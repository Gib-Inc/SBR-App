/**
 * SeasonalSpendForecastCard — the forward inventory-spend view. Projects component
 * purchasing $ for the next months with the seasonal index applied, so the fall
 * peak and the build-up window are visible now (not discovered in September).
 */
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, AlertTriangle } from "lucide-react";

interface Month { month: number; year: number; label: string; seasonalFactor: number; projectedSpend: number; vsBaselinePct: number }
interface Forecast {
  monthly: Month[];
  baselineMonthlySpend: number;
  currentMonth: string;
  peak: { label: string; spend: number; factor: number } | null;
  next3MonthsSpend: number;
  avgLeadDays: number;
  orderByForPeak: { peakLabel: string; orderByLabel: string } | null;
}

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();
const moneyK = (n: number) => "$" + Math.round((n || 0) / 1000) + "K";

export function SeasonalSpendForecastCard() {
  const { data, isLoading } = useQuery<Forecast>({ queryKey: ["/api/finances/seasonal-spend-forecast"] });
  if (isLoading || !data || !data.monthly?.length) return null;

  const peakLabel = data.peak?.label;
  const chartData = data.monthly.map((m) => ({ label: m.label, spend: m.projectedSpend, isPeak: m.label === peakLabel }));

  return (
    <Card data-testid="card-seasonal-spend-forecast">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4" /> Seasonal inventory-spend forecast</CardTitle>
        <CardDescription>
          Projected component purchasing by month, with seasonality applied. This is the fall ramp the reorder list won't show until it's close.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span><span className="text-muted-foreground">Avg month </span><span className="font-semibold">{money(data.baselineMonthlySpend)}</span></span>
          {data.peak && (
            <span>
              <span className="text-muted-foreground">{data.peak.label} peak </span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">{money(data.peak.spend)}</span>
              <span className="text-muted-foreground"> ({data.peak.factor}×)</span>
            </span>
          )}
          <span><span className="text-muted-foreground">Next 3 mo </span><span className="font-semibold">{money(data.next3MonthsSpend)}</span></span>
        </div>

        <div className="h-44 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={42} tickFormatter={moneyK} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                formatter={(v: number) => [money(v), "Projected spend"]}
              />
              <ReferenceLine
                y={data.baselineMonthlySpend} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3"
                label={{ value: "avg", fontSize: 10, fill: "hsl(var(--muted-foreground))", position: "insideTopLeft" }}
              />
              <Bar dataKey="spend" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {chartData.map((d) => (
                  <Cell key={d.label} fill={d.isPeak ? "#d97706" : "hsl(var(--primary))"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {data.orderByForPeak && data.peak && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-amber-800 dark:text-amber-300">
              Your {data.orderByForPeak.peakLabel} peak needs ~{money(data.peak.spend)} in components — over {Math.round(((data.peak.spend / data.baselineMonthlySpend) - 1) * 100)}% above a normal month.
              With ~{Math.round(data.avgLeadDays / 7)}-week lead times plus production, start ordering by <span className="font-semibold">{data.orderByForPeak.orderByLabel}</span>.
            </p>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Deseasonalized current velocity × each month's seasonal index × component cost. Forecast, not a commitment.
        </p>
      </CardContent>
    </Card>
  );
}
