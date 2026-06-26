import { describe, it, expect } from "vitest";
import { governorVerdict } from "./marketing-governor-service";

const base = { breakeven: 5, cashFloor: 60000, septemberThreshold: 5, dataFresh: true };

describe("governorVerdict", () => {
  it("BLOCK (hard) when the September Rule is firing, even with great MER + cash", () => {
    expect(governorVerdict({ ...base, blendedMer: 9, cashOnHand: 100000, septemberStreak: 8 }).state).toBe("BLOCK");
  });
  it("BLOCK when ad/sales data is stale", () => {
    expect(governorVerdict({ ...base, dataFresh: false, blendedMer: 9, cashOnHand: 100000, septemberStreak: 0 }).state).toBe("BLOCK");
  });
  it("HOLD when MER is below breakeven (SBR today: 3.8x)", () => {
    expect(governorVerdict({ ...base, blendedMer: 3.8, cashOnHand: 40386, septemberStreak: 0 }).state).toBe("HOLD");
  });
  it("HOLD when cash is below the floor", () => {
    expect(governorVerdict({ ...base, blendedMer: 9, cashOnHand: 40000, septemberStreak: 0 }).state).toBe("HOLD");
  });
  it("ALLOW_SCALE only when MER>breakeven, cash>floor, fresh, no September Rule", () => {
    expect(governorVerdict({ ...base, blendedMer: 9, cashOnHand: 100000, septemberStreak: 0 }).state).toBe("ALLOW_SCALE");
  });
});
