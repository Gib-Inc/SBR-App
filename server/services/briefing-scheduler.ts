// Daily Briefing Scheduler — fires once per day at 7:00 AM Mountain Time.
// Mirrors the AI Batch Scheduler's interval-check pattern for restart safety
// and same-day idempotency. Lives in its own file to keep scheduler concerns
// separate from the briefing computation.

import { generateAndPersistBriefing } from "./briefing-service";

const TIMEZONE = "America/Denver";
const SCHEDULED_HOUR = 7;
const SCHEDULED_MINUTE = 0;
const RUN_KEY = "DAILY_BRIEFING";

let schedulerInitialized = false;
let lastRunDateKey: string | null = null;
let checkIntervalId: NodeJS.Timeout | null = null;

function getCurrentMountain(): { hour: number; minute: number; dateKey: string } {
  const now = new Date();
  const time = now.toLocaleString("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const [hourStr, minuteStr] = time.split(":");
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  // Date key in Mountain time so same-day re-runs are blocked across server
  // restarts (paired with persisted upsert in storage).
  const dateKey = now.toLocaleString("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return { hour, minute, dateKey };
}

async function checkAndRun(): Promise<void> {
  const { hour, minute, dateKey } = getCurrentMountain();
  // 5-minute window after 7:00 absorbs interval drift.
  if (hour !== SCHEDULED_HOUR) return;
  if (minute < SCHEDULED_MINUTE || minute >= SCHEDULED_MINUTE + 5) return;
  if (lastRunDateKey === dateKey) return;

  lastRunDateKey = dateKey;
  console.log(`[Briefing Scheduler] Time match at ${hour}:${minute.toString().padStart(2, "0")} MT — generating briefing`);
  try {
    const payload = await generateAndPersistBriefing();
    console.log(
      `[Briefing Scheduler] Generated briefing for ${payload.date}: ` +
      `OTDR ${payload.otdr.last7Days ?? "—"}% (${payload.otdr.sampleSize} orders), ` +
      `${payload.topCriticalComponents.length} critical components, ` +
      `${payload.draftPOs.count} draft POs, ` +
      `${payload.inHouseQueueCount} in-house queue, ` +
      `${payload.shopIssues24h.count} shop issues 24h`,
    );
  } catch (error: any) {
    console.error("[Briefing Scheduler] Generation error:", error);
  }
}

export function initializeBriefingScheduler(): void {
  if (schedulerInitialized) return;
  schedulerInitialized = true;
  console.log(`[Briefing Scheduler] Initializing for Mountain Time (${TIMEZONE})`);
  console.log(`[Briefing Scheduler] Scheduled run: ${SCHEDULED_HOUR}:00 MT daily (${RUN_KEY})`);
  checkIntervalId = setInterval(() => {
    checkAndRun().catch((err) => {
      console.error("[Briefing Scheduler] Interval error:", err);
    });
  }, 60 * 1000); // Check every minute
}

export function stopBriefingScheduler(): void {
  if (checkIntervalId) {
    clearInterval(checkIntervalId);
    checkIntervalId = null;
  }
  schedulerInitialized = false;
  lastRunDateKey = null;
}
