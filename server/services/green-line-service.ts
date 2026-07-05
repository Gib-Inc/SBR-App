/**
 * Green Line — cost & debt analytics (read-only, recommend-only):
 *   - opex-creep monitor: operating expense as % of net sales, by month
 *   - spend-leak detector: vendors by share of opex + rising-faster-than-revenue
 *   - debt-avalanche planner: facilities ranked by true cost (tier), payoff order
 *
 * Account classification uses the CANONICAL classifyAccount() from finance-pnl-service
 * (the same one monthly_financials / the budget scorecard use) so Green Line's net income,
 * opex %, and spend leaks reconcile to the P&L surfaces exactly. The old inline
 * `account_name ~ '^[123] -'` rule matched ONLY the duplicate "Match Shopify" accounts and
 * swept real Gross Sales into opex — producing fictional -$200K to -$445K/mo losses, opex %
 * of 171-267%, and a permanently-pinned CRITICAL banner.
 */
import { sql } from "drizzle-orm";
import { debtTier, type Tier } from "./cash-flow-service";
import { classifyAccount, rollup } from "./finance-pnl-service";

type DB = any;
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

export type Severity = "HEALTHY" | "WARNING" | "CRITICAL";

// ── opex creep ──────────────────────────────────────────────────────────────
/** Opex as % of net sales: >=90 CRITICAL (opex alone eats the top line), >=75 WARNING. Pure. */
export function opexStatus(pct: number): Severity {
  return pct >= 90 ? "CRITICAL" : pct >= 75 ? "WARNING" : "HEALTHY";
}

export interface OpexMonth { month: string; netSales: number; opex: number; opexPct: number; status: Severity; }

export async function computeOpexCreep(db: DB, sinceYmd = "2026-01-01"): Promise<{
  months: OpexMonth[]; latest: OpexMonth | null; monthsOver90: number;
}> {
  // Pull per-month, per-account totals and classify with the CANONICAL classifyAccount in JS
  // (net sales = income + contra; opex = expense; cogs/duplicate excluded) so opex % matches
  // the P&L surfaces exactly. Row count is tiny (months × accounts).
  const rs = rows(await db.execute(sql`
    select to_char(date_trunc('month', txn_date),'YYYY-MM') as ym, account_name, sum(amount) as amt
    from qb_pl_detail where txn_date >= ${sinceYmd}::date
    group by 1, 2 order by 1`));
  const byMonth = new Map<string, { netSales: number; opex: number }>();
  for (const rr of rs) {
    const ym = String(rr.ym);
    const amt = num(rr.amt);
    const g = classifyAccount(String(rr.account_name));
    const m = byMonth.get(ym) ?? { netSales: 0, opex: 0 };
    if (g === "income" || g === "contra") m.netSales += amt; // contra is negative in QB → nets down
    else if (g === "expense") m.opex += amt;
    byMonth.set(ym, m);
  }
  const months: OpexMonth[] = Array.from(byMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([ym, m]) => {
      const pct = m.netSales > 0 ? r1((m.opex / m.netSales) * 100) : 0;
      return { month: ym, netSales: r0(m.netSales), opex: r0(m.opex), opexPct: pct, status: opexStatus(pct) };
    });
  // Severity keys off the last COMPLETE month, not the in-progress one: a partial
  // month's opex/sales ratio is unstable and would swing the headline by day.
  const currentYm = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" }).slice(0, 7);
  const complete = months.filter((m) => m.month < currentYm);
  return {
    months,
    latest: complete[complete.length - 1] ?? months[months.length - 1] ?? null,
    monthsOver90: months.filter((m) => m.opexPct >= 90).length,
  };
}

// ── spend-leak detector ─────────────────────────────────────────────────────
export interface VendorSpend {
  vendor: string; spend90: number; pctOfOpex: number;
  spend30: number; prior30: number; growthPct: number | null;
  concentrationFlag: boolean; risingFlag: boolean;
}

