/**
 * PathToProfitabilityCard — the standard to success. Sliders for blended ROAS and
 * "beat last year by %" recompute the full-year net live, off the real cost model
 * (COGS %, fixed monthly nut, YTD actuals). Highlights the breakeven ROAS: the
 * efficiency you must hit to finish the year in the black at a given revenue.
 */
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Target, TrendingUp, TrendingDown } from "lucide-react";

interface Model {
  thisYear: number; ytdThroughMonth: number; cogsPct: number; fixedMonthly: number;
  currentRoas: number | null; ytdNet: number; ytdRevenue: number;
  remainingMonths: { month: number; label: string; lastYearRevenue: number }[];
}

const money = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString();
const moneyK = (n: number) => (n < 0 ? "-$" : "$") + Math.round(Math.abs(n) / 1000) + "K";

export function PathToProfitabilityCard() {
  const { data: model } = useQuery<Model>({ queryKey: ["/api/finances/profitability-model"] });
  const [roas, setRoas] = useState(3);
  const [outperform, setOutperform] = useState(20);

  useEffect(() => {
    if (model?.currentRoas) setRoas(Math.round(model.currentRoas * 10) / 10);
  }, [model?.currentRoas]);

  const proj = useMemo(() => {
    if (!model) return null;
    const mult = 1 + outperform / 100;
    const monthly = model.remainingMonths.map((m) => {
      const rev = m.lastYearRevenue * mult;
      const ad = roas > 0 ? rev / roas : 0;
      return { label: m.label, net: Math.round(rev * (1 - model.cogsPct) - ad - model.fixedMonthly) };
    });
    const remainingNet = monthly.reduce((s, x) => s + x.net, 0);
    const fullYearNet = Math.round(model.ytdNet + remainingNet);
    const R = model.remainingMonths.reduce((s, m) => s + m.lastYearRevenue * mult, 0);
    const denom = model.ytdNet + R * (1 - model.cogsPct) - model.remainingMonths.length * model.fixedMonthly;
    const breakevenRoas = denom > 0 ? Math.round((R / denom) * 100) / 100 : null;
    return { monthly, fullYearNet, breakevenRoas };
  }, [model, roas, outperform]);

  if (!model || !proj) return null;
  const profitable = proj.fullYearNet >= 0;
  const maxAbs = Math.max(1, ...proj.monthly.map((m) => Math.abs(m.net)));

  return (
    <Card data-testid="card-path-to-profitability">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4" /> Path to profitability — the standard</CardTitle>
        <CardDescription>
          Dial in blended ROAS and how much you beat last year. The full-year result updates live off your real cost structure.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sliders */}
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Blended ROAS</span>
              <span className="font-semibold tabular-nums">{roas.toFixed(1)}×{model.currentRoas ? <span className="ml-2 text-xs font-normal text-muted-foreground">now {model.currentRoas}×</span> : null}</span>
            </div>
            <Slider value={[roas]} min={1.5} max={8} step={0.1} onValueChange={(v) => setRoas(v[0])} data-testid="slider-roas" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Beat last year by</span>
              <span className="font-semibold tabular-nums">{outperform > 0 ? "+" : ""}{outperform}%</span>
            </div>
            <Slider value={[outperform]} min={-20} max={50} step={5} onValueChange={(v) => setOutperform(v[0])} data-testid="slider-outperform" />
          </div>
        </div>

        {/* Result */}
        <div className={`rounded-lg border p-3 ${profitable ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30" : "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30"}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Projected {model.thisYear} net</span>
            <span className={`flex items-center gap-1 text-2xl font-bold tabular-nums ${profitable ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`} data-testid="text-fullyear-net">
              {profitable ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              {money(proj.fullYearNet)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {money(model.ytdNet)} actual through month {model.ytdThroughMonth} + the projected rest of the year.
          </p>
        </div>

        {/* Standard to success */}
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm" data-testid="text-standard">
          {proj.breakevenRoas != null ? (
            <p>
              <span className="font-medium">Standard to success:</span> at {outperform > 0 ? "+" : ""}{outperform}% revenue, you need blended ROAS of{" "}
              <span className="font-semibold text-foreground">{proj.breakevenRoas}×</span> to finish {model.thisYear} in the black.
              {model.currentRoas && proj.breakevenRoas > model.currentRoas && (
                <span className="text-muted-foreground"> You're at {model.currentRoas}× — a {Math.round((proj.breakevenRoas / model.currentRoas - 1) * 100)}% efficiency gain.</span>
              )}
            </p>
          ) : (
            <p className="text-amber-700 dark:text-amber-400">At this revenue, no ROAS gets you to full-year profit — you need higher sales. Raise "beat last year."</p>
          )}
        </div>

        {/* Remaining-month net bars */}
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Projected net by month (rest of {model.thisYear})</p>
          <div className="flex items-end gap-1" style={{ height: 60 }}>
            {proj.monthly.map((m) => {
              const h = Math.max(3, (Math.abs(m.net) / maxAbs) * 50);
              const pos = m.net >= 0;
              return (
                <div key={m.label} className="flex flex-1 flex-col items-center justify-end" title={`${m.label}: ${money(m.net)}`}>
                  <div className={`w-full rounded-sm ${pos ? "bg-emerald-500/70" : "bg-red-500/60"}`} style={{ height: h }} />
                  <span className="mt-0.5 text-[10px] text-muted-foreground">{m.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Model: revenue × (1 − {Math.round(model.cogsPct * 100)}% COGS) − revenue/ROAS − {moneyK(model.fixedMonthly)}/mo fixed. Remaining months priced off last year. A model, not a forecast — confirm structure with your accountant.
        </p>
      </CardContent>
    </Card>
  );
}
