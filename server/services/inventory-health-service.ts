/**
 * Inventory health / velocity — the measurement layer the audit flagged as the #1
 * missing piece (no turnover, no costed-coverage KPI). READ-ONLY: it reports and
 * flags, it never writes stock. Three numbers that make inventory legible:
 *   - Turnover + days-on-hand (how fast we go through inventory)
 *   - Costed coverage (% of SKUs and % of on-hand value with a real WAC)
 *   - The app-WAC vs QuickBooks inventory gap (carried from the reconciliation)
 *
 * Turnover is reported as a RANGE — against app-WAC inventory AND against QB's booked
 * Inventory Asset — because the ~$125K valuation gap makes a single figure false. It
 * is directional until (a) COGS coverage rises (SKU cost-mapping) and (b) the gap is
 * decomposed and booked. COGS here is QuickBooks' booked Cost of Goods Sold, which is
 * still largely the 35% plug — so treat the magnitude as directional, the trend as real.
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number): number | null => (whole > 0 ? r1((part / whole) * 100) : null);

export interface InventoryHealth {
  inventoryValueApp: number;       // app-WAC valuation
  qbInventory: number | null;      // QB booked Inventory Asset
  valuationGap: number | null;     // app − QB
  annualizedCogs: number | null;   // trailing complete-month COGS, annualized
  trailingMonths: number;
  turnoverApp: number | null;      // annualizedCogs / app inventory
  turnoverQb: number | null;       // annualizedCogs / QB inventory
  dioApp: number | null;           // 365 / turnoverApp (days on hand)
  dioQb: number | null;
  costedSkuPct: number | null;     // % of in-stock SKUs with a real WAC
  costedValuePct: number | null;   // % of on-hand units that are costed
  skusWithStock: number;
  uncostedSkusWithStock: number;
  notes: string[];
}

/** Pure: turnover/DIO + coverage from gathered aggregates. */
export function computeInventoryHealth(input: {
  inventoryValueApp: number; qbInventory: number | null; annualizedCogs: number | null; trailingMonths: number;
  skusWithStock: number; skusCosted: number; unitsWithStock: number; unitsCosted: number;
}): InventoryHealth {
  const { inventoryValueApp, qbInventory, annualizedCogs } = input;
  const turn = (inv: number | null) => (annualizedCogs != null && inv != null && inv > 0 ? r2(annualizedCogs / inv) : null);
  const dio = (t: number | null) => (t != null && t > 0 ? Math.round(365 / t) : null);
  const turnoverApp = turn(inventoryValueApp);
  const turnoverQb = turn(qbInventory);
  const valuationGap = qbInventory != null ? r2(inventoryValueApp - qbInventory) : null;
  const notes: string[] = [
    "Turnover = annualized Cost of Goods Sold ÷ inventory on hand; days-on-hand = 365 ÷ turnover.",
    "Shown as a range (app-WAC vs QuickBooks inventory) because the two valuations differ — the true figure sits between until the gap is decomposed and booked.",
    "COGS is QuickBooks' booked figure (still largely the 35% plug), so treat the magnitude as directional and the month-over-month trend as real. Costed coverage rising toward 90%+ makes it exact.",
  ];
  return {
    inventoryValueApp: r2(inventoryValueApp), qbInventory, valuationGap,
    annualizedCogs, trailingMonths: input.trailingMonths,
    turnoverApp, turnoverQb, dioApp: dio(turnoverApp), dioQb: dio(turnoverQb),
    costedSkuPct: pct(input.skusCosted, input.skusWithStock),
    costedValuePct: pct(input.unitsCosted, input.unitsWithStock),
    skusWithStock: input.skusWithStock,
    uncostedSkusWithStock: input.skusWithStock - input.skusCosted,
    notes,
  };
}

export async function getInventoryHealth(db: DB): Promise<InventoryHealth> {
  // App-WAC valuation + costed coverage (finished = hildale+pivot, components = currentStock).
  const v = rows(await db.execute(sql`
    WITH valued AS (
      SELECT
        CASE WHEN type = 'finished_product'
             THEN coalesce(hildale_qty,0) + coalesce(pivot_qty,0)
             ELSE coalesce(current_stock,0) END AS qty,
        wac_unit_cost AS wac,
        coalesce(wac_unit_cost, default_purchase_cost) AS unit_cost
      FROM items
    )
    SELECT
      round(sum(qty * coalesce(unit_cost,0))::numeric, 2) AS inv_value,
      count(*) FILTER (WHERE qty > 0) AS skus_with_stock,
      count(*) FILTER (WHERE qty > 0 AND wac IS NOT NULL) AS skus_costed,
      coalesce(sum(qty) FILTER (WHERE qty > 0), 0) AS units_with_stock,
      coalesce(sum(qty) FILTER (WHERE qty > 0 AND wac IS NOT NULL), 0) AS units_costed
    FROM valued`))[0] || {};

  const qbRow = rows(await db.execute(sql`
    SELECT qb_inventory FROM qb_financial_snapshots
    WHERE qb_inventory IS NOT NULL ORDER BY captured_at DESC LIMIT 1`))[0] || {};
  const qbInventory = qbRow.qb_inventory != null ? num(qbRow.qb_inventory) : null;

  // Trailing complete-month COGS (QuickBooks Cost of Goods Sold account; excludes outbound
  // freight, which isn't relieved from inventory). Mountain-time month boundary.
  const c = rows(await db.execute(sql`
    SELECT round(sum(amount)::numeric, 2) AS cogs,
           count(DISTINCT date_trunc('month', txn_date)) AS months
    FROM qb_pl_detail
    WHERE account_name ~* 'cost of goods|cogs'
      AND txn_date >= (date_trunc('month', (now() AT TIME ZONE 'America/Denver')) - interval '3 months')
      AND txn_date <  date_trunc('month', (now() AT TIME ZONE 'America/Denver'))`))[0] || {};
  const trailingCogs = num(c.cogs);
  const trailingMonths = num(c.months);
  const annualizedCogs = trailingMonths > 0 ? r2((trailingCogs / trailingMonths) * 12) : null;

  return computeInventoryHealth({
    inventoryValueApp: num(v.inv_value),
    qbInventory,
    annualizedCogs,
    trailingMonths,
    skusWithStock: num(v.skus_with_stock),
    skusCosted: num(v.skus_costed),
    unitsWithStock: num(v.units_with_stock),
    unitsCosted: num(v.units_costed),
  });
}
