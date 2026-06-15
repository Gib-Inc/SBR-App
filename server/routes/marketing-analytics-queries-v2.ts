/**
 * Marketing Analytics V2 — CMO decision-making queries
 * Revenue vs target, breakeven ROAS (BOM rollup), channel matrix,
 * customer split, geographic, creative fatigue, wasted spend.
 */

import { sql } from 'drizzle-orm';
import {
  getAdSpendCorrection,
  getCorrectedMonthlyAdSpend,
} from '../services/corrected-ad-spend';

type DB = any;
const rows = (r: any) => r.rows || r;
const r2 = (n: number) => Math.round(n * 100) / 100;

const MONTHLY_TARGET = 375000; // $4.5M / 12

export async function queryRevenueTarget(db: DB) {
  const mtd = await db.execute(sql`
    SELECT COALESCE(SUM(total_amount), 0)::real as mtd_revenue,
           COUNT(*)::int as mtd_orders
    FROM sales_orders
    WHERE order_date >= date_trunc('month', current_date)
      AND status NOT IN ('CANCELLED', 'REFUNDED')
  `);
  const last7 = await db.execute(sql`
    SELECT COALESCE(SUM(total_amount), 0)::real as rev
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(days => 7)
      AND status NOT IN ('CANCELLED', 'REFUNDED')
  `);
  const prior7 = await db.execute(sql`
    SELECT COALESCE(SUM(total_amount), 0)::real as rev
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(days => 14)
      AND order_date < current_date - make_interval(days => 7)
      AND status NOT IN ('CANCELLED', 'REFUNDED')
  `);

  const m = rows(mtd)[0] || { mtd_revenue: 0, mtd_orders: 0 };
  const l7 = rows(last7)[0]?.rev || 0;
  const p7 = rows(prior7)[0]?.rev || 0;

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const projectedMonthEnd = dayOfMonth > 0 ? (m.mtd_revenue / dayOfMonth) * daysInMonth : 0;
  const expectedToDate = MONTHLY_TARGET * (dayOfMonth / daysInMonth);

  return {
    monthlyTarget: MONTHLY_TARGET,
    mtdRevenue: m.mtd_revenue,
    mtdOrders: m.mtd_orders,
    projectedMonthEnd,
    pacePercent: expectedToDate > 0 ? (m.mtd_revenue / expectedToDate) * 100 : 0,
    targetProgressPercent: (m.mtd_revenue / MONTHLY_TARGET) * 100,
    last7: l7,
    prior7: p7,
    trend: l7 > p7 ? 'up' : l7 < p7 ? 'down' : 'flat',
    trendPercent: p7 > 0 ? ((l7 - p7) / p7) * 100 : null,
  };
}

/**
 * BOM cost rollup per finished product, with margin fallback.
 * cost = SUM(component.default_purchase_cost * qty * (1 + wastage/100))
 */
export async function queryBreakevenRoas(db: DB, days: number, fallbackMargin = 0.6) {
  const result = await db.execute(sql`
    WITH bom_cost AS (
      SELECT bom.finished_product_id,
             SUM(COALESCE(comp.default_purchase_cost, 0) * bom.quantity_required * (1 + bom.wastage_percent / 100.0)) as cogs,
             BOOL_AND(comp.default_purchase_cost IS NOT NULL) as cogs_complete
      FROM bill_of_materials bom
      JOIN items comp ON comp.id = bom.component_id
      GROUP BY bom.finished_product_id
    ),
    ad AS (
      SELECT sku, SUM(spend)::real as spend, SUM(revenue)::real as revenue, SUM(conversions)::int as conversions
      FROM ad_metrics_daily
      WHERE date >= current_date - make_interval(days => ${days})
      GROUP BY sku
    )
    SELECT i.sku,
           i.name,
           i.selling_price::real as price,
           bc.cogs::real as bom_cogs,
           bc.cogs_complete,
           ad.spend,
           ad.revenue,
           ad.conversions,
           CASE WHEN ad.spend > 0 THEN (ad.revenue / ad.spend)::real ELSE NULL END as actual_roas
    FROM items i
    LEFT JOIN bom_cost bc ON bc.finished_product_id = i.id
    LEFT JOIN ad ON ad.sku = i.sku
    WHERE i.selling_price IS NOT NULL AND i.selling_price > 0
    ORDER BY ad.spend DESC NULLS LAST
  `);

  // Per-SKU spend has no platform dimension → scale by the corrected window's
  // global factor, then recompute actual ROAS off the corrected spend.
  const { correctSpend } = await getAdSpendCorrection(days);
  return rows(result).map((r: any) => {
    let cogs = r.bom_cogs;
    let costSource: string;
    if (r.cogs_complete && r.bom_cogs > 0) {
      costSource = 'bom';
    } else {
      cogs = r.price * (1 - fallbackMargin);
      costSource = 'estimated';
    }
    const margin = r.price - cogs;
    const breakevenRoas = margin > 0 ? r.price / margin : null;
    const spend = r.spend != null ? correctSpend(null, Number(r.spend)) : 0;
    const revenue = Number(r.revenue) || 0;
    const actualRoas = spend > 0 && revenue > 0 ? r2(revenue / spend) : null;
    return {
      sku: r.sku,
      name: r.name,
      price: r.price,
      cogs,
      costSource,
      breakevenRoas,
      actualRoas,
      spend,
      revenue,
      belowBreakeven: actualRoas != null && breakevenRoas != null && actualRoas < breakevenRoas,
    };
  });
}

