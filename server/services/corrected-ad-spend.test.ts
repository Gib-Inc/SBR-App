import { describe, it, expect, vi } from "vitest";

/**
 * Tests for corrected-ad-spend (pure helpers, no DB):
 *  - allocateBreakdownToTotal / reconcileRoasByMonthChannel — proportional scaling
 *  - daysInMonth / monthRangeOverlapFraction / prorateMonthsToRange — the day-proration
 *    that makes getCorrectedAdSpendRange a faithful slice of the canonical monthly
 *    truth (so the range view can never disagree with the monthly Summary).
 *
 * The DB-integrated readers (getCorrectedMonthlyAdSpend / getCorrectedAdSpendRange)
 * are thin wrappers over the canonical engine; their source precedence + snapshot
 * collapse is covered in canonical-spend-service.test.ts and
 * unified-performance-service.test.ts.
 */

const h = vi.hoisted(() => {
  const state: { active: any[] } = { active: [] };
  return {
    state,
    storage: {
      async getActiveMarketingSpendSnapshots() {
        return h.state.active;
      },
    },
  };
});

vi.mock("../storage", () => ({ storage: h.storage }));

import {
  allocateBreakdownToTotal,
  reconcileRoasByMonthChannel,
  daysInMonth,
  monthRangeOverlapFraction,
  prorateMonthsToRange,
  mergeRangePlatforms,
} from "./corrected-ad-spend";

describe("allocateBreakdownToTotal", () => {
  it("scales a breakdown proportionally so it sums to the corrected total", () => {
    const out = allocateBreakdownToTotal(
      [
        { campaign: "Brand", spend: 10, revenue: 100 },
        { campaign: "PMax", spend: 30, revenue: 300 },
      ],
      20, // corrected platform total (raw sums to 40 → factor 0.5)
    );
    expect(out.map((o) => o.spend)).toEqual([5, 15]);
    expect(out.reduce((s, o) => s + o.spend, 0)).toBe(20);
    expect(out.every((o) => o.allocated)).toBe(true);
    // relative shape preserved, other fields pass through
    expect(out[1].spend / out[0].spend).toBe(3);
    expect(out[0].revenue).toBe(100);
    expect(out[0].rawSpend).toBe(10);
  });

  it("leaves spend untouched when there is no corrected total (honest, not zeroed)", () => {
    const out = allocateBreakdownToTotal([{ device: "mobile", spend: 42 }], null);
    expect(out[0].spend).toBe(42);
    expect(out[0].allocated).toBe(false);
  });

  it("does not divide by zero when the raw breakdown has no spend", () => {
    const out = allocateBreakdownToTotal(
      [{ device: "mobile", spend: 0 }, { device: "desktop", spend: 0 }],
      9234,
    );
    expect(out.every((o) => o.spend === 0)).toBe(true);
    expect(out.every((o) => !o.allocated)).toBe(true);
  });

  it("treats a zero corrected total as nothing-to-allocate", () => {
    const out = allocateBreakdownToTotal([{ spend: 5 }, { spend: 5 }], 0);
    expect(out.map((o) => o.spend)).toEqual([5, 5]);
    expect(out.every((o) => !o.allocated)).toBe(true);
  });
});

describe("reconcileRoasByMonthChannel", () => {
  // The bug this guards against: reconciling every month to a single latest-month
  // total. Each month must reconcile to ITS OWN month+channel total.
  const rows = [
    { sku: "A", channel: "shopify", date: "2026-04-10", ad_spend: 10, revenue: 100 },
    { sku: "B", channel: "shopify", date: "2026-04-20", ad_spend: 30, revenue: 300 },
    { sku: "A", channel: "shopify", date: "2026-05-12", ad_spend: 10, revenue: 200 },
    { sku: "C", channel: "amazon", date: "2026-05-12", ad_spend: 5, revenue: 50 },
  ];

  it("scales each month+channel group to its own total, not one shared total", () => {
    const out = reconcileRoasByMonthChannel(rows, {
      "2026-04|shopify": 80, // April shopify raw 40 → factor 2
      "2026-05|shopify": 10, // May shopify raw 10 → factor 1
      "2026-05|amazon": 25, // May amazon raw 5 → factor 5
    });
    const by = (sku: string, ym: string) => out.find((o) => o.sku === sku && o.date.startsWith(ym))!;
    expect(by("A", "2026-04").spend).toBe(20); // 10*2
    expect(by("B", "2026-04").spend).toBe(60); // 30*2 — April reconciled to 80, NOT bled into May
    expect(by("A", "2026-05").spend).toBe(10); // 10*1
    expect(by("C", "2026-05").spend).toBe(25); // 5*5
    // April shopify sums to its own total
    const aprShopify = out.filter((o) => o.channel === "shopify" && o.date.startsWith("2026-04"));
    expect(aprShopify.reduce((s, o) => s + o.spend, 0)).toBe(80);
  });

  it("leaves a month with no total unscaled (allocated:false), never scaled to another month", () => {
    const out = reconcileRoasByMonthChannel(rows, { "2026-05|shopify": 10 });
    const apr = out.filter((o) => o.date.startsWith("2026-04"));
    expect(apr.every((o) => !o.allocated)).toBe(true);
    expect(apr.map((o) => o.spend).sort((a, b) => a - b)).toEqual([10, 30]); // raw, untouched
  });
});

