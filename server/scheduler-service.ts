import { storage } from "./storage";
import { refreshSalesData } from "./channel-ingestion-service";
import { refreshAllProductForecastContexts } from "./forecast-context-service";
import { AISystemReviewer } from "./services/ai-system-reviewer";
import { ExtensivInventorySyncService } from "./services/extensiv-inventory-sync-service";
import { MorningTrapService } from "./services/morning-trap-service";
import { WeeklyDigestService } from "./services/weekly-digest-service";
import { recordSchedulerRun, type SchedulerRunStatus } from "./services/scheduler-run-recorder";
import { runDriftReport } from "./services/inventory-drift-service";

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
let morningTrapTimer: NodeJS.Timeout | null = null;
let velocityTimer: NodeJS.Timeout | null = null;
let driftReportTimer: NodeJS.Timeout | null = null;
let adSyncTimer: NodeJS.Timeout | null = null;
let weeklyDigestTimer: NodeJS.Timeout | null = null;
let financialSnapshotTimer: NodeJS.Timeout | null = null;

// AI System Review interval: weekly (168 hours)
const AI_SYSTEM_REVIEW_INTERVAL_HOURS = 168;

// Inventory drift report interval: hourly, aligned to :15 past the hour so it
// runs just after the top-of-hour Extensiv sync settles pivot_qty.
const DRIFT_REPORT_INTERVAL_HOURS = 1;

// Extensiv sync interval: hourly. The Railway cron remains the primary
// external trigger; this in-process runner is a belt-and-suspenders fallback
// and now uses the same working credential path as the sync service.
const EXTENSIV_SYNC_INTERVAL_HOURS = 1;

