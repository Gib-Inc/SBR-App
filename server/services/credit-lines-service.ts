/**
 * CIPH.R Credit Lines — every card / LOC / loan in one place. Balances are synced
 * live from QuickBooks liability accounts; limit / APR / due day are registered
 * once by the operator (QB doesn't hold them). From those we derive available
 * credit, utilization, and the next due date.
 */
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { QuickBooksClient } from "./quickbooks-client";

const rows = (r: any) => r.rows || r;
const n = (v: any) => (v == null ? null : Number(v));
const r2 = (x: number) => Math.round(x * 100) / 100;

export type PaymentFrequency = "daily" | "weekly" | "biweekly" | "monthly";

/** Pure: normalize a facility payment to a MONTHLY debt-service figure.
 *  daily = business-day ACH (MCAs debit Mon-Fri) → ×21; weekly → ×4.33; biweekly → ×2.17. */
export function monthlyEquivalent(amount: number | null, frequency: string | null): number | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  switch (String(frequency || "monthly").toLowerCase()) {
    case "daily": return r2(amount * 21);
    case "weekly": return r2(amount * 4.33);
    case "biweekly": return r2(amount * 2.17);
    default: return r2(amount); // monthly
  }
}

/** Pure: the DAILY ACH out — what actually leaves the bank on a business day.
 *  Only daily-cadence facilities debit every day; that sum is the number to
 *  reconcile against the bank statement. */
export function dailyDebitTotal(lines: Array<{ paymentAmount: number | null; paymentFrequency: string | null }>): number {
  return r2(lines.reduce((s, l) =>
    s + (String(l.paymentFrequency || "").toLowerCase() === "daily" && l.paymentAmount != null && l.paymentAmount > 0
      ? l.paymentAmount : 0), 0));
}

// Operational liabilities that are NOT credit lines (A/P, taxes, payroll, etc.).
const OPERATIONAL = /accounts?\s*payable|\ba\/p\b|sales\s*tax|payroll|deferred\s*revenue|remittance|employee\s*advance|direct\s*deposit|accrued|child\s*support|income\s*tax|unemployment|\b94[0-4]\b|corporate\s*tax|^other current liabilities$/i;
export function isOperationalLiability(name: string): boolean {
  return OPERATIONAL.test(name || "");
}

/** Map a QuickBooks account to our credit-line type (card | loc | loan | liability). */
function lineType(qbType: string, name: string): string {
  if (/credit\s*card/i.test(qbType) || /visa|amex|american express|discover|home\s*depot|capital one|capital on tap|mastercard|shopify credit/i.test(name)) return "card";
  if (/line\s*of\s*credit|heloc|\bloc\b/i.test(name)) return "loc";
  if (/long\s*term|loan|note/i.test(qbType) || /loan|sba|mortgage|notes?\s*payable|funding|\bcapital\b|paypal|loanbuilder|uncapped/i.test(name)) return "loan";
  return "liability";
}

/** Pull liability balances from QuickBooks and upsert into credit_lines (preserving manual fields). */
export async function syncCreditLineBalances(): Promise<{ synced: number; skipped?: string }> {
  const qbUserId = await storage.getConnectedQuickbooksUserId();
  if (!qbUserId) return { synced: 0, skipped: "QuickBooks not connected" };
  const client = new QuickBooksClient(storage, qbUserId);
  const accounts = await client.fetchCreditLineAccounts();
  if (!accounts.length) return { synced: 0, skipped: "no liability accounts returned" };

  let synced = 0;
  const seenQbIds: string[] = [];
  for (const a of accounts) {
    // "Seen by QB" ≠ "is a credit line": operational liabilities (A/P, taxes, payroll)
    // are skipped from the upsert but MUST count as seen — legacy rows for them exist
    // (pre-filter syncs created them) and would otherwise be falsely ghost-stamped.
    seenQbIds.push(String(a.id));
    if (isOperationalLiability(a.name)) continue; // taxes, payroll, A/P — not credit lines
    const t = lineType(a.type, a.name);
    const owed = Math.abs(a.balance); // QB returns liabilities credit-negative; show amount owed
    const aprFromName = parseAprFromName(a.name); // QB names embed the rate, e.g. "... 36% V"
    await db.execute(sql`
      INSERT INTO credit_lines (name, type, qb_account_id, qb_account_name, balance, apr, balance_synced_at)
      VALUES (${a.name}, ${t}, ${a.id}, ${a.name}, ${owed}, ${aprFromName}, now())
      ON CONFLICT (qb_account_id) WHERE qb_account_id IS NOT NULL
      DO UPDATE SET balance = EXCLUDED.balance, qb_account_name = EXCLUDED.qb_account_name,
                    apr = COALESCE(credit_lines.apr, EXCLUDED.apr),
                    balance_synced_at = now(), qb_missing_since = NULL, updated_at = now()
    `).catch((e: any) => console.error(`[CreditLines] upsert ${a.name} failed:`, e?.message ?? e));
    synced++;
  }
  // GHOST-FACILITY RECONCILIATION: a QB-linked facility that stopped coming back from
  // QuickBooks keeps its last balance here forever (the ~$8,481-stale + WYIT-$15,484
  // mechanism) — numbers quoted in settlement talks with no living source. Stamp when
  // it first went missing (once), clear on reappearance (above). Guarded on a non-empty
  // fetch so one failed QB pull can't mass-flag the book.
  if (seenQbIds.length) {
    await db.execute(sql`
      UPDATE credit_lines SET qb_missing_since = now(), updated_at = now()
      WHERE qb_account_id IS NOT NULL AND COALESCE(is_active, true) = true
        AND qb_missing_since IS NULL AND qb_account_id <> ALL(${seenQbIds})`);
  }
  return { synced };
}

