#!/usr/bin/env npx tsx
/**
 * INCIDENT-2026-07-REPEAT-DECREMENT — damage quantifier + gated true-up
 * =====================================================================
 *
 * Context: through early July 2026, replay-prone ingest paths (webhook
 * redelivery, sync + webhook double-ingest, backfills) could fire
 * SALES_ORDER_CREATED through InventoryMovement.apply() more than once for the
 * same order, decrementing availableForSaleQty repeatedly. The idempotency
 * ledger (atomic claim+write, commit e969e82) closes the hole going forward;
 * this script quantifies the damage already done and proposes the restoration.
 *
 * What it does:
 *   1. DAMAGE ESTIMATE (read-only): finds orders whose SALES_ORDER_CREATED
 *      audit rows fired more than once in the last 30 days and sums
 *      extra_fires × qty_ordered per item. This is an UPPER BOUND — see the
 *      caveats printed with the table. Also runs the BOM repeat check.
 *   2. DRIFT CROSS-CHECK (read-only): replicates the repo-root
 *      inventory-drift-report.js computation (drift = available_for_sale_qty −
 *      pivot_qty for finished products) and prints a per-SKU reconciliation
 *      note where the audit estimate and the observed drift disagree.
 *   3. TRUE-UP PLAN: prints one PROPOSED line per damaged SKU — restore
 *      over-decremented units to availableForSaleQty (finished products) or
 *      currentStock (components) via InventoryMovement.apply() MANUAL_COUNT.
 *      MANUAL_COUNT is deliberate: SALES_ORDER_CREATED / SALES_ORDER_CANCELLED
 *      would be no-ops (their ledger claims already exist), and MANUAL_COUNT's
 *      quantity is a signed difference — exactly the restoration semantic.
 *
 * Modes:
 *   DRY-RUN (default)  — print the complete plan and exit 0. NO writes.
 *   --apply            — execute each PROPOSED line via the InventoryMovement
 *                        gateway, printing before/after per line. Aborts on
 *                        the first error. Never touches SKUs outside the
 *                        damage set.
 *   --capped           — cap each SKU's restore at its LIVE shortfall:
 *                        restore = min(audit_bound, pivot_qty − openUnshipped −
 *                        available_for_sale_qty), floored at 0, computed AT RUN
 *                        TIME. openUnshipped replicates inventory-drift-resolver's
 *                        openUnshippedBySku exactly (status exclusions,
 *                        qty_ordered − qty_shipped, SKU normalization).
 *                        HARD INVARIANT: a capped restore may never push afs
 *                        above pivot_qty − openUnshipped — recomputed and
 *                        re-clamped right before every --apply write.
 *                        SKUs with a stale pivot (extensiv_last_sync_at older
 *                        than 24h, or never synced) are HARD-SKIPPED with a
 *                        named line — never zero-filled or guessed. Works with
 *                        both dry-run and --apply. Without --capped the
 *                        original uncapped plan is unchanged (for comparison).
 *   --sku=X            — restrict the report and the plan to one SKU.
 *
 * Required environment variables:
 *   DATABASE_URL — Railway PostgreSQL connection string
 *
 * Usage:
 *   npx tsx scripts/incident-2026-07-repeat-decrement.ts             (dry-run)
 *   npx tsx scripts/incident-2026-07-repeat-decrement.ts --sku=SBR-36
 *   npx tsx scripts/incident-2026-07-repeat-decrement.ts --capped    (capped dry-run)
 *   npx tsx scripts/incident-2026-07-repeat-decrement.ts --apply     (writes!)
 *   npx tsx scripts/incident-2026-07-repeat-decrement.ts --capped --apply  (capped writes!)
 *
 * All reads go through a dedicated pg Pool (with an error handler — a dropped
 * idle connection must not crash the process). Writes go ONLY through
 * InventoryMovement.apply(), imported from the server code, so the WAC roll,
 * shrinkage/overage reconciliation row, audit trail, and realtime broadcast
 * all happen exactly as they would in the app.
 */

