import { describe, it, expect } from "vitest";
import { assembleResetMonths, paceRanges } from "./reset-impact-service";

describe("paceRanges", () => {
  it("compares this month-to-date to the prior month's same day-range", () => {
    expect(paceRanges("2026-06-27")).toEqual({
      curStart: "2026-06-01", curEnd: "2026-06-27",
      priorStart: "2026-05-01", priorEnd: "2026-05-27", throughDay: 27,
    });
  });
  it("rolls over the year in January", () => {
    const r = paceRanges("2026-01-15");
    expect(r.priorStart).toBe("2025-12-01");
    expect(r.priorEnd).toBe("2025-12-15");
  });
  it("clamps the prior day to the prior month's length (Mar 31 -> Feb 28)", () => {
    expect(paceRanges("2026-03-31").priorEnd).toBe("2026-02-28");
  });
});

describe("assembleResetMonths", () => {
  const byMonth = new Map<string, Array<{ account: string; amount: number }>>([
    ["2026-05", [
      { account: "Gross Sales", amount: 100000 },
      { account: "Cost of Goods Sold", amount: 35000 },
      { account: "Advertising & Marketing", amount: 25000 },
      { account: "Payroll Expenses", amount: 20000 },
    ]],
    ["2026-06", [
      { account: "Gross Sales", amount: 60000 },
      { account: "Cost of Goods Sold", amount: 21000 },
      { account: "Advertising & Marketing", amount: 10000 },
    ]],
  ]);

  it("rolls up P&L per month and computes blended MER", () => {
    const out = assembleResetMonths(byMonth, { "2026-05": 25000, "2026-06": 10000 }, "2026-06");
    const may = out.find((m) => m.month === "2026-05")!;
    expect(may).toMatchObject({ netSales: 100000, grossProfit: 65000, netIncome: 20000, grossMarginPct: 65, netMarginPct: 20, blendedMer: 4, partial: false });
    const jun = out.find((m) => m.month === "2026-06")!;
    expect(jun).toMatchObject({ netSales: 60000, grossProfit: 39000, netIncome: 29000, blendedMer: 6, partial: true });
  });

  it("leaves MER null when a month has no corrected ad spend", () => {
    const out = assembleResetMonths(byMonth, { "2026-05": 0 }, "2026-06");
    expect(out.find((m) => m.month === "2026-05")!.blendedMer).toBeNull();
    expect(out.find((m) => m.month === "2026-06")!.blendedMer).toBeNull(); // not in spend map
  });

  it("nulls a partial month's margins/MER when only expenses have posted (lag guard)", () => {
    const lagging = new Map<string, Array<{ account: string; amount: number }>>([
      ["2026-05", [{ account: "Gross Sales", amount: 100000 }, { account: "Advertising & Marketing", amount: 25000 }]],
      ["2026-06", [{ account: "Advertising & Marketing", amount: 5000 }]], // expense posted, sales haven't
    ]);
    const out = assembleResetMonths(lagging, { "2026-05": 25000, "2026-06": 5000 }, "2026-06");
    const jun = out.find((m) => m.month === "2026-06")!;
    expect(jun.netSales).toBe(0);
    expect(jun.grossMarginPct).toBeNull();
    expect(jun.netMarginPct).toBeNull();
    expect(jun.blendedMer).toBeNull();
    // a COMPLETE month with a real loss still shows its (negative) margin
    const may = out.find((m) => m.month === "2026-05")!;
    expect(may.netMarginPct).not.toBeNull();
  });
});