/** QuickBooks account names embed the rate (e.g. "SBS HELOC Loan RP ITD 36% V", "Newity SBA
 *  ... 9.5% F"). Parse it so facilities aren't rate-blind. Used only to FILL a null apr in the
 *  sync (COALESCE) — never to override an operator-entered value. Returns null when no % token. */
export function parseAprFromName(name: string): number | null {
  const m = String(name || "").match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 && v < 100 ? v : null;
}

/** Next occurrence of a day-of-month from today (today counts), as YYYY-MM-DD in MT. */
function nextDue(dueDay: number | null): string | null {
  if (!dueDay || dueDay < 1 || dueDay > 31) return null;
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Denver" }));
  let y = now.getFullYear(), m = now.getMonth();
  if (now.getDate() > dueDay) { m += 1; if (m > 11) { m = 0; y += 1; } }
  const d = new Date(y, m, Math.min(dueDay, new Date(y, m + 1, 0).getDate()));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface CreditLine {
  id: string; name: string; type: string; qbAccountName: string | null;
  balance: number; creditLimit: number | null; apr: number | null;
  available: number | null; utilization: number | null;
  dueDay: number | null; nextDue: string | null; highUtilization: boolean;
  balanceSyncedAt: string | null;
  // D3 payment terms (operator-entered from the loan schedule; QB doesn't hold them)
  paymentAmount: number | null;
  paymentFrequency: string | null; // daily | weekly | biweekly | monthly
  nextDebitDate: string | null;
  monthlyDebtService: number | null; // cadence-normalized (daily ×21, weekly ×4.33)
  // trust indicators
  qbMissingSince: string | null;    // ghost facility: vanished from QB, balance unverifiable
  staleness: "fresh" | "amber" | "red" | "manual"; // balance age: >48h amber, >7d red
}

export async function computeCreditLines(): Promise<{
  lines: CreditLine[];
  totals: {
    totalBalance: number; totalLimit: number | null; totalAvailable: number | null;
    blendedUtilization: number | null; count: number;
    // Terms completeness: APR / due day are operator-entered (QB doesn't hold them).
    // Until they're filled, DSCR / runway / payoff order run on structural proxies —
    // surfaced here so the gap is visible and actionable, not silent.
    missingApr: number; missingDueDay: number; missingTermsBalance: number; termsComplete: boolean;
    // D3 debt service (ghosts INCLUDED — a debt keeps debiting even if its QB account vanished)
    dailyAchOut: number; monthlyDebtService: number;
    missingPaymentCount: number; missingPaymentBalance: number;
    ghostCount: number; ghostBalance: number;
  };
}> {
  const rs = rows(await db.execute(sql`
    SELECT id, name, type, qb_account_name, balance, credit_limit, apr, due_day, balance_synced_at,
           payment_amount, payment_frequency, next_debit_date, qb_missing_since
    FROM credit_lines
    WHERE COALESCE(is_active, true) = true
    ORDER BY balance DESC NULLS LAST`));

  const nowMs = Date.now();
  const lines: CreditLine[] = rs.map((r: any) => {
    const balance = Number(r.balance) || 0;
    const limit = n(r.credit_limit);
    const available = limit != null ? Math.max(0, Math.round((limit - balance) * 100) / 100) : null;
    const utilization = limit && limit > 0 ? Math.round((balance / limit) * 1000) / 10 : null;
    const dueDay = n(r.due_day);
    const paymentAmount = n(r.payment_amount);
    const paymentFrequency = r.payment_frequency ?? null;
    const syncedMs = r.balance_synced_at ? new Date(r.balance_synced_at).getTime() : null;
    const ageH = syncedMs != null ? (nowMs - syncedMs) / 3600000 : null;
    const staleness: CreditLine["staleness"] =
      ageH == null ? "manual" : ageH > 168 ? "red" : ageH > 48 ? "amber" : "fresh";
    return {
      id: r.id, name: r.name, type: r.type, qbAccountName: r.qb_account_name,
      balance: Math.round(balance * 100) / 100, creditLimit: limit, apr: n(r.apr),
      available, utilization, dueDay, nextDue: nextDue(dueDay),
      highUtilization: utilization != null && utilization > 30,
      balanceSyncedAt: syncedMs != null ? new Date(syncedMs).toISOString() : null,
      paymentAmount, paymentFrequency,
      nextDebitDate: r.next_debit_date ? String(r.next_debit_date).slice(0, 10) : null,
      monthlyDebtService: monthlyEquivalent(paymentAmount, paymentFrequency),
      qbMissingSince: r.qb_missing_since ? new Date(r.qb_missing_since).toISOString() : null,
      staleness,
    };
  });

  const totalBalance = Math.round(lines.reduce((s, l) => s + l.balance, 0) * 100) / 100;
  const withLimit = lines.filter((l) => l.creditLimit != null);
  const totalLimit = withLimit.length ? Math.round(withLimit.reduce((s, l) => s + (l.creditLimit || 0), 0) * 100) / 100 : null;
  // Sum the already-floored per-line available (each = max(0, limit-balance)) instead of
  // pooled (totalLimit - totalBalance): you can't draw one line's room to cover another's
  // over-limit balance, and this guarantees the headline equals the sum of the lines the
  // operator sees. (Audit #19.)
  const totalAvailable = withLimit.length
    ? Math.round(withLimit.reduce((s, l) => s + (l.available || 0), 0) * 100) / 100
    : null;
  const blendedUtilization = totalLimit && totalLimit > 0 ? Math.round((withLimit.reduce((s, l) => s + l.balance, 0) / totalLimit) * 1000) / 10 : null;

  // Loans/MCAs (not cards) are where APR + due day drive DSCR / runway / payoff order;
  // count any active line still missing them, and the balance riding on a proxy.
  const missingApr = lines.filter((l) => l.apr == null).length;
  const missingDueDay = lines.filter((l) => l.dueDay == null).length;
  const missingTermsBalance = Math.round(
    lines.filter((l) => l.apr == null || l.dueDay == null).reduce((s, l) => s + l.balance, 0) * 100,
  ) / 100;
  const termsComplete = missingApr === 0 && missingDueDay === 0;

  // D3 debt-service rollup: the daily ACH out (the #1 runway input — reconcile this
  // against the bank statement) + total monthly debt service, and how much balance
  // still has NO payment terms entered (those facilities read $0 everywhere).
  const dailyAchOut = dailyDebitTotal(lines);
  const monthlyDebtService = r2(lines.reduce((s, l) => s + (l.monthlyDebtService ?? 0), 0));
  const missingPayment = lines.filter((l) => (l.paymentAmount == null || l.paymentAmount <= 0) && l.balance > 0);
  const ghosts = lines.filter((l) => l.qbMissingSince != null);

  return {
    lines,
    totals: {
      totalBalance, totalLimit, totalAvailable, blendedUtilization, count: lines.length,
      missingApr, missingDueDay, missingTermsBalance, termsComplete,
      dailyAchOut, monthlyDebtService,
      missingPaymentCount: missingPayment.length,
      missingPaymentBalance: r2(missingPayment.reduce((s, l) => s + l.balance, 0)),
      ghostCount: ghosts.length,
      ghostBalance: r2(ghosts.reduce((s, l) => s + l.balance, 0)),
    },
  };
}

const VALID_FREQUENCIES = ["daily", "weekly", "biweekly", "monthly"];

/** Register/update the manual fields on a line (limit, APR, due day, name, type, active). */
export async function updateCreditLine(id: string, patch: Record<string, any>): Promise<void> {
  // A garbage frequency would silently normalize to MONTHLY in monthlyEquivalent —
  // for a daily MCA that's a 21× understatement of debt service. Reject it loudly.
  if (patch.paymentFrequency != null && !VALID_FREQUENCIES.includes(String(patch.paymentFrequency).toLowerCase())) {
    throw new Error(`paymentFrequency must be one of ${VALID_FREQUENCIES.join(", ")}`);
  }
  if (patch.paymentFrequency != null) patch.paymentFrequency = String(patch.paymentFrequency).toLowerCase();
  const sets: any[] = [];
  const allow: Record<string, string> = {
    creditLimit: "credit_limit", apr: "apr", dueDay: "due_day", statementDay: "statement_day",
    name: "name", type: "type", notes: "notes", isActive: "is_active",
    paymentAmount: "payment_amount", paymentFrequency: "payment_frequency", nextDebitDate: "next_debit_date",
  };
  for (const [k, col] of Object.entries(allow)) {
    if (patch[k] !== undefined) sets.push(sql`${sql.raw(col)} = ${patch[k]}`);
  }
  if (!sets.length) return;
  await db.execute(sql`UPDATE credit_lines SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${id}`);
}

/** Create a manual (non-QB) credit line. */
export async function createCreditLine(input: { name: string; type?: string; creditLimit?: number; apr?: number; dueDay?: number }): Promise<void> {
  await db.execute(sql`
    INSERT INTO credit_lines (name, type, credit_limit, apr, due_day)
    VALUES (${input.name}, ${input.type || "card"}, ${input.creditLimit ?? null}, ${input.apr ?? null}, ${input.dueDay ?? null})`);
}
