import { describe, it, expect } from "vitest";
import {
  computeScenarioRunway,
  computeRunwayForecast,
  applyVariance,
  type ScenarioInputs,
} from "./runway-engine";

const base: ScenarioInputs = {
  cashOnHand: 100_000,
  dailyFixedOverhead: 1_000,
  dailyAdSpend: 500,
  dailyMarginContribution: 800,
};

describe("computeScenarioRunway", () => {
  it("computes runway days from the formula", () => {
    // burn = 1000 + 500 - 800 = 700/day; 100000/700 = 142.85 -> floor 142
    const r = computeScenarioRunway(base);
    expect(r.burnRate).toBe(700);
    expect(r.runwayDays).toBe(142);
    expect(r.cashFlowPositive).toBe(false);
    expect(r.gaps).toEqual([]);
  });

  it("handles zero sales (no margin contribution)", () => {
    // burn = 1000 + 500 - 0 = 1500/day; 100000/1500 = 66.6 -> 66
    const r = computeScenarioRunway({ ...base, dailyMarginContribution: 0 });
    expect(r.burnRate).toBe(1500);
    expect(r.runwayDays).toBe(66);
  });

  it("handles an extreme ad-spend spike", () => {
    // burn = 1000 + 5000 - 800 = 5200/day; 100000/5200 = 19.2 -> 19
    const r = computeScenarioRunway({ ...base, dailyAdSpend: 5_000 });
    expect(r.burnRate).toBe(5200);
    expect(r.runwayDays).toBe(19);
  });

  it("flags cash-flow positive when margin covers costs (no finite runway)", () => {
    // burn = 1000 + 500 - 2000 = -500 -> cash-flow positive
    const r = computeScenarioRunway({ ...base, dailyMarginContribution: 2_000 });
    expect(r.cashFlowPositive).toBe(true);
    expect(r.runwayDays).toBeNull();
    expect(r.burnRate).toBe(-500);
    expect(r.gaps).toEqual([]);
  });

  it("ANTI-HALLUCINATION: missing cash on hand => gap, null runway, no guess", () => {
    const r = computeScenarioRunway({ ...base, cashOnHand: null });
    expect(r.runwayDays).toBeNull();
    expect(r.burnRate).toBeNull();
    expect(r.gaps).toContain("Cash on Hand");
  });

  it("ANTI-HALLUCINATION: lists every missing metric", () => {
    const r = computeScenarioRunway({
      cashOnHand: null,
      dailyFixedOverhead: null,
      dailyAdSpend: 500,
      dailyMarginContribution: null,
    });
    expect(r.gaps).toEqual(["Cash on Hand", "Fixed Overhead", "Sales Velocity x Net Margin"]);
    expect(r.runwayDays).toBeNull();
  });

  it("treats NaN as a gap (never computes on it)", () => {
    const r = computeScenarioRunway({ ...base, dailyAdSpend: Number.NaN });
    expect(r.gaps).toContain("Variable Ad Spend");
    expect(r.runwayDays).toBeNull();
  });
});

describe("applyVariance (What-If)", () => {
  it("+20% ad spend shortens runway", () => {
    const shifted = applyVariance(base, { adSpendPct: 20 });
    expect(shifted.dailyAdSpend).toBe(600); // 500 * 1.2
    const r = computeScenarioRunway(shifted);
    // burn = 1000 + 600 - 800 = 800; 100000/800 = 125
    expect(r.runwayDays).toBe(125);
  });

  it("-15% sales velocity shortens runway (less margin inflow)", () => {
    const shifted = applyVariance(base, { salesVelocityPct: -15 });
    expect(shifted.dailyMarginContribution).toBe(680); // 800 * 0.85
    const r = computeScenarioRunway(shifted);
    // burn = 1000 + 500 - 680 = 820; 100000/820 = 121.9 -> 121
    expect(r.runwayDays).toBe(121);
  });

  it("preserves nulls through variance (no fabrication)", () => {
    const shifted = applyVariance({ ...base, dailyAdSpend: null }, { adSpendPct: 50 });
    expect(shifted.dailyAdSpend).toBeNull();
  });
});

