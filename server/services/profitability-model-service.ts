/**
 * CIPH.R Path-to-Profitability model. Derives the real cost structure from the
 * QuickBooks monthly P&L (COGS %, fixed monthly nut, current blended ROAS), then
 * projects the rest of the year: actual YTD net + remaining months priced off
 * last year's same-month revenue scaled by an outperformance %, at a chosen
 * blended ROAS. Surfaces the "standard to success" — the ROAS needed to finish
 * the year in the black at a given revenue.
 *
 *   month net = revenue × (1 − COGS%) − revenue/ROAS − fixedMonthly
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface ProfitModel {
  thisYear: number;
  ytdThroughMonth: number;
  cogsPct: number;
  fixedMonthly: number;
  currentRoas: number | null;
  ytdNet: number;
  ytdRevenue: number;
  remainingMonths: { month: number; label: string; lastYearRevenue: number }[];
}

/** Pure projection — same formula the card runs live. */
export function projectFullYear(
  model: ProfitModel,
  roas: number,
  outperformPct: number,
): { fullYearNet: number; remainingNet: number; monthly: { label: string; revenue: number; net: number }[]; breakevenRoas: number | null } {
  const mult = 1 + outperformPct / 100;
  const monthly = model.remainingMonths.map((m) => {
    const rev = m.lastYearRevenue * mult;
    const ad = roas > 0 ? rev / roas : 0;
    const net = rev * (1 - model.cogsPct) - ad - model.fixedMonthly;
    return { label: m.label, revenue: Math.round(rev), net: Math.round(net) };
  });
  const remainingNet = monthly.reduce((s, x) => s + x.net, 0);
  const fullYearNet = Math.round(model.ytdNet + remainingNet);

  // Breakeven ROAS at this revenue: solve fullYearNet = 0 for ROAS.
  const R = model.remainingMonths.reduce((s, m) => s + m.lastYearRevenue * mult, 0);
  const denom = model.ytdNet + R * (1 - model.cogsPct) - model.remainingMonths.length * model.fixedMonthly;
  const breakevenRoas = denom > 0 ? Math.round((R / denom) * 100) / 100 : null; // null → revenue too low for any ROAS

  return { fullYearNet, remainingNet: Math.round(remainingNet), monthly, breakevenRoas };
}

export async function computeProfitabilityModel(db: DB): Promise<ProfitModel> {
  const hist = rows(await db.execute(sql`
    SELECT year::int AS year, month::int AS month,
           COALESCE(revenue, total_income, 0)::float8 AS revenue,
           COALESCE(cogs, 0)::float8 AS cogs,
           COALESCE(ad_spend, 0)::float8 AS ad_spend,
           COALESCE(net_income, 0)::float8 AS net_income
    FROM historical_monthly_sales
    ORDER BY year, month`));

  const years = (Array.from(new Set(hist.map((r: any) => num(r.year)))) as number[]).sort((a, b) => a - b);
  const thisYear = years[years.length - 1] ?? new Date().getFullYear();
  const lastYear = thisYear - 1;
  const cur = hist.filter((r: any) => num(r.year) === thisYear);
  const ytdThroughMonth = cur.length ? Math.max(...cur.map((r: any) => num(r.month))) : 0;

  const sum = (arr: any[], f: (r: any) => number) => arr.reduce((s, r) => s + f(r), 0);
  const rev = sum(cur, (r) => num(r.revenue));
  const cogs = sum(cur, (r) => num(r.cogs));
  const ad = sum(cur, (r) => num(r.ad_spend));
  const net = sum(cur, (r) => num(r.net_income));

  const cogsPct = rev > 0 ? Math.round((cogs / rev) * 1000) / 1000 : 0.46;
  // Fixed monthly = the non-COGS, non-ad nut (opex + overhead + interest), averaged.
  const fixedMonthly = cur.length ? Math.round((rev - cogs - ad - net) / cur.length) : 0;
  const currentRoas = ad > 0 ? Math.round((rev / ad) * 100) / 100 : null;

  const lastByMonth = new Map<number, any>();
  for (const r of hist.filter((r: any) => num(r.year) === lastYear)) lastByMonth.set(num(r.month), r);

  const remainingMonths: ProfitModel["remainingMonths"] = [];
  for (let m = ytdThroughMonth + 1; m <= 12; m++) {
    remainingMonths.push({ month: m, label: MONTHS[m - 1], lastYearRevenue: Math.round(num(lastByMonth.get(m)?.revenue)) });
  }

  return {
    thisYear, ytdThroughMonth, cogsPct, fixedMonthly, currentRoas,
    ytdNet: Math.round(net), ytdRevenue: Math.round(rev), remainingMonths,
  };
}