// NOTE: getCorrectedMonthlyAdSpend / getCorrectedAdSpendRange are thin wrappers over
// the canonical spend engine (canonical-spend-service). Source precedence + snapshot
// collapse coverage lives in canonical-spend-service.test.ts (assembleMonth) +
// unified-performance-service.test.ts (monthlyOverlapSplit, filterCompliantSnapshots,
// collapseOverlappingSnapshots). The old snapshot-mock tests for this function were
// removed as obsolete.

describe("daysInMonth", () => {
  it("knows month lengths incl. 2026 (non-leap) February", () => {
    expect(daysInMonth("2026-01")).toBe(31);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2026-04")).toBe(30);
    expect(daysInMonth("2024-02")).toBe(29); // leap
  });
});

describe("monthRangeOverlapFraction", () => {
  it("is 1 when the month is fully inside the window", () => {
    expect(monthRangeOverlapFraction("2026-03", "2026-01-01", "2026-12-31")).toBe(1);
  });
  it("is 0 when the month is fully outside the window", () => {
    expect(monthRangeOverlapFraction("2026-01", "2026-03-01", "2026-04-30")).toBe(0);
  });
  it("prorates a partial leading month by in-window days ÷ days-in-month", () => {
    // last 2 days of a 31-day month → 2/31
    expect(monthRangeOverlapFraction("2026-05", "2026-05-30", "2026-06-28")).toBeCloseTo(2 / 31, 6);
  });
  it("prorates a partial trailing month", () => {
    // first 28 days of June (30-day month) → 28/30
    expect(monthRangeOverlapFraction("2026-06", "2026-05-30", "2026-06-28")).toBeCloseTo(28 / 30, 6);
  });
});

describe("monthRangeOverlapFraction — in-progress month (dataEnd clamps the spend span)", () => {
  it("counts an in-progress month IN FULL when the window covers its whole data span", () => {
    // July's spend covers Jul 1-9 only; a 30d window ending Jul 9 fully contains it → 1, NOT 9/31
    expect(monthRangeOverlapFraction("2026-07", "2026-06-10", "2026-07-09", "2026-07-09")).toBe(1);
  });
  it("prorates against the DATA span, not the calendar month", () => {
    // window covers Jul 1-5 of a Jul 1-9 data span → 5/9 (not 5/31)
    expect(monthRangeOverlapFraction("2026-07", "2026-07-01", "2026-07-05", "2026-07-09")).toBeCloseTo(5 / 9, 6);
  });
  it("a dataEnd at/after month-end leaves closed months untouched", () => {
    expect(monthRangeOverlapFraction("2026-06", "2026-06-01", "2026-06-30", "2026-07-09")).toBe(1);
    expect(monthRangeOverlapFraction("2026-05", "2026-05-30", "2026-06-28", "2026-07-09")).toBeCloseTo(2 / 31, 6);
  });
});