// ── Campaign drill-down ──
// Top campaigns by spend, with ROAS. Helps find which campaigns to scale vs pause.
export async function queryCampaignBreakdown(db: DB, days: number, platform?: string) {
  const platformFilter = platform ? sql` AND platform = ${platform}` : sql``;
  const result = await db.execute(sql`
    SELECT platform, campaign,
           SUM(spend)::real as spend, SUM(revenue)::real as revenue,
           SUM(impressions)::int as impressions, SUM(clicks)::int as clicks,
           SUM(conversions)::int as conversions,
           CASE WHEN SUM(spend) > 0 THEN (SUM(revenue) / SUM(spend))::real ELSE NULL END as roas,
           CASE WHEN SUM(clicks) > 0 THEN (SUM(spend) / SUM(clicks))::real ELSE NULL END as cpc,
           CASE WHEN SUM(impressions) > 0 THEN (SUM(clicks)::real / SUM(impressions) * 100)::real ELSE NULL END as ctr
    FROM ad_metrics_daily
    WHERE date >= current_date - make_interval(days => ${days})
      AND campaign <> '_all'
      ${platformFilter}
    GROUP BY platform, campaign
    HAVING SUM(spend) > 0
    ORDER BY spend DESC
    LIMIT 50
  `);
  // Scale each campaign's spend by its platform's correction factor so campaigns
  // reconcile to the corrected platform total; recompute ROAS/CPC off it.
  const { correctSpend } = await getAdSpendCorrection(days);
  return rows(result).map((r: any) => {
    const spend = correctSpend(r.platform, Number(r.spend) || 0);
    const revenue = Number(r.revenue) || 0;
    const clicks = Number(r.clicks) || 0;
    return {
      ...r,
      spend,
      roas: spend > 0 && revenue > 0 ? r2(revenue / spend) : null,
      cpc: clicks > 0 ? r2(spend / clicks) : null,
    };
  });
}

// ── Device efficiency ──
// Mobile vs desktop vs tablet ROAS across platforms.
export async function queryDeviceBreakdown(db: DB, days: number) {
  const result = await db.execute(sql`
    SELECT device, platform,
           SUM(spend)::real as spend, SUM(revenue)::real as revenue,
           SUM(impressions)::int as impressions, SUM(clicks)::int as clicks,
           SUM(conversions)::int as conversions,
           CASE WHEN SUM(spend) > 0 THEN (SUM(revenue) / SUM(spend))::real ELSE NULL END as roas,
           CASE WHEN SUM(clicks) > 0 THEN (SUM(spend) / SUM(clicks))::real ELSE NULL END as cpc
    FROM ad_metrics_daily
    WHERE date >= current_date - make_interval(days => ${days})
      AND device <> '_all'
    GROUP BY device, platform
    HAVING SUM(spend) > 0
    ORDER BY spend DESC
  `);
  const { correctSpend } = await getAdSpendCorrection(days);
  return rows(result).map((r: any) => {
    const spend = correctSpend(r.platform, Number(r.spend) || 0);
    const revenue = Number(r.revenue) || 0;
    const clicks = Number(r.clicks) || 0;
    return {
      ...r,
      spend,
      roas: spend > 0 && revenue > 0 ? r2(revenue / spend) : null,
      cpc: clicks > 0 ? r2(spend / clicks) : null,
    };
  });
}

// ── Geo performance ──
// Ad spend + ROAS by country, cross-referenced with sales_orders revenue.
export async function queryAdGeoPerformance(db: DB, days: number) {
  // Ad spend by country from Windsor
  const adGeo = await db.execute(sql`
    SELECT country,
           SUM(spend)::real as ad_spend, SUM(revenue)::real as ad_revenue,
           SUM(conversions)::int as conversions,
           CASE WHEN SUM(spend) > 0 THEN (SUM(revenue) / SUM(spend))::real ELSE NULL END as roas
    FROM ad_metrics_daily
    WHERE date >= current_date - make_interval(days => ${days})
      AND country <> '_all'
    GROUP BY country
    HAVING SUM(spend) > 0
    ORDER BY ad_spend DESC
    LIMIT 30
  `);
  // Sales revenue by country from Shopify orders
  const salesGeo = await db.execute(sql`
    SELECT UPPER(COALESCE(ship_to_country, 'US')) as country,
           COALESCE(SUM(total_amount), 0)::real as sales_revenue,
           COUNT(*)::int as orders
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(days => ${days})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY UPPER(COALESCE(ship_to_country, 'US'))
  `);

  const salesMap = new Map((rows(salesGeo) as any[]).map(r => [r.country, r]));
  const { correctSpend } = await getAdSpendCorrection(days);
  return rows(adGeo).map((a: any) => {
    const adSpend = correctSpend(null, Number(a.ad_spend) || 0);
    const adRevenue = Number(a.ad_revenue) || 0;
    return {
      country: a.country,
      adSpend,
      adRevenue,
      conversions: a.conversions,
      roas: adSpend > 0 && adRevenue > 0 ? r2(adRevenue / adSpend) : null,
      salesRevenue: salesMap.get(a.country)?.sales_revenue ?? 0,
      salesOrders: salesMap.get(a.country)?.orders ?? 0,
    };
  });
}

