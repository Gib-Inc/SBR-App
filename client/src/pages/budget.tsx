import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wallet, ChevronRight, AlertTriangle, TrendingDown, Scissors, Truck, LineChart } from "lucide-react";

/**
 * Budget — categorized P&L from QuickBooks line items + budget-vs-actual (% of net
 * sales) with the gap to breakeven. The cuts that get SBR profitable, made explicit.
 */

interface PnlMonth { month: string; netSales: number; cogs: number; grossProfit: number; grossMarginPct: number | null; totalExpenses: number; netIncome: number; netMarginPct: number | null; }
interface BudgetCategory { account: string; group: string; actual: number; monthlyAvg: number; actualPct: number | null; targetPct: number | null; targetDollars: number | null; variance: number | null; over: boolean; }
interface Opportunity { category: string; currentPct: number | null; targetPct: number | null; monthlyOver: number; annualOver: number; status: string; note: string | null; }
interface Resp {
  success: boolean; monthly: PnlMonth[]; basis: { label: string; months: number; netSales: number };
  categories: BudgetCategory[]; opportunities: Opportunity[];
  summary: { netSales: number; cogs: number; grossProfit: number; grossMarginPct: number | null; totalExpenses: number; netIncome: number; netMarginPct: number | null; overBudgetTotal: number; toBreakeven: number; annualizedNetIncome: number; potentialAnnualSavings: number; pctOfLossClosed: number | null; actionableAnnualSavings: number; inProgressAnnualSavings: number };
}
interface Vendor { vendor: string; amount: number; lines: number; }
interface TopVendor { vendor: string; amount: number; monthlyAvg: number; pctOfNetSales: number | null; topAccount: string | null; lines: number; }
interface VendorResp { success: boolean; basis: { months: number }; netSales: number; vendors: TopVendor[]; fulfillment: { vendor: string; amount: number; monthlyAvg: number; orders: number; costPerOrder: number | null; pctOfNetSales: number | null } | null; }
interface ProjMonth { month: string; netSales: number; cogs: number; expenses: number; netIncome: number; cumulativeNetIncome: number; }
interface ProjCategory { account: string; group: string; driver: string; ratePct: number | null; fixedAmount: number | null; source: string; trailingTotal: number; trailingMonthlyAvg: number; trailingPctOfSales: number | null; monthly: number[]; annualTotal: number; }
interface ProjResp {
  success: boolean; startMonth: string; months: number; baseMethod: string; growthPct: number; revenueBase: number;
  forecast: ProjMonth[]; categories: ProjCategory[];
  reclassification: { to: string; vendorLike: string; trailingAmount: number }[];
  summary: { annualRevenue: number; annualCogs: number; annualExpenses: number; annualNetIncome: number; avgMonthlyNetIncome: number; netMarginPct: number | null; firstProfitableMonth: string | null; cumulativeBreakevenMonth: string | null; startingMonthlyNetIncome: number; endingMonthlyNetIncome: number };
}

