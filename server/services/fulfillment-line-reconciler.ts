/**
 * fulfillment-line-reconciler — P0-3: the ONE shared implementation that fills
 * sales_order_lines.qty_shipped / qty_fulfilled when an order transitions to
 * SHIPPED / DELIVERED.
 *
 * Why this exists: until Jul 2026 only POST /api/sales-orders/:id/ship wrote
 * accurate per-line qty_shipped. Every other path that lands an order in
 * SHIPPED/DELIVERED (Shopify webhooks orders/fulfilled, orders/partially_fulfilled,
 * fulfillments/create, fulfillments/update; the Shopify/Amazon sync routes; the
 * reconciliation scheduler; the manual PATCH) left qty_shipped=0, so
 * "open = ordered − shipped" math (drift resolver, backorder views) had to
 * exclude SHIPPED orders entirely. d439c69 added the first fill in
 * handleOrderUpdated; this module generalizes those exact semantics so every
 * transition path shares one implementation.
 *
 * Source precedence for the per-line shipped quantity:
 *   1. Shopify per-fulfillment quantities (fulfillments[].line_items[].quantity,
 *      summed per line-item SKU) — most precise, supports partial fulfillment.
 *   2. Channel per-line shipped counts (Amazon OrderItems[].QuantityShipped).
 *   3. qtyOrdered fill — ONLY when the caller asserts the whole order shipped
 *      (fillToOrdered, default true; pass false on partial-fulfillment paths).
 *
 * Invariants:
 *   - NEVER decreases qty_shipped or qty_fulfilled (POST /ship's precise counts win).
 *   - Caps per-line shipped at qty_ordered.
 *   - Zeroes backorderQty on fully-shipped lines (a shipped order owes nothing).
 *   - Touches ONLY fulfillment bookkeeping fields on sales_order_lines. It never
 *     writes stock: items.* quantities remain governed exclusively by
 *     InventoryMovement.apply().
 */

export interface ShopifyFulfillmentLineItem {
  id?: string | number | null;
  sku?: string | null;
  quantity?: number | null;
}

/** Shape of one entry of a Shopify order payload's `fulfillments[]` array, or of
 *  a fulfillments/create | fulfillments/update webhook payload itself. */
export interface ShopifyFulfillment {
  status?: string | null; // 'success' | 'cancelled' | 'pending' | ...
  line_items?: ShopifyFulfillmentLineItem[] | null;
  [key: string]: any;
}

/** Amazon SP-API per-line shipped counts (OrderItems[].QuantityShipped). */
export interface AmazonShippedLine {
  sku: string | null | undefined;
  qtyShipped: number | null | undefined;
}

export interface ReconcileShippedLinesOptions {
  fulfillments?: ShopifyFulfillment[] | null;
  amazonLines?: AmazonShippedLine[] | null;
  /**
   * When true (default) the caller asserts the ORDER-level status landed
   * SHIPPED/DELIVERED for the whole order, so lines with no per-line source
   * data are filled to qtyOrdered (d439c69's original fill semantics).
   * Pass false on partial-fulfillment paths — there, only the per-fulfillment
   * quantities are trustworthy and the remainder must stay open
   * (open = ordered − fulfilled-sum).
   */
  fillToOrdered?: boolean;
}

/** Minimal structural slice of IStorage this reconciler needs — satisfied by
 *  MemStorage, PostgresStorage, and the webhook-handler test doubles alike. */
export interface ReconcilerStorage {
  getSalesOrderLines(salesOrderId: string): Promise<any[]>;
  updateSalesOrderLine(id: string, updates: Record<string, any>): Promise<any>;
}

export interface ReconcileResult {
  linesSeen: number;
  linesUpdated: number;
}

/** Same normalization family as order-create SKU matching: trim, strip a
 *  legacy "SKU: " prefix, case-insensitive. */
function normSku(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/^SKU:\s*/i, "").toUpperCase();
}

