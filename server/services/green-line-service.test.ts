import { describe, it, expect } from "vitest";
import { opexStatus, computeOpexCreep } from "./green-line-service";

// db stub: computeOpexCreep reads through gl-reader's single query, so every execute()
// returns the canned rows (already in the reader's {month, account, amount} shape).
const mockDb = (rows: any[]) => ({ execute: async () => ({ rows }) });

describe("computeOpexCreep — classifies via the canonical classifyAccount (not the old '^[123] -' rule)", () => {
  it("counts real Gross Sales as net sales (not opex), excludes an unmapped Match-Shopify duplicate + COGS", async () => {
    // An UNMAPPED '%Match Shopify%' account passes through the reader under its own
    // name (gl-reader's safe default) — classifyAccount must still drop it here.
    const rows = [
      { month: "2026-03", account: "Gross Sales", amount: 400000 },
      { month: "2026-03", account: "3 - Returns/Refunds + Amazon", amount: -50000 }, // contra → nets down
      { month: "2026-03", account: "Cost of Goods Sold", amount: 140000 },           // cogs → NOT opex
      { month: "2026-03", account: "1a - Gross Sales v2 (Match Shopify Total Sales Breakdown)", amount: 380000 }, // duplicate → excluded
      { month: "2026-03", account: "Advertising & Marketing", amount: 100000 },      // opex
      { month: "2026-03", account: "Shipping, Freight & Delivery", amount: 50000 },  // opex
    ];
    const out = await computeOpexCreep(mockDb(rows) as any);
    const m = out.months.find((x) => x.month === "2026-03")!;
    expect(m.netSales).toBe(350000); // 400000 + (-50000); duplicate's 380000 excluded
    expect(m.opex).toBe(150000);     // 100000 + 50000; COGS 140000 excluded
    expect(m.opexPct).toBe(42.9);    // 150000 / 350000
    expect(m.status).toBe("HEALTHY");
    // The OLD '^[123] -' rule would have made net sales = 380000 (the duplicate only) and
    // swept Gross Sales' 400000 into opex → opexPct ~145% → false CRITICAL.
  });
});

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
