/**
 * Meta Direct Feed Scheduler
 * --------------------------
 * Pulls the Meta Marketing API once daily at 6:45 AM MT, after the existing
 * spend reconciliation window. A startup self-heal run makes a fresh deploy
 * prove credentials immediately instead of waiting a full day.
 */
import { syncMetaDirectSpend } from "./meta-ads-client";
import { recordSchedulerRun } from "./scheduler-run-recorder";

const TIMEZONE = "America/Denver";
const SCHEDULER_ID = "meta-direct-feed";
const SCHEDULER_NAME = "Meta Marketing API direct feed";

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
    const result = await syncMetaDirectSpend();
    const status = result.status === "failed" ? "failed" : result.status === "skipped" ? "skipped" : "success";
    await recordSchedulerRun({
      schedulerId: SCHEDULER_ID,
      schedulerName: SCHEDULER_NAME,
      status,
      startedAt,
      errorMessage: result.status === "failed" ? result.reason ?? "Meta direct feed failed" : null,
      details: {
        reason,
        resultReason: result.reason ?? null,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        created: result.created,
        superseded: result.superseded,
        gapped: result.gapped,
      },
    }).catch((e) => console.warn("[Meta Direct Feed] record run failed:", e));
  } catch (error: any) {
    console.error("[Meta Direct Feed] Scheduler wrapper failed:", error?.message ?? error);
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
  nextScheduledRun = getMountainTime(6, 45);
  const ms = Math.max(0, nextScheduledRun.getTime() - Date.now());
  console.log(`[Meta Direct Feed] Next run: 6:45 AM MT at ${nextScheduledRun.toISOString()} (in ${Math.round(ms / 60000)} min)`);
  setTimeout(() => {
    runScheduled("scheduled").finally(scheduleNext);
  }, ms);
}

export function initializeMetaDirectFeedScheduler(): void {
  if (initialized) {
    console.log("[Meta Direct Feed] Scheduler already initialized");
    return;
  }
  initialized = true;
  console.log("[Meta Direct Feed] Initializing — daily 6:45 AM MT + startup self-heal");
  setTimeout(() => {
    runScheduled("startup-self-heal").catch((e) => console.warn("[Meta Direct Feed] startup self-heal failed:", e));
  }, 10_000);
  scheduleNext();
}

export function getMetaDirectFeedSchedulerStatus(): {
  initialized: boolean;
  nextRunAt: Date | null;
  timezone: string;
} {
  return { initialized, nextRunAt: nextScheduledRun, timezone: TIMEZONE };
}
