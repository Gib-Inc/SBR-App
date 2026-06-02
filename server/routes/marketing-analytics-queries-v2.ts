/**
 * Marketing Analytics V2 — CMO decision-making queries
 * Revenue vs target, breakeven ROAS (BOM rollup), channel matrix,
 * customer split, geographic, creative fatigue, wasted spend.
 */

import { sql } from 'drizzle-orm';

type DB = any;
const rows = (r: any) => r.rows || r;

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
    return {
      sku: r.sku,
      name: r.name,
      price: r.price,
      cogs,
      costSource,
      breakevenRoas,
      actualRoas: r.actual_roas,
      spend: r.spend || 0,
      revenue: r.revenue || 0,
      belowBreakeven: r.actual_roas != null && breakevenRoas != null && r.actual_roas < breakevenRoas,
    };
  });
}

export async function queryChannelMatrix(db: DB, days: number) {
  const result = await db.execute(sql`
    SELECT platform,
           SUM(spend)::real as spend,
           SUM(revenue)::real as revenue,
           CASE WHEN SUM(spend) > 0 THEN (SUM(revenue) / SUM(spend))::real ELSE 0 END as roas
    FROM ad_metrics_daily
    WHERE date >= current_date - make_interval(days => ${days})
    GROUP BY platform
  `);
  const data = rows(result);
  const spends = data.map((d: any) => d.spend).sort((a: number, b: number) => a - b);
  const medianSpend = spends.length ? spends[Math.floor(spends.length / 2)] : 0;
  const roasThreshold = 1.0;

  return data.map((d: any) => {
    const highRoas = d.roas >= roasThreshold;
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
    SELECT order_date::date::text as date,
           COALESCE(SUM(total_amount), 0)::real as revenue,
           COUNT(*)::int as orders
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(days => ${days})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY order_date::date
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
  const today = await db.execute(sql`
    SELECT COALESCE(SUM(total_amount), 0)::real as revenue, COUNT(*)::int as orders
    FROM sales_orders
    WHERE order_date::date = current_date AND status NOT IN ('CANCELLED', 'REFUNDED')
  `);
  const yesterday = await db.execute(sql`
    SELECT COALESCE(SUM(total_amount), 0)::real as revenue, COUNT(*)::int as orders
    FROM sales_orders
    WHERE order_date::date = current_date - 1 AND status NOT IN ('CANCELLED', 'REFUNDED')
  `);
  const mtd = await db.execute(sql`
    SELECT COALESCE(SUM(total_amount), 0)::real as revenue, COUNT(*)::int as orders,
           COALESCE(AVG(total_amount), 0)::real as aov
    FROM sales_orders
    WHERE order_date >= date_trunc('month', current_date) AND status NOT IN ('CANCELLED', 'REFUNDED')
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
    SELECT date_trunc('month', order_date)::date::text as month,
           COALESCE(SUM(total_amount), 0)::real as revenue,
           COUNT(*)::int as orders,
           COALESCE(AVG(total_amount), 0)::real as aov,
           COUNT(DISTINCT COALESCE(customer_email, external_customer_id))::int as unique_customers
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(months => ${months})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY date_trunc('month', order_date)
    ORDER BY month
  `);
  return rows(result);
}

export async function queryMonthlyAdSpend(db: DB, months: number = 12) {
  const result = await db.execute(sql`
    SELECT date_trunc('month', date)::date::text as month,
           platform,
           SUM(spend)::real as spend,
           SUM(revenue)::real as revenue,
           SUM(conversions)::int as conversions,
           SUM(clicks)::int as clicks,
           CASE WHEN SUM(spend) > 0 THEN (SUM(revenue) / SUM(spend))::real ELSE NULL END as roas,
           CASE WHEN SUM(conversions) > 0 THEN (SUM(spend) / SUM(conversions))::real ELSE NULL END as cpa
    FROM ad_metrics_daily
    WHERE date >= current_date - make_interval(months => ${months})
    GROUP BY date_trunc('month', date), platform
    ORDER BY month, spend DESC
  `);
  return rows(result);
}

export async function queryMonthlyBlended(db: DB, months: number = 12) {
  const sales = await db.execute(sql`
    SELECT date_trunc('month', order_date)::date::text as month,
           COALESCE(SUM(total_amount), 0)::real as total_revenue,
           COUNT(DISTINCT COALESCE(customer_email, external_customer_id))::int as new_customers
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(months => ${months})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY date_trunc('month', order_date)
    ORDER BY month
  `);
  const ads = await db.execute(sql`
    SELECT date_trunc('month', date)::date::text as month,
           SUM(spend)::real as total_spend,
           SUM(revenue)::real as ad_revenue,
           SUM(conversions)::int as total_conversions
    FROM ad_metrics_daily
    WHERE date >= current_date - make_interval(months => ${months})
    GROUP BY date_trunc('month', date)
    ORDER BY month
  `);

  const salesMap = new Map((rows(sales) as any[]).map(r => [r.month, r]));
  const adsMap = new Map((rows(ads) as any[]).map(r => [r.month, r]));
  const allMonths = new Set([...salesMap.keys(), ...adsMap.keys()]);

  return Array.from(allMonths).sort().map(month => {
    const s = salesMap.get(month) || { total_revenue: 0, new_customers: 0 };
    const a = adsMap.get(month) || { total_spend: 0, ad_revenue: 0, total_conversions: 0 };
    return {
      month,
      totalRevenue: s.total_revenue,
      adSpend: a.total_spend,
      adRevenue: a.ad_revenue,
      blendedRoas: a.total_spend > 0 ? s.total_revenue / a.total_spend : null,
      adRoas: a.total_spend > 0 ? a.ad_revenue / a.total_spend : null,
      cac: s.new_customers > 0 ? a.total_spend / s.new_customers : null,
      newCustomers: s.new_customers,
      conversions: a.total_conversions,
      spendToRevenueRatio: s.total_revenue > 0 ? (a.total_spend / s.total_revenue * 100) : null,
    };
  });
}

// ── Sales velocity + multi-year comparison ──

export async function querySalesVelocity(db: DB, days: number) {
  const result = await db.execute(sql`
    WITH daily AS (
      SELECT order_date::date as day,
             COALESCE(SUM(total_amount), 0)::real as revenue,
             COUNT(*)::int as orders
      FROM sales_orders
      WHERE order_date >= current_date - make_interval(days => ${days})
        AND status NOT IN ('CANCELLED', 'REFUNDED')
      GROUP BY order_date::date
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
    SELECT EXTRACT(DOW FROM order_date) as dow,
           COALESCE(AVG(total_amount), 0)::real as avg_order_value,
           COUNT(*)::real / GREATEST(COUNT(DISTINCT order_date::date), 1) as avg_orders_per_day
    FROM sales_orders
    WHERE order_date >= current_date - make_interval(days => ${days})
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY EXTRACT(DOW FROM order_date)
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
