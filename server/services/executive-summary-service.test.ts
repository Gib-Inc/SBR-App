import { describe, it, expect } from "vitest";
import { buildExecutiveSummary } from "./executive-summary-service";
import { EXECUTIVE_SUMMARY } from "../data/finance-docs";

// Synthetic: 2 months of 2025 + 3 months of 2026 (the latest year = YTD).
const MONTHLY = [
  { month: "Jan 2025", totalIncome: 100000, grossProfit: 50000, netIncome: -10000, totalExpenses: 60000, expenseCategories: { "Advertising & Marketing": 30000, "Payroll Expenses": 0 } },
  { month: "Feb 2025", totalIncome: 100000, grossProfit: 50000, netIncome: -10000, totalExpenses: 60000, expenseCategories: { "Advertising & Marketing": 30000, "Payroll Expenses": 0 } },
  { month: "Jan 2026", totalIncome: 50000, grossProfit: 20000, netIncome: -20000, totalExpenses: 40000, expenseCategories: { "Advertising & Marketing": 25000, "Payroll Expenses": 10000 } },
  { month: "Feb 2026", totalIncome: 50000, grossProfit: 20000, netIncome: -20000, totalExpenses: 40000, expenseCategories: { "Advertising & Marketing": 25000, "Payroll Expenses": 10000 } },
  { month: "Mar 2026", totalIncome: 50000, grossProfit: 20000, netIncome: -20000, totalExpenses: 40000, expenseCategories: { "Advertising & Marketing": 25000, "Payroll Expenses": 10000 } },
];
const BS = {
  asOf: "2026-03-31", cash: 50000, totalAssets: 300000, totalLiabilities: 900000, totalEquity: -600000,
  totalCurrentAssets: 100000, totalCurrentLiabilities: 400000,
  shortTermNotes: 500000, creditCards: 200000, longTermLiabilities: 200000,
};

