/**
 * CIPH.R Data Reconciliation — verify new data against what already exists, so
 * nothing changes silently and data never disappears.
 *
 * Two pure cores (both unit-tested, no DB):
 *  - reconcileMarketingSnapshot(): for additive ad-spend uploads. Decides
 *    ADD (new platform+period), SUPERSEDE (re-upload of same platform+period →
 *    replace, keep old for audit), or DISREGARDED (identical sourceHash → no-op).
 *    Prevents the double-count where every upload added a row.
 *  - reconcileFields(): for record merges (P&L month, balance sheet). Field-level
 *    rules: a non-null incoming UPDATES; a null incoming never overwrites a real
 *    value (KEPT); equal values are no-ops. Returns the merged record + a decision
 *    list so the UI can show exactly what changed.
 *
 * Every decision is {action, field?, oldValue?, newValue?, reason} → persisted to
 * data_reconciliation_log and surfaced to the operator.
 */

export type ReconAction = "ADDED" | "UPDATED" | "KEPT" | "SUPERSEDED" | "DISREGARDED";

export interface ReconDecision {
  action: ReconAction;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  reason: string;
}

// Stable hash of the meaningful content of an ad-spend upload, so an identical
// re-upload is recognized as a duplicate (no-op) rather than a new row.
export function hashMarketingSnapshot(f: {
  platform: string; periodStart: string | null; periodEnd: string | null;
  spend: number | null; impressions?: number | null; clicks?: number | null;
}): string {
  const key = [
    String(f.platform || "").toUpperCase(),
    f.periodStart ?? "", f.periodEnd ?? "",
    f.spend ?? "", f.impressions ?? "", f.clicks ?? "",
  ].join("|");
  // Small deterministic FNV-1a hash — no crypto dependency, stable across runs.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

interface ActiveSnap {
  id: string; platform: string; periodStart: string | null; periodEnd: string | null;
  spend: number | null; sourceHash?: string | null;
}

const money = (v: number | null | undefined) => (v == null ? "—" : "$" + Math.round(Number(v)).toLocaleString());

export function reconcileMarketingSnapshot(
  active: ActiveSnap[],
  incoming: { platform: string; periodStart: string | null; periodEnd: string | null; spend: number | null; sourceHash: string },
): { action: Extract<ReconAction, "ADDED" | "SUPERSEDED" | "DISREGARDED">; supersedeIds: string[]; decision: ReconDecision } {
  const plat = String(incoming.platform || "").toUpperCase();
  const key = `${plat} ${incoming.periodStart ?? "?"}..${incoming.periodEnd ?? "?"}`;
  const samePeriod = (active || []).filter(
    (s) => String(s.platform || "").toUpperCase() === plat && (s.periodStart ?? "") === (incoming.periodStart ?? "") && (s.periodEnd ?? "") === (incoming.periodEnd ?? ""),
  );

  if (samePeriod.some((s) => s.sourceHash && s.sourceHash === incoming.sourceHash)) {
    return {
      action: "DISREGARDED", supersedeIds: [],
      decision: { action: "DISREGARDED", reason: `Identical data already ingested for ${key} — no change (duplicate upload).` },
    };
  }
  if (samePeriod.length) {
    const prior = samePeriod[0];
    return {
      action: "SUPERSEDED", supersedeIds: samePeriod.map((s) => s.id),
      decision: {
        action: "SUPERSEDED", field: "spend", oldValue: money(prior.spend), newValue: money(incoming.spend),
        reason: `Re-upload for ${key} — replaced prior ${money(prior.spend)} with ${money(incoming.spend)} (old kept for audit).`,
      },
    };
  }
  return {
    action: "ADDED", supersedeIds: [],
    decision: { action: "ADDED", field: "spend", newValue: money(incoming.spend), reason: `New: ${key} ${money(incoming.spend)} added.` },
  };
}

// Field-level record merge (for P&L month / balance sheet). `incomingNewer`
// controls who wins when BOTH values are present and differ.
export function reconcileFields<T extends Record<string, any>>(
  existing: T | null | undefined,
  incoming: Partial<T>,
  opts: { fields: (keyof T)[]; incomingNewer?: boolean; labelKey?: string } = { fields: [] },
): { merged: T; decisions: ReconDecision[] } {
  const incomingNewer = opts.incomingNewer !== false; // default: incoming is newer
  const merged: any = { ...(existing || {}) };
  const decisions: ReconDecision[] = [];
  const label = opts.labelKey ? `${String((incoming as any)[opts.labelKey] ?? (existing as any)?.[opts.labelKey] ?? "")} ` : "";

  for (const f of opts.fields) {
    const oldV = existing ? (existing as any)[f] : undefined;
    const newV = (incoming as any)[f];
    const hasOld = oldV != null && oldV !== "";
    const hasNew = newV != null && newV !== "";

    if (!hasNew) {
      // incoming is null/missing — NEVER overwrite a real existing value
      if (hasOld) decisions.push({ action: "KEPT", field: String(f), oldValue: String(oldV), reason: `${label}${String(f)}: kept existing (${oldV}); new upload had no value.` });
      continue;
    }
    if (!hasOld) {
      merged[f] = newV;
      decisions.push({ action: "ADDED", field: String(f), newValue: String(newV), reason: `${label}${String(f)}: added ${newV} (was empty).` });
      continue;
    }
    if (String(oldV) === String(newV)) continue; // unchanged
    if (incomingNewer) {
      merged[f] = newV;
      decisions.push({ action: "UPDATED", field: String(f), oldValue: String(oldV), newValue: String(newV), reason: `${label}${String(f)}: updated ${oldV} → ${newV} (newer source).` });
    } else {
      decisions.push({ action: "KEPT", field: String(f), oldValue: String(oldV), newValue: String(newV), reason: `${label}${String(f)}: kept existing ${oldV} (more relevant than ${newV}).` });
    }
  }
  return { merged, decisions };
}
