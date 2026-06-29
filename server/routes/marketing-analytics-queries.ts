/**
 * Marketing Analytics — SQL query builders
 * Raw Drizzle queries for analytics aggregations.
 * One function per dashboard view.
 *
 * AD SPEND IS CORRECTED AT READ TIME. `ad_metrics_daily` holds overlapping
 * marginal breakdown rows (per-SKU AND per-campaign×device×country) so a naive
 * SUM(spend) multi-counts (~3.65x on Google). Every ad-spend figure below is
 * reconciled to the authoritative source-hierarchy total (Windsor > upload >
 * deduped live) via server/services/corrected-ad-spend — the SAME numbers the
 * Finances page shows, so the two pages can never disagree again.
 */

import { sql } from 'drizzle-orm';
import {
  getAdSpendCorrection,
  getCorrectedAdSummary,
} from '../services/corrected-ad-spend';

type DB = any;
const rows = (r: any) => r.rows || r;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function querySpendPacing(db: DB, days: number) {
  const result = await db.execute(sql`
    SELECT date::text as date,
           SUM(spend)::real as spend,
           SUM(revenue)::real as revenue,
           SUM(impressions)::int as impressions,
           SUM(clicks)::int as clicks,
           SUM(conversions)::int as conversions
    FROM ad_metrics_daily
    WHERE date >= current_date - make_interval(days => ${days})
    GROUP BY date
    ORDER BY date
  `);
  // Scale the daily spend so the series sums to the corrected window total
  // (kills the double-count; keeps the day-to-day pacing shape).
  const { globalFactor } = await getAdSpendCorrection(days);
  return rows(result).map((r: any) => ({ ...r, spend: r2((Number(r.spend) || 0) * globalFactor) }));
}

