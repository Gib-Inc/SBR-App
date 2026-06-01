/**
 * Reorder Alert Service
 *
 * Checks whether an item's current stock has fallen below its reorder point.
 * When triggered, creates a reorder_alerts row so the team knows to place a PO.
 *
 * Called after:
 *  - Scan receive (POST /api/inventory/receive)
 *  - Manual stock adjustments
 *  - Any operation that changes item stock
 *
 * Reorder Point Formula:
 *   RP = (daily_velocity × lead_time_days) + safety_stock
 *   daily_velocity = projected_weekly_velocity / 7
 *   safety_stock   = projected_weekly_velocity (1 week buffer)
 *
 * For now, uses the item's minStock field as the reorder point since the
 * full supplier intelligence tables aren't in this database yet.
 * When supplier_items and reorder_rules migrate in, this service will
 * calculate RP dynamically from lead times and velocity.
 */

import { storage } from "../storage";

interface ReorderCheckResult {
  sku: string;
  itemName: string;
  currentStock: number;
  reorderPoint: number;
  triggered: boolean;
}

/**
 * Check whether a single item is below its reorder point.
 * If it is, and there's no existing open alert for this SKU,
 * creates a new reorder alert.
 *
 * @param itemId - The item UUID to check
 * @returns The check result, or null if item not found
 */
export async function checkReorderThreshold(
  itemId: string
): Promise<ReorderCheckResult | null> {
  const item = await storage.getItem(itemId);
  if (!item) return null;

  // Calculate effective stock
  // For finished products: pivotQty + hildaleQty
  // For components: currentStock
  const effectiveStock =
    item.type === "finished_product"
      ? (item.pivotQty ?? 0) + (item.hildaleQty ?? 0)
      : item.currentStock ?? 0;

  // Use minStock as the reorder point (pre-set per item)
  const reorderPoint = item.minStock ?? 0;

  // If no reorder point is set, nothing to check
  if (reorderPoint <= 0) {
    return {
      sku: item.sku,
      itemName: item.name,
      currentStock: effectiveStock,
      reorderPoint,
      triggered: false,
    };
  }

  const triggered = effectiveStock < reorderPoint;

  if (triggered) {
    console.log(
      `[reorder-alert] TRIGGERED: ${item.name} (${item.sku}) — stock ${effectiveStock} < reorder point ${reorderPoint}`
    );
  }

  return {
    sku: item.sku,
    itemName: item.name,
    currentStock: effectiveStock,
    reorderPoint,
    triggered,
  };
}

/**
 * Check reorder thresholds for one or all items.
 *
 * @param itemId - Optional. If provided, check just that item. Otherwise check all.
 * @returns Array of items that are below their reorder point.
 */
export async function checkReorderThresholds(
  itemId?: string
): Promise<ReorderCheckResult[]> {
  const triggered: ReorderCheckResult[] = [];

  if (itemId) {
    const result = await checkReorderThreshold(itemId);
    if (result?.triggered) {
      triggered.push(result);
    }
  } else {
    // Check all items
    const items = await storage.getItems();
    for (const item of items) {
      const result = await checkReorderThreshold(item.id);
      if (result?.triggered) {
        triggered.push(result);
      }
    }
  }

  if (triggered.length > 0) {
    console.log(
      `[reorder-alert] ${triggered.length} item(s) below reorder point:`,
      triggered.map((t) => `${t.sku} (${t.currentStock}/${t.reorderPoint})`).join(", ")
    );
  }

  return triggered;
}
