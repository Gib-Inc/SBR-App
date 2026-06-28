import { describe, it, expect } from "vitest";
import { computeInventoryHealth } from "./inventory-health-service";

describe("computeInventoryHealth", () => {
  it("computes turnover/DIO as a range across app-WAC and QB inventory", () => {
    const h = computeInventoryHealth({
      inventoryValueApp: 250000, qbInventory: 125000, annualizedCogs: 875000, trailingMonths: 3,
      skusWithStock: 100, skusCosted: 50, unitsWithStock: 4000, unitsCosted: 3000,
    });
    expect(h.turnoverApp).toBe(3.5);  // 875k / 250k
    expect(h.turnoverQb).toBe(7);     // 875k / 125k
    expect(h.dioApp).toBe(104);       // 365 / 3.5
    expect(h.dioQb).toBe(52);         // 365 / 7
    expect(h.valuationGap).toBe(125000);
  });

  it("reports costed coverage by SKU and by units", () => {
    const h = computeInventoryHealth({
      inventoryValueApp: 100, qbInventory: null, annualizedCogs: null, trailingMonths: 0,
      skusWithStock: 100, skusCosted: 50, unitsWithStock: 4000, unitsCosted: 3000,
    });
    expect(h.costedSkuPct).toBe(50);     // 50/100
    expect(h.costedValuePct).toBe(75);   // 3000/4000
    expect(h.uncostedSkusWithStock).toBe(50);
  });

  it("leaves turnover null when COGS or inventory is missing (no fake number)", () => {
    const h = computeInventoryHealth({
      inventoryValueApp: 0, qbInventory: null, annualizedCogs: null, trailingMonths: 0,
      skusWithStock: 0, skusCosted: 0, unitsWithStock: 0, unitsCosted: 0,
    });
    expect(h.turnoverApp).toBeNull();
    expect(h.turnoverQb).toBeNull();
    expect(h.dioApp).toBeNull();
    expect(h.costedSkuPct).toBeNull();
  });
});
