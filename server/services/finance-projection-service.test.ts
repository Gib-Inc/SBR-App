import { describe, it, expect } from "vitest";
import {
  addMonths, defaultDriver, buildRevenueForecast, assembleProjection, getProjection,
  type ResolvedCategory,
} from "./finance-projection-service";
import { rollup } from "./finance-pnl-service";

describe("addMonths", () => {
  it("adds months across year boundaries", () => {
    expect(addMonths("2026-06", 1)).toBe("2026-07");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", 12)).toBe("2027-01");
    expect(addMonths("2025-11", 3)).toBe("2026-02");
    expect(addMonths("2026-06", 0)).toBe("2026-06");
  });
});

describe("defaultDriver", () => {
  it("treats COGS and demand-linked spend as variable, the rest as fixed", () => {
    expect(defaultDriver("Cost of Goods Sold", "cogs")).toBe("variable");
    expect(defaultDriver("Advertising & Marketing", "expense")).toBe("variable");
    expect(defaultDriver("Shipping, Freight & Delivery", "expense")).toBe("variable");
    expect(defaultDriver("Merchant Account Fees", "expense")).toBe("variable");
    expect(defaultDriver("Patent Royalties", "expense")).toBe("variable");
    expect(defaultDriver("Wages", "expense")).toBe("fixed");
    expect(defaultDriver("Rent - Building & Property", "expense")).toBe("fixed");
    expect(defaultDriver("Owner Compensation (Zo)", "expense")).toBe("fixed");
  });
});