import pg from "pg";
import {
  aggregateRepeatDecrementDamage,
  cappedRestore,
  liveShortfall,
  normalizeSku,
  type DupFireLineRow,
  type SkuDamage,
} from "./repeat-decrement-damage";

// ─── CLI / configuration ───

const APPLY = process.argv.includes("--apply");
const CAPPED = process.argv.includes("--capped");
const skuArg = process.argv.find((a) => a.startsWith("--sku="));
const SKU_FILTER = skuArg ? skuArg.slice("--sku=".length) : null;
const WINDOW_DAYS = 30;
/** --capped: pivots synced longer ago than this are HARD-SKIPPED, never used. */
const STALE_PIVOT_HOURS = 24;
const NOTES_PREFIX = "INCIDENT-2026-07-REPEAT-DECREMENT";

function banner(): void {
  const line = "═".repeat(74);
  console.log("");
  console.log(line);
  if (APPLY) {
    console.log("  ███  INCIDENT-2026-07-REPEAT-DECREMENT — APPLY MODE (WRITES ENABLED)  ███");
    console.log("  Every PROPOSED line below WILL be executed via InventoryMovement.apply().");
  } else {
    console.log("  INCIDENT-2026-07-REPEAT-DECREMENT — DRY RUN (read-only, NO writes)");
    console.log("  This prints the complete true-up plan and exits. Pass --apply to execute.");
  }
  if (CAPPED) {
    console.log(
      "  Mode: --capped — each restore = min(audit bound, live shortfall); stale",
    );
    console.log("  pivots (>24h / never synced) and components are HARD-SKIPPED.");
  }
  if (SKU_FILTER) console.log(`  SKU filter: ${SKU_FILTER}`);
  console.log(line);
  console.log("");
}

