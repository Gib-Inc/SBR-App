/**
 * Unit tests for the pure damage-aggregation function used by
 * scripts/incident-2026-07-repeat-decrement.ts. Fixture rows only — no DB,
 * no server imports.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateRepeatDecrementDamage,
  type DupFireLineRow,
} from "./repeat-decrement-damage";

const row = (over: Partial<DupFireLineRow>): DupFireLineRow => ({
  orderId: "order-1",
  extraFires: 1,
  itemId: "item-1",
  sku: "SKU-1",
  itemType: "finished_product",
  qtyOrdered: 1,
  ...over,
});

describe("aggregateRepeatDecrementDamage", () => {
  it("returns empty for no dup rows", () => {
    expect(aggregateRepeatDecrementDamage([])).toEqual([]);
  });

  it("computes extra_fires × qty_ordered for a single order line", () => {
    const out = aggregateRepeatDecrementDamage([
      row({ extraFires: 2, qtyOrdered: 3 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      itemId: "item-1",
      sku: "SKU-1",
      itemType: "finished_product",
      overDecrementedUnits: 6,
      affectedOrders: 1,
      totalExtraFires: 2,
    });
  });

  it("fans a multi-line order out to each line's item at the order's extra_fires", () => {
    const out = aggregateRepeatDecrementDamage([
      row({ orderId: "o1", extraFires: 1, itemId: "a", sku: "A", qtyOrdered: 2 }),
      row({ orderId: "o1", extraFires: 1, itemId: "b", sku: "B", qtyOrdered: 5 }),
    ]);
    expect(out.map((d) => [d.sku, d.overDecrementedUnits])).toEqual([
      ["B", 5],
      ["A", 2],
    ]);
  });

  it("sums damage for the same item across multiple dup orders", () => {
    const out = aggregateRepeatDecrementDamage([
      row({ orderId: "o1", extraFires: 2, qtyOrdered: 3 }), // 6
      row({ orderId: "o2", extraFires: 1, qtyOrdered: 4 }), // 4
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].overDecrementedUnits).toBe(10);
    expect(out[0].affectedOrders).toBe(2);
    expect(out[0].totalExtraFires).toBe(3);
  });

  it("counts extra_fires once per order even when an order repeats the same item", () => {
    // Same order, two lines of the same item: units use both lines' qty but
    // the order's fires are counted once (extraFires is a per-order value).
    const out = aggregateRepeatDecrementDamage([
      row({ orderId: "o1", extraFires: 2, qtyOrdered: 1 }),
      row({ orderId: "o1", extraFires: 2, qtyOrdered: 3 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].overDecrementedUnits).toBe(8); // 2×1 + 2×3
    expect(out[0].affectedOrders).toBe(1);
    expect(out[0].totalExtraFires).toBe(2);
  });

  it("sorts worst damage first with a stable sku tiebreak", () => {
    const out = aggregateRepeatDecrementDamage([
      row({ orderId: "o1", itemId: "a", sku: "ZZZ", extraFires: 1, qtyOrdered: 2 }),
      row({ orderId: "o2", itemId: "b", sku: "AAA", extraFires: 1, qtyOrdered: 2 }),
      row({ orderId: "o3", itemId: "c", sku: "MID", extraFires: 5, qtyOrdered: 2 }),
    ]);
    expect(out.map((d) => d.sku)).toEqual(["MID", "AAA", "ZZZ"]);
  });

  it("drops items whose total contribution is zero (nothing to true up)", () => {
    const out = aggregateRepeatDecrementDamage([
      row({ itemId: "zero", sku: "ZERO", extraFires: 3, qtyOrdered: 0 }),
      row({ orderId: "o2", itemId: "real", sku: "REAL", extraFires: 1, qtyOrdered: 1 }),
    ]);
    expect(out.map((d) => d.sku)).toEqual(["REAL"]);
  });

  it("keeps component rows attributed to currentStock via itemType", () => {
    const out = aggregateRepeatDecrementDamage([
      row({ itemId: "comp", sku: "COMP-1", itemType: "component", qtyOrdered: 7 }),
    ]);
    expect(out[0].itemType).toBe("component");
    expect(out[0].overDecrementedUnits).toBe(7);
  });

  it("clamps malformed negative extra_fires to zero instead of fabricating restores", () => {
    const out = aggregateRepeatDecrementDamage([
      row({ extraFires: -2, qtyOrdered: 5 }),
    ]);
    expect(out).toEqual([]);
  });

  it("labels missing skus without inventing identifiers", () => {
    const out = aggregateRepeatDecrementDamage([
      row({ sku: null, qtyOrdered: 2 }),
    ]);
    expect(out[0].sku).toBe("(no sku)");
  });
});
