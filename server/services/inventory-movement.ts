import type { IStorage } from "../storage";
import type { Item } from "@shared/schema";
import { AuditLogger, type AuditSource, type AuditEventType as AuditEventTypeBase } from "./audit-logger";
import { wsInventoryService } from "./websocket-inventory";

/**
 * INVENTORY MOVEMENT PATTERN DOCUMENTATION
 * =========================================
 * 
 * This system uses PATTERN B: INTERNAL-DRIVEN inventory movements.
 * 
 * KEY INVARIANTS:
 * 
 * 1. pivotQty is READ-ONLY from Extensiv
 *    - The ONLY place pivotQty changes is EXTENSIV_SYNC
 *    - Sales, returns, transfers, backorders NEVER mutate pivotQty
 *    - pivotQty represents physical stock at Pivot 3PL (as reported by Extensiv)
 * 
 * 2. availableForSaleQty is the working sellable field
 *    - Reduced by sales orders
 *    - Increased by cancellations, returns (resellable), and transfers
 *    - Reconciled when pivotQty is refreshed from Extensiv
 * 
 * 3. hildaleQty is buffer/production stock
 *    - ONLY changed by: production, manual adjustments, transfers (decrement)
 *    - Sales orders NEVER touch hildaleQty
 *    - PO receipts do NOT update hildaleQty (POs are for components only)
 * 
 * 4. POs are ONLY for raw/components
 *    - PURCHASE_ORDER_RECEIVED only affects currentStock for components
 *    - If item is finished_product, PO receipt logs warning and does nothing
 * 
 * Movement Rules:
 * 
 * SALES_ORDER_CREATED (from Shopify/Amazon/Direct):
 *   - Decrements availableForSaleQty ONLY (NOT pivotQty)
 *   - NEVER touches hildaleQty
 *   - ONE movement per order line - no double counting
 * 
 * SALES_ORDER_SHIPPED:
 *   - No additional movement (stock already decremented at create)
 *   - NEVER touches hildaleQty or pivotQty
 * 
 * SALES_ORDER_CANCELLED:
 *   - Restores availableForSaleQty ONLY (NOT pivotQty)
 *   - NEVER touches hildaleQty
 * 
 * RETURN_RECEIVED:
 *   - For resellable finished products: increments availableForSaleQty
 *   - For components: increments currentStock
 *   - NEVER touches pivotQty (read-only from Extensiv)
 * 
 * PURCHASE_ORDER_RECEIVED:
 *   - For components (type === 'component'): increments currentStock
 *   - For finished products: NO-OP with warning (POs are for components only)
 *   - NEVER touches hildaleQty, pivotQty, or availableForSaleQty
 * 
 * EXTENSIV_SYNC:
 *   - THE ONLY event that updates pivotQty
 *   - Updates pivotQty to match Extensiv snapshot
 *   - Reconciles availableForSaleQty based on delta
 *   - NO write-back to Extensiv ever
 * 
 * PRODUCTION_COMPLETED:
 *   - Increments hildaleQty for finished products
 *   - This is how finished goods are created
 * 
 * TRANSFER (Hildale → Pivot):
 *   - Decrements hildaleQty
 *   - Increments availableForSaleQty (makes stock sellable)
 *   - Does NOT modify pivotQty (that updates via Extensiv sync)
 * 
 * MANUAL_ADJUSTMENT:
 *   - Location HILDALE: adjusts hildaleQty
 *   - Location PIVOT: adjusts availableForSaleQty
 *   - NEVER touches pivotQty (read-only)
 * 
 * HILDALE INVENTORY CHANGES ONLY FROM:
 *   - Production/BOM builds (increment)
 *   - Hildale → Pivot transfers (decrement)
 *   - Manual adjustments targeting HILDALE
 * 
 * IDEMPOTENCY:
 * - Unique constraint on (channel, externalOrderId) prevents duplicate imports
 * - Shopify/Amazon syncs check getSalesOrdersByExternalId before creating
 * - Each event type results in exactly ONE transaction record
 */

export type InventoryEventType =
  | "SALES_ORDER_CREATED"
  | "SALES_ORDER_SHIPPED"
  | "SALES_ORDER_CANCELLED"
  | "PURCHASE_ORDER_RECEIVED"
  | "RETURN_RECEIVED"
  | "BACKORDER_FULFILLED"
  | "MANUAL_ADJUSTMENT"
  | "PRODUCTION_COMPLETED"
  | "EXTENSIV_SYNC"
  | "TRANSFER"
  | "BOM_CONSUMPTION"
  | "MANUAL_COUNT";

