import { describe, it, expect } from "vitest";
import {
  docNumberFor,
  addDaysToDateString,
  toDateOnlyString,
  computeShopifyDraft,
  computeAmazonDraft,
  evaluateGuards,
  decideDraftAction,
  sumDebitsCredits,
  refundAmountForItem,
  fetchAllQboPages,
  draftDailyJes,
  backfillMissingDailyJes,
  approveProposal,
  redraftProposal,
  reconcileStuckPostingProposals,
  EARLIEST_DRAFT_DATE,
  JE_ACCOUNTS,
  CHANNEL_ENTITY,
  type DraftDeps,
  type ApproveDeps,
  type RedraftDeps,
  type ReconcileDeps,
  type QboPort,
  type OrderRow,
  type RefundRow,
  type ProposalRow,
  type JeLine,
} from "./daily-sales-je-service";

// ── helpers ──────────────────────────────────────────────────────────────

const D = "2026-07-10";

function order(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    channel: "SHOPIFY",
    status: "SHIPPED",
    orderName: "#1001",
    externalOrderId: null,
    totalAmount: 0,
    subtotalAmount: 0,
    taxAmount: 0,
    discountAmount: 0,
    ...over,
  };
}

function refund(over: Partial<RefundRow> = {}): RefundRow {
  return { rmaNumber: "RMA-1", unitPrice: 0, qtyReceived: 0, qtyApproved: 0, qtyRequested: 0, ...over };
}

function lineFor(lines: JeLine[], accountId: string): JeLine | undefined {
  return lines.find((l) => l.JournalEntryLineDetail.AccountRef.value === accountId);
}

/** In-memory DraftDeps with a mockable QBO port and call recording. */
function makeDraftDeps(opts: {
  today?: string;
  orders?: OrderRow[];
  refunds?: RefundRow[];
  existing?: Array<{ id: number; status: string; doc?: string }>;
  /** null = QBO not connected. Partial overrides the clean default port. */
  qbo?: Partial<QboPort> | null;
  /** Last-wins overrides for failure-injection tests. */
  override?: Partial<DraftDeps>;
}) {
  const calls = {
    superseded: [] as number[],
    updatedBlocked: [] as Array<{ id: number; blockReason: string }>,
    inserted: [] as Array<{ docNumber: string; channel: string; status: string; blockReason: string | null; lines: JeLine[]; feeder: Record<string, unknown>; targetDate: string }>,
    qboGets: 0,
  };
  let nextId = 100;
  const deps: DraftDeps = {
    nowMtDate: () => opts.today ?? "2026-07-11",
    fetchOrdersForDay: async () => opts.orders ?? [],
    fetchShopifyRefundsForDay: async () => opts.refunds ?? [],
    getExistingProposals: async (doc) =>
      (opts.existing ?? []).filter((e) => !e.doc || e.doc === doc).map(({ id, status }) => ({ id, status })),
    supersedeProposals: async (ids) => { calls.superseded.push(...ids); },
    updateBlockedProposal: async (id, patch) => { calls.updatedBlocked.push({ id, blockReason: patch.blockReason }); },
    insertProposal: async (p) => { calls.inserted.push(p as any); return nextId++; },
    getQbo: async () => {
      calls.qboGets++;
      return opts.qbo === null
        ? null
        : ({
            findJesByDocNumber: async () => [],
            findA2xJesInPeriod: async () => [],
            postJournalEntry: async () => ({ Id: "999" }),
            ...(opts.qbo ?? {}),
          } as QboPort);
    },
    ...(opts.override ?? {}),
  };
  return { deps, calls };
}

// ── doc number format ────────────────────────────────────────────────────

describe("docNumberFor", () => {
  it("formats SBR-DS-YYMMDD-SH / -AZ exactly (the Jul 10 pattern)", () => {
    expect(docNumberFor("2026-07-10", "SHOPIFY")).toBe("SBR-DS-260710-SH");
    expect(docNumberFor("2026-07-10", "AMAZON")).toBe("SBR-DS-260710-AZ");
    expect(docNumberFor("2026-12-01", "SHOPIFY")).toBe("SBR-DS-261201-SH");
  });
});

