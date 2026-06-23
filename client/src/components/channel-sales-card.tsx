import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingBag } from "lucide-react";

/**
 * ChannelSalesCard — LIVE current-period sales for one channel (Shopify or Amazon),
 * month-to-date. Reads a channel endpoint that queries the app's own sales_orders
 * in store-local time, so it always shows through today. One channel per card so
 * each matches that channel's own admin. Shared body; Shopify/Amazon cards are
 * thin wrappers that pass the endpoint + label.
 */

interface DailyRow { date: string; orders: number; totalSales: number; }
interface Totals { totalSales: number; netSales: number; refunds: number; orders: number; }
interface Metrics {
  days: number; daysInMonth: number; avgDailyTotal: number; avgOrderValue: number;
  bestDay: { date: string; totalSales: number } | null;
  slowestDay: { date: string; totalSales: number } | null;
  projectedMonth: number | null;
}
interface Resp {
  success: boolean; available: boolean; source: string; periodLabel: string;
  periodStart: string; periodEnd: string; currency: string; refreshedAt: string;
  totals: Totals; metrics: Metrics; daily: DailyRow[]; message?: string;
}

const fmt = (v: number) => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();
const dayLabel = (iso: string) => { const p = iso.split("-"); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : iso; };

export function ChannelSalesCard({
  endpoint,
  channelLabel,
  testId,
}: {
  endpoint: string;
  channelLabel: string;
  testId?: string;
}) {
  const { data, isLoading, isError, error } = useQuery<Resp>({ queryKey: [endpoint] });
  const tid = testId ?? `card-${channelLabel.toLowerCase()}-period`;
  if (isLoading) return null;

  // A load failure (500/network) should say so, not silently vanish the card.
  if (isError || !data) {
    return (
      <Card data-testid={tid}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingBag className="h-4 w-4" /> {channelLabel} Sales — Current Period
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Couldn't load {channelLabel} sales{error instanceof Error ? ` — ${error.message}` : ""}.
          </p>
        </CardContent>
      </Card>
    );
  }

  const m = data.metrics;
  const t = data.totals;

  if (!data.available) {
    return (
      <Card data-testid={tid}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingBag className="h-4 w-4" /> {channelLabel} Sales — Current Period
            <span className="text-xs font-normal text-muted-foreground">· {data.periodLabel}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{data.message || `No ${channelLabel} sales this period yet.`}</p>
        </CardContent>
      </Card>
    );
  }

  const maxDay = Math.max(...data.daily.map((d) => d.totalSales), 1);

  return (
    <Card data-testid={tid}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShoppingBag className="h-4 w-4" /> {channelLabel} Sales — Current Period
          <span className="text-xs font-normal text-muted-foreground">· {data.periodLabel}</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{data.source} · {data.currency} · refreshed {data.refreshedAt}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Headline */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Total sales</div>
            <div className="text-lg font-bold mt-1 text-green-600 dark:text-green-400">{fmt(t.totalSales)}</div>
            <div className="text-[11px] text-muted-foreground">{m.days} day{m.days === 1 ? "" : "s"} · {fmt(m.avgDailyTotal)}/day</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Orders</div>
            <div className="text-lg font-bold mt-1">{t.orders.toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground">{fmt(m.avgOrderValue)} avg order</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Best day</div>
            <div className="text-lg font-bold mt-1">{m.bestDay ? fmt(m.bestDay.totalSales) : "—"}</div>
            <div className="text-[11px] text-muted-foreground">{m.bestDay ? dayLabel(m.bestDay.date) : ""}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Projected month</div>
            <div className="text-lg font-bold mt-1 text-blue-600 dark:text-blue-400">{m.projectedMonth != null ? fmt(m.projectedMonth) : "—"}</div>
            <div className="text-[11px] text-muted-foreground">run-rate · {m.daysInMonth}-day month</div>
          </div>
        </div>

        {/* Per-day bars */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Total sales by day</div>
          <div className="space-y-1.5">
            {data.daily.map((d) => (
              <div key={d.date} className="flex items-center gap-2 text-sm" data-testid={`${channelLabel.toLowerCase()}-day-${d.date}`}>
                <span className="w-12 text-xs text-muted-foreground">{dayLabel(d.date)}</span>
                <div className="flex-1 bg-muted rounded h-3.5 overflow-hidden">
                  <div className="h-3.5 bg-blue-500" style={{ width: `${Math.max(2, (d.totalSales / maxDay) * 100)}%` }} />
                </div>
                <span className="w-20 text-right tabular-nums font-medium">{fmt(d.totalSales)}</span>
              </div>
            ))}
          </div>
          {m.bestDay && (
            <p className="text-[11px] text-muted-foreground pt-2">
              Best day {dayLabel(m.bestDay.date)} at {fmt(m.bestDay.totalSales)}. Live from this app's orders — {channelLabel} only, other channels tracked separately.
              {t.refunds > 0 && ` Net of ${fmt(t.refunds)} refunds: ${fmt(t.netSales)}.`}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
