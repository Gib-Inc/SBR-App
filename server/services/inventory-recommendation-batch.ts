/**
 * Inventory Recommendation Batch Service
 * 
 * Centralized service for running AI-powered inventory recommendations in batches.
 * This replaces per-event LLM calls with scheduled and critical-triggered batch runs.
 * 
 * Features:
 * - Scheduled batch runs at 10:00 and 15:00 Mountain time
 * - Critical trigger runs when SKU crosses into critical state (with debounce)
 * - Single batched LLM call for all SKUs in a run
 * - Order timing decision (ORDER_TODAY vs SAFE_UNTIL_TOMORROW)
 */

import { storage } from "../storage";
import { LLMService, type LLMProvider } from "./llm";
import type { Item, Settings, InsertAIRecommendation, AIBatchLog, InsertAIBatchLog } from "@shared/schema";

export type BatchRunReason = "SCHEDULED_10AM" | "SCHEDULED_3PM" | "CRITICAL_TRIGGER" | "MANUAL";
export type OrderTiming = "ORDER_TODAY" | "SAFE_UNTIL_TOMORROW";

export interface BatchRunParams {
  reason: BatchRunReason;
  affectedSkus?: string[];
}

export interface BatchRunResult {
  success: boolean;
  batchLogId: string;
  totalSkus: number;
  processedSkus: number;
  criticalItemsFound: number;
  orderTodayCount: number;
  safeUntilTomorrowCount: number;
  error?: string;
}

interface SKUContext {
  sku: string;
  itemId: string;
  productName: string;
  productType: "component" | "finished_product";
  hildaleQty: number;
  pivotQty: number;
  availableForSale: number;
  dailyVelocity: number;
  daysUntilStockout: number;
  leadTimeDays: number;
  inboundPO: number;
  backorders: number;
  returnRate: number;
  adMultiplier: number;
  supplierScore: number;
  riskThresholdHighDays: number;
  riskThresholdMediumDays: number;
  safetyStockDays: number;
}

interface LLMRecommendation {
  sku: string;
  itemId: string;
  riskLevel: "NEED_ORDER" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  recommendedAction: "ORDER" | "MONITOR" | "OK";
  recommendedQty: number;
  daysUntilStockout: number;
  orderTiming: OrderTiming;
  reasoning: string;
}

// Debounce tracking for critical triggers
const criticalTriggerDebounce = new Map<string, number>();
const DEBOUNCE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Mutex for preventing overlapping batch runs
let batchRunInProgress = false;

export class InventoryRecommendationBatch {
  private storage = storage;

