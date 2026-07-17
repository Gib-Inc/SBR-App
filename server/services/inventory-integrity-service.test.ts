import { describe, it, expect, vi, beforeEach } from "vitest";

// The service issues a fixed, ordered list of db.execute() calls inside Promise.all.
// We queue canned results in that exact order. If you add/reorder queries in
// getInventoryIntegritySummary, update DEFAULT_RESULTS to match.
const execMock = vi.fn();
vi.mock("../db", () => ({ db: { execute: (...args: any[]) => execMock(...args) } }));

import { getInventoryIntegritySummary } from "./inventory-integrity-service";

// Order matches the Promise.all in getInventoryIntegritySummary:
// 0 totals, 1 freshness, 2 wrongFinishedCurrent, 3 wrongComponentWarehouse,
// 4 negativeWarehouseRows, 5 staleExtensiv, 6 drift, 7 openOrders, 8 bomGaps,
// 9 reorder, 10 movements, 11 ledgerStats, 12 ledgerDrift, 13 accuracy,
// 14 componentsBelowZero, 15 orphanLines
function makeResults(over: Partial<Record<number, any>> = {}): any[] {
  const base: any[] = [
    [{ finished_products: 31, components: 35, negative_rows: 0 }],
    [{ mapped_items: 60, recently_synced: 60, latest_sync: "2026-07-02T20:00:00Z", minutes_old: 5 }],
    [], // wrongFinishedCurrent
    [], // wrongComponentWarehouse
    [], // negativeWarehouseRows (hildale/pivot/afs < 0 — current_stock excluded)
    [], // staleExtensiv
    [], // afs drift
    [{ open_orders: 0, open_unshipped_units: 0, allocated_units: 0, backordered_units: 0, hildale_reserved_units: 0 }],
    [], // bomGaps
    [], // reorder
    [], // movements
    [{ tracked_items: 32, drift_items: 0, untracked_items: 0 }], // ledgerStats
    [], // ledgerDrift
    [{ physical_counts_90d: 0, accurate_counts_90d: 0, never_counted_items: 66, drift_events_90d: 0, drift_net_units_90d: 0, drift_absorbed_value_90d: 0 }],
    [], // componentsBelowZero (current_stock < 0, build-ahead)
    [], // orphanLines (sales_order_lines.product_id IS NULL)
  ];
  for (const [k, v] of Object.entries(over)) base[Number(k)] = v;
  return base;
}

function primeExec(results: any[]) {
  execMock.mockReset();
  results.forEach((r) => execMock.mockResolvedValueOnce(r));
}

const issue = (summary: any, code: string) => summary.issues.find((i: any) => i.code === code);

describe("inventory-integrity: ledger tripwire (COUNT-4)", () => {
  beforeEach(() => execMock.mockReset());

  it("flags LEDGER_DRIFT when items diverge from their last gateway snapshot", async () => {
    primeExec(makeResults({
      11: [{ tracked_items: 32, drift_items: 8, untracked_items: 29 }],
      12: [{ sku: "#304-REP-M2", name: "Conveyer Screen", current_stock: 0, hildale_qty: 529, pivot_qty: 195, available_for_sale_qty: 194, ledger_pivot: 198, ledger_hildale: 529, ledger_current: 0, drift: 3 }],
    }));
    const s = await getInventoryIntegritySummary();
    expect(s.ledger).toEqual({ trackedItems: 32, driftItems: 8, untrackedItems: 29 });
    const d = issue(s, "LEDGER_DRIFT");
    expect(d).toBeTruthy();
    expect(d.severity).toBe("warning");
    expect(d.count).toBe(8);
    expect(d.rows).toHaveLength(1);
    expect(issue(s, "LEDGER_UNTRACKED").count).toBe(29);
  });

  it("emits no ledger issues when everything reconciles", async () => {
    primeExec(makeResults()); // drift_items 0, untracked 0 by default
    const s = await getInventoryIntegritySummary();
    expect(issue(s, "LEDGER_DRIFT")).toBeFalsy();
    expect(issue(s, "LEDGER_UNTRACKED")).toBeFalsy();
    expect(s.ledgerDrift).toEqual([]);
  });
});

