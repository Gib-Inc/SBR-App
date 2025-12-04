/**
 * Credential Rotation Scheduler Service
 * 
 * Schedules automated checks for integration credentials approaching rotation date.
 * Runs daily at 6:00 AM Mountain Time (America/Denver).
 * 
 * When credentials are within 7 days of needing rotation, creates a GHL opportunity
 * in the "Needs Attention" stage to alert the team.
 * 
 * Design principles:
 * - Never fails: Comprehensive error handling with per-config isolation
 * - Idempotent: Uses external keys to prevent duplicate opportunities
 * - Robust: Retry logic for transient errors
 */

import { storage } from "../storage";
import { GHLOpportunitiesService } from "./ghl-opportunities-service";

const TIMEZONE = "America/Denver";
const ROTATION_WINDOW_DAYS = 7;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const GHL_ROTATION_PIPELINE_ID = "m28NXgDcGrl85EMg7ZPN";
const GHL_NEEDS_ATTENTION_STAGE_ID = "22c1a9a6-8e24-43be-8d8b-a24b005ce4cb";

let schedulerInitialized = false;
let nextScheduledRun: Date | null = null;

/**
 * Convert a local time in Mountain timezone to a Date object
 */
function getMountainTime(hour: number, minute: number = 0): Date {
  const now = new Date();
  const mountainNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const target = new Date(mountainNow);
  target.setHours(hour, minute, 0, 0);
  
  if (target <= mountainNow) {
    target.setDate(target.getDate() + 1);
  }
  
  const utcOffset = mountainNow.getTime() - now.getTime();
  return new Date(target.getTime() - utcOffset);
}

/**
 * Calculate milliseconds until the target time
 */
function msUntilTarget(targetTime: Date): number {
  return Math.max(0, targetTime.getTime() - Date.now());
}

/**
 * Format a date for display in GHL opportunity name
 */
