/**
 * Morning Trap Service
 *
 * Zo's daily "check the traps" routine, automated.
 * Pulls Google Ads, Amazon/Meta Ads, and Shopify data.
 * Claude writes a briefing. GHL texts it to Zo.
 * Runs daily at 7 AM MST via the scheduler.
 *
 * Source: Zo's Loom walkthrough, March 24, 2026.
 * Context: sbr-product-marketing-context.md
 */

import { storage } from '../storage';
import { ShopifyClient, ShopifyNormalizedOrder } from './shopify-client';
import { googleAdsClient } from './google-ads-client';
import { GoHighLevelClient } from './gohighlevel-client';
import { AuditLogger } from './audit-logger';
import Anthropic from '@anthropic-ai/sdk';

// Claude model for briefing generation
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

// System prompt with full SBR marketing intelligence
const MORNING_TRAP_SYSTEM_PROMPT = `You are the Morning Trap Runner for Sticker Burr Roller (SBR), Hildale, Utah. You produce Zo's daily KPI briefing sent at 7 AM MST via SMS.

VOICE RULES (non-negotiable):
- Contractions always. Didn't, won't, it's. Never formal.
- No em dashes. Period or comma only.
- Short sentences. One idea per sentence.
- Max one exclamation mark total.
- Plain-spoken. Knowledgeable neighbor tone. Never hype.
- BANNED: game-changer, revolutionary, unlock, leverage, seamless, incredible, amazing, powerful, supercharge

BRIEFING FORMAT (SMS-optimized, under 400 words):

[DATE] TRAP CHECK

GOOGLE ADS MTD
Spend: $X | Sales: $X | ROAS: X:1
Top campaign: [name] at [ROAS]
Bottom campaign: [name] at [ROAS]

AMAZON/META MTD
Ad spend: $X | Attributed sales: $X
ACOS: X% | Organic signal: [strong/normal/weak]

SHOPIFY MTD
Gross sales: $X | Orders: X
Return rate: X%

COMBINED
Total ad spend: $X | Total revenue: $X
Blended ROAS: X:1

FLAGS (if any):
[One line per issue. Be specific.]

OPPORTUNITY (if any):
[One actionable insight.]

Go win your ground war.

CRITICAL BENCHMARKS (flag deviations):
- Shopify checkout conversion: BASELINE 27-30%. Flag below 20%. ALERT below 16%.
- Google ROAS mature campaigns: BASELINE 30:1. Flag below 15:1.
- Google ROAS new campaigns: BASELINE 10:1. Flag below 5:1.
- Combined monthly ad spend: BASELINE under $7K. Flag above $10K.
- Return rate: Flag if above prior month average.

ATTRIBUTION ANOMALY (always report):
Shopify shows bulk revenue from unidentified referrer source. Track and report the percentage of revenue with source "web" vs identified external sources. This affects ROAS calculations.

SOURCE BREAKDOWN (always include):
Break Shopify orders by channel. Report: Shopify web, Amazon, and any other channels with order count and revenue.

ESCALATION ROUTING (include if flag is raised):
- Checkout conversion drop -> Christopher + Kevin
- ROAS collapse -> Kevin + Zo
- Ad spend spike -> Christopher (budget approval)
- Return rate spike -> Sammie (fulfillment)
- Attribution anomaly worsening -> Matt (system architecture)

2026 TARGETS FOR CONTEXT:
Revenue target: $4,500,000. Net margin target: 13.4%.
Ad spend ceiling: well below 2025's 29.1% of revenue ($908K was unsustainable).

Never fail silently. If data is missing or an API returned an error, say exactly what's missing and who needs to fix it. Route access blockers to Matt.

If a data source returned no data or errored, include it in the briefing as: "[SOURCE]: NO DATA — [reason]. Route to Matt."`;

export interface TrapCheckResult {
  success: boolean;
  briefing: string | null;
  smsSent: boolean;
  smsError?: string;
  dataSources: {
    googleAds: { success: boolean; error?: string; data?: any };
    shopify: { success: boolean; error?: string; data?: any };
  };
  runDate: string;
}

interface ShopifyTrapData {
  orderCount: number;
  grossSales: number;
  refundedOrders: number;
  cancelledOrders: number;
  sourceBreakdown: Record<string, { orders: number; revenue: number }>;
  recentOrders: Array<{ name: string; total: number; channel: string; status: string }>;
}

interface GoogleAdsTrapData {
  totalSpend: number;
  totalRevenue: number;
  totalConversions: number;
  totalClicks: number;
  totalImpressions: number;
  roas: number;
  campaigns: Array<{
    name: string;
    spend: number;
    revenue: number;
    roas: number;
    conversions: number;
    clicks: number;
    impressions: number;
  }>;
}

