import { describe, it, expect } from "vitest";
import { projectFullYear, type ProfitModel } from "./profitability-model-service";

const base: ProfitModel = {
  thisYear: 2026, ytdThroughMonth: 10, cogsPct: 0.5, fixedMonthly: 20000,
  currentRoas: 3, ytdNet: 0, ytdRevenue: 0,
  remainingMonths: [
    { month: 11, label: "Nov", lastYearRevenue: 100000 },
    { month: 12, label: "Dec", lastYearRevenue: 100000 },
  ],
};

describe("projectFullYear", () => {
  it("computes monthly + full-year net at a given ROAS", () => {
    // rev 100k, COGS 50k, ad 100k/5=20k, fixed 20k => net 10k/mo × 2 = 20k
    const r = projectFullYear(base, 5, 0);
    expect(r.monthly[0].net).toBe(10000);
    expect(r.fullYearNet).toBe(20000);
  });

  it("derives the breakeven ROAS (where full-year net = 0)", () => {
    const r = projectFullYear(base, 5, 0);
    expect(r.breakevenRoas).toBeCloseTo(3.33, 1);
    // sanity: at the breakeven ROAS, net should be ~0
    const atBreakeven = projectFullYear(base, r.breakevenRoas as number, 0);
    expect(Math.abs(atBreakeven.fullYearNet)).toBeLessThan(2000);
  });

  it("scales revenue by the outperformance %", () => {
    const flat = projectFullYear(base, 5, 0).fullYearNet;
    const up = projectFullYear(base, 5, 20).fullYearNet;
    expect(up).toBeGreaterThan(flat);
  });

  it("returns null breakeven when revenue can't cover fixed cost at any ROAS", () => {
    const broke = projectFullYear({ ...base, fixedMonthly: 60000 }, 5, 0);
    expect(broke.breakevenRoas).toBeNull();
  });
});
