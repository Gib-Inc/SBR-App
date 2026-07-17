/**
 * BOOK.E walk phase — the daily sales journal-entry poster.
 *
 * Every night the app DRAFTS the prior MT day's sales journal entries from
 * sales_orders (one per channel: Shopify, Amazon) into daily_je_proposals.
 * A human reviews the feeder numbers and the exact QBO lines on the
 * Bookkeeping page and clicks Approve; ONLY THEN is the entry posted to
 * QuickBooks. The scheduler never posts — approveProposal() is the single
 * QBO write path.
 *
 * Accounting pattern (established Jul 10 2026, QBO entries 18556-18575 —
 * do not deviate):
 *   SHOPIFY (DocNumber SBR-DS-YYMMDD-SH, every line Entity Customer 638):
 *     Cr  27  Gross Sales                 = subtotal + discounts + shipping
 *     Dr 254  Discounts                   = discounts        (omit if 0)
 *     Dr  25  Returns and Refunds         = refunds actually refunded that day (omit if 0)
 *     Cr  21  Sales Tax To Pay            = tax
 *     Dr 184  Accrued Accounts Receivable = total − refunds
 *   AMAZON (DocNumber SBR-DS-YYMMDD-AZ, every line Entity Customer 838):
 *     Cr  27          Gross Sales     = total − tax (revenue ex-tax INCLUDING any
 *                                       shipping income — this is the cash Amazon
 *                                       owes us before fees; marketplace facilitator:
 *                                       Amazon remits its own tax, never book it)
 *     Dr 1150040006   Amazon Reserves = same amount
 *     (No ads line — Amazon fees arrive as Bills.)
 *
 * Data source: sales_orders on the MT calendar day
 * (((order_date AT TIME ZONE 'UTC') AT TIME ZONE 'America/Denver')::date —
 * the naive single AT TIME ZONE converts the WRONG direction), identity-deduped
 * exactly like daily-sales-scheduler (same physical order cloned by multiple
 * import paths / relabeled-channel twins collapses to one row). Refunds come
 * from return_requests.refunded_at × return_items (Shopify only).
 *
 * Order-status handling (deliberate, deviates from BOTH earlier precedents):
 *   - CANCELLED orders are EXCLUDED — a cancelled order must not book revenue
 *     or AR. The exclusion is recorded in the feeder (count + names) so the
 *     human can see exactly what was left out.
 *   - REFUNDED / PENDING_REFUND orders are INCLUDED — the sale is booked on
 *     the order day; the refund books separately (Dr 25) on the day
 *     return_requests.refunded_at lands. Excluding them would subtract the
 *     revenue twice across the identity Db184 = total − refunds.
 *
 * Proposal status lifecycle:
 *   pending  → posting → approved_posted   (claim → QBO write → recorded)
 *   pending  → blocked                     (guard hit at approve time)
 *   posting  → pending                     (claim released: QBO unavailable /
 *                                           post confirmed NOT to have landed)
 *   posting  → blocked                     (post outcome unknown — fails closed)
 *   pending/blocked → superseded           (fresher draft replaced it)
 *   pending/blocked → rejected             (human dismissed; recoverable via
 *                                           redraftProposal / the Re-draft button)
 * The atomic claim (pending → posting, compare-and-set) is what makes Approve
 * single-shot: a second click / second tab gets 0 rows and a 409. A 'posting'
 * row can never be superseded by the nightly draft (supersede only touches
 * pending/blocked) and the nightly draft skips doc numbers with a posting row.
 * If the server dies mid-post, reconcileStuckPostingProposals() adopts the JE
 * if it landed in QBO, or releases the claim if it verifiably did not.
 *
 * FINANCIAL RULES honored:
 *   - A DATA GAP BLOCKS. Any order missing an amount column the math needs
 *     (total/subtotal/tax/discount; refund unit_price) forces the proposal to
 *     status 'blocked' with the gap named in block_reason. Nothing is ever
 *     filled with $0; gapped feeder figures are stored as null ("not
 *     available") and NO journal lines are built. When the source rows are
 *     fixed, the nightly re-draft clears the block automatically.
 *   - The feeder jsonb stores the rows behind every number (order/refund
 *     counts, per-component totals, gap counters, excluded-order names).
 *   - A day whose guards cannot run is stored 'blocked' with the reason —
 *     never silently drafted as if verified. Guard lookups paginate and FAIL
 *     CLOSED (a truncated QBO answer throws instead of passing).
 *   - A channel-day that throws while drafting leaves a visible 'blocked' row
 *     with the error as block_reason (re-draftable later) — never a silent hole.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { QuickBooksClient } from "./quickbooks-client";
import { AuditLogger } from "./audit-logger";
import { dedupeOrdersByIdentity } from "./daily-sales-scheduler";

// ── Config ───────────────────────────────────────────────────────────────

const TIMEZONE = "America/Denver";

/**
 * The JEs for Jul 1–9 2026 were already posted by hand (entries 18556-18575).
 * Drafting any date at or before 2026-07-09 would double-book those days, so
 * it is refused at the service level, not just in the scheduler.
 */
export const EARLIEST_DRAFT_DATE = "2026-07-10";

/** QBO Customer entity stamped on every line, per channel. */
export const CHANNEL_ENTITY = { SHOPIFY: "638", AMAZON: "838" } as const;

/** QBO chart-of-accounts targets. Ids are facts from the live realm. */
export const JE_ACCOUNTS = {
  GROSS_SALES: { value: "27", name: "Gross Sales" },
  DISCOUNTS: { value: "254", name: "Discounts" },
  RETURNS_REFUNDS: { value: "25", name: "Returns and Refunds" },
  SALES_TAX: { value: "21", name: "Sales Tax To Pay" },
  ACCRUED_AR: { value: "184", name: "Accrued Accounts Receivable" },
  AMAZON_RESERVES: { value: "1150040006", name: "Amazon Reserves" },
} as const;

export type JeChannel = "SHOPIFY" | "AMAZON";

// ── Types ────────────────────────────────────────────────────────────────

/** Raw row read from sales_orders (already filtered to the target MT day). */
export interface OrderRow {
  id: string;
  channel: string | null;
  status: string | null;
  orderName: string | null;
  externalOrderId: string | null;
  totalAmount: number | null;    // GROSS, tax-inclusive
  subtotalAmount: number | null; // Shopify subtotal_price: post-discount, pre-shipping/tax
  taxAmount: number | null;
  discountAmount: number | null;
}

/** Raw refunded return line (Shopify only, dated by return_requests.refunded_at). */
export interface RefundRow {
  rmaNumber: string | null;
  unitPrice: number | null;
  qtyReceived: number | null;
  qtyApproved: number | null;
  qtyRequested: number | null;
}

export interface JeLine {
  Description?: string;
  Amount: number;
  DetailType: "JournalEntryLineDetail";
  JournalEntryLineDetail: {
    PostingType: "Debit" | "Credit";
    AccountRef: { value: string; name?: string };
    Entity: { Type: "Customer"; EntityRef: { value: string } };
  };
}

export interface DraftComputation {
  targetDate: string;
  channel: JeChannel;
  docNumber: string;
  lines: JeLine[];
  feeder: Record<string, unknown>;
  /** false = zero-activity day; nothing to draft. */
  hasActivity: boolean;
  balanced: boolean;
  debitTotal: number;
  creditTotal: number;
  /**
   * Non-null when a source row is missing an amount column the math needs.
   * The draft MUST be stored 'blocked' with this reason — a gap says "not
   * available", it is never filled with a plausible $0.
   */
  gapBlockReason: string | null;
}

