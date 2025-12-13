import { storage } from "../storage";
import { ghlOpportunitiesService } from "./ghl-opportunities-service";

const REFUND_CLEANUP_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // Run once daily

let cleanupInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export async function cleanupOldRefundedOpportunities(userId: string): Promise<{
  checked: number;
  deleted: number;
  errors: number;
}> {
  if (isRunning) {
    console.log("[Refund Cleanup] Already running, skipping");
    return { checked: 0, deleted: 0, errors: 0 };
  }

  isRunning = true;
  const stats = { checked: 0, deleted: 0, errors: 0 };

  try {
    console.log("[Refund Cleanup] Starting cleanup of old refunded opportunities");

    const initialized = await ghlOpportunitiesService.initialize(userId);
    if (!initialized) {
      console.log("[Refund Cleanup] GHL not configured, skipping");
      return stats;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - REFUND_CLEANUP_DAYS);

    const allReturns = await storage.getAllReturnRequests();
    
    const oldRefundedReturns = allReturns.filter((r) => {
      if (r.status !== "REFUNDED" && r.status !== "CLOSED") return false;
      if (!r.ghlRefundOpportunityId) return false;
      if (!r.quickbooksRefundCreatedAt) return false;
      
      const refundedAt = new Date(r.quickbooksRefundCreatedAt);
      return refundedAt < cutoffDate;
    });

    console.log(`[Refund Cleanup] Found ${oldRefundedReturns.length} refunded opportunities older than ${REFUND_CLEANUP_DAYS} days`);

    for (const returnReq of oldRefundedReturns) {
      stats.checked++;
      
      if (!returnReq.ghlRefundOpportunityId) continue;

      try {
        const result = await ghlOpportunitiesService.deleteOpportunity(returnReq.ghlRefundOpportunityId);
        
        if (result.success) {
          await storage.updateReturnRequest(returnReq.id, {
            ghlRefundOpportunityId: null,
            ghlRefundOpportunityUrl: null,
          });
          stats.deleted++;
          console.log(`[Refund Cleanup] Deleted GHL opportunity for return ${returnReq.id}`);
        } else {
          stats.errors++;
          console.warn(`[Refund Cleanup] Failed to delete opportunity for return ${returnReq.id}: ${result.error}`);
        }
      } catch (error: any) {
        stats.errors++;
        console.error(`[Refund Cleanup] Error cleaning up return ${returnReq.id}:`, error.message);
      }
    }

    console.log(`[Refund Cleanup] Complete - checked: ${stats.checked}, deleted: ${stats.deleted}, errors: ${stats.errors}`);
    return stats;
  } finally {
    isRunning = false;
  }
}

export function startRefundCleanupScheduler(userId: string): void {
  if (cleanupInterval) {
    console.log("[Refund Cleanup] Scheduler already running");
    return;
  }

  console.log("[Refund Cleanup] Starting scheduler (runs daily)");

  setTimeout(() => {
    cleanupOldRefundedOpportunities(userId).catch((err) => {
      console.error("[Refund Cleanup] Scheduled run failed:", err);
    });
  }, 60 * 1000);

  cleanupInterval = setInterval(() => {
    cleanupOldRefundedOpportunities(userId).catch((err) => {
      console.error("[Refund Cleanup] Scheduled run failed:", err);
    });
  }, CLEANUP_INTERVAL_MS);
}

export function stopRefundCleanupScheduler(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log("[Refund Cleanup] Scheduler stopped");
  }
}
