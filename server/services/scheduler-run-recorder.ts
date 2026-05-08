import { storage } from "../storage";
import { AuditLogger } from "./audit-logger";

export type SchedulerRunStatus = "success" | "failed" | "partial" | "skipped";

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
}
