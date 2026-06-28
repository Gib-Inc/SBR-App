import { describe, it, expect } from "vitest";
import { aggregateMonthlyFinancials } from "./qb-monthly-financials-sync";

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
});
