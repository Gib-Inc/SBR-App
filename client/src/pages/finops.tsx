/**
 * FinOps — the engine's control room.
 * One page for the four FinOps surfaces that previously lived only as API
 * endpoints: system integrity (cross-stream self-healing + the drift
 * resolver's per-SKU ledger with one-click approvals), inventory valuation at
 * WAC, forecast self-tuning accuracy, and the latest blended ad directive.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

const fmt$ = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

function statusBadge(status?: string) {
  const cls =
    status === "DRIFT" || status === "POOR" ? "bg-destructive/10 text-destructive border-destructive/30"
    : status === "WARN" || status === "FAIR" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
    : "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30";
  return <Badge variant="outline" className={cls}>{status ?? "—"}</Badge>;
}

function IntegrityCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<any>({ queryKey: ["/api/system-integrity"] });
  const report = data?.report;
  const sweep = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/system-integrity/check", {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/system-integrity"] });
      qc.invalidateQueries({ queryKey: ["/api/system-integrity/drift-ledger"] });
      toast({ title: "Integrity sweep complete" });
    },
    onError: (e: any) => toast({ title: "Sweep failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="card-system-integrity">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              System Integrity {report && statusBadge(report.status)}
            </CardTitle>
            <CardDescription>
              Cross-stream validation: inventory vs Extensiv · ad-spend plausibility · financial discrepancies. Runs every 6h.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => sweep.mutate()} disabled={sweep.isPending}>
            {sweep.isPending ? "Sweeping…" : "↻ Run sweep"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!report ? (
          <div className="text-sm text-muted-foreground">No sweep recorded yet — run one.</div>
        ) : (
          <div className="space-y-2">
            {report.streams?.map((s: any) => (
              <div key={s.stream} className="flex items-start justify-between gap-3 text-sm border-b last:border-0 pb-2 last:pb-0">
                <div className="flex-1">
                  <span className="font-medium capitalize">{s.stream}</span>
                  <span className="text-muted-foreground"> — {s.summary}</span>
                </div>
                {statusBadge(s.status)}
              </div>
            ))}
            <div className="text-xs text-muted-foreground pt-1">
              Last sweep {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : "—"} · {report.totalAnomalies} total anomalies
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DriftLedgerCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<any>({ queryKey: ["/api/system-integrity/drift-ledger"] });
  const ledger: any[] = data?.ledger ?? [];

  const resolveAll = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/system-integrity/resolve-inventory", {})).json(),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["/api/system-integrity/drift-ledger"] });
      const r = d?.result ?? {};
      toast({ title: "Drift resolution complete", description: `${r.corrected ?? 0} corrected · ${r.explained ?? 0} explained · ${r.proposed ?? 0} need review · ${r.syncFailed ?? 0} unmapped in 3PL` });
    },
    onError: (e: any) => toast({ title: "Resolution failed", description: e.message, variant: "destructive" }),
  });

  const approveOne = useMutation({
    mutationFn: async (sku: string) =>
      (await apiRequest("POST", `/api/system-integrity/resolve-inventory?sku=${encodeURIComponent(sku)}`, {})).json(),
    onSuccess: (_d: any, sku: string) => {
      qc.invalidateQueries({ queryKey: ["/api/system-integrity/drift-ledger"] });
      toast({ title: `Correction applied for ${sku}` });
    },
    onError: (e: any) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const actionBadge = (a: string) => {
    const cls =
      a === "CORRECTED" ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
      : a === "PROPOSED" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
      : a === "SYNC_FAILED" ? "bg-destructive/10 text-destructive border-destructive/30"
      : "bg-muted text-muted-foreground border-muted-foreground/20";
    return <Badge variant="outline" className={cls}>{a}</Badge>;
  };

  return (
    <Card data-testid="card-drift-ledger">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Inventory Drift Resolver</CardTitle>
            <CardDescription>
              Latest status per SKU. PROPOSED = correction exceeds the auto-cap — your Approve applies it through the inventory gateway (audit-logged).
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => resolveAll.mutate()} disabled={resolveAll.isPending}>
            {resolveAll.isPending ? "Resolving…" : "↻ Re-run resolver"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {ledger.length === 0 ? (
          <div className="text-sm text-muted-foreground">No drift decisions logged yet — run the resolver.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1.5 pr-2">SKU</th>
                  <th className="py-1.5">Status</th>
                  <th className="py-1.5 text-right">Sellable now</th>
                  <th className="py-1.5 text-right">Should be</th>
                  <th className="py-1.5 pl-3">Why</th>
                  <th className="py-1.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row: any) => (
                  <tr key={row.sku} className="border-b last:border-0 align-top">
                    <td className="py-1.5 pr-2 font-mono text-xs">{row.sku}</td>
                    <td className="py-1.5">{actionBadge(row.action)}</td>
                    <td className="py-1.5 text-right">{row.old_value ?? "—"}</td>
                    <td className="py-1.5 text-right">{row.new_value ?? "—"}</td>
                    <td className="py-1.5 pl-3 text-xs text-muted-foreground max-w-[360px]">{row.reason}</td>
                    <td className="py-1.5 text-right">
                      {row.action === "PROPOSED" && (
                        <Button size="sm" variant="outline"
                          onClick={() => approveOne.mutate(row.sku)}
                          disabled={approveOne.isPending}
                          data-testid={`button-approve-${row.sku}`}>
                          Approve
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ValuationCard() {
  const { data: v } = useQuery<any>({ queryKey: ["/api/finances/inventory-valuation"] });
  return (
    <Card data-testid="card-inventory-valuation">
      <CardHeader className="pb-3">
        <CardTitle>Inventory Asset Value (WAC)</CardTitle>
        <CardDescription>Live balance-sheet value at weighted-average cost — maintained automatically by receipts, builds, and counts.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-2xl font-bold">{fmt$(v?.totalValue)}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{fmt$(v?.finishedValue)}</div>
            <div className="text-xs text-muted-foreground">Finished goods</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{fmt$(v?.componentValue)}</div>
            <div className="text-xs text-muted-foreground">Components</div>
          </div>
        </div>
        {v?.uncostedItemsWithStock > 0 ? (
          <div className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            ⚠ {v.uncostedItemsWithStock} stocked item(s) have no cost — asset value is understated. {(v.valuationGaps ?? []).slice(0, 5).map((g: any) => g.sku).join(", ")}
          </div>
        ) : v ? (
          <div className="mt-3 text-xs text-muted-foreground">All stocked items carry a cost — no valuation gaps.</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ForecastCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<any>({ queryKey: ["/api/finances/forecast-accuracy"] });
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/finances/forecast-accuracy/run", {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/finances/forecast-accuracy"] });
      toast({ title: "Forecast tuning run complete" });
    },
    onError: (e: any) => toast({ title: "Tuning run failed", description: e.message, variant: "destructive" }),
  });
  const report = data?.report;
  const recent: any[] = data?.recent ?? [];

  return (
    <Card data-testid="card-forecast-accuracy">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              Forecast Self-Tuning {report && statusBadge(report.grade)}
            </CardTitle>
            <CardDescription>
              Nightly at 12:15 AM: grades predicted vs actual revenue and tunes the cash-flow runway. Gets sharper every day.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? "Running…" : "↻ Run now"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-2xl font-bold">{report ? `${report.mape}%` : "—"}</div>
            <div className="text-xs text-muted-foreground">Avg error (MAPE)</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{data?.factor != null ? `${data.factor.toFixed(3)}×` : "—"}</div>
            <div className="text-xs text-muted-foreground">Correction factor → runway</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{report?.samples ?? 0}</div>
            <div className="text-xs text-muted-foreground">Days graded</div>
          </div>
        </div>
        {recent.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1.5">Day</th>
                <th className="py-1.5 text-right">Predicted</th>
                <th className="py-1.5 text-right">Actual</th>
              </tr>
            </thead>
            <tbody>
              {recent.slice(0, 7).map((p: any) => (
                <tr key={p.targetDate} className="border-b last:border-0">
                  <td className="py-1.5">{p.targetDate}</td>
                  <td className="py-1.5 text-right">{fmt$(p.predicted)}</td>
                  <td className="py-1.5 text-right">{p.actual != null ? fmt$(p.actual) : <span className="text-muted-foreground">pending</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function DirectiveSummaryCard() {
  const { data } = useQuery<any>({ queryKey: ["/api/marketing/analysis"] });
  const a = data?.analysis;
  const d = a?.directive;
  return (
    <Card data-testid="card-finops-directive">
      <CardHeader className="pb-3">
        <CardTitle>Today's Ad Directive</CardTitle>
        <CardDescription>Blended guardrail call (8x target · 5x escalate · 3x pause · September Rule). Full per-campaign board lives on ROAS Guardian.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!d ? (
          <div className="text-sm text-muted-foreground">No analysis yet today.</div>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className={d.severity === "critical" ? "bg-destructive/10 text-destructive border-destructive/30" : d.severity === "warn" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30" : "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"}>{d.action}</Badge>
              <div className="text-sm font-medium">{d.headline}</div>
            </div>
            <div className="text-xs text-muted-foreground">
              Media ROAS {a.blendedRoas30d}x (30d) on {fmt$(a.adSpend30d)} spend / {fmt$(a.revenue30d)} revenue
            </div>
          </>
        )}
        <Link href="/marketing" className="text-xs text-primary underline underline-offset-2">Open the per-campaign board →</Link>
      </CardContent>
    </Card>
  );
}

function DailyCompanyReportCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<any>({ queryKey: ["/api/daily-company-report"] });
  const report = data?.report;
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/daily-company-report/run?skipRefresh=true", {})).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/daily-company-report"] }); toast({ title: "Daily report refreshed" }); },
    onError: (e: any) => toast({ title: "Run failed", description: e.message, variant: "destructive" }),
  });
  return (
    <Card data-testid="card-daily-company-report">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              Daily Company Report {report && statusBadge(report.status)}
            </CardTitle>
            <CardDescription>
              6:45 AM MT: refreshes feeds, cross-checks Shopify ↔ app ↔ QuickBooks sales, runs every drift check, snapshots financials + inventory.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? "Running…" : "↻ Run now"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!report ? (
          <div className="text-sm text-muted-foreground">No report yet — runs at 6:45 AM, or hit Run now.</div>
        ) : (
          <>
            <div className="text-sm font-medium">{report.headline}</div>
            {report.sales?.crossCheck && (
              <div className="text-xs text-muted-foreground">Sales cross-check ({report.forDate}): {report.sales.crossCheck}</div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div><div className={`font-semibold ${report.financials?.blendedMer != null && report.financials.blendedMer < (report.financials?.breakeven ?? 5) ? "text-red-600 dark:text-red-400" : ""}`}>{report.financials?.blendedMer != null ? `${Number(report.financials.blendedMer).toFixed(1)}x` : "—"}</div><div className="text-xs text-muted-foreground">Blended MER (vs {report.financials?.breakeven ?? 5}x)</div></div>
              <div><div className="font-semibold">{report.financials?.blendedRoas != null ? `${Number(report.financials.blendedRoas).toFixed(1)}x` : "—"}</div><div className="text-xs text-muted-foreground">Media ROAS (ads)</div></div>
              <div><div className="font-semibold">{report.financials?.adSpend30d != null ? `$${Math.round(report.financials.adSpend30d).toLocaleString()}` : "—"}</div><div className="text-xs text-muted-foreground">Ad spend (30d)</div></div>
              <div><div className="font-semibold">{report.inventory?.assetValueAtWac != null ? `$${Math.round(report.inventory.assetValueAtWac).toLocaleString()}` : "—"}</div><div className="text-xs text-muted-foreground">Inventory @ WAC</div></div>
              <div><div className="font-semibold">{report.freshness?.staleCount ?? 0}</div><div className="text-xs text-muted-foreground">Stale feeds</div></div>
            </div>
            {report.anomalies?.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-sm font-medium text-amber-700 dark:text-amber-400">{report.anomalies.length} item(s) flagged:</div>
                <ul className="mt-1 text-xs text-amber-700/90 dark:text-amber-400/90 list-disc pl-4 space-y-0.5">
                  {report.anomalies.slice(0, 8).map((a: string, i: number) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
            <div className="text-xs text-muted-foreground">Generated {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : "—"}</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function FinOps() {
  return (
    <div className="container mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-3xl font-bold">FinOps Engine</h1>
        <p className="text-muted-foreground">
          Self-healing integrity, real inventory valuation, self-tuning forecasts, and the daily ad directive — all monitored on <Link href="/health" className="text-primary underline underline-offset-2">Health</Link>.
        </p>
      </div>
      <DailyCompanyReportCard />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <IntegrityCard />
        <DirectiveSummaryCard />
        <ValuationCard />
        <ForecastCard />
      </div>
      <DriftLedgerCard />
    </div>
  );
}
