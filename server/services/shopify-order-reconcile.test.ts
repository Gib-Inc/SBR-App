import { describe, it, expect } from "vitest";
import { shouldApplyOrderUpdate } from "./shopify-order-reconcile";

describe("shouldApplyOrderUpdate", () => {
  it("applies an advancing status", () => {
    expect(shouldApplyOrderUpdate({ prevStatus: "ORDERED", newStatus: "SHIPPED" }).apply).toBe(true);
  });

  it("skips a status downgrade", () => {
    const r = shouldApplyOrderUpdate({ prevStatus: "DELIVERED", newStatus: "SHIPPED" });
    expect(r.apply).toBe(false);
    expect(r.reason).toMatch(/downgrade/);
  });

  it("always applies a terminal status (cancel/refund) even from a higher rank", () => {
    expect(shouldApplyOrderUpdate({ prevStatus: "DELIVERED", newStatus: "CANCELLED" }).apply).toBe(true);
    expect(shouldApplyOrderUpdate({ prevStatus: "SHIPPED", newStatus: "REFUNDED" }).apply).toBe(true);
  });

  it("skips a stale same-status re-delivery (newer-wins)", () => {
    const r = shouldApplyOrderUpdate({
      prevStatus: "SHIPPED", newStatus: "SHIPPED",
      prevUpdatedAt: "2026-06-05T10:00:00Z", incomingUpdatedAt: "2026-06-04T10:00:00Z",
    });
    expect(r.apply).toBe(false);
    expect(r.reason).toMatch(/stale/);
  });

  it("applies a fresher same-status update", () => {
    const r = shouldApplyOrderUpdate({
      prevStatus: "SHIPPED", newStatus: "SHIPPED",
      prevUpdatedAt: "2026-06-04T10:00:00Z", incomingUpdatedAt: "2026-06-05T10:00:00Z",
    });
    expect(r.apply).toBe(true);
  });

  it("applies same-status when timestamps are unknown (no regression in behavior)", () => {
    expect(shouldApplyOrderUpdate({ prevStatus: "SHIPPED", newStatus: "SHIPPED" }).apply).toBe(true);
  });
});
