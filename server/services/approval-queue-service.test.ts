/**
 * Approval Queue — unit tests (mocked deps, zero DB).
 *
 * Covers the contract the queue lives on:
 *   - each source aggregates with its full evidence attached
 *   - approveAction maps to the EXISTING endpoint (method + path + payload) —
 *     never a new write path; items with no endpoint render a manual step
 *   - latest-state semantics: a later CORRECTED/EXPLAINED ledger row (or an
 *     already-moved item cost) resolves the proposal — no zombie items
 *   - the >$25K Stacy-approval flag on PO evidence
 *   - stale-bank thresholds (>3d) and the no-entry case
 *   - truth checks map only when they name a human action (V3/LEDGER excluded)
 *   - empty-queue state and per-source failure = stated problem, never silence
 */
import { describe, it, expect } from "vitest";
import {
  reconQueueItem,
  driftQueueItem,
  poQueueItem,
  staleBankItem,
  truthQueueItem,
  getApprovalQueue,
  STACY_APPROVAL_THRESHOLD,
  BANK_STALE_AFTER_DAYS,
  type ApprovalQueueDeps,
  type ReconRow,
} from "./approval-queue-service";
import type { TruthCheck } from "./truth-monitor-service";

const NOW = new Date("2026-07-17T12:00:00Z");

const reconRow = (over: Partial<ReconRow> = {}): ReconRow => ({
  id: "r1",
  data_type: "auto_scraped_cost",
  entity_key: "SBR-1.0",
  action: "PROPOSED",
  field: "defaultPurchaseCost",
  old_value: "10",
  new_value: "12.5",
  reason: "Auto-scraped price $12.5 is 25.0% off prior cost $10 (beyond ±15%, within ±40%) — human confirmation required before applying",
  source: "https://supplier.example/item",
  created_at: "2026-07-16T00:00:00Z",
  ...over,
});

// ─── 1. recon PROPOSED (scraped-cost confirmations) ──────────────────────────

describe("reconQueueItem (scraped-cost confirmations)", () => {
  it("maps to the EXISTING item PATCH endpoint with the proposed cost as payload", () => {
    const qi = reconQueueItem(reconRow(), { id: "item-9", defaultPurchaseCost: 10 })!;
    expect(qi.kind).toBe("recon_proposed");
    expect(qi.approveAction).toEqual(expect.objectContaining({
      method: "PATCH",
      path: "/api/items/item-9",
      payload: { defaultPurchaseCost: 12.5 },
    }));
    expect(qi.manualStep).toBeNull();
    expect(qi.dismissable).toBe(true);
  });

  it("carries the reason text verbatim in the evidence (the math is already in it)", () => {
    const row = reconRow();
    const qi = reconQueueItem(row, { id: "item-9", defaultPurchaseCost: 10 })!;
    expect(qi.evidence.reason).toBe(row.reason);
    expect(qi.evidence.oldValue).toBe("10");
    expect(qi.evidence.newValue).toBe("12.5");
    expect(qi.source).toContain("data_reconciliation_log");
    expect(qi.asOf).toBe("2026-07-16T00:00:00Z");
  });

  it("resolves (no item) when the item's cost already moved off the prior value — a human decided elsewhere", () => {
    expect(reconQueueItem(reconRow(), { id: "item-9", defaultPurchaseCost: 12.5 })).toBeNull();
    expect(reconQueueItem(reconRow(), { id: "item-9", defaultPurchaseCost: 11 })).toBeNull();
  });

  it("renders a manual step when the item cannot be found — the tap has no valid target", () => {
    const qi = reconQueueItem(reconRow(), null)!;
    expect(qi.approveAction).toBeNull();
    expect(qi.manualStep?.instructions).toContain("not found");
  });

  it("non-scraped data types have no one-tap endpoint → manual step, never a new write path", () => {
    const qi = reconQueueItem(reconRow({ data_type: "marketing_spend", entity_key: "META 2026-05" }), null)!;
    expect(qi.approveAction).toBeNull();
    expect(qi.manualStep?.instructions).toContain("No one-tap endpoint");
    expect(qi.evidence.reason).toBeTruthy();
  });
});