export async function queryChannelMatrix(db: DB, days: number) {
  // Spend + platform set come from the corrected source (Windsor > upload >
  // deduped live), so this is identical to the Finances "Ad Spend by Channel"
  // and includes upload-only platforms like Meta. Attributed revenue (if any)
  // comes from ad_metrics_daily for the quadrant heuristic only.
  const raw = await db.execute(sql`
    SELECT platform, SUM(revenue)::real as revenue
    FROM ad_metrics_daily
    WHERE date >= current_date - make_interval(days => ${days})
    GROUP BY platform
  `);
  const revByPlatform = new Map<string, number>();
  for (const r of rows(raw)) {
    const p = String(r.platform || '').toUpperCase();
    revByPlatform.set(p, (revByPlatform.get(p) || 0) + (Number(r.revenue) || 0));
  }
  const { corrected } = await getAdSpendCorrection(days);
  const data = corrected.platforms.map((p) => {
    const revenue = revByPlatform.get(p.platform) || 0;
    return {
      platform: p.platform,
      source: p.source,
      spend: p.spend,
      revenue,
      roas: p.spend > 0 && revenue > 0 ? r2(revenue / p.spend) : null,
    };
  });

  const spends = data.map((d) => d.spend).sort((a, b) => a - b);
  const medianSpend = spends.length ? spends[Math.floor(spends.length / 2)] : 0;
  const roasThreshold = 1.0;
  return data.map((d) => {
    const highRoas = (d.roas ?? 0) >= roasThreshold;
    const highSpend = d.spend >= medianSpend;
    let quadrant: string;
    if (highRoas && highSpend) quadrant = 'scale';
    else if (highRoas && !highSpend) quadrant = 'maintain';
    else if (!highRoas && highSpend) quadrant = 'fix';
    else quadrant = 'cut';
    return { ...d, quadrant };
  });
}

export async function queryCustomerSplit(db: DB, days: number) {
  const result = await db.execute(sql`
    WITH first_orders AS (
      SELECT id, total_amount, channel, order_date,
             MIN(order_date) OVER (PARTITION BY COALESCE(customer_email, external_customer_id, id)) as first_order_date
      FROM sales_orders
      WHERE status NOT IN ('CANCELLED', 'REFUNDED')
    )
    SELECT CASE WHEN order_date = first_order_date THEN 'new' ELSE 'returning' END as customer_type,
           COUNT(*)::int as orders,
           COALESCE(SUM(total_amount), 0)::real as revenue,
           COALESCE(AVG(total_amount), 0)::real as aov
    FROM first_orders
    WHERE order_date >= current_date - make_interval(days => ${days})
    GROUP BY customer_type
  `);

  const byChannel = await db.execute(sql`
    SELECT channel,
           COUNT(*)::int as orders,
           COALESCE(SUM(total_amount), 0)::real as revenue,
           COALESCE(AVG(total_amount), 0)::real as aov
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(days => ${days})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY channel
    ORDER BY revenue DESC
  `);

  return { split: rows(result), byChannel: rows(byChannel) };
}

export async function queryGeographic(db: DB, days: number) {
  const result = await db.execute(sql`
    WITH cur AS (
      SELECT ship_to_state as state,
             COALESCE(SUM(total_amount), 0)::real as revenue,
             COUNT(*)::int as orders
      FROM sales_orders
      WHERE order_date >= current_date - make_interval(days => ${days})
        AND status NOT IN ('CANCELLED', 'REFUNDED')
        AND ship_to_state IS NOT NULL AND ship_to_state != ''
      GROUP BY ship_to_state
    ),
    prev AS (
      SELECT ship_to_state as state,
             COALESCE(SUM(total_amount), 0)::real as revenue
      FROM sales_orders
      WHERE order_date >= current_date - make_interval(days => ${days * 2})
        AND order_date < current_date - make_interval(days => ${days})
        AND status NOT IN ('CANCELLED', 'REFUNDED')
        AND ship_to_state IS NOT NULL AND ship_to_state != ''
      GROUP BY ship_to_state
    )
    SELECT cur.state, cur.revenue, cur.orders,
           CASE WHEN prev.revenue > 0 THEN ((cur.revenue - prev.revenue) / prev.revenue * 100)::real ELSE NULL END as mom_growth
    FROM cur LEFT JOIN prev ON prev.state = cur.state
    ORDER BY cur.revenue DESC
    LIMIT 25
  `);
  return rows(result);
}

export async function queryCreativeFatigue(db: DB, days: number) {
  const result = await db.execute(sql`
    SELECT ca.id, ca.headline, ca.channel,
           cp.ctr::real as ctr, cp.measured_at
    FROM copy_assets ca
    JOIN copy_performance cp ON cp.copy_asset_id = ca.id
    WHERE cp.measured_at >= now() - make_interval(days => ${days})
    ORDER BY ca.id, cp.measured_at
  `);
  const data = rows(result);
  const byAsset = new Map<string, any[]>();
  for (const r of data) {
    if (!byAsset.has(r.id)) byAsset.set(r.id, []);
    byAsset.get(r.id)!.push(r);
  }

  const KILL_CTR = 0.005;
  const out: any[] = [];
  for (const [id, series] of byAsset) {
    if (series.length < 3) {
      out.push({ id, headline: series[0]?.headline, channel: series[0]?.channel, status: 'insufficient_data' });
      continue;
    }
    const peak = Math.max(...series.map(s => s.ctr || 0));
    const current = series[series.length - 1].ctr || 0;
    const first = series[0].ctr || 0;
    const span = series.length - 1;
    const slope = span > 0 ? (current - first) / span : 0; // CTR change per sample
    let daysToKill: number | null = null;
    if (slope < 0 && current > KILL_CTR) {
      daysToKill = Math.round((current - KILL_CTR) / Math.abs(slope));
    }
    out.push({
      id, headline: series[0]?.headline, channel: series[0]?.channel,
      currentCtr: current, peakCtr: peak, slope,
      daysToKill,
      status: slope < 0 ? (daysToKill !== null && daysToKill < 7 ? 'fatiguing' : 'declining') : 'stable',
    });
  }
  return out.sort((a, b) => (a.daysToKill ?? 999) - (b.daysToKill ?? 999));
}

