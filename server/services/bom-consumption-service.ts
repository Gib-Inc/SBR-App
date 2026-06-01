/**
 * BOM Consumption Service
 * ──────────────────────
 * Single shared function that subtracts raw material components whenever
 * a finished product is fulfilled/shipped — regardless of channel.
 *
 * Called from three places:
 *  1. Shopify webhook  → handleOrderFulfilled  (already existed, now refactored here)
 *  2. Amazon sync      → when order status becomes SHIPPED/DELIVERED
 *  3. Manual fulfill   → POST /api/sales-orders/:id/fulfill
 *
 * Teaching note:
 *  This is the "DRY" principle (Don't Repeat Yourself). Instead of copying
 *  the same BOM logic into three different files, we put it in one place
 *  and call it from everywhere. If the logic ever needs to change (e.g.
 *  you add a "waste factor"), you fix it here once.
 */

import type { IStorage } from "../storage";

export interface BomLineItem {
  sku: string;          // House SKU or channel SKU
  qtyFulfilled: number;
}

export interface BomConsumptionResult {
  componentsSubtracted: number;
  warnings: string[];
  errors: string[];
}

/**
 * consumeBomForFulfilledOrder
 *
 * Given a list of fulfilled line items (SKU + qty), looks up each product's
 * BOM and subtracts the required raw materials from currentStock.
 *
 * @param lineItems   - Array of { sku, qtyFulfilled }
 * @param orderId     - For audit log / notes
 * @param channel     - "SHOPIFY" | "AMAZON" | "DIRECT" | "OTHER"
 * @param storage     - DB storage interface
 * @param userId      - Who triggered this (webhook system user or staff id)
 */
export async function consumeBomForFulfilledOrder(
  _lineItems: BomLineItem[],
  _orderId: string,
  _channel: string,
  _storage: IStorage,
  _userId?: string
): Promise<BomConsumptionResult> {
  // C3 FIX — BOM is consumed at PRODUCTION time only (Production screen → "built"),
  // NOT at fulfillment. SBR builds-to-stock: raw materials are drawn when the
  // finished good is built; shipping that good later must NOT draw materials a
  // second time. Doing both double-counts every component.
  //
  // This function is intentionally retained as a no-op so the existing call sites
  // (Shopify orders/fulfilled, Amazon sync, manual fulfill) stay wired and keep
  // their result-shape contract, while fulfillment-time consumption is disabled.
  // If the operating model ever changes to build-to-order, re-enable a draw here
  // behind an explicit guard rather than reverting wholesale.
  return { componentsSubtracted: 0, warnings: [], errors: [] };
}
