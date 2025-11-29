import { storage } from "../storage";
import { logService } from "./log-service";
import { SystemLogSeverity, SystemLogType, SystemLogEntityType } from "@shared/schema";
import * as dns from "dns";
import * as https from "https";
import { promisify } from "util";

const dnsLookup = promisify(dns.lookup);

export interface AutoSuggestCostResult {
  updated: boolean;
  price?: number;
  currency?: string;
  reason?: string;
}

const PRICE_MIN_THRESHOLD = 0.01;
const PRICE_MAX_THRESHOLD = 1_000_000;
const FETCH_TIMEOUT_MS = 15000;

/**
 * Check if an IPv4 address is in a private/internal range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  
  const [a, b] = parts;
  
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  
  return false;
}

/**
 * Check if an IP address is in a private/internal range.
 * Covers RFC 1918, loopback, link-local, IPv4-mapped IPv6, and other reserved ranges.
 */
function isPrivateIP(ip: string): boolean {
  const normalizedIp = ip.toLowerCase().trim();
  
  if (!normalizedIp.includes(':')) {
    return isPrivateIPv4(normalizedIp);
  }
  
  const ipv4MappedMatch = normalizedIp.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4MappedMatch) {
    return isPrivateIPv4(ipv4MappedMatch[1]);
  }
  
  const ipv4CompatMatch = normalizedIp.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4CompatMatch) {
    return isPrivateIPv4(ipv4CompatMatch[1]);
  }
  
  const loopbackForms = [
    '::1',
    '0:0:0:0:0:0:0:1',
    '0000:0000:0000:0000:0000:0000:0000:0001',
  ];
  
  const normalizedForLoopback = normalizedIp.replace(/\b0+(\d)/g, '$1');
  if (loopbackForms.some(lb => normalizedForLoopback === lb || normalizedIp === lb)) {
    return true;
  }
  
  if (normalizedIp === '::' || normalizedIp === '0:0:0:0:0:0:0:0') return true;
  if (normalizedIp.startsWith('fe80:') || normalizedIp.startsWith('fe80::')) return true;
  if (normalizedIp.startsWith('fc') || normalizedIp.startsWith('fd')) return true;
  if (normalizedIp.startsWith('ff')) return true;
  
  return false;
}

export class AutoSuggestCostService {
  /**
   * Validate supplier URL format (sync validation).
   * For full SSRF protection, also call validateUrlWithDNS() before fetching.
   */
  static validateSupplierUrl(url: string): { valid: boolean; reason?: string } {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { valid: false, reason: "Invalid URL format" };
    }
    
    if (parsedUrl.protocol !== "https:") {
      return { valid: false, reason: "Only HTTPS URLs are allowed" };
    }
    
    const hostname = parsedUrl.hostname.toLowerCase();
    
