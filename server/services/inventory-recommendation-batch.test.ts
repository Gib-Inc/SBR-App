/**
 * P1-4 — deterministic clamp tests for LLM inventory recommendations.
 *
 * The deterministic engine is the bounds oracle: the LLM's recommendedQty
 * must land within [max(MOQ, 75% of deterministic), 125% of deterministic]
 * or the deterministic quantity is used instead, and daysUntilStockout is
 * ALWAYS the deterministic context value (the LLM never sets it).
 */
import { describe, it, expect } from "vitest";
import { InventoryRecommendationBatch } from "./inventory-recommendation-batch";

// Fixture SKU context. Deterministic math for the base fixture:
//   coverageBuffer = 10 - 7 = 3 → riskLevel HIGH → action ORDER
//   targetStock = 10/day × (7 lead + 7 safety) = 140
//   calculatedQty = 140 - (100 available + 0 inbound) = 40
//   → deterministic recommendedQty = 40, bounds [30, 50]
function makeContext(overrides: Record<string, any> = {}) {
  return {
    sku: "CMP-1",
    itemId: "item-1",
    productName: "Component One",
    productType: "component",
    hildaleQty: 0,
    pivotQty: 0,
    availableForSale: 100,
    dailyVelocity: 10,
    daysUntilStockout: 10,
    leadTimeDays: 7,
    supplierMOQ: 0,
    inboundPO: 0,
    backorders: 0,
    returnRate: 0.05,
    adMultiplier: 1.0,
    supplierScore: 0,
    riskThresholdHighDays: 3,
    riskThresholdMediumDays: 7,
    safetyStockDays: 7,
    velocitySource: "sales",
    availableForSaleSuspect: false,
    dataConfidence: "high",
    dataWarnings: [],
    ...overrides,
  };
}

const batch = new InventoryRecommendationBatch() as any;

describe("computeDeterministicRecommendation (bounds oracle)", () => {
  it("computes the documented fixture quantities", () => {
    const det = batch.computeDeterministicRecommendation(makeContext());
    expect(det.recommendedQty).toBe(40);
    expect(det.riskLevel).toBe("HIGH");
    expect(det.recommendedAction).toBe("ORDER");
    expect(det.daysUntilStockout).toBe(10);
    expect(det.orderTiming).toBe("ORDER_TODAY");
  });

  it("bumps the order quantity up to the supplier MOQ", () => {
    const det = batch.computeDeterministicRecommendation(makeContext({ supplierMOQ: 50 }));
    expect(det.recommendedQty).toBe(50);
  });

  it("generateDeterministicRecommendations maps every context through the oracle", () => {
    const contexts = [makeContext(), makeContext({ sku: "CMP-2", itemId: "item-2", supplierMOQ: 50 })];
    const recs = batch.generateDeterministicRecommendations(contexts);
    expect(recs).toHaveLength(2);
    expect(recs[0].recommendedQty).toBe(40);
    expect(recs[1].recommendedQty).toBe(50);
  });
});

