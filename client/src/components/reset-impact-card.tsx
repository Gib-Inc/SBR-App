import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * Reset Impact — since the May reset, are losses per month shrinking and is ROAS
 * improving? Live from /api/finances/reset-impact (GL by month + corrected ad spend).
 */
interface Month {
  month: string; partial: boolean;
  netSales: number; grossMarginPct: number | null;
  netIncome: number; netMarginPct: number | null;
  adSpend: number | null; blendedMer: number | null;
}
interface PaceSide { label: string; netSales: number; netIncome: number; adSpend: number | null; blendedMer: number | null }
interface Resp {
  success: boolean;
  months: Month[];
  pace: { throughDay: number; current: PaceSide; prior: PaceSide; delta: { netSales: number; netIncome: number; blendedMer: number | null }; currentDataPending: boolean } | null;
  lossTrend?: {
    completeMonths: number; negativeCount: number; allNegative: boolean;
    latest: { month: string; netIncome: number } | null;
    baseline: { month: string; netIncome: number } | null;
    monthsBetween: number; improvedBy: number | null;
    direction: "improving" | "worsening" | "flat" | "unknown";
  };
  asOf: string; postedThrough: string | null; notes: string[];
}

const money = (v: number | null | undefined) => (v == null ? "—" : (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US"));
const pctOf = (v: number | null) => (v == null ? "—" : `${v}%`);
const mer = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}×`);
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]} ${y}`;
};
const Delta = ({ v, good = "up", fmt }: { v: number | null; good?: "up" | "down"; fmt: (x: number) => string }) => {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const positive = v > 0;
  const isGood = good === "up" ? positive : !positive;
  const Icon = v === 0 ? Minus : positive ? TrendingUp : TrendingDown;
  const tone = v === 0 ? "text-muted-foreground" : isGood ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return <span className={`inline-flex items-center gap-1 ${tone}`}><Icon className="h-3.5 w-3.5" />{(positive ? "+" : "") + fmt(v)}</span>;
};

export function ResetImpactCard() {
  const { data } = useQuery<Resp>({ queryKey: ["/api/finances/reset-impact"] });
  if (!data?.months?.length) return null;
  const p = data.pace;
  const lt = data.lossTrend;
  const maxAbsNi = Math.max(...data.months.map((m) => Math.abs(m.netIncome)), 1);

  return (
    <Card data-testid="card-reset-impact">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Reset Impact — is it working?</CardTitle>
        <CardDescription>Since the May reset: losses per month and blended MER, straight from the GL. Updates as data flows in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {lt?.latest && (
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div className="text-sm font-semibold">
                {lt.allNegative
                  ? `Net loss every month — ${lt.completeMonths} of ${lt.completeMonths}`
                  : `${lt.negativeCount} of ${lt.completeMonths} months at a loss`}
              </div>
              {lt.improvedBy != null && lt.baseline ? (
                <span className={`inline-flex items-center gap-1 text-sm font-medium ${lt.direction === "improving" ? "text-emerald-600 dark:text-emerald-400" : lt.direction === "worsening" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                  {lt.direction === "improving" ? <TrendingUp className="h-4 w-4" /> : lt.direction === "worsening" ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                  {lt.direction === "improving"
                    ? `${money(lt.improvedBy)} less in the red vs ${monthLabel(lt.baseline.month)}`
                    : lt.direction === "worsening"
                      ? `${money(lt.improvedBy)} deeper vs ${monthLabel(lt.baseline.month)}`
                      : `flat vs ${monthLabel(lt.baseline.month)}`}
                </span>
              ) : null}
            </div>
            {/* Net-income bars: red below the zero line = loss, green above = profit */}
            <div className="flex items-stretch gap-1">
              {data.months.map((m) => {
                const h = Math.max(2, Math.round((Math.abs(m.netIncome) / maxAbsNi) * 40));
                const loss = m.netIncome < 0;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center" title={`${monthLabel(m.month)}: ${money(m.netIncome)}${m.partial ? " (MTD)" : ""}`}>
                    <div className="flex h-11 w-full flex-col justify-end items-center">
                      {!loss && <div className="w-3/5 rounded-t bg-emerald-500" style={{ height: `${h}px` }} />}
                    </div>
                    <div className="h-px w-full bg-border" />
                    <div className="flex h-11 w-full flex-col justify-start items-center">
                      {loss && <div className={`w-3/5 rounded-b ${m.partial ? "bg-red-300 dark:bg-red-900" : "bg-red-500"}`} style={{ height: `${h}px` }} />}
                    </div>
                    <div className="text-[9px] text-muted-foreground mt-0.5 whitespace-nowrap">{monthLabel(m.month).slice(0, 3)}{m.partial ? "*" : ""}</div>
                  </div>
                );
              })}
            </div>
            {lt.latest ? (
              <div className="text-[11px] text-muted-foreground mt-1.5">
                Latest full month {monthLabel(lt.latest.month)}: <span className={lt.latest.netIncome < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>{money(lt.latest.netIncome)}</span>. Bars are monthly net income (red = loss); * = current month-to-date.
              </div>
            ) : null}
          </div>
        )}
        {p && (
          <div className="rounded-lg border p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              {monthLabel(p.current.label)} through day {p.throughDay} vs {monthLabel(p.prior.label)} same range (apples to apples)
            </div>
            {p.currentDataPending ? (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                {monthLabel(p.current.label)} GL data is still posting from QuickBooks — the pace comparison fills in as transactions post. ({monthLabel(p.prior.label)} same range: net sales {money(p.prior.netSales)}, net income {money(p.prior.netIncome)}.)
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Net sales</div>
                  <div className="font-semibold tabular-nums">{money(p.current.netSales)}</div>
                  <Delta v={p.delta.netSales} good="up" fmt={money} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Net income</div>
                  <div className="font-semibold tabular-nums">{money(p.current.netIncome)}</div>
                  <Delta v={p.delta.netIncome} good="up" fmt={money} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Blended MER</div>
                  <div className="font-semibold tabular-nums">{mer(p.current.blendedMer)}</div>
                  <Delta v={p.delta.blendedMer} good="up" fmt={(x) => `${x.toFixed(2)}×`} />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Month</th>
                <th className="px-2 py-1.5 text-right font-medium">Net sales</th>
                <th className="px-2 py-1.5 text-right font-medium">Gross margin</th>
                <th className="px-2 py-1.5 text-right font-medium">Net income</th>
                <th className="px-2 py-1.5 text-right font-medium">Net margin</th>
                <th className="px-2 py-1.5 text-right font-medium">Ad spend</th>
                <th className="px-2 py-1.5 text-right font-medium">Blended MER</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.months.map((m) => (
                <tr key={m.month} data-testid={`reset-month-${m.month}`}>
                  <td className="px-3 py-1.5">{monthLabel(m.month)}{m.partial ? <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">MTD</span> : null}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(m.netSales)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pctOf(m.grossMarginPct)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${m.netIncome < 0 ? "text-red-600 dark:text-red-400" : m.netIncome > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{money(m.netIncome)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pctOf(m.netMarginPct)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(m.adSpend)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{mer(m.blendedMer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data.notes?.length ? (
          <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
            {data.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
