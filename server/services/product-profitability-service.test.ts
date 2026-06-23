import { describe, it, expect } from "vitest";
import { margin } from "./product-profitability-service";

describe("margin", () => {
  it("computes a healthy positive margin", () => {
    const m = margin(347.97, 110.61);
    expect(m.grossProfit).toBe(237.36);
    expect(m.marginPct).toBe(68.2);
  });

  it("flags a below-cost sale as negative margin", () => {
    // The #1002 catch basket: ~$20 sale, $21.60 cost.
    const m = margin(20, 21.6);
    expect(m.grossProfit).toBe(-1.6);
    expect(m.marginPct).toBeLessThan(0);
  });

  it("returns null margin (not NaN) for zero revenue", () => {
    const m = margin(0, 5);
    expect(m.grossProfit).toBe(-5);
    expect(m.marginPct).toBeNull();
  });

  it("is 100% margin when there is no cost (e.g. gift card)", () => {
    const m = margin(50, 0);
    expect(m.grossProfit).toBe(50);
    expect(m.marginPct).toBe(100);
  });
});
