import { describe, it, expect, vi } from "vitest";

/**
 * Tests for corrected-ad-spend:
 *  - allocateBreakdownToTotal (pure)
 *  - getCorrectedMonthlyAdSpend READER must COLLAPSE overlapping snapshot windows
 *    before summing (Layer A of ADSPEND-DEDUP-SPEC.md). Windsor writes a fresh
 *    rolling-30d window DAILY; a blind SUM multi-counts them (the ~6.5x bug). The
 *    reader must keep one window per (platform, overlapping period) and apply
 *    windsor-beats-upload precedence.
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

import { allocateBreakdownToTotal, getCorrectedMonthlyAdSpend } from "./corrected-ad-spend";

const snap = (platform: string, source: string, periodStart: string, periodEnd: string, spend: number) =>
  ({ platform, source, periodStart, periodEnd, spend });

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

describe("getCorrectedMonthlyAdSpend — collapse + precedence (anti-double-count)", () => {
  it("collapses overlapping Windsor rolling-30d windows to ONE (never sums them)", async () => {
    // Three daily rolling windows, all period_start in May, overlapping ~29 days.
    // Blind sum would be 9234+9613+9871 = 28,718. Correct = latest window 9,871.
    h.state.active = [
      snap("GOOGLE", "windsor:google_ads", "2026-05-08", "2026-06-06", 9234),
      snap("GOOGLE", "windsor:google_ads", "2026-05-09", "2026-06-07", 9613),
      snap("GOOGLE", "windsor:google_ads", "2026-05-10", "2026-06-08", 9871),
    ];
    const out = await getCorrectedMonthlyAdSpend();
    expect(out.get("2026-05")!.byPlatform.GOOGLE).toBe(9871);
    expect(out.get("2026-05")!.byPlatform.GOOGLE).not.toBe(28718);
  });

  it("Windsor beats an overlapping upload for the same channel/month (no sum)", async () => {
    h.state.active = [
      snap("GOOGLE", "windsor:google_ads", "2026-05-01", "2026-05-31", 10000),
      snap("GOOGLE", "upload:google.csv", "2026-05-02", "2026-05-30", 50000),
    ];
    const out = await getCorrectedMonthlyAdSpend();
    expect(out.get("2026-05")!.byPlatform.GOOGLE).toBe(10000); // windsor wins, CSV not added
  });

  it("keeps non-overlapping months separate (legitimately additive)", async () => {
    h.state.active = [
      snap("GOOGLE", "windsor:google_ads", "2026-04-01", "2026-04-30", 4000),
      snap("GOOGLE", "windsor:google_ads", "2026-05-01", "2026-05-31", 5000),
    ];
    const out = await getCorrectedMonthlyAdSpend();
    expect(out.get("2026-04")!.byPlatform.GOOGLE).toBe(4000);
    expect(out.get("2026-05")!.byPlatform.GOOGLE).toBe(5000);
  });

  it("keeps Meta from the manual tracker (Windsor doesn't cover Meta)", async () => {
    h.state.active = [
      snap("META", "manual:meta-tracker", "2026-06-01", "2026-06-07", 2073.67),
      snap("META", "manual:meta-tracker", "2026-06-08", "2026-06-14", 3636.37),
    ];
    const out = await getCorrectedMonthlyAdSpend();
    // two non-overlapping weekly windows in June → summed (correct): 5710.04
    expect(out.get("2026-06")!.byPlatform.META).toBeCloseTo(5710.04, 2);
  });
});
