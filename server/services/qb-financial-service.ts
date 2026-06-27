/**
 * CIPH.R Phase 1 — Financial data foundation.
 *
 * Turns the raw QuickBooks financial position (from QuickBooksClient.fetchFinancialRaw)
 * into a stored point-in-time snapshot: Cash on Hand, AR + aging, AP + aging, and a
 * P&L summary (OpEx / gross profit / net income). This is the data spine the runway/
 * burn engine (Phase 2) and the data-governor cross-reference (Phase 3) build on.
 *
 * ANTI-HALLUCINATION (CIPH.R spec §1): we NEVER invent a figure. A field that can't
 * be read is stored NULL and named in `dataGaps` as "DATA GAPPED: <field>".
 * `confidence` is the share of core fields actually populated, so downstream views
 * can refuse to compute on thin data.
 *
 * The pure helpers (bucketAging / parseProfitAndLoss / computeConfidence) are
 * exported and unit-tested in qb-financial-service.test.ts — no network needed.
 */
import { storage } from "../storage";
import { QuickBooksClient } from "./quickbooks-client";
import type { InsertQbFinancialSnapshot, QbFinancialSnapshot } from "@shared/schema";

export interface AgingBuckets {
  current: number; // not yet due
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}

export interface AgingInput {
  balance: number;
  dueDate?: string | null;
}

