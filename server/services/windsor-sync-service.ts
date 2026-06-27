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
  // Supersede ANY active same-platform snapshot whose period OVERLAPS this one, so the
  // daily trailing-30d window REPLACES the prior overlapping windows instead of stacking.
  // reconcileMarketingSnapshot only matched exact/identical periods, so ~14 overlapping
  // rolling windows piled up and multi-counted spend (~14x). Mirrors the meta-manual path.
  const newEnd = agg.periodEnd ?? agg.periodStart;
  const overlapIds = (active as any[])
    .filter((s) => String(s.platform || "").toUpperCase() === platform.toUpperCase() && !s.superseded
      && s.periodStart && s.periodEnd && s.sourceHash !== sourceHash
      && s.periodStart <= newEnd && s.periodEnd >= agg.periodStart)
    .map((s) => s.id);
  const supersedeIds = Array.from(new Set([...(rec.action === "SUPERSEDED" ? rec.supersedeIds : []), ...overlapIds]));
  if (supersedeIds.length) await storage.markMarketingSpendSnapshotsSuperseded(supersedeIds, source);
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
    // Amazon spend is split across 4 reports (Sponsored Products / Display /
    // Brands non-video / Brands VIDEO). The video table was missed until the
    // 2026-06-09 integration audit — it carries ~24% of Amazon spend (~$955/30d
    // verified against Windsor raw data), so omitting it under-reported AMAZON.
    const [sp, sd, sb, sbv] = await Promise.all([
      fetchWindsor("amazon_ads", ["date", "sponsored_products_campaign__spend"], apiKey).catch(() => [] as WindsorRow[]),
      fetchWindsor("amazon_ads", ["date", "sponsored_display_campaign__cost"], apiKey).catch(() => [] as WindsorRow[]),
      fetchWindsor("amazon_ads", ["date", "sponsored_brands_campaign_non_video__cost"], apiKey).catch(() => [] as WindsorRow[]),
      fetchWindsor("amazon_ads", ["date", "sponsored_brands_campaign_video__cost"], apiKey).catch(() => [] as WindsorRow[]),
    ]);
    const amz = aggregateWindsorRows([...sp, ...sd, ...sb, ...sbv], ["sponsored_products_campaign__spend", "sponsored_display_campaign__cost", "sponsored_brands_campaign_non_video__cost", "sponsored_brands_campaign_video__cost"]);
    results.push(await ingestPlatform("AMAZON", "windsor:amazon_ads", amz, nowIso));
    // Pinterest is connected in Windsor (account "Inspired Tool Design, LLC").
    // Currently $0 spend, but syncing it now means the moment campaigns start
    // the spend flows in automatically (ingestPlatform skips zero-spend cleanly).
    try {
      const p = await fetchWindsor("pinterest", ["date", "spend", "clicks", "impressions"], apiKey);
      results.push(await ingestPlatform("PINTEREST", "windsor:pinterest", aggregateWindsorRows(p, ["spend"]), nowIso));
    } catch (e: any) {
      results.push({ platform: "PINTEREST", action: "SKIPPED", reason: e?.message ?? "fetch failed" });
    }
    // Campaign-level Google daily (spend, conversions, conversion VALUE) — the
    // automated replacement for Zo's manual KPI tracker. Validated 2026-06-09
    // against her sheet to the cent (e.g. Pull-Behind Original $551.02 /
    // $2,316.70 exact). sku '_windsor' keeps these rows distinct from the live
    // shopping-feed SKU rows; revenue = Google-attributed conversion_value, so
    // per-campaign ROAS in the app is finally real.
    try {
      const rows = await fetchWindsor(
        "google_ads",
        ["date", "campaign", "spend", "clicks", "impressions", "conversions", "conversion_value"],
        apiKey,
      );
      let upserts = 0;
      for (const row of rows as any[]) {
        if (!row?.date || !row?.campaign) continue;
        const spend = Number(row.spend) || 0;
        const revenue = Number(row.conversion_value) || 0;
        if (spend <= 0 && revenue <= 0) continue;
        await storage.upsertAdMetricsDaily({
          platform: "GOOGLE",
          sku: "_windsor",
          date: String(row.date),
          campaign: String(row.campaign),
          impressions: Math.round(Number(row.impressions) || 0),
          clicks: Math.round(Number(row.clicks) || 0),
          spend,
          conversions: Math.round(Number(row.conversions) || 0),
          revenue,
          currency: "USD",
        } as any);
        upserts++;
      }
      results.push({ platform: "GOOGLE_CAMPAIGNS", action: "UPSERTED", rows: upserts });
    } catch (e: any) {
      results.push({ platform: "GOOGLE_CAMPAIGNS", action: "SKIPPED", reason: e?.message ?? "fetch failed" });
    }
    // Campaign-level AMAZON Sponsored Products daily (cost, conversions, and
    // 14-day attributed sales — Amazon's own attribution). Same '_windsor'
    // convention; gives the per-campaign table real Amazon ROAS (e.g. the Auto
    // campaign at ~9x, brand-defense KWs at 20x+) alongside Google.
    try {
      const rows = await fetchWindsor(
        "amazon_ads",
        ["date", "sponsored_products_campaign__campaign", "sponsored_products_campaign__cost", "sponsored_products_campaign__attributedsales14d", "sponsored_products_campaign__attributedconversions14d"],
        apiKey,
      );
      let upserts = 0;
      for (const row of rows as any[]) {
        const campaign = row?.sponsored_products_campaign__campaign;
        if (!row?.date || !campaign) continue;
        const spend = Number(row.sponsored_products_campaign__cost) || 0;
        const revenue = Number(row.sponsored_products_campaign__attributedsales14d) || 0;
        if (spend <= 0 && revenue <= 0) continue;
        await storage.upsertAdMetricsDaily({
          platform: "AMAZON",
          sku: "_windsor",
          date: String(row.date),
          campaign: String(campaign),
          impressions: 0,
          clicks: 0,
          spend,
          conversions: Math.round(Number(row.sponsored_products_campaign__attributedconversions14d) || 0),
          revenue,
          currency: "USD",
        } as any);
        upserts++;
      }
      results.push({ platform: "AMAZON_CAMPAIGNS", action: "UPSERTED", rows: upserts });
    } catch (e: any) {
      results.push({ platform: "AMAZON_CAMPAIGNS", action: "SKIPPED", reason: e?.message ?? "fetch failed" });
    }
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