export async function queryWastedSpend(db: DB, days: number) {
  const breakeven = await queryBreakevenRoas(db, days);
  const wasted = breakeven.filter((p: any) => p.belowBreakeven);
  const totalWasted = wasted.reduce((s: number, p: any) => s + (p.spend || 0), 0);
  return {
    totalWasted,
    count: wasted.length,
    items: wasted.map((p: any) => ({
      sku: p.sku, name: p.name, spend: p.spend,
      actualRoas: p.actualRoas, breakevenRoas: p.breakevenRoas,
    })),
  };
}

// ── Shopify-only queries (no ad credentials needed) ──

export async function queryDailyRevenueSpark(db: DB, days: number) {
  const result = await db.execute(sql`
    SELECT (order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date::text as date,
           COALESCE(SUM(total_amount), 0)::real as revenue,
           COUNT(*)::int as orders
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(days => ${days})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY (order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date
    ORDER BY date
  `);
  return rows(result);
}

export async function queryProductMixTrend(db: DB, days: number) {
  const result = await db.execute(sql`
    WITH current_period AS (
      SELECT sol.sku, COALESCE(SUM(sol.qty_ordered * sol.unit_price), 0)::real as revenue,
             SUM(sol.qty_ordered)::int as units
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.sales_order_id
      WHERE so.order_date >= current_date - make_interval(days => ${days})
        AND so.status NOT IN ('CANCELLED', 'REFUNDED')
      GROUP BY sol.sku
    ),
    prior_period AS (
      SELECT sol.sku, COALESCE(SUM(sol.qty_ordered * sol.unit_price), 0)::real as revenue
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.sales_order_id
      WHERE so.order_date >= current_date - make_interval(days => ${days * 2})
        AND so.order_date < current_date - make_interval(days => ${days})
        AND so.status NOT IN ('CANCELLED', 'REFUNDED')
      GROUP BY sol.sku
    )
    SELECT c.sku, i.name,
           c.revenue, c.units,
           CASE WHEN p.revenue > 0 THEN ((c.revenue - p.revenue) / p.revenue * 100)::real ELSE NULL END as growth_pct
    FROM current_period c
    LEFT JOIN prior_period p ON p.sku = c.sku
    LEFT JOIN items i ON i.sku = c.sku
    ORDER BY c.revenue DESC
    LIMIT 15
  `);
  return rows(result);
}

export async function queryRepeatPurchase(db: DB, days: number) {
  const result = await db.execute(sql`
    WITH customer_orders AS (
      SELECT COALESCE(customer_email, external_customer_id, id) as cust_id,
             MIN(order_date) as first_order,
             MAX(order_date) as last_order,
             COUNT(*)::int as order_count,
             SUM(total_amount)::real as lifetime_value
      FROM sales_orders
      WHERE status NOT IN ('CANCELLED', 'REFUNDED')
        AND order_date >= current_date - make_interval(days => ${days})
      GROUP BY cust_id
    )
    SELECT order_count,
           COUNT(*)::int as customers,
           AVG(lifetime_value)::real as avg_ltv,
           AVG(EXTRACT(EPOCH FROM (last_order - first_order)) / 86400)::real as avg_days_between
    FROM customer_orders
    GROUP BY order_count
    ORDER BY order_count
  `);
  return rows(result);
}

export async function queryTopMetrics(db: DB) {
  // Bucket by MOUNTAIN TIME, not UTC. order_date is a naive UTC timestamp; ::date
  // alone splits the day at 6pm MT and mis-attributes evening orders (today inflated,
  // yesterday deflated). Stamp UTC then convert to Denver. Matches daily-company-report.
  const today = await db.execute(sql`
    SELECT COALESCE(SUM(total_amount), 0)::real as revenue, COUNT(*)::int as orders
    FROM sales_orders
    WHERE (order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date = (now() AT TIME ZONE 'America/Denver')::date
      AND status NOT IN ('CANCELLED', 'REFUNDED')
  `);
  const yesterday = await db.execute(sql`
    SELECT COALESCE(SUM(total_amount), 0)::real as revenue, COUNT(*)::int as orders
    FROM sales_orders
    WHERE (order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date = (now() AT TIME ZONE 'America/Denver')::date - 1
      AND status NOT IN ('CANCELLED', 'REFUNDED')
  `);
  const mtd = await db.execute(sql`
    SELECT COALESCE(SUM(total_amount), 0)::real as revenue, COUNT(*)::int as orders,
           COALESCE(AVG(total_amount), 0)::real as aov
    FROM sales_orders
    WHERE (order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date
            >= date_trunc('month', (now() AT TIME ZONE 'America/Denver')::date)::date
      AND status NOT IN ('CANCELLED', 'REFUNDED')
  `);
  const t = rows(today)[0] || { revenue: 0, orders: 0 };
  const y = rows(yesterday)[0] || { revenue: 0, orders: 0 };
  const m = rows(mtd)[0] || { revenue: 0, orders: 0, aov: 0 };
  return {
    todayRevenue: t.revenue, todayOrders: t.orders,
    yesterdayRevenue: y.revenue, yesterdayOrders: y.orders,
    mtdRevenue: m.revenue, mtdOrders: m.orders, aov: m.aov,
  };
}