export class MorningTrapService {
  /**
   * Run the full morning trap check.
   * Pulls data from all sources, generates briefing, sends SMS, logs result.
   */
  static async runTrapCheck(userId: string, options?: {
    sendSms?: boolean;
    zoContactId?: string;
  }): Promise<TrapCheckResult> {
    const runDate = new Date().toISOString().split('T')[0];
    console.log(`[MorningTrap] Starting trap check for ${runDate}`);

    const sendSms = options?.sendSms ?? true;

    // Pull data from all sources in parallel
    const [shopifyResult, googleAdsResult] = await Promise.allSettled([
      this.pullShopifyData(userId),
      this.pullGoogleAdsData(userId),
    ]);

    const shopifyData = shopifyResult.status === 'fulfilled' ? shopifyResult.value : null;
    const shopifyError = shopifyResult.status === 'rejected' ? String(shopifyResult.reason) : undefined;

    const googleAdsData = googleAdsResult.status === 'fulfilled' ? googleAdsResult.value : null;
    const googleAdsError = googleAdsResult.status === 'rejected' ? String(googleAdsResult.reason) : undefined;

    // Build the data payload for Claude
    const dataPayload = this.buildDataPayload(runDate, shopifyData, shopifyError, googleAdsData, googleAdsError);

    // Generate briefing via Claude
    let briefing: string | null = null;
    try {
      briefing = await this.generateBriefing(userId, dataPayload);
    } catch (error: any) {
      console.error('[MorningTrap] Claude briefing generation failed:', error.message);
      briefing = `${runDate} TRAP CHECK\n\nBRIEFING GENERATION FAILED: ${error.message}\nRoute to Matt.\n\nRaw data attached in logs.`;
    }

    // Send SMS via GHL
    let smsSent = false;
    let smsError: string | undefined;
    if (sendSms && briefing) {
      const smsResult = await this.sendBriefingSms(userId, briefing, options?.zoContactId);
      smsSent = smsResult.success;
      smsError = smsResult.error;
    }

    // Log the run
    try {
      await storage.createMorningTrapRun({
        userId,
        runDate: new Date(runDate),
        googleAdsRaw: googleAdsData || (googleAdsError ? { error: googleAdsError } : null),
        shopifyOrderCount: shopifyData?.orderCount ?? 0,
        shopifyGrossSales: shopifyData?.grossSales?.toString() ?? '0',
        shopifySourceBreakdown: shopifyData?.sourceBreakdown ?? null,
        shopifyRefundCount: shopifyData?.refundedOrders ?? 0,
        claudeBriefing: briefing,
        smsSent,
        smsSentAt: smsSent ? new Date() : null,
      });
    } catch (logError: any) {
      console.error('[MorningTrap] Failed to log run:', logError.message);
    }

    // Audit log
    await AuditLogger.logIntegrationSync({
      source: 'MORNING_TRAP',
      integrationName: 'Morning Trap Runner',
      recordsProcessed: (shopifyData ? 1 : 0) + (googleAdsData ? 1 : 0),
      recordsUpdated: smsSent ? 1 : 0,
    });

    console.log(`[MorningTrap] Trap check complete. SMS sent: ${smsSent}`);

    return {
      success: true,
      briefing,
      smsSent,
      smsError,
      dataSources: {
        googleAds: {
          success: !!googleAdsData,
          error: googleAdsError,
          data: googleAdsData ? { spend: googleAdsData.totalSpend, revenue: googleAdsData.totalRevenue, roas: googleAdsData.roas } : undefined,
        },
        shopify: {
          success: !!shopifyData,
          error: shopifyError,
          data: shopifyData ? { orders: shopifyData.orderCount, grossSales: shopifyData.grossSales, refunds: shopifyData.refundedOrders } : undefined,
        },
      },
      runDate,
    };
  }

