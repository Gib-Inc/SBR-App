import { describe, it, expect } from "vitest";
import {
  computeAdMetrics,
  movingAverage,
  consecutiveDaysBelow,
  generateDirective,
  analyzePlatforms,
  applyDataQualityGate,
  isImplausibleBlendedRoas,
  IMPLAUSIBLE_BLENDED_ROAS,
  ROAS_TARGET,
  ROAS_ESCALATE,
  ROAS_PAUSE,
  SEPTEMBER_RULE_DAYS,
  type PlatformDay,
} from "./marketing-analytics-service";

describe("computeAdMetrics", () => {
  it("derives ROAS, CAC, gross profit, contribution margin, LTV:CAC exactly", () => {
    const m = computeAdMetrics({
      spend: 1000,
      revenue: 9000,
      newCustomers: 50,
      grossMarginPct: 0.6,
      ltvPerCustomer: 300,
    });
    expect(m.roas).toBe(9); // 9000/1000
    expect(m.cac).toBe(20); // 1000/50
    expect(m.grossProfit).toBe(5400); // 9000 * 0.6
    expect(m.contributionMargin).toBe(4400); // 5400 - 1000
    expect(m.ltvToCac).toBe(15); // 300 / 20
  });

  it("handles zero spend and missing customers without NaN/Infinity", () => {
    const m = computeAdMetrics({ spend: 0, revenue: 500 });
    expect(m.roas).toBe(0);
    expect(m.cac).toBeNull();
    expect(m.ltvToCac).toBeNull();
    expect(Number.isFinite(m.contributionMargin)).toBe(true);
  });

  it("defaults gross margin to 60% when not provided", () => {
    const m = computeAdMetrics({ spend: 100, revenue: 1000 });
    expect(m.grossProfit).toBe(600);
    expect(m.contributionMargin).toBe(500);
  });
});

describe("movingAverage", () => {
  it("averages the trailing window", () => {
    expect(movingAverage([2, 4, 6, 8], 2)).toBe(7); // (6+8)/2
    expect(movingAverage([2, 4, 6, 8], 4)).toBe(5);
  });
  it("uses available values when series is shorter than the window", () => {
    expect(movingAverage([10, 20], 7)).toBe(15);
  });
  it("returns 0 for an empty series", () => {
    expect(movingAverage([], 7)).toBe(0);
  });
});

describe("consecutiveDaysBelow (September Rule streak)", () => {
  it("counts trailing days below threshold only", () => {
    // last 3 are below 8; the 9 breaks the streak
    expect(consecutiveDaysBelow([9, 7, 6, 5], ROAS_TARGET)).toBe(3);
  });
  it("is 0 when the most recent day is above threshold", () => {
    expect(consecutiveDaysBelow([4, 4, 9], ROAS_TARGET)).toBe(0);
  });
  it("counts the whole series when all are below", () => {
    expect(consecutiveDaysBelow([7, 7, 7, 7, 7], ROAS_TARGET)).toBe(5);
  });
});

describe("generateDirective — SBR guardrails", () => {
  const metrics = (roas: number) => computeAdMetrics({ spend: 1000, revenue: roas * 1000 });

  it("PAUSES below the 3x floor", () => {
    const d = generateDirective({ platform: "META", roasSeries: [2.5], today: metrics(2.5) });
    expect(d.action).toBe("PAUSE");
    expect(d.severity).toBe("critical");
    expect(d.magnitudePct).toBe(-100);
  });

  it("ESCALATES (cut 30%) below the 5x escalate line", () => {
    const d = generateDirective({ platform: "GOOGLE", roasSeries: [4], today: metrics(4) });
    expect(d.action).toBe("ESCALATE");
    expect(d.magnitudePct).toBe(-30);
    expect(d.severity).toBe("warn");
  });

  it("HOLDS between the escalate line and the target", () => {
    const d = generateDirective({ platform: "GOOGLE", roasSeries: [6.5], today: metrics(6.5) });
    expect(d.action).toBe("HOLD");
    expect(d.magnitudePct).toBe(0);
  });

  it("SCALES above the 8x target with magnitude by headroom", () => {
    const d10 = generateDirective({ platform: "GOOGLE", roasSeries: [9], today: metrics(9) });
    expect(d10.action).toBe("SCALE");
    expect(d10.magnitudePct).toBe(10); // 8 <= roas < 10

    const d15 = generateDirective({ platform: "GOOGLE", roasSeries: [12], today: metrics(12) });
    expect(d15.magnitudePct).toBe(15); // >= 1.25x target

    const d25 = generateDirective({ platform: "GOOGLE", roasSeries: [16], today: metrics(16) });
    expect(d25.magnitudePct).toBe(25); // >= 2x target
  });

  it("September Rule blocks a scale-up after 5 straight days below target", () => {
    // five days below 8, then a recovery to 9 today
    const series = [6, 6, 6, 6, 6, 9];
    const d = generateDirective({ platform: "GOOGLE", roasSeries: series, today: metrics(9) });
    expect(d.action).toBe("HOLD");
    expect(d.blockedBySeptemberRule).toBe(true);
    expect(d.severity).toBe("warn");
  });

  it("does NOT block a scale-up when the below-target streak is under 5 days", () => {
    const series = [6, 6, 9]; // only the recovery day matters; streak resets at 9
    const d = generateDirective({ platform: "GOOGLE", roasSeries: series, today: metrics(9) });
    expect(d.action).toBe("SCALE");
    expect(d.blockedBySeptemberRule).toBe(false);
  });

  it("de-escalates a healthy-ROAS platform when CAC breaches its target by >25%", () => {
    const today = computeAdMetrics({ spend: 1000, revenue: 6000, newCustomers: 10 }); // roas 6, cac 100
    const d = generateDirective({
      platform: "META",
      roasSeries: [6],
      today,
      cacTarget: 70, // 100 > 70 * 1.25
    });
    expect(d.action).toBe("REDUCE");
    expect(d.severity).toBe("warn");
  });
});

