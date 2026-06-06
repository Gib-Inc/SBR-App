/**
 * CIPH.R Phase 2 — runway service (I/O layer over the pure runway engine).
 *
 * Gathers the inputs the engine needs from data the app already has:
 *  - Cash on Hand, Operating Expenses, Net Margin  ← latest qb_financial_snapshot
 *  - Variable Ad Spend (daily avg)                  ← ad_metrics_daily, per window
 *  - Sales margin contribution (daily avg)          ← daily_sales_snapshots, per window
 *
 * Three lookback windows feed the three scenarios: 90d conservative, 30d
 * realistic, 7d aggressive. Fixed overhead uses the snapshot's 30-day P&L OpEx
 * (the only OpEx figure available) divided to a daily rate across all scenarios.
 *
 * ANTI-HALLUCINATION (spec §2): cash/overhead/net-margin come straight from the
 * snapshot — if any is null the engine flags it (gaps[] + CALCULATION_GAPPED) and
 * never guesses. Ad spend / revenue default to their actual window sums (0 when
 * there are genuinely no rows — a real zero, not a fabricated value).
 */
import { storage } from "../storage";
import {
  computeRunwayForecast,
  type RunwayForecast,
  type ScenarioInputs,
  type ScenarioKey,
} from "./runway-engine";
import type { InsertFinancialRunwayForecast, FinancialRunwayForecast } from "@shared/schema";

const WINDOW_DAYS: Record<ScenarioKey, number> = { conservative: 90, realistic: 30, aggressive: 7 };

const round2 = (n: number) => Math.round(n * 100) / 100;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const isoToday = () => new Date().toISOString().slice(0, 10);

export interface RunwayComputation {
  forecast: RunwayForecast;
  scenarioInputs: Record<ScenarioKey, ScenarioInputs>;
  snapshotId: string | null;
  netMargin: number | null;
}

/**
 * Gather inputs + run the engine. Pure-ish: reads the DB but does NOT persist,
 * so the route can serve fresh numbers (incl. per-scenario inputs for the
 * client-side What-If slider) without writing a row on every page load.
 */
export async function computeRunway(): Promise<{ ok: boolean; data?: RunwayComputation; error?: string }> {
  const snap = await storage.getLatestQbFinancialSnapshot();
  if (!snap) {
    return { ok: false, error: "No financial snapshot yet — connect QuickBooks and capture one first." };
  }

  const cashOnHand = snap.cashOnHand != null ? Number(snap.cashOnHand) : null;
  const dailyFixedOverhead = snap.operatingExpenses != null ? round2(Number(snap.operatingExpenses) / 30) : null;

  const grossProfit = snap.grossProfit != null ? Number(snap.grossProfit) : null;
  const totalIncome = snap.totalIncome != null ? Number(snap.totalIncome) : null;
  const netMargin =
    grossProfit != null && totalIncome != null && totalIncome !== 0 ? grossProfit / totalIncome : null;

  const buildScenario = async (windowDays: number): Promise<ScenarioInputs> => {
    const start = isoDaysAgo(windowDays);
    const end = isoToday();

    const adRows = await storage.getAdMetricsInRange(start, end);
    const totalAdSpend = adRows.reduce((s, r) => s + (Number(r.spend) || 0), 0);
    const dailyAdSpend = round2(totalAdSpend / windowDays);

    const salesRows = await storage.getDailySalesSnapshotsInRange(start, end);
    const totalNetRevenue = salesRows.reduce((s, r) => s + (Number(r.netRevenue) || 0), 0);
    const avgDailyRevenue = totalNetRevenue / windowDays;
    const dailyMarginContribution = netMargin != null ? round2(avgDailyRevenue * netMargin) : null;

    return { cashOnHand, dailyFixedOverhead, dailyAdSpend, dailyMarginContribution };
  };

  const scenarioInputs: Record<ScenarioKey, ScenarioInputs> = {
    conservative: await buildScenario(WINDOW_DAYS.conservative),
    realistic: await buildScenario(WINDOW_DAYS.realistic),
    aggressive: await buildScenario(WINDOW_DAYS.aggressive),
  };

  const forecast = computeRunwayForecast({
    conservative: scenarioInputs.conservative,
    realistic: scenarioInputs.realistic,
    aggressive: scenarioInputs.aggressive,
    netMarginAverage: netMargin,
  });

  return { ok: true, data: { forecast, scenarioInputs, snapshotId: snap.id, netMargin } };
}

/** Compute + persist a forecast row (used by the daily scheduler). */
export async function computeAndStoreRunway(): Promise<{ ok: boolean; forecast?: FinancialRunwayForecast; error?: string }> {
  const res = await computeRunway();
  if (!res.ok || !res.data) return { ok: false, error: res.error };

  const { forecast, snapshotId } = res.data;
  const toInsert: InsertFinancialRunwayForecast = {
    snapshotId,
    timestamp: new Date(),
    conservativeDays: forecast.conservativeDays,
    realisticDays: forecast.realisticDays,
    aggressiveDays: forecast.aggressiveDays,
    calculatedBurnRate: forecast.burnRate != null ? forecast.burnRate.toFixed(2) : null,
    netMarginAverage: forecast.netMarginAverage != null ? forecast.netMarginAverage.toFixed(4) : null,
    runwayStatus: forecast.status,
    runwayDataGaps: (forecast.dataGaps as unknown) ?? null,
  };
  const saved = await storage.createFinancialRunwayForecast(toInsert);
  return { ok: true, forecast: saved };
}
