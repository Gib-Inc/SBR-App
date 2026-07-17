import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { InventoryMovement } from "./inventory-movement";

const rows = (result: any) => result.rows ?? result;
const num = (value: unknown): number => Number(value ?? 0) || 0;

export type IntegritySeverity = "critical" | "warning" | "info";

export interface InventoryIntegrityIssue {
  severity: IntegritySeverity;
  code: string;
  title: string;
  count: number;
  detail: string;
  rows?: any[];
}

export interface InventoryIntegritySummary {
  status: "healthy" | "warning" | "critical";
  score: number;
  generatedAt: string;
  totals: {
    finishedProducts: number;
    components: number;
    /** Warehouse fields (hildale/pivot/afs) below zero — must never happen. */
    negativeRows: number;
    /** current_stock < 0 — BOM build-ahead, negative BY DESIGN (info only). */
    componentsBelowZero: number;
    /** sales_order_lines with product_id NULL (unresolvable SKUs). */
    orphanedOrderLines: number;
    mappedExtensivItems: number;
    recentlySyncedExtensivItems: number;
    openOrders: number;
    openUnshippedUnits: number;
    backorderedUnits: number;
    pendingReorderAlerts: number;
  };
  freshness: {
    latestExtensivSyncAt: string | null;
    extensivMinutesOld: number | null;
  };
  ledger: {
    trackedItems: number;
    driftItems: number;
    untrackedItems: number;
  };
  accuracy: {
    iraPercent: number | null;
    physicalCounts90d: number;
    neverCountedItems: number;
    driftEvents90d: number;
    driftNetUnits90d: number;
    driftAbsorbedValue90d: number;
  };
  issues: InventoryIntegrityIssue[];
  drift: any[];
  ledgerDrift: any[];
  openOrders: any[];
  recentMovements: any[];
}

export type InventoryIntegrityAction =
  | "MARK_LEGACY_CLEANUP"
  | "ZERO_INVALID_FIELD"
  | "SET_AFS_TO_TARGET"
  | "MARK_BOM_NOT_REQUIRED";

export interface InventoryIntegrityActionInput {
  action: InventoryIntegrityAction;
  itemId?: string;
  sku?: string;
  field?: "current_stock" | "hildale_qty" | "pivot_qty" | "available_for_sale_qty";
  target?: number;
  reason?: string;
}

export interface InventoryIntegrityActionResult {
  ok: true;
  message: string;
}

function makeIssue(
  severity: IntegritySeverity,
  code: string,
  title: string,
  count: number,
  detail: string,
  sampleRows?: any[],
): InventoryIntegrityIssue | null {
  if (count <= 0) return null;
  return { severity, code, title, count, detail, rows: sampleRows };
}

function computeStatus(issues: InventoryIntegrityIssue[]): "healthy" | "warning" | "critical" {
  if (issues.some((i) => i.severity === "critical")) return "critical";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return "healthy";
}

function computeScore(issues: InventoryIntegrityIssue[]): number {
  const penalty = issues.reduce((sum, i) => {
    const weight = i.severity === "critical" ? 18 : i.severity === "warning" ? 8 : 3;
    return sum + Math.min(30, weight + Math.max(0, i.count - 1));
  }, 0);
  return Math.max(0, 100 - penalty);
}

