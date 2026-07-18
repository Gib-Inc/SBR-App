/**
 * Approval Queue — every pending human decision, evidence-attached (Operation CFO, Build 2).
 *
 * READ-ONLY AGGREGATION over the EXISTING approval flows — this service never
 * creates new approval semantics and never writes anything. It collects the
 * decisions already waiting on a human across five sources:
 *
 *   1. data_reconciliation_log action='PROPOSED' (scraped-cost confirmations and
 *      any other proposed corrections) — the reason text carries the math, verbatim.
 *   2. Inventory-drift Review/Fix pending items (drift-resolver PROPOSED beyond
 *      the auto-cap; same ledger, dataType 'inventory_drift') — evidence is the
 *      resolver's own check output.
 *   3. Draft POs awaiting approval (status DRAFT / APPROVAL_PENDING) — evidence is
 *      the line math + supplier + total + the >$25K Stacy-approval flag.
 *   4. Stale bank-confirmed balance (>3 days) — an action item pointing at the
 *      EXISTING bank-balance entry flow (no one-tap can invent a bank number).
 *   5. Latest truth_reports WARN/FAIL checks that name a human action.
 *
 * Each item's approveAction {method, path, payload} describes the EXISTING
 * endpoint a one-tap would call — permission/SoD gates stay server-side on those
 * endpoints exactly where they already live (e.g. PO approve is requireRole
 * 'owner'; bank balance entry is admin/owner). When no existing endpoint covers
 * an item's action, approveAction is null and a manualStep with instructions is
 * rendered instead — NO new mutation endpoints, ever.
 *
 * HONESTY CONTRACT (same as the Daily Verdict): every item carries provenance
 * {source, asOf}; a source that fails to read lands in `problems` as a stated
 * gap — the queue never silently renders "empty" over a dead feed.
 */
import { sql } from "drizzle-orm";
import { storage as defaultStorage } from "../storage";
import { getBankConfirmedOverride, type BankOverride } from "./cash-flow-service";
import { getLatestTruthReport, type TruthCheck, type TruthReport } from "./truth-monitor-service";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── Contract ────────────────────────────────────────────────────────────────

export type ApprovalKind =
  | "recon_proposed"   // data_reconciliation_log PROPOSED (non-drift)
  | "inventory_drift"  // drift-resolver PROPOSED beyond auto-cap (Review/Fix)
  | "po_draft"         // PO awaiting approval / send
  | "stale_bank"       // bank-confirmed balance too old (or absent)
  | "truth_check";     // truth-monitor WARN/FAIL naming a human action

/** The EXISTING endpoint a one-tap approve would call. Never a new write path. */
export interface ApproveAction {
  method: "POST" | "PATCH";
  path: string;
  payload: Record<string, unknown> | null;
  /** Where the permission already lives, server-side — informational, not enforcement. */
  gate: string;
  /** Button copy for the client. */
  label: string;
}

/** Rendered when no existing endpoint covers the action — instructions, not a new endpoint. */
export interface ManualStep {
  instructions: string;
  href: string | null; // existing page/flow, when one exists
}

export interface ApprovalQueueItem {
  id: string; // stable natural key: `${kind}:${entity}`
  kind: ApprovalKind;
  title: string;
  /** Structured evidence — the full payload a human needs to decide. Reason text verbatim. */
  evidence: Record<string, unknown>;
  source: string;   // the canonical table/module the item came from
  asOf: string | null;
  approveAction: ApproveAction | null;
  manualStep: ManualStep | null;
  dismissable: boolean;
}