describe("prorateMonthsToRange", () => {
  const months = [
    { month: "2026-03", byChannel: { GOOGLE: { spend: 5000 }, META: { spend: 63164 }, AMAZON: { spend: null } } },
    { month: "2026-04", byChannel: { GOOGLE: { spend: 4059 }, META: { spend: 57164 } } },
  ];

  it("sums whole months at fraction 1", () => {
    const out = prorateMonthsToRange(months, "2026-03-01", "2026-04-30");
    expect(out.GOOGLE).toBeCloseTo(9059, 2);
    expect(out.META).toBeCloseTo(120328, 2);
  });

  it("keeps Meta present for the daily-card era (the bug the old engine had: Meta→0)", () => {
    const out = prorateMonthsToRange(months, "2026-03-01", "2026-03-31");
    expect(out.META).toBeCloseTo(63164, 2); // NOT 0 — canonical carries QB Meta
  });

  it("treats a null channel-month as a gap, never a fabricated 0", () => {
    const out = prorateMonthsToRange(months, "2026-03-01", "2026-04-30");
    expect(out.AMAZON).toBeUndefined(); // null spend contributed nothing, no 0 key
  });

  it("day-prorates a partial month (last 2 days of March)", () => {
    const out = prorateMonthsToRange(months, "2026-03-30", "2026-03-31");
    expect(out.GOOGLE).toBeCloseTo(5000 * (2 / 31), 2);
    expect(out.META).toBeCloseTo(63164 * (2 / 31), 2);
  });

  it("counts an in-progress month's fully-window-covered spend IN FULL (the July 9/31 bug)", () => {
    // July Meta $7,286.43 booked over Jul 1-9; a 30d window that fully contains
    // Jul 1-9 must take all of it — the old full-calendar-month proration took
    // only 9/31 (~$2,116) of real spend the window entirely covers.
    const july = [{ month: "2026-07", byChannel: { META: { spend: 7286.43 }, GOOGLE: { spend: null } } }];
    const out = prorateMonthsToRange(july, "2026-06-10", "2026-07-09", "2026-07-09");
    expect(out.META).toBeCloseTo(7286.43, 2);
    expect(out.GOOGLE).toBeUndefined(); // null stays a gap even with dataEnd
  });

  it("dataEnd does not disturb closed months in the same window", () => {
    const out = prorateMonthsToRange(months, "2026-03-01", "2026-04-30", "2026-07-09");
    expect(out.GOOGLE).toBeCloseTo(9059, 2);
    expect(out.META).toBeCloseTo(120328, 2);
  });
});

describe("mergeRangePlatforms (canonical vs live fallback)", () => {
  it("uses canonical spend (incl. a real 0) when canonical has the channel", () => {
    const out = mergeRangePlatforms(
      { GOOGLE: 4059, AMAZON: 0 },
      { GOOGLE: { spend: 99999, impressions: 10, clicks: 2 }, AMAZON: { spend: 5, impressions: 1, clicks: 1 } },
    );
    const g = out.find((p) => p.platform === "GOOGLE")!;
    const a = out.find((p) => p.platform === "AMAZON")!;
    expect(g.spend).toBe(4059); // canonical, NOT the inflated live 99999
    expect(g.source).toBe("canonical");
    expect(a.spend).toBe(0); // real canonical 0 trusted, not live 5
  });

  it("a GOVERNED-channel gap (Google/Meta) reports 0, NEVER the inflated/forbidden live feed", () => {
    // QB hasn't booked this window yet -> canonical has no GOOGLE/META key. live
    // ad_metrics carries the 3.65x-inflated Google sum and the compliance-forbidden
    // Meta feed. The merge must NOT resurrect them.
    const out = mergeRangePlatforms(
      {}, // canonical gap for everything
      {
        GOOGLE: { spend: 25713, impressions: 100, clicks: 20 },
        META: { spend: 8000, impressions: 50, clicks: 5 },
      },
    );
    const g = out.find((p) => p.platform === "GOOGLE")!;
    const m = out.find((p) => p.platform === "META")!;
    expect(g.spend).toBe(0); // not 25713
    expect(m.spend).toBe(0); // not 8000
    expect(g.source).toBe("canonical");
    expect(g.impressions).toBe(100); // impressions still surfaced from live
  });

  it("a NON-governed gap (Amazon/Pinterest) falls back to live ad_metrics (its real source)", () => {
    const out = mergeRangePlatforms(
      {}, // canonical gap
      { AMAZON: { spend: 2150, impressions: 9, clicks: 3 }, PINTEREST: { spend: 0, impressions: 0, clicks: 0 } },
    );
    const a = out.find((p) => p.platform === "AMAZON")!;
    expect(a.spend).toBe(2150); // live fallback is correct for ad_metrics-sourced channels
    expect(a.source).toBe("live");
  });
});
