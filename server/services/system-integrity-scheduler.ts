/**
 * System Integrity Scheduler — the continuous self-healing loop (Pillar 1).
 * Runs the cross-stream integrity sweep every 6 hours (and ~1 min after
 * startup), persisting the report and reporting to the Health monitor. A DRIFT
 * result is recorded as a failed run so it lights up Health as an alert.
 */
import { runSystemIntegrityCheck } from "./system-integrity-service";
import { recordSchedulerRun } from "./scheduler-run-recorder";

const INTERVAL_MS = 6 * 60 * 60 * 1000;
let initialized = false;
let lastRunAt: Date | null = null;

async function runOnce(): Promise<void> {
  const startedAt = new Date();
  try {
    const report = await runSystemIntegrityCheck();
    lastRunAt = new Date();
    const drifting = report.streams.filter((s) => s.status !== "OK");
    await recordSchedulerRun({
      schedulerId: "system-integrity",
      schedulerName: "System integrity sweep",
      // Completing the sweep is a SUCCESS even when it FINDS drift. Mapping
      // DRIFT→"failed" left last_success_at permanently NULL, pinned the
      // consecutive-failure counter, and would have masked a genuine future
      // crash (audit H5). DRIFT is surfaced via errorMessage on a successful run
      // + app_settings/data_reconciliation_log; "failed" is reserved for a
      // thrown exception (the catch block below).
      status: "success",
      startedAt,
      errorMessage:
        report.status === "DRIFT"
          ? `DRIFT: ${report.totalAnomalies} anomalies across ${drifting.length} stream(s): ${drifting.map((s) => s.stream).join(", ")}`
          : null,
      details: {
        status: report.status,
        totalAnomalies: report.totalAnomalies,
        streams: report.streams.map((s) => ({ stream: s.stream, status: s.status, anomalies: s.anomalies })),
      },
    }).catch((e) => console.warn("[System Integrity] record run failed:", e));
    console.log(`[System Integrity] Sweep complete: ${report.status} (${report.totalAnomalies} anomalies)`);
  } catch (error: any) {
    await recordSchedulerRun({
      schedulerId: "system-integrity",
      schedulerName: "System integrity sweep",
      status: "failed",
      startedAt,
      errorMessage: error?.message ?? String(error),
    }).catch(() => {});
    console.error("[System Integrity] Sweep failed:", error?.message ?? error);
  }
}

export function initializeSystemIntegrityScheduler(): void {
  if (initialized) {
    console.log("[System Integrity] Scheduler already initialized");
    return;
  }
  initialized = true;
  console.log("[System Integrity] Initializing — cross-stream sweep every 6h");
  setTimeout(() => {
    runOnce();
  }, 60_000); // first sweep ~1 min after startup
  setInterval(() => {
    runOnce();
  }, INTERVAL_MS);
}

export function getSystemIntegritySchedulerStatus(): {
  initialized: boolean;
  lastRunAt: Date | null;
  intervalHours: number;
} {
  return { initialized, lastRunAt, intervalHours: 6 };
}
