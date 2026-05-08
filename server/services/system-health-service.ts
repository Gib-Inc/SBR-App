import { storage } from "../storage";
import type { AuditLog, IntegrationHealth } from "@shared/schema";

type HealthState = "healthy" | "warning" | "critical" | "unknown";

const PER_SCHEDULER_ALERT_DEDUPE_HOURS = 24;
const OPS_ALERT_LAST_FIRED_KEY = "ops_alert_last_fired_at";
const DEFAULT_ALERT_EMAIL = "stickerburrroller@gmail.com";

function alertDedupeKey(schedulerId: string): string {
  return `ops_alert_last_fired:scheduler:${schedulerId}`;
}

function getAlertEmailRecipient(): string {
  return (
    process.env.SBR_OPS_ALERT_EMAIL ||
    process.env.SYSTEM_HEALTH_ALERT_EMAIL ||
    process.env.ALERT_ADMIN_EMAIL ||
    DEFAULT_ALERT_EMAIL
  );
}

// Comma-separated list support: SBR_OPS_ALERT_EMAIL can hold one or
// many addresses ("a@x.com,b@y.com,c@z.com"). SendGrid's `to` field
// accepts either a string or an array, so we always normalize to an
// array and pass that — works the same for one recipient or four.
function getAlertEmailRecipients(): string[] {
  return getAlertEmailRecipient()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getSlackWebhook(): string | null {
  return (
    process.env.SLACK_WEBHOOK_URL ||
    process.env.SYSTEM_HEALTH_SLACK_WEBHOOK_URL ||
    null
  );
}

function getHealthPageLink(): string {
  const base =
    process.env.APP_BASE_URL ||
    "https://sbr-app-production-f1c4.up.railway.app";
  return `${base.replace(/\/$/, "")}/health`;
}

export interface RecentRun {
  at: string;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
}

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
  lastAlertAt: string | null;
  recentRuns: RecentRun[];
  consecutiveFailures: number;
}

export interface SystemHealthSummary {
  generatedAt: string;
  overallStatus: HealthState;
  counts: Record<HealthState, number>;
  schedulers: SchedulerHealthCheck[];
  errorsLast24h: number;
  lastOpsAlertAt: string | null;
  alerts: {
    stale: SchedulerHealthCheck[];
    configured: {
      slack: boolean;
      email: boolean;
    };
    recipient: string;
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

function buildRecentRuns(logs: AuditLog[], schedulerId: string, limit = 5): RecentRun[] {
  const runs: RecentRun[] = [];
  for (const log of logs) {
    if (log.entityType !== "SCHEDULER" || log.entityId !== schedulerId) continue;
    if (log.eventType !== "SCHEDULER_RUN_COMPLETED" && log.eventType !== "SCHEDULER_RUN_FAILED") continue;
    const details = (log.details as any) ?? {};
    runs.push({
      at: toIso(log.timestamp) ?? "",
      status: typeof details.status === "string" ? details.status : (log.status?.toLowerCase() ?? "unknown"),
      durationMs: typeof details.durationMs === "number" ? details.durationMs : null,
      errorMessage: typeof details.errorMessage === "string"
        ? details.errorMessage
        : log.status === "ERROR" ? log.description : null,
    });
    if (runs.length >= limit) break;
  }
  return runs;
}

function countErrorsLast24h(logs: AuditLog[], now: Date): number {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  return logs.filter((log) => {
    if (log.entityType !== "SCHEDULER") return false;
    if (log.status !== "ERROR") return false;
    const ts = asDate(log.timestamp);
    return ts ? ts.getTime() > cutoff : false;
  }).length;
}

export async function getSystemHealthSummary(): Promise<SystemHealthSummary> {
  const now = new Date();
  const [healthRows, auditResult, runtimeStatuses, extensiv, lastOpsAlertAt] = await Promise.all([
    storage.getAllIntegrationHealth(),
    storage.getAuditLogs({ entityType: "SCHEDULER", limit: 500 }),
    getRuntimeStatuses(),
    getExtensivLastSync(),
    storage.getAppSetting(OPS_ALERT_LAST_FIRED_KEY),
  ]);

  const healthByName = new Map<string, IntegrationHealth>(
    healthRows.map((row) => [row.integrationName, row]),
  );

  const perSchedulerLastAlerts = await Promise.all(
    SCHEDULERS.map(async (def) => [def.id, await storage.getAppSetting(alertDedupeKey(def.id))] as const),
  );
  const lastAlertById = new Map(perSchedulerLastAlerts);

  const perSchedulerFailures = await Promise.all(
    SCHEDULERS.map(async (def) => {
      const raw = await storage.getAppSetting(`scheduler_consecutive_failures:${def.id}`);
      const n = raw ? parseInt(raw, 10) : 0;
      return [def.id, Number.isFinite(n) ? n : 0] as const;
    }),
  );
  const failuresById = new Map(perSchedulerFailures);

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
      lastAlertAt: lastAlertById.get(definition.id) ?? null,
      recentRuns: buildRecentRuns(auditResult.logs, definition.id),
      consecutiveFailures: failuresById.get(definition.id) ?? 0,
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
    errorsLast24h: countErrorsLast24h(auditResult.logs, now),
    lastOpsAlertAt: lastOpsAlertAt ?? null,
    alerts: {
      stale: schedulers.filter((scheduler) => scheduler.status === "critical"),
      configured: {
        slack: Boolean(getSlackWebhook()),
        email: Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
      },
      recipient: getAlertEmailRecipient(),
    },
  };
}

export interface OpsAlertOptions {
  subject: string;
  lines: string[];
  reason: "stale-scheduler" | "scheduler-crash" | "test";
}

export interface OpsAlertResult {
  channels: string[];
  errors: string[];
  recipient: string;
}

export async function sendOpsAlert(opts: OpsAlertOptions): Promise<OpsAlertResult> {
  const channels: string[] = [];
  const errors: string[] = [];
  const recipient = getAlertEmailRecipient();
  const recipients = getAlertEmailRecipients();
  const link = getHealthPageLink();
  const body = [...opts.lines, "", `Health page: ${link}`].join("\n");

  const webhook = getSlackWebhook();
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${opts.subject}*\n${body}` }),
      });
      if (res.ok) channels.push("slack");
      else errors.push(`slack returned ${res.status}`);
    } catch (error: any) {
      errors.push(`slack: ${error?.message ?? error}`);
    }
  }

  const from = process.env.SENDGRID_FROM_EMAIL;
  const apiKey = process.env.SENDGRID_API_KEY;
  if (recipients.length > 0 && from && apiKey) {
    try {
      const sgMail = await import("@sendgrid/mail");
      sgMail.default.setApiKey(apiKey);
      await sgMail.default.send({
        to: recipients,
        from,
        subject: opts.subject,
        text: body,
      });
      channels.push("email");
    } catch (error: any) {
      errors.push(`email: ${error?.message ?? error}`);
    }
  }

  if (channels.length > 0) {
    try {
      await storage.setAppSetting(OPS_ALERT_LAST_FIRED_KEY, new Date().toISOString());
    } catch (error) {
      console.warn("[SystemHealth] Failed to record ops alert timestamp:", error);
    }
  }

  return { channels, errors, recipient };
}

export async function sendSchedulerCrashAlert(
  schedulerId: string,
  schedulerName: string,
  errorMessage: string,
  consecutiveFailures: number,
): Promise<OpsAlertResult> {
  return sendOpsAlert({
    subject: `SBR scheduler crash — ${schedulerName}`,
    reason: "scheduler-crash",
    lines: [
      `Scheduler: ${schedulerName} (${schedulerId})`,
      `Consecutive failures: ${consecutiveFailures}`,
      `Latest error: ${errorMessage}`,
      ``,
      `The scheduler is still running but has crashed ${consecutiveFailures} times in a row.`,
      `Investigate before more silent failures pile up.`,
    ],
  });
}

export async function sendTestAlert(): Promise<OpsAlertResult> {
  return sendOpsAlert({
    subject: "SBR ops alert — test",
    reason: "test",
    lines: [
      `This is a test alert fired manually from /health.`,
      `If you're reading this, your alert pipeline is wired up correctly.`,
      `Time: ${new Date().toISOString()}`,
    ],
  });
}

