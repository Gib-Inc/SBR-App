#!/usr/bin/env npx tsx
/**
 * backfill-qty-shipped.ts — P0-3 guarded backfill for sales_order_lines.qty_shipped
 * ==================================================================================
 *
 * Context: until Jul 2026 only POST /api/sales-orders/:id/ship wrote accurate
 * per-line qty_shipped. Every other path that landed an order in SHIPPED /
 * DELIVERED (webhooks, Shopify/Amazon syncs, the reconciliation scheduler,
 * manual PATCH) left qty_shipped=0. The durable fix
 * (server/services/fulfillment-line-reconciler.ts) closes that going forward;
 * this script heals the rows already written.
 *
 * What it does:
 *   For every sales_order_lines row whose ORDER is SHIPPED or DELIVERED and
 *   whose qty_shipped = 0, set:
 *       qty_shipped   = qty_ordered
 *       qty_fulfilled = GREATEST(qty_fulfilled, qty_ordered)
 *       backorder_qty = 0        (a shipped order owes nothing)
 *
 *   EXCLUDED from the plan (printed, never written):
 *     (a) lines with returned_qty > 0 — the returned portion makes the
 *         qty_ordered fill wrong; needs human review.
 *     (b) lines whose order has ANY return_requests row (sales_order_id match)
 *         — same reason, at order granularity.
 *     (c) lines with product_id IS NULL — printed to a MANUAL-REVIEW list with
 *         a per-SKU diagnostic of the nightly order-line-resolution-service's
 *         7 exact-match keys (items.sku, shopify_sku, amazon_sku, amazon_asin,
 *         sku stripped of 'SKU: ', sku stripped of leading '#', sku_mappings
 *         alias), showing exactly which keys were tried and why none healed
 *         the line.
 *
 * Why a direct UPDATE is sanctioned here: qty_shipped / qty_fulfilled /
 * backorder_qty are fulfillment BOOKKEEPING fields on sales_order_lines, not
 * stock quantities. The InventoryMovement.apply() gateway governs stock
 * (items.availableForSaleQty / hildaleQty / pivotQty / currentStock) — this
 * script never touches the items table or any stock field.
 *
 * Modes:
 *   DRY-RUN (default) — print the complete per-line plan + exclusions and exit
 *                       WITHOUT writing anything.
 *   --apply           — execute the plan. Each UPDATE re-checks qty_shipped=0
 *                       in its WHERE clause so a concurrent live fill can never
 *                       be decreased or double-applied.
 *   --limit=N         — cap the number of lines planned/applied (default: all).
 *
 * Required environment variables:
 *   DATABASE_URL — Railway PostgreSQL connection string
 *
 * Usage:
 *   npx tsx scripts/backfill-qty-shipped.ts             (dry-run, read-only)
 *   npx tsx scripts/backfill-qty-shipped.ts --apply     (writes!)
 */

import pg from "pg";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Math.max(0, parseInt(limitArg.slice("--limit=".length), 10) || 0) : 0;

function banner(): void {
  const line = "═".repeat(74);
  console.log("");
  console.log(line);
  if (APPLY) {
    console.log("  ███  BACKFILL-QTY-SHIPPED — APPLY MODE (WRITES ENABLED)  ███");
    console.log("  Every PLAN line below WILL be written to sales_order_lines.");
  } else {
    console.log("  BACKFILL-QTY-SHIPPED — DRY RUN (read-only, NO writes)");
    console.log("  This prints the complete plan and exits. Pass --apply to execute.");
  }
  if (LIMIT > 0) console.log(`  Line limit: ${LIMIT}`);
  console.log(line);
  console.log("");
}

function pad(value: unknown, width: number, align: "left" | "right" = "left"): string {
  const s = String(value ?? "");
  if (s.length >= width) return s;
  const fill = " ".repeat(width - s.length);
  return align === "right" ? fill + s : s + fill;
}

interface CandidateRow {
  order_id: string;
  external_order_id: string | null;
  channel: string | null;
  status: string;
  order_date: string | null;
  line_id: string;
  sku: string;
  qty_ordered: number;
  qty_shipped: number;
  qty_fulfilled: number;
  backorder_qty: number;
  returned_qty: number;
  product_id: string | null;
  has_return_request: boolean;
}

/** The 7 exact-match keys the nightly order-line-resolution-service tries, in
 *  its priority order (see server/services/order-line-resolution-service.ts). */
