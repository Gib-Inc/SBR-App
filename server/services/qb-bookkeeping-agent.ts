/**
 * BOOK.E — the SBR bookkeeping agent (crawl phase).
 *
 * Sweeps QuickBooks Purchases + Bills whose expense lines sit in the
 * "uncategorized" holding accounts (Uncategorized Expense / Uncategorized
 * Income / Ask My Accountant), asks Claude to propose a real category with a
 * confidence score, and persists the proposals for HUMAN review. Nothing is
 * ever written back to QuickBooks from the scan — write-back happens only in
 * applyProposal(), which runs when a person clicks Approve in the app.
 *
 * Architecture rule this file demonstrates (keep it when extending):
 *   [DETERMINISTIC]  fetching txns, filtering lines, vendor history SQL,
 *                    validation, persistence, write-back — plain code.
 *   [LLM JUDGMENT]   exactly one function (categorizeBatch) lets the model
 *                    think, and its output is validated before it is stored.
 *
 * Known limit: the QBO API cannot see the bank-feed "For Review" pile (Intuit
 * keeps that UI-only). This agent works the next-best queue — transactions
 * already posted to the uncategorized holding accounts.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { QuickBooksClient } from "./quickbooks-client";
import { AuditLogger } from "./audit-logger";
import { getAnthropicClient, CLAUDE_MODEL_FAST } from "./llm";
import type Anthropic from "@anthropic-ai/sdk";

// ── Types ────────────────────────────────────────────────────────────────

export interface CoaAccount {
  id: string;
  name: string;
  type: string;
  subType: string;
  classification: string;
}

interface CandidateLine {
  txnType: "Purchase" | "Bill";
  qbTxnId: string;
  qbLineId: string;
  txnDate: string | null;
  docNumber: string | null;
  vendorName: string | null;
  description: string | null;
  amount: number;
  currentAccountId: string;
  currentAccountName: string;
  paidFrom: string | null; // bank/CC account the Purchase was paid from
}

interface VendorHistoryEntry {
  account: string;
  txns: number;
  total: number;
}

export interface ScanResult {
  ok: boolean;
  error?: string;
  scanned?: number;      // uncategorized lines found in window
  proposed?: number;     // new proposals written
  skipped?: number;      // already had a proposal (any status)
  staled?: number;       // pending proposals whose line is no longer uncategorized
  truncated?: boolean;   // hit maxLines cap
  llmErrors?: number;    // lines dropped because the model's answer failed validation
}

export interface ProposalRow {
  id: number;
  txn_type: string;
  qb_txn_id: string;
  qb_line_id: string;
  txn_date: string | null;
  doc_number: string | null;
  vendor_name: string | null;
  description: string | null;
  amount: number;
  current_account_id: string;
  current_account_name: string;
  proposed_account_id: string;
  proposed_account_name: string;
  confidence: number;
  reasoning: string | null;
  vendor_history: VendorHistoryEntry[] | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  apply_error: string | null;
  created_at: string;
}

// ── Config ───────────────────────────────────────────────────────────────

/** Holding accounts we sweep. Matched case-insensitively against Account.Name. */
const TARGET_ACCOUNT_PATTERNS = [/uncategori[sz]ed/i, /ask my accountant/i];

/** Proposals at/above this ride the "high confidence" bulk-approve rail in the UI. */
export const HIGH_CONFIDENCE = 0.9;

const LLM_BATCH_SIZE = 15;

// ── [DETERMINISTIC] helpers ──────────────────────────────────────────────

const isTargetAccount = (name: string | undefined | null) =>
  !!name && TARGET_ACCOUNT_PATTERNS.some((re) => re.test(name));

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Historical account distribution per vendor from the qb_pl_detail GL mirror —
 * the strongest categorization signal we own. One query for all vendors.
 */
