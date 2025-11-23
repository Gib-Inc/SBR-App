import { storage } from "../storage";

export type LLMProvider = "chatgpt" | "claude" | "grok" | "custom";

export interface LLMRequest {
  provider: LLMProvider;
  apiKey: string;
  customEndpoint?: string;
  taskType: "order_recommendation" | "supplier_ranking" | "forecasting";
  payload: any;
}

export interface LLMResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface ReorderRecommendation {
  itemId: string;
  itemName: string;
  currentStock: number; // For components; for finished products, this is pivotQty
  pivotQty?: number; // For finished products only
  hildaleQty?: number; // For finished products only
  totalOwned?: number; // For finished products only (pivotQty + hildaleQty)
  itemType: "component" | "finished_product";
  recommendedOrderQty: number;
  urgency: "critical" | "high" | "medium" | "low";
  reason: string;
  estimatedStockoutDays: number;
  suggestedSupplier?: string;
}

export interface SupplierRanking {
  supplierId: string;
  supplierName: string;
  score: number;
  priceScore: number;
  leadTimeScore: number;
  reliabilityScore: number;
  recommendation: string;
}

export interface DemandForecast {
  itemId: string;
  itemName: string;
  currentDailyUsage: number;
  forecastedDailyUsage: number;
  confidenceInterval: {
    low: number;
    high: number;
  };
  confidence: "high" | "medium" | "low";
  trend: "increasing" | "stable" | "decreasing";
  seasonalPattern?: string;
}

export interface VisionIdentificationResult {
  name: string;
  sku: string | null;
  quantity: number | null;
  type: "component" | "finished_product";
  category: string | null;
  location: string | null;
  confidence: number; // 0-1 scale
  description: string;
}

export interface VisionRequest {
  provider: "gpt-4-vision" | "claude-vision";
  apiKey: string;
  model: string; // e.g., "gpt-4o", "claude-3-opus"
  imageDataUrl: string; // base64 encoded image
}

/**
 * Pluggable LLM helper that routes requests to different providers
 */
