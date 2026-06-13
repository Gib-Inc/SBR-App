/**
 * Daily Company Report Scheduler — runs the "company brain" routine at 6:45 AM
 * MT (after supplier-intel 6:00 AM + overnight syncs, before the 7:00 AM Morning
 * Trap), refreshing feeds + cross-checking + analyzing, and reporting to Health.
 * A DRIFT report records as "partial" (visible warning, not a false crash).
 */
import { runDailyCompanyReport } from "./daily-company-report-service";
import { recordSchedulerRun } from "./scheduler-run-recorder";

const TIMEZONE = "America/Denver";
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

async function runScheduled(): Promise<void> {
  const startedAt = new Date();
  try {
    const report = await runDailyCompanyReport();
    await recordSchedulerRun({
      schedulerId: "daily-company-report",
      schedulerName: "Daily company report",
      status: report.status === "DRIFT" ? "partial" : "success",
      startedAt,
      errorMessage: report.status === "OK" ? null : `${report.status}: ${report.anomalies.length} item(s)`,
      details: { forDate: report.forDate, status: report.status, anomalies: report.anomalies.length, salesStatus: report.sales?.status },
    }).catch((e) => console.warn("[Daily Company Report] record run failed:", e));
  } catch (error: any) {
    console.error("[Daily Company Report] Scheduled run failed:", error?.message ?? error);
    await recordSchedulerRun({
      schedulerId: "daily-company-report",
      schedulerName: "Daily company report",
      status: "failed",
      startedAt,
      errorMessage: error?.message ?? String(error),
    }).catch(() => {});
  }
  scheduleNext();
}

function scheduleNext(): void {
  nextScheduledRun = getMountainTime(6, 45);
  const ms = Math.max(0, nextScheduledRun.getTime() - Date.now());
  console.log(`[Daily Company Report] Next run: 6:45 AM MT at ${nextScheduledRun.toISOString()} (in ${Math.round(ms / 60000)} min)`);
  setTimeout(() => {
    runScheduled();
  }, ms);
}

export function initializeDailyCompanyReportScheduler(): void {
  if (initialized) {
    console.log("[Daily Company Report] Scheduler already initialized");
    return;
  }
  initialized = true;
  console.log("[Daily Company Report] Initializing — daily 6:45 AM MT");
  scheduleNext();
}

export function getDailyCompanyReportSchedulerStatus(): {
  initialized: boolean;
  nextRunAt: Date | null;
  timezone: string;
} {
  return { initialized, nextRunAt: nextScheduledRun, timezone: TIMEZONE };
}
