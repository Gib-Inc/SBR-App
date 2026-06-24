import { describe, it, expect } from "vitest";
import { classifyAccount, getBudgetScorecard, getTopVendors } from "./finance-pnl-service";

describe("classifyAccount", () => {
  it("classifies QB P&L accounts into groups", () => {
    expect(classifyAccount("1 - Gross Sales (Match Shopify Total Sales Breakdown)")).toBe("income");
    expect(classifyAccount("2 - Discounts (Match Shopify Total Sales Breakdown)")).toBe("contra");
    expect(classifyAccount("3 - Returns/Refunds + Amazon")).toBe("contra");
    expect(classifyAccount("Cost of Goods Sold")).toBe("cogs");
    expect(classifyAccount("Advertising & Marketing")).toBe("expense");
    expect(classifyAccount("Shipping, Freight & Delivery")).toBe("expense");
  });
});

describe("getBudgetScorecard", () => {
  // db.execute: (1) monthly per-account data, (2) budget_targets
  function mockDb(data: any[], targets: any[]) {
    let call = 0;
    return { execute: async () => ({ rows: call++ === 0 ? data : targets }) } as any;
  }

  it("builds a P&L and budget-vs-actual with the breakeven gap", async () => {
    // One month (2026-05): gross 163475, discounts -6577, returns -7704, COGS 52096,
    // marketing 50754, shipping 21938 → netSales 149194.
    const data = [
      { month: "2026-05", account: "1 - Gross Sales", amount: 163475 },
      { month: "2026-05", account: "2 - Discounts", amount: -6577 },
      { month: "2026-05", account: "3 - Returns/Refunds + Amazon", amount: -7704 },
      { month: "2026-05", account: "Cost of Goods Sold", amount: 52096 },
      { month: "2026-05", account: "Advertising & Marketing", amount: 50754 },
      { month: "2026-05", account: "Shipping, Freight & Delivery", amount: 21938 },
    ];
    const targets = [
      { account_name: "Advertising & Marketing", target_pct: 25, sort_order: 20 },
      { account_name: "Shipping, Freight & Delivery", target_pct: 10, sort_order: 30 },
      { account_name: "Cost of Goods Sold", target_pct: 33, sort_order: 10 },
    ];
    const s = await getBudgetScorecard(mockDb(data, targets), 6, 3);
    const netSales = 163475 - 6577 - 7704; // 149194
    expect(s.summary.netSales).toBe(netSales);
    expect(s.summary.cogs).toBe(52096);
    expect(s.summary.grossProfit).toBe(149194 - 52096); // 97098
    expect(s.summary.totalExpenses).toBe(50754 + 21938); // 72692
    expect(s.summary.netIncome).toBe(97098 - 72692); // 24406 (single low-cost month here)
    // marketing actual % = 50754/149194 = 34.0%, target 25% → over
    const mkt = s.categories.find((c) => c.account === "Advertising & Marketing")!;
    expect(mkt.actualPct).toBeCloseTo(34.02, 1);
    expect(mkt.targetPct).toBe(25);
    expect(mkt.over).toBe(true);
    expect(mkt.variance).toBeCloseTo(50754 - 0.25 * netSales, 0); // ~13456 over
    // sorted by target sort_order: COGS(10) before Marketing(20) before Shipping(30)
    expect(s.categories.map((c) => c.account)).toEqual(["Cost of Goods Sold", "Advertising & Marketing", "Shipping, Freight & Delivery"]);
    // savings opportunities: ranked by annualized $ over, marketing biggest
    expect(s.opportunities[0].category).toBe("Advertising & Marketing");
    expect(s.opportunities[0].annualOver).toBeGreaterThan(s.opportunities[1].annualOver);
    expect(s.summary.potentialAnnualSavings).toBeGreaterThan(0);
  });

  it("reports the gap to breakeven when net income is negative", async () => {
    const data = [
      { month: "2026-05", account: "1 - Gross Sales", amount: 100000 },
      { month: "2026-05", account: "Cost of Goods Sold", amount: 40000 },
      { month: "2026-05", account: "Advertising & Marketing", amount: 50000 },
      { month: "2026-05", account: "Shipping, Freight & Delivery", amount: 25000 },
    ];
    const s = await getBudgetScorecard(mockDb(data, []), 6, 3);
    expect(s.summary.netIncome).toBe(-15000); // 100k - 40k - 75k
    expect(s.summary.toBreakeven).toBe(15000);
  });
});

describe("getTopVendors", () => {
  // db.execute order: (1) vendors, (2) net sales, (3) pyvott amount, (4) order count
  function mockDb(vendors: any[], netSales: number, pyvott: number, orders: number) {
    let call = 0;
    return {
      execute: async () => {
        call += 1;
        if (call === 1) return { rows: vendors };
        if (call === 2) return { rows: [{ net_sales: netSales }] };
        if (call === 3) return { rows: [{ amount: pyvott }] };
        return { rows: [{ orders }] };
      },
    } as any;
  }

  it("ranks vendors and computes Pyvott cost per order", async () => {
    const vendors = [
      { vendor: "Pyvott", amount: 67000, lines: 12, top_account: "Shipping, Freight & Delivery" },
      { vendor: "Facebook", amount: 25000, lines: 10, top_account: "Advertising & Marketing" },
    ];
    const v = await getTopVendors(mockDb(vendors, 825645, 67000, 1500), 3, 15);
    expect(v.vendors[0].vendor).toBe("Pyvott");
    expect(v.vendors[0].pctOfNetSales).toBeCloseTo(8.1, 1);
    expect(v.fulfillment?.costPerOrder).toBeCloseTo(44.67, 1); // 67000 / 1500
  });
});
