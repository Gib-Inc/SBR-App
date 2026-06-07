import { describe, it, expect } from "vitest";
// Pure client lib (no DOM) — imported relative so the node test runner picks it up.
import {
  linearRegression,
  deriveModel,
  projectScenario,
  runwayDays,
  runwayDaysFromCut,
  type MonthPoint,
} from "../../client/src/lib/projection";

describe("linearRegression", () => {
  it("fits a perfect line y = 10 + 2x", () => {
    const { a, b } = linearRegression([0, 1, 2, 3], [10, 12, 14, 16]);
    expect(Math.round(a)).toBe(10);
    expect(Math.round(b)).toBe(2);
  });
  it("handles a single point (slope 0)", () => {
    expect(linearRegression([5], [100])).toEqual({ a: 100, b: 0 });
  });
});

describe("deriveModel", () => {
  const months: MonthPoint[] = [
    { adSpend: 10000, revenue: 50000, grossProfit: 30000, totalExpenses: 40000, netIncome: -10000 },
    { adSpend: 20000, revenue: 70000, grossProfit: 42000, totalExpenses: 55000, netIncome: -13000 },
    { adSpend: 30000, revenue: 90000, grossProfit: 54000, totalExpenses: 70000, netIncome: -16000 },
  ];
  it("derives slope, margin, and non-ad expense base", () => {
    const m = deriveModel(months);
    // revenue rises $2 per $1 ad spend, organic baseline ~$30k
    expect(Math.round(m.revPerAdDollar)).toBe(2);
    expect(Math.round(m.intercept)).toBe(30000);
    expect(Math.round(m.grossMarginPct * 100)).toBe(60); // 60% gross margin
    // non-ad expenses: 40-10=30k, 55-20=35k, 70-30=40k -> avg 35k
    expect(Math.round(m.avgNonAdExpenses)).toBe(35000);
    expect(m.basisMonths).toBe(3);
  });
});

describe("projectScenario", () => {
  const m = { intercept: 30000, revPerAdDollar: 2, grossMarginPct: 0.6, avgNonAdExpenses: 35000, basisMonths: 3 };
  it("projects revenue/grossProfit/expenses/netIncome from an ad budget", () => {
    const p = projectScenario(m, 20000);
    expect(p.revenue).toBe(70000); // 30000 + 2*20000
    expect(p.grossProfit).toBe(42000); // 70000*0.6
    expect(p.totalExpenses).toBe(55000); // 35000 + 20000
    expect(p.netIncome).toBe(-13000); // 42000 - 55000
  });
  it("more ad spend lifts revenue but can deepen the loss", () => {
    const p = projectScenario(m, 40000);
    expect(p.revenue).toBe(110000);
    expect(p.netIncome).toBe(110000 * 0.6 - (35000 + 40000)); // 66000 - 75000 = -9000
  });
  it("an expense cut improves net income", () => {
    const base = projectScenario(m, 20000, 0).netIncome;
    const cut = projectScenario(m, 20000, -20).netIncome; // 20% less non-ad expense
    expect(cut).toBeGreaterThan(base);
    expect(cut).toBe(42000 - (35000 * 0.8 + 20000)); // -6000
  });
});

describe("runway helpers", () => {
  it("runwayDays: cash / daily burn", () => {
    expect(runwayDays(56000, -45000)).toBe(Math.floor(56000 / (45000 / 30.4)));
    expect(runwayDays(56000, 5000)).toBeNull(); // cash-flow positive
  });
  it("runwayDaysFromCut: a monthly cut buys extra days", () => {
    const extra = runwayDaysFromCut(56000, 45000, 10000);
    expect(extra).toBeGreaterThan(0);
    expect(runwayDaysFromCut(56000, 0, 10000)).toBe(0); // not burning -> no effect
  });
});
