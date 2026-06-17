import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { FlaskConical, RotateCcw, Scissors, ChevronRight } from "lucide-react";
import { deriveModel, projectScenario, runwayDays, runwayDaysFromCut, type MonthPoint } from "@/lib/projection";

/**
 * CIPH.R — Profit & Savings Playground.
 * Models next-month revenue/profit/runway from a planned ad budget + expense
 * change, fit from the seeded P&L history, and ranks the fastest expense cuts to
 * extend runway. The ad→revenue model is a simple blended fit (incl. organic),
 * clearly labeled — not a causal guarantee.
 */

interface MonthlyRow {
  month: string;
  totalIncome: string | null;
  grossProfit: string | null;
  totalExpenses: string | null;
  netIncome: string | null;
  expenseCategories: Record<string, number> | null;
}

interface VendorAgg { payee: string; total: number; count: number; }
interface AccountAgg { account: string; total: number; txnCount: number; vendors: VendorAgg[]; }
interface ExpenseDetail {
  available?: boolean;
  window?: { start: string; end: string } | null;
  byAccount?: AccountAgg[];
}

const n = (v: any) => (v == null ? 0 : Number(v));
const fmt = (v: number) => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();

export function ProfitPlaygroundCard({ monthly, cash, expenseDetail }: { monthly: MonthlyRow[]; cash: number; expenseDetail?: ExpenseDetail }) {
  // Exclude partial months (labeled like "Jun 2026 (1-13)") from the model fit and
  // the cut rows — a mid-month upload would otherwise show 13-day costs as monthly
  // and drag down the revenue-per-ad-dollar fit.
  const completeMonthly = useMemo(() => monthly.filter((m) => !m.month.includes("(")), [monthly]);
  const points: MonthPoint[] = useMemo(
    () =>
      completeMonthly.map((m) => ({
        adSpend: n(m.expenseCategories?.["Advertising & Marketing"]),
        revenue: n(m.totalIncome),
        grossProfit: m.grossProfit == null ? null : n(m.grossProfit),
        totalExpenses: m.totalExpenses == null ? null : n(m.totalExpenses),
        netIncome: m.netIncome == null ? null : n(m.netIncome),
      })),
    [completeMonthly],
  );
  const model = useMemo(() => deriveModel(points, 12), [points]);

  const recentAd = points.slice(-3).map((p) => p.adSpend).filter((x) => x > 0);
  const defaultAd = recentAd.length ? Math.round(recentAd.reduce((s, v) => s + v, 0) / recentAd.length / 1000) * 1000 : 50000;
  const maxAd = Math.max(200000, ...points.map((p) => p.adSpend)) ;

  const [adBudget, setAdBudget] = useState(defaultAd);
  const [expensePct, setExpensePct] = useState(0);
  const dirty = adBudget !== defaultAd || expensePct !== 0;

  // Map QB expense-detail accounts to the cut rows so a category can expand into
  // the actual vendors behind it ("which subscription to cut").
  const [openCut, setOpenCut] = useState<string | null>(null);
  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const vendorsByAccount = useMemo(() => {
    const m = new Map<string, AccountAgg>();
    for (const a of expenseDetail?.byAccount ?? []) m.set(normName(a.account), a);
    return m;
  }, [expenseDetail]);

  const proj = projectScenario(model, adBudget, expensePct);
  const projRunway = runwayDays(cash, proj.netIncome);

  // current burn = 3-mo avg net loss; fastest cuts from latest month categories
  const burn3 = (() => {
    const ni = points.slice(-3).map((p) => p.netIncome ?? 0).map((x) => -x);
    return ni.length ? ni.reduce((s, v) => s + v, 0) / ni.length : 0;
  })();
  const lastCats = completeMonthly[completeMonthly.length - 1]?.expenseCategories ?? {};
  const cuts = Object.entries(lastCats)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, v]) => ({ name, monthly: v, daysIfCut: runwayDaysFromCut(cash, burn3, v) }));

  const Stat = ({ label, value, tone = "" }: { label: string; value: string; tone?: string }) => (
    <div className="flex-1 text-center">
      <div className={`text-lg font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );

  return (
    <Card data-testid="card-profit-playground">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><FlaskConical className="h-4 w-4" /> Profit &amp; Savings Playground</CardTitle>
        {dirty && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setAdBudget(defaultAd); setExpensePct(0); }} data-testid="button-playground-reset">
            <RotateCcw className="h-3 w-3 mr-1" /> Reset
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* projected outcome */}
        <div className="flex items-stretch gap-2 rounded-lg border p-3 bg-muted/30">
          <Stat label="Proj. Revenue / mo" value={fmt(proj.revenue)} />
          <Stat label="Gross Profit" value={fmt(proj.grossProfit)} />
          <Stat label="Net Income / mo" value={fmt(proj.netIncome)} tone={proj.netIncome < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"} />
          <Stat label="Runway" value={projRunway == null ? "Cash-flow +" : `${(projRunway / 30.4).toFixed(1)} mo`} tone={projRunway != null && projRunway < 60 ? "text-red-600 dark:text-red-400" : ""} />
        </div>

        {/* levers */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs mb-1"><span>Monthly Ad Budget</span><span className="tabular-nums font-medium">{fmt(adBudget)}</span></div>
            <Slider value={[adBudget]} onValueChange={([v]) => setAdBudget(v)} min={0} max={maxAd} step={5000} data-testid="slider-ad-budget" />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs mb-1"><span>Non-Ad Expenses</span><span className="tabular-nums font-medium">{expensePct > 0 ? "+" : ""}{expensePct}%</span></div>
            <Slider value={[expensePct]} onValueChange={([v]) => setExpensePct(v)} min={-50} max={50} step={5} data-testid="slider-expense-pct" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Model (last {model.basisMonths} mo): organic baseline {fmt(model.intercept)}/mo + {model.revPerAdDollar.toFixed(2)}× revenue per ad $, {Math.round(model.grossMarginPct * 100)}% gross margin, {fmt(model.avgNonAdExpenses)}/mo non-ad expenses. Simple blended estimate — not a causal guarantee.
          </p>
        </div>

        {/* fastest savings */}
        {burn3 > 0 && cuts.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1.5"><Scissors className="h-3 w-3" /> Fastest ways to extend runway (cut a recurring cost)</div>
            <div className="space-y-1">
              {cuts.map((c) => {
                const acct = vendorsByAccount.get(normName(c.name));
                const isOpen = openCut === c.name;
                return (
                  <div key={c.name}>
                    <div
                      className={`flex items-center justify-between text-xs ${acct ? "cursor-pointer hover:text-foreground" : ""}`}
                      onClick={() => acct && setOpenCut(isOpen ? null : c.name)}
                      data-testid={`cut-${c.name}`}
                    >
                      <span className="truncate pr-2 flex items-center gap-1">
                        {acct ? (
                          <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        ) : (
                          <span className="w-3 shrink-0" />
                        )}
                        {c.name} <span className="text-muted-foreground">({fmt(c.monthly)}/mo)</span>
                      </span>
                      <span className="text-green-600 dark:text-green-400 whitespace-nowrap font-medium">+{c.daysIfCut} days</span>
                    </div>
                    {isOpen && acct && (
                      <div className="ml-4 mt-1 mb-1.5 space-y-0.5 border-l pl-2" data-testid={`cut-detail-${c.name}`}>
                        {acct.vendors.slice(0, 12).map((v) => (
                          <div key={v.payee} className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span className="truncate pr-2">{v.payee} <span className="opacity-60">({v.count}×)</span></span>
                            <span className="tabular-nums whitespace-nowrap">{fmt(v.total)}</span>
                          </div>
                        ))}
                        {expenseDetail?.window && (
                          <div className="text-[10px] opacity-60 pt-0.5">
                            QuickBooks charges {expenseDetail.window.start} → {expenseDetail.window.end} · total over window, not per month
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Extra runway if that monthly cost were eliminated, at the current {fmt(burn3)}/mo burn.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