export interface ProposalRow {
  id: number;
  target_date: string;
  channel: string;
  doc_number: string;
  lines: JeLine[];
  feeder: Record<string, unknown>;
  status: string;
  block_reason: string | null;
  posted_je_id: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

export interface ChannelDraftResult {
  channel: JeChannel;
  docNumber: string;
  outcome:
    | "drafted_pending"
    | "drafted_blocked"
    | "skipped_no_activity"
    | "skipped_already_posted"
    | "skipped_posting"
    | "skipped_rejected"
    | "skipped_exists"
    | "refused";
  reason?: string;
  proposalId?: number;
}

export interface DraftRunResult {
  ok: boolean;
  targetDate: string;
  error?: string;
  channels: ChannelDraftResult[];
}

// ── [DETERMINISTIC] date helpers (MT calendar) ───────────────────────────

export function mtDateString(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TIMEZONE }); // YYYY-MM-DD
}

/** Pure date-string arithmetic — no timezone involvement. */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function yesterdayMT(now: Date = new Date()): string {
  return addDaysToDateString(mtDateString(now), -1);
}

/**
 * Normalize a date value to YYYY-MM-DD. node-pg parses DATE columns into a JS
 * Date at LOCAL midnight — String(date).slice(0,10) would yield "Fri Jul 10"
 * and corrupt the QBO TxnDate, so Date values are re-read via local getters
 * (exactly the components pg parsed).
 */
export function toDateOnlyString(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return String(v).slice(0, 10);
}

/** DocNumber format fixed by the Jul 10 pattern: SBR-DS-YYMMDD-SH / -AZ. */
export function docNumberFor(dateStr: string, channel: JeChannel): string {
  const compact = dateStr.replaceAll("-", "").slice(2); // YYMMDD
  return `SBR-DS-${compact}-${channel === "SHOPIFY" ? "SH" : "AZ"}`;
}

