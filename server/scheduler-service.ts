import { refreshAllAdPerformanceData, refreshAllSalesData } from "./channel-ingestion-service";
import { refreshAllProductForecastContexts } from "./forecast-context-service";

/**
 * Scheduler Service for periodic data refresh
 * 
 * This service orchestrates daily syncs of:
 * 1. Ad performance data (Google Ads, Meta Ads, TikTok Ads)
 * 2. Sales data (Shopify, Amazon)
 * 3. Product forecast contexts (aggregated metrics for AI)
 */

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Performs a complete data refresh cycle:
 * - Fetches ad performance from all platforms (last 7 days)
 * - Fetches sales data from all channels (last 30 days)
 * - Recalculates forecast context for all products
 */
export async function performDataRefreshCycle(): Promise<void> {
  console.log("[Scheduler] Starting data refresh cycle...");
  const startTime = Date.now();

  try {
    // Step 1: Refresh ad performance (7 days back)
    console.log("[Scheduler] Step 1/3: Refreshing ad performance data...");
    await refreshAllAdPerformanceData(7);

    // Step 2: Refresh sales data (30 days back)
    console.log("[Scheduler] Step 2/3: Refreshing sales data...");
    await refreshAllSalesData(30);

    // Step 3: Refresh all forecast contexts
    console.log("[Scheduler] Step 3/3: Refreshing forecast contexts...");
    await refreshAllProductForecastContexts();

    const duration = Date.now() - startTime;
    console.log(`[Scheduler] Data refresh cycle completed successfully in ${duration}ms`);
  } catch (error) {
    console.error("[Scheduler] Error during data refresh cycle:", error);
    throw error;
  }
}

/**
 * Starts the scheduler to run daily at 2:00 AM local time.
 * In production, consider using a more robust solution like node-cron or a cloud scheduler.
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    console.log("[Scheduler] Scheduler already running");
    return;
  }

  console.log("[Scheduler] Starting daily refresh scheduler...");

  // Calculate time until next 2:00 AM
  const now = new Date();
  const next2AM = new Date();
  next2AM.setHours(2, 0, 0, 0);
  
  if (next2AM <= now) {
    // If 2:00 AM has passed today, schedule for tomorrow
    next2AM.setDate(next2AM.getDate() + 1);
  }

  const msUntilNext2AM = next2AM.getTime() - now.getTime();

  console.log(`[Scheduler] Next refresh scheduled for: ${next2AM.toLocaleString()}`);

  // Schedule first run
  setTimeout(() => {
    performDataRefreshCycle().catch(err => {
      console.error("[Scheduler] Scheduled refresh failed:", err);
    });

    // Then run every 24 hours
    schedulerInterval = setInterval(() => {
      performDataRefreshCycle().catch(err => {
        console.error("[Scheduler] Scheduled refresh failed:", err);
      });
    }, 24 * 60 * 60 * 1000); // 24 hours
  }, msUntilNext2AM);

  console.log("[Scheduler] Scheduler started successfully");
}

/**
 * Stops the scheduler.
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Scheduler] Scheduler stopped");
  }
}

/**
 * Gets the scheduler status.
 */
export function getSchedulerStatus(): { running: boolean } {
  return {
    running: schedulerInterval !== null,
  };
}
