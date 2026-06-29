/**
 * CIPH.R — Corrected Ad Spend (single source of truth for ad spend everywhere).
 *
 * THE PROBLEM this fixes: the Marketing Analytics ("Ad Analytics") page summed
 * `ad_metrics_daily` directly (`SUM(spend) GROUP BY platform`). That table holds
 * OVERLAPPING marginal breakdown rows (per-SKU rows AND per-campaign×device×country
 * rows) on top of any aggregate row, so a naive SUM multi-counts the same spend
 * (~3.65x on Google: $25,713 vs the real $9,234). Worse, two different syncs wrote
 * Google at different granularities that don't even agree with each other or with
 * Windsor. So `ad_metrics_daily` is NOT a trustworthy totals source.
 *
 * THE FIX: every ad-spend surface derives from the SAME merge the Finances page
 * uses — the source hierarchy (Windsor authoritative > manual upload > deduped
 * live), assembled from `marketing_spend_snapshots` (clean, superseded-aware) with
 * `ad_metrics_daily` only as a last-resort fallback for platforms no snapshot
 * covers. This module is that single primitive; Ad Analytics and Finances both
 * call it, so their numbers can never disagree again.
 *
 * Pure helpers (`allocateBreakdownToTotal`) are unit-tested without a DB.
 */
import { storage } from "../storage";
import {
  normalizeAdPlatform,
  mergeAdSpendByPlatform,
  collapseOverlappingSnapshots,
  overlapFraction,
  type PlatformSpend,
  type MergedPlatform,
} from "./unified-performance-service";

const r2 = (n: number) => Math.round(n * 100) / 100;
const isoDaysAgo = (d: number, nowMs: number) =>
  new Date(nowMs - d * 86400000).toISOString().slice(0, 10);

export interface CorrectedAdSpend {
  start: string;
  end: string;
  windowDays: number;
  platforms: MergedPlatform[]; // merged, source-tagged, deduped — exactly one source per platform
  totalAdSpend: number | null;
  spendByPlatform: Record<string, number>; // UPPER platform -> corrected spend (convenience)
}

/**
 * Per-platform corrected ad spend over [start, end] (YYYY-MM-DD, inclusive).
 * Mirrors the Finances `/api/finances/overview` ad-channels block and the unified
 * hub byte-for-byte (same storage calls, same bucketing, same merge), so the
 * Ad Analytics page and the Finances page always show identical totals.
 */