function monthBoundsOf(dateStr: string): { start: string; end: string } {
  const [y, m] = dateStr.split("-").map(Number);
  const start = `${dateStr.slice(0, 7)}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${dateStr.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

// ── [DETERMINISTIC] money + line helpers ─────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round(n * 100);

/**
 * Build one JE line. `amount` is signed against the line's NATURAL posting
 * side; a negative amount flips the posting type (e.g. a refunds-only day has
 * AR = total − refunds < 0, which must post as a Credit — QBO rejects
 * negative amounts).
 */
function jeLine(
  posting: "Debit" | "Credit",
  account: { value: string; name?: string },
  amount: number,
  entityId: string,
  description?: string,
): JeLine {
  const flipped = amount < 0;
  return {
    ...(description ? { Description: description } : {}),
    Amount: round2(Math.abs(amount)),
    DetailType: "JournalEntryLineDetail",
    JournalEntryLineDetail: {
      PostingType: flipped ? (posting === "Debit" ? "Credit" : "Debit") : posting,
      AccountRef: { value: account.value, name: account.name },
      Entity: { Type: "Customer", EntityRef: { value: entityId } },
    },
  };
}

export function sumDebitsCredits(lines: JeLine[]): { debitTotal: number; creditTotal: number; balanced: boolean } {
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    if (l.JournalEntryLineDetail.PostingType === "Debit") dr += cents(l.Amount);
    else cr += cents(l.Amount);
  }
  return { debitTotal: dr / 100, creditTotal: cr / 100, balanced: dr === cr };
}

// ── [DETERMINISTIC] the draft math (pure, unit-tested) ───────────────────

/**
 * Summation convenience ONLY. A null summed through num() is ALWAYS paired
 * with a gap counter; when the counter is > 0 the affected feeder figure is
 * stored as null ("not available") and gapBlockReason forces the proposal to
 * 'blocked' — the fabricated-zero sum can never reach an approvable draft.
 */
const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Refund $ for one return line — same precedence as daily-sales-scheduler. */
export function refundAmountForItem(item: RefundRow): number {
  const qty = item.qtyReceived || item.qtyApproved || item.qtyRequested || 0;
  return qty * num(item.unitPrice);
}

function refundQty(item: RefundRow): number {
  return item.qtyReceived || item.qtyApproved || item.qtyRequested || 0;
}

/**
 * Shopify daily JE. Column semantics (live Shopify sync): total_amount is
 * GROSS tax-inclusive; subtotal_amount is Shopify's subtotal_price
 * (post-discount, pre-shipping/tax); so shipping = total − subtotal − tax and
 * Gross Sales = subtotal + discounts + shipping (algebraically
 * total + discounts − tax, which is what makes the entry balance to the cent).
 *
 * GAP RULE: every one of total/subtotal/tax/discount is required per order,
 * and unit_price is required on any refund line with quantity. A null in any
 * of them sets gapBlockReason (the draft is stored 'blocked'), the affected
 * feeder sums become null, and NO lines are built — $0 is never invented.
 */
export function computeShopifyDraft(
  targetDate: string,
  orders: OrderRow[],
  refundItems: RefundRow[],
): DraftComputation {
  const entity = CHANNEL_ENTITY.SHOPIFY;
  let total = 0, subtotal = 0, tax = 0, discounts = 0;
  let missingTotal = 0, missingSubtotal = 0, missingTax = 0, missingDiscount = 0;
  const orderNames: string[] = [];
  const gappedOrderNames: string[] = [];
  for (const o of orders) {
    total += num(o.totalAmount);
    subtotal += num(o.subtotalAmount);
    tax += num(o.taxAmount);
    discounts += num(o.discountAmount);
    if (o.totalAmount == null) missingTotal++;
    if (o.subtotalAmount == null) missingSubtotal++;
    if (o.taxAmount == null) missingTax++;
    if (o.discountAmount == null) missingDiscount++;
    const name = o.orderName || o.externalOrderId || o.id;
    if (orderNames.length < 300) orderNames.push(name);
    if (
      (o.totalAmount == null || o.subtotalAmount == null || o.taxAmount == null || o.discountAmount == null) &&
      gappedOrderNames.length < 50
    ) {
      gappedOrderNames.push(name);
    }
  }
  total = round2(total); subtotal = round2(subtotal); tax = round2(tax); discounts = round2(discounts);
  const shipping = round2(total - subtotal - tax);

  let refunds = 0;
  let missingRefundPrice = 0;
  const refundRmas: string[] = [];
  for (const r of refundItems) {
    refunds += refundAmountForItem(r);
    if (r.unitPrice == null && refundQty(r) > 0) missingRefundPrice++;
    if (r.rmaNumber && refundRmas.length < 100 && !refundRmas.includes(r.rmaNumber)) refundRmas.push(r.rmaNumber);
  }
  refunds = round2(refunds);

  // GAP CHECK — a missing input blocks; it is never filled with $0.
  const gapFieldBits: string[] = [];
  if (missingTotal) gapFieldBits.push(`total_amount: ${missingTotal}`);
  if (missingSubtotal) gapFieldBits.push(`subtotal_amount: ${missingSubtotal}`);
  if (missingTax) gapFieldBits.push(`tax_amount: ${missingTax}`);
  if (missingDiscount) gapFieldBits.push(`discount_amount: ${missingDiscount}`);
  const gappedOrders = gappedOrderNames.length;
  let gapBlockReason: string | null = null;
  if (gapFieldBits.length || missingRefundPrice) {
    const bits: string[] = [];
    if (gapFieldBits.length) {
      bits.push(`${gappedOrders} of ${orders.length} order(s) missing required amount field(s) — ${gapFieldBits.join(", ")}`);
    }
    if (missingRefundPrice) bits.push(`${missingRefundPrice} refund line(s) missing unit_price`);
    gapBlockReason =
      `Data gap: ${bits.join("; ")}. These values are not available in the source rows, so the day cannot be booked ` +
      `— nothing was filled with $0. Fix or re-sync the source data; this day re-drafts automatically on the next nightly run.`;
  }

  const grossSales = round2(subtotal + discounts + shipping);
  const accruedAr = round2(total - refunds);

  const lines: JeLine[] = [];
  if (!gapBlockReason) {
    const desc = `Daily Shopify sales ${targetDate} (MT)`;
    if (cents(grossSales) !== 0) lines.push(jeLine("Credit", JE_ACCOUNTS.GROSS_SALES, grossSales, entity, desc));
    if (cents(discounts) !== 0) lines.push(jeLine("Debit", JE_ACCOUNTS.DISCOUNTS, discounts, entity, desc));
    if (cents(refunds) !== 0) lines.push(jeLine("Debit", JE_ACCOUNTS.RETURNS_REFUNDS, refunds, entity, `Refunds refunded ${targetDate} (MT)`));
    if (cents(tax) !== 0) lines.push(jeLine("Credit", JE_ACCOUNTS.SALES_TAX, tax, entity, desc));
    if (cents(accruedAr) !== 0) lines.push(jeLine("Debit", JE_ACCOUNTS.ACCRUED_AR, accruedAr, entity, desc));
  }

  const orderComponentsGapped = missingTotal > 0 || missingSubtotal > 0 || missingTax > 0 || missingDiscount > 0;
  const { debitTotal, creditTotal, balanced } = sumDebitsCredits(lines);
  return {
    targetDate,
    channel: "SHOPIFY",
    docNumber: docNumberFor(targetDate, "SHOPIFY"),
    lines,
    feeder: {
      // FACTS (sums of source rows; null = a source row is missing the column,
      // the value is NOT available — never shown as a fabricated $0)
      orders: orders.length,
      total: missingTotal ? null : total,
      subtotal: missingSubtotal ? null : subtotal,
      tax: missingTax ? null : tax,
      discounts: missingDiscount ? null : discounts,
      refunds: missingRefundPrice ? null : refunds,
      refundItems: refundItems.length,
      orderNames,
      refundRmas,
      // COMPUTED (derived, labeled as such; null when any input is gapped)
      shippingDerived: missingTotal || missingSubtotal || missingTax ? null : shipping,
      grossSalesComputed: orderComponentsGapped ? null : grossSales,
      accruedArComputed: missingTotal || missingRefundPrice ? null : accruedAr,
      // DATA GAPS (these BLOCK the draft — see gapBlockReason)
      ordersMissingTotal: missingTotal,
      ordersMissingSubtotal: missingSubtotal,
      ordersMissingTax: missingTax,
      ordersMissingDiscount: missingDiscount,
      refundItemsMissingUnitPrice: missingRefundPrice,
      gappedOrderNames,
    },
    hasActivity: lines.length > 0 || gapBlockReason != null,
    balanced,
    debitTotal,
    creditTotal,
    gapBlockReason,
  };
}

/**
 * Amazon daily JE: revenue ex-tax only (marketplace facilitator — Amazon
 * remits its own tax; never book it). Cr 27 is DELIBERATELY total − tax, not
 * the literal subtotal column: total − tax is the cash Amazon owes us before
 * fees (it includes any shipping income), which is exactly what the Dr Amazon
 * Reserves side accrues. Two lines, balanced by construction.
 *
 * GAP RULE: total and tax are required per order; a null blocks the draft.
 */
export function computeAmazonDraft(targetDate: string, orders: OrderRow[]): DraftComputation {
  const entity = CHANNEL_ENTITY.AMAZON;
  let revenue = 0, total = 0, tax = 0;
  let missingTotal = 0, missingTax = 0;
  const orderNames: string[] = [];
  const gappedOrderNames: string[] = [];
  for (const o of orders) {
    total += num(o.totalAmount);
    tax += num(o.taxAmount);
    revenue += num(o.totalAmount) - num(o.taxAmount);
    if (o.totalAmount == null) missingTotal++;
    if (o.taxAmount == null) missingTax++;
    const name = o.orderName || o.externalOrderId || o.id;
    if (orderNames.length < 300) orderNames.push(name);
    if ((o.totalAmount == null || o.taxAmount == null) && gappedOrderNames.length < 50) gappedOrderNames.push(name);
  }
  revenue = round2(revenue); total = round2(total); tax = round2(tax);

  const gapFieldBits: string[] = [];
  if (missingTotal) gapFieldBits.push(`total_amount: ${missingTotal}`);
  if (missingTax) gapFieldBits.push(`tax_amount: ${missingTax}`);
  const gapBlockReason = gapFieldBits.length
    ? `Data gap: ${gappedOrderNames.length} of ${orders.length} order(s) missing required amount field(s) — ${gapFieldBits.join(", ")}. ` +
      `These values are not available in the source rows, so the day cannot be booked — nothing was filled with $0. ` +
      `Fix or re-sync the source data; this day re-drafts automatically on the next nightly run.`
    : null;

  const lines: JeLine[] = [];
  if (!gapBlockReason && cents(revenue) !== 0) {
    const desc = `Daily Amazon sales ${targetDate} (MT), ex-tax (marketplace facilitator)`;
    lines.push(jeLine("Credit", JE_ACCOUNTS.GROSS_SALES, revenue, entity, desc));
    lines.push(jeLine("Debit", JE_ACCOUNTS.AMAZON_RESERVES, revenue, entity, desc));
  }

  const { debitTotal, creditTotal, balanced } = sumDebitsCredits(lines);
  return {
    targetDate,
    channel: "AMAZON",
    docNumber: docNumberFor(targetDate, "AMAZON"),
    lines,
    feeder: {
      orders: orders.length,
      total: missingTotal ? null : total,
      taxExcluded: missingTax ? null : tax,
      // Cr 27 = total − tax (revenue ex-tax incl. shipping income) — see fn doc.
      revenueExTax: missingTotal || missingTax ? null : revenue,
      orderNames,
      ordersMissingTotal: missingTotal,
      ordersMissingTax: missingTax,
      gappedOrderNames,
    },
    hasActivity: lines.length > 0 || gapBlockReason != null,
    balanced,
    debitTotal,
    creditTotal,
    gapBlockReason,
  };
}

// ── [DETERMINISTIC] guard + supersede decisions (pure, unit-tested) ──────

/**
 * Guard evaluation. Returns a block reason, or null when safe to leave the
 * proposal pending. Order matters: an exact doc-number hit is the strongest
 * signal (this very entry already exists).
 */
export function evaluateGuards(input: {
  docNumber: string;
  /** QBO JEs already carrying this exact DocNumber. */
  docNumberMatches: Array<{ Id: string }>;
  /** QBO JEs in the target month whose DocNumber starts with 'A2X' (covers A2XSH). */
  a2xEntries: Array<{ Id: string; DocNumber?: string; TxnDate?: string }>;
  /** false when no QBO connection was available to run the guards. */
  qboAvailable: boolean;
}): string | null {
  if (!input.qboAvailable) {
    return "QuickBooks guard checks could not run (not connected, or the guard query failed) — the A2X and already-posted checks are unverified. Re-drafts automatically on the next nightly run/boot once QBO answers; do not post blind.";
  }
  if (input.docNumberMatches.length > 0) {
    return `Already posted: QuickBooks already has JournalEntry ${input.docNumberMatches.map((j) => j.Id).join(", ")} with DocNumber ${input.docNumber}. Posting again would double-book the day.`;
  }
  if (input.a2xEntries.length > 0) {
    const sample = input.a2xEntries.slice(0, 5).map((j) => `${j.DocNumber ?? "?"} (JE ${j.Id}${j.TxnDate ? `, ${j.TxnDate}` : ""})`).join("; ");
    return `A2X double-count risk: ${input.a2xEntries.length} A2X journal entr${input.a2xEntries.length === 1 ? "y" : "ies"} found in this period — ${sample}. A2X already books this period's sales; posting the daily JE too would double-count revenue. Resolve which system owns the period first.`;
  }
  return null;
}

export interface ExistingProposal { id: number; status: string }

export type DraftAction =
  | { action: "skip"; reason: "already_posted" | "posting" | "rejected" | "exists" }
  | { action: "draft"; supersedeIds: number[]; blockedIdToUpdate: number | null };

/**
 * What to do given the rows already stored for this doc_number.
 *  - a posted proposal is final — never re-draft over it;
 *  - a 'posting' row means a human approve is mid-flight — hands off;
 *  - a human rejection is respected — the nightly job does not nag (a
 *    mis-click is recoverable through redraftProposal / the Re-draft button);
 *  - pending rows get superseded by the fresh draft (late-syncing orders);
 *  - the LATEST blocked row is refreshed in place when the new draft is
 *    blocked again (prevents one row per boot piling up), superseded when it
 *    clears; any OLDER duplicate blocked rows (two-process race artifacts)
 *    are superseded so they don't linger in the UI.
 * `onlyIfMissing` (boot backfill) additionally skips any doc_number that
 * already has a live pending row — boots must not churn identical drafts.
 */