export async function checkSystemHealthAndAlert(): Promise<{
  summary: SystemHealthSummary;
  alertSent: boolean;
  alerted: string[];
  skipped: string[];
  channels: string[];
}> {
  const summary = await getSystemHealthSummary();
  const stale = summary.alerts.stale.filter((scheduler) => {
    const definition = SCHEDULERS.find((entry) => entry.id === scheduler.id);
    return definition?.alertOnStale;
  });

  if (stale.length === 0) {
    return { summary, alertSent: false, alerted: [], skipped: [], channels: [] };
  }

  const dedupeMs = PER_SCHEDULER_ALERT_DEDUPE_HOURS * 60 * 60 * 1000;
  const now = Date.now();
  const toAlert: SchedulerHealthCheck[] = [];
  const skipped: string[] = [];

  for (const scheduler of stale) {
    const last = await storage.getAppSetting(alertDedupeKey(scheduler.id));
    const lastMs = last ? Date.parse(last) : NaN;
    if (Number.isFinite(lastMs) && now - lastMs < dedupeMs) {
      skipped.push(scheduler.id);
      continue;
    }
    toAlert.push(scheduler);
  }

  if (toAlert.length === 0) {
    return { summary, alertSent: false, alerted: [], skipped, channels: [] };
  }

  const lines = [
    `${toAlert.length} stale scheduler(s) detected on SBR App:`,
    ``,
    ...toAlert.flatMap((scheduler) => [
      `• ${scheduler.name} (${scheduler.id})`,
      `   Last success:      ${scheduler.lastSuccessAt ?? "never"}`,
      `   Expected interval: every ${scheduler.expectedIntervalMinutes} min`,
      `   Stale after:       ${scheduler.staleAfterMinutes} min`,
      `   Age:               ${scheduler.ageMinutes ?? "unknown"} min`,
      scheduler.errorMessage ? `   Last error:        ${scheduler.errorMessage}` : ``,
      ``,
    ]).filter((line) => line !== ""),
  ];

  const result = await sendOpsAlert({
    subject: `SBR scheduler health alert — ${toAlert.length} stale`,
    reason: "stale-scheduler",
    lines,
  });

  if (result.channels.length > 0) {
    const stamp = new Date().toISOString();
    await Promise.all(
      toAlert.map((scheduler) =>
        storage
          .setAppSetting(alertDedupeKey(scheduler.id), stamp)
          .catch((error) => console.warn(`[SystemHealth] Failed to record dedupe stamp for ${scheduler.id}:`, error)),
      ),
    );
  }

  return {
    summary,
    alertSent: result.channels.length > 0,
    alerted: toAlert.map((s) => s.id),
    skipped,
    channels: result.channels,
  };
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