export interface ApprovalQueue {
  generatedAt: string;
  count: number;
  items: ApprovalQueueItem[];
  /** Per-source read failures — stated gaps, never a silently-empty queue. */
  problems: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** POs above this need Stacy's sign-off (surfaced as an evidence flag — the rule lives with the humans). */
export const STACY_APPROVAL_THRESHOLD = 25_000;
/** A pending recon proposal older than this is stale noise, not a live decision. */
export const RECON_PENDING_WINDOW_DAYS = 60;
/** Bank-confirmed balance older than this becomes an action item (matches the Daily Verdict amber tier). */
export const BANK_STALE_AFTER_DAYS = 3;

const RECON_SOURCE = `data_reconciliation_log (latest state per entity, action='PROPOSED', trailing ${RECON_PENDING_WINDOW_DAYS}d)`;
const DRIFT_SOURCE = "data_reconciliation_log dataType='inventory_drift' (drift-resolver ledger, latest state per SKU)";
const PO_SOURCE = "purchase_orders (status DRAFT / APPROVAL_PENDING) + purchase_order_lines";
const BANK_SOURCE = "bank_balance_entries via cash-flow-service.getBankConfirmedOverride";
const TRUTH_SOURCE = "truth_reports (latest run, truth-monitor-service)";

// ─── 1. Reconciliation-log PROPOSED (non-drift) ──────────────────────────────

export interface ReconRow {
  id: string;
  data_type: string;
  entity_key: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string;
  source: string | null;
  created_at: string | null;
}

/**
 * Pure: one queue item from a still-pending PROPOSED recon row.
 *
 * auto_scraped_cost: the existing gated write path is PATCH /api/items/:id
 * (updateItemSchema-validated) — the human tap IS the confirmation the log row
 * asked for. If the item's cost has already moved off old_value the decision was
 * made elsewhere → resolved, no item. If the item can't be found the tap has no
 * valid target → manual step. Every other data_type has no one-tap endpoint →
 * manual step (fence: no new mutation endpoints).
 */
export function reconQueueItem(
  row: ReconRow,
  item: { id: string; defaultPurchaseCost?: number | null } | null,
): ApprovalQueueItem | null {
  const base = {
    id: `recon_proposed:${row.data_type}:${row.entity_key}`,
    kind: "recon_proposed" as const,
    source: RECON_SOURCE,
    asOf: row.created_at,
    dismissable: true,
    evidence: {
      dataType: row.data_type,
      entityKey: row.entity_key,
      field: row.field,
      oldValue: row.old_value,
      newValue: row.new_value,
      reason: row.reason, // verbatim — the reason text already carries the math
      origin: row.source,
    },
  };

  if (row.data_type === "auto_scraped_cost") {
    const proposed = num(row.new_value);
    const prior = num(row.old_value);
    if (item) {
      const current = item.defaultPurchaseCost ?? null;
      // Cost moved off the prior value → a human already decided; nothing pending.
      if (current != null && Math.abs(current - prior) > 0.005) return null;
      return {
        ...base,
        title: `Confirm scraped cost for ${row.entity_key}: $${prior} → $${proposed}`,
        approveAction: {
          method: "PATCH",
          path: `/api/items/${item.id}`,
          payload: { defaultPurchaseCost: proposed },
          gate: "requireAuth — EXISTING item update endpoint (updateItemSchema-validated); this tap IS the human confirmation the ±15% gate asked for",
          label: `Apply $${proposed}`,
        },
        manualStep: null,
      };
    }
    return {
      ...base,
      title: `Confirm scraped cost for ${row.entity_key}: $${prior} → $${proposed}`,
      approveAction: null,
      manualStep: {
        instructions: `Item ${row.entity_key} not found by SKU — the one-tap has no valid target. Review the proposal and, if correct, set the purchase cost on the item record directly.`,
        href: "/products",
      },
    };
  }

  // No existing endpoint covers other proposed corrections → manual step, never a new write path.
  return {
    ...base,
    title: `Proposed ${row.data_type} correction awaiting review: ${row.entity_key}`,
    approveAction: null,
    manualStep: {
      instructions:
        "No one-tap endpoint exists for this correction — review the reconciliation-ledger evidence above and apply it through the flow that owns this data type.",
      href: null,
    },
  };
}

// ─── 2. Inventory-drift Review/Fix pending ───────────────────────────────────

/**
 * Pure: one queue item from a drift-ledger SKU whose LATEST state is PROPOSED
 * (correction beyond the auto-cap — the resolver refused to apply it silently).
 * The one-tap is the EXISTING FinOps per-SKU approve endpoint, which re-runs the
 * resolver with the cap raised so the human-approved correction actually applies
 * through the InventoryMovement MANUAL_COUNT gateway (audit-logged).
 */
export function driftQueueItem(row: ReconRow): ApprovalQueueItem {
  const currentAfs = row.old_value != null ? num(row.old_value) : null;
  const targetAfs = row.new_value != null ? num(row.new_value) : null;
  const correction = currentAfs != null && targetAfs != null ? targetAfs - currentAfs : null;
  return {
    id: `inventory_drift:${row.entity_key}`,
    kind: "inventory_drift",
    title: `Inventory drift correction pending: ${row.entity_key}${correction != null ? ` (afs ${currentAfs} → ${targetAfs})` : ""}`,
    evidence: {
      sku: row.entity_key,
      field: row.field,
      currentAfs,
      targetAfs,
      correction,
      reason: row.reason, // the resolver's check output, verbatim
      origin: row.source,
    },
    source: DRIFT_SOURCE,
    asOf: row.created_at,
    approveAction: {
      method: "POST",
      path: `/api/system-integrity/resolve-inventory?sku=${encodeURIComponent(row.entity_key)}&apply=true`,
      payload: null,
      gate: "requireAuth — EXISTING FinOps per-SKU approve; applies via the InventoryMovement MANUAL_COUNT gateway (audit-logged), re-verifying drift at tap time",
      label: "Approve correction",
    },
    manualStep: null,
    dismissable: true,
  };
}

// ─── 3. Draft POs awaiting approval ──────────────────────────────────────────

export interface PoLineEvidence {
  sku: string | null;
  itemName: string | null;
  qtyOrdered: number;
  unitCost: number;
  lineTotal: number;
}

/**
 * Pure: one queue item per PO stuck at a human decision.
 *   APPROVAL_PENDING → EXISTING approve endpoint (requireRole 'owner' — the SoD
 *                      gate stays exactly where it lives, server-side).
 *   DRAFT            → EXISTING send flow (the decision on a draft is send-or-kill;
 *                      evidence carries the warning that this emails the supplier).
 * Any other status → not a pending approval, no item.
 */
export function poQueueItem(po: any, lines: PoLineEvidence[]): ApprovalQueueItem | null {
  const status = String(po.status ?? "");
  if (status !== "DRAFT" && status !== "APPROVAL_PENDING") return null;
  const total = num(po.total);
  const lineSum = r2(lines.reduce((t, l) => t + num(l.lineTotal), 0));
  const stacyApprovalRequired = total > STACY_APPROVAL_THRESHOLD;
  const evidence: Record<string, unknown> = {
    poNumber: po.poNumber ?? po.id,
    supplier: po.supplierName ?? null,
    status,
    lines,
    lineSum,
    subtotal: num(po.subtotal),
    shippingCost: num(po.shippingCost),
    taxes: num(po.taxes),
    total,
    stacyApprovalRequired,
    ...(stacyApprovalRequired
      ? { stacyApprovalNote: `total $${Math.round(total).toLocaleString()} exceeds the $${STACY_APPROVAL_THRESHOLD.toLocaleString()} threshold — Stacy must sign off before approval` }
      : {}),
    ...(status === "DRAFT" ? { sendWarning: "approving a DRAFT sends the PO email to the supplier" } : {}),
  };
  const asOf = po.updatedAt ? new Date(po.updatedAt).toISOString() : null;
  const title = `PO ${po.poNumber ?? po.id}${po.supplierName ? ` — ${po.supplierName}` : ""}: $${Math.round(total).toLocaleString()} awaiting ${status === "DRAFT" ? "send" : "approval"}${stacyApprovalRequired ? " (>$25K — Stacy sign-off)" : ""}`;
  if (status === "APPROVAL_PENDING") {
    return {
      id: `po_draft:${po.id}`,
      kind: "po_draft",
      title,
      evidence,
      source: PO_SOURCE,
      asOf,
      approveAction: {
        method: "POST",
        path: `/api/purchase-orders/${po.id}/approve`,
        payload: null,
        gate: "requireAuth + requireRole('owner') — EXISTING PO state machine (APPROVAL_PENDING → APPROVED); non-owners get 403 server-side",
        label: "Approve PO",
      },
      manualStep: null,
      dismissable: true,
    };
  }
  return {
    id: `po_draft:${po.id}`,
    kind: "po_draft",
    title,
    evidence,
    source: PO_SOURCE,
    asOf,
    approveAction: {
      method: "POST",
      path: `/api/purchase-orders/${po.id}/send`,
      payload: null,
      gate: "requireAuth — EXISTING PO send flow (emails the supplier; nothing auto-sends without this tap)",
      label: "Approve & send",
    },
    manualStep: null,
    dismissable: true,
  };
}

// ─── 4. Stale bank balance ───────────────────────────────────────────────────

/**
 * Pure: the bank-confirmed balance as an action item when it's >3 days old (or
 * absent). No one-tap can invent a bank number, so this is always a manual step
 * pointing at the EXISTING admin/owner-gated entry flow on /cash-out.
 */
export function staleBankItem(ov: BankOverride | null, nowIso: string): ApprovalQueueItem | null {
  if (ov) {
    const staleDays = Math.floor(ov.staleHours / 24);
    if (staleDays <= BANK_STALE_AFTER_DAYS) return null;
    return {
      id: "stale_bank:entry",
      kind: "stale_bank",
      title: `Bank balance is ${staleDays} day(s) old — update from the bank`,
      evidence: {
        cashOnHand: ov.cashOnHand,
        confirmedAt: ov.confirmedAt,
        staleDays,
        note: "every cash consumer reads this one number — a stale entry ages the whole picture",
      },
      source: BANK_SOURCE,
      asOf: ov.confirmedAt,
      approveAction: null, // the number must come from the bank, typed by a human
      manualStep: {
        instructions:
          "Enter the live bank-share balance via the EXISTING entry flow (POST /api/finances/bank-balance, admin/owner-gated, append-only audit trail).",
        href: "/cash-out",
      },
      dismissable: true,
    };
  }
  return {
    id: "stale_bank:entry",
    kind: "stale_bank",
    title: "No bank-confirmed balance on file — enter the live bank number",
    evidence: {
      noFreshEntry: true,
      note: "no entry within the freshness window; cash consumers are NOT silently falling back to the lagging QB ledger",
    },
    source: BANK_SOURCE,
    asOf: nowIso,
    approveAction: null,
    manualStep: {
      instructions:
        "Enter the live bank-share balance via the EXISTING entry flow (POST /api/finances/bank-balance, admin/owner-gated, append-only audit trail).",
      href: "/cash-out",
    },
    dismissable: true,
  };
}

// ─── 5. Truth-report checks naming a human action ────────────────────────────

/**
 * Pure: map a WARN/FAIL truth check to a queue item WHEN it names a human action.
 *   V1  → one-tap: EXISTING duplicate-order self-heal endpoint.
 *   V2b → manual: re-upload the corrected spend export (ingest supersedes overlaps).
 *   V4  → manual: guarded qty_shipped backfill.
 *   V5-*→ manual: refresh the platform feed / credentials.
 * V3 and LEDGER are automated-system proofs — a FAIL there is an engineering
 * signal (already surfaced by the Daily Verdict), not a pending approval → null.
 */
export function truthQueueItem(check: TruthCheck, runAt: string | null): ApprovalQueueItem | null {
  if (check.status === "PASS") return null;
  const base = {
    id: `truth_check:${check.id}`,
    kind: "truth_check" as const,
    source: TRUTH_SOURCE,
    asOf: runAt,
    dismissable: true,
    evidence: {
      checkId: check.id,
      name: check.name,
      status: check.status,
      summary: check.summary, // the check output, verbatim
      ...(check.details ? { details: check.details } : {}),
      ...(check.error ? { error: check.error } : {}),
    },
  };
  if (check.id === "V1") {
    return {
      ...base,
      title: `Truth ${check.status} — ${check.name}: run the duplicate-order self-heal`,
      approveAction: {
        method: "POST",
        path: "/api/system-integrity/resolve-sales",
        payload: null,
        gate: "requireAuth — EXISTING system-integrity self-heal (the 2026-06 duplicate-sales cleanup); read-verified before it touches anything",
        label: "Run self-heal",
      },
      manualStep: null,
    };
  }
  if (check.id === "V2b") {
    return {
      ...base,
      title: `Truth ${check.status} — ${check.name}: re-upload the corrected spend export`,
      approveAction: null,
      manualStep: {
        instructions:
          "Overlapping ACTIVE spend windows double-count spend. Re-upload the corrected export for the named platform — the EXISTING ingest supersedes overlapping windows (kept for audit).",
        href: "/financial-upload?type=ad_spend",
      },
    };
  }
  if (check.id === "V4") {
    return {
      ...base,
      title: `Truth ${check.status} — ${check.name}: backfill qty_shipped`,
      approveAction: null,
      manualStep: {
        instructions:
          "Shipped/delivered lines with qty_shipped stuck at 0 skew open-order math. Run the guarded backfill (scripts/backfill-qty-shipped.ts) — no ad-hoc SQL.",
        href: null,
      },
    };
  }
  if (check.id.startsWith("V5")) {
    const platform = check.id.split("-")[1] ?? "the platform";
    return {
      ...base,
      title: `Truth ${check.status} — ${check.name}: refresh the ${platform} feed`,
      approveAction: null,
      manualStep: {
        instructions: `The ${platform} spend feed is stale or absent. Upload a fresh export via the EXISTING ad-spend upload flow, or check the feed credentials. Until then the number reads as a stated gap — never 0.`,
        href: "/financial-upload?type=ad_spend",
      },
    };
  }
  return null; // V3 / LEDGER: automated proofs, no human action to queue
}

// ─── Orchestrator (DB reads only; every source failure is a stated problem) ──

export interface ApprovalQueueDeps {
  storage: Pick<typeof defaultStorage, "getAllPurchaseOrders" | "getPurchaseOrderLinesByPOId" | "getItemBySku">;
  getBankConfirmedOverride: typeof getBankConfirmedOverride;
  getLatestTruthReport: typeof getLatestTruthReport;
  now: () => Date;
}

const defaultDeps: ApprovalQueueDeps = {
  storage: defaultStorage,
  getBankConfirmedOverride,
  getLatestTruthReport,
  now: () => new Date(),
};

/** Latest-state rows per (data_type, entity_key) — a later CORRECTED/EXPLAINED row resolves the proposal. */
const PENDING_RECON_SQL = sql`
  SELECT DISTINCT ON (data_type, entity_key)
         id, data_type, entity_key, action, field, old_value, new_value, reason, source, created_at::text AS created_at
  FROM data_reconciliation_log
  WHERE data_type <> 'inventory_drift'
    AND created_at >= now() - make_interval(days => ${RECON_PENDING_WINDOW_DAYS})
  ORDER BY data_type, entity_key, created_at DESC`;

/** Same latest-state semantics as the existing /api/system-integrity/drift-ledger endpoint. */
const PENDING_DRIFT_SQL = sql`
  SELECT DISTINCT ON (entity_key)
         id, data_type, entity_key, action, field, old_value, new_value, reason, source, created_at::text AS created_at
  FROM data_reconciliation_log
  WHERE data_type = 'inventory_drift'
  ORDER BY entity_key, created_at DESC`;

export async function getApprovalQueue(db: any, deps: ApprovalQueueDeps = defaultDeps): Promise<ApprovalQueue> {
  const nowIso = deps.now().toISOString();
  const items: ApprovalQueueItem[] = [];
  const problems: string[] = [];

  // 1. Recon PROPOSED (non-drift) — scraped-cost confirmations etc.
  try {
    const pending = (rowsOf(await db.execute(PENDING_RECON_SQL)) as ReconRow[])
      .filter((r) => r.action === "PROPOSED");
    for (const row of pending) {
      let item: { id: string; defaultPurchaseCost?: number | null } | null = null;
      if (row.data_type === "auto_scraped_cost") {
        item = (await deps.storage.getItemBySku(row.entity_key).catch(() => null)) as any;
      }
      const qi = reconQueueItem(row, item);
      if (qi) items.push(qi);
    }
  } catch (e: any) {
    problems.push(`data_reconciliation_log unreadable: ${e?.message ?? e}`);
  }

  // 2. Inventory-drift Review/Fix pending (PROPOSED beyond auto-cap).
  try {
    const pending = (rowsOf(await db.execute(PENDING_DRIFT_SQL)) as ReconRow[])
      .filter((r) => r.action === "PROPOSED");
    for (const row of pending) items.push(driftQueueItem(row));
  } catch (e: any) {
    problems.push(`inventory-drift ledger unreadable: ${e?.message ?? e}`);
  }

  // 3. Draft POs awaiting approval.
  try {
    const pos = await deps.storage.getAllPurchaseOrders();
    for (const po of pos) {
      const status = String((po as any).status ?? "");
      if (status !== "DRAFT" && status !== "APPROVAL_PENDING") continue;
      let lines: PoLineEvidence[] = [];
      try {
        lines = (await deps.storage.getPurchaseOrderLinesByPOId((po as any).id)).map((l: any) => ({
          sku: l.sku ?? null,
          itemName: l.itemName ?? null,
          qtyOrdered: num(l.qtyOrdered),
          unitCost: num(l.unitCost),
          lineTotal: num(l.lineTotal),
        }));
      } catch (e: any) {
        problems.push(`PO ${(po as any).poNumber ?? (po as any).id} lines unreadable: ${e?.message ?? e}`);
      }
      const qi = poQueueItem(po, lines);
      if (qi) items.push(qi);
    }
  } catch (e: any) {
    problems.push(`purchase_orders unreadable: ${e?.message ?? e}`);
  }

  // 4. Stale bank balance.
  try {
    const qi = staleBankItem(await deps.getBankConfirmedOverride(db), nowIso);
    if (qi) items.push(qi);
  } catch (e: any) {
    problems.push(`bank_balance_entries unreadable: ${e?.message ?? e}`);
  }

  // 5. Truth-report WARN/FAIL checks naming a human action.
  try {
    const report: TruthReport | null = await deps.getLatestTruthReport();
    if (report) {
      for (const check of report.checks) {
        const qi = truthQueueItem(check, report.runAt || null);
        if (qi) items.push(qi);
      }
    }
  } catch (e: any) {
    problems.push(`truth_reports unreadable: ${e?.message ?? e}`);
  }

  return { generatedAt: nowIso, count: items.length, items, problems };
}
