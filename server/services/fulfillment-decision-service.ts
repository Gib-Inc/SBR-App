/**
 * Fulfillment Decision Service
 * 
 * Determines which warehouse (HILDALE vs PIVOT_EXTENSIV) should fulfill an order
 * based on inventory levels and threshold rules.
 * 
 * Decision Logic:
 * 1. If pivotQty > 0 and would stay above threshold, use PIVOT_EXTENSIV
 * 2. If hildaleQty > 0 and pivot is depleted/below threshold, use HILDALE
 * 3. Fall back to HILDALE as default (source of truth for internal stock)
 * 
 * Threshold Rules (from AI Agent Settings):
 * - extensivPivotThreshold: Days of stock at Pivot that triggers Hildale fallback
 * - extensivHildaleThreshold: Days of stock at Hildale that triggers rebalance alert
 * 
 * When Hildale stock drops below its threshold, the system triggers:
 * - GHL opportunity for stock rebalance (transfer from Hildale to Pivot)
 * - System log entry for tracking
 */

import { storage } from "../storage";
import { logService } from "./log-service";
import { FulfillmentSource } from "@shared/schema";
import type { Item, AiAgentSettings, SalesOrder } from "@shared/schema";

export interface FulfillmentDecision {
  source: typeof FulfillmentSource[keyof typeof FulfillmentSource];
  reason: string;
  pivotQtyAfter: number;
  hildaleQtyAfter: number;
  shouldAlertRebalance: boolean;
  rebalanceReason?: string;
}

export interface ThresholdConfig {
  pivotThresholdDays: number;
  hildaleThresholdDays: number;
  safetyBuffer: number;
}

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  pivotThresholdDays: 7,    // Default: fallback to Hildale if Pivot has < 7 days stock
  hildaleThresholdDays: 14, // Default: alert for rebalance if Hildale has < 14 days stock
  safetyBuffer: 0,          // Additional safety buffer units
};

export class FulfillmentDecisionService {
  /**
   * Get threshold configuration from AI Agent Settings
   */
  async getThresholds(userId: string): Promise<ThresholdConfig> {
    try {
      const settings = await storage.getAiAgentSettingsByUserId(userId);
      
      if (settings) {
        return {
          pivotThresholdDays: settings.pivotLowDaysThreshold ?? DEFAULT_THRESHOLDS.pivotThresholdDays,
          hildaleThresholdDays: settings.hildaleHighDaysThreshold ?? DEFAULT_THRESHOLDS.hildaleThresholdDays,
          safetyBuffer: DEFAULT_THRESHOLDS.safetyBuffer,
        };
      }
    } catch (error) {
      console.warn('[FulfillmentDecision] Error loading thresholds, using defaults:', error);
    }
    
    return DEFAULT_THRESHOLDS;
  }

  /**
   * Calculate daily sales velocity for an item
   */
  async getDailySalesVelocity(itemId: string): Promise<number> {
    try {
      const allOrders = await storage.getAllSalesOrders();
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      
      const recentOrders = allOrders.filter(order => 
        order.orderDate >= fourteenDaysAgo && order.status !== 'cancelled'
      );
      
      if (recentOrders.length === 0) return 0;
      
      let totalQuantity = 0;
      for (const order of recentOrders) {
        const lines = await storage.getSalesOrderLines(order.id);
        const lineItem = lines.find(line => line.productId === itemId);
        if (lineItem) {
          totalQuantity += lineItem.qtyOrdered ?? 0;
        }
      }
      
      return totalQuantity / 14;
    } catch (error) {
      console.warn(`[FulfillmentDecision] Error calculating velocity for ${itemId}:`, error);
      return 0;
    }
  }