/** Core financial fields used for the confidence score (share populated). */
export const CORE_FINANCIAL_FIELDS = [
  "cashOnHand",
  "accountsReceivable",
  "accountsPayable",
  "operatingExpenses",
  "grossProfit",
  "netIncome",
  "totalIncome",
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Bucket open balances by how far past due they are relative to `asOf`.
 * No due date => treated as "current" (not yet due).
 */
export function bucketAging(items: AgingInput[], asOf: Date = new Date()): AgingBuckets {
  const b: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const DAY = 24 * 60 * 60 * 1000;
  for (const it of items) {
    const bal = Number(it.balance) || 0;
    if (!bal) continue;
    if (!it.dueDate) {
      b.current += bal;
      continue;
    }
    const due = new Date(`${it.dueDate}T00:00:00`);
    if (Number.isNaN(due.getTime())) {
      b.current += bal;
      continue;
    }
    const overdueDays = Math.floor((asOf.getTime() - due.getTime()) / DAY);
    if (overdueDays <= 0) b.current += bal;
    else if (overdueDays <= 30) b.d1_30 += bal;
    else if (overdueDays <= 60) b.d31_60 += bal;
    else if (overdueDays <= 90) b.d61_90 += bal;
    else b.d90_plus += bal;
  }
  (Object.keys(b) as (keyof AgingBuckets)[]).forEach((k) => {
    b[k] = round2(b[k]);
  });
  return b;
}

export interface PLSummary {
  totalIncome: number | null;
  grossProfit: number | null;
  operatingExpenses: number | null;
  netIncome: number | null;
}

/**
 * Extract the key totals from a QuickBooks ProfitAndLoss report. QB returns a
 * nested Rows tree where summary rows carry a `group` (Income / GrossProfit /
 * Expenses / NetIncome / ...) and a Summary.ColData whose last cell is the total.
 * We walk the tree, collect totals by group, and return only what we actually
 * found (missing groups stay null — never guessed).
 */
export function parseProfitAndLoss(report: any): PLSummary {
  const byGroup: Record<string, number> = {};
  const visit = (rows: any[]) => {
    for (const row of rows || []) {
      const group = row?.group;
      const colData = row?.Summary?.ColData;
      if (group && Array.isArray(colData) && colData.length) {
        const raw = colData[colData.length - 1]?.value;
        const n = raw == null || raw === "" ? NaN : Number(String(raw).replace(/[$,]/g, ""));
        if (!Number.isNaN(n)) byGroup[group] = n;
      }
      if (row?.Rows?.Row) visit(row.Rows.Row);
    }
  };
  visit(report?.Rows?.Row || []);
  const pick = (...keys: string[]): number | null => {
    for (const k of keys) if (k in byGroup) return byGroup[k];
    return null;
  };
  return {
    totalIncome: pick("Income", "TotalIncome"),
    grossProfit: pick("GrossProfit"),
    operatingExpenses: pick("Expenses", "TotalExpenses", "OperatingExpenses"),
    netIncome: pick("NetIncome", "NetOperatingIncome"),
  };
}

/** Share (0-100) of the core financial fields that are populated (not null). */
export function computeConfidence(snap: Record<string, unknown>): number {
  const populated = CORE_FINANCIAL_FIELDS.filter((f) => snap[f] != null).length;
  return Math.round((populated / CORE_FINANCIAL_FIELDS.length) * 100);
}

export interface QbBalanceSheet {
  totalAssets: number | null;
  totalCurrentAssets: number | null;
  totalLiabilities: number | null;
  totalCurrentLiabilities: number | null;
  totalEquity: number | null;
  inventory: number | null; // the booked Inventory asset, for app-WAC reconciliation
}

/**
 * Extract the position totals from a QuickBooks BalanceSheet report. Same nested
 * Rows tree as the P&L; summary rows carry a `group` and/or a label in the first
 * ColData cell. We collect totals by both, then derive Total Liabilities from
 * Liabilities-and-Equity minus Equity when QB doesn't emit it directly. Missing
 * values stay null — never guessed.
 */
export function parseBalanceSheet(report: any): QbBalanceSheet {
  const byKey: Record<string, number> = {};
  const norm = (s: any) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const toNum = (raw: any): number => (raw == null || raw === "" ? NaN : Number(String(raw).replace(/[$,]/g, "")));
  const visit = (rows: any[]) => {
    for (const row of rows || []) {
      const cd = row?.Summary?.ColData;
      if (Array.isArray(cd) && cd.length) {
        const n = toNum(cd[cd.length - 1]?.value);
        if (!Number.isNaN(n)) {
          const label = norm(cd[0]?.value);
          if (label) byKey[label] = n;
          if (row?.group) byKey[norm(row.group)] = n;
        }
      }
      // Leaf account rows (e.g. "Inventory Asset") carry ColData directly, not
      // Summary.ColData. Capture them too, but never overwrite a summary total.
      const lcd = row?.ColData;
      if (Array.isArray(lcd) && lcd.length >= 2) {
        const ln = toNum(lcd[lcd.length - 1]?.value);
        if (!Number.isNaN(ln)) {
          const label = norm(lcd[0]?.value);
          if (label && !(label in byKey)) byKey[label] = ln;
        }
      }
      if (row?.Rows?.Row) visit(row.Rows.Row);
    }
  };
  visit(report?.Rows?.Row || []);
  const pick = (...keys: string[]): number | null => {
    for (const k of keys) { const nk = norm(k); if (nk in byKey) return byKey[nk]; }
    return null;
  };
  let totalLiabilities = pick("TotalLiabilities", "Total Liabilities");
  const liabAndEquity = pick("TotalLiabilitiesAndEquity", "Total Liabilities and Equity");
  const totalEquity = pick("TotalEquity", "Total Equity", "TotalStockholdersEquity");
  if (totalLiabilities == null && liabAndEquity != null && totalEquity != null) {
    totalLiabilities = Math.round((liabAndEquity - totalEquity) * 100) / 100;
  }
  return {
    totalAssets: pick("TotalAssets", "Total Assets"),
    totalCurrentAssets: pick("TotalCurrentAssets", "Total Current Assets"),
    totalLiabilities,
    totalCurrentLiabilities: pick("TotalCurrentLiabilities", "Total Current Liabilities"),
    totalEquity,
    inventory: pick("Inventory", "InventoryAsset", "Inventory Asset", "TotalInventory", "Inventories"),
  };
}

export interface BillDue {
  id: string | null; // QuickBooks Bill Id — stable key for the obligation sync
  vendor: string;
  amount: number;
  dueDate: string | null;
  daysOverdue: number;
  docNumber: string | null;
}

/** Turn open QuickBooks bills into a ranked "what to pay" list — overdue first,
 *  then largest. Defaults to the top 25 for display; pass a larger limit (e.g. for
 *  the Cash Command obligation sync) to get every open bill. Pure (no IO). */
export function buildBillsDue(openBills: any[] | null, asOf: Date = new Date(), limit = 25): BillDue[] {
  if (!openBills) return [];
  const day = 86400000;
  return openBills
    .map((b) => {
      const amount = Math.round((Number(b?.Balance) || 0) * 100) / 100;
      const dueDate = b?.DueDate || null;
      let daysOverdue = 0;
      if (dueDate) {
        const due = Date.parse(String(dueDate) + "T00:00:00Z");
        if (!Number.isNaN(due)) daysOverdue = Math.max(0, Math.floor((asOf.getTime() - due) / day));
      }
      return {
        id: b?.Id ? String(b.Id) : null,
        vendor: String(b?.VendorRef?.name || b?.VendorRef?.value || "Unknown vendor"),
        amount,
        dueDate,
        daysOverdue,
        docNumber: b?.DocNumber ? String(b.DocNumber) : null,
      };
    })
    .filter((b) => b.amount > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.amount - a.amount)
    .slice(0, limit);
}

// ── CIPH.R — A/R collections worklist ───────────────────────────────────────
// SBR's "receivables" are mostly payment-processor SETTLEMENT FLOAT: Amazon,
// Shopify, PayPal, Stripe hold funds in transit then auto-disburse, so they show
// as a receivable but require no collection. A naive collections list would
// wrongly tell the operator "go collect $102K from Amazon." This separates that
// in-transit settlement from REAL collectible customer balances (B2B / wholesale)
// and flags clearing-account artifacts — a stale invoice netted to ~$0 by
// unapplied credit memos — for the accountant to reconcile. Pure (no IO); the live
// pull (open invoices + unapplied credit memos) lives in QuickBooksClient.fetchArOpenItems.
//
// Classification uses a processor TOKEN (word-boundary) plus a settlement-style
// QUALIFIER ("- customer", "website", ...) rather than a raw substring, so a real
// B2B customer named "Amazon Lawns LLC" is NOT misfiled as processor float. When in
// doubt it defaults to "customer" (visible + collectible) — never hide a receivable.
const AR_PROCESSOR_TOKENS = [
  "amazon", "shopify", "paypal", "stripe", "shop pay", "shop cash",
  "affirm", "afterpay", "klarna", "walmart", "etsy", "ebay",
];
// Bare processor names QuickBooks uses for the settlement "customer".
const AR_PROCESSOR_EXACT = new Set(["amazon", "shopify", "paypal", "stripe", "shop pay", "shop cash"]);
// Qualifiers that mark a name as a processor's clearing customer, not a real buyer.
const AR_SETTLEMENT_QUALIFIERS = [
  "- customer", "website", "payout", "payouts", "marketplace", "settlement",
  "clearing", "seller account", "fba",
];

function isWordBoundary(c: string): boolean {
  return c === "" || !/[a-z0-9]/.test(c);
}
function nameHasToken(lname: string, token: string): boolean {
  const i = lname.indexOf(token);
  if (i < 0) return false;
  const before = i === 0 ? "" : lname[i - 1];
  const after = i + token.length >= lname.length ? "" : lname[i + token.length];
  return isWordBoundary(before) && isWordBoundary(after);
}
export function classifyArName(name: string): ArKind {
  const l = name.toLowerCase().trim();
  if (AR_PROCESSOR_EXACT.has(l)) return "settlement";
  const hasToken = AR_PROCESSOR_TOKENS.some((t) => nameHasToken(l, t));
  const hasQualifier = AR_SETTLEMENT_QUALIFIERS.some((q) => l.includes(q));
  return hasToken && hasQualifier ? "settlement" : "customer";
}

export type ArKind = "settlement" | "customer";

export interface ArCustomerLine {
  customer: string;
  kind: ArKind; // settlement = processor float (no action); customer = real collections
  net: number; // grossPositive + unappliedCredits (the true open balance)
  grossPositive: number; // sum of positive open-invoice balances (aged below)
  unappliedCredits: number; // sum of credit-memo balances, as a negative (NOT aged)
  invoiceCount: number; // count of source documents
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d91_plus: number; // age buckets hold POSITIVE invoice balances only
  maxDaysOverdue: number;
  oldestDueDate: string | null;
  reconcileFlag: string | null;
}

export interface ArWorklist {
  asOf: string; // the date this was computed (today)
  totalAr: number;
  settlementFloat: number; // net A/R of processor-settlement customers (in transit)
  realCollectible: number; // net A/R of real customers with a positive balance
  creditBalances: number; // net A/R of real customers in a net credit position (negative)
  realOverdue: number; // the overdue, collectible part of realCollectible (capped at net)
  truncated: boolean; // a source query hit the 1000-row cap (totals understated)
  customers: ArCustomerLine[];
  reconcileFlags: ArCustomerLine[];
  headline: string;
  source: string; // "gl"
  authoritative: string; // "quickbooks"
  note: string;
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Group open QuickBooks A/R items (invoices as positives, unapplied credit memos
 *  as negatives) into a per-customer collections worklist that separates processor
 *  settlement float from real collectible balances and flags clearing artifacts.
 *  Decomposition is an exact partition: totalAr === settlementFloat + realCollectible
 *  + creditBalances. Pure. */
export function buildArWorklist(
  openItems: any[] | null,
  asOf: Date = new Date(),
  opts?: { truncated?: boolean },
): ArWorklist {
  const day = 86400000;
  const byCustomer = new Map<string, any[]>();
  for (const it of openItems || []) {
    const name = String(it?.CustomerRef?.name || it?.CustomerRef?.value || "(unnamed)");
    const list = byCustomer.get(name) ?? [];
    list.push(it);
    byCustomer.set(name, list);
  }

  const customers: ArCustomerLine[] = [];
  for (const [customer, items] of Array.from(byCustomer)) {
    let grossPositive = 0;
    let unappliedCredits = 0; // accumulates negatives separately — keeps age buckets clean
    let current = 0;
    let d1_30 = 0;
    let d31_60 = 0;
    let d61_90 = 0;
    let d91_plus = 0;
    let maxDaysOverdue = 0;
    let oldestDueDate: string | null = null;
    for (const it of items) {
      const bal = round2(Number(it?.Balance) || 0);
      if (bal < 0) {
        unappliedCredits += bal; // credit memo / unapplied — not aged into a debit bucket
        continue;
      }
      if (bal === 0) continue;
      grossPositive += bal;
      const dueStr = it?.DueDate || it?.TxnDate || null;
      let daysOverdue = 0;
      if (dueStr) {
        const due = Date.parse(String(dueStr) + "T00:00:00Z");
        if (!Number.isNaN(due)) daysOverdue = Math.max(0, Math.floor((asOf.getTime() - due) / day));
      }
      if (dueStr && (oldestDueDate === null || String(dueStr) < oldestDueDate)) oldestDueDate = String(dueStr);
      if (daysOverdue > maxDaysOverdue) maxDaysOverdue = daysOverdue;
      if (daysOverdue <= 0) current += bal;
      else if (daysOverdue <= 30) d1_30 += bal;
      else if (daysOverdue <= 60) d31_60 += bal;
      else if (daysOverdue <= 90) d61_90 += bal;
      else d91_plus += bal;
    }
    grossPositive = round2(grossPositive);
    unappliedCredits = round2(unappliedCredits);
    const net = round2(grossPositive + unappliedCredits);
    const kind = classifyArName(customer);
    let reconcileFlag: string | null = null;
    if (Math.abs(net) < 1 && grossPositive >= 1) {
      reconcileFlag =
        `Nets to ~$0: $${fmtUsd(grossPositive)} of invoices offset by $${fmtUsd(Math.abs(unappliedCredits))} in credits / unapplied payments — a clearing-account artifact. Reconcile (Roger).`;
    } else if (unappliedCredits <= -1000) {
      reconcileFlag =
        `Carries $${fmtUsd(Math.abs(unappliedCredits))} in credits / unapplied payments against $${fmtUsd(grossPositive)} of invoices. Apply or clear (Roger).`;
    } else if (kind === "settlement" && d91_plus >= 1000) {
      reconcileFlag =
        `Processor account carries $${fmtUsd(d91_plus)} aged 91+ days — unusual for settlement float (which clears in days). Reconcile (Roger).`;
    }
    customers.push({
      customer, kind, net, grossPositive, unappliedCredits,
      invoiceCount: items.length,
      current: round2(current), d1_30: round2(d1_30), d31_60: round2(d31_60),
      d61_90: round2(d61_90), d91_plus: round2(d91_plus),
      maxDaysOverdue, oldestDueDate, reconcileFlag,
    });
  }

  customers.sort((a, b) => b.net - a.net);
  // Exact partition of totalAr: every customer falls in exactly one of the three.
  const totalAr = round2(customers.reduce((s, c) => s + c.net, 0));
  const settlementFloat = round2(
    customers.filter((c) => c.kind === "settlement").reduce((s, c) => s + c.net, 0),
  );
  const realCustomers = customers.filter((c) => c.kind === "customer");
  const realCollectible = round2(realCustomers.filter((c) => c.net >= 0).reduce((s, c) => s + c.net, 0));
  const creditBalances = round2(realCustomers.filter((c) => c.net < 0).reduce((s, c) => s + c.net, 0));
  // Overdue portion of each real collectible customer, capped at their net so a
  // no-due-date credit can never make "overdue" exceed what is actually owed.
  const realOverdue = round2(
    realCustomers
      .filter((c) => c.net > 0)
      .reduce((s, c) => s + Math.max(0, Math.min(round2(c.d1_30 + c.d31_60 + c.d61_90 + c.d91_plus), c.net)), 0),
  );
  const reconcileFlags = customers.filter((c) => c.reconcileFlag != null);
  const truncated = opts?.truncated === true;

  const creditTail = creditBalances < 0 ? `, and $${fmtUsd(Math.abs(creditBalances))} in customer credits/unapplied` : "";
  const flagTail = reconcileFlags.length
    ? ` ${reconcileFlags.length} item${reconcileFlags.length > 1 ? "s" : ""} to reconcile.`
    : "";
  const headline =
    `Of $${fmtUsd(totalAr)} A/R, $${fmtUsd(settlementFloat)} is payment-processor settlement in transit ` +
    `(auto-disburses, no collection action) and $${fmtUsd(realCollectible)} is real collectible customer balance${creditTail}.` +
    flagTail;

  return {
    asOf: asOf.toISOString().slice(0, 10),
    totalAr, settlementFloat, realCollectible, creditBalances, realOverdue, truncated,
    customers, reconcileFlags, headline,
    source: "gl", authoritative: "quickbooks",
    note:
      "Built from open QuickBooks invoices (positive) netted against unapplied credit memos (negative); book of record is QuickBooks. Unapplied customer PAYMENTS (as opposed to credit memos) are not separately fetched, so a customer's net can still differ from QuickBooks' A/R Aging — reconcile there (Roger). 'Settlement' = payment-processor float in transit, not a collections action. The app reports and flags; it never posts entries, applies payments, or moves money." +
      (truncated ? " NOTE: a source query hit the 1000-row cap — totals are understated." : ""),
  };
}

// ── CIPH.R — transaction-level expense breakdown (who is behind each category) ──
// Answers "what are these subscriptions FOR?" by naming the vendor on every
// expense charge, grouped under its P&L account. Pure + unit-tested; the network
// pull lives in QuickBooksClient.fetchExpenseDetailRaw.

export interface ExpenseLine {
  account: string;
  payee: string;
  txnType: string | null;
  docNumber: string | null;
  memo: string | null;
  date: string | null;
  amount: number;
}

export interface ExpenseVendorAgg {
  payee: string;
  total: number;
  count: number;
}

export interface ExpenseAccountAgg {
  account: string;
  total: number;
  txnCount: number;
  vendors: ExpenseVendorAgg[];
}

export interface ExpenseDetailSummary {
  window: { start: string; end: string };
  byAccount: ExpenseAccountAgg[];
  // Small diagnostic so a parser/shape mismatch is debuggable from the stored
  // snapshot alone (no need to re-pull QB): which columns QB returned, how many
  // data rows we saw, how many lines we extracted.
  diagnostic: { colKeys: string[]; rowCount: number; lineCount: number };
}

/** Parse a "$1,234.56" / "(1,234.56)" / "" cell into a number (NaN if blank). */
function parseMoney(raw: any): number {
  if (raw == null || raw === "") return NaN;
  const s = String(raw).replace(/[$,\s]/g, "");
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, ""));
  return Number.isNaN(n) ? NaN : neg ? -n : n;
}