async function recordRunSafe(input: {
  schedulerId: string;
  schedulerName: string;
  status: SchedulerRunStatus;
  startedAt: Date;
  durationMs?: number;
  errorMessage?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await recordSchedulerRun(input);
  } catch (error) {
    console.warn(`[Scheduler] Failed to record run for ${input.schedulerId}:`, error);
  }
}

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
      // Ad performance is handled by the dedicated ad-performance-sync scheduler
      // (real Google Ads + Meta clients). The old per-channel refresh was a stub
      // that wrote no data, so skip it here rather than run an empty pipeline.
      console.log(`[Scheduler] ${channelName}: ad performance handled by ad-performance-sync; skipping legacy stub refresh`);
      return;
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
  const schedulerStartedAt = new Date();
  // Footgun guard: dev environments hammering the live Extensiv API or
  // writing fake pivot_qty into prod data is a real risk. Refuse unless
  // we're production-tier, with an explicit override env var for the rare
  // case where we genuinely want to test against real Extensiv from dev.
  if (process.env.NODE_ENV !== "production" && process.env.FORCE_EXTENSIV_SYNC !== "true") {
    console.warn(
      "[Extensiv Sync] Skipped — non-production environment. Set FORCE_EXTENSIV_SYNC=true to override.",
    );
    await recordRunSafe({
      schedulerId: "extensiv-sync",
      schedulerName: "Extensiv in-process inventory sync",
      status: "skipped",
      startedAt: schedulerStartedAt,
      details: { reason: "non-production guard" },
    });
    return;
  }

  console.log("[Extensiv Sync] Starting inventory sync...");
  const startTime = Date.now();
  let synced = 0;
  let skippedUsers = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    // Get all users and check their AI Agent Settings for extensivTwoWaySync
    const allUsers = await storage.getAllUsers();
    
    for (const user of allUsers) {
      const settings = await storage.getAiAgentSettingsByUserId(user.id);
      if (!settings?.extensivTwoWaySync) {
        skippedUsers++;
        continue; // Skip users without Extensiv sync enabled
      }

      const syncService = new ExtensivInventorySyncService();
      const initialized = await syncService.initialize(user.id);
      if (!initialized) {
        skippedUsers++;
        console.warn(`[Scheduler] User ${user.id} has Extensiv sync enabled but Extensiv service did not initialize`);
        continue;
      }

      try {
        const result = await syncService.bulkSync();
        synced += result.synced;
        failed += result.failed;
        if (result.failed > 0) {
          errors.push(`user ${user.id}: ${result.failed} item failure(s)`);
        }
        console.log(`[Scheduler] Extensiv sync for user ${user.id}: ${result.synced} synced, ${result.failed} failed`);
      } catch (error: any) {
        failed++;
        errors.push(`user ${user.id}: ${error?.message ?? error}`);
        console.error(`[Scheduler] Extensiv sync failed for user ${user.id}:`, error);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Scheduler] Extensiv inventory sync completed in ${duration}ms`);
    await recordRunSafe({
      schedulerId: "extensiv-sync",
      schedulerName: "Extensiv in-process inventory sync",
      status: failed > 0 ? "partial" : "success",
      startedAt: schedulerStartedAt,
      durationMs: duration,
      errorMessage: errors.length > 0 ? errors.slice(0, 3).join("; ") : null,
      details: {
        usersChecked: allUsers.length,
        usersSkipped: skippedUsers,
        synced,
        failed,
      },
    });
  } catch (error: any) {
    console.error("[Scheduler] Error during Extensiv sync:", error);
    await recordRunSafe({
      schedulerId: "extensiv-sync",
      schedulerName: "Extensiv in-process inventory sync",
      status: "failed",
      startedAt: schedulerStartedAt,
      errorMessage: error?.message ?? String(error),
    });
  }
}

/**
 * Marketing ad-performance sync. Pulls REAL ad data via the connected
 * Google Ads + Meta clients (wrapped by the demand services) for every user
 * who has each integration configured/enabled. Meta covers Facebook AND
 * Instagram placements (same Marketing API / ad account). Replaces the old
 * stub per-channel refresh, which wrote no data. Runs daily.
 */
async function performAdPerformanceSync(): Promise<void> {
  const schedulerStartedAt = new Date();
  const startTime = Date.now();
  let usersChecked = 0;
  let googleSynced = 0;
  let metaSynced = 0;
  let dashboardSynced = 0;
  // initialize() returning false is a silent per-user no-op by design — but when it
  // happens for EVERY user the channel's native feed is dead, and reporting plain
  // "success" hid exactly that (googleSynced=0/metaSynced=0 under a green status).
  let googleInitialized = 0;
  let metaInitialized = 0;
  const errors: string[] = [];

  try {
    const { googleAdsDemandService } = await import("./services/google-ads-demand-service");
    const { metaAdsDemandService } = await import("./services/meta-ads-demand-service");
    const { adMetricsSyncService } = await import("./services/ad-metrics-sync");
    const { runWindsorSync, getWindsorApiKey } = await import("./services/windsor-ingestion-service");
    const allUsers = await storage.getAllUsers();
    let windsorSynced = 0;

    for (const user of allUsers) {
      usersChecked++;

      // Windsor.ai unified connector — pulls Google + Meta + Amazon + TikTok
      // spend into ad_metrics_daily from one API key. No-op for users without
      // a Windsor key configured (UI config or WINDSOR_API_KEY env).
      try {
        if (await getWindsorApiKey(user.id)) {
          const w = await runWindsorSync(user.id, 30);
          if (w.success || w.rowsUpserted > 0) {
            windsorSynced++;
            console.log(`[Ad Sync] Windsor for user ${user.id}: ${w.rowsUpserted} rows across ${Object.keys(w.platforms).join(", ") || "none"}`);
          } else {
            errors.push(`windsor/${user.id}: ${w.errors.slice(0, 1).join("; ") || "sync failed"}`);
          }
        }
      } catch (e: any) {
        errors.push(`windsor/${user.id}: ${e?.message ?? e}`);
      }

      // Google Ads — initialize() returns false (and we skip) if this user has
      // not connected/enabled Google Ads, so unconfigured users are no-ops.
      try {
        if (await googleAdsDemandService.initialize(user.id)) {
          googleInitialized++;
          const r = await googleAdsDemandService.syncDemandSignals();
          if (r.success) {
            googleSynced++;
            console.log(`[Ad Sync] Google Ads for user ${user.id}: ${r.itemsWithData}/${r.itemsProcessed} with data`);
          } else {
            errors.push(`google/${user.id}: ${(r.errors ?? []).slice(0, 1).join("; ") || "sync failed"}`);
          }
        }
      } catch (e: any) {
        errors.push(`google/${user.id}: ${e?.message ?? e}`);
      }

      // Meta Ads — covers Facebook + Instagram placements via the Marketing API.
      try {
        if (await metaAdsDemandService.initialize(user.id)) {
          metaInitialized++;
          const r = await metaAdsDemandService.syncPerformanceData();
          if (r.success) {
            metaSynced++;
            console.log(`[Ad Sync] Meta Ads for user ${user.id}: ${r.rowsStored} rows (${r.rowsMapped} mapped)`);
          } else {
            errors.push(`meta/${user.id}: ${(r.errors ?? []).slice(0, 1).join("; ") || "sync failed"}`);
          }
        }
      } catch (e: any) {
        errors.push(`meta/${user.id}: ${e?.message ?? e}`);
      }

      // Dashboard feed: aggregate Meta + Google by SKU into ad_metrics_daily,
      // the table the marketing-analytics dashboard reads. No-ops if the user
      // has no connected ad platforms. Without this on a schedule the dashboard
      // has no live data feed (its only other trigger is a manual route).
      try {
        const r = await adMetricsSyncService.syncAllForUser(user.id, 7);
        const upserted = r.reduce((s, x) => s + (x.metricsUpserted || 0), 0);
        if (upserted > 0) {
          dashboardSynced++;
          console.log(`[Ad Sync] ad_metrics_daily for user ${user.id}: ${upserted} rows upserted`);
        }
        const failed = r.filter((x) => !x.success);
        if (failed.length) errors.push(`admetrics/${user.id}: ${failed.map((x) => x.error).slice(0, 1).join("; ")}`);
      } catch (e: any) {
        errors.push(`admetrics/${user.id}: ${e?.message ?? e}`);
      }
    }

    // A native channel whose client initialized for NO user is a dead feed — it must
    // be visible (degraded health row + skippedChannels + partial run), never a green
    // "success, 0 errors" while Windsor is the only thing still writing rows.
    const nativeChannels = [
      { key: "google", label: "Google", initialized: googleInitialized },
      { key: "meta", label: "Meta", initialized: metaInitialized },
    ];
    const skippedChannels = nativeChannels
      .filter((c) => usersChecked > 0 && c.initialized === 0)
      .map((c) => c.key);
    for (const c of nativeChannels) {
      const dead = usersChecked > 0 && c.initialized === 0;
      try {
        await storage.createOrUpdateIntegrationHealth({
          integrationName: `ad-sync:${c.key}-native`,
          lastSuccessAt: dead ? undefined : new Date(),
          lastStatus: dead ? "degraded" : "success",
          errorMessage: dead
            ? `${c.label} native ad sync not connected for any user — Windsor-only coverage (client failed to initialize)`
            : null,
        });
      } catch (e) {
        console.warn(`[Ad Sync] Failed to update ${c.key} native health row:`, e);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Ad Sync] Completed in ${duration}ms — google ${googleSynced}, meta ${metaSynced}, windsor ${windsorSynced}, dashboard ${dashboardSynced} (users checked ${usersChecked}${skippedChannels.length ? `, DEAD native feeds: ${skippedChannels.join(", ")}` : ""})`);
    await recordRunSafe({
      schedulerId: "ad-performance-sync",
      schedulerName: "Marketing ad performance sync (Google + Meta + Windsor + dashboard)",
      status: errors.length > 0 || skippedChannels.length > 0 ? "partial" : "success",
      startedAt: schedulerStartedAt,
      durationMs: duration,
      errorMessage:
        errors.length > 0
          ? errors.slice(0, 3).join("; ")
          : skippedChannels.length > 0
            ? `${skippedChannels.join("/")} native sync not connected — Windsor only`
            : null,
      details: { usersChecked, googleSynced, metaSynced, windsorSynced, dashboardSynced, skippedChannels, errorCount: errors.length },
    });
  } catch (error: any) {
    console.error("[Ad Sync] Failed:", error);
    await recordRunSafe({
      schedulerId: "ad-performance-sync",
      schedulerName: "Marketing ad performance sync (Google + Meta)",
      status: "failed",
      startedAt: schedulerStartedAt,
      errorMessage: error?.message ?? String(error),
    });
  }
}

