/**
 * Supplier Intel Scheduler
 * ------------------------
 * Refreshes the Supplier Intel snapshot daily at 6:00 AM Mountain Time
 * (America/Denver). On startup it also computes an initial snapshot if none
 * exists yet, so the page has live data immediately after deploy rather than
 * waiting for the first 6 AM run. Each run reports to the Health monitor via
 * refreshSupplierIntelSnapshot() so a stale/failed snapshot is visible there.
 */
import {
  refreshSupplierIntelSnapshot,
  getLatestSupplierIntelSnapshot,
} from "./supplier-intel-service";

const TIMEZONE = "America/Denver";

let schedulerInitialized = false;
let nextScheduledRun: Date | null = null;

/** Next occurrence of the given Mountain-time hour:minute, as a UTC Date. */
function getMountainTime(hour: number, minute = 0): Date {
  const now = new Date();
  const mountainNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const target = new Date(mountainNow);
  target.setHours(hour, minute, 0, 0);
  if (target <= mountainNow) target.setDate(target.getDate() + 1);
  const utcOffset = mountainNow.getTime() - now.getTime();
  return new Date(target.getTime() - utcOffset);
}

function msUntilTarget(targetTime: Date): number {
  return Math.max(0, targetTime.getTime() - Date.now());
}

async function runScheduledRefresh(): Promise<void> {
  console.log("[Supplier Intel] Running scheduled 6 AM MT refresh");
  try {
    await refreshSupplierIntelSnapshot("SCHEDULED");
  } catch (error: any) {
    // refreshSupplierIntelSnapshot already records the failure to Health.
    console.error("[Supplier Intel] Scheduled refresh failed:", error?.message ?? error);
  }
  scheduleNextRun();
}

function scheduleNextRun(): void {
  nextScheduledRun = getMountainTime(6, 0);
  const msUntil = msUntilTarget(nextScheduledRun);
  console.log(
    `[Supplier Intel] Next refresh scheduled: 6:00 AM MT at ${nextScheduledRun.toISOString()} (in ${Math.round(msUntil / 60000)} minutes)`,
  );
  setTimeout(() => {
    runScheduledRefresh();
  }, msUntil);
}

export function initializeSupplierIntelScheduler(): void {
  if (schedulerInitialized) {
    console.log("[Supplier Intel] Scheduler already initialized");
    return;
  }
  schedulerInitialized = true;
  console.log("[Supplier Intel] Initializing scheduler for Mountain Time (America/Denver), daily 6:00 AM");
  scheduleNextRun();

  // Seed an initial snapshot if the table is empty so the page isn't blank
  // before the first scheduled run. Fire-and-forget; never blocks startup.
  getLatestSupplierIntelSnapshot()
    .then((existing) => {
      if (!existing) {
        console.log("[Supplier Intel] No snapshot found — computing initial snapshot");
        return refreshSupplierIntelSnapshot("STARTUP").then(() => undefined);
      }
    })
    .catch((e) => console.warn("[Supplier Intel] Initial snapshot seed failed:", e?.message ?? e));

  console.log("[Supplier Intel] Scheduler initialized");
}

export function getSupplierIntelSchedulerStatus(): {
  initialized: boolean;
  nextRunAt: Date | null;
  timezone: string;
} {
  return { initialized: schedulerInitialized, nextRunAt: nextScheduledRun, timezone: TIMEZONE };
}
