import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the PO ↔ QuickBooks Bill orchestrators. The real QuickBooksClient
 * is mocked so NO QuickBooks API calls are made — these exercise the
 * orchestration logic: the configured-gate, idempotency, error surfacing, and
 * the PO/Bill stamping that the auto-push (on PO send) and mark-paid flows rely
 * on.
 */

const h = vi.hoisted(() => {
  const pos = new Map<string, any>();
  const linesByPo = new Map<string, any[]>();
  const suppliers = new Map<string, any>();
  const bills = new Map<string, any>(); // keyed by purchaseOrderId
  const items: any[] = [];

  const storage = {
    async getPurchaseOrder(id: string) {
      return pos.get(id);
    },
    async getPurchaseOrderLinesByPOId(id: string) {
      return linesByPo.get(id) ?? [];
    },
    async getSupplier(id: string) {
      return suppliers.get(id);
    },
    async getConnectedQuickbooksUserId() {
      return null;
    },
    async getAllItems() {
      return items;
    },
    async updatePurchaseOrder(id: string, data: any) {
      const po = pos.get(id);
      if (po) Object.assign(po, data);
      return po;
    },
    async getQuickbooksBillByPurchaseOrderId(id: string) {
      return bills.get(id) ?? null;
    },
    async updateQuickbooksBill(billRowId: string, data: any) {
      for (const b of bills.values()) {
        if (b.id === billRowId) {
          Object.assign(b, data);
          return b;
        }
      }
      return null;
    },
  };

  const qb = { configured: true };
  const createBill = vi.fn();
  const markPaid = vi.fn();

  return { pos, linesByPo, suppliers, bills, items, storage, qb, createBill, markPaid };
});

