import { describe, it, expect } from "vitest";
import { evalReconciliation } from "./financial-reconciliation-service";

describe("evalReconciliation (drift needs to exceed BOTH a % and an absolute floor)", () => {
  it("reconciles when within tolerance", () => {
    const r = evalReconciliation(101000, 100000, 5, 2000); // +1%, +$1000
    expect(r.status).toBe("reconciles");
    expect(r.diff).toBe(1000);
    expect(r.diffPct).toBe(1);
  });
  it("flags drift when BOTH the % and the $ floor are exceeded", () => {
    const r = evalReconciliation(120000, 100000, 5, 2000); // +20%, +$20k
    expect(r.status).toBe("drift");
  });
  it("does NOT drift on a big % over a trivial base (abs floor protects)", () => {
    const r = evalReconciliation(1500, 1000, 5, 2000); // +50% but only +$500 (< $2000 floor)
    expect(r.status).toBe("reconciles");
  });
  it("does NOT drift on a big $ over a huge base (% protects)", () => {
    const r = evalReconciliation(1_010_000, 1_000_000, 5, 2000); // +$10k but only +1%
    expect(r.status).toBe("reconciles");
  });
  it("is 'unavailable' (never assumes 0) when either side is null", () => {
    expect(evalReconciliation(null, 100000, 5, 2000).status).toBe("unavailable");
    expect(evalReconciliation(100000, null, 5, 2000).status).toBe("unavailable");
    expect(evalReconciliation(null, null, 5, 2000).diff).toBeNull();
  });
  it("handles a zero book value: exact match reconciles, any nonzero is drift past the $ floor", () => {
    expect(evalReconciliation(0, 0, 5, 2000).status).toBe("reconciles");
    expect(evalReconciliation(5000, 0, 5, 2000).status).toBe("drift"); // diffPct null → treated as exceeding
    expect(evalReconciliation(500, 0, 5, 2000).status).toBe("reconciles"); // under the $2000 floor
  });
});
