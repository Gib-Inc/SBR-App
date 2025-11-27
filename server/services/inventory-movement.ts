import type { IStorage } from "../storage";
import type { Item } from "@shared/schema";
import { AuditLogger, type AuditSource, type AuditEventType as AuditEventTypeBase } from "./audit-logger";

export type InventoryEventType =
  | "SALES_ORDER_CREATED"
  | "SALES_ORDER_FULFILLED"
  | "SALES_ORDER_CANCELLED"
  | "PURCHASE_ORDER_RECEIVED"
  | "RETURN_RECEIVED"
  | "BACKORDER_FULFILLED"
  | "MANUAL_ADJUSTMENT"
  | "PRODUCTION_COMPLETED"
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
  currentStock: number;
}

export class InventoryMovement {
  constructor(private storage: IStorage) {}

  private getInventoryState(item: Item): InventoryState {
    const hildaleQty = item.hildaleQty ?? 0;
    const pivotQty = item.pivotQty ?? 0;
    const currentStock = item.currentStock ?? 0;
    
    const onHand = item.type === "finished_product"
      ? hildaleQty + pivotQty
      : currentStock;
    
    return { onHand, hildaleQty, pivotQty, currentStock };
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
      // Default to PIVOT for finished products (warehouse where inventory is received)
      const location = params.location || (isFinished ? "PIVOT" : "N/A");
      
      let updates: {
        hildaleQty?: number;
        pivotQty?: number;
        currentStock?: number;
        forecastDirty?: boolean;
      } = {};
      let quantityDelta = 0;

      switch (params.eventType) {
        case "PURCHASE_ORDER_RECEIVED":
        case "RETURN_RECEIVED":
          quantityDelta = params.quantity;
          if (isFinished) {
            if (location === "HILDALE") {
              updates.hildaleQty = beforeState.hildaleQty + params.quantity;
            } else {
              updates.pivotQty = beforeState.pivotQty + params.quantity;
            }
          } else {
            updates.currentStock = beforeState.currentStock + params.quantity;
          }
          break;

        case "SALES_ORDER_FULFILLED":
          quantityDelta = -params.quantity;
          if (isFinished) {
            if (location === "PIVOT" && beforeState.pivotQty >= params.quantity) {
              updates.pivotQty = beforeState.pivotQty - params.quantity;
            } else if (beforeState.hildaleQty >= params.quantity) {
              updates.hildaleQty = beforeState.hildaleQty - params.quantity;
            } else {
              return {
                success: false,
                itemId: params.itemId,
                sku: item.sku,
                beforeQty: beforeState.onHand,
                afterQty: beforeState.onHand,
                quantityChanged: 0,
                error: `Insufficient stock for ${item.sku}. Available: ${beforeState.onHand}, Requested: ${params.quantity}`,
              };
            }
          } else {
            if (beforeState.currentStock < params.quantity) {
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
            updates.currentStock = beforeState.currentStock - params.quantity;
          }
          break;

        case "MANUAL_ADJUSTMENT":
          quantityDelta = params.quantity;
          if (isFinished) {
            if (location === "HILDALE") {
              updates.hildaleQty = beforeState.hildaleQty + params.quantity;
            } else {
              updates.pivotQty = beforeState.pivotQty + params.quantity;
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

        case "SALES_ORDER_CREATED":
        case "SALES_ORDER_CANCELLED":
        case "BACKORDER_FULFILLED":
          // Lifecycle events - log audit only, no inventory change
          quantityDelta = 0;
          break;

        case "TRANSFER":
          // Transfer between locations - handled separately
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
        SALES_ORDER_FULFILLED: "SALES_ORDER_FULFILLED",
        SALES_ORDER_CANCELLED: "SALES_ORDER_CANCELLED",
        PURCHASE_ORDER_RECEIVED: "PURCHASE_ORDER_RECEIVED",
        RETURN_RECEIVED: "RETURN_RECEIVED",
        BACKORDER_FULFILLED: "BACKORDER_FULFILLED",
        MANUAL_ADJUSTMENT: "INVENTORY_ADJUSTED",
        PRODUCTION_COMPLETED: "PRODUCTION_COMPLETED",
        TRANSFER: "INVENTORY_TRANSFERRED",
      };

      const entityTypeMap: Record<InventoryEventType, string> = {
        SALES_ORDER_CREATED: "SALES_ORDER",
        SALES_ORDER_FULFILLED: "SALES_ORDER",
        SALES_ORDER_CANCELLED: "SALES_ORDER",
        PURCHASE_ORDER_RECEIVED: "PURCHASE_ORDER",
        RETURN_RECEIVED: "RETURN",
        BACKORDER_FULFILLED: "SALES_ORDER",
        MANUAL_ADJUSTMENT: "ITEM",
        PRODUCTION_COMPLETED: "ITEM",
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
          before: {
            onHand: beforeState.onHand,
            hildaleQty: beforeState.hildaleQty,
            pivotQty: beforeState.pivotQty,
            currentStock: beforeState.currentStock,
          },
          after: {
            onHand: afterState.onHand,
            hildaleQty: afterState.hildaleQty,
            pivotQty: afterState.pivotQty,
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
        return `Sales order created for ${params.quantity} units of ${item.sku}`;
      
      case "SALES_ORDER_FULFILLED":
        return `Shipped ${absQty} units of ${item.sku} from ${params.location}`;
      
      case "SALES_ORDER_CANCELLED":
        return `Sales order cancelled, released allocation for ${item.sku}`;
      
      case "PURCHASE_ORDER_RECEIVED":
        return `Received ${absQty} units of ${item.sku} from PO into ${params.location}`;
      
      case "RETURN_RECEIVED":
        return `Return received: ${absQty} units of ${item.sku} restocked to ${params.location}`;
      
      case "BACKORDER_FULFILLED":
        return `Backorder fulfilled: allocated ${absQty} units of ${item.sku} to pending order`;
      
      case "MANUAL_ADJUSTMENT":
        return `Manual adjustment: ${item.sku} stock ${direction} by ${absQty} at ${params.location}`;
      
      case "PRODUCTION_COMPLETED":
        return `Production completed: ${absQty} units of ${item.sku} added to Hildale`;
      
      case "TRANSFER":
        return `Transfer: ${absQty} units of ${item.sku} moved`;
      
      default:
        return `Inventory movement: ${item.sku} ${direction} by ${absQty}`;
    }
  }

  async applyBatch(movements: InventoryMovementParams[]): Promise<InventoryMovementResult[]> {
    const results: InventoryMovementResult[] = [];
    for (const movement of movements) {
      const result = await this.apply(movement);
      results.push(result);
    }
    return results;
  }
}
