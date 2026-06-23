import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wallet, ChevronRight, AlertTriangle, TrendingDown } from "lucide-react";

/**
 * Budget — categorized P&L from QuickBooks line items + budget-vs-actual (% of net
 * sales) with the gap to breakeven. The cuts that get SBR profitable, made explicit.
 */

interface PnlMonth { month: string; netSales: number; cogs: number; grossProfit: number; grossMarginPct: number | null; totalExpenses: number; netIncome: number; netMarginPct: number | null; }
interface BudgetCategory { account: string; group: string; actual: number; monthlyAvg: number; actualPct: number | null; targetPct: number | null; targetDollars: number | null; variance: number | null; over: boolean; }
interface Resp {
  success: boolean; monthly: PnlMonth[]; basis: { label: string; months: number; netSales: number };
  categories: BudgetCategory[];
  summary: { netSales: number; cogs: number; grossProfit: number; grossMarginPct: number | null; totalExpenses: number; netIncome: number; netMarginPct: number | null; overBudgetTotal: number; toBreakeven: number };
}
interface Vendor { vendor: string; amount: number; lines: number; }

const money = (n: number) => (n < 0 ? "-" : "") + "$" + Math.abs(Math.round(n)).toLocaleString();
const fmtMonth = (m: string) => { const [y, mo] = m.split("-"); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", { month: "short" }); };

export default function Budget() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Resp>({ queryKey: ["/api/finances/budget-scorecard"] });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const vendors = useQuery<{ vendors: Vendor[] }>({
    queryKey: ["/api/finances/category-vendors", expanded],
    queryFn: async () => (await apiRequest("GET", `/api/finances/category-vendors?account=${encodeURIComponent(expanded!)}`)).json(),
    enabled: !!expanded,
  });

  const saveTarget = useMutation({
    mutationFn: async ({ account, targetPct }: { account: string; targetPct: number }) =>
      (await apiRequest("PUT", "/api/finances/budget-target", { account, targetPct })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/finances/budget-scorecard"] }); toast({ title: "Target updated" }); },
    onError: (e: Error) => toast({ title: "Couldn't save target", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading budget…</div>;
  const s = data.summary;
  const netLoss = s.netIncome < 0;
  const maxCat = Math.max(...data.categories.map((c) => Math.max(c.actual, c.targetDollars ?? 0)), 1);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal flex items-center gap-2"><Wallet className="h-5 w-5" /> Budget &amp; P&amp;L</h1>
        <p className="text-sm text-muted-foreground">Real categorized financials from QuickBooks line items · budget vs actual as % of net sales · basis: {data.basis.label} ({data.basis.months} mo).</p>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Net sales" value={money(s.netSales)} sub={`${data.basis.months}-mo`} />
        <Tile label="Gross profit" value={money(s.grossProfit)} sub={s.grossMarginPct != null ? `${s.grossMarginPct}% margin` : ""} />
        <Tile label="Net income" value={money(s.netIncome)} sub={s.netMarginPct != null ? `${s.netMarginPct}% margin` : ""} alert={netLoss} />
        <Tile label={netLoss ? "Gap to breakeven" : "Over budget"} value={money(netLoss ? s.toBreakeven : s.overBudgetTotal)} sub={netLoss ? "cut this to stop the loss" : "above targets"} alert />
      </div>

      {netLoss && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900/40 dark:bg-red-950/20">
          <div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-300"><TrendingDown className="h-4 w-4" /> Running a {money(s.netIncome)} loss over {data.basis.months} months ({s.netMarginPct}% margin)</div>
          <p className="mt-1 text-muted-foreground">Categories over their target total <span className="font-semibold text-foreground">{money(s.overBudgetTotal)}</span>. Bringing the over-budget categories below to target closes most of the {money(s.toBreakeven)} gap to breakeven.</p>
        </div>
      )}

      {/* Budget vs actual by category */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Budget vs actual — by category (% of net sales)</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-2 pb-1 text-[11px] font-medium text-muted-foreground">
              <span>Category</span><span className="text-right w-20">Actual</span><span className="text-right w-16">Actual %</span><span className="text-right w-20">Target %</span><span className="text-right w-24">Over/Under</span>
            </div>
            {data.categories.map((c) => (
              <div key={c.account}>
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 px-2 py-1.5 rounded hover-elevate text-sm">
                  <button className="flex items-center gap-1.5 min-w-0 text-left" onClick={() => setExpanded(expanded === c.account ? null : c.account)} data-testid={`cat-${c.account}`}>
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded === c.account ? "rotate-90" : ""}`} />
                    <span className="truncate">{c.account}</span>
                    {c.group === "cogs" && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">COGS</span>}
                  </button>
                  <span className="w-20 text-right tabular-nums">{money(c.actual)}</span>
                  <span className="w-16 text-right tabular-nums text-muted-foreground">{c.actualPct != null ? `${c.actualPct}%` : "—"}</span>
                  <span className="w-20 text-right">
                    <Input
                      type="number" step="0.5" className="h-6 w-16 ml-auto text-right text-xs px-1"
                      value={edits[c.account] ?? (c.targetPct != null ? String(c.targetPct) : "")}
                      placeholder="—"
                      onChange={(e) => setEdits((p) => ({ ...p, [c.account]: e.target.value }))}
                      onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== c.targetPct) saveTarget.mutate({ account: c.account, targetPct: v }); }}
                      data-testid={`target-${c.account}`}
                    />
                  </span>
                  <span className={`w-24 text-right tabular-nums font-medium ${c.variance == null ? "text-muted-foreground" : c.over ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                    {c.variance == null ? "no target" : `${c.over ? "+" : ""}${money(c.variance)}`}
                  </span>
                </div>
                {/* mini bar: actual vs target */}
                <div className="px-2 pb-1 pl-8">
                  <div className="relative h-1.5 bg-muted rounded overflow-hidden">
                    <div className={`h-1.5 ${c.over ? "bg-red-500" : "bg-green-500"}`} style={{ width: `${Math.min(100, (c.actual / maxCat) * 100)}%` }} />
                    {c.targetDollars != null && <div className="absolute top-0 h-1.5 border-r-2 border-foreground/60" style={{ left: `${Math.min(100, (c.targetDollars / maxCat) * 100)}%` }} title="target" />}
                  </div>
                </div>
                {expanded === c.account && (
                  <div className="px-2 pb-2 pl-8 text-xs">
                    {vendors.isLoading ? <span className="text-muted-foreground">Loading vendors…</span> : (
                      <div className="rounded border divide-y">
                        {(vendors.data?.vendors ?? []).map((v) => (
                          <div key={v.vendor} className="flex items-center justify-between px-2 py-1">
                            <span className="truncate">{v.vendor} <span className="text-muted-foreground">· {v.lines} lines</span></span>
                            <span className="tabular-nums font-medium">{money(v.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground pt-2">Edit a target % to change the budget (it&apos;s a % of net sales, so it scales with revenue). Click a category to see the vendors behind it. COGS scales with sales; the real lever is the over-budget operating lines.</p>
        </CardContent>
      </Card>

      {/* P&L trend */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Net income by month</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {data.monthly.map((m) => {
              const maxAbs = Math.max(...data.monthly.map((x) => Math.abs(x.netIncome)), 1);
              const loss = m.netIncome < 0;
              return (
                <div key={m.month} className="flex items-center gap-2 text-sm" data-testid={`pnl-${m.month}`}>
                  <span className="w-10 text-xs text-muted-foreground">{fmtMonth(m.month)}</span>
                  <div className="flex-1 flex items-center">
                    <div className="w-1/2 flex justify-end">{loss && <div className="h-3.5 bg-red-500 rounded-l" style={{ width: `${(Math.abs(m.netIncome) / maxAbs) * 100}%` }} />}</div>
                    <div className="w-1/2">{!loss && <div className="h-3.5 bg-green-500 rounded-r" style={{ width: `${(m.netIncome / maxAbs) * 100}%` }} />}</div>
                  </div>
                  <span className={`w-20 text-right tabular-nums font-medium ${loss ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>{money(m.netIncome)}</span>
                  <span className="w-14 text-right text-[11px] text-muted-foreground">{m.netMarginPct != null ? `${m.netMarginPct}%` : ""}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${alert ? "border-red-300 dark:border-red-900/40" : ""}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1">{alert && <AlertTriangle className="h-3 w-3 text-red-500" />}{label}</div>
      <div className={`text-lg font-bold mt-1 ${alert ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