// ─── 2. inventory-drift Review/Fix pending ───────────────────────────────────

describe("driftQueueItem (PROPOSED beyond auto-cap)", () => {
  const row = reconRow({
    data_type: "inventory_drift",
    entity_key: "SBR-PUSH 1.0",
    field: "available_for_sale_qty",
    old_value: "120",
    new_value: "80",
    reason: "Residual -40 beyond auto-cap 25; flagged for human review.",
    source: "inventory-drift-resolver",
  });

  it("maps to the EXISTING FinOps per-SKU approve endpoint with the SKU encoded", () => {
    const qi = driftQueueItem(row);
    expect(qi.kind).toBe("inventory_drift");
    expect(qi.approveAction?.method).toBe("POST");
    expect(qi.approveAction?.path).toBe("/api/system-integrity/resolve-inventory?sku=SBR-PUSH%201.0&apply=true");
    expect(qi.approveAction?.payload).toBeNull();
    expect(qi.manualStep).toBeNull();
  });

  it("evidence is the resolver's check output: current/target afs, signed correction, reason verbatim", () => {
    const qi = driftQueueItem(row);
    expect(qi.evidence).toEqual(expect.objectContaining({
      sku: "SBR-PUSH 1.0",
      currentAfs: 120,
      targetAfs: 80,
      correction: -40,
      reason: "Residual -40 beyond auto-cap 25; flagged for human review.",
    }));
  });
});

// ─── 3. draft POs awaiting approval ──────────────────────────────────────────

describe("poQueueItem", () => {
  const lines = [
    { sku: "FRAME-2.0", itemName: "Frame 2.0", qtyOrdered: 100, unitCost: 40, lineTotal: 4000 },
    { sku: "FOAM-2.0", itemName: "Foam 2.0", qtyOrdered: 100, unitCost: 15, lineTotal: 1500 },
  ];
  const po = (over: any = {}) => ({
    id: "po-1", poNumber: "PO-2026-0042", supplierName: "Special FX",
    status: "APPROVAL_PENDING", subtotal: 5500, shippingCost: 300, taxes: 0, total: 5800,
    updatedAt: "2026-07-15T00:00:00Z", ...over,
  });

  it("APPROVAL_PENDING maps to the EXISTING owner-gated approve endpoint", () => {
    const qi = poQueueItem(po(), lines)!;
    expect(qi.approveAction?.method).toBe("POST");
    expect(qi.approveAction?.path).toBe("/api/purchase-orders/po-1/approve");
    expect(qi.approveAction?.gate).toContain("requireRole('owner')");
  });

  it("DRAFT maps to the EXISTING send flow with the emails-the-supplier warning in evidence", () => {
    const qi = poQueueItem(po({ status: "DRAFT" }), lines)!;
    expect(qi.approveAction?.path).toBe("/api/purchase-orders/po-1/send");
    expect(qi.evidence.sendWarning).toContain("supplier");
  });

  it("evidence carries the line math + supplier + totals", () => {
    const qi = poQueueItem(po(), lines)!;
    expect(qi.evidence.lines).toEqual(lines);
    expect(qi.evidence.lineSum).toBe(5500);
    expect(qi.evidence.supplier).toBe("Special FX");
    expect(qi.evidence.total).toBe(5800);
    expect(qi.evidence.shippingCost).toBe(300);
  });

  it(`flags Stacy approval above $${STACY_APPROVAL_THRESHOLD.toLocaleString()} — and not at/below it`, () => {
    const small = poQueueItem(po(), lines)!;
    expect(small.evidence.stacyApprovalRequired).toBe(false);
    const big = poQueueItem(po({ total: 26000 }), lines)!;
    expect(big.evidence.stacyApprovalRequired).toBe(true);
    expect(String(big.evidence.stacyApprovalNote)).toContain("Stacy");
    expect(big.title).toContain(">$25K");
    const exactly = poQueueItem(po({ total: 25000 }), lines)!;
    expect(exactly.evidence.stacyApprovalRequired).toBe(false);
  });

  it("non-pending statuses produce no item", () => {
    for (const status of ["APPROVED", "SENT", "RECEIVED", "CLOSED", "CANCELLED"]) {
      expect(poQueueItem(po({ status }), lines)).toBeNull();
    }
  });
});

