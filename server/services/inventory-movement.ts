import type { IStorage } from "../storage";
import type { Item } from "@shared/schema";
import { AuditLogger, type AuditSource, type AuditEventType as AuditEventTypeBase } from "./audit-logger";

/**
 * INVENTORY MOVEMENT PATTERN DOCUMENTATION
 * =========================================
 * 
 * This system uses PATTERN B: INTERNAL-DRIVEN inventory movements.
 * 
 * Core Principle:
 * - Sales Orders in THIS app are the canonical source of stock movements
 * - Shopify/Amazon/external channels FEED order data into our Sales Orders
 * - External channels do NOT move stock directly - only our Sales Orders do
 * 
 * Movement Rules:
 * 
 * SALES_ORDER_CREATED (from Shopify/Amazon/Direct):
 *   - For Pivot-fulfilled orders (Shopify/Amazon): decrements availableForSaleQty
 *   - For Hildale orders: no movement at create time (movement happens at ship)
 *   - ONE movement per order line - no double counting
 * 
 * SALES_ORDER_SHIPPED:
 *   - For Pivot orders: no additional movement (already decremented at create)
 *   - For Hildale orders: decrements hildaleQty
 * 
 * SALES_ORDER_CANCELLED:
 *   - For Pivot orders: increments availableForSaleQty (restores stock)
 *   - For Hildale orders: no movement (nothing was decremented)
 * 
 * RETURN_RECEIVED:
 *   - Returns ALWAYS go to HILDALE only (not Pivot, not availableForSale)
 *   - Increments hildaleQty ONLY - NOT availableForSaleQty
 *   - Returned items are buffer stock until explicitly transferred to Pivot
 *   - Only on RESTOCK disposition, not SCRAP/INSPECT
 *   - Extensiv is READ-ONLY - no write-back for returns
 * 
 * PURCHASE_ORDER_RECEIVED:
 *   - Increments pivotQty AND availableForSaleQty for finished products
 *   - Increments currentStock for components
 * 
 * EXTENSIV_SYNC:
 *   - READ-ONLY sync from Extensiv/3PL warehouse
 *   - Updates pivotQty to match Extensiv snapshot
 *   - Adjusts availableForSaleQty by delta (newPivotQty - oldPivotQty)
 *   - NO write-back to Extensiv ever
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
  | "TRANSFER";

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
          quantityDelta = params.quantity;
          if (isFinished) {
            updates.pivotQty = beforeState.pivotQty + params.quantity;
            updates.availableForSaleQty = beforeState.availableForSaleQty + params.quantity;
          } else {
            updates.currentStock = beforeState.currentStock + params.quantity;
          }
          break;

        case "RETURN_RECEIVED":
          // Returns ALWAYS go to HILDALE only - NOT available for sale until transferred to Pivot
          // This enforces Extensiv as READ-ONLY and requires explicit Hildale → Pivot transfer
          quantityDelta = params.quantity;
          if (isFinished) {
            // Only increment hildaleQty - NOT availableForSaleQty
            // Item must be transferred to Pivot via scan/transfer workflow to become sellable
            updates.hildaleQty = beforeState.hildaleQty + params.quantity;
          } else {
            updates.currentStock = beforeState.currentStock + params.quantity;
          }
          break;

        case "SALES_ORDER_CREATED":
          if (isFinished && isPivotFulfilled) {
            quantityDelta = -params.quantity;
            updates.availableForSaleQty = beforeState.availableForSaleQty - params.quantity;
          }
          break;

        case "SALES_ORDER_SHIPPED":
          if (isFinished) {
            if (isPivotFulfilled) {
              quantityDelta = 0;
            } else {
              quantityDelta = -params.quantity;
              if (beforeState.hildaleQty >= params.quantity) {
                updates.hildaleQty = beforeState.hildaleQty - params.quantity;
              } else {
                return {
                  success: false,
                  itemId: params.itemId,
                  sku: item.sku,
                  beforeQty: beforeState.onHand,
                  afterQty: beforeState.onHand,
                  quantityChanged: 0,
                  error: `Insufficient Hildale stock for ${item.sku}. Available: ${beforeState.hildaleQty}, Requested: ${params.quantity}`,
                };
              }
            }
          } else {
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
          if (isFinished && isPivotFulfilled) {
            quantityDelta = params.quantity;
            updates.availableForSaleQty = beforeState.availableForSaleQty + params.quantity;
          }
          break;

        case "MANUAL_ADJUSTMENT":
          quantityDelta = params.quantity;
          if (isFinished) {
            if (location === "HILDALE") {
              updates.hildaleQty = beforeState.hildaleQty + params.quantity;
            } else {
              updates.availableForSaleQty = beforeState.availableForSaleQty + params.quantity;
            }
          } else {
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
          if (isFinished) {
            const oldPivotQty = beforeState.pivotQty;
            const newPivotQty = params.quantity;
            const delta = newPivotQty - oldPivotQty;
            
            updates.pivotQty = newPivotQty;
            updates.availableForSaleQty = beforeState.availableForSaleQty + delta;
            quantityDelta = delta;
          }
          break;

        case "BACKORDER_FULFILLED":
          quantityDelta = 0;
          break;

        case "TRANSFER":
          quantityDelta = 0;
          break;
      }

      if (Object.keys(updates).length > 0) {
        updates.forecastDirty = true;
        await this.storage.updateItem(params.itemId, updates);
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
      default:
        return `Inventory ${direction} by ${absQty} for ${item.sku}`;
    }
  }
}
