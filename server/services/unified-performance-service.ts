/**
 * CIPH.R Unified Performance Hub — Stage B merge engine.
 *
 * Joins sales (daily_sales_snapshots / sales orders), live ad metrics
 * (ad_metrics_daily) and uploaded ad-spend rollups (marketing_spend_snapshots)
 * into one view model over a date window: Blended ROAS, MER, and True Net Margin
 * per SKU.
 *
 * PER-PLATFORM PRECEDENCE (never double-count): for each ad platform, LIVE
 * ad_metrics_daily wins; an uploaded marketing_spend_snapshot only fills a
 * platform that has NO live data in the window. So a Meta CSV backfills the
 * missing half while Google's live numbers stay authoritative.
 *
 * ANTI-HALLUCINATION: nothing is invented. Missing inputs become dataGaps[]
 * entries (e.g. "DATA GAPPED: Ad Spend Missing for <range>") and the relevant
 * metric is null — never 0 or Infinity. ROAS/MER are null when ad/marketing
 * spend is 0 or unknown. Allocated SKU ad spend is explicitly labeled
 * (sku_live vs allocated) so a derived split is never mistaken for measured data.
 *
 * The metric math is a PURE function over plain inputs (computeUnifiedPerformance)
 * and is unit-tested without any DB.
 */
import { storage } from "../storage";

