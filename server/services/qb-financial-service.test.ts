import { describe, it, expect } from "vitest";
import { bucketAging, parseProfitAndLoss, computeConfidence, parseBalanceSheet, buildBillsDue } from "./qb-financial-service";

describe("bucketAging", () => {
  const asOf = new Date("2026-06-06T12:00:00");

  it("puts no-due-date and future-due balances in 'current'", () => {
    const b = bucketAging(
      [
        { balance: 100 }, // no due date
        { balance: 200, dueDate: "2026-07-06" }, // future
      ],
      asOf,
    );
    expect(b.current).toBe(300);
    expect(b.d1_30 + b.d31_60 + b.d61_90 + b.d90_plus).toBe(0);
  });

  it("buckets overdue balances by days past due", () => {
    const b = bucketAging(
      [
        { balance: 100 }, // current
        { balance: 200, dueDate: "2026-07-06" }, // current (future)
        { balance: 50, dueDate: "2026-05-22" }, // ~15d overdue -> 1-30
        { balance: 40, dueDate: "2026-04-22" }, // ~45d -> 31-60
        { balance: 30, dueDate: "2026-03-23" }, // ~75d -> 61-90
        { balance: 20, dueDate: "2026-01-06" }, // ~151d -> 90+
        { balance: 0, dueDate: "2026-05-22" }, // zero balance ignored
      ],
      asOf,
    );
    expect(b).toEqual({ current: 300, d1_30: 50, d31_60: 40, d61_90: 30, d90_plus: 20 });
  });

  it("treats an unparseable due date as current rather than dropping it", () => {
    const b = bucketAging([{ balance: 75, dueDate: "not-a-date" }], asOf);
    expect(b.current).toBe(75);
  });
});

describe("parseProfitAndLoss", () => {
  it("extracts the key totals by group, handling $ and commas", () => {
    const report = {
      Rows: {
        Row: [
          { group: "Income", Summary: { ColData: [{ value: "Total Income" }, { value: "10000.00" }] } },
          { group: "COGS", Summary: { ColData: [{ value: "Total COGS" }, { value: "4000.00" }] } },
          { group: "GrossProfit", Summary: { ColData: [{ value: "Gross Profit" }, { value: "6000.00" }] } },
          { group: "Expenses", Summary: { ColData: [{ value: "Total Expenses" }, { value: "$3,500.00" }] } },
          { group: "NetIncome", Summary: { ColData: [{ value: "Net Income" }, { value: "2500.00" }] } },
        ],
      },
    };
    expect(parseProfitAndLoss(report)).toEqual({
      totalIncome: 10000,
      grossProfit: 6000,
      operatingExpenses: 3500,
      netIncome: 2500,
    });
  });

  it("finds totals nested under parent rows", () => {
    const report = {
      Rows: {
        Row: [
          {
            Rows: {
              Row: [
                { group: "Expenses", Summary: { ColData: [{ value: "Total Expenses" }, { value: "1234.56" }] } },
              ],
            },
          },
        ],
      },
    };
    expect(parseProfitAndLoss(report).operatingExpenses).toBe(1234.56);
  });

  it("returns null for missing groups — never guesses", () => {
    const report = {
      Rows: { Row: [{ group: "Income", Summary: { ColData: [{ value: "Income" }, { value: "500" }] } }] },
    };
    const pl = parseProfitAndLoss(report);
    expect(pl.totalIncome).toBe(500);
    expect(pl.grossProfit).toBeNull();
    expect(pl.operatingExpenses).toBeNull();
    expect(pl.netIncome).toBeNull();
  });

  it("handles an empty/garbage report without throwing", () => {
    expect(parseProfitAndLoss(null)).toEqual({
      totalIncome: null,
      grossProfit: null,
      operatingExpenses: null,
      netIncome: null,
    });
  });
});

