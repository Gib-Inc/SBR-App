import { describe, it, expect } from "vitest";
import {
  estimateNetPayout,
  buildExpectedPayouts,
  inboundWithinDays,
  PAYOUT_CONFIG,
} from "./expected-payouts-service";

describe("estimateNetPayout", () => {
  it("nets the fee off the gross window", () => {
    // 55,080 Amazon gross × (1 − 0.15) = 46,818
    expect(estimateNetPayout(55_080, 0.15)).toBe(46_818);
    // 52,507 Shopify-ish × (1 − 0.029) = 50,984.30
    expect(estimateNetPayout(52_507, 0.029)).toBe(50_984.3);
  });
  it("never fabricates from a non-positive or NaN gross", () => {
    expect(estimateNetPayout(0, 0.15)).toBe(0);
    expect(estimateNetPayout(-100, 0.15)).toBe(0);
    expect(estimateNetPayout(Number.NaN, 0.15)).toBe(0);
  });
  it("clamps a nonsense fee into [0,1]", () => {
    expect(estimateNetPayout(1_000, -0.5)).toBe(1_000); // fee floored at 0
    expect(estimateNetPayout(1_000, 2)).toBe(0); // fee capped at 1
    expect(estimateNetPayout(1_000, Number.NaN)).toBe(1_000); // bad fee → 0
  });
});

describe("buildExpectedPayouts", () => {
  it("assembles both channels and totals the net (the real-pipeline scenario)", () => {
    const p = buildExpectedPayouts({ amazonGross: 55_080, shopifyGross: 10_000, asOf: "2026-06-28" });
    expect(p.amazon.netExpected).toBe(46_818); // 55080 × 0.85
    expect(p.amazon.settlementDays).toBe(14);
    expect(p.shopify.netExpected).toBe(8_010); // 10000 × (1 − 0.029 fee − 0.17 Shopify Capital skim)
    expect(p.shopify.settlementDays).toBe(3);
    expect(p.totalNetExpected).toBe(54_828); // 46,818 + 8,010
    expect(p.basis).toBe("sales-estimate");
    expect(p.asOf).toBe("2026-06-28");
  });
  it("floors negative gross at zero (no negative payout)", () => {
    const p = buildExpectedPayouts({ amazonGross: -5, shopifyGross: -5, asOf: "2026-06-28" });
    expect(p.totalNetExpected).toBe(0);
    expect(p.amazon.grossWindow).toBe(0);
  });
  it("uses the configured fee/settlement constants", () => {
    expect(PAYOUT_CONFIG.amazon.feePct).toBe(0.15);
    expect(PAYOUT_CONFIG.shopify.settlementDays).toBe(3);
  });
});

describe("inboundWithinDays (window proration)", () => {
  const p = buildExpectedPayouts({ amazonGross: 56_000, shopifyGross: 10_000, asOf: "2026-06-28" });
  // amazon net = 56000×0.85 = 47,600 over 14d; shopify net = 10000×0.801 = 8,010 over 3d (fee + Capital skim)
  it("a 14-day+ window captures the full pipeline", () => {
    expect(inboundWithinDays(p, 14)).toBe(55_610); // 47,600 + 8,010
    expect(inboundWithinDays(p, 30)).toBe(55_610); // capped at 1×, never more
    expect(inboundWithinDays(p, 60)).toBe(55_610);
  });
  it("a 7-day window captures all Shopify + ~half of Amazon", () => {
    // amazon 47,600 × (7/14)=23,800 ; shopify full 8,010 → 31,810
    expect(inboundWithinDays(p, 7)).toBe(31_810);
  });
  it("a 3-day window captures all Shopify + ~3/14 of Amazon", () => {
    // amazon 47,600 × (3/14)=10,200 ; shopify full 8,010 → 18,210
    expect(inboundWithinDays(p, 3)).toBe(18_210);
  });
  it("zero / negative window is zero (no fabrication)", () => {
    expect(inboundWithinDays(p, 0)).toBe(0);
    expect(inboundWithinDays(p, -5)).toBe(0);
  });
});
