/**
 * Green Line L5 — Marketing Governor (recommend-only spend authority).
 *
 * Green-lights a marketing budget INCREASE only when ALL hold:
 *   - blended MER (QB spend basis, never the platform feed) > breakeven (5x)
 *   - cash on hand above a floor
 *   - ad/sales data is fresh
 *   - the September Rule is not firing (Google ROAS <8x for 5+ straight days)
 *
 * It recommends a posture (ALLOW_SCALE / HOLD / BLOCK). It never moves budget.
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export const BREAKEVEN_MER = 5.0;
export const CASH_FLOOR = 60000;
export const SEPTEMBER_ROAS = 8;
export const SEPTEMBER_THRESHOLD = 5; // consecutive days <8x that block Google increases
export const FRESH_DAYS = 3;

export type GovernorState = "ALLOW_SCALE" | "HOLD" | "BLOCK";

export interface GovernorInput {
  blendedMer: number | null;
  breakeven: number;
  cashOnHand: number | null;
  cashFloor: number;
  septemberStreak: number; // consecutive Google days <8x
  septemberThreshold: number;
  dataFresh: boolean;
}

/**
 * Pure verdict. BLOCK is a hard stop (stale data or September Rule). HOLD means
 * "do not scale" (below breakeven or cash too low). ALLOW_SCALE only when clear.
 */
export function governorVerdict(i: GovernorInput): { state: GovernorState; reasons: string[] } {
  const reasons: string[] = [];
  const septemberTriggered = i.septemberStreak >= i.septemberThreshold;
  const cashOk = i.cashOnHand != null && i.cashOnHand >= i.cashFloor;
  const merOk = i.blendedMer != null && i.blendedMer > i.breakeven;

  if (!i.dataFresh) reasons.push("Ad/sales data is stale — reconnect feeds before any auto-decision");
  if (septemberTriggered)
    reasons.push(`September Rule: Google ROAS below ${SEPTEMBER_ROAS}x for ${i.septemberStreak} straight days — increases blocked`);
  if (!merOk)
    reasons.push(
      i.blendedMer == null ? "Blended MER unavailable" : `Blended MER ${i.blendedMer.toFixed(2)}x below ${i.breakeven.toFixed(1)}x breakeven`,
    );
  if (!cashOk)
    reasons.push(
      i.cashOnHand == null ? "Cash on hand unavailable" : `Cash $${Math.round(i.cashOnHand).toLocaleString()} below $${Math.round(i.cashFloor).toLocaleString()} floor`,
    );

  let state: GovernorState;
  if (!i.dataFresh || septemberTriggered) state = "BLOCK";
  else if (!merOk || !cashOk) state = "HOLD";
  else state = "ALLOW_SCALE";
  if (state === "ALLOW_SCALE") reasons.push("MER above breakeven, cash above floor, data fresh — scaling authorized");
  return { state, reasons };
}

export interface GovernorResult {
  state: GovernorState;
  reasons: string[];
  blendedMer: number | null;
  breakeven: number;
  qbMarketing30d: number;
  netRevenue30d: number;
  cashOnHand: number | null;
  cashFloor: number;
  septemberStreak: number;
  septemberTriggered: boolean;
  dataFresh: boolean;
  adDataLatest: string | null;
}

export async function computeGovernor(db: DB): Promise<GovernorResult> {
  const mkt = num(rows(await db.execute(sql`
    select coalesce(sum(amount),0) as v from qb_pl_detail
    where account_name='Advertising & Marketing' and txn_date >= (current_date - 30)`))[0]?.v);
  const netRev = num(rows(await db.execute(sql`
    select coalesce(sum(net_revenue),0) as v from daily_sales_snapshots where date >= (current_date - 30)`))[0]?.v);
  const blendedMer = mkt > 0 ? r2(netRev / mkt) : null;

  const cashRow = rows(await db.execute(sql`
    select cash_on_hand from qb_financial_snapshots where cash_on_hand is not null
    order by captured_at desc limit 1`))[0];
  const qbCash = cashRow?.cash_on_hand != null ? num(cashRow.cash_on_hand) : null;
  // Prefer the operator-entered bank-confirmed balance over the lagging QB ledger — the spend
  // gate must judge the cash floor against REAL bank cash, not a QB number that lags by ~$26K
  // (which would false-block ad spend). Falls back to QB when no fresh bank entry exists.
  const { getBankConfirmedOverride } = await import("./cash-flow-service");
  const bankOv = await getBankConfirmedOverride(db).catch(() => null);
  const cashOnHand = bankOv ? bankOv.cashOnHand : qbCash;

  // September Rule: consecutive most-recent Google days with ROAS < 8x.
  // Scope to the per-campaign '_windsor' grain only. ad_metrics_daily stores the
  // same Google spend at overlapping grains (account/product SKUs + _windsor),
  // so summing across all of them double-counts spend and mixes attribution
  // fields — the canonical analytics query dedups the same way.
  const gRows = rows(await db.execute(sql`
    select date::text as d, (sum(revenue)/nullif(sum(spend),0)) as roas
    from ad_metrics_daily where platform ilike '%google%' and spend > 0 and sku = '_windsor'
    group by date order by date desc limit 60`));
  let septemberStreak = 0;
  for (const g of gRows) {
    const roas = g.roas == null ? null : num(g.roas);
    if (roas != null && roas < SEPTEMBER_ROAS) septemberStreak++;
    else break;
  }

  const freshRow = rows(await db.execute(sql`
    select max(date)::text as latest, (current_date - max(date)) as age_days from ad_metrics_daily`))[0];
  const adDataLatest = freshRow?.latest ?? null;
  const dataFresh = freshRow?.age_days != null && num(freshRow.age_days) <= FRESH_DAYS;

  const { state, reasons } = governorVerdict({
    blendedMer, breakeven: BREAKEVEN_MER, cashOnHand, cashFloor: CASH_FLOOR,
    septemberStreak, septemberThreshold: SEPTEMBER_THRESHOLD, dataFresh,
  });

  return {
    state, reasons, blendedMer, breakeven: BREAKEVEN_MER,
    qbMarketing30d: Math.round(mkt), netRevenue30d: Math.round(netRev),
    cashOnHand: cashOnHand != null ? Math.round(cashOnHand) : null, cashFloor: CASH_FLOOR,
    septemberStreak, septemberTriggered: septemberStreak >= SEPTEMBER_THRESHOLD, dataFresh, adDataLatest,
  };
}