export interface PlatformSpend { spend: number; impressions?: number | null; clicks?: number | null; }
export interface MergedPlatform { platform: string; spend: number; impressions: number | null; clicks: number | null; source: "windsor" | "live" | "uploaded"; }
export interface SkuInput {
  sku: string;
  name?: string | null;
  revenue: number | null;
  unitsSold: number;
  unitCost: number | null;
  shippingPerUnit?: number | null;
  liveAdSpend?: number | null; // measured SKU-level ad spend from ad_metrics_daily
}
export interface UnifiedInput {
  periodStart: string | null;
  periodEnd: string | null;
  rangeLabel: string;
  revenue: { totalSales: number | null; netSales: number | null };
  live: Record<string, PlatformSpend>;
  uploaded: Record<string, PlatformSpend>;
  windsor?: Record<string, PlatformSpend>;
  marketingExtra?: number; // non-ad marketing cost (e.g. P&L Advertising minus tracked spend); default 0
  plMarketing?: number | null; // booked "Advertising & Marketing" for the window (for display); MER denominator
  skus: SkuInput[];
}
export interface SkuMargin {
  sku: string; name?: string | null;
  revenue: number | null; unitsSold: number;
  cogs: number | null; shipping: number | null; allocatedAdSpend: number | null;
  adSpendBasis: "sku_live" | "allocated" | "none";
  trueNetMargin: number | null; marginPct: number | null;
  dataGaps: string[];
}
export interface UnifiedView {
  rangeLabel: string; periodStart: string | null; periodEnd: string | null;
  totalRevenue: number | null; netRevenue: number | null;
  totalAdSpend: number | null; totalMarketingSpend: number | null;
  plMarketing: number | null; // booked Advertising & Marketing (prorated to window) — MER denominator basis
  platforms: MergedPlatform[];
  blendedRoas: number | null; mer: number | null;
  skus: SkuMargin[];
  dataGaps: string[];
  status: "OK" | "DATA_GAPPED";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Collapse OVERLAPPING ad-spend snapshots, keeping the latest period_end among
 * any overlapping set; genuinely distinct (non-overlapping) periods are all
 * kept. Windsor emits a fresh rolling-30d window daily that never exact-matches
 * the prior period, so without this they accumulate and inflate spend (the
 * 2026-06 ~6.5x bug). Pure — unit tested.
 */
export function collapseOverlappingSnapshots<T extends { periodStart?: string | null; periodEnd?: string | null }>(snaps: T[]): T[] {
  // Snapshots without a usable period can't be overlap-compared — keep them
  // as-is rather than letting an empty-string period act as a wildcard.
  const withPeriod = snaps.filter((s) => s.periodStart && s.periodEnd);
  const withoutPeriod = snaps.filter((s) => !(s.periodStart && s.periodEnd));
  const sorted = [...withPeriod].sort((a, b) =>
    String(b.periodEnd).localeCompare(String(a.periodEnd)));
  const kept: T[] = [];
  for (const s of sorted) {
    const ps = String(s.periodStart);
    const pe = String(s.periodEnd);
    // STRICT overlap: two windows that merely touch at a single boundary date
    // (A.end == B.start) are NOT overlapping — keep both (back-to-back uploads).
    // Windsor's rolling windows overlap by ~29 days so they still collapse.
    const overlapsKept = kept.some(
      (k) => String(k.periodStart) < pe && String(k.periodEnd) > ps,
    );
    if (!overlapsKept) kept.push(s);
  }
  return [...kept, ...withoutPeriod];
}

/**
 * Map a raw ad_metrics_daily.platform value to a canonical AD platform, or null
 * if it is a traffic source (DIRECT, NOT SET, YAHOO, DUCKDUCKGO, organic
 * YOUTUBE/REDDIT/IG, etc.) rather than paid media. Mirrors the Finances overview
 * normalizer so the unified view never mislabels a traffic source as an ad
 * platform. ad_metrics_daily is polluted with analytics traffic rows (spend 0),
 * which would otherwise show as $0 "live" platforms.
 */
export function normalizeAdPlatform(raw: string): string | null {
  const s = (raw || "").toLowerCase();
  if (s.includes("google")) return "GOOGLE";
  if (s.includes("meta") || s === "fb" || s.includes("facebook") || s === "ig" || s.includes("instagram")) return "META";
  if (s.includes("amazon")) return "AMAZON";
  if (s.includes("pinterest")) return "PINTEREST";
  if (s.includes("microsoft") || s.includes("bing")) return "MICROSOFT";
  if (s.includes("tiktok")) return "TIKTOK";
  return null; // traffic source, not a paid-ad platform
}

const MONTH_NUM: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * Prorate the booked "Advertising & Marketing" P&L expense across a date window.
 * monthly_financials is monthly ("May 2026"); the unified view uses a rolling
 * day window — so for each month we take the share of its marketing equal to the
 * fraction of that month inside the window. coveredDays vs windowDays tells the
 * caller whether the window extends past the latest booked month (e.g. the
 * current month isn't closed yet) so MER can be flagged rather than understated.
 * ANTI-HALLUCINATION: months with no row / null marketing contribute nothing and
 * are NOT covered — never back-filled from another month.
 */
export function proratePLMarketing(
  rows: { month: string; marketing: number | null }[],
  start: string,
  end: string,
): { total: number; coveredDays: number; windowDays: number; monthsUsed: string[] } {
  const day = 86400000;
  const ws = Date.parse(start + "T00:00:00Z");
  const weExcl = Date.parse(end + "T00:00:00Z") + day; // make end inclusive
  const windowDays = Math.max(0, Math.round((weExcl - ws) / day));
  let total = 0;
  let coveredDays = 0;
  const monthsUsed: string[] = [];
  for (const r of rows || []) {
    const m = String(r.month || "").trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
    if (!m) continue;
    const mo = MONTH_NUM[m[1].toLowerCase()];
    if (mo == null) continue;
    const year = Number(m[2]);
    const mStart = Date.UTC(year, mo, 1);
    const mEndExcl = Date.UTC(year, mo + 1, 1);
    const daysInMonth = Math.round((mEndExcl - mStart) / day);
    const overlap = Math.max(0, Math.min(mEndExcl, weExcl) - Math.max(mStart, ws)) / day;
    if (overlap <= 0) continue;
    coveredDays += overlap;
    if (r.marketing != null) {
      total += r.marketing * (overlap / daysInMonth);
      monthsUsed.push(r.month);
    }
  }
  return { total: r2(total), coveredDays: Math.round(coveredDays), windowDays, monthsUsed };
}

/**
 * Merge live + uploaded ad spend with per-platform precedence.
 * Live wins ONLY when it has non-zero spend; otherwise an uploaded snapshot
 * fills the platform. Exactly one source per platform → never double-counted.
 */
export function mergeAdSpendByPlatform(
  live: Record<string, PlatformSpend>,
  uploaded: Record<string, PlatformSpend>,
  windsor: Record<string, PlatformSpend> = {},
): { platforms: MergedPlatform[]; totalAdSpend: number | null } {
  const upper = (rec: Record<string, PlatformSpend>) => {
    const m: Record<string, PlatformSpend> = {};
    for (const [k, v] of Object.entries(rec || {})) m[k.toUpperCase()] = v;
    return m;
  };
  const W = upper(windsor);
  const L = upper(live);
  const U = upper(uploaded);
  const out: MergedPlatform[] = [];
  for (const p of Array.from(new Set([...Object.keys(W), ...Object.keys(L), ...Object.keys(U)]))) {
    const w = W[p];
    const l = L[p];
    const u = U[p];
    // SOURCE HIERARCHY: Windsor is authoritative (direct from each platform's
    // API) and wins whenever it has real spend — the live ad_metrics_daily feed
    // proved inflated (~2.7x on Google from double-summed dimension rows), so it
    // sits at the bottom. Manual uploads (e.g. the Meta CSV) fill platforms
    // Windsor doesn't cover. Exactly one source per platform.
    let chosen: PlatformSpend;
    let source: "windsor" | "live" | "uploaded";
    if (w && (w.spend || 0) > 0) { chosen = w; source = "windsor"; }
    else if (u && (u.spend || 0) > 0) { chosen = u; source = "uploaded"; }
    else if (l && (l.spend || 0) > 0) { chosen = l; source = "live"; }
    else if (w) { chosen = w; source = "windsor"; }
    else if (u) { chosen = u; source = "uploaded"; }
    else { chosen = l; source = "live"; }
    out.push({ platform: p, spend: r2(chosen.spend || 0), impressions: chosen.impressions ?? null, clicks: chosen.clicks ?? null, source });
  }
  out.sort((a, b) => b.spend - a.spend);
  const totalAdSpend = out.length ? r2(out.reduce((s, p) => s + p.spend, 0)) : null;
  return { platforms: out, totalAdSpend };
}

export function computeUnifiedPerformance(input: UnifiedInput): UnifiedView {
  const dataGaps: string[] = [];
  const { platforms, totalAdSpend } = mergeAdSpendByPlatform(input.live, input.uploaded, input.windsor || {});

  const totalRevenue = input.revenue?.totalSales ?? null;
  const netRevenue = input.revenue?.netSales ?? null;
  if (totalRevenue == null) dataGaps.push("DATA GAPPED: Sales revenue missing for " + input.rangeLabel);
  if (totalAdSpend == null) dataGaps.push("DATA GAPPED: Ad Spend Missing for " + input.rangeLabel);

  const marketingExtra = input.marketingExtra ?? 0;
  const totalMarketingSpend = totalAdSpend == null && marketingExtra === 0 ? null : r2((totalAdSpend ?? 0) + marketingExtra);

  const blendedRoas = totalRevenue != null && totalAdSpend != null && totalAdSpend > 0 ? r2(totalRevenue / totalAdSpend) : null;
  const mer = totalRevenue != null && totalMarketingSpend != null && totalMarketingSpend > 0 ? r2(totalRevenue / totalMarketingSpend) : null;

  // Per-SKU true net margin.
  const skus: SkuMargin[] = (input.skus || []).map((s) => {
    const gaps: string[] = [];
    const cogs = s.unitCost != null ? r2(s.unitsSold * s.unitCost) : null;
    if (cogs == null) gaps.push("DATA GAPPED: unit cost");
    let shipping: number | null;
    if (s.shippingPerUnit != null) {
      shipping = r2(s.unitsSold * s.shippingPerUnit);
    } else {
      shipping = 0; // not available per SKU — treated as 0 and flagged, never invented
      gaps.push("DATA GAPPED: shipping not allocated");
    }

    let allocatedAdSpend: number | null;
    let adSpendBasis: SkuMargin["adSpendBasis"];
    if (s.liveAdSpend != null) {
      allocatedAdSpend = r2(s.liveAdSpend);
      adSpendBasis = "sku_live";
    } else if (totalAdSpend != null && totalAdSpend > 0 && totalRevenue != null && totalRevenue > 0 && s.revenue != null) {
      allocatedAdSpend = r2(totalAdSpend * (s.revenue / totalRevenue)); // proportional allocation (labeled)
      adSpendBasis = "allocated";
    } else {
      allocatedAdSpend = totalAdSpend == null ? null : 0;
      adSpendBasis = "none";
    }

    const canMargin = s.revenue != null && cogs != null;
    const trueNetMargin = canMargin ? r2(s.revenue! - cogs! - (shipping ?? 0) - (allocatedAdSpend ?? 0)) : null;
    const marginPct = trueNetMargin != null && s.revenue != null && s.revenue > 0 ? r2((trueNetMargin / s.revenue) * 100) : null;

    return {
      sku: s.sku, name: s.name ?? null, revenue: s.revenue, unitsSold: s.unitsSold,
      cogs, shipping, allocatedAdSpend, adSpendBasis, trueNetMargin, marginPct, dataGaps: gaps,
    };
  });

  const skusMissingCost = skus.filter((s) => s.cogs == null).length;
  if (skusMissingCost > 0) dataGaps.push(`DATA GAPPED: unit cost for ${skusMissingCost} SKU(s)`);

  return {
    rangeLabel: input.rangeLabel,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    totalRevenue,
    netRevenue,
    totalAdSpend,
    totalMarketingSpend,
    plMarketing: input.plMarketing ?? null,
    platforms,
    blendedRoas,
    mer,
    skus: skus.sort((a, b) => (b.trueNetMargin ?? -Infinity) - (a.trueNetMargin ?? -Infinity)),
    dataGaps,
    status: dataGaps.length ? "DATA_GAPPED" : "OK",
  };
}

// ---- async aggregator: build UnifiedInput from storage, then compute ----

const isoDaysAgo = (d: number, now: number) => new Date(now - d * 86400000).toISOString().slice(0, 10);

export async function getUnifiedPerformance(days = 30, nowMs?: number): Promise<UnifiedView> {
  const now = nowMs ?? new Date(0).getTime(); // caller passes Date.now(); default epoch keeps this deterministic in tests
  const end = isoDaysAgo(0, now);
  const start = isoDaysAgo(days, now);
  const rangeLabel = `${start} → ${end}`;

  // --- revenue (window) ---
  let totalSales: number | null = null;
  let netSales: number | null = null;
  try {
    const snaps = await storage.getDailySalesSnapshotsInRange(start, end);
    if (snaps.length) {
      totalSales = r2(snaps.reduce((s, x: any) => s + (Number(x.totalRevenue) || 0), 0));
      netSales = r2(snaps.reduce((s, x: any) => s + (Number(x.netRevenue) || 0), 0));
    }
  } catch { /* fall through to order-based revenue */ }

  // --- per-SKU revenue/units (window) from sales order lines ---
  const skuAgg = new Map<string, { revenue: number; units: number; name?: string | null; hasPrice: boolean }>();
  try {
    const orders = await storage.getSalesOrdersByDateRange(new Date(start), new Date(end + "T23:59:59"));
    if (totalSales == null && orders.length) {
      totalSales = r2(orders.reduce((s, o: any) => s + (Number(o.totalAmount) || 0), 0));
      netSales = r2(orders.reduce((s, o: any) => s + ((Number(o.totalAmount) || 0) - (Number(o.totalRefundAmount) || 0)), 0));
    }
    for (const o of orders) {
      const lines = await storage.getSalesOrderLines((o as any).id);
      for (const l of lines as any[]) {
        const cur = skuAgg.get(l.sku) || { revenue: 0, units: 0, name: l.productName, hasPrice: false };
        const units = (l.qtyOrdered || 0) - (l.returnedQty || 0);
        cur.units += units;
        if (l.unitPrice != null) { cur.revenue += units * Number(l.unitPrice); cur.hasPrice = true; }
        skuAgg.set(l.sku, cur);
      }
    }
  } catch { /* sku-level revenue stays partial */ }

  // --- item costs ---
  const costBySku = new Map<string, number | null>();
  try {
    const items = await storage.getAllItems();
    for (const it of items as any[]) {
      if (it.sku) costBySku.set(it.sku, it.defaultPurchaseCost != null ? Number(it.defaultPurchaseCost) : null);
    }
  } catch { /* costs unknown → dataGaps per sku */ }

  // --- ad spend (live, by platform + by sku) ---
  const live: Record<string, PlatformSpend> = {};
  const liveAdBySku = new Map<string, number>();
  try {
    const rows = await storage.getAdMetricsInRange(start, end);
    for (const m of rows as any[]) {
      const p = normalizeAdPlatform(String(m.platform || ""));
      if (!p) continue; // skip traffic-source rows (DIRECT, NOT SET, …) — not paid ads
      const cur = live[p] || { spend: 0, impressions: 0, clicks: 0 };
      cur.spend += Number(m.spend) || 0;
      cur.impressions = (cur.impressions || 0) + (Number(m.impressions) || 0);
      cur.clicks = (cur.clicks || 0) + (Number(m.clicks) || 0);
      live[p] = cur;
      if (m.sku && m.sku !== "_all") liveAdBySku.set(m.sku, (liveAdBySku.get(m.sku) || 0) + (Number(m.spend) || 0));
    }
  } catch { /* no live ad data */ }

  // --- ad spend snapshots, split by source: Windsor (authoritative, source
  // 'windsor:*') vs manual uploads (Meta CSV, etc.). Windsor outranks both the
  // manual uploads and the inflated live feed in the merge. ---
  const windsor: Record<string, PlatformSpend> = {};
  const uploaded: Record<string, PlatformSpend> = {};
  try {
    const snaps = await storage.getMarketingSpendSnapshotsInRange(start, end);
    // Group by (source-bucket, platform) and COLLAPSE overlapping snapshots
    // before summing. Windsor emits a new rolling-30d window every day that
    // never exact-period-matches the prior (so reconcile never supersedes it),
    // and they accumulate — summing all 7 active GOOGLE rolling windows inflated
    // spend ~6.5x ($70,994 vs the correct ~$10,868) and collapsed blended ROAS
    // below the pause floor, tripping false September-Rule directives (2026-06).
    const groups = new Map<string, any[]>();
    for (const s of snaps as any[]) {
      const p = String(s.platform || "OTHER").toUpperCase();
      const src = String(s.source || "").toLowerCase().startsWith("windsor") ? "windsor" : "uploaded";
      const key = `${src}|${p}`;
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
    for (const [key, group] of Array.from(groups.entries())) {
      const [src, p] = key.split("|");
      const bucket = src === "windsor" ? windsor : uploaded;
      const cur = bucket[p] || { spend: 0, impressions: 0, clicks: 0 };
      for (const s of collapseOverlappingSnapshots(group)) {
        cur.spend += Number(s.spend) || 0;
        if (s.impressions != null) cur.impressions = (cur.impressions || 0) + Number(s.impressions);
        if (s.clicks != null) cur.clicks = (cur.clicks || 0) + Number(s.clicks);
      }
      bucket[p] = cur;
    }
  } catch { /* no snapshot ad data */ }

  const skus: SkuInput[] = Array.from(skuAgg.entries()).map(([sku, a]) => ({
    sku,
    name: a.name,
    revenue: a.hasPrice ? r2(a.revenue) : null,
    unitsSold: a.units,
    unitCost: costBySku.has(sku) ? costBySku.get(sku)! : null,
    shippingPerUnit: null, // per-SKU shipping not tracked → flagged in the view
    liveAdSpend: liveAdBySku.has(sku) ? r2(liveAdBySku.get(sku)!) : null,
  }));

  // --- booked marketing (P&L "Advertising & Marketing") prorated to the window ---
  // MER denominator = total booked marketing; marketingExtra is the part NOT
  // already counted in tracked ad spend (untracked channels, agency fees, etc.),
  // so adSpend + extra never double-counts. Falls back to tracked ad spend when
  // no P&L is available.
  let plMarketing: number | null = null;
  let marketingExtra = 0;
  let plCoverageNote: string | null = null;
  try {
    const months = await storage.getMonthlyFinancials();
    const rows = (months as any[]).map((m) => {
      const cats = (m.expenseCategories || {}) as Record<string, number>;
      const v = cats["Advertising & Marketing"];
      return { month: String(m.month), marketing: v != null ? Number(v) : null };
    });
    const pr = proratePLMarketing(rows, start, end);
    if (pr.monthsUsed.length) {
      plMarketing = pr.total;
      const { totalAdSpend } = mergeAdSpendByPlatform(live, uploaded, windsor);
      marketingExtra = Math.max(0, r2(pr.total - (totalAdSpend ?? 0)));
      if (pr.coveredDays < pr.windowDays - 1) {
        const missing = pr.windowDays - pr.coveredDays;
        plCoverageNote = `DATA GAPPED: P&L marketing not booked for ${missing} of ${pr.windowDays} day(s) — MER may understate`;
      }
    }
  } catch { /* no monthly P&L → MER falls back to ad spend */ }

  const view = computeUnifiedPerformance({
    periodStart: start,
    periodEnd: end,
    rangeLabel,
    revenue: { totalSales, netSales },
    live,
    uploaded,
    windsor,
    marketingExtra,
    plMarketing,
    skus,
  });
  if (plCoverageNote && !view.dataGaps.includes(plCoverageNote)) {
    view.dataGaps.push(plCoverageNote);
    view.status = "DATA_GAPPED";
  }
  return view;
}
