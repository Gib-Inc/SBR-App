/**
 * CIPH.R Phase 2 — Cash Runway & Burn-Rate engine (pure, no I/O).
 *
 * Runway Days = Current Cash / (Fixed Overhead + Variable Ad Spend - (Sales Velocity * Net Margin))
 *
 * The denominator is the NET DAILY cash outflow ("burn rate"): fixed overhead/day
 * plus variable ad spend/day, minus the daily gross-margin contribution from sales
 * (cash inflow). Three scenarios use different lookback horizons for the variable
 * inputs: CONSERVATIVE (90-day avg), REALISTIC (30-day), AGGRESSIVE (7-day).
 *
 * ANTI-HALLUCINATION (spec §2): if any required input is null/NaN the engine does
 * NOT interpolate or guess — it records the missing metric name in `gaps` and
 * leaves runwayDays null. The forecast status becomes CALCULATION_GAPPED.
 *
 * Pure + fully unit-tested in runway-engine.test.ts (no DB/network).
 */

// HEALTHY / WARNING / CRITICAL are severity tiers off the realistic (headline)
// runway: >=90 days HEALTHY, 30-89 WARNING, <30 CRITICAL. Before this, ANY fully
// computed forecast returned HEALTHY, so a 6-day runway read "healthy".
export type RunwayStatus = "HEALTHY" | "WARNING" | "CRITICAL" | "CALCULATION_GAPPED" | "MISMATCH";
export type ScenarioKey = "conservative" | "realistic" | "aggressive";

export interface ScenarioInputs {
  cashOnHand: number | null;
  dailyFixedOverhead: number | null; // OpEx / day
  dailyAdSpend: number | null; // variable ad spend / day
  dailyMarginContribution: number | null; // sales velocity * net margin / day (cash inflow)
}

export interface ScenarioResult {
  runwayDays: number | null;
  burnRate: number | null; // net daily cash outflow; <= 0 means cash-flow positive
  cashFlowPositive: boolean;
  gaps: string[]; // missing-metric names, e.g. "Cash on Hand"
}

const REQUIRED: Array<{ key: keyof ScenarioInputs; label: string }> = [
  { key: "cashOnHand", label: "Cash on Hand" },
  { key: "dailyFixedOverhead", label: "Fixed Overhead" },
  { key: "dailyAdSpend", label: "Variable Ad Spend" },
  { key: "dailyMarginContribution", label: "Sales Velocity x Net Margin" },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const isNum = (v: unknown): v is number => v != null && typeof v === "number" && !Number.isNaN(v);

/** Compute one scenario's runway. Missing inputs => gaps + null runway (never guessed). */
export function computeScenarioRunway(inputs: ScenarioInputs): ScenarioResult {
  const gaps: string[] = [];
  for (const { key, label } of REQUIRED) {
    if (!isNum(inputs[key])) gaps.push(label);
  }
  if (gaps.length) {
    return { runwayDays: null, burnRate: null, cashFlowPositive: false, gaps };
  }

  const cash = inputs.cashOnHand as number;
  const burnRate = round2(
    (inputs.dailyFixedOverhead as number) + (inputs.dailyAdSpend as number) - (inputs.dailyMarginContribution as number),
  );

  // burnRate <= 0 => sales margin covers costs => cash-flow positive, no finite burn.
  if (burnRate <= 0) {
    return { runwayDays: null, burnRate, cashFlowPositive: true, gaps: [] };
  }
  return { runwayDays: Math.floor(cash / burnRate), burnRate, cashFlowPositive: false, gaps: [] };
}

/**
 * Scale a scenario's VARIABLE inputs for "What-If" analysis. Cash and fixed
 * overhead are held constant; only ad spend and the sales-velocity-driven margin
 * contribution flex. Percentages are deltas (e.g. +20 ad spend, -15 velocity).
 */
export function applyVariance(
  s: ScenarioInputs,
  opts: { adSpendPct?: number; salesVelocityPct?: number },
): ScenarioInputs {
  const adFactor = 1 + (opts.adSpendPct ?? 0) / 100;
  const velFactor = 1 + (opts.salesVelocityPct ?? 0) / 100;
  return {
    ...s,
    dailyAdSpend: isNum(s.dailyAdSpend) ? round2(s.dailyAdSpend * adFactor) : s.dailyAdSpend,
    dailyMarginContribution: isNum(s.dailyMarginContribution)
      ? round2(s.dailyMarginContribution * velFactor)
      : s.dailyMarginContribution,
  };
}

export interface RunwayForecastInputs {
  conservative: ScenarioInputs;
  realistic: ScenarioInputs;
  aggressive: ScenarioInputs;
  netMarginAverage?: number | null; // 0.42 = 42%, for reporting
}

export interface RunwayForecast {
  conservativeDays: number | null;
  realisticDays: number | null;
  aggressiveDays: number | null;
  burnRate: number | null; // realistic scenario burn (headline)
  netMarginAverage: number | null;
  status: RunwayStatus;
  dataGaps: string[]; // de-duplicated "<metric> (<scenario>)" entries
  scenarios: Record<ScenarioKey, ScenarioResult>;
}

/** Run all three scenarios and aggregate status + gaps. */
export function computeRunwayForecast(inputs: RunwayForecastInputs): RunwayForecast {
  const scenarios: Record<ScenarioKey, ScenarioResult> = {
    conservative: computeScenarioRunway(inputs.conservative),
    realistic: computeScenarioRunway(inputs.realistic),
    aggressive: computeScenarioRunway(inputs.aggressive),
  };

  const dataGaps: string[] = [];
  (Object.keys(scenarios) as ScenarioKey[]).forEach((k) => {
    for (const g of scenarios[k].gaps) {
      const tagged = `${g} (${k})`;
      if (!dataGaps.includes(tagged)) dataGaps.push(tagged);
    }
  });

  // Severity off the REALISTIC (headline) scenario once all inputs are present.
  // null runwayDays with no gaps means cash-flow positive (no finite burn) => HEALTHY.
  let status: RunwayStatus;
  if (dataGaps.length > 0) {
    status = "CALCULATION_GAPPED";
  } else {
    const rd = scenarios.realistic.runwayDays;
    status = rd == null ? "HEALTHY" : rd < 30 ? "CRITICAL" : rd < 90 ? "WARNING" : "HEALTHY";
  }

  return {
    conservativeDays: scenarios.conservative.runwayDays,
    realisticDays: scenarios.realistic.runwayDays,
    aggressiveDays: scenarios.aggressive.runwayDays,
    burnRate: scenarios.realistic.burnRate,
    netMarginAverage: isNum(inputs.netMarginAverage as number) ? (inputs.netMarginAverage as number) : null,
    status,
    dataGaps,
    scenarios,
  };
}
