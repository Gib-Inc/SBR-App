/**
 * CIPH.R Finances — "Reset Impact" view.
 *
 * Answers: since the May reset, are losses per month shrinking and is ROAS
 * improving? Builds a per-CALENDAR-MONTH P&L trend from the QuickBooks GL
 * (qb_pl_detail) — INCLUDING the current month-to-date — plus blended MER per
 * month from the canonical corrected ad-spend reader. Reuses rollup/classifyAccount
 * from finance-pnl-service (same math as the Budget Scorecard) so the numbers agree.
 *
 * Because the current month is partial and QB postings lag, the headline comparison
 * is a PACE check: this month so far vs the SAME day-range of the prior month
 * (e.g. Jun 1-27 vs May 1-27) — apples to apples. Reports + flags; never writes to QB.
 */
import { sql } from "drizzle-orm";
import { rollup } from "./finance-pnl-service";
import { getDedupedMonthlyGl, getDedupedRangeGl } from "./gl-reader";

type DB = any;
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number): number | null => (whole > 0 ? r2((part / whole) * 100) : null);

export interface ResetImpactMonth {
  month: string; partial: boolean;
  netSales: number; cogs: number; grossProfit: number; grossMarginPct: number | null;
  totalExpenses: number; netIncome: number; netMarginPct: number | null;
  adSpend: number | null; blendedMer: number | null;
}
export interface ResetImpactPace {
  throughDay: number;
  current: { label: string; netSales: number; netIncome: number; adSpend: number | null; blendedMer: number | null };
  prior: { label: string; netSales: number; netIncome: number; adSpend: number | null; blendedMer: number | null };
  delta: { netSales: number; netIncome: number; blendedMer: number | null };
  // True when the current month has ~no posted sales but the prior period did — QB
  // postings lag, so a red "collapse" would be a data artifact, not reality.
  currentDataPending: boolean;
}
export interface LossTrend {
  completeMonths: number;
  negativeCount: number; // how many of the complete months were a loss
  allNegative: boolean;
  latest: { month: string; netIncome: number } | null;
  baseline: { month: string; netIncome: number } | null; // ~lookback complete months earlier
  monthsBetween: number;
  improvedBy: number | null; // latest − baseline (>0 = less in the red / better)
  direction: "improving" | "worsening" | "flat" | "unknown";
}

export interface ResetImpact {
  months: ResetImpactMonth[];
  pace: ResetImpactPace | null;
  lossTrend: LossTrend;
  asOf: string;
  postedThrough: string | null; // last date posted to the GL for the current month
  notes: string[];
  source: string; authoritative: string;
}

/** Pure: summarize the monthly net-income trend over the complete months — are we
 *  in the red every month, and less so than ~`lookback` months ago? */
export function computeLossTrend(months: ResetImpactMonth[], lookback = 6): LossTrend {
  const complete = months.filter((m) => !m.partial);
  const negativeCount = complete.filter((m) => m.netIncome < 0).length;
  const lastIdx = complete.length - 1;
  const latest = lastIdx >= 0 ? complete[lastIdx] : null;
  const baseIdx = Math.max(0, lastIdx - lookback);
  const baseline = lastIdx > baseIdx ? complete[baseIdx] : null; // null when only one complete month
  const improvedBy = latest && baseline ? r2(latest.netIncome - baseline.netIncome) : null;
  const direction = improvedBy == null ? "unknown" : improvedBy > 1 ? "improving" : improvedBy < -1 ? "worsening" : "flat";
  return {
    completeMonths: complete.length,
    negativeCount,
    allNegative: complete.length > 0 && negativeCount === complete.length,
    latest: latest ? { month: latest.month, netIncome: latest.netIncome } : null,
    baseline: baseline ? { month: baseline.month, netIncome: baseline.netIncome } : null,
    monthsBetween: baseline ? lastIdx - baseIdx : 0,
    improvedBy,
    direction,
  };
}

/** Pure: assemble per-month rows + blended MER from grouped account rows. */
export function assembleResetMonths(
  byMonth: Map<string, Array<{ account: string; amount: number }>>,
  spendByMonth: Record<string, number | null>,
  currentMonth: string,
): ResetImpactMonth[] {
  return Array.from(byMonth.keys()).sort().map((m) => {
    const r = rollup(byMonth.get(m)!);
    const partial = m === currentMonth;
    const adSpend = m in spendByMonth ? spendByMonth[m] : null;
    // A partial month with no sales posted yet (only expenses) would show a deflated
    // MER / negative margins that are pure posting-lag artifacts — null them instead.
    const salesPosted = r.netSales > 0;
    const blendedMer = adSpend != null && adSpend > 0 && salesPosted ? r2(r.netSales / adSpend) : null;
    const derivedOk = !partial || salesPosted;
    return {
      month: m, partial,
      netSales: r.netSales, cogs: r.cogs, grossProfit: r.grossProfit,
      grossMarginPct: derivedOk ? pct(r.grossProfit, r.netSales) : null,
      totalExpenses: r.totalExpenses, netIncome: r.netIncome,
      netMarginPct: derivedOk ? pct(r.netIncome, r.netSales) : null,
      adSpend, blendedMer,
    };
  });
}

/** Pure: same-day-range windows for an apples-to-apples month-to-date pace check.
 *  today 'YYYY-MM-DD' → current [1..D] of this month vs prior month [1..min(D, prior length)]. */