describe("buildExecutiveSummary", () => {
  it("computes YTD P&L figures from the latest year only", () => {
    const s = buildExecutiveSummary({ monthly: MONTHLY, balanceSheet: BS, cashOnHand: null });
    expect(s.headline.ytdYear).toBe(2026);
    expect(s.headline.ytdMonths).toBe(3);
    expect(s.headline.ytdNetLoss).toBe(-60000); // 3 × -20k, NOT including 2025
    expect(s.headline.ytdNetLossPctOfRevenue).toBe(-40); // -60k / 150k
    expect(s.headline.fullYearLossProjection).toBe(-240000); // -60k / 3 × 12
    expect(s.asOf).toBe("2026-03-31");
  });

  it("computes margins, ad %, payroll % from YTD", () => {
    const s = buildExecutiveSummary({ monthly: MONTHLY, balanceSheet: BS, cashOnHand: null });
    const ratio = (m: string) => s.ratios.find((r: any) => r.metric.startsWith(m))?.value;
    expect(ratio("Gross margin")).toBe("40%"); // 60k / 150k
    expect(ratio("Ad spend")).toBe("50%"); // 75k / 150k
    expect(ratio("Payroll")).toBe("20%"); // 30k / 150k
  });

  it("derives balance-sheet ratios + debt breakdown", () => {
    const s = buildExecutiveSummary({ monthly: MONTHLY, balanceSheet: BS, cashOnHand: null });
    expect(s.headline.ownersEquity).toBe(-600000);
    expect(s.headline.totalDebt).toBe(900000);
    expect(s.headline.debtBreakdown).toEqual({ shortTermLoans: 500000, creditCards: 200000, sba: 200000 });
    expect(s.ratios.find((r: any) => r.metric === "Current ratio")?.value).toBe("0.25"); // 100k/400k
    expect(s.ratios.find((r: any) => r.metric === "Debt-to-assets")?.value).toBe("3.00×"); // 900k/300k
  });

  it("ad ROI per $1 by year, latest labeled YTD", () => {
    const s = buildExecutiveSummary({ monthly: MONTHLY, balanceSheet: BS, cashOnHand: null });
    expect(s.adRoiByYear).toEqual([
      { year: "2025", value: 3.33 }, // 200k / 60k
      { year: "2026 YTD", value: 2 }, // 150k / 75k
    ]);
    expect(s.roiDropPct).toBe(40); // (3.33 - 2) / 3.33
  });

  it("overlays live cash on hand over the balance-sheet cash", () => {
    const s = buildExecutiveSummary({ monthly: MONTHLY, balanceSheet: BS, cashOnHand: 86652 });
    expect(s.headline.cashOnHand).toBe(86652);
    expect(s.ratios.find((r: any) => r.metric === "Cash position")?.value).toBe("$86,652");
  });

  it("flags insolvency + structural unprofitability as findings", () => {
    const s = buildExecutiveSummary({ monthly: MONTHLY, balanceSheet: BS, cashOnHand: null });
    expect(s.critical).toMatch(/technically insolvent/i);
    expect(s.findings.some((f: any) => f.title === "Insolvent")).toBe(true);
    expect(s.findings.some((f: any) => f.title === "Expenses exceed gross profit")).toBe(true);
    // every finding emitted only when its condition holds → none are vacuous
    expect(s.findings.length).toBeGreaterThan(0);
  });

  it("returns the seed constant verbatim when no months are uploaded", () => {
    const s = buildExecutiveSummary({ monthly: [], balanceSheet: BS, cashOnHand: null });
    expect(s).toBe(EXECUTIVE_SUMMARY);
  });

  it("treats zero ad spend as no-ROI (null), not a $0.00 catastrophe", () => {
    const noAds = MONTHLY.map((m) =>
      m.month.endsWith("2026") ? { ...m, expenseCategories: { ...m.expenseCategories, "Advertising & Marketing": 0 } } : m);
    const s = buildExecutiveSummary({ monthly: noAds, balanceSheet: BS, cashOnHand: null });
    expect(s.adRoiByYear.find((r: any) => r.year === "2026 YTD")?.value).toBeNull();
    // No false "Ad ROI below floor" finding for a year that simply spent nothing on ads
    expect(s.findings.some((f: any) => f.title === "Ad ROI below floor")).toBe(false);
  });

  it("says 'profit' not 'loss' when insolvent on the balance sheet but YTD is profitable", () => {
    const profitable = MONTHLY.map((m) =>
      m.month.endsWith("2026") ? { ...m, netIncome: 20000, grossProfit: 60000, totalExpenses: 40000 } : m);
    const s = buildExecutiveSummary({ monthly: profitable, balanceSheet: BS, cashOnHand: null });
    expect(s.headline.ownersEquity).toBe(-600000); // still insolvent
    expect(s.critical).toMatch(/full-year profit will be about/i);
    expect(s.critical).not.toMatch(/full-year loss/i);
    expect(s.findings.some((f: any) => f.title === "Operating at a loss")).toBe(false);
  });

  it("ignores stray future-dated months when picking the YTD year", () => {
    const withStray = [...MONTHLY, { month: "Jan 2027", totalIncome: 999, grossProfit: 1, netIncome: -500, totalExpenses: 500, expenseCategories: {} }];
    const s = buildExecutiveSummary({ monthly: withStray, balanceSheet: BS, cashOnHand: null, asOf: new Date("2026-06-15") });
    expect(s.headline.ytdYear).toBe(2026); // NOT 2027
    expect(s.headline.ytdMonths).toBe(3);
  });

  it("nulls the Dec-2025 debt-change on the live path (no prior BS to compare)", () => {
    const live = buildExecutiveSummary({ monthly: MONTHLY, balanceSheet: BS, cashOnHand: null, computed: true });
    expect(live.headline.totalDebtChangePctSinceDec2025).toBeNull();
    const seedBs = buildExecutiveSummary({ monthly: MONTHLY, balanceSheet: BS, cashOnHand: null, computed: false });
    expect(seedBs.headline.totalDebtChangePctSinceDec2025).toBe(EXECUTIVE_SUMMARY.headline.totalDebtChangePctSinceDec2025);
  });
});
