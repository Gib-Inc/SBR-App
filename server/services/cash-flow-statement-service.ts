/**
 * Statement of Cash Flows (indirect method) — HONEST PARTIAL.
 *
 * Computes the operating section it can from two QuickBooks financial snapshots
 * (net income ± ΔAR / ΔAP / ΔInventory). It does NOT fabricate the pieces the app
 * cannot see: D&A (non-cash add-back), capex (investing), and debt draws/paydowns
 * (financing) are flagged as not-captured, and the statement therefore does NOT
 * claim to reconcile to the actual change in cash — the unreconciled gap IS those
 * missing items. QuickBooks' own Statement of Cash Flows is authoritative; this
 * reports and flags, it never posts entries. OpenAccountants: us-gaap-asc606-revenue
 * (presentation) / us-sole-prop-bookkeeping (the GL is the substantiating record).
 */
import { sql } from "drizzle-orm";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number | null => (v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function computeCashFlowStatement(db: any, periodDays = 30): Promise<any> {
  const end = rows(await db.execute(sql`
    select captured_at::text as at, net_income::float8 as ni, accounts_receivable::float8 as ar,
           accounts_payable::float8 as ap, qb_inventory::float8 as inv, cash_on_hand::float8 as cash
    from qb_financial_snapshots where cash_on_hand is not null order by captured_at desc limit 1`))[0];
  if (!end) return { available: false, note: "No QuickBooks snapshot captured yet." };

  let start = rows(await db.execute(sql`
    select captured_at::text as at, accounts_receivable::float8 as ar, accounts_payable::float8 as ap,
           qb_inventory::float8 as inv, cash_on_hand::float8 as cash
    from qb_financial_snapshots q
    where q.cash_on_hand is not null
      and q.captured_at <= (${end.at}::timestamptz - (${String(periodDays)} || ' days')::interval)
    order by q.captured_at desc limit 1`))[0];
  let spanShort = false;
  if (!start) {
    // No snapshot that far back yet — use the earliest available (the widest span the
    // short snapshot history supports) and flag that the period is approximate.
    spanShort = true;
    start = rows(await db.execute(sql`
      select captured_at::text as at, accounts_receivable::float8 as ar, accounts_payable::float8 as ap,
             qb_inventory::float8 as inv, cash_on_hand::float8 as cash
      from qb_financial_snapshots q
      where q.cash_on_hand is not null and q.captured_at < ${end.at}::timestamptz
      order by q.captured_at asc limit 1`))[0];
  }
  if (!start) {
    return { available: false, periodEnd: end.at,
      note: "Only one QuickBooks snapshot exists — a second is needed. It populates as snapshot history accrues (now capturing 3x/day)." };
  }
  const spanDays = Math.round((Date.parse(end.at) - Date.parse(start.at)) / 86_400_000);

  const gaps: string[] = [];
  if (spanShort) gaps.push(`Snapshot history (~${spanDays}d) is shorter than the requested ${periodDays}d — using the widest available span. Net income is QuickBooks' trailing ~30-day P&L, which does not align to this span, so the operating figure is DIRECTIONAL only until ≥30 days of history accrues.`);
  const delta = (e: number | null, s: number | null) => (e != null && s != null ? r2(e - s) : null);
  const dAR = delta(num(end.ar), num(start.ar));
  const dAP = delta(num(end.ap), num(start.ap));
  const dInv = delta(num(end.inv), num(start.inv));
  const ni = num(end.ni);
  if (dInv == null) gaps.push("ΔInventory unavailable — QB inventory not captured on the start snapshot (populates once two snapshots both carry it).");
  if (ni == null) gaps.push("Net income missing on the latest snapshot.");
  gaps.push("D&A (non-cash add-back), capex (investing), and debt draws/paydowns (financing) are NOT captured — the unreconciled gap below equals those missing items combined.");

  // Indirect operating CF (PARTIAL): NI − ΔAR + ΔAP − ΔInventory. (↑AR/↑Inv use cash; ↑AP is a source.)
  const operating = r2((ni ?? 0) - (dAR ?? 0) + (dAP ?? 0) - (dInv ?? 0));
  const actualCashChange = r2((num(end.cash) ?? 0) - (num(start.cash) ?? 0));
  const unreconciledGap = r2(actualCashChange - operating);

  return {
    available: true,
    method: "indirect (partial)",
    periodStart: start.at, periodEnd: end.at, spanDays,
    netIncome: ni,
    operatingAdjustments: { deltaAR: dAR, deltaAP: dAP, deltaInventory: dInv },
    operatingCashFlowPartial: operating,
    actualCashChange,
    unreconciledGap,
    reconciles: false, // by construction — D&A/capex/financing not captured
    gaps,
    source: "operational_estimate", authoritative: "quickbooks",
    note: "Indirect method, PARTIAL. Operating section from net income ± ΔAR/ΔAP/ΔInventory only. D&A, capex (investing) and financing are not captured, so this does NOT reconcile to the actual change in cash — the unreconciledGap is those missing items. QuickBooks' Statement of Cash Flows is authoritative; the app reports and flags, it never posts entries.",
  };
}
