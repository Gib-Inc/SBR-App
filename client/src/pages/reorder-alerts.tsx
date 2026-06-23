import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRing, CheckCircle2, Loader2, Mail, PackageCheck, PauseCircle, PlayCircle, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { ReorderDigestCard } from "@/components/reorder-digest-card";

type AlertStatus = "pending" | "sent" | "acknowledged" | "dismissed" | "received";

interface ReorderAlertRow {
  id: string;
  itemId: string;
  supplierId: string;
  purchaseOrderId: string | null;
  daysLeftAtAlert: string;
  recommendedQty: number;
  alertStatus: AlertStatus;
  emailSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  item: { id: string; sku: string; name: string; currentStock: number | null } | null;
  supplier: { id: string; name: string } | null;
  purchaseOrder: { id: string; poNumber: string } | null;
}

function formatDate(value: string | null): string {
  if (!value) return "Not sent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusVariant(status: AlertStatus): "default" | "secondary" | "outline" {
  if (status === "sent") return "default";
  if (status === "pending") return "secondary";
  return "outline";
}

export default function ReorderAlerts() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const { data: alerts = [], isLoading, isFetching } = useQuery<ReorderAlertRow[]>({
    queryKey: ["/api/reorder-alerts"],
    refetchInterval: 60_000,
  });

  const { data: settings } = useQuery<{ paused: boolean }>({
    queryKey: ["/api/reorder-alerts/settings"],
  });

  const refreshAlerts = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/reorder-alerts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/reorder-alerts/settings"] });
  };

  const pauseMutation = useMutation({
    mutationFn: async (paused: boolean) => {
      const res = await apiRequest("PATCH", "/api/reorder-alerts/settings", { paused });
      return await res.json();
    },
    onSuccess: refreshAlerts,
    onError: (error: Error) => {
      toast({ title: "Failed to update auto-send pause", description: error.message, variant: "destructive" });
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reorder-alerts/run", {});
      return await res.json();
    },
    onSuccess: (result) => {
      refreshAlerts();
      toast({
        title: "Reorder watcher completed",
        description: `${result.createdCount} alert(s) created, ${result.sentCount} sent${result.paused ? " while auto-send was paused" : ""}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Reorder watcher failed", description: error.message, variant: "destructive" });
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "send" | "acknowledge" | "dismiss" | "receive" }) => {
      const res = await apiRequest("POST", `/api/reorder-alerts/${id}/${action}`, {});
      return await res.json();
    },
    onSuccess: (_, vars) => {
      refreshAlerts();
      const labels: Record<string, string> = {
        send: "Alert sent",
        acknowledge: "Alert acknowledged",
        dismiss: "Alert dismissed",
        receive: "Alert marked received",
      };
      toast({ title: labels[vars.action] });
    },
    onError: (error: Error) => {
      toast({ title: "Alert action failed", description: error.message, variant: "destructive" });
    },
  });

  // One-click "reorder needs -> draft POs": groups items needing reorder by
  // supplier into DRAFT purchase orders (idempotent for the day). Review and
  // send them from the Purchase Orders page.
  const autoDraftMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/purchase-orders/auto-draft", {});
      return await res.json();
    },
    onSuccess: (result) => {
      const created = result?.created?.length ?? 0;
      const exists = result?.alreadyExists?.length ?? 0;
      const skipped = result?.skipped?.length ?? 0;
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({
        title: created > 0 ? `Created ${created} draft PO${created === 1 ? "" : "s"}` : "No new draft POs needed",
        description:
          [
            created > 0 ? `${created} created` : null,
            exists > 0 ? `${exists} already drafted today` : null,
            skipped > 0 ? `${skipped} skipped (missing supplier/cost)` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Everything needing reorder is already drafted.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Draft PO generation failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Reorder</h1>
          <p className="text-sm text-muted-foreground">
            What to order this week, per vendor — velocity × BOM, seasonally adjusted. Email alerts below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshAlerts} disabled={isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => runMutation.mutate()} disabled={runMutation.isPending || !isAdmin}>
            {runMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BellRing className="mr-2 h-4 w-4" />}
            Check Now
          </Button>
          <Button size="sm" onClick={() => autoDraftMutation.mutate()} disabled={autoDraftMutation.isPending || !isAdmin}>
            {autoDraftMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
            Generate Draft POs
          </Button>
        </div>
      </div>

      <ReorderDigestCard />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Pause All Auto-Sends</CardTitle>
            <CardDescription>
              Default is paused after first deploy. The watcher still creates pending alerts while paused.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={settings?.paused ? "secondary" : "default"}>
              {settings?.paused ? "Paused" : "Active"}
            </Badge>
            <Switch
              checked={settings?.paused ?? true}
              disabled={!isAdmin || pauseMutation.isPending}
              onCheckedChange={(checked) => pauseMutation.mutate(checked)}
              aria-label="Pause all auto-sends"
            />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Days Left</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Recommended Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent At</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    Loading reorder alerts...
                  </TableCell>
                </TableRow>
              ) : alerts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No recent reorder alerts.
                  </TableCell>
                </TableRow>
              ) : (
                alerts.map((alert) => {
                  const isBusy = actionMutation.isPending && actionMutation.variables?.id === alert.id;
                  return (
                    <TableRow key={alert.id}>
                      <TableCell>
                        <div className="font-medium">{alert.item?.name ?? "Unknown component"}</div>
                        <div className="text-xs text-muted-foreground">{alert.item?.sku ?? "No SKU"}</div>
                      </TableCell>
                      <TableCell>{Number(alert.daysLeftAtAlert).toFixed(1)}</TableCell>
                      <TableCell>{alert.supplier?.name ?? "Unknown supplier"}</TableCell>
                      <TableCell>{alert.recommendedQty}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(alert.alertStatus)}>
                          {alert.alertStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div>{formatDate(alert.emailSentAt)}</div>
                        {alert.purchaseOrder?.poNumber && (
                          <div className="text-xs text-muted-foreground">{alert.purchaseOrder.poNumber}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          {alert.alertStatus === "pending" && (
                            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => actionMutation.mutate({ id: alert.id, action: "send" })}>
                              {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                              Send Now
                            </Button>
                          )}
                          {(alert.alertStatus === "sent" || alert.alertStatus === "acknowledged") && (
                            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => actionMutation.mutate({ id: alert.id, action: "acknowledge" })}>
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              Mark Acknowledged
                            </Button>
                          )}
                          {(alert.alertStatus === "sent" || alert.alertStatus === "acknowledged") && (
                            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => actionMutation.mutate({ id: alert.id, action: "receive" })}>
                              <PackageCheck className="mr-2 h-4 w-4" />
                              Mark Received
                            </Button>
                          )}
                          {(alert.alertStatus === "pending" || alert.alertStatus === "sent" || alert.alertStatus === "acknowledged") && (
                            <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => actionMutation.mutate({ id: alert.id, action: "dismiss" })}>
                              <XCircle className="mr-2 h-4 w-4" />
                              Dismiss
                            </Button>
                          )}
                          {alert.alertStatus === "received" && (
                            <Badge variant="outline" className="gap-1">
                              <PlayCircle className="h-3.5 w-3.5" />
                              Closed
                            </Badge>
                          )}
                          {alert.alertStatus === "pending" && settings?.paused && (
                            <Badge variant="outline" className="gap-1">
                              <PauseCircle className="h-3.5 w-3.5" />
                              Waiting for review
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
