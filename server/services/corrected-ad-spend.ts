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
 * THE FIX: every ad-spend surface derives from ONE source of truth — the canonical
 * monthly per-channel engine (canonical-spend-service: Google=QB, Meta=QB daily-card
 * →compliant tracker, Amazon/Pinterest=ad_metrics). `getCorrectedMonthlyAdSpend`
 * returns it monthly; `getCorrectedAdSpendRange` day-prorates those months onto any
 * window. Because the range view is a literal slice of the monthly truth, the
 * breakdown tabs / Ad Analytics headline / runway can never disagree with the
 * Finances + monthly Summary again (the old second engine — a Windsor>upload>live
 * snapshot merge — silently dropped Meta to ~$0 for the daily-card era).
 *
 * Pure helpers (`allocateBreakdownToTotal`, `prorateMonthsToRange`,
 * `monthRangeOverlapFraction`) are unit-tested without a DB.
 */
import { storage } from "../storage";
import {
  normalizeAdPlatform,
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

// ---- pure range/proration helpers (unit-tested, no DB) -------------------

/** Number of days in the calendar month of a `YYYY-MM` string. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this one
}

/**
 * Fraction (0..1) of `month`'s SPEND SPAN that lies within the inclusive window
 * [start, end] (YYYY-MM-DD). The spend span is month-start → min(month-end,
 * `dataEnd`): an in-progress month's spend only covers month-start → today, so
 * treating it as spread over the FULL calendar month made a window that fully
 * contains the data span count only span÷days-in-month of it (e.g. July's Jul 1-9
 * spend × 9/31 inside a 30d window that contains all of Jul 1-9). Span fully
 * inside → 1; fully outside → 0; partial → in-window span days ÷ span days.
 */
export function monthRangeOverlapFraction(month: string, start: string, end: string, dataEnd?: string): number {
  const dim = daysInMonth(month);
  const mStart = `${month}-01`;
  let mEnd = `${month}-${String(dim).padStart(2, "0")}`;
  if (dataEnd && dataEnd < mEnd) mEnd = dataEnd < mStart ? mStart : dataEnd;
  const spanDays = Math.round((Date.parse(mEnd + "T00:00:00Z") - Date.parse(mStart + "T00:00:00Z")) / 86400000) + 1;
  const lo = start > mStart ? start : mStart;
  const hi = end < mEnd ? end : mEnd;
  if (hi < lo) return 0;
  const days = Math.round((Date.parse(hi + "T00:00:00Z") - Date.parse(lo + "T00:00:00Z")) / 86400000) + 1;
  return Math.max(0, Math.min(1, days / spanDays));
}

/**
 * Pure: day-prorate canonical MONTHLY per-channel spend onto an arbitrary window
 * [start, end]. Each month contributes its per-channel spend × the fraction of its
 * SPEND SPAN (month-start → min(month-end, dataEnd)) that falls inside the window,
 * so an in-progress month fully covered by the window contributes in FULL. null
 * channel-months contribute nothing (FLAG-DON'T-FABRICATE — a gap stays a gap,
 * never a fabricated 0). Returns UPPER channel keys. This is what makes the range
 * view a faithful slice of the same canonical truth the monthly Summary shows —
 * never a second, disagreeing engine.
 */
export function prorateMonthsToRange(
  months: Array<{ month: string; byChannel: Record<string, { spend: number | null } | undefined> }>,
  start: string,
  end: string,
  dataEnd?: string,
): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const m of months) {
    const frac = monthRangeOverlapFraction(m.month, start, end, dataEnd);
    if (frac <= 0) continue;
    for (const ch of Object.keys(m.byChannel)) {
      const sp = m.byChannel[ch]?.spend;
      if (sp == null) continue;
      acc[ch] = r2((acc[ch] ?? 0) + sp * frac);
    }
  }
  return acc;
}

/** Whole calendar months spanned from `start` (YYYY-MM-DD) up to now, inclusive (≥1). */
function monthsSinceStart(start: string, nowMs: number = Date.now()): number {
  const [sy, sm] = start.split("-").map(Number);
  const d = new Date(nowMs);
  return Math.max(1, (d.getUTCFullYear() - sy) * 12 + (d.getUTCMonth() + 1 - sm) + 1);
}

/**
 * Channels the canonical engine sources from QuickBooks / the compliant tracker
 * (NEVER ad_metrics). For these, a canonical gap must NOT fall back to live
 * ad_metrics spend — that would resurrect the ~3.65x-inflated Google sum or the
 * compliance-forbidden Meta feed. A gap is reported as 0 (the same way the monthly
 * Summary folds a null channel into its total: `spend ?? 0`), never an inflated /
 * fabricated number.
 */
export const GOVERNED_CHANNELS = new Set<string>(["GOOGLE", "META"]);

