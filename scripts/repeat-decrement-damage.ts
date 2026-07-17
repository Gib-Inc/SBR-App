/**
 * repeat-decrement-damage.ts — pure damage-aggregation for the
 * INCIDENT-2026-07-REPEAT-DECREMENT quantifier script.
 *
 * Kept free of DB / server imports so the aggregation math is unit-testable
 * with fixture rows (see repeat-decrement-damage.test.ts). The incident script
 * (incident-2026-07-repeat-decrement.ts) feeds it the joined
 * dup_orders × sales_order_lines × items rows and prints the result.
 */

/**
 * One joined row: a sales-order line belonging to an order whose
 * SALES_ORDER_CREATED audit events fired more than once in the window.
 * `extraFires` is per ORDER (COUNT(*) - 1), so every line of the same order
 * carries the same value.
 */
export interface DupFireLineRow {
  orderId: string;
  /** COUNT(*) - 1 of SALES_ORDER_CREATED audit rows for this order (per order). */
  extraFires: number;
  itemId: string;
  sku: string | null;
  /** items.type — 'finished_product' | 'component' */
  itemType: string;
  qtyOrdered: number;
}

export interface SkuDamage {
  itemId: string;
  sku: string;
  itemType: string;
  /** UPPER BOUND: Σ extra_fires × qty_ordered across the dup orders touching this item. */
  overDecrementedUnits: number;
  /** Distinct dup orders that touched this item. */
  affectedOrders: number;
  /** Σ extra_fires counted ONCE per distinct order (not once per line). */
  totalExtraFires: number;
}

/**
 * SKU normalization — MUST stay identical to `norm` in
 * server/services/inventory-drift-resolver.ts (openUnshippedBySku keys its map
 * with it). Replicated here instead of imported so this module stays free of
 * server/DB imports (the resolver pulls in storage + drizzle at module load).
 */
export const normalizeSku = (s: string | null | undefined): string =>
  (s ?? "").replace(/^SKU:\s*/i, "").replace(/[^a-z0-9]/gi, "").toUpperCase();

// ─── Capped true-up math (--capped mode) ───

export interface CappedRestoreInput {
  /** Audit-derived upper bound: overDecrementedUnits for the SKU. */
  auditBound: number;
  /** items.pivot_qty — Extensiv sellable mirror, read at run time. */
  pivot: number;
  /** Open unshipped units for the SKU (openUnshippedBySku semantics). */
  openUnshipped: number;
  /** items.available_for_sale_qty, read at run time. */
  afs: number;
}

/**
 * Live shortfall: how far afs currently sits BELOW where open orders say it
 * should be (pivot − openUnshipped), floored at 0. A zero means afs is already
 * at or above the pivot − open baseline — nothing is missing right now.
 */
export function liveShortfall(
  input: Pick<CappedRestoreInput, "pivot" | "openUnshipped" | "afs">,
): number {
  const open = Math.max(0, input.openUnshipped ?? 0);
  return Math.max(0, (input.pivot ?? 0) - open - (input.afs ?? 0));
}

/**
 * Capped restoration for one SKU: min(audit bound, live shortfall).
 *
 * INVARIANT (by construction): the returned restore can never push afs above
 * pivot − openUnshipped, because restore ≤ liveShortfall = max(0,
 * pivot − open − afs). The audit bound is an UPPER bound (Math.max clamping and
 * per-line audit rows inflate it), so the live shortfall wins whenever the
 * world has already absorbed part of the damage (Extensiv sync, cancellations,
 * later restorative movements). Malformed inputs are clamped, never inverted:
 * a negative/fractional audit bound floors to 0 units restored.
 */
export function cappedRestore(input: CappedRestoreInput): number {
  const bound = Math.max(0, Math.floor(input.auditBound ?? 0));
  return Math.min(bound, liveShortfall(input));
}

/**
 * Aggregate per-item over-decrement damage from dup-order line rows.
 *
 * Semantics match the audit SQL: SUM(extra_fires × qty_ordered) GROUP BY item,
 * ordered worst-first. Items whose total contribution is <= 0 (e.g. zero-qty
 * lines only) are dropped — there is nothing to true up.
 *
 * This is an UPPER BOUND on real damage: (a) the movement engine clamps
 * availableForSaleQty at 0 (Math.max), so some extra fires decremented nothing;
 * (b) SALES_ORDER_CREATED audit rows are logged per line movement, so a
 * multi-line order counts >1 rows per single order-create pass, inflating
 * extra_fires for orders with more than one mapped line.
 */
export function aggregateRepeatDecrementDamage(rows: DupFireLineRow[]): SkuDamage[] {
  const byItem = new Map<
    string,
    {
      sku: string;
      itemType: string;
      units: number;
      /** orderId → extra_fires (same value per order; keyed so fires count once per order) */
      orders: Map<string, number>;
    }
  >();

  for (const row of rows) {
    const extraFires = Math.max(0, Math.floor(row.extraFires ?? 0));
    const qty = Number(row.qtyOrdered ?? 0);
    if (!row.itemId) continue;

    let entry = byItem.get(row.itemId);
    if (!entry) {
      entry = {
        sku: row.sku ?? "(no sku)",
        itemType: row.itemType,
        units: 0,
        orders: new Map(),
      };
      byItem.set(row.itemId, entry);
    }
    entry.units += extraFires * qty;
    if (!entry.orders.has(row.orderId)) entry.orders.set(row.orderId, extraFires);
  }

  const damages: SkuDamage[] = [];
  byItem.forEach((entry, itemId) => {
    if (entry.units <= 0) return;
    let totalExtraFires = 0;
    entry.orders.forEach((fires) => {
      totalExtraFires += fires;
    });
    damages.push({
      itemId,
      sku: entry.sku,
      itemType: entry.itemType,
      overDecrementedUnits: entry.units,
      affectedOrders: entry.orders.size,
      totalExtraFires,
    });
  });

  // Worst damage first; stable tiebreak by sku for deterministic output.
  damages.sort(
    (a, b) => b.overDecrementedUnits - a.overDecrementedUnits || a.sku.localeCompare(b.sku),
  );
  return damages;
}
