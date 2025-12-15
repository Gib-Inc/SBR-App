/**
 * AI Batch Scheduler Service
 * 
 * Schedules automated batch runs of the AI recommendation engine at:
 * - 10:00 AM Mountain Time (America/Denver)
 * - 3:00 PM Mountain Time (America/Denver)
 * 
 * Uses interval-based checking for robustness against server restarts.
 * Also provides debounced critical trigger functionality.
 */

import { runInventoryRecommendationsBatch, inventoryRecommendationBatch, type BatchRunReason } from "./inventory-recommendation-batch";

const TIMEZONE = "America/Denver";

// Scheduled batch times (24-hour format in Mountain Time)
const SCHEDULED_RUNS = [
  { hour: 10, minute: 0, reason: "SCHEDULED_10AM" as BatchRunReason },
  { hour: 15, minute: 0, reason: "SCHEDULED_3PM" as BatchRunReason },
];

// Track scheduler state
let schedulerInitialized = false;
let lastRunTimestamp: { [key: string]: number } = {};  // Track last run by reason to prevent double-runs
let checkIntervalId: NodeJS.Timeout | null = null;

/**
 * Get current time in Mountain timezone as hours and minutes
 */
function getCurrentMountainTime(): { hour: number; minute: number; dateKey: string } {
  const now = new Date();
  const mountainTimeStr = now.toLocaleString("en-US", { 
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  
  // Parse the time string (format: "10:00" or "15:30")
  const [hourStr, minuteStr] = mountainTimeStr.split(":");
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  
  // Create a date key for today in Mountain time (to prevent running same batch twice in a day)
  const dateStr = now.toLocaleString("en-US", { 
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  
  return { hour, minute, dateKey: dateStr };
}

/**
 * Check if it's time to run a scheduled batch
 * Runs within a 5-minute window of the scheduled time
 */
function shouldRunBatch(scheduledHour: number, scheduledMinute: number, currentHour: number, currentMinute: number): boolean {
  // Check if we're within the target time window (5-minute window after scheduled time)
  if (currentHour !== scheduledHour) return false;
  
  const minuteDiff = currentMinute - scheduledMinute;
  return minuteDiff >= 0 && minuteDiff < 5;
}

/**
 * Generate a unique key for tracking batch runs
 */
function getBatchKey(reason: BatchRunReason, dateKey: string): string {
  return `${reason}-${dateKey}`;
}

/**
 * Run a scheduled batch
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
}

/**
 * Check if any scheduled batch should run now
 * Called every minute by the interval timer
 */
async function checkScheduledBatches(): Promise<void> {
  const { hour, minute, dateKey } = getCurrentMountainTime();
  
  for (const schedule of SCHEDULED_RUNS) {
    if (shouldRunBatch(schedule.hour, schedule.minute, hour, minute)) {
      const batchKey = getBatchKey(schedule.reason, dateKey);
      
      // Check if this batch already ran today
      if (!lastRunTimestamp[batchKey]) {
        lastRunTimestamp[batchKey] = Date.now();
        
        console.log(`[AI Scheduler] Time match for ${schedule.reason} at ${hour}:${minute.toString().padStart(2, '0')} Mountain Time`);
        
        // Run the batch (don't await to avoid blocking the check loop)
        runScheduledBatch(schedule.reason).catch((err) => {
          console.error(`[AI Scheduler] Error running ${schedule.reason}:`, err);
        });
      }
    }
  }
  
  // Clean up old run timestamps (older than 24 hours)
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const key of Object.keys(lastRunTimestamp)) {
    if (lastRunTimestamp[key] < oneDayAgo) {
      delete lastRunTimestamp[key];
    }
  }
}

/**
 * Get the next scheduled run time for status display
 */
function getNextScheduledRun(): { time: Date; reason: BatchRunReason } | null {
  const now = new Date();
  const { hour, minute } = getCurrentMountainTime();
  
  // Find the next scheduled run
  for (const schedule of SCHEDULED_RUNS) {
    if (hour < schedule.hour || (hour === schedule.hour && minute < schedule.minute)) {
      // This schedule hasn't run yet today
      const mountainNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
      const target = new Date(mountainNow);
      target.setHours(schedule.hour, schedule.minute, 0, 0);
      
      // Convert back to UTC
      const utcOffset = mountainNow.getTime() - now.getTime();
      return {
        time: new Date(target.getTime() - utcOffset),
        reason: schedule.reason,
      };
    }
  }
  
  // All schedules passed today, return first schedule for tomorrow
  const mountainNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const target = new Date(mountainNow);
  target.setDate(target.getDate() + 1);
  target.setHours(SCHEDULED_RUNS[0].hour, SCHEDULED_RUNS[0].minute, 0, 0);
  
  const utcOffset = mountainNow.getTime() - now.getTime();
  return {
    time: new Date(target.getTime() - utcOffset),
    reason: SCHEDULED_RUNS[0].reason,
  };
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
  console.log("[AI Scheduler] Scheduled runs: 10:00 AM and 3:00 PM Mountain Time");
  
  // Check every minute for scheduled batch times
  checkIntervalId = setInterval(() => {
    checkScheduledBatches().catch((err) => {
      console.error("[AI Scheduler] Error checking scheduled batches:", err);
    });
  }, 60 * 1000);  // Check every minute
  
  // Run initial check immediately
  checkScheduledBatches().catch((err) => {
    console.error("[AI Scheduler] Error on initial batch check:", err);
  });
  
  // Set up periodic debounce cleanup (every hour)
  setInterval(() => {
    inventoryRecommendationBatch.cleanupDebounceMap();
  }, 60 * 60 * 1000);
  
  const nextRun = getNextScheduledRun();
  if (nextRun) {
    const msUntil = nextRun.time.getTime() - Date.now();
    console.log(`[AI Scheduler] Next run: ${nextRun.reason} at ${nextRun.time.toISOString()} (in ${Math.round(msUntil / 60000)} minutes)`);
  }
  
  console.log("[AI Scheduler] Scheduler initialized");
}

/**
 * Get the next scheduled run info
 */
export function getSchedulerStatus(): { 
  initialized: boolean; 
  nextRun: { time: Date; reason: BatchRunReason } | null;
  timezone: string;
  scheduledTimes: string[];
} {
  return {
    initialized: schedulerInitialized,
    nextRun: getNextScheduledRun(),
    timezone: TIMEZONE,
    scheduledTimes: SCHEDULED_RUNS.map(s => `${s.hour}:${s.minute.toString().padStart(2, '0')} Mountain Time (${s.reason})`),
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

/**
 * Stop the scheduler (for testing/cleanup)
 */
export function stopScheduler(): void {
  if (checkIntervalId) {
    clearInterval(checkIntervalId);
    checkIntervalId = null;
  }
  schedulerInitialized = false;
  lastRunTimestamp = {};
  console.log("[AI Scheduler] Scheduler stopped");
}

// Export for testing
export { getCurrentMountainTime, getNextScheduledRun };
