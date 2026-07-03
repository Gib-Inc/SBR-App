import { describe, it, expect, vi, beforeEach } from "vitest";

// The service issues a fixed, ordered list of db.execute() calls inside Promise.all.
// We queue canned results in that exact order. If you add/reorder queries in
// getInventoryIntegritySummary, update DEFAULT_RESULTS to match.
const execMock = vi.fn();
vi.mock("../db", () => ({ db: { execute: (...args: any[]) => execMock(...args) } }));

import { getInventoryIntegritySummary } from "./inventory-integrity-service";

// Order matches the Promise.all in getInventoryIntegritySummary:
// 0 totals, 1 freshness, 2 wrongFinishedCurrent, 3 wrongComponentWarehouse,
// 4 negativeRows, 5 staleExtensiv, 6 drift, 7 openOrders, 8 bomGaps,
// 9 reorder, 10 movements, 11 ledgerStats, 12 ledgerDrift, 13 accuracy
function makeResults(over: Partial<Record<number, any>> = {}): any[] {
  const base: any[] = [
    [{ finished_products: 31, components: 35, negative_rows: 0 }],
    [{ mapped_items: 60, recently_synced: 60, latest_sync: "2026-07-02T20:00:00Z", minutes_old: 5 }],
    [], // wrongFinishedCurrent
    [], // wrongComponentWarehouse
    [], // negativeRows
    [], // staleExtensiv
    [], // afs drift
    [{ open_orders: 0, open_unshipped_units: 0, allocated_units: 0, backordered_units: 0, hildale_reserved_units: 0 }],
    [], // bomGaps
    [], // reorder
    [], // movements
    [{ tracked_items: 32, drift_items: 0, untracked_items: 0 }], // ledgerStats
    [], // ledgerDrift
    [{ physical_counts_90d: 0, accurate_counts_90d: 0, never_counted_items: 66, drift_events_90d: 0, drift_net_units_90d: 0, drift_absorbed_value_90d: 0 }],
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
