/**
 * SeasonalDemandCard — the company's year at a glance.
 *
 * Paints the seasonal demand index (12 monthly multipliers) as a gradient area
 * curve, marks where we are right now, and calls out the peak/trough. This is
 * the picture behind the reorder engine's seasonal adjustment — spring + fall
 * run hot, summer/winter run cold.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, ReferenceDot,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarRange, ArrowUp, ArrowDown } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function SeasonalDemandCard() {
  const { data, isLoading } = useQuery<{ index: number[]; basis?: string }>({
    queryKey: ["/api/reorder/seasonal-index"],
  });
  const idx = data?.index;
  if (isLoading || !idx || idx.length !== 12) return null;

  const nowMonth = new Date().getMonth(); // 0-11
  const chartData = idx.map((v, i) => ({ month: MONTHS[i], factor: Math.round(v * 100) / 100, i }));
  const max = Math.max(...idx);
  const min = Math.min(...idx);
  const peakI = idx.indexOf(max);
  const troughI = idx.indexOf(min);
  const nowFactor = idx[nowMonth];

  return (
    <Card data-testid="card-seasonal-demand">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4" />
          Seasonal demand — your year at a glance
        </CardTitle>
        <CardDescription>
          How demand swings month to month. Reorder anticipates these peaks so you don't get caught short.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span className="flex items-center gap-1">
            <ArrowUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-muted-foreground">Peak</span>
            <span className="font-semibold">{MONTHS[peakI]} {max.toFixed(1)}×</span>
          </span>
          <span className="flex items-center gap-1">
            <ArrowDown className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
            <span className="text-muted-foreground">Low</span>
            <span className="font-semibold">{MONTHS[troughI]} {min.toFixed(1)}×</span>
          </span>
          <span className="ml-auto text-muted-foreground">
            Now ({MONTHS[nowMonth]}): <span className="font-semibold text-foreground">{nowFactor.toFixed(2)}×</span> avg
          </span>
        </div>

        <div className="h-44 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="seasonalFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval={0} minTickGap={2} />
              <YAxis
                tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={40}
                domain={[0, (dataMax: number) => Math.ceil(dataMax * 10) / 10 + 0.1]}
                tickFormatter={(v) => `${v}×`}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(value: number) => [`${value}× average`, "Demand"]}
              />
              <ReferenceLine
                y={1} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3"
                label={{ value: "avg", fontSize: 10, fill: "hsl(var(--muted-foreground))", position: "insideLeft" }}
              />
              <Area
                type="monotone" dataKey="factor" stroke="hsl(var(--primary))" strokeWidth={2}
                fill="url(#seasonalFill)" dot={{ r: 2 }} activeDot={{ r: 4 }} isAnimationActive={false}
              />
              <ReferenceDot
                x={MONTHS[nowMonth]} y={chartData[nowMonth].factor} r={5}
                fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <p className="text-[11px] text-muted-foreground">
          1.0× = an average month. {data?.basis}
        </p>
      </CardContent>
    </Card>
  );
}
