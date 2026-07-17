import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Item } from "@shared/schema";
import type { IStorage } from "../storage";

// Isolate the engine from its side effects. The audit log + websocket broadcast
// are fire-and-forget and irrelevant to the stock math we are verifying here.
// Mocking them also prevents the audit logger from loading the real storage
// singleton (and any DB connection) at import time.
vi.mock("./audit-logger", () => ({
  AuditLogger: { logEvent: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("./websocket-inventory", () => ({
  wsInventoryService: { broadcast: vi.fn() },
}));

import { InventoryMovement } from "./inventory-movement";

/**
 * Minimal in-memory storage. The engine only calls getItem/updateItem on the
 * paths under test (lot-draw methods fire only when productionLogId is passed,
 * which these tests never do). Casting to IStorage keeps us honest about the
 * surface the engine actually depends on without booting full MemStorage.
 */
class FakeStorage {
  private items = new Map<string, Item>();
  private movementClaims = new Set<string>();

  seed(partial: Partial<Item> & { id: string; sku: string; type: string }): Item {
    const item = {
      name: partial.sku,
      currentStock: 0,
      hildaleQty: 0,
      pivotQty: 0,
      availableForSaleQty: 0,
      ...partial,
    } as unknown as Item;
    this.items.set(item.id, item);
    return item;
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

  async claimInventoryMovementLedger(input: {
    movementType: string;
    externalRef: string;
    itemId: string;
  }): Promise<boolean> {
    const key = `${input.movementType}:${input.externalRef}:${input.itemId}`;
    if (this.movementClaims.has(key)) return false;
    this.movementClaims.add(key);
    return true;
  }

  // Atomic claim+write twin (PostgresStorage runs both in one db.transaction).
  async claimLedgerAndUpdateItem(
    claim: { movementType: string; externalRef: string; itemId: string },
    itemId: string,
    updates: Partial<Item>,
  ): Promise<{ claimed: boolean; item?: Item }> {
    const claimed = await this.claimInventoryMovementLedger(claim);
    if (!claimed) return { claimed: false };
    const item = await this.updateItem(itemId, updates);
    return { claimed: true, item };
  }

  // Costing surfaces (FinOps Pillar 2). Tests seed these directly.
  poLines: any[] = [];
  bom: any[] = [];
  reconLogs: any[] = [];

  async getPurchaseOrderLinesByPOId(_poId: string): Promise<any[]> {
    return this.poLines;
  }

  async getBillOfMaterialsByProductId(_finishedProductId: string): Promise<any[]> {
    return this.bom;
  }

  async createDataReconciliationLog(rows: any[]): Promise<any[]> {
    this.reconLogs.push(...rows);
    return rows;
  }

  // Convenience for assertions
  get(id: string): Item {
    const item = this.items.get(id);
    if (!item) throw new Error(`item ${id} not seeded`);
    return item;
  }
}

let storage: FakeStorage;
let engine: InventoryMovement;

beforeEach(() => {
  storage = new FakeStorage();
  engine = new InventoryMovement(storage as unknown as IStorage);
});

function finished(over: Partial<Item> = {}): Item {
  return storage.seed({ id: "FG1", sku: "FG-1", type: "finished_product", ...over });
}
function component(over: Partial<Item> = {}): Item {
  return storage.seed({ id: "C1", sku: "COMP-1", type: "component", ...over });
}

// ── SALES_ORDER_CREATED ───────────────────────────────────────────────────
describe("SALES_ORDER_CREATED", () => {
  it("decrements availableForSaleQty only; never touches pivotQty or hildaleQty", async () => {
    finished({ availableForSaleQty: 100, pivotQty: 100, hildaleQty: 30 });
    const res = await engine.apply({
      eventType: "SALES_ORDER_CREATED", itemId: "FG1", quantity: 10,
      location: "PIVOT", source: "SYSTEM", orderId: "so-1", salesOrderLineId: "line-1",
    });
    expect(res.success).toBe(true);
    const fg = storage.get("FG1");
    expect(fg.availableForSaleQty).toBe(90);
    expect(fg.pivotQty).toBe(100); // read-only
    expect(fg.hildaleQty).toBe(30); // untouched
  });

  it("clamps availableForSaleQty at 0 (cannot go negative on oversell)", async () => {
    finished({ availableForSaleQty: 6 });
    await engine.apply({
      eventType: "SALES_ORDER_CREATED", itemId: "FG1", quantity: 10,
      location: "PIVOT", source: "SYSTEM", orderId: "so-2", salesOrderLineId: "line-1",
    });
    expect(storage.get("FG1").availableForSaleQty).toBe(0);
  });

  it("fails closed when a sales movement has no idempotency reference", async () => {
    finished({ availableForSaleQty: 100 });

    const res = await engine.apply({
      eventType: "SALES_ORDER_CREATED",
      itemId: "FG1",
      quantity: 4,
      location: "PIVOT",
      source: "SYSTEM",
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/requires an idempotency reference/i);
    expect(storage.get("FG1").availableForSaleQty).toBe(100);
  });

  it("is idempotent for repeated external sales-order movements", async () => {
    finished({ availableForSaleQty: 100, pivotQty: 100, hildaleQty: 0 });

    const first = await engine.apply({
      eventType: "SALES_ORDER_CREATED",
      itemId: "FG1",
      quantity: 7,
      location: "PIVOT",
      source: "SHOPIFY",
      orderId: "so-1",
      salesOrderLineId: "line-1",
      externalRef: "SHOPIFY:15953:line-1",
    });
    const second = await engine.apply({
      eventType: "SALES_ORDER_CREATED",
      itemId: "FG1",
      quantity: 7,
      location: "PIVOT",
      source: "SHOPIFY",
      orderId: "so-1",
      salesOrderLineId: "line-1",
      externalRef: "SHOPIFY:15953:line-1",
    });

    expect(first.quantityChanged).toBe(-7);
    expect(second.success).toBe(true);
    expect(second.quantityChanged).toBe(0);
    expect(storage.get("FG1").availableForSaleQty).toBe(93);
  });
});

// ── SALES_ORDER_CANCELLED (H1 contract) ───────────────────────────────────
describe("SALES_ORDER_CANCELLED", () => {
  it("restores exactly the quantity passed by the caller (H1: caller passes allocated, not ordered)", async () => {
    finished({ availableForSaleQty: 90, pivotQty: 100 });
    // H1 fix: the cancellation service passes the ALLOCATED qty (what was
    // actually decremented), so a 10-unit order with only 6 allocated restores 6.
    await engine.apply({
      eventType: "SALES_ORDER_CANCELLED", itemId: "FG1", quantity: 6,
      location: "PIVOT", source: "USER", orderId: "so-cancel-1", salesOrderLineId: "line-1",
    });
    const fg = storage.get("FG1");
    expect(fg.availableForSaleQty).toBe(96);
    expect(fg.pivotQty).toBe(100); // read-only
  });

  it("create then cancel the same qty is a round-trip (no drift)", async () => {
    finished({ availableForSaleQty: 50 });
    await engine.apply({ eventType: "SALES_ORDER_CREATED", itemId: "FG1", quantity: 8, location: "PIVOT", source: "SYSTEM", orderId: "so-round", salesOrderLineId: "line-1" });
    await engine.apply({ eventType: "SALES_ORDER_CANCELLED", itemId: "FG1", quantity: 8, location: "PIVOT", source: "USER", orderId: "so-round", salesOrderLineId: "line-1" });
    expect(storage.get("FG1").availableForSaleQty).toBe(50);
  });
});

// ── SALES_ORDER_SHIPPED ───────────────────────────────────────────────────
describe("SALES_ORDER_SHIPPED", () => {
  it("PIVOT ship is a no-op for finished products (Extensiv is source of truth)", async () => {
    finished({ availableForSaleQty: 40, pivotQty: 40, hildaleQty: 10 });
    const res = await engine.apply({ eventType: "SALES_ORDER_SHIPPED", itemId: "FG1", quantity: 5, location: "PIVOT", source: "SYSTEM" });
    expect(res.success).toBe(true);
    const fg = storage.get("FG1");
    expect(fg.availableForSaleQty).toBe(40);
    expect(fg.pivotQty).toBe(40);
    expect(fg.hildaleQty).toBe(10);
  });

  it("HILDALE ship decrements hildaleQty and fails when insufficient", async () => {
    finished({ hildaleQty: 4 });
    const ok = await engine.apply({ eventType: "SALES_ORDER_SHIPPED", itemId: "FG1", quantity: 3, location: "HILDALE", source: "USER" });
    expect(ok.success).toBe(true);
    expect(storage.get("FG1").hildaleQty).toBe(1);

    const fail = await engine.apply({ eventType: "SALES_ORDER_SHIPPED", itemId: "FG1", quantity: 5, location: "HILDALE", source: "USER" });
    expect(fail.success).toBe(false);
    expect(storage.get("FG1").hildaleQty).toBe(1); // unchanged on failure
  });
});

// ── RETURN_RECEIVED ───────────────────────────────────────────────────────
describe("RETURN_RECEIVED", () => {
  it("finished product returns land in hildaleQty, NOT availableForSaleQty or pivotQty", async () => {
    finished({ availableForSaleQty: 20, hildaleQty: 5, pivotQty: 20 });
    await engine.apply({ eventType: "RETURN_RECEIVED", itemId: "FG1", quantity: 3, source: "USER" });
    const fg = storage.get("FG1");
    expect(fg.hildaleQty).toBe(8);
    expect(fg.availableForSaleQty).toBe(20); // not sellable until transferred
    expect(fg.pivotQty).toBe(20); // read-only
  });

  it("component returns increment currentStock", async () => {
    component({ currentStock: 12 });
    await engine.apply({ eventType: "RETURN_RECEIVED", itemId: "C1", quantity: 4, source: "USER" });
    expect(storage.get("C1").currentStock).toBe(16);
  });
});

// ── TRANSFER (Hildale → Pivot) ────────────────────────────────────────────
describe("TRANSFER", () => {
  it("moves stock hildaleQty → availableForSaleQty with net-zero onHand", async () => {
    finished({ hildaleQty: 10, availableForSaleQty: 5, pivotQty: 5 });
    const res = await engine.apply({ eventType: "TRANSFER", itemId: "FG1", quantity: 4, source: "USER" });
    expect(res.success).toBe(true);
    expect(res.quantityChanged).toBe(0); // net zero
    const fg = storage.get("FG1");
    expect(fg.hildaleQty).toBe(6);
    expect(fg.availableForSaleQty).toBe(9);
    expect(fg.pivotQty).toBe(5); // read-only
  });

  it("fails when Hildale stock is insufficient and changes nothing", async () => {
    finished({ hildaleQty: 2, availableForSaleQty: 5 });
    const res = await engine.apply({ eventType: "TRANSFER", itemId: "FG1", quantity: 4, source: "USER" });
    expect(res.success).toBe(false);
    const fg = storage.get("FG1");
    expect(fg.hildaleQty).toBe(2);
    expect(fg.availableForSaleQty).toBe(5);
  });
});

// ── PRODUCTION_COMPLETED ──────────────────────────────────────────────────
describe("PRODUCTION_COMPLETED", () => {
  it("increments hildaleQty for finished products only", async () => {
    finished({ hildaleQty: 0 });
    await engine.apply({ eventType: "PRODUCTION_COMPLETED", itemId: "FG1", quantity: 25, location: "HILDALE", source: "USER" });
    expect(storage.get("FG1").hildaleQty).toBe(25);
  });
});

// ── BOM_CONSUMPTION (C3: single-path draw) ────────────────────────────────
describe("BOM_CONSUMPTION", () => {
  it("decrements component currentStock and is a no-op for finished products", async () => {
    component({ currentStock: 50 });
    finished({ hildaleQty: 10, availableForSaleQty: 10 });
    await engine.apply({ eventType: "BOM_CONSUMPTION", itemId: "C1", quantity: 12, location: "N/A", source: "USER" });
    expect(storage.get("C1").currentStock).toBe(38);

    await engine.apply({ eventType: "BOM_CONSUMPTION", itemId: "FG1", quantity: 12, location: "N/A", source: "USER" });
    const fg = storage.get("FG1");
    expect(fg.hildaleQty).toBe(10); // finished good not consumed as a component
    expect(fg.availableForSaleQty).toBe(10);
  });
});

// ── PURCHASE_ORDER_RECEIVED ───────────────────────────────────────────────
describe("PURCHASE_ORDER_RECEIVED", () => {
  it("increments component currentStock", async () => {
    component({ currentStock: 5 });
    await engine.apply({ eventType: "PURCHASE_ORDER_RECEIVED", itemId: "C1", quantity: 100, source: "USER" });
    expect(storage.get("C1").currentStock).toBe(105);
  });

  it("is a NO-OP for finished products (POs are components only)", async () => {
    finished({ hildaleQty: 7, availableForSaleQty: 7, currentStock: 0 });
    const res = await engine.apply({ eventType: "PURCHASE_ORDER_RECEIVED", itemId: "FG1", quantity: 100, source: "USER" });
    expect(res.success).toBe(true);
    const fg = storage.get("FG1");
    expect(fg.hildaleQty).toBe(7);
    expect(fg.availableForSaleQty).toBe(7);
    expect(fg.currentStock).toBe(0);
  });
});

// ── MANUAL_ADJUSTMENT (H3: barcode scan routes here) ──────────────────────
describe("MANUAL_ADJUSTMENT", () => {
  it("HILDALE adjusts hildaleQty (the barcode-scan path)", async () => {
    finished({ hildaleQty: 0 });
    await engine.apply({ eventType: "MANUAL_ADJUSTMENT", itemId: "FG1", quantity: 1, location: "HILDALE", source: "USER" });
    expect(storage.get("FG1").hildaleQty).toBe(1);
  });

  it("PIVOT/default location adjusts availableForSaleQty, never pivotQty", async () => {
    finished({ availableForSaleQty: 3, pivotQty: 50 });
    await engine.apply({ eventType: "MANUAL_ADJUSTMENT", itemId: "FG1", quantity: 2, location: "PIVOT", source: "USER" });
    const fg = storage.get("FG1");
    expect(fg.availableForSaleQty).toBe(5);
    expect(fg.pivotQty).toBe(50); // read-only
  });

  it("component adjusts currentStock", async () => {
    component({ currentStock: 9 });
    await engine.apply({ eventType: "MANUAL_ADJUSTMENT", itemId: "C1", quantity: -4, source: "USER" });
    expect(storage.get("C1").currentStock).toBe(5);
  });
});

// ── EXTENSIV_SYNC (C1: the double-decrement that is still pending) ─────────
describe("EXTENSIV_SYNC", () => {
  it("always mirrors pivotQty to the Extensiv snapshot", async () => {
    finished({ pivotQty: 100, availableForSaleQty: 100 });
    await engine.apply({ eventType: "EXTENSIV_SYNC", itemId: "FG1", quantity: 90, location: "PIVOT", source: "SYSTEM" });
    expect(storage.get("FG1").pivotQty).toBe(90);
  });

  it("C1 FIX: mirrors pivotQty but leaves availableForSaleQty untouched (no double-count of a prior sale)", async () => {
    // Audit walkthrough: a 10-unit Pivot sale already dropped afs 100→90 locally.
    // Extensiv then reports the lower physical count (90). afs must stay at 90 —
    // the sync only mirrors pivotQty and never re-applies the delta to afs.
    finished({ pivotQty: 100, availableForSaleQty: 90 });
    await engine.apply({ eventType: "EXTENSIV_SYNC", itemId: "FG1", quantity: 90, location: "PIVOT", source: "SYSTEM" });
    const fg = storage.get("FG1");
    expect(fg.pivotQty).toBe(90);
    expect(fg.availableForSaleQty).toBe(90); // unchanged by the sync
  });
});

// ── Cross-cutting invariants ──────────────────────────────────────────────
describe("invariants", () => {
  it("EXTENSIV_SYNC is the ONLY event that changes pivotQty", async () => {
    const events = [
      { eventType: "SALES_ORDER_CREATED", quantity: 2, location: "PIVOT" },
      { eventType: "SALES_ORDER_CANCELLED", quantity: 2, location: "PIVOT" },
      { eventType: "SALES_ORDER_SHIPPED", quantity: 1, location: "HILDALE" },
      { eventType: "RETURN_RECEIVED", quantity: 1 },
      { eventType: "TRANSFER", quantity: 1 },
      { eventType: "PRODUCTION_COMPLETED", quantity: 1, location: "HILDALE" },
      { eventType: "MANUAL_ADJUSTMENT", quantity: 1, location: "HILDALE" },
      { eventType: "MANUAL_COUNT", quantity: 1, location: "HILDALE" },
    ] as const;

    for (const e of events) {
      storage = new FakeStorage();
      engine = new InventoryMovement(storage as unknown as IStorage);
      finished({ hildaleQty: 20, availableForSaleQty: 20, pivotQty: 77 });
      await engine.apply({
        ...e,
        itemId: "FG1",
        source: "USER",
        ...(e.eventType === "SALES_ORDER_CREATED" || e.eventType === "SALES_ORDER_CANCELLED"
          ? { orderId: `so-${e.eventType}`, salesOrderLineId: "line-1" }
          : {}),
      });
      expect(storage.get("FG1").pivotQty, `pivotQty must not move on ${e.eventType}`).toBe(77);
    }
  });

  it("finished products never write currentStock", async () => {
    finished({ currentStock: 0, hildaleQty: 10, availableForSaleQty: 10 });
    for (const e of [
      { eventType: "PRODUCTION_COMPLETED", quantity: 5, location: "HILDALE" },
      { eventType: "RETURN_RECEIVED", quantity: 5 },
      { eventType: "MANUAL_ADJUSTMENT", quantity: 5, location: "HILDALE" },
      { eventType: "PURCHASE_ORDER_RECEIVED", quantity: 5 },
    ] as const) {
      await engine.apply({ ...e, itemId: "FG1", source: "USER" });
      expect(storage.get("FG1").currentStock, `currentStock must stay 0 after ${e.eventType}`).toBe(0);
    }
  });

  it("components never write hildaleQty or availableForSaleQty", async () => {
    component({ currentStock: 50, hildaleQty: 0, availableForSaleQty: 0 });
    for (const e of [
      { eventType: "PURCHASE_ORDER_RECEIVED", quantity: 5 },
      { eventType: "RETURN_RECEIVED", quantity: 5 },
      { eventType: "BOM_CONSUMPTION", quantity: 5, location: "N/A" },
      { eventType: "MANUAL_ADJUSTMENT", quantity: 5 },
    ] as const) {
      await engine.apply({ ...e, itemId: "C1", source: "USER" });
      const c = storage.get("C1");
      expect(c.hildaleQty, `hildaleQty must stay 0 after ${e.eventType}`).toBe(0);
      expect(c.availableForSaleQty, `availableForSaleQty must stay 0 after ${e.eventType}`).toBe(0);
    }
  });

  it("returns success:false for an unknown item", async () => {
    const res = await engine.apply({ eventType: "SALES_ORDER_CREATED", itemId: "NOPE", quantity: 1, source: "USER" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("not found");
  });
});

// ─── FinOps Pillar 2: WAC maintenance inside the gateway ─────────────────────
describe("weighted-average cost maintenance", () => {
  it("PO receipt blends component WAC from the PO line cost (atomic with stock)", async () => {
    storage.seed({ id: "C1", sku: "COMP-1", type: "component", currentStock: 100, wacUnitCost: 2 } as any);
    storage.poLines = [{ itemId: "C1", unitCost: 4 }];
    const res = await engine.apply({
      eventType: "PURCHASE_ORDER_RECEIVED", itemId: "C1", quantity: 100, source: "TEST", poId: "PO1",
    });
    expect(res.success).toBe(true);
    const item: any = storage.get("C1");
    expect(item.currentStock).toBe(200);
    expect(item.wacUnitCost).toBe(3); // (100*2 + 100*4) / 200
  });

  it("first receipt adopts the explicit unitCost override", async () => {
    storage.seed({ id: "C2", sku: "COMP-2", type: "component", currentStock: 0 } as any);
    const res = await engine.apply({
      eventType: "PURCHASE_ORDER_RECEIVED", itemId: "C2", quantity: 480, source: "TEST", unitCost: 8.65,
    });
    expect(res.success).toBe(true);
    expect((storage.get("C2") as any).wacUnitCost).toBe(8.65);
  });

  it("production completion rolls BOM build cost into the finished good's WAC", async () => {
    storage.seed({ id: "FG9", sku: "FG-9", type: "finished_product", hildaleQty: 10, pivotQty: 0, wacUnitCost: 50 } as any);
    storage.seed({ id: "C3", sku: "COMP-3", type: "component", currentStock: 500, wacUnitCost: 60 } as any);
    storage.bom = [{ componentId: "C3", quantityRequired: 1, wastagePercent: 0 }];
    const res = await engine.apply({
      eventType: "PRODUCTION_COMPLETED", itemId: "FG9", quantity: 10, source: "TEST", location: "HILDALE",
    });
    expect(res.success).toBe(true);
    const fg: any = storage.get("FG9");
    expect(fg.hildaleQty).toBe(20);
    expect(fg.wacUnitCost).toBe(55); // (10*50 + 10*60) / 20
  });

  it("a costing failure never blocks the stock movement", async () => {
    storage.seed({ id: "C4", sku: "COMP-4", type: "component", currentStock: 10 } as any);
    (storage as any).getPurchaseOrderLinesByPOId = async () => { throw new Error("po lookup down"); };
    const res = await engine.apply({
      eventType: "PURCHASE_ORDER_RECEIVED", itemId: "C4", quantity: 5, source: "TEST", poId: "PO-X",
    });
    expect(res.success).toBe(true);
    const item: any = storage.get("C4");
    expect(item.currentStock).toBe(15); // stock moved
    expect(item.wacUnitCost == null).toBe(true); // costing skipped, not fatal
  });

  it("manual count flags the balance-sheet $ variance in the reconciliation ledger", async () => {
    storage.seed({ id: "C5", sku: "COMP-5", type: "component", currentStock: 100, wacUnitCost: 3 } as any);
    const res = await engine.apply({
      eventType: "MANUAL_COUNT", itemId: "C5", quantity: -5, source: "TEST", location: "N/A",
    });
    expect(res.success).toBe(true);
    expect((storage.get("C5") as any).currentStock).toBe(95);
    expect(storage.reconLogs).toHaveLength(1);
    expect(storage.reconLogs[0].action).toBe("SHRINKAGE");
    expect(storage.reconLogs[0].newValue).toBe("-15"); // -5 × $3 WAC
    expect(storage.reconLogs[0].dataType).toBe("inventory_valuation");
  });
});

// ── P0-1 work order: idempotency ledger gap-closes (fix/number-integrity) ──
describe("idempotency ledger — work-order regression suite", () => {
  it("webhook 3x + reconciliation + backfill on one order → exactly ONE decrement", async () => {
    finished({ availableForSaleQty: 100 });
    const fire = (salesOrderLineId: string) =>
      engine.apply({
        eventType: "SALES_ORDER_CREATED", itemId: "FG1", quantity: 4,
        location: "PIVOT", source: "SHOPIFY", orderId: "so-1",
        salesOrderLineId,
        // Canonical cross-path ref: webhook + sync + backfill all derive the
        // SAME key from the Shopify order + line-item ids, even when their
        // INTERNAL line ids differ (racing creates mint different line rows).
        externalRef: "SHOPIFY:9001:li-77",
      });
    await fire("line-A"); // webhook delivery 1
    await fire("line-A"); // webhook redelivery
    await fire("line-A"); // webhook redelivery
    await fire("line-B"); // reconciliation pass minted a different internal line
    await fire("line-C"); // backfill pass
    expect(storage.get("FG1").availableForSaleQty).toBe(96);
  });

  it("10x redelivery storm → one decrement, and DEDUP_SKIP audit noise is capped to one row", async () => {
    const { AuditLogger } = await import("./audit-logger");
    (AuditLogger.logEvent as any).mockClear();
    finished({ availableForSaleQty: 50 });
    for (let i = 0; i < 10; i++) {
      await engine.apply({
        eventType: "SALES_ORDER_CREATED", itemId: "FG1", quantity: 3,
        location: "PIVOT", source: "SHOPIFY", orderId: "so-storm",
        salesOrderLineId: "line-1", externalRef: "SHOPIFY:9002:li-1",
      });
    }
    expect(storage.get("FG1").availableForSaleQty).toBe(47);
    const dedupRows = (AuditLogger.logEvent as any).mock.calls
      .filter((c: any[]) => c[0]?.details?.dedupAction === "DEDUP_SKIP");
    expect(dedupRows.length).toBe(1); // 9 skips, ONE audit row per (ref,item,day)
  });

  it("BOM_CONSUMPTION re-fired for the same production log consumes components once", async () => {
    component({ currentStock: 40 });
    const draw = () =>
      engine.apply({
        eventType: "BOM_CONSUMPTION", itemId: "C1", quantity: 6,
        location: "N/A", source: "USER", productionLogId: "plog-1",
      });
    await draw();
    await draw(); // replayed build event
    expect((storage.get("C1") as any).currentStock).toBe(34);
  });

  it("cancel-after-create restores once; redelivered cancel does not double-restore", async () => {
    finished({ availableForSaleQty: 100 });
    await engine.apply({
      eventType: "SALES_ORDER_CREATED", itemId: "FG1", quantity: 10,
      location: "PIVOT", source: "SHOPIFY", orderId: "so-2",
      salesOrderLineId: "line-1", externalRef: "SHOPIFY:9003:li-1",
    });
    expect(storage.get("FG1").availableForSaleQty).toBe(90);
    const cancel = () =>
      engine.apply({
        eventType: "SALES_ORDER_CANCELLED", itemId: "FG1", quantity: 10,
        location: "PIVOT", source: "SHOPIFY", orderId: "so-2",
        salesOrderLineId: "line-1", externalRef: "SHOPIFY:9003:line-1",
      });
    await cancel();
    expect(storage.get("FG1").availableForSaleQty).toBe(100);
    await cancel(); // webhook redelivery of orders/cancelled
    expect(storage.get("FG1").availableForSaleQty).toBe(100);
  });

  it("claim is NOT burned when the movement produces no stock update (atomicity contract)", async () => {
    // PURCHASE_ORDER_RECEIVED on finished product = warn-and-no-op; it is not a
    // claimed event type, so the ledger stays empty and nothing is recorded.
    finished({ availableForSaleQty: 10, hildaleQty: 5 });
    const res = await engine.apply({
      eventType: "PURCHASE_ORDER_RECEIVED", itemId: "FG1", quantity: 99,
      location: "HILDALE", source: "SYSTEM", poId: "po-1",
    });
    expect(res.success).toBe(true);
    expect(storage.get("FG1").availableForSaleQty).toBe(10);
    expect(storage.get("FG1").hildaleQty).toBe(5);
  });
});
