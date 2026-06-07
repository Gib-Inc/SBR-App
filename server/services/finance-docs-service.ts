/**
 * CIPH.R Finances (piece 4/4) — derived metrics for the current-period Shopify
 * snapshot. Pure functions over SHOPIFY_PERIOD so the Finances tab can show a
 * live read of the week without re-deriving in the client. Unit-tested.
 *
 * ANTI-HALLUCINATION: these are arithmetic over the document's own numbers
 * (averages, rates, best day) — no estimation or external data.
 */
import { SHOPIFY_PERIOD } from "../data/finance-docs";

export interface ShopifyPeriodMetrics {
  days: number;
  avgDailyTotal: number;
  avgDailyNet: number;
  avgDailyGross: number;
  discountRatePct: number; // discounts / gross sales
  returnRatePct: number; // returns / gross sales
  bestDay: { date: string; totalSales: number } | null;
  slowestDay: { date: string; totalSales: number } | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function shopifyPeriodMetrics(period: typeof SHOPIFY_PERIOD = SHOPIFY_PERIOD): ShopifyPeriodMetrics {
  const daily = period.daily ?? [];
  const days = daily.length;
  const t = period.totals;
  const gross = t.grossSales || 0;

  let best: { date: string; totalSales: number } | null = null;
  let slow: { date: string; totalSales: number } | null = null;
  for (const d of daily) {
    if (!best || d.totalSales > best.totalSales) best = { date: d.date, totalSales: d.totalSales };
    if (!slow || d.totalSales < slow.totalSales) slow = { date: d.date, totalSales: d.totalSales };
  }

  return {
    days,
    avgDailyTotal: days ? round2(t.totalSales / days) : 0,
    avgDailyNet: days ? round2(t.netSales / days) : 0,
    avgDailyGross: days ? round2(gross / days) : 0,
    discountRatePct: gross ? round2((Math.abs(t.discounts) / gross) * 100) : 0,
    returnRatePct: gross ? round2((Math.abs(t.returns) / gross) * 100) : 0,
    bestDay: best,
    slowestDay: slow,
  };
}
