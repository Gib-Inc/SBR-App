import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Database, GitCompareArrows, Loader2, ShieldAlert, ShieldCheck, Truck, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Severity = "critical" | "warning" | "info";

type IntegrityIssue = {
  severity: Severity;
  code: string;
  title: string;
  count: number;
  detail: string;
  rows?: Record<string, any>[];
};

type IntegritySummary = {
  status: "healthy" | "warning" | "critical";
  score: number;
  generatedAt: string;
  totals: {
    finishedProducts: number;
    components: number;
    negativeRows: number;
    mappedExtensivItems: number;
    recentlySyncedExtensivItems: number;
    openOrders: number;
    openUnshippedUnits: number;
    backorderedUnits: number;
    pendingReorderAlerts: number;
  };
  freshness: {
    latestExtensivSyncAt: string | null;
    extensivMinutesOld: number | null;
  };
  ledger: {
    trackedItems: number;
    driftItems: number;
    untrackedItems: number;
  };
  accuracy: {
    iraPercent: number | null;
    physicalCounts90d: number;
    neverCountedItems: number;
    driftEvents90d: number;
    driftNetUnits90d: number;
    driftAbsorbedValue90d: number;
  };
  issues: IntegrityIssue[];
  drift: Record<string, any>[];
  ledgerDrift: Record<string, any>[];
  openOrders: Record<string, any>[];
  recentMovements: Record<string, any>[];
};

const fmt = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");

const fmtMoney = (value: unknown) =>
  `$${Math.abs(Math.round(Number(value ?? 0))).toLocaleString("en-US")}`;

