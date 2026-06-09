/**
 * Forecast Tuning Scheduler — runs the Pillar 4 self-tuning loop nightly at
 * 12:15 AM MT, right after the 11:59 PM daily-sales rollup lands the night's
 * actualized revenue. Reports to the Health monitor.
 */
import { runNightlyForecastTuning } from "./forecast-tuning-service";
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
    const r = await runNightlyForecastTuning();
    await recordSchedulerRun({
      schedulerId: "forecast-tuning",
      schedulerName: "Forecast self-tuning",
      status: "success",
      startedAt,
      errorMessage: null,
      details: {
        actualized: r.actualized,
        mape: r.report?.mape ?? null,
        grade: r.report?.grade ?? null,
        factor: r.factor,
        tomorrowPredicted: r.tomorrow?.predicted ?? null,
        notes: r.notes.length,
      },
    }).catch((e) => console.warn("[Forecast Tuning] record run failed:", e));
  } catch (error: any) {
    console.error("[Forecast Tuning] Scheduled run failed:", error?.message ?? error);
    await recordSchedulerRun({
      schedulerId: "forecast-tuning",
      schedulerName: "Forecast self-tuning",
      status: "failed",
      startedAt,
      errorMessage: error?.message ?? String(error),
    }).catch(() => {});
  }
  scheduleNext();
}

function scheduleNext(): void {
  nextScheduledRun = getMountainTime(0, 15);
  const ms = Math.max(0, nextScheduledRun.getTime() - Date.now());
  console.log(`[Forecast Tuning] Next run: 12:15 AM MT at ${nextScheduledRun.toISOString()} (in ${Math.round(ms / 60000)} min)`);
  setTimeout(() => {
    runScheduled();
  }, ms);
}

export function initializeForecastTuningScheduler(): void {
  if (initialized) {
    console.log("[Forecast Tuning] Scheduler already initialized");
    return;
  }
  initialized = true;
  console.log("[Forecast Tuning] Initializing — nightly 12:15 AM MT (after the daily-sales rollup)");
  scheduleNext();
  // Seed the loop on startup so the first prediction exists tonight rather
  // than waiting a full cycle. Fire-and-forget; never blocks boot.
  setTimeout(() => {
    runNightlyForecastTuning().catch((e) =>
      console.warn("[Forecast Tuning] startup seed failed:", e?.message ?? e));
  }, 90_000);
}

export function getForecastTuningSchedulerStatus(): {
  initialized: boolean;
  nextRunAt: Date | null;
  timezone: string;
} {
  return { initialized, nextRunAt: nextScheduledRun, timezone: TIMEZONE };
}