async function getVendorHistories(
  realmId: string,
  vendors: string[],
): Promise<Map<string, VendorHistoryEntry[]>> {
  const map = new Map<string, VendorHistoryEntry[]>();
  const names = vendors.filter(Boolean);
  if (!names.length) return map;
  const r: any = await db.execute(sql`
    SELECT vendor_or_payee AS vendor, account_name AS account,
           count(*)::int AS txns, round(sum(amount)::numeric, 2)::float AS total
    FROM qb_pl_detail
    WHERE realm_id = ${realmId}
      AND vendor_or_payee = ANY(${names})
      AND account_name IS NOT NULL
      AND account_name !~* 'uncategori[sz]ed|ask my accountant'
    GROUP BY vendor_or_payee, account_name
    ORDER BY vendor_or_payee, count(*) DESC
  `);
  for (const row of r.rows ?? []) {
    const list = map.get(row.vendor) ?? [];
    if (list.length < 5) list.push({ account: row.account, txns: row.txns, total: row.total });
    map.set(row.vendor, list);
  }
  return map;
}

// ── [LLM JUDGMENT] the one function that thinks ──────────────────────────

const SBR_CONTEXT = `Sticker Burr Roller (SBR) manufactures and sells lawn-care sticker/burr
removal rollers, direct-to-consumer on Shopify and Amazon.
Known payees and how SBR typically books them:
- Pyvott / Pyvott Fulfillment: 3PL warehouse — shipping & fulfillment costs
- Special FX Manufacturing: manufactures roller frames — cost of goods sold
- Austi: product manufacturing — cost of goods sold
- Giant Horizons: Amazon PPC management — advertising/marketing
- Carpe Diem: marketing agency — advertising/marketing or contract labor
- Shopify, Amazon: platform/merchant fees unless clearly inventory
- GoHighLevel, Railway, Supabase, n8n, Extensiv, Shippo: software subscriptions
- Matt Gibson, Stacy Stubbs, Christopher, Chance Gibson: owners/family — payments
  to them are usually owner draws/distributions or payroll, NOT vendor expense.
Zelle/wire payments to individuals are often contractor labor or owner draws —
be honest about uncertainty there.`;

interface LlmProposal {
  id: string;
  accountId: string;
  confidence: number;
  reasoning: string;
}

/**
 * Ask Claude to categorize one batch of transactions. Returns only answers
 * that survive validation (known account id, sane confidence). An honest
 * "I'm not sure" (low confidence) is explicitly rewarded in the prompt —
 * that is what makes the confidence gate mean something.
 */
