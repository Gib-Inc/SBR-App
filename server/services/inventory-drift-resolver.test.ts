import { describe, it, expect } from "vitest";
import { classifyDrift } from "./inventory-drift-resolver";

describe("classifyDrift", () => {
  // afs should sit at pivot − openUnshipped: orders decrement afs at create,
  // Extensiv decrements pivot only at ship.

  it("EXPLAINED when open orders fully account for the gap", () => {
    // pivot 100, 40 open → afs should be 60; afs IS 60 → no residual
    const c = classifyDrift(60, 100, 40, 5, 25);
    expect(c.decision).toBe("EXPLAINED");
    expect(c.correction).toBe(0);
    expect(c.targetAfs).toBe(60);
  });

  it("EXPLAINED when residual is inside the threshold", () => {
    // target 60, afs 57 → residual 3 < threshold 5
    const c = classifyDrift(57, 100, 40, 5, 25);
    expect(c.decision).toBe("EXPLAINED");
  });

  it("CORRECTED for residuals beyond threshold but within the auto-cap", () => {
    // target 60, afs 45 → correction +15 (≤ cap 25)
    const c = classifyDrift(45, 100, 40, 5, 25);
    expect(c.decision).toBe("CORRECTED");
    expect(c.correction).toBe(15);
    expect(c.residual).toBe(15);
  });

  it("CORRECTED handles negative corrections (afs too high)", () => {
    // target 60, afs 80 → correction −20
    const c = classifyDrift(80, 100, 40, 5, 25);
    expect(c.decision).toBe("CORRECTED");
    expect(c.correction).toBe(-20);
  });

  it("PROPOSED when the correction exceeds the auto-apply cap", () => {
    // target 60, afs 0 → correction +60 > cap 25 → human review
    const c = classifyDrift(0, 100, 40, 5, 25);
    expect(c.decision).toBe("PROPOSED");
    expect(c.correction).toBe(60);
  });

  it("floors targetAfs at 0 when open orders exceed pivot", () => {
    // pivot 10, 50 open → target 0, never negative
    const c = classifyDrift(5, 10, 50, 5, 25);
    expect(c.targetAfs).toBe(0);
    expect(c.decision).toBe("CORRECTED");
    expect(c.correction).toBe(-5);
  });

  it("treats missing/zero open orders as pure pivot reconciliation", () => {
    const c = classifyDrift(10, 40, 0, 5, 25);
    expect(c.targetAfs).toBe(40);
    expect(c.decision).toBe("PROPOSED"); // +30 > 25 cap
  });
});
