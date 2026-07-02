import { describe, it, expect } from "vitest";
import {
  aggregateMonthlyFinancials, monthLabelToYm, buildHistoricalRow, glAdSpend,
} from "./qb-monthly-financials-sync";

describe("aggregateMonthlyFinancials", () => {
  it("rolls GL lines into a monthly_financials P&L, netting contra income and grouping expenses", () => {
    const rows = [
      { month: "May 2026", account: "Gross Sales", amount: 100000 },
      { month: "May 2026", account: "Discounts given", amount: -5000 }, // contra
      { month: "May 2026", account: "Cost of Goods Sold", amount: 35000 },
      { month: "May 2026", account: "Advertising & Marketing", amount: 25000 },
      { month: "May 2026", account: "Payroll Expenses", amount: 20000 },
    ];
    const [m] = aggregateMonthlyFinancials(rows);
    expect(m.month).toBe("May 2026");
    expect(m.totalIncome).toBe(95000); // 100k gross - 5k discounts
    expect(m.totalCogs).toBe(35000);
    expect(m.grossProfit).toBe(60000); // 95k - 35k
    expect(m.totalExpenses).toBe(45000); // 25k + 20k
    expect(m.netIncome).toBe(15000); // 60k - 45k
    expect(m.expenseCategories).toEqual({ "Advertising & Marketing": 25000, "Payroll Expenses": 20000 });
  });

  it("keeps months separate", () => {
    const out = aggregateMonthlyFinancials([
      { month: "Apr 2026", account: "Gross Sales", amount: 50000 },
      { month: "May 2026", account: "Gross Sales", amount: 80000 },
    ]);
    expect(out.length).toBe(2);
    expect(out.find((x) => x.month === "Apr 2026")!.totalIncome).toBe(50000);
    expect(out.find((x) => x.month === "May 2026")!.totalIncome).toBe(80000);
  });

  it("splits gross sales and returns (for historical_monthly_sales) and still excludes the duplicate tree", () => {
    const [m] = aggregateMonthlyFinancials([
      { month: "Jun 2026", account: "Gross Sales", amount: 228534 },
      { month: "Jun 2026", account: "Discounts", amount: -11463 },
      { month: "Jun 2026", account: "Returns and Refunds", amount: -17374 },
      { month: "Jun 2026", account: "1 - Gross Sales (Match Shopify Total Sales Breakdown)", amount: 138230 }, // duplicate → dropped
      { month: "Jun 2026", account: "Cost of Goods Sold", amount: 41827 },
      { month: "Jun 2026", account: "Advertising & Marketing", amount: 53000 },
    ]);
    expect(m.grossSales).toBe(228534);
    expect(m.returns).toBe(-28837); // discounts + returns, negative
    expect(m.totalIncome).toBe(199697); // NOT +138,230 of phantom income
    expect(m.grossProfit).toBe(157870);
  });
});

describe("monthLabelToYm", () => {
  it("parses 'Mon YYYY' labels", () => {
    expect(monthLabelToYm("Jun 2026")).toEqual({ year: 2026, month: 6, ym: "2026-06" });
    expect(monthLabelToYm("Dec 2025")).toEqual({ year: 2025, month: 12, ym: "2025-12" });
    expect(monthLabelToYm(" Jan 2024 ")).toEqual({ year: 2024, month: 1, ym: "2024-01" });
  });
  it("rejects partial-month stopgap labels and garbage (never mis-keys a row)", () => {
    expect(monthLabelToYm("Jun 2026 (1-20)")).toBeNull();
    expect(monthLabelToYm("June 2026")).toBeNull();
    expect(monthLabelToYm("")).toBeNull();
  });
});

describe("buildHistoricalRow (live H2 sync of historical_monthly_sales)", () => {
  const june = aggregateMonthlyFinancials([
    { month: "Jun 2026", account: "Gross Sales", amount: 228534 },
    { month: "Jun 2026", account: "Discounts", amount: -16835 },
    { month: "Jun 2026", account: "Cost of Goods Sold", amount: 41827 },
    { month: "Jun 2026", account: "Advertising & Marketing", amount: 53000 },
    { month: "Jun 2026", account: "Wages", amount: 104512 },
  ])[0];

  it("maps a derived June into the historical row shape — the trajectory finally knows June happened", () => {
    const row = buildHistoricalRow(june, 53000)!;
    expect(row).toMatchObject({ year: 2026, month: 6 });
    expect(row.revenue).toBe(228534);
    expect(row.returns).toBe(-16835);
    expect(row.totalIncome).toBe(211699);          // net sales
    expect(row.cogs).toBe(41827);
    expect(row.grossProfit).toBe(169872);
    expect(row.totalExpenses).toBe(157512);
    expect(row.netIncome).toBe(12360);             // June: the first profitable month, ± rounding
    expect(row.adSpend).toBe(53000);
    expect(row.grossMarginPct).toBeCloseTo(80.24, 1); // grossProfit / NET income denominator
  });

  it("returns null on an unkeyable month label (partial-month stopgaps never land)", () => {
    expect(buildHistoricalRow({ ...june, month: "Jun 2026 (1-20)" }, 0)).toBeNull();
  });
});

describe("glAdSpend fallback", () => {
  it("sums only advertising/marketing categories from the GL", () => {
    const d = aggregateMonthlyFinancials([
      { month: "Jun 2026", account: "Gross Sales", amount: 100000 },
      { month: "Jun 2026", account: "Advertising & Marketing", amount: 40000 },
      { month: "Jun 2026", account: "Marketing Software", amount: 3000 },
      { month: "Jun 2026", account: "Wages", amount: 20000 },
    ])[0];
    expect(glAdSpend(d)).toBe(43000);
  });
});