const fmtDate = (value: string | null | undefined) => {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const severityClass: Record<Severity, string> = {
  critical: "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-300",
  warning: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300",
  info: "border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-950/20 dark:text-blue-300",
};

function StatusBanner({ data }: { data: IntegritySummary }) {
  const Icon = data.status === "healthy" ? ShieldCheck : data.status === "warning" ? AlertTriangle : ShieldAlert;
  const title = data.status === "healthy"
    ? "Inventory integrity looks clean"
    : data.status === "warning"
      ? `${data.issues.filter((i) => i.severity === "warning").length} warning area${data.issues.filter((i) => i.severity === "warning").length === 1 ? "" : "s"}`
      : `${data.issues.filter((i) => i.severity === "critical").length} critical inventory issue${data.issues.filter((i) => i.severity === "critical").length === 1 ? "" : "s"}`;

  return (
    <Alert className={data.status === "healthy" ? "border-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/20" : data.status === "warning" ? "border-amber-300 bg-amber-50/70 dark:bg-amber-950/20" : "border-red-300 bg-red-50/70 dark:bg-red-950/20"}>
      <Icon className="h-4 w-4" />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {title}
        <Badge variant="outline">score {data.score}/100</Badge>
      </AlertTitle>
      <AlertDescription>
        Extensiv latest sync: {fmtDate(data.freshness.latestExtensivSyncAt)}
        {data.freshness.extensivMinutesOld != null ? ` (${data.freshness.extensivMinutesOld} min old)` : ""}. Generated {fmtDate(data.generatedAt)}.
      </AlertDescription>
    </Alert>
  );
}

function MetricCard({ title, value, helper, icon: Icon }: { title: string; value: string; helper: string; icon: any }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">{title}</div>
            <div className="text-2xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
          </div>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

function IssueCard({ issue }: { issue: IntegrityIssue }) {
  const sampleRows = issue.rows?.slice(0, 6) ?? [];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{issue.title}</span>
          <Badge variant="outline" className={severityClass[issue.severity]}>{issue.severity} · {issue.count}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{issue.detail}</p>
        {sampleRows.length > 0 && (
          <div className="rounded border max-h-56 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Hildale</TableHead>
                  <TableHead className="text-right">Pyvott</TableHead>
                  <TableHead className="text-right">AFS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sampleRows.map((row, idx) => (
                  <TableRow key={`${issue.code}-${row.sku ?? idx}`}>
                    <TableCell className="font-medium">{row.sku ?? row.extensiv_sku ?? "—"}</TableCell>
                    <TableCell className="max-w-[260px] truncate">{row.name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.current_stock ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.hildale_qty ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.pivot_qty ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.available_for_sale_qty ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DriftTable({ rows }: { rows: Record<string, any>[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Sellable Stock Drift</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No finished products are drifting by 5+ units.</div>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Pyvott</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">Target AFS</TableHead>
                  <TableHead className="text-right">Actual AFS</TableHead>
                  <TableHead className="text-right">Drift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id ?? row.sku}>
                    <TableCell className="font-medium">{row.sku}</TableCell>
                    <TableCell className="max-w-[280px] truncate">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.pivot_qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.open_unshipped}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.target_available_for_sale}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.available_for_sale_qty}</TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${Number(row.drift) === 0 ? "" : Number(row.drift) > 0 ? "text-amber-700" : "text-red-700"}`}>{row.drift}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LedgerDriftTable({ rows }: { rows: Record<string, any>[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Ledger Drift — stock changed outside the movement gateway</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Every ledgered item matches its last movement snapshot.</div>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Pyvott (ledger→now)</TableHead>
                  <TableHead className="text-right">Hildale (ledger→now)</TableHead>
                  <TableHead className="text-right">Current (ledger→now)</TableHead>
                  <TableHead className="text-right">Drift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.sku}>
                    <TableCell className="font-medium">{row.sku}</TableCell>
                    <TableCell className="max-w-[240px] truncate">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.ledger_pivot} → {row.pivot_qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.ledger_hildale} → {row.hildale_qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.ledger_current} → {row.current_stock}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-red-700">{row.drift}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentMovements({ rows }: { rows: Record<string, any>[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Recent Inventory Movement Audit</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No inventory movement audit rows in the last 7 days.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Latest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.event_type}>
                  <TableCell className="font-medium">{row.event_type}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmtDate(row.latest)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function InventoryIntegrity() {
  const { data, isLoading, error } = useQuery<IntegritySummary>({
    queryKey: ["/api/inventory-integrity"],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Inventory integrity failed to load</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : "Unknown error"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" />
          Inventory Integrity
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Read-only truth checks for stock fields, Pyvott sync, open orders, BOM coverage, and movement audit trails.
        </p>
      </div>

      <StatusBanner data={data} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard title="Extensiv mapped" value={`${fmt(data.totals.recentlySyncedExtensivItems)} / ${fmt(data.totals.mappedExtensivItems)}`} helper="synced within 70 minutes" icon={Database} />
        <MetricCard title="Open orders" value={fmt(data.totals.openOrders)} helper={`${fmt(data.totals.openUnshippedUnits)} unshipped units`} icon={Truck} />
        <MetricCard title="Backordered" value={fmt(data.totals.backorderedUnits)} helper={`${fmt(data.totals.pendingReorderAlerts)} pending reorder alerts`} icon={AlertTriangle} />
        <MetricCard title="Catalog" value={`${fmt(data.totals.finishedProducts)} / ${fmt(data.totals.components)}`} helper="finished products / components" icon={Warehouse} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          title="Ledger drift"
          value={`${fmt(data.ledger.driftItems)} / ${fmt(data.ledger.trackedItems)}`}
          helper="items changed outside the gateway"
          icon={GitCompareArrows}
        />
        <MetricCard
          title="Untracked stock"
          value={fmt(data.ledger.untrackedItems)}
          helper="no movement ledger — unreconcilable"
          icon={Database}
        />
        <MetricCard
          title="Record accuracy"
          value={data.accuracy.iraPercent === null ? "unmeasured" : `${data.accuracy.iraPercent}%`}
          helper={
            data.accuracy.physicalCounts90d === 0
              ? `0 counts in 90d · ${fmt(data.accuracy.neverCountedItems)} never counted`
              : `${fmt(data.accuracy.physicalCounts90d)} counts in 90d`
          }
          icon={ClipboardCheck}
        />
        <MetricCard
          title="Drift absorbed (90d)"
          value={fmtMoney(data.accuracy.driftAbsorbedValue90d)}
          helper={`${fmt(data.accuracy.driftEvents90d)} silent count/adjust events`}
          icon={ShieldAlert}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {data.issues.length === 0 ? (
          <Card className="xl:col-span-2">
            <CardContent className="py-10 text-center text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
              No integrity issues detected.
            </CardContent>
          </Card>
        ) : data.issues.map((issue) => <IssueCard key={issue.code} issue={issue} />)}
      </div>

      <LedgerDriftTable rows={data.ledgerDrift} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <DriftTable rows={data.drift} />
        <RecentMovements rows={data.recentMovements} />
      </div>
    </div>
  );
}
