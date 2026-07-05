/**
 * Green Line L2 — Debt-Service Coverage Ratio (DSCR).
 *
 * DSCR = operating cash flow / total debt service. Below 1.0 means operations
 * cannot cover debt (the business is borrowing to pay debt — the MCA-spiral
 * signature). This is the single most important turnaround gauge.
 *
 * ANTI-HALLUCINATION: debt PRINCIPAL is operator-entered (cash_obligations debt
 * amounts, currently 0). When principal is unknown we do NOT treat it as zero and
 * report a rosy ratio. We compute against interest only, label the result a
 * best-case upper bound, and emit a named dataGap. A negative numerator is
 * CRITICAL regardless of the denominator.
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export type DscrStatus = "HEALTHY" | "WARNING" | "CRITICAL" | "CALCULATION_GAPPED";

export interface DscrResult {
  asOf: string | null;
  netIncome: number | null;        // trailing-30d net income (post-interest)
  interest: number | null;         // trailing-30d interest + bank fees (slightly overstated)
  principal: number | null;        // monthly debt principal (operator-entered); null if unknown
  operatingCashFlow: number | null; // netIncome + interest (pre-interest, cash available for debt)
  debtService: number | null;      // interest + principal (principal floored to 0 when unknown)
  dscr: number | null;             // operatingCashFlow / debtService
  interestCoverage: number | null; // operatingCashFlow / interest (the upper bound when principal unknown)
  status: DscrStatus;
  dataGaps: string[];
}

/**
 * Pure verdict: ratio + severity band. CRITICAL when operations are underwater
 * (numerator <= 0) or DSCR < 1.0; WARNING in the 1.0-1.25 lender danger zone;
 * HEALTHY at >= 1.25. Unit tested.
 */
export function dscrVerdict(
  operatingCashFlow: number | null,
  debtService: number | null,
): { dscr: number | null; status: DscrStatus } {
  if (operatingCashFlow != null && operatingCashFlow <= 0) {
    // Operations don't even cover interest — CRITICAL no matter the denominator.
    return { dscr: debtService && debtService > 0 ? r2(operatingCashFlow / debtService) : null, status: "CRITICAL" };
  }
  if (operatingCashFlow == null || debtService == null || debtService <= 0) {
    return { dscr: null, status: "CALCULATION_GAPPED" };
  }
  const dscr = r2(operatingCashFlow / debtService);
  const status: DscrStatus = dscr < 1.0 ? "CRITICAL" : dscr < 1.25 ? "WARNING" : "HEALTHY";
  return { dscr, status };
}

/**
 * Cap the DSCR band when principal is UNKNOWN. With principal floored to 0 the
 * denominator (interest only) is a lower bound, so the ratio is a best-case
 * interest-coverage UPPER bound. It must therefore never read HEALTHY — a rosy
 * "1.81 HEALTHY" that hides the unpaid principal is exactly the flattering-the-
 * business failure this service's anti-hallucination contract exists to prevent.
 * Real principal only ever LOWERS the ratio, so downgrade HEALTHY→WARNING; leave
 * CRITICAL / CALCULATION_GAPPED untouched (they can't get better with more debt).
 * Pure, unit-tested.
 */
export function capStatusForUnknownPrincipal(
  status: DscrStatus,
  principalKnown: boolean,
): DscrStatus {
  if (principalKnown) return status;
  return status === "HEALTHY" ? "WARNING" : status;
}

export async function computeDscr(db: DB): Promise<DscrResult> {
  const snap = rows(await db.execute(sql`
    select net_income, captured_at::date as as_of
    from qb_financial_snapshots where net_income is not null
    order by captured_at desc limit 1`))[0];
  const netIncome = snap?.net_income != null ? num(snap.net_income) : null;
  const asOf = snap?.as_of ?? null;

  // Debt-service interest = BOTH debt-interest accounts in this QB realm. Reading only
  // 'Interest, Bank Fees & Service Charges' missed 'Interest Expense' entirely (a real
  // debt-interest line). Explicit list, not ILIKE, so pure operating-fee accounts
  // ('Bank Fees & Service Charges', 'Merchant Account Fees' — NOT debt service) can't
  // leak in. The same set feeds the numerator add-back and the denominator, so the
  // ratio stays internally consistent.
  const intRow = rows(await db.execute(sql`
    select coalesce(sum(amount),0) as interest from qb_pl_detail
    where account_name in ('Interest, Bank Fees & Service Charges', 'Interest Expense')
      and txn_date >= (current_date - 30)`))[0];
  const interest = intRow ? num(intRow.interest) : null;

  // Operator-entered monthly debt principal (cash_obligations debt rows). 0/empty => unknown.
  const prinRow = rows(await db.execute(sql`
    select coalesce(sum(amount),0) as principal from cash_obligations
    where category = 'debt' and is_active and status <> 'paid'`))[0];
  const principalEntered = prinRow ? num(prinRow.principal) : 0;
  const principalKnown = principalEntered > 0;

  const dataGaps: string[] = [];
  if (netIncome == null) dataGaps.push("Net income (QuickBooks snapshot)");
  if (interest == null) dataGaps.push("Interest expense (QuickBooks P&L)");
  if (!principalKnown)
    dataGaps.push("Debt principal — enter each facility's monthly payment in the debt schedule (DSCR shown is a best-case interest-coverage upper bound)");

  const operatingCashFlow = netIncome != null && interest != null ? r2(netIncome + interest) : null;
  // Principal floored to 0 when unknown => debtService is a LOWER bound => DSCR is an UPPER bound (best case).
  const debtService = interest != null ? r2(interest + principalEntered) : null;
  const interestCoverage = operatingCashFlow != null && interest && interest > 0 ? r2(operatingCashFlow / interest) : null;

  const verdict = dscrVerdict(operatingCashFlow, debtService);
  const dscr = verdict.dscr;
  // Never let an interest-only (principal-unknown) ratio read HEALTHY.
  const status = capStatusForUnknownPrincipal(verdict.status, principalKnown);

  return {
    asOf,
    netIncome,
    interest,
    principal: principalKnown ? principalEntered : null,
    operatingCashFlow,
    debtService,
    dscr,
    interestCoverage,
    status,
    dataGaps,
  };
}