function pad(value: unknown, width: number, align: "left" | "right" = "left"): string {
  const s = String(value);
  if (s.length >= width) return s;
  const fill = " ".repeat(width - s.length);
  return align === "right" ? fill + s : s + fill;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function formatAge(hours: number | null): string {
  if (hours === null) return "never";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.floor(hours / 24)}d`;
}

interface DriftRow {
  itemId: string;
  sku: string | null;
  afs: number;
  pivot: number;
  drift: number;
  ageHours: number | null;
}

function buildTrueUpNote(d: SkuDamage): string {
  const target = d.itemType === "finished_product" ? "availableForSaleQty" : "currentStock";
  return (
    `${NOTES_PREFIX}: restore ${d.overDecrementedUnits} over-decremented unit(s) to ${target} ` +
    `for ${d.sku} — audit replays showed ${d.totalExtraFires} extra SALES_ORDER_CREATED fire(s) ` +
    `across ${d.affectedOrders} order(s) in the last ${WINDOW_DAYS} days (upper-bound estimate; ` +
    `Math.max(0,·) clamping may have absorbed part of it)`
  );
}

// ─── --capped mode helpers ───

/** Days representation for the stale-pivot skip line ("pivot stale 1.5d"). */
function staleDays(ageHours: number): string {
  return `${(ageHours / 24).toFixed(1)}d`;
}

/**
 * Open unshipped units per NORMALIZED SKU. Replicates
 * server/services/inventory-drift-resolver.ts openUnshippedBySku() EXACTLY —
 * same status exclusions, same greatest(qty_ordered − qty_shipped, 0) math,
 * same SKU normalization (normalizeSku mirrors the resolver's `norm`) — but
 * through this script's read pool so dry-run never constructs the server
 * storage layer. If the resolver's query changes, change this one with it.
 */
async function fetchOpenUnshippedBySku(pool: pg.Pool): Promise<Map<string, number>> {
  const res = await pool.query(
    `SELECT sol.sku, sum(greatest(coalesce(sol.qty_ordered,0) - coalesce(sol.qty_shipped,0), 0))::int AS open
     FROM sales_order_lines sol
     JOIN sales_orders so ON so.id = sol.sales_order_id
     WHERE upper(coalesce(so.status,'')) NOT IN ('SHIPPED','FULFILLED','CANCELLED','DELIVERED','REFUNDED','PENDING_REFUND')
     GROUP BY sol.sku`,
  );
  const map = new Map<string, number>();
  for (const r of res.rows) {
    const n = normalizeSku(r.sku);
    if (n) map.set(n, (map.get(n) ?? 0) + Number(r.open || 0));
  }
  return map;
}

/** The live numbers behind one capped restore (plan time or re-clamp time). */
interface CappedCalc {
  auditBound: number;
  pivot: number;
  openUnshipped: number;
  afs: number;
  shortfall: number;
  restore: number;
}

interface CappedPlanLine extends CappedCalc {
  damage: SkuDamage;
  /** Which side of min(audit bound, live shortfall) determined the restore. */
  winner: string;
}

function buildCappedTrueUpNote(d: SkuDamage, c: CappedCalc): string {
  return (
    `${NOTES_PREFIX} (capped): restore ${c.restore} unit(s) to availableForSaleQty for ${d.sku} ` +
    `— min(audit bound ${c.auditBound}, live shortfall ${c.shortfall}) where shortfall = ` +
    `pivot ${c.pivot} − openUnshipped ${c.openUnshipped} − afs ${c.afs}, floored at 0; audit ` +
    `replays showed ${d.totalExtraFires} extra SALES_ORDER_CREATED fire(s) across ` +
    `${d.affectedOrders} order(s) in the last ${WINDOW_DAYS} days`
  );
}

async function main(): Promise<void> {
  banner();

  if (!process.env.DATABASE_URL) {
    console.error("❌ Missing required environment variable: DATABASE_URL");
    process.exit(1);
  }

  // Read pool. Same style as the repo-root drift/sync scripts; the no-op error
  // handler keeps a dropped idle connection from crashing the whole process.
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  pool.on("error", () => {});

  try {
    // ── 1. Damage estimate from audit_logs replays (30-day window) ─────────
    // NOTE: audit_logs' time column is "timestamp" (there is no created_at).
    // details->>'orderId' is the internal sales_orders.id the movement logged.
    const dupLineRes = await pool.query(
      `WITH dup_orders AS (
         SELECT details->>'orderId' AS order_id, COUNT(*) - 1 AS extra_fires
         FROM audit_logs
         WHERE event_type = 'SALES_ORDER_CREATED'
           AND "timestamp" > now() - interval '${WINDOW_DAYS} days'
           AND details->>'orderId' IS NOT NULL
         GROUP BY 1
         HAVING COUNT(*) > 1
       )
       SELECT d.order_id, d.extra_fires::int AS extra_fires,
              i.id AS item_id, i.sku, i.type AS item_type,
              l.qty_ordered::int AS qty_ordered
       FROM dup_orders d
       JOIN sales_orders o ON o.id::text = d.order_id
       JOIN sales_order_lines l ON l.sales_order_id = o.id
       JOIN items i ON i.id = l.product_id`,
    );

    // Lines of dup orders with NO product mapping fall out of the items join.
    // They cannot be trued up via item movements — stated as a gap, not filled.
    const unmappedRes = await pool.query(
      `WITH dup_orders AS (
         SELECT details->>'orderId' AS order_id, COUNT(*) - 1 AS extra_fires
         FROM audit_logs
         WHERE event_type = 'SALES_ORDER_CREATED'
           AND "timestamp" > now() - interval '${WINDOW_DAYS} days'
           AND details->>'orderId' IS NOT NULL
         GROUP BY 1
         HAVING COUNT(*) > 1
       )
       SELECT COUNT(*)::int AS lines,
              COALESCE(SUM(d.extra_fires * l.qty_ordered), 0)::int AS units
       FROM dup_orders d
       JOIN sales_orders o ON o.id::text = d.order_id
       JOIN sales_order_lines l ON l.sales_order_id = o.id
       WHERE l.product_id IS NULL`,
    );

    // BOM repeat check (same window). NULL orderIds excluded: production-build
    // draws carry productionLogId instead, and a NULL group would fabricate one
    // giant fake "order".
    const bomRes = await pool.query(
      `SELECT details->>'orderId' AS order_id, COUNT(*)::int AS fires
       FROM audit_logs
       WHERE event_type ILIKE '%BOM%'
         AND "timestamp" > now() - interval '${WINDOW_DAYS} days'
         AND details->>'orderId' IS NOT NULL
       GROUP BY 1
       HAVING COUNT(*) > 1
       ORDER BY 2 DESC`,
    );

    // ── 2. Drift view (replicates repo-root inventory-drift-report.js) ─────
    // drift = available_for_sale_qty − pivot_qty, finished products only.
    // READ-ONLY, same computation as the standalone report.
    const driftRes = await pool.query(
      `SELECT id, sku, available_for_sale_qty, pivot_qty, extensiv_last_sync_at
       FROM items
       WHERE type = 'finished_product'`,
    );
    const driftByItem = new Map<string, DriftRow>();
    for (const r of driftRes.rows) {
      const afs = r.available_for_sale_qty ?? 0;
      const pivot = r.pivot_qty ?? 0;
      const ageHours = r.extensiv_last_sync_at
        ? (Date.now() - new Date(r.extensiv_last_sync_at).getTime()) / 3_600_000
        : null;
      driftByItem.set(r.id, {
        itemId: r.id,
        sku: r.sku,
        afs,
        pivot,
        drift: afs - pivot,
        ageHours,
      });
    }

    const rows: DupFireLineRow[] = dupLineRes.rows.map((r: any) => ({
      orderId: r.order_id,
      extraFires: r.extra_fires,
      itemId: r.item_id,
      sku: r.sku,
      itemType: r.item_type,
      qtyOrdered: r.qty_ordered,
    }));

    let damages = aggregateRepeatDecrementDamage(rows);
    const totalDamagedSkus = damages.length;
    if (SKU_FILTER) damages = damages.filter((d) => d.sku === SKU_FILTER);

    // ── Print: damage estimate ──────────────────────────────────────────────
    console.log(`DAMAGE ESTIMATE — SALES_ORDER_CREATED replays, last ${WINDOW_DAYS} days`);
    console.log(
      `  Dup orders found: ${new Set(rows.map((r) => r.orderId)).size}   ` +
        `Damaged SKUs: ${totalDamagedSkus}` +
        (SKU_FILTER ? `   (showing ${damages.length} after --sku=${SKU_FILTER})` : ""),
    );
    console.log("");
    console.log(
      "  ⚠ UPPER BOUND: (a) the movement engine clamps availableForSaleQty at 0",
    );
    console.log(
      "    (Math.max(0,·)), so some extra fires decremented nothing; (b) audit rows",
    );
    console.log(
      "    are logged per LINE movement, so multi-line orders inflate extra_fires.",
    );
    console.log("    True damage can be LOWER than these numbers, never higher.");
    console.log("");

    if (damages.length === 0) {
      console.log(
        SKU_FILTER
          ? `  No repeat-decrement damage recorded for SKU ${SKU_FILTER} in the window.`
          : "  No repeat-decrement damage found in the window.",
      );
      console.log("");
    } else {
      const header =
        "  " +
        pad("SKU", 20) +
        pad("TYPE", 18) +
        pad("OVER-DEC", 10, "right") +
        pad("ORDERS", 8, "right") +
        pad("XFIRES", 8, "right");
      console.log(header);
      console.log("  " + "─".repeat(header.length));
      for (const d of damages) {
        console.log(
          "  " +
            pad(d.sku, 20) +
            pad(d.itemType, 18) +
            pad(d.overDecrementedUnits, 10, "right") +
            pad(d.affectedOrders, 8, "right") +
            pad(d.totalExtraFires, 8, "right"),
        );
      }
      console.log("");
    }

    const unmapped = unmappedRes.rows[0];
    if (unmapped && Number(unmapped.lines) > 0) {
      console.log(
        `  DATA GAP: ${unmapped.lines} dup-order line(s) have no product_id mapping ` +
          `(≤ ${unmapped.units} unit(s)). They cannot be attributed to an item or trued ` +
          `up via item movements — excluded from the plan, NOT zero-filled away.`,
      );
      console.log("");
    }

    // ── Print: BOM repeat check ─────────────────────────────────────────────
    console.log(`BOM REPEAT CHECK — event_type ILIKE '%BOM%', last ${WINDOW_DAYS} days`);
    if (bomRes.rows.length === 0) {
      console.log("  ✅ No order fired BOM events more than once in the window.");
    } else {
      console.log("  ⚠ Orders with repeated BOM events (component draws may also be doubled —");
      console.log("    investigate separately; this script trues up the SALES_ORDER path only):");
      for (const r of bomRes.rows) {
        console.log(`    order ${r.order_id}: ${r.fires} BOM event(s)`);
      }
    }
    console.log("");

    // ── Print: drift cross-check for the damaged finished SKUs ─────────────
    console.log("DRIFT CROSS-CHECK — vs inventory-drift-report.js view (afs − pivot)");
    const finishedDamages = damages.filter((d) => d.itemType === "finished_product");
    if (finishedDamages.length === 0) {
      console.log("  (no damaged finished products to cross-check)");
    } else {
      for (const d of finishedDamages) {
        const drift = driftByItem.get(d.itemId);
        if (!drift) {
          console.log(`  ${d.sku}: not in the drift view (item missing/type changed) — cannot cross-check.`);
          continue;
        }
        const shortfall = -drift.drift; // pivot − afs; positive = afs below Extensiv sellable
        const base =
          `  ${d.sku}: audit says +${d.overDecrementedUnits} over-decrement; drift view shows ` +
          `afs=${drift.afs}, pivot=${drift.pivot} (drift ${signed(drift.drift)}, ` +
          `shortfall ${signed(shortfall)}; synced ${formatAge(drift.ageHours)} ago)`;
        if (shortfall === d.overDecrementedUnits) {
          console.log(`${base} — consistent.`);
        } else if (shortfall < d.overDecrementedUnits) {
          console.log(
            `${base} — drift shows only ${signed(Math.max(0, shortfall))} — Extensiv sync, the ` +
              `Math.max clamp, or later restorative movements absorbed the rest. Consider a ` +
              `physical count before applying the full amount.`,
          );
        } else {
          console.log(
            `${base} — observed shortfall EXCEEDS the audit estimate; other drift sources are in ` +
              `play (orders not yet reflected upstream, counts, unsynced Extensiv pull).`,
          );
        }
        if (drift.ageHours === null || drift.ageHours > 6) {
          console.log(
            `    ⚠ pivot_qty is STALE (synced ${formatAge(drift.ageHours)} ago) — the drift side of ` +
              `this comparison is not a trustworthy current baseline.`,
          );
        }
      }
    }
    console.log("");

    // ── True-up plan ────────────────────────────────────────────────────────
    // --capped needs the live open-unshipped view; fetched once for the plan
    // and re-fetched before every apply write (hard-invariant re-clamp).
    const openBySku = CAPPED ? await fetchOpenUnshippedBySku(pool) : new Map<string, number>();
    const cappedPlan: CappedPlanLine[] = [];

    if (CAPPED) {
      console.log("TRUE-UP PLAN (CAPPED) — restore = min(audit_bound, live_shortfall) per SKU");
      console.log(
        "  live_shortfall = pivot_qty − openUnshipped − available_for_sale_qty (floored",
      );
      console.log(
        "  at 0), computed at run time. openUnshipped replicates inventory-drift-resolver's",
      );
      console.log(
        "  openUnshippedBySku (status exclusions, qty_ordered − qty_shipped, SKU norm).",
      );
      console.log(
        "  HARD INVARIANT: a restore never pushes afs above pivot − openUnshipped —",
      );
      console.log(
        "  recomputed and re-clamped again immediately before every --apply write.",
      );
      console.log(
        "  Stale pivots (extensiv_last_sync_at > 24h, or never synced) are HARD-SKIPPED.",
      );
      console.log(
        "  Restoration uses MANUAL_COUNT (signed difference) via InventoryMovement.apply().",
      );
      console.log("");

      if (damages.length === 0) {
        console.log("  (nothing to true up)");
      }
      for (const d of damages) {
        if (d.itemType !== "finished_product") {
          console.log(
            `  SKIPPED (component — no Extensiv pivot baseline): ${d.sku} — capped math is ` +
              "finished-goods only; use the uncapped plan after a physical count",
          );
          continue;
        }
        if (d.sku === "(no sku)") {
          console.log(
            `  SKIPPED (item has no SKU): item ${d.itemId} — cannot match open unshipped ` +
              "order lines; never guessed",
          );
          continue;
        }
        const drift = driftByItem.get(d.itemId);
        if (!drift) {
          console.log(
            `  SKIPPED (not in items view — item missing/type changed): ${d.sku} — cannot ` +
              "compute a live shortfall",
          );
          continue;
        }
        if (drift.ageHours === null || drift.ageHours > STALE_PIVOT_HOURS) {
          const staleness =
            drift.ageHours === null
              ? "pivot never synced"
              : `pivot stale ${staleDays(drift.ageHours)}`;
          console.log(`  SKIPPED (${staleness}): ${d.sku} — re-run after Extensiv refresh`);
          continue;
        }

        const open = openBySku.get(normalizeSku(d.sku)) ?? 0;
        const shortfall = liveShortfall({
          pivot: drift.pivot,
          openUnshipped: open,
          afs: drift.afs,
        });
        const restore = cappedRestore({
          auditBound: d.overDecrementedUnits,
          pivot: drift.pivot,
          openUnshipped: open,
          afs: drift.afs,
        });
        const winner =
          shortfall < d.overDecrementedUnits
            ? "live cap won"
            : shortfall > d.overDecrementedUnits
              ? "audit bound won"
              : "tie (bound = cap)";
        const calc: CappedCalc = {
          auditBound: d.overDecrementedUnits,
          pivot: drift.pivot,
          openUnshipped: open,
          afs: drift.afs,
          shortfall,
          restore,
        };
        cappedPlan.push({ ...calc, damage: d, winner });

        const label = restore > 0 ? "PROPOSED " : "NO-OP    ";
        console.log(
          `  ${label} ${pad(d.sku, 20)} ${restore > 0 ? signed(restore) : "0"} → ` +
            `availableForSaleQty  (MANUAL_COUNT, location=PIVOT, item=${d.itemId})`,
        );
        console.log(
          `            audit_bound=${calc.auditBound}  pivot=${calc.pivot}  ` +
            `openUnshipped=${calc.openUnshipped}  afs=${calc.afs}  ` +
            `live_shortfall=${calc.shortfall}  → restore ${restore} (${winner})`,
        );
        if (restore > 0) {
          console.log(`            notes: "${buildCappedTrueUpNote(d, calc)}"`);
        } else {
          console.log(
            "            nothing to restore — afs already at/above pivot − openUnshipped " +
              "(or audit bound is 0); no write will be made.",
          );
        }
      }
    } else {
      console.log("TRUE-UP PLAN — one PROPOSED line per damaged SKU");
      console.log(
        "  Restoration uses MANUAL_COUNT (signed difference) via InventoryMovement.apply().",
      );
      console.log(
        "  NEVER SALES_ORDER_CREATED/CANCELLED — their idempotency-ledger claims already",
      );
      console.log("  exist, so the gateway would no-op them.");
      console.log("");

      if (damages.length === 0) {
        console.log("  (nothing to true up)");
      }
      for (const d of damages) {
        const isFinished = d.itemType === "finished_product";
        const target = isFinished ? "availableForSaleQty" : "currentStock";
        // MANUAL_COUNT semantics (inventory-movement.ts): finished + location !==
        // HILDALE → availableForSaleQty; components ignore location (N/A) → currentStock.
        const location = isFinished ? "PIVOT" : "N/A";
        console.log(
          `  PROPOSED  ${pad(d.sku, 20)} ${signed(d.overDecrementedUnits)} → ${target}` +
            `  (MANUAL_COUNT, location=${location}, item=${d.itemId})`,
        );
        console.log(`            notes: "${buildTrueUpNote(d)}"`);
      }
    }
    console.log("");

    if (!APPLY) {
      console.log("═".repeat(74));
      console.log("  DRY RUN complete — NO writes were made. Re-run with --apply to execute.");
      console.log("═".repeat(74));
      console.log("");
      return;
    }

    // ── APPLY mode ──────────────────────────────────────────────────────────
    const executableCapped = cappedPlan.filter((l) => l.restore > 0);
    if (CAPPED ? executableCapped.length === 0 : damages.length === 0) {
      console.log(
        CAPPED
          ? "  APPLY mode (capped): no executable restore lines (all skipped, capped to 0, or empty) — nothing executed."
          : "  APPLY mode: damage set is empty — nothing executed.",
      );
      return;
    }

    console.log("═".repeat(74));
    console.log(
      CAPPED
        ? "  APPLYING CAPPED TRUE-UP via InventoryMovement.apply() — abort on first error"
        : "  APPLYING TRUE-UP via InventoryMovement.apply() — abort on first error",
    );
    console.log("═".repeat(74));
    console.log("");

    // Imported lazily so DRY-RUN never constructs the server storage layer.
    const { storage } = await import("../server/storage");
    const { InventoryMovement } = await import("../server/services/inventory-movement");
    const movement = new InventoryMovement(storage);

    if (CAPPED) {
      let applied = 0;
      let skippedAtWrite = 0;
      for (const line of executableCapped) {
        const d = line.damage;

        // HARD INVARIANT: recompute pivot / afs / openUnshipped from the live
        // DB immediately before the write and re-clamp — the restore may never
        // push afs above pivot − openUnshipped, even if the world moved since
        // the plan was printed.
        const freshRes = await pool.query(
          `SELECT available_for_sale_qty, pivot_qty, extensiv_last_sync_at
           FROM items WHERE id = $1`,
          [d.itemId],
        );
        if (freshRes.rows.length === 0) {
          console.error(`  ❌ ABORT: item ${d.itemId} (${d.sku}) not found at apply time.`);
          process.exit(1);
        }
        const fresh = freshRes.rows[0];
        const freshAfs = fresh.available_for_sale_qty ?? 0;
        const freshPivot = fresh.pivot_qty ?? 0;
        const freshAge = fresh.extensiv_last_sync_at
          ? (Date.now() - new Date(fresh.extensiv_last_sync_at).getTime()) / 3_600_000
          : null;
        if (freshAge === null || freshAge > STALE_PIVOT_HOURS) {
          const staleness =
            freshAge === null ? "pivot never synced" : `pivot stale ${staleDays(freshAge)}`;
          console.log(
            `  ⏭  SKIPPED at write time (${staleness}): ${d.sku} — re-run after Extensiv refresh`,
          );
          skippedAtWrite++;
          continue;
        }
        const freshOpenBySku = await fetchOpenUnshippedBySku(pool);
        const freshOpen = freshOpenBySku.get(normalizeSku(d.sku)) ?? 0;
        const freshShortfall = liveShortfall({
          pivot: freshPivot,
          openUnshipped: freshOpen,
          afs: freshAfs,
        });
        const restore = cappedRestore({
          auditBound: line.auditBound,
          pivot: freshPivot,
          openUnshipped: freshOpen,
          afs: freshAfs,
        });
        if (restore !== line.restore) {
          console.log(
            `  ↻ re-clamped ${d.sku}: planned ${line.restore} → ${restore} ` +
              `(fresh pivot=${freshPivot}, openUnshipped=${freshOpen}, afs=${freshAfs}, ` +
              `live_shortfall=${freshShortfall})`,
          );
        }
        if (restore <= 0) {
          console.log(
            `  ⏭  ${d.sku}: shortfall fully absorbed since planning — no write made.`,
          );
          skippedAtWrite++;
          continue;
        }

        const freshCalc: CappedCalc = {
          auditBound: line.auditBound,
          pivot: freshPivot,
          openUnshipped: freshOpen,
          afs: freshAfs,
          shortfall: freshShortfall,
          restore,
        };
        const result = await movement.apply({
          eventType: "MANUAL_COUNT",
          itemId: d.itemId,
          quantity: restore, // signed difference; positive capped restore
          location: "PIVOT",
          source: "SYSTEM",
          userName: "incident-2026-07-repeat-decrement.ts",
          notes: buildCappedTrueUpNote(d, freshCalc),
        });
        if (!result.success) {
          console.error(
            `  ❌ ABORT on ${d.sku}: ${result.error ?? "InventoryMovement.apply failed"}. ` +
              "No further lines executed.",
          );
          process.exit(1);
        }

        const after = await storage.getItem(d.itemId);
        const afterAfs = after ? after.availableForSaleQty ?? 0 : freshAfs + restore;
        console.log(
          `  ✅ ${pad(d.sku, 20)} availableForSaleQty: ${freshAfs} → ${afterAfs} ` +
            `(restore ${signed(restore)} = min(audit ${line.auditBound}, ` +
            `shortfall ${freshShortfall}); onHand ${result.beforeQty} → ${result.afterQty})`,
        );
        // Post-write invariant audit: afs must never exceed pivot − openUnshipped.
        if (afterAfs > freshPivot - freshOpen) {
          console.error(
            `  ❌ ABORT: invariant breached AFTER write on ${d.sku} — afs ${afterAfs} > ` +
              `pivot ${freshPivot} − openUnshipped ${freshOpen}. A concurrent movement changed ` +
              "afs between the re-clamp read and the write. The write above already landed; " +
              "no further lines executed — investigate before re-running.",
          );
          process.exit(1);
        }
        applied++;
      }

      console.log("");
      console.log("═".repeat(74));
      console.log(
        `  CAPPED APPLY complete: ${applied} SKU(s) trued up` +
          (skippedAtWrite ? `, ${skippedAtWrite} skipped at write time` : "") +
          ". Each restoration",
      );
      console.log(
        "  wrote its own MANUAL_COUNT audit row + WAC overage reconciliation entry.",
      );
      console.log(
        "  Re-run with --capped (no --apply) or inventory-drift-report.js to verify.",
      );
      console.log("═".repeat(74));
      console.log("");
      return;
    }

    for (const d of damages) {
      const isFinished = d.itemType === "finished_product";
      const target = isFinished ? "availableForSaleQty" : "currentStock";

      const before = await storage.getItem(d.itemId);
      if (!before) {
        console.error(`  ❌ ABORT: item ${d.itemId} (${d.sku}) not found at apply time.`);
        process.exit(1);
      }
      const beforeVal = isFinished
        ? before.availableForSaleQty ?? 0
        : before.currentStock ?? 0;

      const result = await movement.apply({
        eventType: "MANUAL_COUNT",
        itemId: d.itemId,
        quantity: d.overDecrementedUnits, // signed difference; positive restore
        location: isFinished ? "PIVOT" : "N/A",
        source: "SYSTEM",
        userName: "incident-2026-07-repeat-decrement.ts",
        notes: buildTrueUpNote(d),
      });

      if (!result.success) {
        console.error(
          `  ❌ ABORT on ${d.sku}: ${result.error ?? "InventoryMovement.apply failed"}. ` +
            "No further lines executed.",
        );
        process.exit(1);
      }

      const after = await storage.getItem(d.itemId);
      const afterVal = after
        ? isFinished
          ? after.availableForSaleQty ?? 0
          : after.currentStock ?? 0
        : beforeVal;
      console.log(
        `  ✅ ${pad(d.sku, 20)} ${target}: ${beforeVal} → ${afterVal} ` +
          `(onHand ${result.beforeQty} → ${result.afterQty}, Δ ${signed(result.quantityChanged)})`,
      );
    }

    console.log("");
    console.log("═".repeat(74));
    console.log(
      `  APPLY complete: ${damages.length} SKU(s) trued up. Each restoration wrote its own`,
    );
    console.log(
      "  MANUAL_COUNT audit row + WAC overage reconciliation entry. Re-run without",
    );
    console.log("  --apply (or run inventory-drift-report.js) to verify the new state.");
    console.log("═".repeat(74));
    console.log("");
  } finally {
    await pool.end().catch(() => {});
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("❌ incident-2026-07-repeat-decrement failed:", err?.message ?? err);
    process.exit(1);
  });