const OWNER_COMP_LABEL = "Owner Compensation (Zo)";
const money = (n: number) => (n < 0 ? "-" : "") + "$" + Math.abs(Math.round(n)).toLocaleString();
const fmtMonth = (m: string) => { const [y, mo] = m.split("-"); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", { month: "short" }); };
const fmtFull = (m: string) => { const [y, mo] = m.split("-"); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" }); };

export default function Budget() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Resp>({ queryKey: ["/api/finances/budget-scorecard"] });
  const vendorsView = useQuery<VendorResp>({ queryKey: ["/api/finances/top-vendors"] });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [selectedCuts, setSelectedCuts] = useState<Set<string>>(new Set());

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

  // Forward projection: revenue settings persist server-side; the controls drive saved settings.
  const projection = useQuery<ProjResp>({ queryKey: ["/api/finances/projection"] });
  const [growth, setGrowth] = useState("");
  const [asmEdits, setAsmEdits] = useState<Record<string, string>>({});
  const saveSettings = useMutation({
    mutationFn: async (body: { baseMethod?: string; growthPct?: number }) =>
      (await apiRequest("PUT", "/api/finances/projection-settings", body)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/finances/projection"] }),
    onError: (e: Error) => toast({ title: "Couldn't save settings", description: e.message, variant: "destructive" }),
  });
  const saveAssumption = useMutation({
    mutationFn: async (body: { account: string; driver: string; ratePct?: number | null; fixedAmount?: number | null }) =>
      (await apiRequest("PUT", "/api/finances/projection-assumption", body)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/finances/projection"] }),
    onError: (e: Error) => toast({ title: "Couldn't save assumption", description: e.message, variant: "destructive" }),
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

      {/* Savings opportunities — the ranked cuts */}
      {data.opportunities.length > 0 && (
        <Card className="border-2 border-amber-300 dark:border-amber-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Scissors className="h-4 w-4" /> Savings opportunities — where to cut</CardTitle>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-green-700 dark:text-green-400">{money(s.actionableAnnualSavings)}/yr</span> open &amp; controllable now ·
              {" "}<span className="font-semibold text-blue-700 dark:text-blue-400">{money(s.inProgressAnnualSavings)}/yr</span> already in progress ·
              {" "}{money(s.potentialAnnualSavings)}/yr total identified{s.pctOfLossClosed != null && <> vs the {money(-s.annualizedNetIncome)}/yr loss</>}.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {data.opportunities.map((o, i) => {
                const sel = selectedCuts.has(o.category);
                return (
                  <div key={o.category} className={`px-2 py-1.5 rounded text-sm ${sel ? "bg-green-50 dark:bg-green-950/20" : "hover-elevate"}`} data-testid={`opp-${o.category}`}>
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={sel} onChange={() => setSelectedCuts((prev) => { const n = new Set(prev); if (n.has(o.category)) n.delete(o.category); else n.add(o.category); return n; })} className="h-3.5 w-3.5 shrink-0 accent-green-600" data-testid={`cut-${o.category}`} />
                      <span className="w-4 text-xs text-muted-foreground text-right">{i + 1}</span>
                      <span className="flex-1 min-w-0 truncate flex items-center gap-1.5">{o.category}<StatusBadge status={o.status} /></span>
                      <span className="w-24 text-right text-xs text-muted-foreground hidden sm:inline">{o.currentPct != null ? `${o.currentPct}%` : "—"} → {o.targetPct != null ? `${o.targetPct}%` : "—"}</span>
                      <span className="w-24 text-right tabular-nums font-semibold text-green-600 dark:text-green-400">{money(o.annualOver)}/yr</span>
                    </div>
                    {o.note && <div className="pl-9 text-[11px] text-muted-foreground">{o.note}</div>}
                  </div>
                );
              })}
            </div>

            {/* Cut simulator — live impact of the selected cuts on the annual loss */}
            {selectedCuts.size > 0 && (() => {
              const selectedSavings = data.opportunities.filter((o) => selectedCuts.has(o.category)).reduce((sum, o) => sum + o.annualOver, 0);
              const projected = s.annualizedNetIncome + selectedSavings;
              const loss = -s.annualizedNetIncome;
              const pctClosed = loss > 0 ? Math.min(100, (selectedSavings / loss) * 100) : null;
              return (
                <div className="mt-3 rounded-lg border-2 border-green-300 bg-green-50 p-3 dark:border-green-900/40 dark:bg-green-950/20">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium flex items-center gap-2"><Scissors className="h-4 w-4" /> Cut simulator — {selectedCuts.size} selected</div>
                    <button className="text-[11px] text-muted-foreground underline" onClick={() => setSelectedCuts(new Set())}>clear</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                    <div><div className="text-[11px] text-muted-foreground">Annual savings</div><div className="font-bold text-green-700 dark:text-green-400">{money(selectedSavings)}</div></div>
                    <div><div className="text-[11px] text-muted-foreground">Net income becomes</div><div className={`font-bold ${projected < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>{money(projected)}/yr</div></div>
                    <div><div className="text-[11px] text-muted-foreground">Loss closed</div><div className="font-bold">{pctClosed != null ? `${Math.round(pctClosed)}%` : "—"}{projected >= 0 && loss > 0 && " · breakeven"}</div></div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">{projected >= 0 ? "These cuts get SBR to breakeven on an annualized basis." : `Still ${money(-projected)}/yr short of breakeven — select more cuts or grow revenue.`}</p>
                </div>
              );
            })()}

            <p className="text-[11px] text-muted-foreground pt-2">Check the cuts you'd make to model the impact. Green badges are open cuts you can take now; blue are already in progress (marketing restart, contract-labor cuts, loan refi).</p>
          </CardContent>
        </Card>
      )}

      {/* Top vendors & fulfillment spotlight */}
      {vendorsView.data && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Truck className="h-4 w-4" /> Top vendors &amp; fulfillment</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {vendorsView.data.fulfillment && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs font-medium text-muted-foreground mb-1">Pyvott fulfillment</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <div><div className="text-[11px] text-muted-foreground">Spend</div><div className="font-semibold">{money(vendorsView.data.fulfillment.amount)}</div></div>
                  <div><div className="text-[11px] text-muted-foreground">Per month</div><div className="font-semibold">{money(vendorsView.data.fulfillment.monthlyAvg)}</div></div>
                  <div><div className="text-[11px] text-muted-foreground">Cost / order</div><div className="font-semibold">{vendorsView.data.fulfillment.costPerOrder != null ? money(vendorsView.data.fulfillment.costPerOrder) : "—"}</div></div>
                  <div><div className="text-[11px] text-muted-foreground">% of net sales</div><div className="font-semibold">{vendorsView.data.fulfillment.pctOfNetSales != null ? `${vendorsView.data.fulfillment.pctOfNetSales}%` : "—"}</div></div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">~90% of this is carrier postage you'd pay anywhere; the ~10% of fees (incl. the storage charge) is the cuttable part. The pull-behind in-house split recovers ~$22K/yr of freight premium.</p>
              </div>
            )}
            <div className="space-y-0.5">
              {vendorsView.data.vendors.map((v) => (
                <div key={v.vendor} className="flex items-center gap-3 px-2 py-1 text-sm" data-testid={`vendor-${v.vendor}`}>
                  <span className="flex-1 min-w-0 truncate">{v.vendor}<span className="text-muted-foreground text-xs"> · {v.topAccount}</span></span>
                  <span className="w-16 text-right text-[11px] text-muted-foreground">{v.pctOfNetSales != null ? `${v.pctOfNetSales}%` : ""}</span>
                  <span className="w-20 text-right tabular-nums font-medium">{money(v.amount)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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

      {/* Forward 12-month projection — path to breakeven */}
      {projection.data?.success && (() => {
        const p = projection.data;
        const ps = p.summary;
        const maxAbs = Math.max(...p.forecast.map((m) => Math.abs(m.netIncome)), 1);
        const be = ps.firstProfitableMonth;
        const setDriver = (c: ProjCategory, driver: "variable" | "fixed") => {
          setAsmEdits((pp) => { const n = { ...pp }; delete n[c.account]; return n; });
          saveAssumption.mutate(driver === "variable"
            ? { account: c.account, driver, ratePct: c.ratePct ?? c.trailingPctOfSales ?? 0 }
            : { account: c.account, driver, fixedAmount: c.fixedAmount ?? c.trailingMonthlyAvg });
        };
        return (
          <Card className="border-2 border-indigo-300 dark:border-indigo-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><LineChart className="h-4 w-4" /> Forward 12-month projection — path to breakeven</CardTitle>
              <p className="text-xs text-muted-foreground">Each category projected off the trailing 12 months (variable = % of forecast sales, fixed = $/mo). Forecast starts {fmtFull(p.startMonth)}.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">Revenue base</div>
                  <div className="flex gap-1">
                    {([["trailing3", "3-mo avg"], ["trailing6", "6-mo avg"], ["lastMonth", "last mo"]] as const).map(([v, l]) => (
                      <button key={v} onClick={() => saveSettings.mutate({ baseMethod: v })}
                        className={`rounded px-2 py-1 text-xs border ${p.baseMethod === v ? "bg-foreground text-background" : "hover-elevate"}`} data-testid={`base-${v}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">Growth %/mo</div>
                  <Input type="number" step="0.5" className="h-7 w-20 text-right text-xs"
                    value={growth !== "" ? growth : String(p.growthPct ?? 0)}
                    onChange={(e) => setGrowth(e.target.value)}
                    onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== p.growthPct) saveSettings.mutate({ growthPct: v }); }}
                    data-testid="growth-input" />
                </div>
                <div className="text-xs text-muted-foreground pb-1.5">Base <span className="font-semibold text-foreground">{money(p.revenueBase)}</span>/mo</div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Tile label="Proj. annual revenue" value={money(ps.annualRevenue)} sub="next 12 mo" />
                <Tile label="Proj. annual net income" value={money(ps.annualNetIncome)} sub={ps.netMarginPct != null ? `${ps.netMarginPct}% margin` : ""} alert={ps.annualNetIncome < 0} />
                <Tile label="Avg / month" value={money(ps.avgMonthlyNetIncome)} alert={ps.avgMonthlyNetIncome < 0} />
                <Tile label="Turns profitable" value={be ? fmtFull(be) : "not in 12 mo"} sub={be ? "first profitable month" : "raise growth or cut costs"} alert={!be} />
              </div>

              {p.reclassification.length > 0 && (
                <p className="text-[11px] text-muted-foreground">Honest classification: {money(p.reclassification.reduce((s, r) => s + r.trailingAmount, 0))} of Zo&apos;s pay (Lucid Earth + Gamerzdojo) was pulled out of marketing/charity into Owner Compensation before projecting, so a %-of-sales line never scales fixed pay with revenue.</p>
              )}

              <div className="space-y-1">
                {p.forecast.map((m) => {
                  const loss = m.netIncome < 0;
                  const isBE = m.month === be;
                  return (
                    <div key={m.month} className={`flex items-center gap-2 text-sm px-1 rounded ${isBE ? "bg-green-50 dark:bg-green-950/20" : ""}`} data-testid={`proj-${m.month}`}>
                      <span className="w-14 text-xs text-muted-foreground">{fmtFull(m.month)}</span>
                      <div className="flex-1 flex items-center">
                        <div className="w-1/2 flex justify-end">{loss && <div className="h-3 bg-red-500 rounded-l" style={{ width: `${(Math.abs(m.netIncome) / maxAbs) * 100}%` }} />}</div>
                        <div className="w-1/2">{!loss && <div className="h-3 bg-green-500 rounded-r" style={{ width: `${(m.netIncome / maxAbs) * 100}%` }} />}</div>
                      </div>
                      <span className={`w-20 text-right tabular-nums font-medium ${loss ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>{money(m.netIncome)}</span>
                      <span className="w-20 text-right text-[11px] text-muted-foreground hidden sm:inline">cum {money(m.cumulativeNetIncome)}</span>
                    </div>
                  );
                })}
              </div>

              <div>
                <div className="flex items-center gap-3 px-2 pb-1 text-[11px] font-medium text-muted-foreground">
                  <span className="flex-1">Category</span><span className="text-right">Driver / rate</span><span className="text-right w-14">Trailing</span><span className="text-right w-24">Proj. annual</span>
                </div>
                {p.categories.map((c) => (
                  <div key={c.account} className="flex items-center gap-3 px-2 py-1 rounded hover-elevate text-sm" data-testid={`pcat-${c.account}`}>
                    <span className="flex-1 truncate min-w-0">{c.account}{c.account === OWNER_COMP_LABEL && <span className="ml-1 rounded bg-amber-100 dark:bg-amber-950/40 px-1 text-[10px] text-amber-700 dark:text-amber-300">reclassified</span>}</span>
                    <span className="flex items-center justify-end gap-1">
                      <button onClick={() => setDriver(c, "variable")} className={`rounded px-1.5 py-0.5 text-[10px] border ${c.driver === "variable" ? "bg-foreground text-background" : "hover-elevate"}`}>% sales</button>
                      <button onClick={() => setDriver(c, "fixed")} className={`rounded px-1.5 py-0.5 text-[10px] border ${c.driver === "fixed" ? "bg-foreground text-background" : "hover-elevate"}`}>fixed</button>
                      {c.driver === "variable" ? (
                        <Input type="number" step="0.5" className="h-6 w-14 text-right text-xs px-1"
                          value={asmEdits[c.account] ?? (c.ratePct != null ? String(c.ratePct) : "")}
                          onChange={(e) => setAsmEdits((pp) => ({ ...pp, [c.account]: e.target.value }))}
                          onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== c.ratePct) saveAssumption.mutate({ account: c.account, driver: "variable", ratePct: v }); }} />
                      ) : (
                        <Input type="number" step="100" className="h-6 w-20 text-right text-xs px-1"
                          value={asmEdits[c.account] ?? (c.fixedAmount != null ? String(c.fixedAmount) : "")}
                          onChange={(e) => setAsmEdits((pp) => ({ ...pp, [c.account]: e.target.value }))}
                          onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== c.fixedAmount) saveAssumption.mutate({ account: c.account, driver: "fixed", fixedAmount: v }); }} />
                      )}
                    </span>
                    <span className="w-14 text-right tabular-nums text-muted-foreground">{c.trailingPctOfSales != null ? `${c.trailingPctOfSales}%` : "—"}</span>
                    <span className="w-24 text-right tabular-nums font-medium">{money(c.annualTotal)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">Toggle each line between %-of-sales and fixed and edit its rate. Variable lines scale with the revenue forecast; fixed lines stay flat. The green row is the first month SBR turns profitable.</p>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    open: { label: "open", cls: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300" },
    in_progress: { label: "in progress", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
    structural: { label: "structural", cls: "bg-muted text-muted-foreground" },
    fixed: { label: "fixed", cls: "bg-muted text-muted-foreground" },
  };
  const m = map[status] ?? map.open;
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
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
