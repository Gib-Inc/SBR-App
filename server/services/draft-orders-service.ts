/**
 * CIPH.R Finances — LIVE Shopify draft orders (SBR's B2B/wholesale quote pipeline).
 *
 * Draft orders are #D-numbered orders created in the Shopify admin that haven't
 * been converted/paid yet — wholesale quotes, phone/B2B orders, manual invoices.
 * They are NOT in the app's sales_orders table (those are completed orders only),
 * so this fetches them live from Shopify. Requires the read_draft_orders scope;
 * degrades gracefully to a "needs scope" state (mirrors the payouts card) so the
 * tile never errors.
 *
 * The headline is the OPEN PIPELINE — total $ sitting in open quotes, pending
 * revenue not yet closed. The daily bars mirror the sales cards: drafts CREATED
 * each day this month (store-local), so you can see how fast new quotes come in.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { ShopifyClient } from "./shopify-client";

const rows = (r: any) => r.rows || r;
const r2 = (n: number) => Math.round(n * 100) / 100;
const DENVER = "America/Denver";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface DraftOrder { name: string; status: string; createdAt: string; updatedAt: string; totalPrice: number; currency: string; }
export interface DraftDay { date: string; count: number; totalSales: number; }
export interface DraftOrdersView {
  available: boolean;
  reason?: string;
  source: string;
  periodLabel: string;
  refreshedAt: string;
  currency: string;
  pipeline: { count: number; totalValue: number; avgValue: number; oldestOpenDays: number | null };
  createdThisMonth: { count: number; totalValue: number };
  daily: DraftDay[];
  bestDay: { date: string; totalSales: number } | null;
  truncated?: boolean;
  message?: string;
}

// UTC ms → store-local YYYY-MM-DD (en-CA renders ISO-style date parts).
function denverYMD(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DENVER, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function denverYMDfromISO(iso: string): string {
  const t = Date.parse(iso);
  return isFinite(t) ? denverYMD(t) : "";
}
function denverClock(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: DENVER, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ms));
}

/**
 * Pure: summarize a list of OPEN draft orders into the pipeline + this-month
 * daily-created view. nowMs is injectable for tests.
 */
export function summarizeDraftOrders(drafts: DraftOrder[], nowMs: number): Omit<DraftOrdersView, "available" | "reason" | "message"> {
  const nowYMD = denverYMD(nowMs);
  const [yr, mo, dom] = nowYMD.split("-");
  const monthPrefix = `${yr}-${mo}`;
  const monthName = MON[(parseInt(mo, 10) || 1) - 1];
  const periodLabel = `${monthName} 1–${parseInt(dom, 10)}, ${yr}`;

  // Open pipeline = every open draft, regardless of when it was created.
  const count = drafts.length;
  const totalValue = r2(drafts.reduce((s, d) => s + (d.totalPrice || 0), 0));
  const avgValue = count > 0 ? r2(totalValue / count) : 0;
  let oldestMs: number | null = null;
  for (const d of drafts) {
    const t = Date.parse(d.createdAt);
    if (isFinite(t) && (oldestMs == null || t < oldestMs)) oldestMs = t;
  }
  const oldestOpenDays = oldestMs == null ? null : Math.max(0, Math.floor((nowMs - oldestMs) / 86400000));

  // Created this month, grouped by store-local day.
  const dayMap = new Map<string, { count: number; total: number }>();
  let monthCount = 0;
  let monthTotal = 0;
  for (const d of drafts) {
    const ymd = denverYMDfromISO(d.createdAt);
    if (!ymd.startsWith(monthPrefix)) continue;
    monthCount += 1;
    monthTotal += d.totalPrice || 0;
    const cur = dayMap.get(ymd) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += d.totalPrice || 0;
    dayMap.set(ymd, cur);
  }
  const daily: DraftDay[] = Array.from(dayMap.entries())
    .map(([date, v]) => ({ date, count: v.count, totalSales: r2(v.total) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const bestDay = daily.length
    ? daily.reduce((a, b) => (b.totalSales > a.totalSales ? b : a))
    : null;

  return {
    source: "Live — Shopify draft orders (B2B pipeline)",
    periodLabel,
    refreshedAt: denverClock(nowMs),
    currency: drafts[0]?.currency || "USD",
    pipeline: { count, totalValue, avgValue, oldestOpenDays },
    createdThisMonth: { count: monthCount, totalValue: r2(monthTotal) },
    daily,
    bestDay: bestDay ? { date: bestDay.date, totalSales: bestDay.totalSales } : null,
  };
}

/** Resolve Shopify creds (enabled integration config, else env), like the payouts service. */
async function resolveShopifyClient(): Promise<ShopifyClient | null> {
  const cfg = rows(await db.execute(sql`
    SELECT api_key, config->>'shopDomain' AS shop_domain, config->>'apiVersion' AS api_version
    FROM integration_configs
    WHERE provider='SHOPIFY' AND COALESCE(is_enabled, true) = true
    ORDER BY last_sync_at DESC NULLS LAST LIMIT 1`))[0];
  const apiKey = cfg?.api_key || process.env.SHOPIFY_ADMIN_API_KEY || process.env.SHOPIFY_ACCESS_TOKEN;
  const shopDomain = cfg?.shop_domain || process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE_URL;
  const apiVersion = cfg?.api_version || "2024-01";
  if (!apiKey || !shopDomain) return null;
  return new ShopifyClient(shopDomain, apiKey, apiVersion);
}

/** Live: fetch open draft orders and summarize. Degrades gracefully on missing scope. */
export async function getDraftOrders(nowMs: number): Promise<DraftOrdersView> {
  const empty = summarizeDraftOrders([], nowMs);
  const client = await resolveShopifyClient();
  if (!client) {
    return { ...empty, available: false, reason: "not_configured", message: "Shopify is not connected, so draft orders can't be read yet." };
  }
  let res: any;
  try {
    res = await client.fetchOpenDraftOrders();
  } catch (e: any) {
    return { ...empty, available: false, reason: e?.message ?? "error", message: "Could not reach Shopify for draft orders." };
  }
  if (!res.available) {
    const message =
      res.reason === "missing_draft_scope"
        ? "Draft orders need the read_draft_orders scope on the Shopify app token."
        : res.reason === "invalid_token"
          ? "Shopify auth failed — the Admin API token may be revoked or expired. Reconnect Shopify."
          : `Could not load draft orders (${res.reason}).`;
    return { ...empty, available: false, reason: res.reason, message };
  }
  return { ...summarizeDraftOrders(res.drafts, nowMs), available: true, truncated: res.truncated === true };
}