export function decideDraftAction(existing: ExistingProposal[], opts?: { onlyIfMissing?: boolean }): DraftAction {
  if (existing.some((p) => p.status === "approved_posted")) return { action: "skip", reason: "already_posted" };
  if (existing.some((p) => p.status === "posting")) return { action: "skip", reason: "posting" };
  if (existing.some((p) => p.status === "rejected")) return { action: "skip", reason: "rejected" };
  const pending = existing.filter((p) => p.status === "pending").map((p) => p.id);
  const blocked = existing.filter((p) => p.status === "blocked").map((p) => p.id);
  if (opts?.onlyIfMissing && pending.length > 0) return { action: "skip", reason: "exists" };
  const blockedIdToUpdate = blocked.length ? Math.max(...blocked) : null;
  return {
    action: "draft",
    supersedeIds: [...pending, ...blocked.filter((id) => id !== blockedIdToUpdate)],
    blockedIdToUpdate,
  };
}

// ── Ports (I/O seams — injected in tests, real implementations below) ────

export interface QboPort {
  /** SELECT Id FROM JournalEntry WHERE DocNumber = :doc */
  findJesByDocNumber(docNumber: string): Promise<Array<{ Id: string }>>;
  /** JEs in [monthStart, monthEnd] whose DocNumber starts with 'A2X'. */
  findA2xJesInPeriod(monthStart: string, monthEnd: string): Promise<Array<{ Id: string; DocNumber?: string; TxnDate?: string }>>;
  /** POST /journalentry — the ONLY QBO write in this service. */
  postJournalEntry(body: Record<string, unknown>): Promise<{ Id: string }>;
}

export interface DraftDeps {
  nowMtDate(): string;
  fetchOrdersForDay(dateStr: string): Promise<OrderRow[]>;
  fetchShopifyRefundsForDay(dateStr: string): Promise<RefundRow[]>;
  getExistingProposals(docNumber: string): Promise<ExistingProposal[]>;
  supersedeProposals(ids: number[]): Promise<void>;
  updateBlockedProposal(id: number, patch: { lines: JeLine[]; feeder: Record<string, unknown>; blockReason: string }): Promise<void>;
  insertProposal(p: {
    targetDate: string; channel: JeChannel; docNumber: string;
    lines: JeLine[]; feeder: Record<string, unknown>;
    status: "pending" | "blocked"; blockReason: string | null;
  }): Promise<number>;
  /** null = no QBO-connected user found (guards cannot run). */
  getQbo(): Promise<QboPort | null>;
}

// ── Real dependency implementations ──────────────────────────────────────

/**
 * First user whose QuickBooksClient initializes wins (same idiom as the
 * financial-snapshot scheduler) — the QBO realm is company-wide.
 */
async function findQboClient(preferredUserId?: string): Promise<QuickBooksClient | null> {
  const tryUser = async (uid: string): Promise<QuickBooksClient | null> => {
    try {
      const c = new QuickBooksClient(storage, uid);
      return (await c.initialize()) ? c : null;
    } catch {
      return null;
    }
  };
  if (preferredUserId) {
    const c = await tryUser(preferredUserId);
    if (c) return c;
  }
  const users = await storage.getAllUsers();
  for (const u of users) {
    if (u.id === preferredUserId) continue;
    const c = await tryUser(u.id);
    if (c) return c;
  }
  return null;
}

/**
 * Drain a paginated QBO query. FAILS CLOSED: if the page cap is reached while
 * pages are still coming back full, the answer is incomplete — throw so the
 * caller blocks instead of silently passing a truncated guard.
 */
export async function fetchAllQboPages<T>(
  fetchPage: (startPosition: number) => Promise<T[]>,
  pageSize = 1000,
  maxPages = 10,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(page * pageSize + 1);
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
  throw new Error(
    `QBO query returned ${all.length}+ rows across ${maxPages} pages without draining — refusing to evaluate guards on a truncated answer.`,
  );
}