export async function computeSpendLeaks(db: DB): Promise<{ vendors: VendorSpend[]; totalOpex90: number }> {
  // Pull per-vendor, per-ACCOUNT positive amounts so we can classify each account with the
  // canonical classifyAccount and keep ONLY true operating expense ('expense'). The old SQL
  // filter (`!~ '^[123] -'` + exclude COGS) let the real 'Gross Sales' income account through,
  // inflating the opex base ~2.3x (~$773K of revenue counted as spend) and defeating the
  // 15%-concentration flag.
  const raw = rows(await db.execute(sql`
    select coalesce(nullif(vendor_or_payee,''),'(unattributed)') as vendor, account_name,
      coalesce(sum(amount) filter (where txn_date >= current_date-90),0) as spend90,
      coalesce(sum(amount) filter (where txn_date >= current_date-30),0) as spend30,
      coalesce(sum(amount) filter (where txn_date >= current_date-60 and txn_date < current_date-30),0) as prior30
    from qb_pl_detail
    where amount > 0 and txn_date >= (current_date - 90)
    group by 1, 2`));

  const byVendor = new Map<string, { spend90: number; spend30: number; prior30: number }>();
  let totalOpex90 = 0;
  for (const rr of raw) {
    if (classifyAccount(String(rr.account_name)) !== "expense") continue; // opex only
    const vendor = String(rr.vendor);
    const v = byVendor.get(vendor) ?? { spend90: 0, spend30: 0, prior30: 0 };
    v.spend90 += num(rr.spend90); v.spend30 += num(rr.spend30); v.prior30 += num(rr.prior30);
    byVendor.set(vendor, v);
    totalOpex90 += num(rr.spend90);
  }

  const vendors: VendorSpend[] = Array.from(byVendor.entries())
    .filter(([, v]) => v.spend90 > 0)
    .sort((a, b) => b[1].spend90 - a[1].spend90)
    .slice(0, 12)
    .map(([vendor, v]) => {
      const pctOfOpex = totalOpex90 > 0 ? r1((v.spend90 / totalOpex90) * 100) : 0;
      const growthPct = v.prior30 > 0 ? r1(((v.spend30 - v.prior30) / v.prior30) * 100) : null;
      return {
        vendor, spend90: r0(v.spend90), pctOfOpex,
        spend30: r0(v.spend30), prior30: r0(v.prior30), growthPct,
        concentrationFlag: pctOfOpex > 15,
        risingFlag: growthPct != null && growthPct > 10,
      };
    });
  return { vendors, totalOpex90: r0(totalOpex90) };
}

// ── debt-avalanche planner ──────────────────────────────────────────────────
const TIER_COST_RANK: Record<Tier, number> = { mca: 0, tier1: 1, tier2: 2, tier3: 3, tier4: 4, hold: 9 };
const TIER_BUCKET: Record<string, string> = {
  mca: "MCA / daily-debit (retire first)", tier2: "SBA / bank term", tier3: "Cards & lines of credit",
};

export interface DebtFacility { name: string; type: string; balance: number; apr: number | null; tier: Tier; bucket: string; payoffOrder: number; }

