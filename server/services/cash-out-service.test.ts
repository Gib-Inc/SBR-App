import { describe, it, expect } from "vitest";
import { addDaysYmd, buildRollingCashOut, bucketObligationsByDay } from "./cash-out-service";

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
