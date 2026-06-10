/**
 * InventoryDriftResolver — automated resolution for app-vs-Extensiv SKU drift.
 * ---------------------------------------------------------------------------
 * The integrity sweep flags SKUs where availableForSaleQty (afs) diverges from
 * pivotQty (Extensiv mirror). Drift is NOT automatically an error: afs is
 * decremented when an order is CREATED, while Extensiv only decrements when it
 * SHIPS — so afs ≈ pivot − openUnshipped at all times. The resolver therefore:
 *
 *   1. STALE Extensiv data → force a per-item re-sync (refresh pivot from the
 *      3PL). A failed sync is logged with its exact point of failure.
 *   2. Drift explained by open unshipped orders → EXPLAINED (logged, no write).
 *   3. Residual drift beyond the threshold → afs is corrected to
 *      (pivot − openUnshipped) through InventoryMovement MANUAL_COUNT — the
 *      sanctioned single gateway (audit-logged) — but ONLY when `apply` is on
 *      AND the correction is within `maxAutoCorrect` units. Larger residuals
 *      are logged as PROPOSED for human review, never silently applied.
 *
 * Every decision lands in data_reconciliation_log (dataType 'inventory_drift'),
 * giving the launch-readiness report a precise per-SKU status trail.
 */
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { InventoryMovement } from "./inventory-movement";

export type DriftDecision =
  | "EXPLAINED" // open orders fully account for the gap
  | "CORRECTED" // afs reset to pivot − openUnshipped via MANUAL_COUNT
  | "PROPOSED" // correction computed but exceeds the auto-apply cap
  | "RESYNCED" // stale pivot refreshed from Extensiv; drift re-evaluated
  | "SYNC_FAILED" // Extensiv re-sync failed — point of failure logged
  | "SKIPPED"; // no item / no drift after re-check

export interface DriftClassification {
  decision: Extract<DriftDecision, "EXPLAINED" | "CORRECTED" | "PROPOSED">;
  residual: number; // drift left after open orders are accounted for
  targetAfs: number; // what afs should be (pivot − openUnshipped, floored at 0)
  correction: number; // targetAfs − currentAfs (signed)
}

/**
 * Pure: classify a SKU's drift given afs, pivot, open unshipped units, the
 * tolerance threshold, and the auto-apply cap. Unit-tested.
 */
export function classifyDrift(
  afs: number,
  pivot: number,
  openUnshipped: number,
  threshold: number,
  maxAutoCorrect: number,
): DriftClassification {
  const targetAfs = Math.max(0, (pivot || 0) - Math.max(0, openUnshipped || 0));
  const correction = targetAfs - (afs || 0);
  const residual = correction; // how far afs sits from where it should be
  if (Math.abs(residual) < Math.max(1, threshold)) {
    return { decision: "EXPLAINED", residual, targetAfs, correction: 0 };
  }
  if (Math.abs(correction) <= maxAutoCorrect) {
    return { decision: "CORRECTED", residual, targetAfs, correction };
  }
  return { decision: "PROPOSED", residual, targetAfs, correction };
}

export interface ResolveResult {
  ranAt: string;
  flagged: number;
  resynced: number;
  explained: number;
  corrected: number;
  proposed: number;
  syncFailed: number;
  details: Array<{ sku: string; decision: DriftDecision; note: string }>;
}

const norm = (s: string | null | undefined): string =>
  (s ?? "").replace(/^SKU:\s*/i, "").replace(/[^a-z0-9]/gi, "").toUpperCase();

/** Open unshipped units per normalized SKU across non-terminal sales orders. */
async function openUnshippedBySku(): Promise<Map<string, number>> {
  const res: any = await db.execute(sql`
    SELECT sol.sku, sum(greatest(coalesce(sol.qty_ordered,0) - coalesce(sol.qty_shipped,0), 0))::int AS open
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    WHERE upper(coalesce(so.status,'')) NOT IN ('FULFILLED','CANCELLED','DELIVERED','REFUNDED','PENDING_REFUND')
    GROUP BY sol.sku`);
  const map = new Map<string, number>();
  for (const r of (res.rows ?? res ?? [])) {
    const n = norm(r.sku);
    if (n) map.set(n, (map.get(n) ?? 0) + Number(r.open || 0));
  }
  return map;
}

