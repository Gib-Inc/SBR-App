/**
 * Inventory Decision Engine
 * 
 * Computes per-SKU inventory recommendations based on:
 * - Sales velocity (from Sales Orders)
 * - Current stock (local + Extensiv/Pivot)
 * - Open POs and expected arrivals
 * - Returns rate
 * - Supplier reliability (disputes, late POs)
 * - Lead times
 * 
 * Returns structured recommendations with risk levels and explanations.
 */

import { IStorage } from "../storage";
import type { Item, Settings, PurchaseOrder, SalesOrder, ReturnRequest } from "@shared/schema";

// Types for the decision engine
// Note: These match the frontend expectations
export type RiskLevel = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
export type RecommendedAction = "ORDER" | "MONITOR" | "OK"; // MONITOR = watch, OK = no action needed

export interface SkuMetrics {
  dailySalesVelocity: number;
  projectedDaysUntilStockout: number;
  onHand: number;
  inboundPO: number;
  returnRate: number;
  supplierScore: number; // 0-100, higher = more reliable
  effectiveLeadTime: number;
  supplierLeadTimeDays: number; // Alias for effectiveLeadTime (frontend compatibility)
  backorderCount: number;
  reorderPoint: number;
}

export interface SkuRecommendation {
  itemId: string;
  sku: string;
  productName: string;
  productType: "component" | "finished_product";
  recommendedAction: RecommendedAction;
  recommendedQty: number;
  riskLevel: RiskLevel;
  metrics: SkuMetrics;
  explanation: string;
  primaryChannel?: string; // 'SHOPIFY' | 'AMAZON' | 'DIRECT' | null
}

export interface DecisionEngineResult {
  recommendations: SkuRecommendation[];
  computedAt: Date;
  rulesApplied: {
    velocityLookbackDays: number;
    safetyStockDays: number;
    riskThresholdHighDays: number;
    riskThresholdMediumDays: number;
  };
}

export interface AIRulesConfig {
  velocityLookbackDays: number;
  safetyStockDays: number;
  riskThresholdHighDays: number;
  riskThresholdMediumDays: number;
  returnRateImpact: number;
  adDemandImpact: number;
  supplierDisputePenaltyDays: number;
  defaultLeadTimeDays: number;
  minOrderQuantity: number;
}

const DEFAULT_RULES: AIRulesConfig = {
  velocityLookbackDays: 14,
  safetyStockDays: 7,
  riskThresholdHighDays: 0,
  riskThresholdMediumDays: 7,
  returnRateImpact: 0.5,
  adDemandImpact: 0.2,
  supplierDisputePenaltyDays: 3,
  defaultLeadTimeDays: 7,
  minOrderQuantity: 1,
};

export class InventoryDecisionEngine {
  private storage: IStorage;
  private cachedResult: DecisionEngineResult | null = null;
  private cacheTimestamp: Date | null = null;
  private cacheTTLMs = 5 * 60 * 1000; // 5 minutes

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Extract AI rules from settings, falling back to defaults
   */
  private extractRulesFromSettings(settings: Settings | null): AIRulesConfig {
    if (!settings) return DEFAULT_RULES;
    
    return {
      velocityLookbackDays: settings.aiVelocityLookbackDays ?? DEFAULT_RULES.velocityLookbackDays,
      safetyStockDays: settings.aiSafetyStockDays ?? DEFAULT_RULES.safetyStockDays,
      riskThresholdHighDays: settings.aiRiskThresholdHighDays ?? DEFAULT_RULES.riskThresholdHighDays,
      riskThresholdMediumDays: settings.aiRiskThresholdMediumDays ?? DEFAULT_RULES.riskThresholdMediumDays,
      returnRateImpact: settings.aiReturnRateImpact ?? DEFAULT_RULES.returnRateImpact,
      adDemandImpact: settings.aiAdDemandImpact ?? DEFAULT_RULES.adDemandImpact,
      supplierDisputePenaltyDays: settings.aiSupplierDisputePenaltyDays ?? DEFAULT_RULES.supplierDisputePenaltyDays,
      defaultLeadTimeDays: settings.aiDefaultLeadTimeDays ?? DEFAULT_RULES.defaultLeadTimeDays,
      minOrderQuantity: settings.aiMinOrderQuantity ?? DEFAULT_RULES.minOrderQuantity,
    };
  }

