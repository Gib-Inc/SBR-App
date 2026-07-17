import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type HealthState = "healthy" | "warning" | "critical" | "unknown";

interface RecentRun {
  at: string;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
}

interface SchedulerHealthCheck {
  id: string;
  name: string;
  owner: string;
  kind: string;
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

interface SystemHealthSummary {
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

type TruthCheckStatus = "PASS" | "WARN" | "FAIL";

interface TruthCheck {
  id: string;
  name: string;
  status: TruthCheckStatus;
  summary: string;
  error?: string;
}

interface TruthReport {
  id?: string;
  runAt: string;
  overall: TruthCheckStatus;
  checks: TruthCheck[];
}

const statusLabels: Record<HealthState, string> = {
  healthy: "Healthy",
  warning: "Late",
  critical: "Stale",
  unknown: "Unknown",
};

function truthVariant(status: TruthCheckStatus): "default" | "secondary" | "destructive" {
  if (status === "FAIL") return "destructive";
  if (status === "WARN") return "secondary";
  return "default";
}

function statusIcon(status: HealthState) {
  if (status === "healthy") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  if (status === "critical") return <XCircle className="h-4 w-4 text-red-600" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function statusVariant(status: HealthState): "default" | "secondary" | "destructive" | "outline" {
  if (status === "critical") return "destructive";
  if (status === "warning") return "secondary";
  if (status === "healthy") return "default";
  return "outline";
}

function runDotClass(runStatus: string): string {
  const s = runStatus.toLowerCase();
  if (s === "success") return "bg-emerald-500";
  if (s === "partial") return "bg-amber-500";
  if (s === "skipped") return "bg-muted-foreground/40";
  if (s === "failed") return "bg-red-500";
  return "bg-muted-foreground/40";
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAge(minutes: number | null): string {
  if (minutes === null) return "Unknown";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 48) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000 / 60)}m`;
}

function bannerCopy(summary: SystemHealthSummary | undefined): {
  message: string;
  tone: "ok" | "warn" | "bad";
} {
  if (!summary) return { message: "Loading…", tone: "ok" };
  const stale = summary.counts.critical;
  const errors = summary.errorsLast24h;
  if (stale > 0 && errors > 0) {
    return {
      message: `${stale} scheduler${stale === 1 ? "" : "s"} stale · ${errors} error${errors === 1 ? "" : "s"} in last 24h`,
      tone: "bad",
    };
  }
  if (stale > 0) {
    return {
      message: `${stale} scheduler${stale === 1 ? "" : "s"} stale`,
      tone: "bad",
    };
  }
  if (errors > 0) {
    return {
      message: `All schedulers healthy · ${errors} error${errors === 1 ? "" : "s"} in last 24h`,
      tone: "warn",
    };
  }
  if (summary.counts.warning > 0) {
    return {
      message: `${summary.counts.warning} scheduler${summary.counts.warning === 1 ? "" : "s"} running late`,
      tone: "warn",
    };
  }
  return { message: "All systems healthy", tone: "ok" };
}

export default function Health() {
  const { toast } = useToast();
  const { data, isLoading, error, refetch, isFetching } = useQuery<SystemHealthSummary>({
    queryKey: ["/api/system-health"],
    refetchInterval: 60_000,
  });

  const { data: truthData } = useQuery<{ report: TruthReport | null }>({
    queryKey: ["/api/system-integrity/truth-report"],
    refetchInterval: 60_000,
  });
  const truthReport = truthData?.report ?? null;

  const alertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/system-health/check-alerts");
      return await res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-health"] });
      toast({
        title: result.alertSent ? "Alert sent" : "No alert sent",
        description: result.channels?.length
          ? `Sent via ${result.channels.join(", ")}`
          : "No stale scheduler needed a new alert (or all are within the 24h dedupe window).",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Health alert check failed", description: err.message, variant: "destructive" });
    },
  });

  const testAlertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/system-health/test-alert");
      return await res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-health"] });
      const channels = result.channels?.length ? result.channels.join(", ") : "no channels";
      toast({
        title: result.sent ? "Test alert sent" : "Test alert NOT sent",
        description: result.sent
          ? `Sent via ${channels} to ${result.recipient}.`
          : `Nothing fired — check that SLACK_WEBHOOK_URL and/or SendGrid credentials are configured. Errors: ${(result.errors ?? []).join("; ") || "none"}`,
        variant: result.sent ? "default" : "destructive",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Test alert failed", description: err.message, variant: "destructive" });
    },
  });

  const sortedSchedulers = useMemo(() => {
    const order: Record<HealthState, number> = { critical: 0, warning: 1, unknown: 2, healthy: 3 };
    return [...(data?.schedulers ?? [])].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  }, [data]);

  const banner = bannerCopy(data);
  const bannerClass =
    banner.tone === "bad"
      ? "border-red-200 bg-red-50 text-red-900"
      : banner.tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-emerald-200 bg-emerald-50 text-emerald-900";

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-9 w-48" />
        <div className="grid gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((idx) => <Skeleton key={idx} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-destructive">
            {(error as Error).message}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">System Health</h1>
          <p className="text-sm text-muted-foreground">
            Updated {formatTimestamp(data?.generatedAt ?? null)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => alertMutation.mutate()} disabled={alertMutation.isPending}>
            <Bell className="mr-2 h-4 w-4" />
            Check Alerts
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => testAlertMutation.mutate()}
            disabled={testAlertMutation.isPending}
            data-testid="test-alert-button"
          >
            <Send className="mr-2 h-4 w-4" />
            Test Alert
          </Button>
        </div>
      </div>

      <div className={`flex items-center justify-between gap-4 rounded-md border p-4 text-sm ${bannerClass}`}>
        <div className="flex items-center gap-2">
          {banner.tone === "ok" ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : banner.tone === "warn" ? (
            <AlertTriangle className="h-5 w-5" />
          ) : (
            <XCircle className="h-5 w-5" />
          )}
          <span className="font-medium">{banner.message}</span>
        </div>
        <div className="text-xs opacity-80">
          Last alert fired:{" "}
          <span className="font-medium">{formatTimestamp(data?.lastOpsAlertAt ?? null)}</span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {(["critical", "warning", "unknown", "healthy"] as HealthState[]).map((state) => (
          <Card key={state}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="text-sm text-muted-foreground">{statusLabels[state]}</div>
                <div className="text-2xl font-semibold">{data?.counts[state] ?? 0}</div>
              </div>
              {statusIcon(state)}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Truth Report</CardTitle>
            <p className="text-xs text-muted-foreground">
              Daily read-only V-suite: order twins, spend overlaps, ledger dedup, shipment quantities, feed freshness.
            </p>
          </div>
          {truthReport && (
            <div className="text-right">
              <Badge variant={truthVariant(truthReport.overall)}>{truthReport.overall}</Badge>
              <div className="mt-1 text-xs text-muted-foreground">{formatTimestamp(truthReport.runAt)}</div>
            </div>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {!truthReport ? (
            <div className="text-sm text-muted-foreground">
              No truth report yet — the first run lands at 7:00 AM MT (or on the next deploy via startup self-heal).
            </div>
          ) : (
            <div className="divide-y">
              {truthReport.checks.map((check) => (
                <div key={check.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      <span className="text-muted-foreground">{check.id}</span> · {check.name}
                    </div>
                    <div className="text-xs text-muted-foreground" title={check.summary}>
                      {check.summary}
                    </div>
                    {check.error && (
                      <div className="text-xs text-destructive truncate" title={check.error}>
                        {check.error}
                      </div>
                    )}
                  </div>
                  <Badge variant={truthVariant(check.status)} className="shrink-0">
                    {check.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scheduler</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Success</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Recent Runs</TableHead>
              <TableHead>Last Alert</TableHead>
              <TableHead>Cadence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedSchedulers.map((scheduler) => (
              <TableRow key={scheduler.id}>
                <TableCell className="min-w-[220px]">
                  <div className="font-medium">{scheduler.name}</div>
                  <div className="text-xs text-muted-foreground">{scheduler.owner}</div>
                  {scheduler.initialized === false && (
                    <div className="mt-1 text-xs text-destructive">Not initialized in this process</div>
                  )}
                  {scheduler.consecutiveFailures > 0 && (
                    <div className="mt-1 text-xs text-amber-700">
                      {scheduler.consecutiveFailures} consecutive failure{scheduler.consecutiveFailures === 1 ? "" : "s"}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(scheduler.status)} className="gap-1">
                    {statusIcon(scheduler.status)}
                    {statusLabels[scheduler.status]}
                  </Badge>
                  {scheduler.lastStatus && (
                    <div className="mt-1 text-xs text-muted-foreground">{scheduler.lastStatus}</div>
                  )}
                </TableCell>
                <TableCell>{formatTimestamp(scheduler.lastSuccessAt)}</TableCell>
                <TableCell>
                  <div>{formatAge(scheduler.ageMinutes)}</div>
                  {scheduler.driftMinutes !== null && scheduler.driftMinutes > 0 && (
                    <div className="text-xs text-muted-foreground">+{formatAge(scheduler.driftMinutes)} drift</div>
                  )}
                </TableCell>
                <TableCell className="min-w-[180px]">
                  {scheduler.recentRuns.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No runs recorded</span>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        {scheduler.recentRuns.slice(0, 5).map((run, idx) => (
                          <span
                            key={idx}
                            className={`inline-block h-2.5 w-2.5 rounded-full ${runDotClass(run.status)}`}
                            title={`${run.status} · ${formatTimestamp(run.at)}${run.durationMs !== null ? ` · ${formatDuration(run.durationMs)}` : ""}${run.errorMessage ? ` · ${run.errorMessage}` : ""}`}
                          />
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {scheduler.recentRuns[0].status}
                        {scheduler.recentRuns[0].durationMs !== null && ` · ${formatDuration(scheduler.recentRuns[0].durationMs)}`}
                      </div>
                      {scheduler.recentRuns[0].errorMessage && (
                        <div className="text-xs text-destructive truncate max-w-[220px]" title={scheduler.recentRuns[0].errorMessage}>
                          {scheduler.recentRuns[0].errorMessage}
                        </div>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="text-sm">{formatTimestamp(scheduler.lastAlertAt)}</div>
                </TableCell>
                <TableCell className="max-w-[180px] text-sm">
                  <div>{scheduler.cadence}</div>
                  {scheduler.errorMessage && (
                    <div className="mt-1 text-xs text-destructive truncate" title={scheduler.errorMessage}>
                      {scheduler.errorMessage}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Activity className="h-4 w-4" />
        Alert channels:
        <Badge variant={data?.alerts.configured.slack ? "default" : "outline"}>Slack</Badge>
        <Badge variant={data?.alerts.configured.email ? "default" : "outline"}>Email</Badge>
        {data?.alerts.recipient && (
          <span className="ml-2 text-xs">→ {data.alerts.recipient}</span>
        )}
      </div>
    </div>
  );
}
