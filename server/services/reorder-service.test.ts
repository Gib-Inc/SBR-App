import { describe, it, expect } from "vitest";
import { reorderLine, groupNeedsByVendor, type ReorderNeed } from "./reorder-service";

describe("reorderLine", () => {
  it("flags a stockout and refills to target", () => {
    const r = reorderLine({ weeklyDemand: 40, onHand: 0, onOrder: 0, leadTimeDays: 14, moq: 0 });
    expect(r.reorderPoint).toBe(160); // 40 × (2 lead + 1 review + 1 safety)
    expect(r.urgency).toBe("STOCKOUT");
    expect(r.needed).toBe(160);
    expect(r.suggestedOrderQty).toBe(200); // refill to target = 40 × 5
    expect(r.weeksCover).toBe(0);
  });

  it("is OK when well-stocked", () => {
    const r = reorderLine({ weeklyDemand: 10, onHand: 500, onOrder: 0, leadTimeDays: 14, moq: 0 });
    expect(r.needed).toBe(0);
    expect(r.urgency).toBe("OK");
    expect(r.suggestedOrderQty).toBe(0);
  });

  it("rounds the suggested qty up to the MOQ", () => {
    const r = reorderLine({ weeklyDemand: 5, onHand: 0, onOrder: 0, leadTimeDays: 7, moq: 50 });
    expect(r.suggestedOrderQty).toBe(50);
    expect(r.suggestedOrderQty % 50).toBe(0);
  });

  it("counts on-order toward the position", () => {
    const r = reorderLine({ weeklyDemand: 40, onHand: 0, onOrder: 200, leadTimeDays: 14, moq: 0 });
    expect(r.needed).toBe(0); // 200 on order already covers the 160 reorder point
    expect(r.urgency).toBe("OK");
  });
});

describe("groupNeedsByVendor", () => {
  const need = (sku: string, vendorId: string, vendorName: string, needed: number, est: number, urgency: any): ReorderNeed => ({
    itemId: sku, sku, name: sku, weeklyDemand: 10, onHand: 0, onOrder: 0, weeksCover: 0,
    leadTimeDays: 14, reorderPoint: 40, needed, suggestedOrderQty: needed, vendorId, vendorName,
    moq: 0, unitCost: 1, estReorderCost: est, urgency,
  });

  it("groups needed items by vendor, sums cost, and ranks by urgency", () => {
    const g = groupNeedsByVendor([
      need("A", "v1", "FX", 100, 500, "STOCKOUT"),
      need("B", "v1", "FX", 50, 250, "LOW"),
      need("C", "v2", "McMaster", 10, 50, "CRITICAL"),
      need("D", "v3", "Home Depot", 0, 0, "OK"), // not needed → excluded
    ]);
    expect(g).toHaveLength(2);
    expect(g[0].vendorName).toBe("FX"); // STOCKOUT outranks CRITICAL
    expect(g[0].lineCount).toBe(2);
    expect(g[0].estCost).toBe(750);
    expect(g[1].vendorName).toBe("McMaster");
  });
});
