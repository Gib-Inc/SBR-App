/**
 * Marketing Analytics Scheduler
 * -----------------------------
 * Runs the blended ad Intelligence/Recommendation engine daily at 6:30 AM MT
 * (after the overnight Windsor ad-spend sync + daily-sales rollup), persisting
 * a fresh directive to marketing_recommendations. Reports each run to the
 * Health monitor so a stale/failed analysis surfaces there. Fully hands-off.
 */
import { runMarketingAnalysis } from "./marketing-analytics-service";
import { recordSchedulerRun } from "./scheduler-run-recorder";

const TIMEZONE = "America/Denver";

let schedulerInitialized = false;
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

function msUntilTarget(t: Date): number {
  return Math.max(0, t.getTime() - Date.now());
}

async function runScheduledAnalysis(): Promise<void> {
  console.log("[Marketing Analytics] Running scheduled 6:30 AM MT analysis");
  const startedAt = new Date();
  try {
    const a = await runMarketingAnalysis({ createdBy: "scheduled" });
    await recordSchedulerRun({
      schedulerId: "marketing-analytics",
      schedulerName: "Marketing analytics directive",
      status: "success",
      startedAt,
      errorMessage: null,
      details: {
        action: a.directive.action,
        blendedRoas7d: a.blendedRoas7d,
        blendedRoas30d: a.blendedRoas30d,
        dataConfident: a.dataConfident,
        dataGaps: a.dataGaps.length,
      },
    }).catch((e) => console.warn("[Marketing Analytics] record run failed:", e));
  } catch (error: any) {
    console.error("[Marketing Analytics] Scheduled analysis failed:", error?.message ?? error);
    await recordSchedulerRun({
      schedulerId: "marketing-analytics",
      schedulerName: "Marketing analytics directive",
      status: "failed",
      startedAt,
      errorMessage: error?.message ?? String(error),
    }).catch((e) => console.warn("[Marketing Analytics] record run failed:", e));
  }
  scheduleNextRun();
}

function scheduleNextRun(): void {
  nextScheduledRun = getMountainTime(6, 30);
  const msUntil = msUntilTarget(nextScheduledRun);
  console.log(
    `[Marketing Analytics] Next run: 6:30 AM MT at ${nextScheduledRun.toISOString()} (in ${Math.round(msUntil / 60000)} min)`,
  );
  setTimeout(() => {
    runScheduledAnalysis();
  }, msUntil);
}

export function initializeMarketingAnalyticsScheduler(): void {
  if (schedulerInitialized) {
    console.log("[Marketing Analytics] Scheduler already initialized");
    return;
  }
  schedulerInitialized = true;
  console.log("[Marketing Analytics] Initializing scheduler — daily 6:30 AM MT");
  scheduleNextRun();
}

export function getMarketingAnalyticsSchedulerStatus(): {
  initialized: boolean;
  nextRunAt: Date | null;
  timezone: string;
} {
  return { initialized: schedulerInitialized, nextRunAt: nextScheduledRun, timezone: TIMEZONE };
}
