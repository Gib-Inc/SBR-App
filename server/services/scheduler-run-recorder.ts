import { storage } from "../storage";
import { AuditLogger } from "./audit-logger";

export type SchedulerRunStatus = "success" | "failed" | "partial" | "skipped";

const FAILURE_ALERT_THRESHOLD = 3;
function failureCountKey(schedulerId: string): string {
  return `scheduler_consecutive_failures:${schedulerId}`;
}

export interface SchedulerRunRecordInput {
  schedulerId: string;
  schedulerName: string;
  status: SchedulerRunStatus;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  errorMessage?: string | null;
  details?: Record<string, unknown>;
}

const STATUS_TO_AUDIT_STATUS: Record<SchedulerRunStatus, "INFO" | "WARNING" | "ERROR"> = {
  success: "INFO",
  skipped: "INFO",
  partial: "WARNING",
  failed: "ERROR",
};

export async function recordSchedulerRun(input: SchedulerRunRecordInput): Promise<void> {
  const finishedAt = input.finishedAt ?? new Date();
  const durationMs = input.durationMs ?? Math.max(0, finishedAt.getTime() - input.startedAt.getTime());
  const normalizedStatus = input.status.toLowerCase() as SchedulerRunStatus;
  const integrationName = `scheduler:${input.schedulerId}`;

  try {
    await storage.createOrUpdateIntegrationHealth({
      integrationName,
      lastSuccessAt: normalizedStatus === "success" || normalizedStatus === "partial" || normalizedStatus === "skipped" ? finishedAt : undefined,
      lastStatus: normalizedStatus,
      errorMessage: input.errorMessage ?? null,
    });
  } catch (error) {
    console.warn(`[SchedulerHealth] Failed to update health row for ${input.schedulerId}:`, error);
  }

  try {
    await AuditLogger.logEvent({
      source: "SYSTEM",
      eventType: normalizedStatus === "failed" ? "SCHEDULER_RUN_FAILED" : "SCHEDULER_RUN_COMPLETED",
      entityType: "SCHEDULER",
      entityId: input.schedulerId,
      entityLabel: input.schedulerName,
      status: STATUS_TO_AUDIT_STATUS[normalizedStatus],
      description: `${input.schedulerName} ${normalizedStatus}`,
      details: {
        schedulerId: input.schedulerId,
        status: normalizedStatus,
        startedAt: input.startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs,
        errorMessage: input.errorMessage ?? null,
        ...(input.details ?? {}),
      },
    });
  } catch (error) {
    console.warn(`[SchedulerHealth] Failed to write audit log for ${input.schedulerId}:`, error);
  }

  // Failure-counter management. Every recorded failure logs SCHEDULER_CRASH
  // to system_logs, increments a per-scheduler counter, and after 3
  // consecutive failures fires an ops alert. A success/partial/skipped run
  // resets the counter. This keeps the scheduler running while still
  // surfacing pile-up failures during unattended operation.
  try {
    if (normalizedStatus === "failed") {
      try {
        await storage.createSystemLog({
          type: "SCHEDULER",
          entityType: "INTEGRATION",
          entityId: input.schedulerId,
          severity: "ERROR",
          code: "SCHEDULER_CRASH",
          message: `${input.schedulerName} run failed: ${input.errorMessage ?? "unknown error"}`,
          details: {
            schedulerId: input.schedulerId,
            schedulerName: input.schedulerName,
            errorMessage: input.errorMessage ?? null,
            durationMs,
            startedAt: input.startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
          },
        });
      } catch (logError) {
        console.warn(`[SchedulerHealth] Failed to write system_log for ${input.schedulerId}:`, logError);
      }

      const prevRaw = await storage.getAppSetting(failureCountKey(input.schedulerId));
      const prev = prevRaw ? parseInt(prevRaw, 10) : 0;
      const next = (Number.isFinite(prev) ? prev : 0) + 1;
      await storage.setAppSetting(failureCountKey(input.schedulerId), String(next));

      if (next >= FAILURE_ALERT_THRESHOLD) {
        try {
          const { sendSchedulerCrashAlert } = await import("./system-health-service");
          await sendSchedulerCrashAlert(
            input.schedulerId,
            input.schedulerName,
            input.errorMessage ?? "unknown error",
            next,
          );
        } catch (alertError: any) {
          console.warn(
            `[SchedulerHealth] Failed to send crash alert for ${input.schedulerId}:`,
            alertError?.message ?? alertError,
          );
        }
      }
    } else {
      const prevRaw = await storage.getAppSetting(failureCountKey(input.schedulerId));
      const prev = prevRaw ? parseInt(prevRaw, 10) : 0;
      if (Number.isFinite(prev) && prev > 0) {
        await storage.setAppSetting(failureCountKey(input.schedulerId), "0");
      }
    }
  } catch (counterError: any) {
    console.warn(
      `[SchedulerHealth] Failure-counter management failed for ${input.schedulerId}:`,
      counterError?.message ?? counterError,
    );
  }
}