describe("buildRevenueForecast", () => {
  it("forecasts flat at base when growth is 0", () => {
    const f = buildRevenueForecast({ base: 200000, startMonth: "2026-06", months: 3, growthPct: 0 });
    expect(f.map((x) => x.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(f.every((x) => x.netSales === 200000)).toBe(true);
    expect(f.every((x) => x.overridden === false)).toBe(true);
  });

  it("compounds monthly growth from the base", () => {
    const f = buildRevenueForecast({ base: 100000, startMonth: "2026-06", months: 3, growthPct: 10 });
    expect(f[0].netSales).toBe(100000);          // (1.1)^0
    expect(f[1].netSales).toBe(110000);          // (1.1)^1
    expect(f[2].netSales).toBeCloseTo(121000, 0); // (1.1)^2
  });

  it("applies per-month overrides", () => {
    const f = buildRevenueForecast({ base: 200000, startMonth: "2026-06", months: 3, growthPct: 0, overrides: { "2026-07": 450000 } });
    expect(f[1].netSales).toBe(450000);
    expect(f[1].overridden).toBe(true);
    expect(f[0].netSales).toBe(200000);
  });
});

describe("assembleProjection", () => {
  const forecast = buildRevenueForecast({ base: 200000, startMonth: "2026-06", months: 12, growthPct: 0 });
  const cats: ResolvedCategory[] = [
    { account: "Cost of Goods Sold", group: "cogs", driver: "variable", ratePct: 35, fixedAmount: null, source: "default", trailingTotal: 0, trailingMonthlyAvg: 0, trailingPctOfSales: 35 },
    { account: "Advertising & Marketing", group: "expense", driver: "variable", ratePct: 20, fixedAmount: null, source: "default", trailingTotal: 0, trailingMonthlyAvg: 0, trailingPctOfSales: 20 },
    { account: "Wages", group: "expense", driver: "fixed", ratePct: null, fixedAmount: 15000, source: "default", trailingTotal: 0, trailingMonthlyAvg: 15000, trailingPctOfSales: null },
  ];

  it("projects variable as % of sales and fixed as flat, and rolls up net income", () => {
    const p = assembleProjection({ startMonth: "2026-06", months: 12, baseMethod: "trailing3", growthPct: 0, revenueBase: 200000, forecast, categories: cats, reclassification: [] });
    const m0 = p.forecast[0];
    expect(m0.netSales).toBe(200000);
    expect(m0.cogs).toBe(70000);       // 35% of 200k
    expect(m0.expenses).toBe(55000);   // 20% of 200k (40k) + 15k wages
    expect(m0.netIncome).toBe(75000);  // 200k - 70k - 55k
    expect(m0.cumulativeNetIncome).toBe(75000);
    expect(p.forecast[1].cumulativeNetIncome).toBe(150000);
    expect(p.summary.annualRevenue).toBe(2400000);
    expect(p.summary.annualNetIncome).toBe(900000);
    expect(p.summary.firstProfitableMonth).toBe("2026-06");
    // category annual totals
    const mkt = p.categories.find((c) => c.account === "Advertising & Marketing")!;
    expect(mkt.annualTotal).toBe(40000 * 12);
  });

  it("finds the breakeven month when a loss-making business grows into profit", () => {
    // Fixed costs heavy; revenue grows 15%/mo from a base that starts in the red.
    const grow = buildRevenueForecast({ base: 100000, startMonth: "2026-06", months: 12, growthPct: 15 });
    const heavy: ResolvedCategory[] = [
      { account: "Cost of Goods Sold", group: "cogs", driver: "variable", ratePct: 35, fixedAmount: null, source: "default", trailingTotal: 0, trailingMonthlyAvg: 0, trailingPctOfSales: 35 },
      { account: "Fixed Overhead", group: "expense", driver: "fixed", ratePct: null, fixedAmount: 90000, source: "default", trailingTotal: 0, trailingMonthlyAvg: 90000, trailingPctOfSales: null },
    ];
    const p = assembleProjection({ startMonth: "2026-06", months: 12, baseMethod: "trailing3", growthPct: 15, revenueBase: 100000, forecast: grow, categories: heavy, reclassification: [] });
    // month0: 100k - 35k - 90k = -25k (loss); later months grow into profit
    expect(p.forecast[0].netIncome).toBeLessThan(0);
    expect(p.summary.firstProfitableMonth).not.toBeNull();
    const fp = p.forecast.find((m) => m.month === p.summary.firstProfitableMonth)!;
    expect(fp.netIncome).toBeGreaterThanOrEqual(0);
    // the month before breakeven is still a loss
    const idx = p.forecast.indexOf(fp);
    if (idx > 0) expect(p.forecast[idx - 1].netIncome).toBeLessThan(0);
  });

  it("reports null breakeven when never profitable", () => {
    const flat = buildRevenueForecast({ base: 100000, startMonth: "2026-06", months: 6, growthPct: 0 });
    const losing: ResolvedCategory[] = [
      { account: "Fixed Overhead", group: "expense", driver: "fixed", ratePct: null, fixedAmount: 150000, source: "default", trailingTotal: 0, trailingMonthlyAvg: 150000, trailingPctOfSales: null },
    ];
    const p = assembleProjection({ startMonth: "2026-06", months: 6, baseMethod: "trailing3", growthPct: 0, revenueBase: 100000, forecast: flat, categories: losing, reclassification: [] });
    expect(p.summary.firstProfitableMonth).toBeNull();
    expect(p.summary.cumulativeBreakevenMonth).toBeNull();
    expect(p.summary.annualNetIncome).toBe((100000 - 150000) * 6);
  });
});

describe("getProjection revenue base excludes the Match-Shopify duplicate tree (REGRESSION)", () => {
  // The old raw ILIKE ("%gross sales%"/"%discount%"/...) matched BOTH income trees and
  // inflated the projection's revenue base ~1.7x — phantom path-to-breakeven. Every
  // month here carries the duplicate tree; the classifier must drop it.
  const MONTHS = ["2026-04", "2026-05", "2026-06"];
  const perMonthAccounts = MONTHS.flatMap((month) => [
    { month, account: "Gross Sales", amount: 100000 },
    { month, account: "Discounts given", amount: -5000 },
    { month, account: "1 - Gross Sales (Match Shopify Total Sales Breakdown)", amount: 70000 },
    { month, account: "2 - Discounts (Match Shopify Total Sales Breakdown)", amount: -3000 },
  ]);
  // db.execute order in getProjection: (1) net-sales per-month-per-account rows,
  // (2) per-account cost totals, (3) reclassify vendor rows, (4) assumptions, (5) settings
  function mockDb() {
    let call = 0;
    return {
      execute: async () => {
        call += 1;
        if (call === 1) return { rows: perMonthAccounts };
        if (call === 2) return { rows: [{ account: "Cost of Goods Sold", amount: 99750 }, { account: "Wages", amount: 45000 }] };
        if (call === 3) return { rows: [] };
        if (call === 4) return { rows: [] };
        return { rows: [] }; // settings
      },
    } as any;
  }

  it("revenue base = primary tree only, in exact parity with the Budget Scorecard rollup", async () => {
    const p = await getProjection(mockDb(), { months: 3 });
    // trailing-3 average of the TRUE net sales (95k/mo), not the inflated 162k
    expect(p.revenueBase).toBe(95000);
    // parity: the same month's rows through the Scorecard's rollup() give the same net sales
    const juneRows = perMonthAccounts.filter((r) => r.month === "2026-06")
      .map((r) => ({ account: r.account, amount: r.amount }));
    expect(Math.abs(p.revenueBase - rollup(juneRows).netSales)).toBeLessThan(1);
    // COGS % of sales must be computed against the TRUE base too: 99750 / 285000 = 35%
    const cogs = p.categories.find((c) => c.account === "Cost of Goods Sold")!;
    expect(cogs.trailingPctOfSales).toBe(35);
    // and the projection starts after the latest actual month
    expect(p.startMonth).toBe("2026-07");
  });

  it("a projection fed the duplicate tree would have called the business profitable — the fix flips it to the truth", async () => {
    const p = await getProjection(mockDb(), { months: 3 });
    // true picture: 95000 - (35% cogs) - 15000 wages/mo ≈ 46,750/mo profit on these toy
    // numbers — the POINT is the base: with the old bug the base would be 162,000 and
    // every downstream % (cogs 21.6%!) and breakeven month would be fiction.
    expect(p.forecast[0].netSales).toBe(95000);
    expect(p.forecast.every((m) => m.netSales === 95000)).toBe(true);
  });
});
