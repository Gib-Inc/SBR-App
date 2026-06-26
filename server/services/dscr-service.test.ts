import { describe, it, expect } from "vitest";
import { dscrVerdict } from "./dscr-service";

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
