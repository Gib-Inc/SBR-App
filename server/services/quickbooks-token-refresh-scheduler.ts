/**
 * QuickBooks Token Refresh Scheduler Service
 * 
 * Proactively refreshes QuickBooks OAuth tokens before they expire.
 * Access tokens expire in ~60 minutes, so we refresh every 45 minutes.
 * Refresh tokens expire in ~100 days and rotate on each use.
 * 
 * When token refresh fails, creates a GHL "Needs Attention" opportunity
 * to alert the team that manual reconnection is required.
 * 
 * Design principles:
 * - Never fails: Comprehensive error handling
 * - Autonomous: Runs in background without user interaction
 * - Proactive: Refreshes tokens before they expire
 * - Alerting: Creates GHL opportunities when action is needed
 */

import { storage } from "../storage";
import { GHLOpportunitiesService } from "./ghl-opportunities-service";
import { AuditLogger } from "./audit-logger";

// Configuration
const REFRESH_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes
const TOKEN_EXPIRY_BUFFER_MS = 10 * 60 * 1000; // 10 minutes before expiry
const GHL_NEEDS_ATTENTION_STAGE_ID = "22c1a9a6-8e24-43be-8d8b-a24b005ce4cb";

let schedulerInitialized = false;
let refreshIntervalId: NodeJS.Timeout | null = null;
let lastRefreshAt: Date | null = null;
let lastRefreshStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED' | null = null;

interface RefreshResult {
  success: boolean;
  message: string;
  tokensRefreshed: number;
  tokensFailed: number;
  tokensSkipped: number;
  details: Array<{
    userId: string;
    realmId: string;
    companyName: string | null;
    action: 'refreshed' | 'failed' | 'skipped';
    error?: string;
  }>;
}

/**
 * Refresh tokens for a single QuickBooks auth record
 */
