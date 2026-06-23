import { describe, it, expect } from "vitest";
import { buildAging, rollupShop, getBuildTracker, type BuildOrder } from "./build-tracker-service";

const NOW = Date.UTC(2026, 5, 23, 18); // 2026-06-23

describe("buildAging", () => {
  it("counts days in progress from the order date", () => {
    const a = buildAging("2026-06-13", null, NOW);
    expect(a.daysInProgress).toBe(10);
    expect(a.overdue).toBe(false);
    expect(a.daysUntilDue).toBeNull();
  });
  it("flags overdue when the due date has passed", () => {
    const a = buildAging("2026-06-01", "2026-06-20", NOW);
    expect(a.daysUntilDue).toBe(-3);
    expect(a.overdue).toBe(true);
  });
  it("counts days until a future due date", () => {
    const a = buildAging("2026-06-20", "2026-06-30", NOW);
    expect(a.daysUntilDue).toBe(7);
    expect(a.overdue).toBe(false);
  });
  it("handles missing dates without throwing", () => {
    const a = buildAging(null, null, NOW);
    expect(a).toEqual({ daysInProgress: null, daysUntilDue: null, overdue: false });
  });
});

describe("rollupShop", () => {
  const b = (units: number, overdue: boolean): BuildOrder => ({
    poId: "x", poNumber: "PO", stage: "in_production", stageLabel: "In Production",
    orderedDate: null, dueDate: null, daysInProgress: null, daysUntilDue: null, overdue,
    unitsOrdered: units, unitsRemaining: units, lines: [],
  });
  it("sums remaining units and counts overdue orders", () => {
    const r = rollupShop([b(50, false), b(30, true), b(20, true)]);
    expect(r.openOrders).toBe(3);
    expect(r.unitsInBuild).toBe(100);
    expect(r.overdueCount).toBe(2);
  });
  it("is zero for no builds", () => {
    expect(rollupShop([])).toEqual({ openOrders: 0, unitsInBuild: 0, overdueCount: 0 });
  });
});

describe("getBuildTracker", () => {
  // Mock db.execute returning, in order: shops, line rows, item rows.
  function mockDb(shops: any[], lines: any[], items: any[]) {
    let call = 0;
    return {
      execute: async () => {
        call += 1;
        return { rows: call === 1 ? shops : call === 2 ? lines : items };
      },
    } as any;
  }

  it("groups builds by shop and computes summaries", async () => {
    const shops = [{ id: "1", name: "FX Industries" }, { id: "4", name: "Pednar" }];
    const lines = [
      { po_id: "poA", po_number: "PO-1", supplier_id: "1", stage: "in_production", ordered_date: "2026-06-13", due_date: "2026-06-30",
        sku: "SBR-PUSH-1.0", item_name: "Push Model 1.0", qty_ordered: 50, qty_received: 0, item_type: "finished_product", in_process: 50 },
      { po_id: "poB", po_number: "PO-2", supplier_id: "4", stage: "ordered", ordered_date: "2026-06-01", due_date: "2026-06-20",
        sku: "SBR-RLR-BF", item_name: "Foam Roller — Bigfoot", qty_ordered: 200, qty_received: 40, item_type: "component", in_process: 0 },
    ];
    const items = [
      { supplier_id: "1", id: "i1", sku: "SBR-PUSH-1.0", name: "Push Model 1.0", item_type: "finished_product" },
      { supplier_id: "4", id: "i2", sku: "SBR-RLR-BF", name: "Foam Roller — Bigfoot", item_type: "component" },
    ];
    const t = await getBuildTracker(mockDb(shops, lines, items), NOW);
    expect(t.shops).toHaveLength(2);
    const fx = t.shops.find((s) => s.shopId === "1")!;
    expect(fx.openOrders).toBe(1);
    expect(fx.unitsInBuild).toBe(50);
    expect(fx.builds[0].lines[0].remaining).toBe(50);
    const ped = t.shops.find((s) => s.shopId === "4")!;
    expect(ped.unitsInBuild).toBe(160); // 200 ordered - 40 received
    expect(ped.builds[0].overdue).toBe(true); // due 6/20, now 6/23
    expect(t.summary).toEqual({ shops: 2, openOrders: 2, unitsInBuild: 210, overdue: 1 });
  });
});
