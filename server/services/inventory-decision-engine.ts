/**
 * Inventory Decision Engine
 * 
 * Computes per-SKU inventory recommendations based on:
 * - Sales velocity (from Sales Orders)
 * - Current stock (local + Extensiv/Pivot)
 * - Extensiv variance (mismatch between Extensiv snapshot and availableForSale)
 * - Open POs and expected arrivals
 * - Returns rate
 * - Supplier reliability (disputes, late POs)
 * - Lead times
 * 
 * Returns structured recommendations with risk levels and explanations.
 * 
 * V1 AI Decision Layer:
 * - All calculations are deterministic rules (no external LLM for core math)
 * - Logs all recommendations and anomalies to AI Logs for audit trail
 * - Factors extensivVariance into risk calculations
 */

import { IStorage } from "../storage";
import { AuditLogger } from "./audit-logger";
import type { Item, Settings, PurchaseOrder, SalesOrder, ReturnRequest, QuickbooksSalesSnapshot } from "@shared/schema";

// Types for the decision engine
// Note: These match the frontend expectations
// NEED_ORDER = at or below lead-time coverage, or already negative stock
export type RiskLevel = "NEED_ORDER" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
export type RecommendedAction = "ORDER" | "MONITOR" | "OK"; // MONITOR = watch, OK = no action needed

// Anomaly types for logging
export type AnomalyType = 
  | "EXTENSIV_VARIANCE_HIGH"    // Large mismatch between pivotQty/extensivOnHandSnapshot and availableForSale
  | "NEGATIVE_AVAILABLE_STOCK"  // availableForSaleQty is negative (oversold)
  | "MISSING_LEAD_TIME"         // No supplier lead time configured
  | "ZERO_VELOCITY_WITH_STOCK"  // Has stock but no sales history
  | "HIGH_RETURN_RATE";         // Return rate above threshold

export interface Anomaly {
  type: AnomalyType;
  itemId: string;
  sku: string;
  productName: string;
  severity: "WARNING" | "ERROR";
  description: string;
  details: Record<string, unknown>;
}

export interface SkuMetrics {
  dailySalesVelocity: number;
  projectedDaysUntilStockout: number;
  onHand: number;
  availableForSale: number;  // Raw availableForSaleQty (can be negative)
  extensivOnHand: number;    // Last synced Extensiv quantity
  extensivVariance: number;  // Difference between extensivOnHand and availableForSale
  extensivVariancePercent: number; // Variance as percentage of extensivOnHand
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
   * Build a map of SKU -> average daily velocity from QuickBooks sales snapshots
   * Uses recent months (last 6 months) to compute average daily sales
   * This provides historical reference when local sales data is insufficient
   */
  private buildQuickBooksVelocityMap(
    snapshots: QuickbooksSalesSnapshot[]
  ): Map<string, number> {
    const velocityMap = new Map<string, number>();
    
    if (!snapshots || snapshots.length === 0) {
      return velocityMap;
    }

    // Group by SKU
    const skuSnapshots = new Map<string, QuickbooksSalesSnapshot[]>();
    for (const snapshot of snapshots) {
      const existing = skuSnapshots.get(snapshot.sku) || [];
      existing.push(snapshot);
      skuSnapshots.set(snapshot.sku, existing);
    }

    // Calculate average daily velocity for each SKU (using last 6 months of data)
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);

    for (const [sku, skuData] of Array.from(skuSnapshots.entries())) {
      // Filter to recent snapshots
      const recentSnapshots = skuData.filter((s: QuickbooksSalesSnapshot) => {
        const snapshotDate = new Date(s.year, s.month - 1, 1);
        return snapshotDate >= sixMonthsAgo;
      });

      if (recentSnapshots.length === 0) {
        continue;
      }

      // Calculate total quantity and days covered
      let totalQty = 0;
      for (const snapshot of recentSnapshots) {
        totalQty += Number(snapshot.totalQty) || 0;
      }

      // Estimate days covered (30 days per month * number of months)
      const daysCovered = recentSnapshots.length * 30;
      const dailyVelocity = daysCovered > 0 ? totalQty / daysCovered : 0;

      velocityMap.set(sku, dailyVelocity);
    }

