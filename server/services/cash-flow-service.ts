/**
 * Cash Flow Command — a "what to pay when" decision-support layer.
 *
 * DESIGN BOUNDARY: this service RECOMMENDS and TRACKS. It never moves money.
 * "Approve" records a decision (and an audit row in payment_actions) for a human
 * to execute in the bank / QuickBooks. There is no payment-execution path here.
 *
 * Model aligned to the Weekly Cash Command spec: obligations carry a TIER
 * (mca | tier1 | tier2 | tier3 | tier4 | hold) and the ranked list is tier-first.
 *   - mca   = merchant cash advances / auto-debits (pull whether you like it or not)
 *   - tier1 = tax & payroll (penalties + trust-fund exposure; OpenAccountants-verified cadences)
 *   - tier2 = must-pay (critical vendors, secured/SBA debt)
 *   - tier3 = important, tier4 = flexible, hold = defer
 *
 * Tax cadences come from OpenAccountants accountant-verified skills
 * (us-form-941-940-payroll, us-sales-tax). Working figures — Roger confirms.
 */
import { sql } from "drizzle-orm";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export type Tier = "mca" | "tier1" | "tier2" | "tier3" | "tier4" | "hold";
export type Criticality = "must" | "important" | "flexible";
export type OblCategory = "vendor_bill" | "debt" | "tax" | "payroll" | "recurring";
// 'covered_by_plan' = an open QB bill absorbed into a vendor payment plan: it stays a real,
// queryable open A/P record (NOT paid) but is excluded from the pay-now surfaces (the plan
// installment is the pay-now item). Set only by the sync, never by the operator status route.
export type OblStatus = "pending" | "approved" | "deferred" | "paid" | "covered_by_plan";

const TIER_RANK: Record<Tier, number> = { mca: 0, tier1: 1, tier2: 2, tier3: 3, tier4: 4, hold: 9 };

export interface Obligation {
  id: string;
  label: string;
  payee: string | null;
  category: OblCategory;
  tier: Tier;
  tierRank: number;
  amount: number;
  amountEstimated: boolean;
  dueDate: string | null;
  daysUntilDue: number | null;
  criticality: Criticality;
  payFrom: string | null;
  method: string | null;
  status: OblStatus;
  source: string;
  rationale: string | null;
  sourceRef: string | null;
  anomalyFlag: boolean;
  anomalyReason: string | null;
  runningCashAfter: number | null;
}

export interface ExpectedPayoutsSummary {
  amazonNet: number;
  shopifyNet: number;
  totalNet: number;            // sales-derived "money on its way" (net of fees) — counted in the runway
  amazonGross: number;
  shopifyGross: number;
  amazonSettlementDays: number;
  shopifySettlementDays: number;
}

export interface CashPosition {
  asOf: string;
  cashOnHand: number;
  cashAsOf: string | null;
  dailySalesRunRate: number;
  windowDays: number;
  projectedIncome: number;     // projected sales over the window (run-rate * days)
  receivablesInbound: number;  // QB A/R aging total (accrual — shown for reference, NOT counted)
  expectedPayouts: ExpectedPayoutsSummary; // sales-derived channel payouts on their way (counted)
  inboundWindow: number;       // expected payouts that LAND within windowDays (counted in projectedLow)
  totalDue: number;
  tier1Due: number;       // tax + payroll
  projectedLow: number;
  // FLAG-DON'T-FABRICATE: obligations seeded with an unknown amount (amountEstimated &&
  // amount<=0 — e.g. MCAs/tax/debt before the operator enters the real figure) contribute
  // $0 to totalDue, so projectedLow OMITS them and reads optimistic. These flags say how
  // many real outflows the runway can't see yet, so the UI never presents projectedLow as
  // a clean/complete number while a top-ranked MCA shows $0.
  unfundedCount: number;          // active obligations with an unknown (estimated $0) amount
  unfundedMustPayCount: number;   // of those, the unavoidable ones (mca/tier1/tier2)
  projectedLowComplete: boolean;  // false when unfundedCount > 0 — projectedLow is a ceiling, not exact
  // Where cashOnHand came from. 'bank_confirmed' = an operator entered the live bank-share
  // balance (the truth); 'qbo_ledger' = QuickBooks Account.CurrentBalance, which LAGS the bank
  // (feed delay + book-vs-bank), so it's flagged so no UI presents it as the live number.
  cashSource: "bank_confirmed" | "qbo_ledger";
  cashConfirmedAt: string | null; // ISO ts the bank balance was confirmed (bank_confirmed only)
  cashStale: boolean;             // true when the cash figure may not equal the live bank balance
  cashStaleHours: number | null;  // age of the bank-confirmed entry in hours (bank_confirmed only)
  cashDivergenceFlag: boolean;    // bank entry diverges wildly (>5x or <1/5x) from the QB ledger — likely a fat-finger
  inTransit: BankInTransitItem[]; // confirmed money on its way the operator logged (Amazon/Shopify payouts)
  inTransitTotal: number;         // sum of inTransit (near-term = cashOnHand + inTransitTotal)
}

export interface BankInTransitItem {
  label: string;
  amount: number;
  eta?: string | null;
}

export interface AuthoritativeBankBalance {
  availableBalance: number;
  asOf: string;             // ISO ts the bank showed this balance
  inTransit: BankInTransitItem[];
  source: string;
  enteredBy: string | null;
}

// Shared cash-source policy constants — used by BOTH resolveCashSource (cash-out view) and
// getBankConfirmedOverride (every other consumer) so the whole app shows ONE cash number.
const CASH_FRESH_HOURS = 72;          // bank entry trusted-fresh for 3 days
const CASH_STALE_MAX_HOURS = 14 * 24; // beyond 14 days a manual bank number is too old to override QB
const CASH_QB_STALE_DAYS = 2;         // QB snapshot older than this is itself flagged stale
const CASH_DIVERGENCE_RATIO = 5;      // bank entry >5x or <1/5x the QB ledger ⇒ likely a fat-finger

export interface BankOverride {
  cashOnHand: number;
  confirmedAt: string;
  stale: boolean;
  staleHours: number;
}

/**
 * Pure: given the latest bank entry and the current time, return the bank-confirmed balance to
 * use as cash-on-hand, or null when there is none / it's malformed / future-dated / older than
 * CASH_STALE_MAX_HOURS. This is THE single precedence gate — every cash consumer goes through it
 * (directly or via resolveCashSource) so the app can never show two different cash numbers.
 */
export function bankOverrideFromEntry(a: AuthoritativeBankBalance | null, nowMs: number): BankOverride | null {
  if (!a || !Number.isFinite(a.availableBalance)) return null;
  const ageHours = (nowMs - Date.parse(a.asOf)) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > CASH_STALE_MAX_HOURS) return null;
  return {
    cashOnHand: r2(a.availableBalance),
    confirmedAt: a.asOf,
    stale: ageHours > CASH_FRESH_HOURS,
    staleHours: Math.max(0, Math.round(ageHours)),
  };
}

