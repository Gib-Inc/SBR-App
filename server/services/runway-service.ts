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
  computeScenarioRunway,
  type RunwayForecast,
  type ScenarioInputs,
  type ScenarioResult,
  type ScenarioKey,
} from "./runway-engine";
import type { ExpectedPayouts } from "./expected-payouts-service";
import type { InsertFinancialRunwayForecast, FinancialRunwayForecast } from "@shared/schema";

const WINDOW_DAYS: Record<ScenarioKey, number> = { conservative: 90, realistic: 30, aggressive: 7 };

const round2 = (n: number) => Math.round(n * 100) / 100;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const isoToday = () => new Date().toISOString().slice(0, 10);
/** "Today" in SBR's operating timezone — the seasonal lookup keys off the month. */
const todayMountain = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });

/** "Same as last year" scenario: last year's same upcoming months drive sales. */
export interface SeasonalScenario {
  result: ScenarioResult;
  inputs: ScenarioInputs;
  dailyRevenue: number | null; // last-year seasonal daily net-sales rate
  basisMonths: Array<{ year: number; month: number }>;
  gaps: Array<{ year: number; month: number }>;
}

export interface RunwayComputation {
  forecast: RunwayForecast;
  scenarioInputs: Record<ScenarioKey, ScenarioInputs>;
  /** "If we sell the same as last year" — seasonal scenario (null if no last-year data). */
  seasonal: SeasonalScenario | null;
  /** Sales-derived expected channel payouts (Amazon + Shopify, net of fees) fed into every scenario. */
  inboundReceivables: number;
  snapshotId: string | null;
  netMargin: number | null;
  /** Pillar 4 self-tuning multiplier applied to revenue inputs (1 = untuned). */
  biasCorrectionFactor?: number;
  /** D5: the debt drain in the burn — daily debt service from entered facility terms,
   *  plus how much balance still has NO terms (that debt reads $0 in the burn, so the
   *  runway is optimistic by exactly that omission — flagged, never silent). */
  debtService?: {
    dailyDebtService: number;
    monthlyDebtService: number;
    missingPaymentCount: number;
    missingPaymentBalance: number;
  };
}

/**
 * Gather inputs + run the engine. Pure-ish: reads the DB but does NOT persist,
 * so the route can serve fresh numbers (incl. per-scenario inputs for the
 * client-side What-If slider) without writing a row on every page load.
 */