    return velocityMap;
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
   * 
   * V1 Risk Classification:
   * - NEED_ORDER: Already at/below lead time, negative stock, or active backorders (critical - order immediately)
   * - HIGH: Stockout within lead time + buffer, or high extensiv variance
   * - MEDIUM: Close to reorder point or poor supplier reliability  
   * - LOW: Healthy stock levels
   * - UNKNOWN: Not enough sales history to determine
   */
  private determineRiskLevel(
    daysUntilStockout: number,
    effectiveLeadTime: number,
    backorderCount: number,
    supplierScore: number,
    rules: AIRulesConfig,
    hasEnoughHistory: boolean,
    availableForSale: number = 0,
    extensivVariancePercent: number = 0
  ): RiskLevel {
    // V1 CRITICAL: NEED_ORDER fires FIRST before any other checks
    // These are absolute conditions that require immediate action regardless of sales history:
    // - Negative available stock (oversold - can't fulfill orders)
    // - At or below lead time coverage (won't get stock before stockout)
    // - Active backorders exist
    // - Severe Extensiv variance (>30% indicates major reconciliation issue)
    if (
      availableForSale < 0 || 
      daysUntilStockout <= effectiveLeadTime ||
      backorderCount > 0 ||
      Math.abs(extensivVariancePercent) > 30
    ) {
      return "NEED_ORDER";
    }
    
    // For non-critical states, we need sales history to make accurate projections
    if (!hasEnoughHistory) return "UNKNOWN";
    
    // HIGH: stockout imminent (within lead time + threshold) or large Extensiv variance
    // Large variance (>20%) indicates potential reconciliation issues that need attention
    if (daysUntilStockout <= effectiveLeadTime + rules.riskThresholdHighDays || Math.abs(extensivVariancePercent) > 20) {
      return "HIGH";
    }
    
    // MEDIUM: close to reorder point or poor supplier reliability
    if (daysUntilStockout <= effectiveLeadTime + rules.riskThresholdMediumDays || supplierScore < 50) {
      return "MEDIUM";
    }
    
    return "LOW";
  }