export async function getInventoryIntegritySummary(): Promise<InventoryIntegritySummary> {
  const [
    totalsRes,
    freshnessRes,
    wrongFinishedCurrentRes,
    wrongComponentWarehouseRes,
    negativeRowsRes,
    staleExtensivRes,
    driftRes,
    openOrdersRes,
    bomGapsRes,
    reorderRes,
    movementRes,
    ledgerStatsRes,
    ledgerDriftRes,
    accuracyRes,
    componentsBelowZeroRes,
    orphanLinesRes,
  ] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE type = 'finished_product')::int AS finished_products,
        count(*) FILTER (WHERE type = 'component')::int AS components,
        -- Warehouse fields only. current_stock < 0 is counted separately
        -- (components_below_zero): BOM_CONSUMPTION drives it negative BY DESIGN.
        count(*) FILTER (
          WHERE hildale_qty < 0 OR pivot_qty < 0 OR available_for_sale_qty < 0
        )::int AS negative_rows
      FROM items
    `),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE extensiv_sku IS NOT NULL)::int AS mapped_items,
        count(*) FILTER (
          WHERE extensiv_sku IS NOT NULL
            AND extensiv_last_sync_at > now() - interval '70 minutes'
        )::int AS recently_synced,
        max(extensiv_last_sync_at)::text AS latest_sync,
        CASE
          WHEN max(extensiv_last_sync_at) IS NULL THEN NULL
          ELSE (extract(epoch from (now() - max(extensiv_last_sync_at))) / 60)::int
        END AS minutes_old
      FROM items
    `),
    db.execute(sql`
      SELECT id, sku, name, current_stock, hildale_qty, pivot_qty, available_for_sale_qty
      FROM items
      WHERE type = 'finished_product' AND current_stock <> 0
        AND NOT EXISTS (
          SELECT 1
          FROM data_reconciliation_log drl
          WHERE drl.data_type = 'inventory_integrity'
            AND drl.entity_key = items.sku
            AND drl.field = 'legacy_field_cleanup'
            AND drl.action = 'KEPT'
        )
      ORDER BY abs(current_stock) DESC, sku
      LIMIT 25
    `),
    db.execute(sql`
      SELECT id, sku, name, current_stock, hildale_qty, pivot_qty, available_for_sale_qty
      FROM items
      WHERE type = 'component'
        AND (hildale_qty <> 0 OR pivot_qty <> 0 OR available_for_sale_qty <> 0)
        AND NOT EXISTS (
          SELECT 1
          FROM data_reconciliation_log drl
          WHERE drl.data_type = 'inventory_integrity'
            AND drl.entity_key = items.sku
            AND drl.field = 'legacy_field_cleanup'
            AND drl.action = 'KEPT'
        )
      ORDER BY abs(hildale_qty) + abs(pivot_qty) + abs(available_for_sale_qty) DESC, sku
      LIMIT 25
    `),
    // P2-6 negative-stock tripwire: WAREHOUSE fields only. These must never go
    // negative — the movement gateway guards/clamps them and NOT VALID CHECK
    // constraints (startup-migrations) reject new negative writes. Rows here
    // are legacy negatives or a write that bypassed the gateway. current_stock
    // is deliberately EXCLUDED: BOM_CONSUMPTION preserves the actual material
    // draw instead of clamping to zero (inventory-movement.ts), so components
    // go negative BY DESIGN on build-ahead shortages — counted separately below.
    db.execute(sql`
      SELECT id, sku, name, type, current_stock, hildale_qty, pivot_qty, available_for_sale_qty
      FROM items
      WHERE hildale_qty < 0 OR pivot_qty < 0 OR available_for_sale_qty < 0
      ORDER BY sku
      LIMIT 25
    `),
    db.execute(sql`
      SELECT id, sku, name, extensiv_sku, pivot_qty, extensiv_on_hand_snapshot,
             extensiv_last_sync_at::text AS extensiv_last_sync_at
      FROM items
      WHERE extensiv_sku IS NOT NULL
        AND (extensiv_last_sync_at IS NULL OR extensiv_last_sync_at <= now() - interval '70 minutes')
      ORDER BY extensiv_last_sync_at NULLS FIRST, sku
      LIMIT 25
    `),
    db.execute(sql`
      WITH open_units AS (
        SELECT
          sol.product_id,
          sum(greatest(coalesce(sol.qty_ordered, 0) - coalesce(sol.qty_shipped, 0), 0))::int AS open_unshipped
        FROM sales_order_lines sol
        JOIN sales_orders so ON so.id = sol.sales_order_id
        WHERE upper(coalesce(so.status, '')) NOT IN ('SHIPPED','FULFILLED','CANCELLED','DELIVERED','REFUNDED','PENDING_REFUND')
        GROUP BY sol.product_id
      )
      SELECT
        i.id,
        i.sku,
        i.name,
        i.pivot_qty,
        i.available_for_sale_qty,
        i.hildale_qty,
        coalesce(o.open_unshipped, 0)::int AS open_unshipped,
        greatest(coalesce(i.pivot_qty, 0) - coalesce(o.open_unshipped, 0), 0)::int AS target_available_for_sale,
        (coalesce(i.available_for_sale_qty, 0) - greatest(coalesce(i.pivot_qty, 0) - coalesce(o.open_unshipped, 0), 0))::int AS drift
      FROM items i
      LEFT JOIN open_units o ON o.product_id = i.id
      WHERE i.type = 'finished_product'
        AND abs(coalesce(i.available_for_sale_qty, 0) - greatest(coalesce(i.pivot_qty, 0) - coalesce(o.open_unshipped, 0), 0)) >= 5
      ORDER BY abs(coalesce(i.available_for_sale_qty, 0) - greatest(coalesce(i.pivot_qty, 0) - coalesce(o.open_unshipped, 0), 0)) DESC
      LIMIT 25
    `),
    db.execute(sql`
      SELECT
        count(DISTINCT so.id)::int AS open_orders,
        sum(greatest(coalesce(sol.qty_ordered, 0) - coalesce(sol.qty_shipped, 0), 0))::int AS open_unshipped_units,
        sum(coalesce(sol.qty_allocated, 0))::int AS allocated_units,
        sum(coalesce(sol.backorder_qty, 0))::int AS backordered_units,
        sum(coalesce(sol.backorder_fulfilled_qty, 0))::int AS hildale_reserved_units
      FROM sales_orders so
      JOIN sales_order_lines sol ON sol.sales_order_id = so.id
      WHERE upper(coalesce(so.status, '')) NOT IN ('SHIPPED','FULFILLED','CANCELLED','DELIVERED','REFUNDED','PENDING_REFUND')
    `),
    db.execute(sql`
      SELECT fp.id, fp.sku, fp.name, count(b.component_id)::int AS bom_lines
      FROM items fp
      LEFT JOIN bill_of_materials b ON b.finished_product_id = fp.id
      WHERE fp.type = 'finished_product'
        AND coalesce(fp.reorder_priority, '') IN ('core_build', 'money_maker', 'finished_good')
        AND NOT EXISTS (
          SELECT 1
          FROM data_reconciliation_log drl
          WHERE drl.data_type = 'inventory_integrity'
            AND drl.entity_key = fp.sku
            AND drl.field = 'bom_required'
            AND drl.action = 'DISREGARDED'
        )
      GROUP BY fp.id, fp.sku, fp.name
      HAVING count(b.component_id) = 0
      ORDER BY fp.sku
      LIMIT 25
    `),
    db.execute(sql`
      SELECT alert_status, count(*)::int AS count
      FROM reorder_alerts
      GROUP BY alert_status
      ORDER BY alert_status
    `),
    db.execute(sql`
      SELECT event_type, count(*)::int AS count, max(timestamp)::text AS latest
      FROM audit_logs
      WHERE entity_type IN ('INVENTORY', 'ITEM', 'PURCHASE_ORDER', 'SALES_ORDER')
        AND timestamp > now() - interval '7 days'
        AND event_type IN (
          'BOM_CONSUMPTION', 'PRODUCTION_COMPLETED', 'PURCHASE_ORDER_RECEIVED',
          'SALES_ORDER_CREATED', 'SALES_ORDER_CANCELLED', 'SALES_ORDER_FULFILLED',
          'MANUAL_COUNT', 'INTEGRATION_SYNC', 'INVENTORY_TRANSFERRED'
        )
      GROUP BY event_type
      ORDER BY count DESC
    `),
    // COUNT-4: ledger-vs-on-hand tripwire — compare each item's current physical
    // buckets to the `after` snapshot of its most-recent gateway movement. A gap
    // means a write bypassed InventoryMovement (no WAC roll, no shrinkage row).
    db.execute(sql`
      WITH last_mv AS (
        SELECT DISTINCT ON (details->>'itemId')
          details->>'itemId' AS item_id,
          (details->'after'->>'pivotQty')::numeric AS l_pivot,
          (details->'after'->>'hildaleQty')::numeric AS l_hildale,
          (details->'after'->>'currentStock')::numeric AS l_current
        FROM audit_logs
        WHERE entity_type IN ('INVENTORY','ITEM')
          AND details ? 'after'
          AND details->>'itemId' IS NOT NULL
        ORDER BY details->>'itemId', timestamp DESC
      ),
      tracked AS (
        SELECT i.id,
          abs(coalesce(i.pivot_qty,0)-coalesce(l.l_pivot,0))
          + abs(coalesce(i.hildale_qty,0)-coalesce(l.l_hildale,0))
          + abs(coalesce(i.current_stock,0)-coalesce(l.l_current,0)) AS drift
        FROM last_mv l JOIN items i ON i.id = l.item_id
      )
      SELECT
        (SELECT count(*) FROM tracked)::int AS tracked_items,
        (SELECT count(*) FROM tracked WHERE drift > 0)::int AS drift_items,
        (SELECT count(*) FROM items i
           WHERE i.type IN ('finished_product','component')
             AND (coalesce(i.pivot_qty,0)+coalesce(i.hildale_qty,0)+coalesce(i.current_stock,0)) <> 0
             AND NOT EXISTS (
               SELECT 1 FROM audit_logs a
               WHERE a.entity_type IN ('INVENTORY','ITEM')
                 AND a.details->>'itemId' = i.id
                 AND a.details ? 'after'
             ))::int AS untracked_items
    `),
    db.execute(sql`
      WITH last_mv AS (
        SELECT DISTINCT ON (details->>'itemId')
          details->>'itemId' AS item_id,
          (details->'after'->>'pivotQty')::numeric AS l_pivot,
          (details->'after'->>'hildaleQty')::numeric AS l_hildale,
          (details->'after'->>'currentStock')::numeric AS l_current,
          timestamp AS last_mv_at
        FROM audit_logs
        WHERE entity_type IN ('INVENTORY','ITEM')
          AND details ? 'after'
          AND details->>'itemId' IS NOT NULL
        ORDER BY details->>'itemId', timestamp DESC
      )
      SELECT
        i.sku, i.name, i.current_stock, i.hildale_qty, i.pivot_qty, i.available_for_sale_qty,
        l.l_pivot::int AS ledger_pivot,
        l.l_hildale::int AS ledger_hildale,
        l.l_current::int AS ledger_current,
        l.last_mv_at::text AS last_movement_at,
        (abs(coalesce(i.pivot_qty,0)-coalesce(l.l_pivot,0))
         + abs(coalesce(i.hildale_qty,0)-coalesce(l.l_hildale,0))
         + abs(coalesce(i.current_stock,0)-coalesce(l.l_current,0)))::int AS drift
      FROM last_mv l JOIN items i ON i.id = l.item_id
      WHERE abs(coalesce(i.pivot_qty,0)-coalesce(l.l_pivot,0))
          + abs(coalesce(i.hildale_qty,0)-coalesce(l.l_hildale,0))
          + abs(coalesce(i.current_stock,0)-coalesce(l.l_current,0)) > 0
      ORDER BY drift DESC
      LIMIT 25
    `),
    // COUNT-5: IRA + shrinkage/drift. Real physical counts live in
    // inventory_adjustments / cycle_count_entries (both empty today); MANUAL_COUNT
    // and INVENTORY_ADJUSTED audit rows carry the drift the system silently absorbed.
    db.execute(sql`
      SELECT
        ((SELECT count(*) FROM inventory_adjustments WHERE created_at > now()-interval '90 days')
         + (SELECT count(*) FROM cycle_count_entries e JOIN cycle_count_sessions s ON s.id = e.session_id
              WHERE s.status = 'COMMITTED' AND s.committed_at > now()-interval '90 days'
                AND e.counted_qty IS NOT NULL))::int AS physical_counts_90d,
        ((SELECT count(*) FILTER (WHERE difference = 0) FROM inventory_adjustments
            WHERE created_at > now()-interval '90 days')
         + (SELECT count(*) FILTER (WHERE variance = 0) FROM cycle_count_entries e
              JOIN cycle_count_sessions s ON s.id = e.session_id
              WHERE s.status = 'COMMITTED' AND s.committed_at > now()-interval '90 days'
                AND e.counted_qty IS NOT NULL))::int AS accurate_counts_90d,
        (SELECT count(*)::int FROM items i
           WHERE i.type IN ('finished_product','component')
             AND NOT EXISTS (SELECT 1 FROM inventory_adjustments a WHERE a.item_id = i.id)
             AND NOT EXISTS (SELECT 1 FROM cycle_count_entries e
                              WHERE e.item_id = i.id AND e.counted_qty IS NOT NULL)) AS never_counted_items,
        (SELECT count(*)::int FROM audit_logs a
           WHERE a.event_type IN ('MANUAL_COUNT','INVENTORY_ADJUSTED')
             AND a.timestamp > now()-interval '90 days'
             AND a.details ? 'quantityChanged'
             AND (a.details->>'quantityChanged')::numeric <> 0) AS drift_events_90d,
        (SELECT coalesce(sum((a.details->>'quantityChanged')::numeric),0)::int FROM audit_logs a
           WHERE a.event_type IN ('MANUAL_COUNT','INVENTORY_ADJUSTED')
             AND a.timestamp > now()-interval '90 days'
             AND a.details ? 'quantityChanged') AS drift_net_units_90d,
        (SELECT coalesce(sum(CASE WHEN (a.details->>'quantityChanged')::numeric < 0
                    THEN (a.details->>'quantityChanged')::numeric * coalesce(i.wac_unit_cost,0) ELSE 0 END),0)
           FROM audit_logs a LEFT JOIN items i ON i.id = a.details->>'itemId'
           WHERE a.event_type IN ('MANUAL_COUNT','INVENTORY_ADJUSTED')
             AND a.timestamp > now()-interval '90 days'
             AND a.details ? 'quantityChanged') AS drift_absorbed_value_90d
    `),
    // P2-6: components below zero (build-ahead). current_stock < 0 is legal —
    // BOM_CONSUMPTION records the true material draw on a shortage instead of
    // clamping — so this is an INFO count (replenish, don't "fix"), kept out of
    // the negative-stock warning above. Window count rides along with a top-5
    // sample of the deepest shortages.
    db.execute(sql`
      SELECT id, sku, name, type, current_stock,
             count(*) OVER ()::int AS total_below_zero
      FROM items
      WHERE current_stock < 0
      ORDER BY current_stock ASC, sku
      LIMIT 5
    `),
    // P2-6: orphaned order lines. sales_order_lines.sales_order_id already has
    // FK ON DELETE CASCADE (order deletion can't strand lines) — the REAL
    // orphan class is product_id IS NULL: a SKU none of the 7 resolution keys
    // could match (order-line-resolution-service heals what it can nightly in
    // the daily company report). These lines are invisible to COGS,
    // contribution and open-unit math. Total count + top-5 SKUs by line count.
    db.execute(sql`
      SELECT sku,
             count(*)::int AS line_count,
             sum(coalesce(qty_ordered, 0))::int AS units,
             (sum(count(*)) OVER ())::int AS total_orphan_lines
      FROM sales_order_lines
      WHERE product_id IS NULL
      GROUP BY sku
      ORDER BY count(*) DESC, sku
      LIMIT 5
    `),
  ]);

  const totalsRow = rows(totalsRes)[0] ?? {};
  const freshnessRow = rows(freshnessRes)[0] ?? {};
  const openOrderRow = rows(openOrdersRes)[0] ?? {};
  const reorderRows = rows(reorderRes);
  const pendingReorderAlerts = reorderRows
    .filter((r: any) => r.alert_status === "pending")
    .reduce((sum: number, r: any) => sum + num(r.count), 0);

  const wrongFinishedCurrent = rows(wrongFinishedCurrentRes);
  const wrongComponentWarehouse = rows(wrongComponentWarehouseRes);
  const negativeRows = rows(negativeRowsRes);
  const staleExtensiv = rows(staleExtensivRes);
  const drift = rows(driftRes);
  const bomGaps = rows(bomGapsRes);
  const ledgerStatsRow = rows(ledgerStatsRes)[0] ?? {};
  const ledgerDrift = rows(ledgerDriftRes);
  const accuracyRow = rows(accuracyRes)[0] ?? {};
  const componentsBelowZero = rows(componentsBelowZeroRes);
  const componentsBelowZeroCount = num(componentsBelowZero[0]?.total_below_zero);
  const orphanLines = rows(orphanLinesRes);
  const orphanLineCount = num(orphanLines[0]?.total_orphan_lines);

  const ledger = {
    trackedItems: num(ledgerStatsRow.tracked_items),
    driftItems: num(ledgerStatsRow.drift_items),
    untrackedItems: num(ledgerStatsRow.untracked_items),
  };

  const physicalCounts90d = num(accuracyRow.physical_counts_90d);
  const accurateCounts90d = num(accuracyRow.accurate_counts_90d);
  const accuracy = {
    // IRA is only real when physical counts exist; otherwise it is unmeasured, not 100%.
    iraPercent: physicalCounts90d > 0 ? Math.round((accurateCounts90d / physicalCounts90d) * 100) : null,
    physicalCounts90d,
    neverCountedItems: num(accuracyRow.never_counted_items),
    driftEvents90d: num(accuracyRow.drift_events_90d),
    driftNetUnits90d: num(accuracyRow.drift_net_units_90d),
    driftAbsorbedValue90d: num(accuracyRow.drift_absorbed_value_90d),
  };

  const issues = [
    // P2-6: warehouse-field negatives (hildale/pivot/afs). current_stock is
    // deliberately excluded — BOM_CONSUMPTION drives component current_stock
    // negative BY DESIGN (build-ahead), reported separately as info below.
    makeIssue("warning", "NEGATIVE_WAREHOUSE_STOCK", "Negative warehouse stock", negativeRows.length, "hildale_qty / pivot_qty / available_for_sale_qty is below zero. These fields must never go negative (the movement gateway guards them; NOT VALID CHECK constraints reject new negative writes), so these rows are legacy negatives or a write that bypassed InventoryMovement. Fulfillment and reorder decisions on them are unsafe until reviewed. current_stock is deliberately excluded: BOM consumption legitimately drives components below zero (build-ahead).", negativeRows),
    makeIssue("info", "COMPONENTS_BELOW_ZERO", "Components below zero (build-ahead)", componentsBelowZeroCount, `${componentsBelowZeroCount} item(s) have current_stock below zero. BOM consumption preserves the actual material draw instead of clamping to zero, so a build can legitimately reveal a component shortage. This is a replenishment signal, not drift — do not zero it away.`, componentsBelowZero),
    makeIssue("warning", "ORPHANED_ORDER_LINES", "Order lines with unresolvable SKUs", orphanLineCount, `${orphanLineCount} sales_order_lines have product_id NULL, making them invisible to COGS/contribution/open-unit math. sales_order_id already cascades on order delete, so product_id-NULL (an unresolvable SKU) is the real orphan class here. The 7-key order-line resolution service re-joins what it can nightly; these lines matched none of the 7 keys. Top SKUs: ${orphanLines.map((r: any) => `${r.sku} (${num(r.line_count)} line${num(r.line_count) === 1 ? "" : "s"})`).join(", ") || "none"}.`, orphanLines),
    makeIssue("critical", "EXTENSIV_STALE", "Extensiv sync stale", staleExtensiv.length, "Mapped Pyvott/Extensiv items have not synced within the expected hourly window.", staleExtensiv),
    makeIssue("warning", "AFS_DRIFT", "Sellable stock drift", drift.length, "available_for_sale_qty should roughly equal pivot_qty minus open unshipped units. Large differences need review.", drift),
    makeIssue("warning", "FINISHED_CURRENT_STOCK", "Finished products have current_stock", wrongFinishedCurrent.length, "Finished products should use Hildale/Pyvott fields, not current_stock.", wrongFinishedCurrent),
    makeIssue("warning", "COMPONENT_WAREHOUSE_FIELDS", "Components have warehouse values", wrongComponentWarehouse.length, "Components should use current_stock only. Hildale/Pyvott values here are legacy contamination.", wrongComponentWarehouse),
    makeIssue("info", "CORE_BOM_GAPS", "Core finished products missing BOMs", bomGaps.length, "Core build products without BOMs cannot consume components or calculate build cost correctly.", bomGaps),
    makeIssue("info", "BACKORDER_PRESSURE", "Open backordered units", num(openOrderRow.backordered_units) > 0 ? 1 : 0, `${num(openOrderRow.backordered_units)} units are currently backordered across open sales orders.`, [openOrderRow]),
    // COUNT-4: writes that bypassed the movement gateway (WAC + shrinkage skipped on those).
    makeIssue("warning", "LEDGER_DRIFT", "Stock differs from movement ledger", ledger.driftItems, `${ledger.driftItems} of ${ledger.trackedItems} ledgered items have a current on-hand that no longer matches the 'after' snapshot of their most-recent gateway movement. A write reached the stock field outside InventoryMovement, so weighted-average cost and the shrinkage ledger were skipped on it.`, ledgerDrift),
    makeIssue("info", "LEDGER_UNTRACKED", "Stock with no movement ledger", ledger.untrackedItems, `${ledger.untrackedItems} items hold stock but have zero movement-ledger rows, so their on-hand cannot be reconciled against a ledger (SUM of movements vs on-hand is unprovable for them).`),
    // COUNT-5: inventory record accuracy. Unmeasured until real physical counts are recorded.
    makeIssue("warning", "IRA_UNMEASURED", "Inventory record accuracy unmeasured", accuracy.iraPercent === null ? 1 : 0, `No physical counts have been recorded in the last 90 days, so inventory record accuracy cannot be measured. ${accuracy.neverCountedItems} SKUs have never been counted through the app.`),
    makeIssue("warning", "IRA_LOW", "Inventory record accuracy below target", accuracy.iraPercent !== null && accuracy.iraPercent < 95 ? 1 : 0, `Inventory record accuracy is ${accuracy.iraPercent}% over ${accuracy.physicalCounts90d} counts in the last 90 days (target >=95%).`),
    makeIssue("info", "DRIFT_ABSORBED", "Unreconciled drift absorbed", accuracy.driftEvents90d, `${accuracy.driftEvents90d} count/adjustment movements in the last 90 days silently corrected stock without a physical count behind them, absorbing $${Math.abs(Math.round(accuracy.driftAbsorbedValue90d)).toLocaleString("en-US")} of shrinkage at WAC (${accuracy.driftNetUnits90d} net units).`),
  ].filter(Boolean) as InventoryIntegrityIssue[];

  return {
    status: computeStatus(issues),
    score: computeScore(issues),
    generatedAt: new Date().toISOString(),
    totals: {
      finishedProducts: num(totalsRow.finished_products),
      components: num(totalsRow.components),
      negativeRows: num(totalsRow.negative_rows),
      componentsBelowZero: componentsBelowZeroCount,
      orphanedOrderLines: orphanLineCount,
      mappedExtensivItems: num(freshnessRow.mapped_items),
      recentlySyncedExtensivItems: num(freshnessRow.recently_synced),
      openOrders: num(openOrderRow.open_orders),
      openUnshippedUnits: num(openOrderRow.open_unshipped_units),
      backorderedUnits: num(openOrderRow.backordered_units),
      pendingReorderAlerts,
    },
    freshness: {
      latestExtensivSyncAt: freshnessRow.latest_sync ?? null,
      extensivMinutesOld: freshnessRow.minutes_old == null ? null : num(freshnessRow.minutes_old),
    },
    ledger,
    accuracy,
    issues,
    drift,
    ledgerDrift,
    openOrders: [openOrderRow],
    recentMovements: rows(movementRes),
  };
}

