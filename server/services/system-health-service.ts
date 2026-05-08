import { storage } from "../storage";
import type { AuditLog, IntegrationHealth } from "@shared/schema";

type HealthState = "healthy" | "warning" | "critical" | "unknown";

interface SchedulerDefinition {
  id: string;
  name: string;
  owner: string;
  kind: "railway-cron" | "in-process" | "external-sync";
  cadence: string;
  expectedIntervalMinutes: number;
  staleAfterMinutes: number;
  sourceOfTruth: string;
  alertOnStale: boolean;
}

export interface SchedulerHealthCheck {
  id: string;
  name: string;
  owner: string;
  kind: SchedulerDefinition["kind"];
  cadence: string;
  expectedIntervalMinutes: number;
  staleAfterMinutes: number;
  sourceOfTruth: string;
  status: HealthState;
  initialized: boolean | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  ageMinutes: number | null;
  driftMinutes: number | null;
  lastStatus: string | null;
  errorMessage: string | null;
  notes: string[];
}

export interface SystemHealthSummary {
  generatedAt: string;
  overallStatus: HealthState;
  counts: Record<HealthState, number>;
  schedulers: SchedulerHealthCheck[];
  alerts: {
    stale: SchedulerHealthCheck[];
    configured: {
      slack: boolean;
      email: boolean;
    };
  };
}

const SCHEDULERS: SchedulerDefinition[] = [
  {
    id: "extensiv-cron",
    name: "Extensiv inventory sync",
    owner: "Railway sweet-hope",
    kind: "railway-cron",
    cadence: "Every 4 hours at :05 UTC",
    expectedIntervalMinutes: 4 * 60,
    staleAfterMinutes: 8 * 60,
    sourceOfTruth: "items.extensiv_last_sync_at on Extensiv-mapped items",
    alertOnStale: true,
  },
  {
    id: "quickbooks-token-refresh",
    name: "QuickBooks token refresh",
    owner: "SBR-App process",
    kind: "in-process",
    cadence: "Every 45 minutes",
    expectedIntervalMinutes: 45,
    staleAfterMinutes: 90,
    sourceOfTruth: "scheduler:quickbooks-token-refresh health row + audit logs",
    alertOnStale: true,
  },
  {
    id: "daily-briefing",
    name: "Daily briefing",
    owner: "SBR-App process",
    kind: "in-process",
    cadence: "Daily at 7:00 AM MT",
    expectedIntervalMinutes: 24 * 60,
    staleAfterMinutes: 48 * 60,
    sourceOfTruth: "scheduler:daily-briefing health row + audit logs",
    alertOnStale: true,
  },
  {
    id: "ai-batch",
    name: "AI inventory batch",
    owner: "SBR-App process",
    kind: "in-process",
    cadence: "Daily at 10:00 AM and 3:00 PM MT",
    expectedIntervalMinutes: 12 * 60,
    staleAfterMinutes: 24 * 60,
    sourceOfTruth: "scheduler:ai-batch health row + audit logs",
    alertOnStale: true,
  },
  {
    id: "credential-rotation",
    name: "Credential rotation reminders",
    owner: "SBR-App process",
    kind: "in-process",
    cadence: "Daily at 6:00 AM MT",
    expectedIntervalMinutes: 24 * 60,
    staleAfterMinutes: 48 * 60,
    sourceOfTruth: "scheduler:credential-rotation health row + audit logs",
    alertOnStale: true,
  },
  {
    id: "shopify-reconciliation",
    name: "Shopify reconciliation",
    owner: "SBR-App process",
    kind: "in-process",
    cadence: "Tuesday and Thursday at 9:00 AM MT",
    expectedIntervalMinutes: 4 * 24 * 60,
    staleAfterMinutes: 8 * 24 * 60,
    sourceOfTruth: "scheduler:shopify-reconciliation health row + audit logs",
    alertOnStale: true,
  },
  {
    id: "daily-sales",
    name: "Daily sales aggregation",
    owner: "SBR-App process",
    kind: "in-process",
    cadence: "Daily at 11:59 PM MT",
    expectedIntervalMinutes: 24 * 60,
    staleAfterMinutes: 48 * 60,
    sourceOfTruth: "daily_sales_snapshots + scheduler:daily-sales health row",
    alertOnStale: true,
  },
  {
    id: "reorder-watcher",
    name: "Auto reorder watcher",
    owner: "SBR-App process",
    kind: "in-process",
    cadence: "Hourly",
    expectedIntervalMinutes: 60,
    staleAfterMinutes: 120,
    sourceOfTruth: "scheduler:reorder-watcher health row + audit logs",
    alertOnStale: true,
  },
];