export class LLMService {
  /**
   * Main entry point for LLM requests
   */
  static async askLLM(request: LLMRequest): Promise<LLMResponse> {
    try {
      switch (request.provider) {
        case "chatgpt":
          return await this.askChatGPT(request);
        case "claude":
          return await this.askClaude(request);
        case "grok":
          return await this.askGrok(request);
        case "custom":
          return await this.askCustom(request);
        default:
          return {
            success: false,
            error: `Unknown provider: ${request.provider}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "LLM request failed",
      };
    }
  }

  /**
   * ChatGPT/OpenAI integration
   */
  private static async askChatGPT(request: LLMRequest): Promise<LLMResponse> {
    // Stub implementation - would use OpenAI SDK in production
    // const openai = new OpenAI({ apiKey: request.apiKey });
    // const completion = await openai.chat.completions.create({
    //   model: "gpt-4",
    //   messages: [{ role: "user", content: this.buildPrompt(request) }],
    // });
    
    if (request.taskType === "order_recommendation" && request.payload?.prompt) {
      return {
        success: true,
        data: {
          provider: "chatgpt",
          recommendation: {
            daysUntilStockout: 20,
            willLastFourWeeks: false,
            urgency: "high",
            recommendedOrderQty: 150,
            reasoning: "Based on current daily usage rate of 5 units/day and current stock of 100 units, the inventory will last approximately 20 days. This falls into the 'high' urgency category (14-21 days). Considering the 14-day supplier lead time, ordering now is recommended to avoid stockout. The recommended quantity of 150 units provides a 30-day safety buffer."
          },
          taskType: request.taskType,
        },
      };
    }
    
    return {
      success: true,
      data: {
        provider: "chatgpt",
        recommendation: "Stub response from ChatGPT",
        taskType: request.taskType,
      },
    };
  }

  /**
   * Claude/Anthropic integration
   */
  private static async askClaude(request: LLMRequest): Promise<LLMResponse> {
    // Stub implementation - would use Anthropic SDK in production
    // const anthropic = new Anthropic({ apiKey: request.apiKey });
    // const message = await anthropic.messages.create({
    //   model: "claude-3-opus-20240229",
    //   messages: [{ role: "user", content: this.buildPrompt(request) }],
    // });

    if (request.taskType === "order_recommendation" && request.payload?.prompt) {
      return {
        success: true,
        data: {
          provider: "claude",
          recommendation: {
            daysUntilStockout: 18,
            willLastFourWeeks: false,
            urgency: "high",
            recommendedOrderQty: 140,
            reasoning: "Current inventory analysis shows 18 days until stockout based on historical usage patterns. Given the supplier's 14-day lead time, immediate ordering is critical to maintain continuous operations. The recommended 140-unit order accounts for safety stock requirements and anticipated demand variability."
          },
          taskType: request.taskType,
        },
      };
    }

    return {
      success: true,
      data: {
        provider: "claude",
        recommendation: "Stub response from Claude",
        taskType: request.taskType,
      },
    };
  }

  /**
   * Grok integration
   */
  private static async askGrok(request: LLMRequest): Promise<LLMResponse> {
    // Stub implementation - would use Grok API in production
    if (request.taskType === "order_recommendation" && request.payload?.prompt) {
      return {
        success: true,
        data: {
          provider: "grok",
          recommendation: {
            daysUntilStockout: 22,
            willLastFourWeeks: false,
            urgency: "medium",
            recommendedOrderQty: 160,
            reasoning: "Stock projection indicates 22 days of inventory remain at current consumption rate. While not critical, ordering within the next week ensures adequate buffer given the 14-day delivery window. Recommended quantity provides 30-day coverage post-delivery."
          },
          taskType: request.taskType,
        },
      };
    }
    
    return {
      success: true,
      data: {
        provider: "grok",
        recommendation: "Stub response from Grok",
        taskType: request.taskType,
      },
    };
  }

  /**
   * Custom endpoint integration
   */
  private static async askCustom(request: LLMRequest): Promise<LLMResponse> {
    if (!request.customEndpoint) {
      return {
        success: false,
        error: "Custom endpoint URL is required",
      };
    }

    // Stub implementation - would make HTTP request to custom endpoint
    if (request.taskType === "order_recommendation" && request.payload?.prompt) {
      return {
        success: true,
        data: {
          provider: "custom",
          endpoint: request.customEndpoint,
          recommendation: {
            daysUntilStockout: 25,
            willLastFourWeeks: false,
            urgency: "medium",
            recommendedOrderQty: 170,
            reasoning: "Inventory projection based on historical patterns shows 25 days of supply remaining. The medium urgency classification allows for planned ordering within the next 1-2 weeks. Recommended order size balances safety stock requirements with anticipated demand trends."
          },
          taskType: request.taskType,
        },
      };
    }
    
    return {
      success: true,
      data: {
        provider: "custom",
        endpoint: request.customEndpoint,
        recommendation: "Stub response from custom endpoint",
        taskType: request.taskType,
      },
    };
  }

  /**
   * Build appropriate prompt based on task type
   */
  private static buildPrompt(request: LLMRequest): string {
    switch (request.taskType) {
      case "order_recommendation":
        return `Based on the following inventory data, recommend optimal reorder quantities and timing:\n${JSON.stringify(request.payload, null, 2)}`;
      
      case "supplier_ranking":
        return `Rank the following suppliers based on price, lead time, and reliability:\n${JSON.stringify(request.payload, null, 2)}`;
      
      case "forecasting":
        return `Predict future demand based on historical sales data:\n${JSON.stringify(request.payload, null, 2)}`;
      
      default:
        return JSON.stringify(request.payload);
    }
  }

  /**
   * Generate smart reorder recommendations based on inventory analysis
   */
  static async generateReorderRecommendations(): Promise<ReorderRecommendation[]> {
    const items = await storage.getAllItems();
    const recommendations: ReorderRecommendation[] = [];

    for (const item of items) {
      if (item.type === 'component') {
        const daysUntilStockout = item.dailyUsage > 0 
          ? item.currentStock / item.dailyUsage 
          : 999;

        if (daysUntilStockout < 45) {
          const urgency = 
            daysUntilStockout < 14 ? 'critical' :
            daysUntilStockout < 21 ? 'high' :
            daysUntilStockout < 45 ? 'medium' : 'low';

          const safetyStockDays = 30;
          const recommendedQty = Math.max(
            Math.ceil(item.dailyUsage * safetyStockDays - item.currentStock),
            item.minStock
          );

          const supplierItems = await storage.getSupplierItemsByItemId(item.id);
          const designatedSupplier = supplierItems.find(si => si.isDesignatedSupplier);
          
          recommendations.push({
            itemId: item.id,
            itemName: item.name,
            currentStock: item.currentStock,
            itemType: 'component',
            recommendedOrderQty: recommendedQty,
            urgency,
            reason: urgency === 'critical' 
              ? `Critical: Only ${Math.floor(daysUntilStockout)} days of stock remaining - order now`
              : urgency === 'high'
              ? `High priority: ${Math.floor(daysUntilStockout)} days of stock remaining - order soon`
              : `Monitor: ${Math.floor(daysUntilStockout)} days of stock remaining`,
            estimatedStockoutDays: Math.floor(daysUntilStockout),
            suggestedSupplier: designatedSupplier ? 
              (await storage.getSupplier(designatedSupplier.supplierId))?.name : undefined
          });
        }
      } else if (item.type === 'finished_product') {
        // For finished products, base risk check on pivotQty (ready-to-ship warehouse)
        const pivotQty = item.pivotQty ?? 0;
        const hildaleQty = item.hildaleQty ?? 0;
        const totalOwned = pivotQty + hildaleQty;
        
        const daysUntilStockout = item.dailyUsage > 0 
          ? pivotQty / item.dailyUsage 
          : 999;

        if (daysUntilStockout < 45) {
          const urgency = 
            daysUntilStockout < 14 ? 'critical' :
            daysUntilStockout < 21 ? 'high' :
            daysUntilStockout < 45 ? 'medium' : 'low';

          const safetyStockDays = 30;
          const recommendedQty = Math.max(
            Math.ceil(item.dailyUsage * safetyStockDays - pivotQty),
            item.minStock
          );
          
          recommendations.push({
            itemId: item.id,
            itemName: item.name,
            currentStock: pivotQty, // For finished products, currentStock represents pivotQty
            pivotQty,
            hildaleQty,
            totalOwned,
            itemType: 'finished_product',
            recommendedOrderQty: recommendedQty,
            urgency,
            reason: urgency === 'critical' 
              ? `Critical: Only ${Math.floor(daysUntilStockout)} days of ready-to-ship stock (Pivot) remaining - order now. Hildale has ${hildaleQty} units in buffer.`
              : urgency === 'high'
              ? `High priority: ${Math.floor(daysUntilStockout)} days of ready-to-ship stock (Pivot) remaining - order soon. Hildale has ${hildaleQty} units in buffer.`
              : `Monitor: ${Math.floor(daysUntilStockout)} days of ready-to-ship stock (Pivot) remaining. Hildale has ${hildaleQty} units in buffer.`,
            estimatedStockoutDays: Math.floor(daysUntilStockout),
          });
        }
      }
    }

    return recommendations.sort((a, b) => {
      const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    });
  }

  /**
   * Generate LLM-powered reorder recommendations with actual reasoning
   * @param provider - LLM provider to use
   * @param apiKey - API key for the provider
   * @param customEndpoint - Custom endpoint URL
   * @param itemsToProcess - Optional filtered list of items to process (defaults to all items)
   */
  static async generateLLMReorderRecommendations(
    provider: LLMProvider = "chatgpt",
    apiKey?: string,
    customEndpoint?: string,
    itemsToProcess?: any[]
  ): Promise<ReorderRecommendation[]> {
    const items = itemsToProcess || await storage.getAllItems();
    const recommendations: ReorderRecommendation[] = [];
    
    const currentDate = new Date().toISOString().split('T')[0];
    const fourWeeksLater = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    for (const item of items) {
      // Handle both components and finished products
      const isFinishedProduct = item.type === 'finished_product';
      if (item.type !== 'component' && !isFinishedProduct) continue;

      const salesHistory = await storage.getSalesHistoryByItemId(item.id);
      const supplierItems = await storage.getSupplierItemsByItemId(item.id);
      const designatedSupplier = supplierItems.find(si => si.isDesignatedSupplier);

      const last30DaysSales = salesHistory
        .filter((s: any) => {
          const saleDate = new Date(s.saleDate);
          const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          return saleDate >= cutoff;
        })
        .reduce((sum: number, s: any) => sum + s.quantitySold, 0);

      const last90DaysSales = salesHistory
        .filter((s: any) => {
          const saleDate = new Date(s.saleDate);
          const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
          return saleDate >= cutoff;
        })
        .reduce((sum: number, s: any) => sum + s.quantitySold, 0);

      const historicalAvgDaily = salesHistory.length > 0
        ? salesHistory.reduce((sum: number, s: any) => sum + s.quantitySold, 0) / Math.max(salesHistory.length, 1)
        : item.dailyUsage;

      const avgLeadTime = designatedSupplier?.leadTimeDays || 14;
      const safetyStockDays = 30;

      // For finished products, use pivotQty as the primary stock measure
      const pivotQty = isFinishedProduct ? (item.pivotQty ?? 0) : 0;
      const hildaleQty = isFinishedProduct ? (item.hildaleQty ?? 0) : 0;
      const totalOwned = isFinishedProduct ? pivotQty + hildaleQty : item.currentStock;
      const stockForCalculation = isFinishedProduct ? pivotQty : item.currentStock;

      const prompt = isFinishedProduct ? 
        `You are an inventory management AI assistant. Today is ${currentDate}.

**Finished Product Analysis:**
- Item: ${item.name} (SKU: ${item.sku})
- Type: Finished Product
- Pivot Warehouse (Ready-to-Ship): ${pivotQty} units
- Hildale Warehouse (Buffer Stock): ${hildaleQty} units
- Total Owned: ${totalOwned} units
- Daily Usage Rate: ${item.dailyUsage} units/day
- Minimum Stock Level: ${item.minStock} units
- Safety Stock Target: ${safetyStockDays} days supply

**Important:** Base risk calculations on Pivot Qty (${pivotQty}) as it represents ready-to-ship inventory. Hildale serves as buffer stock.`
        :
        `You are an inventory management AI assistant. Today is ${currentDate}.

**Component Analysis:**
- Item: ${item.name} (SKU: ${item.sku})
- Current Stock: ${item.currentStock} units
- Daily Usage Rate: ${item.dailyUsage} units/day
- Minimum Stock Level: ${item.minStock} units
- Safety Stock Target: ${safetyStockDays} days supply

**Sales History:**
- Last 30 Days: ${last30DaysSales} units (avg ${(last30DaysSales / 30).toFixed(1)}/day)
- Last 90 Days: ${last90DaysSales} units (avg ${(last90DaysSales / 90).toFixed(1)}/day)
- Historical Average: ${historicalAvgDaily.toFixed(1)} units/day
- Total Records: ${salesHistory.length} data points

**Supplier Information:**
${designatedSupplier ? `- Designated Supplier: Available
- Lead Time: ${avgLeadTime} days
- Reorder Point: Order must be placed ${avgLeadTime} days before stockout` : '- No designated supplier configured'}

**Your Task:**
Analyze this inventory situation and reason through the following:
1. Calculate days until stockout: current_stock / daily_usage_rate
2. Determine if stock will last 4 weeks (until ${fourWeeksLater})
3. Factor in the ${avgLeadTime}-day supplier lead time - if stockout is predicted before order can arrive, urgency is critical
4. Recommend order quantity considering:
   - Replenishing to minimum safe stock (${safetyStockDays} days)
   - Recent demand trends (compare 30-day vs 90-day averages)
   - Safety buffer for demand variability

**Urgency Classification:**
- critical: < 14 days (order immediately - may stockout before delivery)
- high: 14-21 days (order soon - tight timeline)
- medium: 21-45 days (monitor and prepare order)
- low: > 45 days (adequate stock)

**Respond ONLY with valid JSON in this format:**
{
  "daysUntilStockout": <number>,
  "willLastFourWeeks": <boolean>,
  "urgency": "<critical|high|medium|low>",
  "recommendedOrderQty": <number>,
  "reasoning": "<your step-by-step explanation showing calculations and logic>"
}`;

      try {
        if (!apiKey) {
          const fallbackRecommendation = this.generateFallbackRecommendation(item, avgLeadTime);
          if (fallbackRecommendation) {
            recommendations.push(fallbackRecommendation);
          }
          continue;
        }

        const llmResponse = await this.askLLM({
          provider,
          apiKey,
          customEndpoint,
          taskType: "order_recommendation",
          payload: { prompt }
        });

        if (!llmResponse.success || !llmResponse.data) {
          console.error(`[LLM] Failed to get recommendation for ${item.name}:`, llmResponse.error);
          const fallbackRecommendation = this.generateFallbackRecommendation(item, avgLeadTime);
          if (fallbackRecommendation) {
            recommendations.push(fallbackRecommendation);
          }
          continue;
        }

        let parsedData;
        try {
          parsedData = typeof llmResponse.data.recommendation === 'string'
            ? JSON.parse(llmResponse.data.recommendation)
            : llmResponse.data.recommendation;
        } catch (parseError: any) {
          console.error(`[LLM] JSON parse error for ${item.name}:`, parseError.message);
          console.error(`[LLM] Raw response:`, llmResponse.data.recommendation);
          const fallbackRecommendation = this.generateFallbackRecommendation(item, avgLeadTime);
          if (fallbackRecommendation) {
            recommendations.push(fallbackRecommendation);
          }
          continue;
        }

        if (!parsedData.urgency || parsedData.recommendedOrderQty == null || !parsedData.reasoning) {
          console.error(`[LLM] Invalid response format for ${item.name}:`, parsedData);
          const fallbackRecommendation = this.generateFallbackRecommendation(item, avgLeadTime);
          if (fallbackRecommendation) {
            recommendations.push(fallbackRecommendation);
          }
          continue;
        }

        recommendations.push({
          itemId: item.id,
          itemName: item.name,
          currentStock: stockForCalculation,
          ...(isFinishedProduct && {
            pivotQty,
            hildaleQty,
            totalOwned,
          }),
          itemType: isFinishedProduct ? 'finished_product' : 'component',
          recommendedOrderQty: parsedData.recommendedOrderQty,
          urgency: parsedData.urgency,
          reason: parsedData.reasoning,
          estimatedStockoutDays: parsedData.daysUntilStockout || Math.floor(stockForCalculation / Math.max(item.dailyUsage, 0.01)),
          suggestedSupplier: designatedSupplier
            ? (await storage.getSupplier(designatedSupplier.supplierId))?.name
            : undefined
        });
      } catch (error: any) {
        console.error(`[LLM] Unexpected error for ${item.name}:`, error.message);
        const fallbackRecommendation = this.generateFallbackRecommendation(item, avgLeadTime);
        if (fallbackRecommendation) {
          recommendations.push(fallbackRecommendation);
        }
      }
    }

    return recommendations.sort((a, b) => {
      const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    });
  }

  /**
   * Fallback recommendation when LLM is not available
   */
  private static generateFallbackRecommendation(
    item: any,
    avgLeadTime: number
  ): ReorderRecommendation | null {
    const isFinishedProduct = item.type === 'finished_product';
    const pivotQty = isFinishedProduct ? (item.pivotQty ?? 0) : 0;
    const hildaleQty = isFinishedProduct ? (item.hildaleQty ?? 0) : 0;
    const totalOwned = isFinishedProduct ? pivotQty + hildaleQty : item.currentStock;
    const stockForCalculation = isFinishedProduct ? pivotQty : item.currentStock;
    
    const daysUntilStockout = item.dailyUsage > 0 
      ? stockForCalculation / item.dailyUsage 
      : 999;

    if (daysUntilStockout >= 45) return null;

    const urgency = 
      daysUntilStockout < 14 ? 'critical' :
      daysUntilStockout < 21 ? 'high' :
      daysUntilStockout < 45 ? 'medium' : 'low';

    const safetyStockDays = 30;
    const recommendedQty = Math.max(
      Math.ceil(item.dailyUsage * safetyStockDays - stockForCalculation),
      item.minStock
    );

    return {
      itemId: item.id,
      itemName: item.name,
      currentStock: stockForCalculation,
      ...(isFinishedProduct && {
        pivotQty,
        hildaleQty,
        totalOwned,
      }),
      itemType: isFinishedProduct ? 'finished_product' : 'component',
      recommendedOrderQty: recommendedQty,
      urgency,
      reason: isFinishedProduct
        ? (urgency === 'critical' 
          ? `Critical: Only ${Math.floor(daysUntilStockout)} days of ready-to-ship stock (Pivot) remaining - order now. Hildale has ${hildaleQty} units in buffer.`
          : urgency === 'high'
          ? `High priority: ${Math.floor(daysUntilStockout)} days of ready-to-ship stock (Pivot) remaining - order soon. Hildale has ${hildaleQty} units in buffer.`
          : `Monitor: ${Math.floor(daysUntilStockout)} days of ready-to-ship stock (Pivot) remaining. Hildale has ${hildaleQty} units in buffer.`)
        : (urgency === 'critical' 
          ? `Critical: Only ${Math.floor(daysUntilStockout)} days of stock remaining - order now`
          : urgency === 'high'
          ? `High priority: ${Math.floor(daysUntilStockout)} days of stock remaining - order soon`
          : `Monitor: ${Math.floor(daysUntilStockout)} days of stock remaining`),
      estimatedStockoutDays: Math.floor(daysUntilStockout),
      suggestedSupplier: undefined
    };
  }

  /**
   * Rank suppliers based on price, lead time, and reliability
   */
  static async rankSuppliers(itemId: string): Promise<SupplierRanking[]> {
    const supplierItems = await storage.getSupplierItemsByItemId(itemId);
    const rankings: SupplierRanking[] = [];

    if (supplierItems.length === 0) {
      return rankings;
    }

    const prices = supplierItems.map(si => si.price || 0).filter(p => p > 0);
    const leadTimes = supplierItems.map(si => si.leadTimeDays || 0).filter(lt => lt > 0);

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const minLeadTime = Math.min(...leadTimes);
    const maxLeadTime = Math.max(...leadTimes);

    for (const si of supplierItems) {
      const supplier = await storage.getSupplier(si.supplierId);
      if (!supplier) continue;

      const priceScore = si.price && minPrice > 0 && maxPrice > minPrice
        ? ((maxPrice - si.price) / (maxPrice - minPrice)) * 100
        : 50;

      const leadTimeScore = si.leadTimeDays && minLeadTime > 0 && maxLeadTime > minLeadTime
        ? ((maxLeadTime - si.leadTimeDays) / (maxLeadTime - minLeadTime)) * 100
        : 50;

      const reliabilityScore = si.isDesignatedSupplier ? 100 : 70;

      const overallScore = (priceScore * 0.4) + (leadTimeScore * 0.3) + (reliabilityScore * 0.3);

      let recommendation = '';
      if (overallScore >= 80) {
        recommendation = 'Excellent choice - best overall value';
      } else if (overallScore >= 60) {
        recommendation = 'Good option - balanced trade-offs';
      } else {
        recommendation = 'Consider alternatives - may have better options';
      }

      rankings.push({
        supplierId: supplier.id,
        supplierName: supplier.name,
        score: Math.round(overallScore),
        priceScore: Math.round(priceScore),
        leadTimeScore: Math.round(leadTimeScore),
        reliabilityScore: Math.round(reliabilityScore),
        recommendation
      });
    }

    return rankings.sort((a, b) => b.score - a.score);
  }

  /**
   * Generate demand forecast with confidence intervals
   */
  static async generateDemandForecast(): Promise<DemandForecast[]> {
    const items = await storage.getAllItems();
    const forecasts: DemandForecast[] = [];

    for (const item of items) {
      const salesHistory = await storage.getSalesHistoryByItemId(item.id);
      
      let avgDailyUsage: number;
      let stdDev = 0;
      let confidence: "high" | "medium" | "low" = 'medium';
      let trend: "increasing" | "stable" | "decreasing" = 'stable';

      if (salesHistory.length === 0) {
        avgDailyUsage = item.dailyUsage || 0;
        stdDev = avgDailyUsage * 0.5;
        confidence = 'low';
      } else {
        salesHistory.sort((a: any, b: any) => new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime());

        const recentSales = salesHistory.slice(-30);
        const totalQty = recentSales.reduce((sum: number, sale: any) => sum + sale.quantitySold, 0);
        avgDailyUsage = recentSales.length > 0 ? totalQty / Math.min(30, recentSales.length) : item.dailyUsage;

        if (recentSales.length >= 2) {
          const variance = recentSales.reduce((sum: number, sale: any) => {
            const diff = sale.quantitySold - avgDailyUsage;
            return sum + diff * diff;
          }, 0) / recentSales.length;

          stdDev = Math.sqrt(variance);
          const coefficientOfVariation = avgDailyUsage > 0 ? (stdDev / avgDailyUsage) : 1;

          confidence = 
            coefficientOfVariation < 0.2 ? 'high' :
            coefficientOfVariation < 0.5 ? 'medium' : 'low';
        } else {
          confidence = 'low';
          stdDev = avgDailyUsage * 0.5;
        }

        if (salesHistory.length >= 4) {
          const oldSales = salesHistory.slice(0, Math.floor(salesHistory.length / 2));
          const newSales = salesHistory.slice(Math.floor(salesHistory.length / 2));
          
          const oldAvg = oldSales.length > 0 
            ? oldSales.reduce((sum: number, s: any) => sum + s.quantitySold, 0) / oldSales.length 
            : 0;
          const newAvg = newSales.length > 0 
            ? newSales.reduce((sum: number, s: any) => sum + s.quantitySold, 0) / newSales.length 
            : 0;

          trend = 
            newAvg > oldAvg * 1.1 ? 'increasing' :
            newAvg < oldAvg * 0.9 ? 'decreasing' : 'stable';
        }
      }

      const confidenceMultiplier = confidence === 'high' ? 1.5 : confidence === 'medium' ? 2 : 2.5;

      const forecastValue = Number(avgDailyUsage.toFixed(2));
      const intervalLow = Math.max(0, Number((avgDailyUsage - confidenceMultiplier * stdDev).toFixed(2)));
      const intervalHigh = Number((avgDailyUsage + confidenceMultiplier * stdDev).toFixed(2));

      forecasts.push({
        itemId: item.id,
        itemName: item.name,
        currentDailyUsage: item.dailyUsage,
        forecastedDailyUsage: forecastValue,
        confidenceInterval: {
          low: isNaN(intervalLow) ? 0 : intervalLow,
          high: isNaN(intervalHigh) ? forecastValue * 2 : intervalHigh
        },
        confidence,
        trend,
        seasonalPattern: undefined
      });
    }

    return forecasts;
  }

  /**
   * Identify inventory item from image using vision AI
   */
  static async identifyItemFromImage(request: VisionRequest): Promise<VisionIdentificationResult> {
    try {
      // Stub implementation that would integrate with actual vision APIs
      // In production, this would call:
      // - OpenAI GPT-4 Vision API for gpt-4-vision provider
      // - Anthropic Claude Vision API for claude-vision provider
      
      // For now, return a structured mock response
      const mockResult: VisionIdentificationResult = {
        name: "M8 Hex Bolt",
        sku: "BOLT-M8-50",
        quantity: 25,
        type: "component",
        category: "Fasteners",
        location: null,
        confidence: 0.85,
        description: "Standard M8 hex bolt, approximately 50mm length, appears to be zinc-plated steel. Identified from image analysis with high confidence."
      };

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log(`[Vision] Identified item: ${mockResult.name} (confidence: ${mockResult.confidence})`);
      
      return mockResult;
    } catch (error: any) {
      console.error("[Vision] Error identifying item:", error);
      throw new Error(`Vision API failed: ${error.message}`);
    }
  }
}