describe("addDaysToDateString", () => {
  it("does pure date-string math across month/year bounds", () => {
    expect(addDaysToDateString("2026-07-11", -1)).toBe("2026-07-10");
    expect(addDaysToDateString("2026-08-01", -1)).toBe("2026-07-31");
    expect(addDaysToDateString("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysToDateString("2026-07-31", 1)).toBe("2026-08-01");
  });
});

describe("toDateOnlyString", () => {
  it("recovers YYYY-MM-DD from the local-midnight Date that node-pg parses DATE columns into", () => {
    // pg parses DATE '2026-07-10' as new Date(2026, 6, 10) — local midnight.
    expect(toDateOnlyString(new Date(2026, 6, 10))).toBe("2026-07-10");
    expect(toDateOnlyString("2026-07-10")).toBe("2026-07-10");
    expect(toDateOnlyString("2026-07-10T00:00:00.000Z")).toBe("2026-07-10");
  });
});

// ── Shopify draft math ───────────────────────────────────────────────────

describe("computeShopifyDraft", () => {
  // One order: subtotal(post-discount) 90, discount 10, tax 8, shipping 12 → total 110.
  const baseOrder = order({ totalAmount: 110, subtotalAmount: 90, taxAmount: 8, discountAmount: 10 });

  it("produces the exact Jul-10 line pattern with the right amounts", () => {
    const c = computeShopifyDraft(D, [baseOrder], []);
    expect(c.docNumber).toBe("SBR-DS-260710-SH");
    // Gross Sales = subtotal + discounts + shipping = 90 + 10 + 12 = 112
    const gross = lineFor(c.lines, JE_ACCOUNTS.GROSS_SALES.value)!;
    expect(gross.Amount).toBe(112);
    expect(gross.JournalEntryLineDetail.PostingType).toBe("Credit");
    const disc = lineFor(c.lines, JE_ACCOUNTS.DISCOUNTS.value)!;
    expect(disc.Amount).toBe(10);
    expect(disc.JournalEntryLineDetail.PostingType).toBe("Debit");
    const tax = lineFor(c.lines, JE_ACCOUNTS.SALES_TAX.value)!;
    expect(tax.Amount).toBe(8);
    expect(tax.JournalEntryLineDetail.PostingType).toBe("Credit");
    const ar = lineFor(c.lines, JE_ACCOUNTS.ACCRUED_AR.value)!;
    expect(ar.Amount).toBe(110); // total − refunds(0)
    expect(ar.JournalEntryLineDetail.PostingType).toBe("Debit");
    // No refunds → no Returns and Refunds line at all
    expect(lineFor(c.lines, JE_ACCOUNTS.RETURNS_REFUNDS.value)).toBeUndefined();
    expect(c.balanced).toBe(true);
    expect(c.debitTotal).toBe(120);
    expect(c.creditTotal).toBe(120);
    expect(c.feeder.shippingDerived).toBe(12);
    expect(c.gapBlockReason).toBeNull();
  });

  it("stamps Entity Customer 638 on EVERY line", () => {
    const c = computeShopifyDraft(D, [baseOrder], [refund({ unitPrice: 25, qtyReceived: 1 })]);
    for (const l of c.lines) {
      expect(l.JournalEntryLineDetail.Entity).toEqual({ Type: "Customer", EntityRef: { value: CHANNEL_ENTITY.SHOPIFY } });
    }
  });

  it("books refunds refunded that day and nets them out of AR", () => {
    const c = computeShopifyDraft(D, [baseOrder], [refund({ unitPrice: 25, qtyReceived: 1 })]);
    expect(lineFor(c.lines, JE_ACCOUNTS.RETURNS_REFUNDS.value)!.Amount).toBe(25);
    expect(lineFor(c.lines, JE_ACCOUNTS.RETURNS_REFUNDS.value)!.JournalEntryLineDetail.PostingType).toBe("Debit");
    expect(lineFor(c.lines, JE_ACCOUNTS.ACCRUED_AR.value)!.Amount).toBe(85); // 110 − 25
    expect(c.balanced).toBe(true);
  });

  it("omits zero lines (discounts and refunds at 0 do not appear)", () => {
    const c = computeShopifyDraft(D, [order({ totalAmount: 108, subtotalAmount: 100, taxAmount: 8, discountAmount: 0 })], []);
    expect(lineFor(c.lines, JE_ACCOUNTS.DISCOUNTS.value)).toBeUndefined();
    expect(lineFor(c.lines, JE_ACCOUNTS.RETURNS_REFUNDS.value)).toBeUndefined();
    expect(c.lines).toHaveLength(3); // gross, tax, AR
    expect(c.balanced).toBe(true);
  });

  it("a refunds-only day flips AR to a Credit (QBO rejects negative amounts)", () => {
    const c = computeShopifyDraft(D, [], [refund({ unitPrice: 50, qtyReceived: 1 })]);
    const ret = lineFor(c.lines, JE_ACCOUNTS.RETURNS_REFUNDS.value)!;
    expect(ret.Amount).toBe(50);
    expect(ret.JournalEntryLineDetail.PostingType).toBe("Debit");
    const ar = lineFor(c.lines, JE_ACCOUNTS.ACCRUED_AR.value)!;
    expect(ar.Amount).toBe(50);
    expect(ar.JournalEntryLineDetail.PostingType).toBe("Credit"); // flipped: 0 − 50
    expect(c.balanced).toBe(true);
    expect(c.hasActivity).toBe(true);
  });

  it("no orders and no refunds → no activity, zero lines", () => {
    const c = computeShopifyDraft(D, [], []);
    expect(c.hasActivity).toBe(false);
    expect(c.lines).toHaveLength(0);
    expect(c.gapBlockReason).toBeNull();
  });

  it("a NULL subtotal/tax BLOCKS the draft — the gap is named, nothing is filled with $0", () => {
    const c = computeShopifyDraft(D, [order({ totalAmount: 100, subtotalAmount: null, taxAmount: null, discountAmount: 0 })], []);
    expect(c.gapBlockReason).toMatch(/Data gap/);
    expect(c.gapBlockReason).toMatch(/1 of 1 order\(s\)/);
    expect(c.gapBlockReason).toMatch(/subtotal_amount: 1/);
    expect(c.gapBlockReason).toMatch(/tax_amount: 1/);
    expect(c.gapBlockReason).toMatch(/not available/);
    // NO lines — there is nothing plausible to approve.
    expect(c.lines).toHaveLength(0);
    // Gapped feeder figures read "not available" (null), never a fabricated $0…
    expect(c.feeder.subtotal).toBeNull();
    expect(c.feeder.tax).toBeNull();
    expect(c.feeder.shippingDerived).toBeNull();
    expect(c.feeder.grossSalesComputed).toBeNull();
    // …while ungapped facts stay visible.
    expect(c.feeder.total).toBe(100);
    expect(c.feeder.discounts).toBe(0);
    expect(c.feeder.ordersMissingSubtotal).toBe(1);
    expect(c.feeder.ordersMissingTax).toBe(1);
    expect(c.feeder.gappedOrderNames).toEqual(["#1001"]);
    // A gapped day is NOT a skippable no-activity day — it must surface.
    expect(c.hasActivity).toBe(true);
  });

  it("NULL total and NULL discount block too — every input the math needs is required", () => {
    const c = computeShopifyDraft(D, [order({ totalAmount: null, subtotalAmount: 90, taxAmount: 8, discountAmount: null })], []);
    expect(c.gapBlockReason).toMatch(/total_amount: 1/);
    expect(c.gapBlockReason).toMatch(/discount_amount: 1/);
    expect(c.feeder.total).toBeNull();
    expect(c.feeder.discounts).toBeNull();
    expect(c.feeder.accruedArComputed).toBeNull();
    expect(c.lines).toHaveLength(0);
  });

  it("a refund line with quantity but NULL unit_price blocks (refund $ cannot be invented)", () => {
    const c = computeShopifyDraft(
      D,
      [order({ totalAmount: 110, subtotalAmount: 90, taxAmount: 8, discountAmount: 10 })],
      [refund({ unitPrice: null, qtyReceived: 2 })],
    );
    expect(c.gapBlockReason).toMatch(/1 refund line\(s\) missing unit_price/);
    expect(c.feeder.refunds).toBeNull();
    expect(c.feeder.accruedArComputed).toBeNull();
    expect(c.lines).toHaveLength(0);
  });

  it("a zero-quantity refund line with NULL unit_price is NOT a gap (nothing was refunded on it)", () => {
    const c = computeShopifyDraft(
      D,
      [order({ totalAmount: 110, subtotalAmount: 90, taxAmount: 8, discountAmount: 10 })],
      [refund({ unitPrice: null, qtyReceived: 0, qtyApproved: 0, qtyRequested: 0 })],
    );
    expect(c.gapBlockReason).toBeNull();
    expect(c.balanced).toBe(true);
  });

  it("sums many orders and stays balanced to the cent", () => {
    const orders = [
      order({ totalAmount: 53.97, subtotalAmount: 44.99, taxAmount: 3.99, discountAmount: 5.0 }),
      order({ totalAmount: 107.94, subtotalAmount: 89.98, taxAmount: 7.98, discountAmount: 0 }),
      order({ totalAmount: 26.49, subtotalAmount: 21.5, taxAmount: 1.99, discountAmount: 2.39 }),
    ];
    const c = computeShopifyDraft(D, orders, [refund({ unitPrice: 21.5, qtyApproved: 1 })]);
    expect(c.balanced).toBe(true);
    expect(c.debitTotal).toBe(c.creditTotal);
    expect(lineFor(c.lines, JE_ACCOUNTS.ACCRUED_AR.value)!.Amount).toBe(
      Math.round((53.97 + 107.94 + 26.49 - 21.5) * 100) / 100,
    );
  });
});

// ── Amazon draft math ────────────────────────────────────────────────────

describe("computeAmazonDraft", () => {
  it("books revenue EX-TAX only (marketplace facilitator) into Gross Sales vs Amazon Reserves", () => {
    const orders = [
      order({ channel: "AMAZON", totalAmount: 100, taxAmount: 7 }),
      order({ channel: "AMAZON", totalAmount: 50, taxAmount: 0 }),
    ];
    const c = computeAmazonDraft(D, orders);
    expect(c.docNumber).toBe("SBR-DS-260710-AZ");
    expect(c.lines).toHaveLength(2); // never an ads line — Amazon fees arrive as Bills
    const gross = lineFor(c.lines, JE_ACCOUNTS.GROSS_SALES.value)!;
    expect(gross.Amount).toBe(143); // (100−7) + (50−0)
    expect(gross.JournalEntryLineDetail.PostingType).toBe("Credit");
    const reserves = lineFor(c.lines, JE_ACCOUNTS.AMAZON_RESERVES.value)!;
    expect(reserves.Amount).toBe(143);
    expect(reserves.JournalEntryLineDetail.PostingType).toBe("Debit");
    expect(c.balanced).toBe(true);
    expect(c.feeder.revenueExTax).toBe(143);
    expect(c.gapBlockReason).toBeNull();
    for (const l of c.lines) {
      expect(l.JournalEntryLineDetail.Entity).toEqual({ Type: "Customer", EntityRef: { value: CHANNEL_ENTITY.AMAZON } });
    }
  });

  it("a NULL total or tax BLOCKS the Amazon draft the same way", () => {
    const c = computeAmazonDraft(D, [
      order({ channel: "AMAZON", totalAmount: 100, taxAmount: null }),
      order({ channel: "AMAZON", totalAmount: 50, taxAmount: 4 }),
    ]);
    expect(c.gapBlockReason).toMatch(/Data gap/);
    expect(c.gapBlockReason).toMatch(/tax_amount: 1/);
    expect(c.lines).toHaveLength(0);
    expect(c.feeder.taxExcluded).toBeNull();
    expect(c.feeder.revenueExTax).toBeNull();
    expect(c.feeder.total).toBe(150); // ungapped fact still visible
    expect(c.hasActivity).toBe(true);
  });

  it("no Amazon orders → no activity", () => {
    const c = computeAmazonDraft(D, []);
    expect(c.hasActivity).toBe(false);
    expect(c.lines).toHaveLength(0);
  });
});

// ── refund precedence + balance helper ───────────────────────────────────

describe("refundAmountForItem", () => {
  it("uses qtyReceived, then qtyApproved, then qtyRequested (scheduler parity)", () => {
    expect(refundAmountForItem(refund({ unitPrice: 10, qtyReceived: 2, qtyApproved: 5, qtyRequested: 9 }))).toBe(20);
    expect(refundAmountForItem(refund({ unitPrice: 10, qtyReceived: 0, qtyApproved: 3, qtyRequested: 9 }))).toBe(30);
    expect(refundAmountForItem(refund({ unitPrice: 10, qtyReceived: 0, qtyApproved: 0, qtyRequested: 4 }))).toBe(40);
    expect(refundAmountForItem(refund({ unitPrice: null, qtyReceived: 2 }))).toBe(0);
  });
});

describe("sumDebitsCredits", () => {
  it("detects an unbalanced entry to the cent", () => {
    const c = computeShopifyDraft(D, [order({ totalAmount: 110, subtotalAmount: 90, taxAmount: 8, discountAmount: 10 })], []);
    const tampered = JSON.parse(JSON.stringify(c.lines)) as JeLine[];
    tampered[0].Amount += 0.01;
    expect(sumDebitsCredits(c.lines).balanced).toBe(true);
    expect(sumDebitsCredits(tampered).balanced).toBe(false);
  });
});

// ── QBO pagination (fail-closed) ─────────────────────────────────────────

describe("fetchAllQboPages", () => {
  it("drains multiple pages with QBO STARTPOSITION semantics", async () => {
    const starts: number[] = [];
    const r = await fetchAllQboPages(async (start) => {
      starts.push(start);
      if (start === 1) return ["a", "b", "c"];
      if (start === 4) return ["d"];
      return [];
    }, 3, 10);
    expect(r).toEqual(["a", "b", "c", "d"]);
    expect(starts).toEqual([1, 4]); // page 2 starts at pageSize + 1
  });

  it("FAILS CLOSED when the page cap is hit while pages are still full (no silent truncation)", async () => {
    await expect(fetchAllQboPages(async () => ["x", "y", "z"], 3, 2)).rejects.toThrow(/truncated/);
  });
});

// ── guards + supersede decisions ─────────────────────────────────────────

describe("evaluateGuards", () => {
  const base = { docNumber: "SBR-DS-260710-SH", docNumberMatches: [], a2xEntries: [], qboAvailable: true };

  it("clean → null (safe to leave pending)", () => {
    expect(evaluateGuards(base)).toBeNull();
  });

  it("doc number already in QBO → blocked as already posted", () => {
    const r = evaluateGuards({ ...base, docNumberMatches: [{ Id: "18590" }] });
    expect(r).toMatch(/Already posted/);
    expect(r).toMatch(/18590/);
  });

  it("A2X entries in the period → blocked with double-count explanation", () => {
    const r = evaluateGuards({ ...base, a2xEntries: [{ Id: "7", DocNumber: "A2XSH-2026-07", TxnDate: "2026-07-31" }] });
    expect(r).toMatch(/A2X/);
    expect(r).toMatch(/double-count/);
  });

  it("QBO unavailable → blocked, never drafted as verified", () => {
    const r = evaluateGuards({ ...base, qboAvailable: false });
    expect(r).toMatch(/could not run/);
  });
});

describe("decideDraftAction", () => {
  it("posted proposal is final", () => {
    expect(decideDraftAction([{ id: 1, status: "approved_posted" }])).toEqual({ action: "skip", reason: "already_posted" });
  });
  it("a 'posting' row (approve mid-flight) is strictly hands-off", () => {
    expect(decideDraftAction([{ id: 1, status: "posting" }])).toEqual({ action: "skip", reason: "posting" });
  });
  it("human rejection is respected", () => {
    expect(decideDraftAction([{ id: 1, status: "rejected" }])).toEqual({ action: "skip", reason: "rejected" });
  });
  it("pending rows get superseded by a fresh draft", () => {
    const d = decideDraftAction([{ id: 4, status: "pending" }, { id: 9, status: "superseded" }]);
    expect(d).toEqual({ action: "draft", supersedeIds: [4], blockedIdToUpdate: null });
  });
  it("the LATEST blocked row is refreshed in place; older blocked twins are retired", () => {
    const d = decideDraftAction([{ id: 3, status: "blocked" }, { id: 6, status: "blocked" }]);
    expect(d).toEqual({ action: "draft", supersedeIds: [3], blockedIdToUpdate: 6 });
  });
  it("onlyIfMissing skips when a live pending draft exists (boot backfill must not churn)", () => {
    expect(decideDraftAction([{ id: 4, status: "pending" }], { onlyIfMissing: true })).toEqual({ action: "skip", reason: "exists" });
    // …but a blocked-only date is still re-evaluated so transient failures self-heal
    const d = decideDraftAction([{ id: 5, status: "blocked" }], { onlyIfMissing: true });
    expect(d.action).toBe("draft");
  });
});

// ── draftDailyJes (injected deps; QBO client mocked) ─────────────────────

const shopifyDay = [order({ totalAmount: 110, subtotalAmount: 90, taxAmount: 8, discountAmount: 10 })];
const amazonDay = [order({ channel: "AMAZON", orderName: "111-222", totalAmount: 100, taxAmount: 7 })];

describe("draftDailyJes", () => {
  it("refuses dates on/before 2026-07-09 (those JEs were posted by hand)", async () => {
    const { deps, calls } = makeDraftDeps({ today: "2026-07-15", orders: shopifyDay });
    const r = await draftDailyJes("2026-07-09", undefined, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/double-book/);
    expect(calls.inserted).toHaveLength(0);
    expect(EARLIEST_DRAFT_DATE).toBe("2026-07-10");
  });

  it("refuses today / future (MT day not complete)", async () => {
    const { deps, calls } = makeDraftDeps({ today: "2026-07-15", orders: shopifyDay });
    const r = await draftDailyJes("2026-07-15", undefined, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not complete/);
    expect(calls.inserted).toHaveLength(0);
  });

  it("defaults to yesterday MT", async () => {
    const { deps } = makeDraftDeps({ today: "2026-07-15" });
    const r = await draftDailyJes(undefined, undefined, deps);
    expect(r.targetDate).toBe("2026-07-14");
  });

  it("drafts one PENDING proposal per active channel with the exact doc numbers — and never posts", async () => {
    let posted = 0;
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-11",
      orders: [...shopifyDay, ...amazonDay],
      qbo: { postJournalEntry: async () => { posted++; return { Id: "X" }; } },
    });
    const r = await draftDailyJes("2026-07-10", undefined, deps);
    expect(r.ok).toBe(true);
    expect(calls.inserted.map((p) => [p.docNumber, p.status])).toEqual([
      ["SBR-DS-260710-SH", "pending"],
      ["SBR-DS-260710-AZ", "pending"],
    ]);
    expect(posted).toBe(0); // the scheduler path NEVER writes to QBO
  });

  it("skips a channel with no activity", async () => {
    const { deps, calls } = makeDraftDeps({ today: "2026-07-11", orders: shopifyDay });
    const r = await draftDailyJes("2026-07-10", undefined, deps);
    expect(r.channels.find((c) => c.channel === "AMAZON")!.outcome).toBe("skipped_no_activity");
    expect(calls.inserted).toHaveLength(1);
  });

  it("a gapped day (NULL tax) is stored BLOCKED with the gap named — even when QBO is clean", async () => {
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-11",
      orders: [order({ totalAmount: 100, subtotalAmount: null, taxAmount: null, discountAmount: 0 })],
    });
    const r = await draftDailyJes("2026-07-10", undefined, deps);
    const sh = r.channels.find((c) => c.channel === "SHOPIFY")!;
    expect(sh.outcome).toBe("drafted_blocked");
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0].status).toBe("blocked");
    expect(calls.inserted[0].blockReason).toMatch(/Data gap/);
    expect(calls.inserted[0].blockReason).toMatch(/tax_amount: 1/);
    expect(calls.inserted[0].blockReason).toMatch(/subtotal_amount: 1/);
    expect(calls.inserted[0].lines).toHaveLength(0); // nothing approvable was stored
    expect((calls.inserted[0].feeder as any).tax).toBeNull(); // UI shows "—", not $0
  });

  it("CANCELLED orders are excluded (and counted in the feeder); REFUNDED orders stay in", async () => {
    const orders = [
      order({ id: "1", orderName: "#A", totalAmount: 110, subtotalAmount: 90, taxAmount: 8, discountAmount: 10 }),
      order({ id: "2", orderName: "#B", status: "CANCELLED", totalAmount: 50, subtotalAmount: 45, taxAmount: 5, discountAmount: 0 }),
      order({ id: "3", orderName: "#C", status: "REFUNDED", totalAmount: 108, subtotalAmount: 100, taxAmount: 8, discountAmount: 0 }),
    ];
    const { deps, calls } = makeDraftDeps({ today: "2026-07-11", orders });
    await draftDailyJes("2026-07-10", undefined, deps);
    const f = calls.inserted[0].feeder as any;
    expect(f.orders).toBe(2);                 // #A + #C — the sale side of a refunded
    expect(f.total).toBe(218);                // order books; its refund books via Dr 25
    expect(f.ordersExcludedCancelled).toBe(1);
    expect(f.excludedCancelledOrderNames).toEqual(["#B"]);
  });

  it("A2X present in the period → proposals are created BLOCKED", async () => {
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-11",
      orders: [...shopifyDay, ...amazonDay],
      qbo: { findA2xJesInPeriod: async () => [{ Id: "7", DocNumber: "A2XSH-JUL", TxnDate: "2026-07-31" }] },
    });
    const r = await draftDailyJes("2026-07-10", undefined, deps);
    expect(r.channels.every((c) => c.outcome === "drafted_blocked")).toBe(true);
    expect(calls.inserted.every((p) => p.status === "blocked" && /A2X/.test(p.blockReason ?? ""))).toBe(true);
  });

  it("doc number already in QBO → blocked as already posted", async () => {
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-11",
      orders: shopifyDay,
      qbo: { findJesByDocNumber: async (doc) => (doc === "SBR-DS-260710-SH" ? [{ Id: "18590" }] : []) },
    });
    await draftDailyJes("2026-07-10", undefined, deps);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0].status).toBe("blocked");
    expect(calls.inserted[0].blockReason).toMatch(/Already posted/);
  });

  it("QBO not connected → blocked (guards could not run), not silently pending", async () => {
    const { deps, calls } = makeDraftDeps({ today: "2026-07-11", orders: shopifyDay, qbo: null });
    await draftDailyJes("2026-07-10", undefined, deps);
    expect(calls.inserted[0].status).toBe("blocked");
    expect(calls.inserted[0].blockReason).toMatch(/could not run/);
  });

  it("supersedes a prior pending proposal for the same doc number", async () => {
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-11",
      orders: shopifyDay,
      existing: [{ id: 7, status: "pending", doc: "SBR-DS-260710-SH" }],
    });
    await draftDailyJes("2026-07-10", undefined, deps);
    expect(calls.superseded).toContain(7);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0].status).toBe("pending");
  });

  it("skips entirely when already posted / human-rejected", async () => {
    for (const status of ["approved_posted", "rejected"]) {
      const { deps, calls } = makeDraftDeps({
        today: "2026-07-11",
        orders: shopifyDay,
        existing: [{ id: 7, status, doc: "SBR-DS-260710-SH" }],
      });
      const r = await draftDailyJes("2026-07-10", undefined, deps);
      expect(calls.inserted).toHaveLength(0);
      expect(calls.superseded).toHaveLength(0);
      expect(r.channels.find((c) => c.channel === "SHOPIFY")!.outcome).toBe(
        status === "approved_posted" ? "skipped_already_posted" : "skipped_rejected",
      );
    }
  });

  it("a doc number with a 'posting' row (approve in flight) is left strictly alone", async () => {
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-11",
      orders: shopifyDay,
      existing: [{ id: 7, status: "posting", doc: "SBR-DS-260710-SH" }],
    });
    const r = await draftDailyJes("2026-07-10", undefined, deps);
    expect(r.channels.find((c) => c.channel === "SHOPIFY")!.outcome).toBe("skipped_posting");
    expect(calls.superseded).toHaveLength(0);
    expect(calls.inserted).toHaveLength(0);
  });

  it("never touches QBO when every channel skips (keeps the nightly sweep cheap)", async () => {
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-11",
      orders: [...shopifyDay, ...amazonDay],
      existing: [{ id: 1, status: "approved_posted" }], // matches every doc number
    });
    await draftDailyJes("2026-07-10", undefined, deps);
    expect(calls.qboGets).toBe(0);
  });

  it("refreshes a standing blocked row in place instead of stacking new rows", async () => {
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-11",
      orders: shopifyDay,
      existing: [{ id: 5, status: "blocked", doc: "SBR-DS-260710-SH" }],
      qbo: null, // still blocked
    });
    await draftDailyJes("2026-07-10", undefined, deps);
    expect(calls.updatedBlocked).toHaveLength(1);
    expect(calls.updatedBlocked[0].id).toBe(5);
    expect(calls.inserted).toHaveLength(0);
  });

  it("retires OLDER duplicate blocked rows (two-process race artifacts) while refreshing the latest", async () => {
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-11",
      orders: shopifyDay,
      existing: [
        { id: 3, status: "blocked", doc: "SBR-DS-260710-SH" },
        { id: 5, status: "blocked", doc: "SBR-DS-260710-SH" },
      ],
      qbo: null, // still blocked
    });
    await draftDailyJes("2026-07-10", undefined, deps);
    expect(calls.superseded).toEqual([3]);
    expect(calls.updatedBlocked.map((u) => u.id)).toEqual([5]);
  });

  it("when the block clears, retires the blocked row and inserts a fresh pending", async () => {
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-11",
      orders: shopifyDay,
      existing: [{ id: 5, status: "blocked", doc: "SBR-DS-260710-SH" }],
      // clean QBO now
    });
    await draftDailyJes("2026-07-10", undefined, deps);
    expect(calls.superseded).toContain(5);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0].status).toBe("pending");
  });

  it("a channel that THROWS leaves a visible BLOCKED trace row, not a silent hole", async () => {
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-11",
      orders: shopifyDay,
      existing: [{ id: 7, status: "pending", doc: "SBR-DS-260710-SH" }],
      override: { supersedeProposals: async () => { throw new Error("db down mid-draft"); } },
    });
    const r = await draftDailyJes("2026-07-10", undefined, deps);
    const sh = r.channels.find((c) => c.channel === "SHOPIFY")!;
    expect(sh.outcome).toBe("drafted_blocked");
    expect(sh.reason).toMatch(/Draft failed: db down mid-draft/);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0].status).toBe("blocked");
    expect(calls.inserted[0].blockReason).toMatch(/db down mid-draft/);
    expect(calls.inserted[0].blockReason).toMatch(/re-drafts automatically/);
  });

  it("a concurrent-insert unique violation is a benign skip (the twin process won), not a failure", async () => {
    const dup: any = new Error(`duplicate key value violates unique constraint "daily_je_proposals_live_doc_uidx"`);
    dup.code = "23505";
    const { deps } = makeDraftDeps({
      today: "2026-07-11",
      orders: shopifyDay,
      override: { insertProposal: async () => { throw dup; } },
    });
    const r = await draftDailyJes("2026-07-10", undefined, deps);
    expect(r.channels.find((c) => c.channel === "SHOPIFY")!.outcome).toBe("skipped_exists");
  });

  it("only when even the trace write fails does the channel come back 'refused'", async () => {
    const { deps } = makeDraftDeps({
      today: "2026-07-11",
      orders: shopifyDay,
      override: {
        getExistingProposals: async () => { throw new Error("db down"); },
        insertProposal: async () => { throw new Error("db still down"); },
      },
    });
    const r = await draftDailyJes("2026-07-10", undefined, deps);
    const sh = r.channels.find((c) => c.channel === "SHOPIFY")!;
    expect(sh.outcome).toBe("refused");
    expect(sh.reason).toMatch(/db down/);
  });

  it("identity-dedupes relabeled-channel twins BEFORE bucketing by channel", async () => {
    const twins = [
      order({ id: "a", channel: "SHOPIFY", externalOrderId: "EXT-1", totalAmount: 110, subtotalAmount: 90, taxAmount: 8, discountAmount: 10 }),
      order({ id: "b", channel: "AMAZON", externalOrderId: "EXT-1", totalAmount: 110, taxAmount: 8 }),
    ];
    const { deps, calls } = makeDraftDeps({ today: "2026-07-11", orders: twins });
    const r = await draftDailyJes("2026-07-10", undefined, deps);
    // The AMAZON twin collapsed onto its SHOPIFY original → no Amazon activity.
    expect(r.channels.find((c) => c.channel === "AMAZON")!.outcome).toBe("skipped_no_activity");
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0].channel).toBe("SHOPIFY");
    expect((calls.inserted[0].feeder as any).orders).toBe(1);
  });
});

