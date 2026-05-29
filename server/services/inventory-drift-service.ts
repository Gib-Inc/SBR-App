import { storage } from "../storage";

/**
 * Inventory Drift Service — in-app reconciliation check.
 *
 * Mirrors the standalone `inventory-drift-report.js` logic but reads through
 * the app's storage layer so it can run inside the deployed server on a
 * schedule (see scheduler-service.ts → performDriftReport). READ-ONLY: it
 * never writes to items, it only computes and reports.
 *
 * drift = availableForSaleQty − pivotQty
 *   pivotQty              = Extensiv "Available" mirror (3PL system-of-record)
 *   availableForSaleQty   = local working sellable number (orders/returns/etc.)
 *
 * After the C1 fix, EXTENSIV_SYNC no longer auto-corrects afs off the Extensiv
 * delta — so a small, slow drift is normal and is meant to be *reported*, not
 * silently reconciled. A large/persistent drift, or a stale Extensiv sync,
 * means the two numbers have desynced and a manual count is warranted.
 */

export interface DriftItem {
  id: string;
  sku: string | null;
  name: string | null;
  extensivSku: string | null;
  afs: number;
  pivot: number;
  hildale: number;
  onHand: number;
  drift: number;
  ageHours: number | null;
  stale: boolean;
  overThreshold: boolean;
}

export interface DriftReportResult {
  analyzed: number;
  overThresholdCount: number;
  staleCount: number;
  flaggedCount: number;
  driftThreshold: number;
  staleHours: number;
  /** Flagged items, worst drift first. Capped by the caller when logging. */
  flaggedItems: DriftItem[];
}

function resolveThreshold(): number {
  const v = Number(process.env.DRIFT_THRESHOLD ?? 5);
  return Number.isFinite(v) && v >= 0 ? v : 5;
}

function resolveStaleHours(): number {
  const v = Number(process.env.STALE_HOURS ?? 6);
  return Number.isFinite(v) && v >= 0 ? v : 6;
}

function hoursSince(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  return Number.isFinite(ms) ? ms / (1000 * 60 * 60) : null;
}

/**
 * Computes drift across all finished products. Components are excluded by
 * design — they track current_stock and have no pivot mirror.
 */
export async function runDriftReport(opts?: {
  driftThreshold?: number;
  staleHours?: number;
}): Promise<DriftReportResult> {
  const driftThreshold = opts?.driftThreshold ?? resolveThreshold();
  const staleHours = opts?.staleHours ?? resolveStaleHours();

  const allItems = await storage.getAllItems();
  const finished = allItems.filter((it) => it.type === "finished_product");

  const analyzed: DriftItem[] = finished.map((r) => {
    const afs = r.availableForSaleQty ?? 0;
    const pivot = r.pivotQty ?? 0;
    const drift = afs - pivot;
    const ageHours = hoursSince(r.extensivLastSyncAt ?? null);
    const stale = ageHours === null || ageHours > staleHours;
    const overThreshold = Math.abs(drift) >= driftThreshold;
    return {
      id: r.id,
      sku: r.sku ?? null,
      name: r.name ?? null,
      extensivSku: r.extensivSku ?? null,
      afs,
      pivot,
      hildale: r.hildaleQty ?? 0,
      onHand: r.extensivOnHandSnapshot ?? 0,
      drift,
      ageHours,
      stale,
      overThreshold,
    };
  });

  const flaggedItems = analyzed
    .filter((r) => r.overThreshold || r.stale)
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

  return {
    analyzed: analyzed.length,
    overThresholdCount: analyzed.filter((r) => r.overThreshold).length,
    staleCount: analyzed.filter((r) => r.stale).length,
    flaggedCount: flaggedItems.length,
    driftThreshold,
    staleHours,
    flaggedItems,
  };
}