  /**
   * Generate human-readable explanation for the recommendation
   * 
   * V1: Explanations are concise, actionable, and include extensiv variance when relevant
   */
  private generateExplanation(
    action: RecommendedAction,
    qty: number,
    metrics: SkuMetrics,
    riskLevel: RiskLevel,
    rules: AIRulesConfig
  ): string {
    const parts: string[] = [];

    // Lead with the action and urgency
    if (riskLevel === "NEED_ORDER") {
      parts.push(`URGENT: Order ${qty} units now`);
    } else if (action === "ORDER") {
      parts.push(`Order ${qty} units`);
    } else if (action === "MONITOR") {
      parts.push("Monitor closely");
    } else {
      parts.push("Stock healthy");
    }

    // Add key metrics
    if (metrics.availableForSale < 0) {
      parts.push(`oversold by ${Math.abs(metrics.availableForSale)}`);
    } else {
      parts.push(`${metrics.onHand} on-hand`);
    }
    
    if (metrics.dailySalesVelocity > 0) {
      parts.push(`selling ${metrics.dailySalesVelocity.toFixed(1)}/day`);
    }

    // Days until stockout (critical metric)
    if (metrics.projectedDaysUntilStockout <= 0) {
      parts.push("already out of stock");
    } else if (metrics.projectedDaysUntilStockout < 999) {
      parts.push(`${metrics.projectedDaysUntilStockout.toFixed(0)}d until stockout`);
    }

    // Lead time context
    parts.push(`${metrics.effectiveLeadTime}d lead time`);

    // Add critical issues
    if (metrics.backorderCount > 0) {
      parts.push(`${metrics.backorderCount} backordered`);
    }

    // Extensiv variance (only show if significant)
    if (Math.abs(metrics.extensivVariancePercent) > 10) {
      const direction = metrics.extensivVariance > 0 ? "more" : "less";
      parts.push(`Extensiv shows ${Math.abs(metrics.extensivVariance)} ${direction}`);
    }

    if (metrics.returnRate > 0.1) {
      parts.push(`${(metrics.returnRate * 100).toFixed(0)}% return rate`);
    }

    if (metrics.supplierScore < 80) {
      parts.push(`supplier score ${metrics.supplierScore.toFixed(0)}/100`);
    }

    return parts.join("; ") + ".";
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

    // Fetch all required data (including QuickBooks historical sales if available)
    const [
      items,
      settings,
      purchaseOrders,
      salesOrders,
      returnRequests,
      qbSalesSnapshots,
    ] = await Promise.all([
      this.storage.getAllItems(),
      this.storage.getSettings(userId),
      this.storage.getAllPurchaseOrders(),
      this.storage.getAllSalesOrders(),
      this.storage.getAllReturnRequests(),
      this.storage.getAllQuickbooksSalesSnapshots(),
    ]);

    // Build QuickBooks sales velocity map (avg monthly sales / 30 = daily velocity)
    const qbVelocityMap = this.buildQuickBooksVelocityMap(qbSalesSnapshots);

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
      // Compute on-hand stock (finished products use availableForSaleQty for 3PL risk, components use currentStock)
      // availableForSaleQty = live projected 3PL stock that accounts for new orders/returns in real-time
      // pivotQty = authoritative mirror from Extensiv (not used for risk calculations)
      const availableForSale = item.type === "finished_product" 
        ? (item.availableForSaleQty ?? 0)
        : item.currentStock;
      
      const onHand = item.type === "finished_product" 
        ? availableForSale + (item.hildaleQty ?? 0)
        : item.currentStock;
      
      // V1: Extensiv variance tracking for finished products
      // extensivOnHandSnapshot = last synced quantity from Extensiv
      // Variance = Extensiv snapshot - our availableForSale (positive = we think we have less than Extensiv shows)
      const extensivOnHand = item.type === "finished_product" 
        ? (item.extensivOnHandSnapshot ?? 0)
        : 0;
      const extensivVariance = item.type === "finished_product"
        ? extensivOnHand - availableForSale
        : 0;
      const extensivVariancePercent = extensivOnHand > 0 
        ? (extensivVariance / extensivOnHand) * 100 
        : 0;

      // Compute sales velocity from local sales orders
      const { velocity: localVelocity, primaryChannel } = this.computeSalesVelocity(
        item.sku,
        salesOrders,
        salesOrderLines,
        rules.velocityLookbackDays
      );

      // Use QuickBooks historical velocity as fallback when local history is insufficient
      // This helps new products or products with sparse local sales data
      const qbVelocity = qbVelocityMap.get(item.sku) || 0;
      let velocity = localVelocity;
      let usedQbFallback = false;
      
      // If local velocity is 0 but QuickBooks has historical data, use QB as estimate
      // Apply a 0.8 multiplier to be conservative (historical data may be outdated)
      if (localVelocity === 0 && qbVelocity > 0) {
        velocity = qbVelocity * 0.8;
        usedQbFallback = true;
      }

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
      // Consider QuickBooks fallback data as valid history
      const hasEnoughHistory = velocity > 0 || usedQbFallback || salesOrders.length > 5;

      // Determine risk level (now includes extensiv variance as risk factor)
      const riskLevel = this.determineRiskLevel(
        daysUntilStockout,
        supplierMetrics.effectiveLeadTime,
        backorderCount,
        supplierMetrics.score,
        rules,
        hasEnoughHistory,
        availableForSale,
        extensivVariancePercent
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
      // NEED_ORDER always triggers ORDER action
      let action: RecommendedAction = "OK";
      if (!hasEnoughHistory) {
        action = "MONITOR";
      } else if (riskLevel === "NEED_ORDER") {
        action = "ORDER"; // Critical - must order
      } else if (recommendedQty > 0 && (riskLevel === "HIGH" || riskLevel === "MEDIUM")) {
        action = "ORDER";
      } else if (riskLevel === "MEDIUM" || returnRate > 0.15 || Math.abs(extensivVariancePercent) > 10) {
        action = "MONITOR";
      }

      // Build metrics snapshot
      const metrics: SkuMetrics = {
        dailySalesVelocity: velocity,
        projectedDaysUntilStockout: daysUntilStockout,
        onHand,
        availableForSale,
        extensivOnHand,
        extensivVariance,
        extensivVariancePercent,
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

    // Sort by risk level (NEED_ORDER first, then HIGH, MEDIUM, UNKNOWN, LOW)
    const riskOrder: Record<RiskLevel, number> = { NEED_ORDER: 0, HIGH: 1, MEDIUM: 2, UNKNOWN: 3, LOW: 4 };
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
   * V1: Now includes NEED_ORDER as highest priority
   */
  async getTopAtRiskItems(userId: string, limit = 5): Promise<SkuRecommendation[]> {
    const result = await this.computeRecommendations(userId);
    return result.recommendations
      .filter(r => r.riskLevel === "NEED_ORDER" || r.riskLevel === "HIGH" || r.riskLevel === "MEDIUM")
      .slice(0, limit);
  }

  /**
   * Clear the cache (call after data changes)
   */
  clearCache(): void {
    this.cachedResult = null;
    this.cacheTimestamp = null;
  }

  /**
   * V1 AI Decision Layer: Log recommendations and anomalies to AI Logs
   * Called when recommendations are refreshed via the Insights "Refresh" button
   */
  async logRecommendationsToAudit(
    recommendations: SkuRecommendation[],
    rulesApplied: DecisionEngineResult["rulesApplied"]
  ): Promise<{ logged: number; anomalies: Anomaly[] }> {
    const anomalies: Anomaly[] = [];
    let logged = 0;

    // Log batch start
    await AuditLogger.logEvent({
      source: "SYSTEM",
      eventType: "AI_DECISION",
      entityType: "INTEGRATION",
      entityLabel: "AI Decision Engine",
      status: "INFO",
      description: `AI Decision Engine computed ${recommendations.length} SKU recommendations`,
      details: {
        totalSkus: recommendations.length,
        needOrder: recommendations.filter(r => r.riskLevel === "NEED_ORDER").length,
        highRisk: recommendations.filter(r => r.riskLevel === "HIGH").length,
        mediumRisk: recommendations.filter(r => r.riskLevel === "MEDIUM").length,
        lowRisk: recommendations.filter(r => r.riskLevel === "LOW").length,
        unknown: recommendations.filter(r => r.riskLevel === "UNKNOWN").length,
        rulesApplied,
      },
    });
    logged++;

    // Log each recommendation that requires action
    for (const rec of recommendations) {
      // Only log actionable recommendations (ORDER or MONITOR with issues)
      if (rec.recommendedAction === "ORDER" || rec.riskLevel === "NEED_ORDER" || rec.riskLevel === "HIGH") {
        await AuditLogger.logEvent({
          source: "SYSTEM",
          eventType: "AI_RISK_CALCULATED",
          entityType: "ITEM",
          entityId: rec.itemId,
          entityLabel: rec.sku,
          status: rec.riskLevel === "NEED_ORDER" ? "WARNING" : "INFO",
          description: rec.explanation,
          details: {
            sku: rec.sku,
            productName: rec.productName,
            riskLevel: rec.riskLevel,
            recommendedAction: rec.recommendedAction,
            recommendedQty: rec.recommendedQty,
            onHand: rec.metrics.onHand,
            availableForSale: rec.metrics.availableForSale,
            dailyVelocity: rec.metrics.dailySalesVelocity,
            daysUntilStockout: rec.metrics.projectedDaysUntilStockout,
            extensivVariance: rec.metrics.extensivVariance,
            extensivVariancePercent: rec.metrics.extensivVariancePercent,
            leadTime: rec.metrics.effectiveLeadTime,
            backorderCount: rec.metrics.backorderCount,
            primaryChannel: rec.primaryChannel,
          },
        });
        logged++;
      }

      // Detect and log anomalies
      
      // Anomaly: Large Extensiv variance (>20%)
      if (Math.abs(rec.metrics.extensivVariancePercent) > 20) {
        const anomaly: Anomaly = {
          type: "EXTENSIV_VARIANCE_HIGH",
          itemId: rec.itemId,
          sku: rec.sku,
          productName: rec.productName,
          severity: Math.abs(rec.metrics.extensivVariancePercent) > 50 ? "ERROR" : "WARNING",
          description: `Large discrepancy: Extensiv shows ${rec.metrics.extensivOnHand} vs local ${rec.metrics.availableForSale} (${rec.metrics.extensivVariance} difference)`,
          details: {
            extensivOnHand: rec.metrics.extensivOnHand,
            availableForSale: rec.metrics.availableForSale,
            variance: rec.metrics.extensivVariance,
            variancePercent: rec.metrics.extensivVariancePercent,
          },
        };
        anomalies.push(anomaly);
        
        await AuditLogger.logEvent({
          source: "SYSTEM",
          eventType: "INTEGRATION_ERROR",
          entityType: "ITEM",
          entityId: rec.itemId,
          entityLabel: rec.sku,
          status: anomaly.severity,
          description: anomaly.description,
          details: anomaly.details,
        });
        logged++;
      }

      // Anomaly: Negative available stock (oversold)
      if (rec.metrics.availableForSale < 0) {
        const anomaly: Anomaly = {
          type: "NEGATIVE_AVAILABLE_STOCK",
          itemId: rec.itemId,
          sku: rec.sku,
          productName: rec.productName,
          severity: "ERROR",
          description: `Oversold: ${rec.sku} has negative available stock (${rec.metrics.availableForSale})`,
          details: {
            availableForSale: rec.metrics.availableForSale,
            backorderCount: rec.metrics.backorderCount,
          },
        };
        anomalies.push(anomaly);

        await AuditLogger.logEvent({
          source: "SYSTEM",
          eventType: "AI_DECISION",
          entityType: "ITEM",
          entityId: rec.itemId,
          entityLabel: rec.sku,
          status: "ERROR",
          description: anomaly.description,
          details: anomaly.details,
        });
        logged++;
      }

      // Anomaly: Zero velocity but has stock (potential slow mover)
      if (rec.metrics.dailySalesVelocity === 0 && rec.metrics.onHand > 10) {
        const anomaly: Anomaly = {
          type: "ZERO_VELOCITY_WITH_STOCK",
          itemId: rec.itemId,
          sku: rec.sku,
          productName: rec.productName,
          severity: "WARNING",
          description: `${rec.sku} has ${rec.metrics.onHand} units but no recent sales velocity`,
          details: {
            onHand: rec.metrics.onHand,
            velocity: rec.metrics.dailySalesVelocity,
          },
        };
        anomalies.push(anomaly);
      }

      // Anomaly: High return rate (>15%)
      if (rec.metrics.returnRate > 0.15) {
        const anomaly: Anomaly = {
          type: "HIGH_RETURN_RATE",
          itemId: rec.itemId,
          sku: rec.sku,
          productName: rec.productName,
          severity: rec.metrics.returnRate > 0.25 ? "ERROR" : "WARNING",
          description: `${rec.sku} has ${(rec.metrics.returnRate * 100).toFixed(1)}% return rate`,
          details: {
            returnRate: rec.metrics.returnRate,
          },
        };
        anomalies.push(anomaly);
      }
    }

    return { logged, anomalies };
  }
}
