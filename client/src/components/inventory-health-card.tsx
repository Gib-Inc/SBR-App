import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Gauge, AlertTriangle } from "lucide-react";

/**
 * Inventory Health — turnover/days-on-hand + costed coverage + the valuation gap.
 * Read-only, from /api/finances/inventory-health. The measurement layer the audit
 * flagged as missing. Turnover is a range (app-WAC vs QB inventory) — directional
 * until COGS coverage rises and the valuation gap is booked.
 */
interface Resp {
  success: boolean;
  inventoryValueApp: number; qbInventory: number | null; valuationGap: number | null;
  annualizedCogs: number | null; trailingMonths: number;
  turnoverApp: number | null; turnoverQb: number | null; dioApp: number | null; dioQb: number | null;
  costedSkuPct: number | null; costedValuePct: number | null;
  skusWithStock: number; uncostedSkusWithStock: number; notes: string[];
  // MEAS-3
  abc?: { a: { skus: number; value: number }; b: { skus: number; value: number }; c: { skus: number; value: number } };
  agingFinished?: { onHandValue: number; deadValue: number; deadSkus: number };
  gmroi?: { annualizedGrossProfit: number | null; gmroiApp: number | null; gmroiQb: number | null };
  valueTrend?: { date: string; totalValueApp: number; qbInventory: number | null }[];
}
const money = (v: number | null | undefined) => (v == null ? "—" : (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US"));
const range = (a: number | null, b: number | null, suffix: string) => {
  const lo = a != null && b != null ? Math.min(a, b) : (a ?? b);
  const hi = a != null && b != null ? Math.max(a, b) : (a ?? b);
  if (lo == null) return "—";
  return lo === hi ? `${lo}${suffix}` : `${lo}–${hi}${suffix}`;
};

export function InventoryHealthCard() {
  const { data } = useQuery<Resp>({ queryKey: ["/api/finances/inventory-health"] });
  if (!data) return null;
  const coverageLow = data.costedSkuPct != null && data.costedSkuPct < 90;

  return (
    <Card data-testid="card-inventory-health">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Gauge className="h-4 w-4" /> Inventory health</CardTitle>
        <CardDescription>How fast inventory moves, how much of it is costed, and whether the valuation ties to QuickBooks.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Turnover / year" value={range(data.turnoverApp, data.turnoverQb, "×")} sub={`${data.trailingMonths}-mo COGS, annualized`} />
          <Metric label="Days on hand" value={range(data.dioQb, data.dioApp, "d")} sub="≈ how long stock lasts" />
          <Metric label="Inventory value" value={money(data.inventoryValueApp)} sub={data.qbInventory != null ? `QB books ${money(data.qbInventory)}` : "app WAC"} />
          <Metric label="Costed coverage" value={data.costedSkuPct != null ? `${data.costedSkuPct}%` : "—"} sub={`${data.uncostedSkusWithStock} SKUs uncosted`} tone={coverageLow ? "warn" : "ok"} />
        </div>

        {(data.abc || data.agingFinished || data.gmroi) ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.abc ? (
              <Metric label="A-items" value={`${data.abc.a.skus} SKUs`} sub={`hold ${money(data.abc.a.value)} — count these first`} />
            ) : null}
            {data.agingFinished ? (
              <Metric label="Dead stock" value={money(data.agingFinished.deadValue)} sub={`${data.agingFinished.deadSkus} finished SKUs, no sale 180d+`} tone={data.agingFinished.deadValue > 10000 ? "warn" : "ok"} />
            ) : null}
            {data.gmroi ? (
              <Metric label="GMROI" value={range(data.gmroi.gmroiApp, data.gmroi.gmroiQb, "×")} sub="gross margin ÷ inventory" />
            ) : null}
            {data.agingFinished ? (
              <Metric label="Finished-goods value" value={money(data.agingFinished.onHandValue)} sub="at app WAC" />
            ) : null}
          </div>
        ) : null}

        {data.valueTrend && data.valueTrend.length > 0 ? (
          <ValueTrend points={data.valueTrend} />
        ) : null}

        {data.valuationGap != null && Math.abs(data.valuationGap) > 10000 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>App values inventory at {money(data.inventoryValueApp)} but QuickBooks books {money(data.qbInventory)} — a {money(Math.abs(data.valuationGap))} gap. Turnover is a range until this is decomposed and booked, and {data.costedSkuPct ?? 0}% costed coverage is raised.</span>
          </div>
        ) : null}

        {data.notes?.length ? (
          <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
            {data.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ValueTrend({ points }: { points: { date: string; totalValueApp: number }[] }) {
  const vals = points.map((p) => p.totalValueApp);
  const first = vals[0];
  const last = vals[vals.length - 1];
  const delta = last - first;
  const W = 240, H = 32;
  // Sparkline path (skip when only one point — nothing to draw yet).
  let path = "";
  if (vals.length > 1) {
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    path = vals
      .map((v, i) => {
        const x = (i / (vals.length - 1)) * W;
        const y = H - ((v - min) / span) * H;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }
  return (
    <div className="rounded-xl border p-3 bg-card">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Inventory value trend</div>
        <div className="text-[11px] text-muted-foreground">
          {points.length === 1
            ? "tracking started today"
            : <>{money(first)} → {money(last)} <span className={delta > 0 ? "text-amber-600" : delta < 0 ? "text-emerald-600" : ""}>({delta >= 0 ? "+" : "-"}{money(Math.abs(delta))})</span> over {points.length}d</>}
        </div>
      </div>
      {path ? (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2 w-full h-8">
          <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-muted-foreground" />
        </svg>
      ) : null}
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "warn" ? "border-amber-200 bg-amber-50 dark:bg-amber-950/30" : "bg-card"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-1 tabular-nums ${tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
