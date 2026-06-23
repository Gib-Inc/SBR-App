/**
 * VECT.R Marketing Trend — "are things getting better, month over month?"
 *
 * Two altitudes, both with a delta vs the prior month so improvement/decay is obvious:
 *   • CHANNEL  — Meta / Google / etc. per month (from marketing_spend_snapshots), ROAS,
 *                spend, and CAC, against the 8x blended target line.
 *   • CAMPAIGN — each campaign per month (from ad_campaign_performance), so you can see
 *                which specific ads are climbing or fading.
 *
 * Campaign-level ROAS begins with the first month that carried revenue (the live
 * meta_ads_performance sync stored spend only, so older months show spend trend only).
 * Platform ROAS overstates true contribution (reconcile to QB) — this is a directional
 * is-it-improving view, not a profit statement.
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export const ROAS_TARGET = 8;

export interface MonthPoint {
  month: string;              // YYYY-MM
  spend: number;
  revenue: number | null;     // null when the source month had no revenue
  purchases: number | null;
  roas: number | null;        // revenue/spend, null when no revenue
  cac: number | null;         // spend/purchases
}
export interface TrendPoint extends MonthPoint {
  roasDelta: number | null;   // vs prior month with a roas
  spendDelta: number | null;
  dir: "up" | "down" | "flat";
}
export interface ChannelTrend { platform: string; points: TrendPoint[]; }
export interface CampaignTrend { platform: string; campaign: string; points: TrendPoint[]; latestRoas: number | null; }

/** Pure: attach prior-month deltas + a direction to a month-sorted series. */
export function withDeltas(points: MonthPoint[]): TrendPoint[] {
  let lastRoas: number | null = null;
  let lastSpend: number | null = null;
  return points.map((p) => {
    const roasDelta = p.roas != null && lastRoas != null ? r2(p.roas - lastRoas) : null;
    const spendDelta = lastSpend != null ? r2(p.spend - lastSpend) : null;
    const dir: TrendPoint["dir"] = roasDelta == null ? "flat" : roasDelta > 0.05 ? "up" : roasDelta < -0.05 ? "down" : "flat";
    if (p.roas != null) lastRoas = p.roas;
    lastSpend = p.spend;
    return { ...p, roasDelta, spendDelta, dir };
  });
}

function toPoint(r: any): MonthPoint {
  const spend = r2(num(r.spend));
  const hasRev = r.revenue != null;
  const revenue = hasRev ? r2(num(r.revenue)) : null;
  const purchases = r.purchases != null ? num(r.purchases) : null;
  return {
    month: r.month,
    spend,
    revenue,
    purchases,
    roas: hasRev && spend > 0 ? r2(revenue! / spend) : null,
    cac: purchases && purchases > 0 ? r2(spend / purchases) : null,
  };
}

export interface MarketingTrend {
  target: number;
  months: string[];
  channels: ChannelTrend[];
  campaigns: CampaignTrend[];
}