  /**
   * Main entry point for running a batch of inventory recommendations
   */
  async runBatch(params: BatchRunParams): Promise<BatchRunResult> {
    // Prevent overlapping runs
    if (batchRunInProgress) {
      console.log("[AI Batch] Skipping run - another batch is in progress");
      return {
        success: false,
        batchLogId: "",
        totalSkus: 0,
        processedSkus: 0,
        criticalItemsFound: 0,
        orderTodayCount: 0,
        safeUntilTomorrowCount: 0,
        error: "Another batch run is in progress",
      };
    }

    batchRunInProgress = true;
    const startTime = Date.now();
    let batchLog: AIBatchLog | undefined;

    try {
      // Create batch log entry
      batchLog = await this.storage.createAIBatchLog({
        reason: params.reason,
        affectedSkus: params.affectedSkus || null,
        status: "RUNNING",
        startedAt: new Date(),
      });

      console.log(`[AI Batch] Starting batch run: ${params.reason}, log ID: ${batchLog.id}`);

      // Get user settings for LLM config and thresholds
      const users = await this.storage.getAllItems(); // Just to get a userId - in production this would be better structured
      const defaultUserId = "default";
      const settings = await this.storage.getSettings(defaultUserId);

      // Get all items or filter by affected SKUs
      let items = await this.storage.getAllItems();
      items = items.filter(item => item.type === "component" || item.type === "finished_product");

      if (params.affectedSkus && params.affectedSkus.length > 0) {
        items = items.filter(item => params.affectedSkus!.includes(item.sku));
      }

      // Update batch log with total count
      await this.storage.updateAIBatchLog(batchLog.id, { totalSkus: items.length });

      if (items.length === 0) {
        await this.storage.updateAIBatchLog(batchLog.id, {
          status: "SUCCESS",
          finishedAt: new Date(),
          processedSkus: 0,
          llmResponseTimeMs: Date.now() - startTime,
        });

        batchRunInProgress = false;
        return {
          success: true,
          batchLogId: batchLog.id,
          totalSkus: 0,
          processedSkus: 0,
          criticalItemsFound: 0,
          orderTodayCount: 0,
          safeUntilTomorrowCount: 0,
        };
      }

      // Build context for each SKU
      const skuContexts = await this.buildSKUContexts(items, settings);

      // Prepare LLM prompt and call
      const llmProvider = (settings?.llmProvider || "chatgpt") as LLMProvider;
      const apiKey = settings?.llmApiKey;
      const recommendations = await this.callLLMForRecommendations(
        skuContexts,
        llmProvider,
        apiKey,
        settings
      );

      // Persist recommendations to database
      let criticalItemsFound = 0;
      let orderTodayCount = 0;
      let safeUntilTomorrowCount = 0;

      for (const rec of recommendations) {
        if (rec.riskLevel === "NEED_ORDER" || rec.riskLevel === "HIGH") {
          criticalItemsFound++;
        }
        if (rec.orderTiming === "ORDER_TODAY") {
          orderTodayCount++;
        } else {
          safeUntilTomorrowCount++;
        }

        // Upsert recommendation
        await this.storage.upsertAIRecommendation({
          type: "INVENTORY",
          itemId: rec.itemId,
          sku: rec.sku,
          productName: skuContexts.find(c => c.sku === rec.sku)?.productName || "",
          recommendationType: rec.recommendedAction === "ORDER" ? "REORDER" : "MONITOR",
          riskLevel: rec.riskLevel === "NEED_ORDER" ? "HIGH" : rec.riskLevel,
          daysUntilStockout: rec.daysUntilStockout,
          availableForSale: skuContexts.find(c => c.sku === rec.sku)?.availableForSale || 0,
          recommendedQty: rec.recommendedQty,
          recommendedAction: rec.recommendedAction,
          reasonSummary: rec.reasoning,
          orderTiming: rec.orderTiming,
          batchLogId: batchLog.id,
          status: "NEW",
        });
      }

      const llmResponseTimeMs = Date.now() - startTime;

      // Update batch log with results
      await this.storage.updateAIBatchLog(batchLog.id, {
        status: "SUCCESS",
        finishedAt: new Date(),
        processedSkus: recommendations.length,
        criticalItemsFound,
        orderTodayCount,
        safeUntilTomorrowCount,
        llmProvider: llmProvider,
        llmResponseTimeMs,
      });

      console.log(`[AI Batch] Completed: ${recommendations.length} SKUs, ${criticalItemsFound} critical, ${orderTodayCount} order today, ${llmResponseTimeMs}ms`);

      batchRunInProgress = false;
      return {
        success: true,
        batchLogId: batchLog.id,
        totalSkus: items.length,
        processedSkus: recommendations.length,
        criticalItemsFound,
        orderTodayCount,
        safeUntilTomorrowCount,
      };

    } catch (error: any) {
      console.error("[AI Batch] Error:", error);

      if (batchLog) {
        await this.storage.updateAIBatchLog(batchLog.id, {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: error.message || "Unknown error",
          llmResponseTimeMs: Date.now() - startTime,
        });
      }

      batchRunInProgress = false;
      return {
        success: false,
        batchLogId: batchLog?.id || "",
        totalSkus: 0,
        processedSkus: 0,
        criticalItemsFound: 0,
        orderTodayCount: 0,
        safeUntilTomorrowCount: 0,
        error: error.message || "Unknown error",
      };
    }
  }

