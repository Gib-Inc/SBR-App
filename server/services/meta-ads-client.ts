/**
 * Meta (Facebook) Ads Client
 * 
 * Handles OAuth 2.0 authentication and fetching ad insights for inventory forecasting.
 * 
 * V1 Scope:
 * - OAuth flow via Facebook Login
 * - List ad accounts
 * - Fetch campaign/adset insights with purchase metrics
 * - Aggregate by SKU for ad_metrics_daily
 */

import { AuditLogger } from './audit-logger';

export interface MetaAdAccount {
  id: string;
  name: string;
  accountId: string; // Without 'act_' prefix
  currency: string;
  timezone: string;
}

export interface MetaInsightsResult {
  sku: string;
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
  currency: string;
}

interface MetaOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface MetaInsightsResponse {
  data: Array<{
    campaign_id?: string;
    campaign_name?: string;
    adset_id?: string;
    adset_name?: string;
    date_start: string;
    date_stop: string;
    impressions: string;
    clicks: string;
    spend: string;
    actions?: Array<{
      action_type: string;
      value: string;
    }>;
    action_values?: Array<{
      action_type: string;
      value: string;
    }>;
  }>;
  paging?: {
    cursors?: {
      after?: string;
    };
    next?: string;
  };
}

export class MetaAdsClient {
  private config: MetaOAuthConfig | null = null;
  private accessToken: string | null = null;
  private baseUrl = 'https://graph.facebook.com/v18.0';

  constructor() {
    this.loadConfig();
  }

  private loadConfig() {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = process.env.META_REDIRECT_URI || `${process.env.REPLIT_DEV_DOMAIN || 'http://localhost:5000'}/api/ads/meta/callback`;

    if (appId && appSecret) {
      this.config = { appId, appSecret, redirectUri };
    }
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthUrl(state: string): string {
    if (!this.config) {
      throw new Error('Meta Ads not configured - missing META_APP_ID or META_APP_SECRET');
    }

    const scopes = ['ads_read', 'business_management'];
    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: this.config.redirectUri,
      scope: scopes.join(','),
      response_type: 'code',
      state,
    });

    return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<MetaTokenResponse> {
    if (!this.config) {
      throw new Error('Meta Ads not configured');
    }

    const params = new URLSearchParams({
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      redirect_uri: this.config.redirectUri,
      code,
    });

    const response = await fetch(`${this.baseUrl}/oauth/access_token?${params.toString()}`);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code for token: ${error}`);
    }

    return response.json();
  }

  /**
   * Get long-lived access token (60 days validity)
   */
  async getLongLivedToken(shortLivedToken: string): Promise<MetaTokenResponse> {
    if (!this.config) {
      throw new Error('Meta Ads not configured');
    }

    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      fb_exchange_token: shortLivedToken,
    });

    const response = await fetch(`${this.baseUrl}/oauth/access_token?${params.toString()}`);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get long-lived token: ${error}`);
    }

    return response.json();
  }

  /**
   * List all ad accounts accessible to the user
   */
  async listAdAccounts(): Promise<MetaAdAccount[]> {
    if (!this.accessToken) {
      throw new Error('Access token not set');
    }

    const response = await fetch(
      `${this.baseUrl}/me/adaccounts?fields=id,name,account_id,currency,timezone_name&access_token=${this.accessToken}`
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list ad accounts: ${error}`);
    }

    const data = await response.json();
    
    return (data.data || []).map((account: any) => ({
      id: account.id,
      name: account.name,
      accountId: account.account_id,
      currency: account.currency,
      timezone: account.timezone_name,
    }));
  }

  /**
   * Fetch insights for an ad account
   * Returns daily metrics aggregated by campaign
   */
  async fetchAccountInsights(
    adAccountId: string,
    startDate: Date,
    endDate: Date,
    skuMappings: Map<string, string> // adEntityId -> sku
  ): Promise<MetaInsightsResult[]> {
    if (!this.accessToken) {
      throw new Error('Access token not set');
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const fields = [
      'campaign_id',
      'campaign_name',
      'impressions',
      'clicks',
      'spend',
      'actions',
      'action_values',
    ].join(',');

    const params = new URLSearchParams({
      access_token: this.accessToken,
      fields,
      time_range: JSON.stringify({ since: startStr, until: endStr }),
      time_increment: '1', // Daily breakdown
      level: 'campaign',
    });

    const results: MetaInsightsResult[] = [];
    let url = `${this.baseUrl}/${adAccountId}/insights?${params.toString()}`;
    
    while (url) {
      const response = await fetch(url);
      
      if (!response.ok) {
        const error = await response.text();
        console.error(`[MetaAdsClient] Insights fetch error: ${error}`);
        break;
      }

      const data: MetaInsightsResponse = await response.json();
      
      for (const row of data.data || []) {
        const campaignId = row.campaign_id;
        if (!campaignId) continue;

        // Look up SKU mapping
        const sku = skuMappings.get(campaignId);
        if (!sku) continue; // Skip campaigns without SKU mapping

        // Extract purchase conversions and revenue
        let conversions = 0;
        let revenue = 0;
        
        if (row.actions) {
          const purchaseAction = row.actions.find(a => a.action_type === 'purchase');
          if (purchaseAction) {
            conversions = parseInt(purchaseAction.value, 10) || 0;
          }
        }
        
        if (row.action_values) {
          const purchaseValue = row.action_values.find(a => a.action_type === 'purchase');
          if (purchaseValue) {
            revenue = parseFloat(purchaseValue.value) || 0;
          }
        }

        results.push({
          sku,
          date: row.date_start,
          impressions: parseInt(row.impressions, 10) || 0,
          clicks: parseInt(row.clicks, 10) || 0,
          spend: parseFloat(row.spend) || 0,
          conversions,
          revenue,
          currency: 'USD', // Will be set from account config
        });
      }

      // Handle pagination
      url = data.paging?.next || '';
    }

    return results;
  }

  /**
   * Test connection by fetching user info
   */
  async testConnection(): Promise<{ success: boolean; userId?: string; name?: string; error?: string }> {
    if (!this.accessToken) {
      return { success: false, error: 'Access token not set' };
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/me?fields=id,name&access_token=${this.accessToken}`
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = await response.json();
      return { success: true, userId: data.id, name: data.name };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

export const metaAdsClient = new MetaAdsClient();