  /**
   * Compute sales velocity for an item over the lookback period
   */
  private computeSalesVelocity(
    itemSku: string,
    salesOrders: SalesOrder[],
    salesOrderLines: Map<string, { sku: string; qtyFulfilled: number }[]>,
    lookbackDays: number
  ): { velocity: number; primaryChannel: string | undefined } {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    let totalFulfilled = 0;
    const channelCounts: Record<string, number> = {};

    for (const order of salesOrders) {
      // Only count fulfilled orders within lookback period
      // Use updatedAt as proxy for fulfillment date since there's no fulfilledAt field
      const orderDate = new Date(order.updatedAt);
      if (order.status !== 'FULFILLED' && order.status !== 'COMPLETED') continue;
      if (orderDate < cutoffDate) continue;
      
      const lines = salesOrderLines.get(order.id) || [];
      for (const line of lines) {
        if (line.sku === itemSku) {
          totalFulfilled += line.qtyFulfilled;
          channelCounts[order.channel] = (channelCounts[order.channel] || 0) + line.qtyFulfilled;
        }
      }
    }

    // Find primary channel
    let primaryChannel: string | undefined = undefined;
    let maxChannelQty = 0;
    for (const [channel, qty] of Object.entries(channelCounts)) {
      if (qty > maxChannelQty) {
        maxChannelQty = qty;
        primaryChannel = channel;
      }
    }

    const velocity = lookbackDays > 0 ? totalFulfilled / lookbackDays : 0;
    return { velocity, primaryChannel };
  }

  /**
   * Compute return rate for an item
   */
  private computeReturnRate(
    itemSku: string,
    returnRequests: ReturnRequest[],
    returnItems: Map<string, { sku: string; qtyRequested: number }[]>,
    salesOrders: SalesOrder[],
    salesOrderLines: Map<string, { sku: string; qtyFulfilled: number }[]>
  ): number {
    let totalReturned = 0;
    let totalShipped = 0;

    // Count returns
    for (const returnReq of returnRequests) {
      const items = returnItems.get(returnReq.id) || [];
      for (const item of items) {
        if (item.sku === itemSku) {
          totalReturned += item.qtyRequested;
        }
      }
    }

    // Count shipped
    for (const order of salesOrders) {
      if (order.status !== 'FULFILLED' && order.status !== 'COMPLETED') continue;
      const lines = salesOrderLines.get(order.id) || [];
      for (const line of lines) {
        if (line.sku === itemSku) {
          totalShipped += line.qtyFulfilled;
        }
      }
    }

    return totalShipped > 0 ? totalReturned / totalShipped : 0;
  }

