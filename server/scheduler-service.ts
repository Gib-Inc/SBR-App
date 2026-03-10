import { storage } from "./storage";
import { refreshAdPerformanceData, refreshSalesData } from "./channel-ingestion-service";
import { refreshAllProductForecastContexts } from "./forecast-context-service";
import { AISystemReviewer } from "./services/ai-system-reviewer";
import { ExtensivInventorySyncService } from "./services/extensiv-inventory-sync-service";

/**
 * Scheduler Service for periodic data refresh
 * 
 * This service orchestrates per-channel syncs respecting each channel's:
 * 1. Enabled/disabled status
 * 2. Configured sync interval (hours)
 * 3. Type (advertising vs sales platform)
 */

interface ChannelSchedule {
  channelId: string;
  channelName: string;
  timer: NodeJS.Timeout;
  intervalHours: number;
}

const channelSchedules: Map<string, ChannelSchedule> = new Map();
let forecastContextTimer: NodeJS.Timeout | null = null;
let aiSystemReviewTimer: NodeJS.Timeout | null = null;
let extensivSyncTimer: NodeJS.Timeout | null = null;

// AI System Review interval: weekly (168 hours)
const AI_SYSTEM_REVIEW_INTERVAL_HOURS = 168;

// Extensiv sync interval: every 4 hours (aligns with 3PL inventory updates)
const EXTENSIV_SYNC_INTERVAL_HOURS = 4;

/**
 * Performs a data refresh for a specific channel
 */
async function performChannelRefresh(channelId: string, channelName: string, channelType: string): Promise<void> {
  console.log(`[Scheduler] Refreshing ${channelName} (ID: ${channelId})...`);
  const startTime = Date.now();

  try {
    if (!channelType) {
      console.warn(`[Scheduler] Channel type is null/undefined for channel ${channelName} (ID: ${channelId}). Skipping refresh.`);
      return;
    }

    const normalizedType = channelType.toUpperCase();
    
    if (normalizedType === 'AD_PLATFORM' || normalizedType === 'ADVERTISING') {
      await refreshAdPerformanceData(channelId, 7); // Last 7 days
    } else if (normalizedType === 'SALES_CHANNEL' || normalizedType === 'SALES') {
      await refreshSalesData(channelId, 30); // Last 30 days
    } else {
      console.warn(`[Scheduler] Unsupported channel type "${channelType}" for channel ${channelName} (ID: ${channelId}). Skipping refresh.`);
      return;
    }

    const duration = Date.now() - startTime;
    console.log(`[Scheduler] ${channelName} refresh completed in ${duration}ms`);
  } catch (error) {
    console.error(`[Scheduler] Error refreshing ${channelName}:`, error);
  }
}

/**
 * Schedules a single channel for periodic refresh
 */
function scheduleChannel(channelId: string, channelName: string, channelType: string, intervalHours: number): void {
  // Validate sync interval
  if (!intervalHours || intervalHours <= 0) {
    console.error(`[Scheduler] Invalid sync interval (${intervalHours}) for channel ${channelName}. Skipping.`);
    return;
  }

  // Clear existing schedule if present
  const existing = channelSchedules.get(channelId);
  if (existing) {
    clearInterval(existing.timer);
  }

  console.log(`[Scheduler] Scheduling ${channelName} every ${intervalHours} hours`);

  // Run immediately, then repeat
  performChannelRefresh(channelId, channelName, channelType).catch(err => {
    console.error(`[Scheduler] Initial refresh failed for ${channelName}:`, err);
  });

  const timer = setInterval(() => {
    performChannelRefresh(channelId, channelName, channelType).catch(err => {
      console.error(`[Scheduler] Scheduled refresh failed for ${channelName}:`, err);
    });
  }, intervalHours * 60 * 60 * 1000);

  channelSchedules.set(channelId, {
    channelId,
    channelName,
    timer,
    intervalHours,
  });
}

/**
 * Unschedules a specific channel
 */
function unscheduleChannel(channelId: string): void {
  const schedule = channelSchedules.get(channelId);
  if (schedule) {
    clearInterval(schedule.timer);
    channelSchedules.delete(channelId);
    console.log(`[Scheduler] Unscheduled ${schedule.channelName}`);
  }
}

/**
 * Refreshes forecast contexts for all products (runs less frequently)
 */
async function performForecastContextRefresh(): Promise<void> {
  console.log("[Scheduler] Refreshing forecast contexts...");
  const startTime = Date.now();

  try {
    await refreshAllProductForecastContexts();
    const duration = Date.now() - startTime;
    console.log(`[Scheduler] Forecast context refresh completed in ${duration}ms`);
  } catch (error) {
    console.error("[Scheduler] Error refreshing forecast contexts:", error);
  }
}

