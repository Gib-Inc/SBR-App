import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, AlertTriangle, ArrowRight, TrendingUp, TrendingDown, Flag } from "lucide-react";

/**
 * BreakevenScoreboardCard — the single number to manage to. Settled revenue ÷ QB
 * marketing (MER, the breakeven truth) and ÷ ad-platform media (media ROAS), both
 * vs the 5x breakeven. Anchored on the P&L so it doesn't drift like the pixel views.
 */

interface MerMonth { month: string; revenue: number; marketing: number; mer: number | null; vsBreakeven: number | null; belowBreakeven: boolean; netIncome: number | null; isRestart: boolean; }
interface Trajectory { restartMonth: string; preRestartAvgMer: number | null; postRestartAvgMer: number | null; trailingMer: number | null; gapToBreakeven: number | null; improving: boolean | null; }
interface Resp {
  success: boolean; breakeven: number; restartMonth: string; trajectory: Trajectory; monthly: MerMonth[]; monthsBelowBreakeven: number;
  current: { windowDays: number; revenue: number; mediaSpend: number; qbRunRate: number | null; mediaRoas: number | null; merEstimate: number | null; agencyGap: number | null; qbPending: boolean };
}

const money = (n: number) => "$" + Math.round(n).toLocaleString();
const k = (n: number) => (Math.abs(n) >= 1000 ? "$" + (n / 1000).toFixed(1) + "K" : "$" + Math.round(n));
const fmtMonth = (m: string) => { const [y, mo] = m.split("-"); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" }); };

export function BreakevenScoreboardCard() {
  const { data } = useQuery<Resp>({ queryKey: ["/api/marketing/breakeven-scoreboard"] });
  if (!data) return null;
  const c = data.current;
  const be = data.breakeven;
  const tj = data.trajectory;
  const merBelow = c.merEstimate != null && c.merEstimate < be;
  const maxMer = Math.max(be, ...data.monthly.map((m) => m.mer ?? 0), 1);
  const improving = tj.improving === true;

  return (
    <Card className="border-2" data-testid="card-breakeven-scoreboard">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> Breakeven Scoreboard</CardTitle>
        <p className="text-xs text-muted-foreground">The one reconciled number: settled revenue ÷ your real marketing cost, vs the {be}× breakeven. Anchored to QuickBooks, not platform pixels.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Are things improving? — measured from the May restart */}
        <div className={`rounded-lg border p-3 ${improving ? "border-green-300 bg-green-50 dark:border-green-900/40 dark:bg-green-950/20" : "border-muted bg-muted/30"}`}>
          <div className="flex items-center gap-2 text-sm font-medium">
            {improving ? <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" /> : <TrendingDown className="h-4 w-4 text-muted-foreground" />}
            Are things improving since the May restart?
            <span className={improving ? "text-green-700 dark:text-green-300" : "text-muted-foreground"}>{tj.improving == null ? "Not enough data yet" : improving ? "Yes — trending up" : "Not yet"}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Old regime ran <span className="font-semibold text-foreground">{tj.preRestartAvgMer != null ? `${tj.preRestartAvgMer.toFixed(2)}×` : "—"}</span> MER (Kevin in-house, ~$10K/mo). Since the rebuild it&apos;s
            {" "}<span className="font-semibold text-foreground">{tj.trailingMer != null ? `${tj.trailingMer.toFixed(2)}×` : "—"}</span> (Carpe Diem, ~$1.8K/mo) —
            {tj.gapToBreakeven != null && tj.gapToBreakeven > 0
              ? <> still <span className="font-semibold text-amber-700 dark:text-amber-300">{tj.gapToBreakeven.toFixed(2)}× short</span> of the {be}× breakeven.</>
              : <> at/above the {be}× breakeven.</>}
            {" "}Cutting marketing labor ~$8.2K/mo helps, but you need revenue efficiency, not just lower cost, to close the gap. June is provisional until QuickBooks closes the month.
          </p>
        </div>

        {/* Headline: MER vs breakeven, media ROAS beside it */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className={`rounded-xl border-2 p-3 ${merBelow ? "border-red-300 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20" : "border-green-300 bg-green-50 dark:border-green-900/40 dark:bg-green-950/20"}`}>
            <div className="text-xs text-muted-foreground">MER — net sales ÷ all marketing</div>
            <div className={`text-2xl font-bold mt-1 ${merBelow ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
              {c.merEstimate != null ? `${c.merEstimate.toFixed(2)}×` : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {c.merEstimate != null ? (merBelow ? `${(be - c.merEstimate).toFixed(2)}× below the ${be}× breakeven` : `at/above the ${be}× breakeven`) : "QB marketing pending"}
            </div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Media ROAS — ads only</div>
            <div className="text-2xl font-bold mt-1 text-muted-foreground">{c.mediaRoas != null ? `${c.mediaRoas.toFixed(2)}×` : "—"}</div>
            <div className="text-[11px] text-muted-foreground">excludes agency fee — flatters MER</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Net settled sales · {c.windowDays}d</div>
            <div className="text-2xl font-bold mt-1">{k(c.revenue)}</div>
            <div className="text-[11px] text-muted-foreground">net of refunds (Shopify + Amazon)</div>
          </div>
        </div>

        {/* Spend reconciliation — WHY the numbers differ */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">Where your marketing cost actually is</div>
          {c.agencyGap != null && c.agencyGap >= 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded bg-background border px-2 py-1"><span className="text-muted-foreground">Tracker-reported media</span> <span className="font-semibold">{k(c.mediaSpend)}</span></span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="rounded bg-amber-50 border border-amber-200 px-2 py-1 dark:bg-amber-950/30 dark:border-amber-900/40"><span className="text-muted-foreground">+ under-reported &amp; other</span> <span className="font-semibold text-amber-700 dark:text-amber-300">{k(c.agencyGap)}</span></span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="rounded bg-background border px-2 py-1"><span className="text-muted-foreground">= QuickBooks total</span> <span className="font-semibold">{c.qbRunRate != null ? k(c.qbRunRate) : "—"}</span></span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                The tracker reports {k(c.mediaSpend)} of media, but QuickBooks books {c.qbRunRate != null ? k(c.qbRunRate) : "more"}. The {k(c.agencyGap)} gap is ad spend the connector under-reports plus the Carpe Diem fee (~$1.8K) and other marketing. MER divides by the full QuickBooks cost — the honest denominator, and why it sits below the tracker-only media ROAS.
                {c.qbPending && " The current month isn't closed in QuickBooks yet, so MER uses your last verified month as the run-rate."}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Tracker-reported media ({k(c.mediaSpend)}) currently exceeds the last booked QuickBooks marketing month ({c.qbRunRate != null ? k(c.qbRunRate) : "—"}). MER uses the QuickBooks figure as the honest denominator; the current month reconciles once QuickBooks closes it.
            </p>
          )}
        </div>

        {/* Closed-month MER trend vs breakeven */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs font-medium text-muted-foreground">MER by month — net sales ÷ QB marketing, vs {be}× breakeven</div>
            {data.monthsBelowBreakeven > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
                <AlertTriangle className="h-3 w-3" /> {data.monthsBelowBreakeven} of {data.monthly.length} months below breakeven
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {data.monthly.map((m) => (
              <div key={m.month} className={`flex items-center gap-2 text-sm ${m.isRestart ? "pt-1 border-t border-dashed border-blue-300 dark:border-blue-800" : ""}`} data-testid={`mer-month-${m.month}`}>
                <span className="w-14 text-xs text-muted-foreground flex items-center gap-1">
                  {m.isRestart && <Flag className="h-3 w-3 text-blue-500" />}{fmtMonth(m.month)}
                </span>
                <div className="relative flex-1 bg-muted rounded h-4 overflow-hidden">
                  <div className={`h-4 ${m.belowBreakeven ? "bg-red-500" : "bg-green-500"}`} style={{ width: `${Math.min(100, ((m.mer ?? 0) / maxMer) * 100)}%` }} />
                  {/* breakeven marker */}
                  <div className="absolute top-0 h-4 border-r-2 border-foreground/50" style={{ left: `${(be / maxMer) * 100}%` }} title={`${be}× breakeven`} />
                </div>
                <span className={`w-12 text-right tabular-nums font-medium ${m.belowBreakeven ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>{m.mer != null ? `${m.mer.toFixed(2)}×` : "—"}</span>
                <span className="w-16 text-right text-[11px] text-muted-foreground">{m.netIncome != null ? `${m.netIncome < 0 ? "-" : ""}${money(Math.abs(m.netIncome))}` : ""}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground pt-2">
            Net income on the right. You have been running below the {be}× breakeven for months, which is why the P&L shows monthly losses. Platform pixel ROAS (Amazon's 30–50× self-attribution) is directional only and is not used here.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
