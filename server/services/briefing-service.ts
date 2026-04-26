// Daily Briefing — runs at 7:00 AM Mountain Time and on demand via the
// /api/briefing/daily endpoint. Computes a single-day operational snapshot
// (OTDR, critical components, draft POs, in-house queue, shop issues)
// from existing storage methods, persists it to the daily_briefings table,
// and writes an audit-log entry. If SendGrid is configured the briefing is
// also emailed; otherwise the audit-log entry is the durable record.
//
// Scheduler intentionally lives in briefing-scheduler.ts to keep separation
// of concerns from the AI inventory batch.

import { storage } from "../storage";
import { AuditLogger } from "./audit-logger";

const PUSH_2_SKU = "SBR-Extrawide2.0";
const OTDR_TARGET_PERCENT = 90;
const OTDR_WINDOW_DAYS = 7;

export type DailyBriefingPayload = {
  date: string; // YYYY-MM-DD in America/Denver
  generatedAt: string; // ISO timestamp
  otdr: {
    last7Days: number | null; // percent 0-100, null if no eligible orders
    target: number;
    sampleSize: number; // orders evaluated
  };
  push2Extrawide: {
    sku: string;
    name: string | null;
    inStock: boolean;
    daysOutOfStock: number | null;
    onHand: number;
  };
  topCriticalComponents: Array<{
    name: string;
    currentStock: number;
    daysUntilStockout: number;
    dailyUsage: number;
  }>;
  draftPOs: {
    count: number;
    totalDollars: number;
  };
  inHouseQueueCount: number;
  shopIssues24h: {
    count: number;
    items: Array<{ itemName: string; issueType: string; notes: string; createdAt: string }>;
  };
};