/**
 * Runs the AI System Review to analyze logs and generate recommendations
 * This runs weekly by default to avoid excessive API costs
 */
/**
 * CIPH.R — daily financial-position snapshot (the spec's "every 24h" pulse).
 * Pulls Cash on Hand / AR / AP / P&L from QuickBooks into qb_financial_snapshots.
 * The financial position is company-wide, so we capture for the first
 * QB-connected user and stop. No-ops gracefully (status "skipped") when no user
 * has QuickBooks connected, so this is safe to arm before Part B reconnect.
 */
async function performFinancialSnapshotCapture(): Promise<void> {
  const startedAt = new Date();
  try {
    const { captureFinancialSnapshot } = await import("./services/qb-financial-service");
    const users = await storage.getAllUsers();
    let captured = false;
    let lastError = "no QuickBooks-connected user";
    for (const user of users) {
      const r = await captureFinancialSnapshot(user.id);
      if (r.ok) {
        captured = true;
        const gaps = Array.isArray(r.snapshot?.dataGaps) ? (r.snapshot!.dataGaps as unknown[]).length : 0;
        console.log(
          `[Financial Snapshot] Captured for user ${user.id} — confidence ${r.snapshot?.confidence ?? "?"}%, ${gaps} data gap(s)`,
        );
        break; // company-wide position — one snapshot/day is enough
      }
      lastError = r.error || lastError;
    }
    // After a fresh snapshot, compute + store the runway forecast (Phase 2)
    // so the dashboard has a current cash-runway reading each day.
    if (captured) {
      try {
        const { computeAndStoreRunway } = await import("./services/runway-service");
        const rw = await computeAndStoreRunway();
        if (rw.ok) {
          console.log(`[Financial Snapshot] Runway forecast stored (status ${rw.forecast?.runwayStatus})`);
        } else {
          console.warn(`[Financial Snapshot] Runway forecast skipped: ${rw.error}`);
        }
      } catch (e: any) {
        console.error("[Financial Snapshot] Runway forecast failed:", e?.message ?? e);
      }
    }
    await recordRunSafe({
      schedulerId: "financial-snapshot",
      schedulerName: "CIPH.R financial-position snapshot (QuickBooks)",
      status: captured ? "success" : "skipped",
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      errorMessage: captured ? null : lastError,
    });
  } catch (error: any) {
    console.error("[Financial Snapshot] Failed:", error);
    await recordRunSafe({
      schedulerId: "financial-snapshot",
      schedulerName: "CIPH.R financial-position snapshot (QuickBooks)",
      status: "failed",
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      errorMessage: error?.message ?? String(error),
    });
  }
}

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
 * Morning Trap Runner — Zo's daily KPI briefing
 * Runs at 7 AM MST daily. Pulls all marketing/sales data, generates Claude briefing, texts Zo.
 */
