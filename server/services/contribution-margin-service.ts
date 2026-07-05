/**
 * C6 — Contribution-margin keystone.
 *
 * Until Jul 2026 "contribution margin" everywhere was `revenue × 0.6` — a
 * hardcoded guess that GATED SCALE/HOLD/PAUSE. This service computes the real
 * thing from the order ledger:
 *
 *   contribution = net revenue − real COGS − channel fees
 *
 * - net revenue: order lines (qty − returned) × unit price, CANCELLED/REFUNDED
 *   excluded (matches every other revenue surface's status filter).
 * - real COGS: items.wac_unit_cost → default_purchase_cost per line (95.8% of
 *   line revenue joins after the C5 backfill). The uncosted remainder uses the
 *   QB-validated COGS plug (34–35% measured) — NEVER the legacy 40%-of-price
 *   guess baked into the old 0.6.
 * - channel fees: PAYOUT_CONFIG rates (Amazon referral 15%, Shopify 2.9%) by
 *   order channel — the same rates the expected-payouts engine settles on.
 * - freight: NOT included (outbound shipping is not captured per order — 3PL
 *   side). Reported as an explicit dataGap so the number never pretends to be
 *   more complete than it is.
 *
 * Pure math is exported and unit-tested; the DB read is memoized (60s) like
 * the canonical spend engine so every consumer sees the same figure.
 */
import { sql } from "drizzle-orm";
import { PAYOUT_CONFIG } from "./expected-payouts-service";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** QB-validated COGS plug (Dec-2025 write-down analysis measured 34–35% as a RATE).
 *  Used ONLY for the uncosted revenue remainder — never for costed lines. */
export const COGS_PLUG_RATE = 0.35;

/** Channel fee rate for an order channel, from the payout engine's config. */
export function channelFeePct(channel: string | null | undefined): number {
  const c = String(channel || "").toUpperCase();
  if (c === "AMAZON") return PAYOUT_CONFIG.amazon.feePct;
  if (c === "SHOPIFY") return PAYOUT_CONFIG.shopify.feePct;
  return 0; // DIRECT / GHL / OTHER — no marketplace fee
}

export interface OrderContributionInput {
  grossRevenue: number;
  refundedAmount?: number | null;
  cogs: number;
  channelFeePct?: number | null;
}
export interface OrderContribution {
  netRevenue: number;
  cogs: number;
  channelFees: number;
  contributionMargin: number;
  contributionMarginPct: number | null; // null when net revenue is 0
  status: "healthy" | "marginal" | "negative";
}

/** Pure: one order's contribution. Unit-tested. */
export function computeOrderContributionMargin(m: OrderContributionInput): OrderContribution {
  const netRevenue = r2(Math.max(0, num(m.grossRevenue) - num(m.refundedAmount)));
  const fees = r2(netRevenue * Math.min(Math.max(num(m.channelFeePct), 0), 1));
  const cogs = r2(Math.max(0, num(m.cogs)));
  const contributionMargin = r2(netRevenue - cogs - fees);
  const pct = netRevenue > 0 ? r4(contributionMargin / netRevenue) : null;
  return {
    netRevenue,
    cogs,
    channelFees: fees,
    contributionMargin,
    contributionMarginPct: pct,
    status: contributionMargin < 0 ? "negative" : pct != null && pct < 0.3 ? "marginal" : "healthy",
  };
}

/** Pure: the MER at which contribution covers ad spend — revenue×margin ≥ spend
 *  ⇔ MER ≥ 1/margin. The honest counterpart to a static breakeven constant.
 *  Unit-tested. */
export function impliedBreakevenMer(contributionMarginPct: number | null): number | null {
  if (contributionMarginPct == null || !(contributionMarginPct > 0)) return null;
  return r2(1 / contributionMarginPct);
}

export interface BlendedContribution {
  windowDays: number;
  revenue: number;            // net line revenue in window
  cogs: number;               // costed + plug
  cogsCosted: number;         // from real WAC/purchase cost
  cogsPlug: number;           // uncosted remainder × COGS_PLUG_RATE
  channelFees: number;
  channelFeesAmazon: number;  // referral — netted from Amazon deposits, NEVER in QB OpEx
  channelFeesShopify: number; // processing — booked in QB OpEx as "Merchant Account Fees"
  contributionMargin: number;
  contributionMarginPct: number | null;
  grossMarginPct: number | null;   // before channel fees (comparability with the old 0.6)
  costedRevenueShare: number | null; // how much of revenue has REAL costs (0..1)
  impliedBreakevenMer: number | null;
  runwayMarginRate: number | null; // see composeRunwayMarginRate
  dataGaps: string[];
}