  /**
   * Compute supplier reliability score and effective lead time
   */
  private computeSupplierMetrics(
    itemId: string,
    purchaseOrders: PurchaseOrder[],
    poLines: Map<string, { itemId: string; qtyOrdered: number; qtyReceived: number }[]>,
    rules: AIRulesConfig
  ): { score: number; effectiveLeadTime: number; inboundQty: number } {
    let totalPOs = 0;
    let disputePOs = 0;
    let latePOs = 0;
    let inboundQty = 0;

    for (const po of purchaseOrders) {
      const lines = poLines.get(po.id) || [];
      const hasItem = lines.some(l => l.itemId === itemId);
      if (!hasItem) continue;

      totalPOs++;
      
      // Track disputes
      if (po.hasIssue || po.issueStatus === 'OPEN' || po.issueStatus === 'IN_PROGRESS') {
        disputePOs++;
      }
      
      // Track late deliveries (expected before now but not received)
      if (po.expectedDate && !po.receivedAt && new Date(po.expectedDate) < new Date()) {
        latePOs++;
      }

      // Count inbound from open POs
      if (po.status === 'SENT' || po.status === 'PARTIAL_RECEIVED' || po.status === 'APPROVED') {
        for (const line of lines) {
          if (line.itemId === itemId) {
            inboundQty += (line.qtyOrdered - line.qtyReceived);
          }
        }
      }
    }

    // Supplier score: 100 = perfect, penalize for disputes and late POs
    let score = 100;
    if (totalPOs > 0) {
      const disputeRate = disputePOs / totalPOs;
      const lateRate = latePOs / totalPOs;
      score = Math.max(0, 100 - (disputeRate * 50) - (lateRate * 30));
    }

    // Effective lead time: add penalty days based on disputes
    const effectiveLeadTime = rules.defaultLeadTimeDays + 
      (disputePOs * rules.supplierDisputePenaltyDays);

    return { score, effectiveLeadTime, inboundQty };
  }

  /**
   * Count backorders for an item
   */
  private countBackorders(
    itemSku: string,
    salesOrders: SalesOrder[],
    salesOrderLines: Map<string, { sku: string; qtyOrdered: number; qtyFulfilled: number }[]>
  ): number {
    let backorderCount = 0;

    for (const order of salesOrders) {
      if (order.status === 'CANCELLED' || order.status === 'FULFILLED' || order.status === 'COMPLETED') continue;
      
      const lines = salesOrderLines.get(order.id) || [];
      for (const line of lines) {
        if (line.sku === itemSku && line.qtyOrdered > line.qtyFulfilled) {
          backorderCount += (line.qtyOrdered - line.qtyFulfilled);
        }
      }
    }

    return backorderCount;
  }

  /**
   * Determine risk level based on metrics and rules
   */
  private determineRiskLevel(
    daysUntilStockout: number,
    effectiveLeadTime: number,
    backorderCount: number,
    supplierScore: number,
    rules: AIRulesConfig,
    hasEnoughHistory: boolean
  ): RiskLevel {
    if (!hasEnoughHistory) return "UNKNOWN";
    
    // HIGH: stockout imminent or backorders exist
    if (daysUntilStockout <= effectiveLeadTime + rules.riskThresholdHighDays || backorderCount > 0) {
      return "HIGH";
    }
    
    // MEDIUM: close to reorder point or poor supplier reliability
    if (daysUntilStockout <= effectiveLeadTime + rules.riskThresholdMediumDays || supplierScore < 50) {
      return "MEDIUM";
    }
    
    return "LOW";
  }

  /**
   * Generate human-readable explanation
   */
  private generateExplanation(
    action: RecommendedAction,
    qty: number,
    metrics: SkuMetrics,
    riskLevel: RiskLevel,
    rules: AIRulesConfig
  ): string {
    const parts: string[] = [];

    if (action === "ORDER") {
      parts.push(`Order ${qty} units:`);
    } else if (action === "MONITOR") {
      parts.push("Monitor closely:");
    } else {
      parts.push("No action needed:");
    }

    parts.push(`on-hand ${metrics.onHand}`);
    parts.push(`inbound ${metrics.inboundPO}`);
    
    if (metrics.dailySalesVelocity > 0) {
      parts.push(`selling ${metrics.dailySalesVelocity.toFixed(1)}/day`);
    }

    parts.push(`${metrics.projectedDaysUntilStockout.toFixed(0)} days until stockout`);
    parts.push(`${metrics.effectiveLeadTime}-day lead time`);

    if (metrics.backorderCount > 0) {
      parts.push(`${metrics.backorderCount} backordered`);
    }

    if (metrics.returnRate > 0.1) {
      parts.push(`${(metrics.returnRate * 100).toFixed(0)}% return rate`);
    }

    if (metrics.supplierScore < 80) {
      parts.push(`supplier score ${metrics.supplierScore.toFixed(0)}/100`);
    }

    return parts.join(", ") + ".";
  }

