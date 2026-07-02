import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Compass, ShieldAlert, TrendingDown, Receipt, Layers, Gauge, AlertTriangle } from "lucide-react";
import { DataFreshnessBar } from "@/components/data-freshness-bar";

const money = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);

interface GreenLine {
  overall: string; cashOnHand: number | null; runwayDays: number | null; runwaySeverity: string;
  burnRate: number | null; dscr: number | null; dscrStatus: string; opexPct: number | null; opexSeverity: string;
  governorState: string; blendedMer: number | null; totalDebt: number; mcaBucket: number;
  netIncomeTrend: { month: string; netIncome: number }[]; gaps: string[]; asOf: string | null;
}
interface Governor {
  state: string; reasons: string[]; blendedMer: number | null; breakeven: number; qbMarketing30d: number;
  creditLineMeta30d: number; merBasis30d: number | null; merUnderstated: boolean;
  netRevenue30d: number; cashOnHand: number | null; cashFloor: number; septemberStreak: number;
  septemberTriggered: boolean; dataFresh: boolean; adDataLatest: string | null;
}
interface DebtService { dailyAchOut: number; monthlyTotal: number; missingPaymentCount: number; missingPaymentBalance: number }
interface Ghosts { count: number; balance: number; names: string[] }
interface DebtAval {
  debtService?: DebtService;
  ghosts?: Ghosts;
  totalDebt: number; byBucket: { bucket: string; tier: string; total: number; count: number }[];
  facilities: { name: string; balance: number; apr: number | null; tier: string; bucket: string; payoffOrder: number }[];
  interestTrend: { month: string; interest: number }[];
  aprCoverage?: { missingCount: number; missingBalance: number };
}
interface SpendLeaks {
  totalOpex90: number;
  vendors: { vendor: string; spend90: number; pctOfOpex: number; growthPct: number | null; concentrationFlag: boolean; risingFlag: boolean }[];
}
interface CogsRecon {
  months: { month: string; measuredCogs: number; coveragePct: number; measuredRatePct: number; plugCogs: number | null; plugRatePct: number | null; variance: number | null }[];
}
interface ChannelCogs {
  channels: { channel: string; revenue: number; coveredRevenue: number; coveragePct: number; measuredCogs: number; materialsMarginPct: number; grossContribution: number }[];
}

