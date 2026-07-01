import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * End-to-end tests for OrderCancellationService.updateLocalDatabase path.
 *
 * The service reaches for the module-level `storage` singleton, the GHL
 * opportunities service, and builds its own InventoryMovement(storage). We mock
 * the singletons and side-effect modules but keep the REAL InventoryMovement
 * engine wired, so these tests exercise service → engine → storage end to end.
 * This is where H1 lives: cancellations must restore the ALLOCATED quantity
 * (what was actually deducted at order-create), not the ordered quantity.
 */

const h = vi.hoisted(() => {
  const orders = new Map<string, any>(); // keyed by internal order id
  const linesByOrder = new Map<string, any[]>();
  const items = new Map<string, any>();
  const refreshedSnapshots: string[] = [];

  const storage = {
    async getSalesOrder(orderId: string) {
      return orders.get(orderId);
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
      const o = orders.get(orderId);
      if (o) Object.assign(o, data);
      return o;
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
    async getUser() {
      return { id: "u1", email: "test@example.com" };
    },
    async createAuditLog() {
      return undefined;
    },
    async getIntegrationConfig() {
      return undefined;
    },
    async refreshBackorderSnapshot(productId: string) {
      refreshedSnapshots.push(productId);
    },
    async refreshProductForecastContext() {
      return undefined;
    },
  };

  return { storage, orders, linesByOrder, items, refreshedSnapshots };
});

vi.mock("../storage", () => ({ storage: h.storage }));
vi.mock("../services/audit-logger", () => ({ AuditLogger: { logEvent: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../services/websocket-inventory", () => ({ wsInventoryService: { broadcast: vi.fn() } }));
vi.mock("./ghl-opportunities-service", () => ({
  ghlOpportunitiesService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    isConfigured: vi.fn().mockReturnValue(false),
    upsertOpportunity: vi.fn().mockResolvedValue({ success: false }),
  },
}));

import { OrderCancellationService } from "./order-cancellation-service";

const svc = new OrderCancellationService("u1");
const opts = { skipShopify: true, skipGHL: true } as const;

beforeEach(() => {
  h.orders.clear();
  h.linesByOrder.clear();
  h.items.clear();
  h.refreshedSnapshots.length = 0;
  vi.clearAllMocks();
});

function seedOrder(id: string, channel: string, lines: any[], extra: Record<string, any> = {}) {
  h.orders.set(id, {
    id,
    externalOrderId: `EXT-${id}`,
    channel,
    status: "OPEN",
    totalAmount: 0,
    currency: "USD",
    ...extra,
  });
  h.linesByOrder.set(id, lines);
}

describe("OrderCancellationService.cancelOrder (H1: restore allocated, not ordered)", () => {
  it("restores only the allocated quantity to availableForSaleQty", async () => {
    h.items.set("FG1", { id: "FG1", sku: "FG-1", type: "finished_product", availableForSaleQty: 90, pivotQty: 100, hildaleQty: 0 });
    // Ordered 10, only 6 were in stock to allocate (4 backordered, never deducted).
    seedOrder("so1", "SHOPIFY", [{ id: "l1", productId: "FG1", qtyAllocated: 6, backorderQty: 4, qtyFulfilled: 0 }]);

    const res = await svc.cancelOrder("so1", opts);

    expect(res.success).toBe(true);
    expect(res.localUpdated).toBe(true);
    expect(h.items.get("FG1").availableForSaleQty).toBe(96); // +6 (allocated), NOT +10
    expect(h.items.get("FG1").pivotQty).toBe(100); // read-only, untouched
    expect(h.orders.get("so1").status).toBe("CANCELLED");
    expect(h.orders.get("so1").returnStatus).toBe("REFUNDED");
    expect(h.linesByOrder.get("so1")![0].qtyAllocated).toBe(0);
    expect(h.linesByOrder.get("so1")![0].backorderQty).toBe(0);
    expect(h.refreshedSnapshots).toContain("FG1");
  });

  it("restores nothing when the line was fully backordered (allocated = 0)", async () => {
    h.items.set("FG1", { id: "FG1", sku: "FG-1", type: "finished_product", availableForSaleQty: 90, pivotQty: 100, hildaleQty: 0 });
    seedOrder("so2", "SHOPIFY", [{ id: "l1", productId: "FG1", qtyAllocated: 0, backorderQty: 10, qtyFulfilled: 0 }]);

    const res = await svc.cancelOrder("so2", opts);

    expect(res.success).toBe(true);
    expect(h.items.get("FG1").availableForSaleQty).toBe(90); // unchanged: nothing was ever deducted
    expect(h.orders.get("so2").status).toBe("CANCELLED");
    expect(h.linesByOrder.get("so2")![0].qtyAllocated).toBe(0);
  });

  it("does not restore Hildale-reserved backorder units to availableForSaleQty", async () => {
    h.items.set("FG1", { id: "FG1", sku: "FG-1", type: "finished_product", availableForSaleQty: 90, pivotQty: 100, hildaleQty: 4 });
    // 6 units were allocated from AFS at create time; 4 more were later
    // reserved from Hildale by backorder auto-fulfill.
    seedOrder("so2b", "SHOPIFY", [{
      id: "l1",
      productId: "FG1",
      qtyAllocated: 10,
      backorderFulfilledQty: 4,
      backorderQty: 0,
      qtyFulfilled: 0,
    }]);

    const res = await svc.cancelOrder("so2b", opts);

    expect(res.success).toBe(true);
    expect(h.items.get("FG1").availableForSaleQty).toBe(96); // +6 only, not +10
    expect(h.items.get("FG1").hildaleQty).toBe(4); // reservation cleared, physical stock unchanged
    expect(h.linesByOrder.get("so2b")![0].qtyAllocated).toBe(0);
    expect(h.linesByOrder.get("so2b")![0].backorderFulfilledQty).toBe(0);
  });

  it("sums restores across multiple lines and refreshes each product", async () => {
    h.items.set("FG1", { id: "FG1", sku: "FG-1", type: "finished_product", availableForSaleQty: 50, pivotQty: 60, hildaleQty: 0 });
    h.items.set("FG2", { id: "FG2", sku: "FG-2", type: "finished_product", availableForSaleQty: 20, pivotQty: 25, hildaleQty: 0 });
    seedOrder("so3", "SHOPIFY", [
      { id: "l1", productId: "FG1", qtyAllocated: 3, backorderQty: 0, qtyFulfilled: 0 },
      { id: "l2", productId: "FG2", qtyAllocated: 5, backorderQty: 0, qtyFulfilled: 0 },
    ]);

    const res = await svc.cancelOrder("so3", opts);

    expect(res.success).toBe(true);
    expect(h.items.get("FG1").availableForSaleQty).toBe(53);
    expect(h.items.get("FG2").availableForSaleQty).toBe(25);
    expect(h.refreshedSnapshots).toEqual(expect.arrayContaining(["FG1", "FG2"]));
  });

  it("refuses to cancel an order with fulfilled items and touches no stock", async () => {
    h.items.set("FG1", { id: "FG1", sku: "FG-1", type: "finished_product", availableForSaleQty: 90, pivotQty: 100, hildaleQty: 0 });
    seedOrder("so4", "SHOPIFY", [{ id: "l1", productId: "FG1", qtyAllocated: 6, backorderQty: 0, qtyFulfilled: 6 }]);

    const res = await svc.cancelOrder("so4", opts);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/fulfilled/i);
    expect(h.items.get("FG1").availableForSaleQty).toBe(90); // untouched
    expect(h.orders.get("so4").status).toBe("OPEN"); // not cancelled
  });

  it("returns a not-found error when the order does not exist", async () => {
    const res = await svc.cancelOrder("missing", opts);
    expect(res.success).toBe(false);
    expect(res.error).toBe("Sales order not found");
  });

  it("skips lines with no productId without throwing", async () => {
    seedOrder("so5", "SHOPIFY", [{ id: "l1", productId: null, qtyAllocated: 3, backorderQty: 0, qtyFulfilled: 0 }]);

    const res = await svc.cancelOrder("so5", opts);

    expect(res.success).toBe(true);
    expect(h.orders.get("so5").status).toBe("CANCELLED");
    expect(h.linesByOrder.get("so5")![0].qtyAllocated).toBe(0);
  });
});
