/**
 * ForecastTuningService — Pillar 4 production wiring ("gets smarter every day").
 * -----------------------------------------------------------------------------
 * The nightly feedback loop over the pure forecast-accuracy core:
 *
 *   1. ACTUALIZE — fill yesterday's (and any missed) predictions with the
 *      actualized merchant revenue from daily_sales_snapshots (net revenue —
 *      the settlement-basis number the app records nightly at 11:59 PM MT).
 *   2. GRADE — MAPE + directional bias over the trailing 30 actualized pairs
 *      (gradeForecasts), persisted to app_settings 'forecast_accuracy_latest'.
 *   3. TUNE — the dampened+clamped bias-correction factor is stored in
 *      app_settings 'forecast_bias_correction' and applied to (a) tomorrow's
 *      stored prediction and (b) the cash-flow runway's revenue inputs
 *      (runway-service multiplies avgDailyRevenue by this factor).
 *   4. PREDICT — tomorrow's daily-revenue forecast = trailing-7-day average ×
 *      correction factor, written to forecast_predictions so tomorrow night's
 *      run can grade it. The loop literally measures itself daily.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { gradeForecasts, tunedForecast, type ForecastPair, type AccuracyReport } from "./forecast-accuracy-service";

const FACTOR_KEY = "forecast_bias_correction";
const REPORT_KEY = "forecast_accuracy_latest";
const PAIR_WINDOW = 30;

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Current bias-correction multiplier (1 when the model is untuned/unbiased). */
export async function getBiasCorrectionFactor(): Promise<number> {
  try {
    const v = await storage.getAppSetting(FACTOR_KEY);
    const f = v != null ? Number(v) : 1;
    return Number.isFinite(f) && f > 0 ? f : 1;
  } catch {
    return 1;
  }
}

export interface TuningRunResult {
  ranAt: string;
  actualized: number;
  report: AccuracyReport | null;
  factor: number;
  tomorrow: { date: string; rawPredicted: number; predicted: number } | null;
  notes: string[];
}

export async function runNightlyForecastTuning(): Promise<TuningRunResult> {
  const notes: string[] = [];
  const ranAt = new Date().toISOString();

  // 1. ACTUALIZE — join unactualized predictions to recorded daily revenue.
  let actualized = 0;
  try {
    const r: any = await db.execute(sql`
      UPDATE forecast_predictions fp
      SET actual = dss.net_revenue, actualized_at = now()
      FROM daily_sales_snapshots dss
      WHERE fp.actual IS NULL
        AND fp.target_date <= CURRENT_DATE - 1
        AND dss.date = fp.target_date
      RETURNING fp.target_date`);
    actualized = (r.rows ?? r ?? []).length;
  } catch (e: any) {
    notes.push(`actualize failed: ${e?.message ?? e}`);
  }

  // 2+3. GRADE the trailing window and persist the correction factor.
  let report: AccuracyReport | null = null;
  let factor = 1;
  try {
    const r: any = await db.execute(sql`
      SELECT predicted, actual FROM forecast_predictions
      WHERE actual IS NOT NULL
      ORDER BY target_date DESC LIMIT ${PAIR_WINDOW}`);
    const pairs: ForecastPair[] = (r.rows ?? r ?? []).map((x: any) => ({
      predicted: Number(x.predicted) || 0,
      actual: Number(x.actual) || 0,
    }));
    if (pairs.length) {
      report = gradeForecasts(pairs);
      factor = report.correctionFactor;
      await storage.setAppSetting(REPORT_KEY, JSON.stringify({ ...report, gradedAt: ranAt }));
      await storage.setAppSetting(FACTOR_KEY, String(factor));
    } else {
      notes.push("no actualized pairs yet — model starts grading after the first night");
    }
  } catch (e: any) {
    notes.push(`grading failed: ${e?.message ?? e}`);
  }

  // 4. PREDICT tomorrow: trailing-7d average daily net revenue × factor.
  let tomorrow: TuningRunResult["tomorrow"] = null;
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86_400_000);
    const sales = await storage.getDailySalesSnapshotsInRange(iso(start), iso(end));
    if (sales && sales.length) {
      const raw = r2(sales.reduce((s: number, x: any) => s + (Number(x.netRevenue) || 0), 0) / sales.length);
      const predicted = tunedForecast(raw, factor);
      const targetDate = iso(new Date(end.getTime() + 86_400_000));
      await db.execute(sql`
        INSERT INTO forecast_predictions (target_date, metric, predicted, raw_predicted, correction_factor_used, created_at)
        VALUES (${targetDate}, 'daily_net_revenue', ${predicted}, ${raw}, ${factor}, now())
        ON CONFLICT (target_date) DO UPDATE
          SET predicted = EXCLUDED.predicted,
              raw_predicted = EXCLUDED.raw_predicted,
              correction_factor_used = EXCLUDED.correction_factor_used`);
      tomorrow = { date: targetDate, rawPredicted: raw, predicted };
    } else {
      notes.push("no daily sales in the last 7 days — prediction skipped");
    }
  } catch (e: any) {
    notes.push(`prediction failed: ${e?.message ?? e}`);
  }

  console.log(`[Forecast Tuning] actualized=${actualized} mape=${report?.mape ?? "n/a"} factor=${factor} tomorrow=${tomorrow?.predicted ?? "n/a"}`);
  return { ranAt, actualized, report, factor, tomorrow, notes };
}

/** Latest stored accuracy report (+ recent pairs for the UI). */
export async function getForecastAccuracyStatus(): Promise<{
  report: (AccuracyReport & { gradedAt?: string }) | null;
  factor: number;
  recent: Array<{ targetDate: string; predicted: number; actual: number | null }>;
}> {
  let report: any = null;
  try {
    const v = await storage.getAppSetting(REPORT_KEY);
    report = v ? JSON.parse(v) : null;
  } catch { /* none yet */ }
  const factor = await getBiasCorrectionFactor();
  let recent: Array<{ targetDate: string; predicted: number; actual: number | null }> = [];
  try {
    const r: any = await db.execute(sql`
      SELECT target_date, predicted, actual FROM forecast_predictions
      ORDER BY target_date DESC LIMIT 14`);
    recent = (r.rows ?? r ?? []).map((x: any) => ({
      targetDate: String(x.target_date),
      predicted: Number(x.predicted) || 0,
      actual: x.actual != null ? Number(x.actual) : null,
    }));
  } catch { /* table may not exist yet pre-migration */ }
  return { report, factor, recent };
}
