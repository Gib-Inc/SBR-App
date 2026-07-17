/**
 * Truth Monitor Scheduler
 * -----------------------
 * Runs the read-only daily Truth Report (V-suite + ledger stats + feed
 * confidence) at 7:00 AM MT, plus a startup self-heal run when no report
 * exists in the last 24h — so a fresh deploy proves the numbers immediately
 * instead of waiting a day.
 *
 * A report that FINDS problems (overall WARN/FAIL) records as a "partial"
 * scheduler run: the monitor itself succeeded, and the finding stays a visible
 * warning without reading as a crash. Only a thrown exception records "failed".
 */
import { runTruthReport } from "./truth-monitor-service";
import { recordSchedulerRun } from "./scheduler-run-recorder";

const TIMEZONE = "America/Denver";
const SCHEDULER_ID = "truth-monitor";
const SCHEDULER_NAME = "Truth Monitor daily report";

let initialized = false;
let nextScheduledRun: Date | null = null;
let lastRunAt: Date | null = null;

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
    const { report, persisted, persistError } = await runTruthReport();
    lastRunAt = new Date();
    const nonPass = report.checks.filter((c) => c.status !== "PASS");
    const status = report.overall === "PASS" && persisted ? "success" : "partial";
    await recordSchedulerRun({
      schedulerId: SCHEDULER_ID,
      schedulerName: SCHEDULER_NAME,
      status,
      startedAt,
      errorMessage:
        status === "success"
          ? null
          : [
              nonPass.length
                ? `${report.overall}: ${nonPass.map((c) => `${c.id}=${c.status}`).join(", ")}`
                : null,
              persisted ? null : `report NOT persisted: ${persistError ?? "unknown error"}`,
            ]
              .filter(Boolean)
              .join(" | "),
      details: {
        reason,
        overall: report.overall,
        persisted,
        reportId: report.id ?? null,
        checks: report.checks.map((c) => ({ id: c.id, status: c.status })),
      },
    }).catch((e) => console.warn("[Truth Monitor] record run failed:", e));
    console.log(
      `[Truth Monitor] Report complete: ${report.overall} (${nonPass.length} non-PASS check(s)${persisted ? "" : ", NOT persisted"})`,
    );
  } catch (error: any) {
    console.error("[Truth Monitor] Scheduled run failed:", error?.message ?? error);
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
  nextScheduledRun = getMountainTime(7, 0);
  const ms = Math.max(0, nextScheduledRun.getTime() - Date.now());
  console.log(
    `[Truth Monitor] Next run: 7:00 AM MT at ${nextScheduledRun.toISOString()} (in ${Math.round(ms / 60000)} min)`,
  );
  setTimeout(() => {
    runScheduled("scheduled").finally(scheduleNext);
  }, ms);
}

export function initializeTruthMonitorScheduler(): void {
  if (initialized) {
    console.log("[Truth Monitor] Scheduler already initialized");
    return;
  }
  initialized = true;
  console.log("[Truth Monitor] Initializing — daily 7:00 AM MT + startup self-heal");
  setTimeout(async () => {
    try {
      const { hasRecentTruthReport } = await import("./truth-monitor-service");
      // If the freshness probe itself fails, run anyway — running is the
      // honest default; the run will record its own outcome.
      const recent = await hasRecentTruthReport().catch(() => false);
      if (recent) {
        console.log("[Truth Monitor] Startup self-heal skipped — a report exists in the last 24h");
        return;
      }
      await runScheduled("startup-self-heal");
    } catch (e: any) {
      console.warn("[Truth Monitor] startup self-heal failed:", e?.message ?? e);
    }
  }, 15_000);
  scheduleNext();
}

export function getTruthMonitorSchedulerStatus(): {
  initialized: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  timezone: string;
} {
  return { initialized, nextRunAt: nextScheduledRun, lastRunAt, timezone: TIMEZONE };
}
