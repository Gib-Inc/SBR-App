/**
 * Ad Performance Service
 *
 * Pulls Meta and Google Ads data, stores in copy_performance,
 * matches against copy_assets via copy_asset_id.
 */

import { googleAdsClient, type GoogleInsightsResult } from '../clients/google-ads';
import { metaAdsClient, type MetaInsightsResult } from '../clients/meta-ads';
import { createCopyPerformance } from '../db/queries';

export interface AdSnapshot {
  channel: 'GOOGLE' | 'META';
  campaigns: Array<{
    name: string;
    spend: number;
    revenue: number;
    roas: number;
    conversions: number;
    clicks: number;
    impressions: number;
  }>;
  totalSpend: number;
  totalRevenue: number;
  totalConversions: number;
  roas: number;
}

export async function pullGoogleAds(
  customerId: string,
  startDate: Date,
  endDate: Date,
): Promise<AdSnapshot> {
  const raw = await googleAdsClient.fetchCampaignPerformance(customerId, startDate, endDate);
  return aggregateCampaigns('GOOGLE', raw.map(r => ({
    name: r.campaignName,
    spend: r.spend,
    revenue: r.revenue,
    conversions: r.conversions,
    clicks: r.clicks,
    impressions: r.impressions,
  })));
}

export async function pullMetaAds(
  adAccountId: string,
  startDate: Date,
  endDate: Date,
): Promise<AdSnapshot> {
  const raw = await metaAdsClient.fetchAccountInsights(adAccountId, startDate, endDate);
  return aggregateCampaigns('META', raw.map(r => ({
    name: r.campaignName,
    spend: r.spend,
    revenue: r.revenue,
    conversions: r.conversions,
    clicks: r.clicks,
    impressions: r.impressions,
  })));
}

function aggregateCampaigns(
  channel: 'GOOGLE' | 'META',
  rows: Array<{ name: string; spend: number; revenue: number; conversions: number; clicks: number; impressions: number }>,
): AdSnapshot {
  const map = new Map<string, typeof rows[0]>();

  for (const row of rows) {
    const existing = map.get(row.name);
    if (existing) {
      existing.spend += row.spend;
      existing.revenue += row.revenue;
      existing.conversions += row.conversions;
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
    } else {
      map.set(row.name, { ...row });
    }
  }

  const campaigns = Array.from(map.values())
    .map(c => ({ ...c, roas: c.spend > 0 ? c.revenue / c.spend : 0 }))
    .sort((a, b) => b.spend - a.spend);

  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0);

  return {
    channel,
    campaigns,
    totalSpend,
    totalRevenue,
    totalConversions: campaigns.reduce((s, c) => s + c.conversions, 0),
    roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
  };
}

/**
 * Record performance metrics against a specific copy asset.
 * Call this after matching an ad to a copy_asset record.
 */
export async function recordPerformanceForCopy(
  copyAssetId: string,
  channel: string,
  metrics: { impressions: number; clicks: number; conversions: number; spend: number; revenue: number },
) {
  const roas = parseFloat(metrics.spend as any) > 0
    ? parseFloat(metrics.revenue as any) / parseFloat(metrics.spend as any)
    : 0;
  const ctr = metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0;

  return createCopyPerformance({
    copyAssetId,
    channel,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    conversions: metrics.conversions,
    spend: String(metrics.spend),
    revenue: String(metrics.revenue),
    roas,
    ctr,
  });
}