/** DB wrapper: the fresh bank-confirmed override to use as cash-on-hand, or null. Shared by the
 *  marketing governor, runway, green-line, and exec-summary so they stop reading raw (lagging) QB. */
export async function getBankConfirmedOverride(db: any): Promise<BankOverride | null> {
  const a = await getLatestAuthoritativeBankBalance(db).catch(() => null);
  return bankOverrideFromEntry(a, Date.now());
}

/**
 * Decide which cash figure is authoritative for the cash-out view: an operator-entered
 * bank-confirmed balance, or the QuickBooks ledger fallback. Pure + unit-tested.
 *  - A bank-confirmed entry within CASH_STALE_MAX_HOURS wins (real bank truth), flagged stale
 *    past CASH_FRESH_HOURS so the UI nudges a refresh, but still used — a slightly-old real bank
 *    number beats the always-lagging QB ledger.
 *  - Otherwise fall back to the QB ledger value (BEHAVIOR UNCHANGED from before this feature),
 *    flagged stale when the QB snapshot itself is > CASH_QB_STALE_DAYS old.
 *  - cashDivergenceFlag warns when a bank entry is >CASH_DIVERGENCE_RATIO× off the QB ledger
 *    (a likely fat-finger — extra digit), so the UI can prompt a double-check.
 */
export function resolveCashSource(
  authoritative: AuthoritativeBankBalance | null,
  qbo: { cashOnHand: number; cashAsOf: string | null },
  nowMs: number,
): {
  cashOnHand: number;
  cashSource: "bank_confirmed" | "qbo_ledger";
  cashConfirmedAt: string | null;
  cashStale: boolean;
  cashStaleHours: number | null;
  cashDivergenceFlag: boolean;
  inTransit: BankInTransitItem[];
  inTransitTotal: number;
} {
  const ov = bankOverrideFromEntry(authoritative, nowMs);
  if (ov && authoritative) {
    const inTransit = (authoritative.inTransit ?? []).filter(
      (t) => t && typeof t.label === "string" && Number.isFinite(t.amount),
    );
    const ratio = qbo.cashOnHand > 0 ? ov.cashOnHand / qbo.cashOnHand : 1;
    const divergence = qbo.cashOnHand > 0 && (ratio > CASH_DIVERGENCE_RATIO || ratio < 1 / CASH_DIVERGENCE_RATIO);
    return {
      cashOnHand: ov.cashOnHand,
      cashSource: "bank_confirmed",
      cashConfirmedAt: ov.confirmedAt,
      cashStale: ov.stale,
      cashStaleHours: ov.staleHours,
      cashDivergenceFlag: divergence,
      inTransit,
      inTransitTotal: r2(inTransit.reduce((s, t) => s + (t.amount || 0), 0)),
    };
  }

  // Fallback: QuickBooks ledger — identical value to pre-feature behavior.
  let qbStale = true;
  if (qbo.cashAsOf) {
    const ageDays = (nowMs - Date.parse(qbo.cashAsOf)) / 86_400_000;
    qbStale = !Number.isFinite(ageDays) || ageDays > CASH_QB_STALE_DAYS;
  }
  return {
    cashOnHand: r2(qbo.cashOnHand),
    cashSource: "qbo_ledger",
    cashConfirmedAt: null,
    cashStale: qbStale,
    cashStaleHours: null,
    cashDivergenceFlag: false,
    inTransit: [],
    inTransitTotal: 0,
  };
}

/** Latest operator-entered bank-confirmed balance (newest by as_of), or null if none. */
export async function getLatestAuthoritativeBankBalance(db: any): Promise<AuthoritativeBankBalance | null> {
  const row = rows(await db.execute(sql`
    select available_balance, as_of, in_transit, source, entered_by
    from bank_balance_entries order by as_of desc, created_at desc limit 1`))[0];
  if (!row) return null;
  let inTransit: BankInTransitItem[] = [];
  try {
    const raw = typeof row.in_transit === "string" ? JSON.parse(row.in_transit) : row.in_transit;
    if (Array.isArray(raw)) {
      inTransit = raw
        .filter((t: any) => t && typeof t.label === "string" && Number.isFinite(Number(t.amount)))
        .map((t: any) => ({ label: String(t.label), amount: r2(Number(t.amount)), eta: t.eta ?? null }));
    }
  } catch { /* malformed in_transit → empty list, never throw on a hot read path */ }
  return {
    availableBalance: num(row.available_balance),
    asOf: new Date(row.as_of).toISOString(),
    inTransit,
    source: row.source ?? "manual",
    enteredBy: row.entered_by ?? null,
  };
}

export interface CashFlowResult {
  position: CashPosition;
  obligations: Obligation[];
  generatedAt: string;
}

// ── date helpers (pure) ─────────────────────────────────────────────────────
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((parseYmd(toYmd).getTime() - parseYmd(fromYmd).getTime()) / 86_400_000);
}
function lastDayOfMonth(year: number, monthIdx0: number): number {
  return new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();
}
/** "Today" as a YYYY-MM-DD in SBR's operating timezone (America/Denver). The
 *  nightly scheduler keys obligations off the Mountain date; the interactive
 *  read must agree, or an evening page-load (after UTC rolls over) generates a
 *  duplicate seed under a next-day external_key and mislabels every due date. */
function todayMountain(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
}

/** Default tier when not explicitly set: tax/payroll → tier1, else by criticality. Pure. */
export function defaultTier(category: OblCategory, criticality: Criticality): Tier {
  if (category === "tax" || category === "payroll") return "tier1";
  return criticality === "must" ? "tier2" : criticality === "important" ? "tier3" : "tier4";
}

/** Tier for a debt facility by its name/type. MCAs/fintech auto-debit → mca. Pure. */
export function debtTier(name: string, type: string): Tier {
  const n = (name || "").toLowerCase();
  // MCA / daily-or-weekly auto-debit advances. Broadened to common providers (audit #9:
  // generic MCAs like Kabbage/Credibly/OnDeck were missed). Bare "paypal" and "capital on
  // tap" removed (audit #10: a PayPal balance and the Capital On Tap CARD were wrongly
  // ranked #1) — "loanbuilder" still catches PayPal LoanBuilder. Short tokens stay
  // word-boundaried so "Comcast"/"Metafora" don't match.
  const isMcaName = /shopify capital|fresh funding|loanbuilder|uncapped|kabbage|credibly|ondeck|bluevine|forward\s*line|merchant cash|working capital advance|\bfora\b|\bmca\b/.test(n);
  // Cards and LOCs are revolving credit, never auto-debit advances — don't let an
  // MCA-ish name force a card to the top of the pay order.
  if (isMcaName && type !== "card" && type !== "loc") return "mca";
  if (type === "loan") return "tier2";       // SBA / bank term loans
  return "tier3";                            // cards / LOCs
}