/**
 * Performs Extensiv/Pivot inventory sync for all users with extensivTwoWaySync enabled
 * Updates pivotQty from Extensiv on-hand quantities
 */
async function performExtensivSync(): Promise<void> {
  console.log("[Scheduler] Starting Extensiv inventory sync...");
  const startTime = Date.now();

  try {
    // Get all users and check their AI Agent Settings for extensivTwoWaySync
    const allUsers = await storage.getAllUsers();
    
    for (const user of allUsers) {
      const settings = await storage.getAIAgentSettings(user.id);
      if (!settings?.extensivTwoWaySync) {
        continue; // Skip users without Extensiv sync enabled
      }

      const extensivSettings = await storage.getIntegrationSettings(user.id, 'extensiv');
      if (!extensivSettings?.apiKey || !extensivSettings?.warehouseId) {
        console.warn(`[Scheduler] User ${user.id} has Extensiv sync enabled but missing credentials`);
        continue;
      }

      try {
        const syncService = new ExtensivInventorySyncService(
          extensivSettings.apiKey,
          extensivSettings.warehouseId,
          user.id
        );
        const result = await syncService.syncInventory();
        console.log(`[Scheduler] Extensiv sync for user ${user.id}: ${result.synced} items synced, ${result.errors} errors`);
      } catch (error) {
        console.error(`[Scheduler] Extensiv sync failed for user ${user.id}:`, error);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Scheduler] Extensiv inventory sync completed in ${duration}ms`);
  } catch (error) {
    console.error("[Scheduler] Error during Extensiv sync:", error);
  }
}

/**
 * Runs the AI System Review to analyze logs and generate recommendations
 * This runs weekly by default to avoid excessive API costs
 */
async function performAISystemReview(): Promise<void> {
  console.log("[Scheduler] Starting AI System Review...");
  const startTime = Date.now();

  try {
    const result = await AISystemReviewer.runReview();
    const duration = Date.now() - startTime;
    
    if (result.success) {
      console.log(`[Scheduler] AI System Review completed in ${duration}ms: ${result.recommendationsGenerated} recommendations from ${result.logsAnalyzed} logs`);
    } else {
      console.warn(`[Scheduler] AI System Review completed with issues in ${duration}ms: ${result.error}`);
    }
  } catch (error) {
    console.error("[Scheduler] Error during AI System Review:", error);
  }
}

/**
 * Starts the scheduler for all enabled channels.
 * Reads channel configurations and schedules individual timers.
 */
export async function startScheduler(): Promise<void> {
  console.log("[Scheduler] Starting per-channel scheduler...");

  try {
    // Fetch all channels
    const channels = await storage.getAllChannels();
    
    // Schedule each enabled channel
    for (const channel of channels) {
      if (channel.isActive) {
        // Default to 24 hours if syncIntervalHours is missing
        const intervalHours = channel.syncIntervalHours || 24;
        scheduleChannel(
          channel.id,
          channel.name,
          channel.type,
          intervalHours
        );
      } else {
        console.log(`[Scheduler] Skipping disabled channel: ${channel.name}`);
      }
    }

    // Schedule forecast context refresh (every 6 hours)
    if (forecastContextTimer) {
      clearInterval(forecastContextTimer);
    }

    // Run immediately, then every 6 hours
    performForecastContextRefresh().catch(err => {
      console.error("[Scheduler] Initial forecast refresh failed:", err);
    });

    forecastContextTimer = setInterval(() => {
      performForecastContextRefresh().catch(err => {
        console.error("[Scheduler] Scheduled forecast refresh failed:", err);
      });
    }, 6 * 60 * 60 * 1000); // 6 hours

    // Schedule AI System Review (weekly)
    if (aiSystemReviewTimer) {
      clearInterval(aiSystemReviewTimer);
    }

    // Note: We don't run immediately on startup to avoid hitting LLM API
    // on every server restart. Instead, it runs on the scheduled interval.
    console.log(`[Scheduler] AI System Review scheduled to run every ${AI_SYSTEM_REVIEW_INTERVAL_HOURS} hours (weekly)`);

    aiSystemReviewTimer = setInterval(() => {
      performAISystemReview().catch(err => {
        console.error("[Scheduler] Scheduled AI System Review failed:", err);
      });
    }, AI_SYSTEM_REVIEW_INTERVAL_HOURS * 60 * 60 * 1000); // Weekly

    // Schedule Extensiv/Pivot inventory sync (every 4 hours)
    if (extensivSyncTimer) {
      clearInterval(extensivSyncTimer);
    }

    // Note: Don't run immediately on startup to avoid hitting APIs on every restart
    console.log(`[Scheduler] Extensiv sync scheduled to run every ${EXTENSIV_SYNC_INTERVAL_HOURS} hours`);

    extensivSyncTimer = setInterval(() => {
      performExtensivSync().catch(err => {
        console.error("[Scheduler] Scheduled Extensiv sync failed:", err);
      });
    }, EXTENSIV_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);

    console.log(`[Scheduler] Scheduler started successfully (${channelSchedules.size} channels active)`);
  } catch (error) {
    console.error("[Scheduler] Failed to start scheduler:", error);
    throw error;
  }
}

/**
 * Stops all schedulers.
 */
export function stopScheduler(): void {
  // Stop all channel schedules
  for (const [channelId] of channelSchedules) {
    unscheduleChannel(channelId);
  }

  // Stop forecast context timer
  if (forecastContextTimer) {
    clearInterval(forecastContextTimer);
    forecastContextTimer = null;
  }

  // Stop AI System Review timer
  if (aiSystemReviewTimer) {
    clearInterval(aiSystemReviewTimer);
    aiSystemReviewTimer = null;
  }

  // Stop Extensiv sync timer
  if (extensivSyncTimer) {
    clearInterval(extensivSyncTimer);
    extensivSyncTimer = null;
  }

  console.log("[Scheduler] All schedulers stopped");
}

/**
 * Refreshes the scheduler (useful when channel config changes).
 */
export async function refreshScheduler(): Promise<void> {
  console.log("[Scheduler] Refreshing scheduler configuration...");
  stopScheduler();
  await startScheduler();
}

/**
 * Gets the scheduler status.
 */
export function getSchedulerStatus(): { 
  running: boolean;
  activeChannels: number;
  schedules: Array<{ channelId: string; channelName: string; intervalHours: number }>;
  aiSystemReviewScheduled: boolean;
  extensivSyncScheduled: boolean;
} {
  return {
    running: channelSchedules.size > 0 || forecastContextTimer !== null || aiSystemReviewTimer !== null || extensivSyncTimer !== null,
    activeChannels: channelSchedules.size,
    schedules: Array.from(channelSchedules.values()).map(s => ({
      channelId: s.channelId,
      channelName: s.channelName,
      intervalHours: s.intervalHours,
    })),
    aiSystemReviewScheduled: aiSystemReviewTimer !== null,
    extensivSyncScheduled: extensivSyncTimer !== null,
  };
}

/**
 * Performs a complete data refresh cycle for all enabled channels.
 * This is exposed as a manual trigger endpoint.
 */
export async function performDataRefreshCycle(): Promise<void> {
  console.log("[Scheduler] Starting manual data refresh cycle...");
  const startTime = Date.now();

  try {
    const channels = await storage.getAllChannels();
    const activeChannels = channels.filter(c => c.isActive);

    // Refresh each active channel
    for (const channel of activeChannels) {
      await performChannelRefresh(channel.id, channel.name, channel.type);
    }

    // Refresh forecast contexts
    await performForecastContextRefresh();

    const duration = Date.now() - startTime;
    console.log(`[Scheduler] Manual data refresh cycle completed in ${duration}ms`);
  } catch (error) {
    console.error("[Scheduler] Error during manual data refresh cycle:", error);
    throw error;
  }
}

/**
 * Manually triggers an AI System Review.
 * Useful for on-demand analysis outside the weekly schedule.
 */
export async function triggerAISystemReview(options?: {
  periodStart?: Date;
  periodEnd?: Date;
  userId?: string;
}): Promise<{
  success: boolean;
  logsAnalyzed: number;
  recommendationsGenerated: number;
  error?: string;
}> {
  console.log("[Scheduler] Manually triggering AI System Review...");
  
  try {
    const result = await AISystemReviewer.runReview(options);
    return {
      success: result.success,
      logsAnalyzed: result.logsAnalyzed,
      recommendationsGenerated: result.recommendationsGenerated,
      error: result.error,
    };
  } catch (error: any) {
    console.error("[Scheduler] Error during manual AI System Review:", error);
    return {
      success: false,
      logsAnalyzed: 0,
      recommendationsGenerated: 0,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Manually triggers Extensiv inventory sync for all users.
 * Exported so it can be called from API endpoints.
 */
export async function triggerExtensivSync(): Promise<void> {
  return performExtensivSync();
}

/**
 * Restart the schedule for a single channel (e.g. after sync interval update).
 * For simplicity, this refreshes the full scheduler — all channels restart
 * with their current DB settings.
 */
export async function restartChannelSchedule(_channelId: string): Promise<void> {
  await refreshScheduler();
}
