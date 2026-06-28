import { describe, it, expect } from "vitest";
import { assembleResetMonths, paceRanges, computeLossTrend } from "./reset-impact-service";

const mo = (month: string, netIncome: number, partial = false): any => ({ month, partial, netIncome });

describe("computeLossTrend", () => {
  it("flags all-negative but improving (less in the red than 6 months ago)", () => {
    const months = [
      mo("2025-12", -100000), mo("2026-01", -90000), mo("2026-02", -80000), mo("2026-03", -70000),
      mo("2026-04", -60000), mo("2026-05", -50000), mo("2026-06", -40000),
      mo("2026-07", -5000, true), // current partial — excluded
    ];
    const t = computeLossTrend(months);
    expect(t.completeMonths).toBe(7);
    expect(t.allNegative).toBe(true);
    expect(t.negativeCount).toBe(7);
    expect(t.latest).toEqual({ month: "2026-06", netIncome: -40000 });
    expect(t.baseline).toEqual({ month: "2025-12", netIncome: -100000 }); // 6 complete months back
    expect(t.improvedBy).toBe(60000); // -40k − (-100k) = +60k, less negative
    expect(t.direction).toBe("improving");
  });

  it("reports worsening when the latest loss is deeper than the baseline", () => {
    const t = computeLossTrend([mo("2026-05", -20000), mo("2026-06", -50000)]);
    expect(t.improvedBy).toBe(-30000);
    expect(t.direction).toBe("worsening");
  });

  it("has no baseline (unknown direction) with a single complete month", () => {
    const t = computeLossTrend([mo("2026-06", -10000), mo("2026-07", -1000, true)]);
    expect(t.completeMonths).toBe(1);
    expect(t.baseline).toBeNull();
    expect(t.improvedBy).toBeNull();
    expect(t.direction).toBe("unknown");
  });
});

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
