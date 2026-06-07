import { describe, it, expect } from "vitest";
import { allocateBreakdownToTotal } from "./corrected-ad-spend";

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
    const out = allocateBreakdownToTotal(
      [{ device: "mobile", spend: 42 }],
      null,
    );
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