/**
 * Pure: count active obligations whose amount is UNKNOWN (estimated $0) — the real
 * outflows projectedLow can't see — and how many of those are unavoidable (mca/tier1/
 * tier2). When unfundedCount > 0, projectedLow is a best-case ceiling, not the true floor.
 */
export function countUnfunded(
  active: Array<{ amount: number; amountEstimated: boolean; tier: Tier }>,
): { unfundedCount: number; unfundedMustPayCount: number } {
  const u = active.filter((o) => o.amountEstimated && o.amount <= 0);
  return {
    unfundedCount: u.length,
    unfundedMustPayCount: u.filter((o) => o.tier === "mca" || o.tier === "tier1" || o.tier === "tier2").length,
  };
}

/**
 * Rank tier-first (mca → tier1 → ...), then most-overdue, then largest, and
 * project the running cash balance if paid in that order. Pure. No DB.
 */
export function rankAndProject(obls: Obligation[], cashAvailable: number, asOf: string): Obligation[] {
  const ranked = obls
    .map((o) => ({ ...o, daysUntilDue: o.dueDate ? daysBetween(asOf, o.dueDate) : null, tierRank: TIER_RANK[o.tier] ?? 3 }))
    .sort((a, b) =>
      a.tierRank - b.tierRank ||
      (a.daysUntilDue ?? 9999) - (b.daysUntilDue ?? 9999) ||
      b.amount - a.amount);
  let running = cashAvailable;
  for (const o of ranked) {
    // hold = defer (per the tier model): parked bills do not draw down the runway.
    if (o.status === "paid" || o.status === "deferred" || o.status === "covered_by_plan" || o.tier === "hold") { o.runningCashAfter = null; continue; }
    running = r2(running - o.amount);
    o.runningCashAfter = running;
  }
  return ranked;
}

// ── tax & payroll cadences (OpenAccountants-verified) ───────────────────────
export function taxObligationSeeds(asOf: string): Array<{
  label: string; payee: string; category: OblCategory; tier: Tier; dueDate: string;
  cadence: string; criticality: Criticality; externalKey: string; rationale: string; sourceRef: string;
}> {
  const now = parseYmd(asOf);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const out: ReturnType<typeof taxObligationSeeds> = [];

  // Federal payroll deposit — monthly depositor: due the 15th of the following month.
  const depMonth = now.getUTCDate() <= 15 ? m : m + 1;
  const depYear = y + Math.floor(depMonth / 12);
  const depM = ((depMonth % 12) + 12) % 12;
  out.push({
    label: "Federal payroll tax deposit (941)", payee: "IRS / EFTPS", category: "payroll", tier: "tier1",
    dueDate: `${depYear}-${String(depM + 1).padStart(2, "0")}-15`, cadence: "monthly", criticality: "must",
    externalKey: `tax:payroll-deposit:${depYear}-${String(depM + 1).padStart(2, "0")}`,
    rationale: "Monthly depositor: prior month's withholding + FICA due by the 15th. Late = §6656 penalty + personal trust-fund exposure. Confirm semiweekly vs monthly with Roger.",
    sourceRef: "us-form-941-940-payroll",
  });

  // Quarterly 941 / FUTA — Apr 30, Jul 31, Oct 31, Jan 31.
  for (const mm of ["04-30", "07-31", "10-31", "01-31"]) {
    const q = mm === "01-31" ? "Q4" : mm === "04-30" ? "Q1" : mm === "07-31" ? "Q2" : "Q3";
    // Q4's 941/940 is due Jan 31. When asOf is already in January (m===0), that
    // deadline is THIS year (~days away); only Feb-Dec roll it to next year.
    // Hardcoding y+1 dropped the imminent Jan-31 filing out of the 120-day window
    // every January — the highest-consequence tax obligation, silently missing.
    const due = q === "Q4" ? `${m === 0 ? y : y + 1}-${mm}` : `${y}-${mm}`;
    const dlt = daysBetween(asOf, due);
    if (dlt >= 0 && dlt <= 120) {
      out.push({
        label: `Form 941 quarterly (${q})`, payee: "IRS / EFTPS", category: "tax", tier: "tier1", dueDate: due,
        cadence: "quarterly", criticality: "must", externalKey: `tax:941:${due}`,
        rationale: `Quarterly 941 balance due ${due}; FUTA (940) deposit too if accrued > $500.`, sourceRef: "us-form-941-940-payroll",
      });
    }
  }

  // Utah sales/use tax — monthly filer: due the last day of the following month.
  const stMonth = m + 1;
  const stYear = y + Math.floor(stMonth / 12);
  const stM = ((stMonth % 12) + 12) % 12;
  const stDue = `${stYear}-${String(stM + 1).padStart(2, "0")}-${String(lastDayOfMonth(stYear, stM)).padStart(2, "0")}`;
  out.push({
    label: "Utah sales & use tax (TC-62)", payee: "Utah State Tax Commission", category: "tax", tier: "tier1",
    dueDate: stDue, cadence: "monthly", criticality: "must", externalKey: `tax:ut-sales:${stYear}-${String(stM + 1).padStart(2, "0")}`,
    rationale: "Sales/use tax collected is the state's money — remit by month end. Confirm UT filing frequency + add other registered states with Roger.",
    sourceRef: "us-sales-tax",
  });

  return out;
}

