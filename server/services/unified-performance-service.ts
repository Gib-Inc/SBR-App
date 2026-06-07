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
export interface MergedPlatform { platform: string; spend: number; impressions: number | null; clicks: number | null; source: "live" | "uploaded"; }
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
  marketingExtra?: number; // non-ad marketing cost (e.g. P&L Advertising minus tracked spend); default 0
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
  platforms: MergedPlatform[];
  blendedRoas: number | null; mer: number | null;
  skus: SkuMargin[];
  dataGaps: string[];
  status: "OK" | "DATA_GAPPED";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Merge live + uploaded ad spend with per-platform precedence.
 * Live wins; uploaded fills only platforms with no live row in the window.
 */
export function mergeAdSpendByPlatform(
  live: Record<string, PlatformSpend>,
  uploaded: Record<string, PlatformSpend>,
): { platforms: MergedPlatform[]; totalAdSpend: number | null } {
  const out: MergedPlatform[] = [];
  const seen = new Set<string>();
  for (const [platform, v] of Object.entries(live || {})) {
    const p = platform.toUpperCase();
    seen.add(p);
    out.push({ platform: p, spend: r2(v.spend || 0), impressions: v.impressions ?? null, clicks: v.clicks ?? null, source: "live" });
  }
  for (const [platform, v] of Object.entries(uploaded || {})) {
    const p = platform.toUpperCase();
    if (seen.has(p)) continue; // live already covers this platform — do NOT add (no double-count)
    seen.add(p);
    out.push({ platform: p, spend: r2(v.spend || 0), impressions: v.impressions ?? null, clicks: v.clicks ?? null, source: "uploaded" });
  }
  out.sort((a, b) => b.spend - a.spend);
  const totalAdSpend = out.length ? r2(out.reduce((s, p) => s + p.spend, 0)) : null;
  return { platforms: out, totalAdSpend };
}

export function computeUnifiedPerformance(input: UnifiedInput): UnifiedView {
  const dataGaps: string[] = [];
  const { platforms, totalAdSpend } = mergeAdSpendByPlatform(input.live, input.uploaded);

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
      const p = String(m.platform || "OTHER").toUpperCase();
      const cur = live[p] || { spend: 0, impressions: 0, clicks: 0 };
      cur.spend += Number(m.spend) || 0;
      cur.impressions = (cur.impressions || 0) + (Number(m.impressions) || 0);
      cur.clicks = (cur.clicks || 0) + (Number(m.clicks) || 0);
      live[p] = cur;
      if (m.sku && m.sku !== "_all") liveAdBySku.set(m.sku, (liveAdBySku.get(m.sku) || 0) + (Number(m.spend) || 0));
    }
  } catch { /* no live ad data */ }

  // --- ad spend (uploaded rollups, by platform) ---
  const uploaded: Record<string, PlatformSpend> = {};
  try {
    const snaps = await storage.getMarketingSpendSnapshotsInRange(start, end);
    for (const s of snaps as any[]) {
      const p = String(s.platform || "OTHER").toUpperCase();
      const cur = uploaded[p] || { spend: 0, impressions: 0, clicks: 0 };
      cur.spend += Number(s.spend) || 0;
      if (s.impressions != null) cur.impressions = (cur.impressions || 0) + Number(s.impressions);
      if (s.clicks != null) cur.clicks = (cur.clicks || 0) + Number(s.clicks);
      uploaded[p] = cur;
    }
  } catch { /* no uploaded ad data */ }

  const skus: SkuInput[] = Array.from(skuAgg.entries()).map(([sku, a]) => ({
    sku,
    name: a.name,
    revenue: a.hasPrice ? r2(a.revenue) : null,
    unitsSold: a.units,
    unitCost: costBySku.has(sku) ? costBySku.get(sku)! : null,
    shippingPerUnit: null, // per-SKU shipping not tracked → flagged in the view
    liveAdSpend: liveAdBySku.has(sku) ? r2(liveAdBySku.get(sku)!) : null,
  }));

  return computeUnifiedPerformance({
    periodStart: start,
    periodEnd: end,
    rangeLabel,
    revenue: { totalSales, netSales },
    live,
    uploaded,
    skus,
  });
}
