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
  currentStock: number;
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

        if (daysUntilStockout < 30) {
          const urgency = 
            daysUntilStockout < 3 ? 'critical' :
            daysUntilStockout < 7 ? 'high' :
            daysUntilStockout < 14 ? 'medium' : 'low';

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
            recommendedOrderQty: recommendedQty,
            urgency,
            reason: urgency === 'critical' 
              ? `Critical: Only ${Math.floor(daysUntilStockout)} days of stock remaining`
              : `Stock will run out in ${Math.floor(daysUntilStockout)} days at current usage rate`,
            estimatedStockoutDays: Math.floor(daysUntilStockout),
            suggestedSupplier: designatedSupplier ? 
              (await storage.getSupplier(designatedSupplier.supplierId))?.name : undefined
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
}