/**
 * Walk a QuickBooks ProfitAndLossDetail report into flat transaction lines.
 * QB returns Rows as a tree: each account is a Section (Header.ColData[0] = the
 * account name) whose nested Rows are the individual "Data" transactions; columns
 * are identified by ColKey metadata (tx_date, txn_type, doc_num, name, memo,
 * account_name, subt_nat_amount) so we read by name, not fragile position.
 */
export function parseExpenseDetail(report: any): { lines: ExpenseLine[]; colKeys: string[]; rowCount: number } {
  const lines: ExpenseLine[] = [];
  if (!report) return { lines, colKeys: [], rowCount: 0 };

  const cols: any[] = report?.Columns?.Column || [];
  const idx: Record<string, number> = {};
  const colKeys: string[] = cols.map((c, i) => {
    const meta = (c?.MetaData || []).find((m: any) => m?.Name === "ColKey");
    const key = meta?.Value ? String(meta.Value) : c?.ColType || c?.ColTitle || `col${i}`;
    idx[key] = i;
    return key;
  });
  const amountIdx = idx["subt_nat_amount"] ?? idx["subt_nat_home_amount"] ?? null;
  const cell = (cd: any[], key: string): any => {
    const i = idx[key];
    return i == null ? undefined : cd?.[i]?.value;
  };

  let rowCount = 0;
  const walk = (rows: any[], currentAccount: string) => {
    for (const row of rows || []) {
      let acct = currentAccount;
      const headerVal = row?.Header?.ColData?.[0]?.value;
      if (headerVal != null && String(headerVal).trim()) acct = String(headerVal).trim();

      if (row?.type === "Data" && Array.isArray(row?.ColData)) {
        rowCount++;
        const cd = row.ColData;
        // amount: prefer the natural-amount column, else last numeric cell in row
        let amount = amountIdx != null ? parseMoney(cd[amountIdx]?.value) : NaN;
        if (Number.isNaN(amount)) {
          for (let i = cd.length - 1; i >= 0; i--) {
            const n = parseMoney(cd[i]?.value);
            if (!Number.isNaN(n)) { amount = n; break; }
          }
        }
        if (!Number.isNaN(amount)) {
          const rowAcct = cell(cd, "account_name");
          const account = rowAcct && String(rowAcct).trim() ? String(rowAcct).trim() : acct;
          const payeeRaw = cell(cd, "name");
          const payee = payeeRaw && String(payeeRaw).trim() ? String(payeeRaw).trim() : "(no payee)";
          const str = (k: string): string | null => {
            const v = cell(cd, k);
            return v != null && String(v).trim() ? String(v).trim() : null;
          };
          lines.push({
            account: account || "(ungrouped)",
            payee,
            txnType: str("txn_type"),
            docNumber: str("doc_num"),
            memo: str("memo"),
            date: str("tx_date"),
            amount,
          });
        }
      }

      if (row?.Rows?.Row) walk(row.Rows.Row, acct);
    }
  };
  walk(report?.Rows?.Row || [], "(ungrouped)");
  return { lines, colKeys, rowCount };
}

