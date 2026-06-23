import { describe, it, expect } from "vitest";
import { computeShopifyPeriod, computeAmazonPeriod, computeChannelPeriod } from "./shopify-period-service";

// Mock db.execute: first call returns the daily rows, second returns the period meta.
function mockDb(daily: any[], meta: any) {
  let call = 0;
  return {
    execute: async () => {
      call += 1;
      return { rows: call === 1 ? daily : [meta] };
    },
  } as any;
}

const META = {
  period_start: "2026-06-01",
  today: "2026-06-22",
  days_in_month: 30,
  day_of_month: 22,
  refreshed_at: "02:35 PM",
  today_label: "Jun 22",
};

describe("computeShopifyPeriod", () => {
  it("aggregates totals, best day, AOV, and a run-rate projection", async () => {
    const daily = [
      { date: "2026-06-01", orders: 9, gross: 2570.33, refunds: 0 },
      { date: "2026-06-02", orders: 12, gross: 8766.16, refunds: 0 },
      { date: "2026-06-22", orders: 13, gross: 5259.01, refunds: 0 },
    ];
    const v = await computeShopifyPeriod(mockDb(daily, META), Date.UTC(2026, 5, 22, 18));
    expect(v.available).toBe(true);
    expect(v.totals.totalSales).toBe(16595.5); // sum of gross
    expect(v.totals.orders).toBe(34);
    expect(v.metrics.days).toBe(3);
    expect(v.metrics.bestDay?.date).toBe("2026-06-02");
    expect(v.metrics.avgOrderValue).toBe(488.1); // 16595.5 / 34
    // run-rate: total / elapsed(22) * daysInMonth(30)
    expect(v.metrics.projectedMonth).toBe(22630.23);
    expect(v.periodLabel).toBe("Jun 1–22, 2026");
  });

  it("nets refunds out of net sales but keeps total gross", async () => {
    const daily = [{ date: "2026-06-10", orders: 5, gross: 1000, refunds: 150 }];
    const v = await computeShopifyPeriod(mockDb(daily, META), Date.UTC(2026, 5, 22, 18));
    expect(v.totals.totalSales).toBe(1000);
    expect(v.totals.refunds).toBe(150);
    expect(v.totals.netSales).toBe(850);
  });

  it("returns an unavailable view with a message when there are no orders", async () => {
    const v = await computeShopifyPeriod(mockDb([], META), Date.UTC(2026, 5, 22, 18));
    expect(v.available).toBe(false);
    expect(v.message).toMatch(/no shopify orders/i);
    expect(v.totals.totalSales).toBe(0);
  });

  it("labels the channel in source + empty message (Amazon wrapper)", async () => {
    const daily = [{ date: "2026-06-10", orders: 5, gross: 1000, refunds: 0 }];
    const v = await computeAmazonPeriod(mockDb(daily, META), Date.UTC(2026, 5, 22, 18));
    expect(v.source).toMatch(/Amazon channel/);
    const empty = await computeAmazonPeriod(mockDb([], META), Date.UTC(2026, 5, 22, 18));
    expect(empty.message).toMatch(/no amazon orders/i);
  });

  it("computeChannelPeriod parameterizes the channel directly", async () => {
    const daily = [{ date: "2026-06-10", orders: 2, gross: 500, refunds: 0 }];
    const v = await computeChannelPeriod(mockDb(daily, META), "SHOPIFY", Date.UTC(2026, 5, 22, 18));
    expect(v.source).toMatch(/Shopify channel/);
    expect(v.totals.totalSales).toBe(500);
  });
});
