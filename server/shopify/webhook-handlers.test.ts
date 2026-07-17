import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Integration tests for the Shopify webhook handlers. The handlers reach for the
 * module-level `storage` singleton and several services, so we mock those — but
 * we keep the REAL InventoryMovement engine wired in, so these tests exercise
 * the handler → engine → storage path end to end (that's where H2 lives).
 */

// Stateful in-memory storage, created in a hoisted block so vi.mock can see it.
const h = vi.hoisted(() => {
  const orders = new Map<string, any>(); // keyed by external order id (string)
  const linesByOrder = new Map<string, any[]>(); // keyed by internal order id
  const items = new Map<string, any>();

  const storage = {
    async getSalesOrdersByExternalId(_channel: string, externalId: string) {
      const o = orders.get(String(externalId));
      return o ? [o] : [];
    },
    async getSalesOrderLines(orderId: string) {
      return linesByOrder.get(orderId) ?? [];
    },
    async updateSalesOrderLine(lineId: string, data: any) {
      for (const lines of linesByOrder.values()) {
        const line = lines.find((l) => l.id === lineId);
        if (line) Object.assign(line, data);
      }
    },
    async updateSalesOrder(orderId: string, data: any) {
      for (const o of orders.values()) {
        if (o.id === orderId) {
          Object.assign(o, data);
          return o;
        }
      }
      return undefined;
    },
    async getItem(id: string) {
      return items.get(id);
    },
    async updateItem(id: string, data: any) {
      const it = items.get(id);
      if (!it) return undefined;
      Object.assign(it, data);
      return it;
    },
    async claimInventoryMovementLedger(input: any) {
      const key = `${input.movementType}:${input.externalRef}:${input.itemId}`;
      const claims = (storage as any).__movementClaims ?? new Set<string>();
      (storage as any).__movementClaims = claims;
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    },
    async getUser() {
      return { id: "u1", email: "test@example.com" };
    },
  };

  return { storage, orders, linesByOrder, items };
});

vi.mock("../storage", () => ({ storage: h.storage }));
vi.mock("../services/audit-logger", () => ({ AuditLogger: { logEvent: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../services/websocket-inventory", () => ({ wsInventoryService: { broadcast: vi.fn() } }));
vi.mock("../services/log-service", () => ({ logService: {} }));
vi.mock("../services/ghl-stock-alert-service", () => ({
  triggerShortageAlertsForOrder: vi.fn().mockResolvedValue(undefined),
  triggerHildaleFulfillmentAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/shopify-inventory-sync-service", () => ({ ShopifyInventorySyncService: class {} }));
vi.mock("../services/bom-consumption-service", () => ({
  consumeBomForFulfilledOrder: vi.fn().mockResolvedValue({ componentsSubtracted: 0, warnings: [], errors: [] }),
}));

import { handleOrderCancelled, handleOrderFulfilled, handleOrderUpdated } from "./webhook-handlers";
import { consumeBomForFulfilledOrder } from "../services/bom-consumption-service";

const ctx = {} as any;

beforeEach(() => {
  h.orders.clear();
  h.linesByOrder.clear();
  h.items.clear();
  (h.storage as any).__movementClaims = new Set<string>();
  vi.clearAllMocks();
});

function seedOpenOrder(externalId: string, internalId: string, lines: any[]) {
  h.orders.set(externalId, { id: internalId, externalOrderId: externalId, status: "OPEN" });
  h.linesByOrder.set(internalId, lines);
}

describe("handleOrderCancelled (H2)", () => {
  it("restores the allocated quantity to availableForSaleQty and marks the order CANCELLED", async () => {
    h.items.set("FG1", { id: "FG1", sku: "FG-1", type: "finished_product", availableForSaleQty: 90, pivotQty: 100, hildaleQty: 0 });
    seedOpenOrder("5001", "so1", [{ id: "l1", productId: "FG1", qtyAllocated: 6, backorderQty: 4 }]);

    const res = await handleOrderCancelled({ id: 5001, name: "#1001" } as any, ctx, "u1");

    expect(res.success).toBe(true);
    expect(h.items.get("FG1").availableForSaleQty).toBe(96); // restored 6 (allocated), not 10 (ordered)
    expect(h.items.get("FG1").pivotQty).toBe(100); // read-only
    expect(h.orders.get("5001").status).toBe("CANCELLED");
    expect(h.linesByOrder.get("so1")![0].qtyAllocated).toBe(0);
  });

  it("is idempotent: a second cancellation webhook does not restore stock again", async () => {
    h.items.set("FG1", { id: "FG1", sku: "FG-1", type: "finished_product", availableForSaleQty: 90, pivotQty: 100, hildaleQty: 0 });
    seedOpenOrder("5002", "so2", [{ id: "l1", productId: "FG1", qtyAllocated: 6, backorderQty: 0 }]);

    await handleOrderCancelled({ id: 5002, name: "#1002" } as any, ctx, "u1");
    expect(h.items.get("FG1").availableForSaleQty).toBe(96);

    // Shopify re-delivers the same webhook. Status is now CANCELLED → no re-restore.
    await handleOrderCancelled({ id: 5002, name: "#1002" } as any, ctx, "u1");
    expect(h.items.get("FG1").availableForSaleQty).toBe(96); // unchanged
  });

  it("does not restore stock for an order already in a terminal state", async () => {
    h.items.set("FG1", { id: "FG1", sku: "FG-1", type: "finished_product", availableForSaleQty: 90, pivotQty: 100, hildaleQty: 0 });
    h.orders.set("5003", { id: "so3", externalOrderId: "5003", status: "REFUNDED" });
    h.linesByOrder.set("so3", [{ id: "l1", productId: "FG1", qtyAllocated: 6, backorderQty: 0 }]);

    await handleOrderCancelled({ id: 5003, name: "#1003" } as any, ctx, "u1");
    expect(h.items.get("FG1").availableForSaleQty).toBe(90); // never restored
  });

  it("returns success when the order is not found locally", async () => {
    const res = await handleOrderCancelled({ id: 9999, name: "#9999" } as any, ctx, "u1");
    expect(res.success).toBe(true);
  });
});

describe("handleOrderFulfilled (C3 fulfillment trigger)", () => {
  it("triggers BOM consumption at fulfillment time with the fulfilled line items", async () => {
    seedOpenOrder("6001", "so10", []);

    await handleOrderFulfilled(
      { id: 6001, name: "#2001", line_items: [{ sku: "FG-SHOP", quantity: 3 }], fulfillments: [] } as any,
      ctx,
      "u1",
    );

    // This is the second BOM draw that, combined with production-time consumption,
    // constitutes the C3 double-consume.
    expect(consumeBomForFulfilledOrder).toHaveBeenCalledTimes(1);
    const callArgs = (consumeBomForFulfilledOrder as any).mock.calls[0];
    expect(callArgs[0]).toEqual([{ sku: "FG-SHOP", qtyFulfilled: 3 }]);
    expect(callArgs[1]).toBe("6001");
    expect(callArgs[2]).toBe("SHOPIFY");
  });
});

describe("handleOrderUpdated shipped-line reconciliation", () => {
  it("marks existing lines shipped when Shopify sends a fulfilled update", async () => {
    seedOpenOrder("7001", "so20", [{
      id: "l1",
      productId: "FG1",
      sku: "FG-1",
      qtyOrdered: 4,
      qtyAllocated: 4,
      qtyShipped: 0,
      qtyFulfilled: 0,
      backorderQty: 0,
    }]);

    const res = await handleOrderUpdated(
      { id: 7001, name: "#3001", financial_status: "paid", fulfillment_status: "fulfilled", fulfillments: [], updated_at: "2026-07-17T00:00:00Z" } as any,
      ctx,
      "u1",
    );

    expect(res.success).toBe(true);
    expect(h.orders.get("7001").status).toBe("SHIPPED");
    expect(h.linesByOrder.get("so20")![0].qtyShipped).toBe(4);
    expect(h.linesByOrder.get("so20")![0].qtyFulfilled).toBe(4);
  });
});
