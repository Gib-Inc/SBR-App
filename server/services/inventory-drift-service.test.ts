import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for the in-app inventory drift service. We mock the storage
 * singleton's getAllItems and exercise runDriftReport directly: it must flag
 * drift over threshold and stale Extensiv syncs, leave clean items alone, and
 * exclude components (which have no pivot mirror).
 */

const h = vi.hoisted(() => {
  const items: any[] = [];
  return {
    items,
    storage: {
      async getAllItems() {
        return h.items;
      },
    },
  };
});

vi.mock("../storage", () => ({ storage: h.storage }));

import { runDriftReport } from "./inventory-drift-service";

const fresh = () => new Date(Date.now() - 30 * 60 * 1000); // 30 min ago → not stale at 6h
const old = () => new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago → stale

function fp(over: Record<string, any>) {
  return {
    id: over.id ?? "x",
    type: "finished_product",
    sku: over.sku ?? "SKU",
    name: over.name ?? "Item",
    extensivSku: over.extensivSku ?? null,
    availableForSaleQty: over.afs ?? 0,
    pivotQty: over.pivot ?? 0,
    hildaleQty: over.hildale ?? 0,
    extensivOnHandSnapshot: over.onHand ?? 0,
    extensivLastSyncAt: "extensivLastSyncAt" in over ? over.extensivLastSyncAt : fresh(),
  };
}

beforeEach(() => {
  h.items.length = 0;
});

describe("runDriftReport", () => {
  it("reports a clean run when afs == pivot and syncs are fresh", async () => {
    h.items.push(fp({ id: "a", sku: "A", afs: 100, pivot: 100 }));
    h.items.push(fp({ id: "b", sku: "B", afs: 50, pivot: 50 }));

    const r = await runDriftReport({ driftThreshold: 5, staleHours: 6 });

    expect(r.analyzed).toBe(2);
    expect(r.flaggedCount).toBe(0);
    expect(r.overThresholdCount).toBe(0);
    expect(r.staleCount).toBe(0);
    expect(r.flaggedItems).toEqual([]);
  });

  it("flags an item whose abs(drift) meets the threshold", async () => {
    h.items.push(fp({ id: "a", sku: "A", afs: 100, pivot: 100 }));
    h.items.push(fp({ id: "b", sku: "B", afs: 90, pivot: 100 })); // drift -10

    const r = await runDriftReport({ driftThreshold: 5, staleHours: 6 });

    expect(r.overThresholdCount).toBe(1);
    expect(r.flaggedCount).toBe(1);
    expect(r.flaggedItems[0].sku).toBe("B");
    expect(r.flaggedItems[0].drift).toBe(-10);
    expect(r.flaggedItems[0].overThreshold).toBe(true);
  });

  it("does NOT flag drift below the threshold", async () => {
    h.items.push(fp({ id: "a", sku: "A", afs: 102, pivot: 100 })); // drift +2 < 5

    const r = await runDriftReport({ driftThreshold: 5, staleHours: 6 });

    expect(r.overThresholdCount).toBe(0);
    expect(r.flaggedCount).toBe(0);
  });

  it("flags stale and never-synced items even with zero drift", async () => {
    h.items.push(fp({ id: "a", sku: "A", afs: 10, pivot: 10, extensivLastSyncAt: old() }));
    h.items.push(fp({ id: "b", sku: "B", afs: 10, pivot: 10, extensivLastSyncAt: null }));
    h.items.push(fp({ id: "c", sku: "C", afs: 10, pivot: 10 })); // fresh

    const r = await runDriftReport({ driftThreshold: 5, staleHours: 6 });

    expect(r.staleCount).toBe(2);
    expect(r.overThresholdCount).toBe(0);
    expect(r.flaggedCount).toBe(2);
    expect(r.flaggedItems.map((i) => i.sku).sort()).toEqual(["A", "B"]);
  });

  it("excludes components from analysis entirely", async () => {
    h.items.push(fp({ id: "a", sku: "A", afs: 100, pivot: 100 }));
    h.items.push({ id: "c1", type: "component", sku: "C1", currentStock: 5, availableForSaleQty: 0, pivotQty: 0, hildaleQty: 0, extensivOnHandSnapshot: 0, extensivLastSyncAt: null });

    const r = await runDriftReport({ driftThreshold: 5, staleHours: 6 });

    expect(r.analyzed).toBe(1); // only the finished product
    expect(r.flaggedCount).toBe(0);
  });

  it("sorts flagged items by largest absolute drift first", async () => {
    h.items.push(fp({ id: "a", sku: "A", afs: 100, pivot: 93 })); // +7
    h.items.push(fp({ id: "b", sku: "B", afs: 100, pivot: 120 })); // -20
    h.items.push(fp({ id: "c", sku: "C", afs: 100, pivot: 90 })); // +10

    const r = await runDriftReport({ driftThreshold: 5, staleHours: 6 });

    expect(r.flaggedItems.map((i) => i.sku)).toEqual(["B", "C", "A"]);
  });
});
