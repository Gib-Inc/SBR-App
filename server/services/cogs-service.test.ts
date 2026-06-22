import { describe, it, expect } from "vitest";
import { projectCogsBudget, type MonthlyCogs } from "./cogs-service";

const m = (month: string, coveragePct: number, cogsRatePct: number): MonthlyCogs => ({
  month, realMaterialsCogs: 33000, lineRevenue: 100000, coveragePct, cogsRatePct, plugCogs: 35000, variance: 2000,
});

describe("projectCogsBudget", () => {
  const months = [m("2026-04", 60, 33), m("2026-05", 84, 33), m("2026-06", 74, 33)];

  it("derives the measured rate from covered months and projects COGS", () => {
    const b = projectCogsBudget(months, 200000);
    expect(b.measuredRatePct).toBe(33);
    expect(b.projectedCogs).toBe(66000); // 33% of 200k
    expect(b.basisMonths).toBe(3);
  });

  it("ignores low-coverage months when deriving the rate", () => {
    const withLow = [m("2026-01", 1, 50), ...months];
    const b = projectCogsBudget(withLow, 100000);
    expect(b.basisMonths).toBe(3); // the 1%-coverage month is excluded
    expect(b.measuredRatePct).toBe(33);
  });

  it("returns a zero rate (not NaN) when there is no covered history", () => {
    const b = projectCogsBudget([m("2026-02", 0, 0)], 100000);
    expect(b.measuredRatePct).toBe(0);
    expect(b.projectedCogs).toBe(0);
  });
});