export async function resolveInventoryDrift(opts?: {
  apply?: boolean; // actually write CORRECTED decisions (default true — bounded by maxAutoCorrect)
  maxAutoCorrect?: number; // cap on auto-applied |correction| (default 25 units)
  sku?: string; // resolve a single SKU (used by the FinOps page's per-SKU Approve button)
  userId?: string;
}): Promise<ResolveResult> {
  const apply = opts?.apply ?? true;
  const maxAutoCorrect = opts?.maxAutoCorrect ?? 25;
  const ranAt = new Date().toISOString();
  const out: ResolveResult = {
    ranAt, flagged: 0, resynced: 0, explained: 0, corrected: 0, proposed: 0, syncFailed: 0, details: [],
  };

  const { runDriftReport } = await import("./inventory-drift-service");
  const report: any = await runDriftReport();
  const flagged: any[] = (report.flaggedItems ?? []).filter(
    (f: any) => !opts?.sku || f.sku === opts.sku,
  );
  out.flagged = flagged.length;
  if (!flagged.length) return out;

  // 1. Force a re-sync for stale items so decisions use fresh pivot numbers.
  const staleItems = flagged.filter((f) => f.stale);
  if (staleItems.length) {
    try {
      const { extensivInventorySyncService } = await import("./extensiv-inventory-sync-service");
      const initialized = await (extensivInventorySyncService as any).initialize?.(opts?.userId ?? "default");
      for (const f of staleItems) {
        try {
          if (initialized === false) throw new Error("Extensiv credentials not configured");
          const item = await storage.getItemBySku(f.sku);
          if (!item) throw new Error("item not found by sku");
          const r: any = await (extensivInventorySyncService as any).syncItem?.(item);
          if (r && r.success === false) throw new Error(r.error || "sync returned failure");
          out.resynced++;
          f.pivot = r?.newQty ?? f.pivot; // use the fresh number downstream
          out.details.push({ sku: f.sku, decision: "RESYNCED", note: `pivot refreshed (${r?.previousQty ?? "?"} → ${r?.newQty ?? "?"})` });
        } catch (e: any) {
          out.syncFailed++;
          out.details.push({ sku: f.sku, decision: "SYNC_FAILED", note: `Extensiv re-sync failed: ${e?.message ?? e}` });
        }
      }
    } catch (e: any) {
      for (const f of staleItems) {
        out.syncFailed++;
        out.details.push({ sku: f.sku, decision: "SYNC_FAILED", note: `Extensiv sync service unavailable: ${e?.message ?? e}` });
      }
    }
  }

  // 2/3. Explain or correct the residual drift.
  const openBySku = await openUnshippedBySku().catch(() => new Map<string, number>());
  const threshold = Number(report.driftThreshold ?? 5);
  const mover = new InventoryMovement(storage as any);
  const ledger: any[] = [];

  for (const f of flagged) {
    const skuFailed = out.details.some((d) => d.sku === f.sku && d.decision === "SYNC_FAILED");
    if (skuFailed) {
      ledger.push(logRow(f.sku, "SYNC_FAILED", null, null, out.details.find((d) => d.sku === f.sku)!.note));
      continue;
    }
    const open = openBySku.get(norm(f.sku)) ?? 0;
    const cls = classifyDrift(Number(f.afs ?? 0), Number(f.pivot ?? 0), open, threshold, maxAutoCorrect);

    if (cls.decision === "EXPLAINED") {
      out.explained++;
      out.details.push({ sku: f.sku, decision: "EXPLAINED", note: `drift ${f.drift} covered by ${open} open unshipped unit(s)` });
      ledger.push(logRow(f.sku, "EXPLAINED", String(f.afs), String(cls.targetAfs), `Drift accounted for by ${open} open order unit(s); within ±${threshold}.`));
      continue;
    }

    if (cls.decision === "CORRECTED" && apply) {
      try {
        const item = await storage.getItemBySku(f.sku);
        if (!item) throw new Error("item not found by sku");
        // MANUAL_COUNT takes the signed DIFFERENCE (actual − expected), and for
        // finished products at a non-HILDALE location it adjusts afs directly.
        const res: any = await mover.apply({
          eventType: "MANUAL_COUNT",
          itemId: (item as any).id,
          quantity: cls.correction,
          location: "PIVOT",
          source: "SYSTEM",
          userId: opts?.userId ?? "system",
          userName: "drift-resolver",
          notes: `Auto drift resolution: afs ${f.afs} → ${cls.targetAfs} (pivot ${f.pivot} − ${open} open) [residual ${cls.residual}]`,
        });
        if (res && res.success === false) throw new Error(res.error || "movement rejected");
        out.corrected++;
        out.details.push({ sku: f.sku, decision: "CORRECTED", note: `afs ${f.afs} → ${cls.targetAfs} (pivot ${f.pivot} − ${open} open)` });
        ledger.push(logRow(f.sku, "CORRECTED", String(f.afs), String(cls.targetAfs), `afs reset to pivot − open orders via MANUAL_COUNT (cap ${maxAutoCorrect}).`));
      } catch (e: any) {
        out.proposed++;
        out.details.push({ sku: f.sku, decision: "PROPOSED", note: `correction failed to apply: ${e?.message ?? e}` });
        ledger.push(logRow(f.sku, "PROPOSED", String(f.afs), String(cls.targetAfs), `Auto-apply failed (${e?.message ?? e}); needs human review.`));
      }
      continue;
    }

    // PROPOSED (too large to auto-apply, or apply=false)
    out.proposed++;
    out.details.push({ sku: f.sku, decision: "PROPOSED", note: `correction ${cls.correction > 0 ? "+" : ""}${cls.correction} exceeds cap ${maxAutoCorrect} — review` });
    ledger.push(logRow(f.sku, "PROPOSED", String(f.afs), String(cls.targetAfs), `Residual ${cls.residual} beyond auto-cap ${maxAutoCorrect}; flagged for human review.`));
  }

  if (ledger.length) {
    await storage.createDataReconciliationLog(ledger).catch((e: any) =>
      console.warn("[DriftResolver] ledger write failed:", e?.message ?? e));
  }
  console.log(`[DriftResolver] flagged=${out.flagged} resynced=${out.resynced} explained=${out.explained} corrected=${out.corrected} proposed=${out.proposed} syncFailed=${out.syncFailed}`);
  return out;
}

function logRow(sku: string, action: string, oldValue: string | null, newValue: string | null, reason: string) {
  return {
    dataType: "inventory_drift",
    entityKey: sku,
    action,
    field: "available_for_sale_qty",
    oldValue,
    newValue,
    reason,
    source: "inventory-drift-resolver",
  };
}
