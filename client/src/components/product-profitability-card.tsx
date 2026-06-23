/**
 * ProductProfitabilityCard — per-SKU profit margin from REAL BOM cost.
 *
 * The truth Katana can't show: it reports ~96% margin because it never deducts
 * component cost. We have the bill of materials, so this is honest — it ranks
 * every product by gross profit, computes margin from the live build cost, and
 * puts the money-losers (selling below cost) right at the top.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, AlertTriangle } from "lucide-react";

interface ProductProfit {
  productId: string; sku: string; name: string; type: string;
  units: number; revenue: number; unitCost: number; cogs: number;
  grossProfit: number; marginPct: number | null; hasBom: boolean; costed: boolean;
}
interface ProfitResponse {
  rows: ProductProfit[];
  summary: {
    products: number; revenue: number; cogs: number; grossProfit: number;
    blendedMarginPct: number | null; negativeMarginCount: number; lowMarginCount: number;
    uncostedCount: number; since: string;
  };
}

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();
const PERIODS = [
  { key: "ytd", label: "YTD", params: "" },
  { key: "90d", label: "90 days", params: "?days=90" },
  { key: "30d", label: "30 days", params: "?days=30" },
];

function marginClass(m: number | null): string {
  if (m == null) return "text-muted-foreground";
  if (m < 0) return "text-red-600 dark:text-red-400 font-semibold";
  if (m < 15) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}

// Health colors for the margin bars: red losing, amber thin, primary ok, emerald strong.
function barColor(m: number | null): string {
  if (m == null) return "hsl(var(--muted-foreground))";
  if (m < 0) return "#dc2626";
  if (m < 15) return "#d97706";
  if (m < 40) return "hsl(var(--primary))";
  return "#059669";
}

export function ProductProfitabilityCard() {
  const [period, setPeriod] = useState(PERIODS[0]);
  const { data, isLoading } = useQuery<ProfitResponse>({
    queryKey: [`/api/finances/product-profitability${period.params}`],
  });

  const s = data?.summary;
  const rows = data?.rows || [];
  const losers = rows.filter((r) => r.marginPct != null && r.marginPct < 0);
  // Top sellers by revenue + every money-loser, drawn in margin order so the
  // healthy bars and the red losers separate cleanly.
  const withMargin = rows.filter((r) => r.marginPct != null);
  const topByRev = [...withMargin].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const extraLosers = withMargin.filter((r) => (r.marginPct as number) < 0 && !topByRev.includes(r));
  const chartRows = [...topByRev, ...extraLosers]
    .sort((a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0))
    .map((r) => ({ label: r.sku, marginPct: r.marginPct as number }));

  return (
    <Card data-testid="card-product-profitability">
      <CardHeader className="pb-3">
        <div className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              Product profitability
            </CardTitle>
            <CardDescription>Real margin from BOM cost — what each SKU actually makes.</CardDescription>
          </div>
          <div className="flex shrink-0 gap-1">
            {PERIODS.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={p.key === period.key ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setPeriod(p)}
                data-testid={`button-period-${p.key}`}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Calculating…</p>
        ) : !s ? (
          <p className="text-sm text-muted-foreground">No sales in this period.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span><span className="font-semibold">{money(s.revenue)}</span><span className="text-muted-foreground"> revenue</span></span>
              <span><span className="font-semibold">{money(s.cogs)}</span><span className="text-muted-foreground"> COGS</span></span>
              <span><span className="font-semibold">{money(s.grossProfit)}</span><span className="text-muted-foreground"> gross profit</span></span>
              <span>
                <span className="font-semibold">{s.blendedMarginPct != null ? `${s.blendedMarginPct}%` : "—"}</span>
                <span className="text-muted-foreground"> margin</span>
              </span>
            </div>

            {losers.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/50 dark:bg-red-950/30" data-testid="callout-money-losers">
                <p className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {losers.length} {losers.length === 1 ? "product is" : "products are"} selling below cost
                </p>
                <p className="mt-0.5 text-xs text-red-600/90 dark:text-red-400/80">
                  {losers.slice(0, 4).map((l) => `${l.sku} (${l.marginPct}%)`).join(" · ")}
                  {losers.length > 4 ? ` +${losers.length - 4} more` : ""}
                </p>
              </div>
            )}

            {chartRows.length > 0 && (
              <div className="rounded-lg border p-2">
                <p className="mb-1 px-1 text-xs text-muted-foreground">Margin by top product (revenue-weighted)</p>
                <div style={{ height: chartRows.length * 26 + 24 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartRows} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 4 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} domain={["dataMin", "dataMax"]} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} width={104} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                        formatter={(value: number) => [`${value}% margin`, ""]}
                      />
                      <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                      <Bar dataKey="marginPct" radius={3} isAnimationActive={false}
                        label={{ position: "right", fontSize: 10, formatter: (v: number) => `${v}%`, fill: "hsl(var(--muted-foreground))" }}>
                        {chartRows.map((r) => (
                          <Cell key={r.label} fill={barColor(r.marginPct)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Product</th>
                    <th className="px-2 py-1.5 text-right font-medium">Units</th>
                    <th className="px-2 py-1.5 text-right font-medium">Revenue</th>
                    <th className="px-2 py-1.5 text-right font-medium">Unit cost</th>
                    <th className="px-2 py-1.5 text-right font-medium">Profit</th>
                    <th className="px-3 py-1.5 text-right font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.productId} className="hover-elevate" data-testid={`row-profit-${r.sku}`}>
                      <td className="px-3 py-1.5">
                        <span className="font-mono text-xs">{r.sku}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{r.name}</span>
                        {!r.costed && <span className="ml-2 text-[10px] text-amber-600 dark:text-amber-400">no cost</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.units}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(r.revenue)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">${r.unitCost.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(r.grossProfit)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${marginClass(r.marginPct)}`}>
                        {r.marginPct != null ? `${r.marginPct}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Cost is the live BOM build cost (Σ component × WAC); products without a recipe use their own unit cost.
              {s.uncostedCount > 0 ? ` ${s.uncostedCount} product(s) have no cost yet.` : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
