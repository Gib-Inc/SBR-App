/**
 * ForecastAccuracyService — Pillar 4 continuous optimization ("gets smarter").
 * --------------------------------------------------------------------------
 * The app already PRODUCES forecasts (runway-engine: computeRunwayForecast,
 * computeScenarioRunway). What it never did was GRADE itself. This service is
 * the feedback loop: compare each prior prediction to the actualized number,
 * measure error (MAPE) + directional bias, and emit a bias-correction factor
 * that nudges future forecasts toward reality — so accuracy improves over time.
 *
 * Pure + deterministic; the correction factor is clamped so one noisy week can
 * never whipsaw the model.
 */

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export interface ForecastPair {
  predicted: number;
  actual: number;
}

/** Signed percentage error: (actual − predicted)/actual. null when actual is 0. */
export function percentageError(predicted: number, actual: number): number | null {
  if (!actual) return null; // undefined when there's no actual to divide by
  return round((actual - predicted) / actual, 4);
}

/**
 * Mean Absolute Percentage Error (%) across pairs with a non-zero actual. 0 when
 * there are no usable pairs. A MAPE of 8 means forecasts are off by ~8% on average.
 */
export function meanAbsolutePercentageError(pairs: ForecastPair[]): number {
  const usable = (pairs || []).filter((p) => p.actual);
  if (!usable.length) return 0;
  const sum = usable.reduce((s, p) => s + Math.abs((p.actual - p.predicted) / p.actual), 0);
  return round((sum / usable.length) * 100, 2);
}

/**
 * Mean SIGNED percentage error — the directional bias. Positive ⇒ the model
 * UNDER-predicts (actuals come in higher); negative ⇒ it OVER-predicts.
 */
export function forecastBias(pairs: ForecastPair[]): number {
  const usable = (pairs || []).filter((p) => p.actual);
  if (!usable.length) return 0;
  const sum = usable.reduce((s, p) => s + (p.actual - p.predicted) / p.actual, 0);
  return round(sum / usable.length, 4);
}

export interface CorrectionOpts {
  /** Max single-direction correction (default ±30%). Guards against whipsaw. */
  clamp?: number;
  /** Fraction of the measured bias to apply per cycle (default 0.5 — ease in). */
  dampening?: number;
}

/**
 * Multiplier to apply to the next raw forecast so persistent bias is corrected.
 * If the model under-predicts by 10% on average, returns ~1.05 (with default
 * 0.5 dampening), clamped to [1−clamp, 1+clamp].
 */
export function biasCorrectionFactor(pairs: ForecastPair[], opts?: CorrectionOpts): number {
  const clamp = opts?.clamp ?? 0.3;
  const dampening = opts?.dampening ?? 0.5;
  const bias = forecastBias(pairs); // signed fraction
  const raw = 1 + bias * dampening;
  const lo = 1 - clamp;
  const hi = 1 + clamp;
  return round(Math.min(hi, Math.max(lo, raw)), 4);
}

/** Apply a bias-correction factor to a raw forecast. */
export function tunedForecast(rawForecast: number, correctionFactor: number): number {
  return round((rawForecast || 0) * (correctionFactor || 1), 2);
}

export type AccuracyGrade = "EXCELLENT" | "GOOD" | "FAIR" | "POOR";

/** Grade a forecast model from its MAPE. */
export function accuracyGrade(mape: number): AccuracyGrade {
  if (mape <= 5) return "EXCELLENT";
  if (mape <= 10) return "GOOD";
  if (mape <= 20) return "FAIR";
  return "POOR";
}

export interface AccuracyReport {
  samples: number;
  mape: number;
  bias: number;
  grade: AccuracyGrade;
  correctionFactor: number;
}

/** Full accuracy report from a window of (predicted, actual) pairs. */
export function gradeForecasts(pairs: ForecastPair[], opts?: CorrectionOpts): AccuracyReport {
  const usable = (pairs || []).filter((p) => p.actual);
  const mape = meanAbsolutePercentageError(pairs);
  return {
    samples: usable.length,
    mape,
    bias: forecastBias(pairs),
    grade: accuracyGrade(mape),
    correctionFactor: biasCorrectionFactor(pairs, opts),
  };
}
