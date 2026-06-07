import { describe, it, expect } from "vitest";
import {
  mergeAdSpendByPlatform,
  computeUnifiedPerformance,
  normalizeAdPlatform,
  proratePLMarketing,
  type UnifiedInput,
} from "./unified-performance-service";

describe("proratePLMarketing", () => {
  it("takes a full month at face value", () => {
    const r = proratePLMarketing([{ month: "May 2026", marketing: 31000 }], "2026-05-01", "2026-05-31");
    expect(r.total).toBe(31000);
    expect(r.coveredDays).toBe(31);
    expect(r.windowDays).toBe(31);
    expect(r.monthsUsed).toEqual(["May 2026"]);
  });
  it("prorates a partial month and flags days the P&L doesn't cover", () => {
    // window May 8 – Jun 7 (31 days); only May is booked → 24/31 of May, June uncovered
    const r = proratePLMarketing([{ month: "May 2026", marketing: 31000 }], "2026-05-08", "2026-06-07");
    expect(r.windowDays).toBe(31);
    expect(r.coveredDays).toBe(24);
    expect(r.total).toBe(24000); // 31000 * 24/31
  });
  it("sums across two months by their in-window share", () => {
    const r = proratePLMarketing(
      [{ month: "May 2026", marketing: 31000 }, { month: "Jun 2026", marketing: 30000 }],
      "2026-05-16", "2026-06-15",
    );
    expect(r.coveredDays).toBe(31);
    expect(r.total).toBe(31000); // 31000*16/31 + 30000*15/30 = 16000 + 15000
  });
  it("never invents marketing for a month whose value is null", () => {
    const r = proratePLMarketing([{ month: "May 2026", marketing: null }], "2026-05-01", "2026-05-31");
    expect(r.total).toBe(0);
    expect(r.monthsUsed).toEqual([]);
    expect(r.coveredDays).toBe(31); // month is present (covered) but contributes nothing
  });
});

describe("normalizeAdPlatform", () => {
  it("maps real ad platforms to canonical keys", () => {
    expect(normalizeAdPlatform("GOOGLE")).toBe("GOOGLE");
    expect(normalizeAdPlatform("google_ads")).toBe("GOOGLE");
    expect(normalizeAdPlatform("FB")).toBe("META");
    expect(normalizeAdPlatform("facebook")).toBe("META");
    expect(normalizeAdPlatform("IG")).toBe("META");
    expect(normalizeAdPlatform("bing")).toBe("MICROSOFT");
    expect(normalizeAdPlatform("Amazon")).toBe("AMAZON");
  });
  it("returns null for traffic sources (never mislabeled as ad platforms)", () => {
    for (const t of ["DIRECT", "NOT SET", "YAHOO", "DUCKDUCKGO", "youtube.com", "reddit.com", ""]) {
      expect(normalizeAdPlatform(t)).toBeNull();
    }
  });
});

describe("mergeAdSpendByPlatform — per-platform precedence", () => {
  it("source hierarchy windsor > uploaded > live, one source per platform (no double-count)", () => {
    const { platforms, totalAdSpend } = mergeAdSpendByPlatform(
      { GOOGLE: { spend: 25279 }, META: { spend: 0 } },          // live: inflated Google, $0 Meta noise
      { META: { spend: 11733 }, GOOGLE: { spend: 9999 } },        // uploaded: manual CSVs
      { GOOGLE: { spend: 9234 }, AMAZON: { spend: 2630 } },       // windsor: authoritative
    );
    const g = platforms.find((p) => p.platform === "GOOGLE")!;
    expect(g.spend).toBe(9234); expect(g.source).toBe("windsor"); // windsor beats the inflated live 25279 AND uploaded 9999
    const a = platforms.find((p) => p.platform === "AMAZON")!;
    expect(a.spend).toBe(2630); expect(a.source).toBe("windsor"); // windsor fills (no live/upload)
    const m = platforms.find((p) => p.platform === "META")!;
    expect(m.spend).toBe(11733); expect(m.source).toBe("uploaded"); // no windsor/live → uploaded CSV wins
    expect(totalAdSpend).toBe(9234 + 2630 + 11733); // exactly one source each
  });

  it("returns null total when there is no ad data at all", () => {
    expect(mergeAdSpendByPlatform({}, {}).totalAdSpend).toBeNull();
  });

  it("a $0 live row does NOT shadow a real uploaded value (uploaded fills it)", () => {
    // Real case: fb/ig traffic normalizes to a META live row with spend 0, while
    // an uploaded Meta CSV has the real $11,733. The upload must win.
    const { platforms, totalAdSpend } = mergeAdSpendByPlatform(
      { GOOGLE: { spend: 24918 }, META: { spend: 0, impressions: 0, clicks: 0 } },
      { META: { spend: 11733.16, impressions: 1058254 } },
    );
    const meta = platforms.find((p) => p.platform === "META")!;
    expect(meta.spend).toBe(11733.16);
    expect(meta.source).toBe("uploaded");
    expect(platforms.find((p) => p.platform === "GOOGLE")!.source).toBe("live"); // live>0 still wins
    expect(totalAdSpend).toBe(36651.16); // 24918 + 11733.16
  });
});