  /**
   * Build context for each SKU including inventory, velocity, lead times, etc.
   */
  private async buildSKUContexts(items: Item[], settings: Settings | undefined): Promise<SKUContext[]> {
    const contexts: SKUContext[] = [];
    const purchaseOrders = await this.storage.getAllPurchaseOrders();
    const poLines = await this.storage.getAllPurchaseOrderLines();
    const salesOrders = await this.storage.getAllSalesOrders();

    // Build PO inbound map
    const inboundMap = new Map<string, number>();
    for (const line of poLines) {
      const po = purchaseOrders.find(p => p.id === line.purchaseOrderId);
      if (po && !po.isHistorical && po.status !== "CANCELLED" && po.status !== "CLOSED") {
        const pending = (line.quantity ?? 0) - (line.receivedQty ?? 0);
        if (pending > 0 && line.itemId) {
          inboundMap.set(line.itemId, (inboundMap.get(line.itemId) || 0) + pending);
        }
      }
    }

    // Build backorder map
    const backorderMap = new Map<string, number>();
    for (const so of salesOrders) {
      if (!so.isHistorical && so.status !== "FULFILLED" && so.status !== "CANCELLED") {
        // Would need to check SO lines for actual backorders
      }
    }

    // Get supplier info for lead times
    const supplierItems = await this.storage.getAllSupplierItems();
    const leadTimeMap = new Map<string, number>();
    const supplierScoreMap = new Map<string, number>();

    for (const si of supplierItems) {
      if (si.isDesignatedSupplier && si.itemId) {
        leadTimeMap.set(si.itemId, si.leadTimeDays || 14);
        supplierScoreMap.set(si.itemId, 85); // Default score, would calculate from disputes/history
      }
    }

    // Default thresholds
    const riskThresholdHighDays = settings?.aiRiskThresholdHighDays ?? 0;
    const riskThresholdMediumDays = settings?.aiRiskThresholdMediumDays ?? 7;
    const safetyStockDays = settings?.aiSafetyStockDays ?? 7;
    const velocityLookbackDays = settings?.aiVelocityLookbackDays ?? 14;

    for (const item of items) {
      const isFinished = item.type === "finished_product";
      const pivotQty = isFinished ? (item.pivotQty ?? 0) : 0;
      const hildaleQty = isFinished ? (item.hildaleQty ?? 0) : 0;
      const availableForSale = isFinished ? (item.availableForSaleQty ?? pivotQty) : item.currentStock;
      const dailyVelocity = item.dailyUsage || 0.1; // Avoid division by zero
      const daysUntilStockout = dailyVelocity > 0 ? availableForSale / dailyVelocity : 999;
      const leadTimeDays = leadTimeMap.get(item.id) || 14;
      const inboundPO = inboundMap.get(item.id) || 0;
      const backorders = backorderMap.get(item.id) || 0;
      const supplierScore = supplierScoreMap.get(item.id) || 85;

      contexts.push({
        sku: item.sku,
        itemId: item.id,
        productName: item.name,
        productType: isFinished ? "finished_product" : "component",
        hildaleQty,
        pivotQty,
        availableForSale,
        dailyVelocity,
        daysUntilStockout: Math.round(daysUntilStockout),
        leadTimeDays,
        inboundPO,
        backorders,
        returnRate: 0.05, // Would calculate from returns data
        adMultiplier: 1.0, // Would calculate from ad metrics
        supplierScore,
        riskThresholdHighDays,
        riskThresholdMediumDays,
        safetyStockDays,
      });
    }

    return contexts;
  }

  /**
   * Call the LLM with batched SKU contexts and get recommendations
   */
  private async callLLMForRecommendations(
    contexts: SKUContext[],
    provider: LLMProvider,
    apiKey: string | undefined | null,
    settings: Settings | undefined
  ): Promise<LLMRecommendation[]> {
    // If no API key, use deterministic fallback
    if (!apiKey) {
      console.log("[AI Batch] No API key configured, using deterministic fallback");
      return this.generateDeterministicRecommendations(contexts);
    }

    // Build the prompt
    const prompt = this.buildBatchPrompt(contexts);

    try {
      const response = await LLMService.askLLM({
        provider,
        apiKey,
        taskType: "order_recommendation",
        payload: { prompt, contexts },
      });

      if (!response.success || !response.data) {
        console.log("[AI Batch] LLM call failed, using deterministic fallback");
        return this.generateDeterministicRecommendations(contexts);
      }

      // Try to parse the LLM response
      try {
        // The LLM might return recommendations in various formats
        const data = response.data;
        if (data.recommendations && Array.isArray(data.recommendations)) {
          return data.recommendations.map((rec: any) => this.normalizeRecommendation(rec, contexts));
        }
        // Fallback to deterministic if response format is unexpected
        return this.generateDeterministicRecommendations(contexts);
      } catch (parseError) {
        console.log("[AI Batch] Failed to parse LLM response, using deterministic fallback");
        return this.generateDeterministicRecommendations(contexts);
      }

    } catch (error: any) {
      console.error("[AI Batch] LLM error:", error);
      return this.generateDeterministicRecommendations(contexts);
    }
  }

