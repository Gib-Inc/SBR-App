/**
 * InventoryCostingService — Pillar 2 Weighted-Average-Cost (WAC) valuation.
 * -----------------------------------------------------------------------
 * The app already moves QUANTITY correctly (BOM consumption, build orders /
 * production runs, FIFO lots, InventoryMovement). What it lacks is the COST
 * layer: a running weighted-average cost per item, the per-unit cost of a built
 * finished good, the asset value of inventory, and the balance-sheet impact of
 * a manual recount. These are pure, deterministic formulas — unit tested to the
 * cent — so the valuation is auditable and drift-free.
 *
 * WAC (vs FIFO/LIFO) is chosen because it's stable, GAAP-acceptable, and matches
 * how the existing single cost-per-item fields are shaped.
 */

/** Round to whole cents — money math must be exact and assertion-friendly. */
function cents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface StockPosition {
  qty: number;
  unitCost: number; // WAC per unit
}

/**
 * New weighted-average cost after receiving `addedQty` units at `addedUnitCost`.
 *
 *   newWac = (onHandQty·onHandWac + addedQty·addedUnitCost) / (onHandQty + addedQty)
 *
 * Receiving 0 units leaves WAC unchanged. If the resulting total is 0, WAC is 0.
 * Returns at WHOLE-CENT precision (carrying full precision into the next call
 * would drift; the cent is the unit of account).
 */
export function weightedAverageCost(
  onHandQty: number,
  onHandWac: number,
  addedQty: number,
  addedUnitCost: number,
): number {
  const q0 = Math.max(0, onHandQty || 0);
  const c0 = Math.max(0, onHandWac || 0);
  const qa = Math.max(0, addedQty || 0);
  const ca = Math.max(0, addedUnitCost || 0);
  if (qa === 0) return cents(c0);
  const total = q0 + qa;
  if (total === 0) return 0;
  return cents((q0 * c0 + qa * ca) / total);
}

export interface BomComponent {
  qtyPerUnit: number; // components consumed to build ONE finished unit
  unitCost: number; // WAC of that component
}

/** Per-unit cost to build one finished good from its bill of materials. */
export function buildUnitCost(components: BomComponent[]): number {
  const total = (components || []).reduce(
    (s, c) => s + Math.max(0, c.qtyPerUnit || 0) * Math.max(0, c.unitCost || 0),
    0,
  );
  return cents(total);
}

/**
 * Build-order state transition (cost side): combining components into a finished
 * batch raises finished-goods stock and rolls the batch's build cost into the
 * finished good's WAC. Returns the finished good's new {qty, unitCost}.
 */
export function applyBuildToFinishedGood(
  finished: StockPosition,
  builtQty: number,
  perUnitBuildCost: number,
): StockPosition {
  const qty = Math.max(0, finished.qty || 0) + Math.max(0, builtQty || 0);
  const unitCost = weightedAverageCost(
    finished.qty || 0,
    finished.unitCost || 0,
    builtQty || 0,
    perUnitBuildCost,
  );
  return { qty, unitCost };
}

/** Total component cost consumed to build a batch (for the COGS/audit trail). */
export function batchBuildCost(components: BomComponent[], batchUnits: number): number {
  return cents(buildUnitCost(components) * Math.max(0, batchUnits || 0));
}

/** Total balance-sheet asset value of a set of stock positions (Σ qty·WAC). */
export function inventoryAssetValue(positions: StockPosition[]): number {
  return cents(
    (positions || []).reduce(
      (s, p) => s + Math.max(0, p.qty || 0) * Math.max(0, p.unitCost || 0),
      0,
    ),
  );
}

export interface CountVariance {
  qtyDelta: number; // counted − system (negative = shrinkage)
  valueDelta: number; // qtyDelta · WAC — the balance-sheet adjustment
  direction: "SHRINKAGE" | "OVERAGE" | "MATCH";
}

/**
 * Zero-drift audit: when a manual physical count differs from the system count,
 * the inventory asset on the balance sheet must move by (countedQty − systemQty)·WAC.
 * Returns the signed delta + direction so the variance is flagged, not silently
 * absorbed.
 */
export function countVariance(
  systemQty: number,
  countedQty: number,
  unitCost: number,
): CountVariance {
  const qtyDelta = (countedQty || 0) - (systemQty || 0);
  const valueDelta = cents(qtyDelta * Math.max(0, unitCost || 0));
  const direction = qtyDelta < 0 ? "SHRINKAGE" : qtyDelta > 0 ? "OVERAGE" : "MATCH";
  return { qtyDelta, valueDelta, direction };
}
