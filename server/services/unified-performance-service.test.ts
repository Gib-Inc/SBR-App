import { describe, it, expect } from "vitest";
import {
  mergeAdSpendByPlatform,
  computeUnifiedPerformance,
  normalizeAdPlatform,
  proratePLMarketing,
  overlapFraction,
  monthlyOverlapSplit,
  filterCompliantSnapshots,
  type UnifiedInput,
} from "./unified-performance-service";

describe("monthlyOverlapSplit (split a window across calendar months)", () => {
  it("a window inside one month returns one entry with the full spend", () => {
    expect(monthlyOverlapSplit("2026-06-01", "2026-06-09", 2652)).toEqual([{ month: "2026-06", spend: 2652 }]);
  });
  it("splits a straddling window by inclusive day-fraction (the Apr27-May19 Meta CSV)", () => {
    // Apr 27-30 = 4 days, May 1-19 = 19 days, total 23. $11,733 → 4/23 + 19/23.
    const parts = monthlyOverlapSplit("2026-04-27", "2026-05-19", 11733);
    expect(parts).toEqual([
      { month: "2026-04", spend: 2040.52 }, // 11733 * 4/23
      { month: "2026-05", spend: 9692.48 }, // 11733 * 19/23
    ]);
    // The split must conserve the total (no spend created or lost).
    expect(parts.reduce((s, p) => s + p.spend, 0)).toBeCloseTo(11733, 1);
  });
  it("handles a window spanning three months, conserving the total", () => {
    const parts = monthlyOverlapSplit("2026-05-15", "2026-07-10", 30000);
    expect(parts.map((p) => p.month)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(parts.reduce((s, p) => s + p.spend, 0)).toBeCloseTo(30000, 1);
  });
  it("a single-day window returns that month at full spend", () => {
    expect(monthlyOverlapSplit("2026-06-20", "2026-06-20", 8344.81)).toEqual([{ month: "2026-06", spend: 8344.81 }]);
  });
  it("degenerate / unparseable input returns [] (never fabricates a month)", () => {
    expect(monthlyOverlapSplit("2026-06-10", "2026-06-01", 100)).toEqual([]); // end before start
    expect(monthlyOverlapSplit("", "2026-06-01", 100)).toEqual([]);
    expect(monthlyOverlapSplit("not-a-date", "also-bad", 100)).toEqual([]);
  });
});

describe("filterCompliantSnapshots (Meta must never come from Windsor)", () => {
  const rows = [
    { platform: "META", source: "windsor:meta" },
    { platform: "FACEBOOK", source: "windsor:facebook_ads" },
    { platform: "META", source: "manual:meta-csv" },
    { platform: "META", source: "upload:facebook-tracker-june" },
    { platform: "GOOGLE", source: "windsor:google_ads" },
    { platform: "AMAZON", source: "windsor:amazon_ads" },
  ];
  it("drops Windsor Meta/Facebook rows but keeps compliant Meta + all other channels", () => {
    const out = filterCompliantSnapshots(rows);
    expect(out).toEqual([
      { platform: "META", source: "manual:meta-csv" },
      { platform: "META", source: "upload:facebook-tracker-june" },
      { platform: "GOOGLE", source: "windsor:google_ads" }, // Windsor Google is allowed
      { platform: "AMAZON", source: "windsor:amazon_ads" },
    ]);
  });
  it("is case-insensitive on the windsor source prefix and the Meta aliases", () => {
    expect(filterCompliantSnapshots([{ platform: "fb", source: "WINDSOR:meta" }])).toEqual([]);
    expect(filterCompliantSnapshots([{ platform: "Instagram", source: "Windsor:ig" }])).toEqual([]);
  });
  it("empty / missing input is safe", () => {
    expect(filterCompliantSnapshots([])).toEqual([]);
    expect(filterCompliantSnapshots(undefined as any)).toEqual([]);
  });
});

describe("overlapFraction (prorate windows to a query range)", () => {
  const RS = "2026-05-16", RE = "2026-06-15"; // a ~last-30-days range
  it("a window fully inside the range counts in full (factor 1)", () => {
    // Windsor rolling 30d window 05-16..06-14 — must NOT be prorated down.
    expect(overlapFraction("2026-05-16", "2026-06-14", RS, RE)).toBe(1);
  });
  it("a wide window only partially in range is prorated to its in-range slice", () => {
    // Meta upload 04-27..05-19 (23 days); only 05-16..05-19 = 4 days are in range.
    const f = overlapFraction("2026-04-27", "2026-05-19", RS, RE);
    expect(f).toBeCloseTo(4 / 23, 4);
    expect(Math.round(11733 * f)).toBe(2041); // $11,733 → ~$2,041, not full
  });
  it("a window fully inside but short counts in full", () => {
    expect(overlapFraction("2026-05-26", "2026-05-31", RS, RE)).toBe(1);
  });
  it("a window entirely outside the range contributes nothing (0)", () => {
    expect(overlapFraction("2026-01-01", "2026-01-31", RS, RE)).toBe(0);
  });
  it("missing/unparseable periods fail safe to 1 (never silently drop spend)", () => {
    expect(overlapFraction(null, "2026-06-14", RS, RE)).toBe(1);
    expect(overlapFraction("2026-05-16", "2026-06-14", null, RE)).toBe(1);
  });
});

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

import { collapseOverlappingSnapshots } from "./unified-performance-service";
describe("collapseOverlappingSnapshots (ad-spend overlap dedup — the 6.5x bug)", () => {
  it("collapses overlapping rolling-30d windows to the single latest", () => {
    const rolling = Array.from({ length: 7 }, (_, i) => ({
      periodStart: `2026-05-0${i + 1}`, periodEnd: `2026-06-0${i + 1}`, spend: 10000 + i,
    }));
    const kept = collapseOverlappingSnapshots(rolling);
    expect(kept).toHaveLength(1);
    expect(kept[0].periodEnd).toBe("2026-06-07");
  });
  it("keeps genuinely distinct non-overlapping periods (manual uploads)", () => {
    const distinct = [
      { periodStart: "2026-04-27", periodEnd: "2026-05-19", spend: 11733 },
      { periodStart: "2026-05-26", periodEnd: "2026-05-31", spend: 1770 },
      { periodStart: "2026-06-01", periodEnd: "2026-06-09", spend: 2651 },
    ];
    expect(collapseOverlappingSnapshots(distinct)).toHaveLength(3);
  });
  it("mixes correctly: drops the earlier overlapper, keeps the distinct one", () => {
    const mixed = [
      { periodStart: "2026-05-08", periodEnd: "2026-06-07", spend: 70 },
      { periodStart: "2026-05-01", periodEnd: "2026-05-31", spend: 50 },
      { periodStart: "2026-03-01", periodEnd: "2026-03-31", spend: 30 },
    ];
    expect(collapseOverlappingSnapshots(mixed).map((k) => k.periodEnd).sort()).toEqual(["2026-03-31", "2026-06-07"]);
  });
});

describe("collapseOverlappingSnapshots — code-review edge cases", () => {
  it("keeps both windows that merely touch at one boundary date (no spend loss)", () => {
    const backToBack = [
      { periodStart: "2026-04-01", periodEnd: "2026-04-30", spend: 5000 },
      { periodStart: "2026-04-30", periodEnd: "2026-05-31", spend: 8000 },
    ];
    expect(collapseOverlappingSnapshots(backToBack)).toHaveLength(2);
  });
  it("keeps (does not wildcard-suppress) snapshots with a null/empty period", () => {
    const withNull = [
      { periodStart: "2026-05-08", periodEnd: "2026-06-07", spend: 70 },
      { periodStart: null, periodEnd: null, spend: 12 },
    ];
    const kept = collapseOverlappingSnapshots(withNull as any);
    expect(kept).toHaveLength(2);
  });
  it("still collapses real multi-day-overlapping rolling windows", () => {
    const rolling = [
      { periodStart: "2026-05-08", periodEnd: "2026-06-07", spend: 11 },
      { periodStart: "2026-05-09", periodEnd: "2026-06-08", spend: 12 },
    ];
    expect(collapseOverlappingSnapshots(rolling)).toHaveLength(1);
  });
});
