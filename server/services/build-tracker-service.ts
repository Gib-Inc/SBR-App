/**
 * COUNT.M — Build Tracker: "what's being built", per build shop.
 *
 * SBR's three build shops each make part of a roller: Pednar turns the foam
 * rollers, Acu-Form molds the catch baskets, FX Industries assembles the finished
 * rollers (and builds frames). A "build" is an open purchase order to one of those
 * shops; its po_status walks ordered → confirmed → in_production → received. This
 * surfaces those open builds grouped by shop with quantities, stage, and aging, and
 * lets you start a new one. Receiving a build (Mark Received) is the existing flow:
 * FX finished products move fx_in_process → hildale; components add to currentStock.
 */
import { sql } from "drizzle-orm";

type DB = any;
type Storage = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);

export const BUILD_STAGES = ["ordered", "confirmed", "in_production", "shipped", "received"] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];
export const STAGE_LABEL: Record<string, string> = {
  ordered: "Ordered", confirmed: "Confirmed", in_production: "In Production", shipped: "Shipped", received: "Received",
};
// Stages where finished-product units count as "in process" at FX (mirrors the
// po-status PATCH so fx_in_process_qty stays consistent across both paths).
const isContributingStage = (s: string) => s === "in_production" || s === "shipped";

const DAY = 86400000;
const ymd = (d: any): string | null => {
  if (!d) return null;
  const s = String(d);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

export interface BuildLine { sku: string; name: string; itemType: string; qtyOrdered: number; qtyReceived: number; remaining: number; inProcess: number; }
export interface BuildOrder {
  poId: string; poNumber: string; stage: string; stageLabel: string;
  orderedDate: string | null; dueDate: string | null;
  daysInProgress: number | null; daysUntilDue: number | null; overdue: boolean;
  unitsOrdered: number; unitsRemaining: number; lines: BuildLine[];
}
export interface ShopBuilds {
  shopId: string; shopName: string;
  openOrders: number; unitsInBuild: number; overdueCount: number;
  builds: BuildOrder[];
  buildableItems: Array<{ itemId: string; sku: string; name: string; itemType: string }>;
}
export interface BuildTracker {
  shops: ShopBuilds[];
  summary: { shops: number; openOrders: number; unitsInBuild: number; overdue: number };
}

/** Pure: aging for a build from its order + due dates. */
export function buildAging(orderedDate: string | null, dueDate: string | null, nowMs: number): {
  daysInProgress: number | null; daysUntilDue: number | null; overdue: boolean;
} {
  const today = Math.floor(nowMs / DAY) * DAY;
  const daysInProgress = orderedDate ? Math.max(0, Math.round((today - Date.parse(orderedDate + "T00:00:00Z")) / DAY)) : null;
  const daysUntilDue = dueDate ? Math.round((Date.parse(dueDate + "T00:00:00Z") - today) / DAY) : null;
  const overdue = daysUntilDue != null && daysUntilDue < 0;
  return { daysInProgress, daysUntilDue, overdue };
}

/** Pure: roll a shop's builds into its summary counts. */
export function rollupShop(builds: BuildOrder[]): { openOrders: number; unitsInBuild: number; overdueCount: number } {
  return {
    openOrders: builds.length,
    unitsInBuild: builds.reduce((s, b) => s + b.unitsRemaining, 0),
    overdueCount: builds.filter((b) => b.overdue).length,
  };
}

export async function getBuildTracker(db: DB, nowMs: number): Promise<BuildTracker> {
  const shops = rows(await db.execute(sql`
    SELECT id, name FROM suppliers WHERE is_build_shop = true ORDER BY name`)) as Array<{ id: string; name: string }>;
  if (shops.length === 0) return { shops: [], summary: { shops: 0, openOrders: 0, unitsInBuild: 0, overdue: 0 } };

  // Open build POs + their lines.
  const lineRows = rows(await db.execute(sql`
    SELECT po.id AS po_id, po.po_number, po.supplier_id,
           COALESCE(po.po_status, 'ordered') AS stage,
           to_char(po.order_date, 'YYYY-MM-DD') AS ordered_date,
           to_char(po.expected_date, 'YYYY-MM-DD') AS due_date,
           pol.sku, pol.item_name, COALESCE(pol.qty_ordered,0) AS qty_ordered,
           COALESCE(pol.qty_received,0) AS qty_received,
           COALESCE(i.type,'component') AS item_type, COALESCE(i.fx_in_process_qty,0) AS in_process
    FROM purchase_orders po
    LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    LEFT JOIN items i ON i.id = pol.item_id
    WHERE po.supplier_id IN (SELECT id FROM suppliers WHERE is_build_shop = true)
      AND COALESCE(po.status,'') NOT IN ('RECEIVED','CLOSED','CANCELLED')
      AND COALESCE(po.po_status,'ordered') <> 'received'
      AND COALESCE(po.is_historical,false) = false
    ORDER BY po.order_date DESC NULLS LAST, po.po_number`)) as any[];

  // Buildable items per shop (for the Start-a-build picker).
  const itemRows = rows(await db.execute(sql`
    SELECT si.supplier_id, i.id, i.sku, i.name, COALESCE(i.type,'component') AS item_type
    FROM supplier_items si JOIN items i ON i.id = si.item_id
    WHERE si.supplier_id IN (SELECT id FROM suppliers WHERE is_build_shop = true)
    ORDER BY i.type DESC, i.sku`)) as any[];

  // Group line rows into builds (by PO).
  const buildsByPo = new Map<string, BuildOrder>();
  const poToShop = new Map<string, string>();
  for (const r of lineRows) {
    poToShop.set(r.po_id, r.supplier_id);
    let b = buildsByPo.get(r.po_id);
    if (!b) {
      const age = buildAging(r.ordered_date ?? null, r.due_date ?? null, nowMs);
      b = {
        poId: r.po_id, poNumber: r.po_number, stage: r.stage, stageLabel: STAGE_LABEL[r.stage] ?? r.stage,
        orderedDate: r.ordered_date ?? null, dueDate: r.due_date ?? null,
        daysInProgress: age.daysInProgress, daysUntilDue: age.daysUntilDue, overdue: age.overdue,
        unitsOrdered: 0, unitsRemaining: 0, lines: [],
      };
      buildsByPo.set(r.po_id, b);
    }
    if (r.sku) {
      const qtyOrdered = num(r.qty_ordered);
      const qtyReceived = num(r.qty_received);
      const remaining = Math.max(0, qtyOrdered - qtyReceived);
      b.lines.push({
        sku: r.sku, name: r.item_name ?? r.sku, itemType: r.item_type,
        qtyOrdered, qtyReceived, remaining, inProcess: num(r.in_process),
      });
      b.unitsOrdered += qtyOrdered;
      b.unitsRemaining += remaining;
    }
  }

  const itemsByShop = new Map<string, ShopBuilds["buildableItems"]>();
  for (const r of itemRows) {
    const arr = itemsByShop.get(r.supplier_id) ?? [];
    arr.push({ itemId: r.id, sku: r.sku, name: r.name, itemType: r.item_type });
    itemsByShop.set(r.supplier_id, arr);
  }

  const shopBuilds: ShopBuilds[] = shops.map((s) => {
    const builds = Array.from(buildsByPo.values()).filter((b) => poToShop.get(b.poId) === s.id);
    const roll = rollupShop(builds);
    return { shopId: s.id, shopName: s.name, builds, buildableItems: itemsByShop.get(s.id) ?? [], ...roll };
  });

  const summary = {
    shops: shopBuilds.length,
    openOrders: shopBuilds.reduce((a, s) => a + s.openOrders, 0),
    unitsInBuild: shopBuilds.reduce((a, s) => a + s.unitsInBuild, 0),
    overdue: shopBuilds.reduce((a, s) => a + s.overdueCount, 0),
  };
  return { shops: shopBuilds, summary };
}

export interface StartBuildInput { shopId: string; itemId: string; qty: number; dueDate?: string | null; stage?: string }
export interface StartBuildResult { ok: boolean; reason?: string; poId?: string; poNumber?: string; shopName?: string; sku?: string }

/** Start a build: create an open PO to the shop for an item + qty, at a build stage. */
export async function startBuild(db: DB, storage: Storage, input: StartBuildInput, nowMs: number): Promise<StartBuildResult> {
  const qty = Math.round(Number(input.qty) || 0);
  if (!input.shopId || !input.itemId) return { ok: false, reason: "missing_fields" };
  if (qty <= 0) return { ok: false, reason: "bad_qty" };
  const stage = BUILD_STAGES.includes(input.stage as BuildStage) ? (input.stage as BuildStage) : "in_production";

  const shop = rows(await db.execute(sql`SELECT id, name, is_build_shop FROM suppliers WHERE id = ${input.shopId} LIMIT 1`))[0];
  if (!shop || shop.is_build_shop !== true) return { ok: false, reason: "not_a_build_shop" };

  const link = rows(await db.execute(sql`
    SELECT i.id, i.sku, i.name, COALESCE(i.type,'component') AS item_type, si.price
    FROM supplier_items si JOIN items i ON i.id = si.item_id
    WHERE si.supplier_id = ${input.shopId} AND si.item_id = ${input.itemId} LIMIT 1`))[0];
  if (!link) return { ok: false, reason: "item_not_built_here" };

  const unitCost = num(link.price);
  const subtotal = Math.round(qty * unitCost * 100) / 100;
  const due = input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? new Date(`${input.dueDate}T00:00:00Z`) : undefined;
  const poNumber = await storage.getNextPONumber();

  const po = await storage.createPurchaseOrder({
    poNumber,
    supplierId: shop.id,
    supplierName: shop.name,
    currency: "USD",
    status: "SENT",
    poStatus: stage,
    confirmedQty: qty,
    sentAt: new Date(nowMs),
    source: "build_tracker",
    subtotal,
    total: subtotal,
    totalItemsOrdered: qty,
    expectedDate: due,
    notes: `Build at ${shop.name}: ${qty} × ${link.sku}`,
  } as any);

  await storage.createPurchaseOrderLine({
    purchaseOrderId: po.id,
    itemId: link.id,
    sku: link.sku,
    itemName: link.name,
    qtyOrdered: qty,
    unitCost,
    lineTotal: subtotal,
  } as any);

  // Finished products started in a contributing stage (in_production/shipped) are
  // "in process" at FX — seed the fx_in_process_qty cache the same way the po-status
  // PATCH does, so the two paths agree (Mark Received later decrements it). Only when
  // contributing; an "ordered"/"confirmed" build isn't in process yet.
  if (link.item_type === "finished_product" && isContributingStage(stage)) {
    await db.execute(sql`
      UPDATE items SET fx_in_process_qty = COALESCE(fx_in_process_qty,0) + ${qty} WHERE id = ${link.id}`);
  }

  return { ok: true, poId: po.id, poNumber: po.poNumber, shopName: shop.name, sku: link.sku };
}
