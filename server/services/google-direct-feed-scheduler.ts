/**
 * Google Direct Feed Scheduler
 * ----------------------------
 * Pulls the Google Ads API once daily at 6:50 AM MT — 5 minutes after the
 * Meta direct feed — plus a startup self-heal run so a fresh deploy proves
 * credentials immediately instead of waiting a full day. With credentials
 * absent the sync reports awaiting_credentials and stays dark and quiet:
 * no failures logged, no circuit breaker trips.
 */
import { syncGoogleDirectSpend } from "./google-ads-client";
import { recordSchedulerRun } from "./scheduler-run-recorder";

const TIMEZONE = "America/Denver";
const SCHEDULER_ID = "google-direct-feed";
const SCHEDULER_NAME = "Google Ads API direct feed";

let initialized = false;
let nextScheduledRun: Date | null = null;

function getMountainTime(hour: number, minute = 0): Date {
  const now = new Date();
  const mountainNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const target = new Date(mountainNow);
  target.setHours(hour, minute, 0, 0);
  if (target <= mountainNow) target.setDate(target.getDate() + 1);
  const utcOffset = mountainNow.getTime() - now.getTime();
  return new Date(target.getTime() - utcOffset);
}

async function runScheduled(reason: "startup-self-heal" | "scheduled"): Promise<void> {
  const startedAt = new Date();
  try {
    const result = await syncGoogleDirectSpend();
    const status = result.status === "failed" ? "failed" : result.status === "skipped" ? "skipped" : "success";
    await recordSchedulerRun({
      schedulerId: SCHEDULER_ID,
      schedulerName: SCHEDULER_NAME,
      status,
      startedAt,
      errorMessage: result.status === "failed" ? result.reason ?? "Google direct feed failed" : null,
      details: {
        reason,
        resultReason: result.reason ?? null,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        created: result.created,
        superseded: result.superseded,
        gapped: result.gapped,
      },
    }).catch((e) => console.warn("[Google Direct Feed] record run failed:", e));
  } catch (error: any) {
    console.error("[Google Direct Feed] Scheduler wrapper failed:", error?.message ?? error);
    await recordSchedulerRun({
      schedulerId: SCHEDULER_ID,
      schedulerName: SCHEDULER_NAME,
      status: "failed",
      startedAt,
      errorMessage: error?.message ?? String(error),
      details: { reason },
    }).catch(() => {});
  }
}

function scheduleNext(): void {
  nextScheduledRun = getMountainTime(6, 50);
  const ms = Math.max(0, nextScheduledRun.getTime() - Date.now());
  console.log(`[Google Direct Feed] Next run: 6:50 AM MT at ${nextScheduledRun.toISOString()} (in ${Math.round(ms / 60000)} min)`);
  setTimeout(() => {
    runScheduled("scheduled").finally(scheduleNext);
  }, ms);
}

export function initializeGoogleDirectFeedScheduler(): void {
  if (initialized) {
    console.log("[Google Direct Feed] Scheduler already initialized");
    return;
  }
  initialized = true;
  console.log("[Google Direct Feed] Initializing — daily 6:50 AM MT + startup self-heal");
  setTimeout(() => {
    runScheduled("startup-self-heal").catch((e) => console.warn("[Google Direct Feed] startup self-heal failed:", e));
  }, 10_000);
  scheduleNext();
}

export function getGoogleDirectFeedSchedulerStatus(): {
  initialized: boolean;
  nextRunAt: Date | null;
  timezone: string;
} {
  return { initialized, nextRunAt: nextScheduledRun, timezone: TIMEZONE };
}
