import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Item } from "@shared/schema";
import type { IStorage } from "../storage";

// The BOM service builds its own InventoryMovement(storage) internally, so we
// mock the engine's two side-effect modules (same as the engine unit tests).
vi.mock("./audit-logger", () => ({
  AuditLogger: { logEvent: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("./websocket-inventory", () => ({
  wsInventoryService: { broadcast: vi.fn() },
}));

import { consumeBomForFulfilledOrder } from "./bom-consumption-service";

interface BomEntry {
  componentId: string;
  quantityRequired: number;
}

/**
 * Fake storage covering exactly the surface consumeBomForFulfilledOrder touches:
 * SKU resolution, BOM lookup, plus the getItem/updateItem the engine needs to
 * draw down component stock.
 */
class FakeStorage {
  private items = new Map<string, Item>();
  private boms = new Map<string, BomEntry[]>();

  seedItem(partial: Partial<Item> & { id: string; sku: string; type: string }): Item {
    const item = {
      name: partial.sku,
      currentStock: 0,
      hildaleQty: 0,
      pivotQty: 0,
      availableForSaleQty: 0,
      shopifySku: null,
      ...partial,
    } as unknown as Item;
    this.items.set(item.id, item);
    return item;
  }

  seedBom(productId: string, entries: BomEntry[]) {
    this.boms.set(productId, entries);
  }

  async findProductByShopifySku(sku: string): Promise<Item | undefined> {
    return [...this.items.values()].find((i) => (i as any).shopifySku === sku);
  }
  async getItemBySku(sku: string): Promise<Item | undefined> {
    return [...this.items.values()].find((i) => i.sku === sku);
  }
  async getBillOfMaterialsByProductId(productId: string): Promise<BomEntry[]> {
    return this.boms.get(productId) ?? [];
  }
  async getItem(id: string): Promise<Item | undefined> {
    return this.items.get(id);
  }
  async updateItem(id: string, data: Partial<Item>): Promise<Item | undefined> {
    const cur = this.items.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...data } as Item;
    this.items.set(id, next);
    return next;
  }

  get(id: string): Item {
    const item = this.items.get(id);
    if (!item) throw new Error(`item ${id} not seeded`);
    return item;
  }
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
});

describe("consumeBomForFulfilledOrder (C3 FIX: no-op at fulfillment)", () => {
  // C3: raw materials are drawn at PRODUCTION time only. Fulfillment must NOT
  // draw a second time, so this function is now a guarded no-op. These tests pin
  // that contract: regardless of input, no component stock moves at fulfillment.
  it("does not subtract component stock even when a BOM exists", async () => {
    storage.seedItem({ id: "FG", sku: "FG-1", type: "finished_product", shopifySku: "FG-SHOP" });
    storage.seedItem({ id: "A", sku: "COMP-A", type: "component", currentStock: 100 });
    storage.seedItem({ id: "B", sku: "COMP-B", type: "component", currentStock: 100 });
    storage.seedBom("FG", [
      { componentId: "A", quantityRequired: 2 },
      { componentId: "B", quantityRequired: 1 },
    ]);

    const res = await consumeBomForFulfilledOrder(
      [{ sku: "FG-SHOP", qtyFulfilled: 3 }],
      "ORDER-1",
      "SHOPIFY",
      storage as unknown as IStorage,
    );

    expect(res.componentsSubtracted).toBe(0);
    expect(res.errors).toEqual([]);
    expect(storage.get("A").currentStock).toBe(100); // untouched at fulfillment
    expect(storage.get("B").currentStock).toBe(100); // untouched at fulfillment
  });

  it("returns the empty result-shape contract its callers expect", async () => {
    const res = await consumeBomForFulfilledOrder(
      [{ sku: "ANYTHING", qtyFulfilled: 5 }],
      "ORDER-2",
      "SHOPIFY",
      storage as unknown as IStorage,
    );
    expect(res).toEqual({ componentsSubtracted: 0, warnings: [], errors: [] });
  });
});
