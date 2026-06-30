import { describe, it, expect, beforeEach, vi } from "vitest";
import type { IStorage } from "../storage";
import type { Item, SalesOrderLine } from "@shared/schema";

vi.mock("./audit-logger", () => ({
  AuditLogger: { logEvent: vi.fn().mockResolvedValue(undefined) },
}));

import { BackorderService } from "./backorder-service";

class FakeStorage {
  item: Item | undefined;
  lines: SalesOrderLine[] = [];
  reservedBackorderQty = 0;
  refreshed: string[] = [];

  async getItem() {
    return this.item;
  }

  async getOpenBackorderFulfilledQtyByProduct() {
    return this.reservedBackorderQty;
  }

  async getOpenBackorderLinesByProduct() {
    return this.lines;
  }

  async updateSalesOrderLine(id: string, updates: Partial<SalesOrderLine>) {
    const line = this.lines.find((l) => l.id === id);
    if (line) Object.assign(line, updates);
    return line;
  }

  async refreshBackorderSnapshot(productId: string) {
    this.refreshed.push(productId);
    return { id: "snap1", productId, totalBackorderedQty: 0, lastUpdatedAt: new Date() };
  }
}

let storage: FakeStorage;
let service: BackorderService;

beforeEach(() => {
  storage = new FakeStorage();
  service = new BackorderService(storage as unknown as IStorage);
  storage.item = {
    id: "FG1",
    sku: "FG-1",
    name: "Finished Good",
    type: "finished_product",
    hildaleQty: 5,
    pivotQty: 0,
    availableForSaleQty: 0,
    currentStock: 0,
  } as unknown as Item;
});

function line(overrides: Partial<SalesOrderLine>): SalesOrderLine {
  return {
    id: "l1",
    salesOrderId: "so1",
    productId: "FG1",
    sku: "FG-1",
    productName: "Finished Good",
    qtyOrdered: 5,
    qtyAllocated: 0,
    qtyShipped: 0,
    qtyFulfilled: 0,
    returnedQty: 0,
    backorderQty: 5,
    backorderFulfilledQty: 0,
    unitPrice: null,
    notes: null,
    ...overrides,
  } as SalesOrderLine;
}

describe("BackorderService", () => {
  it("reserves newly available Hildale stock without decrementing hildaleQty", async () => {
    storage.lines = [line({})];

    const result = await service.checkAndFulfillBackorders("FG1", 5);

    expect(result.success).toBe(true);
    expect(result.stockAvailable).toBe(5);
    expect(result.totalAllocated).toBe(5);
    expect(storage.lines[0].qtyAllocated).toBe(5);
    expect(storage.lines[0].backorderFulfilledQty).toBe(5);
    expect(storage.lines[0].backorderQty).toBe(0);
    expect(storage.item!.hildaleQty).toBe(5);
    expect(storage.refreshed).toEqual(["FG1"]);
  });

  it("does not allocate Hildale units already reserved by earlier backorder fulfillments", async () => {
    storage.reservedBackorderQty = 3;
    storage.lines = [line({ backorderQty: 5 })];

    const result = await service.checkAndFulfillBackorders("FG1", 0);

    expect(result.success).toBe(true);
    expect(result.stockAvailable).toBe(2);
    expect(result.totalAllocated).toBe(2);
    expect(storage.lines[0].qtyAllocated).toBe(2);
    expect(storage.lines[0].backorderFulfilledQty).toBe(2);
    expect(storage.lines[0].backorderQty).toBe(3);
  });
});