  /**
   * Decide which warehouse should fulfill an order for a given item
   */
  async decideSource(
    item: Item,
    orderQuantity: number,
    userId: string
  ): Promise<FulfillmentDecision> {
    const thresholds = await this.getThresholds(userId);
    const velocity = await this.getDailySalesVelocity(item.id);
    
    const pivotQty = item.pivotQty ?? 0;
    const hildaleQty = item.hildaleQty ?? 0;
    const availableForSale = item.availableForSaleQty ?? 0;
    
    const pivotDaysStock = velocity > 0 ? pivotQty / velocity : 999;
    const hildaleDaysStock = velocity > 0 ? hildaleQty / velocity : 999;
    
    let decision: FulfillmentDecision;

    if (pivotQty >= orderQuantity && pivotDaysStock > thresholds.pivotThresholdDays) {
      decision = {
        source: FulfillmentSource.PIVOT_EXTENSIV,
        reason: `Pivot has ${pivotQty} units (${Math.round(pivotDaysStock)} days), above ${thresholds.pivotThresholdDays}-day threshold`,
        pivotQtyAfter: pivotQty - orderQuantity,
        hildaleQtyAfter: hildaleQty,
        shouldAlertRebalance: false,
      };
    } else if (hildaleQty >= orderQuantity) {
      const hildaleAfter = hildaleQty - orderQuantity;
      const hildaleDaysAfter = velocity > 0 ? hildaleAfter / velocity : 999;
      const shouldAlert = hildaleDaysAfter < thresholds.hildaleThresholdDays;
      
      decision = {
        source: FulfillmentSource.HILDALE,
        reason: pivotQty < orderQuantity 
          ? `Pivot insufficient (${pivotQty} < ${orderQuantity}), using Hildale (${hildaleQty} units)`
          : `Pivot below threshold (${Math.round(pivotDaysStock)} days), using Hildale (${hildaleQty} units)`,
        pivotQtyAfter: pivotQty,
        hildaleQtyAfter: hildaleAfter,
        shouldAlertRebalance: shouldAlert,
        rebalanceReason: shouldAlert 
          ? `Hildale will have ${Math.round(hildaleDaysAfter)} days stock after fulfillment (below ${thresholds.hildaleThresholdDays}-day threshold)`
          : undefined,
      };
    } else if (pivotQty + hildaleQty >= orderQuantity) {
      decision = {
        source: FulfillmentSource.HILDALE,
        reason: `Splitting: Hildale (${hildaleQty}) + Pivot (${pivotQty}) covers order`,
        pivotQtyAfter: pivotQty,
        hildaleQtyAfter: Math.max(0, hildaleQty - orderQuantity),
        shouldAlertRebalance: true,
        rebalanceReason: `Low combined stock: ${pivotQty + hildaleQty} units for ${orderQuantity} order`,
      };
    } else {
      decision = {
        source: FulfillmentSource.HILDALE,
        reason: `Insufficient total stock: ${pivotQty + hildaleQty} available for ${orderQuantity} order (backorder)`,
        pivotQtyAfter: pivotQty,
        hildaleQtyAfter: Math.max(0, hildaleQty - orderQuantity),
        shouldAlertRebalance: true,
        rebalanceReason: `Backorder condition: need ${orderQuantity}, have ${pivotQty + hildaleQty}`,
      };
    }

    console.log(`[FulfillmentDecision] ${item.sku}: ${decision.source} - ${decision.reason}`);
    return decision;
  }

  /**
   * Decide fulfillment source for a full order with multiple line items
   */
  async decideOrderSource(
    lineItems: Array<{ itemId: string; quantity: number }>,
    userId: string
  ): Promise<{
    overallSource: typeof FulfillmentSource[keyof typeof FulfillmentSource];
    decisions: Record<string, FulfillmentDecision>;
    needsRebalance: boolean;
    rebalanceItems: Array<{ sku: string; reason: string }>;
  }> {
    const decisions: Record<string, FulfillmentDecision> = {};
    const rebalanceItems: Array<{ sku: string; reason: string }> = [];
    let usePivot = true;

    for (const lineItem of lineItems) {
      const item = await storage.getItem(lineItem.itemId);
      if (!item) continue;
      
      const decision = await this.decideSource(item, lineItem.quantity, userId);
      decisions[lineItem.itemId] = decision;
      
      if (decision.source === FulfillmentSource.HILDALE) {
        usePivot = false;
      }
      
      if (decision.shouldAlertRebalance && decision.rebalanceReason) {
        rebalanceItems.push({
          sku: item.sku,
          reason: decision.rebalanceReason,
        });
      }
    }

    const overallSource = usePivot ? FulfillmentSource.PIVOT_EXTENSIV : FulfillmentSource.HILDALE;

    return {
      overallSource,
      decisions,
      needsRebalance: rebalanceItems.length > 0,
      rebalanceItems,
    };
  }

