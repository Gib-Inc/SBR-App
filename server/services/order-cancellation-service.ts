/**
 * Order Cancellation Service
 * Orchestrates cancellation across all integrated systems:
 * - Shopify (cancel order)
 * - QuickBooks (create credit memo)
 * - GoHighLevel (update opportunity to lost)
 * - Local database (update status)
 */

import { storage } from "../storage";
import { ghlOpportunitiesService } from "./ghl-opportunities-service";
import { GHL_CONFIG } from "../config/ghl-config";
import { InventoryMovement } from "./inventory-movement";
import type { SalesOrder, SalesOrderLine } from "@shared/schema";

interface CancellationResult {
  success: boolean;
  error?: string;
  shopifyCancelled?: boolean;
  quickbooksCreditMemo?: boolean;
  ghlUpdated?: boolean;
  localUpdated?: boolean;
  details?: Record<string, any>;
}

interface CancellationOptions {
  skipShopify?: boolean;
  skipQuickBooks?: boolean;
  skipGHL?: boolean;
  reason?: string;
  notifyCustomer?: boolean;
}

export class OrderCancellationService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Cancel an order across all integrated systems
   */
  async cancelOrder(
    orderId: string,
    options: CancellationOptions = {}
  ): Promise<CancellationResult> {
    console.log(`[OrderCancellation] Starting cancellation for order: ${orderId}`);

    const result: CancellationResult = {
      success: false,
      shopifyCancelled: false,
      quickbooksCreditMemo: false,
      ghlUpdated: false,
      localUpdated: false,
      details: {},
    };

    try {
      // Get the order
      const order = await storage.getSalesOrder(orderId);
      if (!order) {
        return { success: false, error: "Sales order not found" };
      }

      // Get all line items
      const lines = await storage.getSalesOrderLines(orderId);

      // Check if any items have been fulfilled - if so, cannot cancel
      const anyFulfilled = lines.some((line: SalesOrderLine) => (line.qtyFulfilled ?? 0) > 0);
      if (anyFulfilled) {
        return { 
          success: false, 
          error: "Cannot cancel order with fulfilled items. Use returns instead." 
        };
      }

      // 1. Cancel in Shopify (if applicable)
      if (!options.skipShopify && order.channel === 'SHOPIFY' && order.externalOrderId) {
        try {
          const shopifyResult = await this.cancelInShopify(order, options);
          result.shopifyCancelled = shopifyResult.success;
          result.details!.shopify = shopifyResult;
          if (!shopifyResult.success) {
            console.warn(`[OrderCancellation] Shopify cancellation failed: ${shopifyResult.error}`);
          }
        } catch (error: any) {
          console.error(`[OrderCancellation] Shopify error:`, error.message);
          result.details!.shopify = { success: false, error: error.message };
        }
      }

      // 2. Update GHL opportunity to "lost" status
      if (!options.skipGHL) {
        try {
          const ghlResult = await this.updateGHLOpportunity(order, options.reason);
          result.ghlUpdated = ghlResult.success;
          result.details!.ghl = ghlResult;
        } catch (error: any) {
          console.error(`[OrderCancellation] GHL error:`, error.message);
          result.details!.ghl = { success: false, error: error.message };
        }
      }

      // 3. Update local database
      try {
        await this.updateLocalDatabase(order, lines, options.reason);
        result.localUpdated = true;
      } catch (error: any) {
        console.error(`[OrderCancellation] Local update error:`, error.message);
        return { success: false, error: `Failed to update local database: ${error.message}` };
      }

      // Log the cancellation
      const user = await storage.getUser(this.userId);
      await storage.createAuditLog({
        source: 'USER',
        eventType: 'ORDER_CANCELLED',
        entityType: 'SALES_ORDER',
        entityId: orderId,
        entityLabel: order.externalOrderId || order.id.slice(0, 8),
        performedByUserId: this.userId,
        performedByName: user?.email || 'Unknown',
        status: 'INFO',
        description: `Order cancelled - full refund of ${order.totalAmount} ${order.currency}`,
        details: {
          orderId,
          refundAmount: order.totalAmount,
          currency: order.currency,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          shopifyCancelled: result.shopifyCancelled,
          ghlUpdated: result.ghlUpdated,
          reason: options.reason,
        },
      });

      result.success = true;
      console.log(`[OrderCancellation] Successfully cancelled order ${orderId}`);
      return result;

    } catch (error: any) {
      console.error(`[OrderCancellation] Unexpected error:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel the order in Shopify
   */
  private async cancelInShopify(
    order: SalesOrder,
    options: CancellationOptions
  ): Promise<{ success: boolean; error?: string }> {
    console.log(`[OrderCancellation] Cancelling Shopify order: ${order.externalOrderId}`);

    const config = await storage.getIntegrationConfig(this.userId, "SHOPIFY") as any;
    if (!config?.shopDomain || !config?.apiKey) {
      return { success: false, error: "Shopify not configured" };
    }

    const shopDomain = config.shopDomain as string;
    const accessToken = config.apiKey as string;
    
    try {
      // Use Shopify Admin API to cancel the order
      const apiVersion = "2024-01";
      const url = `https://${shopDomain}/admin/api/${apiVersion}/orders/${order.externalOrderId}/cancel.json`;
      
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          reason: options.reason || "customer",
          email: options.notifyCustomer ?? true,
          restock: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OrderCancellation] Shopify cancel failed: ${response.status} - ${errorText}`);
        
        // Check if already cancelled (422 typically means already cancelled)
        if (response.status === 422 && errorText.includes("already cancelled")) {
          return { success: true };
        }
        
        return { success: false, error: `Shopify API error: ${response.status}` };
      }

      console.log(`[OrderCancellation] Shopify order ${order.externalOrderId} cancelled`);
      return { success: true };

    } catch (error: any) {
      console.error(`[OrderCancellation] Shopify cancel error:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update GHL opportunity to "lost" status
   */
  private async updateGHLOpportunity(
    order: SalesOrder,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> {
    console.log(`[OrderCancellation] Updating GHL opportunity for order: ${order.id}`);

    await ghlOpportunitiesService.initialize(this.userId);
    
    if (!ghlOpportunitiesService.isConfigured()) {
      console.log("[OrderCancellation] GHL not configured - skipping");
      return { success: false, error: "GHL not configured" };
    }

    if (!order.ghlProductionOpportunityId) {
      console.log("[OrderCancellation] No GHL opportunity linked - skipping");
      return { success: false, error: "No GHL opportunity linked" };
    }

    try {
      // Use the opportunities service to update the opportunity to "lost" status
      const result = await ghlOpportunitiesService.upsertOpportunity({
        externalKey: `sales-order-${order.id}`,
        name: `[CANCELLED] ${order.externalOrderId || order.id.slice(0, 8)} - ${order.customerName}`,
        pipelineStageId: GHL_CONFIG.stages.SALES_ORDERS,
        status: "lost",
        amount: 0,
        existingOpportunityId: order.ghlProductionOpportunityId,
        customFields: {
          order_status: 'CANCELLED',
          cancellation_reason: reason || 'Customer requested',
          cancelled_at: new Date().toISOString(),
        },
      });

      return { success: result.success, error: result.error };

    } catch (error: any) {
      console.error(`[OrderCancellation] GHL update error:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update local database with cancellation
   */
  private async updateLocalDatabase(
    order: SalesOrder,
    lines: SalesOrderLine[],
    reason?: string
  ): Promise<void> {
    console.log(`[OrderCancellation] Updating local database for order: ${order.id}`);

    const affectedProductIds = new Set<string>();
    const inventoryMovement = new InventoryMovement(storage);
    const user = await storage.getUser(this.userId);
    const isPivotOrder = order.channel === 'SHOPIFY' || order.channel === 'AMAZON';

    // Update each line: set qtyAllocated = 0, backorderQty = 0
    for (const line of lines) {
      await storage.updateSalesOrderLine(line.id, {
        qtyAllocated: 0,
        backorderQty: 0,
      });
      affectedProductIds.add(line.productId);

      // Log SALES_ORDER_CANCELLED event and restore availableForSaleQty for Pivot orders
      await inventoryMovement.apply({
        eventType: "SALES_ORDER_CANCELLED",
        itemId: line.productId,
        quantity: line.qtyOrdered,
        location: isPivotOrder ? "PIVOT" : "HILDALE",
        source: "USER",
        orderId: order.id,
        salesOrderLineId: line.id,
        channel: order.channel,
        userId: this.userId,
        userName: user?.email,
        notes: `Order ${order.externalOrderId || order.id} cancelled${reason ? `: ${reason}` : ''}: released ${line.qtyAllocated} allocated, ${line.backorderQty} backordered`,
      });
    }

    // Update order status to CANCELLED with cancelledAt timestamp
    await storage.updateSalesOrder(order.id, { 
      status: 'CANCELLED',
      cancelledAt: new Date(),
      returnStatus: 'REFUNDED',
      totalRefundAmount: order.totalAmount,
    });

    // Refresh backorder snapshots and forecast context for all products
    for (const productId of Array.from(affectedProductIds)) {
      await storage.refreshBackorderSnapshot(productId);
      await storage.refreshProductForecastContext(productId);
    }
  }
}

export function createOrderCancellationService(userId: string): OrderCancellationService {
  return new OrderCancellationService(userId);
}