async function categorizeBatch(
  lines: CandidateLine[],
  candidates: CoaAccount[],
  histories: Map<string, VendorHistoryEntry[]>,
): Promise<Map<string, LlmProposal>> {
  const client = getAnthropicClient();

  const coaBlock = candidates
    .map((a) => `${a.id}: ${a.name} (${a.type}${a.subType ? "/" + a.subType : ""})`)
    .join("\n");

  const txnBlock = lines
    .map((l) => {
      const key = `${l.txnType}:${l.qbTxnId}:${l.qbLineId}`;
      const hist = l.vendorName ? histories.get(l.vendorName) : undefined;
      const histTxt = hist?.length
        ? ` | history: ${hist.map((h) => `${h.account} (${h.txns}x, $${Math.abs(h.total).toFixed(0)})`).join("; ")}`
        : " | history: none on file";
      return `id=${key} | ${l.txnDate ?? "?"} | ${l.txnType}${l.docNumber ? " #" + l.docNumber : ""} | payee: ${l.vendorName ?? "(none)"} | $${l.amount.toFixed(2)}${l.paidFrom ? " | paid from: " + l.paidFrom : ""} | memo: ${l.description ?? "(none)"}${histTxt}`;
    })
    .join("\n");

  const prompt = `You are the bookkeeping categorization agent for SBR. Recategorize each
transaction below out of its uncategorized holding account into the correct
account from the chart of accounts.

${SBR_CONTEXT}

CHART OF ACCOUNTS (the ONLY valid accountId values):
${coaBlock}

TRANSACTIONS (each has a vendor's historical booking pattern when we have one):
${txnBlock}

Rules:
- confidence is 0.0-1.0. An honest low confidence on a genuinely ambiguous
  transaction is worth MORE than a confident wrong answer. Anything you mark
  >= 0.9 may be bulk-approved by a human with one click, so 0.9+ means "I would
  bet the books on it."
- Strong vendor history pointing at one account is the best evidence.
- Payments to individuals with no history: confidence <= 0.6.
- reasoning: one short sentence.

Respond with ONLY a JSON array, no prose:
[{"id": "...", "accountId": "...", "confidence": 0.95, "reasoning": "..."}]`;

  const response = await client.messages.create({
    model: CLAUDE_MODEL_FAST,
    max_tokens: 3000,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // [DETERMINISTIC] validate everything the model said before trusting it.
  const valid = new Map<string, LlmProposal>();
  const knownIds = new Set(candidates.map((a) => a.id));
  const wantedKeys = new Set(lines.map((l) => `${l.txnType}:${l.qbTxnId}:${l.qbLineId}`));
  let parsed: any;
  try {
    const jsonText = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
    parsed = JSON.parse(jsonText);
  } catch {
    console.error("[BOOK.E] LLM returned unparseable JSON, dropping batch");
    return valid;
  }
  if (!Array.isArray(parsed)) return valid;
  for (const p of parsed) {
    if (!p || typeof p !== "object") continue;
    if (!wantedKeys.has(p.id)) continue;                 // answer for a txn we didn't ask about
    if (!knownIds.has(String(p.accountId))) continue;    // hallucinated account
    const confidence = Math.max(0, Math.min(1, Number(p.confidence) || 0));
    valid.set(p.id, {
      id: p.id,
      accountId: String(p.accountId),
      confidence,
      reasoning: String(p.reasoning ?? "").slice(0, 500),
    });
  }
  return valid;
}

// ── Scan (read QBO → propose → persist; never writes to QBO) ─────────────

let scanInFlight = false;
let lastScanResult: ScanResult | null = null;
let lastScanAt: string | null = null;

/** Poll target for the UI while a fire-and-forget scan runs. */
export function getScanState(): { running: boolean; lastResult: ScanResult | null; lastRunAt: string | null } {
  return { running: scanInFlight, lastResult: lastScanResult, lastRunAt: lastScanAt };
}

export async function scanForProposals(
  userId: string,
  opts?: { days?: number; maxLines?: number },
): Promise<ScanResult> {
  if (scanInFlight) return { ok: false, error: "A scan is already running" };
  scanInFlight = true;
  const record = (r: ScanResult): ScanResult => {
    lastScanResult = r;
    lastScanAt = new Date().toISOString();
    return r;
  };
  try {
    const days = Math.min(Math.max(opts?.days ?? 90, 7), 400);
    const maxLines = Math.min(Math.max(opts?.maxLines ?? 300, 10), 1000);

    const client = new QuickBooksClient(storage, userId);
    if (!(await client.initialize())) return record({ ok: false, error: "QuickBooks not connected" });
    const auth = await storage.getQuickbooksAuth(userId);
    const realmId = auth?.realmId ?? "unknown";

    // [DETERMINISTIC] chart of accounts → target (holding) ids + candidate targets.
    const coa = await client.fetchChartOfAccounts();
    const targets = coa.filter((a) => isTargetAccount(a.name));
    if (!targets.length) return record({ ok: false, error: "No uncategorized/holding accounts found in the chart of accounts" });
    const targetIds = new Set(targets.map((a) => a.id));
    // Candidates the model may propose: expense-side accounts that are not holding accounts.
    const candidates = coa.filter(
      (a) => a.classification === "Expense" && !targetIds.has(a.id),
    );

    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    const startStr = fmtDate(start);
    const endStr = fmtDate(end);

    // [DETERMINISTIC] pull Purchases + Bills in window, keep lines parked in holding accounts.
    const purchases = await client.fetchPurchasesInRange(startStr, endStr);
    const bills = await client.fetchBillsInRange(startStr, endStr);

    const found: CandidateLine[] = [];
    for (const p of purchases) {
      for (const ln of p.Line ?? []) {
        const det = ln.AccountBasedExpenseLineDetail;
        if (!det?.AccountRef || !targetIds.has(det.AccountRef.value) || ln.Id == null) continue;
        found.push({
          txnType: "Purchase",
          qbTxnId: p.Id,
          qbLineId: String(ln.Id),
          txnDate: p.TxnDate ?? null,
          docNumber: p.DocNumber ?? null,
          vendorName: p.EntityRef?.name ?? null,
          description: ln.Description ?? null,
          amount: Number(ln.Amount) || 0,
          currentAccountId: det.AccountRef.value,
          currentAccountName: det.AccountRef.name ?? "Uncategorized",
          paidFrom: p.AccountRef?.name ?? null,
        });
      }
    }
    for (const b of bills) {
      for (const ln of b.Line ?? []) {
        const det = (ln as any).AccountBasedExpenseLineDetail;
        if (!det?.AccountRef || !targetIds.has(det.AccountRef.value) || ln.Id == null) continue;
        found.push({
          txnType: "Bill",
          qbTxnId: b.Id,
          qbLineId: String(ln.Id),
          txnDate: b.TxnDate ?? null,
          docNumber: b.DocNumber ?? null,
          vendorName: b.VendorRef?.name ?? null,
          description: (ln as any).Description ?? null,
          amount: Number((ln as any).Amount) || 0,
          currentAccountId: det.AccountRef.value,
          currentAccountName: det.AccountRef.name ?? "Uncategorized",
          paidFrom: null,
        });
      }
    }

    // [DETERMINISTIC] mark pending proposals stale when their line left the
    // uncategorized pile (someone fixed it in QBO directly). Window-scoped.
    // NOTE: a bare JS array bound to `= ANY(${arr})` serializes to a malformed
    // array literal on this pg driver — build an explicit ARRAY[...]::text[]
    // from individually-bound params (the same idiom as the ALL() hotfix). When
    // nothing was found, there's nothing to compare against — skip the sweep
    // rather than fabricate a sentinel that stales every in-window pending row.
    const seenKeys = found.map((l) => `${l.txnType}:${l.qbTxnId}:${l.qbLineId}`);
    let staled = 0;
    if (seenKeys.length) {
      const staleRes: any = await db.execute(sql`
        UPDATE qb_categorization_proposals
        SET status = 'stale'
        WHERE realm_id = ${realmId} AND status = 'pending'
          AND txn_date BETWEEN ${startStr} AND ${endStr}
          AND (txn_type || ':' || qb_txn_id || ':' || qb_line_id) <> ALL(ARRAY[${sql.join(seenKeys.map((k) => sql`${k}`), sql`, `)}]::text[])
      `);
      staled = (staleRes.rowCount as number) ?? 0;
    }

    // [DETERMINISTIC] drop lines that already have a proposal (any status).
    const existing: any = await db.execute(sql`
      SELECT txn_type || ':' || qb_txn_id || ':' || qb_line_id AS key
      FROM qb_categorization_proposals WHERE realm_id = ${realmId}
    `);
    const existingKeys = new Set((existing.rows ?? []).map((r: any) => r.key));
    let fresh = found.filter((l) => !existingKeys.has(`${l.txnType}:${l.qbTxnId}:${l.qbLineId}`));
    const skipped = found.length - fresh.length;
    const truncated = fresh.length > maxLines;
    if (truncated) fresh = fresh.slice(0, maxLines);

    if (!fresh.length) {
      return record({ ok: true, scanned: found.length, proposed: 0, skipped, staled, truncated: false, llmErrors: 0 });
    }

    // [DETERMINISTIC] vendor histories for grounding.
    const histories = await getVendorHistories(
      realmId,
      Array.from(new Set(fresh.map((l) => l.vendorName).filter((v): v is string => !!v))),
    );

    // [LLM JUDGMENT] categorize in batches; validate; persist.
    let proposed = 0;
    let llmErrors = 0;
    for (let i = 0; i < fresh.length; i += LLM_BATCH_SIZE) {
      const batch = fresh.slice(i, i + LLM_BATCH_SIZE);
      let answers: Map<string, LlmProposal>;
      try {
        answers = await categorizeBatch(batch, candidates, histories);
      } catch (e: any) {
        console.error("[BOOK.E] categorizeBatch failed:", e?.message ?? e);
        llmErrors += batch.length;
        continue;
      }
      const accountById = new Map(candidates.map((a) => [a.id, a]));
      for (const l of batch) {
        const key = `${l.txnType}:${l.qbTxnId}:${l.qbLineId}`;
        const ans = answers.get(key);
        if (!ans) { llmErrors++; continue; }
        const acct = accountById.get(ans.accountId)!;
        const hist = l.vendorName ? histories.get(l.vendorName) ?? null : null;
        await db.execute(sql`
          INSERT INTO qb_categorization_proposals
            (realm_id, txn_type, qb_txn_id, qb_line_id, txn_date, doc_number,
             vendor_name, description, amount, current_account_id, current_account_name,
             proposed_account_id, proposed_account_name, confidence, reasoning, vendor_history)
          VALUES
            (${realmId}, ${l.txnType}, ${l.qbTxnId}, ${l.qbLineId}, ${l.txnDate}, ${l.docNumber},
             ${l.vendorName}, ${l.description}, ${l.amount}, ${l.currentAccountId}, ${l.currentAccountName},
             ${ans.accountId}, ${acct.name}, ${ans.confidence}, ${ans.reasoning}, ${hist ? JSON.stringify(hist) : null})
          ON CONFLICT (realm_id, txn_type, qb_txn_id, qb_line_id) DO NOTHING
        `);
        proposed++;
      }
    }

    await AuditLogger.logEvent({
      source: "QUICKBOOKS",
      eventType: "BOOKKEEPING_SCAN",
      status: "INFO",
      description: `BOOK.E scan: ${found.length} uncategorized lines, ${proposed} new proposals`,
      details: { days, scanned: found.length, proposed, skipped, staled, truncated, llmErrors },
    });

    return record({ ok: true, scanned: found.length, proposed, skipped, staled, truncated, llmErrors });
  } catch (e: any) {
    console.error("[BOOK.E] scan failed:", e?.message ?? e);
    return record({ ok: false, error: e?.message ?? "scan failed" });
  } finally {
    scanInFlight = false;
  }
}

// ── Apply (the ONLY QBO write path; runs on human Approve) ───────────────

export async function applyProposal(
  proposalId: number,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const r: any = await db.execute(sql`
    SELECT * FROM qb_categorization_proposals WHERE id = ${proposalId}
  `);
  const p = r.rows?.[0];
  if (!p) return { ok: false, error: "Proposal not found" };
  if (p.status !== "pending" && p.status !== "failed") {
    return { ok: false, error: `Proposal is ${p.status}, not pending` };
  }

  const client = new QuickBooksClient(storage, userId);
  if (!(await client.initialize())) return { ok: false, error: "QuickBooks not connected" };

  // Staleness guard lives inside updateTxnLineAccount: it re-fetches the txn
  // and refuses if the line no longer points at the account we scanned.
  const res = await client.updateTxnLineAccount(
    p.txn_type as "Purchase" | "Bill",
    p.qb_txn_id,
    p.qb_line_id,
    p.current_account_id,
    p.proposed_account_id,
    p.proposed_account_name,
  );

  if (res.ok) {
    await db.execute(sql`
      UPDATE qb_categorization_proposals
      SET status = 'applied', decided_by = ${userId}, decided_at = now(), apply_error = NULL
      WHERE id = ${proposalId}
    `);
    await AuditLogger.logEvent({
      source: "QUICKBOOKS",
      eventType: "BOOKKEEPING_APPLY",
      status: "INFO",
      description: `BOOK.E: ${p.txn_type} ${p.qb_txn_id} line ${p.qb_line_id} recategorized "${p.current_account_name}" → "${p.proposed_account_name}" ($${p.amount})`,
      details: { proposalId, userId, vendor: p.vendor_name, confidence: p.confidence },
    });
    return { ok: true };
  }

  await db.execute(sql`
    UPDATE qb_categorization_proposals
    SET status = 'failed', decided_by = ${userId}, decided_at = now(), apply_error = ${res.error ?? "unknown"}
    WHERE id = ${proposalId}
  `);
  return { ok: false, error: res.error };
}

export async function rejectProposal(proposalId: number, userId: string): Promise<boolean> {
  const r: any = await db.execute(sql`
    UPDATE qb_categorization_proposals
    SET status = 'rejected', decided_by = ${userId}, decided_at = now()
    WHERE id = ${proposalId} AND status IN ('pending', 'failed')
  `);
  return ((r.rowCount as number) ?? 0) > 0;
}

export async function listProposals(status?: string): Promise<ProposalRow[]> {
  const r: any = status
    ? await db.execute(sql`
        SELECT * FROM qb_categorization_proposals WHERE status = ${status}
        ORDER BY confidence DESC, txn_date DESC LIMIT 500`)
    : await db.execute(sql`
        SELECT * FROM qb_categorization_proposals
        ORDER BY (status = 'pending') DESC, confidence DESC, txn_date DESC LIMIT 500`);
  return r.rows ?? [];
}

export async function proposalSummary(): Promise<{
  pending: number; pendingHigh: number; applied: number; rejected: number;
  appliedAmount: number; pendingAmount: number;
}> {
  const r: any = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'pending')::int AS pending,
      count(*) FILTER (WHERE status = 'pending' AND confidence >= ${HIGH_CONFIDENCE})::int AS pending_high,
      count(*) FILTER (WHERE status = 'applied')::int AS applied,
      count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      coalesce(sum(abs(amount)) FILTER (WHERE status = 'applied'), 0)::float AS applied_amount,
      coalesce(sum(abs(amount)) FILTER (WHERE status = 'pending'), 0)::float AS pending_amount
    FROM qb_categorization_proposals
  `);
  const row = r.rows?.[0] ?? {};
  return {
    pending: row.pending ?? 0,
    pendingHigh: row.pending_high ?? 0,
    applied: row.applied ?? 0,
    rejected: row.rejected ?? 0,
    appliedAmount: row.applied_amount ?? 0,
    pendingAmount: row.pending_amount ?? 0,
  };
}

// ── Related-party / owner-transaction review ────────────────────────────────
// BOOK.E's Uncategorized sweep is empty for SBR (the books code everything to a
// real account). The genuinely review-worthy pile is the RELATED-PARTY set —
// owner draws, the Stubbs family, HELOC/member loans, and personal expenses run
// through the company — the reasonable-comp / personal-expense exposure the AFCU
// review + tax memo flagged. This scan SURFACES those for human review. It is
// READ-ONLY: no proposals, no QuickBooks writes, nothing auto-changed. (Flagging
// "expense line in a non-expense account" was rejected — on SBR's books that's
// 391 mostly-CORRECT debt payments & owner draws, i.e. noise.)
const RP_PAYEE = /\bstubbs\b|owner'?s?\s*draw|member\s*draw|\bheloc\b|related[-\s]?party|due (to|from) member|shareholder/i;
const RP_ACCOUNT = /owner'?s?\s*draw|member\s*draw|\bheloc\b|shareholder|due (to|from) member|related[-\s]?party/i;

export interface RelatedPartyItem {
  txnType: "Purchase" | "Bill";
  qbTxnId: string;
  qbLineId: string;
  date: string | null;
  payee: string;
  description: string | null;
  amount: number;
  account: string;
  accountClass: string;
  reason: string;
}
export interface RelatedPartyReview {
  ok: boolean;
  error?: string;
  count: number;
  totalAmount: number;
  windowDays: number;
  byReason: Record<string, { count: number; amount: number }>;
  items: RelatedPartyItem[];
  generatedAt: string;
}

/** Pure: why (if at all) a line is related-party review-worthy. */
export function relatedPartyReason(payee: string, accountName: string, accountClass: string): string | null {
  const acctRp = RP_ACCOUNT.test(accountName || "");
  const payeeRp = RP_PAYEE.test(payee || "");
  if (!acctRp && !payeeRp) return null;
  if (/owner'?s?\s*draw|member\s*draw/i.test(accountName || "")) return "Owner draw";
  if (/heloc/i.test(accountName || "")) return "HELOC / member loan";
  // A family member paid through a labor/contractor account is a worker-classification
  // review (W-2 vs 1099), NOT a personal expense — call it what it is.
  if (payeeRp && accountClass === "Expense" && /contract labor|\bwages?\b|payroll|\blabor\b|salary|commission/i.test(accountName || "")) return "Family member paid as contractor";
  if (payeeRp && accountClass === "Expense") return "Personal expense on company books";
  if (payeeRp) return "Related-party payment";
  return "Related-party account";
}

export async function scanRelatedPartyReview(
  userId: string,
  opts?: { days?: number },
): Promise<RelatedPartyReview> {
  const days = Math.min(Math.max(opts?.days ?? 90, 7), 400);
  const base = (): RelatedPartyReview => ({
    ok: true, count: 0, totalAmount: 0, windowDays: days, byReason: {}, items: [],
    generatedAt: new Date().toISOString(),
  });
  const client = new QuickBooksClient(storage, userId);
  if (!(await client.initialize())) return { ...base(), ok: false, error: "QuickBooks not connected" };

  const coa = await client.fetchChartOfAccounts();
  const acctById = new Map(coa.map((a) => [String(a.id), a]));
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const purchases = await client.fetchPurchasesInRange(fmt(start), fmt(end));
  const bills = await client.fetchBillsInRange(fmt(start), fmt(end));

  const items: RelatedPartyItem[] = [];
  const consider = (txnType: "Purchase" | "Bill", t: any, payee: string) => {
    for (const ln of t.Line ?? []) {
      const det = ln.AccountBasedExpenseLineDetail;
      if (!det?.AccountRef || ln.Id == null) continue;
      const acct: any = acctById.get(String(det.AccountRef.value));
      const acctName = acct?.name ?? det.AccountRef.name ?? "";
      const acctClass = acct?.classification ?? "?";
      const reason = relatedPartyReason(payee, acctName, acctClass);
      if (!reason) continue;
      items.push({
        txnType, qbTxnId: String(t.Id), qbLineId: String(ln.Id), date: t.TxnDate ?? null,
        payee: payee || "(unknown)", description: ln.Description ?? null,
        amount: Number(ln.Amount) || 0, account: acctName, accountClass: acctClass, reason,
      });
    }
  };
  for (const p of purchases) consider("Purchase", p, p.EntityRef?.name ?? "");
  for (const b of bills) consider("Bill", b, b.VendorRef?.name ?? "");

  items.sort((a, b) => b.amount - a.amount);
  const byReason: Record<string, { count: number; amount: number }> = {};
  let totalAmount = 0;
  for (const it of items) {
    totalAmount += it.amount;
    const r = (byReason[it.reason] ??= { count: 0, amount: 0 });
    r.count++;
    r.amount = Math.round((r.amount + it.amount) * 100) / 100;
  }
  return { ...base(), count: items.length, totalAmount: Math.round(totalAmount * 100) / 100, byReason, items };
}