async function getActionItem(input: InventoryIntegrityActionInput) {
  const item = input.itemId
    ? await storage.getItem(input.itemId)
    : input.sku
      ? await storage.getItemBySku(input.sku)
      : undefined;
  if (!item) throw new Error("Inventory item not found for integrity action");
  return item;
}

async function getOpenUnshippedUnits(itemId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT coalesce(sum(greatest(coalesce(sol.qty_ordered, 0) - coalesce(sol.qty_shipped, 0), 0)), 0)::int AS open_unshipped
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    WHERE sol.product_id = ${itemId}
      AND upper(coalesce(so.status, '')) NOT IN ('SHIPPED','FULFILLED','CANCELLED','DELIVERED','REFUNDED','PENDING_REFUND')
  `);
  return num(rows(result)[0]?.open_unshipped);
}

function valueForField(item: any, field: NonNullable<InventoryIntegrityActionInput["field"]>): number {
  switch (field) {
    case "current_stock":
      return num(item.currentStock);
    case "hildale_qty":
      return num(item.hildaleQty);
    case "pivot_qty":
      return num(item.pivotQty);
    case "available_for_sale_qty":
      return num(item.availableForSaleQty);
  }
}

async function logIntegrityAction(entry: {
  sku: string;
  action: string;
  field: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  reason: string;
}) {
  await storage.createDataReconciliationLog([{
    dataType: "inventory_integrity",
    entityKey: entry.sku,
    action: entry.action,
    field: entry.field,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    reason: entry.reason,
    source: "inventory-integrity",
  }]);
}

export async function applyInventoryIntegrityAction(
  input: InventoryIntegrityActionInput,
  actor: { userId?: string | number | null } = {},
): Promise<InventoryIntegrityActionResult> {
  const item = await getActionItem(input);
  const reason = input.reason?.trim() || "Reviewed from Inventory Integrity Review/Fix mode.";

  if (input.action === "MARK_LEGACY_CLEANUP") {
    // Stable marker field: the summary queries exclude SKUs with this decision,
    // so the reviewed row actually drops off the legacy-contamination lists.
    await logIntegrityAction({
      sku: item.sku,
      action: "KEPT",
      field: "legacy_field_cleanup",
      reason: `Marked as legacy field cleanup. ${reason}`,
    });
    return { ok: true, message: `${item.sku} marked as legacy field cleanup.` };
  }

  if (input.action === "MARK_BOM_NOT_REQUIRED") {
    if (item.type !== "finished_product") {
      throw new Error("Only finished products can be marked BOM not required");
    }
    await logIntegrityAction({
      sku: item.sku,
      action: "DISREGARDED",
      field: "bom_required",
      oldValue: "required",
      newValue: "not_required",
      reason: `BOM gap marked not required. ${reason}`,
    });
    return { ok: true, message: `${item.sku} marked BOM not required.` };
  }

  if (input.action === "ZERO_INVALID_FIELD") {
    if (!input.field) throw new Error("field is required to zero an invalid field");
    const validFinishedField = item.type === "finished_product" && input.field === "current_stock";
    const validComponentField = item.type === "component" && ["hildale_qty", "pivot_qty", "available_for_sale_qty"].includes(input.field);
    if (!validFinishedField && !validComponentField) {
      throw new Error(`Refusing to zero ${input.field} for ${item.type}. This is not an invalid legacy field for that item type.`);
    }

    const before = valueForField(item, input.field);
    const updatesByField = {
      current_stock: { currentStock: 0 },
      hildale_qty: { hildaleQty: 0 },
      pivot_qty: { pivotQty: 0 },
      available_for_sale_qty: { availableForSaleQty: 0 },
    };
    if (before !== 0) {
      await storage.updateItem(item.id, updatesByField[input.field]);
    }
    await logIntegrityAction({
      sku: item.sku,
      action: before === 0 ? "KEPT" : "UPDATED",
      field: input.field,
      oldValue: String(before),
      newValue: "0",
      reason: `Zeroed invalid legacy inventory field. ${reason}`,
    });
    return { ok: true, message: `${item.sku} ${input.field} is now zero.` };
  }

  if (input.action === "SET_AFS_TO_TARGET") {
    if (item.type !== "finished_product") {
      throw new Error("Only finished products have available-for-sale targets");
    }
    const openUnshipped = await getOpenUnshippedUnits(item.id);
    const computedTarget = Math.max(0, num(item.pivotQty) - openUnshipped);
    const target = Number.isFinite(Number(input.target)) ? Math.max(0, Math.trunc(Number(input.target))) : computedTarget;
    const currentAfs = num(item.availableForSaleQty);
    const delta = target - currentAfs;
    if (delta !== 0) {
      const movement = new InventoryMovement(storage);
      const result = await movement.apply({
        eventType: "MANUAL_COUNT",
        itemId: item.id,
        quantity: delta,
        location: "PIVOT",
        source: "inventory-integrity",
        userId: actor.userId ?? undefined,
        notes: `Inventory Integrity Review/Fix: set AFS to ${target} (Pyvott ${num(item.pivotQty)} - open unshipped ${openUnshipped}).`,
      });
      if (!result.success) throw new Error(result.error || "Failed to set AFS target");
    }
    await logIntegrityAction({
      sku: item.sku,
      action: delta === 0 ? "KEPT" : "UPDATED",
      field: "available_for_sale_qty",
      oldValue: String(currentAfs),
      newValue: String(target),
      reason: `Set AFS to integrity target. ${reason}`,
    });
    return { ok: true, message: `${item.sku} AFS set to ${target}.` };
  }

  throw new Error(`Unsupported integrity action: ${input.action}`);
}
