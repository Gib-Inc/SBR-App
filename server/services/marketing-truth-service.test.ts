import { describe, it, expect } from "vitest";
import { verdictFor, contributionMerOf, assessConfidence, composeHeadline } from "./marketing-truth-service";
import { measuredFreightPct, composeRunwayMarginRate, impliedBreakevenMer } from "./contribution-margin-service";

describe("marketing-truth — verdicts & contribution MER", () => {
  it("verdictFor: above / below / unavailable", () => {
    expect(verdictFor(4.25, 2.19)).toBe("above");
    expect(verdictFor(1.8, 2.19)).toBe("below");
    expect(verdictFor(null, 2.19)).toBe("unavailable");
    expect(verdictFor(4.25, null)).toBe("unavailable");
    expect(verdictFor(2.19, 2.19)).toBe("above"); // at the line = covering cost
  });

  it("contributionMerOf: MER × margin, null-safe; NEGATIVE margin flows through as a negative MER", () => {
    expect(contributionMerOf(4.25, 0.456)).toBe(1.94);
    expect(contributionMerOf(null, 0.5)).toBeNull();
    expect(contributionMerOf(4.25, null)).toBeNull();
    expect(contributionMerOf(4.25, 0)).toBeNull();
    // edge-gap #2: below-cost selling must render as a screaming "below", never a blank dash —
    // a negative margin produces a negative contribution MER, and verdictFor puts it BELOW 1.0
    expect(contributionMerOf(4.25, -0.1)).toBe(-0.43);
    expect(verdictFor(contributionMerOf(4.25, -0.1), 1)).toBe("below");
  });

  it("composeHeadline: revenue-only when margin missing, both when present", () => {
    expect(composeHeadline(4.25, 1.94)).toBe("every $1 of marketing → $4.25 revenue / $1.94 contribution");
    expect(composeHeadline(4.25, null)).toBe("every $1 of marketing → $4.25 revenue");
    expect(composeHeadline(null, null)).toBeNull();
  });
});

describe("marketing-truth — the honesty ladder", () => {
  const clean = {
    merNull: false, merUnderstated: false, adDataStale: false,
    cmNull: false, freightUnmeasured: false, freightCapped: false, marginNegative: false,
    driftingFeeds: [], unavailableFeeds: [],
  };

  it("all inputs clean → HIGH with no reasons", () => {
    const c = assessConfidence(clean);
    expect(c.level).toBe("high");
    expect(c.reasons).toHaveLength(0);
  });

  it("a drifting feed → UNRELIABLE, names the feed (the whole point of the tile)", () => {
    const c = assessConfidence({ ...clean, driftingFeeds: ["the Meta ad-spend feed"] });
    expect(c.level).toBe("unreliable");
    expect(c.reasons[0]).toContain("Meta ad-spend feed");
  });

  it("missing MER or missing margin → UNRELIABLE (no number to show)", () => {
    expect(assessConfidence({ ...clean, merNull: true }).level).toBe("unreliable");
    expect(assessConfidence({ ...clean, cmNull: true }).level).toBe("unreliable");
  });

  it("understated basis / stale data / unmeasured freight → DIRECTIONAL, not clean", () => {
    expect(assessConfidence({ ...clean, merUnderstated: true }).level).toBe("directional");
    expect(assessConfidence({ ...clean, adDataStale: true }).level).toBe("directional");
    expect(assessConfidence({ ...clean, freightUnmeasured: true }).level).toBe("directional");
  });

  it("directional NEVER upgrades an unreliable — worst input wins", () => {
    const c = assessConfidence({ ...clean, driftingFeeds: ["x"], merUnderstated: true });
    expect(c.level).toBe("unreliable");
    expect(c.reasons).toHaveLength(2);
  });

  it("edge-gap #1: a freight rate at the 0.5 sanity cap → UNRELIABLE (margin distorted, never 'high')", () => {
    const c = assessConfidence({ ...clean, freightCapped: true });
    expect(c.level).toBe("unreliable");
    expect(c.reasons[0]).toContain("sanity cap");
  });

  it("edge-gap #2: a NEGATIVE margin → DIRECTIONAL with a verify-first reason (real or anomaly — never silently confident)", () => {
    const c = assessConfidence({ ...clean, marginNegative: true });
    expect(c.level).toBe("directional");
    expect(c.reasons[0]).toContain("NEGATIVE");
  });
});

describe("contribution-margin — measured freight (C6/#11)", () => {
  it("measures the real Jul-2026 rate: $77,066 / $651,073 ≈ 11.84%", () => {
    expect(measuredFreightPct(77066, 651073)).toBeCloseTo(0.1184, 3);
  });

  it("null on zero/absent revenue — never fabricates a rate", () => {
    expect(measuredFreightPct(1000, 0)).toBeNull();
    expect(measuredFreightPct(1000, -5)).toBeNull();
  });

  it("clamps: negative freight → 0, runaway rate → 0.5 sanity cap", () => {
    expect(measuredFreightPct(-500, 10000)).toBe(0);
    expect(measuredFreightPct(9000, 10000)).toBe(0.5);
  });

  it("runway margin rate now carries freight (4th arg), default keeps old callers exact", () => {
    // (100000 − 34000 − 3750 − 11840) / 100000
    expect(composeRunwayMarginRate(100000, 34000, 3750, 11840)).toBeCloseTo(0.5041, 4);
    // default freight=0 — backward-compatible with the shipped 3-arg call shape
    expect(composeRunwayMarginRate(100000, 34000, 3750)).toBeCloseTo(0.6225, 4);
  });

  it("freight-loaded margin raises the implied breakeven MER (the honesty direction)", () => {
    const before = impliedBreakevenMer(0.574); // pre-freight margin
    const after = impliedBreakevenMer(0.574 - 0.118); // freight loaded
    expect(before).toBeCloseTo(1.74, 2);
    expect(after).toBeCloseTo(2.19, 2);
    expect(after!).toBeGreaterThan(before!);
  });
});