let monitorInitialized = false;
let monitorInterval: NodeJS.Timeout | null = null;

function minutesBetween(now: Date, then: Date | null): number | null {
  if (!then) return null;
  return Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value: Date | string | null | undefined): string | null {
  const date = asDate(value);
  return date ? date.toISOString() : null;
}

function latestDate(...dates: Array<Date | null>): Date | null {
  return dates.filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
}

function classifyAge(ageMinutes: number | null, definition: SchedulerDefinition): HealthState {
  if (ageMinutes === null) return "unknown";
  if (ageMinutes > definition.staleAfterMinutes) return "critical";
  if (ageMinutes > definition.expectedIntervalMinutes) return "warning";
  return "healthy";
}

async function getRuntimeStatuses(): Promise<Record<string, { initialized: boolean | null; nextRunAt: string | null; notes: string[] }>> {
  const statuses: Record<string, { initialized: boolean | null; nextRunAt: string | null; notes: string[] }> = {};

  try {
    const qb = await import("./quickbooks-token-refresh-scheduler");
    const status = qb.getQuickBooksTokenRefreshStatus();
    statuses["quickbooks-token-refresh"] = {
      initialized: status.initialized,
      nextRunAt: null,
      notes: [`Interval: ${status.refreshIntervalMinutes} minutes`, `Last runtime status: ${status.lastRefreshStatus ?? "none"}`],
    };
  } catch (error: any) {
    statuses["quickbooks-token-refresh"] = { initialized: null, nextRunAt: null, notes: [`Runtime status unavailable: ${error.message}`] };
  }

  try {
    const ai = await import("./ai-batch-scheduler");
    const status = ai.getSchedulerStatus();
    statuses["ai-batch"] = {
      initialized: status.initialized,
      nextRunAt: status.nextRun?.time ? status.nextRun.time.toISOString() : null,
      notes: status.scheduledTimes,
    };
  } catch (error: any) {
    statuses["ai-batch"] = { initialized: null, nextRunAt: null, notes: [`Runtime status unavailable: ${error.message}`] };
  }

  try {
    const rotation = await import("./credential-rotation-scheduler");
    const status = rotation.getRotationSchedulerStatus();
    statuses["credential-rotation"] = {
      initialized: status.initialized,
      nextRunAt: status.nextRun ? status.nextRun.toISOString() : null,
      notes: [`Rotation window: ${status.rotationWindowDays} days`, `Timezone: ${status.timezone}`],
    };
  } catch (error: any) {
    statuses["credential-rotation"] = { initialized: null, nextRunAt: null, notes: [`Runtime status unavailable: ${error.message}`] };
  }

  try {
    const reconciliation = await import("./shopify-reconciliation-scheduler");
    const status = reconciliation.getReconciliationSchedulerStatus();
    statuses["shopify-reconciliation"] = {
      initialized: status.initialized,
      nextRunAt: status.nextRun?.time ?? null,
      notes: [`Running now: ${status.isRunning ? "yes" : "no"}`, status.nextRun ? `Next day: ${status.nextRun.day}` : "No next run scheduled"],
    };
  } catch (error: any) {
    statuses["shopify-reconciliation"] = { initialized: null, nextRunAt: null, notes: [`Runtime status unavailable: ${error.message}`] };
  }

  try {
    const dailySales = await import("./daily-sales-scheduler");
    const nextRun = dailySales.getNextScheduledRun();
    statuses["daily-sales"] = {
      initialized: nextRun !== null,
      nextRunAt: nextRun ? nextRun.toISOString() : null,
      notes: ["Runs from the SBR-App process"],
    };
  } catch (error: any) {
    statuses["daily-sales"] = { initialized: null, nextRunAt: null, notes: [`Runtime status unavailable: ${error.message}`] };
  }

  try {
    const reorderWatcher = await import("./reorder-watcher");
    const status = reorderWatcher.getReorderWatcherStatus();
    const paused = await reorderWatcher.getReorderAutoSendPaused();
    statuses["reorder-watcher"] = {
      initialized: status.initialized,
      nextRunAt: status.nextRunAt ? status.nextRunAt.toISOString() : null,
      notes: [
        `Auto-send paused: ${paused ? "yes" : "no"}`,
        `Last runtime status: ${status.lastRunStatus ?? "none"}`,
      ],
    };
  } catch (error: any) {
    statuses["reorder-watcher"] = { initialized: null, nextRunAt: null, notes: [`Runtime status unavailable: ${error.message}`] };
  }

  return statuses;
}

