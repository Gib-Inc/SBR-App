// Daily-usage / velocity calculator.
//
// Two-pass:
//   1. Finished products — units sold over the last 90 days (matched by
//      SKU on sales_order_lines, joined to sales_orders for the date
//      filter), divided by 90.
//   2. Components — sum across every BOM entry referencing the component:
//      finishedProduct.dailyUsage × quantityRequired × wastage factor.
//
// Wastage matches the live calculation in /api/raw-materials/dashboard so
// items.daily_usage and the dashboard view always agree. Order pass 1
// before pass 2 — components depend on the finished values from pass 1.

import { storage } from "../storage";

const VELOCITY_WINDOW_DAYS = 90;

export interface VelocityRefreshResult {
  finishedProductsUpdated: number;
  componentsUpdated: number;
  itemsScanned: number;
  durationMs: number;
}

/**
 * Compute the per-day usage for a single item. Used by the on-demand
 * endpoint and as the implementation primitive for refreshAllItems.
 *
 * Returns null if the item doesn't exist.
 */
export async function computeDailyUsage(itemId: string): Promise<number | null> {
  const item = await storage.getItem(itemId);
  if (!item) return null;

  const velocity = await storage.getSkuSalesVelocity(VELOCITY_WINDOW_DAYS);
  const velocityBySku = new Map(velocity.map((v) => [v.sku, v.unitsSold]));

  if (item.type === "finished_product") {
    return computeFinishedFromMap(item.sku, velocityBySku);
  }

  // For components we need every finished product's freshly computed
  // daily_usage. Compute them on the fly so the answer reflects the
  // latest velocity even if the items table hasn't been updated yet.
  const allItems = await storage.getAllItems();
  const finishedDailyUsageById = new Map<string, number>();
  for (const it of allItems) {
    if (it.type === "finished_product") {
      finishedDailyUsageById.set(it.id, computeFinishedFromMap(it.sku, velocityBySku));
    }
  }
  return await computeComponentDailyUsage(itemId, finishedDailyUsageById);
}

function computeFinishedFromMap(sku: string, velocityBySku: Map<string, number>): number {
  const units = velocityBySku.get(sku) ?? 0;
  return units / VELOCITY_WINDOW_DAYS;
}

async function computeComponentDailyUsage(
  componentId: string,
  finishedDailyUsageById: Map<string, number>,
): Promise<number> {
  const allItems = await storage.getAllItems();
  let total = 0;
  for (const it of allItems) {
    if (it.type !== "finished_product") continue;
    const bom = await storage.getBillOfMaterialsByProductId(it.id);
    for (const entry of bom) {
      if (entry.componentId !== componentId) continue;
      const wastage = (entry as any).wastagePercent ?? 0;
      const effectiveQty = entry.quantityRequired * (1 + wastage / 100);
      total += (finishedDailyUsageById.get(it.id) ?? 0) * effectiveQty;
    }
  }
  return total;
}

/**
 * Refresh daily_usage on every item.
 *
 * @param onlyZeroOrNull  When true, skip items whose current daily_usage is
 *                        already a positive number — used by the boot-time
 *                        backfill so we never overwrite a hand-entered value.
 *                        The scheduled and manual refreshes pass false to
 *                        replace stale values with the latest velocity.
 */
export async function refreshAllItems(opts: { onlyZeroOrNull: boolean }): Promise<VelocityRefreshResult> {
  const startedAt = Date.now();
  const allItems = await storage.getAllItems();
  const velocity = await storage.getSkuSalesVelocity(VELOCITY_WINDOW_DAYS);
  const velocityBySku = new Map(velocity.map((v) => [v.sku, v.unitsSold]));

  const shouldWrite = (current: number | null | undefined, computed: number) => {
    if (opts.onlyZeroOrNull) {
      const cur = current ?? 0;
      return cur === 0 && computed > 0;
    }
    // Always write when the value would change. Round to 4 decimals on both
    // sides so float jitter doesn't cause spurious updates.
    const roundedCur = Math.round((current ?? 0) * 10000) / 10000;
    const roundedNew = Math.round(computed * 10000) / 10000;
    return roundedCur !== roundedNew;
  };

  // Cache BOMs per finished product to avoid re-querying in pass 2.
  const bomByProductId = new Map<string, Awaited<ReturnType<typeof storage.getBillOfMaterialsByProductId>>>();

  // Pass 1: finished products.
  const finished = allItems.filter((i) => i.type === "finished_product");
  const newDailyUsageById = new Map<string, number>();
  let finishedUpdated = 0;
  for (const item of finished) {
    const computed = computeFinishedFromMap(item.sku, velocityBySku);
    newDailyUsageById.set(item.id, computed);
    bomByProductId.set(item.id, await storage.getBillOfMaterialsByProductId(item.id));
    if (shouldWrite(item.dailyUsage, computed)) {
      await storage.updateItem(item.id, { dailyUsage: Math.round(computed * 10000) / 10000 });
      finishedUpdated++;
    }
  }

  // Pass 2: components — aggregate the new finished daily_usage values.
  const components = allItems.filter((i) => i.type === "component");
  let componentsUpdated = 0;
  for (const item of components) {
    let computed = 0;
    for (const [productId, bom] of bomByProductId.entries()) {
      for (const entry of bom) {
        if (entry.componentId !== item.id) continue;
        const wastage = (entry as any).wastagePercent ?? 0;
        const effectiveQty = entry.quantityRequired * (1 + wastage / 100);
        computed += (newDailyUsageById.get(productId) ?? 0) * effectiveQty;
      }
    }
    if (shouldWrite(item.dailyUsage, computed)) {
      await storage.updateItem(item.id, { dailyUsage: Math.round(computed * 10000) / 10000 });
      componentsUpdated++;
    }
  }

  return {
    finishedProductsUpdated: finishedUpdated,
    componentsUpdated,
    itemsScanned: allItems.length,
    durationMs: Date.now() - startedAt,
  };
}
