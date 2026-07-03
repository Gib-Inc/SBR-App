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

export interface InventoryHealthBase {
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

// MEAS-3 additions — read-only analytics layered on top of the health base.
export interface AbcClass { skus: number; value: number; }        // A/B/C by on-hand $
export interface InventoryAging {
  onHandValue: number;             // finished-goods on-hand value (app-WAC)
  deadValue: number;               // value of never-sold or >180d-since-sale finished goods
  deadSkus: number;
  buckets: { d0_30: number; d31_90: number; d91_180: number; d180plus: number; never: number };
}
export interface InventoryGmroi {
  annualizedGrossProfit: number | null;
  gmroiApp: number | null;         // annualized gross profit ÷ app-WAC inventory
  gmroiQb: number | null;          // annualized gross profit ÷ QB inventory
}
export interface InventoryHealth extends InventoryHealthBase {
  abc: { a: AbcClass; b: AbcClass; c: AbcClass };  // where the inventory dollars sit
  agingFinished: InventoryAging;   // staleness from real sales-order history
  gmroi: InventoryGmroi;           // gross-margin return on inventory investment
}

/** Pure: turnover/DIO + coverage from gathered aggregates. */
export function computeInventoryHealth(input: {
  inventoryValueApp: number; qbInventory: number | null; annualizedCogs: number | null; trailingMonths: number;
  skusWithStock: number; skusCosted: number; unitsWithStock: number; unitsCosted: number;
}): InventoryHealthBase {
  const { inventoryValueApp, qbInventory, annualizedCogs } = input;
  const turn = (inv: number | null) => (annualizedCogs != null && inv != null && inv > 0 ? r2(annualizedCogs / inv) : null);
  const dio = (t: number | null) => (t != null && t > 0 ? Math.round(365 / t) : null);
  const turnoverApp = turn(inventoryValueApp);
  const turnoverQb = turn(qbInventory);
  const valuationGap = qbInventory != null ? r2(inventoryValueApp - qbInventory) : null;
  const notes: string[] = [
    "Turnover = annualized Cost of Goods Sold ÷ inventory on hand; days-on-hand = 365 ÷ turnover.",
    "QuickBooks' booked Inventory Asset is the authoritative value; the app-WAC figure OVER-values it because it double-counts BOM component cost into finished goods (a finished-good WAC already includes its components, then raw components are counted again). Trust the QuickBooks end, not a midpoint.",
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

/** The QuickBooks booked Inventory Asset (latest snapshot) — the AUTHORITATIVE inventory dollar
 *  value. The app's per-item WAC OVER-values it (a finished-good WAC already rolls up its BOM
 *  component cost, then raw components are counted AGAIN → ~2x), so QuickBooks is the source of
 *  truth. Returns null when no snapshot exists (FLAG-DON'T-FABRICATE). */
export async function getQbInventoryAsset(db: DB): Promise<number | null> {
  const r = rows(await db.execute(sql`
    SELECT qb_inventory FROM qb_financial_snapshots
    WHERE qb_inventory IS NOT NULL ORDER BY captured_at DESC LIMIT 1`))[0] || {};
  return r?.qb_inventory != null ? num(r.qb_inventory) : null;
}

/** ONE inventory-value source for every headline surface (dashboard, system stats): prefer the
 *  QuickBooks booked Inventory Asset; fall back to a LABELED operational WAC estimate only when no
 *  QB snapshot exists — never the old $10/unit mock or a current_stock×default_cost partial. */
export async function getInventoryValue(db: DB): Promise<{
  value: number | null; source: "quickbooks" | "estimate" | null; qbInventory: number | null; wacEstimate: number | null;
}> {
  const qbInventory = await getQbInventoryAsset(db);
  const est = rows(await db.execute(sql`
    SELECT round(sum(
      (CASE WHEN type = 'finished_product' THEN coalesce(hildale_qty,0) + coalesce(pivot_qty,0)
            ELSE coalesce(current_stock,0) END)
      * coalesce(wac_unit_cost, default_purchase_cost, 0))::numeric, 2) AS v
    FROM items`))[0] || {};
  const wacEstimate = est?.v != null ? num(est.v) : null;
  const value = qbInventory ?? wacEstimate;
  const source: "quickbooks" | "estimate" | null = qbInventory != null ? "quickbooks" : wacEstimate != null ? "estimate" : null;
  return { value, source, qbInventory, wacEstimate };
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

  const qbInventory = await getQbInventoryAsset(db);

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

  const base = computeInventoryHealth({
    inventoryValueApp: num(v.inv_value),
    qbInventory,
    annualizedCogs,
    trailingMonths,
    skusWithStock: num(v.skus_with_stock),
    skusCosted: num(v.skus_costed),
    unitsWithStock: num(v.units_with_stock),
    unitsCosted: num(v.units_costed),
  });

  // MEAS-3: ABC by on-hand value (Pareto — where the inventory dollars sit, for
  // cycle-count prioritization). A = SKUs up to 80% of cumulative value, B = next
  // 15%, C = last 5%. All stock-holding SKUs (finished + components) at app-WAC.
  const abcRows = rows(await db.execute(sql`
    WITH valued AS (
      SELECT
        (CASE WHEN type = 'finished_product'
              THEN coalesce(hildale_qty,0) + coalesce(pivot_qty,0)
              ELSE coalesce(current_stock,0) END)
        * coalesce(wac_unit_cost, default_purchase_cost, 0) AS val
      FROM items
      WHERE type IN ('finished_product','component')
    ),
    stocked AS (SELECT val FROM valued WHERE val > 0),
    ranked AS (
      SELECT val,
             sum(val) OVER (ORDER BY val DESC) AS cum,
             sum(val) OVER () AS total
      FROM stocked
    )
    SELECT
      CASE WHEN total <= 0 THEN 'c'
           WHEN cum <= 0.80 * total THEN 'a'
           WHEN cum <= 0.95 * total THEN 'b'
           ELSE 'c' END AS class,
      count(*)::int AS skus,
      round(sum(val)::numeric, 2) AS value
    FROM ranked
    GROUP BY 1`));
  const abcClass = (k: string): AbcClass => {
    const r = abcRows.find((x: any) => x.class === k);
    return { skus: num(r?.skus), value: num(r?.value) };
  };
  const abc = { a: abcClass("a"), b: abcClass("b"), c: abcClass("c") };

  // MEAS-3: finished-goods aging + dead stock from REAL sales-order history
  // (sales_orders.order_date), NOT the ~30-day audit-log window which would flag
  // almost everything as dead. Dead = never sold (with stock) or >180 days since
  // last sale. Components excluded — they are consumed in builds, not sold.
  const ageRow = rows(await db.execute(sql`
    WITH fg AS (
      SELECT id,
             coalesce(hildale_qty,0) + coalesce(pivot_qty,0) AS qty,
             coalesce(wac_unit_cost, default_purchase_cost, 0) AS uc
      FROM items WHERE type = 'finished_product'
    ),
    last_sale AS (
      SELECT sol.product_id, max(so.order_date) AS last_sale_at
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.sales_order_id
      WHERE upper(coalesce(so.status,'')) NOT IN ('CANCELLED','REFUNDED')
        AND sol.product_id IS NOT NULL
      GROUP BY sol.product_id
    ),
    aged AS (
      SELECT fg.qty * fg.uc AS val,
        CASE WHEN ls.last_sale_at IS NULL THEN 'never'
             WHEN ls.last_sale_at >= now() - interval '30 days' THEN 'd0_30'
             WHEN ls.last_sale_at >= now() - interval '90 days' THEN 'd31_90'
             WHEN ls.last_sale_at >= now() - interval '180 days' THEN 'd91_180'
             ELSE 'd180plus' END AS bucket
      FROM fg LEFT JOIN last_sale ls ON ls.product_id = fg.id
      WHERE fg.qty > 0
    )
    SELECT
      round(sum(val)::numeric, 2) AS on_hand_value,
      round(sum(val) FILTER (WHERE bucket IN ('never','d180plus'))::numeric, 2) AS dead_value,
      count(*) FILTER (WHERE bucket IN ('never','d180plus'))::int AS dead_skus,
      count(*) FILTER (WHERE bucket = 'd0_30')::int AS d0_30,
      count(*) FILTER (WHERE bucket = 'd31_90')::int AS d31_90,
      count(*) FILTER (WHERE bucket = 'd91_180')::int AS d91_180,
      count(*) FILTER (WHERE bucket = 'd180plus')::int AS d180plus,
      count(*) FILTER (WHERE bucket = 'never')::int AS never
    FROM aged`))[0] || {};
  const agingFinished: InventoryAging = {
    onHandValue: num(ageRow.on_hand_value),
    deadValue: num(ageRow.dead_value),
    deadSkus: num(ageRow.dead_skus),
    buckets: {
      d0_30: num(ageRow.d0_30), d31_90: num(ageRow.d31_90), d91_180: num(ageRow.d91_180),
      d180plus: num(ageRow.d180plus), never: num(ageRow.never),
    },
  };

  // MEAS-3: GMROI = annualized gross margin ÷ average inventory at cost. Gross
  // profit comes from historical_monthly_sales (the reconciled trailing months);
  // reported as a range against app-WAC and QB inventory, and directional because
  // COGS is still largely the 35% plug (same caveat as turnover).
  const gp = rows(await db.execute(sql`
    SELECT round((sum(gross_profit) / nullif(count(*),0) * 12)::numeric, 2) AS annualized_gp
    FROM historical_monthly_sales
    WHERE (year * 100 + month) < to_char((now() AT TIME ZONE 'America/Denver'), 'YYYYMM')::int
      AND (year * 100 + month) >= to_char((now() AT TIME ZONE 'America/Denver') - interval '3 months', 'YYYYMM')::int`))[0] || {};
  const annualizedGrossProfit = gp?.annualized_gp != null ? num(gp.annualized_gp) : null;
  const gmroiOf = (inv: number | null): number | null =>
    annualizedGrossProfit != null && inv != null && inv > 0 ? r2(annualizedGrossProfit / inv) : null;
  const gmroi: InventoryGmroi = {
    annualizedGrossProfit,
    gmroiApp: gmroiOf(base.inventoryValueApp),
    gmroiQb: gmroiOf(qbInventory),
  };

  return {
    ...base,
    abc,
    agingFinished,
    gmroi,
    notes: [
      ...base.notes,
      "ABC is by on-hand dollar value (Pareto): A = the SKUs holding the first 80% of inventory value, B = the next 15%, C = the last 5% — count the A items first.",
      "Aging and dead stock use real sales-order history (last order date), and cover finished goods only; components move by consumption, not sale.",
      "GMROI = annualized gross margin ÷ inventory at cost; directional while COGS is the 35% plug, and a range because the app over-values inventory vs QuickBooks.",
    ],
  };
}
