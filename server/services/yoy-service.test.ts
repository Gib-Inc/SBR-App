import { describe, it, expect } from "vitest";
import { deltaPct } from "./yoy-service";

describe("deltaPct", () => {
  it("computes a positive YoY change", () => {
    // Sales $1.32M vs $1.05M ≈ +26%
    expect(deltaPct(1323640, 1050970)).toBeCloseTo(25.9, 0);
  });

  it("computes ad spend up faster than revenue", () => {
    // Ad spend $452K vs $282K ≈ +60%
    expect(deltaPct(451615, 281801)).toBeCloseTo(60.3, 0);
  });

  it("returns null when last year is zero", () => {
    expect(deltaPct(100, 0)).toBeNull();
  });

  it("reports a decline as negative", () => {
    expect(deltaPct(80, 100)).toBe(-20);
  });
});
