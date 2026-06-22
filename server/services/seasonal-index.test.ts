import { describe, it, expect } from "vitest";
import { monthIndex, seasonalAdjustmentFactor, DEFAULT_SEASONAL_INDEX } from "./seasonal-index";

const FLAT = new Array(12).fill(1);

describe("monthIndex", () => {
  it("looks up 1-based months and wraps safely", () => {
    expect(monthIndex(DEFAULT_SEASONAL_INDEX, 1)).toBe(0.37); // Jan
    expect(monthIndex(DEFAULT_SEASONAL_INDEX, 10)).toBe(1.88); // Oct peak
    expect(monthIndex(DEFAULT_SEASONAL_INDEX, 13)).toBe(0.37); // wraps to Jan
  });
  it("defaults to 1.0 for a malformed index", () => {
    expect(monthIndex([1, 2, 3], 5)).toBe(1);
  });
});

describe("seasonalAdjustmentFactor", () => {
  it("is a no-op (1.0) when the index is flat", () => {
    expect(seasonalAdjustmentFactor(FLAT, new Date("2026-08-15"), 14)).toBe(1);
  });

  it("is a no-op when the index is missing/invalid", () => {
    expect(seasonalAdjustmentFactor([], new Date("2026-08-15"), 14)).toBe(1);
  });

  it("ramps a long-lead reorder UP heading into the fall peak", () => {
    // Mid-August, 45-day lead => stock sells ~October (1.88) vs trailing
    // Jun/Jul/Aug (~0.86) => factor well above 1.
    const f = seasonalAdjustmentFactor(DEFAULT_SEASONAL_INDEX, new Date("2026-08-15"), 45);
    expect(f).toBeGreaterThan(1.3);
    expect(f).toBeLessThanOrEqual(2.5); // clamp
  });

  it("pulls a reorder DOWN coming off the fall peak into winter", () => {
    // Late October, short lead => stock sells November/December (declining)
    // vs the elevated trailing Aug/Sep/Oct window => factor below 1.
    const f = seasonalAdjustmentFactor(DEFAULT_SEASONAL_INDEX, new Date("2026-10-28"), 14);
    expect(f).toBeLessThan(1);
    expect(f).toBeGreaterThanOrEqual(0.5); // clamp
  });

  it("never returns a wild multiplier (clamped to [0.5, 2.5])", () => {
    const spiky = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 9, 0.1, 0.1];
    const f = seasonalAdjustmentFactor(spiky, new Date("2026-08-01"), 60);
    expect(f).toBeLessThanOrEqual(2.5);
    expect(f).toBeGreaterThanOrEqual(0.5);
  });
});
