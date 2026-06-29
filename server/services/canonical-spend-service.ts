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
  bookedMarketingTotal: number | null; // QB total Advertising (MER denominator)
  otherMarketing: number | null; // booked − channelTotal (agency/creative/etc.)
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

  const amazon: ChannelSpend = has(inp.amazon) && (inp.amazon as number) > 0
    ? { spend: r2(inp.amazon as number), source: "ad_metrics", confidence: "medium", understated: false }
    : { spend: null, source: "none", confidence: "low", understated: false, gapReason: "no Amazon ad spend captured" };

  const pinterest: ChannelSpend = has(inp.pinterest) && (inp.pinterest as number) > 0
    ? { spend: r2(inp.pinterest as number), source: "ad_metrics", confidence: "medium", understated: false }
    : { spend: null, source: "none", confidence: "low", understated: false, gapReason: "no Pinterest spend" };

  const byChannel = { GOOGLE: google, META: meta, AMAZON: amazon, PINTEREST: pinterest } as Record<Channel, ChannelSpend>;
  const channelTotal = r2(CHANNELS.reduce((s, c) => s + (byChannel[c].spend ?? 0), 0));
  const bookedMarketingTotal = has(inp.booked) ? r2(inp.booked as number) : null;
  const otherMarketing = bookedMarketingTotal != null ? r2(bookedMarketingTotal - channelTotal) : null;
  return { month, byChannel, channelTotal, bookedMarketingTotal, otherMarketing };
}

/** DB (read-only): gather all per-channel sources and assemble the canonical series. */
export async function getCanonicalMonthlySpendByChannel(db: any, monthsBack = 12): Promise<MonthSpend[]> {
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