/**
 * Pure: merge canonical per-channel spend with live ad_metrics into the range
 * engine's platform list. SPEND = canonical where present; for a canonical gap,
 * GOVERNED channels report 0 (honest "no booked spend yet"), every other platform
 * (Amazon/Pinterest — which canonical itself sources from ad_metrics — plus anything
 * canonical doesn't model) falls back to live ad_metrics. Impressions/clicks always
 * come from live, so breakdown tabs keep their secondary metrics.
 */
export function mergeRangePlatforms(
  canonical: Record<string, number>,
  live: Record<string, { spend?: number; impressions?: number | null; clicks?: number | null }>,
  governed: Set<string> = GOVERNED_CHANNELS,
): MergedPlatform[] {
  const names = new Set<string>([...Object.keys(canonical), ...Object.keys(live)]);
  const out: MergedPlatform[] = [];
  for (const p of Array.from(names)) {
    const canon = canonical[p];
    let spend: number;
    let source: MergedPlatform["source"];
    if (canon != null) {
      spend = canon;
      source = "canonical";
    } else if (governed.has(p)) {
      spend = 0; // QB/tracker channel with a gap → honest 0, never the inflated live feed
      source = "canonical";
    } else {
      spend = live[p]?.spend ?? 0;
      source = "live";
    }
    out.push({
      platform: p,
      spend: r2(spend),
      impressions: live[p]?.impressions ?? null,
      clicks: live[p]?.clicks ?? null,
      source,
    });
  }
  out.sort((a, b) => b.spend - a.spend);
  return out;
}

/**
 * Per-platform corrected ad spend over [start, end] (YYYY-MM-DD, inclusive).
 *
 * SPEND comes from the canonical monthly engine (canonical-spend-service:
 * Google=QB, Meta=QB daily-card→compliant tracker, Amazon/Pinterest=ad_metrics),
 * day-prorated onto the window. This is the SAME source the monthly Summary uses,
 * so range-based surfaces (breakdown tabs, Ad Analytics headline, runway) can no
 * longer disagree with it — the old second engine (Windsor>upload>live snapshot
 * merge) silently dropped Meta to ~$0 for the daily-card era (no snapshot covered
 * it), inflating ROAS on the very channel that drives demand. IMPRESSIONS/CLICKS
 * (and a spend fallback for any platform/window canonical can't cover) still come
 * from live ad_metrics, so breakdown tabs keep their secondary metrics.
 */
export async function getCorrectedAdSpendRange(
  start: string,
  end: string,
): Promise<CorrectedAdSpend> {
  // LIVE ad_metrics in range: source of impressions/clicks, and a spend fallback
  // only for a platform/window the canonical engine returns nothing for.
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

  // CANONICAL per-channel spend, day-prorated onto [start, end].
  let canonical: Record<string, number> = {};
  try {
    const { getCanonicalMonthlySpendByChannel } = await import("./canonical-spend-service");
    const { db } = await import("../db");
    // Cover the whole window back to its start (no upper cap — the canonical engine
    // computes one memoized full-horizon snapshot and slices it, so asking for more
    // months is free and never silently truncates a wide window's early months).
    const monthsBack = Math.max(14, monthsSinceStart(start) + 1);
    const months = await getCanonicalMonthlySpendByChannel(db, monthsBack);
    // dataEnd = today: the current month's spend only spans month-start → today, so
    // a window covering that whole span takes the month's spend in full (not ×n/31).
    canonical = prorateMonthsToRange(months, start, end, isoDaysAgo(0, Date.now()));
  } catch {
    /* canonical unavailable → fall back to live ad_metrics below (never empty) */
  }

  // MERGE: spend = canonical where present; a canonical gap on a GOVERNED channel
  // (Google/Meta — QB/tracker-sourced) reports 0 rather than the inflated/forbidden
  // live ad_metrics feed; other platforms fall back to live. Impressions/clicks live.
  const platforms = mergeRangePlatforms(canonical, live);

  const spendByPlatform: Record<string, number> = {};
  let total = 0;
  for (const p of platforms) {
    spendByPlatform[p.platform] = p.spend;
    total += p.spend;
  }
  const totalAdSpend = platforms.length ? r2(total) : null;

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
  // globalFactor reconciles ONLY the platforms that actually appear in raw
  // ad_metrics_daily. A canonical-only channel (Meta = QB/tracker, ZERO ad_metrics
  // rows) must not be folded into a blended factor that then scales platformless /
  // per-SKU ad_metrics breakdowns (querySpendPacing, queryProductPerformance, the
  // YTD weekly column) — that would smear Meta's dollars onto the Google/Amazon SKUs
  // that are the only ones carrying rows, inflating their spend and crushing their
  // ROAS into false "loser" flags. Per-platform callers use factorByPlatform; this
  // blended factor lives entirely inside the ad_metrics universe.
  let correctedForRaw = 0;
  for (const p of Object.keys(raw)) {
    const c = corrected.spendByPlatform[p];
    correctedForRaw += c != null ? c : raw[p];
  }
  const globalFactor = rawTotal > 0 ? correctedForRaw / rawTotal : 1;
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
