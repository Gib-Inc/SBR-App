/**
 * Canonical monthly ad spend by channel — the SINGLE source of truth for media
 * spend → ROAS, replacing five disagreeing tables. Built from the audit
 * (project_roas_canonical_spend) + validated against Matt's real exports
 * (Zo Google sheet, the Meta YTD CSV).
 *
 * PER-CHANNEL PRECEDENCE (each channel resolves independently so one gap never
 * pollutes another):
 *  - GOOGLE   = QuickBooks qb_pl_detail (vendor/account Google). Zo's Google Ads
 *               export VALIDATES QB (~$3.7-11K/mo); ad_metrics_daily Google is ~3x
 *               inflated (SKU/campaign double-count) — NOT used as the spine.
 *  - META     = QB Facebook vendor through the daily-card era (≤ 2026-04, high
 *               confidence); from 2026-05 (credit-line switch, QB stops booking it)
 *               use the COMPLIANT non-Windsor tracker snapshots, month-allocated
 *               (medium, understated). NEVER Windsor for Meta. NEVER ad_metrics.
 *  - AMAZON   = ad_metrics_daily (QB books Amazon ~$0).
 *  - PINTEREST= ad_metrics_daily.
 *
 * channelTotal = the four media channels (for MEDIA ROAS). bookedMarketingTotal =
 * total QB Advertising (the MER denominator — incl. agency/creative/etc.), NEVER
 * used as channel spend. otherMarketing = booked − channelTotal.
 *
 * FLAG-DON'T-FABRICATE: a channel with no source for a month it historically ran
 * is null + a gapReason, NEVER 0 (a false 0 inflates ROAS the most). The pure
 * assembly (assembleMonth) is unit-tested in canonical-spend-service.test.ts.
 */
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import {
  monthlyOverlapSplit,
  filterCompliantSnapshots,
  collapseOverlappingSnapshots,
  normalizeAdPlatform,
} from "./unified-performance-service";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// Meta's daily-charged-card era ends here; after this it's on a credit line and
// QB stops booking it as Facebook advertising expense.
export const META_QB_CUTOFF_MONTH = "2026-05"; // months >= this use compliant snapshots for Meta

export type Channel = "GOOGLE" | "META" | "AMAZON" | "PINTEREST";
export const CHANNELS: Channel[] = ["GOOGLE", "META", "AMAZON", "PINTEREST"];

export interface ChannelSpend {
  spend: number | null;
  source: string;
  confidence: "high" | "medium" | "low";
  understated: boolean;
  gapReason?: string;
}
export interface MonthSpend {
  month: string; // YYYY-MM
  byChannel: Record<Channel, ChannelSpend>;
  channelTotal: number; // sum of non-null channels (media — for media ROAS)
  bookedMarketingTotal: number | null; // QB total Advertising (booked only)
  otherMarketing: number | null; // booked − channelTotal (agency/creative/etc.)
  // THE MER denominator: booked QB marketing + credit-line-era Meta (which QB stopped
  // booking at the 2026-05 switch). bookedMarketingTotal alone UNDERSTATES true
  // marketing cost post-cutoff — a gate or scoreboard dividing by it overstates MER.
  merDenominator: number | null;
  merUnderstated: boolean; // true when a known component (credit-line Meta) is missing
}

/** Pure: THE one MER-denominator composition — booked QB marketing + credit-line-era
 *  Meta. Used at month grain here (assembleMonth) and at window grain by the
 *  marketing governor, so the daily gate and the scoreboard can never disagree on
 *  what "total marketing spend" means. */
export function merDenominator(opts: {
  booked: number | null;      // QB booked Advertising for the period
  creditLineMeta: number | null; // Meta spend QB is NOT booking (compliant tracker), post-cutoff only
  creditLineEra: boolean;     // does the period fall in the credit-line era?
}): { value: number | null; understated: boolean } {
  const hasBooked = opts.booked != null && Number.isFinite(opts.booked);
  const hasMeta = opts.creditLineMeta != null && Number.isFinite(opts.creditLineMeta);
  if (!hasBooked && !hasMeta) return { value: null, understated: true };
  const value = r2((hasBooked ? (opts.booked as number) : 0) + (hasMeta ? (opts.creditLineMeta as number) : 0));
  // Understated when the era says Meta is running unbooked but we have no tracker
  // number for it, or when booked itself is missing.
  const understated = (opts.creditLineEra && !hasMeta) || !hasBooked;
  return { value, understated };
}

export interface MonthInputs {
  qbGoogle?: number | null;
  qbMeta?: number | null; // QB Facebook vendor (daily-card era)
  metaSnap?: number | null; // compliant non-Windsor tracker, month-allocated
  amazon?: number | null;
  pinterest?: number | null;
  booked?: number | null; // total QB Advertising
}