function formatRotationDate(date: Date): string {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Generate an idempotent external key for a rotation reminder
 * This ensures the same reminder isn't created twice
 */
function getExternalKey(configId: string, rotationDate: Date): string {
  return `rotation-${configId}-${formatRotationDate(rotationDate)}`;
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  context: string
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      const isTransient = error.status === 429 || error.status >= 500;
      
      if (!isTransient || attempt === maxRetries) {
        console.error(`[Rotation Scheduler] ${context} failed after ${attempt} attempts:`, error.message);
        throw error;
      }
      
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[Rotation Scheduler] ${context} attempt ${attempt} failed (${error.message}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Process a single integration config and create/update GHL opportunity if needed
 */
async function processConfig(
  config: {
    id: string;
    userId: string;
    provider: string;
    accountName: string | null;
    tokenNextRotationAt: Date | null;
    rotationReminderOpportunityId: string | null;
  },
  ghlService: GHLOpportunitiesService
): Promise<{ success: boolean; action: 'created' | 'updated' | 'skipped' | 'error'; error?: string }> {
  const configContext = `${config.provider} (${config.id})`;
  
  try {
    if (!config.tokenNextRotationAt) {
      console.log(`[Rotation Scheduler] Skipping ${configContext}: No rotation date set`);
      return { success: true, action: 'skipped' };
    }
    
    const rotationDate = new Date(config.tokenNextRotationAt);
    const externalKey = getExternalKey(config.id, rotationDate);
    const displayName = config.accountName || config.provider;
    const opportunityName = `Rotate ${displayName} credentials by ${formatRotationDate(rotationDate)}`;
    
    console.log(`[Rotation Scheduler] Processing ${configContext}: rotation due ${formatRotationDate(rotationDate)}`);
    
    // Get or create a system contact for internal notifications
    const systemContactId = await ghlService.getOrCreateSystemContact();
    if (!systemContactId) {
      console.error(`[Rotation Scheduler] Could not get system contact for ${configContext}`);
      return { success: false, action: 'error', error: 'Could not get system contact' };
    }
    
    const result = await withRetry(
      async () => {
        return await ghlService.upsertOpportunity({
          externalKey,
          name: opportunityName,
          pipelineStageId: GHL_NEEDS_ATTENTION_STAGE_ID,
          status: "open",
          contactId: systemContactId,
          existingOpportunityId: config.rotationReminderOpportunityId,
        });
      },
      MAX_RETRIES,
      RETRY_DELAY_MS,
      `Create opportunity for ${configContext}`
    );
    
    // If opportunity was created successfully, add a note with details
    if (result.success && result.created && result.opportunityId) {
      const noteBody = [
        `Credential Rotation Reminder`,
        ``,
        `Provider: ${config.provider}`,
        config.accountName ? `Account: ${config.accountName}` : null,
        `Rotation Due: ${formatRotationDate(rotationDate)}`,
        ``,
        `Action Required: Rotate API credentials before the due date to maintain integration connectivity.`,
      ].filter(Boolean).join('\n');
      
      await ghlService.addNoteToOpportunity(systemContactId, result.opportunityId, noteBody);
    }
    
    if (!result.success) {
      console.error(`[Rotation Scheduler] Failed to create opportunity for ${configContext}:`, result.error);
      return { success: false, action: 'error', error: result.error };
    }
    
    await storage.updateIntegrationConfig(config.id, {
      rotationReminderOpportunityId: result.opportunityId,
      rotationReminderSentAt: new Date(),
    } as any);
    
    const action = result.created ? 'created' : 'updated';
    console.log(`[Rotation Scheduler] ${action} opportunity for ${configContext}: ${result.opportunityId}`);
    
    return { success: true, action };
  } catch (error: any) {
    console.error(`[Rotation Scheduler] Error processing ${configContext}:`, error.message);
    return { success: false, action: 'error', error: error.message };
  }
}

/**
 * Run the rotation reminder check for all configs
 */
export async function runRotationCheck(): Promise<{
  success: boolean;
  configsChecked: number;
  remindersCreated: number;
  remindersUpdated: number;
  errors: number;
  details: Array<{ configId: string; provider: string; action: string; error?: string }>;
}> {
  console.log(`[Rotation Scheduler] Starting rotation check at ${new Date().toISOString()}`);
  
  const result = {
    success: true,
    configsChecked: 0,
    remindersCreated: 0,
    remindersUpdated: 0,
    errors: 0,
    details: [] as Array<{ configId: string; provider: string; action: string; error?: string }>,
  };
  
  try {
    const configs = await storage.getConfigsNeedingRotationReminder(ROTATION_WINDOW_DAYS);
    console.log(`[Rotation Scheduler] Found ${configs.length} configs needing rotation reminders`);
    
    if (configs.length === 0) {
      console.log(`[Rotation Scheduler] No configs need rotation reminders`);
      return result;
    }
    
    const configsByUser = new Map<string, typeof configs>();
    for (const config of configs) {
      if (!configsByUser.has(config.userId)) {
        configsByUser.set(config.userId, []);
      }
      configsByUser.get(config.userId)!.push(config);
    }
    
    for (const [userId, userConfigs] of Array.from(configsByUser.entries())) {
      console.log(`[Rotation Scheduler] Processing ${userConfigs.length} configs for user ${userId}`);
      
      const ghlService = new GHLOpportunitiesService();
      const initialized = await ghlService.initialize(userId);
      
      if (!initialized) {
        console.warn(`[Rotation Scheduler] GHL not configured for user ${userId}, skipping their configs`);
        for (const config of userConfigs) {
          result.details.push({
            configId: config.id,
            provider: config.provider,
            action: 'skipped',
            error: 'GHL not configured for this user',
          });
        }
        continue;
      }
      
      for (const config of userConfigs) {
        result.configsChecked++;
        
        try {
          const processResult = await processConfig(config, ghlService);
          
          result.details.push({
            configId: config.id,
            provider: config.provider,
            action: processResult.action,
            error: processResult.error,
          });
          
          if (processResult.action === 'created') {
            result.remindersCreated++;
          } else if (processResult.action === 'updated') {
            result.remindersUpdated++;
          } else if (processResult.action === 'error') {
            result.errors++;
          }
        } catch (error: any) {
          console.error(`[Rotation Scheduler] Unhandled error for config ${config.id}:`, error.message);
          result.errors++;
          result.details.push({
            configId: config.id,
            provider: config.provider,
            action: 'error',
            error: error.message,
          });
        }
      }
    }
    
    // Explicitly set success to false if any errors occurred
    if (result.errors > 0) {
      result.success = false;
    }
    
  } catch (error: any) {
    console.error(`[Rotation Scheduler] Fatal error during rotation check:`, error.message);
    result.success = false;
    result.errors++;
  }
  
  const statusText = result.success ? 'completed successfully' : `completed with ${result.errors} errors`;
  console.log(`[Rotation Scheduler] Rotation check ${statusText}: ${result.configsChecked} checked, ${result.remindersCreated} created, ${result.remindersUpdated} updated`);
  
  return result;
}

/**
 * Run the scheduled rotation check and reschedule
 */
async function runScheduledRotationCheck(): Promise<void> {
  console.log(`[Rotation Scheduler] Running scheduled rotation check`);
  
  try {
    await runRotationCheck();
  } catch (error: any) {
    console.error(`[Rotation Scheduler] Scheduled check failed:`, error.message);
  }
  
  scheduleNextRotationCheck();
}

/**
 * Schedule the next rotation check for 6 AM Mountain Time
 */
function scheduleNextRotationCheck(): void {
  nextScheduledRun = getMountainTime(6, 0);
  const msUntil = msUntilTarget(nextScheduledRun);
  
  console.log(`[Rotation Scheduler] Next check scheduled: 6:00 AM MT at ${nextScheduledRun.toISOString()} (in ${Math.round(msUntil / 60000)} minutes)`);
  
  setTimeout(() => {
    runScheduledRotationCheck();
  }, msUntil);
}

/**
 * Initialize the credential rotation scheduler
 * Should be called once when the server starts
 */
export function initializeRotationScheduler(): void {
  if (schedulerInitialized) {
    console.log("[Rotation Scheduler] Already initialized");
    return;
  }
  
  schedulerInitialized = true;
  console.log("[Rotation Scheduler] Initializing for Mountain Time (America/Denver)");
  
  scheduleNextRotationCheck();
  
  console.log("[Rotation Scheduler] Scheduler initialized");
}

/**
 * Get the scheduler status
 */
export function getRotationSchedulerStatus(): {
  initialized: boolean;
  nextRun: Date | null;
  timezone: string;
  rotationWindowDays: number;
} {
  return {
    initialized: schedulerInitialized,
    nextRun: nextScheduledRun,
    timezone: TIMEZONE,
    rotationWindowDays: ROTATION_WINDOW_DAYS,
  };
}

/**
 * Manually trigger a rotation check (for testing or admin use)
 */
export async function triggerManualRotationCheck(): Promise<{
  success: boolean;
  message: string;
  details?: any;
}> {
  console.log("[Rotation Scheduler] Manual rotation check triggered");
  
  try {
    const result = await runRotationCheck();
    
    return {
      success: result.success,
      message: result.success
        ? `Rotation check completed: ${result.configsChecked} checked, ${result.remindersCreated} created, ${result.remindersUpdated} updated`
        : `Rotation check completed with ${result.errors} errors`,
      details: result,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Rotation check failed: ${error.message}`,
    };
  }
}
