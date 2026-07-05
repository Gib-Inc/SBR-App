import { describe, it, expect } from "vitest";
import { dscrVerdict, capStatusForUnknownPrincipal } from "./dscr-service";

describe("dscrVerdict", () => {
  it("CRITICAL when operating cash flow is negative (operations underwater)", () => {
    // SBR today: net income -158,412 + interest 26,785 = -131,627
    const v = dscrVerdict(-131627, 26785);
    expect(v.status).toBe("CRITICAL");
  });
  it("CRITICAL when DSCR < 1.0", () => {
    expect(dscrVerdict(800, 1000).status).toBe("CRITICAL");
  });
  it("WARNING in the 1.0-1.25 lender danger zone", () => {
    const v = dscrVerdict(1100, 1000);
    expect(v.dscr).toBe(1.1);
    expect(v.status).toBe("WARNING");
  });
  it("HEALTHY at >= 1.25", () => {
    const v = dscrVerdict(1500, 1000);
    expect(v.dscr).toBe(1.5);
    expect(v.status).toBe("HEALTHY");
  });
  it("GAPPED when debt service unknown and the numerator is not negative", () => {
    expect(dscrVerdict(1000, 0).status).toBe("CALCULATION_GAPPED");
    expect(dscrVerdict(null, null).status).toBe("CALCULATION_GAPPED");
  });
});

describe("trailingClosedMonthAvg (G #16 — one green MTD point must not flip the chain)", () => {
  it("averages the last 3 CLOSED months, excluding the current calendar month", async () => {
    const { trailingClosedMonthAvg } = await import("./dscr-service");
    const now = Date.parse("2026-07-05T12:00:00Z");
    const months = [
      { month: "Jul 2026", netIncome: 11921 },   // current month MTD artifact — MUST be excluded
      { month: "Jun 2026", netIncome: -48806 },
      { month: "May 2026", netIncome: -58852 },
      { month: "Apr 2026", netIncome: -38365 },
      { month: "Mar 2026", netIncome: -19574 },  // beyond take=3 — ignored
    ];
    // (−48806 − 58852 − 38365) / 3 = −48674.33
    expect(trailingClosedMonthAvg(months, now)).toBe(-48674.33);
  });
  it("no closed months → null (never fabricate)", async () => {
    const { trailingClosedMonthAvg } = await import("./dscr-service");
    const now = Date.parse("2026-07-05T12:00:00Z");
    expect(trailingClosedMonthAvg([{ month: "Jul 2026", netIncome: 5000 }], now)).toBeNull();
    expect(trailingClosedMonthAvg([], now)).toBeNull();
    expect(trailingClosedMonthAvg([{ month: "garbage", netIncome: 5 }], now)).toBeNull();
  });
});

describe("capStatusForUnknownPrincipal", () => {
  it("downgrades a rosy HEALTHY to WARNING when principal is unknown (never HEALTHY on interest-only)", () => {
    // The 1.81 upper bound that hid the unpaid principal must not read HEALTHY.
    expect(capStatusForUnknownPrincipal("HEALTHY", false)).toBe("WARNING");
  });
  it("leaves HEALTHY intact once real principal is entered", () => {
    expect(capStatusForUnknownPrincipal("HEALTHY", true)).toBe("HEALTHY");
  });
  it("never upgrades a worse band — CRITICAL / WARNING / GAPPED pass through", () => {
    expect(capStatusForUnknownPrincipal("CRITICAL", false)).toBe("CRITICAL");
    expect(capStatusForUnknownPrincipal("WARNING", false)).toBe("WARNING");
    expect(capStatusForUnknownPrincipal("CALCULATION_GAPPED", false)).toBe("CALCULATION_GAPPED");
  });
});
