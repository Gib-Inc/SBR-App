/**
 * Unit tests for the pure damage-aggregation function used by
 * scripts/incident-2026-07-repeat-decrement.ts. Fixture rows only — no DB,
 * no server imports.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateRepeatDecrementDamage,
  cappedRestore,
  liveShortfall,
  normalizeSku,
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

describe("cappedRestore (--capped true-up mode)", () => {
  it("live cap wins when the shortfall is smaller than the audit bound", () => {
    // pivot 120 − open 17 − afs 100 = shortfall 3 < audit bound 9
    expect(
      cappedRestore({ auditBound: 9, pivot: 120, openUnshipped: 17, afs: 100 }),
    ).toBe(3);
  });

  it("audit bound wins when it is smaller than the live shortfall", () => {
    // pivot 50 − open 5 − afs 30 = shortfall 15 > audit bound 4
    expect(
      cappedRestore({ auditBound: 4, pivot: 50, openUnshipped: 5, afs: 30 }),
    ).toBe(4);
  });

  it("floors at 0 when afs already sits at or above pivot − openUnshipped", () => {
    // afs == pivot − open exactly → nothing missing
    expect(
      cappedRestore({ auditBound: 10, pivot: 40, openUnshipped: 10, afs: 30 }),
    ).toBe(0);
    // afs ABOVE pivot − open → still 0, never a negative "restore"
    expect(
      cappedRestore({ auditBound: 10, pivot: 40, openUnshipped: 10, afs: 45 }),
    ).toBe(0);
  });

  it("never exceeds pivot − openUnshipped − afs (hard invariant, grid check)", () => {
    for (const auditBound of [0, 1, 3, 7, 50]) {
      for (const pivot of [0, 5, 20, 100]) {
        for (const openUnshipped of [0, 3, 25, 120]) {
          for (const afs of [0, 4, 19, 100]) {
            const restore = cappedRestore({ auditBound, pivot, openUnshipped, afs });
            const headroom = Math.max(0, pivot - openUnshipped - afs);
            expect(restore).toBeGreaterThanOrEqual(0);
            expect(restore).toBeLessThanOrEqual(headroom);
            expect(restore).toBeLessThanOrEqual(auditBound);
            // Applying the restore can never push afs above pivot − openUnshipped.
            expect(afs + restore).toBeLessThanOrEqual(
              Math.max(afs, pivot - openUnshipped),
            );
          }
        }
      }
    }
  });

  it("clamps malformed negative openUnshipped to 0 instead of inflating the shortfall", () => {
    // open = −10 must NOT become pivot + 10 headroom
    expect(
      cappedRestore({ auditBound: 100, pivot: 20, openUnshipped: -10, afs: 15 }),
    ).toBe(5);
  });

  it("clamps malformed negative or fractional audit bounds to whole non-negative units", () => {
    expect(
      cappedRestore({ auditBound: -3, pivot: 100, openUnshipped: 0, afs: 0 }),
    ).toBe(0);
    expect(
      cappedRestore({ auditBound: 2.9, pivot: 100, openUnshipped: 0, afs: 0 }),
    ).toBe(2);
  });
});

describe("liveShortfall", () => {
  it("is pivot − openUnshipped − afs floored at 0", () => {
    expect(liveShortfall({ pivot: 30, openUnshipped: 10, afs: 5 })).toBe(15);
    expect(liveShortfall({ pivot: 30, openUnshipped: 10, afs: 25 })).toBe(0);
    expect(liveShortfall({ pivot: 0, openUnshipped: 0, afs: 0 })).toBe(0);
  });
});

describe("normalizeSku (must mirror inventory-drift-resolver.ts norm)", () => {
  it("strips the SKU: prefix, punctuation, and uppercases", () => {
    expect(normalizeSku("SKU: sbr-36")).toBe("SBR36");
    expect(normalizeSku("sbr 36 / v2")).toBe("SBR36V2");
    expect(normalizeSku(null)).toBe("");
    expect(normalizeSku(undefined)).toBe("");
  });
});