async function performMorningTrapCheck(): Promise<void> {
  console.log("[Scheduler] Starting Morning Trap Check...");
  const startTime = Date.now();

  try {
    // Get admin users to run trap check for
    const allUsers = await storage.getAllUsers();
    const adminUser = allUsers.find(u => u.role === 'admin');

    if (!adminUser) {
      console.warn("[Scheduler] No admin user found for morning trap check");
      return;
    }

    const result = await MorningTrapService.runTrapCheck(adminUser.id, { sendSms: true });
    const duration = Date.now() - startTime;

    if (result.success) {
      console.log(`[Scheduler] Morning Trap Check completed in ${duration}ms. SMS sent: ${result.smsSent}`);
      if (result.smsError) {
        console.warn(`[Scheduler] Morning Trap SMS issue: ${result.smsError}`);
      }
    } else {
      console.warn(`[Scheduler] Morning Trap Check completed with issues in ${duration}ms`);
    }
  } catch (error) {
    console.error("[Scheduler] Error during Morning Trap Check:", error);
  }
}

/**
 * Weekly CMO digest. Fires daily at 7 AM MST but only sends on Mondays —
 * the headline CMO numbers (revenue vs target, blended ROAS, LTV:CAC,
 * repeat rate) texted to Zo via GHL.
 */
async function performWeeklyDigest(): Promise<void> {
  // Gate to Monday in Mountain Time (UTC-7). 7 AM MST = 14:00 UTC, so the
  // UTC day is the same as the MT day at that hour.
  const dayOfWeek = new Date().getUTCDay(); // 0=Sun, 1=Mon
  if (dayOfWeek !== 1) {
    return;
  }
  console.log("[Scheduler] Starting Weekly CMO Digest...");
  const startTime = Date.now();
  try {
    const allUsers = await storage.getAllUsers();
    const adminUser = allUsers.find(u => u.role === 'admin');
    if (!adminUser) {
      console.warn("[Scheduler] No admin user found for weekly digest");
      return;
    }
    const result = await WeeklyDigestService.run(adminUser.id, { sendSms: true });
    const duration = Date.now() - startTime;
    console.log(`[Scheduler] Weekly CMO Digest completed in ${duration}ms. SMS sent: ${result.smsSent}`);
    if (!result.success && result.error) {
      console.warn(`[Scheduler] Weekly Digest issue: ${result.error}`);
    }
  } catch (error) {
    console.error("[Scheduler] Error during Weekly CMO Digest:", error);
  }
}