export async function computeDebtAvalanche(db: DB): Promise<{
  facilities: DebtFacility[];
  byBucket: Array<{ bucket: string; tier: Tier; total: number; count: number }>;
  totalDebt: number;
  interestTrend: Array<{ month: string; interest: number }>;
  // FLAG-DON'T-FABRICATE: a true avalanche needs every APR. Surface how much debt has no rate
  // so the payoff order is presented as partial, not authoritative, while APRs are unset.
  aprCoverage: { missingCount: number; missingBalance: number };
  // D3: what actually leaves the bank — daily ACH out (daily-cadence facilities; reconcile
  // against the bank statement) + cadence-normalized monthly service, and the balance still
  // missing payment terms (reads $0 in every runway/forecast until entered).
  debtService: { dailyAchOut: number; monthlyTotal: number; missingPaymentCount: number; missingPaymentBalance: number };
  // Ghost facilities (vanished from QuickBooks but still carrying a balance) are EXCLUDED
  // from the payoff order by default — a settlement number needs a living source.
  ghosts: { count: number; balance: number; names: string[] };
}> {
  const all = rows(await db.execute(sql`
    select name, type, balance, apr, rate_type, payment_amount, payment_frequency, qb_missing_since
    from credit_lines where is_active and balance > 0`));
  const ghostRows = all.filter((rr: any) => rr.qb_missing_since != null);
  // Ghosts are excluded from the payoff ORDER only (a settlement number needs a living
  // source) — they stay IN totalDebt and debt service. Dropping them from totals would
  // fabricate a smaller debt stack on the north-star tile; a debt doesn't stop debiting
  // the bank because its QB account vanished.
  const rs = all.filter((rr: any) => rr.qb_missing_since == null);
  const { monthlyEquivalent, dailyDebitTotal } = await import("./credit-lines-service");
  const termed = all.map((rr: any) => ({
    paymentAmount: rr.payment_amount != null ? num(rr.payment_amount) : null,
    paymentFrequency: rr.payment_frequency ?? null,
    balance: num(rr.balance),
  }));
  const dailyAchOut = dailyDebitTotal(termed);
  const monthlyTotal = termed.reduce((s: number, t: any) => s + (monthlyEquivalent(t.paymentAmount, t.paymentFrequency) ?? 0), 0);
  const missingPayment = termed.filter((t: any) => t.paymentAmount == null || t.paymentAmount <= 0);
  // TRUE avalanche: retire MCAs first (daily revenue-share debits — effective cost far exceeds
  // any stated APR), then rank the rest by ACTUAL APR descending (a null rate sorts last so a
  // rate-blind facility never jumps ahead of a known 36% one), tie-broken by balance. The old
  // sort used name-keyword tier + balance and ignored the apr column entirely — it told you to
  // pay 9.5% SBA debt before the 36% HELOC.
  const ranked = rs
    .map((rr: any) => {
      // G #14: an EXPLICIT rate_type ('factor'/'revenue_share') marks MCA-style pricing
      // even when the name-keyword heuristic misses it (rename-proof) — and it means the
      // apr column is a scraped lie for this facility, so never rank or display it as real.
      const explicitMca = rr.rate_type === "factor" || rr.rate_type === "revenue_share";
      const tier = explicitMca ? ("mca" as Tier) : debtTier(String(rr.name || ""), String(rr.type || ""));
      const apr = rr.apr == null || explicitMca ? null : num(rr.apr);
      return { name: String(rr.name), type: String(rr.type || ""), balance: num(rr.balance), apr, tier };
    })
    .sort((a, b) => {
      const am = a.tier === "mca" ? 0 : 1, bm = b.tier === "mca" ? 0 : 1;
      if (am !== bm) return am - bm;                     // MCAs first (daily-debit)
      if (am === 0) return b.balance - a.balance;        // within MCAs: larger balance first
      const aApr = a.apr ?? -1, bApr = b.apr ?? -1;      // non-MCA: highest APR first, nulls last
      if (bApr !== aApr) return bApr - aApr;
      return b.balance - a.balance;                       // tie-break: larger balance
    });

  const facilities: DebtFacility[] = ranked.map((f, i) => ({
    ...f, balance: r0(f.balance), apr: f.apr, bucket: TIER_BUCKET[f.tier] ?? "Other", payoffOrder: i + 1,
  }));

  const bucketMap = new Map<string, { bucket: string; tier: Tier; total: number; count: number }>();
  for (const f of ranked) {
    const key = f.tier;
    const b = bucketMap.get(key) ?? { bucket: TIER_BUCKET[f.tier] ?? "Other", tier: f.tier, total: 0, count: 0 };
    b.total += f.balance; b.count += 1; bucketMap.set(key, b);
  }
  const byBucket = Array.from(bucketMap.values())
    .map((b) => ({ ...b, total: r0(b.total) }))
    .sort((a, b) => TIER_COST_RANK[a.tier] - TIER_COST_RANK[b.tier]);

  const trendRows = rows(await db.execute(sql`
    select to_char(date_trunc('month', txn_date),'YYYY-MM') as ym, coalesce(sum(amount),0) as interest
    from qb_pl_detail where account_name = 'Interest, Bank Fees & Service Charges'
      and txn_date >= (current_date - interval '6 months')
    group by 1 order by 1`));
  const interestTrend = trendRows.map((rr: any) => ({ month: String(rr.ym), interest: r0(num(rr.interest)) }));

  const missingApr = ranked.filter((f) => f.apr == null);
  const ghostBalance = ghostRows.reduce((s: number, rr: any) => s + num(rr.balance), 0);
  return {
    facilities,
    byBucket,
    // ALL active debt, ghosts included — the ORDER above excludes them, the TOTAL never does.
    totalDebt: r0(ranked.reduce((s, f) => s + f.balance, 0) + ghostBalance),
    interestTrend,
    aprCoverage: { missingCount: missingApr.length, missingBalance: r0(missingApr.reduce((s, f) => s + f.balance, 0)) },
    debtService: {
      dailyAchOut: r0(dailyAchOut), monthlyTotal: r0(monthlyTotal),
      missingPaymentCount: missingPayment.length,
      missingPaymentBalance: r0(missingPayment.reduce((s: number, t: any) => s + t.balance, 0)),
    },
    ghosts: {
      count: ghostRows.length,
      balance: r0(ghostBalance),
      names: ghostRows.map((rr: any) => String(rr.name)),
    },
  };
}

