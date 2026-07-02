import { sql } from "drizzle-orm";
import { db } from "../db";

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
    negativeRows: number;
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
  issues: InventoryIntegrityIssue[];
  drift: any[];
  openOrders: any[];
  recentMovements: any[];
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
  ] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE type = 'finished_product')::int AS finished_products,
        count(*) FILTER (WHERE type = 'component')::int AS components,
        count(*) FILTER (
          WHERE current_stock < 0 OR hildale_qty < 0 OR pivot_qty < 0 OR available_for_sale_qty < 0
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
      SELECT sku, name, current_stock, hildale_qty, pivot_qty, available_for_sale_qty
      FROM items
      WHERE type = 'finished_product' AND current_stock <> 0
      ORDER BY abs(current_stock) DESC, sku
      LIMIT 25
    `),
    db.execute(sql`
      SELECT sku, name, current_stock, hildale_qty, pivot_qty, available_for_sale_qty
      FROM items
      WHERE type = 'component'
        AND (hildale_qty <> 0 OR pivot_qty <> 0 OR available_for_sale_qty <> 0)
      ORDER BY abs(hildale_qty) + abs(pivot_qty) + abs(available_for_sale_qty) DESC, sku
      LIMIT 25
    `),
    db.execute(sql`
      SELECT sku, name, type, current_stock, hildale_qty, pivot_qty, available_for_sale_qty
      FROM items
      WHERE current_stock < 0 OR hildale_qty < 0 OR pivot_qty < 0 OR available_for_sale_qty < 0
      ORDER BY sku
      LIMIT 25
    `),
    db.execute(sql`
      SELECT sku, name, extensiv_sku, pivot_qty, extensiv_on_hand_snapshot,
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
      SELECT fp.sku, fp.name, count(b.component_id)::int AS bom_lines
      FROM items fp
      LEFT JOIN bill_of_materials b ON b.finished_product_id = fp.id
      WHERE fp.type = 'finished_product'
        AND coalesce(fp.reorder_priority, '') IN ('core_build', 'money_maker', 'finished_good')
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

  const issues = [
    makeIssue("critical", "NEGATIVE_STOCK", "Negative stock rows", negativeRows.length, "A stock field is below zero. Fulfillment and reorder decisions are unsafe until reviewed.", negativeRows),
    makeIssue("critical", "EXTENSIV_STALE", "Extensiv sync stale", staleExtensiv.length, "Mapped Pyvott/Extensiv items have not synced within the expected hourly window.", staleExtensiv),
    makeIssue("warning", "AFS_DRIFT", "Sellable stock drift", drift.length, "available_for_sale_qty should roughly equal pivot_qty minus open unshipped units. Large differences need review.", drift),
    makeIssue("warning", "FINISHED_CURRENT_STOCK", "Finished products have current_stock", wrongFinishedCurrent.length, "Finished products should use Hildale/Pyvott fields, not current_stock.", wrongFinishedCurrent),
    makeIssue("warning", "COMPONENT_WAREHOUSE_FIELDS", "Components have warehouse values", wrongComponentWarehouse.length, "Components should use current_stock only. Hildale/Pyvott values here are legacy contamination.", wrongComponentWarehouse),
    makeIssue("info", "CORE_BOM_GAPS", "Core finished products missing BOMs", bomGaps.length, "Core build products without BOMs cannot consume components or calculate build cost correctly.", bomGaps),
    makeIssue("info", "BACKORDER_PRESSURE", "Open backordered units", num(openOrderRow.backordered_units) > 0 ? 1 : 0, `${num(openOrderRow.backordered_units)} units are currently backordered across open sales orders.`, [openOrderRow]),
  ].filter(Boolean) as InventoryIntegrityIssue[];

  return {
    status: computeStatus(issues),
    score: computeScore(issues),
    generatedAt: new Date().toISOString(),
    totals: {
      finishedProducts: num(totalsRow.finished_products),
      components: num(totalsRow.components),
      negativeRows: num(totalsRow.negative_rows),
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
    issues,
    drift,
    openOrders: [openOrderRow],
    recentMovements: rows(movementRes),
  };
}
