/**
 * AI Batch Scheduler Service
 * 
 * Schedules automated batch runs of the AI recommendation engine at:
 * - 10:00 AM Mountain Time (America/Denver)
 * - 3:00 PM Mountain Time (America/Denver)
 * 
 * Also provides debounced critical trigger functionality.
 */

import { runInventoryRecommendationsBatch, inventoryRecommendationBatch, type BatchRunReason } from "./inventory-recommendation-batch";

const TIMEZONE = "America/Denver";

// Track scheduled jobs
let schedulerInitialized = false;
let nextScheduledRun: { time: Date; reason: BatchRunReason } | null = null;

/**
 * Convert a local time in Mountain timezone to a Date object
 */
function getMountainTime(hour: number, minute: number = 0): Date {
  const now = new Date();
  
  // Create a date in Mountain time by using toLocaleString
  const mountainNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  
  // Set the target time
  const target = new Date(mountainNow);
  target.setHours(hour, minute, 0, 0);
  
  // If target time has passed today, schedule for tomorrow
  if (target <= mountainNow) {
    target.setDate(target.getDate() + 1);
  }
  
  // Convert back to UTC by calculating the offset
  const utcOffset = mountainNow.getTime() - now.getTime();
  return new Date(target.getTime() - utcOffset);
}

/**
 * Get the next scheduled run time and reason
 */
function getNextScheduledRun(): { time: Date; reason: BatchRunReason } {
  const run10am = getMountainTime(10, 0);
  const run3pm = getMountainTime(15, 0);
  
  if (run10am <= run3pm) {
    return { time: run10am, reason: "SCHEDULED_10AM" };
  } else {
    return { time: run3pm, reason: "SCHEDULED_3PM" };
  }
}

/**
 * Calculate milliseconds until the next scheduled run
 */
function msUntilNextRun(targetTime: Date): number {
  return Math.max(0, targetTime.getTime() - Date.now());
}

/**
 * Run a scheduled batch and schedule the next one
 */
async function runScheduledBatch(reason: BatchRunReason): Promise<void> {
  console.log(`[AI Scheduler] Running scheduled batch: ${reason}`);
  
  try {
    const result = await runInventoryRecommendationsBatch({ reason });
    
    if (result.success) {
      console.log(`[AI Scheduler] Batch completed successfully: ${result.processedSkus} SKUs, ${result.criticalItemsFound} critical, ${result.orderTodayCount} order today`);
    } else {
      console.error(`[AI Scheduler] Batch failed: ${result.error}`);
    }
  } catch (error: any) {
    console.error(`[AI Scheduler] Batch error:`, error);
  }
  
  // Schedule the next run
  scheduleNextRun();
}

/**
 * Schedule the next batch run
 */
function scheduleNextRun(): void {
  nextScheduledRun = getNextScheduledRun();
  const msUntil = msUntilNextRun(nextScheduledRun.time);
  
  console.log(`[AI Scheduler] Next run scheduled: ${nextScheduledRun.reason} at ${nextScheduledRun.time.toISOString()} (in ${Math.round(msUntil / 60000)} minutes)`);
  
  setTimeout(() => {
    runScheduledBatch(nextScheduledRun!.reason);
  }, msUntil);
}

/**
 * Initialize the scheduler
 * Should be called once when the server starts
 */
export function initializeScheduler(): void {
  if (schedulerInitialized) {
    console.log("[AI Scheduler] Already initialized");
    return;
  }
  
  schedulerInitialized = true;
  console.log("[AI Scheduler] Initializing scheduler for Mountain Time (America/Denver)");
  
  // Schedule the first run
  scheduleNextRun();
  
  // Set up periodic debounce cleanup (every hour)
  setInterval(() => {
    inventoryRecommendationBatch.cleanupDebounceMap();
  }, 60 * 60 * 1000);
  
  console.log("[AI Scheduler] Scheduler initialized");
}

/**
 * Get the next scheduled run info
 */
export function getSchedulerStatus(): { 
  initialized: boolean; 
  nextRun: { time: Date; reason: BatchRunReason } | null;
  timezone: string;
} {
  return {
    initialized: schedulerInitialized,
    nextRun: nextScheduledRun,
    timezone: TIMEZONE,
  };
}

/**
 * Manually trigger a batch run
 */
export async function triggerManualBatch(): Promise<{ success: boolean; message: string }> {
  console.log("[AI Scheduler] Manual batch triggered");
  
  const result = await runInventoryRecommendationsBatch({ reason: "MANUAL" });
  
  return {
    success: result.success,
    message: result.success 
      ? `Batch completed: ${result.processedSkus} SKUs processed, ${result.criticalItemsFound} critical items, ${result.orderTodayCount} order today`
      : `Batch failed: ${result.error}`,
  };
}

/**
 * Check if a SKU should trigger a critical batch run
 * Call this after inventory updates that might affect stock levels
 */
export async function checkAndTriggerCritical(
  sku: string, 
  itemId: string,
  daysUntilStockout: number,
  leadTimeDays: number,
  riskThresholdHighDays: number = 0
): Promise<boolean> {
  // Check if this SKU is now in critical state
  if (inventoryRecommendationBatch.isCritical(daysUntilStockout, leadTimeDays, riskThresholdHighDays)) {
    return await inventoryRecommendationBatch.scheduleCriticalTrigger(sku, itemId);
  }
  return false;
}

// Export for testing
export { getMountainTime, getNextScheduledRun };