/**
 * Aggregate the best available per-line shipped quantities keyed by normalized
 * SKU. Per-fulfillment quantities take precedence over channel per-line counts
 * (they carry partial-fulfillment detail). Returns null when the caller
 * provided no usable per-line data at all.
 */
function shippedBySkuFromSources(opts: ReconcileShippedLinesOptions): Map<string, number> | null {
  const map = new Map<string, number>();
  let hasData = false;

  for (const f of opts.fulfillments ?? []) {
    // A cancelled fulfillment shipped nothing.
    if ((f?.status ?? "").toString().toLowerCase() === "cancelled") continue;
    for (const li of f?.line_items ?? []) {
      // Fulfillment line_items reuse the ORDER line-item id, so the
      // `SHOPIFY-${id}` fallback matches lines created from SKU-less items.
      const key = normSku(li?.sku) || (li?.id != null ? normSku(`SHOPIFY-${li.id}`) : "");
      const qty = Number(li?.quantity ?? 0);
      if (!key || !Number.isFinite(qty) || qty <= 0) continue;
      map.set(key, (map.get(key) ?? 0) + qty);
      hasData = true;
    }
  }

  if (!hasData) {
    for (const al of opts.amazonLines ?? []) {
      const key = normSku(al?.sku);
      const qty = Number(al?.qtyShipped ?? 0);
      if (!key || !Number.isFinite(qty) || qty <= 0) continue;
      map.set(key, (map.get(key) ?? 0) + qty);
      hasData = true;
    }
  }

  return hasData ? map : null;
}

/**
 * Reconcile a sales order's line qty_shipped / qty_fulfilled after a
 * SHIPPED/DELIVERED transition (or a partial fulfillment event).
 *
 * Multi-line orders sharing one SKU are handled by aggregation: the shipped
 * total for that SKU is distributed across its lines in storage order, each
 * line capped at its own qtyOrdered.
 */
export async function reconcileShippedLines(
  storage: ReconcilerStorage,
  orderId: string,
  opts: ReconcileShippedLinesOptions = {},
): Promise<ReconcileResult> {
  const fillToOrdered = opts.fillToOrdered ?? true;
  const lines = await storage.getSalesOrderLines(orderId);
  const result: ReconcileResult = { linesSeen: lines.length, linesUpdated: 0 };
  if (!lines.length) return result;

  const shipped = shippedBySkuFromSources(opts);
  // Mutable remainder per SKU so same-SKU lines split the shipped total.
  const remaining = shipped ? new Map(shipped) : null;

  for (const line of lines) {
    const ordered = Number(line.qtyOrdered ?? 0);
    const curShipped = Number(line.qtyShipped ?? 0);
    const curFulfilled = Number(line.qtyFulfilled ?? 0);

    // Per-line target from the best available source.
    let target: number | null = null;
    if (remaining) {
      const key = normSku(line.sku);
      const avail = key ? (remaining.get(key) ?? 0) : 0;
      if (avail > 0) {
        target = Math.min(ordered, avail);
        remaining.set(key, avail - target);
      } else if (fillToOrdered) {
        // Whole-order transition but this line's SKU is absent from the
        // per-line data (payload gap / SKU alias mismatch) — fall back to the
        // qtyOrdered fill, exactly like the no-per-line-data case.
        target = ordered;
      }
    } else if (fillToOrdered) {
      target = ordered;
    }

    if (target === null || target <= 0) continue;

    // NEVER decrease what a more precise path (POST /ship) already recorded.
    const newShipped = Math.max(curShipped, target);
    const newFulfilled = Math.max(curFulfilled, target);
    const fullyShipped = newShipped >= ordered;

    const updates: Record<string, number> = {};
    if (newShipped !== curShipped) updates.qtyShipped = newShipped;
    if (newFulfilled !== curFulfilled) updates.qtyFulfilled = newFulfilled;
    if (fullyShipped && Number(line.backorderQty ?? 0) !== 0) updates.backorderQty = 0;
    if (Object.keys(updates).length === 0) continue;

    await storage.updateSalesOrderLine(line.id, updates);
    result.linesUpdated++;
  }

  return result;
}
