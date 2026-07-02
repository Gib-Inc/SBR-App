/**
 * Seed historical P&L data from QuickBooks export.
 * Full monthly financials: Jan 2022 through May 2026.
 */

import { sql } from 'drizzle-orm';
import { HISTORICAL_PL_DATA } from './historical-pl-data';

type DB = any;
const rows = (r: any) => r.rows || r;

export async function seedHistoricalSales(db: DB): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const row of HISTORICAL_PL_DATA) {
    try {
      const grossMarginPct = row.grossSales > 0 ? (row.grossProfit / row.grossSales) * 100 : 0;
      const res = await db.execute(sql`
        INSERT INTO historical_monthly_sales (year, month, revenue, returns, total_income, cogs, gross_profit, ad_spend, total_expenses, net_income, gross_margin_pct, source)
        VALUES (${row.year}, ${row.month}, ${row.grossSales}, ${row.returns}, ${row.totalIncome}, ${row.cogs}, ${row.grossProfit}, ${row.adSpend}, ${row.totalExpenses}, ${row.netIncome}, ${grossMarginPct}, 'quickbooks')
        ON CONFLICT (year, month) DO UPDATE SET
          revenue = ${row.grossSales}, returns = ${row.returns}, total_income = ${row.totalIncome},
          cogs = ${row.cogs}, gross_profit = ${row.grossProfit}, ad_spend = ${row.adSpend},
          total_expenses = ${row.totalExpenses}, net_income = ${row.netIncome},
          gross_margin_pct = ${grossMarginPct}, source = 'quickbooks'
        WHERE historical_monthly_sales.source <> 'qb_sync'
      `);
      // ^ never overwrite a month the live GL sync owns — the static array is frozen at
      //   May 2026 (and its May is stale); qb_sync rows are the fresher truth.
      // rowCount 0 = the WHERE guard skipped a qb_sync-owned month; report it honestly.
      if (((res as any)?.rowCount ?? 1) > 0) inserted++; else skipped++;
    } catch (e) {
      skipped++;
    }
  }

  return { inserted, skipped };
}

/**
 * Merged query: historical P&L + live Shopify + ad_metrics_daily
 */
export async function queryFullYearComparison(db: DB) {
  const historical = await db.execute(sql`
    SELECT year, month, revenue::real, returns::real, total_income::real,
           cogs::real, gross_profit::real, ad_spend::real,
           total_expenses::real, net_income::real, gross_margin_pct::real, source
    FROM historical_monthly_sales
    ORDER BY year, month
  `);

  const live = await db.execute(sql`
    SELECT EXTRACT(YEAR FROM order_date)::int as year,
           EXTRACT(MONTH FROM order_date)::int as month,
           COALESCE(SUM(total_amount), 0)::real as revenue,
           COUNT(*)::int as orders,
           COUNT(DISTINCT COALESCE(customer_email, external_customer_id))::int as customers
    FROM sales_orders
    WHERE status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY EXTRACT(YEAR FROM order_date), EXTRACT(MONTH FROM order_date)
  `);

  const histRows = rows(historical);
  const liveRows = rows(live);
  const merged = new Map<string, any>();

  for (const h of histRows) {
    merged.set(`${h.year}-${h.month}`, { ...h, orders: 0, customers: 0 });
  }
  for (const l of liveRows) {
    const key = `${l.year}-${l.month}`;
    const existing = merged.get(key);
    if (existing) {
      existing.orders = l.orders;
      existing.customers = l.customers;
    } else {
      merged.set(key, { year: l.year, month: l.month, revenue: l.revenue, orders: l.orders, customers: l.customers, source: 'shopify' });
    }
  }

  const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const allData = Array.from(merged.values()).sort((a, b) => a.year * 100 + a.month - b.year * 100 - b.month);
  const years = [...new Set(allData.map(d => d.year))].sort();

  const annual = years.map(y => {
    const yData = allData.filter(d => d.year === y);
    return {
      year: y,
      revenue: yData.reduce((s, d) => s + (d.revenue || 0), 0),
      cogs: yData.reduce((s, d) => s + (d.cogs || 0), 0),
      grossProfit: yData.reduce((s, d) => s + (d.gross_profit || 0), 0),
      adSpend: yData.reduce((s, d) => s + (d.ad_spend || 0), 0),
      totalExpenses: yData.reduce((s, d) => s + (d.total_expenses || 0), 0),
      netIncome: yData.reduce((s, d) => s + (d.net_income || 0), 0),
      orders: yData.reduce((s, d) => s + (d.orders || 0), 0),
      customers: yData.reduce((s, d) => s + (d.customers || 0), 0),
      monthsReported: yData.length,
    };
  });

  return {
    years,
    monthly: allData.map(d => ({ ...d, monthName: MONTH_NAMES[d.month] })),
    annual,
  };
}

/**
 * Full CMO history: revenue + COGS + ad spend + ROAS + CAC + margin
 * All from historical P&L data (no ad platform API needed)
 */
export async function queryFullCMOHistory(db: DB) {
  const data = await queryFullYearComparison(db);

  const monthly = data.monthly.map((m: any) => ({
    ...m,
    grossMarginPct: m.revenue > 0 ? ((m.gross_profit || 0) / m.revenue * 100) : null,
    adSpendPct: m.revenue > 0 ? ((m.ad_spend || 0) / m.revenue * 100) : null,
    roas: m.ad_spend > 0 ? m.revenue / m.ad_spend : null,
    cac: m.customers > 0 && m.ad_spend > 0 ? m.ad_spend / m.customers : null,
  }));

  const annual = data.annual.map((a: any) => ({
    ...a,
    grossMarginPct: a.revenue > 0 ? (a.grossProfit / a.revenue * 100) : null,
    adSpendPct: a.revenue > 0 ? (a.adSpend / a.revenue * 100) : null,
    roas: a.adSpend > 0 ? a.revenue / a.adSpend : null,
    cac: a.customers > 0 && a.adSpend > 0 ? a.adSpend / a.customers : null,
  }));

  return { years: data.years, monthly, annual };
}