async function getExtensivLastSync(): Promise<{ lastSuccessAt: Date | null; mappedCount: number; justSyncedCount: number }> {
  const items = await storage.getAllItems();
  const mapped = items.filter((item) => item.extensivSku || item.extensivLastSyncAt);
  const lastSuccessAt = mapped.reduce<Date | null>((latest, item) => {
    const syncAt = asDate(item.extensivLastSyncAt);
    if (!syncAt) return latest;
    return !latest || syncAt > latest ? syncAt : latest;
  }, null);
  const now = Date.now();
  const justSyncedCount = mapped.filter((item) => {
    const syncAt = asDate(item.extensivLastSyncAt);
    return syncAt ? now - syncAt.getTime() <= 5 * 60 * 1000 : false;
  }).length;

  return { lastSuccessAt, mappedCount: mapped.length, justSyncedCount };
}

function latestAuditForScheduler(logs: AuditLog[], schedulerId: string, successOnly = false): AuditLog | null {
  const candidates = logs.filter((log) => {
    if (log.entityType !== "SCHEDULER" || log.entityId !== schedulerId) return false;
    if (!successOnly) return true;
    return log.eventType === "SCHEDULER_RUN_COMPLETED" && log.status !== "ERROR";
  });
  return candidates[0] ?? null;
}

export async function getSystemHealthSummary(): Promise<SystemHealthSummary> {
  const now = new Date();
  const [healthRows, auditResult, runtimeStatuses, extensiv] = await Promise.all([
    storage.getAllIntegrationHealth(),
    storage.getAuditLogs({ entityType: "SCHEDULER", limit: 500 }),
    getRuntimeStatuses(),
    getExtensivLastSync(),
  ]);

  const healthByName = new Map<string, IntegrationHealth>(
    healthRows.map((row) => [row.integrationName, row]),
  );

  const schedulers = SCHEDULERS.map((definition): SchedulerHealthCheck => {
    const runtime = runtimeStatuses[definition.id] ?? { initialized: null, nextRunAt: null, notes: [] };
    const health = healthByName.get(`scheduler:${definition.id}`);
    const lastAudit = latestAuditForScheduler(auditResult.logs, definition.id);
    const lastSuccessAudit = latestAuditForScheduler(auditResult.logs, definition.id, true);

    let lastRunAt = asDate(lastAudit?.timestamp);
    let lastSuccessAt = latestDate(asDate(health?.lastSuccessAt), asDate(lastSuccessAudit?.timestamp));
    const notes = [...runtime.notes];

    if (definition.id === "extensiv-cron") {
      lastSuccessAt = latestDate(lastSuccessAt, extensiv.lastSuccessAt);
      notes.push(`${extensiv.mappedCount} Extensiv-mapped item(s), ${extensiv.justSyncedCount} synced in the last 5 minutes`);
    }

    if (!lastRunAt && health?.lastStatus) {
      lastRunAt = asDate(health.lastSuccessAt);
    }

    const ageMinutes = minutesBetween(now, lastSuccessAt);
    const status = classifyAge(ageMinutes, definition);
    const lastStatus = health?.lastStatus ?? lastAudit?.status ?? null;

    return {
      id: definition.id,
      name: definition.name,
      owner: definition.owner,
      kind: definition.kind,
      cadence: definition.cadence,
      expectedIntervalMinutes: definition.expectedIntervalMinutes,
      staleAfterMinutes: definition.staleAfterMinutes,
      sourceOfTruth: definition.sourceOfTruth,
      status,
      initialized: runtime.initialized,
      lastRunAt: toIso(lastRunAt),
      lastSuccessAt: toIso(lastSuccessAt),
      nextRunAt: runtime.nextRunAt,
      ageMinutes,
      driftMinutes: ageMinutes === null ? null : Math.max(0, ageMinutes - definition.expectedIntervalMinutes),
      lastStatus,
      errorMessage: health?.errorMessage ?? (lastAudit?.status === "ERROR" ? lastAudit.description : null),
      notes,
    };
  });

  const counts = schedulers.reduce<Record<HealthState, number>>(
    (acc, scheduler) => {
      acc[scheduler.status]++;
      return acc;
    },
    { healthy: 0, warning: 0, critical: 0, unknown: 0 },
  );
  const overallStatus: HealthState =
    counts.critical > 0 ? "critical" :
    counts.warning > 0 ? "warning" :
    counts.unknown > 0 ? "unknown" :
    "healthy";

  return {
    generatedAt: now.toISOString(),
    overallStatus,
    counts,
    schedulers,
    alerts: {
      stale: schedulers.filter((scheduler) => scheduler.status === "critical"),
      configured: {
        slack: Boolean(process.env.SYSTEM_HEALTH_SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL),
        email: Boolean((process.env.SYSTEM_HEALTH_ALERT_EMAIL || process.env.ALERT_ADMIN_EMAIL) && process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
      },
    },
  };
}

async function sendSlackAlert(stale: SchedulerHealthCheck[]): Promise<boolean> {
  const webhookUrl = process.env.SYSTEM_HEALTH_SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return false;

  const text = [
    `SBR scheduler health alert: ${stale.length} stale scheduler(s)`,
    ...stale.map((scheduler) => `- ${scheduler.name}: last success ${scheduler.lastSuccessAt ?? "never"} (${scheduler.ageMinutes ?? "unknown"} min old)`),
  ].join("\n");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return res.ok;
}

async function sendEmailAlert(stale: SchedulerHealthCheck[]): Promise<boolean> {
  const to = process.env.SYSTEM_HEALTH_ALERT_EMAIL || process.env.ALERT_ADMIN_EMAIL;
  const from = process.env.SENDGRID_FROM_EMAIL;
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!to || !from || !apiKey) return false;

  const sgMail = await import("@sendgrid/mail");
  sgMail.default.setApiKey(apiKey);
  await sgMail.default.send({
    to,
    from,
    subject: `SBR scheduler health alert: ${stale.length} stale`,
    text: [
      "One or more SBR schedulers are stale.",
      "",
      ...stale.map((scheduler) => [
        scheduler.name,
        `Last success: ${scheduler.lastSuccessAt ?? "never"}`,
        `Expected interval: ${scheduler.expectedIntervalMinutes} minutes`,
        `Stale after: ${scheduler.staleAfterMinutes} minutes`,
        scheduler.errorMessage ? `Error: ${scheduler.errorMessage}` : null,
      ].filter(Boolean).join("\n")),
    ].join("\n\n"),
  });
  return true;
}

