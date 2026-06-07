import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert, TrendingDown } from "lucide-react";

/**
 * CIPH.R Finances (piece 4) — the accountant's Executive Financial Summary.
 * Renders the ITD narrative: critical insolvency banner, 4 headline metrics,
 * the key-ratios table, the ad-ROI-per-$1 collapse, and the 10 findings.
 * Every figure is transcribed from Roger Knudson's June 2026 summary (cited).
 */

interface Headline {
  cashOnHand: number; ytdNetLoss: number; ytdNetLossPctOfRevenue: number;
  totalDebt: number; totalDebtChangePctSinceDec2025: number; ownersEquity: number;
  totalAssets: number; fullYearLossProjection: number;
  debtBreakdown: { shortTermLoans: number; creditCards: number; sba: number };
}
interface Ratio { metric: string; value: string; status: string; tone: string; }
interface Finding { n: number; title: string; headline: string; detail: string; tone: string; }
interface RoiYear { year: string; value: number; }
interface ExecSummary {
  source: string; preparedBy: string; basis: string; asOf: string; periodLabel: string;
  critical: string; headline: Headline; ratios: Ratio[]; adRoiByYear: RoiYear[]; findings: Finding[];
}
interface Resp { success: boolean; executiveSummary?: ExecSummary; }

const fmt = (v: number) => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();
const toneText = (t: string) => t === "crit" ? "text-red-600 dark:text-red-400" : t === "warn" ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400";

export function ExecutiveSummaryCard() {
  const { data, isLoading } = useQuery<Resp>({ queryKey: ["/api/finances/documents"] });
  const es = data?.executiveSummary;
  if (isLoading || !es) return null;
  const h = es.headline;
  const maxRoi = Math.max(...es.adRoiByYear.map((r) => r.value), 1);

  return (
    <Card className="border-red-200 dark:border-red-900" data-testid="card-executive-summary">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" /> Accountant's Executive Summary
          <span className="text-xs font-normal text-muted-foreground">· {es.periodLabel}</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{es.source} · {es.preparedBy} · {es.basis} basis · through {es.asOf}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Critical banner */}
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" /><span><b>CRITICAL:</b> {es.critical}</span>
        </div>

        {/* Headline metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Cash on hand" value={fmt(h.cashOnHand)} sub="Adequate near-term" tone="ok" />
          <Metric label="2026 YTD net loss (5 mo)" value={fmt(h.ytdNetLoss)} sub={`${h.ytdNetLossPctOfRevenue}% of revenue`} tone="crit" />
          <Metric label="Total debt" value={fmt(h.totalDebt)} sub={`Up ${h.totalDebtChangePctSinceDec2025}% since Dec 2025`} tone="crit" />
          <Metric label="Owner's equity" value={fmt(h.ownersEquity)} sub={`Assets ${fmt(h.totalAssets)} − liabilities`} tone="crit" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Ratios */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">Key ratios</div>
            <div className="rounded-lg border divide-y">
              {es.ratios.map((r) => (
                <div key={r.metric} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span>{r.metric}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums font-medium">{r.value}</span>
                    <span className={`text-xs ${toneText(r.tone)}`}>{r.status}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Ad ROI collapse */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Advertising ROI — revenue per $1 spent</div>
            <div className="rounded-lg border p-3 space-y-1.5">
              {es.adRoiByYear.map((r) => (
                <div key={r.year} className="flex items-center gap-2 text-sm">
                  <span className="w-16 text-xs text-muted-foreground">{r.year}</span>
                  <div className="flex-1 bg-muted rounded h-3 overflow-hidden">
                    <div className={`h-3 ${r.value >= 8 ? "bg-green-500" : r.value >= 4 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${Math.max(3, (r.value / maxRoi) * 100)}%` }} />
                  </div>
                  <span className="w-14 text-right tabular-nums font-medium">${r.value.toFixed(2)}</span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground pt-1">Fell 87% since 2022 — the #1 loss driver. SBR ROAS floor is 8× (target).</p>
            </div>
          </div>
        </div>

        {/* Findings */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Top findings</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {es.findings.map((f) => (
              <div key={f.n} className="rounded-lg border p-2.5" data-testid={`finding-${f.n}`}>
                <div className={`text-sm font-medium flex items-center gap-1.5 ${toneText(f.tone)}`}><span className="text-xs opacity-70">{f.n}</span> {f.title}</div>
                <div className="text-xs font-medium mt-0.5">{f.headline}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{f.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "crit" ? "border-red-200 bg-red-50 dark:bg-red-950/30" : "bg-card"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-1 ${tone === "crit" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