// ── Monthly rollup queries ──

export async function queryMonthlySales(db: DB, months: number = 12) {
  const result = await db.execute(sql`
    SELECT date_trunc('month', order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date::text as month,
           COALESCE(SUM(total_amount), 0)::real as revenue,
           COUNT(*)::int as orders,
           COALESCE(AVG(total_amount), 0)::real as aov,
           COUNT(DISTINCT COALESCE(customer_email, external_customer_id))::int as unique_customers
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(months => ${months})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY date_trunc('month', order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')
    ORDER BY month
  `);
  return rows(result);
}

export async function queryMonthlyAdSpend(db: DB, months: number = 12) {
  // Spend per (month, platform) comes from the corrected monthly snapshots
  // (Windsor monthly figures), NOT the inflated ad_metrics_daily. Attributed
  // revenue/conversions/clicks are joined from ad_metrics_daily for shape.
  const result = await db.execute(sql`
    SELECT date_trunc('month', date)::date::text as month,
           platform,
           SUM(revenue)::real as revenue,
           SUM(conversions)::int as conversions,
           SUM(clicks)::int as clicks
    FROM ad_metrics_daily
    WHERE date >= current_date - make_interval(months => ${months})
    GROUP BY date_trunc('month', date), platform
  `);
  const rawMap = new Map<string, any>();
  for (const r of rows(result)) {
    const month = String(r.month).slice(0, 7);
    const p = String(r.platform || '').toUpperCase();
    rawMap.set(`${month}|${p}`, r);
  }
  const monthly = await getCorrectedMonthlyAdSpend();
  const out: any[] = [];
  for (const [month, mp] of Array.from(monthly.entries())) {
    for (const [platform, spend] of Object.entries(mp.byPlatform)) {
      const r = rawMap.get(`${month}|${platform}`) || {};
      const revenue = Number(r.revenue) || 0;
      const conversions = Number(r.conversions) || 0;
      const clicks = Number(r.clicks) || 0;
      out.push({
        month: `${month}-01`,
        platform,
        spend,
        revenue,
        conversions,
        clicks,
        roas: spend > 0 && revenue > 0 ? r2(revenue / spend) : null,
        cpa: conversions > 0 ? r2(spend / conversions) : null,
      });
    }
  }
  out.sort((a, b) => (a.month === b.month ? b.spend - a.spend : a.month < b.month ? -1 : 1));
  return out;
}

export async function queryMonthlyBlended(db: DB, months: number = 12) {
  const sales = await db.execute(sql`
    SELECT date_trunc('month', order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date::text as month,
           COALESCE(SUM(total_amount), 0)::real as total_revenue,
           COUNT(DISTINCT COALESCE(customer_email, external_customer_id))::int as new_customers
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(months => ${months})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY date_trunc('month', order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')
    ORDER BY month
  `);
  // Attributed ad revenue / conversions by month for shape (NOT spend).
  const adsRaw = await db.execute(sql`
    SELECT date_trunc('month', date)::date::text as month,
           SUM(revenue)::real as ad_revenue,
           SUM(conversions)::int as total_conversions
    FROM ad_metrics_daily
    WHERE date >= current_date - make_interval(months => ${months})
    GROUP BY date_trunc('month', date)
    ORDER BY month
  `);
  // Historical ad spend (QuickBooks) keyed to month-start, used as a fallback
  // for months with no corrected snapshot yet — keeps the blended ROAS / CAC
  // series continuous back through the QuickBooks history.
  const hist = await db.execute(sql`
    SELECT make_date(year, month, 1)::text as month, COALESCE(ad_spend, 0)::real as ad_spend
    FROM historical_monthly_sales
  `);

  // Corrected monthly ad spend (Windsor snapshots) — the authoritative series.
  const monthly = await getCorrectedMonthlyAdSpend();
  const correctedSpendMap = new Map<string, number>();
  for (const [m, mp] of Array.from(monthly.entries())) correctedSpendMap.set(`${m}-01`, mp.total);

  const salesMap = new Map((rows(sales) as any[]).map(r => [r.month, r]));
  const adsRevMap = new Map((rows(adsRaw) as any[]).map(r => [r.month, r]));
  const histMap = new Map((rows(hist) as any[]).map(r => [r.month, r.ad_spend]));
  const allMonths = new Set([...salesMap.keys(), ...correctedSpendMap.keys(), ...adsRevMap.keys()]);

  return Array.from(allMonths).sort().map(month => {
    const s = salesMap.get(month) || { total_revenue: 0, new_customers: 0 };
    const a = adsRevMap.get(month) || { ad_revenue: 0, total_conversions: 0 };
    // Corrected snapshot spend if present, else fall back to the QuickBooks total.
    const correctedSpend = correctedSpendMap.get(month) || 0;
    const adSpend = correctedSpend > 0 ? correctedSpend : (histMap.get(month) || 0);
    const spendSource = correctedSpend > 0 ? 'corrected' : (histMap.has(month) ? 'historical' : 'none');
    const adRevenue = Number(a.ad_revenue) || 0;
    return {
      month,
      totalRevenue: s.total_revenue,
      adSpend,
      adRevenue,
      spendSource,
      blendedRoas: adSpend > 0 ? r2(s.total_revenue / adSpend) : null,
      adRoas: correctedSpend > 0 && adRevenue > 0 ? r2(adRevenue / correctedSpend) : null,
      cac: s.new_customers > 0 && adSpend > 0 ? r2(adSpend / s.new_customers) : null,
      newCustomers: s.new_customers,
      conversions: a.total_conversions,
      spendToRevenueRatio: s.total_revenue > 0 ? r2(adSpend / s.total_revenue * 100) : null,
    };
  });
}