// ── L7: the Green Line north-star ───────────────────────────────────────────
/** Runway severity, status-aware. Returns null ("unknown") when the persisted
 *  forecast is gapped: a NULL day count means EITHER cash-flow positive OR a
 *  failed calculation, and the two must not both read green. */
function runwaySev(days: number | null, status: string | null): Severity | null {
  if (status === "CALCULATION_GAPPED" || status === "MISMATCH") return null;
  if (days == null) return "HEALTHY"; // genuine cash-flow positive (no finite burn)
  return days < 30 ? "CRITICAL" : days < 90 ? "WARNING" : "HEALTHY";
}
/** Worst (most severe) of the KNOWN severities. Gaps are excluded by the caller. */
function worst(s: Severity[]): Severity {
  if (s.includes("CRITICAL")) return "CRITICAL";
  if (s.includes("WARNING")) return "WARNING";
  return "HEALTHY";
}

export interface GreenLineSummary {
  overall: Severity;
  cashOnHand: number | null;
  runwayDays: number | null;
  runwaySeverity: string; // Severity or "UNKNOWN" (gapped)
  burnRate: number | null;
  dscr: number | null;
  dscrStatus: string;
  opexPct: number | null;
  opexSeverity: string; // Severity or "UNKNOWN" (gapped)
  governorState: string;
  blendedMer: number | null;
  totalDebt: number;
  mcaBucket: number;
  netIncomeTrend: Array<{ month: string; netIncome: number }>;
  gaps: string[];
  asOf: string | null;
}

/** One readout: is SBR trending into the green? Worst-of solvency severities
 *  (runway, DSCR, opex) drives the overall color; governor + debt shown alongside. */
