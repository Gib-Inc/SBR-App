/**
 * CIPH.R Shopify cash-on-the-way. Tries the Shopify Payments balance + in-transit
 * payouts (needs the read_shopify_payments scope); always also computes a sales-
 * based estimate from the app's own recent Shopify orders, so the tile shows a
 * number even before the scope is granted. Upgrades to the exact figure once it is.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { ShopifyClient } from "./shopify-client";

const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);

const FEE_RATE = 0.029; // ~Shopify Payments processing fee
const ESTIMATE_DAYS = 3; // Shopify pays out on a ~2-3 business-day rolling basis

export interface ShopifyCash {
  available: boolean;          // true = exact figure from Shopify Payments
  reason?: string;             // why exact is unavailable
  total: number | null;        // exact total on the way (balance + in transit)
  balance?: number;
  inTransit?: number;
  currency?: string;
  nextPayoutDate?: string | null;
  estimate: number;            // always present — recent Shopify sales net of fees
  estimateBasis: { days: number; grossSales: number; orders: number; feeRate: number };
}

export async function getShopifyCashOnTheWay(): Promise<ShopifyCash> {
  // Estimate from the app's own recent Shopify orders (always available).
  const est = rows(await db.execute(sql`
    SELECT COALESCE(sum(total_amount),0)::float8 AS gross, count(*)::int AS orders
    FROM sales_orders
    WHERE channel = 'SHOPIFY'
      AND COALESCE(status,'') NOT IN ('CANCELLED','cancelled','canceled','REFUNDED')
      AND order_date >= current_date - (${ESTIMATE_DAYS} || ' days')::interval`))[0] || {};
  const estGross = num(est.gross);
  const estimate = Math.round(estGross * (1 - FEE_RATE) * 100) / 100;
  const estimateBasis = { days: ESTIMATE_DAYS, grossSales: Math.round(estGross), orders: num(est.orders), feeRate: FEE_RATE };

  // Resolve Shopify creds (enabled integration config, else env).
  const cfg = rows(await db.execute(sql`
    SELECT api_key, config->>'shopDomain' AS shop_domain, config->>'apiVersion' AS api_version
    FROM integration_configs
    WHERE provider='SHOPIFY' AND COALESCE(is_enabled, true) = true
    ORDER BY last_sync_at DESC NULLS LAST LIMIT 1`))[0];
  const apiKey = cfg?.api_key || process.env.SHOPIFY_ADMIN_API_KEY || process.env.SHOPIFY_ACCESS_TOKEN;
  const shopDomain = cfg?.shop_domain || process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE_URL;
  const apiVersion = cfg?.api_version || "2024-01";

  let exact: any = { available: false, reason: "not_configured" };
  if (apiKey && shopDomain) {
    try {
      const client = new ShopifyClient(shopDomain, apiKey, apiVersion);
      exact = await client.fetchPayoutSummary();
    } catch (e: any) {
      exact = { available: false, reason: e?.message ?? "error" };
    }
  }

  if (exact.available) {
    return {
      available: true, total: exact.total, balance: exact.balance, inTransit: exact.inTransit,
      currency: exact.currency, nextPayoutDate: exact.nextPayoutDate, estimate, estimateBasis,
    };
  }
  return { available: false, reason: exact.reason, total: null, estimate, estimateBasis };
}