describe("analyzePlatforms", () => {
  const series: PlatformDay[] = [
    { platform: "GOOGLE", date: "2026-06-07", spend: 1000, revenue: 9000 },
    { platform: "GOOGLE", date: "2026-06-08", spend: 1000, revenue: 10000 },
    { platform: "META", date: "2026-06-07", spend: 500, revenue: 1200 },
    { platform: "META", date: "2026-06-08", spend: 500, revenue: 1000 }, // roas 2 → pause
  ];

  it("produces one directive per platform from the latest day", () => {
    const out = analyzePlatforms(series);
    expect(out).toHaveLength(2);
    const google = out.find((d) => d.platform === "GOOGLE")!;
    const meta = out.find((d) => d.platform === "META")!;
    expect(google.action).toBe("SCALE"); // roas 10 today
    expect(meta.action).toBe("PAUSE"); // roas 2 today
  });

  it("sorts most-urgent (critical) first", () => {
    const out = analyzePlatforms(series);
    expect(out[0].platform).toBe("META"); // critical pause before google scale
    expect(out[0].severity).toBe("critical");
  });
});

describe("applyDataQualityGate (never act on untrusted spend)", () => {
  const scaleDirective = generateDirective({
    platform: "BLENDED",
    roasSeries: [12],
    today: computeAdMetrics({ spend: 1000, revenue: 12000 }),
  });

  it("passes the directive through untouched when data is clean", () => {
    const out = applyDataQualityGate(scaleDirective, [], false);
    expect(out.action).toBe("SCALE");
    expect(out).toEqual(scaleDirective);
  });

  it("downgrades a SCALE to a HOLD when spend data is gapped", () => {
    const out = applyDataQualityGate(scaleDirective, ["GOOGLE spend missing"], true);
    expect(out.action).toBe("HOLD");
    expect(out.severity).toBe("warn");
    expect(out.reason).toContain("SCALE"); // preserves what the raw call would have been
    expect(out.reason).toMatch(/reconcile/i);
  });

  it("gates on dataGaps even when the gapped flag is false", () => {
    const out = applyDataQualityGate(scaleDirective, ["META uploaded snapshot stale"], false);
    expect(out.action).toBe("HOLD");
  });
});

describe("isImplausibleBlendedRoas (catches under-reported spend)", () => {
  it("flags ROAS above the plausibility ceiling", () => {
    expect(isImplausibleBlendedRoas(32)).toBe(true); // 387k rev / 12k spend
    expect(isImplausibleBlendedRoas(IMPLAUSIBLE_BLENDED_ROAS + 0.1)).toBe(true);
  });
  it("accepts ROAS within SBR's realistic band", () => {
    expect(isImplausibleBlendedRoas(10)).toBe(false);
    expect(isImplausibleBlendedRoas(IMPLAUSIBLE_BLENDED_ROAS)).toBe(false);
  });
});

describe("guardrail constants stay locked to SBR policy", () => {
  it("matches the non-negotiable ROAS floors", () => {
    expect(ROAS_TARGET).toBe(8);
    expect(ROAS_ESCALATE).toBe(5);
    expect(ROAS_PAUSE).toBe(3);
    expect(SEPTEMBER_RULE_DAYS).toBe(5);
    expect(IMPLAUSIBLE_BLENDED_ROAS).toBe(20);
  });
});