function qboPortFor(client: QuickBooksClient): QboPort {
  // apiRequest is private on the client (TS-only visibility); this service is
  // the sanctioned JE caller, same pattern the task prescribes.
  const api = client as unknown as {
    apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T>;
  };
  const PAGE = 1000;
  return {
    async findJesByDocNumber(docNumber: string) {
      const esc = docNumber.replace(/'/g, "''");
      const q = encodeURIComponent(`SELECT Id, DocNumber FROM JournalEntry WHERE DocNumber = '${esc}'`);
      const r = await api.apiRequest<{ QueryResponse?: { JournalEntry?: Array<{ Id: string }> } }>(`/query?query=${q}`);
      return r.QueryResponse?.JournalEntry ?? [];
    },
    async findA2xJesInPeriod(monthStart: string, monthEnd: string) {
      const all = await fetchAllQboPages(async (startPosition) => {
        const q = encodeURIComponent(
          `SELECT Id, DocNumber, TxnDate FROM JournalEntry WHERE TxnDate >= '${monthStart}' AND TxnDate <= '${monthEnd}' STARTPOSITION ${startPosition} MAXRESULTS ${PAGE}`,
        );
        const r = await api.apiRequest<{ QueryResponse?: { JournalEntry?: Array<{ Id: string; DocNumber?: string; TxnDate?: string }> } }>(`/query?query=${q}`);
        return r.QueryResponse?.JournalEntry ?? [];
      }, PAGE);
      return all.filter((j) => (j.DocNumber ?? "").toUpperCase().startsWith("A2X"));
    },
    async postJournalEntry(body: Record<string, unknown>) {
      const r = await api.apiRequest<{ JournalEntry: { Id: string } }>(`/journalentry`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { Id: r.JournalEntry.Id };
    },
  };
}

function parseProposalRow(row: any): ProposalRow {
  return {
    ...row,
    id: Number(row.id),
    lines: typeof row.lines === "string" ? JSON.parse(row.lines) : row.lines,
    feeder: typeof row.feeder === "string" ? JSON.parse(row.feeder) : row.feeder,
  } as ProposalRow;
}

function realDeps(): DraftDeps {
  return {
    nowMtDate: () => mtDateString(new Date()),

    async fetchOrdersForDay(dateStr: string): Promise<OrderRow[]> {
      // MT calendar day: the stored naive timestamp is UTC, so tag it UTC
      // first, THEN render in America/Denver. Ordered oldest-import-first so
      // identity dedupe keeps the original of a cloned/twin order.
      // NO status filter here — CANCELLED rows are excluded in draftDailyJes
      // so the exclusion is counted and visible in the feeder.
      const r: any = await db.execute(sql`
        SELECT id, channel, status, order_name, external_order_id,
               total_amount, subtotal_amount, tax_amount, discount_amount
        FROM sales_orders
        WHERE ((order_date AT TIME ZONE 'UTC') AT TIME ZONE 'America/Denver')::date = ${dateStr}::date
        ORDER BY created_at ASC, id ASC
      `);
      return (r.rows ?? []).map((row: any): OrderRow => ({
        id: String(row.id),
        channel: row.channel ?? null,
        status: row.status ?? null,
        orderName: row.order_name ?? null,
        externalOrderId: row.external_order_id ?? null,
        totalAmount: row.total_amount == null ? null : Number(row.total_amount),
        subtotalAmount: row.subtotal_amount == null ? null : Number(row.subtotal_amount),
        taxAmount: row.tax_amount == null ? null : Number(row.tax_amount),
        discountAmount: row.discount_amount == null ? null : Number(row.discount_amount),
      }));
    },

    async fetchShopifyRefundsForDay(dateStr: string): Promise<RefundRow[]> {
      const r: any = await db.execute(sql`
        SELECT rr.rma_number, ri.unit_price, ri.qty_received, ri.qty_approved, ri.qty_requested
        FROM return_requests rr
        JOIN return_items ri ON ri.return_request_id = rr.id
        WHERE rr.refunded_at IS NOT NULL
          AND ((rr.refunded_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Denver')::date = ${dateStr}::date
          AND upper(rr.sales_channel) LIKE '%SHOPIFY%'
      `);
      return (r.rows ?? []).map((row: any): RefundRow => ({
        rmaNumber: row.rma_number ?? null,
        unitPrice: row.unit_price == null ? null : Number(row.unit_price),
        qtyReceived: row.qty_received == null ? null : Number(row.qty_received),
        qtyApproved: row.qty_approved == null ? null : Number(row.qty_approved),
        qtyRequested: row.qty_requested == null ? null : Number(row.qty_requested),
      }));
    },

    async getExistingProposals(docNumber: string): Promise<ExistingProposal[]> {
      const r: any = await db.execute(sql`
        SELECT id, status FROM daily_je_proposals WHERE doc_number = ${docNumber}
      `);
      return (r.rows ?? []).map((row: any) => ({ id: Number(row.id), status: String(row.status) }));
    },

    async supersedeProposals(ids: number[]): Promise<void> {
      for (const id of ids) {
        await db.execute(sql`
          UPDATE daily_je_proposals SET status = 'superseded', decided_at = now()
          WHERE id = ${id} AND status IN ('pending', 'blocked')
        `);
      }
    },

    async updateBlockedProposal(id, patch): Promise<void> {
      await db.execute(sql`
        UPDATE daily_je_proposals
        SET lines = ${JSON.stringify(patch.lines)}, feeder = ${JSON.stringify(patch.feeder)},
            block_reason = ${patch.blockReason}, created_at = now()
        WHERE id = ${id} AND status = 'blocked'
      `);
    },

    async insertProposal(p): Promise<number> {
      const r: any = await db.execute(sql`
        INSERT INTO daily_je_proposals (target_date, channel, doc_number, lines, feeder, status, block_reason)
        VALUES (${p.targetDate}, ${p.channel}, ${p.docNumber}, ${JSON.stringify(p.lines)},
                ${JSON.stringify(p.feeder)}, ${p.status}, ${p.blockReason})
        RETURNING id
      `);
      return Number(r.rows?.[0]?.id);
    },

    async getQbo(): Promise<QboPort | null> {
      const client = await findQboClient();
      return client ? qboPortFor(client) : null;
    },
  };
}

// ── Draft (writes proposals only; NEVER posts to QuickBooks) ─────────────

/**
 * [DETERMINISTIC] Draft both channels' daily-sales JE proposals for one MT
 * date (default: yesterday MT). Guards:
 *  - refuses dates <= 2026-07-09 (already posted by hand) and dates that are
 *    not yet complete in MT;
 *  - DATA GAPS BLOCK: an order missing a required amount column stores the
 *    proposal 'blocked' with the gap named — never a fabricated $0;
 *  - balance check to the cent, else the proposal is stored 'blocked';
 *  - A2X-in-period and doc-number-already-in-QBO checks, else 'blocked';
 *  - supersedes stale pending proposals for the same doc_number;
 *  - a channel that THROWS is stored as a 'blocked' proposal carrying the
 *    error (visible + re-draftable); only if even that write fails does the
 *    channel come back 'refused' (which the scheduler records as a failure).
 * Never posts. Posting happens exclusively in approveProposal().
 */
export async function draftDailyJes(
  forDate?: string,
  opts?: { onlyIfMissing?: boolean },
  deps: DraftDeps = realDeps(),
): Promise<DraftRunResult> {
  const today = deps.nowMtDate();
  const targetDate = forDate ?? addDaysToDateString(today, -1);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { ok: false, targetDate, error: `Invalid date '${targetDate}' — expected YYYY-MM-DD`, channels: [] };
  }
  if (targetDate < EARLIEST_DRAFT_DATE) {
    return {
      ok: false,
      targetDate,
      error: `Refusing to draft ${targetDate}: daily JEs through 2026-07-09 were already posted by hand (QBO 18556-18575); drafting them again would double-book.`,
      channels: [],
    };
  }
  if (targetDate >= today) {
    return { ok: false, targetDate, error: `Refusing to draft ${targetDate}: the MT day is not complete yet.`, channels: [] };
  }

  const [allOrders, refundItems] = await Promise.all([
    deps.fetchOrdersForDay(targetDate),
    deps.fetchShopifyRefundsForDay(targetDate),
  ]);

  // Identity-dedupe across the WHOLE day (all channels together) so a
  // relabeled-channel twin collapses onto its original before bucketing.
  const deduped = dedupeOrdersByIdentity(allOrders);
  // CANCELLED orders never book revenue/AR; the exclusion is recorded in the
  // feeder below. REFUNDED / PENDING_REFUND stay in — their refund books
  // separately (Dr 25) on the refunded_at day; excluding the sale too would
  // subtract the revenue twice.
  const isCancelled = (o: OrderRow) => (o.status ?? "").toUpperCase() === "CANCELLED";
  const orders = deduped.filter((o) => !isCancelled(o));
  const cancelled = deduped.filter(isCancelled);
  const inChannel = (o: OrderRow, ch: string) => (o.channel ?? "").toUpperCase().includes(ch);
  const shopifyOrders = orders.filter((o) => inChannel(o, "SHOPIFY"));
  const amazonOrders = orders.filter((o) => inChannel(o, "AMAZON"));

  const computations: DraftComputation[] = [
    computeShopifyDraft(targetDate, shopifyOrders, refundItems),
    computeAmazonDraft(targetDate, amazonOrders),
  ];
  for (const comp of computations) {
    const excl = cancelled.filter((o) => inChannel(o, comp.channel));
    comp.feeder.ordersExcludedCancelled = excl.length;
    comp.feeder.excludedCancelledOrderNames = excl.slice(0, 50).map((o) => o.orderName || o.externalOrderId || o.id);
  }

  const channels: ChannelDraftResult[] = [];

  /**
   * A channel-day that throws must leave a VISIBLE trace: store (or refresh)
   * a 'blocked' proposal carrying the error so the Bookkeeping page shows the
   * hole and the nightly re-draft can heal it. A concurrent-insert unique
   * violation is not a failure — the twin process won; a live row exists.
   */
  const persistFailureTrace = async (
    comp: DraftComputation,
    decision: Extract<DraftAction, { action: "draft" }> | null,
    err: any,
  ): Promise<ChannelDraftResult> => {
    const msg = err?.message ?? String(err ?? "draft failed");
    const base = { channel: comp.channel, docNumber: comp.docNumber } as const;
    if (err?.code === "23505" || /duplicate key value/i.test(msg)) {
      return { ...base, outcome: "skipped_exists", reason: "A concurrent draft already inserted a live proposal for this doc number." };
    }
    console.error(`[Daily JE] draft failed for ${comp.docNumber}:`, msg);
    const blockReason = `Draft failed: ${msg}. Stored as a blocked draft so the day stays visible; it re-drafts automatically on the next nightly run.`;
    try {
      if (decision?.blockedIdToUpdate != null) {
        await deps.updateBlockedProposal(decision.blockedIdToUpdate, { lines: comp.lines, feeder: comp.feeder, blockReason });
        return { ...base, outcome: "drafted_blocked", reason: blockReason, proposalId: decision.blockedIdToUpdate };
      }
      const id = await deps.insertProposal({
        targetDate: comp.targetDate, channel: comp.channel, docNumber: comp.docNumber,
        lines: comp.lines, feeder: comp.feeder, status: "blocked", blockReason,
      });
      return { ...base, outcome: "drafted_blocked", reason: blockReason, proposalId: id };
    } catch (e2: any) {
      console.error(`[Daily JE] could not store the failure trace for ${comp.docNumber}:`, e2?.message ?? e2);
      return { ...base, outcome: "refused", reason: msg };
    }
  };

  // Phase 1 — decide per channel from OUR table only (no QBO needed yet).
  const work: Array<{ comp: DraftComputation; decision: Extract<DraftAction, { action: "draft" }> }> = [];
  for (const comp of computations) {
    const base = { channel: comp.channel, docNumber: comp.docNumber } as const;
    try {
      if (!comp.hasActivity) {
        channels.push({ ...base, outcome: "skipped_no_activity", reason: "No orders or refunds on this MT day" });
        continue;
      }
      const existing = await deps.getExistingProposals(comp.docNumber);
      const decision = decideDraftAction(existing, opts);
      if (decision.action === "skip") {
        channels.push({
          ...base,
          outcome:
            decision.reason === "already_posted" ? "skipped_already_posted"
            : decision.reason === "posting" ? "skipped_posting"
            : decision.reason === "rejected" ? "skipped_rejected"
            : "skipped_exists",
        });
        continue;
      }
      work.push({ comp, decision });
    } catch (e: any) {
      channels.push(await persistFailureTrace(comp, null, e));
    }
  }

  // Phase 2 — only channels that actually draft need the QBO guard pass.
  if (work.length > 0) {
    let qbo: QboPort | null = null;
    try {
      qbo = await deps.getQbo();
    } catch (e: any) {
      console.warn("[Daily JE] QBO client unavailable for guards:", e?.message ?? e);
    }
    const { start: monthStart, end: monthEnd } = monthBoundsOf(targetDate);
    let a2xEntries: Array<{ Id: string; DocNumber?: string; TxnDate?: string }> = [];
    let a2xLookupFailed = false;
    if (qbo) {
      try {
        a2xEntries = await qbo.findA2xJesInPeriod(monthStart, monthEnd);
      } catch (e: any) {
        a2xLookupFailed = true;
        console.warn("[Daily JE] A2X guard query failed:", e?.message ?? e);
      }
    }

    for (const { comp, decision } of work) {
      const base = { channel: comp.channel, docNumber: comp.docNumber } as const;
      try {
        // Guards — data gaps block first (nothing else can be trusted when
        // inputs are missing), then balance, then the QBO idempotency + A2X
        // double-count checks.
        let blockReason: string | null = null;
        if (comp.gapBlockReason) {
          blockReason = comp.gapBlockReason;
        } else if (!comp.balanced) {
          blockReason = `Journal entry does not balance: debits $${comp.debitTotal.toFixed(2)} vs credits $${comp.creditTotal.toFixed(2)}. Source data needs review before this can be posted.`;
        } else {
          let docMatches: Array<{ Id: string }> = [];
          let docLookupOk = false;
          if (qbo && !a2xLookupFailed) {
            try {
              docMatches = await qbo.findJesByDocNumber(comp.docNumber);
              docLookupOk = true;
            } catch (e: any) {
              console.warn(`[Daily JE] doc-number guard query failed for ${comp.docNumber}:`, e?.message ?? e);
            }
          }
          blockReason = evaluateGuards({
            docNumber: comp.docNumber,
            docNumberMatches: docMatches,
            a2xEntries,
            qboAvailable: !!qbo && !a2xLookupFailed && docLookupOk,
          });
        }

        const status: "pending" | "blocked" = blockReason ? "blocked" : "pending";

        // Supersede stale pending drafts (and stray older blocked twins);
        // refresh the standing blocked row in place instead of stacking one
        // per run.
        if (decision.supersedeIds.length) await deps.supersedeProposals(decision.supersedeIds);
        if (status === "blocked" && decision.blockedIdToUpdate != null) {
          await deps.updateBlockedProposal(decision.blockedIdToUpdate, {
            lines: comp.lines,
            feeder: comp.feeder,
            blockReason: blockReason!,
          });
          channels.push({ ...base, outcome: "drafted_blocked", reason: blockReason!, proposalId: decision.blockedIdToUpdate });
          continue;
        }
        if (decision.blockedIdToUpdate != null) {
          // Block cleared — retire the old blocked row, then insert fresh.
          await deps.supersedeProposals([decision.blockedIdToUpdate]);
        }

        const id = await deps.insertProposal({
          targetDate: comp.targetDate,
          channel: comp.channel,
          docNumber: comp.docNumber,
          lines: comp.lines,
          feeder: comp.feeder,
          status,
          blockReason,
        });
        channels.push({
          ...base,
          outcome: status === "pending" ? "drafted_pending" : "drafted_blocked",
          reason: blockReason ?? undefined,
          proposalId: id,
        });
      } catch (e: any) {
        channels.push(await persistFailureTrace(comp, decision, e));
      }
    }
  }

  const drafted = channels.filter((c) => c.outcome === "drafted_pending" || c.outcome === "drafted_blocked");
  if (drafted.length) {
    await AuditLogger.logEvent({
      source: "QUICKBOOKS",
      eventType: "DAILY_JE_DRAFT",
      status: "INFO",
      description: `Daily sales JE draft for ${targetDate}: ${channels.map((c) => `${c.channel} ${c.outcome}`).join(", ")}`,
      details: { targetDate, channels },
    }).catch((e) => console.warn("[Daily JE] audit log failed:", e?.message ?? e));
  }

  return { ok: true, targetDate, channels };
}

/**
 * Backfill: draft any missing MT dates from EARLIEST_DRAFT_DATE (2026-07-10)
 * through yesterday. A date already carrying a pending, posting, posted, or
 * human-rejected proposal is left alone; blocked/superseded-only dates are
 * re-evaluated so a transient guard failure self-heals. Runs at boot AND on
 * every nightly tick — a channel-day that failed to draft (or a deploy that
 * straddled 2:30 AM) is swept up the next night, not the next redeploy.
 */
export async function backfillMissingDailyJes(deps: DraftDeps = realDeps()): Promise<{
  daysChecked: number;
  drafted: number;
  blocked: number;
  refused: number;
  results: DraftRunResult[];
}> {
  const results: DraftRunResult[] = [];
  let drafted = 0;
  let blocked = 0;
  let refused = 0;
  const lastDay = addDaysToDateString(deps.nowMtDate(), -1);
  let daysChecked = 0;
  for (let d = EARLIEST_DRAFT_DATE; d <= lastDay; d = addDaysToDateString(d, 1)) {
    daysChecked++;
    const r = await draftDailyJes(d, { onlyIfMissing: true }, deps);
    results.push(r);
    if (!r.ok) refused++;
    for (const c of r.channels) {
      if (c.outcome === "drafted_pending") drafted++;
      if (c.outcome === "drafted_blocked") blocked++;
      if (c.outcome === "refused") refused++;
    }
    // Safety valve — never loop unbounded on a clock anomaly.
    if (daysChecked > 400) break;
  }
  return { daysChecked, drafted, blocked, refused, results };
}

// ── Approve / Reject (the ONLY QuickBooks write path; human-gated) ───────

export interface ApproveDeps {
  loadProposal(id: number): Promise<ProposalRow | null>;
  /**
   * ATOMIC CLAIM: compare-and-set status 'pending' → 'posting' and return the
   * claimed row, or null when the row was not claimable (missing, already
   * posting, blocked, decided). This runs BEFORE any QBO call — it is the
   * double-post lock.
   */
  claimProposal(id: number, userId: string): Promise<ProposalRow | null>;
  /** Release a claim: 'posting' → 'pending' (only safe when we KNOW no JE landed). */
  releaseClaim(id: number): Promise<void>;
  /** 'posting' → 'approved_posted' with the QBO JE id. Conditional on 'posting'. */
  markPosted(id: number, jeId: string, userId: string): Promise<void>;
  markBlocked(id: number, reason: string, userId: string): Promise<void>;
  getQbo(preferredUserId?: string): Promise<QboPort | null>;
}

function realApproveDeps(): ApproveDeps {
  return {
    async loadProposal(id: number): Promise<ProposalRow | null> {
      const r: any = await db.execute(sql`SELECT * FROM daily_je_proposals WHERE id = ${id}`);
      const row = r.rows?.[0];
      return row ? parseProposalRow(row) : null;
    },
    async claimProposal(id: number, userId: string): Promise<ProposalRow | null> {
      const r: any = await db.execute(sql`
        UPDATE daily_je_proposals
        SET status = 'posting', decided_by = ${userId}, decided_at = now()
        WHERE id = ${id} AND status = 'pending'
        RETURNING *
      `);
      const row = r.rows?.[0];
      return row ? parseProposalRow(row) : null;
    },
    async releaseClaim(id: number): Promise<void> {
      await db.execute(sql`
        UPDATE daily_je_proposals
        SET status = 'pending', decided_by = NULL, decided_at = NULL
        WHERE id = ${id} AND status = 'posting'
      `);
    },
    async markPosted(id, jeId, userId) {
      await db.execute(sql`
        UPDATE daily_je_proposals
        SET status = 'approved_posted', posted_je_id = ${jeId}, decided_by = ${userId}, decided_at = now()
        WHERE id = ${id} AND status = 'posting'
      `);
    },
    async markBlocked(id, reason, userId) {
      await db.execute(sql`
        UPDATE daily_je_proposals
        SET status = 'blocked', block_reason = ${reason}, decided_by = ${userId}, decided_at = now()
        WHERE id = ${id} AND status IN ('pending', 'posting')
      `);
    },
    async getQbo(preferredUserId?: string) {
      const client = await findQboClient(preferredUserId);
      return client ? qboPortFor(client) : null;
    },
  };
}

export interface ApproveResult {
  ok: boolean;
  error?: string;
  postedJeId?: string;
  /** true = the request lost a race (someone else holds/held the row) → HTTP 409. */
  conflict?: boolean;
  /** true = the QBO call failed but the recheck proved the JE landed; adopted. */
  adoptedAfterFailure?: boolean;
}

/**
 * [HUMAN GATED] Post an approved proposal to QuickBooks.
 *
 * Sequence (each step fails closed):
 *  1. ATOMIC CLAIM — pending → 'posting' via compare-and-set; 0 rows = someone
 *     else is (or was) posting this row → 409, no QBO call is ever made.
 *  2. Balance re-check on the stored lines (tamper guard) — an unbalanced or
 *     empty entry is marked 'blocked', never posted.
 *  3. Guard re-check at the moment of truth: BOTH the exact-DocNumber lookup
 *     AND the A2X-in-period lookup (drafts can sit for days; A2X may have
 *     booked the month since). A guard hit → 'blocked'. A guard QUERY failure
 *     → claim released, retryable error — not posting blind.
 *  4. POST /journalentry, then 'posting' → 'approved_posted' with the JE id.
 *
 * If the QBO post THROWS after the claim, the outcome is unknown (a timeout
 * can land the JE anyway). Recovery, in order:
 *   a. re-query the DocNumber: found → the JE DID land; adopt it (markPosted
 *      with the found id) — the books and the app agree, no double post;
 *   b. not found → the post verifiably failed; release the claim back to
 *      'pending' so the human can retry (the retry re-runs step 3 before
 *      posting — residual risk is QBO's seconds-scale query lag vs. the
 *      human retry loop, plus the nightly doc-number guard as backstop);
 *   c. the recovery query ITSELF fails → we truly cannot know; the row is
 *      marked 'blocked' ("post outcome unknown") — the nightly re-draft's
 *      doc-number guard resolves it either way once QBO answers.
 */
export async function approveProposal(
  proposalId: number,
  userId: string,
  deps: ApproveDeps = realApproveDeps(),
): Promise<ApproveResult> {
  // 1. Atomic claim BEFORE any QBO traffic.
  const p = await deps.claimProposal(proposalId, userId);
  if (!p) {
    const existing = await deps.loadProposal(proposalId);
    if (!existing) return { ok: false, error: "Proposal not found" };
    if (existing.status === "posting") {
      return { ok: false, conflict: true, error: "This proposal is already being posted by another request. Refresh to see the result." };
    }
    return { ok: false, conflict: true, error: `Proposal is ${existing.status}, not pending` };
  }

  // 2. Tamper guard on the stored lines.
  const lines = p.lines ?? [];
  const { balanced, debitTotal, creditTotal } = sumDebitsCredits(lines);
  if (!lines.length || !balanced) {
    const reason = `Refusing to post: entry is ${lines.length ? `not balanced (debits $${debitTotal.toFixed(2)} vs credits $${creditTotal.toFixed(2)})` : "empty"}. Re-draft before approving.`;
    await deps.markBlocked(proposalId, reason, userId);
    return { ok: false, error: reason };
  }

  const qbo = await deps.getQbo(userId);
  if (!qbo) {
    await deps.releaseClaim(proposalId);
    return { ok: false, error: "QuickBooks not connected" };
  }

  const targetDate = toDateOnlyString(p.target_date);

  // 3. Guard re-check at the moment of truth: doc-number AND A2X. A draft can
  // sit pending for days; A2X may have booked the month in the meantime.
  try {
    const { start: monthStart, end: monthEnd } = monthBoundsOf(targetDate);
    const [matches, a2xEntries] = await Promise.all([
      qbo.findJesByDocNumber(p.doc_number),
      qbo.findA2xJesInPeriod(monthStart, monthEnd),
    ]);
    const reason = evaluateGuards({ docNumber: p.doc_number, docNumberMatches: matches, a2xEntries, qboAvailable: true });
    if (reason) {
      await deps.markBlocked(proposalId, reason, userId);
      return { ok: false, error: reason };
    }
  } catch (e: any) {
    await deps.releaseClaim(proposalId);
    return { ok: false, error: `Could not verify the doc-number/A2X guards in QuickBooks (${e?.message ?? e}) — not posting blind.` };
  }

  const feeder: any = p.feeder ?? {};
  const body = {
    TxnDate: targetDate,
    DocNumber: p.doc_number,
    PrivateNote: `BOOK.E daily sales JE — ${p.channel} ${targetDate} (MT): ${feeder.orders ?? "?"} orders, total $${Number(feeder.total ?? 0).toFixed(2)}. Drafted by app, approved by ${userId}.`,
    Line: lines,
  };

  // 4. The one QBO write.
  try {
    const posted = await qbo.postJournalEntry(body);
    await deps.markPosted(proposalId, posted.Id, userId);
    await AuditLogger.logEvent({
      source: "QUICKBOOKS",
      eventType: "DAILY_JE_POSTED",
      status: "INFO",
      description: `Daily sales JE ${p.doc_number} (${p.channel} ${targetDate}) posted to QuickBooks as JE ${posted.Id} — $${debitTotal.toFixed(2)}`,
      details: { proposalId, userId, docNumber: p.doc_number, postedJeId: posted.Id, debitTotal, creditTotal, feeder },
    }).catch((e) => console.warn("[Daily JE] audit log failed:", e?.message ?? e));
    return { ok: true, postedJeId: posted.Id };
  } catch (e: any) {
    const msg = e?.message ?? "QuickBooks post failed";
    console.error(`[Daily JE] post failed for ${p.doc_number}:`, msg);
    // Post outcome unknown — recover via the doc-number recheck (see fn doc).
    let recovery: "adopted" | "released" | "unknown" = "unknown";
    let adoptedId: string | undefined;
    try {
      const recheck = await qbo.findJesByDocNumber(p.doc_number);
      if (recheck.length > 0) {
        adoptedId = recheck[0].Id;
        await deps.markPosted(proposalId, adoptedId, userId);
        recovery = "adopted";
      } else {
        await deps.releaseClaim(proposalId);
        recovery = "released";
      }
    } catch {
      await deps.markBlocked(
        proposalId,
        `QuickBooks post failed (${msg}) and the outcome could not be verified — check QuickBooks for DocNumber ${p.doc_number} before retrying. The nightly re-draft resolves this automatically once QuickBooks answers.`,
        userId,
      );
      recovery = "unknown";
    }
    await AuditLogger.logEvent({
      source: "QUICKBOOKS",
      eventType: "DAILY_JE_POST_FAILED",
      status: "ERROR",
      description: `Daily sales JE ${p.doc_number} post error: ${msg} (recovery: ${recovery}${adoptedId ? `, adopted JE ${adoptedId}` : ""})`,
      details: { proposalId, userId, docNumber: p.doc_number, recovery, adoptedId },
    }).catch(() => {});
    if (recovery === "adopted") {
      // The JE actually landed despite the error — books and app now agree.
      return { ok: true, postedJeId: adoptedId, adoptedAfterFailure: true };
    }
    if (recovery === "released") {
      return { ok: false, error: `${msg} — nothing was posted; the proposal is pending again and can be retried.` };
    }
    return { ok: false, error: `${msg} — post outcome unknown; the proposal was blocked until QuickBooks can be checked.` };
  }
}

export async function rejectProposal(proposalId: number, userId: string): Promise<boolean> {
  const r: any = await db.execute(sql`
    UPDATE daily_je_proposals
    SET status = 'rejected', decided_by = ${userId}, decided_at = now()
    WHERE id = ${proposalId} AND status IN ('pending', 'blocked')
  `);
  const ok = ((r.rowCount as number) ?? 0) > 0;
  if (ok) {
    await AuditLogger.logEvent({
      source: "QUICKBOOKS",
      eventType: "DAILY_JE_REJECTED",
      status: "INFO",
      description: `Daily sales JE proposal ${proposalId} rejected — nothing posted to QuickBooks`,
      details: { proposalId, userId },
    }).catch(() => {});
  }
  return ok;
}

// ── Re-draft (the recovery lever for a mis-clicked Dismiss) ──────────────

export interface RedraftDeps {
  /**
   * Conditional flip rejected/blocked → 'superseded'; returns the row's
   * target date + doc number, or null when the row wasn't in a re-draftable
   * status (races with approve/reject are refused, never forced).
   */
  supersedeDecided(id: number, userId: string): Promise<{ targetDate: string; docNumber: string; channel: string } | null>;
  loadProposal(id: number): Promise<ProposalRow | null>;
  draft(dateStr: string): Promise<DraftRunResult>;
}

function realRedraftDeps(): RedraftDeps {
  return {
    async supersedeDecided(id: number, userId: string) {
      const r: any = await db.execute(sql`
        UPDATE daily_je_proposals
        SET status = 'superseded', decided_by = ${userId}, decided_at = now()
        WHERE id = ${id} AND status IN ('rejected', 'blocked')
        RETURNING target_date, doc_number, channel
      `);
      const row = r.rows?.[0];
      return row
        ? { targetDate: toDateOnlyString(row.target_date), docNumber: String(row.doc_number), channel: String(row.channel) }
        : null;
    },
    loadProposal: realApproveDeps().loadProposal,
    draft: (dateStr: string) => draftDailyJes(dateStr),
  };
}

/**
 * [HUMAN GATED] Re-open a rejected (or blocked) channel-day: the old row is
 * retired to 'superseded' and the date is drafted fresh through the full
 * guard pass. This is the recovery path for a mis-clicked Dismiss — without
 * it a rejection would be a permanent, silent hole in the books.
 */
export async function redraftProposal(
  proposalId: number,
  userId: string,
  deps: RedraftDeps = realRedraftDeps(),
): Promise<{ ok: boolean; error?: string; conflict?: boolean; run?: DraftRunResult }> {
  const retired = await deps.supersedeDecided(proposalId, userId);
  if (!retired) {
    const existing = await deps.loadProposal(proposalId);
    if (!existing) return { ok: false, error: "Proposal not found" };
    return {
      ok: false,
      conflict: true,
      error: `Proposal is ${existing.status} — only rejected or blocked proposals can be re-drafted.`,
    };
  }
  const run = await deps.draft(retired.targetDate);
  await AuditLogger.logEvent({
    source: "QUICKBOOKS",
    eventType: "DAILY_JE_REDRAFT",
    status: "INFO",
    description: `Daily sales JE proposal ${proposalId} (${retired.docNumber}) re-drafted by ${userId}: ${run.channels.map((c) => `${c.channel} ${c.outcome}`).join(", ") || run.error || "no channels"}`,
    details: { proposalId, userId, docNumber: retired.docNumber, run },
  }).catch(() => {});
  return { ok: true, run };
}

// ── Stuck-claim reconciliation (server died between claim and record) ────

export interface ReconcileDeps {
  /** 'posting' rows older than the threshold (claimed but never resolved). */
  listStuckPosting(olderThanMinutes: number): Promise<ProposalRow[]>;
  releaseClaim(id: number): Promise<void>;
  markPosted(id: number, jeId: string, userId: string): Promise<void>;
  getQbo(): Promise<QboPort | null>;
}

function realReconcileDeps(): ReconcileDeps {
  const approve = realApproveDeps();
  return {
    async listStuckPosting(olderThanMinutes: number): Promise<ProposalRow[]> {
      const r: any = await db.execute(sql`
        SELECT * FROM daily_je_proposals
        WHERE status = 'posting'
          AND (decided_at IS NULL OR decided_at < now() - make_interval(mins => ${olderThanMinutes}))
      `);
      return (r.rows ?? []).map(parseProposalRow);
    },
    releaseClaim: approve.releaseClaim,
    markPosted: approve.markPosted,
    getQbo: () => approve.getQbo(),
  };
}

/**
 * A row stuck in 'posting' means the server died between the claim and the
 * outcome record — the JE may or may not be in QuickBooks. For each stale
 * claim: query the DocNumber; found → adopt it as posted (books and app
 * agree); verifiably absent → release the claim back to 'pending'; QBO
 * unanswerable → leave the claim standing (visible in the UI as "Posting…",
 * retried on the next sweep) — never guess.
 */
export async function reconcileStuckPostingProposals(
  deps: ReconcileDeps = realReconcileDeps(),
  olderThanMinutes = 10,
): Promise<{ checked: number; adopted: number; released: number; unresolved: number }> {
  const stuck = await deps.listStuckPosting(olderThanMinutes);
  const out = { checked: stuck.length, adopted: 0, released: 0, unresolved: 0 };
  if (!stuck.length) return out;

  let qbo: QboPort | null = null;
  try {
    qbo = await deps.getQbo();
  } catch {
    qbo = null;
  }
  if (!qbo) {
    out.unresolved = stuck.length;
    console.warn(`[Daily JE] ${stuck.length} proposal(s) stuck in 'posting' but QBO is unavailable — leaving them for the next sweep.`);
    return out;
  }

  for (const p of stuck) {
    try {
      const matches = await qbo.findJesByDocNumber(p.doc_number);
      if (matches.length > 0) {
        await deps.markPosted(p.id, matches[0].Id, p.decided_by ?? "system:reconcile");
        out.adopted++;
        await AuditLogger.logEvent({
          source: "QUICKBOOKS",
          eventType: "DAILY_JE_POSTED",
          status: "INFO",
          description: `Daily sales JE ${p.doc_number} found in QuickBooks as JE ${matches[0].Id} while reconciling a stale 'posting' claim — adopted.`,
          details: { proposalId: p.id, docNumber: p.doc_number, postedJeId: matches[0].Id, reconciled: true },
        }).catch(() => {});
      } else {
        await deps.releaseClaim(p.id);
        out.released++;
        console.log(`[Daily JE] Released stale posting claim on ${p.doc_number} (no JE in QBO) — pending again.`);
      }
    } catch (e: any) {
      out.unresolved++;
      console.warn(`[Daily JE] Could not reconcile stale posting claim on ${p.doc_number}:`, e?.message ?? e);
    }
  }
  return out;
}

// ── List (for the Bookkeeping page card) ─────────────────────────────────

export async function listDailyJeProposals(): Promise<ProposalRow[]> {
  const r: any = await db.execute(sql`
    SELECT * FROM daily_je_proposals
    ORDER BY target_date DESC, channel ASC, created_at DESC
    LIMIT 120
  `);
  return (r.rows ?? []).map((row: any) => ({
    ...parseProposalRow(row),
    target_date: toDateOnlyString(row.target_date),
  }));
}