// ── Sales velocity + multi-year comparison ──

export async function querySalesVelocity(db: DB, days: number) {
  const result = await db.execute(sql`
    WITH daily AS (
      SELECT (order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date as day,
             COALESCE(SUM(total_amount), 0)::real as revenue,
             COUNT(*)::int as orders
      FROM sales_orders
      WHERE order_date >= current_date - make_interval(days => ${days})
        AND status NOT IN ('CANCELLED', 'REFUNDED')
      GROUP BY (order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date
    )
    SELECT AVG(revenue)::real as avg_daily_revenue,
           AVG(orders)::real as avg_daily_orders,
           MAX(revenue)::real as peak_day_revenue,
           MIN(revenue)::real as low_day_revenue,
           STDDEV(revenue)::real as revenue_stddev,
           COUNT(*)::int as days_with_sales
    FROM daily
  `);

  const weekly = await db.execute(sql`
    SELECT EXTRACT(DOW FROM order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver') as dow,
           COALESCE(AVG(total_amount), 0)::real as avg_order_value,
           COUNT(*)::real / GREATEST(COUNT(DISTINCT (order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date), 1) as avg_orders_per_day
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(days => ${days})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY EXTRACT(DOW FROM order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')
    ORDER BY dow
  `);

  const productVelocity = await db.execute(sql`
    SELECT sol.sku, i.name,
           SUM(sol.qty_ordered)::int as units_sold,
           SUM(sol.qty_ordered * sol.unit_price)::real as revenue,
           (SUM(sol.qty_ordered)::real / GREATEST(${days}, 1))::real as units_per_day,
           (SUM(sol.qty_ordered * sol.unit_price)::real / GREATEST(${days}, 1))::real as revenue_per_day,
           COALESCE(i.available_for_sale_qty, 0)::int as current_stock,
           CASE WHEN SUM(sol.qty_ordered) > 0
             THEN (COALESCE(i.available_for_sale_qty, 0)::real / (SUM(sol.qty_ordered)::real / GREATEST(${days}, 1)))::real
             ELSE NULL END as days_of_stock
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    LEFT JOIN items i ON i.sku = sol.sku
    WHERE so.order_date >= current_date - make_interval(days => ${days})
      AND so.status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY sol.sku, i.name, i.available_for_sale_qty
    ORDER BY revenue DESC
    LIMIT 20
  `);

  const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    summary: rows(result)[0] || {},
    byDayOfWeek: rows(weekly).map((r: any) => ({ ...r, dayName: DOW_NAMES[Math.round(r.dow)] })),
    productVelocity: rows(productVelocity),
  };
}

export async function queryMultiYearComparison(db: DB) {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  const result = await db.execute(sql`
    SELECT EXTRACT(YEAR FROM order_date)::int as year,
           EXTRACT(MONTH FROM order_date)::int as month,
           COALESCE(SUM(total_amount), 0)::real as revenue,
           COUNT(*)::int as orders,
           COALESCE(AVG(total_amount), 0)::real as aov,
           COUNT(DISTINCT COALESCE(customer_email, external_customer_id))::int as customers
    FROM sales_orders
    WHERE EXTRACT(YEAR FROM order_date) IN (${years[0]}, ${years[1]}, ${years[2]})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY EXTRACT(YEAR FROM order_date), EXTRACT(MONTH FROM order_date)
    ORDER BY year, month
  `);

  const annual = await db.execute(sql`
    SELECT EXTRACT(YEAR FROM order_date)::int as year,
           COALESCE(SUM(total_amount), 0)::real as revenue,
           COUNT(*)::int as orders,
           COALESCE(AVG(total_amount), 0)::real as aov,
           COUNT(DISTINCT COALESCE(customer_email, external_customer_id))::int as customers
    FROM sales_orders
    WHERE EXTRACT(YEAR FROM order_date) IN (${years[0]}, ${years[1]}, ${years[2]})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY EXTRACT(YEAR FROM order_date)
    ORDER BY year
  `);

  const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthly = rows(result).map((r: any) => ({ ...r, monthName: MONTH_NAMES[r.month] }));

  return {
    years,
    monthly,
    annual: rows(annual),
  };
}

