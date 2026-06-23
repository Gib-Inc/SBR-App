/**
 * YoYCard — are we up or down vs last year, on sales AND ad spend?
 *
 * Same-period normalized (this year-to-date vs the matching slice of last year),
 * so a partial current year compares fairly. Four KPI tiles + two this-vs-last
 * line charts. The story it tells: sales can be up while ad spend is up more and
 * ROAS slides — which is exactly the thing to catch.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarClock, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface YoYMetric { thisYear: number; lastYear: number; deltaPct: number | null; }
interface YoY {
  thisYear: number; lastYear: number; throughMonth: number; throughLabel: string;
  revenue: YoYMetric; adSpend: YoYMetric;
  netIncome: { thisYear: number; lastYear: number };
  roas: { thisYear: number | null; lastYear: number | null };
  monthly: { month: number; label: string; revThis: number | null; revLast: number | null; adThis: number | null; adLast: number | null }[];
}

function money(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}

function DeltaBadge({ pct, goodWhen = "up" }: { pct: number | null; goodWhen?: "up" | "down" | "neutral" }) {
  if (pct == null) return null;
  const up = pct >= 0;
  const good = goodWhen === "neutral" ? null : goodWhen === "up" ? up : !up;
  const cls = good == null
    ? "text-amber-600 dark:text-amber-400"
    : good
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" />{up ? "+" : ""}{pct}%
    </span>
  );
}

function Tile({ label, value, sub, badge }: { label: string; value: string; sub?: string; badge?: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {badge}
      </div>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function YoYLineChart({ data, thisKey, lastKey, thisYear, lastYear }: {
  data: any[]; thisKey: string; lastKey: string; thisYear: number; lastYear: number;
}) {
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval={0} minTickGap={2} />
          <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={42} tickFormatter={(v) => money(v)} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => money(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
          <Line type="monotone" name={`${lastYear}`} dataKey={lastKey} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
          <Line type="monotone" name={`${thisYear}`} dataKey={thisKey} stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 2 }} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function YoYCard() {
  const { data, isLoading } = useQuery<YoY>({ queryKey: ["/api/finances/yoy-summary"] });
  if (isLoading || !data) return null;

  const roasThis = data.roas.thisYear;
  const roasLast = data.roas.lastYear;
  const roasDelta = roasThis != null && roasLast != null && roasLast !== 0
    ? Math.round(((roasThis - roasLast) / roasLast) * 1000) / 10 : null;

  return (
    <Card data-testid="card-yoy">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" />
          Year over year — {data.thisYear} vs {data.lastYear}
        </CardTitle>
        <CardDescription>
          Same period (Jan–{data.throughLabel}) this year vs last. Are sales beating last year, and is spend keeping pace?
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Tile label={`Sales (Jan–${data.throughLabel})`} value={money(data.revenue.thisYear)}
            sub={`vs ${money(data.revenue.lastYear)} last year`} badge={<DeltaBadge pct={data.revenue.deltaPct} goodWhen="up" />} />
          <Tile label="Ad spend" value={money(data.adSpend.thisYear)}
            sub={`vs ${money(data.adSpend.lastYear)} last year`} badge={<DeltaBadge pct={data.adSpend.deltaPct} goodWhen="neutral" />} />
          <Tile label="Blended ROAS" value={roasThis != null ? `${roasThis}×` : "—"}
            sub={roasLast != null ? `vs ${roasLast}× last year` : undefined} badge={<DeltaBadge pct={roasDelta} goodWhen="up" />} />
          <Tile label="Net income" value={money(data.netIncome.thisYear)}
            sub={`vs ${money(data.netIncome.lastYear)} last year`} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-2">
            <p className="mb-1 px-1 text-xs text-muted-foreground">Sales by month</p>
            <YoYLineChart data={data.monthly} thisKey="revThis" lastKey="revLast" thisYear={data.thisYear} lastYear={data.lastYear} />
          </div>
          <div className="rounded-lg border p-2">
            <p className="mb-1 px-1 text-xs text-muted-foreground">Ad spend by month</p>
            <YoYLineChart data={data.monthly} thisKey="adThis" lastKey="adLast" thisYear={data.thisYear} lastYear={data.lastYear} />
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Blended (all channels) from the QuickBooks monthly P&amp;L. Per-channel YoY isn't available — channel-level spend only starts mid-{data.lastYear}.
        </p>
      </CardContent>
    </Card>
  );
}