const SEV: Record<string, { box: string; text: string; label: string }> = {
  CRITICAL: { box: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/40", text: "text-red-700 dark:text-red-300", label: "RED" },
  WARNING: { box: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40", text: "text-amber-700 dark:text-amber-300", label: "AMBER" },
  HEALTHY: { box: "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/30", text: "text-green-700 dark:text-green-400", label: "GREEN" },
};
const sevText = (s: string) => SEV[s]?.text ?? "text-foreground";
const TIER_CLASS: Record<string, string> = {
  mca: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  tier2: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  tier3: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};
const GOV_CLASS: Record<string, string> = {
  BLOCK: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  HOLD: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  ALLOW_SCALE: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
};

interface InvRecon { appWac: number; qbInventory: number | null; variance: number | null; material: boolean; flag: string; }
interface NetRev { gross: number; taxCollected: number; netOfTax: number; taxCaptureCoveragePct: number; }
interface CloseStatus { periods: { period: string; status: string; doneCount: number; totalCount: number }[]; }

export default function GreenLine() {
  const gl = useQuery<GreenLine>({ queryKey: ["/api/finances/green-line"] });
  const gov = useQuery<Governor>({ queryKey: ["/api/finances/marketing-governor"] });
  const debt = useQuery<DebtAval>({ queryKey: ["/api/finances/debt-avalanche"] });
  const leaks = useQuery<SpendLeaks>({ queryKey: ["/api/finances/spend-leaks"] });
  const recon = useQuery<CogsRecon>({ queryKey: ["/api/finances/cogs-reconciliation"] });
  const channels = useQuery<ChannelCogs>({ queryKey: ["/api/finances/cogs-by-channel"] });
  const invRecon = useQuery<InvRecon>({ queryKey: ["/api/finances/inventory-reconciliation"] });
  const netRev = useQuery<NetRev>({ queryKey: ["/api/finances/revenue-net-of-tax?days=90"] });
  const close = useQuery<CloseStatus>({ queryKey: ["/api/finances/close-status"] });

  const g = gl.data;
  const sev = SEV[g?.overall ?? "HEALTHY"] ?? SEV.HEALTHY;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Compass className="h-6 w-6" /> Green Line</h1>
        <p className="text-sm text-muted-foreground">One readout: are we steering into the green? Solvency (runway, DSCR, opex) drives the color. Every instrument recommends and tracks. None of it moves money.</p>
        <p className="text-[11px] text-muted-foreground mt-1">Figures here are operational estimates (basis: accrual, from QuickBooks). QuickBooks is the authoritative book of record; the app reconciles and flags, it never posts entries.</p>
        <DataFreshnessBar className="mt-2" />
      </div>

      {/* North-star banner */}
      <div className={`rounded-lg border p-4 ${sev.box}`} data-testid="green-line-banner">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className={`text-lg font-semibold ${sev.text}`}>
            {g?.overall === "HEALTHY" ? "Trending into the green" : g?.overall === "WARNING" ? "Off the green line — warning" : "Off the green line — critical"}
          </div>
          <Badge className={`${sev.text} bg-transparent border ${sev.box}`}>{sev.label}{g?.asOf ? ` · as of ${g.asOf}` : ""}</Badge>
        </div>
        {g?.gaps && g.gaps.length > 0 && (
          <div className="text-[11px] mt-1 opacity-80">Some inputs incomplete ({g.gaps.join(", ")}); color reflects measured signals only.</div>
        )}
      </div>

      {/* Vitals */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Cash on hand" value={money(g?.cashOnHand)} tone={(g?.cashOnHand ?? 0) < 60000 ? "CRITICAL" : "HEALTHY"} />
        <Tile label="Runway" value={g?.runwayDays != null ? `${g.runwayDays}d` : "—"} sub={g?.burnRate ? `${money(g.burnRate)}/day burn` : ""} tone={g?.runwaySeverity} />
        <Tile label="DSCR" value={g?.dscr != null ? `${g.dscr.toFixed(2)}x` : (g?.dscrStatus === "CRITICAL" ? "<0" : "—")} sub="debt coverage" tone={g?.dscrStatus === "CRITICAL" ? "CRITICAL" : g?.dscrStatus === "HEALTHY" ? "HEALTHY" : g?.dscrStatus === "WARNING" ? "WARNING" : "UNKNOWN"} />
        <Tile label="Blended MER" value={g?.blendedMer != null ? `${g.blendedMer.toFixed(2)}x` : "—"} sub="vs 5x breakeven" tone={(g?.blendedMer ?? 0) > 5 ? "HEALTHY" : "WARNING"} />
        <Tile label="Opex / sales" value={pct(g?.opexPct)} sub="latest month" tone={g?.opexSeverity} />
        <Tile label="Total debt" value={money(g?.totalDebt)} sub={`${money(g?.mcaBucket)} MCA`} tone={(g?.totalDebt ?? 0) > 0 ? "WARNING" : "HEALTHY"} />
      </div>

      {/* What to pay first — the #1 turnaround lever, shown first */}
      <Card className="border-2">
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" /> What to pay first — debt payoff priority</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {debt.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : debt.data && debt.data.facilities.length > 0 ? (<>
            <p className="text-xs text-muted-foreground">Every spare dollar goes to <span className="font-medium text-foreground">#1</span> first, then down the list. Clear the MCA bucket before the SBA and bank loans: MCAs auto-debit daily, so each one retired immediately frees cash and lifts runway.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {debt.data.byBucket.map((b) => (
                <div key={b.tier} className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">{b.bucket}</div>
                  <div className="text-lg font-bold tabular-nums">{money(b.total)}</div>
                  <div className="text-[11px] text-muted-foreground">{b.count} facilities</div>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {debt.data.facilities.map((f) => (
                <div key={f.name} className="flex items-center gap-2 text-sm">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold shrink-0 tabular-nums">{f.payoffOrder}</span>
                  <Badge className={`${TIER_CLASS[f.tier] ?? TIER_CLASS.tier3} text-[10px]`}>{f.tier}</Badge>
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className={`tabular-nums text-[11px] w-14 text-right shrink-0 ${f.apr != null ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>{f.apr != null ? `${f.apr}%` : "rate?"}</span>
                  <span className="tabular-nums font-medium w-20 text-right shrink-0">{money(f.balance)}</span>
                </div>
              ))}
            </div>
            {debt.data.debtService && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-sm" data-testid="debt-service-strip">
                <span title="Sum of daily-cadence facility debits (MCAs) — reconcile this against the bank statement's daily ACH total">
                  <span className={`font-semibold tabular-nums ${debt.data.debtService.dailyAchOut > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{money(debt.data.debtService.dailyAchOut)}</span>
                  <span className="text-muted-foreground text-xs"> /business-day ACH out</span>
                </span>
                <span title="All facility payments normalized to monthly (daily ×21 business days, weekly ×4.33)">
                  <span className="font-semibold tabular-nums">{money(debt.data.debtService.monthlyTotal)}</span>
                  <span className="text-muted-foreground text-xs"> /mo debt service</span>
                </span>
              </div>
            )}
            {debt.data.debtService && debt.data.debtService.missingPaymentCount > 0 && (
              <p className="text-[11px] text-red-700 dark:text-red-400 flex items-start gap-1" data-testid="debt-unfunded-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {debt.data.debtService.missingPaymentCount} {debt.data.debtService.missingPaymentCount === 1 ? "facility" : "facilities"} ({money(debt.data.debtService.missingPaymentBalance)} of balance) have no payment amount entered — they read $0 in runway, forecasts, and the pay order. Enter each schedule on the Finances debt card.
              </p>
            )}
            {debt.data.ghosts && debt.data.ghosts.count > 0 && (
              <p className="text-[11px] text-red-700 dark:text-red-400 flex items-start gap-1" data-testid="debt-ghost-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Excluded from this payoff order (still counted in the debt total): {debt.data.ghosts.names.join(", ")} ({money(debt.data.ghosts.balance)}) — no longer returned by QuickBooks, balance unverifiable. Confirm with Roger, then deactivate or re-link.
              </p>
            )}
            {debt.data.aprCoverage && debt.data.aprCoverage.missingCount > 0 && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {money(debt.data.aprCoverage.missingBalance)} of debt ({debt.data.aprCoverage.missingCount} {debt.data.aprCoverage.missingCount === 1 ? "facility" : "facilities"}) has no APR on file — those sort last, so this order is a best-effort until the rates are entered.
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">Ranked by true cost: MCAs first (daily-debit), then by APR, highest rate first. Interest trend (6 mo): {debt.data.interestTrend.map((t) => money(t.interest)).join(" → ")}. Recommends a payoff order; it never moves money.</p>
          </>) : <p className="text-sm text-muted-foreground">No active facilities found.</p>}
        </CardContent>
      </Card>

      {/* Net income trend */}
      {g?.netIncomeTrend && g.netIncomeTrend.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingDown className="h-4 w-4" /> Net income trend (6 mo)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 flex-wrap">
              {g.netIncomeTrend.map((m) => (
                <div key={m.month} className="text-center flex-1 min-w-[64px]">
                  <div className={`text-sm font-semibold tabular-nums ${m.netIncome < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>{money(m.netIncome)}</div>
                  <div className="text-[11px] text-muted-foreground">{m.month}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground pt-2">Loss every month. Closing the gap to breakeven (roughly the latest monthly loss) is the goal the instruments below serve.</p>
          </CardContent>
        </Card>
      )}

      {/* Marketing Governor */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base flex items-center gap-2"><Gauge className="h-4 w-4" /> Marketing Governor</CardTitle>
          {gov.data && <Badge className={GOV_CLASS[gov.data.state] ?? ""}>{gov.data.state.replace("_", " ")}</Badge>}
        </CardHeader>
        <CardContent className="space-y-2">
          {gov.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : gov.data ? (<>
            <div className="text-xs text-muted-foreground">Authorize a budget increase only when blended MER beats breakeven, cash clears the floor, data is fresh, and the September Rule is quiet.</div>
            <ul className="text-sm space-y-1">
              {gov.data.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2"><ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" /><span>{r}</span></li>
              ))}
            </ul>
            <div className="text-[11px] text-muted-foreground pt-1">
              MER basis: {money(gov.data.netRevenue30d)} net ÷ {money(gov.data.merBasis30d ?? gov.data.qbMarketing30d)} marketing (30d = {money(gov.data.qbMarketing30d)} QB booked + {money(gov.data.creditLineMeta30d ?? 0)} credit-line Meta).
              {gov.data.merUnderstated && <span className="text-amber-600 font-medium"> Basis incomplete — credit-line Meta missing for this window.</span>}
              {" "}September streak: {gov.data.septemberStreak} days &lt;8x. Ad data {gov.data.dataFresh ? "fresh" : "stale"}{gov.data.adDataLatest ? ` (${gov.data.adDataLatest})` : ""}.
            </div>
          </>) : <p className="text-sm text-muted-foreground">Unavailable.</p>}
        </CardContent>
      </Card>

      {/* Spend leaks */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" /> Spend leaks — biggest controllable lines (90d)</CardTitle></CardHeader>
        <CardContent>
          {leaks.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : leaks.data ? (
            <div className="space-y-1">
              {leaks.data.vendors.map((v) => (
                <div key={v.vendor} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{v.vendor}</span>
                  {v.concentrationFlag && <Badge className="bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 text-[10px]">{v.pctOfOpex}% of opex</Badge>}
                  {v.risingFlag && <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300 text-[10px]">rising {v.growthPct}%</Badge>}
                  <span className="tabular-nums font-medium w-24 text-right">{money(v.spend90)}</span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground pt-1">Vendors over 15% of opex or rising while revenue falls are the first cuts. Total opex 90d: {money(leaks.data.totalOpex90)}.</p>
            </div>
          ) : <p className="text-sm text-muted-foreground">Unavailable.</p>}
        </CardContent>
      </Card>

      {/* COGS reconciliation + channel contribution */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Is gross margin real? Measured COGS vs the booked plug</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="text-[11px] rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-2 py-1">
            <b>PLUG — not measured.</b> Booked COGS is a 35%-of-income journal estimate. Roger books the measured-COGS true-up in QuickBooks; the app reports and flags only, it never posts entries.
          </div>
          {recon.data?.months && (
            <div className="space-y-1">
              {recon.data.months.slice(-4).map((m) => (
                <div key={m.month} className="flex items-center gap-2 text-sm">
                  <span className="w-16 text-muted-foreground">{m.month}</span>
                  <span className="flex-1">measured <b className="tabular-nums">{m.measuredRatePct}%</b> <span className="text-[11px] text-muted-foreground">({m.coveragePct}% covered)</span></span>
                  <span className="text-muted-foreground">booked plug <b className="tabular-nums">{m.plugRatePct != null ? `${m.plugRatePct}%` : "—"}</b></span>
                </div>
              ))}
            </div>
          )}
          {channels.data?.channels && (
            <div className="border-t pt-2 space-y-1">
              <div className="text-[11px] text-muted-foreground">Gross contribution per channel (materials COGS only, covered SKUs)</div>
              {channels.data.channels.map((c) => (
                <div key={c.channel} className="flex items-center gap-2 text-sm">
                  <span className="w-20 font-medium">{c.channel}</span>
                  <span className="flex-1 text-[11px] text-muted-foreground">{money(c.revenue)} rev · {c.coveragePct}% covered · {c.materialsMarginPct}% materials margin</span>
                  <span className="tabular-nums font-medium">{money(c.grossContribution)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Measured COGS is materials-only on covered SKUs (about half of lines have unmapped SKUs), so it reads below the booked plug. The fix is SKU mapping. Until coverage is high, treat any single margin number as directional.</p>
        </CardContent>
      </Card>

      {/* Books reconciliation — for Roger */}
      <Card className="border-2">
        <CardHeader className="pb-2"><CardTitle className="text-base">Books reconciliation — for Roger</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-start gap-2">
            <span className="w-28 text-muted-foreground shrink-0">Inventory</span>
            <div className="flex-1">
              <div>App WAC <b className="tabular-nums">{money(invRecon.data?.appWac)}</b> vs QB <b className="tabular-nums">{money(invRecon.data?.qbInventory)}</b>{invRecon.data?.variance != null && <span className={invRecon.data.material ? " text-red-600 dark:text-red-400" : ""}> · variance <b className="tabular-nums">{money(invRecon.data.variance)}</b></span>}</div>
              {invRecon.data?.flag && <div className="text-[11px] text-muted-foreground">{invRecon.data.flag}</div>}
            </div>
          </div>
          <div className="flex items-start gap-2 border-t pt-2">
            <span className="w-28 text-muted-foreground shrink-0">Revenue (90d)</span>
            <div className="flex-1">
              <div>gross <b className="tabular-nums">{money(netRev.data?.gross)}</b> · net of tax <b className="tabular-nums">{money(netRev.data?.netOfTax)}</b> · tax <b className="tabular-nums">{money(netRev.data?.taxCollected)}</b></div>
              <div className="text-[11px] text-muted-foreground">Tax-capture coverage {netRev.data?.taxCaptureCoveragePct ?? 0}% (forward-only). QuickBooks nets tax and is authoritative.</div>
            </div>
          </div>
          <div className="flex items-start gap-2 border-t pt-2">
            <span className="w-28 text-muted-foreground shrink-0">Month-end close</span>
            <div className="flex-1 space-y-0.5">
              {close.data?.periods?.slice(0, 3).map((p) => (
                <div key={p.period} className="flex items-center gap-2">
                  <span className="w-16 tabular-nums">{p.period}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.status === "locked" ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{p.status}</span>
                  <span className="text-[11px] text-muted-foreground">{p.doneCount}/{p.totalCount} checklist</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">The app reconciles and flags; Roger books all entries and the bank reconciliation in QuickBooks. The app never posts to QB.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold tabular-nums ${tone ? sevText(tone) : ""}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
