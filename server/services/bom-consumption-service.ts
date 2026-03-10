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

import { InventoryMovement } from "./inventory-movement";
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
  lineItems: BomLineItem[],
  orderId: string,
  channel: string,
  storage: IStorage,
  userId?: string
): Promise<BomConsumptionResult> {
  const inventoryMovement = new InventoryMovement(storage);
  const result: BomConsumptionResult = {
    componentsSubtracted: 0,
    warnings: [],
    errors: [],
  };

  for (const lineItem of lineItems) {
    const { sku, qtyFulfilled } = lineItem;

    if (!sku) {
      result.warnings.push(`Line item has no SKU — skipped BOM subtraction`);
      continue;
    }

    if (qtyFulfilled <= 0) continue;

    // Resolve product — try channel-specific SKU first, fall back to house SKU
    let product = await storage.findProductByShopifySku(sku).catch(() => null);
    if (!product) {
      product = await storage.getItemBySku(sku).catch(() => null);
    }

    if (!product) {
      result.warnings.push(`SKU "${sku}" not found in database — skipped BOM subtraction`);
      continue;
    }

    // Only finished products have BOMs — skip components/accessories
    if (product.type !== "finished_product") continue;

    const bom = await storage.getBillOfMaterialsByProductId(product.id);
    if (!bom || bom.length === 0) {
      result.warnings.push(`No BOM defined for "${sku}" (${product.name}) — raw materials NOT subtracted`);
      continue;
    }

    // Subtract each BOM component × qty fulfilled
    for (const bomEntry of bom) {
      const requiredQty = bomEntry.quantityRequired * qtyFulfilled;

      const movementResult = await inventoryMovement.apply({
        eventType: "BOM_CONSUMPTION",
        itemId: bomEntry.componentId,
        quantity: requiredQty,
        location: "N/A",
        source: channel.toUpperCase() as any,
        orderId,
        channel: channel.toLowerCase(),
        userId,
        notes: `BOM consumption: ${requiredQty} units consumed for ${qtyFulfilled}× ${sku} (Order ${orderId}) [${channel}]`,
      });

      if (movementResult.success) {
        result.componentsSubtracted++;
      } else {
        result.errors.push(
          `Failed to subtract component ${movementResult.sku || bomEntry.componentId} for ${sku}: ${movementResult.error}`
        );
      }
    }
  }

  return result;
}