export async function computeGreenLine(db: DB): Promise<GreenLineSummary> {
  const { computeDscr } = await import("./dscr-service");
  const { computeGovernor } = await import("./marketing-governor-service");

  const [cashRow, runwayRow, niRows, debt, dscr, opex, gov] = await Promise.all([
    db.execute(sql`select cash_on_hand, captured_at::date::text as as_of from qb_financial_snapshots
      where cash_on_hand is not null order by captured_at desc limit 1`).then((r: any) => rows(r)[0]),
    db.execute(sql`select realistic_days, calculated_burn_rate, runway_status from financial_runway_forecasts
      order by created_at desc limit 1`).then((r: any) => rows(r)[0]),
    db.execute(sql`
      select to_char(date_trunc('month',txn_date),'YYYY-MM') as ym, account_name, sum(amount) as amt
      from qb_pl_detail where txn_date >= (current_date - interval '6 months')
      group by 1, 2 order by 1`).then((r: any) => rows(r)),
    computeDebtAvalanche(db),
    computeDscr(db),
    computeOpexCreep(db),
    computeGovernor(db),
  ]);

  // Net income per month via the canonical rollup() (classifies each account with the same
  // classifyAccount the P&L surfaces use, excluding the Match-Shopify duplicate tree), so the
  // trend reconciles to monthly_financials instead of the old ~5-11x-too-negative inline rule.
  const niByMonth = new Map<string, Array<{ account: string; amount: number }>>();
  for (const rr of niRows as any[]) {
    const ym = String(rr.ym);
    if (!niByMonth.has(ym)) niByMonth.set(ym, []);
    niByMonth.get(ym)!.push({ account: String(rr.account_name), amount: num(rr.amt) });
  }
  const netIncomeTrend = Array.from(niByMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([ym, items]) => ({ month: ym, netIncome: r0(rollup(items).netIncome) }));

  // Prefer the operator-entered bank-confirmed balance over the lagging QB ledger so the
  // Green Line shows the same cash as the Cash Out view (one number, app-wide).
  const qbCash = cashRow?.cash_on_hand != null ? num(cashRow.cash_on_hand) : null;
  const { getBankConfirmedOverride } = await import("./cash-flow-service");
  const bankOv = await getBankConfirmedOverride(db).catch(() => null);
  const cashOnHand = bankOv ? bankOv.cashOnHand : qbCash;

  const runwayDays = runwayRow?.realistic_days != null ? num(runwayRow.realistic_days) : null;
  const rwSev = runwaySev(runwayDays, runwayRow?.runway_status ?? null);
  const dscrSev: Severity | null =
    dscr.status === "CRITICAL" ? "CRITICAL" : dscr.status === "WARNING" ? "WARNING" : dscr.status === "HEALTHY" ? "HEALTHY" : null;
  const opexSev: Severity | null = opex.latest ? opex.latest.status : null;
  // A data gap is "unknown" — it must not read green OR amber. The color reflects
  // only the instruments we can actually measure; gaps are surfaced separately.
  const known = [rwSev, dscrSev, opexSev].filter((s): s is Severity => s != null);
  const overall: Severity = known.length ? worst(known) : "WARNING";
  const gaps: string[] = [];
  if (rwSev == null) gaps.push("runway");
  if (dscrSev == null) gaps.push("DSCR");
  if (opexSev == null) gaps.push("opex");
  const mcaBucket = (debt.byBucket.find((b) => b.tier === "mca")?.total) ?? 0;

  return {
    overall,
    cashOnHand: cashOnHand != null ? r0(cashOnHand) : null,
    runwayDays,
    runwaySeverity: rwSev ?? "UNKNOWN",
    burnRate: runwayRow?.calculated_burn_rate != null ? r0(num(runwayRow.calculated_burn_rate)) : null,
    dscr: dscr.dscr,
    dscrStatus: dscr.status,
    opexPct: opex.latest?.opexPct ?? null,
    opexSeverity: opexSev ?? "UNKNOWN",
    governorState: gov.state,
    blendedMer: gov.blendedMer,
    totalDebt: debt.totalDebt,
    mcaBucket,
    netIncomeTrend,
    gaps,
    asOf: cashRow?.as_of ?? null,
  };
}
