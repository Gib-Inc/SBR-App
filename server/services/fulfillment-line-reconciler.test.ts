import { describe, it, expect, vi } from "vitest";
import { reconcileShippedLines } from "./fulfillment-line-reconciler";

/** Minimal stateful storage double satisfying ReconcilerStorage. */
function makeStorage(lines: any[]) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    lines,
    updateCalls: [] as Array<{ id: string; updates: any }>,
    async getSalesOrderLines(_orderId: string) {
      return lines;
    },
    async updateSalesOrderLine(id: string, updates: any) {
      this.updateCalls.push({ id, updates });
      const line = byId.get(id);
      if (line) Object.assign(line, updates);
      return line;
    },
  };
}

describe("reconcileShippedLines", () => {
  it("fills qty_shipped/qty_fulfilled to qty_ordered on a full SHIPPED transition with no per-line data", async () => {
    const s = makeStorage([
      { id: "l1", sku: "FG-1", qtyOrdered: 4, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 2 },
      { id: "l2", sku: "FG-2", qtyOrdered: 1, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
    ]);

    const res = await reconcileShippedLines(s, "so1");

    expect(res).toEqual({ linesSeen: 2, linesUpdated: 2 });
    expect(s.lines[0]).toMatchObject({ qtyShipped: 4, qtyFulfilled: 4, backorderQty: 0 });
    expect(s.lines[1]).toMatchObject({ qtyShipped: 1, qtyFulfilled: 1, backorderQty: 0 });
  });

  it("uses per-fulfillment quantities on partial fulfillment: open = ordered − fulfilled-sum", async () => {
    const s = makeStorage([
      { id: "l1", sku: "FG-1", qtyOrdered: 4, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
    ]);

    await reconcileShippedLines(s, "so1", {
      fulfillments: [{ status: "success", line_items: [{ sku: "FG-1", quantity: 1 }] }],
      fillToOrdered: false,
    });

    // 1 of 4 shipped → 3 stay open; NOT filled to ordered.
    expect(s.lines[0].qtyShipped).toBe(1);
    expect(s.lines[0].qtyFulfilled).toBe(1);
    // Not fully shipped → backorderQty untouched.
    expect(s.lines[0].backorderQty).toBe(0);
  });

  it("sums quantities across multiple fulfillments for the same line item", async () => {
    const s = makeStorage([
      { id: "l1", sku: "FG-1", qtyOrdered: 5, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
    ]);

    await reconcileShippedLines(s, "so1", {
      fulfillments: [
        { status: "success", line_items: [{ sku: "FG-1", quantity: 2 }] },
        { status: "success", line_items: [{ sku: "FG-1", quantity: 3 }] },
      ],
      fillToOrdered: false,
    });

    expect(s.lines[0].qtyShipped).toBe(5);
    expect(s.lines[0].qtyFulfilled).toBe(5);
    expect(s.lines[0].backorderQty).toBe(0); // fully shipped → zeroed
  });

  it("distributes a same-SKU shipped total across multiple lines with per-line caps", async () => {
    const s = makeStorage([
      { id: "l1", sku: "FG-1", qtyOrdered: 2, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
      { id: "l2", sku: "FG-1", qtyOrdered: 3, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
    ]);

    await reconcileShippedLines(s, "so1", {
      fulfillments: [{ status: "success", line_items: [{ sku: "FG-1", quantity: 4 }] }],
      fillToOrdered: false,
    });

    expect(s.lines[0].qtyShipped).toBe(2); // capped at its own qtyOrdered
    expect(s.lines[1].qtyShipped).toBe(2); // remainder of the aggregated 4
  });

  it("NEVER decreases qty_shipped recorded by a more precise path", async () => {
    const s = makeStorage([
      { id: "l1", sku: "FG-1", qtyOrdered: 4, qtyShipped: 4, qtyFulfilled: 4, backorderQty: 0 },
    ]);

    await reconcileShippedLines(s, "so1", {
      fulfillments: [{ status: "success", line_items: [{ sku: "FG-1", quantity: 1 }] }],
      fillToOrdered: false,
    });

    expect(s.lines[0].qtyShipped).toBe(4); // stays at 4, not dropped to 1
    expect(s.updateCalls).toHaveLength(0); // and no pointless write happened
  });

  it("ignores cancelled fulfillments", async () => {
    const s = makeStorage([
      { id: "l1", sku: "FG-1", qtyOrdered: 4, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
    ]);

    await reconcileShippedLines(s, "so1", {
      fulfillments: [{ status: "cancelled", line_items: [{ sku: "FG-1", quantity: 4 }] }],
      fillToOrdered: false,
    });

    expect(s.lines[0].qtyShipped).toBe(0);
    expect(s.updateCalls).toHaveLength(0);
  });

  it("falls back to the qtyOrdered fill for lines missing from per-line data on a FULL transition", async () => {
    const s = makeStorage([
      { id: "l1", sku: "FG-1", qtyOrdered: 2, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
      { id: "l2", sku: "FG-MISSING", qtyOrdered: 3, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 1 },
    ]);

    await reconcileShippedLines(s, "so1", {
      fulfillments: [{ status: "success", line_items: [{ sku: "FG-1", quantity: 2 }] }],
      // fillToOrdered defaults true: the order-level status asserts full shipment
    });

    expect(s.lines[0].qtyShipped).toBe(2); // per-fulfillment data
    expect(s.lines[1]).toMatchObject({ qtyShipped: 3, qtyFulfilled: 3, backorderQty: 0 }); // fill
  });

  it("uses Amazon per-line shipped counts and leaves unshipped lines open when fillToOrdered=false", async () => {
    const s = makeStorage([
      { id: "l1", sku: "AMZ-1", qtyOrdered: 2, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
      { id: "l2", sku: "AMZ-2", qtyOrdered: 3, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
    ]);

    await reconcileShippedLines(s, "so1", {
      amazonLines: [
        { sku: "AMZ-1", qtyShipped: 2 },
        { sku: "AMZ-2", qtyShipped: 0 },
      ],
      fillToOrdered: false, // Amazon partial (status SHIPPED)
    });

    expect(s.lines[0]).toMatchObject({ qtyShipped: 2, qtyFulfilled: 2, backorderQty: 0 });
    expect(s.lines[1].qtyShipped).toBe(0); // still open — NOT fabricated as shipped
  });

  it("matches SKUs case-insensitively and through the legacy 'SKU: ' prefix", async () => {
    const s = makeStorage([
      { id: "l1", sku: "SKU: fg-1", qtyOrdered: 2, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
    ]);

    await reconcileShippedLines(s, "so1", {
      fulfillments: [{ status: "success", line_items: [{ sku: "FG-1", quantity: 2 }] }],
      fillToOrdered: false,
    });

    expect(s.lines[0].qtyShipped).toBe(2);
  });

  it("matches SKU-less lines through the SHOPIFY-{lineItemId} fallback key", async () => {
    const s = makeStorage([
      { id: "l1", sku: "SHOPIFY-987", qtyOrdered: 1, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
    ]);

    await reconcileShippedLines(s, "so1", {
      fulfillments: [{ status: "success", line_items: [{ id: 987, sku: null, quantity: 1 }] }],
      fillToOrdered: false,
    });

    expect(s.lines[0].qtyShipped).toBe(1);
  });

  it("does nothing on partial paths when the payload carries no per-line data (no fabrication)", async () => {
    const s = makeStorage([
      { id: "l1", sku: "FG-1", qtyOrdered: 4, qtyShipped: 0, qtyFulfilled: 0, backorderQty: 0 },
    ]);

    await reconcileShippedLines(s, "so1", { fulfillments: [], fillToOrdered: false });

    expect(s.lines[0].qtyShipped).toBe(0);
    expect(s.updateCalls).toHaveLength(0);
  });

  it("returns early for orders with no lines", async () => {
    const s = makeStorage([]);
    const spy = vi.spyOn(s, "updateSalesOrderLine");
    const res = await reconcileShippedLines(s, "so-empty");
    expect(res).toEqual({ linesSeen: 0, linesUpdated: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("zeroes a stale backorderQty even when quantities were already filled", async () => {
    const s = makeStorage([
      { id: "l1", sku: "FG-1", qtyOrdered: 4, qtyShipped: 4, qtyFulfilled: 4, backorderQty: 2 },
    ]);

    await reconcileShippedLines(s, "so1");

    expect(s.lines[0].backorderQty).toBe(0);
    expect(s.updateCalls).toEqual([{ id: "l1", updates: { backorderQty: 0 } }]);
  });
});