/** Aggregate parsed expense lines into account → vendor totals (both sorted desc). */
export function summarizeExpenseDetail(
  parsed: { lines: ExpenseLine[]; colKeys: string[]; rowCount: number },
  window: { start: string; end: string },
): ExpenseDetailSummary {
  const accounts = new Map<string, Map<string, { total: number; count: number }>>();
  for (const ln of parsed.lines) {
    if (!accounts.has(ln.account)) accounts.set(ln.account, new Map());
    const vmap = accounts.get(ln.account)!;
    const v = vmap.get(ln.payee) || { total: 0, count: 0 };
    v.total = round2(v.total + ln.amount);
    v.count += 1;
    vmap.set(ln.payee, v);
  }
  const byAccount: ExpenseAccountAgg[] = Array.from(accounts.entries())
    .map(([account, vmap]) => {
      const vendors = Array.from(vmap.entries())
        .map(([payee, v]) => ({ payee, total: v.total, count: v.count }))
        .sort((a, b) => b.total - a.total);
      const total = round2(vendors.reduce((s, v) => s + v.total, 0));
      const txnCount = vendors.reduce((s, v) => s + v.count, 0);
      return { account, total, txnCount, vendors };
    })
    .sort((a, b) => b.total - a.total);
  return {
    window,
    byAccount,
    diagnostic: { colKeys: parsed.colKeys, rowCount: parsed.rowCount, lineCount: parsed.lines.length },
  };
}