// ── backfill (boot + nightly sweep) ──────────────────────────────────────

describe("backfillMissingDailyJes", () => {
  it("drafts 2026-07-10 through yesterday, never earlier", async () => {
    const { deps, calls } = makeDraftDeps({ today: "2026-07-13", orders: [...shopifyDay, ...amazonDay] });
    const r = await backfillMissingDailyJes(deps);
    expect(r.daysChecked).toBe(3); // 07-10, 07-11, 07-12
    expect(r.drafted).toBe(6); // 2 channels × 3 days
    expect(r.refused).toBe(0);
    expect(calls.inserted.every((p) => p.targetDate >= EARLIEST_DRAFT_DATE)).toBe(true);
  });

  it("leaves dates alone that already have a live pending draft", async () => {
    const { deps, calls } = makeDraftDeps({
      today: "2026-07-12",
      orders: shopifyDay,
      existing: [{ id: 1, status: "pending", doc: "SBR-DS-260710-SH" }],
    });
    const r = await backfillMissingDailyJes(deps);
    expect(r.daysChecked).toBe(2); // 07-10, 07-11
    expect(calls.superseded).toHaveLength(0); // onlyIfMissing never churns pendings
    // 07-10 SHOPIFY skipped (pending exists); 07-11 SHOPIFY drafted
    expect(calls.inserted.map((p) => p.docNumber)).toEqual(["SBR-DS-260711-SH"]);
  });

  it("counts refused channel-days so the scheduler can record a FAILED run", async () => {
    const { deps } = makeDraftDeps({
      today: "2026-07-12",
      orders: shopifyDay,
      override: {
        getExistingProposals: async () => { throw new Error("db down"); },
        insertProposal: async () => { throw new Error("db still down"); },
      },
    });
    const r = await backfillMissingDailyJes(deps);
    expect(r.refused).toBe(2); // SHOPIFY refused on both swept days
  });
});