/**
 * Refresh items.daily_usage from sales velocity. Runs nightly at 12:05
 * AM MT (just after the morning's sales sync would settle a UTC day) so
 * the day's order activity is reflected in the next day's reorder
 * calculations.
 */
async function performVelocityRefresh(opts: { onlyZeroOrNull: boolean }): Promise<void> {
  console.log(`[Scheduler] Refreshing item daily_usage (onlyZeroOrNull=${opts.onlyZeroOrNull})...`);
  const startTime = Date.now();
  try {
    const { refreshAllItems } = await import("./services/velocity-service");
    const result = await refreshAllItems(opts);
    const duration = Date.now() - startTime;
    console.log(
      `[Scheduler] Velocity refresh: scanned=${result.itemsScanned}, ` +
      `finished updated=${result.finishedProductsUpdated}, ` +
      `components updated=${result.componentsUpdated}, ` +
      `duration=${duration}ms`,
    );
  } catch (error) {
    console.error("[Scheduler] Velocity refresh failed:", error);
  }
}

/**
 * Inventory Drift Report — hourly reconciliation check of every finished
 * product's local sellable number (availableForSaleQty) against the
 * Extensiv-mirrored available (pivotQty). READ-ONLY: it reports, never writes.
 *
 * A clean run records as "success"; a run with any flagged item (drift over
 * threshold, or a stale/never-synced Extensiv pull) records as "partial" so it
 * surfaces as a WARNING in the scheduler health + audit trail (visible in
 * Settings) without paging anyone. Inspect flagged SKUs there or via
 * `npm run report:drift`.
 */
async function performDriftReport(): Promise<void> {
  const schedulerStartedAt = new Date();
  const startTime = Date.now();
  try {
    const result = await runDriftReport();
    const duration = Date.now() - startTime;

    const top = result.flaggedItems.slice(0, 10).map((r) => ({
      sku: r.sku,
      afs: r.afs,
      pivot: r.pivot,
      drift: r.drift,
      stale: r.stale,
      ageHours: r.ageHours === null ? null : Math.round(r.ageHours * 10) / 10,
    }));

    if (result.flaggedCount === 0) {
      console.log(
        `[Drift Report] OK — ${result.analyzed} finished products within ±${result.driftThreshold} and freshly synced (${duration}ms)`,
      );
    } else {
      console.warn(
        `[Drift Report] ${result.flaggedCount} flagged of ${result.analyzed} ` +
          `(drift>=±${result.driftThreshold}: ${result.overThresholdCount}, ` +
          `stale>${result.staleHours}h: ${result.staleCount}) in ${duration}ms`,
      );
      for (const r of top) {
        console.warn(
          `[Drift Report]   ${r.sku ?? "(no sku)"}  afs=${r.afs} pivot=${r.pivot} ` +
            `drift=${r.drift >= 0 ? "+" : ""}${r.drift}` +
            (r.stale ? `  STALE(${r.ageHours === null ? "never" : r.ageHours + "h"})` : ""),
        );
      }
    }

    await recordRunSafe({
      schedulerId: "inventory-drift-report",
      schedulerName: "Inventory drift report",
      status: result.flaggedCount > 0 ? "partial" : "success",
      startedAt: schedulerStartedAt,
      durationMs: duration,
      errorMessage: null,
      details: {
        analyzed: result.analyzed,
        overThreshold: result.overThresholdCount,
        stale: result.staleCount,
        flagged: result.flaggedCount,
        driftThreshold: result.driftThreshold,
        staleHours: result.staleHours,
        topFlagged: top,
      },
    });
  } catch (error: any) {
    console.error("[Drift Report] Failed:", error);
    await recordRunSafe({
      schedulerId: "inventory-drift-report",
      schedulerName: "Inventory drift report",
      status: "failed",
      startedAt: schedulerStartedAt,
      errorMessage: error?.message ?? String(error),
    });
  }
}