const toNumericString = (n: number | null): string | null => (n == null ? null : round2(n).toFixed(2));

/**
 * Pull the live financial position from QuickBooks and persist a snapshot.
 * Returns ok:false (no throw) when QB isn't connected so callers/schedulers
 * degrade gracefully.
 */
export async function captureFinancialSnapshot(
  userId: string,
): Promise<{ ok: boolean; snapshot?: QbFinancialSnapshot; error?: string }> {
  const client = new QuickBooksClient(storage, userId);
  if (!(await client.initialize())) {
    return { ok: false, error: "QuickBooks not connected" };
  }

  const raw = await client.fetchFinancialRaw();
  const gaps: string[] = [...raw.errors];

  // Cash on Hand
  let cashOnHand: number | null = null;
  if (raw.bankAccounts != null) {
    cashOnHand = round2(raw.bankAccounts.reduce((s, a) => s + (Number(a.CurrentBalance) || 0), 0));
  }

  // Accounts Receivable + aging
  let accountsReceivable: number | null = null;
  let arAging: AgingBuckets | null = null;
  if (raw.openInvoices != null) {
    accountsReceivable = round2(raw.openInvoices.reduce((s, i) => s + (Number(i.Balance) || 0), 0));
    arAging = bucketAging(raw.openInvoices.map((i) => ({ balance: Number(i.Balance) || 0, dueDate: i.DueDate })));
  }

  // Accounts Payable + aging
  let accountsPayable: number | null = null;
  let apAging: AgingBuckets | null = null;
  if (raw.openBills != null) {
    accountsPayable = round2(raw.openBills.reduce((s, b) => s + (Number(b.Balance) || 0), 0));
    apAging = bucketAging(raw.openBills.map((b) => ({ balance: Number(b.Balance) || 0, dueDate: b.DueDate })));
  }

  // P&L
  const pl: PLSummary = raw.plReport != null
    ? parseProfitAndLoss(raw.plReport)
    : { totalIncome: null, grossProfit: null, operatingExpenses: null, netIncome: null };
  if (raw.plReport != null) {
    if (pl.operatingExpenses == null) gaps.push("DATA GAPPED: Operating Expenses (P&L Expenses total)");
    if (pl.netIncome == null) gaps.push("DATA GAPPED: Net Income (P&L)");
  }

  const confidence = computeConfidence({
    cashOnHand,
    accountsReceivable,
    accountsPayable,
    operatingExpenses: pl.operatingExpenses,
    grossProfit: pl.grossProfit,
    netIncome: pl.netIncome,
    totalIncome: pl.totalIncome,
  });

  // Full live balance-sheet totals + a ranked "bills to pay" list. Stored under
  // raw.qbBalanceSheet (NOT raw.balanceSheet, which is reserved for the uploaded
  // accountant BS with named-loan rates) so the two never collide.
  const qbBalanceSheet = raw.bsReport != null ? parseBalanceSheet(raw.bsReport) : null;
  if (raw.bsReport != null && qbBalanceSheet?.totalLiabilities == null && qbBalanceSheet?.totalAssets == null) {
    gaps.push("DATA GAPPED: Balance Sheet totals (unrecognized report layout)");
  }
  if (raw.bsReport != null && qbBalanceSheet?.inventory == null) {
    gaps.push("DATA GAPPED: Balance Sheet Inventory line (app-WAC reconciliation unavailable)");
  }
  const billsDue = buildBillsDue(raw.openBills);

  // Mirror EVERY open QuickBooks bill into the Cash Command pay-order so the
  // accounting team sees real bills (amounts + due dates) ranked alongside tax
  // and debt. ONLY when bills were actually fetched (openBills != null) — a QB
  // AP gap must not wipe the list. Best-effort: never break the snapshot capture.
  if (raw.openBills != null) {
    try {
      const allBills = buildBillsDue(raw.openBills, new Date(), 5000);
      const { db } = await import("../db");
      const { syncQbBillsToObligations } = await import("./cash-flow-service");
      const r = await syncQbBillsToObligations(db, allBills);
      console.log(`[QB Bills] Synced ${r.upserted} open bills to Cash Command, marked ${r.closed} paid/closed`);
    } catch (e: any) {
      gaps.push(`Bill→obligation sync skipped: ${e?.message ?? e}`);
    }
  }

  // Transaction-level expense breakdown (who is behind each category total).
  // Trailing 120 days so a monthly vendor shows ~4 charges — enough to read a
  // per-month rate from total/count. Read-only; a failure degrades to a gap.
  let expenseDetail: ExpenseDetailSummary | null = null;
  {
    const endD = new Date();
    const startD = new Date(endD.getTime() - 120 * 24 * 60 * 60 * 1000);
    const ed = await client.fetchExpenseDetailRaw(startD, endD);
    if (ed.error) gaps.push(ed.error);
    if (ed.report) {
      expenseDetail = summarizeExpenseDetail(parseExpenseDetail(ed.report), {
        start: ed.periodStart,
        end: ed.periodEnd,
      });
    }
  }

  const toInsert: InsertQbFinancialSnapshot = {
    capturedAt: new Date(),
    cashOnHand: toNumericString(cashOnHand),
    accountsReceivable: toNumericString(accountsReceivable),
    accountsPayable: toNumericString(accountsPayable),
    arAging: (arAging as unknown) ?? null,
    apAging: (apAging as unknown) ?? null,
    operatingExpenses: toNumericString(pl.operatingExpenses),
    grossProfit: toNumericString(pl.grossProfit),
    netIncome: toNumericString(pl.netIncome),
    totalIncome: toNumericString(pl.totalIncome),
    qbInventory: toNumericString(qbBalanceSheet?.inventory ?? null),
    plPeriodStart: raw.plPeriodStart,
    plPeriodEnd: raw.plPeriodEnd,
    realmId: raw.realmId,
    dataGaps: (gaps as unknown) ?? null,
    confidence,
    raw: { qbBalanceSheet, billsDue, expenseDetail } as any,
  };

  const saved = await storage.createQbFinancialSnapshot(toInsert);
  return { ok: true, snapshot: saved };
}

