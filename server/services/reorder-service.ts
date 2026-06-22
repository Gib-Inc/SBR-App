/**
 * COUNT.M Reorder engine — "what we need this week", per component, per vendor.
 *
 * Component weekly demand is rolled up from finished-product sales velocity
 * (trailing 13 weeks) through the bill of materials (qty × wastage). Against
 * on-hand + on-order, a velocity-based reorder point (lead time + review + safety)
 * tells us what to buy, rounded to the vendor's minimum order qty. groupNeedsBy-
 * Vendor turns it into the per-vendor "weekly needs" list the digest sends.
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

export type Urgency = "STOCKOUT" | "CRITICAL" | "LOW" | "OK";
const URGENCY_RANK: Record<Urgency, number> = { STOCKOUT: 0, CRITICAL: 1, LOW: 2, OK: 3 };

export interface ReorderNeed {
  itemId: string; sku: string; name: string;
  weeklyDemand: number; onHand: number; onOrder: number; weeksCover: number | null;
  leadTimeDays: number; reorderPoint: number; needed: number; suggestedOrderQty: number;
  vendorId: string | null; vendorName: string | null; moq: number; unitCost: number;
  estReorderCost: number; urgency: Urgency;
}

/**
 * Pure reorder math for one component. reorderPoint covers demand over
 * (lead time + 1 review week + 1 safety week); target adds a second safety week.
 * Suggested qty refills to target, floored at MOQ and rounded up to MOQ multiples.
 */
export function reorderLine(input: {
  weeklyDemand: number; onHand: number; onOrder: number; leadTimeDays: number; moq: number;
}): { reorderPoint: number; needed: number; suggestedOrderQty: number; weeksCover: number | null; urgency: Urgency } {
  const demand = Math.max(0, input.weeklyDemand || 0);
  const position = Math.max(0, input.onHand || 0) + Math.max(0, input.onOrder || 0);
  const leadWeeks = Math.max(0, (input.leadTimeDays || 14)) / 7;
  const moq = Math.max(1, input.moq || 1);
  const reorderPoint = Math.ceil(demand * (leadWeeks + 1 + 1));
  const target = Math.ceil(demand * (leadWeeks + 1 + 2));
  const needed = Math.max(0, reorderPoint - position);
  const weeksCover = demand > 0 ? r1(position / demand) : null;
  let suggestedOrderQty = 0;
  if (needed > 0) {
    suggestedOrderQty = Math.max(target - position, moq);
    if (moq > 1) suggestedOrderQty = Math.ceil(suggestedOrderQty / moq) * moq;
  }
  let urgency: Urgency;
  if (demand <= 0) urgency = "OK";
  else if (position <= 0) urgency = "STOCKOUT";
  else if (weeksCover != null && weeksCover < leadWeeks) urgency = "CRITICAL";
  else if (needed > 0) urgency = "LOW";
  else urgency = "OK";
  return { reorderPoint, needed, suggestedOrderQty, weeksCover, urgency };
}

