/**
 * QB Demand Diagnostic — one-shot, read-only-into-QB probe.
 *
 * The reorder engine only sees ~4.5 months of app sales (Shopify/Amazon since
 * Feb 2026). QuickBooks is the standing system of record for revenue and could
 * hold years more. The sales-history pipeline (quickbooks-client.syncDemandHistory)
 * was built but never run. This runs it ONCE and writes a human-readable summary
 * to system_logs (code QB_DEMAND_DIAGNOSTIC) so we can answer, with real data:
 *   - Does QB actually carry item-level sales history, and how far back?
 *   - What do the QB item NAMES look like (the key to mapping QB ItemId -> house SKU)?
 *   - How many QB items already name-match a house item?
 *
 * It does NOT wire QB into reorder. It only reveals what's there so we can decide.
 * Self-guards to a single run (skips once quickbooks_demand_history is populated).
 *
 * CAVEAT surfaced in the summary: the underlying fetch uses MAXRESULTS 1000 with
 * no pagination, so a high-volume QB file is sampled (most-recent 1000 docs), not
 * exhaustively pulled. Enough to characterize the data; not a full backfill.
 */
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { QuickBooksClient } from "./quickbooks-client";

const rows = (r: any) => r.rows || r;

export async function runQbDemandDiagnostic(opts: { force?: boolean } = {}): Promise<void> {
  try {
    const existing = Number(rows(await db.execute(sql`SELECT count(*)::int AS n FROM quickbooks_demand_history`))[0]?.n ?? 0);
    if (existing > 0 && !opts.force) {
      console.log(`[QB-Diag] demand history already has ${existing} rows — skipping diagnostic.`);
      return;
    }

    const qbUserId = await storage.getConnectedQuickbooksUserId();
    if (!qbUserId) {
      await logDiag("QB_DEMAND_DIAGNOSTIC_SKIP", "WARN", "No connected QuickBooks user — cannot run demand sync.", {});
      return;
    }

    console.log("[QB-Diag] Running 3-year demand-history sync (one-shot diagnostic)…");
    const client = new QuickBooksClient(storage, qbUserId);
    const demand = await client.syncDemandHistory(3);
    const snapshots = await client.syncSalesSnapshots(3).catch((e: any) => ({ success: false, message: String(e?.message ?? e) }));

    // What actually landed.
    const summary = rows(await db.execute(sql`
      SELECT count(*)::int AS rows,
             count(DISTINCT quickbooks_item_id)::int AS distinct_qb_items,
             min(year * 100 + month)::int AS min_ym,
             max(year * 100 + month)::int AS max_ym,
             count(DISTINCT (year * 100 + month))::int AS distinct_months,
             COALESCE(sum(qty_sold), 0)::int AS total_sold,
             COALESCE(sum(qty_returned), 0)::int AS total_returned,
             COALESCE(sum(net_qty), 0)::int AS total_net,
             round(COALESCE(sum(revenue), 0)::numeric, 2) AS total_revenue
      FROM quickbooks_demand_history`))[0] ?? {};

    // Top QB items by net qty — the list we'll eyeball to map QB item -> house SKU.
    const topItems = rows(await db.execute(sql`
      SELECT quickbooks_item_id, product_name, sku,
             COALESCE(sum(net_qty), 0)::int AS net_qty,
             count(DISTINCT (year * 100 + month))::int AS months_present,
             min(year * 100 + month)::int AS first_ym,
             max(year * 100 + month)::int AS last_ym
      FROM quickbooks_demand_history
      GROUP BY quickbooks_item_id, product_name, sku
      ORDER BY net_qty DESC
      LIMIT 50`));

    // How many QB items already match a house item by name (auto-map feasibility).
    const matched = Number(rows(await db.execute(sql`
      SELECT count(DISTINCT d.quickbooks_item_id)::int AS n
      FROM quickbooks_demand_history d
      JOIN items i ON lower(trim(i.name)) = lower(trim(d.product_name))`))[0]?.n ?? 0);

    const sevOk = demand?.success;
    await logDiag(
      "QB_DEMAND_DIAGNOSTIC",
      sevOk ? "INFO" : "WARN",
      `QB demand diagnostic: ${demand?.message ?? "no result"}. Snapshots: ${(snapshots as any)?.message ?? "n/a"}. ` +
        `${(summary as any).rows ?? 0} rows / ${(summary as any).distinct_qb_items ?? 0} QB items, ` +
        `range ${(summary as any).min_ym ?? "-"}..${(summary as any).max_ym ?? "-"}, ` +
        `${matched} QB items name-match a house product.`,
      {
        ranAt: new Date().toISOString(),
        demand,
        snapshots,
        summary,
        matchedQbItemsByName: matched,
        truncationCaveat: "fetchSalesHistory uses MAXRESULTS 1000 with no pagination — high-volume QB files are sampled (most-recent ~1000 Invoices + ~1000 SalesReceipts), not exhaustively pulled.",
        topItems,
      },
    );
    console.log(`[QB-Diag] done: ${(summary as any).rows ?? 0} rows, ${(summary as any).distinct_qb_items ?? 0} QB items, ${matched} name-matched.`);
  } catch (e: any) {
    await logDiag("QB_DEMAND_DIAGNOSTIC_ERROR", "ERROR", `QB demand diagnostic failed: ${e?.message ?? e}`, {});
    console.error("[QB-Diag] failed:", e?.message ?? e);
  }
}

async function logDiag(code: string, severity: string, message: string, details: any): Promise<void> {
  await storage
    .createSystemLog({ type: "QB_DIAGNOSTIC", severity, code, message, details } as any)
    .catch(() => {});
}