  /**
   * Pull MTD Shopify orders and compute summary
   */
  private static async pullShopifyData(userId: string): Promise<ShopifyTrapData> {
    // Get Shopify credentials
    const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
    const settingsRow = await storage.getSettings(userId);

    const shopDomain = (config?.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
    const accessToken = config?.apiKey || settingsRow?.shopifyApiKey || process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopDomain || !accessToken) {
      throw new Error('Shopify not configured. Add credentials in Settings. Route to Matt.');
    }

    const client = new ShopifyClient(shopDomain, accessToken);

    // Pull MTD orders (days since start of month)
    const now = new Date();
    const daysSinceMonthStart = now.getDate();
    const orders = await client.syncRecentOrders(daysSinceMonthStart, 1000);

    // Filter to current month only
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mtdOrders = orders.filter(o => o.orderDate >= monthStart);

    // Also pull refunds
    let refundCount = 0;
    try {
      const refunds = await client.fetchRefunds(daysSinceMonthStart);
      refundCount = refunds.length;
    } catch (e) {
      console.warn('[MorningTrap] Could not fetch refunds:', e);
    }

    // Compute source breakdown
    const sourceBreakdown: Record<string, { orders: number; revenue: number }> = {};
    let cancelledCount = 0;

    for (const order of mtdOrders) {
      const channel = order.channel || 'unknown';
      if (!sourceBreakdown[channel]) {
        sourceBreakdown[channel] = { orders: 0, revenue: 0 };
      }
      sourceBreakdown[channel].orders++;
      sourceBreakdown[channel].revenue += order.totalAmount || 0;

      if (order.status === 'cancelled') {
        cancelledCount++;
      }
    }

    return {
      orderCount: mtdOrders.length,
      grossSales: mtdOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
      refundedOrders: refundCount,
      cancelledOrders: cancelledCount,
      sourceBreakdown,
      recentOrders: mtdOrders.slice(-10).map(o => ({
        name: o.externalOrderId,
        total: o.totalAmount || 0,
        channel: o.channel,
        status: o.status,
      })),
    };
  }

  /**
   * Pull MTD Google Ads campaign data
   */
  private static async pullGoogleAdsData(userId: string): Promise<GoogleAdsTrapData> {
    // Initialize the Google Ads service
    const config = await storage.getIntegrationConfig(userId, 'GOOGLE_ADS');
    if (!config?.isEnabled) {
      throw new Error('Google Ads not configured. Route to Zo for credentials.');
    }

    const configData = config.config as Record<string, any> || {};
    const accessToken = configData.accessToken;
    const refreshToken = configData.refreshToken;
    const customerId = configData.customerId;

    if (!accessToken || !customerId) {
      throw new Error('Google Ads missing access token or customer ID. Route to Matt.');
    }

    googleAdsClient.setAccessToken(accessToken);
    if (refreshToken) {
      googleAdsClient.setRefreshToken(refreshToken);
    }

    // MTD date range
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getTime() - 86400000); // Yesterday (don't include today)

    if (endDate < startDate) {
      // First day of month, no data yet
      return {
        totalSpend: 0, totalRevenue: 0, totalConversions: 0,
        totalClicks: 0, totalImpressions: 0, roas: 0, campaigns: [],
      };
    }

    // Try campaign performance (more detail than shopping)
    let results;
    try {
      results = await googleAdsClient.fetchCampaignPerformance(
        customerId, startDate, endDate, new Map()
      );
    } catch (error: any) {
      // Token might be expired, try refresh
      if (error.message?.includes('token') || error.message?.includes('401')) {
        try {
          await googleAdsClient.refreshAccessToken();
          results = await googleAdsClient.fetchCampaignPerformance(
            customerId, startDate, endDate, new Map()
          );
        } catch (refreshError) {
          throw new Error(`Google Ads token refresh failed: ${String(refreshError)}. Route to Matt.`);
        }
      } else {
        throw error;
      }
    }

    // Aggregate by campaign (results have sku field but for campaign data it's campaign name)
    const campaignMap = new Map<string, {
      name: string; spend: number; revenue: number; conversions: number; clicks: number; impressions: number;
    }>();

    for (const row of results) {
      const key = row.sku; // In campaign performance, this maps to campaign ID/name
      const existing = campaignMap.get(key);
      if (existing) {
        existing.spend += row.spend;
        existing.revenue += row.revenue;
        existing.conversions += row.conversions;
        existing.clicks += row.clicks;
        existing.impressions += row.impressions;
      } else {
        campaignMap.set(key, {
          name: key,
          spend: row.spend,
          revenue: row.revenue,
          conversions: row.conversions,
          clicks: row.clicks,
          impressions: row.impressions,
        });
      }
    }

