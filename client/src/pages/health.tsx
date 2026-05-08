import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bell, CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type HealthState = "healthy" | "warning" | "critical" | "unknown";

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
}

interface SystemHealthSummary {
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

const statusLabels: Record<HealthState, string> = {
  healthy: "Healthy",
  warning: "Late",
  critical: "Stale",
  unknown: "Unknown",
};

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

export default function Health() {
  const { toast } = useToast();
  const { data, isLoading, error, refetch, isFetching } = useQuery<SystemHealthSummary>({
    queryKey: ["/api/system-health"],
    refetchInterval: 60_000,
  });

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
          : "No stale scheduler needed a new alert, or no alert channel is configured.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Health alert check failed", description: err.message, variant: "destructive" });
    },
  });

  const sortedSchedulers = useMemo(() => {
    const order: Record<HealthState, number> = { critical: 0, warning: 1, unknown: 2, healthy: 3 };
    return [...(data?.schedulers ?? [])].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  }, [data]);

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

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scheduler</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Success</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Next Run</TableHead>
              <TableHead>Cadence</TableHead>
              <TableHead>Source</TableHead>
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
                <TableCell>{formatTimestamp(scheduler.nextRunAt)}</TableCell>
                <TableCell className="max-w-[180px] text-sm">{scheduler.cadence}</TableCell>
                <TableCell className="max-w-[260px]">
                  <div className="text-sm">{scheduler.sourceOfTruth}</div>
                  {scheduler.errorMessage && (
                    <div className="mt-1 text-xs text-destructive">{scheduler.errorMessage}</div>
                  )}
                  {scheduler.notes.length > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">{scheduler.notes[0]}</div>
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
      </div>
    </div>
  );
}
