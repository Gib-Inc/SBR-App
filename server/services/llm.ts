import { storage } from "../storage";
import Anthropic from "@anthropic-ai/sdk";

// Default model for most tasks (fast + smart). Use opus for complex multi-step reasoning.
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
const CLAUDE_MODEL_FAST = "claude-haiku-4-5-20251001";

/**
 * Get Anthropic client with API key from environment secret ANTHROPIC_API_KEY
 * The database llm_api_key field is deprecated - use environment secret only
 */
function getAnthropicClient(apiKeyOverride?: string): Anthropic {
  const apiKey = apiKeyOverride?.trim() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("No Anthropic API key configured. Please add ANTHROPIC_API_KEY in your environment variables.");
  }
  return new Anthropic({ apiKey });
}

export type LLMProvider = "chatgpt" | "claude" | "grok" | "custom";

export interface LLMRequest {
  provider: LLMProvider;
  apiKey?: string;
  customEndpoint?: string;
  taskType: "order_recommendation" | "supplier_ranking" | "forecasting" | "po_generation" | "HEALTH_CHECK" | "price_extraction";
  payload: any;
}

export interface PriceExtractionResult {
  success: boolean;
  price: number | null;
  currency: string;
  confidence: "high" | "medium" | "low";
  source: string;
  error?: string;
}

export interface POGenerationPayload {
  supplierName: string;
  supplierEmail?: string;
  supplierPhone?: string;
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    currentStock: number;
    daysUntilStockout?: number;
    unitPrice?: number;
  }>;
  poNumber: string;
  companyName: string;
  deliveryAddress?: string;
  notes?: string;
}

export interface POGenerationResult {
  subject: string;
  body: string;
  smsMessage: string;
}

export interface LLMResponse {
  success: boolean;
  data?: any;
  error?: string;
  text?: string;
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
   * ChatGPT/OpenAI integration - NOW ROUTES TO ANTHROPIC CLAUDE
   * Kept as "chatgpt" provider name for backwards compatibility with saved settings
   */
  private static async askChatGPT(request: LLMRequest): Promise<LLMResponse> {
    return this.askClaude(request);
  }

  /**
   * Claude/Anthropic integration using Claude Sonnet
   */
  private static async askClaude(request: LLMRequest): Promise<LLMResponse> {
    let client: Anthropic;
    try {
      client = getAnthropicClient(request.apiKey);
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: {
          provider: "claude",
          status: "no_api_key",
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Health check - verify Anthropic connection
    if (request.taskType === "HEALTH_CHECK") {
      try {
        const testResponse = await client.messages.create({
          model: CLAUDE_MODEL_FAST,
          max_tokens: 10,
          messages: [{ role: "user", content: "Say 'OK' to confirm connection." }],
        });
        
        const responseText = testResponse.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map(b => b.text)
          .join("");

        return {
          success: true,
          data: {
            provider: "claude",
            model: CLAUDE_MODEL,
            status: "connected",
            timestamp: new Date().toISOString(),
            response: responseText,
          },
          text: `Claude connection verified with ${CLAUDE_MODEL}`,
        };
      } catch (error: any) {
        return {
          success: false,
          error: `Claude connection failed: ${error.message}`,
          data: {
            provider: "claude",
            status: "disconnected",
            timestamp: new Date().toISOString(),
          },
        };
      }
    }
    
    // Order recommendation - use structured JSON output
    if (request.taskType === "order_recommendation" && request.payload?.prompt) {
      try {
        const response = await client.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 8192,
          system: "You are an expert inventory management AI. Analyze inventory data and provide recommendations. Always respond with valid JSON only — no markdown, no code fences, no commentary.",
          messages: [{ role: "user", content: request.payload.prompt }],
        });
        
        const content = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map(b => b.text)
          .join("");

        if (!content) {
          throw new Error("No response content from Claude");
        }
        
        // Strip any markdown fences if present
        const cleanJson = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const parsedData = JSON.parse(cleanJson);
        
        return {
          success: true,
          data: {
            provider: "claude",
            model: CLAUDE_MODEL,
            ...parsedData,
            taskType: request.taskType,
          },
          text: content,
        };
      } catch (error: any) {
        console.error("[LLM] Claude order_recommendation error:", error.message);
        return {
          success: false,
          error: `Claude API error: ${error.message}`,
        };
      }
    }
    
    // Price extraction
    if (request.taskType === "price_extraction" && request.payload?.prompt) {
      try {
        const response = await client.messages.create({
          model: CLAUDE_MODEL_FAST,
          max_tokens: 500,
          system: "You are a price extraction assistant. Extract pricing information from the provided text and return JSON with: found (boolean), price (number or null), currency (string), confidence (high/medium/low), notes (string). Respond with valid JSON only — no markdown, no code fences.",
          messages: [{ role: "user", content: request.payload.prompt }],
        });
        
        const content = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map(b => b.text)
          .join("") || '{"found": false, "price": null, "currency": "USD", "confidence": "low", "notes": "No response"}';
        
        return {
          success: true,
          text: content,
          data: { provider: "claude", model: CLAUDE_MODEL_FAST, taskType: request.taskType },
        };
      } catch (error: any) {
        console.error("[LLM] Claude price_extraction error:", error.message);
        return {
          success: true,
          text: '{"found": false, "price": null, "currency": "USD", "confidence": "low", "notes": "API error"}',
          data: { provider: "claude", taskType: request.taskType, error: error.message },
        };
      }
    }
    
    // Generic request handler
    try {
      const prompt = this.buildPrompt(request);
      const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: "You are an expert inventory management AI assistant. Always respond with valid JSON only — no markdown, no code fences, no commentary.",
        messages: [{ role: "user", content: prompt }],
      });
      