// ── approve / posting (the only QBO write; client mocked) ────────────────

function makeApproveDeps(opts: {
  proposal?: Partial<ProposalRow> | null;
  qbo?: Partial<QboPort> | null;
}) {
  const comp = computeShopifyDraft("2026-07-10", shopifyDay, []);
  const calls = {
    posted: [] as Array<Record<string, unknown>>,
    markPosted: [] as Array<{ id: number; jeId: string; userId: string }>,
    markBlocked: [] as Array<{ id: number; reason: string }>,
    released: [] as number[],
    events: [] as string[], // ordering assertions (claim MUST precede any QBO call)
  };
  const state: { proposal: ProposalRow | null } = {
    proposal:
      opts.proposal === null
        ? null
        : ({
            id: 42,
            target_date: "2026-07-10",
            channel: "SHOPIFY",
            doc_number: comp.docNumber,
            lines: comp.lines,
            feeder: comp.feeder,
            status: "pending",
            block_reason: null,
            posted_je_id: null,
            created_at: new Date().toISOString(),
            decided_at: null,
            decided_by: null,
            ...(opts.proposal ?? {}),
          } as ProposalRow),
  };
  const deps: ApproveDeps = {
    loadProposal: async () => state.proposal,
    claimProposal: async (_id, userId) => {
      calls.events.push("claim");
      if (!state.proposal || state.proposal.status !== "pending") return null;
      state.proposal = { ...state.proposal, status: "posting", decided_by: userId };
      return state.proposal;
    },
    releaseClaim: async (id) => {
      calls.released.push(id);
      if (state.proposal?.status === "posting") state.proposal = { ...state.proposal, status: "pending" };
    },
    markPosted: async (id, jeId, userId) => {
      calls.markPosted.push({ id, jeId, userId });
      if (state.proposal) state.proposal = { ...state.proposal, status: "approved_posted", posted_je_id: jeId };
    },
    markBlocked: async (id, reason) => {
      calls.markBlocked.push({ id, reason });
      if (state.proposal) state.proposal = { ...state.proposal, status: "blocked", block_reason: reason };
    },
    getQbo: async () =>
      opts.qbo === null
        ? null
        : ({
            findJesByDocNumber: async (doc: string) => { calls.events.push("qbo:findDoc"); return []; },
            findA2xJesInPeriod: async () => { calls.events.push("qbo:findA2x"); return []; },
            postJournalEntry: async (body: Record<string, unknown>) => {
              calls.events.push("qbo:post");
              calls.posted.push(body);
              return { Id: "18601" };
            },
            ...(opts.qbo ?? {}),
          } as QboPort),
  };
  return { deps, calls, state };
}