export async function queryChannelMix(db: DB, days: number) {
  // Raw per-platform secondary metrics (revenue/conversions/clicks) for shape…
  const result = await db.execute(sql`
    SELECT platform,
           SUM(revenue)::real as revenue,
           SUM(conversions)::int as conversions,
           SUM(clicks)::int as clicks,
           SUM(impressions)::int as impressions
    FROM ad_metrics_daily
    WHERE date >= current_date - make_interval(days => ${days})
    GROUP BY platform
  `);
  const rawByPlatform = new Map<string, any>();
  for (const r of rows(result)) {
    const p = String(r.platform || '').toUpperCase();
    const prev = rawByPlatform.get(p) || { revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
    rawByPlatform.set(p, {
      revenue: prev.revenue + (Number(r.revenue) || 0),
      conversions: prev.conversions + (Number(r.conversions) || 0),
      clicks: prev.clicks + (Number(r.clicks) || 0),
      impressions: prev.impressions + (Number(r.impressions) || 0),
    });
  }
  // …but SPEND + the platform set come from the corrected source (so Meta from an
  // upload appears, and Google/Amazon are deduped to Windsor).
  const { corrected } = await getAdSpendCorrection(days);
  return corrected.platforms
    .map((p) => {
      const r = rawByPlatform.get(p.platform) || { revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
      const spend = p.spend;
      const revenue = Number(r.revenue) || 0;
      return {
        platform: p.platform,
        source: p.source,
        spend,
        revenue,
        conversions: r.conversions,
        clicks: r.clicks,
        impressions: r.impressions,
        cpa: r.conversions > 0 ? r2(spend / r.conversions) : null,
        // per-platform ROAS only when we have attributed revenue for that platform;
        // otherwise null (honest — blended ROAS is shown at the card level).
        roas: spend > 0 && revenue > 0 ? r2(revenue / spend) : null,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

export async function queryProductPerformance(db: DB, days: number) {
  const result = await db.execute(sql`
    SELECT amd.sku,
           i.name,
           i.available_for_sale_qty as available_qty,
           i.hildale_qty,
           SUM(amd.spend)::real as spend,
           SUM(amd.revenue)::real as revenue,
           SUM(amd.conversions)::int as conversions,
           SUM(amd.conversions)::int as raw_conversions
    FROM ad_metrics_daily amd
    LEFT JOIN items i ON i.sku = amd.sku
    WHERE amd.date >= current_date - make_interval(days => ${days})
    GROUP BY amd.sku, i.name, i.available_for_sale_qty, i.hildale_qty
    ORDER BY spend DESC
  `);
  // Scale per-SKU spend to the corrected window total (SKU rows carry no platform,
  // so the global factor applies), then recompute ROAS / days-of-stock.
  const { globalFactor } = await getAdSpendCorrection(days);
  return rows(result).map((r: any) => {
    const spend = r2((Number(r.spend) || 0) * globalFactor);
    const revenue = Number(r.revenue) || 0;
    const conv = Number(r.conversions) || 0;
    return {
      sku: r.sku,
      name: r.name,
      available_qty: r.available_qty,
      hildale_qty: r.hildale_qty,
      spend,
      revenue,
      conversions: conv,
      roas: spend > 0 && revenue > 0 ? r2(revenue / spend) : null,
      days_of_stock: conv > 0 ? r2((Number(r.available_qty) || 0) / (conv / days)) : null,
    };
  });
}

export async function queryCreativeIntelligence(db: DB, days: number) {
  const byFramework = await db.execute(sql`
    SELECT ca.framework,
           AVG(cp.roas)::real as avg_roas,
           AVG(cp.ctr)::real as avg_ctr,
           COUNT(*)::int as sample_size,
           SUM(cp.spend::real) as total_spend,
           SUM(cp.revenue::real) as total_revenue
    FROM copy_assets ca
    JOIN copy_performance cp ON cp.copy_asset_id = ca.id
    WHERE cp.measured_at >= now() - make_interval(days => ${days})
    GROUP BY ca.framework
    HAVING COUNT(*) >= 2
    ORDER BY avg_roas DESC
  `);

  const byAvatar = await db.execute(sql`
    SELECT ca.primary_objection as avatar,
           AVG(cp.roas)::real as avg_roas,
           AVG(cp.ctr)::real as avg_ctr,
           COUNT(*)::int as sample_size
    FROM copy_assets ca
    JOIN copy_performance cp ON cp.copy_asset_id = ca.id
    WHERE cp.measured_at >= now() - make_interval(days => ${days})
      AND ca.primary_objection IS NOT NULL
    GROUP BY ca.primary_objection
    HAVING COUNT(*) >= 2
    ORDER BY avg_roas DESC
  `);

  const killScale = await db.execute(sql`
    SELECT ca.id, ca.headline, ca.body, ca.channel, ca.framework,
           cp.roas::real, cp.ctr::real, cp.spend::real, cp.impressions,
           cp.performance_score::real
    FROM copy_assets ca
    JOIN copy_performance cp ON cp.copy_asset_id = ca.id
    WHERE cp.measured_at >= now() - make_interval(days => ${days})
    ORDER BY cp.roas DESC
  `);

  const roots = await db.execute(sql`
    SELECT * FROM copy_roots ORDER BY avg_roas DESC LIMIT 20
  `);

  return {
    byFramework: byFramework.rows || byFramework,
    byAvatar: byAvatar.rows || byAvatar,
    killScale: killScale.rows || killScale,
    roots: roots.rows || roots,
  };
}

export async function querySeasonalIntelligence(db: DB, currentYear: number, compareYear: number) {
  const yoy = await db.execute(sql`
    SELECT EXTRACT(WEEK FROM order_date) as week_num,
           SUM(CASE WHEN EXTRACT(YEAR FROM order_date) = ${currentYear} THEN total_amount::real ELSE 0 END) as current_revenue,
           SUM(CASE WHEN EXTRACT(YEAR FROM order_date) = ${compareYear} THEN total_amount::real ELSE 0 END) as prior_revenue,
           COUNT(CASE WHEN EXTRACT(YEAR FROM order_date) = ${currentYear} THEN 1 END)::int as current_orders,
           COUNT(CASE WHEN EXTRACT(YEAR FROM order_date) = ${compareYear} THEN 1 END)::int as prior_orders
    FROM sales_orders
    WHERE EXTRACT(YEAR FROM order_date) IN (${currentYear}, ${compareYear})
    GROUP BY week_num
    ORDER BY week_num
  `);

  const convTrends = await db.execute(sql`
    SELECT EXTRACT(WEEK FROM date) as week_num,
           AVG(CASE WHEN clicks > 0 THEN conversions::real / clicks END)::real as conv_rate,
           AVG(CASE WHEN impressions > 0 THEN clicks::real / impressions END)::real as ctr,
           SUM(spend)::real as spend
    FROM ad_metrics_daily
    WHERE EXTRACT(YEAR FROM date) = ${currentYear}
    GROUP BY week_num
    ORDER BY week_num
  `);

  // Conversion/CTR rates are ratios (unaffected by the spend double-count). The
  // weekly spend column is scaled to this year's corrected run-rate so it lines
  // up with every other spend figure on the page.
  let factor = 1;
  try {
    // Use the ad_metrics-restricted globalFactor (NOT corrected.totalAdSpend / rawYtd):
    // totalAdSpend now includes canonical Meta, which has no rows in this weekly
    // ad_metrics series, so dividing by it would smear Meta's spend across the
    // Google/Amazon weeks. globalFactor reconciles only the platforms present here.
    const { globalFactor } = await getAdSpendCorrection(365);
    if (globalFactor > 0 && isFinite(globalFactor)) factor = globalFactor;
  } catch { /* leave unscaled */ }

  return {
    yoy: rows(yoy),
    conversionTrends: rows(convTrends).map((r: any) => ({ ...r, spend: r2((Number(r.spend) || 0) * factor) })),
  };
}

export async function queryKPIs(db: DB) {
  // 30-DAY summary (NOT month-to-date). Windsor snapshots are period-level, so
  // summing a 30-day snapshot into a short MTD window would over-count spend and
  // crush ROAS. Using the SAME 30-day window as the "Ad Spend by Channel" card
  // (via getCorrectedAdSummary) makes the KPI bar, the card, and the Finances
  // unified view all show the identical spend / revenue / blended ROAS.
  const summary = await getCorrectedAdSummary(30);
  const ordersRes = await db.execute(sql`
    SELECT COUNT(*)::int as orders
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(days => 30)
      AND status NOT IN ('CANCELLED', 'REFUNDED')
  `);
  const orders = Number(rows(ordersRes)[0]?.orders) || 0;
  const spend = summary.totalAdSpend || 0;
  return {
    mtd_spend: spend,
    mtd_revenue: summary.totalRevenue ?? 0,
    blended_roas: summary.blendedRoas,
    total_conversions: orders,
    avg_cpa: orders > 0 && spend > 0 ? r2(spend / orders) : null,
  };
}
