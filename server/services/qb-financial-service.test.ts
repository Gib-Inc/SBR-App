import { describe, it, expect } from "vitest";
import { bucketAging, parseProfitAndLoss, computeConfidence } from "./qb-financial-service";

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
