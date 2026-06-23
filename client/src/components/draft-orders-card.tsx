import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Info } from "lucide-react";

/**
 * DraftOrdersCard — LIVE Shopify draft orders (SBR's B2B/wholesale quote pipeline).
 * Reads /api/finances/draft-orders, which fetches open drafts live from Shopify
 * (they aren't in sales_orders). Headline = open pipeline $ (pending revenue not
 * yet closed); daily bars mirror the sales cards = drafts CREATED each day this
 * month. Degrades to a clear "needs scope" message when the token can't read them.
 */

interface DraftDay { date: string; count: number; totalSales: number; }
interface Resp {
  success: boolean; available: boolean; reason?: string; source: string;
  periodLabel: string; refreshedAt: string; currency: string;
  pipeline: { count: number; totalValue: number; avgValue: number; oldestOpenDays: number | null };
  createdThisMonth: { count: number; totalValue: number };
  daily: DraftDay[];
  bestDay: { date: string; totalSales: number } | null;
  truncated?: boolean;
  message?: string;
}

const fmt = (v: number) => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();
const dayLabel = (iso: string) => { const p = iso.split("-"); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : iso; };

export function DraftOrdersCard() {
  const { data, isLoading, isError, error } = useQuery<Resp>({ queryKey: ["/api/finances/draft-orders"] });
  if (isLoading) return null;

  // A load failure (500/network) should say so, not silently vanish the card.
  if (isError || !data) {
    return (
      <Card data-testid="card-draft-orders">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Draft Orders — B2B Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Couldn't load draft orders{error instanceof Error ? ` — ${error.message}` : ""}.
          </p>
        </CardContent>
      </Card>
    );
  }

  const Header = (
    <CardHeader className="pb-2">
      <CardTitle className="text-base flex items-center gap-2">
        <FileText className="h-4 w-4" /> Draft Orders — B2B Pipeline
        <span className="text-xs font-normal text-muted-foreground">· {data.periodLabel}</span>
      </CardTitle>
      {data.available && <p className="text-xs text-muted-foreground">{data.source} · {data.currency} · refreshed {data.refreshedAt}</p>}
    </CardHeader>
  );

  if (!data.available) {
    return (
      <Card data-testid="card-draft-orders">
        {Header}
        <CardContent>
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{data.message || "Draft orders are unavailable right now."}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const p = data.pipeline;
  const maxDay = Math.max(...data.daily.map((d) => d.totalSales), 1);

  return (
    <Card data-testid="card-draft-orders">
      {Header}
      <CardContent className="space-y-4">
        {/* Headline */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Open pipeline</div>
            <div className="text-lg font-bold mt-1 text-purple-600 dark:text-purple-400">{fmt(p.totalValue)}</div>
            <div className="text-[11px] text-muted-foreground">{p.count} open quote{p.count === 1 ? "" : "s"}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Created this month</div>
            <div className="text-lg font-bold mt-1">{fmt(data.createdThisMonth.totalValue)}</div>
            <div className="text-[11px] text-muted-foreground">{data.createdThisMonth.count} new quote{data.createdThisMonth.count === 1 ? "" : "s"}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Avg quote</div>
            <div className="text-lg font-bold mt-1">{fmt(p.avgValue)}</div>
            <div className="text-[11px] text-muted-foreground">across open</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Oldest open</div>
            <div className="text-lg font-bold mt-1 text-amber-600 dark:text-amber-400">{p.oldestOpenDays != null ? `${p.oldestOpenDays}d` : "—"}</div>
            <div className="text-[11px] text-muted-foreground">age of oldest quote</div>
          </div>
        </div>

        {/* Per-day created bars */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Quotes created by day</div>
          {data.daily.length === 0 ? (
            <p className="text-sm text-muted-foreground">No new draft orders created yet this month.</p>
          ) : (
            <div className="space-y-1.5">
              {data.daily.map((d) => (
                <div key={d.date} className="flex items-center gap-2 text-sm" data-testid={`draft-day-${d.date}`}>
                  <span className="w-12 text-xs text-muted-foreground">{dayLabel(d.date)}</span>
                  <div className="flex-1 bg-muted rounded h-3.5 overflow-hidden">
                    <div className="h-3.5 bg-purple-500" style={{ width: `${Math.max(2, (d.totalSales / maxDay) * 100)}%` }} />
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{d.count}×</span>
                  <span className="w-20 text-right tabular-nums font-medium">{fmt(d.totalSales)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground pt-2">
            Open B2B/wholesale quotes from Shopify, not yet converted to paid orders. The pipeline total is pending revenue — close these to bank it.
            {data.truncated && " Showing the first batch only — open-quote count is unusually high, so totals may be understated."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