export function paceRanges(today: string): { curStart: string; curEnd: string; priorStart: string; priorEnd: string; throughDay: number } {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), d = Number(today.slice(8, 10));
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const priorLen = new Date(Date.UTC(py, pm, 0)).getUTCDate(); // last day of prior month
  const pd = Math.min(d, priorLen);
  const pad = (x: number) => String(x).padStart(2, "0");
  return {
    curStart: `${y}-${pad(m)}-01`, curEnd: today,
    priorStart: `${py}-${pad(pm)}-01`, priorEnd: `${py}-${pad(pm)}-${pad(pd)}`,
    throughDay: d,
  };
}

export async function getResetImpact(db: DB, monthsBack = 7): Promise<ResetImpact> {
  // Mountain-time clock — txn_date is the business's local calendar date, so the
  // month/day boundary must be Mountain, not the server's UTC (else the "current
  // month" flips early each evening / at month-end).
  const MT = sql`(now() AT TIME ZONE 'America/Denver')`;
  const clk = rows(await db.execute(sql`SELECT to_char(${MT}, 'YYYY-MM') AS m, ${MT}::date::text AS d`))[0] || {};
  const currentMonth = String(clk.m ?? "");
  const today = String(clk.d ?? "");

  // The GL's actual posted-through date for the current month. QB posts sales with a
  // lag, so the partial month is windowed to THIS date on BOTH sides (sales AND ad
  // spend) — otherwise a few days of posted sales over a full month of spend reads as
  // an MER collapse that is really just posting lag.
  const glRow = rows(await db.execute(sql`
    SELECT max(txn_date)::text AS d FROM qb_pl_detail
    WHERE txn_date >= date_trunc('month', ${MT}) AND txn_date <= ${MT}::date`))[0] || {};
  const glThrough: string | null = glRow.d ?? null;

  // Per-month, per-account totals INCLUDING the current (partial) month; future-dated
  // excluded — via the shared mirror-deduped reader ('toDate' = through MT today).
  const data = await getDedupedMonthlyGl(db, { monthsBack, cutoff: "toDate" });
  const byMonth = new Map<string, Array<{ account: string; amount: number }>>();
  for (const r of data) {
    const a = byMonth.get(r.month) ?? [];
    a.push({ account: r.account, amount: r.amount });
    byMonth.set(r.month, a);
  }

  const { getCorrectedAdSpendRange } = await import("./corrected-ad-spend");
  const spendForRange = async (start: string, end: string): Promise<number | null> => {
    if (!start || !end || end < start) return null;
    try { return (await getCorrectedAdSpendRange(start, end)).totalAdSpend ?? null; } catch { return null; }
  };

  // Ad spend per month. The current month is clipped to glThrough so its MER window
  // matches the posted-sales window; complete months use the full month. Parallel.
  const monthKeys = Array.from(byMonth.keys());
  const spends = await Promise.all(monthKeys.map((m) => {
    const [yy, mm] = String(m).split("-").map(Number);
    const first = `${m}-01`;
    const lastCal = `${m}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, "0")}`;
    const end = m === currentMonth ? (glThrough ?? (lastCal > today ? today : lastCal)) : lastCal;
    return spendForRange(first, end).then((v) => [m, v] as const);
  }));
  const spendByMonth: Record<string, number | null> = {};
  for (const [m, v] of spends) spendByMonth[m] = v;

  const months = assembleResetMonths(byMonth, spendByMonth, currentMonth);

  // Pace: current vs prior month over the SAME posted day-range (windowed to glThrough),
  // so sales and spend cover identical windows on both sides — apples to apples.
  const rangeRollup = async (start: string, end: string) => rollup(await getDedupedRangeGl(db, start, end));
  let pace: ResetImpactPace | null = null;
  if (glThrough) {
    const pr = paceRanges(glThrough);
    const [curR, priorR, curSpend, priorSpend] = await Promise.all([
      rangeRollup(pr.curStart, pr.curEnd), rangeRollup(pr.priorStart, pr.priorEnd),
      spendForRange(pr.curStart, pr.curEnd), spendForRange(pr.priorStart, pr.priorEnd),
    ]);
    const mer = (ns: number, ad: number | null) => (ad != null && ad > 0 && ns > 0 ? r2(ns / ad) : null);
    const curMer = mer(curR.netSales, curSpend), priorMer = mer(priorR.netSales, priorSpend);
    // Even with aligned windows, guard the case where only expenses have posted (sales not yet).
    const currentDataPending = curR.netSales <= 0 && priorR.netSales > 0;
    pace = {
      throughDay: pr.throughDay,
      current: { label: currentMonth, netSales: curR.netSales, netIncome: curR.netIncome, adSpend: curSpend, blendedMer: curMer },
      prior: { label: pr.priorStart.slice(0, 7), netSales: priorR.netSales, netIncome: priorR.netIncome, adSpend: priorSpend, blendedMer: priorMer },
      delta: {
        netSales: r2(curR.netSales - priorR.netSales),
        netIncome: r2(curR.netIncome - priorR.netIncome),
        blendedMer: curMer != null && priorMer != null ? r2(curMer - priorMer) : null,
      },
      currentDataPending,
    };
  }

  return {
    months, pace, lossTrend: computeLossTrend(months), asOf: today, postedThrough: glThrough,
    notes: [
      "Net sales, margins and net income are from the QuickBooks GL (qb_pl_detail) by calendar month — same source as the Budget Scorecard.",
      glThrough
        ? `Current month shown through ${glThrough}, the last date posted to the GL (QuickBooks posts sales with a lag). The pace compares the SAME day-range of the prior month — apples to apples on posted data.`
        : "The current month has no posted GL data yet — the pace comparison appears once QuickBooks posts.",
      "Blended MER = net sales ÷ corrected ad spend (collapse-overlapping + source-tier + proration). COGS is still the 35% plug, so net income reflects that until measured COGS is booked.",
    ],
    source: "gl+corrected_ad_spend", authoritative: "quickbooks",
  };
}
