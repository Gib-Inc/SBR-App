/**
 * LLM Prompt Builder Service
 * 
 * Structures inventory data from all sources into a comprehensive prompt
 * that enables the LLM to make informed reorder decisions.
 * 
 * Data Sources:
 * - Inventory levels (Hildale buffer, Pivot sellable)
 * - Sales velocity (from sales orders)
 * - Daily sales snapshots (for trend analysis)
 * - Open POs (quantity on order, expected arrival)
 * - Supplier lead times
 * - Ad performance (Google, Meta)
 * - Returns data
 */

import { IStorage } from "../storage";
import type { Item, SalesOrder, PurchaseOrder, DailySalesSnapshot, SalesOrderLine, ReturnRequest, SupplierItem } from "@shared/schema";

export interface SkuContext {
  sku: string;
  productName: string;
  itemId: string;
  productType: "component" | "finished_product";
  
  // Current Inventory
  hildaleQty: number;      // Buffer stock at production warehouse
  pivotQty: number;        // Sellable stock at 3PL
  availableForSale: number; // Derived, can be negative
  
  // Sales Velocity
  dailySalesVelocity: number;       // Units/day over lookback period
  last7DaysSales: number;
  last30DaysSales: number;
  
  // Projections
  daysUntilStockout: number | null;
  
  // Supply Chain
  qtyOnPO: number;                  // Quantity currently on open POs
  expectedPOArrival: Date | null;   // Earliest expected PO arrival
  supplierLeadTimeDays: number;     // Average supplier lead time
  supplierName: string | null;
  
  // Trends (from daily snapshots)
  weekOverWeekChange: number | null;  // % change in sales
  monthOverMonthChange: number | null;
  yearOverYearChange: number | null;
  
  // Ad Performance
  adDemandMultiplier: number;       // Velocity multiplier from ad spend
  googleAdsStatus: string | null;   // BOOST, STEADY, DECLINE
  metaAdsStatus: string | null;
  
  // Returns
  returnRate: number;               // % of units returned
  
  // Reorder Point
  reorderPoint: number;             // Calculated safety stock threshold
}

export interface BatchContext {
  batchId: string;
  reason: "SCHEDULED" | "CRITICAL_TRIGGER" | "MANUAL";
  triggerTime: Date;
  totalSkusToAnalyze: number;
  criticalSkuCount: number;
}

export interface LLMPromptPayload {
  batchContext: BatchContext;
  skuContexts: SkuContext[];
  globalContext: {
    currentDate: string;
    dayOfWeek: string;
    isWeekend: boolean;
    recentOrderVolume: number;        // Total orders last 7 days
    averageOrderValue: number;
    topSellingSkus: string[];         // Top 5 by velocity
  };
}

export interface LLMDecisionResponse {
  sku: string;
  decision: "ORDER" | "MONITOR" | "OK";
  orderTiming: "ORDER_TODAY" | "SAFE_UNTIL_TOMORROW";
  recommendedQty: number;
  confidence: number;           // 0-100
  reasoning: string;            // LLM explanation
  riskLevel: "NEED_ORDER" | "HIGH" | "MEDIUM" | "LOW";
  keyFactors: string[];         // Top factors that influenced decision
}