describe("computeConfidence", () => {
  it("is 100 when all core fields are populated", () => {
    expect(
      computeConfidence({
        cashOnHand: 1,
        accountsReceivable: 1,
        accountsPayable: 1,
        operatingExpenses: 1,
        grossProfit: 1,
        netIncome: 1,
        totalIncome: 1,
      }),
    ).toBe(100);
  });

  it("is 0 when nothing is populated", () => {
    expect(computeConfidence({})).toBe(0);
  });

  it("is the rounded share of populated core fields", () => {
    // 4 of 7 populated -> round(57.14) = 57
    expect(
      computeConfidence({ cashOnHand: 1, accountsReceivable: 1, accountsPayable: 1, operatingExpenses: 1 }),
    ).toBe(57);
  });

  it("treats null/undefined as not populated", () => {
    expect(computeConfidence({ cashOnHand: null, accountsReceivable: undefined })).toBe(0);
  });
});

describe("parseBalanceSheet", () => {
  // QB BalanceSheet report shape: nested Rows, summary rows carry group + ColData.
  const report = {
    Rows: { Row: [
      { group: "TotalCurrentAssets", Summary: { ColData: [{ value: "Total Current Assets" }, { value: "250,330.55" }] } },
      { group: "TotalAssets", Summary: { ColData: [{ value: "Total Assets" }, { value: "360,451.23" }] } },
      { group: "TotalCurrentLiabilities", Summary: { ColData: [{ value: "Total Current Liabilities" }, { value: "1,001,782" }] } },
      { Summary: { ColData: [{ value: "Total Equity" }, { value: "-907,465.34" }] } }, // no group, label only
      { group: "TotalLiabilitiesAndEquity", Summary: { ColData: [{ value: "TOTAL LIABILITIES AND EQUITY" }, { value: "360,451.23" }] } },
    ] },
  };

  it("extracts the headline totals (incl. $ and commas)", () => {
    const bs = parseBalanceSheet(report);
    expect(bs.totalAssets).toBe(360451.23);
    expect(bs.totalCurrentAssets).toBe(250330.55);
    expect(bs.totalEquity).toBe(-907465.34); // picked up by label even without a group
  });

  it("derives Total Liabilities from Liabilities+Equity − Equity when absent", () => {
    const bs = parseBalanceSheet(report);
    // 360,451.23 − (−907,465.34) = 1,267,916.57
    expect(bs.totalLiabilities).toBeCloseTo(1267916.57, 2);
  });

  it("returns nulls (never guesses) for an unrecognized report", () => {
    expect(parseBalanceSheet({})).toEqual({ totalAssets: null, totalCurrentAssets: null, totalLiabilities: null, totalCurrentLiabilities: null, totalEquity: null });
  });
});

describe("buildBillsDue", () => {
  const asOf = new Date("2026-06-08T12:00:00Z");

  it("ranks overdue first then largest, with vendor + days late", () => {
    const out = buildBillsDue([
      { Balance: 715, DueDate: "2026-05-20", VendorRef: { name: "FX Industries" }, DocNumber: "B-1" },     // 19d late
      { Balance: 9451, DueDate: "2026-04-01", VendorRef: { name: "Liston Metalworks" } },                   // ~68d late
      { Balance: 26964.64, DueDate: "2026-06-30", VendorRef: { value: "42" } },                              // not due yet
      { Balance: 0, DueDate: "2026-01-01", VendorRef: { name: "Zero" } },                                    // dropped (0 balance)
    ], asOf);
    expect(out).toHaveLength(3);
    expect(out[0].vendor).toBe("Liston Metalworks"); // most overdue
    expect(out[0].daysOverdue).toBeGreaterThan(60);
    expect(out[2].daysOverdue).toBe(0);              // future-dated bill, not late
    expect(out[2].vendor).toBe("42");                // falls back to VendorRef.value
  });

  it("handles null bills and missing due dates", () => {
    expect(buildBillsDue(null)).toEqual([]);
    const out = buildBillsDue([{ Balance: 100 }], asOf);
    expect(out[0].daysOverdue).toBe(0);
    expect(out[0].vendor).toBe("Unknown vendor");
  });
});
