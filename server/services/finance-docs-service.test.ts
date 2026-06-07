import { describe, it, expect } from "vitest";
import { shopifyPeriodMetrics } from "./finance-docs-service";
import { SHOPIFY_PERIOD, EXECUTIVE_SUMMARY } from "../data/finance-docs";

describe("shopifyPeriodMetrics (Jun 1-6, 2026)", () => {
  const m = shopifyPeriodMetrics();

  it("counts the days in the period", () => {
    expect(m.days).toBe(6);
  });

  it("averages total sales across the period", () => {
    // 37,884.27 / 6 = 6,314.0449… → 6314.04 (IEEE-754 rounds down here)
    expect(m.avgDailyTotal).toBe(6314.04);
  });

  it("averages net sales across the period", () => {
    // 35,011.96 / 6 = 5,835.326... → 5835.33
    expect(m.avgDailyNet).toBe(5835.33);
  });

  it("computes discount and return rates off gross sales", () => {
    // 3,718.38 / 39,078.31 = 9.5152% → 9.52
    expect(m.discountRatePct).toBe(9.52);
    // 347.97 / 39,078.31 = 0.8904% → 0.89
    expect(m.returnRatePct).toBe(0.89);
  });

  it("identifies the best and slowest days", () => {
    expect(m.bestDay).toEqual({ date: "2026-06-02", totalSales: 11346.9 });
    expect(m.slowestDay).toEqual({ date: "2026-06-06", totalSales: 1340.0 });
  });

  it("handles an empty period without dividing by zero", () => {
    const empty = { ...SHOPIFY_PERIOD, daily: [], totals: { ...SHOPIFY_PERIOD.totals, grossSales: 0 } } as any;
    const e = shopifyPeriodMetrics(empty);
    expect(e.days).toBe(0);
    expect(e.avgDailyTotal).toBe(0);
    expect(e.discountRatePct).toBe(0);
    expect(e.bestDay).toBeNull();
  });
});

describe("EXECUTIVE_SUMMARY integrity", () => {
  it("carries the headline insolvency figures verbatim", () => {
    expect(EXECUTIVE_SUMMARY.headline.ownersEquity).toBe(-889312);
    expect(EXECUTIVE_SUMMARY.headline.totalDebt).toBe(1279431);
    expect(EXECUTIVE_SUMMARY.headline.cashOnHand).toBe(86652);
  });
  it("has all 10 findings and 5 ad-ROI years", () => {
    expect(EXECUTIVE_SUMMARY.findings).toHaveLength(10);
    expect(EXECUTIVE_SUMMARY.adRoiByYear).toHaveLength(5);
    expect(EXECUTIVE_SUMMARY.adRoiByYear[0]).toEqual({ year: "2022", value: 20.05 });
  });
});