/**
 * Pure: the margin rate the RUNWAY burn model needs. The runway multiplies this
 * against ORDER-VALUE revenue while separately subtracting QB operating expenses
 * as overhead — and fee placement differs by channel (verified Jul 2026 in
 * qb_pl_detail): Shopify processing IS booked in QB OpEx ("Merchant Account
 * Fees" ~$9.5K/90d) so it must NOT also come out of margin (double-count), while
 * Amazon's ~15% referral is netted from deposits and never appears in OpEx
 * ("Amazon Selling Fees" only $840/90d) so it MUST come out of margin — order-
 * value revenue includes money Amazon keeps. Hence: (rev − COGS − amazonFees)/rev.
 * Unit-tested.
 */
export function composeRunwayMarginRate(
  revenue: number,
  cogs: number,
  amazonFees: number,
): number | null {
  if (!(revenue > 0)) return null;
  return r4((revenue - num(cogs) - num(amazonFees)) / revenue);
}

let memo: { at: number; days: number; value: BlendedContribution } | null = null;

/**
 * Blended contribution margin over a trailing window, straight from the order
 * ledger. This is THE margin feed for the directive engine / breakeven surfaces
 * (replacing revenue×0.6). Memoized 60s.
 */
export async function getBlendedContributionMargin(db: any, days = 30): Promise<BlendedContribution> {
  if (memo && memo.days === days && Date.now() - memo.at < 60_000) return memo.value;

  const row = rows(await db.execute(sql`
    WITH lines AS (
      SELECT upper(coalesce(o.channel,'')) AS channel,
             greatest(l.qty_ordered - coalesce(l.returned_qty, 0), 0) AS net_qty,
             coalesce(l.unit_price, 0) AS unit_price,
             coalesce(i.wac_unit_cost, i.default_purchase_cost) AS unit_cost
      FROM sales_order_lines l
      JOIN sales_orders o ON o.id = l.sales_order_id
      LEFT JOIN items i ON i.id = l.product_id
      WHERE o.order_date >= current_date - make_interval(days => ${days})
        AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','REFUNDED')
    )
    SELECT
      coalesce(sum(net_qty * unit_price), 0)                                            AS revenue,
      coalesce(sum(net_qty * unit_price) FILTER (WHERE unit_cost IS NOT NULL), 0)       AS costed_revenue,
      coalesce(sum(net_qty * unit_cost)  FILTER (WHERE unit_cost IS NOT NULL), 0)       AS costed_cogs,
      coalesce(sum(net_qty * unit_price) FILTER (WHERE channel = 'AMAZON'), 0)          AS amazon_revenue,
      coalesce(sum(net_qty * unit_price) FILTER (WHERE channel = 'SHOPIFY'), 0)         AS shopify_revenue
    FROM lines`))[0] ?? {};

  const revenue = num(row.revenue);
  const costedRevenue = num(row.costed_revenue);
  const cogsCosted = num(row.costed_cogs);
  const uncostedRevenue = Math.max(0, revenue - costedRevenue);
  const cogsPlug = r2(uncostedRevenue * COGS_PLUG_RATE);
  const cogs = r2(cogsCosted + cogsPlug);
  const channelFeesAmazon = r2(num(row.amazon_revenue) * PAYOUT_CONFIG.amazon.feePct);
  const channelFeesShopify = r2(num(row.shopify_revenue) * PAYOUT_CONFIG.shopify.feePct);
  const channelFees = r2(channelFeesAmazon + channelFeesShopify);
  const contributionMargin = r2(revenue - cogs - channelFees);
  const contributionMarginPct = revenue > 0 ? r4(contributionMargin / revenue) : null;
  const grossMarginPct = revenue > 0 ? r4((revenue - cogs) / revenue) : null;
  const costedRevenueShare = revenue > 0 ? r4(costedRevenue / revenue) : null;

  const dataGaps: string[] = [
    "outbound freight is not captured per order (3PL side) — contribution is overstated by the per-order shipping share",
  ];
  if (costedRevenueShare != null && costedRevenueShare < 0.9) {
    dataGaps.push(
      `only ${(costedRevenueShare * 100).toFixed(1)}% of window revenue has real item costs — the rest uses the ${COGS_PLUG_RATE * 100}% QB COGS plug`,
    );
  }
  if (revenue <= 0) dataGaps.push("no order-line revenue in the window — margin unavailable");

  const value: BlendedContribution = {
    windowDays: days,
    revenue: r2(revenue),
    cogs,
    cogsCosted: r2(cogsCosted),
    cogsPlug,
    channelFees,
    channelFeesAmazon,
    channelFeesShopify,
    contributionMargin,
    contributionMarginPct,
    grossMarginPct,
    costedRevenueShare,
    impliedBreakevenMer: impliedBreakevenMer(contributionMarginPct),
    runwayMarginRate: composeRunwayMarginRate(revenue, cogs, channelFeesAmazon),
    dataGaps,
  };
  memo = { at: Date.now(), days, value };
  return value;
}