vi.mock("../storage", () => ({ storage: h.storage }));
vi.mock("./audit-logger", () => ({ AuditLogger: { logEvent: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("./quickbooks-client", () => ({
  isQuickBooksConfigured: () => h.qb.configured,
  QuickBooksClient: class {
    constructor(_storage: any, _userId: string) {}
    createBillFromPurchaseOrder(...args: any[]) {
      return h.createBill(...args);
    }
    markBillAsPaid(...args: any[]) {
      return h.markPaid(...args);
    }
  },
}));

import { syncApprovedPOToQuickBooks, markPOBillAsPaidInQuickBooks, billPOOnReceipt } from "./po-quickbooks-sync";

beforeEach(() => {
  h.pos.clear();
  h.linesByPo.clear();
  h.suppliers.clear();
  h.bills.clear();
  h.items.length = 0;
  h.qb.configured = true;
  h.createBill.mockReset();
  h.markPaid.mockReset();
});

function seedPO(id: string, extra: Record<string, any> = {}) {
  h.pos.set(id, { id, poNumber: `PO-${id}`, supplierId: `sup-${id}`, status: "SENT", ...extra });
  h.suppliers.set(`sup-${id}`, { id: `sup-${id}`, name: `Vendor ${id}` });
  h.linesByPo.set(id, [{ id: `l-${id}`, itemId: `i-${id}`, qtyOrdered: 2, unitCost: 5 }]);
  h.items.push({ id: `i-${id}`, sku: `SKU-${id}`, name: `Item ${id}` });
}

describe("syncApprovedPOToQuickBooks (auto-push on PO send)", () => {
  it("skips when QuickBooks is not configured", async () => {
    h.qb.configured = false;
    const res = await syncApprovedPOToQuickBooks("po1", "u1");
    expect(res).toEqual({ success: false, skipped: true, reason: "QuickBooks not configured" });
    expect(h.createBill).not.toHaveBeenCalled();
  });

  it("returns not-found when the PO does not exist", async () => {
    const res = await syncApprovedPOToQuickBooks("missing", "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Purchase order not found");
  });

  it("skips draft/unapproved POs before creating a QuickBooks Bill", async () => {
    seedPO("po1", { status: "DRAFT" });
    const res = await syncApprovedPOToQuickBooks("po1", "u1");
    expect(res).toMatchObject({ success: false, skipped: true });
    expect(res.reason).toMatch(/approved\/sent\/received/i);
    expect(h.createBill).not.toHaveBeenCalled();
  });

  it("is idempotent: skips if the PO already links a QuickBooks Bill", async () => {
    seedPO("po1", { externalAccountingId: "QB-EXISTING" });
    const res = await syncApprovedPOToQuickBooks("po1", "u1");
    expect(res).toMatchObject({ success: true, skipped: true, billId: "QB-EXISTING" });
    expect(h.createBill).not.toHaveBeenCalled();
  });

  it("errors when the PO has no line items", async () => {
    seedPO("po1");
    h.linesByPo.set("po1", []);
    const res = await syncApprovedPOToQuickBooks("po1", "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("PO has no line items to bill");
    expect(h.createBill).not.toHaveBeenCalled();
  });

  it("errors when the supplier is missing", async () => {
    seedPO("po1");
    h.suppliers.delete("sup-po1");
    const res = await syncApprovedPOToQuickBooks("po1", "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Supplier not found for PO");
    expect(h.createBill).not.toHaveBeenCalled();
  });

  it("creates the Bill and stamps the PO on success", async () => {
    seedPO("po1");
    h.createBill.mockResolvedValue({ success: true, billId: "QB123", billNumber: "B-1" });

    const res = await syncApprovedPOToQuickBooks("po1", "u1");

    expect(h.createBill).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ success: true, billId: "QB123", billNumber: "B-1" });

    const po = h.pos.get("po1");
    expect(po.externalAccountingId).toBe("QB123");
    expect(po.qbRecordType).toBe("Bill");
    expect(po.accountantNotifiedAt).toBeInstanceOf(Date);
  });

  it("propagates a QuickBooks failure without stamping the PO", async () => {
    seedPO("po1");
    h.createBill.mockResolvedValue({ success: false, error: "QBO 401" });

    const res = await syncApprovedPOToQuickBooks("po1", "u1");

    expect(res.success).toBe(false);
    expect(res.error).toBe("QBO 401");
    const po = h.pos.get("po1");
    expect(po.externalAccountingId).toBeUndefined();
    expect(po.accountantNotifiedAt).toBeUndefined();
  });
});

describe("billPOOnReceipt (bill-on-receipt gate)", () => {
  it("skips when QuickBooks is not configured", async () => {
    h.qb.configured = false;
    const res = await billPOOnReceipt("po1", "u1");
    expect(res).toEqual({ success: false, skipped: true, reason: "QuickBooks not configured" });
    expect(h.createBill).not.toHaveBeenCalled();
  });

  it("returns not-found when the PO does not exist", async () => {
    const res = await billPOOnReceipt("missing", "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Purchase order not found");
  });

  it("does NOT bill a PO that is not fully received (SENT, no receivedAt)", async () => {
    seedPO("po1", { status: "SENT" });
    const res = await billPOOnReceipt("po1", "u1");
    expect(res).toMatchObject({ success: false, skipped: true });
    expect(res.reason).toMatch(/not fully received/i);
    expect(h.createBill).not.toHaveBeenCalled();
  });

  it("does NOT bill a partially received PO", async () => {
    seedPO("po1", { status: "PARTIAL_RECEIVED" });
    const res = await billPOOnReceipt("po1", "u1");
    expect(res).toMatchObject({ success: false, skipped: true });
    expect(h.createBill).not.toHaveBeenCalled();
  });

  it("bills when status is RECEIVED", async () => {
    seedPO("po1", { status: "RECEIVED" });
    h.createBill.mockResolvedValue({ success: true, billId: "QB777", billNumber: "B-7" });
    const res = await billPOOnReceipt("po1", "u1");
    expect(h.createBill).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ success: true, billId: "QB777" });
    expect(h.pos.get("po1").externalAccountingId).toBe("QB777");
  });

  it("bills when receivedAt is set even if status is not literally RECEIVED", async () => {
    seedPO("po1", { status: "CLOSED", receivedAt: new Date("2026-05-20T00:00:00Z") });
    h.createBill.mockResolvedValue({ success: true, billId: "QB888", billNumber: "B-8" });
    const res = await billPOOnReceipt("po1", "u1");
    expect(h.createBill).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ success: true, billId: "QB888" });
  });

  it("is idempotent: a received PO already linked to a Bill does not re-create", async () => {
    seedPO("po1", { status: "RECEIVED", externalAccountingId: "QB-OLD" });
    const res = await billPOOnReceipt("po1", "u1");
    expect(res).toMatchObject({ success: true, skipped: true, billId: "QB-OLD" });
    expect(h.createBill).not.toHaveBeenCalled();
  });
});

