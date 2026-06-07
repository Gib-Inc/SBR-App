import { describe, it, expect } from "vitest";
import { assessExtensivPayload } from "./sync-guard";

const rows = (n: number, avail: number) => Array.from({ length: n }, () => ({ available: avail }));

describe("assessExtensivPayload", () => {
  it("allows a normal full payload", () => {
    const r = assessExtensivPayload(rows(200, 12), { inStockItemCount: 180, lastGoodItemCount: 200 });
    expect(r.safe).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("refuses an empty payload (would zero everything)", () => {
    const r = assessExtensivPayload([], { inStockItemCount: 180, lastGoodItemCount: 200 });
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/0 items|zero all/i);
  });

  it("refuses when most in-stock SKUs would drop to 0 (degraded payload)", () => {
    // 200 rows all available:0, 180 currently in stock → 180/180 = 100% > 30%
    const r = assessExtensivPayload(rows(200, 0), { inStockItemCount: 180, lastGoodItemCount: 200 });
    expect(r.safe).toBe(false);
    expect(r.wouldZeroPctOfInStock).toBeGreaterThan(0.3);
    expect(r.reason).toMatch(/drop to 0|degraded/i);
  });

  it("refuses a short payload vs the last good run", () => {
    // 50 items now vs 200 last good → 25% < 50%
    const r = assessExtensivPayload(rows(50, 10), { inStockItemCount: 180, lastGoodItemCount: 200 });
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/under 50%|partial\/failed/i);
  });

  it("allows a legit partial zero-out under the threshold", () => {
    // 20 of 180 in-stock would zero = 11% < 30% → fine (real stock movements)
    const incoming = [...rows(20, 0), ...rows(180, 5)];
    const r = assessExtensivPayload(incoming, { inStockItemCount: 180, lastGoodItemCount: 200 });
    expect(r.safe).toBe(true);
  });

  it("does not divide by zero on a fresh catalog (no in-stock items yet)", () => {
    const r = assessExtensivPayload(rows(10, 0), { inStockItemCount: 0, lastGoodItemCount: null });
    expect(r.safe).toBe(true); // nothing to protect yet
  });
});
