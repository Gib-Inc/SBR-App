import type { IStorage } from "../storage";
import type { Item, SalesOrderLine } from "@shared/schema";
import { AuditLogger } from "./audit-logger";

export interface BackorderFulfillmentResult {
  success: boolean;
  itemId: string;
  sku: string;
  stockAvailable: number;
  linesProcessed: number;
  totalAllocated: number;
  fulfillments: Array<{
    salesOrderLineId: string;
    salesOrderId: string;
    qtyAllocated: number;
    newBackorderQty: number;
  }>;
  error?: string;
}

/**
 * BackorderService handles automatic fulfillment of backorders when stock increases.
 * 
 * When stock increases (from PO receipts or returns), this service:
 * 1. Finds all open sales order lines with backorder qty for that product
 * 2. Allocates available stock to those lines (FIFO by order date)
 * 3. Updates the sales order lines with new allocated/backorder quantities
 * 4. Refreshes the backorder snapshot for the product
 */
export class BackorderService {
  constructor(private storage: IStorage) {}

  /**
   * Check and fulfill backorders for a specific product after stock increase.
   * 
   * @param itemId - The product ID that received new stock
   * @param stockIncrease - The quantity of stock that was added
   * @returns Result object with details of what was fulfilled
   */
  async checkAndFulfillBackorders(
    itemId: string,
    stockIncrease: number
  ): Promise<BackorderFulfillmentResult> {
    try {
      const item = await this.storage.getItem(itemId);
      if (!item) {
        return {
          success: false,
          itemId,
          sku: '',
          stockAvailable: 0,
          linesProcessed: 0,
          totalAllocated: 0,
          fulfillments: [],
          error: `Item ${itemId} not found`,
        };
      }

      // Only process finished products (backorders are for finished products)
      if (item.type !== 'finished_product') {
        return {
          success: true,
          itemId,
          sku: item.sku,
          stockAvailable: 0,
          linesProcessed: 0,
          totalAllocated: 0,
          fulfillments: [],
        };
      }

      // Allocate from the HILDALE buffer only — NOT pivotQty (audit #13). pivotQty is the
      // Extensiv physical Pivot count that already underlies availableForSaleQty (the real
      // sellable number, decremented at order time); adding it here double-counts. Also
      // subtract Hildale units already reserved by prior backorder auto-fulfill runs; those
      // units have not physically shipped yet, but they are no longer available to allocate
      // to another waiting customer.
      const hildaleReserved = await this.storage.getOpenBackorderFulfilledQtyByProduct(itemId);
      const availableStock = Math.max(0, (item.hildaleQty ?? 0) - hildaleReserved);

      // Get open backorder lines for this product (sorted by order date, FIFO)
      const backorderLines = await this.storage.getOpenBackorderLinesByProduct(itemId);

      if (backorderLines.length === 0) {
        return {
          success: true,
          itemId,
          sku: item.sku,
          stockAvailable: availableStock,
          linesProcessed: 0,
          totalAllocated: 0,
          fulfillments: [],
        };
      }

      let remainingStock = availableStock;
      let totalAllocated = 0;
      const fulfillments: BackorderFulfillmentResult['fulfillments'] = [];

      // Process each backorder line in FIFO order
      for (const line of backorderLines) {
        if (remainingStock <= 0) break;

        const backorderQty = line.backorderQty ?? 0;
        if (backorderQty <= 0) continue;

        // Allocate as much as possible to this line
        const qtyToAllocate = Math.min(backorderQty, remainingStock);
        const newAllocated = (line.qtyAllocated ?? 0) + qtyToAllocate;
        const newBackorderQty = backorderQty - qtyToAllocate;

        // Update the sales order line. These units came from the HILDALE buffer, NOT from
        // availableForSaleQty (which was only drawn down for the in-stock portion at order
        // create). Track them in backorderFulfilledQty so a later cancel restores afs by
        // ONLY the afs-sourced portion (qtyAllocated - backorderFulfilledQty) — otherwise
        // cancel over-restores sellable stock these units never came from → oversell (#14).
        // No inventory is decremented here: the units remain in Hildale and leave only when
        // the order ships (SALES_ORDER_SHIPPED from Hildale).
        await this.storage.updateSalesOrderLine(line.id, {
          qtyAllocated: newAllocated,
          backorderQty: newBackorderQty,
          backorderFulfilledQty: (line.backorderFulfilledQty ?? 0) + qtyToAllocate,
        });

        fulfillments.push({
          salesOrderLineId: line.id,
          salesOrderId: line.salesOrderId,
          qtyAllocated: qtyToAllocate,
          newBackorderQty,
        });

        // Log BACKORDER_FULFILLED event
        try {
          await AuditLogger.logEvent({
            source: 'SYSTEM',
            eventType: 'BACKORDER_FULFILLED',
            entityType: 'SALES_ORDER',
            entityId: line.salesOrderId,
            entityLabel: item.sku,
            status: 'INFO',
            description: `Backorder fulfilled: allocated ${qtyToAllocate} units of ${item.sku} to order ${line.salesOrderId}`,
            details: {
              itemId: item.id,
              sku: item.sku,
              itemName: item.name,
              salesOrderLineId: line.id,
              salesOrderId: line.salesOrderId,
              qtyAllocated: qtyToAllocate,
              previousBackorderQty: backorderQty,
              newBackorderQty,
              remainingStock: remainingStock - qtyToAllocate,
            },
          });
        } catch (logError) {
          console.warn('[BackorderService] Failed to log backorder fulfillment:', logError);
        }

        remainingStock -= qtyToAllocate;
        totalAllocated += qtyToAllocate;
      }

      // Refresh the backorder snapshot for this product
      await this.storage.refreshBackorderSnapshot(itemId);

      console.log(`[BackorderService] Fulfilled ${totalAllocated} units for ${item.sku} across ${fulfillments.length} order lines`);

      return {
        success: true,
        itemId,
        sku: item.sku,
        stockAvailable: availableStock,
        linesProcessed: fulfillments.length,
        totalAllocated,
        fulfillments,
      };
    } catch (error: any) {
      console.error(`[BackorderService] Error fulfilling backorders for ${itemId}:`, error);
      return {
        success: false,
        itemId,
        sku: '',
        stockAvailable: 0,
        linesProcessed: 0,
        totalAllocated: 0,
        fulfillments: [],
        error: error.message || 'Failed to fulfill backorders',
      };
    }
  }

  /**
   * Process backorders for multiple items (e.g., after bulk PO receipt)
   */
  async checkAndFulfillMultipleBackorders(
    itemIds: string[]
  ): Promise<BackorderFulfillmentResult[]> {
    const results: BackorderFulfillmentResult[] = [];
    
    for (const itemId of itemIds) {
      const result = await this.checkAndFulfillBackorders(itemId, 0);
      results.push(result);
    }
    
    return results;
  }
}
