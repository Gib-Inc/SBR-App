/**
 * C5 — Order-line → item resolution (the COGS join self-heal).
 *
 * ~60% of sales_order_lines carried product_id NULL (measured Jul 2026: 3,085
 * lines / $1.21M of line revenue) even though 98% of them match an items row by
 * an EXACT unique key — mostly the plain house SKU. Root cause: the historical
 * import never attempted the join, and live orders can arrive before their item
 * exists in the catalog (the join is only tried at write time). Every NULL line
 * is invisible to COGS/contribution math, which is why COGS coverage read ~33%.
 *
 * This service re-joins unmapped lines deterministically and is safe to run any
 * time (idempotent; only touches rows where product_id IS NULL; never overwrites
 * an existing link; writes ONLY the product_id foreign key — no quantities, no
 * inventory movements, no stock effects).
 *
 * Match priority (all unique-indexed on items, prod-verified ZERO ambiguity):
 *   1. exact house sku            2. shopify_sku          3. amazon_sku
 *   4. amazon_asin                5. house sku after stripping a "SKU: " prefix
 *   6. house sku after stripping a leading "#" (legacy duplicate-SKU prefix)
 *   7. sku_mappings alias → canonical house sku
 */
import { sql } from "drizzle-orm";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export interface OrderLineResolutionResult {
  resolved: number;   // lines that gained a product_id this run
  remaining: number;  // lines still NULL after the run (genuinely unmappable SKUs)
}

export async function resolveUnmappedOrderLines(db: any): Promise<OrderLineResolutionResult> {
  const upd = await db.execute(sql`
    WITH cand AS (
      SELECT l.id AS line_id, r.item_id
      FROM sales_order_lines l
      CROSS JOIN LATERAL (
        SELECT item_id FROM (
          SELECT i.id AS item_id, 1 AS pri FROM items i WHERE i.sku = l.sku
          UNION ALL SELECT i.id, 2 FROM items i WHERE i.shopify_sku = l.sku
          UNION ALL SELECT i.id, 3 FROM items i WHERE i.amazon_sku = l.sku
          UNION ALL SELECT i.id, 4 FROM items i WHERE i.amazon_asin = l.sku
          UNION ALL SELECT i.id, 5 FROM items i WHERE i.sku = regexp_replace(l.sku, '^SKU:\\s*', '', 'i')
          UNION ALL SELECT i.id, 6 FROM items i WHERE i.sku = regexp_replace(l.sku, '^#', '')
          UNION ALL SELECT i.id, 7 FROM sku_mappings m JOIN items i ON i.sku = m.canonical_sku
                     WHERE m.external_sku = l.sku
        ) x ORDER BY pri LIMIT 1
      ) r
      WHERE l.product_id IS NULL
    )
    UPDATE sales_order_lines l SET product_id = c.item_id
    FROM cand c WHERE l.id = c.line_id
    RETURNING l.id`);
  const resolved = rows(upd).length;

  const rem = rows(await db.execute(sql`
    SELECT count(*)::int AS remaining FROM sales_order_lines WHERE product_id IS NULL`))[0];
  const remaining = Number(rem?.remaining ?? 0);

  if (resolved > 0) {
    console.log(`[OrderLineResolution] re-joined ${resolved} order lines to items (${remaining} still unmappable)`);
  }
  return { resolved, remaining };
}