async function refreshTokensForAuth(auth: {
  id: string;
  userId: string;
  realmId: string;
  companyName: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  isConnected: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { success: false, error: 'QuickBooks credentials not configured' };
  }

  // Check if refresh token itself is expired (100 days)
  const refreshTokenExpiry = new Date(auth.refreshTokenExpiresAt);
  if (refreshTokenExpiry <= new Date()) {
    return { success: false, error: 'Refresh token expired - manual reconnection required' };
  }

  try {
    // Get token endpoint from Discovery Document (Intuit compliance)
    const { getTokenEndpoint } = await import('./intuit-discovery');
    const tokenEndpoint = await getTokenEndpoint();
    
    // Retry logic for token refresh
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;
    let response: Response | null = null;
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: auth.refreshToken,
          }),
        });
        
        if (response.ok) break;
        
        // Retry on 5xx errors or 429 rate limits
        if ((response.status >= 500 || response.status === 429) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(`[QB Token Refresh] Attempt ${attempt} failed with ${response.status}, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(`[QB Token Refresh] Attempt ${attempt} failed: ${err.message}, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    if (!response || !response.ok) {
      const errorText = response ? await response.text() : lastError?.message;
      console.error(`[QB Token Refresh] Token refresh failed for ${auth.realmId}:`, errorText);
      
      // Mark as disconnected
      await storage.updateQuickbooksAuth(auth.id, { 
        isConnected: false,
      });
      await storage.updateQuickbooksAuthHealthStatus(auth.id, {
        lastTokenCheckStatus: 'CRITICAL',
        lastTokenCheckAt: new Date(),
      });
      
      return { success: false, error: `Token refresh failed: ${response?.status || 'network error'}` };
    }

    const tokens = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      x_refresh_token_expires_in: number;
    };

    const now = new Date();
    const accessTokenExpiresAt = new Date(now.getTime() + tokens.expires_in * 1000);
    const refreshTokenExpiresAt = new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000);

    await storage.updateQuickbooksAuth(auth.id, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      tokenLastRotatedAt: now,
      isConnected: true,
    });
    await storage.updateQuickbooksAuthHealthStatus(auth.id, {
      lastTokenCheckStatus: 'OK',
      lastTokenCheckAt: now,
    });

    console.log(`[QB Token Refresh] Successfully refreshed tokens for ${auth.companyName || auth.realmId}`);
    return { success: true };
  } catch (error: any) {
    console.error(`[QB Token Refresh] Error refreshing tokens for ${auth.realmId}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Create GHL "Needs Attention" opportunity for failed QuickBooks connection
 */
async function createGHLAlertForFailedRefresh(
  userId: string,
  companyName: string | null,
  error: string
): Promise<void> {
  try {
    const ghlService = new GHLOpportunitiesService();
    const initialized = await ghlService.initialize(userId);
    
    if (!initialized) {
      console.log(`[QB Token Refresh] GHL not configured for user ${userId}, skipping alert`);
      return;
    }

    const systemContactId = await ghlService.getOrCreateSystemContact();
    if (!systemContactId) {
      console.error(`[QB Token Refresh] Could not get system contact for GHL alert`);
      return;
    }

    const displayName = companyName || 'QuickBooks';
    const externalKey = `qb-connection-failed-${userId}`;
    const opportunityName = `QuickBooks Connection Failed: ${displayName}`;

    const result = await ghlService.upsertOpportunity({
      externalKey,
      name: opportunityName,
      pipelineStageId: GHL_NEEDS_ATTENTION_STAGE_ID,
      status: "open",
      contactId: systemContactId,
    });

    if (result.success && result.opportunityId) {
      const noteBody = [
        `QuickBooks Connection Failed`,
        ``,
        `Company: ${displayName}`,
        `Error: ${error}`,
        `Time: ${new Date().toISOString()}`,
        ``,
        `Action Required: Please reconnect QuickBooks in the AI Settings page.`,
        `Go to Settings > AI > QuickBooks and click "Connect via OAuth" to re-authorize.`,
      ].join('\n');

      await ghlService.addNoteToOpportunity(systemContactId, result.opportunityId, noteBody);
      console.log(`[QB Token Refresh] Created GHL alert opportunity: ${result.opportunityId}`);
    }
  } catch (error: any) {
    console.error(`[QB Token Refresh] Failed to create GHL alert:`, error.message);
  }
}

/**
 * Run the token refresh check for all QuickBooks connections
 */
export async function runTokenRefresh(): Promise<RefreshResult> {
  console.log(`[QB Token Refresh] Starting token refresh check at ${new Date().toISOString()}`);
  
  const result: RefreshResult = {
    success: true,
    message: '',
    tokensRefreshed: 0,
    tokensFailed: 0,
    tokensSkipped: 0,
    details: [],
  };

  try {
    // Get all QuickBooks auth records that are connected AND have complete token data
    const allAuths = await storage.getAllQuickbooksAuths();
    const connectedAuths = allAuths.filter(auth => {
      // Must be connected
      if (!auth.isConnected) return false;
      
      // Must have valid tokens and expiry timestamps - skip skeleton records
      if (!auth.accessToken || !auth.refreshToken) {
        console.log(`[QB Token Refresh] Skipping ${auth.companyName || auth.realmId}: missing tokens (incomplete auth record)`);
        return false;
      }
      if (!auth.accessTokenExpiresAt || !auth.refreshTokenExpiresAt) {
        console.log(`[QB Token Refresh] Skipping ${auth.companyName || auth.realmId}: missing expiry timestamps`);
        return false;
      }
      
      return true;
    });
    
    if (connectedAuths.length === 0) {
      result.message = 'No connected QuickBooks accounts with complete token data found';
      console.log(`[QB Token Refresh] ${result.message}`);
      lastRefreshAt = new Date();
      lastRefreshStatus = 'SKIPPED';
      return result;
    }

    console.log(`[QB Token Refresh] Found ${connectedAuths.length} connected QuickBooks accounts with complete token data`);

    for (const auth of connectedAuths) {
      const accessTokenExpiry = new Date(auth.accessTokenExpiresAt);
      const now = new Date();
      const timeUntilExpiry = accessTokenExpiry.getTime() - now.getTime();

      // Only refresh if token expires within buffer window
      if (timeUntilExpiry > TOKEN_EXPIRY_BUFFER_MS) {
        result.tokensSkipped++;
        result.details.push({
          userId: auth.userId,
          realmId: auth.realmId,
          companyName: auth.companyName,
          action: 'skipped',
        });
        console.log(`[QB Token Refresh] Skipping ${auth.companyName || auth.realmId}: token valid for ${Math.round(timeUntilExpiry / 60000)} more minutes`);
        continue;
      }

      console.log(`[QB Token Refresh] Refreshing tokens for ${auth.companyName || auth.realmId} (expires in ${Math.round(timeUntilExpiry / 60000)} minutes)`);

      const refreshResult = await refreshTokensForAuth(auth);

      if (refreshResult.success) {
        result.tokensRefreshed++;
        result.details.push({
          userId: auth.userId,
          realmId: auth.realmId,
          companyName: auth.companyName,
          action: 'refreshed',
        });

        await AuditLogger.logEvent({
          source: 'QUICKBOOKS',
          eventType: 'TOKEN_REFRESH',
          status: 'INFO',
          description: `QuickBooks tokens automatically refreshed for ${auth.companyName || auth.realmId}`,
        });
      } else {
        result.tokensFailed++;
        result.details.push({
          userId: auth.userId,
          realmId: auth.realmId,
          companyName: auth.companyName,
          action: 'failed',
          error: refreshResult.error,
        });

        await AuditLogger.logEvent({
          source: 'QUICKBOOKS',
          eventType: 'TOKEN_REFRESH_ERROR',
          status: 'ERROR',
          description: `QuickBooks token refresh failed for ${auth.companyName || auth.realmId}: ${refreshResult.error}`,
        });

        // Create GHL alert for failed refresh
        await createGHLAlertForFailedRefresh(auth.userId, auth.companyName, refreshResult.error || 'Unknown error');
      }
    }

    if (result.tokensFailed > 0) {
      result.success = false;
      result.message = `Token refresh completed with ${result.tokensFailed} failures`;
      lastRefreshStatus = 'FAILED';
    } else {
      result.message = `Token refresh completed: ${result.tokensRefreshed} refreshed, ${result.tokensSkipped} skipped`;
      lastRefreshStatus = 'SUCCESS';
    }

    lastRefreshAt = new Date();
    console.log(`[QB Token Refresh] ${result.message}`);

  } catch (error: any) {
    console.error(`[QB Token Refresh] Fatal error:`, error.message);
    result.success = false;
    result.message = `Token refresh failed: ${error.message}`;
    lastRefreshStatus = 'FAILED';
    lastRefreshAt = new Date();
  }

  return result;
}

/**
 * Initialize the QuickBooks token refresh scheduler
 * Should be called once when the server starts
 */
export function initializeQuickBooksTokenRefreshScheduler(): void {
  if (schedulerInitialized) {
    console.log("[QB Token Refresh] Already initialized");
    return;
  }

  schedulerInitialized = true;
  console.log("[QB Token Refresh] Initializing scheduler");
  console.log(`[QB Token Refresh] Refresh interval: ${REFRESH_INTERVAL_MS / 60000} minutes`);

  // Run immediately on startup
  runTokenRefresh().catch(err => {
    console.error("[QB Token Refresh] Initial refresh failed:", err.message);
  });

  // Schedule periodic refreshes
  refreshIntervalId = setInterval(() => {
    runTokenRefresh().catch(err => {
      console.error("[QB Token Refresh] Scheduled refresh failed:", err.message);
    });
  }, REFRESH_INTERVAL_MS);

  console.log("[QB Token Refresh] Scheduler initialized");
}

/**
 * Stop the scheduler (for graceful shutdown)
 */
export function stopQuickBooksTokenRefreshScheduler(): void {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
  schedulerInitialized = false;
  console.log("[QB Token Refresh] Scheduler stopped");
}

/**
 * Get the scheduler status
 */
export function getQuickBooksTokenRefreshStatus(): {
  initialized: boolean;
  refreshIntervalMinutes: number;
  lastRefreshAt: Date | null;
  lastRefreshStatus: string | null;
} {
  return {
    initialized: schedulerInitialized,
    refreshIntervalMinutes: REFRESH_INTERVAL_MS / 60000,
    lastRefreshAt,
    lastRefreshStatus,
  };
}

/**
 * Manually trigger a token refresh (for testing or admin use)
 */
export async function triggerManualTokenRefresh(): Promise<RefreshResult> {
  console.log("[QB Token Refresh] Manual token refresh triggered");
  return await runTokenRefresh();
}