export async function getCorrectedAdSpendRange(
  start: string,
  end: string,
): Promise<CorrectedAdSpend> {
  // LIVE: naive ad_metrics_daily by normalized platform. The merge below only
  // ever uses this for a platform that has NO windsor/upload snapshot, so its
  // known double-count can't pollute Google/Amazon/Meta (all snapshot-backed).
  const live: Record<string, PlatformSpend> = {};
  try {
    const rows = await storage.getAdMetricsInRange(start, end);
    for (const r of rows as any[]) {
      const p = normalizeAdPlatform(String(r.platform || ""));
      if (!p) continue; // skip traffic-source noise (DIRECT, NOT SET, …)
      const cur = live[p] || { spend: 0, impressions: 0, clicks: 0 };
      cur.spend += Number(r.spend) || 0;
      cur.impressions = (cur.impressions || 0) + (Number(r.impressions) || 0);
      cur.clicks = (cur.clicks || 0) + (Number(r.clicks) || 0);
      live[p] = cur;
    }
  } catch {
    /* no live ad data */
  }

  // SNAPSHOTS: split by source — Windsor (authoritative) vs manual upload (Meta
  // CSV, etc.). getMarketingSpendSnapshotsInRange excludes superseded rows, but
  // Windsor writes a fresh rolling-30d window DAILY, so many OVERLAPPING active
  // rows pile up per (source, platform). Collapse each group to one window BEFORE
  // summing — a blind SUM here is the ~6.5x ad-spend over-count bug. Mirrors the
  // safe path in getUnifiedPerformance. See ADSPEND-DEDUP-SPEC.md (Layer A).
  const uploaded: Record<string, PlatformSpend> = {};
  const windsor: Record<string, PlatformSpend> = {};
  try {
    const snaps = await storage.getMarketingSpendSnapshotsInRange(start, end);
    const groups = new Map<string, any[]>(); // key: `${bucket}|${platform}`
    for (const s of snaps as any[]) {
      const p = String(s.platform || "OTHER").toUpperCase();
      const bucketName = String(s.source || "").toLowerCase().startsWith("windsor") ? "windsor" : "uploaded";
      const key = `${bucketName}|${p}`;
      const g = groups.get(key);
      if (g) g.push(s); else groups.set(key, [s]);
    }
    for (const [key, group] of Array.from(groups.entries())) {
      const [bucketName, p] = key.split("|");
      const bucket = bucketName === "windsor" ? windsor : uploaded;
      const cur = bucket[p] || { spend: 0, impressions: 0, clicks: 0 };
      for (const s of collapseOverlappingSnapshots(group)) {
        // PRORATE to the query range: a window only partially inside [start,end]
        // contributes its in-range slice, not its full value (so a stale 3-week
        // upload doesn't inflate a "last 30 days" total). Rolling windows fully in
        // range → factor 1 (unchanged).
        const f = overlapFraction(s.periodStart, s.periodEnd, start, end);
        cur.spend += (Number(s.spend) || 0) * f;
        if (s.impressions != null) cur.impressions = (cur.impressions || 0) + Number(s.impressions) * f;
        if (s.clicks != null) cur.clicks = (cur.clicks || 0) + Number(s.clicks) * f;
      }
      bucket[p] = cur;
    }
  } catch {
    /* no snapshot ad data */
  }

  const { platforms, totalAdSpend } = mergeAdSpendByPlatform(live, uploaded, windsor);
  const spendByPlatform: Record<string, number> = {};
  for (const p of platforms) spendByPlatform[p.platform] = p.spend;

  const day = 86400000;
  const windowDays = Math.max(
    1,
    Math.round(
      (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / day,
    ) + 1,
  );
  return { start, end, windowDays, platforms, totalAdSpend, spendByPlatform };
}

/** Corrected ad spend for a trailing N-day window ending today. */
export async function getCorrectedAdSpendDays(
  days: number,
  nowMs: number = Date.now(),
): Promise<CorrectedAdSpend> {
  const end = isoDaysAgo(0, nowMs);
  const start = isoDaysAgo(Math.max(1, days), nowMs);
  return getCorrectedAdSpendRange(start, end);
}

export interface CorrectedAdSummary extends CorrectedAdSpend {
  totalRevenue: number | null; // sales revenue in the window (for blended ROAS)
  blendedRoas: number | null; // revenue ÷ corrected ad spend
}

/** Lightweight window revenue: daily sales snapshots, else summed order totals. */
async function getWindowRevenue(start: string, end: string): Promise<number | null> {
  try {
    const snaps = await storage.getDailySalesSnapshotsInRange(start, end);
    if (snaps.length) {
      return r2(snaps.reduce((s, x: any) => s + (Number(x.totalRevenue) || 0), 0));
    }
  } catch {
    /* fall through */
  }
  try {
    const orders = await storage.getSalesOrdersByDateRange(
      new Date(start),
      new Date(end + "T23:59:59"),
    );
    if (orders.length) {
      return r2(orders.reduce((s, o: any) => s + (Number(o.totalAmount) || 0), 0));
    }
  } catch {
    /* no revenue */
  }
  return null;
}

/**
 * Corrected ad spend + window revenue + blended ROAS. This backs the Ad Analytics
 * headline (KPI bar + "Ad Spend by Channel" card) so it matches the Finances
 * unified card's Blended ROAS exactly.
 */
export async function getCorrectedAdSummary(
  days: number,
  nowMs: number = Date.now(),
): Promise<CorrectedAdSummary> {
  const base = await getCorrectedAdSpendDays(days, nowMs);
  const totalRevenue = await getWindowRevenue(base.start, base.end);
  const blendedRoas =
    totalRevenue != null && base.totalAdSpend != null && base.totalAdSpend > 0
      ? r2(totalRevenue / base.totalAdSpend)
      : null;
  return { ...base, totalRevenue, blendedRoas };
}

export interface AdSpendCorrection {
  corrected: CorrectedAdSpend;
  factorByPlatform: Record<string, number>; // UPPER platform -> multiplier on raw ad_metrics_daily spend
  globalFactor: number; // corrected total ÷ raw total (for platform-less breakdowns)
  /** Convert a raw ad_metrics_daily spend value to its corrected value. Uses the
   *  platform's factor when known, else the global factor. */
  correctSpend(platform: string | null | undefined, rawSpend: number): number;
}

/**
 * Window-level correction factors. Each ad_metrics_daily-derived spend can be
 * multiplied by `factorByPlatform[PLATFORM]` (or `globalFactor` when the row has
 * no platform) to land on the authoritative corrected total. This is what the
 * breakdown/time-series tabs use — it kills the ~3.65x double-count while keeping
 * each breakdown's RELATIVE shape, and makes every tab's spend reconcile to the
 * same number the Finances page shows.
 */
export async function getAdSpendCorrection(
  days: number,
  nowMs: number = Date.now(),
): Promise<AdSpendCorrection> {
  const corrected = await getCorrectedAdSpendDays(days, nowMs);
  const raw: Record<string, number> = {};
  let rawTotal = 0;
  try {
    const rows = await storage.getAdMetricsInRange(corrected.start, corrected.end);
    for (const r of rows as any[]) {
      const p = normalizeAdPlatform(String(r.platform || ""));
      if (!p) continue;
      const s = Number(r.spend) || 0;
      raw[p] = (raw[p] || 0) + s;
      rawTotal += s;
    }
  } catch {
    /* no live ad data → factors default to global/1 */
  }
  const factorByPlatform: Record<string, number> = {};
  for (const [p, c] of Object.entries(corrected.spendByPlatform)) {
    if (raw[p] && raw[p] > 0) factorByPlatform[p] = c / raw[p];
  }
  const correctedTotal = corrected.totalAdSpend || 0;
  const globalFactor = rawTotal > 0 ? correctedTotal / rawTotal : 1;
  const correctSpend = (platform: string | null | undefined, rawSpend: number) => {
    const f = factorByPlatform[String(platform || "").toUpperCase()];
    const factor = f != null && isFinite(f) ? f : globalFactor;
    return r2((Number(rawSpend) || 0) * factor);
  };
  return { corrected, factorByPlatform, globalFactor, correctSpend };
}

export interface MonthlyPlatformSpend {
  byPlatform: Record<string, number>; // UPPER platform -> corrected spend that month
  total: number;
}

/**
 * Corrected ad spend per CALENDAR MONTH per platform, straight from the clean
 * snapshot source (Windsor authoritative > manual upload), keyed to the month of
 * each snapshot's period_start. The monthly/LTV tabs use this instead of summing
 * the inflated ad_metrics_daily — the Windsor snapshots ARE monthly, so this is a
 * direct, accurate series. Months with no snapshot are simply absent (callers
 * fall back to their QuickBooks historical_monthly_sales series).
 *
 * Returns Map<'YYYY-MM', MonthlyPlatformSpend>.
 */
export async function getCorrectedMonthlyAdSpend(): Promise<Map<string, MonthlyPlatformSpend>> {
  // CANONICAL: source per-channel monthly spend from the single source of truth
  // (canonical-spend-service: Google=QB validated, Meta=QB-Facebook/compliant-tracker,
  // Amazon/Pinterest=ad_metrics) instead of the snapshot pile, which carried the
  // Windsor-Google ~3x inflation, no Windsor-Meta compliance filter, and the
  // period_start-only month-straddle bug. Every consumer (Monthly Ad Spend, LTV-CAC,
  // breakeven trend) inherits the correction here. Failure → empty map (callers fall
  // back to historical_monthly_sales).
  const out = new Map<string, MonthlyPlatformSpend>();
  try {
    const { getCanonicalMonthlySpendByChannel } = await import("./canonical-spend-service");
    const { db } = await import("../db");
    for (const m of await getCanonicalMonthlySpendByChannel(db, 14)) {
      const byPlatform: Record<string, number> = {};
      for (const ch of Object.keys(m.byChannel)) {
        const sp = (m.byChannel as any)[ch]?.spend;
        if (sp != null && sp > 0) byPlatform[ch] = r2(sp);
      }
      out.set(m.month, { byPlatform, total: r2(m.channelTotal) });
    }
  } catch {
    /* canonical unavailable → empty map (callers fall back to historical_monthly_sales) */
  }
  return out;
}

/**
 * Scale a raw breakdown (by campaign/device/country/sku from ad_metrics_daily) so
 * its spend sums to the corrected platform total — same proportional-allocation
 * pattern the per-SKU margin table uses. Keeps the breakdown's RELATIVE shape
 * (which campaign/device is bigger) while making its ABSOLUTE numbers reconcile
 * to the authoritative total. Returns items with `spend` replaced by the
 * allocated value and an `allocated: true` flag; revenue/clicks pass through.
 *
 * If the raw spend sums to 0 (no signal to weight by) or there's no corrected
 * total, spend is left as-is and `allocated` is false (honest: nothing to scale).
 */
export function allocateBreakdownToTotal<T extends { spend: number }>(
  items: T[],
  correctedTotal: number | null,
): Array<T & { spend: number; rawSpend: number; allocated: boolean }> {
  const rawTotal = items.reduce((s, it) => s + (Number(it.spend) || 0), 0);
  const canAllocate = correctedTotal != null && correctedTotal > 0 && rawTotal > 0;
  const factor = canAllocate ? (correctedTotal as number) / rawTotal : 1;
  return items.map((it) => {
    const rawSpend = Number(it.spend) || 0;
    return {
      ...it,
      rawSpend,
      spend: canAllocate ? r2(rawSpend * factor) : rawSpend,
      allocated: canAllocate,
    };
  });
}

/**
 * Period-aware reconciliation for multi-month ROAS history. Groups per-SKU rows by
 * (calendar month of `date`, channel) and scales each group to THAT month+channel's
 * authoritative spend total — so a 3-month window isn't distorted by reconciling
 * every month to a single latest-month total (the bug this replaces). A month with
 * no total is left unscaled (allocated:false), never scaled to another month's number.
 * `totalByMonthChannel` is keyed `${YYYY-MM}|${channel}`. Pure.
 */
export function reconcileRoasByMonthChannel<T extends { date: string; channel: string; ad_spend?: number }>(
  rows: T[],
  totalByMonthChannel: Record<string, number | null>,
): Array<T & { spend: number; rawSpend: number; allocated: boolean }> {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = `${String(r.date).slice(0, 7)}|${r.channel}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const out: Array<T & { spend: number; rawSpend: number; allocated: boolean }> = [];
  for (const [key, items] of Array.from(groups.entries())) {
    const target = key in totalByMonthChannel ? totalByMonthChannel[key] : null;
    const scaled = allocateBreakdownToTotal(
      items.map((it) => ({ ...it, spend: Number(it.ad_spend) || 0 })),
      target,
    );
    out.push(...scaled);
  }
  return out;
}
