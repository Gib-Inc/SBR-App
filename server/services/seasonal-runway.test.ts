import { describe, it, expect } from "vitest";
import { seasonalDailyRevenue, type MonthlySalesRow } from "./seasonal-runway";

// SBR's real 2025 summer/fall (total_income, net of returns ~ revenue here).
const HIST: MonthlySalesRow[] = [
  { year: 2025, month: 6, totalIncome: 158176 },
  { year: 2025, month: 7, totalIncome: 232394 },
  { year: 2025, month: 8, totalIncome: 351526 },
  { year: 2025, month: 9, totalIncome: 314993 },
  { year: 2025, month: 10, totalIncome: 529530 },
  { year: 2025, month: 12, totalIncome: 198756 },
  { year: 2026, month: 1, totalIncome: 110000 },
  { year: 2026, month: 2, totalIncome: 175000 },
];

describe("seasonalDailyRevenue", () => {
  it("uses last year's SAME upcoming months (Jun asOf → Jul/Aug/Sep 2025)", () => {
    const r = seasonalDailyRevenue(HIST, "2026-06-28", 3);
    // (232394 + 351526 + 314993) / (31 + 31 + 30) = 898913 / 92 = 9770.79
    expect(r.dailyRevenue).toBe(9770.79);
    expect(r.basisMonths).toEqual([
      { year: 2025, month: 7 },
      { year: 2025, month: 8 },
      { year: 2025, month: 9 },
    ]);
    expect(r.gaps).toEqual([]);
  });

  it("wraps the year boundary (Nov asOf → Dec '25 / Jan '26 / Feb '26)", () => {
    const r = seasonalDailyRevenue(HIST, "2026-11-15", 3);
    // 198756 + 110000 + 175000 = 483756 over 31 + 31 + 28 = 90 days
    expect(r.basisMonths).toEqual([
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
    expect(r.dailyRevenue).toBe(5375.07); // 483756 / 90
    expect(r.gaps).toEqual([]);
  });

  it("FLAG-DON'T-FABRICATE: a missing last-year month is recorded as a gap, not invented", () => {
    // Oct asOf → Nov/Dec '25 + Jan '26. Nov 2025 is absent from HIST.
    const r = seasonalDailyRevenue(HIST, "2026-10-10", 3);
    expect(r.gaps).toEqual([{ year: 2025, month: 11 }]);
    // Still computes from the two months present (Dec '25 + Jan '26).
    expect(r.basisMonths).toEqual([
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
    ]);
    // (198756 + 110000) / (31 + 31) = 308756 / 62 = 4979.94
    expect(r.dailyRevenue).toBe(4979.94);
  });

  it("returns null (no fabrication) when no last-year months exist", () => {
    const r = seasonalDailyRevenue([], "2026-06-28", 3);
    expect(r.dailyRevenue).toBeNull();
    expect(r.basisMonths).toEqual([]);
    expect(r.gaps.length).toBe(3);
  });

  it("ignores null total_income months (treats as missing)", () => {
    const hist: MonthlySalesRow[] = [
      { year: 2025, month: 7, totalIncome: null },
      { year: 2025, month: 8, totalIncome: 310000 },
      { year: 2025, month: 9, totalIncome: null },
    ];
    const r = seasonalDailyRevenue(hist, "2026-06-28", 3);
    expect(r.basisMonths).toEqual([{ year: 2025, month: 8 }]);
    expect(r.dailyRevenue).toBe(10000); // 310000 / 31
    expect(r.gaps).toEqual([
      { year: 2025, month: 7 },
      { year: 2025, month: 9 },
    ]);
  });
});