    if (hostname === 'localhost') {
      return { valid: false, reason: "localhost is not allowed" };
    }
    
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      if (isPrivateIP(hostname)) {
        return { valid: false, reason: "Private/internal IP addresses are not allowed" };
      }
    }
    
    return { valid: true };
  }

  /**
   * Async validation that performs DNS lookup to prevent DNS rebinding attacks.
   * Returns the validated IP address to be used for the actual fetch (prevents TOCTOU).
   */
  static async validateUrlWithDNS(url: string): Promise<{ valid: boolean; reason?: string; validatedIp?: string }> {
    const basicValidation = this.validateSupplierUrl(url);
    if (!basicValidation.valid) {
      return basicValidation;
    }

    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;

    try {
      const result = await dnsLookup(hostname, { all: true });
      const addresses = Array.isArray(result) ? result : [result];
      
      let firstPublicIp: string | undefined;
      
      for (const addr of addresses) {
        const ip = typeof addr === 'string' ? addr : addr.address;
        if (isPrivateIP(ip)) {
          return { valid: false, reason: `DNS resolved to private IP: ${ip}` };
        }
        if (!firstPublicIp) {
          firstPublicIp = ip;
        }
      }
      
      return { valid: true, validatedIp: firstPublicIp };
    } catch (dnsError: any) {
      return { valid: false, reason: `DNS lookup failed: ${dnsError.message}` };
    }
  }

  /**
   * Auto-suggest a purchase cost for a product by fetching the supplier's product page
   * and extracting the unit price using regex patterns and/or LLM.
   */
  static async autoSuggestPurchaseCost(itemId: string): Promise<AutoSuggestCostResult> {
    try {
      const item = await storage.getItem(itemId);
      if (!item) {
        return { updated: false, reason: "Item not found." };
      }

      if (item.defaultPurchaseCost !== null && item.costSource === "MANUAL") {
        return { updated: false, reason: "Manual cost already set." };
      }

      if (!item.supplierProductUrl) {
        return { updated: false, reason: "No supplierProductUrl." };
      }

      const urlValidation = await this.validateUrlWithDNS(item.supplierProductUrl);
      if (!urlValidation.valid || !urlValidation.validatedIp) {
        await this.logError("INVALID_URL", itemId, item.supplierProductUrl, urlValidation.reason || "URL validation failed");
        return { updated: false, reason: `Invalid supplier URL: ${urlValidation.reason}` };
      }

      const autoScrapeEnabled = process.env.AUTO_SCRAPE_SUPPLIER_PRICES_ENABLED;
      if (autoScrapeEnabled === "false") {
        return { updated: false, reason: "Auto-scrape disabled by config." };
      }

      let html: string;
      try {
        html = await this.fetchSupplierPageSecure(item.supplierProductUrl, urlValidation.validatedIp);
      } catch (fetchError: any) {
        await this.logError("FETCH_FAILED", itemId, item.supplierProductUrl, fetchError.message);
        return { updated: false, reason: `Failed to fetch supplier page: ${fetchError.message}` };
      }

      let extractedPrice = this.extractPriceWithRegex(html);
      let priceSource = "regex";

      if (extractedPrice === null) {
        try {
          const llmPrice = await this.extractPriceWithLLM(html, item.supplierProductUrl);
          if (llmPrice !== null) {
            extractedPrice = llmPrice;
            priceSource = "llm";
          }
        } catch (llmError: any) {
          await this.logError("LLM_EXTRACTION_FAILED", itemId, item.supplierProductUrl, llmError.message);
        }
      }

      if (extractedPrice === null) {
        return { updated: false, reason: "No reliable price found on the supplier page." };
      }

      if (!this.isPriceValid(extractedPrice)) {
        await this.logError("INVALID_PRICE", itemId, item.supplierProductUrl, 
          `Extracted price ${extractedPrice} failed sanity check (must be > ${PRICE_MIN_THRESHOLD} and < ${PRICE_MAX_THRESHOLD})`);
        return { updated: false, reason: "Extracted price failed sanity check." };
      }

      const currency = item.currency || "USD";

      if (item.defaultPurchaseCost !== null && item.costSource === "MANUAL") {
        await logService.logSystemEvent({
          type: "PRICE_SUGGESTION_IGNORED",
          entityType: SystemLogEntityType.PRODUCT,
          entityId: itemId,
          severity: SystemLogSeverity.INFO,
          message: `Suggested price $${extractedPrice.toFixed(2)} (${priceSource}) for item ${item.name} (SKU: ${item.sku}) - ignored because manual cost is set.`,
          details: {
            suggestedPrice: extractedPrice,
            existingPrice: item.defaultPurchaseCost,
            url: item.supplierProductUrl,
            extractionMethod: priceSource,
          },
        });

        return {
          updated: false,
          price: extractedPrice,
          currency,
          reason: "Manual cost already set; suggestion ignored.",
        };
      }

      await storage.updateItem(itemId, {
        defaultPurchaseCost: extractedPrice,
        currency,
        costSource: "AUTO_SCRAPED",
        lastCostUpdatedAt: new Date(),
      });

      await logService.logSystemEvent({
        type: "PRICE_AUTO_SCRAPED",
        entityType: SystemLogEntityType.PRODUCT,
        entityId: itemId,
        severity: SystemLogSeverity.INFO,
        message: `Auto-scraped price $${extractedPrice.toFixed(2)} (${priceSource}) for item ${item.name} (SKU: ${item.sku})`,
        details: {
          price: extractedPrice,
          url: item.supplierProductUrl,
          extractionMethod: priceSource,
        },
      });

      return {
        updated: true,
        price: extractedPrice,
        currency,
      };
    } catch (error: any) {
      console.error("[AutoSuggestCostService] Unexpected error:", error);
      return { updated: false, reason: `Unexpected error: ${error.message}` };
    }
  }

  /**
   * Fetch supplier page using the pre-validated IP address to prevent DNS rebinding attacks.
   * Uses Node's https module with servername for proper TLS while connecting to the validated IP.
   * This closes the TOCTOU gap without breaking TLS certificate validation.
   */
  private static fetchSupplierPageSecure(originalUrl: string, validatedIp: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(originalUrl);
      const hostname = parsedUrl.hostname;
      const port = parseInt(parsedUrl.port || '443', 10);
      const path = parsedUrl.pathname + parsedUrl.search;
      
      const options: https.RequestOptions = {
        hostname: validatedIp,
        port,
        path,
        method: 'GET',
        servername: hostname,
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          'Host': hostname,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      };

      const req = https.request(options, (res) => {
        if (res.statusCode && (res.statusCode >= 300 && res.statusCode < 400) && res.headers.location) {
          reject(new Error(`Redirect not followed: ${res.statusCode} -> ${res.headers.location}`));
          return;
        }
        
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 5 * 1024 * 1024) {
            req.destroy();
            reject(new Error('Response too large (>5MB)'));
          }
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      req.end();
    });
  }

  /**
   * Extract price from HTML using regex patterns
   * Returns the most likely price or null if not found
   */
  private static extractPriceWithRegex(html: string): number | null {
    const pricePatterns = [
      /\$\s*([\d,]+\.?\d{0,2})/g,
      /USD\s*([\d,]+\.?\d{0,2})/gi,
      /Price[:\s]*\$?([\d,]+\.?\d{0,2})/gi,
      /price["\s:]*["\s]*([\d,]+\.?\d{0,2})/gi,
      /data-price["\s:=]*["\s]*([\d,]+\.?\d{0,2})/gi,
      /amount["\s:]*["\s]*([\d,]+\.?\d{0,2})/gi,
      /cost[:\s]*\$?([\d,]+\.?\d{0,2})/gi,
    ];

    const foundPrices: number[] = [];

    for (const pattern of pricePatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const priceStr = match[1].replace(/,/g, "");
        const price = parseFloat(priceStr);
        if (!isNaN(price) && this.isPriceValid(price)) {
          foundPrices.push(price);
        }
      }
    }

    if (foundPrices.length === 0) {
      return null;
    }

    const sortedPrices = foundPrices.sort((a, b) => a - b);
    const minValidPrice = sortedPrices.find(p => p > PRICE_MIN_THRESHOLD) || sortedPrices[0];

    return minValidPrice;
  }

  /**
   * Extract price using LLM when regex fails or is ambiguous
   */
  private static async extractPriceWithLLM(html: string, url: string): Promise<number | null> {
    try {
      const settings = await storage.getSettings("default");
      if (!settings?.llmProvider || !settings?.llmApiKey) {
        console.log("[AutoSuggestCostService] No LLM configured, skipping LLM extraction");
        return null;
      }

      const truncatedHtml = this.truncateHtmlForLLM(html, 8000);

      const prompt = `You are analyzing HTML from a supplier's product page to extract the unit price.

URL: ${url}

HTML Content (truncated):
${truncatedHtml}

Task: Extract the main unit price for a single unit of the product. 
- Return ONLY a number (e.g., 15.32) representing the price in USD.
- If you cannot confidently find a price, return the word "null".
- Do not include currency symbols, just the numeric value.
- Look for the primary/main price, not bulk discounts or shipping costs.

Your response (number only or "null"):`;

      const apiKey = settings.llmApiKey;
      const provider = settings.llmProvider;

      let responseText: string | null = null;

      if (provider === "chatgpt") {
        responseText = await this.callOpenAI(apiKey, prompt);
      } else if (provider === "claude") {
        responseText = await this.callAnthropic(apiKey, prompt);
      } else {
        console.log(`[AutoSuggestCostService] Unsupported LLM provider: ${provider}`);
        return null;
      }

      if (!responseText) {
        return null;
      }

      const cleanedResponse = responseText.trim().toLowerCase();
      if (cleanedResponse === "null" || cleanedResponse === "") {
        return null;
      }

      const price = parseFloat(cleanedResponse.replace(/[^0-9.]/g, ""));
      if (isNaN(price) || !this.isPriceValid(price)) {
        console.log(`[AutoSuggestCostService] LLM returned invalid price: ${responseText}`);
        return null;
      }

      return price;
    } catch (error: any) {
      console.error("[AutoSuggestCostService] LLM extraction error:", error.message);
      throw error;
    }
  }

  /**
   * Call OpenAI API for price extraction
   */
  private static async callOpenAI(apiKey: string, prompt: string): Promise<string | null> {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 50,
          temperature: 0,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || null;
    } catch (error: any) {
      console.error("[AutoSuggestCostService] OpenAI call failed:", error.message);
      throw error;
    }
  }

  /**
   * Call Anthropic API for price extraction
   */
  private static async callAnthropic(apiKey: string, prompt: string): Promise<string | null> {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 50,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.content?.[0]?.text || null;
    } catch (error: any) {
      console.error("[AutoSuggestCostService] Anthropic call failed:", error.message);
      throw error;
    }
  }

  /**
   * Truncate HTML for LLM to avoid token limits
   * Focus on areas likely to contain pricing
   */
  private static truncateHtmlForLLM(html: string, maxLength: number): string {
    const stripTags = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");

    const priceKeywords = ["price", "cost", "amount", "$", "usd"];
    const lines = stripTags.split("\n");
    const relevantLines: string[] = [];

    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (priceKeywords.some(keyword => lowerLine.includes(keyword))) {
        relevantLines.push(line.trim());
      }
    }

    let result = relevantLines.join("\n");
    
    if (result.length < 500) {
      result = stripTags.substring(0, maxLength);
    }

    return result.substring(0, maxLength);
  }

  /**
   * Validate that price is within reasonable bounds
   */
  private static isPriceValid(price: number): boolean {
    return price > PRICE_MIN_THRESHOLD && price < PRICE_MAX_THRESHOLD;
  }

  /**
   * Log errors to the system log
   */
  private static async logError(code: string, itemId: string, url: string, message: string): Promise<void> {
    await logService.logSystemEvent({
      type: "PRICE_SCRAPE_ERROR",
      entityType: SystemLogEntityType.PRODUCT,
      entityId: itemId,
      severity: SystemLogSeverity.WARNING,
      code,
      message: `Price scrape error for item ${itemId}: ${message}`,
      details: {
        url: url.substring(0, 200),
        errorCode: code,
      },
    });
  }
}
