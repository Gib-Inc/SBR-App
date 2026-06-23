/**
 * COUNT.M Seasonal inventory-spend forecast — the forward view the reactive
 * "anticipation" card lacks. It projects component purchasing $ for the next N
 * months by deseasonalizing current velocity and re-applying each upcoming
 * month's seasonal index, so the fall peak is visible months ahead and the
 * long-lead build-up can start on time.
 *
 *   deseasonalized weekly $ = (component weekly demand / current-season factor) × WAC
 *   month M spend           = Σ deseasonalized weekly $ × weeks/month × index[M]
 */
import { DEFAULT_SEASONAL_INDEX, monthIndex } from "./seasonal-index";
import { computeReorderNeeds } from "./reorder-service";

type DB = any;
const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;
const WEEKS_PER_MONTH = 4.333;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface SeasonalSpendMonth {
  month: number; year: number; label: string;
  seasonalFactor: number; projectedSpend: number; vsBaselinePct: number;
}
export interface SeasonalSpendForecast {
  monthly: SeasonalSpendMonth[];
  baselineMonthlySpend: number;
  currentMonth: string;
  peak: { label: string; spend: number; factor: number } | null;
  next3MonthsSpend: number;
  avgLeadDays: number;
  // When to start ordering for the peak month (peak − lead − ~2wk production).
  orderByForPeak: { peakLabel: string; orderByLabel: string } | null;
}

export async function computeSeasonalSpendForecast(db: DB, opts: { months?: number } = {}): Promise<SeasonalSpendForecast> {
  const horizon = Math.max(1, Math.min(12, opts.months ?? 6));
  const needs = await computeReorderNeeds(db);
  const now = new Date();
  const curMonth0 = now.getMonth(); // 0-11

  // Current-season factor = trailing-3-month average index (matches the velocity window).
  let cf = 0;
  for (let k = 0; k < 3; k++) cf += monthIndex(DEFAULT_SEASONAL_INDEX, (((curMonth0 - k) % 12) + 12) % 12 + 1);
  const currentFactor = cf > 0 ? cf / 3 : 1;

  // Deseasonalized weekly purchasing $ per component (an average-month-equivalent rate).
  const comps = needs
    .filter((nd) => nd.weeklyDemand > 0 && nd.unitCost > 0)
    .map((nd) => ({ deseasonWeeklySpend: (nd.weeklyDemand / currentFactor) * nd.unitCost, lead: nd.leadTimeDays }));

  const baselineMonthlySpend = r0(comps.reduce((s, c) => s + c.deseasonWeeklySpend * WEEKS_PER_MONTH, 0));

  const monthly: SeasonalSpendMonth[] = [];
  for (let m = 0; m < horizon; m++) {
    const idx0 = (curMonth0 + m) % 12;
    const year = now.getFullYear() + Math.floor((curMonth0 + m) / 12);
    const factor = monthIndex(DEFAULT_SEASONAL_INDEX, idx0 + 1);
    const spend = r0(comps.reduce((s, c) => s + c.deseasonWeeklySpend * WEEKS_PER_MONTH * factor, 0));
    monthly.push({
      month: idx0 + 1, year, label: MONTHS[idx0],
      seasonalFactor: r2(factor), projectedSpend: spend,
      vsBaselinePct: baselineMonthlySpend > 0 ? Math.round((spend / baselineMonthlySpend - 1) * 100) : 0,
    });
  }

  const peakM = monthly.reduce((a, b) => (b.projectedSpend > a.projectedSpend ? b : a), monthly[0]);
  const peak = peakM ? { label: peakM.label, spend: peakM.projectedSpend, factor: peakM.seasonalFactor } : null;
  const next3MonthsSpend = r0(monthly.slice(0, 3).reduce((s, x) => s + x.projectedSpend, 0));
  const avgLeadDays = comps.length ? Math.round(comps.reduce((s, c) => s + c.lead, 0) / comps.length) : 14;

  // Order-by = peak month minus (avg lead + ~2 weeks production buffer).
  let orderByForPeak: SeasonalSpendForecast["orderByForPeak"] = null;
  if (peakM) {
    const leadPlusBuildWeeks = avgLeadDays / 7 + 2;
    const orderBy = new Date(peakM.year, peakM.month - 1, 1);
    orderBy.setDate(orderBy.getDate() - Math.round(leadPlusBuildWeeks * 7));
    orderByForPeak = { peakLabel: peakM.label, orderByLabel: MONTHS[orderBy.getMonth()] };
  }

  return {
    monthly, baselineMonthlySpend, currentMonth: MONTHS[curMonth0],
    peak, next3MonthsSpend, avgLeadDays, orderByForPeak,
  };
}