describe("approveProposal", () => {
  it("claims atomically FIRST, then posts the stored lines with the right TxnDate/DocNumber", async () => {
    const { deps, calls, state } = makeApproveDeps({});
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(true);
    expect(r.postedJeId).toBe("18601");
    expect(calls.posted).toHaveLength(1);
    expect(calls.posted[0].TxnDate).toBe("2026-07-10");
    expect(calls.posted[0].DocNumber).toBe("SBR-DS-260710-SH");
    expect(Array.isArray(calls.posted[0].Line)).toBe(true);
    expect(calls.markPosted).toEqual([{ id: 42, jeId: "18601", userId: "user-1" }]);
    expect(state.proposal!.status).toBe("approved_posted");
    // The claim happens BEFORE any QBO traffic — that is the double-post lock.
    expect(calls.events[0]).toBe("claim");
    expect(calls.events.indexOf("claim")).toBeLessThan(calls.events.indexOf("qbo:post"));
  });

  it("a second approve of the same proposal loses the claim → 409 conflict, ONE QBO post total", async () => {
    const { deps, calls } = makeApproveDeps({});
    const first = await approveProposal(42, "user-1", deps);
    expect(first.ok).toBe(true);
    const second = await approveProposal(42, "user-2", deps);
    expect(second.ok).toBe(false);
    expect(second.conflict).toBe(true);
    expect(second.error).toMatch(/approved_posted, not pending/);
    expect(calls.posted).toHaveLength(1); // exactly one JE ever posted
  });

  it("a proposal already mid-post ('posting') is rejected as a conflict without touching QBO", async () => {
    const { deps, calls } = makeApproveDeps({ proposal: { status: "posting" } });
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.conflict).toBe(true);
    expect(r.error).toMatch(/already being posted/);
    expect(calls.posted).toHaveLength(0);
  });

  it("re-checks the doc-number guard at post time: a QBO hit blocks instead of double-posting", async () => {
    const { deps, calls } = makeApproveDeps({ qbo: { findJesByDocNumber: async () => [{ Id: "18590" }] } });
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Already posted/);
    expect(calls.posted).toHaveLength(0);
    expect(calls.markBlocked).toHaveLength(1);
  });

  it("re-checks the A2X guard at post time too (drafts can sit for days while A2X books the month)", async () => {
    const { deps, calls } = makeApproveDeps({
      qbo: { findA2xJesInPeriod: async () => [{ Id: "7", DocNumber: "A2XSH-JUL", TxnDate: "2026-07-31" }] },
    });
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/A2X/);
    expect(calls.posted).toHaveLength(0);
    expect(calls.markBlocked).toHaveLength(1);
    expect(calls.markBlocked[0].reason).toMatch(/double-count/);
  });

  it("refuses a non-pending proposal (conflict, not a plain error)", async () => {
    const { deps, calls } = makeApproveDeps({ proposal: { status: "blocked" } });
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.conflict).toBe(true);
    expect(r.error).toMatch(/blocked, not pending/);
    expect(calls.posted).toHaveLength(0);
  });

  it("an unbalanced stored entry is marked BLOCKED (visible + re-draftable), never posted", async () => {
    const comp = computeShopifyDraft("2026-07-10", shopifyDay, []);
    const tampered = JSON.parse(JSON.stringify(comp.lines)) as JeLine[];
    tampered[0].Amount += 5;
    const { deps, calls, state } = makeApproveDeps({ proposal: { lines: tampered } });
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not balanced/);
    expect(calls.posted).toHaveLength(0);
    expect(calls.markBlocked).toHaveLength(1);
    expect(state.proposal!.status).toBe("blocked");
  });

  it("QBO not connected → claim RELEASED back to pending, clean error", async () => {
    const { deps, calls, state } = makeApproveDeps({ qbo: null });
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not connected/);
    expect(calls.released).toEqual([42]);
    expect(state.proposal!.status).toBe("pending"); // retryable, not stuck in 'posting'
    expect(calls.markPosted).toHaveLength(0);
    expect(calls.markBlocked).toHaveLength(0);
  });

  it("guard query failure → claim released, does not post blind", async () => {
    const { deps, calls, state } = makeApproveDeps({
      qbo: { findJesByDocNumber: async () => { throw new Error("QBO 500"); } },
    });
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not posting blind/);
    expect(calls.posted).toHaveLength(0);
    expect(calls.released).toEqual([42]);
    expect(state.proposal!.status).toBe("pending");
  });

  it("post THROWS but the JE actually landed → the recheck finds it and ADOPTS it (no double post, id recorded)", async () => {
    let findCallCount = 0;
    const { deps, calls, state } = makeApproveDeps({
      qbo: {
        findJesByDocNumber: async () => {
          findCallCount++;
          // 1st call = pre-post guard (clean); 2nd call = post-failure recovery (JE landed).
          return findCallCount === 1 ? [] : [{ Id: "18777" }];
        },
        postJournalEntry: async () => { throw new Error("socket timeout"); },
      },
    });
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(true);
    expect(r.adoptedAfterFailure).toBe(true);
    expect(r.postedJeId).toBe("18777");
    expect(calls.markPosted).toEqual([{ id: 42, jeId: "18777", userId: "user-1" }]);
    expect(state.proposal!.status).toBe("approved_posted");
  });

  it("post THROWS and the recheck proves nothing landed → claim released, retryable error", async () => {
    const { deps, calls, state } = makeApproveDeps({
      qbo: { postJournalEntry: async () => { throw new Error("QuickBooks API error: 400"); } },
    });
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/400/);
    expect(r.error).toMatch(/can be retried/);
    expect(calls.released).toEqual([42]);
    expect(state.proposal!.status).toBe("pending"); // human can retry; retry re-runs the guards
    expect(calls.markPosted).toHaveLength(0);
    expect(calls.markBlocked).toHaveLength(0);
  });

  it("post THROWS and the recovery check ALSO fails → row blocked as 'outcome unknown' (fails closed)", async () => {
    let findCallCount = 0;
    const { deps, calls, state } = makeApproveDeps({
      qbo: {
        findJesByDocNumber: async () => {
          findCallCount++;
          if (findCallCount === 1) return []; // pre-post guard passes
          throw new Error("QBO down"); // recovery check fails — outcome truly unknown
        },
        postJournalEntry: async () => { throw new Error("socket timeout"); },
      },
    });
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/outcome unknown/);
    expect(calls.markBlocked).toHaveLength(1);
    expect(calls.markBlocked[0].reason).toMatch(/could not be verified/);
    expect(calls.released).toHaveLength(0); // NOT released — releasing could enable a double post
    expect(state.proposal!.status).toBe("blocked");
  });

  it("missing proposal → not found", async () => {
    const { deps } = makeApproveDeps({ proposal: null });
    const r = await approveProposal(999, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });

  it("normalizes a Date-typed target_date (node-pg DATE parsing) into a clean QBO TxnDate", async () => {
    const { deps, calls } = makeApproveDeps({
      proposal: { target_date: new Date(2026, 6, 10) as unknown as string },
    });
    const r = await approveProposal(42, "user-1", deps);
    expect(r.ok).toBe(true);
    expect(calls.posted[0].TxnDate).toBe("2026-07-10"); // NOT "Fri Jul 10"
  });
});

