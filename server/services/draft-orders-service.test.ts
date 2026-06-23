import { describe, it, expect } from "vitest";
import { summarizeDraftOrders, type DraftOrder } from "./draft-orders-service";

const NOW = Date.UTC(2026, 5, 23, 18); // 2026-06-23, ~noon Denver

const draft = (name: string, createdAt: string, totalPrice: number): DraftOrder => ({
  name, status: "open", createdAt, updatedAt: createdAt, totalPrice, currency: "USD",
});

describe("summarizeDraftOrders", () => {
  const drafts = [
    draft("#D1034", "2026-06-21T20:09:50Z", 347.97),
    draft("#D989", "2026-06-05T17:23:49Z", 272.93),
    draft("#D977", "2026-05-30T17:26:08Z", 278.38),   // last month → pipeline only
    draft("#D509", "2025-12-03T18:20:39Z", 2159.99),  // oldest open
  ];

  it("totals the full open pipeline regardless of create date", () => {
    const v = summarizeDraftOrders(drafts, NOW);
    expect(v.pipeline.count).toBe(4);
    expect(v.pipeline.totalValue).toBe(3059.27);
    expect(v.pipeline.avgValue).toBe(764.82);
  });

  it("ages the oldest open draft in days", () => {
    const v = summarizeDraftOrders(drafts, NOW);
    expect(v.pipeline.oldestOpenDays).toBeGreaterThan(180); // Dec 2025 → Jun 2026
  });

  it("counts only this-month drafts in the daily-created view (store-local)", () => {
    const v = summarizeDraftOrders(drafts, NOW);
    expect(v.createdThisMonth.count).toBe(2);
    expect(v.createdThisMonth.totalValue).toBe(620.9);
    expect(v.daily.map((d) => d.date)).toEqual(["2026-06-05", "2026-06-21"]);
    expect(v.bestDay?.date).toBe("2026-06-21");
    expect(v.periodLabel).toBe("Jun 1–23, 2026");
  });

  it("returns an empty-but-valid shape with no drafts", () => {
    const v = summarizeDraftOrders([], NOW);
    expect(v.pipeline.count).toBe(0);
    expect(v.pipeline.oldestOpenDays).toBeNull();
    expect(v.daily).toEqual([]);
    expect(v.bestDay).toBeNull();
  });
});
