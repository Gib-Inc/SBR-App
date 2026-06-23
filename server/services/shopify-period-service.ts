/**
 * CIPH.R Finances — LIVE current-period Shopify sales.
 *
 * Replaces the old static "Jun 1-6" accountant snapshot (server/data/finance-docs
 * SHOPIFY_PERIOD), which was typed in once and never moved, so the card looked
 * frozen days into the month. This reads the app's own sales_orders (Shopify
 * channel) for the current calendar month-to-date, in America/Denver, so the
 * card always shows today. Gross = order grand totals (total_amount); refunds
 * come from total_refund_amount when present. A simple run-rate projects the
 * full month from the days elapsed.
 *
 * Shopify only — Amazon is a separate channel and is intentionally excluded so
 * this matches what Stacy/Christopher see in the Shopify admin.
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ShopifyPeriodDay { date: string; orders: number; totalSales: number; }
export interface ShopifyPeriodLive {
  available: boolean;
  source: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  refreshedAt: string;
  totals: { totalSales: number; netSales: number; refunds: number; orders: number };
  metrics: {
    days: number;
    daysInMonth: number;
    avgDailyTotal: number;
    avgOrderValue: number;
    bestDay: { date: string; totalSales: number } | null;
    slowestDay: { date: string; totalSales: number } | null;
    projectedMonth: number | null;
  };
  daily: ShopifyPeriodDay[];
  message?: string;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (iso: string) => { const p = iso.split("-"); return `${MON[Number(p[1]) - 1]} ${Number(p[2])}`; };

/**
 * Current calendar month-to-date Shopify sales, by day, in America/Denver.
 * nowMs is injectable for tests; defaults to wall clock in the route.
 */
export async function computeShopifyPeriod(db: DB, nowMs: number): Promise<ShopifyPeriodLive> {
  const TZ = "America/Denver";
  // Daily gross + refunds for the current month, store-local time.
  const res = await db.execute(sql`
    WITH d AS (
      SELECT (order_date AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date AS day,
             total_amount::numeric AS gross,
             COALESCE(total_refund_amount, 0)::numeric AS refund
      FROM sales_orders
      WHERE channel = 'SHOPIFY'
        AND COALESCE(status, '') NOT ILIKE 'cancel%'
        AND (order_date AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})
            >= date_trunc('month', timezone(${TZ}, to_timestamp(${Math.floor(nowMs / 1000)})))
    )
    SELECT to_char(day, 'YYYY-MM-DD') AS date,
           count(*)::int AS orders,
           round(sum(gross), 2) AS gross,
           round(sum(refund), 2) AS refunds
    FROM d GROUP BY day ORDER BY day
  `);
  const list = rows(res) as Array<{ date: string; orders: number; gross: any; refunds: any }>;

  // Period framing from the same store-local clock.
  const metaRes = await db.execute(sql`
    SELECT to_char(date_trunc('month', timezone(${TZ}, to_timestamp(${Math.floor(nowMs / 1000)}))), 'YYYY-MM-DD') AS period_start,
           to_char(timezone(${TZ}, to_timestamp(${Math.floor(nowMs / 1000)})), 'YYYY-MM-DD') AS today,
           extract(day FROM (date_trunc('month', timezone(${TZ}, to_timestamp(${Math.floor(nowMs / 1000)}))) + interval '1 month - 1 day'))::int AS days_in_month,
           extract(day FROM timezone(${TZ}, to_timestamp(${Math.floor(nowMs / 1000)})))::int AS day_of_month,
           to_char(timezone(${TZ}, to_timestamp(${Math.floor(nowMs / 1000)})), 'HH12:MI AM') AS refreshed_at,
           to_char(timezone(${TZ}, to_timestamp(${Math.floor(nowMs / 1000)})), 'Mon FMDD') AS today_label
  `);
  const meta = (rows(metaRes)[0] || {}) as any;
  const periodStart: string = meta.period_start;
  const today: string = meta.today;
  const daysInMonth: number = num(meta.days_in_month) || 30;
  const dayOfMonth: number = num(meta.day_of_month) || list.length;
  const monthName = MON[(parseInt((periodStart || "2026-01-01").split("-")[1], 10) || 1) - 1];

  if (list.length === 0) {
    return {
      available: false,
      source: "Live — sales_orders (Shopify channel)",
      periodLabel: `${monthName} ${(periodStart || "2026-01-01").split("-")[0]}`,
      periodStart, periodEnd: today, currency: "USD",
      refreshedAt: meta.refreshed_at || "",
      totals: { totalSales: 0, netSales: 0, refunds: 0, orders: 0 },
      metrics: { days: 0, daysInMonth, avgDailyTotal: 0, avgOrderValue: 0, bestDay: null, slowestDay: null, projectedMonth: null },
      daily: [],
      message: "No Shopify orders recorded yet this month.",
    };
  }

  const daily: ShopifyPeriodDay[] = list.map((d) => ({
    date: d.date, orders: num(d.orders), totalSales: r2(num(d.gross)),
  }));
  const totalSales = r2(daily.reduce((s, d) => s + d.totalSales, 0));
  const refunds = r2(list.reduce((s, d) => s + num(d.refunds), 0));
  const orders = list.reduce((s, d) => s + num(d.orders), 0);
  const days = daily.length;

  const best = daily.reduce((a, b) => (b.totalSales > a.totalSales ? b : a));
  const slow = daily.reduce((a, b) => (b.totalSales < a.totalSales ? b : a));
  // Run-rate: scale the per-elapsed-day average across the full month.
  const elapsed = Math.max(dayOfMonth, days);
  const projectedMonth = elapsed > 0 ? r2((totalSales / elapsed) * daysInMonth) : null;

  const yr = (periodStart || "2026-01-01").split("-")[0];
  const todayDom = parseInt((today || `${periodStart}`).split("-")[2], 10) || dayOfMonth;
  return {
    available: true,
    source: "Live — sales_orders (Shopify channel)",
    periodLabel: `${monthName} 1–${todayDom}, ${yr}`,
    periodStart,
    periodEnd: today,
    currency: "USD",
    refreshedAt: meta.refreshed_at || "",
    totals: { totalSales, netSales: r2(totalSales - refunds), refunds, orders },
    metrics: {
      days,
      daysInMonth,
      avgDailyTotal: r2(totalSales / days),
      avgOrderValue: orders > 0 ? r2(totalSales / orders) : 0,
      bestDay: { date: best.date, totalSales: best.totalSales },
      slowestDay: { date: slow.date, totalSales: slow.totalSales },
      projectedMonth,
    },
    daily,
  };
}
