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
import { LLMService, type LLMProvider, type PriceExtractionResult } from "./llm";
import type { Item, Settings, InsertAIRecommendation, AIBatchLog, InsertAIBatchLog } from "@shared/schema";
import { ghlOpportunitiesService } from "./ghl-opportunities-service";
import { GHL_CONFIG } from "../config/ghl-config";
import { wsLogsService } from "./websocket-logs";
import { buildReportContext, formatReportContextForPrompt, type ReportContext } from "./report-context-builder";

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
  supplierMOQ: number;
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
  notesForHuman?: string;
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
      wsLogsService.broadcastBatchLog(batchLog);

      console.log(`[AI Batch] Starting batch run: ${params.reason}, log ID: ${batchLog.id}`);

      // Get user settings for LLM config and thresholds
      const users = await this.storage.getAllItems(); // Just to get a userId - in production this would be better structured
      const defaultUserId = "default";
      const settings = await this.storage.getSettings(defaultUserId);

      // Get all items or filter by affected SKUs
      // Only analyze components for ordering - finished products are manufactured, not ordered
      let items = await this.storage.getAllItems();
      items = items.filter(item => item.type === "component");

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
      let autoDraftPOsCreated = 0;

      // Check AI Agent Settings for auto-draft PO creation
      const aiAgentSettings = await this.storage.getAiAgentSettingsByUserId(defaultUserId);
      const shouldAutoDraftPOs = aiAgentSettings?.autoSendCriticalPos ?? false;

      // Get supplier items for PO creation
      const supplierItems = await this.storage.getAllSupplierItems();
      const suppliers = await this.storage.getAllSuppliers();

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
        const skuContext = skuContexts.find(c => c.sku === rec.sku);
        
        // Build source signals from context (flat structure for UI compatibility)
        const sourceSignals = skuContext ? {
          hildaleQty: skuContext.hildaleQty,
          pivotQty: skuContext.pivotQty,
          availableForSale: skuContext.availableForSale,
          dailyVelocity: skuContext.dailyVelocity,
          adMultiplier: skuContext.adMultiplier,
          leadTimeDays: skuContext.leadTimeDays,
          inboundPO: skuContext.inboundPO,
          daysUntilStockout: skuContext.daysUntilStockout,
          safetyStockDays: skuContext.safetyStockDays,
          backorders: skuContext.backorders,
          returnRate: skuContext.returnRate,
        } : null;
        
        await this.storage.upsertAIRecommendation({
          type: "INVENTORY",
          itemId: rec.itemId,
          sku: rec.sku,
          productName: skuContext?.productName || "",
          recommendationType: rec.recommendedAction === "ORDER" ? "REORDER" : "MONITOR",
          riskLevel: rec.riskLevel === "NEED_ORDER" ? "HIGH" : rec.riskLevel,
          daysUntilStockout: rec.daysUntilStockout,
          availableForSale: skuContext?.availableForSale || 0,
          recommendedQty: rec.recommendedQty,
          recommendedAction: rec.recommendedAction,
          reasonSummary: rec.reasoning,
          orderTiming: rec.orderTiming,
          batchLogId: batchLog.id,
          status: "NEW",
          adMultiplier: skuContext?.adMultiplier ?? 1.0,
          baseVelocity: skuContext?.dailyVelocity ?? null,
          adjustedVelocity: skuContext ? skuContext.dailyVelocity * (skuContext.adMultiplier || 1.0) : null,
          sourceSignals: sourceSignals,
          contextSnapshot: skuContext ? { ...skuContext, batchReason: params.reason } : null,
          notesForHuman: rec.notesForHuman || null,
        });

        // Auto-create draft PO for critical items with ORDER_TODAY timing
        if (shouldAutoDraftPOs && 
            rec.orderTiming === "ORDER_TODAY" && 
            (rec.riskLevel === "NEED_ORDER" || rec.riskLevel === "HIGH") &&
            rec.recommendedAction === "ORDER" &&
            rec.recommendedQty > 0) {
          
          try {
            const draftPO = await this.createAutoDraftPO(
              rec.itemId,
              rec.sku,
              rec.recommendedQty,
              rec.reasoning,
              supplierItems,
              suppliers
            );
            
            if (draftPO) {
              autoDraftPOsCreated++;
              console.log(`[AI Batch] Auto-created draft PO ${draftPO.poNumber} for ${rec.sku}`);
              
              // Create notification for auto-draft PO
              await this.storage.createNotification({
                userId: defaultUserId,
                type: "AUTO_PO_CREATED",
                title: `Auto-Draft PO: ${rec.sku}`,
                message: `AI created draft PO ${draftPO.poNumber} for ${rec.recommendedQty} units. Review and send to complete.`,
                severity: "HIGH",
                actionUrl: `/products?tab=purchase-orders&po=${draftPO.id}`,
                actionLabel: "Review PO",
                relatedEntityType: "PurchaseOrder",
                relatedEntityId: draftPO.id,
                isPinned: false,
                isRead: false,
                metadata: { 
                  sku: rec.sku, 
                  quantity: rec.recommendedQty,
                  poNumber: draftPO.poNumber,
                  daysUntilStockout: rec.daysUntilStockout
                },
              });
            }
          } catch (error: any) {
            console.error(`[AI Batch] Failed to auto-create draft PO for ${rec.sku}:`, error);
          }
        } else if ((rec.riskLevel === "NEED_ORDER" || rec.riskLevel === "HIGH") && 
                   rec.orderTiming === "ORDER_TODAY" &&
                   rec.recommendedAction === "ORDER") {
          try {
            const productName = skuContexts.find(c => c.sku === rec.sku)?.productName || rec.sku;
            const notificationType = rec.riskLevel === "NEED_ORDER" ? "STOCK_WARNING_CRITICAL" : "STOCK_WARNING_HIGH";
            await this.storage.createNotification({
              userId: defaultUserId,
              type: notificationType,
              title: `Critical Stock: ${rec.sku}`,
              message: `${productName} has only ${rec.daysUntilStockout} days of stock remaining. Order ${rec.recommendedQty} units now.`,
              severity: rec.riskLevel === "NEED_ORDER" ? "CRITICAL" : "HIGH",
              actionUrl: `/products?item=${rec.itemId}`,
              actionLabel: "View Item",
              relatedEntityType: "ITEM",
              relatedEntityId: rec.itemId,
              isPinned: false,
              isRead: false,
              metadata: { 
                sku: rec.sku, 
                recommendedQty: rec.recommendedQty,
                daysUntilStockout: rec.daysUntilStockout,
                riskLevel: rec.riskLevel,
              },
            });
          } catch (error: any) {
            console.error(`[AI Batch] Failed to create stock warning notification for ${rec.sku}:`, error);
          }
        }
      }

      const llmResponseTimeMs = Date.now() - startTime;

      // Update batch log with results
      const updatedLog = await this.storage.updateAIBatchLog(batchLog.id, {
        status: "SUCCESS",
        finishedAt: new Date(),
        processedSkus: recommendations.length,
        criticalItemsFound,
        orderTodayCount,
        safeUntilTomorrowCount,
        llmProvider: llmProvider,
        llmResponseTimeMs,
      });
      if (updatedLog) wsLogsService.broadcastBatchLog(updatedLog);

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
        const failedLog = await this.storage.updateAIBatchLog(batchLog.id, {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: error.message || "Unknown error",
          llmResponseTimeMs: Date.now() - startTime,
        });
        if (failedLog) wsLogsService.broadcastBatchLog(failedLog);
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
        const pending = (line.qtyOrdered ?? 0) - (line.qtyReceived ?? 0);
        if (pending > 0 && line.itemId) {
          inboundMap.set(line.itemId, (inboundMap.get(line.itemId) || 0) + pending);
        }
      }
    }

    // Build backorder map
    const backorderMap = new Map<string, number>();
    for (const so of salesOrders) {
      if (!so.isHistorical && so.status !== "FULFILLED" && so.status !== "DELIVERED" && so.status !== "CANCELLED") {
        // Would need to check SO lines for actual backorders
      }
    }

    // Get supplier info for lead times and MOQ
    const supplierItems = await this.storage.getAllSupplierItems();
    const leadTimeMap = new Map<string, number>();
    const moqMap = new Map<string, number>();
    const supplierScoreMap = new Map<string, number>();

    for (const si of supplierItems) {
      if (si.isDesignatedSupplier && si.itemId) {
        leadTimeMap.set(si.itemId, si.leadTimeDays || 14);
        moqMap.set(si.itemId, si.minimumOrderQuantity || 0);
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
      const supplierMOQ = moqMap.get(item.id) || 0;
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
        supplierMOQ,
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

    // Build report context for business-informed decisions
    let reportContext: ReportContext | undefined;
    try {
      reportContext = await buildReportContext();
      console.log("[AI Batch] Built report context with sales, PO, and QuickBooks data");
    } catch (reportError) {
      console.warn("[AI Batch] Failed to build report context, proceeding without:", reportError);
    }

    // Build the prompt with report context
    const prompt = this.buildBatchPrompt(contexts, reportContext);

    try {
      const response = await LLMService.askLLM({
        provider,
        apiKey,
        taskType: "order_recommendation",
        payload: { prompt, contexts, reportContext },
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
   * Build the prompt for the LLM with all SKU contexts and business report context
   */
  private buildBatchPrompt(contexts: SKUContext[], reportContext?: ReportContext): string {
    const today = new Date().toISOString().split('T')[0];
    const isWeekend = [0, 6].includes(new Date().getDay());
    const nextBusinessDay = isWeekend ? "Monday" : "tomorrow";
    
    const businessContextSection = reportContext 
      ? formatReportContextForPrompt(reportContext)
      : '';

    return `You are an inventory management AI assistant for a manufacturing company. Today is ${today}.

${businessContextSection}

=== YOUR TASK ===

Analyze inventory data for ${contexts.length} component SKUs. For EACH SKU:
1. Assess risk level based on days until stockout vs lead time and safety stock
2. Decide if a purchase order is needed
3. Determine ORDER TIMING: Must we order TODAY, or can we safely wait until ${nextBusinessDay}?
4. Consider business context (sales trends, pending POs, historical demand)

RISK LEVEL DEFINITIONS:
- NEED_ORDER: Days until stockout <= lead time days (immediate action required)
- HIGH: Days until stockout <= lead time + high risk threshold
- MEDIUM: Days until stockout <= lead time + medium risk threshold  
- LOW: Adequate stock coverage
- UNKNOWN: Insufficient data

ORDER TIMING RULES:
- ORDER_TODAY: Required when daysUntilStockout - leadTimeDays <= 3 (less than 3 days buffer)
- SAFE_UNTIL_TOMORROW: Can wait if daysUntilStockout - leadTimeDays > 3

DECISION FACTORS:
- Current available stock and daily sales velocity
- Supplier lead time
- Supplier MOQ (minimum order quantity) - order quantity must be >= MOQ when ordering
- Inbound POs that will replenish stock (check if already covered)
- Safety stock requirements
- Return rate impact on available inventory
- Recent sales trends (is demand increasing/decreasing?)
- Historical seasonality from QuickBooks data

MOQ CONSTRAINT:
- If recommending an order, ensure recommendedQty >= supplierMOQ
- If calculated need is less than MOQ, still recommend MOQ quantity (supplier won't ship less)

=== SKU DATA ===
${JSON.stringify(contexts, null, 2)}

=== RESPONSE FORMAT ===
Respond with JSON in this exact format:
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
      "reasoning": "Brief explanation referencing key metrics",
      "notesForHuman": "Optional context for human reviewer about edge cases or special considerations"
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
      notesForHuman: rec.notesForHuman || undefined,
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

      // Calculate recommended order quantity (respecting supplier MOQ)
      const targetDays = leadTimeDays + safetyStockDays;
      const targetStock = ctx.dailyVelocity * targetDays;
      const currentCoverage = ctx.availableForSale + ctx.inboundPO;
      const calculatedQty = Math.max(0, Math.round(targetStock - currentCoverage));

      // Determine order timing
      const orderTiming: OrderTiming = coverageBuffer <= 3 ? "ORDER_TODAY" : "SAFE_UNTIL_TOMORROW";

      // Apply MOQ constraint: if recommending ORDER action, quantity must be at least supplier MOQ
      // Even if calculated qty is 0, if we're ordering, use MOQ as minimum
      let recommendedQty = calculatedQty;
      if (recommendedAction === "ORDER" && ctx.supplierMOQ > 0) {
        recommendedQty = Math.max(calculatedQty, ctx.supplierMOQ);
      }

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

      // Add demand risk context when ad multiplier indicates surge
      if (ctx.adMultiplier > 1) {
        const surgePercent = Math.round((ctx.adMultiplier - 1) * 100);
        if (surgePercent >= 30) {
          reasoning += ` WARNING: ${surgePercent}% demand surge risk from ad performance - recommend ordering now.`;
        } else if (surgePercent >= 15) {
          reasoning += ` Caution: ${surgePercent}% demand surge risk from ad trends.`;
        } else if (surgePercent >= 5) {
          reasoning += ` Note: ${surgePercent}% elevated demand from ads.`;
        }
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
   * Create an auto-draft PO for a critical item
   */
  private async createAutoDraftPO(
    itemId: string,
    sku: string,
    quantity: number,
    reasoning: string,
    supplierItems: any[],
    suppliers: any[]
  ): Promise<any | null> {
    // Find designated supplier for this item first (preferred)
    let designatedSupplierItem = supplierItems.find(
      si => si.itemId === itemId && si.isDesignatedSupplier
    );
    
    // If no designated supplier, use AI to select best supplier based on history
    if (!designatedSupplierItem) {
      // Get all supplier items for this item
      const itemSupplierItems = supplierItems.filter(si => si.itemId === itemId);
      
      if (itemSupplierItems.length === 0) {
        console.log(`[AI Batch] No supplier items for ${sku}, skipping auto-draft PO`);
        return null;
      }
      
      // Select supplier with best PO history (highest received/sent ratio, then most received)
      const supplierScores = itemSupplierItems.map(si => {
        const supplier = suppliers.find(s => s.id === si.supplierId);
        if (!supplier) return { si, score: -1, received: 0 };
        
        const sent = supplier.poSentCount || 0;
        const received = supplier.poReceivedCount || 0;
        
        // Score: reliability (received/sent ratio) * 100 + received count
        // New suppliers with no history get score 0
        const reliability = sent > 0 ? received / sent : 0;
        const score = (reliability * 100) + received;
        
        return { si, score, received, supplier };
      }).filter(s => s.score >= 0);
      
      if (supplierScores.length === 0) {
        console.log(`[AI Batch] No valid suppliers found for ${sku}, skipping auto-draft PO`);
        return null;
      }
      
      // Sort by score descending, pick best one
      supplierScores.sort((a, b) => b.score - a.score);
      designatedSupplierItem = supplierScores[0].si;
      
      console.log(`[AI Batch] AI selected supplier ${supplierScores[0].supplier?.name} for ${sku} based on history (score: ${supplierScores[0].score.toFixed(1)})`);
    }
    
    const supplier = suppliers.find(s => s.id === designatedSupplierItem.supplierId);
    if (!supplier) {
      console.log(`[AI Batch] Supplier not found for ${sku}, skipping auto-draft PO`);
      return null;
    }
    
    // Get item details
    const items = await this.storage.getAllItems();
    const item = items.find(i => i.id === itemId);
    if (!item) {
      console.log(`[AI Batch] Item not found for ${sku}, skipping auto-draft PO`);
      return null;
    }
    
    // Generate PO number
    const existingPOs = await this.storage.getAllPurchaseOrders();
    const poCount = existingPOs.length + 1;
    const poNumber = `AI-PO-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${String(poCount).padStart(4, '0')}`;
    
    // Calculate cost - priority: supplier item price > item defaultPurchaseCost > LLM extraction > 0
    let unitCost = designatedSupplierItem.price ?? item.defaultPurchaseCost ?? 0;
    
    // Check if price needs refresh (no price or >30 days old)
    const needsPriceRefresh = LLMService.needsPriceRefresh({
      defaultPurchaseCost: unitCost,
      lastCostUpdatedAt: item.lastCostUpdatedAt,
    });
    
    if (needsPriceRefresh && item.supplierProductUrl) {
      console.log(`[AI Batch] Price needs refresh for ${sku}, attempting LLM extraction from ${item.supplierProductUrl}`);
      
      try {
        const defaultUserId = "default";
        const settings = await this.storage.getSettings(defaultUserId);
        const llmProvider = (settings?.llmProvider || "chatgpt") as LLMProvider;
        const apiKey = settings?.llmApiKey;
        
        if (apiKey) {
          const priceResult = await LLMService.extractPriceFromUrl(
            item.supplierProductUrl,
            item.name,
            sku,
            llmProvider,
            apiKey
          );
          
          if (priceResult.success && priceResult.price && priceResult.price > 0) {
            if (priceResult.confidence === 'high' || priceResult.confidence === 'medium') {
              unitCost = priceResult.price;
              console.log(`[AI Batch] LLM extracted price $${unitCost} for ${sku} (${priceResult.confidence} confidence)`);
              
              await this.storage.updateItem(item.id, {
                defaultPurchaseCost: unitCost,
                currency: priceResult.currency,
                costSource: 'AUTO_SCRAPED',
                lastCostUpdatedAt: new Date(),
              });
            } else {
              console.log(`[AI Batch] Skipping low-confidence price $${priceResult.price} for ${sku} - not updating`);
            }
          } else {
            console.log(`[AI Batch] LLM price extraction failed for ${sku}: ${priceResult.error}`);
          }
        } else {
          console.log(`[AI Batch] No LLM API key configured, skipping price extraction for ${sku}`);
        }
      } catch (priceError: any) {
        console.warn(`[AI Batch] Error during LLM price extraction for ${sku}: ${priceError.message}`);
      }
    }
    
    const lineTotal = quantity * unitCost;
    
    // Create the PO
    const po = await this.storage.createPurchaseOrder({
      poNumber,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierEmail: supplier.email,
      status: "DRAFT",
      orderDate: new Date(),
      expectedDate: new Date(Date.now() + (designatedSupplierItem.leadTimeDays || 14) * 24 * 60 * 60 * 1000),
      subtotal: lineTotal,
      shippingCost: 0,
      total: lineTotal,
      notes: `Auto-generated by AI Batch System.\n\nReason: ${reasoning}`,
      isHistorical: false,
      isAutoDraft: true,
    });
    
    // Create the PO line
    await this.storage.createPurchaseOrderLine({
      purchaseOrderId: po.id,
      itemId: item.id,
      sku: sku,
      itemName: item.name,
      qtyOrdered: quantity,
      qtyReceived: 0,
      unitCost: unitCost,
      lineTotal: lineTotal,
    });
    
    // Check if supplier is missing email or mandatory business info
    const missingFields = this.getSupplierMissingFields(supplier);
    
    if (missingFields.length > 0) {
      // Create GHL "Needs Attention" opportunity for missing supplier info
      try {
        await this.createGHLMissingSupplierInfoOpportunity(po, supplier, missingFields, item);
      } catch (ghlError: any) {
        console.warn(`[AI Batch] Failed to create GHL opportunity for missing supplier info: ${ghlError.message}`);
      }
    } else {
      // Create GHL "Needs Attention" opportunity for critical auto-sent PO
      try {
        await this.createGHLCriticalPOOpportunity(po, supplier, quantity, reasoning, item);
      } catch (ghlError: any) {
        console.warn(`[AI Batch] Failed to create GHL opportunity for auto-draft PO: ${ghlError.message}`);
        // Don't fail the PO creation if GHL fails
      }
    }
    
    return po;
  }
  
  /**
   * Check supplier for missing mandatory fields required to send a PO
   * Returns array of missing field names
   */
  private getSupplierMissingFields(supplier: any): string[] {
    const missingFields: string[] = [];
    
    // Email is required to send PO
    if (!supplier.email) {
      missingFields.push('Email');
    }
    
    // Contact name is helpful for addressing POs
    if (!supplier.contactName) {
      missingFields.push('Contact Name');
    }
    
    return missingFields;
  }
  
  /**
   * Create a GHL "Needs Attention" opportunity when supplier is missing email or mandatory info
   */
  private async createGHLMissingSupplierInfoOpportunity(
    po: any,
    supplier: any,
    missingFields: string[],
    item: any
  ): Promise<void> {
    // Initialize GHL service - get any user with GHL config
    const users = await this.storage.getAllUsers();
    let initialized = false;
    for (const user of users) {
      const success = await ghlOpportunitiesService.initialize(user.id);
      if (success && ghlOpportunitiesService.isConfigured()) {
        initialized = true;
        break;
      }
    }
    
    if (!initialized) {
      console.log('[AI Batch] GHL not configured, skipping missing supplier info opportunity');
      return;
    }
    
    // Get system contact (replit admin)
    const systemContactId = await ghlOpportunitiesService.getOrCreateSystemContact();
    if (!systemContactId) {
      console.log('[AI Batch] No system contact available for GHL opportunity');
      return;
    }
    
    const stageId = GHL_CONFIG.stages.STALE_SYNC_ALERT; // "Needs Attention" stage
    
    const opportunityName = `Needed PO is missing supplier info - ${supplier.name}`;
    const externalKey = `missing-supplier-info-${po.id}`;
    
    // Create the opportunity
    const createResult = await ghlOpportunitiesService.upsertOpportunity({
      externalKey,
      name: opportunityName,
      pipelineStageId: stageId,
      status: 'open',
      amount: po.total ?? 0,
      contactId: systemContactId,
    });
    
    if (!createResult.success || !createResult.opportunityId) {
      console.warn(`[AI Batch] Failed to create GHL missing supplier info opportunity: ${createResult.error}`);
      return;
    }
    
    // Add notes with details
    const dateCreated = new Date().toLocaleString('en-US', { 
      timeZone: 'America/Denver',
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    
    const notes = [
      `ACTION REQUIRED: SUPPLIER INFO MISSING`,
      ``,
      `A Purchase Order was auto-drafted but cannot be sent because the supplier is missing required information.`,
      ``,
      `PO Number: ${po.poNumber}`,
      `Supplier: ${supplier.name}`,
      `Date Created: ${dateCreated}`,
      `PO Amount: $${(po.total ?? 0).toFixed(2)}`,
      ``,
      `Missing Fields:`,
      ...missingFields.map(field => `- ${field}`),
      ``,
      `Item Needed: ${item.sku} - ${item.name}`,
      ``,
      `Please update the supplier's contact information in the Suppliers page, then manually send the PO.`,
    ].join('\n');
    
    await ghlOpportunitiesService.addNoteToOpportunity(systemContactId, createResult.opportunityId, notes);
    
    console.log(`[AI Batch] Created GHL "Needs Attention" opportunity for missing supplier info: ${supplier.name}`);
  }
  
  /**
   * Create a GHL "Needs Attention" opportunity when AI auto-sends a critical PO
   */
  private async createGHLCriticalPOOpportunity(
    po: any,
    supplier: any,
    quantity: number,
    reasoning: string,
    item: any
  ): Promise<void> {
    // Guard: Only create opportunity for AI auto-draft POs
    if (!po.isAutoDraft) {
      console.log(`[AI Batch] Skipping GHL opportunity for non-auto-draft PO ${po.poNumber}`);
      return;
    }
    
    // Initialize GHL service - get any user with GHL config
    const users = await this.storage.getAllUsers();
    let initialized = false;
    for (const user of users) {
      const success = await ghlOpportunitiesService.initialize(user.id);
      if (success && ghlOpportunitiesService.isConfigured()) {
        initialized = true;
        break;
      }
    }
    
    if (!initialized) {
      console.log('[AI Batch] GHL not configured, skipping opportunity creation');
      return;
    }
    
    // Get system contact (replit admin)
    const systemContactId = await ghlOpportunitiesService.getOrCreateSystemContact();
    if (!systemContactId) {
      console.log('[AI Batch] No system contact available for GHL opportunity');
      return;
    }
    
    // Get PO lines to compute accurate metrics
    const poLines = await this.storage.getPurchaseOrderLinesByPOId(po.id);
    const itemCount = poLines.length || 1;
    const totalQty = poLines.reduce((sum, line) => sum + (line.qtyOrdered || 0), 0) || quantity;
    const monetaryValue = poLines.reduce((sum, line) => sum + (line.lineTotal || 0), 0) || (po.total ?? 0);
    
    const stageId = GHL_CONFIG.stages.STALE_SYNC_ALERT; // "Needs Attention" stage
    
    const opportunityName = `Critical PO Sent: ${po.poNumber}`;
    const externalKey = `critical-po-${po.id}`;
    
    // First create the opportunity using upsertOpportunity
    const createResult = await ghlOpportunitiesService.upsertOpportunity({
      externalKey,
      name: opportunityName,
      pipelineStageId: stageId,
      status: 'open',
      amount: monetaryValue,
      contactId: systemContactId,
    });
    
    if (!createResult.success || !createResult.opportunityId) {
      console.warn(`[AI Batch] Failed to create GHL opportunity: ${createResult.error}`);
      return;
    }
    
    // Then add notes via the notes API
    const dateSent = new Date().toLocaleString('en-US', { 
      timeZone: 'America/Denver',
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    
    // Build item details from PO lines
    const itemDetails = poLines.length > 0
      ? poLines.map(line => `- SKU: ${line.sku || 'N/A'}, Name: ${line.itemName || 'Unknown'}, Qty: ${line.qtyOrdered}`).join('\n')
      : `- SKU: ${item.sku}, Name: ${item.name}, Qty: ${quantity}`;
    
    const notes = [
      `CRITICAL PO AUTO-SENT BY AI`,
      ``,
      `PO Number: ${po.poNumber}`,
      `Supplier: ${supplier.name}`,
      `Date Sent: ${dateSent}`,
      `PO Amount: $${monetaryValue.toFixed(2)}`,
      `# of Items: ${itemCount}`,
      `Total Qty: ${totalQty}`,
      ``,
      `AI Reason for Auto-Send:`,
      reasoning,
      ``,
      `Item Details:`,
      itemDetails,
    ].join('\n');
    
    // Add note to opportunity via contact notes
    await ghlOpportunitiesService.addNoteToOpportunity(systemContactId, createResult.opportunityId, notes);
    
    console.log(`[AI Batch] Created GHL "Needs Attention" opportunity for ${po.poNumber}`);
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
    const entries = Array.from(criticalTriggerDebounce.entries());
    for (const [sku, timestamp] of entries) {
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
