/**
 * CIPH.R Per-SKU Product Profitability — what Katana's dashboard pretends to show
 * but can't, because Katana never books component cost (it reports ~96% margin on
 * a 35%-COGS business). We have the real BOM, so we compute the truth:
 *
 *   unit COGS = Σ over the bill of materials ( qty_required × (1 + wastage%) × component WAC )
 *   gross profit = revenue − units × unit COGS
 *
 * Build cost is computed LIVE from the current BOM and current component WAC, so
 * it reflects every BOM/cost correction (e.g. the Bigfoot screen 2→3 fix). For
 * products without a BOM (refurbs, parts, gift cards) it falls back to the item's
 * own WAC — which is exactly how the money-losers (a refurb selling below its
 * acquisition cost) surface as negative margin.
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ProductProfit {
  productId: string; sku: string; name: string; type: string;
  units: number; revenue: number; unitCost: number; cogs: number;
  grossProfit: number; marginPct: number | null; hasBom: boolean; costed: boolean;
}

export interface ProfitSummary {
  products: number; revenue: number; cogs: number; grossProfit: number;
  blendedMarginPct: number | null; negativeMarginCount: number; lowMarginCount: number;
  uncostedCount: number; since: string;
}

/** Pure gross-profit + margin helper. */
export function margin(revenue: number, cogs: number): { grossProfit: number; marginPct: number | null } {
  const gp = r2(revenue - cogs);
  return { grossProfit: gp, marginPct: revenue > 0 ? r1((gp / revenue) * 100) : null };
}

export async function computeProductProfitability(
  db: DB,
  opts: { since?: string; days?: number } = {},
): Promise<{ rows: ProductProfit[]; summary: ProfitSummary }> {
  // Period: explicit since, else trailing `days`, else YTD-2026 (matches COGS report).
  const since = opts.since
    ? opts.since
    : opts.days && opts.days > 0
      ? new Date(Date.now() - opts.days * 86400000).toISOString().slice(0, 10)
      : "2026-01-01";

  const raw = rows(await db.execute(sql`
    WITH build_cost AS (
      SELECT b.finished_product_id AS pid,
             sum(b.quantity_required * (1 + COALESCE(b.wastage_percent,0)/100.0) * COALESCE(c.wac_unit_cost,0)) AS unit_cogs
      FROM bill_of_materials b JOIN items c ON c.id = b.component_id
      GROUP BY b.finished_product_id
    ),
    sales AS (
      SELECT sol.product_id AS pid,
             sum(GREATEST(sol.qty_ordered - COALESCE(sol.returned_qty,0),0))::numeric AS units,
             sum(GREATEST(sol.qty_ordered - COALESCE(sol.returned_qty,0),0) * COALESCE(sol.unit_price,0))::numeric AS revenue
      FROM sales_order_lines sol JOIN sales_orders so ON so.id = sol.sales_order_id
      WHERE (so.order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date >= ${since}::date
        AND COALESCE(so.status,'') NOT IN ('CANCELLED','cancelled','canceled','REFUNDED')
        AND sol.product_id IS NOT NULL
      GROUP BY sol.product_id
    )
    SELECT i.id, i.sku, i.name, i.type,
           s.units::float8 AS units, s.revenue::float8 AS revenue,
           COALESCE(bc.unit_cogs, i.wac_unit_cost, 0)::float8 AS unit_cogs,
           (bc.pid IS NOT NULL) AS has_bom,
           (bc.unit_cogs IS NOT NULL OR i.wac_unit_cost IS NOT NULL) AS costed
    FROM sales s
    JOIN items i ON i.id = s.pid
    LEFT JOIN build_cost bc ON bc.pid = i.id
    WHERE s.units > 0
  `));

  const out: ProductProfit[] = raw.map((r: any) => {
    const units = num(r.units);
    const revenue = r2(num(r.revenue));
    const unitCost = r2(num(r.unit_cogs));
    const cogs = r2(units * unitCost);
    const m = margin(revenue, cogs);
    return {
      productId: r.id, sku: r.sku, name: r.name, type: r.type,
      units: r1(units), revenue, unitCost, cogs,
      grossProfit: m.grossProfit, marginPct: m.marginPct,
      hasBom: !!r.has_bom, costed: !!r.costed,
    };
  });

  const totalRev = r2(out.reduce((s, p) => s + p.revenue, 0));
  const totalCogs = r2(out.reduce((s, p) => s + p.cogs, 0));
  const tm = margin(totalRev, totalCogs);
  const summary: ProfitSummary = {
    products: out.length,
    revenue: totalRev, cogs: totalCogs, grossProfit: tm.grossProfit,
    blendedMarginPct: tm.marginPct,
    negativeMarginCount: out.filter((p) => p.marginPct != null && p.marginPct < 0).length,
    lowMarginCount: out.filter((p) => p.marginPct != null && p.marginPct >= 0 && p.marginPct < 15).length,
    uncostedCount: out.filter((p) => !p.costed || p.unitCost === 0).length,
    since,
  };

  // Money-losers first (most negative margin), then biggest profit contributors.
  out.sort((a, b) => {
    const an = a.marginPct != null && a.marginPct < 0;
    const bn = b.marginPct != null && b.marginPct < 0;
    if (an && bn) return a.grossProfit - b.grossProfit; // most-negative first
    if (an) return -1;
    if (bn) return 1;
    return b.grossProfit - a.grossProfit;
  });

  return { rows: out, summary };
}