// ─── 4. stale bank balance ───────────────────────────────────────────────────

describe("staleBankItem (action item >3d, manual step at the EXISTING entry flow)", () => {
  const nowIso = NOW.toISOString();

  it("fresh entry (≤3d) queues nothing", () => {
    expect(staleBankItem({ cashOnHand: 53185.82, confirmedAt: "2026-07-16T09:00:00Z", stale: false, staleHours: 27 }, nowIso)).toBeNull();
    expect(staleBankItem({ cashOnHand: 1, confirmedAt: "x", stale: false, staleHours: BANK_STALE_AFTER_DAYS * 24 + 23 }, nowIso)).toBeNull();
  });

  it(">3 days old becomes an action item pointing at the existing entry flow — no one-tap (no invented numbers)", () => {
    const qi = staleBankItem({ cashOnHand: 53185.82, confirmedAt: "2026-07-12T09:00:00Z", stale: true, staleHours: 121 }, nowIso)!;
    expect(qi.kind).toBe("stale_bank");
    expect(qi.approveAction).toBeNull();
    expect(qi.manualStep?.href).toBe("/cash-out");
    expect(qi.manualStep?.instructions).toContain("/api/finances/bank-balance");
    expect(qi.evidence).toEqual(expect.objectContaining({ cashOnHand: 53185.82, staleDays: 5 }));
    expect(qi.asOf).toBe("2026-07-12T09:00:00Z");
  });

  it("no entry at all is an item too — a gap is a decision, not a silent nothing", () => {
    const qi = staleBankItem(null, nowIso)!;
    expect(qi.evidence.noFreshEntry).toBe(true);
    expect(qi.manualStep?.href).toBe("/cash-out");
  });
});

// ─── 5. truth checks naming a human action ───────────────────────────────────

describe("truthQueueItem", () => {
  const check = (over: Partial<TruthCheck>): TruthCheck => ({
    id: "V1", name: "Cross-channel order twins", status: "FAIL", summary: "3 twin group(s)", ...over,
  });

  it("V1 FAIL maps to the EXISTING duplicate-order self-heal endpoint", () => {
    const qi = truthQueueItem(check({}), "2026-07-17T06:00:00Z")!;
    expect(qi.kind).toBe("truth_check");
    expect(qi.approveAction?.path).toBe("/api/system-integrity/resolve-sales");
    expect(qi.evidence.summary).toBe("3 twin group(s)");
    expect(qi.asOf).toBe("2026-07-17T06:00:00Z");
  });

  it("V5 staleness is a manual step at the existing upload flow (a gap stays a stated gap)", () => {
    const qi = truthQueueItem(check({ id: "V5-META", name: "Meta feed freshness", status: "WARN", summary: "5d old" }), null)!;
    expect(qi.approveAction).toBeNull();
    expect(qi.manualStep?.href).toBe("/financial-upload?type=ad_spend");
    expect(qi.manualStep?.instructions).toContain("META");
  });

  it("V2b and V4 render manual steps", () => {
    expect(truthQueueItem(check({ id: "V2b", status: "WARN" }), null)!.manualStep).toBeTruthy();
    expect(truthQueueItem(check({ id: "V4", status: "WARN" }), null)!.manualStep?.instructions).toContain("backfill");
  });

  it("PASS checks and automated proofs (V3 / LEDGER) queue nothing — no named human action", () => {
    expect(truthQueueItem(check({ status: "PASS" }), null)).toBeNull();
    expect(truthQueueItem(check({ id: "V3", status: "FAIL" }), null)).toBeNull();
    expect(truthQueueItem(check({ id: "LEDGER", status: "FAIL" }), null)).toBeNull();
  });
});