  /**
   * Build the prompt for the LLM with all SKU contexts
   */
  private buildBatchPrompt(contexts: SKUContext[]): string {
    const today = new Date().toISOString().split('T')[0];
    const isWeekend = [0, 6].includes(new Date().getDay());
    const nextBusinessDay = isWeekend ? "Monday" : "tomorrow";

    return `You are an inventory management AI assistant. Today is ${today}.

You are analyzing inventory data for ${contexts.length} SKUs. For EACH SKU, you must:
1. Assess the risk level based on days until stockout vs lead time and safety stock needs
2. Decide if a purchase order is needed
3. Determine ORDER TIMING: Must we order TODAY, or can we safely wait until ${nextBusinessDay}?

RISK LEVEL DEFINITIONS:
- NEED_ORDER: Days until stockout <= lead time days (immediate action required)
- HIGH: Days until stockout <= lead time + high risk threshold
- MEDIUM: Days until stockout <= lead time + medium risk threshold  
- LOW: Adequate stock coverage
- UNKNOWN: Insufficient data

ORDER TIMING RULES:
- ORDER_TODAY: Required when daysUntilStockout - leadTimeDays <= 3 (less than 3 days buffer)
- SAFE_UNTIL_TOMORROW: Can wait if daysUntilStockout - leadTimeDays > 3

For each SKU, consider:
- Current available stock and daily sales velocity
- Supplier lead time
- Inbound POs that will replenish stock
- Safety stock requirements
- Return rate impact on available inventory

SKU DATA:
${JSON.stringify(contexts, null, 2)}

Respond with a JSON array of recommendations in this exact format:
{
  "recommendations": [
    {
      "sku": "SKU-123",
      "itemId": "uuid",
      "riskLevel": "HIGH",
      "recommendedAction": "ORDER",
      "recommendedQty": 100,
      "daysUntilStockout": 12,
      "orderTiming": "ORDER_TODAY",
      "reasoning": "Brief explanation referencing key numbers"
    }
  ]
}`;
  }

  /**
   * Normalize a recommendation from LLM response to our format
   */
  private normalizeRecommendation(rec: any, contexts: SKUContext[]): LLMRecommendation {
    const context = contexts.find(c => c.sku === rec.sku || c.itemId === rec.itemId);
    
    return {
      sku: rec.sku || context?.sku || "",
      itemId: rec.itemId || context?.itemId || "",
      riskLevel: this.normalizeRiskLevel(rec.riskLevel),
      recommendedAction: this.normalizeAction(rec.recommendedAction),
      recommendedQty: typeof rec.recommendedQty === "number" ? rec.recommendedQty : 0,
      daysUntilStockout: typeof rec.daysUntilStockout === "number" ? rec.daysUntilStockout : (context?.daysUntilStockout || 999),
      orderTiming: this.normalizeOrderTiming(rec.orderTiming),
      reasoning: rec.reasoning || rec.rationale || "No reasoning provided",
    };
  }

  private normalizeRiskLevel(level: any): LLMRecommendation["riskLevel"] {
    const normalized = String(level).toUpperCase();
    if (["NEED_ORDER", "HIGH", "MEDIUM", "LOW", "UNKNOWN"].includes(normalized)) {
      return normalized as LLMRecommendation["riskLevel"];
    }
    if (normalized === "CRITICAL") return "NEED_ORDER";
    return "UNKNOWN";
  }

  private normalizeAction(action: any): LLMRecommendation["recommendedAction"] {
    const normalized = String(action).toUpperCase();
    if (["ORDER", "MONITOR", "OK"].includes(normalized)) {
      return normalized as LLMRecommendation["recommendedAction"];
    }
    if (normalized === "REORDER") return "ORDER";
    return "MONITOR";
  }

  private normalizeOrderTiming(timing: any): OrderTiming {
    const normalized = String(timing).toUpperCase().replace(/ /g, "_");
    if (normalized === "ORDER_TODAY" || normalized === "ORDERTODAY") {
      return "ORDER_TODAY";
    }
    return "SAFE_UNTIL_TOMORROW";
  }