export async function computeRunway(): Promise<{ ok: boolean; data?: RunwayComputation; error?: string }> {
  // Prefer the latest LIVE QuickBooks capture (real cash + 30-day OpEx); fall back
  // to the most recent snapshot of any kind if no live capture exists yet.
  const snap = (await storage.getLatestQbLiveSnapshot()) ?? (await storage.getLatestQbFinancialSnapshot());
  if (!snap) {
    return { ok: false, error: "No financial snapshot yet — connect QuickBooks and capture one first." };
  }

  const qbCash = snap.cashOnHand != null ? Number(snap.cashOnHand) : null;
  // Prefer the operator-entered bank-confirmed balance so runway days are computed from REAL
  // bank cash, not the lagging QB ledger. Falls back to the snapshot when no fresh entry exists.
  const { db } = await import("../db");
  const { getBankConfirmedOverride } = await import("./cash-flow-service");
  const bankOv = await getBankConfirmedOverride(db).catch(() => null);
  const cashOnHand = bankOv ? bankOv.cashOnHand : qbCash;
  const dailyFixedOverhead = snap.operatingExpenses != null ? round2(Number(snap.operatingExpenses) / 30) : null;

  const asOf = todayMountain();

  // D5: the debt drain. P&L OpEx never contains principal (balance-sheet), so MCA
  // daily debits + loan payments were invisible to every runway — a rosy runway
  // during a debt spiral is the exact failure this app exists to prevent. Sum the
  // entered facility terms to a calendar-daily rate; when facilities are missing
  // terms, the shortfall is FLAGGED (debtService.missingPayment*) rather than
  // guessed. Failure → 0 + no flag update (never fabricated).
  // NOTE (known conservative bias, follow-up logged): the facility payments summed
  // here include their INTEREST portion, and P&L OpEx (dailyFixedOverhead) already
  // carries the interest expense line — bounded double-count ≲$530/day, safe
  // direction, dwarfed by the principal this adds. Netting it properly needs
  // per-facility interest splits.
  let debtService: RunwayComputation["debtService"]; // undefined on failure — never a fabricated all-clear
  try {
    const { computeCreditLines } = await import("./credit-lines-service");
    const cl = await computeCreditLines();
    debtService = {
      dailyDebtService: round2(cl.totals.monthlyDebtService / 30),
      monthlyDebtService: cl.totals.monthlyDebtService,
      missingPaymentCount: cl.totals.missingPaymentCount,
      missingPaymentBalance: cl.totals.missingPaymentBalance,
    };
  } catch (err: any) {
    console.warn("[CIPH.R] debt service for runway failed (runway runs WITHOUT debt in the burn):", err?.message ?? err);
  }

  // Money on its way — the DEFENSIBLE near-cash fed into each scenario's starting
  // cash. This is the sales-derived expected channel payout (Amazon trailing-14d +
  // Shopify trailing-3d, net of fees) — NOT the QB A/R accrual (snap.accountsReceivable),
  // which is a single unverified Amazon journal entry ~2x the real pipeline. Failure
  // leaves it 0 (the runway simply omits the bump — never a fabricated number).
  let ep: ExpectedPayouts | null = null;
  let inboundWithinDays: ((p: ExpectedPayouts, days: number) => number) | null = null;
  try {
    const { db } = await import("../db");
    const mod = await import("./expected-payouts-service");
    ep = await mod.computeExpectedPayouts(db, asOf);
    inboundWithinDays = mod.inboundWithinDays;
  } catch (err: any) {
    console.warn("[CIPH.R] expected-payouts for runway failed:", err?.message ?? err);
  }
  const inboundReceivables = ep ? ep.totalNetExpected : 0; // full pipeline (for display)

  // Credit only the pipeline cash that lands BEFORE the runway runs out. Feeding the
  // full payout to every scenario overstates a distress runway (e.g. a 10-day runway
  // counting Amazon cash that takes 14 days to arrive). 2-pass: compute the runway on
  // cash alone, then re-credit the inbound that settles within that many days. Adding
  // inbound only lengthens the runway, so this single re-pass is conservative (safe).
  const withWindowedInbound = (inputs: ScenarioInputs): ScenarioInputs => {
    if (!ep || !inboundWithinDays || ep.totalNetExpected <= 0) return { ...inputs, inboundReceivables: 0 };
    const prelim = computeScenarioRunway({ ...inputs, inboundReceivables: 0 });
    const inbound =
      prelim.runwayDays == null
        ? ep.totalNetExpected // gapped or cash-flow positive: the full pipeline lands eventually
        : inboundWithinDays(ep, prelim.runwayDays);
    return { ...inputs, inboundReceivables: inbound };
  };

  const grossProfit = snap.grossProfit != null ? Number(snap.grossProfit) : null;
  const totalIncome = snap.totalIncome != null ? Number(snap.totalIncome) : null;
  const netMargin =
    grossProfit != null && totalIncome != null && totalIncome !== 0 ? grossProfit / totalIncome : null;

  // Forecast self-tuning factor (1.0 when untuned). Resolved once per compute
  // so all three scenarios use the same correction.
  let biasFactor = 1;
  try {
    const { getBiasCorrectionFactor } = await import("./forecast-tuning-service");
    biasFactor = await getBiasCorrectionFactor();
  } catch { /* untuned */ }

  const buildScenario = async (windowDays: number): Promise<ScenarioInputs> => {
    const start = isoDaysAgo(windowDays);
    const end = isoToday();

    // Corrected ad spend (Windsor-authoritative > upload > deduped live), NOT the raw
    // ad_metrics_daily sum — that table has overlapping SKU/campaign-grain rows that
    // multi-count spend ~3x, which would overstate burn and shorten the runway falsely.
    let totalAdSpend = 0;
    try {
      const { getCorrectedAdSpendRange } = await import("./corrected-ad-spend");
      const corrected = await getCorrectedAdSpendRange(start, end);
      totalAdSpend = corrected.totalAdSpend ?? 0;
    } catch {
      const adRows = await storage.getAdMetricsInRange(start, end);
      totalAdSpend = adRows.reduce((s, r) => s + (Number(r.spend) || 0), 0);
    }
    const dailyAdSpend = round2(totalAdSpend / windowDays);

    const salesRows = await storage.getDailySalesSnapshotsInRange(start, end);
    const totalNetRevenue = salesRows.reduce((s, r) => s + (Number(r.netRevenue) || 0), 0);
    // Pillar 4 self-tuning: the nightly predicted-vs-actual grader stores a
    // dampened, clamped bias-correction factor (1.0 when untuned). Applying it
    // here means the cash-flow projection inherits every accuracy lesson the
    // model learned — the "gets smarter every day" loop, bounded to ±30%.
    const avgDailyRevenue = (totalNetRevenue / windowDays) * biasFactor;
    const dailyMarginContribution = netMargin != null ? round2(avgDailyRevenue * netMargin) : null;

    // inboundReceivables is applied by withWindowedInbound (2-pass) below, so the
    // amount credited never exceeds what settles before the runway ends.
    return { cashOnHand, dailyFixedOverhead, dailyAdSpend, dailyMarginContribution, dailyDebtService: debtService.dailyDebtService };
  };

  const scenarioInputs: Record<ScenarioKey, ScenarioInputs> = {
    conservative: withWindowedInbound(await buildScenario(WINDOW_DAYS.conservative)),
    realistic: withWindowedInbound(await buildScenario(WINDOW_DAYS.realistic)),
    aggressive: withWindowedInbound(await buildScenario(WINDOW_DAYS.aggressive)),
  };

  const forecast = computeRunwayForecast({
    conservative: scenarioInputs.conservative,
    realistic: scenarioInputs.realistic,
    aggressive: scenarioInputs.aggressive,
    netMarginAverage: netMargin,
  });

  // "Same as last year" seasonal scenario: last year's same upcoming months drive
  // sales (current overhead/ad-spend/margin held constant), so it answers "if this
  // season matches last year, how long does our money last?". Uses the REALISTIC
  // 30-day ad-spend as the held-constant cost basis. Gaps → null (no fabrication).
  let seasonal: SeasonalScenario | null = null;
  try {
    const { db } = await import("../db");
    const { getSeasonalDailyRevenue } = await import("./seasonal-runway");
    const sr = await getSeasonalDailyRevenue(db, asOf, 3);
    const dailyMarginContribution =
      sr.dailyRevenue != null && netMargin != null ? round2(sr.dailyRevenue * biasFactor * netMargin) : null;
    const inputs = withWindowedInbound({
      cashOnHand,
      dailyFixedOverhead,
      dailyAdSpend: scenarioInputs.realistic.dailyAdSpend,
      dailyMarginContribution,
      dailyDebtService: debtService.dailyDebtService,
    });
    seasonal = {
      result: computeScenarioRunway(inputs),
      inputs,
      dailyRevenue: sr.dailyRevenue,
      basisMonths: sr.basisMonths,
      gaps: sr.gaps,
    };
  } catch (err: any) {
    console.warn("[CIPH.R] seasonal runway failed:", err?.message ?? err);
  }

  return {
    ok: true,
    data: { forecast, scenarioInputs, seasonal, inboundReceivables, snapshotId: snap.id, netMargin, biasCorrectionFactor: biasFactor, debtService },
  };
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