// ── stuck-claim reconciliation ───────────────────────────────────────────

function makeReconcileDeps(opts: {
  stuck: Array<Partial<ProposalRow> & { id: number; doc_number: string }>;
  qbo?: Partial<QboPort> | null;
}) {
  const calls = { markPosted: [] as Array<{ id: number; jeId: string; userId: string }>, released: [] as number[] };
  const deps: ReconcileDeps = {
    listStuckPosting: async () => opts.stuck.map((p) => ({ status: "posting", decided_by: null, ...p } as ProposalRow)),
    markPosted: async (id, jeId, userId) => { calls.markPosted.push({ id, jeId, userId }); },
    releaseClaim: async (id) => { calls.released.push(id); },
    getQbo: async () =>
      opts.qbo === null
        ? null
        : ({
            findJesByDocNumber: async () => [],
            findA2xJesInPeriod: async () => [],
            postJournalEntry: async () => { throw new Error("reconcile must NEVER post"); },
            ...(opts.qbo ?? {}),
          } as QboPort),
  };
  return { deps, calls };
}

describe("reconcileStuckPostingProposals", () => {
  it("adopts a stale 'posting' claim whose JE actually landed in QBO", async () => {
    const { deps, calls } = makeReconcileDeps({
      stuck: [{ id: 9, doc_number: "SBR-DS-260710-SH", decided_by: "user-1" } as any],
      qbo: { findJesByDocNumber: async () => [{ Id: "18800" }] },
    });
    const r = await reconcileStuckPostingProposals(deps);
    expect(r).toEqual({ checked: 1, adopted: 1, released: 0, unresolved: 0 });
    expect(calls.markPosted).toEqual([{ id: 9, jeId: "18800", userId: "user-1" }]);
  });

  it("releases a stale claim when QBO verifiably has no such JE (pending again, human retries)", async () => {
    const { deps, calls } = makeReconcileDeps({
      stuck: [{ id: 9, doc_number: "SBR-DS-260710-SH" } as any],
    });
    const r = await reconcileStuckPostingProposals(deps);
    expect(r).toEqual({ checked: 1, adopted: 0, released: 1, unresolved: 0 });
    expect(calls.released).toEqual([9]);
  });

  it("leaves claims standing when QBO cannot answer — never guesses", async () => {
    const { deps, calls } = makeReconcileDeps({
      stuck: [{ id: 9, doc_number: "SBR-DS-260710-SH" } as any],
      qbo: null,
    });
    const r = await reconcileStuckPostingProposals(deps);
    expect(r).toEqual({ checked: 1, adopted: 0, released: 0, unresolved: 1 });
    expect(calls.released).toHaveLength(0);
    expect(calls.markPosted).toHaveLength(0);
  });

  it("a failing doc lookup marks the row unresolved (retried next sweep), not released", async () => {
    const { deps, calls } = makeReconcileDeps({
      stuck: [{ id: 9, doc_number: "SBR-DS-260710-SH" } as any],
      qbo: { findJesByDocNumber: async () => { throw new Error("QBO 500"); } },
    });
    const r = await reconcileStuckPostingProposals(deps);
    expect(r.unresolved).toBe(1);
    expect(calls.released).toHaveLength(0);
  });

  it("no stuck rows → no QBO traffic at all", async () => {
    let qboFetched = 0;
    const deps: ReconcileDeps = {
      listStuckPosting: async () => [],
      markPosted: async () => {},
      releaseClaim: async () => {},
      getQbo: async () => { qboFetched++; return null; },
    };
    const r = await reconcileStuckPostingProposals(deps);
    expect(r.checked).toBe(0);
    expect(qboFetched).toBe(0);
  });
});