/** Pure: resolve one month's per-channel spend + totals from the gathered inputs. */
export function assembleMonth(month: string, inp: MonthInputs): MonthSpend {
  const isClosedDailyCard = month < META_QB_CUTOFF_MONTH; // Meta still on the daily card
  const has = (v: number | null | undefined) => v != null && Number.isFinite(v);

  // GOOGLE — QB is the validated spine.
  const google: ChannelSpend = has(inp.qbGoogle)
    ? { spend: r2(inp.qbGoogle as number), source: "quickbooks", confidence: "high", understated: false }
    : { spend: null, source: "none", confidence: "low", understated: false, gapReason: "no QB Google spend booked" };

  // META — QB-Facebook for the daily-card era, compliant snapshots after the credit-line switch.
  let meta: ChannelSpend;
  if (isClosedDailyCard) {
    meta = has(inp.qbMeta) && (inp.qbMeta as number) > 0
      ? { spend: r2(inp.qbMeta as number), source: "quickbooks:facebook", confidence: "high", understated: false }
      : has(inp.metaSnap)
        ? { spend: r2(inp.metaSnap as number), source: "tracker", confidence: "medium", understated: false }
        : { spend: null, source: "none", confidence: "low", understated: false, gapReason: "no Meta source" };
  } else {
    // Credit-line era: QB no longer books Meta — use the compliant tracker (month-allocated).
    if (has(inp.metaSnap) && (inp.metaSnap as number) > 0) {
      meta = { spend: r2(inp.metaSnap as number), source: "tracker:compliant", confidence: "medium", understated: true, gapReason: "Meta on credit line — QB not booking it; tracker estimate" };
    } else if (has(inp.qbMeta) && (inp.qbMeta as number) > 0) {
      meta = { spend: r2(inp.qbMeta as number), source: "quickbooks:facebook(partial)", confidence: "low", understated: true, gapReason: "QB Facebook partial (pre-credit-line only)" };
    } else {
      meta = { spend: null, source: "none", confidence: "low", understated: true, gapReason: "Meta on credit line, no compliant tracker for this month" };
    }
  }

  // Amazon's only feed (ad_metrics_daily) is KNOWN to undercount ~25-32% vs the
  // authoritative Giant Horizons weekly PDF (which has no ingestion path yet) — so an
  // Amazon number is never clean; flag it understated rather than let Amazon ROAS
  // silently flatter itself.
  const amazon: ChannelSpend = has(inp.amazon) && (inp.amazon as number) > 0
    ? { spend: r2(inp.amazon as number), source: "ad_metrics", confidence: "medium", understated: true, gapReason: "ad_metrics undercounts ~25-32% vs the authoritative Giant Horizons weekly PDF (no ingestion path yet)" }
    : { spend: null, source: "none", confidence: "low", understated: false, gapReason: "no Amazon ad spend captured" };

  const pinterest: ChannelSpend = has(inp.pinterest) && (inp.pinterest as number) > 0
    ? { spend: r2(inp.pinterest as number), source: "ad_metrics", confidence: "medium", understated: false }
    : { spend: null, source: "none", confidence: "low", understated: false, gapReason: "no Pinterest spend" };

  const byChannel = { GOOGLE: google, META: meta, AMAZON: amazon, PINTEREST: pinterest } as Record<Channel, ChannelSpend>;
  const channelTotal = r2(CHANNELS.reduce((s, c) => s + (byChannel[c].spend ?? 0), 0));
  const bookedMarketingTotal = has(inp.booked) ? r2(inp.booked as number) : null;
  const otherMarketing = bookedMarketingTotal != null ? r2(bookedMarketingTotal - channelTotal) : null;
  // Credit-line-era Meta is the piece QB doesn't book: only tracker-sourced Meta counts
  // as an ADDITION to booked (card-era Meta is already inside booked QB advertising).
  const creditLineEra = !isClosedDailyCard;
  const creditLineMeta = creditLineEra && meta.source === "tracker:compliant" ? meta.spend : null;
  const md = merDenominator({ booked: bookedMarketingTotal, creditLineMeta, creditLineEra });
  return { month, byChannel, channelTotal, bookedMarketingTotal, otherMarketing, merDenominator: md.value, merUnderstated: md.understated };
}

// Short in-process memo: the canonical series is read by many surfaces (Monthly
// Summary, finances, runway, the per-month ROAS-reconciliation loop, the range
// engine) within one request cycle, and the underlying QB/ad data changes at most
// on a sync (minutes-to-daily). We compute ONE full-horizon snapshot and slice it
// per caller, so every surface — whatever monthsBack it asks for — reads the SAME
// snapshot. (Keying by monthsBack would let a 12-month caller and a 14-month caller
// hold two snapshots up to 60s apart and disagree for a shared month — the exact
// cross-surface drift this engine exists to kill.) Horizon 48 covers any realistic
// window; the GROUP-BY-month query only returns months that actually have data.
const _FULL_HORIZON = 48;
const _MEMO_TTL_MS = 60_000;
let _memo: { at: number; data: MonthSpend[] } | null = null;