    const campaigns = Array.from(campaignMap.values()).map(c => ({
      ...c,
      roas: c.spend > 0 ? c.revenue / c.spend : 0,
    })).sort((a, b) => b.spend - a.spend);

    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0);

    return {
      totalSpend,
      totalRevenue,
      totalConversions: campaigns.reduce((s, c) => s + c.conversions, 0),
      totalClicks: campaigns.reduce((s, c) => s + c.clicks, 0),
      totalImpressions: campaigns.reduce((s, c) => s + c.impressions, 0),
      roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
      campaigns,
    };
  }

  /**
   * Build the data payload string for Claude
   */
  private static buildDataPayload(
    runDate: string,
    shopifyData: ShopifyTrapData | null,
    shopifyError: string | undefined,
    googleAdsData: GoogleAdsTrapData | null,
    googleAdsError: string | undefined,
  ): string {
    let payload = `MORNING TRAP CHECK DATA — ${runDate}\n\n`;

    // Google Ads
    payload += '=== GOOGLE ADS MTD ===\n';
    if (googleAdsData) {
      payload += `Total spend: $${googleAdsData.totalSpend.toFixed(2)}\n`;
      payload += `Total sales (conv value): $${googleAdsData.totalRevenue.toFixed(2)}\n`;
      payload += `Overall ROAS: ${googleAdsData.roas.toFixed(1)}:1\n`;
      payload += `Total conversions: ${googleAdsData.totalConversions.toFixed(0)}\n`;
      payload += `Total clicks: ${googleAdsData.totalClicks}\n`;
      payload += `Total impressions: ${googleAdsData.totalImpressions}\n`;
      payload += `\nCampaigns (sorted by spend):\n`;
      for (const c of googleAdsData.campaigns) {
        payload += `  ${c.name}: $${c.spend.toFixed(2)} spend, $${c.revenue.toFixed(2)} sales, ${c.roas.toFixed(1)}:1 ROAS, ${c.conversions.toFixed(0)} conv, ${c.clicks} clicks\n`;
      }
    } else {
      payload += `ERROR: ${googleAdsError || 'No data returned'}\n`;
    }

    // Shopify
    payload += '\n=== SHOPIFY MTD ===\n';
    if (shopifyData) {
      payload += `Total orders: ${shopifyData.orderCount}\n`;
      payload += `Gross sales: $${shopifyData.grossSales.toFixed(2)}\n`;
      payload += `Refunded orders: ${shopifyData.refundedOrders}\n`;
      payload += `Cancelled orders: ${shopifyData.cancelledOrders}\n`;
      payload += `\nSource breakdown:\n`;
      for (const [source, data] of Object.entries(shopifyData.sourceBreakdown)) {
        payload += `  ${source}: ${data.orders} orders, $${data.revenue.toFixed(2)} revenue\n`;
      }
      payload += `\nRecent orders (last 10):\n`;
      for (const o of shopifyData.recentOrders) {
        payload += `  ${o.name}: $${o.total.toFixed(2)} via ${o.channel} (${o.status})\n`;
      }
    } else {
      payload += `ERROR: ${shopifyError || 'No data returned'}\n`;
    }

    return payload;
  }

  /**
   * Generate the morning briefing using Claude
   */
  private static async generateBriefing(userId: string, dataPayload: string): Promise<string> {
    // Get API key from settings
    const settingsRow = await storage.getSettings(userId);
    const apiKey = settingsRow?.llmApiKey;

    if (!apiKey) {
      throw new Error('No Anthropic API key configured. Add your key in Settings > LLM Configuration. Route to Matt.');
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: MORNING_TRAP_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Analyze this data and produce today's morning briefing.\n\n${dataPayload}` }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    if (!text) {
      throw new Error('Claude returned empty response');
    }

    return text;
  }

  /**
   * Send the briefing to Zo via GHL SMS
   */
  private static async sendBriefingSms(
    userId: string,
    briefing: string,
    zoContactIdOverride?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get GHL credentials
      const config = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
      const settingsRow = await storage.getSettings(userId);

      const apiKey = config?.apiKey || settingsRow?.gohighlevelApiKey;
      const locationId = (config?.config as any)?.locationId || settingsRow?.gohighlevelLocationId;

      if (!apiKey || !locationId) {
        return { success: false, error: 'GHL not configured. Add API key and Location ID in Settings. Route to Matt.' };
      }

      // Zo's contact ID: check override, then integration config, then settings
      const zoContactId = zoContactIdOverride
        || (config?.config as any)?.zoContactId
        || (settingsRow as any)?.zoGhlContactId;

      if (!zoContactId) {
        return { success: false, error: 'Zo GHL contact ID not configured. Look up Zo in GHL contacts and add zoContactId to integration config. Route to Matt.' };
      }

      const ghlClient = new GoHighLevelClient(
        'https://services.leadconnectorhq.com',
        apiKey,
        locationId,
      );

      // GHL SMS has a character limit. If briefing is too long, truncate with note.
      let message = briefing;
      if (message.length > 1500) {
        message = message.substring(0, 1450) + '\n\n[Briefing truncated. Full version in app.]';
      }

      const result = await ghlClient.sendSMS(zoContactId, message);
      return { success: result.success, error: result.error };
    } catch (error: any) {
      return { success: false, error: `SMS send failed: ${error.message}` };
    }
  }

  /**
   * Get history of trap runs
   */
  static async getRunHistory(userId: string, limit: number = 30): Promise<any[]> {
    return storage.getMorningTrapRuns(userId, limit);
  }
}
