/**
 * CIPH.R — inventory-spend anticipation.
 * Combines active reorder alerts (what needs ordering) with item cost + velocity
 * (how much + WHEN) to project upcoming inventory cash needs on a timeline.
 *
 * ANTI-HALLUCINATION: items with no purchase cost are counted but their spend is
 * left null ("cost unknown"), never guessed; the total reflects only known costs
 * and the response reports how many are missing a cost.
 */
import { storage } from "../storage";

export type SpendBucket = "overdue" | "d0_30" | "d31_60" | "d61_90" | "d90_plus" | "unknown";

export interface AnticipateInput {
  recommendedQty: number | null;
  unitCost: number | null;
  currentStock: number;
  dailyUsage: number;
}
export interface AnticipateResult {
  projectedCost: number | null;
  daysOfCover: number | null;
  bucket: SpendBucket;
}

/** Pure: projected cost + when stock runs out + which timeline bucket. */
export function anticipateItem(i: AnticipateInput): AnticipateResult {
  const projectedCost =
    i.unitCost != null && i.recommendedQty != null ? Math.round(i.unitCost * i.recommendedQty * 100) / 100 : null;

  let daysOfCover: number | null;
  if (i.currentStock <= 0) daysOfCover = 0;
  else if (i.dailyUsage > 0) daysOfCover = Math.floor(i.currentStock / i.dailyUsage);
  else daysOfCover = null; // no usage signal -> timing unknown

  let bucket: SpendBucket;
  if (daysOfCover === null) bucket = "unknown";
  else if (daysOfCover <= 0) bucket = "overdue";
  else if (daysOfCover <= 30) bucket = "d0_30";
  else if (daysOfCover <= 60) bucket = "d31_60";
  else if (daysOfCover <= 90) bucket = "d61_90";
  else bucket = "d90_plus";

  return { projectedCost, daysOfCover, bucket };
}

export interface AnticipatedItem {
  sku: string;
  name: string;
  supplierName: string | null;
  recommendedQty: number | null;
  unitCost: number | null;
  projectedCost: number | null;
  currentStock: number;
  daysOfCover: number | null;
  bucket: SpendBucket;
}

export interface InventoryAnticipation {
  items: AnticipatedItem[];
  totalKnownCost: number;
  missingCostCount: number;
  buckets: Record<SpendBucket, number>; // known-cost spend per timeline bucket
}

export async function getInventorySpendAnticipation(): Promise<InventoryAnticipation> {
  const [alerts, allItems] = await Promise.all([storage.getReorderAlerts(), storage.getAllItems()]);
  const itemById = new Map(allItems.map((it: any) => [it.id, it]));

  // Active alerts only (still need ordering); keep the latest per item.
  const active = alerts.filter((a: any) => ["pending", "acknowledged", "failed", "open"].includes((a.alertStatus || a.status || "").toLowerCase()));
  const latestByItem = new Map<string, any>();
  for (const a of active) {
    const prev = latestByItem.get(a.itemId);
    if (!prev || new Date(a.createdAt) > new Date(prev.createdAt)) latestByItem.set(a.itemId, a);
  }

  const items: AnticipatedItem[] = [];
  const buckets: Record<SpendBucket, number> = { overdue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, unknown: 0 };
  let totalKnownCost = 0;
  let missingCostCount = 0;

  for (const a of Array.from(latestByItem.values())) {
    const it: any = itemById.get(a.itemId) || {};
    const recommendedQty = a.recommendedQty ?? a.suggestedOrderQty ?? null;
    const unitCost = it.defaultPurchaseCost != null ? Number(it.defaultPurchaseCost) : null;
    const currentStock = a.currentStock ?? it.currentStock ?? 0;
    const dailyUsage = Number(it.dailyUsage) || 0;
    const r = anticipateItem({ recommendedQty, unitCost, currentStock, dailyUsage });
    if (r.projectedCost == null) missingCostCount++;
    else {
      totalKnownCost += r.projectedCost;
      buckets[r.bucket] += r.projectedCost;
    }
    items.push({
      sku: a.sku || it.sku || "",
      name: it.name || a.sku || "(unknown item)",
      supplierName: a.supplierName ?? null,
      recommendedQty,
      unitCost,
      projectedCost: r.projectedCost,
      currentStock,
      daysOfCover: r.daysOfCover,
      bucket: r.bucket,
    });
  }

  // soonest-needed first (overdue, then by days of cover)
  const order: Record<SpendBucket, number> = { overdue: 0, d0_30: 1, d31_60: 2, d61_90: 3, d90_plus: 4, unknown: 5 };
  items.sort((a, b) => order[a.bucket] - order[b.bucket] || (a.daysOfCover ?? 9999) - (b.daysOfCover ?? 9999));

  return { items, totalKnownCost: Math.round(totalKnownCost * 100) / 100, missingCostCount, buckets };
}