// ── DB: cash position ───────────────────────────────────────────────────────
export async function getCashPosition(db: any, windowDays: number, asOf: string): Promise<CashPosition> {
  // Skip NULL-cash snapshots: a QB capture that gapped on bank accounts persists
  // a row with cash_on_hand = NULL, which would coalesce to $0 and fabricate a
  // shortfall. The canonical accessor (getLatestQbLiveSnapshot) filters these too.
  const cashRow = rows(await db.execute(sql`
    select cash_on_hand, accounts_receivable, captured_at::date as cash_as_of
    from qb_financial_snapshots where cash_on_hand is not null
    order by captured_at desc limit 1`))[0];
  const qboCashOnHand = num(cashRow?.cash_on_hand);
  // Prefer an operator-entered BANK-CONFIRMED balance over the lagging QB ledger. When none
  // exists this returns the QB value unchanged, so the fallback path is a no-op vs before.
  const authoritative = await getLatestAuthoritativeBankBalance(db).catch(() => null);
  const cashSrc = resolveCashSource(
    authoritative,
    { cashOnHand: qboCashOnHand, cashAsOf: cashRow?.cash_as_of ?? null },
    Date.now(),
  );
  const cashOnHand = cashSrc.cashOnHand;
  // A/R already earned and in transit (e.g. the Amazon marketplace payout) — real
  // "money on its way" the runway otherwise ignores. From the aging-report total.
  const receivablesInbound = r2(num(cashRow?.accounts_receivable));

  // Daily run-rate = trailing-30-day net revenue over a FIXED 30-day denominator.
  // avg() would divide by the count of present rows, so missing snapshot days
  // inflate the rate and make projected income too optimistic (under-warning the
  // shortfall — the wrong direction for a runway tool). net_revenue is NOT NULL.
  const salesRow = rows(await db.execute(sql`
    select coalesce(sum(net_revenue), 0) / 30.0 as daily_net
    from daily_sales_snapshots where date >= (${asOf}::date - 30)`))[0];
  const dailyRunRate = num(salesRow?.daily_net);

  // Expected channel payouts — the DEFENSIBLE "money on its way": Amazon (trailing
  // 14d sales) + Shopify (trailing 3d) netted by marketplace fees. Sales-derived
  // and DB-only (lazy import, no external API in this hot read path). Unlike the
  // QB A/R accrual above, this is granular near-cash, so it IS counted in the
  // runway. Failure leaves zeros — never a fabricated number.
  let expectedPayouts: ExpectedPayoutsSummary = {
    amazonNet: 0, shopifyNet: 0, totalNet: 0, amazonGross: 0, shopifyGross: 0,
    amazonSettlementDays: 14, shopifySettlementDays: 3,
  };
  let inboundWindow = 0;
  try {
    const { computeExpectedPayouts, inboundWithinDays } = await import("./expected-payouts-service");
    const ep = await computeExpectedPayouts(db, asOf);
    expectedPayouts = {
      amazonNet: ep.amazon.netExpected, shopifyNet: ep.shopify.netExpected, totalNet: ep.totalNetExpected,
      amazonGross: ep.amazon.grossWindow, shopifyGross: ep.shopify.grossWindow,
      amazonSettlementDays: ep.amazon.settlementDays, shopifySettlementDays: ep.shopify.settlementDays,
    };
    inboundWindow = inboundWithinDays(ep, windowDays);
  } catch (err: any) {
    console.warn("[Cash Command] expected-payouts compute failed:", err?.message ?? err);
  }

  // Settlement-aware projected income (avoids double-counting with inboundWindow):
  // forward sales also take ~3-14 days to settle, so only sales made in the first
  // (windowDays − blendedLag) days actually turn into cash inside the window. The
  // trailing pipeline (inboundWindow) covers the near-term cash; this covers the
  // forward sales that settle before the window ends. blendedLag is the channel-mix
  // weighted settlement lag (0 when we have no payout data → reverts to run-rate×W).
  const amazonDaily = expectedPayouts.amazonGross / Math.max(1, expectedPayouts.amazonSettlementDays);
  const shopifyDaily = expectedPayouts.shopifyGross / Math.max(1, expectedPayouts.shopifySettlementDays);
  const dailyMix = amazonDaily + shopifyDaily;
  const blendedLag =
    dailyMix > 0
      ? (amazonDaily * expectedPayouts.amazonSettlementDays + shopifyDaily * expectedPayouts.shopifySettlementDays) / dailyMix
      : 0;
  const projectedIncome = r2(dailyRunRate * Math.max(0, windowDays - blendedLag));

  return {
    asOf, cashOnHand, cashAsOf: cashRow?.cash_as_of ?? null,
    dailySalesRunRate: r2(dailyRunRate), windowDays, projectedIncome,
    receivablesInbound, expectedPayouts, inboundWindow, totalDue: 0, tier1Due: 0, projectedLow: 0,
    unfundedCount: 0, unfundedMustPayCount: 0, projectedLowComplete: true,
    cashSource: cashSrc.cashSource, cashConfirmedAt: cashSrc.cashConfirmedAt,
    cashStale: cashSrc.cashStale, cashStaleHours: cashSrc.cashStaleHours,
    cashDivergenceFlag: cashSrc.cashDivergenceFlag,
    inTransit: cashSrc.inTransit, inTransitTotal: cashSrc.inTransitTotal,
  };
}

/** Write a cash_position snapshot row (so the standalone tool can read it too). */
export async function writeCashPosition(db: any, asOf: string): Promise<void> {
  const p = await getCashPosition(db, 30, asOf);
  // One snapshot per day. getCashFlow runs on every page read, so a SELECT-then-INSERT
  // raced into duplicate rows under concurrent loads. A single INSERT ... ON CONFLICT
  // (as_of) upsert is race-safe (backed by the cash_position_as_of_uidx unique index in
  // startup-checks). expected_payouts_net = the nightly "total on its way" (net of fees).
  // Record the true source ('bank_confirmed' | 'qbo_ledger') so the persisted snapshot
  // doesn't masquerade an operator bank number as a QB read (or vice-versa).
  await db.execute(sql`
    insert into cash_position (as_of, cash_on_hand, expected_inflows, expected_payouts_net, source, updated_at)
    values (${asOf}::date, ${p.cashOnHand}, ${p.projectedIncome}, ${p.expectedPayouts.totalNet}, ${p.cashSource}, now())
    on conflict (as_of) do update set
      cash_on_hand = excluded.cash_on_hand, expected_inflows = excluded.expected_inflows,
      expected_payouts_net = excluded.expected_payouts_net, source = excluded.source, updated_at = now()`);
}

