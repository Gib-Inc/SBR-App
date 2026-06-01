/**
 * Marketing Analytics — SQL query builders
 * Raw Drizzle queries for analytics aggregations.
 * One function per dashboard view.
 */

import { sql } from 'drizzle-orm';

type DB = any;

export async function querySpendPacing(db: DB, days: number) {
  const result = await db.execute(sql`
    SELECT date::text as date,
           SUM(spend)::real as spend,
           SUM(revenue)::real as revenue,
           SUM(impressions)::int as impressions,
           SUM(clicks)::int as clicks,
           SUM(conversions)::int as conversions
    FROM ad_metrics_daily
    WHERE date >= current_date - ${days}
    GROUP BY date
    ORDER BY date
  `);
  return result.rows || result;
}

export async function queryChannelMix(db: DB, days: number) {
  const result = await db.execute(sql`
    SELECT platform,
           SUM(spend)::real as spend,
           SUM(revenue)::real as revenue,
           SUM(conversions)::int as conversions,
           SUM(clicks)::int as clicks,
           SUM(impressions)::int as impressions,
           CASE WHEN SUM(conversions) > 0 THEN (SUM(spend) / SUM(conversions))::real ELSE NULL END as cpa,
           CASE WHEN SUM(spend) > 0 THEN (SUM(revenue) / SUM(spend))::real ELSE NULL END as roas
    FROM ad_metrics_daily
    WHERE date >= current_date - ${days}
    GROUP BY platform
    ORDER BY spend DESC
  `);
  return result.rows || result;
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
           CASE WHEN SUM(amd.spend) > 0 THEN (SUM(amd.revenue) / SUM(amd.spend))::real ELSE NULL END as roas,
           CASE WHEN SUM(amd.conversions) > 0
             THEN (COALESCE(i.available_for_sale_qty, 0) / (SUM(amd.conversions)::real / ${days}))::real
             ELSE NULL END as days_of_stock
    FROM ad_metrics_daily amd
    LEFT JOIN items i ON i.sku = amd.sku
    WHERE amd.date >= current_date - ${days}
    GROUP BY amd.sku, i.name, i.available_for_sale_qty, i.hildale_qty
    ORDER BY spend DESC
  `);
  return result.rows || result;
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
    WHERE cp.measured_at >= now() - (${days} || ' days')::interval
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
    WHERE cp.measured_at >= now() - (${days} || ' days')::interval
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
    WHERE cp.measured_at >= now() - (${days} || ' days')::interval
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
    SELECT EXTRACT(WEEK FROM created_at) as week_num,
           SUM(CASE WHEN EXTRACT(YEAR FROM created_at) = ${currentYear} THEN total_amount::real ELSE 0 END) as current_revenue,
           SUM(CASE WHEN EXTRACT(YEAR FROM created_at) = ${compareYear} THEN total_amount::real ELSE 0 END) as prior_revenue,
           COUNT(CASE WHEN EXTRACT(YEAR FROM created_at) = ${currentYear} THEN 1 END)::int as current_orders,
           COUNT(CASE WHEN EXTRACT(YEAR FROM created_at) = ${compareYear} THEN 1 END)::int as prior_orders
    FROM sales_orders
    WHERE EXTRACT(YEAR FROM created_at) IN (${currentYear}, ${compareYear})
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

  return {
    yoy: yoy.rows || yoy,
    conversionTrends: convTrends.rows || convTrends,
  };
}

export async function queryKPIs(db: DB) {
  const result = await db.execute(sql`
    SELECT SUM(spend)::real as mtd_spend,
           SUM(revenue)::real as mtd_revenue,
           CASE WHEN SUM(spend) > 0 THEN (SUM(revenue) / SUM(spend))::real ELSE NULL END as blended_roas,
           SUM(conversions)::int as total_conversions,
           CASE WHEN SUM(conversions) > 0 THEN (SUM(spend) / SUM(conversions))::real ELSE NULL END as avg_cpa
    FROM ad_metrics_daily
    WHERE date >= date_trunc('month', current_date)
  `);
  const row = (result.rows || result)[0];
  return row || { mtd_spend: 0, mtd_revenue: 0, blended_roas: null, total_conversions: 0, avg_cpa: null };
}
