import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, Radio, Upload } from "lucide-react";

/**
 * CIPH.R Unified Performance Hub (Stage C) — "Unified Sales & Ad Performance".
 * Reads /api/finances/unified-performance (the Stage B merge engine): Blended
 * ROAS, MER, revenue vs ad spend, per-platform spend (live vs uploaded source),
 * and True Net Margin per SKU (allocated vs measured ad spend, labeled).
 * DATA GAPPED markers render as inline amber badges; null metrics show "—".
 */

interface MergedPlatform { platform: string; spend: number; impressions: number | null; clicks: number | null; source: "live" | "uploaded"; }
interface SkuMargin {
  sku: string; name: string | null; revenue: number | null; unitsSold: number;
  cogs: number | null; shipping: number | null; allocatedAdSpend: number | null;
  adSpendBasis: "sku_live" | "allocated" | "none"; trueNetMargin: number | null; marginPct: number | null; dataGaps: string[];
}
interface UnifiedView {
  success: boolean; rangeLabel: string; periodStart: string | null; periodEnd: string | null;
  totalRevenue: number | null; netRevenue: number | null; totalAdSpend: number | null; totalMarketingSpend: number | null;
  platforms: MergedPlatform[]; blendedRoas: number | null; mer: number | null; skus: SkuMargin[];
  dataGaps: string[]; status: "OK" | "DATA_GAPPED";
}

const money = (v: number | null | undefined) => (v == null ? "—" : (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString());
const ratio = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}×`);

// SBR ROAS guardrails (global memory): 8x target / 5x escalate / 3x pause.
const roasTone = (v: number | null) => v == null ? "" : v >= 8 ? "text-green-600 dark:text-green-400" : v >= 5 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";

export function UnifiedPerformanceCard() {
  const { data, isLoading } = useQuery<UnifiedView>({ queryKey: ["/api/finances/unified-performance"] });
  if (isLoading) return null;
  if (!data?.success) return null;
  const v = data;
  const maxSpend = v.platforms.length ? Math.max(...v.platforms.map((p) => p.spend), 1) : 1;

  return (
    <Card data-testid="card-unified-performance">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Unified Sales &amp; Ad Performance
          <span className="text-xs font-normal text-muted-foreground">· last 30 days</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">Sales, ad spend and true margin merged into one view · {v.rangeLabel}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* DATA GAPPED banners */}
        {v.dataGaps && v.dataGaps.length > 0 && (
          <div className="space-y-1" data-testid="unified-data-gaps">
            {v.dataGaps.map((g, i) => (
              <div key={i} className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded px-2 py-1 flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /><span>{g}</span>
              </div>
            ))}
          </div>
        )}

        {/* Headline KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Blended ROAS" value={ratio(v.blendedRoas)} sub="revenue ÷ ad spend" tone={roasTone(v.blendedRoas)} />
          <Kpi label="MER" value={ratio(v.mer)} sub="revenue ÷ marketing" tone={roasTone(v.mer)} />
          <Kpi label="Total Revenue" value={money(v.totalRevenue)} sub="sales (window)" tone="" />
          <Kpi label="Total Ad Spend" value={money(v.totalAdSpend)} sub="all platforms" tone="" />
        </div>

        {/* Ad spend by platform with source tag */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Ad spend by platform</div>
          {v.platforms.length === 0 ? (
            <div className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> No ad spend tracked or uploaded for this window.</div>
          ) : (
            <div className="space-y-1.5">
              {v.platforms.map((p) => (
                <div key={p.platform} data-testid={`unified-platform-${p.platform}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      {p.platform}
                      <span className={`inline-flex items-center gap-0.5 text-[10px] px-1 rounded ${p.source === "live" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"}`}>
                        {p.source === "live" ? <Radio className="h-2.5 w-2.5" /> : <Upload className="h-2.5 w-2.5" />}{p.source}
                      </span>
                    </span>
                    <span className="tabular-nums font-medium">{money(p.spend)}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded mt-0.5"><div className="h-1.5 rounded bg-orange-500" style={{ width: `${Math.max(2, (p.spend / maxSpend) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* True net margin per SKU */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">True net margin per SKU <span className="font-normal">· revenue − COGS − shipping − allocated ad spend</span></div>
          {v.skus.length === 0 ? (
            <p className="text-sm text-muted-foreground">No SKU sales in this window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground text-right">
                  <th className="text-left py-1">SKU</th><th className="py-1">Revenue</th><th className="py-1">COGS</th><th className="py-1">Ad spend</th><th className="py-1">Net margin</th><th className="py-1">%</th>
                </tr></thead>
                <tbody>
                  {v.skus.slice(0, 15).map((s) => (
                    <tr key={s.sku} className="border-t text-right" data-testid={`unified-sku-${s.sku}`}>
                      <td className="text-left py-1">
                        <div className="font-medium truncate max-w-[180px]">{s.name || s.sku}</div>
                        <div className="text-[10px] text-muted-foreground">{s.sku}</div>
                      </td>
                      <td className="tabular-nums">{money(s.revenue)}</td>
                      <td className="tabular-nums">{money(s.cogs)}</td>
                      <td className="tabular-nums">
                        {money(s.allocatedAdSpend)}
                        {s.adSpendBasis !== "none" && (
                          <span className={`ml-1 text-[9px] px-1 rounded ${s.adSpendBasis === "sku_live" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                            {s.adSpendBasis === "sku_live" ? "measured" : "allocated"}
                          </span>
                        )}
                      </td>
                      <td className={`tabular-nums font-medium ${s.trueNetMargin != null && s.trueNetMargin < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{money(s.trueNetMargin)}</td>
                      <td className={`tabular-nums ${s.marginPct != null && s.marginPct < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{s.marginPct == null ? "—" : `${s.marginPct.toFixed(0)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-muted-foreground mt-1">"allocated" ad spend is split proportionally by revenue (no SKU-level ad data); "measured" comes from per-SKU ad metrics. Per-SKU shipping isn't tracked, so it's treated as $0.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-xl border p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tone}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