export async function checkSystemHealthAndAlert(): Promise<{
  summary: SystemHealthSummary;
  alertSent: boolean;
  channels: string[];
}> {
  const summary = await getSystemHealthSummary();
  const stale = summary.alerts.stale.filter((scheduler) => {
    const definition = SCHEDULERS.find((entry) => entry.id === scheduler.id);
    return definition?.alertOnStale;
  });

  if (stale.length === 0) {
    return { summary, alertSent: false, channels: [] };
  }

  const alertKey = "scheduler-alerts";
  const alertRow = await storage.getIntegrationHealth(alertKey);
  const lastAlertAt = asDate(alertRow?.lastAlertAt);
  if (lastAlertAt && Date.now() - lastAlertAt.getTime() < 60 * 60 * 1000) {
    return { summary, alertSent: false, channels: [] };
  }

  const channels: string[] = [];
  try {
    if (await sendSlackAlert(stale)) channels.push("slack");
  } catch (error) {
    console.error("[SystemHealth] Slack alert failed:", error);
  }

  try {
    if (await sendEmailAlert(stale)) channels.push("email");
  } catch (error) {
    console.error("[SystemHealth] Email alert failed:", error);
  }

  if (channels.length > 0) {
    await storage.createOrUpdateIntegrationHealth({
      integrationName: alertKey,
      lastStatus: "sent",
      lastAlertAt: new Date(),
      errorMessage: null,
    });
  }

  return { summary, alertSent: channels.length > 0, channels };
}

export function initializeSystemHealthMonitor(): void {
  if (monitorInitialized) return;
  monitorInitialized = true;
  console.log("[SystemHealth] Scheduler stale monitor initialized (hourly)");

  monitorInterval = setInterval(() => {
    checkSystemHealthAndAlert().catch((error) => {
      console.error("[SystemHealth] Scheduled health alert check failed:", error);
    });
  }, 60 * 60 * 1000);
}

export function stopSystemHealthMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  monitorInitialized = false;
}
