/**
 * CIPH.R Sync Reconciliation — Phase 1 guard.
 *
 * A degenerate/partial/empty Extensiv payload (API timeout, rate-limit, warehouse
 * outage) would otherwise write pivot_qty = 0 across the catalog and silently zero
 * sellable stock → false backorders. This pure guard inspects an incoming payload
 * against the current state and decides whether it's SAFE to apply.
 *
 * It refuses (safe:false) when:
 *   - the payload is empty, OR
 *   - it would drop > maxZeroPct (default 30%) of currently in-stock SKUs to 0, OR
 *   - it has < minCountRatio (default 50%) of the last good run's item count.
 *
 * Pure + unit-tested. The cron (extensiv-sync.js) mirrors this logic inline (it
 * can't import TS); the in-app service imports this directly.
 */

export interface SyncPayloadAssessment {
  safe: boolean;
  reason: string | null;
  itemCount: number;
  wouldZeroCount: number;
  wouldZeroPctOfInStock: number; // 0..1
}

export interface SyncGuardPrev {
  /** how many items currently have a positive sellable qty (pivot_qty > 0) */
  inStockItemCount: number;
  /** item count from the last good sync (or current mapped-item count as a proxy) */
  lastGoodItemCount?: number | null;
}

export interface SyncGuardOpts {
  maxZeroPct?: number; // default 0.30
  minCountRatio?: number; // default 0.50
}

export function assessExtensivPayload(
  incoming: Array<{ available: number | null | undefined }>,
  prev: SyncGuardPrev,
  opts: SyncGuardOpts = {},
): SyncPayloadAssessment {
  const maxZeroPct = opts.maxZeroPct ?? 0.30;
  const minCountRatio = opts.minCountRatio ?? 0.50;
  const itemCount = incoming?.length ?? 0;
  const inStock = Math.max(0, prev?.inStockItemCount ?? 0);

  if (itemCount === 0) {
    return { safe: false, reason: "Extensiv returned 0 items — refusing to write (would zero all stock).", itemCount: 0, wouldZeroCount: 0, wouldZeroPctOfInStock: 0 };
  }

  const wouldZeroCount = incoming.filter((r) => r.available == null || Number(r.available) === 0).length;
  const wouldZeroPctOfInStock = inStock > 0 ? wouldZeroCount / inStock : 0;

  const lastGood = prev?.lastGoodItemCount ?? null;
  if (lastGood != null && lastGood > 0 && itemCount < lastGood * minCountRatio) {
    return {
      safe: false,
      reason: `Extensiv returned ${itemCount} items — under ${Math.round(minCountRatio * 100)}% of the last good run (${lastGood}); likely a partial/failed pull. Skipping.`,
      itemCount, wouldZeroCount, wouldZeroPctOfInStock,
    };
  }

  if (inStock > 0 && wouldZeroPctOfInStock > maxZeroPct) {
    return {
      safe: false,
      reason: `${wouldZeroCount} items (${Math.round(wouldZeroPctOfInStock * 100)}% of in-stock SKUs) would drop to 0 — over the ${Math.round(maxZeroPct * 100)}% guard. Looks like an empty/degraded payload. Skipping.`,
      itemCount, wouldZeroCount, wouldZeroPctOfInStock,
    };
  }

  return { safe: true, reason: null, itemCount, wouldZeroCount, wouldZeroPctOfInStock };
}
