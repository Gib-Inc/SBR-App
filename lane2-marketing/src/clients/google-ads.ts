/**
 * Google Ads client — extracted from monolith google-ads-client.ts.
 * Stripped to: fetch campaign performance, token refresh. Nothing else.
 *
 * Env vars: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN
 * DB config: integrationConfigs table, provider='GOOGLE_ADS'
 */

export interface GoogleInsightsResult {
  campaignName: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  developerToken: string | null;
}

export class GoogleAdsClient {
  private config: OAuthConfig | null = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private baseUrl = 'https://googleads.googleapis.com/v16';

  constructor() {
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || null;
    if (clientId && clientSecret) {
      this.config = { clientId, clientSecret, developerToken };
    }
  }

  isConfigured(): boolean { return this.config !== null; }
  setAccessToken(token: string) { this.accessToken = token; }
  setRefreshToken(token: string) { this.refreshToken = token; }

  async refreshAccessToken(): Promise<string> {
    if (!this.config || !this.refreshToken) {
      throw new Error('Cannot refresh: missing config or refresh token');
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
    if (!response.ok) throw new Error(`Token refresh failed: ${await response.text()}`);
    const tokens = await response.json();
    this.accessToken = tokens.access_token;
    return tokens.access_token;
  }

  async fetchCampaignPerformance(
    customerId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<GoogleInsightsResult[]> {
    if (!this.accessToken) throw new Error('Access token not set');

    const fmt = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '');
    const query = `
      SELECT campaign.id, campaign.name, segments.date,
             metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${fmt(startDate)}' AND '${fmt(endDate)}'
    `;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    if (this.config?.developerToken) headers['developer-token'] = this.config.developerToken;

    const response = await fetch(
      `${this.baseUrl}/customers/${customerId}/googleAds:searchStream`,
      { method: 'POST', headers, body: JSON.stringify({ query }) },
    );
    if (!response.ok) throw new Error(`Google Ads API error: ${await response.text()}`);

    const data = await response.json();
    const results: GoogleInsightsResult[] = [];

    for (const batch of data || []) {
      for (const row of batch.results || []) {
        const dateRaw = row.segments?.date;
        if (!dateRaw) continue;
        results.push({
          campaignName: row.campaign?.name || row.campaign?.id || 'unknown',
          date: `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`,
          impressions: parseInt(row.metrics?.impressions || '0', 10),
          clicks: parseInt(row.metrics?.clicks || '0', 10),
          spend: parseInt(row.metrics?.costMicros || '0', 10) / 1_000_000,
          conversions: parseFloat(row.metrics?.conversions || '0'),
          revenue: parseFloat(row.metrics?.conversionsValue || '0'),
        });
      }
    }
    return results;
  }
}

export const googleAdsClient = new GoogleAdsClient();