let qbFinancialArmed = false;

/** Ms until the next of the given Mountain-time (America/Denver) hour slots. */
function msUntilNextMountainSlot(hours: number[]): number {
  const now = new Date();
  const mtNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Denver" }));
  const offset = mtNow.getTime() - now.getTime(); // MT wall-clock minus real UTC
  let best = Infinity;
  for (const h of hours) {
    const target = new Date(mtNow);
    target.setHours(h, 0, 0, 0);
    if (target <= mtNow) target.setDate(target.getDate() + 1);
    const delta = (target.getTime() - offset) - now.getTime();
    if (delta < best) best = delta;
  }
  return Math.max(60_000, best);
}

/**
 * Arm the live-QuickBooks financial capture. Runs ~30s after boot, then at fixed
 * Mountain-time slots (7am/1pm/7pm) — NOT a boot-relative 24h interval, which
 * drifts and silently skips quiet (no-deploy) days and leaves the canonical
 * cash/AR/AP/P&L snapshot stale. No-ops when QuickBooks isn't connected.
 * Idempotent via the `armed` guard; fire-and-forget so a slow QB call never
 * blocks listen().
 */
export function startQbFinancialScheduler(): void {
  if (qbFinancialArmed) return;
  qbFinancialArmed = true;
  const run = async () => {
    try {
      const r = await captureFinancialSnapshot("system");
      if (r.ok) {
        console.log(`[QB Financials] Daily snapshot captured (cash=${r.snapshot?.cashOnHand ?? "—"}, confidence=${r.snapshot?.confidence ?? "—"}).`);
      } else {
        console.log(`[QB Financials] Daily snapshot skipped: ${r.error}`);
      }
    } catch (err: any) {
      console.error("[QB Financials] Scheduler run failed:", err?.message ?? err);
    }
  };
  setTimeout(() => { void run(); }, 30_000); // initial run after boot settles
  const SLOTS = [7, 13, 19]; // 7am / 1pm / 7pm America/Denver
  const scheduleNext = () => {
    const t = setTimeout(() => { void run().finally(scheduleNext); }, msUntilNextMountainSlot(SLOTS));
    if (typeof (t as any)?.unref === "function") (t as any).unref();
  };
  scheduleNext();
}