  /**
   * Log rebalance alert for tracking
   */
  async logRebalanceAlert(
    orderId: string,
    items: Array<{ sku: string; reason: string }>,
    userId: string
  ): Promise<void> {
    try {
      await logService.logWarning(
        `Rebalance alert: ${items.length} item(s) need stock transfer for order ${orderId}`,
        {
          orderId,
          items,
          recommendation: 'Consider transferring stock from Hildale to Pivot',
          userId,
        }
      );
      
      console.log(`[FulfillmentDecision] Rebalance alert logged for order ${orderId}`);
    } catch (error) {
      console.error('[FulfillmentDecision] Failed to log rebalance alert:', error);
    }
  }

  /**
   * Get fulfillment analytics for dashboard/reporting
   */
  async getAnalytics(userId: string): Promise<{
    recentOrders: {
      fromPivot: number;
      fromHildale: number;
      total: number;
    };
    currentStock: {
      pivotUnits: number;
      hildaleUnits: number;
      pivotItems: number;
      hildaleItems: number;
    };
    atRiskItems: Array<{
      id: string;
      sku: string;
      name: string;
      pivotQty: number;
      hildaleQty: number;
      daysStock: number;
      source: string;
    }>;
  }> {
    const thresholds = await this.getThresholds(userId);
    const allItems = await storage.getAllItems();
    const finishedProducts = allItems.filter(item => item.type === 'finished_product');
    
    let pivotUnits = 0;
    let hildaleUnits = 0;
    let pivotItems = 0;
    let hildaleItems = 0;
    const atRiskItems: Array<{
      id: string;
      sku: string;
      name: string;
      pivotQty: number;
      hildaleQty: number;
      daysStock: number;
      source: string;
    }> = [];
    
    for (const item of finishedProducts) {
      const pivot = item.pivotQty ?? 0;
      const hildale = item.hildaleQty ?? 0;
      
      pivotUnits += pivot;
      hildaleUnits += hildale;
      
      if (pivot > 0) pivotItems++;
      if (hildale > 0) hildaleItems++;
      
      const velocity = await this.getDailySalesVelocity(item.id);
      const totalStock = pivot + hildale;
      const daysStock = velocity > 0 ? totalStock / velocity : 999;
      
      if (daysStock < thresholds.hildaleThresholdDays) {
        atRiskItems.push({
          id: item.id,
          sku: item.sku,
          name: item.name,
          pivotQty: pivot,
          hildaleQty: hildale,
          daysStock: Math.round(daysStock),
          source: pivot > hildale ? 'PIVOT' : 'HILDALE',
        });
      }
    }
    
    const allOrders = await storage.getAllSalesOrders();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentOrders = allOrders.filter((order: SalesOrder) => 
      order.orderDate >= thirtyDaysAgo
    );
    
    const fromPivot = recentOrders.filter((o: SalesOrder) => o.fulfillmentSource === 'PIVOT_EXTENSIV').length;
    const fromHildale = recentOrders.filter((o: SalesOrder) => o.fulfillmentSource === 'HILDALE').length;
    
    return {
      recentOrders: {
        fromPivot,
        fromHildale,
        total: recentOrders.length,
      },
      currentStock: {
        pivotUnits,
        hildaleUnits,
        pivotItems,
        hildaleItems,
      },
      atRiskItems: atRiskItems.slice(0, 10),
    };
  }
}

export const fulfillmentDecisionService = new FulfillmentDecisionService();
