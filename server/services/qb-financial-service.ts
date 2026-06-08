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
  };
}

export interface BillDue {
  vendor: string;
  amount: number;
  dueDate: string | null;
  daysOverdue: number;
  docNumber: string | null;
}

/** Turn open QuickBooks bills into a ranked "what to pay" list — overdue first,
 *  then largest. Top 25. Pure (no IO). */
export function buildBillsDue(openBills: any[] | null, asOf: Date = new Date()): BillDue[] {
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
        vendor: String(b?.VendorRef?.name || b?.VendorRef?.value || "Unknown vendor"),
        amount,
        dueDate,
        daysOverdue,
        docNumber: b?.DocNumber ? String(b.DocNumber) : null,
      };
    })
    .filter((b) => b.amount > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.amount - a.amount)
    .slice(0, 25);
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
  const billsDue = buildBillsDue(raw.openBills);

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
    plPeriodStart: raw.plPeriodStart,
    plPeriodEnd: raw.plPeriodEnd,
    realmId: raw.realmId,
    dataGaps: (gaps as unknown) ?? null,
    confidence,
    raw: { qbBalanceSheet, billsDue } as any,
  };

  const saved = await storage.createQbFinancialSnapshot(toInsert);
  return { ok: true, snapshot: saved };
}

let qbFinancialArmed = false;

/**
 * Arm the daily live-QuickBooks financial capture. Fires ~30s after boot, then
 * every 24h. No-ops gracefully when QuickBooks isn't connected (captureFinancial
 * Snapshot returns ok:false). Idempotent via the `armed` guard. Fire-and-forget
 * from startup so a slow QB call never blocks listen().
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
  const t = setInterval(() => { void run(); }, 24 * 60 * 60 * 1000);
  if (typeof (t as any)?.unref === "function") (t as any).unref();
}