export interface InventoryMovementParams {
  eventType: InventoryEventType;
  itemId: string;
  quantity: number;
  location?: "HILDALE" | "PIVOT" | "N/A";
  source: string;
  orderId?: string;
  returnId?: string;
  poId?: string;
  salesOrderLineId?: string;
  channel?: string;
  userId?: string | number;
  userName?: string;
  notes?: string;
}

export interface InventoryMovementResult {
  success: boolean;
  itemId: string;
  sku: string;
  beforeQty: number;
  afterQty: number;
  quantityChanged: number;
  error?: string;
}

interface InventoryState {
  onHand: number;
  hildaleQty: number;
  pivotQty: number;
  availableForSaleQty: number;
  currentStock: number;
}

export class InventoryMovement {
  constructor(private storage: IStorage) {}

  private getInventoryState(item: Item): InventoryState {
    const hildaleQty = item.hildaleQty ?? 0;
    const pivotQty = item.pivotQty ?? 0;
    const availableForSaleQty = item.availableForSaleQty ?? 0;
    const currentStock = item.currentStock ?? 0;
    
    const onHand = item.type === "finished_product"
      ? hildaleQty + availableForSaleQty
      : currentStock;
    
    return { onHand, hildaleQty, pivotQty, availableForSaleQty, currentStock };
  }