/**
 * Calculate milliseconds until the next 12:05 AM MT firing. Mirrors the
 * morning-trap MST math; +5 minutes so the daily sales scheduler settles
 * before we read totals.
 */
/**
 * ms until the next top-of-hour UTC boundary. Used by the in-process
 * Extensiv fallback so ticks align to wall clock and do not drift from
 * server restart time.
 */
function msUntilNextHourUTC(): number {
  const now = new Date();
  const target = new Date(now);
  target.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
  return target.getTime() - now.getTime();
}

/**
 * ms until the next :15-past-the-hour UTC boundary. The drift report runs
 * here so it lands just after the top-of-hour Extensiv sync refreshes
 * pivot_qty, giving the freshest possible baseline to compare against.
 */
function msUntilNext15PastHourUTC(): number {
  const now = new Date();
  const target = new Date(now);
  target.setUTCMinutes(15, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setUTCHours(target.getUTCHours() + 1);
  }
  return target.getTime() - now.getTime();
}

function msUntilNextMidnightMT(): number {
  const now = new Date();
  const mstOffset = -7 * 60; // minutes — MST is UTC-7
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const mstMinutes = utcMinutes + mstOffset;
  const targetMstMinutes = 5; // 00:05 MT
  let minutesUntil = targetMstMinutes - mstMinutes;
  if (minutesUntil <= 0) minutesUntil += 24 * 60;
  return minutesUntil * 60 * 1000;
}

/**
 * Calculate milliseconds until next 7 AM MST (UTC-7)
 */
function msUntilNext7amMST(): number {
  const now = new Date();
  // MST is UTC-7
  const mstOffset = -7 * 60; // minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const mstMinutes = utcMinutes + mstOffset;

  // Target: 7:00 AM MST = 7*60 = 420 minutes into the MST day
  const targetMstMinutes = 7 * 60;

  let minutesUntil = targetMstMinutes - mstMinutes;
  if (minutesUntil <= 0) {
    minutesUntil += 24 * 60; // Next day
  }

  return minutesUntil * 60 * 1000;
}

/**
 * Starts the scheduler for all enabled channels.
 * Reads channel configurations and schedules individual timers.
 */