describe("computeRunwayForecast", () => {
  it("aggregates three scenarios and reports HEALTHY when all compute", () => {
    const f = computeRunwayForecast({
      conservative: { ...base, dailyAdSpend: 400 }, // burn 600 -> 166
      realistic: base, // burn 700 -> 142
      aggressive: { ...base, dailyAdSpend: 900 }, // burn 1100 -> 90
      netMarginAverage: 0.42,
    });
    expect(f.conservativeDays).toBe(166);
    expect(f.realisticDays).toBe(142);
    expect(f.aggressiveDays).toBe(90);
    expect(f.burnRate).toBe(700); // realistic headline
    expect(f.netMarginAverage).toBe(0.42);
    expect(f.status).toBe("HEALTHY");
    expect(f.dataGaps).toEqual([]);
  });

  it("CRITICAL when the realistic runway is under 30 days", () => {
    const f = computeRunwayForecast({
      conservative: { ...base, cashOnHand: 10_000 },
      realistic: { ...base, cashOnHand: 10_000 }, // burn 700 -> 14 days
      aggressive: { ...base, cashOnHand: 10_000 },
    });
    expect(f.realisticDays).toBe(14);
    expect(f.status).toBe("CRITICAL"); // a ~6-14 day runway must NOT read healthy
  });

  it("WARNING when the realistic runway is 30-89 days", () => {
    const f = computeRunwayForecast({
      conservative: base,
      realistic: { ...base, cashOnHand: 40_000 }, // 40000/700 -> 57 days
      aggressive: base,
    });
    expect(f.realisticDays).toBe(57);
    expect(f.status).toBe("WARNING");
  });

  it("stays HEALTHY when cash-flow positive (no finite burn, no gaps)", () => {
    const cfPositive = { ...base, dailyMarginContribution: 5_000 }; // inflow > costs
    const f = computeRunwayForecast({ conservative: cfPositive, realistic: cfPositive, aggressive: cfPositive });
    expect(f.realisticDays).toBeNull();
    expect(f.status).toBe("HEALTHY");
  });

  it("CALCULATION_GAPPED when any scenario is missing inputs, tagged by scenario", () => {
    const f = computeRunwayForecast({
      conservative: base,
      realistic: { ...base, cashOnHand: null },
      aggressive: base,
    });
    expect(f.status).toBe("CALCULATION_GAPPED");
    expect(f.realisticDays).toBeNull();
    expect(f.conservativeDays).toBe(142);
    expect(f.dataGaps).toContain("Cash on Hand (realistic)");
  });

  it("null netMarginAverage stays null (not coerced)", () => {
    const f = computeRunwayForecast({ conservative: base, realistic: base, aggressive: base });
    expect(f.netMarginAverage).toBeNull();
  });
});

describe("inbound receivables (money on its way) extend the runway", () => {
  const b: ScenarioInputs = { cashOnHand: 1_000, dailyFixedOverhead: 800, dailyAdSpend: 200, dailyMarginContribution: 300 };
  it("adds A/R to starting cash, not to the burn rate", () => {
    const without = computeScenarioRunway(b);
    const withAr = computeScenarioRunway({ ...b, inboundReceivables: 1_100 });
    expect(without.burnRate).toBe(700);
    expect(without.runwayDays).toBe(1);   // floor(1000 / 700)
    expect(withAr.burnRate).toBe(700);    // burn unchanged
    expect(withAr.runwayDays).toBe(3);    // floor((1000 + 1100) / 700)
  });
  it("treats absent/null inbound receivables as 0 (existing callers unchanged)", () => {
    expect(computeScenarioRunway(b).runwayDays).toBe(1);
    expect(computeScenarioRunway({ ...b, inboundReceivables: null }).runwayDays).toBe(1);
    expect(computeScenarioRunway({ ...b, inboundReceivables: undefined }).runwayDays).toBe(1);
  });
});

describe("D5: debt service in the burn", () => {
  it("dailyDebtService adds to burn and shortens the runway by the expected amount", async () => {
    const { computeScenarioRunway } = await import("./runway-engine");
    const base = { cashOnHand: 53000, dailyFixedOverhead: 4000, dailyAdSpend: 1000, dailyMarginContribution: 4500 };
    const without = computeScenarioRunway(base);
    const withDebt = computeScenarioRunway({ ...base, dailyDebtService: 1500 });
    // burn: 4000+1000-4500 = 500/day → 106 days;  with debt: 500+1500 = 2000/day → 26 days
    expect(without.burnRate).toBe(500);
    expect(without.runwayDays).toBe(106);
    expect(withDebt.burnRate).toBe(2000);
    expect(withDebt.runwayDays).toBe(26); // the true (shorter) number
  });
  it("absent/null dailyDebtService behaves exactly like before (no gap, no phantom burn)", async () => {
    const { computeScenarioRunway } = await import("./runway-engine");
    const base = { cashOnHand: 10000, dailyFixedOverhead: 300, dailyAdSpend: 100, dailyMarginContribution: 200 };
    expect(computeScenarioRunway(base).burnRate).toBe(200);
    expect(computeScenarioRunway({ ...base, dailyDebtService: null }).burnRate).toBe(200);
    expect(computeScenarioRunway(base).gaps).toEqual([]);
  });
  it("debt service can flip a cash-flow-positive read into a real burn", async () => {
    const { computeScenarioRunway } = await import("./runway-engine");
    const base = { cashOnHand: 50000, dailyFixedOverhead: 3000, dailyAdSpend: 1000, dailyMarginContribution: 4500 };
    expect(computeScenarioRunway(base).cashFlowPositive).toBe(true); // -500/day: rosy
    const truth = computeScenarioRunway({ ...base, dailyDebtService: 2000 });
    expect(truth.cashFlowPositive).toBe(false); // +1500/day of real burn
    expect(truth.runwayDays).toBe(33);
  });
});