  async apply(params: InventoryMovementParams): Promise<InventoryMovementResult> {
    try {
      const item = await this.storage.getItem(params.itemId);
      if (!item) {
        return {
          success: false,
          itemId: params.itemId,
          sku: "",
          beforeQty: 0,
          afterQty: 0,
          quantityChanged: 0,
          error: `Item ${params.itemId} not found`,
        };
      }

      const beforeState = this.getInventoryState(item);
      const isFinished = item.type === "finished_product";
      const location = params.location || (isFinished ? "PIVOT" : "N/A");
      const isPivotFulfilled = location === "PIVOT";
      
      let updates: {
        hildaleQty?: number;
        pivotQty?: number;
        availableForSaleQty?: number;
        currentStock?: number;
        forecastDirty?: boolean;
      } = {};
      let quantityDelta = 0;

      switch (params.eventType) {
        case "PURCHASE_ORDER_RECEIVED":
          // INVARIANT: POs are ONLY for raw/components, NOT finished products
          // Finished products are created via PRODUCTION_COMPLETED, not PO receipts
          if (isFinished) {
            // Log warning but do NOT update hildaleQty - this is an invalid configuration
            console.warn(`[InventoryMovement] WARNING: PO receipt attempted for finished product ${item.sku}. POs should only be for components. No inventory change applied.`);
            // Return success with zero change to avoid breaking PO flow, but log the issue
            quantityDelta = 0;
            // No updates applied for finished products
          } else {
            // Components: increment currentStock as expected
            quantityDelta = params.quantity;
            updates.currentStock = beforeState.currentStock + params.quantity;
          }
          break;

        case "RETURN_RECEIVED":
          // Returns for finished products go to HILDALE warehouse for inspection
          // They are NOT immediately sellable - must be transferred to Pivot to become sellable
          // INVARIANT: pivotQty is READ-ONLY from Extensiv
          quantityDelta = params.quantity;
          if (isFinished) {
            // Increment hildaleQty - returned stock arrives at Hildale for processing
            // Stock is NOT sellable until transferred from Hildale to Pivot
            updates.hildaleQty = beforeState.hildaleQty + params.quantity;
          } else {
            // Components: increment currentStock
            updates.currentStock = beforeState.currentStock + params.quantity;
          }
          break;

        case "SALES_ORDER_CREATED":
          // INVARIANT: Sales only decrement availableForSaleQty, NOT pivotQty
          // pivotQty is READ-ONLY from Extensiv - only EXTENSIV_SYNC can change it
          // hildaleQty is NEVER touched by sales orders
          if (isFinished) {
            quantityDelta = -params.quantity;
            // ONLY decrement availableForSaleQty - pivotQty stays unchanged (read-only)
            updates.availableForSaleQty = Math.max(0, beforeState.availableForSaleQty - params.quantity);
          }
          break;

        case "SALES_ORDER_SHIPPED":
          // Finished products: Pivot ships are a no-op because pivotQty is read-only
          // from Extensiv (EXTENSIV_SYNC will catch up). Hildale ships decrement
          // hildaleQty because nothing else will.
          if (isFinished) {
            if (location === "HILDALE") {
              if (beforeState.hildaleQty < params.quantity) {
                return {
                  success: false,
                  itemId: params.itemId,
                  sku: item.sku,
                  beforeQty: beforeState.hildaleQty,
                  afterQty: beforeState.hildaleQty,
                  quantityChanged: 0,
                  error: `Insufficient Hildale stock for ${item.sku}. Available: ${beforeState.hildaleQty}, Requested: ${params.quantity}`,
                };
              }
              quantityDelta = -params.quantity;
              updates.hildaleQty = beforeState.hildaleQty - params.quantity;
            }
            // PIVOT: no-op — Extensiv sync is source of truth for pivotQty
          } else {
            // Components: decrement currentStock
            quantityDelta = -params.quantity;
            if (beforeState.currentStock >= params.quantity) {
              updates.currentStock = beforeState.currentStock - params.quantity;
            } else {
              return {
                success: false,
                itemId: params.itemId,
                sku: item.sku,
                beforeQty: beforeState.currentStock,
                afterQty: beforeState.currentStock,
                quantityChanged: 0,
                error: `Insufficient stock for ${item.sku}. Available: ${beforeState.currentStock}, Requested: ${params.quantity}`,
              };
            }
          }
          break;

        case "SALES_ORDER_CANCELLED":
          // INVARIANT: Cancellations only restore availableForSaleQty, NOT pivotQty
          // pivotQty is READ-ONLY from Extensiv - only EXTENSIV_SYNC can change it
          // hildaleQty is NEVER touched by sales orders
          if (isFinished) {
            quantityDelta = params.quantity;
            // ONLY restore availableForSaleQty - pivotQty stays unchanged (read-only)
            updates.availableForSaleQty = beforeState.availableForSaleQty + params.quantity;
          }
          break;

        case "MANUAL_ADJUSTMENT":
          // INVARIANT: Manual adjustments NEVER touch pivotQty (read-only from Extensiv)
          // Location determines which field is adjusted for finished products
          quantityDelta = params.quantity;
          if (isFinished) {
            if (location === "HILDALE") {
              // Adjust buffer stock at Hildale
              updates.hildaleQty = beforeState.hildaleQty + params.quantity;
            } else {
              // Adjust sellable stock (availableForSaleQty, NOT pivotQty)
              updates.availableForSaleQty = beforeState.availableForSaleQty + params.quantity;
            }
          } else {
            // Components: adjust currentStock
            updates.currentStock = beforeState.currentStock + params.quantity;
          }
          break;

        case "PRODUCTION_COMPLETED":
          quantityDelta = params.quantity;
          if (isFinished) {
            updates.hildaleQty = beforeState.hildaleQty + params.quantity;
          }
          break;

        case "EXTENSIV_SYNC":
          // *** THE ONLY EVENT TYPE THAT MODIFIES pivotQty ***
          // This is the ONLY place pivotQty is allowed to change - it's the canonical
          // source of truth from Extensiv's physical inventory snapshot.
          // The delta is applied to availableForSaleQty to keep it in sync.
          if (isFinished) {
            const oldPivotQty = beforeState.pivotQty;
            const newPivotQty = params.quantity;
            const delta = newPivotQty - oldPivotQty;
            
            // Update pivotQty to match Extensiv snapshot (the ONLY place this happens)
            updates.pivotQty = newPivotQty;
            // Reconcile availableForSaleQty based on the delta
            updates.availableForSaleQty = beforeState.availableForSaleQty + delta;
            quantityDelta = delta;
          }
          break;

        case "BACKORDER_FULFILLED":
          quantityDelta = 0;
          break;

        case "TRANSFER":
          // Hildale → Pivot transfer: decrements hildaleQty, increments availableForSaleQty
          // INVARIANT: pivotQty is READ-ONLY from Extensiv, so we only update availableForSaleQty
          // The physical stock at Pivot will be reflected in pivotQty after next Extensiv sync
          if (isFinished) {
            if (beforeState.hildaleQty >= params.quantity) {
              updates.hildaleQty = beforeState.hildaleQty - params.quantity;
              // ONLY increment availableForSaleQty - pivotQty is read-only from Extensiv
              updates.availableForSaleQty = beforeState.availableForSaleQty + params.quantity;
              quantityDelta = 0; // Net change is zero (moving between locations)
            } else {
              return {
                success: false,
                itemId: params.itemId,
                sku: item.sku,
                beforeQty: beforeState.onHand,
                afterQty: beforeState.onHand,
                quantityChanged: 0,
                error: `Insufficient Hildale stock for transfer of ${item.sku}. Available: ${beforeState.hildaleQty}, Requested: ${params.quantity}`,
              };
            }
          }
          break;

        case "BOM_CONSUMPTION":
          // Triggered by Shopify fulfilled webhook — subtracts raw materials based on BOM
          // Only applies to components (raw materials), not finished products
          // NOTE: If Clarence also logs production via the Production Screen, raw materials
          // would be subtracted there too. Operationally, use ONE path — not both.
          if (!isFinished) {
            quantityDelta = -params.quantity;
            updates.currentStock = Math.max(0, beforeState.currentStock - params.quantity);
          }
          break;

        case "MANUAL_COUNT":
          // Physical count adjustment — quantity is the DIFFERENCE (actual - expected)
          // Can be positive (found more than expected) or negative (found less)
          quantityDelta = params.quantity;
          if (isFinished) {
            if (location === "HILDALE") {
              updates.hildaleQty = Math.max(0, beforeState.hildaleQty + params.quantity);
            } else {
              updates.availableForSaleQty = Math.max(0, beforeState.availableForSaleQty + params.quantity);
            }
          } else {
            updates.currentStock = Math.max(0, beforeState.currentStock + params.quantity);
          }
          break;
      }

      if (Object.keys(updates).length > 0) {
        updates.forecastDirty = true;
        await this.storage.updateItem(params.itemId, updates);
        // Realtime broadcast: only the fields we actually mutated. forecastDirty
        // is a bookkeeping flag and not relevant to the UI, so we strip it.
        const changedFields = Object.keys(updates).filter((f) => f !== "forecastDirty");
        if (changedFields.length > 0) {
          wsInventoryService.broadcast({
            itemIds: [params.itemId],
            fields: changedFields,
            reason: params.eventType === "TRANSFER" ? "TRANSFER"
              : params.eventType === "SALES_ORDER_SHIPPED" ? "SHIP"
              : "MOVEMENT",
          });
        }
      }

      const afterItem = await this.storage.getItem(params.itemId);
      const afterState = afterItem ? this.getInventoryState(afterItem) : beforeState;

      await this.logMovement(params, item, beforeState, afterState, quantityDelta);

      return {
        success: true,
        itemId: params.itemId,
        sku: item.sku,
        beforeQty: beforeState.onHand,
        afterQty: afterState.onHand,
        quantityChanged: quantityDelta,
      };
    } catch (error: any) {
      console.error(`[InventoryMovement] Error applying ${params.eventType}:`, error);
      return {
        success: false,
        itemId: params.itemId,
        sku: "",
        beforeQty: 0,
        afterQty: 0,
        quantityChanged: 0,
        error: error.message || "Failed to apply inventory movement",
      };
    }
  }