  /**
   * Generate deterministic recommendations when LLM is unavailable
   */
  private generateDeterministicRecommendations(contexts: SKUContext[]): LLMRecommendation[] {
    return contexts.map(ctx => {
      const { daysUntilStockout, leadTimeDays, safetyStockDays, riskThresholdHighDays, riskThresholdMediumDays } = ctx;
      const coverageBuffer = daysUntilStockout - leadTimeDays;

      // Determine risk level
      let riskLevel: LLMRecommendation["riskLevel"];
      if (daysUntilStockout <= leadTimeDays) {
        riskLevel = "NEED_ORDER";
      } else if (coverageBuffer <= riskThresholdHighDays) {
        riskLevel = "HIGH";
      } else if (coverageBuffer <= riskThresholdMediumDays) {
        riskLevel = "MEDIUM";
      } else {
        riskLevel = "LOW";
      }

      // Determine action
      let recommendedAction: LLMRecommendation["recommendedAction"];
      if (riskLevel === "NEED_ORDER" || riskLevel === "HIGH") {
        recommendedAction = "ORDER";
      } else if (riskLevel === "MEDIUM") {
        recommendedAction = "MONITOR";
      } else {
        recommendedAction = "OK";
      }

      // Calculate recommended order quantity
      const targetDays = leadTimeDays + safetyStockDays;
      const targetStock = ctx.dailyVelocity * targetDays;
      const currentCoverage = ctx.availableForSale + ctx.inboundPO;
      const recommendedQty = Math.max(0, Math.round(targetStock - currentCoverage));

      // Determine order timing
      const orderTiming: OrderTiming = coverageBuffer <= 3 ? "ORDER_TODAY" : "SAFE_UNTIL_TOMORROW";

      // Generate reasoning
      let reasoning = "";
      if (riskLevel === "NEED_ORDER") {
        reasoning = `Critical: Only ${Math.round(daysUntilStockout)} days of stock with ${leadTimeDays}-day lead time. Order immediately.`;
      } else if (riskLevel === "HIGH") {
        reasoning = `High priority: ${Math.round(daysUntilStockout)} days of stock, ${Math.round(coverageBuffer)} days buffer after lead time.`;
      } else if (riskLevel === "MEDIUM") {
        reasoning = `Monitor: ${Math.round(daysUntilStockout)} days of stock, ${Math.round(coverageBuffer)} days buffer.`;
      } else {
        reasoning = `Healthy: ${Math.round(daysUntilStockout)} days of stock coverage.`;
      }

      if (ctx.inboundPO > 0) {
        reasoning += ` ${ctx.inboundPO} units on order.`;
      }

      return {
        sku: ctx.sku,
        itemId: ctx.itemId,
        riskLevel,
        recommendedAction,
        recommendedQty,
        daysUntilStockout: Math.round(daysUntilStockout),
        orderTiming,
        reasoning,
      };
    });
  }

  /**
   * Check if a SKU has crossed into critical state and should trigger a batch run
   */
  isCritical(daysUntilStockout: number, leadTimeDays: number, riskThresholdHighDays: number = 0): boolean {
    return daysUntilStockout <= leadTimeDays + riskThresholdHighDays;
  }

  /**
   * Schedule a critical trigger batch run with debounce
   */
  async scheduleCriticalTrigger(sku: string, itemId: string): Promise<boolean> {
    const now = Date.now();
    const lastTrigger = criticalTriggerDebounce.get(sku);

    if (lastTrigger && now - lastTrigger < DEBOUNCE_WINDOW_MS) {
      console.log(`[AI Batch] Skipping critical trigger for ${sku} - within debounce window`);
      return false;
    }

    criticalTriggerDebounce.set(sku, now);
    console.log(`[AI Batch] Scheduling critical trigger for ${sku}`);

    // Run the batch with just this SKU
    const result = await this.runBatch({
      reason: "CRITICAL_TRIGGER",
      affectedSkus: [sku],
    });

    return result.success;
  }

  /**
   * Clean up old debounce entries (call periodically)
   */
  cleanupDebounceMap(): void {
    const now = Date.now();
    for (const [sku, timestamp] of criticalTriggerDebounce.entries()) {
      if (now - timestamp > DEBOUNCE_WINDOW_MS * 2) {
        criticalTriggerDebounce.delete(sku);
      }
    }
  }
}

// Export singleton instance
export const inventoryRecommendationBatch = new InventoryRecommendationBatch();

// Export function for external use
export async function runInventoryRecommendationsBatch(params: BatchRunParams): Promise<BatchRunResult> {
  return inventoryRecommendationBatch.runBatch(params);
}
