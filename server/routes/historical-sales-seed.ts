/**
 * Seed historical monthly sales from the Gross Sales spreadsheet.
 * Data: Jan 2022 through May 2026.
 * Run once via: POST /api/marketing-analytics/cmo/seed-historical
 */

import { sql } from 'drizzle-orm';

type DB = any;

const HISTORICAL_DATA = [
  // [year, jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec]
  [2022, 7127.28, 5168.31, 4498.06, 193882.93, 77271.09, 66324.94, 34523.27, 64207.37, 65373.90, 116400.64, 58154.06, 46211.04],
  [2023, 69558.27, 63918.30, 144980.36, 110487.43, 109015.84, 83565.85, 85641.28, 92961.16, 107541.26, 122233.03, 118954.85, 71213.24],
  [2024, 58556.54, 130005.47, 168159.87, 158778.33, 124794.87, 133868.85, 203886.44, 212893.98, 213974.05, 371959.84, 205646.43, 169983.32],
  [2025, 101576.56, 172120.64, 366406.42, 229073.16, 181794.55, 158175.62, 232394.40, 351526.14, 314993.43, 529529.50, 419746.54, 198756.21],
  [2026, 154770.13, 283151.00, 441269.00, 280979.00, 163474.64, null, null, null, null, null, null, null],
];

export async function seedHistoricalSales(db: DB): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const row of HISTORICAL_DATA) {
    const year = row[0] as number;
    for (let m = 1; m <= 12; m++) {
      const revenue = row[m] as number | null;
      if (revenue == null) continue;

      try {
        await db.execute(sql`
          INSERT INTO historical_monthly_sales (year, month, revenue, source)
          VALUES (${year}, ${m}, ${revenue}, 'spreadsheet')
          ON CONFLICT (year, month) DO UPDATE SET revenue = ${revenue}, source = 'spreadsheet'
        `);
        inserted++;
      } catch (e) {
        skipped++;
      }
    }
  }

  return { inserted, skipped };
}

/**
 * Query that merges historical spreadsheet data with live Shopify data.
 * Historical takes precedence for completed months.
 * Current month uses live Shopify if available.
 */
export async function queryFullYearComparison(db: DB) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  // Get historical data
  const historical = await db.execute(sql`
    SELECT year, month, revenue::real as revenue, source
    FROM historical_monthly_sales
    ORDER BY year, month
  `);

  // Get live Shopify data for current year (overrides historical for current month)
  const live = await db.execute(sql`
    SELECT EXTRACT(YEAR FROM order_date)::int as year,
           EXTRACT(MONTH FROM order_date)::int as month,
           COALESCE(SUM(total_amount), 0)::real as revenue,
           COUNT(*)::int as orders,
           COUNT(DISTINCT COALESCE(customer_email, external_customer_id))::int as customers
    FROM sales_orders
    WHERE EXTRACT(YEAR FROM order_date) >= ${currentYear - 2}
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY EXTRACT(YEAR FROM order_date), EXTRACT(MONTH FROM order_date)
    ORDER BY year, month
  `);

  const rows = (r: any) => r.rows || r;
  const histRows = rows(historical) as any[];
  const liveRows = rows(live) as any[];

  // Build merged dataset: historical base, live overlay for recent data
  const merged = new Map<string, any>();

  for (const h of histRows) {
    const key = `${h.year}-${h.month}`;
    merged.set(key, { year: h.year, month: h.month, revenue: h.revenue, source: h.source, orders: null, customers: null });
  }

  for (const l of liveRows) {
    const key = `${l.year}-${l.month}`;
    const existing = merged.get(key);
    if (!existing || l.year === currentYear) {
      // Live data overrides for current year, supplements for past years
      merged.set(key, {
        year: l.year, month: l.month,
        revenue: l.year === currentYear ? l.revenue : (existing?.revenue || l.revenue),
        source: l.year === currentYear ? 'shopify' : (existing?.source || 'shopify'),
        orders: l.orders,
        customers: l.customers,
      });
    }
  }

  const allData = Array.from(merged.values()).sort((a, b) => a.year * 100 + a.month - b.year * 100 - b.month);
  const years = [...new Set(allData.map(d => d.year))].sort();

  // Annual totals
  const annual = years.map(y => {
    const yearData = allData.filter(d => d.year === y);
    return {
      year: y,
      revenue: yearData.reduce((s, d) => s + (d.revenue || 0), 0),
      orders: yearData.reduce((s, d) => s + (d.orders || 0), 0),
      customers: yearData.reduce((s, d) => s + (d.customers || 0), 0),
      monthsReported: yearData.length,
    };
  });

  const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return {
    years,
    monthly: allData.map(d => ({ ...d, monthName: MONTH_NAMES[d.month] })),
    annual,
  };
}