  private async logMovement(
    params: InventoryMovementParams,
    item: Item,
    beforeState: InventoryState,
    afterState: InventoryState,
    quantityDelta: number
  ): Promise<void> {
    try {
      const eventTypeMap: Record<InventoryEventType, AuditEventTypeBase> = {
        SALES_ORDER_CREATED: "SALES_ORDER_CREATED",
        SALES_ORDER_SHIPPED: "SALES_ORDER_FULFILLED",
        SALES_ORDER_CANCELLED: "SALES_ORDER_CANCELLED",
        PURCHASE_ORDER_RECEIVED: "PURCHASE_ORDER_RECEIVED",
        RETURN_RECEIVED: "RETURN_RECEIVED",
        BACKORDER_FULFILLED: "BACKORDER_FULFILLED",
        MANUAL_ADJUSTMENT: "INVENTORY_ADJUSTED",
        PRODUCTION_COMPLETED: "PRODUCTION_COMPLETED",
        EXTENSIV_SYNC: "INTEGRATION_SYNC",
        TRANSFER: "INVENTORY_TRANSFERRED",
        BOM_CONSUMPTION: "BOM_CONSUMPTION",
        MANUAL_COUNT: "MANUAL_COUNT",
      };

      const entityTypeMap: Record<InventoryEventType, string> = {
        SALES_ORDER_CREATED: "SALES_ORDER",
        SALES_ORDER_SHIPPED: "SALES_ORDER",
        SALES_ORDER_CANCELLED: "SALES_ORDER",
        PURCHASE_ORDER_RECEIVED: "PURCHASE_ORDER",
        RETURN_RECEIVED: "RETURN",
        BACKORDER_FULFILLED: "SALES_ORDER",
        MANUAL_ADJUSTMENT: "ITEM",
        PRODUCTION_COMPLETED: "ITEM",
        EXTENSIV_SYNC: "ITEM",
        TRANSFER: "ITEM",
        BOM_CONSUMPTION: "ITEM",
        MANUAL_COUNT: "ITEM",
      };

      const entityId = params.orderId || params.poId || params.returnId || params.itemId;
      const description = this.buildDescription(params, item, quantityDelta);

      const source: AuditSource = params.source === "USER" || params.source === "SYSTEM" 
        ? params.source as AuditSource 
        : "SYSTEM";

      await AuditLogger.logEvent({
        eventType: eventTypeMap[params.eventType],
        entityType: entityTypeMap[params.eventType],
        entityId,
        entityLabel: item.sku,
        source,
        status: "INFO",
        description,
        details: {
          itemId: params.itemId,
          sku: item.sku,
          itemName: item.name,
          itemType: item.type,
          eventType: params.eventType,
          quantityChanged: quantityDelta,
          location: params.location,
          channel: params.channel,
          before: {
            onHand: beforeState.onHand,
            hildaleQty: beforeState.hildaleQty,
            pivotQty: beforeState.pivotQty,
            availableForSaleQty: beforeState.availableForSaleQty,
            currentStock: beforeState.currentStock,
          },
          after: {
            onHand: afterState.onHand,
            hildaleQty: afterState.hildaleQty,
            pivotQty: afterState.pivotQty,
            availableForSaleQty: afterState.availableForSaleQty,
            currentStock: afterState.currentStock,
          },
          orderId: params.orderId,
          poId: params.poId,
          returnId: params.returnId,
          salesOrderLineId: params.salesOrderLineId,
          notes: params.notes,
        },
        performedByUserId: params.userId?.toString(),
        performedByName: params.userName,
        purchaseOrderId: params.poId,
      });
    } catch (error) {
      console.warn("[InventoryMovement] Failed to log movement:", error);
    }
  }

