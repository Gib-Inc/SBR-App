import { describe, it, expect } from "vitest";
import {
  computeOrderContributionMargin,
  impliedBreakevenMer,
  channelFeePct,
  COGS_PLUG_RATE,
} from "./contribution-margin-service";

describe("computeOrderContributionMargin (pure)", () => {
  it("healthy order: net revenue − COGS − channel fee", () => {
    // $400 Shopify roller order, $140 real COGS (35%), 2.9% fee
    const c = computeOrderContributionMargin({ grossRevenue: 400, cogs: 140, channelFeePct: 0.029 });
    expect(c.netRevenue).toBe(400);
    expect(c.channelFees).toBe(11.6);
    expect(c.contributionMargin).toBe(248.4);
    expect(c.contributionMarginPct).toBe(0.6210);
    expect(c.status).toBe("healthy");
  });
  it("Amazon fee bites harder: same order at 15% referral", () => {
    const c = computeOrderContributionMargin({ grossRevenue: 400, cogs: 140, channelFeePct: 0.15 });
    expect(c.channelFees).toBe(60);
    expect(c.contributionMargin).toBe(200);
    expect(c.status).toBe("healthy");
  });
  it("refund reduces net revenue AND the fee basis", () => {
    const c = computeOrderContributionMargin({ grossRevenue: 400, refundedAmount: 200, cogs: 140, channelFeePct: 0.15 });
    expect(c.netRevenue).toBe(200);
    expect(c.channelFees).toBe(30);
    expect(c.contributionMargin).toBe(30);
    expect(c.status).toBe("marginal"); // 15% < 30%
  });
  it("negative contribution is reported, never clamped", () => {
    const c = computeOrderContributionMargin({ grossRevenue: 100, cogs: 120, channelFeePct: 0.15 });
    expect(c.contributionMargin).toBe(-35);
    expect(c.status).toBe("negative");
  });
  it("zero net revenue → null pct (no fabricated ratio)", () => {
    const c = computeOrderContributionMargin({ grossRevenue: 100, refundedAmount: 100, cogs: 0 });
    expect(c.contributionMarginPct).toBeNull();
  });
});

describe("impliedBreakevenMer (pure)", () => {
  it("40% contribution → 2.5x; 20% → 5x (today's static constant = an implied 20%)", () => {
    expect(impliedBreakevenMer(0.4)).toBe(2.5);
    expect(impliedBreakevenMer(0.2)).toBe(5);
  });
  it("zero/negative/null margin → null (never a fake breakeven)", () => {
    expect(impliedBreakevenMer(0)).toBeNull();
    expect(impliedBreakevenMer(-0.1)).toBeNull();
    expect(impliedBreakevenMer(null)).toBeNull();
  });
});

describe("channelFeePct", () => {
  it("maps channels to the payout engine's rates", () => {
    expect(channelFeePct("AMAZON")).toBe(0.15);
    expect(channelFeePct("shopify")).toBe(0.029);
    expect(channelFeePct("GHL")).toBe(0);
    expect(channelFeePct(null)).toBe(0);
  });
});

describe("COGS_PLUG_RATE", () => {
  it("is the QB-validated 35% rate, not the legacy 40% (1−0.6) guess", () => {
    expect(COGS_PLUG_RATE).toBe(0.35);
  });
});