// ── re-draft (recovery lever for a mis-clicked Dismiss) ──────────────────

describe("redraftProposal", () => {
  it("retires a rejected row and drafts the date fresh through the full guard pass", async () => {
    const calls = { superseded: [] as number[], drafted: [] as string[] };
    const deps: RedraftDeps = {
      supersedeDecided: async (id) => {
        calls.superseded.push(id);
        return { targetDate: "2026-07-10", docNumber: "SBR-DS-260710-SH", channel: "SHOPIFY" };
      },
      loadProposal: async () => null,
      draft: async (d) => { calls.drafted.push(d); return { ok: true, targetDate: d, channels: [] }; },
    };
    const r = await redraftProposal(7, "user-1", deps);
    expect(r.ok).toBe(true);
    expect(calls.superseded).toEqual([7]);
    expect(calls.drafted).toEqual(["2026-07-10"]);
  });

  it("refuses to re-draft a posted proposal (conflict; the books already carry it)", async () => {
    const comp = computeShopifyDraft("2026-07-10", shopifyDay, []);
    const deps: RedraftDeps = {
      supersedeDecided: async () => null, // conditional UPDATE matched 0 rows
      loadProposal: async () =>
        ({
          id: 7, target_date: "2026-07-10", channel: "SHOPIFY", doc_number: comp.docNumber,
          lines: comp.lines, feeder: comp.feeder, status: "approved_posted", block_reason: null,
          posted_je_id: "18601", created_at: "", decided_at: null, decided_by: null,
        } as ProposalRow),
      draft: async () => { throw new Error("must not draft"); },
    };
    const r = await redraftProposal(7, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.conflict).toBe(true);
    expect(r.error).toMatch(/approved_posted/);
  });

  it("missing proposal → not found", async () => {
    const deps: RedraftDeps = {
      supersedeDecided: async () => null,
      loadProposal: async () => null,
      draft: async () => { throw new Error("must not draft"); },
    };
    const r = await redraftProposal(999, "user-1", deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });
});
