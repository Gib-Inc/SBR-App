/**
 * VECT.R Year-over-Year — "are we up or down vs last year, on sales AND ad spend?"
 *
 * Reads historical_monthly_sales (QuickBooks P&L, monthly revenue + ad_spend +
 * net_income back to 2022) and compares the CURRENT year-to-date against the
 * SAME period last year (Jan → the last complete month of the current year), so
 * a partial 2026 isn't unfairly stacked against a full 2025. Blended only — the
 * app has no full prior-year per-channel ad spend, so this stays at the total
 * level (which is the honest blended ROAS anyway).
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface YoYMetric { thisYear: number; lastYear: number; deltaPct: number | null; }
export interface YoYSummary {
  thisYear: number; lastYear: number; throughMonth: number; throughLabel: string;
  revenue: YoYMetric;
  adSpend: YoYMetric;
  netIncome: { thisYear: number; lastYear: number };
  roas: { thisYear: number | null; lastYear: number | null };
  monthly: { month: number; label: string; revThis: number | null; revLast: number | null; adThis: number | null; adLast: number | null }[];
}

/** Percent change vs last year. Null if last year is zero. Uses |last| so a sign flip reads sanely. */
export function deltaPct(thisY: number, lastY: number): number | null {
  if (!lastY) return null;
  return Math.round(((thisY - lastY) / Math.abs(lastY)) * 1000) / 10;
}

export async function computeYoYSummary(db: DB): Promise<YoYSummary> {
  const raw = rows(await db.execute(sql`
    SELECT year::int AS year, month::int AS month,
           COALESCE(revenue, total_income, 0)::float8 AS revenue,
           COALESCE(ad_spend, 0)::float8 AS ad_spend,
           COALESCE(net_income, 0)::float8 AS net_income
    FROM historical_monthly_sales
    ORDER BY year, month
  `));

  const byYear = new Map<number, Map<number, any>>();
  for (const r of raw) {
    const y = num(r.year), m = num(r.month);
    if (!byYear.has(y)) byYear.set(y, new Map());
    byYear.get(y)!.set(m, r);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const thisYear = years[years.length - 1] ?? new Date().getFullYear();
  const lastYear = thisYear - 1;
  const thisMonths = byYear.get(thisYear) ?? new Map();
  const throughMonth = thisMonths.size ? Math.max(...Array.from(thisMonths.keys())) : 12;

  const ytd = (year: number, field: "revenue" | "ad_spend" | "net_income"): number => {
    const ym = byYear.get(year);
    if (!ym) return 0;
    let s = 0;
    for (let m = 1; m <= throughMonth; m++) s += num(ym.get(m)?.[field]);
    return s;
  };

  const revThis = ytd(thisYear, "revenue"), revLast = ytd(lastYear, "revenue");
  const adThis = ytd(thisYear, "ad_spend"), adLast = ytd(lastYear, "ad_spend");
  const niThis = ytd(thisYear, "net_income"), niLast = ytd(lastYear, "net_income");

  const monthly = MONTHS.map((label, i) => {
    const m = i + 1;
    const t = byYear.get(thisYear)?.get(m);
    const l = byYear.get(lastYear)?.get(m);
    return {
      month: m, label,
      revThis: t ? r0(num(t.revenue)) : null,
      revLast: l ? r0(num(l.revenue)) : null,
      adThis: t ? r0(num(t.ad_spend)) : null,
      adLast: l ? r0(num(l.ad_spend)) : null,
    };
  });

  return {
    thisYear, lastYear, throughMonth, throughLabel: MONTHS[throughMonth - 1] ?? "",
    revenue: { thisYear: r0(revThis), lastYear: r0(revLast), deltaPct: deltaPct(revThis, revLast) },
    adSpend: { thisYear: r0(adThis), lastYear: r0(adLast), deltaPct: deltaPct(adThis, adLast) },
    netIncome: { thisYear: r0(niThis), lastYear: r0(niLast) },
    roas: { thisYear: adThis ? r2(revThis / adThis) : null, lastYear: adLast ? r2(revLast / adLast) : null },
    monthly,
  };
}