export class LLMPromptBuilder {
  private storage: IStorage;
  private velocityLookbackDays = 14;
  private safetyStockDays = 7;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Build a comprehensive prompt payload for a batch of SKUs
   */
  async buildBatchPrompt(
    itemIds: string[],
    batchContext: Omit<BatchContext, "totalSkusToAnalyze" | "criticalSkuCount">
  ): Promise<LLMPromptPayload> {
    const items = await Promise.all(
      itemIds.map(id => this.storage.getItem(id))
    );
    const validItems = items.filter((item): item is Item => item !== null);

    // Gather all context data in parallel
    const [
      salesOrders,
      purchaseOrders,
      dailySnapshots,
      returns,
      supplierItems,
    ] = await Promise.all([
      this.getRecentSalesOrders(),
      this.getOpenPurchaseOrders(),
      this.getDailySalesSnapshots(30),
      this.storage.getAllReturnRequests(),
      this.storage.getAllSupplierItems(),
    ]);

    // Build SKU contexts
    const skuContexts: SkuContext[] = [];
    let criticalCount = 0;

    for (const item of validItems) {
      const context = await this.buildSkuContext(
        item,
        salesOrders,
        purchaseOrders,
        dailySnapshots,
        returns,
        supplierItems
      );
      skuContexts.push(context);
      
      if (context.daysUntilStockout !== null && context.daysUntilStockout <= context.supplierLeadTimeDays) {
        criticalCount++;
      }
    }

    // Build global context
    const recentOrders = salesOrders.filter((o: SalesOrder) => {
      const orderDate = new Date(o.orderDate);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return orderDate >= weekAgo;
    });

    const totalRevenue = recentOrders.reduce((sum: number, o: SalesOrder) => sum + (o.totalAmount || 0), 0);
    const avgOrderValue = recentOrders.length > 0 ? totalRevenue / recentOrders.length : 0;

    // Find top selling SKUs by velocity
    const topSkus = [...skuContexts]
      .sort((a, b) => b.dailySalesVelocity - a.dailySalesVelocity)
      .slice(0, 5)
      .map(s => s.sku);

    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });

    return {
      batchContext: {
        ...batchContext,
        totalSkusToAnalyze: skuContexts.length,
        criticalSkuCount: criticalCount,
      },
      skuContexts,
      globalContext: {
        currentDate: now.toISOString().split('T')[0],
        dayOfWeek,
        isWeekend: dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday',
        recentOrderVolume: recentOrders.length,
        averageOrderValue: Math.round(avgOrderValue * 100) / 100,
        topSellingSkus: topSkus,
      },
    };
  }

  /**
   * Build context for a single SKU
   */
  private async buildSkuContext(
    item: Item,
    salesOrders: SalesOrder[],
    purchaseOrders: PurchaseOrder[],
    dailySnapshots: DailySalesSnapshot[],
    returns: ReturnRequest[],
    supplierItems: SupplierItem[]
  ): Promise<SkuContext> {
    // Calculate sales velocity
    const velocityData = await this.calculateSalesVelocity(item.id, salesOrders);
    
    // Get PO info
    const poInfo = await this.getPurchaseOrderInfo(item.id, purchaseOrders);
    
    // Get designated supplier info from supplierItems
    const designatedSupplierItem = supplierItems.find(
      si => si.itemId === item.id && si.isDesignatedSupplier
    );
    const supplier = designatedSupplierItem
      ? await this.storage.getSupplier(designatedSupplierItem.supplierId)
      : null;
    const leadTime = designatedSupplierItem?.leadTimeDays ?? 14;
    
    // Calculate trends from daily snapshots
    const trends = this.calculateTrends(dailySnapshots);
    
    // Calculate return rate
    const itemReturns = returns.filter((r: ReturnRequest) => {
      return r.salesOrderId && salesOrders.some(
        (so: SalesOrder) => so.id === r.salesOrderId
      );
    });
    const totalSold = velocityData.last30DaysSales;
    const returnRate = totalSold > 0 ? (itemReturns.length / totalSold) * 100 : 0;
    
    // Calculate days until stockout
    const availableStock = item.availableForSaleQty ?? item.pivotQty ?? 0;
    const daysUntilStockout = velocityData.dailyVelocity > 0 
      ? Math.floor(availableStock / velocityData.dailyVelocity)
      : null;
    
    // Calculate reorder point
    const reorderPoint = Math.ceil(velocityData.dailyVelocity * (leadTime + this.safetyStockDays));

    return {
      sku: item.sku,
      productName: item.name,
      itemId: item.id,
      productType: item.type as "component" | "finished_product",
      
      hildaleQty: item.hildaleQty ?? 0,
      pivotQty: item.pivotQty ?? 0,
      availableForSale: availableStock,
      
      dailySalesVelocity: velocityData.dailyVelocity,
      last7DaysSales: velocityData.last7DaysSales,
      last30DaysSales: velocityData.last30DaysSales,
      
      daysUntilStockout,
      
      qtyOnPO: poInfo.qtyOnPO,
      expectedPOArrival: poInfo.expectedArrival,
      supplierLeadTimeDays: leadTime,
      supplierName: supplier?.name ?? null,
      
      weekOverWeekChange: trends.weekOverWeek,
      monthOverMonthChange: trends.monthOverMonth,
      yearOverYearChange: trends.yearOverYear,
      
      adDemandMultiplier: 1, // Default multiplier, can be enhanced later
      googleAdsStatus: null,
      metaAdsStatus: null,
      
      returnRate: Math.round(returnRate * 100) / 100,
      
      reorderPoint,
    };
  }

  /**
   * Calculate sales velocity for an item
   */
  private async calculateSalesVelocity(
    itemId: string, 
    salesOrders: SalesOrder[]
  ): Promise<{ dailyVelocity: number; last7DaysSales: number; last30DaysSales: number }> {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 30);
    const lookbackDate = new Date(now);
    lookbackDate.setDate(lookbackDate.getDate() - this.velocityLookbackDays);

    let last7DaysSales = 0;
    let last30DaysSales = 0;
    let lookbackSales = 0;

    for (const order of salesOrders) {
      const orderDate = new Date(order.orderDate);
      
      // Get order lines for this order
      const lines = await this.storage.getSalesOrderLines(order.id);
      const itemLines = lines.filter((l: SalesOrderLine) => l.productId === itemId);
      const itemQty = itemLines.reduce((sum: number, l: SalesOrderLine) => sum + l.qtyOrdered, 0);
      
      if (orderDate >= weekAgo) {
        last7DaysSales += itemQty;
      }
      if (orderDate >= monthAgo) {
        last30DaysSales += itemQty;
      }
      if (orderDate >= lookbackDate) {
        lookbackSales += itemQty;
      }
    }

    const dailyVelocity = lookbackSales / this.velocityLookbackDays;

    return {
      dailyVelocity: Math.round(dailyVelocity * 100) / 100,
      last7DaysSales,
      last30DaysSales,
    };
  }

  /**
   * Get PO information for an item
   */
  private async getPurchaseOrderInfo(
    itemId: string,
    purchaseOrders: PurchaseOrder[]
  ): Promise<{ qtyOnPO: number; expectedArrival: Date | null }> {
    let qtyOnPO = 0;
    let earliestArrival: Date | null = null;

    const openStatuses = ["APPROVED", "SENT", "PARTIAL_RECEIVED"];
    
    for (const po of purchaseOrders) {
      if (!openStatuses.includes(po.status)) continue;
      
      // Load PO lines to check for this item
      const poLines = await this.storage.getPurchaseOrderLinesByPOId(po.id);
      const itemLines = poLines.filter(line => line.itemId === itemId);
      
      for (const line of itemLines) {
        qtyOnPO += (line.quantity - (line.receivedQty || 0));
      }
      
      if (itemLines.length > 0 && po.expectedDate) {
        const expectedDate = new Date(po.expectedDate);
        if (!earliestArrival || expectedDate < earliestArrival) {
          earliestArrival = expectedDate;
        }
      }
    }

    return { qtyOnPO, expectedArrival: earliestArrival };
  }

  /**
   * Calculate sales trends from daily snapshots
   */
  private calculateTrends(snapshots: DailySalesSnapshot[]): {
    weekOverWeek: number | null;
    monthOverMonth: number | null;
    yearOverYear: number | null;
  } {
    if (snapshots.length === 0) {
      return { weekOverWeek: null, monthOverMonth: null, yearOverYear: null };
    }

    // Get the most recent snapshot with trend data
    const latestWithTrends = snapshots
      .filter((s: DailySalesSnapshot) => s.weekOverWeekChange !== null || s.monthOverMonthChange !== null)
      .sort((a: DailySalesSnapshot, b: DailySalesSnapshot) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      )[0];

    if (!latestWithTrends) {
      return { weekOverWeek: null, monthOverMonth: null, yearOverYear: null };
    }

    return {
      weekOverWeek: latestWithTrends.weekOverWeekChange ?? null,
      monthOverMonth: latestWithTrends.monthOverMonthChange ?? null,
      yearOverYear: latestWithTrends.yearOverYearChange ?? null,
    };
  }

  /**
   * Get recent sales orders
   */
  private async getRecentSalesOrders(): Promise<SalesOrder[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const allOrders = await this.storage.getAllSalesOrders();
    return allOrders.filter((o: SalesOrder) => new Date(o.orderDate) >= thirtyDaysAgo);
  }

  /**
   * Get open purchase orders
   */
  private async getOpenPurchaseOrders(): Promise<PurchaseOrder[]> {
    const allPOs = await this.storage.getAllPurchaseOrders();
    const openStatuses = ["APPROVED", "SENT", "PARTIAL_RECEIVED"];
    return allPOs.filter((po: PurchaseOrder) => openStatuses.includes(po.status));
  }

  /**
   * Get daily sales snapshots for trend analysis
   */
  private async getDailySalesSnapshots(days: number): Promise<DailySalesSnapshot[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = new Date().toISOString().split('T')[0];
    
    return await this.storage.getDailySalesSnapshotsInRange(startDateStr, endDateStr);
  }

  /**
   * Format the payload into an LLM prompt string
   */
  formatPromptForLLM(payload: LLMPromptPayload): string {
    const { batchContext, skuContexts, globalContext } = payload;

    let prompt = `# Inventory Reorder Decision Request

## Context
- **Date**: ${globalContext.currentDate} (${globalContext.dayOfWeek})
- **Batch Reason**: ${batchContext.reason}
- **SKUs to Analyze**: ${batchContext.totalSkusToAnalyze}
- **Critical Items**: ${batchContext.criticalSkuCount}
- **Recent Order Volume (7 days)**: ${globalContext.recentOrderVolume} orders
- **Average Order Value**: $${globalContext.averageOrderValue}

## Instructions
For each SKU below, analyze the data and provide a reorder recommendation:
- Decision: ORDER (create PO now), MONITOR (watch closely), or OK (no action needed)
- Order Timing: ORDER_TODAY (critical) or SAFE_UNTIL_TOMORROW
- Recommended Quantity: If ordering, how many units
- Risk Level: NEED_ORDER, HIGH, MEDIUM, or LOW
- Reasoning: 1-2 sentence explanation

Consider these factors:
1. Days until stockout vs supplier lead time
2. Sales velocity trends (week-over-week, month-over-month)
3. Current stock levels (Hildale buffer vs Pivot sellable)
4. Quantity already on open POs
5. Return rates
6. Ad performance impact on demand

## SKU Data
`;

    for (const sku of skuContexts) {
      prompt += `
### ${sku.sku} - ${sku.productName}
- **Type**: ${sku.productType}
- **Inventory**: Pivot (sellable): ${sku.pivotQty}, Hildale (buffer): ${sku.hildaleQty}, Available: ${sku.availableForSale}
- **Sales**: ${sku.dailySalesVelocity}/day velocity, ${sku.last7DaysSales} units (7d), ${sku.last30DaysSales} units (30d)
- **Stockout**: ${sku.daysUntilStockout !== null ? `${sku.daysUntilStockout} days` : 'N/A'} | Lead Time: ${sku.supplierLeadTimeDays} days
- **On PO**: ${sku.qtyOnPO} units${sku.expectedPOArrival ? ` (arriving ${sku.expectedPOArrival.toISOString().split('T')[0]})` : ''}
- **Trends**: WoW ${sku.weekOverWeekChange !== null ? `${sku.weekOverWeekChange > 0 ? '+' : ''}${sku.weekOverWeekChange}%` : 'N/A'}, MoM ${sku.monthOverMonthChange !== null ? `${sku.monthOverMonthChange > 0 ? '+' : ''}${sku.monthOverMonthChange}%` : 'N/A'}
- **Ad Multiplier**: ${sku.adDemandMultiplier}x
- **Return Rate**: ${sku.returnRate}%
- **Reorder Point**: ${sku.reorderPoint} units
`;
    }

    prompt += `
## Response Format
Provide your analysis as a JSON array with one object per SKU:
\`\`\`json
[
  {
    "sku": "SKU-123",
    "decision": "ORDER",
    "orderTiming": "ORDER_TODAY",
    "recommendedQty": 100,
    "confidence": 85,
    "reasoning": "With 5 days until stockout and 14-day lead time, immediate order is critical.",
    "riskLevel": "NEED_ORDER",
    "keyFactors": ["stockout_imminent", "lead_time_exceeds_coverage"]
  }
]
\`\`\`
`;

    return prompt;
  }
}
