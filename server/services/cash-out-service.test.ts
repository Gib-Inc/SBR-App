import { describe, it, expect } from "vitest";
import { addDaysYmd, buildRollingCashOut, bucketObligationsByDay, dailyInboundSchedule, buildScenarios, type ScenarioObl } from "./cash-out-service";

describe("addDaysYmd", () => {
  it("adds days and rolls month/year boundaries (UTC)", () => {
    expect(addDaysYmd("2026-06-29", 1)).toBe("2026-06-30");
    expect(addDaysYmd("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysYmd("2026-03-01", 0)).toBe("2026-03-01");
  });
});

describe("buildRollingCashOut", () => {
  it("threads each day's ending into the next day's opening", () => {
    const days = buildRollingCashOut(
      "2026-06-30", 3, 40000,
      { "2026-07-01": 9346, "2026-07-02": 281 },
      {
        "2026-06-30": [{ id: "a", amount: 8211, amountEstimated: false }],
        "2026-07-01": [{ id: "b", amount: 28641, amountEstimated: false }],
        "2026-07-02": [{ id: "c", amount: 3229, amountEstimated: false }],
      },
    );
    expect(days.map((d) => d.date)).toEqual(["2026-06-30", "2026-07-01", "2026-07-02"]);
    // day0: 40000 + 0 - 8211 = 31789
    expect(days[0].ending).toBe(31789);
    // day1: 31789 + 9346 - 28641 = 12494  (opening carried)
    expect(days[1].opening).toBe(31789);
    expect(days[1].ending).toBe(12494);
    // day2: 12494 + 281 - 3229 = 9546
    expect(days[2].opening).toBe(12494);
    expect(days[2].ending).toBe(9546);
  });

  it("FLAG-DON'T-FABRICATE: an estimated-$0 obligation adds $0 to payNow but flags the day incomplete", () => {
    const days = buildRollingCashOut(
      "2026-06-30", 1, 10000, {},
      { "2026-06-30": [
        { id: "mca", amount: 0, amountEstimated: true },   // unknown MCA pull
        { id: "bill", amount: 500, amountEstimated: false }, // known bill
      ] },
    );
    expect(days[0].payNow).toBe(500);          // only the known amount
    expect(days[0].unfundedCount).toBe(1);     // the MCA is unfunded
    expect(days[0].endingComplete).toBe(false); // ending is a ceiling
    expect(days[0].ending).toBe(9500);         // 10000 - 500 (MCA not subtracted — unknown)
  });

  it("returns empty for 0 days and never throws on missing date keys", () => {
    expect(buildRollingCashOut("2026-06-30", 0, 100, {}, {})).toEqual([]);
    const d = buildRollingCashOut("2026-06-30", 2, 100, {}, {});
    expect(d[1].opening).toBe(100); // nothing happened day 0 → carries flat
  });
});

describe("dailyInboundSchedule", () => {
  const payouts = {
    amazon: { channel: "amazon" as const, grossWindow: 0, feePct: 0.15, settlementDays: 14, netExpected: 1400 },
    shopify: { channel: "shopify" as const, grossWindow: 0, feePct: 0.029, settlementDays: 3, netExpected: 300 },
    totalNetExpected: 1700, asOf: "2026-06-30", basis: "sales-estimate" as const,
  };
  it("spreads each channel's net payout evenly across its settlement window", () => {
    const s = dailyInboundSchedule(payouts, "2026-06-30", 3);
    // day0: amazon 1400/14=100 + shopify 300/3=100 = 200
    expect(s["2026-06-30"]).toBeCloseTo(200, 2);
    expect(s["2026-07-01"]).toBeCloseTo(200, 2);
    expect(s["2026-07-02"]).toBeCloseTo(200, 2);
  });
  it("only Amazon contributes past the Shopify window (day 3+)", () => {
    const s = dailyInboundSchedule(payouts, "2026-06-30", 5);
    expect(s["2026-07-03"]).toBeCloseTo(100, 2); // amazon only (shopify done after 3 days)
    expect(s["2026-07-04"]).toBeCloseTo(100, 2);
  });
  it("summed over a wide window equals the total net payout (no cash invented or lost)", () => {
    const s = dailyInboundSchedule(payouts, "2026-06-30", 14);
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1700, 1);
  });
});

describe("buildScenarios (deterministic what-to-pay options)", () => {
  const obls: ScenarioObl[] = [
    { id: "mca", label: "Fresh MCA", amount: 2000, amountEstimated: false, tier: "mca" },
    { id: "tax", label: "941 deposit", amount: 3000, amountEstimated: false, tier: "tier1" },
    { id: "vendor", label: "Critical vendor", amount: 4000, amountEstimated: false, tier: "tier2" },
    { id: "flex", label: "Flexible bill", amount: 5000, amountEstimated: false, tier: "tier4" },
  ];
  // cash 6000 + inbound 1000 = budget 7000; available credit 10000
  const [payAll, conservative, preserveCash] = buildScenarios(obls, 6000, 1000, 10000);

  it("pay_all clears everything and reports the credit draw when budget falls short", () => {
    expect(payAll.totalPaid).toBe(14000);
    expect(payAll.endingCash).toBe(-7000);   // 7000 budget - 14000
    expect(payAll.creditDrawn).toBe(7000);
    expect(payAll.feasible).toBe(true);       // 7000 <= 10000 credit
    expect(payAll.defer).toEqual([]);
  });

  it("conservative pays only the unavoidable tiers (mca/tier1/tier2), defers the rest", () => {
    expect(conservative.pay.map((o) => o.id)).toEqual(["mca", "tax", "vendor"]);
    expect(conservative.defer.map((o) => o.id)).toEqual(["flex"]);
    expect(conservative.totalPaid).toBe(9000);
  });

  it("preserve_cash pays top-down only as far as cash+inbound reach, never drawing credit", () => {
    // budget 7000: mca 2000 -> 5000, tax 3000 -> 2000, vendor 4000 won't fit (>2000) -> defer, flex defer
    expect(preserveCash.pay.map((o) => o.id)).toEqual(["mca", "tax"]);
    expect(preserveCash.defer.map((o) => o.id)).toEqual(["vendor", "flex"]);
    expect(preserveCash.creditDrawn).toBe(0);
    expect(preserveCash.endingCash).toBe(2000);
  });

  it("infeasible when the credit draw exceeds available credit", () => {
    const [pa] = buildScenarios(obls, 0, 0, 1000); // budget 0, only 1000 credit, 14000 owed
    expect(pa.creditDrawn).toBe(14000);
    expect(pa.feasible).toBe(false);
  });
});

describe("bucketObligationsByDay", () => {
  const obls = [
    { id: "overdue", amount: 100, amountEstimated: false, dueDate: "2026-06-25" }, // before start → day0
    { id: "noDue", amount: 200, amountEstimated: false, dueDate: null },           // no due → day0
    { id: "today", amount: 300, amountEstimated: false, dueDate: "2026-06-30" },
    { id: "d2", amount: 400, amountEstimated: false, dueDate: "2026-07-02" },
    { id: "beyond", amount: 500, amountEstimated: false, dueDate: "2026-07-10" },  // past window → dropped
  ];
  it("pulls overdue + undated to day 0, keeps in-window, drops beyond-window", () => {
    const m = bucketObligationsByDay(obls, "2026-06-30", 3); // window 06-30..07-02
    expect(m["2026-06-30"].map((o) => o.id).sort()).toEqual(["noDue", "overdue", "today"]);
    expect(m["2026-07-02"].map((o) => o.id)).toEqual(["d2"]);
    expect(m["2026-07-10"]).toBeUndefined(); // beyond window dropped
  });
});