// ── LTV / CAC by acquisition cohort ──
// Groups customers by the MONTH of their first order, then measures the full
// lifetime value of that cohort (all orders ever, not just the cohort month)
// against what it cost to acquire them that month. CAC uses ad spend from
// ad_metrics_daily when present, falling back to historical_monthly_sales.ad_spend
// for months before the platforms were connected — so the series is continuous.
export async function queryLtvCac(db: DB, months: number = 18) {
  // 1. First-order month per customer + their full lifetime value.
  const cohorts = await db.execute(sql`
    WITH customer_first AS (
      SELECT COALESCE(customer_email, external_customer_id, id) as cust_id,
             MIN(order_date) as first_order
      FROM sales_orders
      WHERE status NOT IN ('CANCELLED', 'REFUNDED')
      GROUP BY cust_id
    ),
    customer_ltv AS (
      SELECT COALESCE(o.customer_email, o.external_customer_id, o.id) as cust_id,
             SUM(o.total_amount)::real as lifetime_value,
             COUNT(*)::int as lifetime_orders
      FROM sales_orders o
      WHERE o.status NOT IN ('CANCELLED', 'REFUNDED')
      GROUP BY cust_id
    )
    SELECT EXTRACT(YEAR FROM cf.first_order)::int as year,
           EXTRACT(MONTH FROM cf.first_order)::int as month,
           COUNT(*)::int as new_customers,
           COALESCE(AVG(cl.lifetime_value), 0)::real as avg_ltv,
           COALESCE(SUM(cl.lifetime_value), 0)::real as cohort_revenue,
           COALESCE(AVG(cl.lifetime_orders), 0)::real as avg_orders
    FROM customer_first cf
    JOIN customer_ltv cl ON cl.cust_id = cf.cust_id
    WHERE cf.first_order >= date_trunc('month', current_date) - make_interval(months => ${months})
    GROUP BY EXTRACT(YEAR FROM cf.first_order), EXTRACT(MONTH FROM cf.first_order)
    ORDER BY year, month
  `);

  // 2. Corrected ad spend per month from the snapshot source (Windsor > upload),
  //    NOT the inflated ad_metrics_daily — so CAC is accurate.
  const monthly = await getCorrectedMonthlyAdSpend();

  // 3. Historical ad spend fallback (pre-platform-connection months).
  const histSpend = await db.execute(sql`
    SELECT year, month, COALESCE(ad_spend, 0)::real as ad_spend
    FROM historical_monthly_sales
  `);

  const liveMap = new Map<string, number>();
  for (const [m, mp] of Array.from(monthly.entries())) {
    const year = parseInt(m.slice(0, 4), 10);
    const month = parseInt(m.slice(5, 7), 10); // strips leading zero → matches cohort key
    liveMap.set(`${year}-${month}`, mp.total);
  }
  const histMap = new Map<string, number>();
  for (const r of rows(histSpend)) histMap.set(`${r.year}-${r.month}`, r.ad_spend);

  const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const series = rows(cohorts).map((c: any) => {
    const key = `${c.year}-${c.month}`;
    const adSpend = liveMap.get(key) ?? histMap.get(key) ?? 0;
    const spendSource = liveMap.has(key) ? 'live' : (histMap.has(key) ? 'historical' : 'none');
    const cac = c.new_customers > 0 && adSpend > 0 ? adSpend / c.new_customers : null;
    const ltvCacRatio = cac && cac > 0 ? c.avg_ltv / cac : null;
    return {
      year: c.year,
      month: c.month,
      label: `${MONTH_NAMES[c.month]} ${String(c.year).slice(2)}`,
      newCustomers: c.new_customers,
      avgLtv: c.avg_ltv,
      avgOrders: c.avg_orders,
      cohortRevenue: c.cohort_revenue,
      adSpend,
      spendSource,
      cac,
      ltvCacRatio,
    };
  });

  // Blended summary across the window.
  const totalNew = series.reduce((s: number, r: any) => s + r.newCustomers, 0);
  const totalSpend = series.reduce((s: number, r: any) => s + r.adSpend, 0);
  const totalLtv = series.reduce((s: number, r: any) => s + r.cohortRevenue, 0);
  const blendedCac = totalNew > 0 && totalSpend > 0 ? totalSpend / totalNew : null;
  const blendedLtv = totalNew > 0 ? totalLtv / totalNew : null;
  const blendedRatio = blendedCac && blendedLtv ? blendedLtv / blendedCac : null;

  return {
    series,
    summary: {
      totalNewCustomers: totalNew,
      totalAdSpend: totalSpend,
      blendedCac,
      blendedLtv,
      blendedRatio,
      // Healthy DTC benchmark is 3x. Flag below 3.
      healthy: blendedRatio != null ? blendedRatio >= 3 : null,
    },
  };
}

// ── BOM completeness ──
// For each finished product with a selling price, reports whether it has a BOM
// and whether every component has a default_purchase_cost. Surfaces the gap
// that forces queryBreakevenRoas to fall back to an estimated margin. Sorted
// by ad spend so the team fills in the SKUs that matter to ROAS first.
export async function queryBomCompleteness(db: DB, days: number = 30) {
  const result = await db.execute(sql`
    WITH bom_rollup AS (
      SELECT bom.finished_product_id,
             COUNT(*)::int as component_count,
             COUNT(*) FILTER (WHERE comp.default_purchase_cost IS NULL OR comp.default_purchase_cost = 0)::int as missing_cost_count,
             SUM(COALESCE(comp.default_purchase_cost, 0) * bom.quantity_required * (1 + bom.wastage_percent / 100.0))::real as cogs,
             ARRAY_AGG(comp.name) FILTER (WHERE comp.default_purchase_cost IS NULL OR comp.default_purchase_cost = 0) as missing_components
      FROM bill_of_materials bom
      JOIN items comp ON comp.id = bom.component_id
      GROUP BY bom.finished_product_id
    ),
    ad AS (
      SELECT sku, SUM(spend)::real as spend
      FROM ad_metrics_daily
      WHERE date >= current_date - make_interval(days => ${days})
      GROUP BY sku
    )
    SELECT i.sku, i.name, i.selling_price::real as price,
           COALESCE(br.component_count, 0) as component_count,
           COALESCE(br.missing_cost_count, 0) as missing_cost_count,
           br.cogs,
           br.missing_components,
           COALESCE(ad.spend, 0)::real as ad_spend
    FROM items i
    LEFT JOIN bom_rollup br ON br.finished_product_id = i.id
    LEFT JOIN ad ON ad.sku = i.sku
    WHERE i.type = 'finished_product' AND i.selling_price IS NOT NULL AND i.selling_price > 0
    ORDER BY ad.spend DESC NULLS LAST, i.selling_price DESC
  `);

  const { correctSpend } = await getAdSpendCorrection(days);
  const items = rows(result).map((r: any) => {
    const hasBom = r.component_count > 0;
    const costComplete = hasBom && r.missing_cost_count === 0;
    let status: 'complete' | 'missing_costs' | 'no_bom';
    if (!hasBom) status = 'no_bom';
    else if (costComplete) status = 'complete';
    else status = 'missing_costs';
    return {
      sku: r.sku,
      name: r.name,
      price: r.price,
      componentCount: r.component_count,
      missingCostCount: r.missing_cost_count,
      cogs: costComplete ? r.cogs : null,
      missingComponents: r.missing_components || [],
      adSpend: correctSpend(null, Number(r.ad_spend) || 0),
      status,
    };
  });

  const total = items.length;
  const complete = items.filter((i: any) => i.status === 'complete').length;
  const missingCosts = items.filter((i: any) => i.status === 'missing_costs').length;
  const noBom = items.filter((i: any) => i.status === 'no_bom').length;
  // Spend riding on incomplete COGS — the dollars where break-even ROAS is a guess.
  const spendOnEstimated = items
    .filter((i: any) => i.status !== 'complete')
    .reduce((s: number, i: any) => s + i.adSpend, 0);

  return {
    summary: { total, complete, missingCosts, noBom, completePct: total > 0 ? (complete / total * 100) : null, spendOnEstimated },
    items,
  };
}

