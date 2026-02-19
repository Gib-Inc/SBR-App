/**
 * Google Ads Client
 * 
 * Handles OAuth 2.0 authentication and fetching ad insights for inventory forecasting.
 * 
 * V1 Scope:
 * - OAuth flow via Google
 * - List accessible customer accounts
 * - GAQL queries for shopping performance (SKU-level data)
 * - Aggregate by SKU for ad_metrics_daily
 */

import { AuditLogger } from './audit-logger';

export interface GoogleAdsCustomer {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
}

export interface GoogleInsightsResult {
  sku: string;
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  spend: number; // In account currency (converted from micros)
  conversions: number;
  revenue: number;
  currency: string;
}

interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  developerToken?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export class GoogleAdsClient {
  private config: GoogleOAuthConfig | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private developerToken: string | null = null;
  private customerId: string | null = null;
  private baseUrl = 'https://googleads.googleapis.com/v16';

  constructor() {
    this.loadConfig();
  }

  private loadConfig() {
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI || 
      `${process.env.APP_BASE_URL || 'http://localhost:5000'}/api/ads/google/callback`;

    if (clientId && clientSecret) {
      this.config = { clientId, clientSecret, redirectUri, developerToken };
      this.developerToken = developerToken || null;
    }
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  setRefreshToken(token: string) {
    this.refreshToken = token;
  }

  setCustomerId(id: string) {
    this.customerId = id;
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthUrl(state: string): string {
    if (!this.config) {
      throw new Error('Google Ads not configured - missing GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET');
    }

    const scopes = ['https://www.googleapis.com/auth/adwords'];
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: scopes.join(' '),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
    if (!this.config) {
      throw new Error('Google Ads not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code for token: ${error}`);
    }

    return response.json();
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<GoogleTokenResponse> {
    if (!this.config || !this.refreshToken) {
      throw new Error('Google Ads not configured or refresh token not set');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh token: ${error}`);
    }

    const tokens: GoogleTokenResponse = await response.json();
    this.accessToken = tokens.access_token;
    return tokens;
  }

  /**
   * List accessible customer accounts
   */
  async listAccessibleCustomers(): Promise<GoogleAdsCustomer[]> {
    if (!this.accessToken) {
      throw new Error('Access token not set');
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    
    if (this.developerToken) {
      headers['developer-token'] = this.developerToken;
    }

    const response = await fetch(`${this.baseUrl}/customers:listAccessibleCustomers`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list customers: ${error}`);
    }

    const data = await response.json();
    const resourceNames: string[] = data.resourceNames || [];
    
    // Get details for each customer
    const customers: GoogleAdsCustomer[] = [];
    for (const resourceName of resourceNames) {
      const customerId = resourceName.replace('customers/', '');
      try {
        const customer = await this.getCustomerDetails(customerId);
        if (customer) {
          customers.push(customer);
        }
      } catch (error) {
        console.error(`[GoogleAdsClient] Error fetching customer ${customerId}:`, error);
      }
    }

    return customers;
  }

  /**
   * Get details for a specific customer
   */
  private async getCustomerDetails(customerId: string): Promise<GoogleAdsCustomer | null> {
    if (!this.accessToken) return null;

    const query = `
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone
      FROM customer
      LIMIT 1
    `;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    
    if (this.developerToken) {
      headers['developer-token'] = this.developerToken;
    }

    const response = await fetch(`${this.baseUrl}/customers/${customerId}/googleAds:searchStream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const result = data[0]?.results?.[0]?.customer;
    
    if (!result) return null;

    return {
      customerId: result.id,
      descriptiveName: result.descriptiveName || customerId,
      currencyCode: result.currencyCode || 'USD',
      timeZone: result.timeZone || 'UTC',
    };
  }

  /**
   * Fetch shopping performance by SKU (product_item_id)
   * This is the key query for SKU-level ad metrics
   */
  async fetchShoppingPerformance(
    customerId: string,
    startDate: Date,
    endDate: Date
  ): Promise<GoogleInsightsResult[]> {
    if (!this.accessToken) {
      throw new Error('Access token not set');
    }

    const startStr = startDate.toISOString().split('T')[0].replace(/-/g, '');
    const endStr = endDate.toISOString().split('T')[0].replace(/-/g, '');

    // GAQL query for shopping performance view (SKU-level data)
    const query = `
      SELECT
        segments.product_item_id,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM shopping_performance_view
      WHERE segments.date BETWEEN '${startStr}' AND '${endStr}'
    `;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    
    if (this.developerToken) {
      headers['developer-token'] = this.developerToken;
    }

    const response = await fetch(`${this.baseUrl}/customers/${customerId}/googleAds:searchStream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch shopping performance: ${error}`);
    }

    const data = await response.json();
    const results: GoogleInsightsResult[] = [];

    for (const batch of data || []) {
      for (const row of batch.results || []) {
        const sku = row.segments?.productItemId;
        if (!sku) continue;

        // Convert date from YYYY-MM-DD format (already in correct format from Google)
        const dateStr = row.segments?.date;
        if (!dateStr) continue;
        
        // Format date properly (Google returns YYYYMMDD, we need YYYY-MM-DD)
        const formattedDate = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;

        results.push({
          sku,
          date: formattedDate,
          impressions: parseInt(row.metrics?.impressions || '0', 10),
          clicks: parseInt(row.metrics?.clicks || '0', 10),
          spend: (parseInt(row.metrics?.costMicros || '0', 10) / 1000000), // Convert micros to dollars
          conversions: parseFloat(row.metrics?.conversions || '0'),
          revenue: parseFloat(row.metrics?.conversionsValue || '0'),
          currency: 'USD', // Will be set from account config
        });
      }
    }

    return results;
  }

  /**
   * Fetch campaign performance with manual SKU mapping
   * Used when shopping campaigns aren't available
   */
  async fetchCampaignPerformance(
    customerId: string,
    startDate: Date,
    endDate: Date,
    skuMappings: Map<string, string> // campaignId -> sku
  ): Promise<GoogleInsightsResult[]> {
    if (!this.accessToken) {
      throw new Error('Access token not set');
    }

    const startStr = startDate.toISOString().split('T')[0].replace(/-/g, '');
    const endStr = endDate.toISOString().split('T')[0].replace(/-/g, '');

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startStr}' AND '${endStr}'
    `;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    
    if (this.developerToken) {
      headers['developer-token'] = this.developerToken;
    }

    const response = await fetch(`${this.baseUrl}/customers/${customerId}/googleAds:searchStream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch campaign performance: ${error}`);
    }

    const data = await response.json();
    const results: GoogleInsightsResult[] = [];

    for (const batch of data || []) {
      for (const row of batch.results || []) {
        const campaignId = row.campaign?.id;
        if (!campaignId) continue;

        // Look up SKU from mapping
        const sku = skuMappings.get(campaignId);
        if (!sku) continue;

        const dateStr = row.segments?.date;
        if (!dateStr) continue;
        
        const formattedDate = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;

        results.push({
          sku,
          date: formattedDate,
          impressions: parseInt(row.metrics?.impressions || '0', 10),
          clicks: parseInt(row.metrics?.clicks || '0', 10),
          spend: (parseInt(row.metrics?.costMicros || '0', 10) / 1000000),
          conversions: parseFloat(row.metrics?.conversions || '0'),
          revenue: parseFloat(row.metrics?.conversionsValue || '0'),
          currency: 'USD',
        });
      }
    }

    return results;
  }

  /**
   * Test connection by fetching accessible customers
   */
  async testConnection(): Promise<{ success: boolean; customersCount?: number; error?: string }> {
    if (!this.accessToken) {
      return { success: false, error: 'Access token not set' };
    }

    try {
      const customers = await this.listAccessibleCustomers();
      return { success: true, customersCount: customers.length };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

export const googleAdsClient = new GoogleAdsClient();