// ─── orchestrator ────────────────────────────────────────────────────────────

/** db.execute stub keyed by which ledger the SQL targets (drift filters ON the
 *  dataType with `= 'inventory_drift'`; the recon query excludes it with `<>`). */
function dbStub(opts: { recon?: any[]; drift?: any[]; reconThrows?: boolean } = {}) {
  return {
    execute: async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query) ?? "";
      const isDrift = text.includes("= 'inventory_drift'");
      if (!isDrift && opts.reconThrows) throw new Error("recon ledger down");
      return { rows: isDrift ? (opts.drift ?? []) : (opts.recon ?? []) };
    },
  };
}

const makeDeps = (over: Partial<ApprovalQueueDeps> = {}): ApprovalQueueDeps => ({
  storage: {
    getAllPurchaseOrders: async () => [],
    getPurchaseOrderLinesByPOId: async () => [],
    getItemBySku: async () => undefined,
  } as any,
  getBankConfirmedOverride: async () =>
    ({ cashOnHand: 50000, confirmedAt: NOW.toISOString(), stale: false, staleHours: 2 }),
  getLatestTruthReport: async () => null,
  now: () => NOW,
  ...over,
});

describe("getApprovalQueue (orchestrator)", () => {
  it("empty everywhere → empty queue with count 0 and no problems (a real empty, not a dead feed)", async () => {
    const q = await getApprovalQueue(dbStub(), makeDeps());
    expect(q.count).toBe(0);
    expect(q.items).toEqual([]);
    expect(q.problems).toEqual([]);
    expect(q.generatedAt).toBe(NOW.toISOString());
  });

  it("aggregates all five sources into one queue with correct approveAction mapping", async () => {
    const deps = makeDeps({
      storage: {
        getAllPurchaseOrders: async () => [
          { id: "po-1", poNumber: "PO-1", supplierName: "FX", status: "APPROVAL_PENDING", subtotal: 30000, shippingCost: 0, taxes: 0, total: 30000, updatedAt: new Date("2026-07-15") },
          { id: "po-2", poNumber: "PO-2", supplierName: "FX", status: "SENT", subtotal: 100, shippingCost: 0, taxes: 0, total: 100, updatedAt: new Date("2026-07-15") },
        ],
        getPurchaseOrderLinesByPOId: async () => [
          { sku: "FRAME", itemName: "Frame", qtyOrdered: 750, unitCost: 40, lineTotal: 30000 },
        ],
        getItemBySku: async (sku: string) => (sku === "SBR-1.0" ? { id: "item-9", defaultPurchaseCost: 10 } : undefined),
      } as any,
      getBankConfirmedOverride: async () =>
        ({ cashOnHand: 40000, confirmedAt: "2026-07-10T00:00:00Z", stale: true, staleHours: 180 }),
      getLatestTruthReport: async () => ({
        runAt: "2026-07-17T06:00:00Z",
        overall: "FAIL",
        checks: [
          { id: "V1", name: "Cross-channel order twins", status: "FAIL", summary: "2 groups" },
          { id: "V3", name: "Duplicate decrements", status: "PASS", summary: "0" },
          { id: "V5-GOOGLE", name: "Google feed freshness", status: "WARN", summary: "4d old" },
        ],
      }),
    });
    const db = dbStub({
      recon: [reconRow()],
      drift: [reconRow({ data_type: "inventory_drift", entity_key: "SKU-X", old_value: "100", new_value: "60", reason: "Residual -40 beyond auto-cap 25" })],
    });

    const q = await getApprovalQueue(db, deps);
    expect(q.problems).toEqual([]);
    const byKind = Object.fromEntries(q.items.map((i) => [i.id, i]));

    // 1. scraped-cost confirmation → item PATCH
    expect(byKind["recon_proposed:auto_scraped_cost:SBR-1.0"].approveAction?.path).toBe("/api/items/item-9");
    // 2. drift → per-SKU resolve
    expect(byKind["inventory_drift:SKU-X"].approveAction?.path).toBe("/api/system-integrity/resolve-inventory?sku=SKU-X&apply=true");
    // 3. PO pending (SENT po-2 excluded) with Stacy flag + line math
    expect(byKind["po_draft:po-1"].approveAction?.path).toBe("/api/purchase-orders/po-1/approve");
    expect(byKind["po_draft:po-1"].evidence.stacyApprovalRequired).toBe(true);
    expect((byKind["po_draft:po-1"].evidence.lines as any[])[0].lineTotal).toBe(30000);
    expect(byKind["po_draft:po-2"]).toBeUndefined();
    // 4. stale bank (7 days old)
    expect(byKind["stale_bank:entry"].manualStep?.href).toBe("/cash-out");
    // 5. truth checks: V1 one-tap + V5 manual; V3 PASS excluded
    expect(byKind["truth_check:V1"].approveAction?.path).toBe("/api/system-integrity/resolve-sales");
    expect(byKind["truth_check:V5-GOOGLE"].approveAction).toBeNull();
    expect(byKind["truth_check:V3"]).toBeUndefined();

    expect(q.count).toBe(q.items.length);
    expect(q.count).toBe(6);
    // every item carries provenance
    for (const item of q.items) {
      expect(item.source).toBeTruthy();
      expect(item.evidence).toBeTruthy();
    }
  });

  it("latest-state filtering: rows whose newest action is not PROPOSED never queue", async () => {
    const db = dbStub({
      recon: [reconRow({ action: "UPDATED" })],
      drift: [reconRow({ data_type: "inventory_drift", entity_key: "SKU-X", action: "CORRECTED" })],
    });
    const q = await getApprovalQueue(db, makeDeps());
    expect(q.items.filter((i) => i.kind === "recon_proposed" || i.kind === "inventory_drift")).toEqual([]);
  });

  it("a failed source is a STATED problem while the others still aggregate — never a silently-empty queue", async () => {
    const deps = makeDeps({
      storage: {
        getAllPurchaseOrders: async () => { throw new Error("po table down"); },
        getPurchaseOrderLinesByPOId: async () => [],
        getItemBySku: async () => undefined,
      } as any,
      getBankConfirmedOverride: async () => null, // no entry → still queues the bank item
    });
    const q = await getApprovalQueue(dbStub({ reconThrows: true }), deps);
    expect(q.problems.some((p) => p.includes("data_reconciliation_log"))).toBe(true);
    expect(q.problems.some((p) => p.includes("purchase_orders"))).toBe(true);
    expect(q.items.some((i) => i.kind === "stale_bank")).toBe(true);
  });

  it("PO line-read failure states the problem and still queues the PO (evidence lines empty, not invented)", async () => {
    const deps = makeDeps({
      storage: {
        getAllPurchaseOrders: async () => [
          { id: "po-1", poNumber: "PO-1", supplierName: "FX", status: "DRAFT", subtotal: 100, shippingCost: 0, taxes: 0, total: 100, updatedAt: new Date("2026-07-15") },
        ],
        getPurchaseOrderLinesByPOId: async () => { throw new Error("lines down"); },
        getItemBySku: async () => undefined,
      } as any,
    });
    const q = await getApprovalQueue(dbStub(), deps);
    const po = q.items.find((i) => i.id === "po_draft:po-1")!;
    expect(po.evidence.lines).toEqual([]);
    expect(po.approveAction?.path).toBe("/api/purchase-orders/po-1/send");
    expect(q.problems.some((p) => p.includes("PO-1"))).toBe(true);
  });
});
