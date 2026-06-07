import { describe, it, expect } from "vitest";
import {
  mergeAdSpendByPlatform,
  computeUnifiedPerformance,
  type UnifiedInput,
} from "./unified-performance-service";

describe("mergeAdSpendByPlatform — per-platform precedence", () => {
  it("live wins; uploaded only fills platforms with no live data (no double-count)", () => {
    const { platforms, totalAdSpend } = mergeAdSpendByPlatform(
      { GOOGLE: { spend: 1000, impressions: 50000, clicks: 1000 } },
      { GOOGLE: { spend: 9999 }, META: { spend: 500, impressions: 20000, clicks: 400 } },
    );
    const google = platforms.find((p) => p.platform === "GOOGLE")!;
    const meta = platforms.find((p) => p.platform === "META")!;
    expect(google.spend).toBe(1000); // live, NOT the uploaded 9999
    expect(google.source).toBe("live");
    expect(meta.spend).toBe(500); // uploaded fills the gap
    expect(meta.source).toBe("uploaded");
    expect(totalAdSpend).toBe(1500); // 1000 + 500, never 1000+9999+500
  });

  it("returns null total when there is no ad data at all", () => {
    expect(mergeAdSpendByPlatform({}, {}).totalAdSpend).toBeNull();
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
