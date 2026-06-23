import { describe, it, expect } from "vitest";
import { merStatus, getBreakevenScoreboard, BREAKEVEN_MER } from "./marketing-breakeven-service";

const NOW = Date.UTC(2026, 5, 23, 18);

describe("merStatus", () => {
  it("flags below-breakeven and the gap", () => {
    expect(merStatus(4.3)).toEqual({ vs: -0.7, below: true });
    expect(merStatus(5.0)).toEqual({ vs: 0, below: false });
    expect(merStatus(6.2)).toEqual({ vs: 1.2, below: false });
    expect(merStatus(null)).toEqual({ vs: null, below: false });
  });
});

describe("getBreakevenScoreboard", () => {
  // db.execute order: (1) historical_monthly_sales, (2) daily_sales_snapshots revenue, (3) marketing_spend_snapshots
  function mockDb(qb: any[], revenue: number, snaps: any[]) {
    let call = 0;
    return {
      execute: async () => {
        call += 1;
        if (call === 1) return { rows: qb };
        if (call === 2) return { rows: [{ revenue }] };
        return { rows: snaps };
      },
    } as any;
  }

  it("computes closed-month MER vs the 5x breakeven and the agency gap", async () => {
    const qb = [
      { year: 2026, month: 4, revenue: 280979, ad_spend: 106650, net_income: -58852 },
      { year: 2026, month: 5, revenue: 163475, ad_spend: 50754, net_income: -48806 },
    ];
    const snaps = [
      { platform: "GOOGLE", periodStart: "2026-05-24", periodEnd: "2026-06-22", spend: 12291 },
      { platform: "META", periodStart: "2026-05-24", periodEnd: "2026-06-22", spend: 11545 },
      { platform: "AMAZON", periodStart: "2026-05-24", periodEnd: "2026-06-22", spend: 4557 },
    ];
    const s = await getBreakevenScoreboard(mockDb(qb, 215360, snaps), NOW);
    expect(s.breakeven).toBe(BREAKEVEN_MER);
    // May MER = 163475/50754 ≈ 3.22, below 5
    const may = s.monthly.find((m) => m.month === "2026-05")!;
    expect(may.mer).toBeCloseTo(3.22, 1);
    expect(may.belowBreakeven).toBe(true);
    expect(s.monthsBelowBreakeven).toBe(2); // both months below 5x
    // current window
    expect(s.current.mediaSpend).toBe(28393);
    expect(s.current.mediaRoas).toBeCloseTo(7.58, 1);    // revenue / media (flattering)
    expect(s.current.merEstimate).toBeCloseTo(4.24, 1);  // revenue / QB run-rate (50754)
    expect(s.current.agencyGap).toBe(22361);             // 50754 - 28393 (under-reported + other)
    // trajectory: May is the restart; pre = April (2.63x), trailing ~4.24x → improving
    expect(s.restartMonth).toBe("2026-05");
    expect(s.monthly.find((m) => m.month === "2026-05")!.isRestart).toBe(true);
    expect(s.trajectory.preRestartAvgMer).toBeCloseTo(2.63, 1);
    expect(s.trajectory.gapToBreakeven).toBeCloseTo(0.76, 1); // 5 - 4.24
    expect(s.trajectory.improving).toBe(true);
  });

  it("collapses overlapping platform windows so media spend isn't double-counted", async () => {
    const qb = [{ year: 2026, month: 5, revenue: 163475, ad_spend: 50754, net_income: -48806 }];
    const snaps = [
      { platform: "GOOGLE", periodStart: "2026-05-24", periodEnd: "2026-06-22", spend: 12291 },
      { platform: "GOOGLE", periodStart: "2026-05-23", periodEnd: "2026-06-21", spend: 12339 }, // overlaps
    ];
    const s = await getBreakevenScoreboard(mockDb(qb, 215360, snaps), NOW);
    // collapse keeps one GOOGLE window (latest period_end), not the sum 24630
    expect(s.current.mediaSpend).toBe(12291);
  });
});