export async function startScheduler(): Promise<void> {
  console.log("[Scheduler] Starting per-channel scheduler...");
  let sectionsStarted = 0;
  const totalSections = 9;

  try {
    const channels = await storage.getAllChannels();
    for (const channel of channels) {
      if (channel.isActive) {
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
    sectionsStarted++;
  } catch (err) {
    console.error("[Scheduler] Channels failed to initialize:", err);
  }

  try {
    if (forecastContextTimer) {
      clearInterval(forecastContextTimer);
    }

    performForecastContextRefresh().catch(err => {
      console.error("[Scheduler] Initial forecast refresh failed:", err);
    });

    forecastContextTimer = setInterval(() => {
      performForecastContextRefresh().catch(err => {
        console.error("[Scheduler] Scheduled forecast refresh failed:", err);
      });
    }, 6 * 60 * 60 * 1000); // 6 hours
    sectionsStarted++;
  } catch (err) {
    console.error("[Scheduler] Forecast context refresh failed to initialize:", err);
  }

  try {
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
    sectionsStarted++;
  } catch (err) {
    console.error("[Scheduler] AI System Review failed to initialize:", err);
  }

  try {
    if (extensivSyncTimer) {
      clearTimeout(extensivSyncTimer);
    }
    const msUntilNextTick = msUntilNextHourUTC();
    const target = new Date(Date.now() + msUntilNextTick);
    const targetHHMM = `${String(target.getUTCHours()).padStart(2, "0")}:${String(target.getUTCMinutes()).padStart(2, "0")}`;
    const minutesUntil = Math.round(msUntilNextTick / 60000);
    console.log(
      `[Extensiv Sync] Scheduler initialized — next run at ${targetHHMM} UTC (in ${minutesUntil} minutes)`,
    );

    extensivSyncTimer = setTimeout(() => {
      performExtensivSync().catch((err) =>
        console.error("[Extensiv Sync] Scheduled run failed:", err),
      );
      // After the first aligned tick, fall back to a plain hourly
      // interval. Each subsequent tick lands on the same wall-clock
      // boundary because the first one did.
      extensivSyncTimer = setInterval(() => {
        performExtensivSync().catch((err) =>
          console.error("[Extensiv Sync] Scheduled run failed:", err),
        );
      }, EXTENSIV_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
    }, msUntilNextTick);
    sectionsStarted++;
  } catch (err) {
    console.error("[Scheduler] Extensiv sync failed to initialize:", err);
  }

  try {
    if (morningTrapTimer) {
      clearTimeout(morningTrapTimer);
    }

    const msUntil7am = msUntilNext7amMST();
    const hoursUntil = (msUntil7am / (1000 * 60 * 60)).toFixed(1);
    console.log(`[Scheduler] Morning Trap Check scheduled. Next run in ${hoursUntil} hours (7 AM MST)`);

    // Use setTimeout for first run at 7 AM, then setInterval for daily after that
    morningTrapTimer = setTimeout(() => {
      performMorningTrapCheck().catch(err => {
        console.error("[Scheduler] Morning Trap Check failed:", err);
      });

      // After first run, repeat every 24 hours
      morningTrapTimer = setInterval(() => {
        performMorningTrapCheck().catch(err => {
          console.error("[Scheduler] Scheduled Morning Trap Check failed:", err);
        });
      }, 24 * 60 * 60 * 1000);
    }, msUntil7am);
    sectionsStarted++;
  } catch (err) {
    console.error("[Scheduler] Morning Trap failed to initialize:", err);
  }

  // ── Weekly CMO digest (Mondays 7 AM MST) ──────────────────────────────
  try {
    if (weeklyDigestTimer) {
      clearTimeout(weeklyDigestTimer);
      clearInterval(weeklyDigestTimer);
    }
    const msUntil7amDigest = msUntilNext7amMST();
    console.log(`[Scheduler] Weekly CMO Digest scheduled. Checks daily at 7 AM MST, sends on Mondays.`);
    // Fire daily at 7 AM; performWeeklyDigest self-gates to Monday.
    weeklyDigestTimer = setTimeout(() => {
      performWeeklyDigest().catch(err => console.error("[Scheduler] Weekly Digest failed:", err));
      weeklyDigestTimer = setInterval(() => {
        performWeeklyDigest().catch(err => console.error("[Scheduler] Weekly Digest failed:", err));
      }, 24 * 60 * 60 * 1000);
    }, msUntil7amDigest);
    sectionsStarted++;
  } catch (err) {
    console.error("[Scheduler] Weekly Digest failed to initialize:", err);
  }

  try {
    performVelocityRefresh({ onlyZeroOrNull: true }).catch((err) => {
      console.error("[Scheduler] Boot-time velocity backfill failed:", err);
    });

    if (velocityTimer) {
      clearTimeout(velocityTimer);
    }
    const msUntilVelocity = msUntilNextMidnightMT();
    const hoursUntilVelocity = (msUntilVelocity / (1000 * 60 * 60)).toFixed(1);
    console.log(`[Scheduler] Velocity refresh scheduled. Next run in ${hoursUntilVelocity} hours (12:05 AM MT)`);
    velocityTimer = setTimeout(() => {
      performVelocityRefresh({ onlyZeroOrNull: false }).catch(() => {});
      velocityTimer = setInterval(() => {
        performVelocityRefresh({ onlyZeroOrNull: false }).catch(() => {});
      }, 24 * 60 * 60 * 1000);
    }, msUntilVelocity);
    sectionsStarted++;
  } catch (err) {
    console.error("[Scheduler] Velocity refresh failed to initialize:", err);
  }

  try {
    if (driftReportTimer) {
      clearTimeout(driftReportTimer);
      clearInterval(driftReportTimer);
    }
    const msUntilDrift = msUntilNext15PastHourUTC();
    const driftTarget = new Date(Date.now() + msUntilDrift);
    const driftHHMM = `${String(driftTarget.getUTCHours()).padStart(2, "0")}:${String(driftTarget.getUTCMinutes()).padStart(2, "0")}`;
    console.log(
      `[Drift Report] Scheduler initialized — next run at ${driftHHMM} UTC (in ${Math.round(msUntilDrift / 60000)} minutes), then hourly`,
    );
    driftReportTimer = setTimeout(() => {
      performDriftReport().catch((err) =>
        console.error("[Drift Report] Scheduled run failed:", err),
      );
      driftReportTimer = setInterval(() => {
        performDriftReport().catch((err) =>
          console.error("[Drift Report] Scheduled run failed:", err),
        );
      }, DRIFT_REPORT_INTERVAL_HOURS * 60 * 60 * 1000);
    }, msUntilDrift);
    sectionsStarted++;
  } catch (err) {
    console.error("[Scheduler] Drift report failed to initialize:", err);
  }

  try {
    // Marketing ad performance sync (real Google Ads + Meta). Boot run so data
    // appears soon after deploy/connect, then daily at ~12:05 AM MT.
    performAdPerformanceSync().catch((err) => {
      console.error("[Ad Sync] Boot-time run failed:", err);
    });
    if (adSyncTimer) {
      clearTimeout(adSyncTimer);
      clearInterval(adSyncTimer);
    }
    const msUntilAdSync = msUntilNextMidnightMT();
    console.log(
      `[Ad Sync] Scheduled. Next run in ${(msUntilAdSync / (1000 * 60 * 60)).toFixed(1)} hours (12:05 AM MT), then daily`,
    );
    adSyncTimer = setTimeout(() => {
      performAdPerformanceSync().catch(() => {});
      adSyncTimer = setInterval(() => {
        performAdPerformanceSync().catch(() => {});
      }, 24 * 60 * 60 * 1000);
    }, msUntilAdSync);
    sectionsStarted++;
  } catch (err) {
    console.error("[Scheduler] Ad performance sync failed to initialize:", err);
  }

  try {
    // CIPH.R financial-position snapshot. Boot run so a snapshot appears soon
    // after QB connects, then daily at midnight MT (alongside the ad sync).
    performFinancialSnapshotCapture().catch((err) => {
      console.error("[Financial Snapshot] Boot-time run failed:", err);
    });
    if (financialSnapshotTimer) {
      clearTimeout(financialSnapshotTimer);
      clearInterval(financialSnapshotTimer);
    }
    const msUntilFin = msUntilNextMidnightMT();
    console.log(
      `[Financial Snapshot] Scheduled. Next run in ${(msUntilFin / (1000 * 60 * 60)).toFixed(1)} hours (12:05 AM MT), then daily`,
    );
    financialSnapshotTimer = setTimeout(() => {
      performFinancialSnapshotCapture().catch(() => {});
      financialSnapshotTimer = setInterval(() => {
        performFinancialSnapshotCapture().catch(() => {});
      }, 24 * 60 * 60 * 1000);
    }, msUntilFin);
    sectionsStarted++;
  } catch (err) {
    console.error("[Scheduler] Financial snapshot capture failed to initialize:", err);
  }

  console.log(
    `[Scheduler] Scheduler started successfully (${sectionsStarted}/${totalSections} sections initialized, ${channelSchedules.size} channels active)`,
  );
}

/**
 * Stops all schedulers.
 */
export function stopScheduler(): void {
  // Stop all channel schedules
  for (const [channelId] of Array.from(channelSchedules)) {
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

  // Stop Weekly Digest timer
  if (weeklyDigestTimer) {
    clearTimeout(weeklyDigestTimer);
    clearInterval(weeklyDigestTimer);
    weeklyDigestTimer = null;
  }

  // Stop Extensiv sync timer
  if (extensivSyncTimer) {
    clearInterval(extensivSyncTimer);
    extensivSyncTimer = null;
  }

  // Stop Morning Trap timer
  if (morningTrapTimer) {
    clearTimeout(morningTrapTimer);
    clearInterval(morningTrapTimer);
    morningTrapTimer = null;
  }

  // Stop Velocity timer
  if (velocityTimer) {
    clearTimeout(velocityTimer);
    clearInterval(velocityTimer);
    velocityTimer = null;
  }

  // Stop Drift Report timer
  if (driftReportTimer) {
    clearTimeout(driftReportTimer);
    clearInterval(driftReportTimer);
    driftReportTimer = null;
  }

  // Stop Ad Performance Sync timer
  if (adSyncTimer) {
    clearTimeout(adSyncTimer);
    clearInterval(adSyncTimer);
    adSyncTimer = null;
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
  driftReportScheduled: boolean;
  adSyncScheduled: boolean;
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
    driftReportScheduled: driftReportTimer !== null,
    adSyncScheduled: adSyncTimer !== null,
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