const RESOLUTION_KEYS: Array<{ label: string; sql: string }> = [
  { label: "1 items.sku exact", sql: `SELECT count(*)::int AS n FROM items i WHERE i.sku = $1` },
  { label: "2 items.shopify_sku", sql: `SELECT count(*)::int AS n FROM items i WHERE i.shopify_sku = $1` },
  { label: "3 items.amazon_sku", sql: `SELECT count(*)::int AS n FROM items i WHERE i.amazon_sku = $1` },
  { label: "4 items.amazon_asin", sql: `SELECT count(*)::int AS n FROM items i WHERE i.amazon_asin = $1` },
  { label: "5 sku strip 'SKU: '", sql: `SELECT count(*)::int AS n FROM items i WHERE i.sku = regexp_replace($1, '^SKU:\\s*', '', 'i')` },
  { label: "6 sku strip '#'", sql: `SELECT count(*)::int AS n FROM items i WHERE i.sku = regexp_replace($1, '^#', '')` },
  { label: "7 sku_mappings alias", sql: `SELECT count(*)::int AS n FROM sku_mappings m JOIN items i ON i.sku = m.canonical_sku WHERE m.external_sku = $1` },
];

async function main(): Promise<void> {
  banner();

  if (!process.env.DATABASE_URL) {
    console.error("❌ Missing required environment variable: DATABASE_URL");
    process.exit(1);
  }

  // Same pool style as the other repo scripts; the no-op error handler keeps a
  // dropped idle connection from crashing the whole process.
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  pool.on("error", () => {});

  try {
    // ── 1. Candidates: SHIPPED/DELIVERED orders with unfilled lines ─────────
    const candidatesRes = await pool.query(
      `SELECT so.id AS order_id,
              so.external_order_id,
              so.channel,
              upper(coalesce(so.status,'')) AS status,
              so.order_date::text AS order_date,
              l.id AS line_id,
              l.sku,
              coalesce(l.qty_ordered, 0)::int   AS qty_ordered,
              coalesce(l.qty_shipped, 0)::int   AS qty_shipped,
              coalesce(l.qty_fulfilled, 0)::int AS qty_fulfilled,
              coalesce(l.backorder_qty, 0)::int AS backorder_qty,
              coalesce(l.returned_qty, 0)::int  AS returned_qty,
              l.product_id,
              EXISTS (
                SELECT 1 FROM return_requests rr WHERE rr.sales_order_id = so.id
              ) AS has_return_request
       FROM sales_order_lines l
       JOIN sales_orders so ON so.id = l.sales_order_id
       WHERE upper(coalesce(so.status,'')) IN ('SHIPPED','DELIVERED')
         AND coalesce(l.qty_shipped, 0) = 0
         AND coalesce(l.qty_ordered, 0) > 0
       ORDER BY so.order_date NULLS LAST, so.id, l.id`,
    );
    const candidates: CandidateRow[] = candidatesRes.rows;

    const plan: CandidateRow[] = [];
    const excludedReturnedQty: CandidateRow[] = [];
    const excludedReturnRequest: CandidateRow[] = [];
    const manualReviewNullProduct: CandidateRow[] = [];

    for (const row of candidates) {
      if (row.returned_qty > 0) {
        excludedReturnedQty.push(row);
      } else if (row.has_return_request) {
        excludedReturnRequest.push(row);
      } else if (row.product_id === null) {
        manualReviewNullProduct.push(row);
      } else if (LIMIT === 0 || plan.length < LIMIT) {
        plan.push(row);
      }
    }

    console.log(`Scanned ${candidates.length} unfilled line(s) on SHIPPED/DELIVERED orders.`);
    console.log(`  PLAN (fill):                   ${plan.length}`);
    console.log(`  EXCLUDED returned_qty > 0:     ${excludedReturnedQty.length}`);
    console.log(`  EXCLUDED order has return_req: ${excludedReturnRequest.length}`);
    console.log(`  MANUAL REVIEW product_id NULL: ${manualReviewNullProduct.length}`);
    console.log("");

    // ── 2. Per-line plan ────────────────────────────────────────────────────
    if (plan.length > 0) {
      console.log("── PLAN — one line per row that will be written ──");
      console.log(
        `${pad("channel", 8)} ${pad("order", 22)} ${pad("status", 10)} ${pad("sku", 26)} ` +
        `${pad("ordered", 7, "right")}  ${pad("shipped", 14)} ${pad("fulfilled", 14)} backorder`,
      );
      for (const row of plan) {
        const newFulfilled = Math.max(row.qty_fulfilled, row.qty_ordered);
        console.log(
          `${pad(row.channel ?? "?", 8)} ${pad(row.external_order_id ?? row.order_id, 22)} ` +
          `${pad(row.status, 10)} ${pad(row.sku, 26)} ${pad(row.qty_ordered, 7, "right")}  ` +
          `${pad(`${row.qty_shipped} → ${row.qty_ordered}`, 14)} ` +
          `${pad(`${row.qty_fulfilled} → ${newFulfilled}`, 14)} ` +
          `${row.backorder_qty} → 0`,
        );
      }
      console.log("");
    }

    // ── 3. Exclusion lists (stated, never written) ──────────────────────────
    const printExclusions = (title: string, rows: CandidateRow[], reason: string) => {
      if (!rows.length) return;
      console.log(`── EXCLUDED — ${title} (${rows.length} line(s), NOT written) ──`);
      for (const row of rows) {
        console.log(
          `  ${pad(row.channel ?? "?", 8)} ${pad(row.external_order_id ?? row.order_id, 22)} ` +
          `${pad(row.sku, 26)} ordered=${row.qty_ordered} returned=${row.returned_qty} — ${reason}`,
        );
      }
      console.log("");
    };
    printExclusions(
      "returned_qty > 0",
      excludedReturnedQty,
      "returned units make the qty_ordered fill wrong; review manually",
    );
    printExclusions(
      "order has return_requests row",
      excludedReturnRequest,
      "order-level return in flight; review manually",
    );

    // ── 4. Manual-review list for product_id NULL lines, with the reason the
    //       nightly order-line-resolution-service didn't heal them ───────────
    if (manualReviewNullProduct.length > 0) {
      console.log(
        `── MANUAL REVIEW — product_id NULL (${manualReviewNullProduct.length} line(s), NOT written) ──`,
      );
      console.log(
        "These lines never resolved to a catalog item, so their fulfillment state",
        "cannot be trusted programmatically. Per distinct SKU, the nightly",
        "order-line-resolution-service's 7 exact-match keys were re-tried below —",
        "a key with 0 matches is WHY the nightly run could not heal it.",
      );
      console.log("");

      const skus = Array.from(new Set(manualReviewNullProduct.map((r) => r.sku)));
      for (const sku of skus) {
        const rows = manualReviewNullProduct.filter((r) => r.sku === sku);
        const orders = Array.from(new Set(rows.map((r) => r.external_order_id ?? r.order_id)));
        console.log(`  SKU ${JSON.stringify(sku)} — ${rows.length} line(s) across order(s): ${orders.join(", ")}`);
        for (const key of RESOLUTION_KEYS) {
          const res = await pool.query(key.sql, [sku]);
          const n = Number(res.rows?.[0]?.n ?? 0);
          console.log(
            `    key ${pad(key.label, 22)} → ${n === 0 ? "no match" : `${n} match(es) — WOULD heal on next nightly run; excluded here anyway (product_id still NULL)`}`,
          );
        }
      }
      console.log("");
    }

    // ── 5. Apply (or stop) ──────────────────────────────────────────────────
    if (!APPLY) {
      console.log("DRY RUN complete — nothing was written. Re-run with --apply to execute the plan.");
      return;
    }

    if (plan.length === 0) {
      console.log("APPLY: plan is empty — nothing to write.");
      return;
    }

    console.log(`APPLY: writing ${plan.length} line(s)...`);
    let written = 0;
    let skippedRace = 0;
    for (const row of plan) {
      // Guard re-checked in the WHERE clause: if a live transition filled the
      // line between the scan and this write, do nothing (never decrease,
      // never double-apply).
      const upd = await pool.query(
        `UPDATE sales_order_lines
         SET qty_shipped   = qty_ordered,
             qty_fulfilled = GREATEST(coalesce(qty_fulfilled, 0), qty_ordered),
             backorder_qty = 0
         WHERE id = $1
           AND coalesce(qty_shipped, 0) = 0
           AND coalesce(returned_qty, 0) = 0
         RETURNING id`,
        [row.line_id],
      );
      if ((upd.rowCount ?? 0) > 0) {
        written++;
        console.log(
          `  ✓ ${pad(row.external_order_id ?? row.order_id, 22)} ${pad(row.sku, 26)} ` +
          `qty_shipped 0 → ${row.qty_ordered}`,
        );
      } else {
        skippedRace++;
        console.log(
          `  – ${pad(row.external_order_id ?? row.order_id, 22)} ${pad(row.sku, 26)} ` +
          `skipped (already filled or returned since scan)`,
        );
      }
    }
    console.log("");
    console.log(`APPLY complete: ${written} line(s) written, ${skippedRace} skipped by the re-check guard.`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("❌ backfill-qty-shipped failed:", err);
  process.exit(1);
});
