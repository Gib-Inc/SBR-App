/**
 * CIPH.R — pure financial projection math for the Finances playground.
 * No React/DOM so it can be unit-tested in node. Anti-hallucination: callers
 * pass real history; this only fits/projects from it, and labels the model as a
 * simple blended estimate (it never claims causal precision).
 */

export interface MonthPoint {
  adSpend: number;
  revenue: number;
  grossProfit: number | null;
  totalExpenses: number | null;
  netIncome: number | null;
}

export interface ProjectionModel {
  intercept: number; // baseline (organic) monthly revenue at $0 ad spend
  revPerAdDollar: number; // marginal revenue per $1 of ad spend (regression slope)
  grossMarginPct: number; // 0..1
  avgNonAdExpenses: number; // monthly non-ad expense base
  basisMonths: number;
}

/** Ordinary least squares slope/intercept for y = a + b·x. */
export function linearRegression(xs: number[], ys: number[]): { a: number; b: number } {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return { a: 0, b: 0 };
  if (n === 1) return { a: ys[0], b: 0 };
  const sx = xs.reduce((s, v) => s + v, 0);
  const sy = ys.reduce((s, v) => s + v, 0);
  const sxx = xs.reduce((s, v) => s + v * v, 0);
  const sxy = xs.reduce((s, v, i) => s + v * ys[i], 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { a: sy / n, b: 0 };
  const b = (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;
  return { a, b };
}

export function deriveModel(points: MonthPoint[], lookback = 12): ProjectionModel {
  const recent = points.slice(-lookback).filter((p) => p.revenue != null);
  const withAd = recent.filter((p) => p.adSpend > 0 && p.revenue > 0);
  const reg = linearRegression(withAd.map((p) => p.adSpend), withAd.map((p) => p.revenue));
  const gms = recent.filter((p) => p.grossProfit != null && p.revenue > 0).map((p) => (p.grossProfit as number) / p.revenue);
  const grossMarginPct = gms.length ? gms.reduce((s, v) => s + v, 0) / gms.length : 0;
  const nonAd = recent.filter((p) => p.totalExpenses != null).map((p) => (p.totalExpenses as number) - p.adSpend);
  const avgNonAdExpenses = nonAd.length ? nonAd.reduce((s, v) => s + v, 0) / nonAd.length : 0;
  return {
    intercept: Math.max(0, reg.a),
    revPerAdDollar: reg.b,
    grossMarginPct,
    avgNonAdExpenses,
    basisMonths: recent.length,
  };
}

export interface Projection {
  revenue: number;
  grossProfit: number;
  totalExpenses: number;
  netIncome: number;
}

/** Project one month given an ad budget and a % change to non-ad expenses. */
export function projectScenario(m: ProjectionModel, adBudget: number, expensePct = 0): Projection {
  const revenue = Math.max(0, m.intercept + m.revPerAdDollar * adBudget);
  const grossProfit = revenue * m.grossMarginPct;
  const totalExpenses = m.avgNonAdExpenses * (1 + expensePct / 100) + adBudget;
  return { revenue, grossProfit, totalExpenses, netIncome: grossProfit - totalExpenses };
}

/** Days of cash runway given a monthly net income (null = cash-flow positive). */
export function runwayDays(cash: number, monthlyNetIncome: number): number | null {
  if (monthlyNetIncome >= 0) return null;
  return Math.floor(cash / (-monthlyNetIncome / 30.4));
}

/** Extra runway days a recurring monthly expense cut buys, at the current burn. */
export function runwayDaysFromCut(cash: number, currentMonthlyBurn: number, cutMonthly: number): number {
  if (currentMonthlyBurn <= 0 || cutMonthly <= 0) return 0;
  const before = cash / (currentMonthlyBurn / 30.4);
  const newBurn = Math.max(currentMonthlyBurn - cutMonthly, 0.01);
  const after = cash / (newBurn / 30.4);
  return Math.round(after - before);
}