export async function getMarketingTrend(db: DB): Promise<MarketingTrend> {
  // Channel level — sum active snapshots per platform per month (bucket by period_end).
  const chRows = rows(await db.execute(sql`
    SELECT platform,
           to_char(COALESCE(period_end, period_start), 'YYYY-MM') AS month,
           round(sum(spend)::numeric, 2) AS spend,
           CASE WHEN bool_or(revenue IS NOT NULL) THEN round(sum(COALESCE(revenue,0))::numeric, 2) ELSE NULL END AS revenue,
           CASE WHEN bool_or(conversions IS NOT NULL) THEN sum(COALESCE(conversions,0)) ELSE NULL END AS purchases
    FROM marketing_spend_snapshots
    WHERE COALESCE(superseded,false) = false AND COALESCE(period_end, period_start) IS NOT NULL
    GROUP BY platform, month
    ORDER BY platform, month`)) as any[];

  // Campaign level — from ad_campaign_performance.
  const cpRows = rows(await db.execute(sql`
    SELECT platform, campaign_name AS campaign, month,
           round(sum(spend)::numeric, 2) AS spend,
           CASE WHEN bool_or(revenue IS NOT NULL) THEN round(sum(COALESCE(revenue,0))::numeric, 2) ELSE NULL END AS revenue,
           CASE WHEN bool_or(purchases IS NOT NULL) THEN sum(COALESCE(purchases,0)) ELSE NULL END AS purchases
    FROM ad_campaign_performance
    WHERE COALESCE(superseded,false) = false
    GROUP BY platform, campaign_name, month
    ORDER BY campaign_name, month`)) as any[];

  const allMonths = new Set<string>();

  // group channels
  const chMap = new Map<string, MonthPoint[]>();
  for (const r of chRows) {
    allMonths.add(r.month);
    const arr = chMap.get(r.platform) ?? [];
    arr.push(toPoint(r));
    chMap.set(r.platform, arr);
  }
  const channels: ChannelTrend[] = Array.from(chMap.entries())
    .map(([platform, pts]) => ({ platform, points: withDeltas(pts.sort((a, b) => a.month.localeCompare(b.month))) }))
    .sort((a, b) => a.platform.localeCompare(b.platform));

  // group campaigns
  const cpMap = new Map<string, { platform: string; campaign: string; pts: MonthPoint[] }>();
  for (const r of cpRows) {
    allMonths.add(r.month);
    const key = `${r.platform}|${r.campaign}`;
    const g = cpMap.get(key) ?? { platform: r.platform, campaign: r.campaign, pts: [] };
    g.pts.push(toPoint(r));
    cpMap.set(key, g);
  }
  const campaigns: CampaignTrend[] = Array.from(cpMap.values())
    .map((g) => {
      const points = withDeltas(g.pts.sort((a, b) => a.month.localeCompare(b.month)));
      const latestRoas = [...points].reverse().find((p) => p.roas != null)?.roas ?? null;
      return { platform: g.platform, campaign: g.campaign, points, latestRoas };
    })
    // most recent spend first; campaigns with revenue/roas ahead of spend-only
    .sort((a, b) => (b.points.at(-1)?.spend ?? 0) - (a.points.at(-1)?.spend ?? 0));

  return {
    target: ROAS_TARGET,
    months: Array.from(allMonths).sort(),
    channels,
    campaigns,
  };
}

/**
 * Upsert per-campaign monthly rows from a parsed Meta campaigns upload, so each
 * monthly upload feeds the campaign trend. Re-uploading the same month replaces
 * (supersedes) that month's rows for the platform rather than double-counting.
 */
export interface CampaignRow { campaign: string; spend: number; revenue?: number | null; purchases?: number | null; impressions?: number | null; }
export async function ingestCampaignMonth(
  db: DB,
  args: { platform: string; month: string; periodStart: string | null; periodEnd: string | null; source: string; campaigns: CampaignRow[] },
): Promise<{ inserted: number; month: string }> {
  const { platform, month, periodStart, periodEnd, source, campaigns } = args;
  const clean = (campaigns || []).filter((c) => c.campaign && (Number(c.spend) || 0) >= 0);
  if (clean.length === 0) return { inserted: 0, month };
  // Supersede this platform+month's existing rows, then insert the fresh set.
  await db.execute(sql`
    UPDATE ad_campaign_performance SET superseded = true
    WHERE platform = ${platform} AND month = ${month} AND superseded = false`);
  for (const c of clean) {
    await db.execute(sql`
      INSERT INTO ad_campaign_performance (platform, campaign_name, month, period_start, period_end, spend, revenue, purchases, impressions, source)
      VALUES (${platform}, ${c.campaign}, ${month}, ${periodStart}, ${periodEnd},
              ${r2(num(c.spend))}, ${c.revenue == null ? null : r2(num(c.revenue))},
              ${c.purchases == null ? null : num(c.purchases)}, ${c.impressions == null ? null : num(c.impressions)}, ${source})`);
  }
  return { inserted: clean.length, month };
}