describe("inventory-integrity: IRA + shrinkage (COUNT-5)", () => {
  beforeEach(() => execMock.mockReset());

  it("reports IRA as unmeasured (null) when no physical counts exist", async () => {
    primeExec(makeResults());
    const s = await getInventoryIntegritySummary();
    expect(s.accuracy.iraPercent).toBeNull();
    expect(issue(s, "IRA_UNMEASURED")).toBeTruthy();
    expect(issue(s, "IRA_UNMEASURED").detail).toContain("66 SKUs");
    expect(issue(s, "IRA_LOW")).toBeFalsy();
  });

  it("computes IRA% and flags IRA_LOW below target when counts exist", async () => {
    primeExec(makeResults({
      13: [{ physical_counts_90d: 20, accurate_counts_90d: 17, never_counted_items: 40, drift_events_90d: 0, drift_net_units_90d: 0, drift_absorbed_value_90d: 0 }],
    }));
    const s = await getInventoryIntegritySummary();
    expect(s.accuracy.iraPercent).toBe(85); // 17/20
    expect(issue(s, "IRA_UNMEASURED")).toBeFalsy();
    expect(issue(s, "IRA_LOW")).toBeTruthy();
  });

  it("surfaces DRIFT_ABSORBED with dollar value from silent count/adjust events", async () => {
    primeExec(makeResults({
      13: [{ physical_counts_90d: 0, accurate_counts_90d: 0, never_counted_items: 66, drift_events_90d: 7, drift_net_units_90d: -40, drift_absorbed_value_90d: -12297.63 }],
    }));
    const s = await getInventoryIntegritySummary();
    const da = issue(s, "DRIFT_ABSORBED");
    expect(da).toBeTruthy();
    expect(da.count).toBe(7);
    expect(da.detail).toContain("$12,298"); // abs, rounded, localized
    expect(s.accuracy.driftAbsorbedValue90d).toBeCloseTo(-12297.63);
  });
});

describe("inventory-integrity: negative-stock tripwire (P2-6)", () => {
  beforeEach(() => execMock.mockReset());

  it("flags warehouse-field negatives as a WARNING with the offending rows", async () => {
    primeExec(makeResults({
      0: [{ finished_products: 31, components: 35, negative_rows: 1 }],
      4: [{ id: "i1", sku: "SBR-36", name: "36in Roller", type: "finished_product", current_stock: 0, hildale_qty: -3, pivot_qty: 12, available_for_sale_qty: 4 }],
    }));
    const s = await getInventoryIntegritySummary();
    const neg = issue(s, "NEGATIVE_WAREHOUSE_STOCK");
    expect(neg).toBeTruthy();
    expect(neg.severity).toBe("warning");
    expect(neg.count).toBe(1);
    expect(neg.rows).toHaveLength(1);
    expect(neg.rows[0].sku).toBe("SBR-36");
    expect(s.totals.negativeRows).toBe(1);
    // current_stock is deliberately not part of this check
    expect(neg.detail).toContain("current_stock is deliberately excluded");
  });

  it("reports current_stock<0 as an INFO build-ahead count, never a warning", async () => {
    primeExec(makeResults({
      14: [
        { id: "c1", sku: "FOAM-P2", name: "P2 Foam", type: "component", current_stock: -12, total_below_zero: 2 },
        { id: "c2", sku: "FRAME-A", name: "Frame A", type: "component", current_stock: -1, total_below_zero: 2 },
      ],
    }));
    const s = await getInventoryIntegritySummary();
    const info = issue(s, "COMPONENTS_BELOW_ZERO");
    expect(info).toBeTruthy();
    expect(info.severity).toBe("info");
    expect(info.count).toBe(2); // window count, not sample length
    expect(info.detail).toContain("build");
    expect(s.totals.componentsBelowZero).toBe(2);
    // components below zero alone must NOT raise the warehouse-negative warning
    expect(issue(s, "NEGATIVE_WAREHOUSE_STOCK")).toBeFalsy();
  });

  it("emits neither negative-stock issue when everything is >= 0", async () => {
    primeExec(makeResults());
    const s = await getInventoryIntegritySummary();
    expect(issue(s, "NEGATIVE_WAREHOUSE_STOCK")).toBeFalsy();
    expect(issue(s, "COMPONENTS_BELOW_ZERO")).toBeFalsy();
    expect(s.totals.componentsBelowZero).toBe(0);
  });
});

describe("inventory-integrity: orphaned order lines (P2-6)", () => {
  beforeEach(() => execMock.mockReset());

  it("warns with the total NULL-product_id line count and top SKUs", async () => {
    primeExec(makeResults({
      15: [
        { sku: "MYSTERY-1", line_count: 40, units: 55, total_orphan_lines: 47 },
        { sku: "OLD-KIT-2", line_count: 7, units: 7, total_orphan_lines: 47 },
      ],
    }));
    const s = await getInventoryIntegritySummary();
    const orphan = issue(s, "ORPHANED_ORDER_LINES");
    expect(orphan).toBeTruthy();
    expect(orphan.severity).toBe("warning");
    expect(orphan.count).toBe(47); // total across all SKUs, not just the top-5 sample
    expect(orphan.rows).toHaveLength(2);
    expect(orphan.detail).toContain("MYSTERY-1 (40 lines)");
    expect(orphan.detail).toContain("OLD-KIT-2 (7 lines)");
    // the check documents WHY product_id-NULL is the orphan class
    expect(orphan.detail).toContain("cascades");
    expect(s.totals.orphanedOrderLines).toBe(47);
  });

  it("emits no orphan issue when every line resolved to an item", async () => {
    primeExec(makeResults());
    const s = await getInventoryIntegritySummary();
    expect(issue(s, "ORPHANED_ORDER_LINES")).toBeFalsy();
    expect(s.totals.orphanedOrderLines).toBe(0);
  });
});