/**
 * DB (read-only): the canonical per-channel monthly series, trailing `monthsBack`
 * months. Backed by one memoized full-horizon snapshot (see above), so two callers
 * asking for different monthsBack still read the same underlying numbers. Returns a
 * fresh array each call (callers must treat the MonthSpend objects as read-only).
 */
export async function getCanonicalMonthlySpendByChannel(db: any, monthsBack = 12): Promise<MonthSpend[]> {
  if (!_memo || Date.now() - _memo.at >= _MEMO_TTL_MS) {
    _memo = { at: Date.now(), data: await _computeCanonicalMonthlySpendByChannel(db, _FULL_HORIZON) };
  }
  const data = _memo.data;
  return monthsBack >= data.length ? data.slice() : data.slice(-monthsBack);
}

async function _computeCanonicalMonthlySpendByChannel(db: any, monthsBack: number): Promise<MonthSpend[]> {
  const dNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Denver" }));
  const cut = new Date(dNow.getFullYear(), dNow.getMonth() - monthsBack, 1);
  const cutStr = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, "0")}-01`;

  // QB per-vendor monthly (Google + Facebook/Meta). Meta only counts the daily-card
  // era — credit-line charges post untagged, so we don't trust QB Facebook past then.
  const qb = rows(await db.execute(sql`
    SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS mo,
      sum(amount) FILTER (WHERE vendor_or_payee ILIKE '%google%' OR account_name ILIKE '%google%') AS qb_google,
      sum(amount) FILTER (WHERE vendor_or_payee ILIKE '%facebook%' OR vendor_or_payee ILIKE '%meta%') AS qb_meta
    FROM qb_pl_detail WHERE txn_date >= ${cutStr}::date GROUP BY 1`));
  const qbMap = new Map<string, any>(qb.map((r) => [r.mo, r]));

  // ad_metrics monthly (Amazon, Pinterest).
  const adm = rows(await db.execute(sql`
    SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS mo,
      sum(spend) FILTER (WHERE lower(platform) LIKE '%amazon%') AS amazon,
      sum(spend) FILTER (WHERE lower(platform) LIKE '%pinterest%') AS pinterest
    FROM ad_metrics_daily WHERE date >= ${cutStr}::date GROUP BY 1`));
  const admMap = new Map<string, any>(adm.map((r) => [r.mo, r]));

  // Total QB Advertising (booked marketing = MER denominator).
  const booked = rows(await db.execute(sql`
    SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS mo, sum(amount) AS booked
    FROM qb_pl_detail WHERE account_name ILIKE '%advertising%' AND txn_date >= ${cutStr}::date GROUP BY 1`));
  const bookedMap = new Map<string, number>(booked.map((r) => [r.mo, num(r.booked)]));

  // Compliant Meta tracker snapshots (non-Windsor), split across the calendar months
  // each window touches and overlap-collapsed so duplicate/rolling windows don't pile up.
  const metaSnapMap = new Map<string, number>();
  try {
    const allSnaps = (await storage.getActiveMarketingSpendSnapshots()) as any[];
    const metaSnaps = filterCompliantSnapshots(
      allSnaps.filter((s) => normalizeAdPlatform(String(s.platform || "")) === "META"),
    );
    for (const s of collapseOverlappingSnapshots(metaSnaps)) {
      const ps = String(s.periodStart || s.period_start || "");
      const pe = String(s.periodEnd || s.period_end || "");
      for (const part of monthlyOverlapSplit(ps, pe, num(s.spend))) {
        metaSnapMap.set(part.month, r2((metaSnapMap.get(part.month) ?? 0) + part.spend));
      }
    }
  } catch { /* no snapshots → Meta falls back to QB */ }

  const allMonths = new Set<string>(
    [
      ...Array.from(qbMap.keys()), ...Array.from(admMap.keys()),
      ...Array.from(bookedMap.keys()), ...Array.from(metaSnapMap.keys()),
    ].filter((m) => m >= cutStr.slice(0, 7)),
  );

  return Array.from(allMonths).sort().map((mo) =>
    assembleMonth(mo, {
      qbGoogle: qbMap.has(mo) ? num(qbMap.get(mo).qb_google) : null,
      qbMeta: qbMap.has(mo) ? num(qbMap.get(mo).qb_meta) : null,
      metaSnap: metaSnapMap.has(mo) ? metaSnapMap.get(mo)! : null,
      amazon: admMap.has(mo) ? num(admMap.get(mo).amazon) : null,
      pinterest: admMap.has(mo) ? num(admMap.get(mo).pinterest) : null,
      booked: bookedMap.has(mo) ? bookedMap.get(mo)! : null,
    }),
  );
}
