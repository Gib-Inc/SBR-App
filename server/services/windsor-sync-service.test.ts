import { describe, it, expect } from "vitest";
import { aggregateWindsorRows } from "./windsor-sync-service";

describe("aggregateWindsorRows", () => {
  it("sums spend/clicks/impressions and derives the period from daily rows", () => {
    const rows = [
      { date: "2026-05-08", spend: 100.5, clicks: 10, impressions: 1000 },
      { date: "2026-05-09", spend: 200.25, clicks: 20, impressions: 2000 },
      { date: "2026-05-07", spend: 50, clicks: 5, impressions: 500 },
    ];
    const a = aggregateWindsorRows(rows, ["spend"]);
    expect(a.spend).toBe(350.75);
    expect(a.clicks).toBe(35);
    expect(a.impressions).toBe(3500);
    expect(a.periodStart).toBe("2026-05-07"); // min
    expect(a.periodEnd).toBe("2026-05-09"); // max
    expect(a.rowCount).toBe(3);
  });

  it("sums across multiple spend columns (Amazon SP+SD+SB) ignoring missing ones", () => {
    const rows = [
      { date: "2026-05-08", sponsored_products_campaign__spend: 80 },
      { date: "2026-05-08", sponsored_display_campaign__cost: 1 },
      { date: "2026-05-09", sponsored_brands_campaign_non_video__cost: 5 },
    ];
    const a = aggregateWindsorRows(rows, ["sponsored_products_campaign__spend", "sponsored_display_campaign__cost", "sponsored_brands_campaign_non_video__cost"]);
    expect(a.spend).toBe(86);
    expect(a.clicks).toBeNull(); // no clicks column → null, not 0
    expect(a.periodStart).toBe("2026-05-08");
    expect(a.periodEnd).toBe("2026-05-09");
  });

  it("handles an empty payload", () => {
    const a = aggregateWindsorRows([], ["spend"]);
    expect(a.spend).toBe(0);
    expect(a.periodStart).toBeNull();
    expect(a.rowCount).toBe(0);
  });
});