  private buildDescription(
    params: InventoryMovementParams,
    item: Item,
    quantityDelta: number
  ): string {
    const absQty = Math.abs(quantityDelta);
    const direction = quantityDelta >= 0 ? "increased" : "decreased";
    
    switch (params.eventType) {
      case "SALES_ORDER_CREATED":
        return `Sales order created: ${absQty} ${item.sku} allocated from ${params.location || 'PIVOT'}`;
      case "SALES_ORDER_SHIPPED":
        return `Sales order shipped: ${absQty} ${item.sku} ${direction} at ${params.location || 'warehouse'}`;
      case "SALES_ORDER_CANCELLED":
        return `Sales order cancelled: ${absQty} ${item.sku} restored to ${params.location || 'PIVOT'}`;
      case "PURCHASE_ORDER_RECEIVED":
        return `PO received: ${absQty} ${item.sku} added to inventory`;
      case "RETURN_RECEIVED":
        return `Return received: ${absQty} ${item.sku} restocked to Hildale`;
      case "BACKORDER_FULFILLED":
        return `Backorder fulfilled: ${absQty} ${item.sku} allocated`;
      case "MANUAL_ADJUSTMENT":
        return `Manual adjustment: ${item.sku} ${direction} by ${absQty} at ${params.location || 'warehouse'}`;
      case "PRODUCTION_COMPLETED":
        return `Production completed: ${absQty} ${item.sku} added to Hildale`;
      case "EXTENSIV_SYNC":
        return `Extensiv sync: ${item.sku} pivot qty updated by ${quantityDelta}`;
      case "TRANSFER":
        return `Transfer: ${absQty} ${item.sku} moved`;
      case "BOM_CONSUMPTION":
        return `BOM consumption: ${absQty} ${item.sku} subtracted (order fulfillment)`;
      case "MANUAL_COUNT":
        return `Manual count: ${item.sku} ${direction} by ${absQty} at ${params.location || 'warehouse'}`;
      default:
        return `Inventory ${direction} by ${absQty} for ${item.sku}`;
    }
  }
}