  /**
   * Main computation method - evaluates all items and returns recommendations
   */
  async computeRecommendations(userId: string, forceRefresh = false): Promise<DecisionEngineResult> {
    // Check cache
    if (!forceRefresh && this.cachedResult && this.cacheTimestamp) {
      const cacheAge = Date.now() - this.cacheTimestamp.getTime();
      if (cacheAge < this.cacheTTLMs) {
        return this.cachedResult;
      }
    }

    // Fetch all required data
    const [
      items,
      settings,
      purchaseOrders,
      salesOrders,
      returnRequests,
    ] = await Promise.all([
      this.storage.getAllItems(),
      this.storage.getSettings(userId),
      this.storage.getAllPurchaseOrders(),
      this.storage.getAllSalesOrders(),
      this.storage.getAllReturnRequests(),
    ]);

    // Build line item maps
    const poLines = new Map<string, { itemId: string; qtyOrdered: number; qtyReceived: number }[]>();
    const salesOrderLines = new Map<string, { sku: string; qtyOrdered: number; qtyFulfilled: number }[]>();
    const returnItemsMap = new Map<string, { sku: string; qtyRequested: number }[]>();

    // Fetch all PO lines
    for (const po of purchaseOrders) {
      const lines = await this.storage.getPurchaseOrderLinesByPOId(po.id);
      poLines.set(po.id, lines.map((l: any) => ({
        itemId: l.itemId,
        qtyOrdered: l.qtyOrdered,
        qtyReceived: l.qtyReceived,
      })));
    }

    // Fetch all sales order lines
    for (const order of salesOrders) {
      const lines = await this.storage.getSalesOrderLines(order.id);
      salesOrderLines.set(order.id, lines.map(l => ({
        sku: l.sku,
        qtyOrdered: l.qtyOrdered,
        qtyFulfilled: l.qtyFulfilled,
      })));
    }

    // Fetch all return items
    for (const returnReq of returnRequests) {
      const items = await this.storage.getReturnItemsByRequestId(returnReq.id);
      returnItemsMap.set(returnReq.id, items.map(i => ({
        sku: i.sku,
        qtyRequested: i.qtyRequested,
      })));
    }

    // Extract rules (handle undefined as null for the helper)
    const rules = this.extractRulesFromSettings(settings ?? null);

    // Process each item
    const recommendations: SkuRecommendation[] = [];

    for (const item of items) {
      // Compute on-hand stock (finished products use pivotProjectionQty for 3PL risk, components use currentStock)
      // pivotProjectionQty = live projected 3PL stock that accounts for new orders/returns in real-time
      // pivotQty = authoritative mirror from Extensiv (not used for risk calculations)
      const onHand = item.type === "finished_product" 
        ? (item.pivotProjectionQty ?? 0) + (item.hildaleQty ?? 0)
        : item.currentStock;

      // Compute sales velocity
      const { velocity, primaryChannel } = this.computeSalesVelocity(
        item.sku,
        salesOrders,
        salesOrderLines,
        rules.velocityLookbackDays
      );

      // Compute supplier metrics (for inbound POs and reliability)
      const supplierMetrics = this.computeSupplierMetrics(
        item.id,
        purchaseOrders,
        poLines,
        rules
      );

      // Compute return rate
      const returnRate = this.computeReturnRate(
        item.sku,
        returnRequests,
        returnItemsMap,
        salesOrders,
        salesOrderLines
      );

      // Count backorders
      const backorderCount = this.countBackorders(item.sku, salesOrders, salesOrderLines);

      // Compute days until stockout
      const availableStock = onHand + supplierMetrics.inboundQty;
      const daysUntilStockout = velocity > 0 
        ? availableStock / velocity 
        : (availableStock > 0 ? 999 : 0);

      // Check if we have enough history
      const hasEnoughHistory = velocity > 0 || salesOrders.length > 5;

      // Determine risk level
      const riskLevel = this.determineRiskLevel(
        daysUntilStockout,
        supplierMetrics.effectiveLeadTime,
        backorderCount,
        supplierMetrics.score,
        rules,
        hasEnoughHistory
      );

      // Compute recommended reorder point
      const safetyStock = velocity * rules.safetyStockDays;
      const reorderPoint = (velocity * supplierMetrics.effectiveLeadTime) + safetyStock;

      // Compute recommended order quantity
      let recommendedQty = Math.max(reorderPoint - availableStock, 0);
      
      // Apply return rate impact (reduce qty for high return items)
      if (returnRate > 0.1 && rules.returnRateImpact > 0) {
        const returnPenalty = 1 - (returnRate * rules.returnRateImpact);
        recommendedQty = Math.round(recommendedQty * Math.max(0.5, returnPenalty));
      }

      // Round to MOQ
      const moq = rules.minOrderQuantity;
      recommendedQty = Math.ceil(recommendedQty / moq) * moq;

      // Determine action (using frontend-compatible enum values)
      let action: RecommendedAction = "OK";
      if (!hasEnoughHistory) {
        action = "MONITOR";
      } else if (recommendedQty > 0 && riskLevel !== "LOW") {
        action = "ORDER";
      } else if (riskLevel === "MEDIUM" || returnRate > 0.15) {
        action = "MONITOR";
      }

      // Build metrics snapshot
      const metrics: SkuMetrics = {
        dailySalesVelocity: velocity,
        projectedDaysUntilStockout: daysUntilStockout,
        onHand,
        inboundPO: supplierMetrics.inboundQty,
        returnRate,
        supplierScore: supplierMetrics.score,
        effectiveLeadTime: supplierMetrics.effectiveLeadTime,
        supplierLeadTimeDays: supplierMetrics.effectiveLeadTime, // Alias for frontend
        backorderCount,
        reorderPoint: Math.round(reorderPoint),
      };

      // Generate explanation
      const explanation = !hasEnoughHistory
        ? "Not enough history; using default safety stock. Monitor sales data."
        : this.generateExplanation(action, recommendedQty, metrics, riskLevel, rules);

      recommendations.push({
        itemId: item.id,
        sku: item.sku,
        productName: item.name,
        productType: item.type as "component" | "finished_product",
        recommendedAction: action,
        recommendedQty,
        riskLevel,
        metrics,
        explanation,
        primaryChannel,
      });
    }

    // Sort by risk level (HIGH first) then by days until stockout
    const riskOrder: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, UNKNOWN: 2, LOW: 3 };
    recommendations.sort((a, b) => {
      const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      if (riskDiff !== 0) return riskDiff;
      return a.metrics.projectedDaysUntilStockout - b.metrics.projectedDaysUntilStockout;
    });

    const result: DecisionEngineResult = {
      recommendations,
      computedAt: new Date(),
      rulesApplied: {
        velocityLookbackDays: rules.velocityLookbackDays,
        safetyStockDays: rules.safetyStockDays,
        riskThresholdHighDays: rules.riskThresholdHighDays,
        riskThresholdMediumDays: rules.riskThresholdMediumDays,
      },
    };

    // Cache the result
    this.cachedResult = result;
    this.cacheTimestamp = new Date();

    return result;
  }

  /**
   * Get top N at-risk items for dashboard display
   */
  async getTopAtRiskItems(userId: string, limit = 5): Promise<SkuRecommendation[]> {
    const result = await this.computeRecommendations(userId);
    return result.recommendations
      .filter(r => r.riskLevel === "HIGH" || r.riskLevel === "MEDIUM")
      .slice(0, limit);
  }

  /**
   * Clear the cache (call after data changes)
   */
  clearCache(): void {
    this.cachedResult = null;
    this.cacheTimestamp = null;
  }
}