describe("markPOBillAsPaidInQuickBooks", () => {
  it("skips when QuickBooks is not configured", async () => {
    h.qb.configured = false;
    const res = await markPOBillAsPaidInQuickBooks("po1", "u1");
    expect(res).toEqual({ success: false, skipped: true, reason: "QuickBooks not configured" });
    expect(h.markPaid).not.toHaveBeenCalled();
  });

  it("skips gracefully when no Bill is linked to the PO", async () => {
    const res = await markPOBillAsPaidInQuickBooks("po1", "u1");
    expect(res).toMatchObject({ success: false, skipped: true });
    expect(res.reason).toMatch(/no quickbooks bill/i);
    expect(h.markPaid).not.toHaveBeenCalled();
  });

  it("skips when the Bill is already marked paid", async () => {
    h.bills.set("po1", { id: "row1", quickbooksBillId: "QB123", status: "PAID" });
    const res = await markPOBillAsPaidInQuickBooks("po1", "u1");
    expect(res).toMatchObject({ success: true, skipped: true, billId: "QB123" });
    expect(h.markPaid).not.toHaveBeenCalled();
  });

  it("records the payment and flips the Bill to PAID on success", async () => {
    h.bills.set("po1", { id: "row1", quickbooksBillId: "QB123", status: "CREATED" });
    h.markPaid.mockResolvedValue({ success: true, transactionId: "PAY-1" });

    const res = await markPOBillAsPaidInQuickBooks("po1", "u1");

    expect(h.markPaid).toHaveBeenCalledWith("QB123");
    expect(res).toMatchObject({ success: true, billId: "QB123" });
    expect(h.bills.get("po1").status).toBe("PAID");
  });

  it("propagates a payment failure and leaves the Bill unpaid", async () => {
    h.bills.set("po1", { id: "row1", quickbooksBillId: "QB123", status: "CREATED" });
    h.markPaid.mockResolvedValue({ success: false, error: "no bank account" });

    const res = await markPOBillAsPaidInQuickBooks("po1", "u1");

    expect(res.success).toBe(false);
    expect(res.error).toBe("no bank account");
    expect(h.bills.get("po1").status).toBe("CREATED");
  });
});

describe("raw QBO payload capture (accounting-spine evidence)", () => {
  it("stores the full QBO Bill API response as rawPayload on the created bill row", async () => {
    // The harness above mocks ./quickbooks-client for the orchestrator tests;
    // pull in the REAL client here so this exercises the actual bill-row writer
    // that runs at sync time. Its network/auth surface is stubbed per-instance —
    // no QuickBooks API calls are made.
    const { QuickBooksClient: RealQuickBooksClient } = await vi.importActual<
      typeof import("./quickbooks-client")
    >("./quickbooks-client");

    const created: any[] = [];
    const clientStorage = {
      getQuickbooksBillByPurchaseOrderId: vi.fn().mockResolvedValue(null),
      createQuickbooksBill: vi.fn(async (bill: any) => {
        created.push(bill);
        return { id: "row1", ...bill };
      }),
    };

    const client: any = new RealQuickBooksClient(clientStorage as any, "u1");
    client.initialize = vi.fn().mockResolvedValue(true);
    client.findOrCreateVendor = vi.fn().mockResolvedValue("VEND-1");
    client.findItemOrFallback = vi.fn().mockResolvedValue({ itemId: "QBI-1", useAccount: false });

    const qboBillResponse = {
      Id: "QB123",
      DocNumber: "B-1",
      VendorRef: { value: "VEND-1", name: "Vendor po1" },
      TxnDate: "2026-07-01",
      TotalAmt: 10,
      Line: [
        {
          Id: "1",
          Amount: 10,
          Description: "Item po1 (SKU-po1)",
          DetailType: "ItemBasedExpenseLineDetail",
          ItemBasedExpenseLineDetail: { ItemRef: { value: "QBI-1" }, Qty: 2, UnitPrice: 5 },
        },
      ],
    };
    client.apiRequest = vi.fn().mockResolvedValue({ Bill: qboBillResponse });

    const po = {
      id: "po1",
      poNumber: "PO-po1",
      supplierId: "sup-po1",
      status: "APPROVED",
      orderDate: new Date("2026-07-01T00:00:00Z"),
      expectedDate: null,
    };
    const poLines = [{ id: "l-po1", itemId: "i-po1", qtyOrdered: 2, unitCost: 5 }];
    const supplier = { id: "sup-po1", name: "Vendor po1" };
    const items = new Map([["i-po1", { id: "i-po1", sku: "SKU-po1", name: "Item po1" }]]);

    const res = await client.createBillFromPurchaseOrder(po, poLines, supplier, items);

    expect(res).toMatchObject({ success: true, billId: "QB123", billNumber: "B-1" });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      purchaseOrderId: "po1",
      quickbooksBillId: "QB123",
      status: "CREATED",
    });
    // The created bill row captured the QBO response object verbatim.
    expect(created[0].rawPayload).toEqual(qboBillResponse);
  });
});
