/**
 * Meta Ads client — extracted from monolith meta-ads-client.ts.
 * Stripped to: fetch account insights. Nothing else.
 *
 * Env vars: META_APP_ID, META_APP_SECRET
 * DB config: ad_platform_configs table, platform='META'
 */

export interface MetaInsightsResult {
  campaignId: string;
  campaignName: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
}

interface InsightsResponse {
  data: Array<{
    campaign_id?: string;
    campaign_name?: string;
    date_start: string;
    impressions: string;
    clicks: string;
    spend: string;
    actions?: Array<{ action_type: string; value: string }>;
    action_values?: Array<{ action_type: string; value: string }>;
  }>;
  paging?: { next?: string };
}

export class MetaAdsClient {
  private accessToken: string | null = null;
  private baseUrl = 'https://graph.facebook.com/v18.0';

  setAccessToken(token: string) { this.accessToken = token; }

  async fetchAccountInsights(
    adAccountId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<MetaInsightsResult[]> {
    if (!this.accessToken) throw new Error('Meta access token not set');

    const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const fields = 'campaign_id,campaign_name,impressions,clicks,spend,actions,action_values';
    const params = new URLSearchParams({
      access_token: this.accessToken,
      fields,
      time_range: JSON.stringify({
        since: startDate.toISOString().split('T')[0],
        until: endDate.toISOString().split('T')[0],
      }),
      time_increment: '1',
      level: 'campaign',
    });

    const results: MetaInsightsResult[] = [];
    let url: string | null = `${this.baseUrl}/${accountId}/insights?${params.toString()}`;

    while (url) {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[MetaAds] Insights fetch error: ${await response.text()}`);
        break;
      }

      const data: InsightsResponse = await response.json();

      for (const row of data.data || []) {
        let conversions = 0;
        let revenue = 0;
        const purchase = row.actions?.find(a => a.action_type === 'purchase');
        if (purchase) conversions = parseInt(purchase.value, 10) || 0;
        const purchaseVal = row.action_values?.find(a => a.action_type === 'purchase');
        if (purchaseVal) revenue = parseFloat(purchaseVal.value) || 0;

        results.push({
          campaignId: row.campaign_id || 'unknown',
          campaignName: row.campaign_name || 'unknown',
          date: row.date_start,
          impressions: parseInt(row.impressions, 10) || 0,
          clicks: parseInt(row.clicks, 10) || 0,
          spend: parseFloat(row.spend) || 0,
          conversions,
          revenue,
        });
      }

      url = data.paging?.next || null;
    }

    return results;
  }
}

export const metaAdsClient = new MetaAdsClient();