describe("normalizeRecommendation clamps (anti-hallucination)", () => {
  it("keeps the LLM qty when it is within deterministic bounds", () => {
    const contexts = [makeContext()];
    const rec = batch.normalizeRecommendation(
      { sku: "CMP-1", itemId: "item-1", riskLevel: "HIGH", recommendedAction: "ORDER", recommendedQty: 45, daysUntilStockout: 10, orderTiming: "ORDER_TODAY", reasoning: "ok" },
      contexts,
    );
    expect(rec.recommendedQty).toBe(45);
    expect(rec.notesForHuman).toBeUndefined();
  });

  it("replaces an inflated LLM qty with the deterministic qty and notes the clamp", () => {
    const contexts = [makeContext()];
    const rec = batch.normalizeRecommendation(
      { sku: "CMP-1", itemId: "item-1", riskLevel: "HIGH", recommendedAction: "ORDER", recommendedQty: 400, daysUntilStockout: 10, orderTiming: "ORDER_TODAY", reasoning: "hallucinated" },
      contexts,
    );
    expect(rec.recommendedQty).toBe(40); // deterministic, NOT the band edge
    expect(rec.notesForHuman).toContain("qty clamped to deterministic bounds (LLM said 400)");
  });

  it("replaces a lowballed LLM qty with the deterministic qty", () => {
    const contexts = [makeContext()];
    const rec = batch.normalizeRecommendation(
      { sku: "CMP-1", itemId: "item-1", recommendedQty: 10, daysUntilStockout: 10, reasoning: "x" },
      contexts,
    );
    expect(rec.recommendedQty).toBe(40);
    expect(rec.notesForHuman).toContain("LLM said 10");
  });

  it("appends the clamp note after an existing notesForHuman", () => {
    const contexts = [makeContext()];
    const rec = batch.normalizeRecommendation(
      { sku: "CMP-1", itemId: "item-1", recommendedQty: 400, daysUntilStockout: 10, reasoning: "x", notesForHuman: "check supplier" },
      contexts,
    );
    expect(rec.notesForHuman).toBe("check supplier; qty clamped to deterministic bounds (LLM said 400)");
  });

  it("enforces the MOQ as the lower bound", () => {
    const contexts = [makeContext({ supplierMOQ: 50 })];
    // deterministic = 50 (MOQ-bumped); bounds [max(50, 37), 63] = [50, 63]
    const rec = batch.normalizeRecommendation(
      { sku: "CMP-1", itemId: "item-1", recommendedQty: 40, daysUntilStockout: 10, reasoning: "x" },
      contexts,
    );
    expect(rec.recommendedQty).toBe(50);
  });

  it("clamps a phantom order on a well-stocked SKU back to zero", () => {
    // 100 days of stock → deterministic qty 0, bounds [0, 1]
    const contexts = [makeContext({ daysUntilStockout: 100, availableForSale: 1000 })];
    const rec = batch.normalizeRecommendation(
      { sku: "CMP-1", itemId: "item-1", recommendedQty: 500, daysUntilStockout: 100, reasoning: "phantom" },
      contexts,
    );
    expect(rec.recommendedQty).toBe(0);
    expect(rec.notesForHuman).toContain("LLM said 500");
  });

  it("ALWAYS uses the deterministic daysUntilStockout, never the LLM's", () => {
    const contexts = [makeContext()];
    const rec = batch.normalizeRecommendation(
      { sku: "CMP-1", itemId: "item-1", recommendedQty: 40, daysUntilStockout: 99, reasoning: "x" },
      contexts,
    );
    expect(rec.daysUntilStockout).toBe(10);
  });

  it("does not warn or note when the deterministic qty equals the LLM qty in a degenerate band", () => {
    // OK item: det qty 0, MOQ 25 → band [25, 1] is degenerate; LLM also says 0
    const contexts = [makeContext({ daysUntilStockout: 100, availableForSale: 1000, supplierMOQ: 25 })];
    const rec = batch.normalizeRecommendation(
      { sku: "CMP-1", itemId: "item-1", recommendedQty: 0, daysUntilStockout: 100, reasoning: "x" },
      contexts,
    );
    expect(rec.recommendedQty).toBe(0);
    expect(rec.notesForHuman).toBeUndefined();
  });

  it("passes LLM values through unchanged when no context matches (no oracle available)", () => {
    const rec = batch.normalizeRecommendation(
      { sku: "UNKNOWN", itemId: "nope", recommendedQty: 77, daysUntilStockout: 5, reasoning: "x" },
      [makeContext()],
    );
    expect(rec.recommendedQty).toBe(77);
    expect(rec.daysUntilStockout).toBe(5);
  });

  it("treats a non-numeric LLM qty as 0 and clamps it", () => {
    const contexts = [makeContext()];
    const rec = batch.normalizeRecommendation(
      { sku: "CMP-1", itemId: "item-1", recommendedQty: "lots", daysUntilStockout: 10, reasoning: "x" },
      contexts,
    );
    expect(rec.recommendedQty).toBe(40);
  });
});