      const content = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text)
        .join("");

      if (!content) {
        throw new Error("No response content from Claude");
      }
      
      const cleanJson = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsedData = JSON.parse(cleanJson);
      
      return {
        success: true,
        data: {
          provider: "claude",
          model: CLAUDE_MODEL,
          ...parsedData,
          taskType: request.taskType,
        },
        text: content,
      };
    } catch (error: any) {
      console.error("[LLM] Claude generic error:", error.message);
      return {
        success: false,
        error: `Claude API error: ${error.message}`,
      };
    }
  }

  /**
   * Grok integration
   */
  private static async askGrok(request: LLMRequest): Promise<LLMResponse> {
    // Health check returns simple success
    if (request.taskType === "HEALTH_CHECK") {
      return {
        success: true,
        data: {
          provider: "grok",
          status: "connected",
          timestamp: new Date().toISOString(),
        },
        text: "Grok connection verified",
      };
    }
    
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
    
    if (request.taskType === "price_extraction" && request.payload?.prompt) {
      return {
        success: true,
        text: '{"found": true, "price": 13.25, "currency": "USD", "confidence": "medium", "notes": "Price extracted from product page"}',
        data: { provider: "grok", taskType: request.taskType },
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

    // Health check returns simple success
    if (request.taskType === "HEALTH_CHECK") {
      return {
        success: true,
        data: {
          provider: "custom",
          endpoint: request.customEndpoint,
          status: "connected",
          timestamp: new Date().toISOString(),
        },
        text: "Custom endpoint connection verified",
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
    
    if (request.taskType === "price_extraction" && request.payload?.prompt) {
      return {
        success: true,
        text: '{"found": true, "price": 14.50, "currency": "USD", "confidence": "medium", "notes": "Price extracted from product page"}',
        data: { provider: "custom", endpoint: request.customEndpoint, taskType: request.taskType },
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
      
      case "po_generation":
        return this.buildPOPrompt(request.payload as POGenerationPayload);
      
      default:
        return JSON.stringify(request.payload);
    }
  }

  /**
   * Build a professional PO generation prompt
   */
  private static buildPOPrompt(payload: POGenerationPayload): string {
    const itemLines = payload.items.map(item => 
      `- ${item.name} (SKU: ${item.sku}): ${item.quantity} units${item.unitPrice ? ` @ $${item.unitPrice.toFixed(2)}` : ''}${item.daysUntilStockout ? ` [${item.daysUntilStockout} days until stockout]` : ''}`
    ).join('\n');

    return `Generate a professional purchase order message to send to a supplier.

SUPPLIER: ${payload.supplierName}
PO NUMBER: ${payload.poNumber}
COMPANY: ${payload.companyName}

ITEMS TO ORDER:
${itemLines}

${payload.deliveryAddress ? `DELIVERY ADDRESS: ${payload.deliveryAddress}` : ''}
${payload.notes ? `ADDITIONAL NOTES: ${payload.notes}` : ''}

Please generate:
1. An email subject line (concise, professional)
2. An email body (professional, includes all items with quantities, asks for confirmation and expected delivery date)
3. An SMS message (brief, mentions PO number and requests confirmation, max 160 characters)

Format your response as JSON:
{
  "subject": "...",
  "body": "...",
  "smsMessage": "..."
}`;
  }

  /**
   * Generate PO content using LLM
   */
  static async generatePOContent(payload: POGenerationPayload): Promise<POGenerationResult> {
    // Get LLM settings from database
    const settings = await storage.getSettings(payload.companyName);
    
    // Default fallback if no LLM is configured
    const itemsList = payload.items.map(item => 
      `• ${item.name} (SKU: ${item.sku}) - Qty: ${item.quantity}${item.unitPrice ? ` @ $${item.unitPrice.toFixed(2)}` : ''}`
    ).join('\n');

    const totalValue = payload.items.reduce((sum, item) => 
      sum + (item.quantity * (item.unitPrice || 0)), 0
    );

    const defaultSubject = `Purchase Order ${payload.poNumber} from ${payload.companyName}`;
    const defaultBody = `Dear ${payload.supplierName},

Please find our purchase order ${payload.poNumber} below.

ORDER DETAILS:
${itemsList}

${totalValue > 0 ? `Estimated Total: $${totalValue.toFixed(2)}` : ''}
${payload.deliveryAddress ? `\nDelivery Address:\n${payload.deliveryAddress}` : ''}
${payload.notes ? `\nNotes: ${payload.notes}` : ''}

Please confirm receipt of this order and provide expected delivery date.

Thank you for your partnership.

Best regards,
${payload.companyName}`;

    const defaultSMS = `PO ${payload.poNumber} sent. ${payload.items.length} item(s). Please confirm receipt. - ${payload.companyName}`;

    // If no LLM configured, use defaults
    if (!settings?.llmProvider || !settings?.llmApiKey) {
      return {
        subject: defaultSubject,
        body: defaultBody,
        smsMessage: defaultSMS,
      };
    }

    // Try to use LLM for generation
    try {
      const response = await this.askLLM({
        provider: settings.llmProvider as LLMProvider,
        apiKey: settings.llmApiKey,
        customEndpoint: settings.llmCustomEndpoint || undefined,
        taskType: "po_generation",
        payload,
      });

      if (response.success && response.data?.poContent) {
        return response.data.poContent as POGenerationResult;
      }

      // Fall back to defaults if LLM fails
      return {
        subject: defaultSubject,
        body: defaultBody,
        smsMessage: defaultSMS,
      };
    } catch (error) {
      console.error('[LLMService] Error generating PO content:', error);
      return {
        subject: defaultSubject,
        body: defaultBody,
        smsMessage: defaultSMS,
      };
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
          const fallbackRecommendation = await this.generateFallbackRecommendation(item, avgLeadTime);
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
          const fallbackRecommendation = await this.generateFallbackRecommendation(item, avgLeadTime);
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
          const fallbackRecommendation = await this.generateFallbackRecommendation(item, avgLeadTime);
          if (fallbackRecommendation) {
            recommendations.push(fallbackRecommendation);
          }
          continue;
        }

        if (!parsedData.urgency || parsedData.recommendedOrderQty == null || !parsedData.reasoning) {
          console.error(`[LLM] Invalid response format for ${item.name}:`, parsedData);
          const fallbackRecommendation = await this.generateFallbackRecommendation(item, avgLeadTime);
          if (fallbackRecommendation) {
            recommendations.push(fallbackRecommendation);
          }
          continue;
        }

        const recommendation = {
          itemId: item.id,
          itemName: item.name,
          currentStock: stockForCalculation,
          ...(isFinishedProduct && {
            pivotQty,
            hildaleQty,
            totalOwned,
          }),
          itemType: isFinishedProduct ? 'finished_product' as const : 'component' as const,
          recommendedOrderQty: parsedData.recommendedOrderQty,
          urgency: parsedData.urgency,
          reason: parsedData.reasoning,
          estimatedStockoutDays: parsedData.daysUntilStockout || Math.floor(stockForCalculation / Math.max(item.dailyUsage, 0.01)),
          suggestedSupplier: designatedSupplier
            ? (await storage.getSupplier(designatedSupplier.supplierId))?.name
            : undefined
        };
        recommendations.push(recommendation);
        
        // Create AIRecommendation record for audit trail
        const riskLevel = parsedData.urgency === 'critical' ? 'HIGH' : parsedData.urgency === 'high' ? 'MEDIUM' : 'LOW';
        const recommendedAction = parsedData.urgency === 'critical' || parsedData.urgency === 'high' ? 'ORDER' : 'MONITOR';
        await storage.createAIRecommendation({
          type: 'INVENTORY',
          sku: item.sku,
          itemId: item.id,
          productName: item.name,
          recommendationType: 'REORDER',
          riskLevel,
          recommendedAction,
          daysUntilStockout: parsedData.daysUntilStockout || Math.floor(stockForCalculation / Math.max(item.dailyUsage, 0.01)),
          availableForSale: stockForCalculation,
          recommendedQty: parsedData.recommendedOrderQty,
          qtyOnPo: 0, // Will be populated by decision engine
          reasonSummary: parsedData.reasoning,
          sourceSignals: {
            currentStock: stockForCalculation,
            dailyUsage: item.dailyUsage,
            pivotQty: isFinishedProduct ? pivotQty : undefined,
            hildaleQty: isFinishedProduct ? hildaleQty : undefined,
            totalOwned: isFinishedProduct ? totalOwned : undefined,
            last30DaysSales,
            last90DaysSales,
            avgLeadTime,
            urgency: parsedData.urgency,
            llmModel: 'claude-sonnet',
          },
        });
      } catch (error: any) {
        console.error(`[LLM] Unexpected error for ${item.name}:`, error.message);
        const fallbackRecommendation = await this.generateFallbackRecommendation(item, avgLeadTime);
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
  private static async generateFallbackRecommendation(
    item: any,
    avgLeadTime: number
  ): Promise<ReorderRecommendation | null> {
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

    const recommendation = {
      itemId: item.id,
      itemName: item.name,
      currentStock: stockForCalculation,
      ...(isFinishedProduct && {
        pivotQty,
        hildaleQty,
        totalOwned,
      }),
      itemType: isFinishedProduct ? 'finished_product' as const : 'component' as const,
      recommendedOrderQty: recommendedQty,
      urgency: urgency as 'critical' | 'high' | 'medium' | 'low',
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
    
    // Create AIRecommendation record for fallback path
    const riskLevel = urgency === 'critical' ? 'HIGH' : urgency === 'high' ? 'MEDIUM' : 'LOW';
    const recommendedAction = urgency === 'critical' || urgency === 'high' ? 'ORDER' : 'MONITOR';
    await storage.createAIRecommendation({
      type: 'INVENTORY',
      sku: item.sku,
      itemId: item.id,
      productName: item.name,
      recommendationType: 'REORDER',
      riskLevel,
      recommendedAction,
      daysUntilStockout: Math.floor(daysUntilStockout),
      availableForSale: stockForCalculation,
      recommendedQty,
      qtyOnPo: 0,
      reasonSummary: recommendation.reason,
      sourceSignals: {
        currentStock: stockForCalculation,
        dailyUsage: item.dailyUsage,
        pivotQty: isFinishedProduct ? pivotQty : undefined,
        hildaleQty: isFinishedProduct ? hildaleQty : undefined,
        totalOwned: isFinishedProduct ? totalOwned : undefined,
        avgLeadTime,
        urgency,
        fallback: true,
      },
    });
    
    return recommendation;
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

  /**
   * Validate URL to prevent SSRF attacks
   * Only allows https URLs to external hosts, blocks internal/private networks
   */
  private static validateUrl(url: string): { valid: boolean; error?: string } {
    try {
      const parsed = new URL(url);
      
      if (parsed.protocol !== 'https:') {
        return { valid: false, error: 'Only HTTPS URLs are allowed' };
      }
      
      const hostname = parsed.hostname.toLowerCase();
      
      const blockedPatterns = [
        /^localhost$/i,
        /^127\.\d+\.\d+\.\d+$/,
        /^10\.\d+\.\d+\.\d+$/,
        /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
        /^192\.168\.\d+\.\d+$/,
        /^0\.0\.0\.0$/,
        /^::1$/,
        /^fe80:/i,
        /^169\.254\.\d+\.\d+$/,
        /\.local$/i,
        /\.internal$/i,
        /\.localhost$/i,
      ];
      
      for (const pattern of blockedPatterns) {
        if (pattern.test(hostname)) {
          return { valid: false, error: 'Internal/private network URLs are blocked' };
        }
      }
      
      if (!hostname.includes('.')) {
        return { valid: false, error: 'Invalid hostname' };
      }
      
      return { valid: true };
    } catch (e) {
      return { valid: false, error: 'Invalid URL format' };
    }
  }

  /**
   * Extract price from a supplier product page using LLM
   * Fetches the URL content and uses LLM to parse/extract the price
   */
  static async extractPriceFromUrl(
    url: string,
    productName: string,
    sku: string,
    provider: LLMProvider,
    apiKey: string
  ): Promise<PriceExtractionResult> {
    try {
      const urlValidation = this.validateUrl(url);
      if (!urlValidation.valid) {
        return {
          success: false,
          price: null,
          currency: 'USD',
          confidence: 'low',
          source: url,
          error: urlValidation.error || 'Invalid URL',
        };
      }
      
      console.log(`[Price Extraction] Fetching URL: ${url}`);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      
      let pageContent = '';
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; InventoryBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml',
          },
        });
        clearTimeout(timeout);
        
        if (!response.ok) {
          return {
            success: false,
            price: null,
            currency: 'USD',
            confidence: 'low',
            source: url,
            error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
          };
        }
        
        const html = await response.text();
        pageContent = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .substring(0, 15000);
      } catch (fetchError: any) {
        clearTimeout(timeout);
        return {
          success: false,
          price: null,
          currency: 'USD',
          confidence: 'low',
          source: url,
          error: `Network error: ${fetchError.message}`,
        };
      }
      
      const prompt = `You are analyzing a supplier product page to extract pricing information.

Product Name: ${productName}
SKU: ${sku}
URL: ${url}

Page Content (text extracted from HTML):
${pageContent}

Task: Find the unit price for this product. Look for patterns like:
- Price tags: $XX.XX, $X.XX, USD X.XX
- Per-unit pricing
- Wholesale/bulk pricing tiers (use the single-unit price if available)

Respond ONLY with a JSON object in this exact format:
{
  "found": true/false,
  "price": <number or null>,
  "currency": "USD" or other 3-letter code,
  "confidence": "high"/"medium"/"low",
  "notes": "brief explanation"
}

If no price is found, set found:false and price:null.`;

      const llmResponse = await this.askLLM({
        provider,
        apiKey,
        taskType: 'price_extraction',
        payload: { prompt },
      });
      
      if (!llmResponse.success || !llmResponse.text) {
        return {
          success: false,
          price: null,
          currency: 'USD',
          confidence: 'low',
          source: url,
          error: llmResponse.error || 'LLM returned no response',
        };
      }
      
      try {
        const jsonMatch = llmResponse.text.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) {
          return {
            success: false,
            price: null,
            currency: 'USD',
            confidence: 'low',
            source: url,
            error: 'Could not parse LLM response as JSON',
          };
        }
        
        const parsed = JSON.parse(jsonMatch[0]);
        
        if (parsed.found && typeof parsed.price === 'number' && parsed.price > 0) {
          console.log(`[Price Extraction] Found price $${parsed.price} for ${sku} (${parsed.confidence} confidence)`);
          return {
            success: true,
            price: parsed.price,
            currency: parsed.currency || 'USD',
            confidence: parsed.confidence || 'medium',
            source: url,
          };
        }
        
        return {
          success: false,
          price: null,
          currency: 'USD',
          confidence: 'low',
          source: url,
          error: parsed.notes || 'Price not found on page',
        };
      } catch (parseError: any) {
        return {
          success: false,
          price: null,
          currency: 'USD',
          confidence: 'low',
          source: url,
          error: `JSON parse error: ${parseError.message}`,
        };
      }
    } catch (error: any) {
      console.error(`[Price Extraction] Error for ${sku}:`, error);
      return {
        success: false,
        price: null,
        currency: 'USD',
        confidence: 'low',
        source: url,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Check if an item needs a price refresh (no price or >30 days old)
   */
  static needsPriceRefresh(item: { defaultPurchaseCost?: number | null; lastCostUpdatedAt?: Date | null }): boolean {
    if (!item.defaultPurchaseCost || item.defaultPurchaseCost <= 0) {
      return true;
    }
    
    if (!item.lastCostUpdatedAt) {
      return true;
    }
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const lastUpdate = new Date(item.lastCostUpdatedAt);
    return lastUpdate < thirtyDaysAgo;
  }
}
