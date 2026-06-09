import { describe, it, expect } from "vitest";
import {
  weightedAverageCost,
  buildUnitCost,
  applyBuildToFinishedGood,
  batchBuildCost,
  inventoryAssetValue,
  countVariance,
} from "./inventory-costing-service";

describe("weightedAverageCost", () => {
  it("blends old and new cost by quantity", () => {
    // 100 @ $2 + 100 @ $4 = 200 @ $3
    expect(weightedAverageCost(100, 2, 100, 4)).toBe(3);
  });
  it("weights toward the larger quantity", () => {
    // 900 @ $10 + 100 @ $20 = 1000 @ $11
    expect(weightedAverageCost(900, 10, 100, 20)).toBe(11);
  });
  it("is unchanged when nothing is received", () => {
    expect(weightedAverageCost(50, 7.25, 0, 999)).toBe(7.25);
  });
  it("adopts the receipt cost when starting from empty stock", () => {
    expect(weightedAverageCost(0, 0, 480, 8.65)).toBe(8.65);
  });
  it("returns 0 when the resulting total is 0", () => {
    expect(weightedAverageCost(0, 0, 0, 0)).toBe(0);
  });
  it("rounds to the cent", () => {
    // (1*1 + 2*2)/3 = 1.6667 -> 1.67
    expect(weightedAverageCost(1, 1, 2, 2)).toBe(1.67);
  });
});

describe("buildUnitCost", () => {
  it("sums component qty x unit cost for one finished unit", () => {
    // frame $44 + roller $8.65 + 2 screens @ $2 = 56.65
    const cost = buildUnitCost([
      { qtyPerUnit: 1, unitCost: 44 },
      { qtyPerUnit: 1, unitCost: 8.65 },
      { qtyPerUnit: 2, unitCost: 2 },
    ]);
    expect(cost).toBe(56.65);
  });
  it("is 0 for no components", () => {
    expect(buildUnitCost([])).toBe(0);
  });
});

describe("applyBuildToFinishedGood (build-order cost transition)", () => {
  it("raises finished qty and rolls build cost into WAC", () => {
    // 10 finished @ $50 WAC, build 10 more at $60 build cost -> 20 @ $55
    const out = applyBuildToFinishedGood({ qty: 10, unitCost: 50 }, 10, 60);
    expect(out.qty).toBe(20);
    expect(out.unitCost).toBe(55);
  });
  it("sets WAC to the build cost when finished stock starts empty", () => {
    const out = applyBuildToFinishedGood({ qty: 0, unitCost: 0 }, 25, 56.65);
    expect(out).toEqual({ qty: 25, unitCost: 56.65 });
  });
});

describe("batchBuildCost", () => {
  it("multiplies per-unit build cost by batch size", () => {
    expect(batchBuildCost([{ qtyPerUnit: 1, unitCost: 44 }, { qtyPerUnit: 2, unitCost: 2 }], 100)).toBe(4800);
  });
});

describe("inventoryAssetValue", () => {
  it("sums qty x WAC across positions", () => {
    expect(
      inventoryAssetValue([
        { qty: 100, unitCost: 3 },
        { qty: 50, unitCost: 10 },
      ]),
    ).toBe(800); // 300 + 500
  });
  it("is 0 for empty inventory", () => {
    expect(inventoryAssetValue([])).toBe(0);
  });
});

describe("countVariance (zero-drift balance-sheet audit)", () => {
  it("flags shrinkage and the negative asset adjustment", () => {
    const v = countVariance(100, 95, 3);
    expect(v.qtyDelta).toBe(-5);
    expect(v.valueDelta).toBe(-15);
    expect(v.direction).toBe("SHRINKAGE");
  });
  it("flags overage with a positive adjustment", () => {
    const v = countVariance(100, 108, 2.5);
    expect(v.qtyDelta).toBe(8);
    expect(v.valueDelta).toBe(20);
    expect(v.direction).toBe("OVERAGE");
  });
  it("reports a match with zero delta", () => {
    const v = countVariance(42, 42, 9.99);
    expect(v.qtyDelta).toBe(0);
    expect(v.valueDelta).toBe(0);
    expect(v.direction).toBe("MATCH");
  });
});