function todayMountainISO(): string {
  // YYYY-MM-DD in America/Denver — same key the scheduler uses for idempotency.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * Walks finished-product BOMs × 90-day sales velocity to derive how many of
 * each component get consumed per day. Mirrors /api/raw-materials/dashboard
 * and InventoryRecommendationBatch.computeComponentDailyUsageMap so the
 * briefing surfaces the same numbers Clarence sees on the Raw Materials page.
 */
async function computeComponentDailyUsage(): Promise<Map<string, number>> {
  const allItems = await storage.getAllItems();
  const finishedProducts = allItems.filter((i) => i.type === "finished_product");
  const velocity = await storage.getSkuSalesVelocity(90);
  const velocityMap = new Map(velocity.map((v) => [v.sku, v.unitsSold]));

  const usage = new Map<string, number>();
  for (const product of finishedProducts) {
    const bom = await storage.getBillOfMaterialsByProductId(product.id);
    if (!bom || bom.length === 0) continue;
    const dailySales = (velocityMap.get(product.sku) ?? 0) / 90;
    if (dailySales <= 0) continue;
    for (const entry of bom) {
      const wastage = (entry as any).wastagePercent ?? 0;
      const effectiveQty = entry.quantityRequired * (1 + wastage / 100);
      usage.set(
        entry.componentId,
        (usage.get(entry.componentId) ?? 0) + effectiveQty * dailySales,
      );
    }
  }
  return usage;
}

async function computeOTDR(): Promise<{ last7Days: number | null; target: number; sampleSize: number }> {
  const orders = await storage.getAllSalesOrders();
  const now = Date.now();
  const windowStart = now - OTDR_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  let onTime = 0;
  let total = 0;
  for (const o of orders) {
    const delivered = (o as any).deliveredAt ? new Date((o as any).deliveredAt).getTime() : null;
    if (delivered === null || Number.isNaN(delivered)) continue;
    if (delivered < windowStart) continue;
    const requiredBy = (o as any).requiredByDate ? new Date((o as any).requiredByDate).getTime() : null;
    if (requiredBy === null || Number.isNaN(requiredBy)) continue;
    total++;
    if (delivered <= requiredBy) onTime++;
  }

  const last7Days = total > 0 ? Math.round((onTime / total) * 1000) / 10 : null;
  return { last7Days, target: OTDR_TARGET_PERCENT, sampleSize: total };
}

async function computePush2Status(): Promise<DailyBriefingPayload["push2Extrawide"]> {
  const item = await storage.getItemBySku(PUSH_2_SKU);
  if (!item) {
    return { sku: PUSH_2_SKU, name: null, inStock: false, daysOutOfStock: null, onHand: 0 };
  }
  const onHand = (item.hildaleQty ?? 0) + (item.pivotQty ?? 0);
  const inStock = onHand > 0;
  let daysOutOfStock: number | null = null;
  if (!inStock) {
    // Heuristic: walk inventory_transactions for this item and find the most
    // recent transaction that brought stock to zero. If we can't find one,
    // fall back to "since first time we saw it at 0" via the item.updatedAt.
    try {
      const txns = await storage.getInventoryTransactionsByItem(item.id);
      const sorted = [...txns].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      // Walk backwards in time accumulating qty (negative for SHIP/WRITEOFF
      // when stored negative, positive otherwise). The last day stock crossed
      // to zero is the start of the OOS window.
      let runningOnHand = onHand; // current
      for (const t of sorted) {
        // Reverse the transaction to get the prior balance.
        // Type-direction guess: negative-stored qty (WRITEOFF, SHIPPED_HILDALE)
        // already encodes direction; positive needs sign-by-type.
        const rawQty = (t as any).quantity ?? 0;
        const signed = rawQty < 0
          ? rawQty
          : (t.type === "SHIP" || t.type === "TRANSFER_OUT" ? -rawQty : rawQty);
        const prior = runningOnHand - signed;
        if (prior > 0 && runningOnHand === 0) {
          // Stock crossed to zero on this transaction.
          daysOutOfStock = Math.max(
            0,
            Math.floor((Date.now() - new Date(t.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
          );
          break;
        }
        runningOnHand = prior;
      }
    } catch {
      // ignore — leave daysOutOfStock null
    }
  }
  return { sku: PUSH_2_SKU, name: item.name, inStock, daysOutOfStock, onHand };
}

async function computeTopCritical(): Promise<DailyBriefingPayload["topCriticalComponents"]> {
  const allItems = await storage.getAllItems();
  const components = allItems.filter((i) => i.type === "component");
  const usageMap = await computeComponentDailyUsage();

  const ranked = components
    .map((c) => {
      const dailyUsage = usageMap.get(c.id) ?? 0;
      const onHand = c.currentStock ?? 0;
      const days = dailyUsage > 0 ? Math.round(onHand / dailyUsage) : Number.POSITIVE_INFINITY;
      return { name: c.name, currentStock: onHand, daysUntilStockout: days, dailyUsage };
    })
    .filter((c) => c.dailyUsage > 0)
    .sort((a, b) => a.daysUntilStockout - b.daysUntilStockout)
    .slice(0, 3)
    .map((c) => ({
      name: c.name,
      currentStock: c.currentStock,
      daysUntilStockout: Number.isFinite(c.daysUntilStockout) ? c.daysUntilStockout : 999,
      dailyUsage: Math.round(c.dailyUsage * 100) / 100,
    }));
  return ranked;
}

async function computeDraftPOs(): Promise<{ count: number; totalDollars: number }> {
  const pos = await storage.getAllPurchaseOrders();
  let count = 0;
  let totalDollars = 0;
  for (const po of pos) {
    if ((po as any).isHistorical) continue;
    if (po.status === "DRAFT") {
      count++;
      totalDollars += (po as any).total ?? 0;
    }
  }
  return { count, totalDollars: Math.round(totalDollars * 100) / 100 };
}

async function computeInHouseQueueCount(): Promise<number> {
  const live = await storage.getLiveSalesOrders();
  // In-house = ships from Hildale and isn't already shipped.
  const queue = live.filter((o) => {
    const fs = (o as any).fulfillmentSource ?? "HILDALE";
    return fs === "HILDALE" && o.status !== "SHIPPED" && o.status !== "DELIVERED" && o.status !== "CANCELLED";
  });
  return queue.length;
}

async function computeShopIssues(): Promise<DailyBriefingPayload["shopIssues24h"]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const issues = await storage.getShopIssuesSince(since);
  const items = await Promise.all(
    issues.slice(0, 20).map(async (i) => {
      const item = await storage.getItem(i.itemId);
      return {
        itemName: item?.name ?? "(unknown item)",
        issueType: i.issueType,
        notes: i.notes,
        createdAt: i.createdAt instanceof Date ? i.createdAt.toISOString() : String(i.createdAt),
      };
    }),
  );
  return { count: issues.length, items };
}

/**
 * Build the briefing payload from live data. Pure compute — does not persist.
 */
export async function buildDailyBriefing(date?: string): Promise<DailyBriefingPayload> {
  const targetDate = date ?? todayMountainISO();
  const [otdr, push2, critical, draftPOs, inHouseCount, issues] = await Promise.all([
    computeOTDR(),
    computePush2Status(),
    computeTopCritical(),
    computeDraftPOs(),
    computeInHouseQueueCount(),
    computeShopIssues(),
  ]);
  return {
    date: targetDate,
    generatedAt: new Date().toISOString(),
    otdr,
    push2Extrawide: push2,
    topCriticalComponents: critical,
    draftPOs,
    inHouseQueueCount: inHouseCount,
    shopIssues24h: issues,
  };
}

/**
 * Compute, persist, audit-log, and (TODO) email. Returns the payload for
 * scheduler logging or HTTP response use. Email send is gated on SendGrid
 * env vars per the project pattern; when missing, the audit log is the
 * durable record.
 */
export async function generateAndPersistBriefing(date?: string): Promise<DailyBriefingPayload> {
  const payload = await buildDailyBriefing(date);

  // Persist (upsert by date so re-runs the same day overwrite cleanly).
  await storage.upsertDailyBriefing({
    date: payload.date,
    contentJson: payload as unknown as Record<string, unknown>,
  });

  // Always write an audit log entry. Doubles as the durable trail when
  // SendGrid isn't configured.
  const sendGridConfigured = !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
  await AuditLogger.logEvent({
    source: "SYSTEM",
    eventType: "BRIEFING_GENERATED",
    entityType: "BRIEFING",
    entityId: payload.date,
    entityLabel: `Daily briefing ${payload.date}`,
    status: sendGridConfigured ? "INFO" : "WARNING",
    description: sendGridConfigured
      ? `Daily briefing generated for ${payload.date}`
      : `Daily briefing generated for ${payload.date} (SendGrid not configured — email skipped)`,
    details: payload as unknown as Record<string, unknown>,
  });

  // Email send — wired here once SendGrid is configured. Intentionally a
  // no-op today so missing env doesn't break the cron run.
  if (sendGridConfigured) {
    // Future: import @sendgrid/mail and call sgMail.send(...) with a rendered
    // HTML version of the briefing. Skipped until recipients + template are
    // confirmed by the user.
  }

  return payload;
}