export async function computeReorderNeeds(db: DB): Promise<ReorderNeed[]> {
  const raw = rows(await db.execute(sql`
    WITH fp_velocity AS (
      SELECT sol.product_id AS fp_id,
             sum(GREATEST(sol.qty_ordered - COALESCE(sol.returned_qty,0),0))::numeric / 13.0 AS weekly_units
      FROM sales_order_lines sol JOIN sales_orders so ON so.id=sol.sales_order_id
      WHERE so.order_date >= current_date - interval '91 days'
        AND COALESCE(so.status,'') NOT IN ('CANCELLED','cancelled','canceled','REFUNDED')
        AND sol.product_id IS NOT NULL
      GROUP BY sol.product_id
    ),
    comp_demand AS (
      SELECT b.component_id,
             sum(COALESCE(v.weekly_units,0) * b.quantity_required * (1 + b.wastage_percent/100.0)) AS weekly_demand
      FROM bill_of_materials b LEFT JOIN fp_velocity v ON v.fp_id = b.finished_product_id
      GROUP BY b.component_id
    ),
    on_order AS (
      SELECT pol.item_id, sum(GREATEST(COALESCE(pol.qty_ordered,0),0)) AS on_order_qty
      FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id
      WHERE COALESCE(po.status,'') NOT IN ('RECEIVED','CLOSED','CANCELLED','DRAFT')
      GROUP BY pol.item_id
    ),
    designated AS (
      SELECT DISTINCT ON (si.item_id) si.item_id, si.supplier_id, si.minimum_order_quantity AS moq, si.lead_time_days
      FROM supplier_items si WHERE si.is_designated_supplier ORDER BY si.item_id, si.price NULLS LAST
    )
    SELECT i.id, i.sku, i.name,
      COALESCE(d.weekly_demand,0)::float8 AS weekly_demand,
      (COALESCE(i.current_stock,0)+COALESCE(i.hildale_qty,0))::float8 AS on_hand,
      COALESCE(oo.on_order_qty,0)::float8 AS on_order,
      COALESCE(i.wac_unit_cost,0)::float8 AS unit_cost,
      dg.supplier_id, COALESCE(dg.lead_time_days,14)::float8 AS lead_days,
      COALESCE(dg.moq,0)::float8 AS moq, s.name AS vendor_name
    FROM items i
    LEFT JOIN comp_demand d ON d.component_id=i.id
    LEFT JOIN on_order oo ON oo.item_id=i.id
    LEFT JOIN designated dg ON dg.item_id=i.id
    LEFT JOIN suppliers s ON s.id=dg.supplier_id
    WHERE i.type='component'
  `));

  const out: ReorderNeed[] = raw.map((r: any) => {
    const weeklyDemand = num(r.weekly_demand);
    const onHand = num(r.on_hand);
    const onOrder = num(r.on_order);
    const leadTimeDays = num(r.lead_days) || 14;
    const moq = num(r.moq);
    const unitCost = num(r.unit_cost);
    const calc = reorderLine({ weeklyDemand, onHand, onOrder, leadTimeDays, moq });
    return {
      itemId: r.id, sku: r.sku, name: r.name,
      weeklyDemand: r1(weeklyDemand), onHand, onOrder, weeksCover: calc.weeksCover,
      leadTimeDays, reorderPoint: calc.reorderPoint, needed: calc.needed,
      suggestedOrderQty: calc.suggestedOrderQty,
      vendorId: r.supplier_id ?? null, vendorName: r.vendor_name ?? null,
      moq, unitCost, estReorderCost: Math.round(calc.suggestedOrderQty * unitCost * 100) / 100,
      urgency: calc.urgency,
    };
  });

  return out.sort((a, b) =>
    URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
    (a.weeksCover ?? 9999) - (b.weeksCover ?? 9999));
}

export interface VendorNeeds {
  vendorId: string; vendorName: string;
  lines: ReorderNeed[]; lineCount: number; estCost: number;
  topUrgency: Urgency;
}

/** Group the items that actually need reordering into per-vendor order lists. */
export function groupNeedsByVendor(needs: ReorderNeed[]): VendorNeeds[] {
  const map = new Map<string, VendorNeeds>();
  for (const n of needs.filter((x) => x.needed > 0)) {
    const id = n.vendorId || "UNASSIGNED";
    let v = map.get(id);
    if (!v) {
      v = { vendorId: id, vendorName: n.vendorName || "Unassigned vendor", lines: [], lineCount: 0, estCost: 0, topUrgency: "OK" };
      map.set(id, v);
    }
    v.lines.push(n);
    v.lineCount++;
    v.estCost = Math.round((v.estCost + n.estReorderCost) * 100) / 100;
    if (URGENCY_RANK[n.urgency] < URGENCY_RANK[v.topUrgency]) v.topUrgency = n.urgency;
  }
  return Array.from(map.values()).sort((a, b) =>
    URGENCY_RANK[a.topUrgency] - URGENCY_RANK[b.topUrgency] || b.estCost - a.estCost);
}
