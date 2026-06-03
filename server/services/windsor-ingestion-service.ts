/**
 * Windsor ingestion service — pulls the unified Windsor.ai feed and upserts it
 * into ad_metrics_daily (the normalized fact table the whole Marketing
 * Analytics query layer reads from).
 *
 * Aggregation grain: platform + sku + date. SKU resolves to the Google
 * Shopping product_item_id when Windsor provides it; otherwise rows roll up to
 * the sentinel SKU 'ACCOUNT' so platform-level totals (channel mix, spend
 * pacing, monthly ad spend, blended ROAS) are correct immediately even before
 * per-SKU mapping is complete.
 *
 * The API key is read from the WINDSOR integration_config (per user) with an
 * env-var fallback (WINDSOR_API_KEY) so it works in both the UI-configured and
 * env-configured cases.
 */

import { storage } from "../storage";
import { fetchWindsorRows, normalizePlatform, type WindsorRow } from "./windsor-client";
import type { InsertAdMetricsDaily } from "@shared/schema";

const ACCOUNT_SKU = "ACCOUNT";

function normalizeDevice(d: string | undefined): string {
  if (!d) return "_all";
  const s = d.toLowerCase().trim();
  if (s.includes("mobile") || s.includes("phone")) return "mobile";
  if (s.includes("desktop") || s.includes("computer")) return "desktop";
  if (s.includes("tablet")) return "tablet";
  if (s === "(not set)" || s === "not set") return "_all";
  return s || "_all";
}

function num(...vals: unknown[]): number {
  for (const v of vals) {
    if (v == null) continue;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface WindsorSyncResult {
  success: boolean;
  rowsFetched: number;
  rowsUpserted: number;
  platforms: Record<string, number>; // platform -> upserted count
  errors: string[];
}

/**
 * Resolve the Windsor API key for a user: UI-configured integration_config
 * first, then env fallback.
 */
export async function getWindsorApiKey(userId: string): Promise<string | null> {
  try {
    const cfg = await storage.getIntegrationConfig(userId, "WINDSOR");
    if (cfg?.apiKey && cfg.isEnabled !== false) return cfg.apiKey;
  } catch {
    // integration_configs may not have a WINDSOR row yet — fall through to env.
  }
  return process.env.WINDSOR_API_KEY || null;
}

/**
 * Aggregate raw Windsor rows by platform+sku+date, summing the metrics.
 * Windsor returns one row per source/campaign/day (and per product for
 * Shopping), so multiple rows can collapse into one ad_metrics_daily row.
 */
function aggregate(rows: WindsorRow[]): Map<string, InsertAdMetricsDaily> {
  const out = new Map<string, InsertAdMetricsDaily>();

  for (const r of rows) {
    const platform = normalizePlatform(r.source);
    if (!platform) continue;
    const date = (r.date || "").slice(0, 10);
    if (!date) continue;
    // Skip rows with zero spend — organic/referral traffic, not paid ads
    if (num(r.spend) <= 0) continue;

    const sku = (r.product_item_id && String(r.product_item_id).trim()) || ACCOUNT_SKU;
    const campaign = (r.campaign && String(r.campaign).trim()) || "_all";
    const device = normalizeDevice(r.device);
    const country = (r.country && String(r.country).trim().toUpperCase()) || "_all";
    const key = `${platform}|${sku}|${date}|${campaign}|${device}|${country}`;

    const existing = out.get(key);
    const impressions = num(r.impressions);
    const clicks = num(r.clicks);
    const spend = num(r.spend);
    const conversions = num(r.conversions);
    const revenue = num(r.total_conversion_value, r.conversion_value, r.revenue);
    const currency = (r.currency && String(r.currency)) || "USD";

    if (existing) {
      existing.impressions = (existing.impressions ?? 0) + Math.round(impressions);
      existing.clicks = (existing.clicks ?? 0) + Math.round(clicks);
      existing.spend = (existing.spend ?? 0) + spend;
      existing.conversions = (existing.conversions ?? 0) + Math.round(conversions);
      existing.revenue = (existing.revenue ?? 0) + revenue;
    } else {
      out.set(key, {
        platform,
        sku,
        date,
        campaign,
        device,
        country,
        impressions: Math.round(impressions),
        clicks: Math.round(clicks),
        spend,
        conversions: Math.round(conversions),
        revenue,
        currency,
      });
    }
  }

  return out;
}

/**
 * Run a Windsor sync for one user over the trailing `days` window (default 30).
 */
export async function runWindsorSync(userId: string, days = 30): Promise<WindsorSyncResult> {
  const result: WindsorSyncResult = {
    success: false,
    rowsFetched: 0,
    rowsUpserted: 0,
    platforms: {},
    errors: [],
  };

  const apiKey = await getWindsorApiKey(userId);
  if (!apiKey) {
    result.errors.push("No Windsor API key. Add it in Settings > Integrations (WINDSOR) or set WINDSOR_API_KEY.");
    return result;
  }

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  let rows: WindsorRow[];
  try {
    rows = await fetchWindsorRows({ apiKey, dateFrom: isoDate(from), dateTo: isoDate(to) });
  } catch (e: any) {
    result.errors.push(e?.message ?? String(e));
    return result;
  }

  result.rowsFetched = rows.length;
  const aggregated = aggregate(rows);

  for (const metrics of aggregated.values()) {
    try {
      await storage.upsertAdMetricsDaily(metrics);
      result.rowsUpserted++;
      result.platforms[metrics.platform] = (result.platforms[metrics.platform] ?? 0) + 1;
    } catch (e: any) {
      result.errors.push(`${metrics.platform}/${metrics.sku}/${metrics.date}: ${e?.message ?? e}`);
    }
  }

  // Record sync state on the integration config (best-effort).
  try {
    const cfg = await storage.getIntegrationConfig(userId, "WINDSOR");
    if (cfg) {
      await storage.updateIntegrationConfig(cfg.id, {
        lastSyncAt: new Date(),
        lastSyncStatus: result.errors.length > 0 ? "PARTIAL" : "SUCCESS",
        lastSyncMessage: `Fetched ${result.rowsFetched}, upserted ${result.rowsUpserted} across ${Object.keys(result.platforms).join(", ") || "no platforms"}`,
      });
    }
  } catch {
    // non-fatal
  }

  result.success = result.errors.length === 0;
  return result;
}
