import { describe, it, expect } from "vitest";
import { classifyAccount, rollup, getBudgetScorecard, getTopVendors } from "./finance-pnl-service";

describe("classifyAccount", () => {
  it("classifies QB P&L accounts into groups", () => {
    // The parallel "Match Shopify Total Sales Breakdown" tree is a DUPLICATE of the
    // primary revenue accounts — it must NOT roll into the P&L (it double-counted
    // revenue ~70% and manufactured phantom profit). It classifies as 'duplicate'.
    expect(classifyAccount("1 - Gross Sales (Match Shopify Total Sales Breakdown)")).toBe("duplicate");
    expect(classifyAccount("2 - Discounts (Match Shopify Total Sales Breakdown)")).toBe("duplicate");
    expect(classifyAccount("3 - Returns/Refunds (Match Shopify Total Sales Breakdown) + Amazon")).toBe("duplicate");
    // The PRIMARY accounts (no "Match Shopify" suffix) classify normally.
    expect(classifyAccount("Gross Sales")).toBe("income");
    expect(classifyAccount("3 - Returns/Refunds + Amazon")).toBe("contra");
    expect(classifyAccount("Cost of Goods Sold")).toBe("cogs");
    expect(classifyAccount("Advertising & Marketing")).toBe("expense");
    expect(classifyAccount("Shipping, Freight & Delivery")).toBe("expense");
  });

  it("classifies the A2X connector revenue accounts as income (live since 6/24)", () => {
    expect(classifyAccount("Channel sales:Shopify sales")).toBe("income");
    expect(classifyAccount("Shopify sales")).toBe("income");
    expect(classifyAccount("Shopify Shipping")).toBe("income");
    // The liability account must NOT match the income regex, and fee/clearing
    // accounts stay out of income.
    expect(classifyAccount("Shopify Sales Tax Collected")).not.toBe("income");
    expect(classifyAccount("Shopify fees")).toBe("expense");
  });
});

describe("rollup excludes the Match-Shopify duplicate tree", () => {
  it("does not double-count the parallel income tree (no phantom profit)", () => {
    // Real June-ish shape: primary tree nets ~199,698; the duplicate tree would add
    // ~138,230 of phantom income if summed. The roll-up must ignore it entirely.
    const items = [
      { account: "Gross Sales", amount: 228534 },
      { account: "Discounts", amount: -11463 },
      { account: "Returns and Refunds", amount: -17374 },
      { account: "Cost of Goods Sold", amount: 60000 },
      { account: "Advertising & Marketing", amount: 200000 },
      // duplicate tree — must be skipped:
      { account: "1 - Gross Sales (Match Shopify Total Sales Breakdown)", amount: 161431 },
      { account: "2 - Discounts (Match Shopify Total Sales Breakdown)", amount: -11463 },
      { account: "3 - Returns/Refunds (Match Shopify Total Sales Breakdown) + Amazon", amount: -11738 },
    ];
    const r = rollup(items);
    expect(r.netSales).toBe(199697); // 228534 - 11463 - 17374, dup tree excluded
    expect(r.netIncome).toBe(-60303); // 199697 - 60000 - 200000 → a LOSS, not phantom profit
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
  // db.execute order: (1) vendors, (2) net-sales per-account rows, (3) pyvott amount, (4) order count
  function mockDb(vendors: any[], nsAccounts: any[], pyvott: number, orders: number) {
    let call = 0;
    return {
      execute: async () => {
        call += 1;
        if (call === 1) return { rows: vendors };
        if (call === 2) return { rows: nsAccounts };
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
    const nsAccounts = [
      { account: "Gross Sales", amount: 850645 },
      { account: "Discounts", amount: -25000 },
    ];
    const v = await getTopVendors(mockDb(vendors, nsAccounts, 67000, 1500), 3, 15);
    expect(v.netSales).toBe(825645);
    expect(v.vendors[0].vendor).toBe("Pyvott");
    expect(v.vendors[0].pctOfNetSales).toBeCloseTo(8.1, 1);
    expect(v.fulfillment?.costPerOrder).toBeCloseTo(44.67, 1); // 67000 / 1500
  });

  it("REGRESSION: net sales excludes the Match-Shopify duplicate tree and includes other income", async () => {
    // The old raw ILIKE summed the duplicate tree (phantom revenue) and missed
    // \bincome\b accounts. classifyAccount handles both.
    const nsAccounts = [
      { account: "Gross Sales", amount: 100000 },
      { account: "Discounts given", amount: -5000 },
      { account: "1 - Gross Sales (Match Shopify Total Sales Breakdown)", amount: 70000 }, // duplicate → excluded
      { account: "2 - Discounts (Match Shopify Total Sales Breakdown)", amount: -3000 },   // duplicate → excluded
      { account: "Interest Income", amount: 250 },                                          // income → included
      { account: "Cost of Goods Sold", amount: 35000 },                                     // cogs → excluded
    ];
    const v = await getTopVendors(mockDb([], nsAccounts, 0, 0), 3, 15);
    expect(v.netSales).toBe(95250); // 100000 - 5000 + 250; NOT 162250
  });
});
