import { describe, it, expect } from "vitest";
import { anticipateItem } from "./inventory-spend-service";

describe("anticipateItem", () => {
  it("projects cost = qty * unit cost", () => {
    const r = anticipateItem({ recommendedQty: 100, unitCost: 12.5, currentStock: 300, dailyUsage: 10 });
    expect(r.projectedCost).toBe(1250);
    expect(r.daysOfCover).toBe(30); // 300 / 10
    expect(r.bucket).toBe("d0_30");
  });

  it("buckets by days of cover", () => {
    expect(anticipateItem({ recommendedQty: 1, unitCost: 1, currentStock: 450, dailyUsage: 10 }).bucket).toBe("d31_60"); // 45d
    expect(anticipateItem({ recommendedQty: 1, unitCost: 1, currentStock: 750, dailyUsage: 10 }).bucket).toBe("d61_90"); // 75d
    expect(anticipateItem({ recommendedQty: 1, unitCost: 1, currentStock: 2000, dailyUsage: 10 }).bucket).toBe("d90_plus");
  });

  it("flags out-of-stock as overdue", () => {
    expect(anticipateItem({ recommendedQty: 50, unitCost: 2, currentStock: 0, dailyUsage: 5 }).bucket).toBe("overdue");
    expect(anticipateItem({ recommendedQty: 50, unitCost: 2, currentStock: -3, dailyUsage: 5 }).daysOfCover).toBe(0);
  });

  it("ANTI-HALLUCINATION: missing unit cost -> projectedCost null, never guessed", () => {
    const r = anticipateItem({ recommendedQty: 100, unitCost: null, currentStock: 300, dailyUsage: 10 });
    expect(r.projectedCost).toBeNull();
    expect(r.daysOfCover).toBe(30); // timing still computable
  });

  it("no usage signal -> timing unknown (not fabricated)", () => {
    const r = anticipateItem({ recommendedQty: 10, unitCost: 5, currentStock: 100, dailyUsage: 0 });
    expect(r.daysOfCover).toBeNull();
    expect(r.bucket).toBe("unknown");
    expect(r.projectedCost).toBe(50);
  });
});