// ── Customer cohort intelligence ──
// Repeat-purchase rate, retention, AOV by order-count, and revenue
// concentration (what share of revenue the top decile of customers drives).
// All from sales_orders — no ad APIs needed.
export async function queryCustomerCohorts(db: DB) {
  // Per-customer lifetime stats.
  const perCustomer = await db.execute(sql`
    SELECT COALESCE(customer_email, external_customer_id, id) as cust_id,
           COUNT(*)::int as orders,
           SUM(total_amount)::real as ltv,
           MIN(order_date) as first_order,
           MAX(order_date) as last_order
    FROM sales_orders
    WHERE status NOT IN ('CANCELLED', 'REFUNDED')
      AND COALESCE(customer_email, external_customer_id, id) IS NOT NULL
    GROUP BY cust_id
  `);
  const customers = rows(perCustomer) as any[];
  const total = customers.length;

  if (total === 0) {
    return {
      totalCustomers: 0, repeatCustomers: 0, repeatRate: null, avgOrdersPerCustomer: null,
      oneTime: 0, twoOrders: 0, threePlus: 0,
      revenueConcentration: null, top10PctShare: null, retention90d: null,
      byOrderCount: [],
    };
  }

  const repeat = customers.filter(c => c.orders >= 2).length;
  const oneTime = customers.filter(c => c.orders === 1).length;
  const twoOrders = customers.filter(c => c.orders === 2).length;
  const threePlus = customers.filter(c => c.orders >= 3).length;
  const totalOrders = customers.reduce((s, c) => s + c.orders, 0);
  const totalRevenue = customers.reduce((s, c) => s + (c.ltv || 0), 0);

  // Revenue concentration — top 10% of customers by LTV.
  const sorted = [...customers].sort((a, b) => (b.ltv || 0) - (a.ltv || 0));
  const top10Count = Math.max(1, Math.floor(total * 0.1));
  const top10Revenue = sorted.slice(0, top10Count).reduce((s, c) => s + (c.ltv || 0), 0);
  const top10PctShare = totalRevenue > 0 ? (top10Revenue / totalRevenue * 100) : null;

  // 90-day retention: of customers whose FIRST order was 90-180 days ago
  // (so they had a full window to come back), what share ordered again
  // within 90 days of that first order.
  const now = Date.now();
  const cohortEligible = customers.filter(c => {
    const first = new Date(c.first_order).getTime();
    const ageDays = (now - first) / 86400000;
    return ageDays >= 90 && ageDays <= 180;
  });
  const retained = cohortEligible.filter(c => {
    if (c.orders < 2) return false;
    const first = new Date(c.first_order).getTime();
    const last = new Date(c.last_order).getTime();
    return (last - first) / 86400000 <= 90;
  });
  const retention90d = cohortEligible.length > 0
    ? (retained.length / cohortEligible.length * 100) : null;

  // AOV / LTV by order-count bucket.
  const buckets = [
    { label: '1 order', filter: (c: any) => c.orders === 1 },
    { label: '2 orders', filter: (c: any) => c.orders === 2 },
    { label: '3-4 orders', filter: (c: any) => c.orders >= 3 && c.orders <= 4 },
    { label: '5+ orders', filter: (c: any) => c.orders >= 5 },
  ];
  const byOrderCount = buckets.map(b => {
    const grp = customers.filter(b.filter);
    const rev = grp.reduce((s, c) => s + (c.ltv || 0), 0);
    return {
      label: b.label,
      customers: grp.length,
      revenue: rev,
      avgLtv: grp.length > 0 ? rev / grp.length : 0,
      pctOfRevenue: totalRevenue > 0 ? (rev / totalRevenue * 100) : 0,
    };
  });

  return {
    totalCustomers: total,
    repeatCustomers: repeat,
    repeatRate: total > 0 ? (repeat / total * 100) : null,
    avgOrdersPerCustomer: total > 0 ? totalOrders / total : null,
    oneTime, twoOrders, threePlus,
    top10PctShare,
    retention90d,
    totalRevenue,
    byOrderCount,
  };
}