const base = (over: Partial<UnifiedInput> = {}): UnifiedInput => ({
  periodStart: "2026-05-01", periodEnd: "2026-05-31", rangeLabel: "test-range",
  revenue: { totalSales: 15000, netSales: 14000 },
  live: { GOOGLE: { spend: 1000 } },
  uploaded: { META: { spend: 500 } },
  skus: [
    { sku: "A", name: "Item A", revenue: 9000, unitsSold: 90, unitCost: 30, liveAdSpend: 800 },
    { sku: "B", name: "Item B", revenue: 6000, unitsSold: 60, unitCost: null },
  ],
  ...over,
});

describe("computeUnifiedPerformance", () => {
  it("computes blended ROAS and MER over merged spend", () => {
    const v = computeUnifiedPerformance(base());
    expect(v.totalAdSpend).toBe(1500);
    expect(v.totalRevenue).toBe(15000);
    expect(v.blendedRoas).toBe(10); // 15000 / 1500
    expect(v.mer).toBe(10); // no extra marketing cost → equals ROAS
    expect(v.status).toBe("DATA_GAPPED"); // because SKU B has no unit cost + shipping gaps
  });

  it("adds non-ad marketing cost into MER but not ROAS", () => {
    const v = computeUnifiedPerformance(base({ marketingExtra: 500 }));
    expect(v.blendedRoas).toBe(10); // 15000/1500
    expect(v.totalMarketingSpend).toBe(2000);
    expect(v.mer).toBe(7.5); // 15000/2000
  });

  it("true net margin per SKU: sku_live ad spend vs proportional allocation", () => {
    const v = computeUnifiedPerformance(base());
    const a = v.skus.find((s) => s.sku === "A")!;
    expect(a.cogs).toBe(2700); // 90 * 30
    expect(a.shipping).toBe(0);
    expect(a.dataGaps).toContain("DATA GAPPED: shipping not allocated");
    expect(a.adSpendBasis).toBe("sku_live");
    expect(a.allocatedAdSpend).toBe(800);
    expect(a.trueNetMargin).toBe(5500); // 9000 - 2700 - 0 - 800
    expect(a.marginPct).toBe(61.11);

    const b = v.skus.find((s) => s.sku === "B")!;
    expect(b.cogs).toBeNull(); // missing unit cost → never invented
    expect(b.trueNetMargin).toBeNull();
    expect(b.adSpendBasis).toBe("allocated"); // proportional since no sku_live
    expect(b.allocatedAdSpend).toBe(600); // 1500 * (6000/15000)
    expect(b.dataGaps).toContain("DATA GAPPED: unit cost");
  });

  it("flags missing ad spend and leaves ROAS/MER null (never Infinity)", () => {
    const v = computeUnifiedPerformance(base({ live: {}, uploaded: {} }));
    expect(v.totalAdSpend).toBeNull();
    expect(v.blendedRoas).toBeNull();
    expect(v.mer).toBeNull();
    expect(v.dataGaps).toContain("DATA GAPPED: Ad Spend Missing for test-range");
  });

  it("ROAS is null (not Infinity) when ad spend is exactly 0", () => {
    const v = computeUnifiedPerformance(base({ live: { GOOGLE: { spend: 0 } }, uploaded: {} }));
    expect(v.totalAdSpend).toBe(0);
    expect(v.blendedRoas).toBeNull();
  });

  it("flags missing revenue", () => {
    const v = computeUnifiedPerformance(base({ revenue: { totalSales: null, netSales: null } }));
    expect(v.totalRevenue).toBeNull();
    expect(v.blendedRoas).toBeNull();
    expect(v.dataGaps.some((g) => g.includes("Sales revenue missing"))).toBe(true);
  });

  it("is OK with no gaps when all inputs are present", () => {
    const v = computeUnifiedPerformance(base({
      skus: [{ sku: "A", revenue: 15000, unitsSold: 100, unitCost: 30, shippingPerUnit: 2, liveAdSpend: 1500 }],
    }));
    expect(v.status).toBe("OK");
    expect(v.dataGaps).toHaveLength(0);
    const a = v.skus[0];
    expect(a.shipping).toBe(200); // 100 * 2
    expect(a.trueNetMargin).toBe(15000 - 3000 - 200 - 1500);
  });
});