// ── DB: keep generated (tax/debt) obligations fresh ─────────────────────────
export async function syncGeneratedObligations(db: any, asOf: string): Promise<{ tax: number; debt: number }> {
  let tax = 0;
  for (const s of taxObligationSeeds(asOf)) {
    await db.execute(sql`
      insert into cash_obligations (label, payee, category, tier, amount, amount_estimated, due_date, cadence, criticality, status, source, external_key, rationale, source_ref)
      values (${s.label}, ${s.payee}, ${s.category}, ${s.tier}, 0, true, ${s.dueDate}::date, ${s.cadence}, ${s.criticality}, 'pending', 'tax', ${s.externalKey}, ${s.rationale}, ${s.sourceRef})
      on conflict (external_key) where external_key is not null do update set
        due_date = excluded.due_date, label = excluded.label, rationale = excluded.rationale,
        tier = excluded.tier, updated_at = now()
      where cash_obligations.status = 'pending' and not coalesce(cash_obligations.manually_edited, false)`);
    tax++;
  }

  let debt = 0;
  const debtKeys: string[] = []; // external_keys generated this run → close out the rest
  // Generate a monthly obligation for EVERY active facility with a balance. The
  // due_day filter used to require a non-null due_day, but credit_lines.due_day is
  // NULL on every facility, so the entire ~$1.16M debt stack never appeared in the
  // pay order. Default a NULL due day to the 15th (mid-month, avoids bunching every
  // facility on the 1st) and flag it as an estimate until the operator sets it.
  const lines = rows(await db.execute(sql`
    select name, type, due_day, payment_amount, payment_frequency from credit_lines where is_active and balance > 0`));
  const now = parseYmd(asOf);
  const { monthlyEquivalent } = await import("./credit-lines-service");
  for (const ln of lines) {
    const dueKnown = ln.due_day != null;
    const dd = Math.max(1, Math.min(28, num(ln.due_day) || 15));
    let yy = now.getUTCFullYear(), mm = now.getUTCMonth();
    if (now.getUTCDate() > dd) { mm += 1; yy += Math.floor(mm / 12); mm = ((mm % 12) + 12) % 12; }
    const due = `${yy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const key = `debt:${ln.name}:${yy}-${String(mm + 1).padStart(2, "0")}`;
    debtKeys.push(key);
    const tier = debtTier(ln.name, ln.type);
    // D3: REAL amounts from the operator-entered payment terms (monthly-equivalent for
    // daily/weekly cadences: ×21 business days, ×4.33 weeks). Facilities with no terms
    // still seed $0 + estimated + an "enter the amount" rationale — visible as unfunded
    // in the pay order, never silently guessed.
    const pay = ln.payment_amount != null ? num(ln.payment_amount) : null;
    const freq = ln.payment_frequency ? String(ln.payment_frequency) : null;
    const monthlyAmt = monthlyEquivalent(pay, freq);
    const hasAmount = monthlyAmt != null && monthlyAmt > 0;
    const isMonthlyCadence = !freq || freq.toLowerCase() === "monthly";
    const rationale = hasAmount
      ? `Scheduled ${ln.type || "debt"} payment${!isMonthlyCadence ? ` (${freq} $${pay} ≈ $${monthlyAmt}/mo)` : ""}.${dueKnown ? "" : " Due day is an estimate (15th) until set in the debt schedule."}`
      : `Scheduled ${ln.type || "debt"} payment.${dueKnown ? "" : " Due day is an estimate (15th) until set in the debt schedule."} Enter the payment amount in the debt schedule.`;
    await db.execute(sql`
      insert into cash_obligations (label, payee, category, tier, amount, amount_estimated, due_date, cadence, criticality, status, source, external_key, rationale)
      values (${ln.name + " payment"}, ${ln.name}, 'debt', ${tier}, ${hasAmount ? monthlyAmt : 0}, ${!hasAmount || !isMonthlyCadence}, ${due}::date, 'monthly', ${tier === "tier2" ? "must" : "important"}, 'pending', 'debt', ${key}, ${rationale})
      on conflict (external_key) where external_key is not null do update set
        amount = excluded.amount, amount_estimated = excluded.amount_estimated,
        due_date = excluded.due_date, tier = excluded.tier, rationale = excluded.rationale, updated_at = now()
      where cash_obligations.status = 'pending' and not coalesce(cash_obligations.manually_edited, false)`);
    debt++;
  }
  // CLOSE-OUT (audit #16): the debt external_key is month-bucketed (debt:NAME:YYYY-MM),
  // so when the month rolls (or a facility is paid off / deactivated) the prior key's row
  // is left status='pending', is_active=true, amount=0 forever and keeps showing in the
  // pay order with a past due date. Deactivate any generated-debt pending row NOT in this
  // run's key set. Only touches status='pending' (operator-approved/deferred rows are
  // preserved). Guarded on a non-empty key set so a failed lines query can't mass-close.
  if (debtKeys.length) {
    // Explicit ARRAY[...]::text[] — a bare JS-array binding into ALL() fails on this
    // driver ("malformed array literal"), which means this close-out had been silently
    // erroring since it shipped: stale month-bucketed debt rows were never deactivated.
    await db.execute(sql`
      update cash_obligations set is_active = false, updated_at = now()
      where source = 'debt' and is_active and status = 'pending'
        and external_key is not null
        and external_key <> all(ARRAY[${sql.join(debtKeys.map((k) => sql`${k}`), sql`, `)}]::text[])`);
  }
  // Surface (don't silently swallow) a failed cash-position write — a persistent
  // failure here means the nightly "money on its way" post + downstream readers go
  // stale. The catch keeps a hot page read from 500'ing, but it must be visible.
  await writeCashPosition(db, asOf).catch((e: any) =>
    console.error("[Cash Command] writeCashPosition failed (cash_position not updated):", e?.message ?? e),
  );
  return { tax, debt };
}

/** Vendors whose bills are tax obligations → tier1 (rank above ordinary AP). */
function isTaxVendor(vendor: string): boolean {
  return /tax commission|department of revenue|dept of revenue|franchise tax|\birs\b|eftps|state tax|internal revenue/i.test(vendor || "");
}

/**
 * Tier a (non-tax) vendor bill by operational criticality so the pay-order ranks
 * what the business actually needs to keep running above what can wait. Pure.
 *  - tier2 (must): fulfillment, materials, molds, freight, rent/facility — can't ship without them
 *  - tier4 (flexible): marketing / agencies / ad platforms — deferrable in a cash crunch
 *  - tier3 (important): everything else (legal, software, misc)
 */
export function classifyVendorTier(vendor: string): { tier: Tier; criticality: Criticality } {
  const v = (vendor || "").toLowerCase();
  // Marketing / ad-platform / agency first (a name can match both lists; defer wins
  // only for genuine marketing spend, so keep this list specific).
  if (/meta platforms|facebook|google ads|while you'?re in town|carpe diem|jezza|giant horizons|lucid earth|vertical ascension|gamerzdojo|tiktok|pinterest|\bmarketing\b/.test(v)) {
    return { tier: "tier4", criticality: "flexible" };
  }
  // Operationally critical: fulfillment, materials, molds, freight, rent/facility.
  if (/pyvott|accu-?form|mcmaster|uline|basic american|plastics|fulfillment|freight|postage|warehouse|\brent\b|property|utah ave|supply|materials|packaging|shippo|extensiv/.test(v)) {
    return { tier: "tier2", criticality: "must" };
  }
  return { tier: "tier3", criticality: "important" };
}

// ── DB: mirror open QuickBooks bills into the pay-order ─────────────────────
/** Upsert every open QB bill as a real (non-estimated) obligation, then mark any
 *  previously-synced qb_bill that is no longer open as paid so it drops off. The
 *  caller must only pass bills when QB actually returned them (never on a gap). */
export async function syncQbBillsToObligations(
  db: any,
  bills: Array<{ id: string | null; vendor: string; amount: number; dueDate: string | null; docNumber: string | null }>,
): Promise<{ upserted: number; closed: number }> {
  // DB-clock boundary: every still-open bill below gets updated_at = now() (> dbStart),
  // so anything left with updated_at < dbStart is no longer open in QB. Using the DB's
  // own clock keeps the sweep immune to app/DB clock skew.
  const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  const dbStart = rows(await db.execute(sql`select now() as t`))[0]?.t;
  // Vendor payment plans (e.g. "pay While You're In Town $1,000/week"): a matching
  // vendor's bills roll into ONE committed installment obligation instead of being
  // listed whole and treated as deferrable.
  const plans = rows(await db.execute(sql`
    select id, vendor_match, display_name, amount::float8 as amount, cadence, tier, note
    from vendor_payment_plans where is_active`));
  const planAgg = new Map<string, { plan: any; total: number; count: number; vendor: string }>();

  let upserted = 0;
  for (const b of bills) {
    const plan = plans.find((p: any) =>
      b.vendor.toLowerCase().includes(String(p.vendor_match || "").toLowerCase()));
    if (plan) {
      const agg = planAgg.get(plan.id) ?? { plan, total: 0, count: 0, vendor: b.vendor };
      agg.total += num(b.amount); agg.count += 1; planAgg.set(plan.id, agg);
      // Keep the underlying bill as an OPEN record (status 'covered_by_plan'), touching
      // updated_at so the end-of-run sweep below can't mark it 'paid'. Excluded from the
      // pay-now surfaces (the plan installment is the pay-now item) but stays queryable as
      // real open A/P so its exposure isn't hidden. Before this, plan-matched bills were
      // skipped, left untouched, and the sweep auto-closed them as 'paid' — e.g. $15,484 of
      // overdue While-You're-In-Town bills showed PAID while open + 31-90 days overdue in QB.
      // The caller only passes OPEN bills, so resurrecting a wrongly-'paid' row is correct
      // (the ON CONFLICT updates status even from 'paid', but respects operator edits).
      const planKey = `qbbill:${b.id ?? `${b.vendor}:${b.docNumber ?? b.dueDate ?? b.amount}`}`;
      const planLabel = `${b.vendor}${b.docNumber ? ` #${b.docNumber}` : ""}`;
      await db.execute(sql`
        insert into cash_obligations (label, payee, category, tier, amount, amount_estimated, due_date, cadence, criticality, status, source, external_key, rationale)
        values (${planLabel}, ${b.vendor}, 'vendor_bill', 'tier3', ${num(b.amount)}, false, ${b.dueDate}::date, 'one_time', 'important', 'covered_by_plan', 'qb_bill', ${planKey}, ${`Open bill covered by the ${plan.display_name || b.vendor} payment plan (paid via the plan installment).`})
        on conflict (external_key) where external_key is not null do update set
          amount = excluded.amount, due_date = excluded.due_date, payee = excluded.payee,
          label = excluded.label, status = 'covered_by_plan', updated_at = now()
        where not coalesce(cash_obligations.manually_edited, false)`);
      continue; // the plan installment (below) is the single pay-now item for this vendor
    }
    const key = `qbbill:${b.id ?? `${b.vendor}:${b.docNumber ?? b.dueDate ?? b.amount}`}`;
    const tax = isTaxVendor(b.vendor);
    const c = tax ? { tier: "tier1" as Tier, criticality: "must" as Criticality } : classifyVendorTier(b.vendor);
    const label = `${b.vendor}${b.docNumber ? ` #${b.docNumber}` : ""}`;
    const rationale = tax
      ? "Tax bill booked in QuickBooks A/P. Confirm with Roger."
      : c.tier === "tier2"
        ? "Open vendor bill — operationally critical supplier (must-pay)."
        : c.tier === "tier4"
          ? "Open vendor bill — marketing/agency; deferrable in a cash crunch."
          : "Open vendor bill from QuickBooks accounts payable.";
    await db.execute(sql`
      insert into cash_obligations (label, payee, category, tier, amount, amount_estimated, due_date, cadence, criticality, status, source, external_key, rationale)
      values (${label}, ${b.vendor}, ${tax ? "tax" : "vendor_bill"}, ${c.tier}, ${num(b.amount)}, false, ${b.dueDate}::date, 'one_time', ${c.criticality}, 'pending', 'qb_bill', ${key}, ${rationale})
      on conflict (external_key) where external_key is not null do update set
        amount = excluded.amount, due_date = excluded.due_date, payee = excluded.payee,
        label = excluded.label, tier = excluded.tier, updated_at = now()
      where cash_obligations.status <> 'paid'`);
    upserted++;
  }

  // One obligation per active plan with open bills: the agreed installment (not the
  // whole balance), tiered as a committed payment. Shows the cadence + balance.
  for (const { plan, total, count, vendor } of Array.from(planAgg.values())) {
    const tier = (plan.tier || "tier2") as Tier;
    const crit: Criticality = tier === "tier4" ? "flexible" : tier === "tier3" ? "important" : "must";
    const per = plan.cadence === "monthly" ? "month" : "week";
    const name = plan.display_name || vendor;
    const label = `${name} — ${usd(num(plan.amount))}/${per} plan`;
    const rationale = `Agreed ${plan.cadence} payment plan${plan.note ? `: ${plan.note}` : ""}. ${usd(total)} balance across ${count} open bill${count === 1 ? "" : "s"}.`;
    await db.execute(sql`
      insert into cash_obligations (label, payee, category, tier, amount, amount_estimated, due_date, cadence, criticality, status, source, external_key, rationale)
      values (${label}, ${name}, 'vendor_bill', ${tier}, ${num(plan.amount)}, false, current_date, ${plan.cadence}, ${crit}, 'pending', 'qb_bill', ${`plan:${plan.id}`}, ${rationale})
      on conflict (external_key) where external_key is not null do update set
        amount = excluded.amount, label = excluded.label, rationale = excluded.rationale,
        tier = excluded.tier, due_date = excluded.due_date, updated_at = now()
      where cash_obligations.status <> 'paid'`);
    upserted++;
  }

  // Anything source='qb_bill' not touched this run (paid in QB, or a plan now paid
  // off) drops off the pay-order.
  const res = await db.execute(sql`
    update cash_obligations set status = 'paid', updated_at = now()
    where source = 'qb_bill' and is_active and status <> 'paid' and updated_at < ${dbStart}`);
  return { upserted, closed: num((res as any)?.rowCount ?? 0) };
}

// ── DB: 13-week cash forecast (the standard turnaround instrument) ───────────
export interface ForecastWeek {
  weekStart: string; weekEnd: string; openingCash: number; inflows: number; outflows: number; endingCash: number;
}
/** Weekly cash projection for the next 13 weeks: opening cash → + sales run-rate
 *  − obligations due that week → ending cash. Recommend-only; never moves money. */
export async function compute13WeekForecast(db: any, asOf?: string): Promise<{
  startingCash: number; weeklyInflow: number; weeks: ForecastWeek[]; lowestCash: number; lowestWeek: string | null; note: string;
}> {
  const startStr = asOf ?? todayMountain();
  const start = parseYmd(startStr);
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const pos = await getCashPosition(db, 7, startStr);
  const weeklyInflow = r2(pos.dailySalesRunRate * 7);
  // Expected channel payouts land early: Shopify (~3d) + ~half of Amazon (~14d) in
  // week 0, the Amazon remainder in week 1; everything settles within ~14 days.
  let inWk0 = 0, inWk1 = 0;
  try {
    const { computeExpectedPayouts, inboundWithinDays } = await import("./expected-payouts-service");
    const ep = await computeExpectedPayouts(db, startStr);
    inWk0 = inboundWithinDays(ep, 7);
    inWk1 = r2(inboundWithinDays(ep, 14) - inboundWithinDays(ep, 7));
  } catch (err: any) {
    console.warn("[Cash Command] 13-week expected-payouts failed:", err?.message ?? err);
  }
  const endStr = fmt(new Date(start.getTime() + 91 * 86_400_000));
  const obls = rows(await db.execute(sql`
    select due_date::text as due, amount::float8 as amount from cash_obligations
    where is_active and status not in ('paid','deferred','covered_by_plan') and due_date is not null
      and due_date >= ${startStr}::date and due_date < ${endStr}::date`));
  let cash = pos.cashOnHand;
  let lowestCash = cash;
  let lowestWeek: string | null = null;
  const weeks: ForecastWeek[] = [];
  for (let w = 0; w < 13; w++) {
    const ws = new Date(start.getTime() + w * 7 * 86_400_000);
    const we = new Date(ws.getTime() + 6 * 86_400_000);
    const wsS = fmt(ws), weS = fmt(we);
    const outflows = r2(obls.filter((o: any) => o.due >= wsS && o.due <= weS).reduce((s: number, o: any) => s + num(o.amount), 0));
    const opening = cash;
    // Inflow = ongoing sales run-rate + the one-time pipeline payouts landing in
    // weeks 0-1 (Amazon/Shopify cash already earned, net of fees). The QB A/R
    // accrual is still excluded (unverified — see getCashFlow note).
    const pipelineInflow = w === 0 ? inWk0 : w === 1 ? inWk1 : 0;
    const weekInflow = r2(weeklyInflow + pipelineInflow);
    cash = r2(opening + weekInflow - outflows);
    if (cash < lowestCash) { lowestCash = cash; lowestWeek = wsS; }
    weeks.push({ weekStart: wsS, weekEnd: weS, openingCash: r2(opening), inflows: weekInflow, outflows, endingCash: cash });
  }
  return {
    startingCash: r2(pos.cashOnHand), weeklyInflow, weeks, lowestCash, lowestWeek,
    note: "OPTIMISTIC / best-case. Inflows are GROSS trailing-30d sales run-rate × 7 (costs NOT deducted, so true net cash inflow is materially lower) PLUS the one-time Amazon/Shopify pipeline payouts landing in weeks 0-1 (sales-estimate, net of fees). Outflows only include obligations that carry a due date and amount — debt service (MCA daily debits) and tax read $0 until their amounts are entered. Read the SHAPE (weekly bill timing, trajectory), not the level. Operational estimate; QuickBooks is authoritative.",
  };
}

// ── DB: the assembled, ranked cash-flow view ────────────────────────────────
export async function getCashFlow(db: any, opts: { windowDays?: number; asOf?: string } = {}): Promise<CashFlowResult> {
  const windowDays = opts.windowDays ?? 30;
  const asOf = opts.asOf ?? todayMountain();

  await syncGeneratedObligations(db, asOf).catch(() => {});
  const position = await getCashPosition(db, windowDays, asOf);

  const raw = rows(await db.execute(sql`
    select id, label, payee, category, tier, criticality, amount::float8 as amount, amount_estimated,
           due_date::text as due_date, pay_from, method, status, source, rationale, source_ref,
           anomaly_flag, anomaly_reason
    from cash_obligations
    where is_active and status not in ('paid', 'covered_by_plan')
      and (due_date is null or due_date <= (${asOf}::date + ${windowDays}::int))`));

  const obls: Obligation[] = raw.map((o: any) => {
    const criticality = (o.criticality || "important") as Criticality;
    const category = (o.category || "vendor_bill") as OblCategory;
    const tier = (o.tier || defaultTier(category, criticality)) as Tier;
    return {
      id: o.id, label: o.label, payee: o.payee, category, tier, tierRank: TIER_RANK[tier] ?? 3,
      amount: num(o.amount), amountEstimated: o.amount_estimated === true, dueDate: o.due_date, daysUntilDue: null,
      criticality, payFrom: o.pay_from, method: o.method, status: (o.status || "pending") as OblStatus,
      source: o.source, rationale: o.rationale, sourceRef: o.source_ref,
      anomalyFlag: o.anomaly_flag === true, anomalyReason: o.anomaly_reason, runningCashAfter: null,
    };
  });

  const ranked = rankAndProject(obls, position.cashOnHand, asOf);
  // "Due in window" / projected low excludes deferred AND hold-tier (hold = defer).
  const active = ranked.filter((o) => o.status !== "deferred" && o.tier !== "hold");
  const totalDue = r2(active.reduce((s, o) => s + o.amount, 0));
  const tier1Due = r2(active.filter((o) => o.tier === "tier1").reduce((s, o) => s + o.amount, 0));

  // FLAG-DON'T-FABRICATE: an active obligation seeded with an unknown amount (estimated
  // $0) draws $0 from totalDue, so projectedLow can't see it. Count them — and the
  // unavoidable ones (mca/tier1/tier2) — so projectedLow is surfaced as a CEILING (best
  // case), never a clean number, while a top-ranked MCA bucket still reads $0.
  const { unfundedCount, unfundedMustPayCount } = countUnfunded(active);

  return {
    // projectedLow COUNTS inboundWindow — the sales-derived expected channel payouts
    // (Amazon + Shopify, net of fees) that actually land within this window. That is
    // defensible near-cash, unlike the QB A/R accrual (receivablesInbound), which is
    // a single unverified Amazon journal entry shown for reference only and NOT added.
    // It does NOT subtract unfunded (estimated-$0) obligations — so when unfundedCount
    // > 0 it is a CEILING (projectedLowComplete=false), not the true floor.
    position: {
      ...position, totalDue, tier1Due,
      projectedLow: r2(position.cashOnHand + position.projectedIncome + position.inboundWindow - totalDue),
      unfundedCount, unfundedMustPayCount, projectedLowComplete: unfundedCount === 0,
    },
    obligations: ranked,
    generatedAt: new Date().toISOString(),
  };
}

// ── DB: mutations (with audit trail) ────────────────────────────────────────
export async function upsertObligation(db: any, p: {
  id?: string; label: string; payee?: string; category?: OblCategory; tier?: Tier; amount?: number;
  amountEstimated?: boolean; dueDate?: string | null; cadence?: string; criticality?: Criticality;
  payFrom?: string | null; method?: string | null; rationale?: string | null;
}): Promise<void> {
  const criticality = p.criticality ?? "important";
  const category = p.category ?? "vendor_bill";
  const tier = p.tier ?? defaultTier(category, criticality);
  if (p.id) {
    await db.execute(sql`
      update cash_obligations set
        label = ${p.label}, payee = ${p.payee ?? null}, category = ${category}, tier = ${tier},
        amount = ${p.amount ?? 0}, amount_estimated = ${p.amountEstimated ?? false},
        due_date = ${p.dueDate ?? null}::date, cadence = ${p.cadence ?? "one_time"},
        criticality = ${criticality}, pay_from = ${p.payFrom ?? null}, method = ${p.method ?? "ach"},
        rationale = ${p.rationale ?? null}, manually_edited = true, updated_at = now()
      where id = ${p.id}`);
  } else {
    await db.execute(sql`
      insert into cash_obligations (label, payee, category, tier, amount, amount_estimated, due_date, cadence, criticality, pay_from, method, rationale, source)
      values (${p.label}, ${p.payee ?? null}, ${category}, ${tier}, ${p.amount ?? 0}, ${p.amountEstimated ?? false},
              ${p.dueDate ?? null}::date, ${p.cadence ?? "one_time"}, ${criticality}, ${p.payFrom ?? null}, ${p.method ?? "ach"}, ${p.rationale ?? null}, 'manual')`);
  }
}

// covered_by_plan is set only by the bill sync, never via the operator status route, but the
// Record must be total over OblStatus.
const ACTION_FOR: Record<OblStatus, string> = { approved: "approved", deferred: "deferred", paid: "marked_paid", pending: "reopened", covered_by_plan: "covered_by_plan" };

/** Dual-control threshold: marking a paid obligation at/above this requires a
 *  different person than the approver. Configurable via env (default $1,000). */
const DUAL_CONTROL_THRESHOLD = Number(process.env.FINANCE_DUAL_CONTROL_THRESHOLD || 1000);

/** Segregation of duties (state machine): a material obligation may be marked
 *  paid ONLY from an 'approved' state, by a person OTHER than the approver.
 *  This blocks BOTH defeats of dual control:
 *    - pending -> paid in one step (no approval ever happened), and
 *    - self-approve -> self-pay (approver == payer).
 *  Non-material items (a KNOWN amount below the threshold) are not gated. An
 *  UNKNOWN amount (amountEstimated — the $0-seeded MCA/941 tax/debt rows) is
 *  treated as material and gated: those are exactly the high-consequence payments,
 *  so they must NOT slip under the threshold as a fabricated $0. Pure + unit-tested. */
export function sodBlocksPaid(targetStatus: OblStatus, currentStatus: OblStatus, amount: number, approvedBy: string | null, actor: string, threshold = DUAL_CONTROL_THRESHOLD, amountEstimated = false): boolean {
  if (targetStatus !== "paid") return false;
  const material = amountEstimated || amount >= threshold; // unknown amount = material (fail-safe)
  if (!material) return false;
  return currentStatus !== "approved" || !approvedBy || approvedBy === actor;
}

export type StatusResult = { ok: boolean; reason?: "not_found" | "no_actor" | "sod_block"; auditWarning?: boolean };

export async function setObligationStatus(db: any, id: string, status: OblStatus, by?: string, byName?: string): Promise<StatusResult> {
  const o = rows(await db.execute(sql`select amount::float8 as amount, amount_estimated, approved_by, status from cash_obligations where id = ${id}`))[0];
  // Unknown/stale/deleted/forged id: refuse so we never write an orphan audit row.
  if (!o) return { ok: false, reason: "not_found" };
  // Every action must attribute to a real authenticated person — never a placeholder
  // like "team" (which destroys the audit trail's evidentiary value).
  if (!by) return { ok: false, reason: "no_actor" };
  const currentStatus = (o.status ?? "pending") as OblStatus;
  // Idempotent re-mark (e.g. re-confirming an already-paid item) is a no-op, not
  // an SoD violation — avoid rewriting timestamps or returning a spurious 409.
  if (currentStatus === status) return { ok: true };

  let action: string = ACTION_FOR[status] ?? status;
  // Segregation of duties: a material item reaches 'paid' only from 'approved',
  // by someone other than the approver — no pending->paid shortcut, no self-pay.
  if (sodBlocksPaid(status, currentStatus, num(o.amount), o.approved_by ?? null, by, DUAL_CONTROL_THRESHOLD, o.amount_estimated === true)) {
    // Dual control needs a SECOND eligible approver. In a single-admin org that is
    // impossible, so rather than permanently deadlock material payments we allow
    // the self-pay but record it as a distinct, auditable action. With 2+ admins
    // the block stands.
    const eligible = num(rows(await db.execute(sql`select count(*)::int as c from users where role in ('admin','owner')`))[0]?.c ?? 0);
    if (eligible > 1) return { ok: false, reason: "sod_block" };
    action = "marked_paid_single_operator";
  }
  await db.execute(sql`
    update cash_obligations set
      status = ${status},
      approved_by = ${status === "approved" ? by : sql`approved_by`},
      approved_at = ${status === "approved" ? sql`now()` : sql`approved_at`},
      paid_at = ${status === "paid" ? sql`now()` : sql`paid_at`},
      updated_at = now()
    where id = ${id}`);
  // Append-only audit trail (DB trigger blocks UPDATE/DELETE) — critical given the
  // ACH fraud history. Best-effort so a logging hiccup never blocks the recorded
  // decision, but a FAILURE must be visible (audit #8): log it and flag the result,
  // so a marked-paid-without-audit row isn't silently swallowed.
  let auditWarning = false;
  await db.execute(sql`
    insert into payment_actions (obligation_id, action, acted_by, acted_by_name, amount)
    values (${id}, ${action}, ${by}, ${byName ?? null}, ${num(o.amount)})`).catch((e: any) => {
    auditWarning = true;
    console.error(`[Cash Command] payment_actions audit insert FAILED for obligation ${id} (${action} by ${by}):`, e?.message ?? e);
  });
  return auditWarning ? { ok: true, auditWarning: true } : { ok: true };
}
