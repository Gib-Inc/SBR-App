import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingBag } from "lucide-react";

/**
 * CIPH.R Finances (piece 4) — current-period Shopify sales snapshot (Jun 1-6).
 * Real numbers from the Shopify "Total sales breakdown" export, with derived
 * daily averages + a per-day bar. Confirms the recent sales lift Matt flagged.
 */

interface Totals {
  grossSales: number; discounts: number; returns: number; netSales: number;
  shippingCharges: number; returnFees: number; taxes: number; totalSales: number;
}
interface DailyRow { date: string; grossSales: number; netSales: number; totalSales: number; }
interface Metrics {
  days: number; avgDailyTotal: number; avgDailyNet: number; avgDailyGross: number;
  discountRatePct: number; returnRatePct: number;
  bestDay: { date: string; totalSales: number } | null;
  slowestDay: { date: string; totalSales: number } | null;
}
interface Period { source: string; periodLabel: string; currency: string; refreshedAt: string; totals: Totals; daily: DailyRow[]; }
interface Resp { success: boolean; shopifyPeriod?: Period; shopifyMetrics?: Metrics; }

const fmt = (v: number) => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();
const dayLabel = (iso: string) => { const p = iso.split("-"); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : iso; };

export function ShopifyPeriodCard() {
  const { data, isLoading } = useQuery<Resp>({ queryKey: ["/api/finances/documents"] });
  const p = data?.shopifyPeriod;
  const m = data?.shopifyMetrics;
  if (isLoading || !p || !m) return null;
  const t = p.totals;
  const maxDay = Math.max(...p.daily.map((d) => d.totalSales), 1);

  return (
    <Card data-testid="card-shopify-period">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShoppingBag className="h-4 w-4" /> Shopify Sales — Current Period
          <span className="text-xs font-normal text-muted-foreground">· {p.periodLabel}</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{p.source} · {p.currency} · refreshed {p.refreshedAt}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Headline */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Total sales</div>
            <div className="text-lg font-bold mt-1 text-green-600 dark:text-green-400">{fmt(t.totalSales)}</div>
            <div className="text-[11px] text-muted-foreground">{m.days} days · {fmt(m.avgDailyTotal)}/day</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Net sales</div>
            <div className="text-lg font-bold mt-1">{fmt(t.netSales)}</div>
            <div className="text-[11px] text-muted-foreground">{fmt(m.avgDailyNet)}/day</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Gross sales</div>
            <div className="text-lg font-bold mt-1">{fmt(t.grossSales)}</div>
            <div className="text-[11px] text-muted-foreground">{fmt(m.avgDailyGross)}/day</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Discounts / Returns</div>
            <div className="text-lg font-bold mt-1 text-amber-600 dark:text-amber-400">{m.discountRatePct}%</div>
            <div className="text-[11px] text-muted-foreground">{fmt(t.discounts)} disc · {fmt(t.returns)} ret ({m.returnRatePct}%)</div>
          </div>
        </div>

        {/* Per-day bars */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Total sales by day</div>
          <div className="space-y-1.5">
            {p.daily.map((d) => (
              <div key={d.date} className="flex items-center gap-2 text-sm" data-testid={`shopify-day-${d.date}`}>
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
              Best day {dayLabel(m.bestDay.date)} at {fmt(m.bestDay.totalSales)}. Taxes {fmt(t.taxes)} · shipping {fmt(t.shippingCharges)}. Shopify only — Amazon not included.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
