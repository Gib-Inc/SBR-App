import { describe, it, expect } from "vitest";
import { opexStatus } from "./green-line-service";

describe("opexStatus", () => {
  it("CRITICAL at >=90% (opex alone eats the top line)", () => {
    expect(opexStatus(105.7)).toBe("CRITICAL"); // SBR Jan
    expect(opexStatus(98.0)).toBe("CRITICAL");  // SBR May
    expect(opexStatus(90)).toBe("CRITICAL");
  });
  it("WARNING in 75-89%", () => {
    expect(opexStatus(89.3)).toBe("WARNING");   // SBR Jun
    expect(opexStatus(84.2)).toBe("WARNING");   // SBR Apr
    expect(opexStatus(75)).toBe("WARNING");
  });
  it("HEALTHY below 75%", () => {
    expect(opexStatus(68)).toBe("HEALTHY");      // SBR Mar
    expect(opexStatus(0)).toBe("HEALTHY");
  });
});
