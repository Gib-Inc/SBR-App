/**
 * Expected Channel Payouts — "money on its way" from Shopify + Amazon, derived
 * from REAL (deduplicated) sales × each channel's settlement timing, net of
 * marketplace fees.
 *
 * WHY THIS EXISTS: QuickBooks A/R for the marketplaces is an accountant ACCRUAL
 * (a single monthly "Amazon - Customer" journal entry), not a granular payout
 * feed — it read ~2x the real Amazon pipeline (~$102K vs the true ~$50K). This
 * service derives the payout pipeline from the order data the app already trusts
 * so the runway can count near-cash that actually lands within days.
 *
 * ESTIMATE, NOT A FEED (yet): until the Shopify Payments scope (read_shopify_
 * payments) and the Amazon SP-API settlement report are connected, these are
 * sales-derived ESTIMATES: grossWindow × (1 − fee). The fee/settlement constants
 * are conservative and tunable below. When the real payout APIs are wired, swap
 * computeExpectedPayouts' query for the settlement balances and keep this shape.
 *
 * HOT PATH: this is DB-only (no external API call) on purpose — getCashPosition
 * runs it on every cash-flow read. The exact Shopify Payments balance lives in
 * the separate shopify-payouts-service (which does hit the Shopify API).
 *
 * Pure helpers (estimateNetPayout / buildExpectedPayouts / inboundWithinDays)
 * are unit-tested in expected-payouts-service.test.ts (no DB).
 */
import { sql } from "drizzle-orm";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const isNum = (v: unknown): v is number => v != null && typeof v === "number" && !Number.isNaN(v);

export type PayoutChannel = "amazon" | "shopify";

export interface ChannelPayout {
  channel: PayoutChannel;
  grossWindow: number;    // gross sales in the settlement window (real, deduped)
  feePct: number;         // marketplace fee fraction applied
  settlementDays: number; // typical hold before this channel pays out
  netExpected: number;    // grossWindow × (1 − feePct), rounded; near-cash on its way
}

export interface ExpectedPayouts {
  amazon: ChannelPayout;
  shopify: ChannelPayout;
  totalNetExpected: number;
  asOf: string;
  /** "sales-estimate" until a real settlement feed (Shopify Payments / Amazon SP-API) is wired. */
  basis: "sales-estimate";
}

// Tunable. Amazon referral ~15% (lawn/garden; FBM rollers carry no FBA fee);
// biweekly disbursement so ~14-day hold. Shopify Payments ~2.9% + 30¢ ≈ 3%;
// rolling ~3 business-day payout. Kept consistent with shopify-payouts-service.
// skimPct = Shopify Capital's merchant-loan daily remittance withheld from every
// payout BEFORE cash reaches the operating account (17% per the Dec 2025 Merchant
// Loan Agreements; SBR's Apr 2026 reduction request was not confirmed granted).
// Cash truth: deposits arrive net of this skim, so payout estimates must net it
// too — and the Shopify Capital facility is then EXCLUDED from debt outflows by
// consumers (cash-forecast-service) so the same skim is never counted twice.
export const PAYOUT_CONFIG: Record<PayoutChannel, { feePct: number; settlementDays: number; skimPct: number }> = {
  amazon: { feePct: 0.15, settlementDays: 14, skimPct: 0 },
  shopify: { feePct: 0.029, settlementDays: 3, skimPct: 0.17 },
};

/** Pure: net payout from a gross window, fee, and payout-withheld skim (MCA
 *  remittance taken off the top). Non-positive/NaN gross → 0. */
export function estimateNetPayout(grossWindow: number, feePct: number, skimPct = 0): number {
  if (!isNum(grossWindow) || grossWindow <= 0) return 0;
  const f = isNum(feePct) ? Math.min(Math.max(feePct, 0), 1) : 0;
  const k = isNum(skimPct) ? Math.min(Math.max(skimPct, 0), 1) : 0;
  return r2(grossWindow * Math.max(0, 1 - f - k));
}

/** Pure: assemble ExpectedPayouts from the two channel gross windows. */
export function buildExpectedPayouts(input: {
  amazonGross: number;
  shopifyGross: number;
  asOf: string;
}): ExpectedPayouts {
  const a = PAYOUT_CONFIG.amazon;
  const s = PAYOUT_CONFIG.shopify;
  const amazon: ChannelPayout = {
    channel: "amazon",
    grossWindow: r2(Math.max(0, num(input.amazonGross))),
    feePct: a.feePct,
    settlementDays: a.settlementDays,
    netExpected: estimateNetPayout(input.amazonGross, a.feePct, a.skimPct),
  };
  const shopify: ChannelPayout = {
    channel: "shopify",
    grossWindow: r2(Math.max(0, num(input.shopifyGross))),
    feePct: s.feePct,
    settlementDays: s.settlementDays,
    netExpected: estimateNetPayout(input.shopifyGross, s.feePct, s.skimPct),
  };
  return {
    amazon,
    shopify,
    totalNetExpected: r2(amazon.netExpected + shopify.netExpected),
    asOf: input.asOf,
    basis: "sales-estimate",
  };
}

/**
 * Pure: the portion of expected payouts that lands WITHIN `windowDays`, prorated
 * by each channel's settlement window. A 7-day window captures all of Shopify
 * (3-day hold) and ~half of Amazon (14-day hold). Used so a runway/forecast
 * window only counts the pipeline cash that actually arrives inside it — never
 * more than the full payout (capped at 1×).
 */
export function inboundWithinDays(p: ExpectedPayouts, windowDays: number): number {
  if (!isNum(windowDays) || windowDays <= 0) return 0;
  const prorate = (c: ChannelPayout) =>
    c.netExpected * Math.min(1, windowDays / Math.max(1, c.settlementDays));
  return r2(prorate(p.amazon) + prorate(p.shopify));
}

/**
 * DB (read-only): expected payouts from real deduped sales. Amazon = trailing
 * 14-day gross; Shopify = trailing 3-day gross; each netted by its fee. CANCELLED
 * / REFUNDED orders excluded (case-insensitive, matching shopify-payouts-service).
 */
export async function computeExpectedPayouts(db: any, asOf: string): Promise<ExpectedPayouts> {
  const grossFor = async (channel: string, days: number): Promise<number> => {
    const r = rows(
      await db.execute(sql`
        select coalesce(sum(sol.qty_ordered * coalesce(sol.unit_price, 0)), 0)::float8 as gross
        from sales_orders so
        join sales_order_lines sol on sol.sales_order_id = so.id
        where so.channel = ${channel}
          and upper(trim(coalesce(so.status, ''))) not in ('CANCELLED', 'CANCELED', 'REFUNDED')
          -- exactly N calendar dates ending on asOf (the in-transit settlement window);
          -- a lower bound of asOf-days would span days+1 dates and pull one extra day of
          -- gross, overstating the expected payout and the runway (audit #11).
          and so.order_date >= (${asOf}::date - ${days}::int + 1)
          and so.order_date < (${asOf}::date + 1)`),
    )[0];
    return num(r?.gross);
  };

  const amazonGross = await grossFor("AMAZON", PAYOUT_CONFIG.amazon.settlementDays);
  const shopifyGross = await grossFor("SHOPIFY", PAYOUT_CONFIG.shopify.settlementDays);
  return buildExpectedPayouts({ amazonGross, shopifyGross, asOf });
}
