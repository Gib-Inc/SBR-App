import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Factory, ChevronDown, ChevronRight, AlertTriangle,
  CheckCircle2, Clock, PackageCheck, Wrench, TrendingUp,
  DollarSign, Layers, CalendarDays, User,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlanComponent {
  componentId: string;
  componentName: string;
  componentSku: string;
  qtyPerUnit: number;
  wastagePercent: number;
  effectiveQtyPerUnit: number;
  onHand: number;
  canMake: number;
  neededForTarget: number;
  shortage: number;
  unitCost: number | null;
  shortageCost: number;
}

interface PlanProduct {
  productId: string;
  productName: string;
  productSku: string;
  hildaleQty: number;
  canBuildNow: number;
  limitingComponent: string | null;
  components: PlanComponent[];
  targetQty: number;
  shortages: PlanComponent[];
  totalShortageCost: number;
  hasBOM: boolean;
}

interface ProductionRunLine {
  id: string;
  productName: string;
  productSku: string;
  quantityBuilt: number;
  componentsConsumed: Array<{ name: string; sku: string; qty: number }>;
  buildCostSnapshot: number | null;
  success: boolean;
  errorMessage?: string;
}

interface ProductionRun {
  id: string;
  runNumber: string;
  createdAt: string;
  createdByName: string;
  notes: string | null;
  totalProductsBuilt: number;
  totalUnitsBuilt: number;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  lines: ProductionRunLine[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: ProductionRun["status"] }) {
  if (status === "COMPLETED") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-0">Completed</Badge>;
  if (status === "PARTIAL") return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0">Partial</Badge>;
  return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0">Failed</Badge>;
}

// ─── Plan Tab ─────────────────────────────────────────────────────────────────

function PlanTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetInput, setTargetInput] = useState("450");
  const [target, setTarget] = useState(450);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [buildQtys, setBuildQtys] = useState<Record<string, number>>({});
  const [buildNotes, setBuildNotes] = useState("");

  const { data, isLoading, refetch } = useQuery<{ plan: PlanProduct[]; targetQty: number }>({
    queryKey: ["/api/production/plan", target],
    queryFn: async () => {
      const res = await fetch(`/api/production/plan?target=${target}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load plan");
      return res.json();
    },
  });

  const buildMutation = useMutation({
    mutationFn: async (builds: Array<{ finishedProductId: string; quantity: number }>) => {
      const res = await apiRequest("POST", "/api/production/batch-build", { builds, notes: buildNotes || undefined });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Build failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      const s = data.summary;
      toast({ title: `Built ${s.successCount} product${s.successCount !== 1 ? "s" : ""}`, description: s.failCount > 0 ? `${s.failCount} failed` : "All successful" });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/production/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/production/plan"] });
      setBuildQtys({});
      setBuildNotes("");
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Build failed", description: e.message }),
  });

  const toggleExpand = (id: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBuild = () => {
    const builds = Object.entries(buildQtys)
      .filter(([, qty]) => qty > 0)
      .map(([finishedProductId, quantity]) => ({ finishedProductId, quantity }));
    if (builds.length === 0) { toast({ variant: "destructive", title: "Nothing to build", description: "Enter quantities above 0 for at least one product." }); return; }
    buildMutation.mutate(builds);
  };

  const hasBuildQtys = Object.values(buildQtys).some(q => q > 0);

  if (isLoading) return (
    <div className="flex h-64 items-center justify-center text-muted-foreground gap-3">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      Loading production plan…
    </div>
  );

  const allPlan = data?.plan ?? [];
  // Only show products that have a BOM — items without one aren't manufactured
  const plan = allPlan.filter(p => p.hasBOM);
  const noBomCount = allPlan.length - plan.length;

  return (
    <div className="space-y-6">
      {/* Target + Build Controls */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border bg-muted/30 p-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Monthly target (units per product)</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="0"
              value={targetInput}
              onChange={e => setTargetInput(e.target.value)}
              className="w-28 font-mono"
            />
            <Button variant="outline" size="sm" onClick={() => { const n = parseInt(targetInput); if (!isNaN(n)) { setTarget(n); refetch(); } }}>
              Calculate
            </Button>
          </div>
        </div>
        <div className="space-y-1 flex-1 min-w-48">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Build notes (optional)</label>
          <Input
            placeholder="e.g. March production run"
            value={buildNotes}
            onChange={e => setBuildNotes(e.target.value)}
          />
        </div>
        <Button
          onClick={handleBuild}
          disabled={!hasBuildQtys || buildMutation.isPending}
          className="gap-2"
        >
          <Factory className="h-4 w-4" />
          {buildMutation.isPending ? "Building…" : "Log Build"}
        </Button>
      </div>

      {/* Product Cards */}
      <div className="space-y-3">
        {plan.map(product => {
          const isExpanded = expandedProducts.has(product.productId);
          const buildQty = buildQtys[product.productId] ?? 0;
          const hasShortages = product.shortages.length > 0;
          const canBuild = product.hasBOM && product.canBuildNow > 0;

          return (
            <div key={product.productId} className="rounded-xl border bg-card overflow-hidden">
              {/* Header row */}
              <div className="flex items-center gap-4 p-4">
                <button onClick={() => toggleExpand(product.productId)} className="text-muted-foreground hover:text-foreground">
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{product.productName}</span>
                    <span className="text-xs text-muted-foreground font-mono">{product.productSku}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Layers className="h-3 w-3" />{product.hildaleQty} at Hildale</span>
                    {!product.hasBOM && <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />No BOM set</span>}
                    {product.hasBOM && product.limitingComponent && (
                      <span className="flex items-center gap-1">
                        <Wrench className="h-3 w-3" />
                        Limited by: {product.limitingComponent}
                      </span>
                    )}
                  </div>
                </div>

                {/* Can build now */}
                <div className="text-center min-w-[80px]">
                  <div className={`text-2xl font-bold tabular-nums ${canBuild ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                    {product.canBuildNow}
                  </div>
                  <div className="text-xs text-muted-foreground">can build</div>
                </div>

                {/* Target shortages */}
                {target > 0 && (
                  <div className="text-center min-w-[80px]">
                    {hasShortages ? (
                      <>
                        <div className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
                          {product.shortages.length}
                        </div>
                        <div className="text-xs text-muted-foreground">short of {target}</div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                        <div className="text-xs text-muted-foreground">on track</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Build qty input */}
                {product.hasBOM && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      placeholder="qty"
                      value={buildQty || ""}
                      onChange={e => {
                        const n = parseInt(e.target.value);
                        setBuildQtys(prev => ({ ...prev, [product.productId]: isNaN(n) ? 0 : n }));
                      }}
                      className="w-20 font-mono text-right"
                    />
                  </div>
                )}
              </div>

              {/* Expanded component breakdown */}
              {isExpanded && product.hasBOM && (
                <div className="border-t bg-muted/20">
                  <div className="px-4 py-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground uppercase tracking-wide">
                          <th className="text-left pb-2 font-medium">Component</th>
                          <th className="text-right pb-2 font-medium">Per Unit</th>
                          <th className="text-right pb-2 font-medium">Waste %</th>
                          <th className="text-right pb-2 font-medium">On Hand</th>
                          <th className="text-right pb-2 font-medium">Can Make</th>
                          {target > 0 && <th className="text-right pb-2 font-medium">Need ({target})</th>}
                          {target > 0 && <th className="text-right pb-2 font-medium">Short</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {product.components.map(comp => (
                          <tr key={comp.componentId} className={comp.shortage > 0 ? "text-red-700 dark:text-red-300" : ""}>
                            <td className="py-1">
                              <div className="font-medium">{comp.componentName}</div>
                              <div className="text-xs text-muted-foreground font-mono">{comp.componentSku}</div>
                            </td>
                            <td className="text-right tabular-nums py-1">{comp.qtyPerUnit}</td>
                            <td className="text-right tabular-nums py-1 text-muted-foreground">{comp.wastagePercent > 0 ? `${comp.wastagePercent}%` : "—"}</td>
                            <td className="text-right tabular-nums py-1 font-mono">{comp.onHand}</td>
                            <td className={`text-right tabular-nums py-1 font-medium ${comp.canMake === 0 ? "text-red-600 dark:text-red-400" : ""}`}>{comp.canMake}</td>
                            {target > 0 && <td className="text-right tabular-nums py-1">{comp.neededForTarget}</td>}
                            {target > 0 && (
                              <td className="text-right tabular-nums py-1 font-medium">
                                {comp.shortage > 0
                                  ? <span className="text-red-600 dark:text-red-400">{comp.shortage}</span>
                                  : <span className="text-green-600 dark:text-green-400">✓</span>}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Shortage cost summary */}
                    {product.shortages.length > 0 && product.totalShortageCost > 0 && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                        <DollarSign className="h-4 w-4 flex-shrink-0" />
                        Estimated cost to fill shortages: <span className="font-semibold ml-1">{fmt$(product.totalShortageCost)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {plan.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No products have a Bill of Materials set up yet. Add BOMs in the Products page to enable production planning.
          </div>
        )}
      </div>
      {noBomCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {noBomCount} product{noBomCount !== 1 ? "s" : ""} without a BOM hidden. Set up BOMs in the Products page to include them.
        </p>
      )}
    </div>
  );
}

// ─── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab() {
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());

  const { data: runs = [], isLoading } = useQuery<ProductionRun[]>({
    queryKey: ["/api/production/runs"],
    queryFn: async () => {
      const res = await fetch("/api/production/runs", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load runs");
      return res.json();
    },
  });

  const toggleRun = (id: string) => {
    setExpandedRuns(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (isLoading) return (
    <div className="flex h-64 items-center justify-center text-muted-foreground gap-3">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      Loading history…
    </div>
  );

  if (runs.length === 0) return (
    <div className="flex flex-col h-64 items-center justify-center text-muted-foreground gap-3">
      <PackageCheck className="h-10 w-10 opacity-30" />
      <p className="text-sm">No production runs yet.</p>
      <p className="text-xs">Use the Plan tab to log your first build.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {runs.map(run => {
        const isExpanded = expandedRuns.has(run.id);
        const totalCost = run.lines.reduce((s, l) => s + (l.buildCostSnapshot ?? 0), 0);

        return (
          <div key={run.id} className="rounded-xl border bg-card overflow-hidden">
            <button
              className="w-full flex items-center gap-4 p-4 text-left hover:bg-muted/30 transition-colors"
              onClick={() => toggleRun(run.id)}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold font-mono text-sm">{run.runNumber}</span>
                  <StatusBadge status={run.status} />
                </div>
                <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{fmtDate(run.createdAt)}</span>
                  <span className="flex items-center gap-1"><User className="h-3 w-3" />{run.createdByName}</span>
                  {run.notes && <span className="italic truncate">{run.notes}</span>}
                </div>
              </div>

              <div className="flex items-center gap-6 text-right flex-shrink-0">
                <div>
                  <div className="text-lg font-bold tabular-nums">{run.totalUnitsBuilt}</div>
                  <div className="text-xs text-muted-foreground">units built</div>
                </div>
                <div>
                  <div className="text-lg font-bold tabular-nums">{run.totalProductsBuilt}</div>
                  <div className="text-xs text-muted-foreground">products</div>
                </div>
                {totalCost > 0 && (
                  <div>
                    <div className="text-lg font-bold tabular-nums">{fmt$(totalCost)}</div>
                    <div className="text-xs text-muted-foreground">materials cost</div>
                  </div>
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t bg-muted/20 px-4 py-3 space-y-4">
                {run.lines.map(line => (
                  <div key={line.id} className={`rounded-lg border p-3 ${line.success ? "bg-card" : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-medium">{line.productName}</span>
                        <span className="text-xs text-muted-foreground font-mono ml-2">{line.productSku}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        {line.buildCostSnapshot != null && (
                          <span className="text-muted-foreground">{fmt$(line.buildCostSnapshot)} materials</span>
                        )}
                        <span className="font-semibold tabular-nums">{line.quantityBuilt} units</span>
                        {line.success
                          ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                          : <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />}
                      </div>
                    </div>
                    {line.errorMessage && (
                      <p className="text-xs text-red-600 dark:text-red-400 mb-2">{line.errorMessage}</p>
                    )}
                    {line.componentsConsumed && line.componentsConsumed.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {line.componentsConsumed.map((c, i) => (
                          <span key={i} className="text-xs bg-muted rounded px-2 py-0.5 font-mono">
                            {c.qty}× {c.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Production() {
  const { data: runs = [] } = useQuery<ProductionRun[]>({
    queryKey: ["/api/production/runs"],
    queryFn: async () => {
      const res = await fetch("/api/production/runs", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const totalUnitsThisMonth = useMemo(() => {
    const now = new Date();
    return runs
      .filter(r => {
        const d = new Date(r.createdAt);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && r.status !== "FAILED";
      })
      .reduce((s, r) => s + r.totalUnitsBuilt, 0);
  }, [runs]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Factory className="h-6 w-6" />
            Production
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Plan builds and track what Clarence's crew has made</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{totalUnitsThisMonth}</div>
            <div className="text-xs text-muted-foreground">units built this month</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{runs.length}</div>
            <div className="text-xs text-muted-foreground">total runs</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="plan">
        <TabsList>
          <TabsTrigger value="plan" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            Plan
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <Clock className="h-4 w-4" />
            History
            {runs.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">{runs.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="mt-6">
          <PlanTab />
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
