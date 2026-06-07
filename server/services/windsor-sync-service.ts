/**
 * CIPH.R — Windsor.ai auto-sync (keeps the app's ad spend accurate & current).
 *
 * Windsor.ai aggregates the real ad spend from each platform's own API (Google
 * Ads, Amazon Ads, …). This service pulls it daily and writes per-platform
 * snapshots through the SAME reconciliation path as a manual upload (source
 * 'windsor:<connector>', which outranks the inflated live ad_metrics_daily feed
 * in the merge). Accumulates/supersedes; logs every decision.
 *
 * ⚙️  REQUIRES process.env.WINDSOR_API_KEY (Windsor dashboard → API → API key).
 *     Matt must add WINDSOR_API_KEY in Railway → SBR-App → Variables to enable
 *     this. Without it the sync is a clean no-op (logs once, never errors).
 */
import { storage } from "../storage";
import { hashMarketingSnapshot, reconcileMarketingSnapshot } from "./reconciliation-service";

const WINDSOR_BASE = "https://connectors.windsor.ai";

export interface WindsorRow { date?: string; spend?: number; clicks?: number; impressions?: number; [k: string]: any; }
export interface WindsorAgg { spend: number; clicks: number | null; impressions: number | null; periodStart: string | null; periodEnd: string | null; rowCount: number; }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Pure: sum spend (across one or more spend columns) + clicks/impressions and
 *  derive the period bounds from a set of daily Windsor rows. Unit-tested. */
export function aggregateWindsorRows(rows: WindsorRow[], spendKeys: string[] = ["spend"]): WindsorAgg {
  let spend = 0, clicks = 0, impressions = 0;
  let anyClick = false, anyImpr = false;
  const dates: string[] = [];
  for (const r of rows || []) {
    for (const k of spendKeys) { const v = Number(r[k]); if (!Number.isNaN(v)) spend += v; }
    if (r.clicks != null) { clicks += Number(r.clicks) || 0; anyClick = true; }
    if (r.impressions != null) { impressions += Number(r.impressions) || 0; anyImpr = true; }
    if (r.date) dates.push(String(r.date));
  }
  dates.sort();
  return {
    spend: r2(spend),
    clicks: anyClick ? clicks : null,
    impressions: anyImpr ? impressions : null,
    periodStart: dates[0] || null,
    periodEnd: dates[dates.length - 1] || null,
    rowCount: (rows || []).length,
  };
}

async function fetchWindsor(connector: string, fields: string[], apiKey: string): Promise<WindsorRow[]> {
  const url = `${WINDSOR_BASE}/${connector}?api_key=${encodeURIComponent(apiKey)}&date_preset=last_30d&fields=${fields.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Windsor ${connector} HTTP ${res.status}`);
  const json: any = await res.json();
  return Array.isArray(json?.data) ? json.data : Array.isArray(json?.result) ? json.result : [];
}

type RunStatus = { at: string | null; ran: boolean; keyPresent: boolean; results: any[]; error?: string };
let lastRun: RunStatus = { at: null, ran: false, keyPresent: false, results: [] };
export function getWindsorSyncStatus() { return { ...lastRun, keyPresent: !!process.env.WINDSOR_API_KEY }; }

async function ingestPlatform(platform: string, source: string, agg: WindsorAgg, nowIso: string) {
  if (agg.spend <= 0 || !agg.periodStart) return { platform, action: "SKIPPED", reason: "no spend/period" };
  const sourceHash = hashMarketingSnapshot({ platform, periodStart: agg.periodStart, periodEnd: agg.periodEnd, spend: agg.spend, impressions: agg.impressions, clicks: agg.clicks });
  const active = await storage.getActiveMarketingSpendSnapshots();
  const rec = reconcileMarketingSnapshot(active as any, { platform, periodStart: agg.periodStart, periodEnd: agg.periodEnd, spend: agg.spend, sourceHash });
  const entityKey = `${platform} ${agg.periodStart}..${agg.periodEnd}`;
  if (rec.action === "DISREGARDED") {
    await storage.createDataReconciliationLog([{ dataType: "sync:windsor", entityKey, action: "DISREGARDED", field: null, oldValue: null, newValue: null, reason: rec.decision.reason, source }]);
    return { platform, action: "DISREGARDED", spend: agg.spend };
  }
  if (rec.action === "SUPERSEDED" && rec.supersedeIds.length) await storage.markMarketingSpendSnapshotsSuperseded(rec.supersedeIds, source);
  await storage.createMarketingSpendSnapshot({
    platform, periodStart: agg.periodStart, periodEnd: agg.periodEnd,
    spend: agg.spend, impressions: agg.impressions, clicks: agg.clicks, currency: "USD",
    source, status: "OK", sourceHash, raw: { rowCount: agg.rowCount, sync: "windsor", at: nowIso } as unknown,
  });
  await storage.createDataReconciliationLog([{ dataType: "sync:windsor", entityKey, action: rec.action, field: "spend", oldValue: rec.decision.oldValue ?? null, newValue: String(agg.spend), reason: rec.decision.reason, source }]);
  return { platform, action: rec.action, spend: agg.spend };
}

export async function runWindsorSync(): Promise<{ ran: boolean; reason?: string; results?: any[] }> {
  const apiKey = process.env.WINDSOR_API_KEY;
  const nowIso = new Date().toISOString();
  if (!apiKey) {
    console.log("[Windsor Sync] WINDSOR_API_KEY not set — skipping. Add it in Railway → SBR-App → Variables to enable daily ad-spend sync.");
    lastRun = { at: nowIso, ran: false, keyPresent: false, results: [] };
    return { ran: false, reason: "no_api_key" };
  }
  const results: any[] = [];
  try {
    const g = await fetchWindsor("google_ads", ["date", "spend", "clicks", "impressions"], apiKey);
    results.push(await ingestPlatform("GOOGLE", "windsor:google_ads", aggregateWindsorRows(g, ["spend"]), nowIso));
    // Amazon spend is split across 3 reports (Sponsored Products/Display/Brands).
    const [sp, sd, sb] = await Promise.all([
      fetchWindsor("amazon_ads", ["date", "sponsored_products_campaign__spend"], apiKey).catch(() => [] as WindsorRow[]),
      fetchWindsor("amazon_ads", ["date", "sponsored_display_campaign__cost"], apiKey).catch(() => [] as WindsorRow[]),
      fetchWindsor("amazon_ads", ["date", "sponsored_brands_campaign_non_video__cost"], apiKey).catch(() => [] as WindsorRow[]),
    ]);
    const amz = aggregateWindsorRows([...sp, ...sd, ...sb], ["sponsored_products_campaign__spend", "sponsored_display_campaign__cost", "sponsored_brands_campaign_non_video__cost"]);
    results.push(await ingestPlatform("AMAZON", "windsor:amazon_ads", amz, nowIso));
    lastRun = { at: nowIso, ran: true, keyPresent: true, results };
    console.log("[Windsor Sync] Synced:", JSON.stringify(results));
    return { ran: true, results };
  } catch (e: any) {
    lastRun = { at: nowIso, ran: false, keyPresent: true, results, error: e?.message ?? String(e) };
    console.error("[Windsor Sync] Failed:", e?.message ?? e);
    return { ran: false, reason: e?.message ?? "error" };
  }
}

let armed = false;
/** Arm the daily Windsor sync (fire-and-forget initial run + every 24h). Safe to
 *  call once at startup; a no-op without WINDSOR_API_KEY. */
export function startWindsorSyncScheduler() {
  if (armed) return;
  armed = true;
  void runWindsorSync();
  const t = setInterval(() => void runWindsorSync(), 24 * 60 * 60 * 1000);
  (t as any).unref?.();
}
