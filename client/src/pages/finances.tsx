import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FinancialPositionCard } from "@/components/financial-position-card";
import { CashRunwayCard } from "@/components/cash-runway-card";
import { ProfitPlaygroundCard } from "@/components/profit-playground-card";
import { InventoryAnticipationCard } from "@/components/inventory-anticipation-card";
import { SeasonalSpendForecastCard } from "@/components/seasonal-spend-forecast-card";
import { ProductProfitabilityCard } from "@/components/product-profitability-card";
import { SeasonalDemandCard } from "@/components/seasonal-demand-card";
import { YoYCard } from "@/components/yoy-card";
import { PathToProfitabilityCard } from "@/components/path-to-profitability-card";
import { ShopifyCashCard } from "@/components/shopify-cash-card";
import { CreditLinesCard } from "@/components/credit-lines-card";
import { DebtRunwayCard } from "@/components/debt-runway-card";
import { ExecutiveSummaryCard } from "@/components/executive-summary-card";
import { ResetImpactCard } from "@/components/reset-impact-card";
import { ShopifyPeriodCard } from "@/components/shopify-period-card";
import { AmazonPeriodCard } from "@/components/amazon-period-card";
import { DraftOrdersCard } from "@/components/draft-orders-card";
import { UnifiedPerformanceCard } from "@/components/unified-performance-card";
import { DataHealthCard } from "@/components/data-health-card";
import { QuickBooksLiveCard, type QbLive } from "@/components/quickbooks-live-card";
import { DollarSign, TrendingDown, AlertTriangle, Wallet, Landmark, Megaphone, ArrowRight, UploadCloud } from "lucide-react";
import { Link } from "wouter";

/**
 * CIPH.R Finances tab — the financial command center.
 * Reads /api/finances/overview (seeded accountant P&L + balance sheet; QB live
 * later). ANTI-HALLUCINATION: every figure comes from the data; nothing invented.
 */

interface MonthlyRow {
  month: string;
  totalIncome: string | null;
  grossProfit: string | null;
  totalExpenses: string | null;
  netIncome: string | null;
  expenseCategories: Record<string, number> | null;
}
interface LoanLine { name: string; balance: number | null; term?: string | null; rate?: number | null; }
interface BalanceSheet {
  asOf: string; cash: number | null; accountsReceivable: number | null; accountsPayable: number | null;
  inventory: number | null; creditCards: number | null; shortTermNotes: number | null; salesTaxToPay: number | null;
  longTermLiabilities?: number | null; totalLiabilities: number | null; totalEquity: number | null;
  loans?: LoanLine[]; source?: string;
}
interface AdChannel { channel: string; spend: number; source?: "live" | "uploaded" | "canonical"; }
interface ExpectedPayouts { amazonNet: number; shopifyNet: number; totalNet: number; }
interface CashBurn { burn30: number | null; from?: { asOf: string; balance: number }; to?: { asOf: string; balance: number }; spanDays?: number; reason?: string }
interface Overview { success: boolean; monthly: MonthlyRow[]; balanceSheet?: BalanceSheet; balanceSheetSource?: string; balanceSheetDataGaps?: string[]; qbLive?: QbLive | null; netCashPosition?: number | null; expectedPayouts?: ExpectedPayouts | null; adChannels?: AdChannel[]; adChannelsWindowDays?: number; cashBurn?: CashBurn | null; }

const n = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));
const fmt = (v: number | null | undefined) => (v == null ? "—" : (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString());
const fmtK = (v: number) => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v / 1000)).toLocaleString() + "K";
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function MiniTrend({ months, a, b }: { months: string[]; a: number[]; b: number[] }) {
  const W = 560, H = 180, pad = { l: 46, r: 12, t: 12, b: 22 };
  const all = [...a, ...b, 0];
  const min = Math.min(...all), max = Math.max(...all);
  const N = months.length;
  const X = (i: number) => pad.l + (W - pad.l - pad.r) * (N > 1 ? i / (N - 1) : 0);
  const Y = (v: number) => H - pad.b - (H - pad.t - pad.b) * ((v - min) / ((max - min) || 1));
  const path = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const grid = [0, 1, 2, 3].map((t) => { const v = min + (max - min) * t / 3, y = Y(v); return `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#eef1f5"/><text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#9aa3b2">${fmtK(v)}</text>`; }).join("");
  const zero = min < 0 && max > 0 ? `<line x1="${pad.l}" y1="${Y(0)}" x2="${W - pad.r}" y2="${Y(0)}" stroke="#cbd3df" stroke-dasharray="3 3"/>` : "";
  const xl = [0, Math.floor(N / 2), N - 1].filter((i) => i >= 0).map((i) => `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#9aa3b2">${months[i] || ""}</text>`).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%">${grid}${zero}<path d="${path(a)}" fill="none" stroke="#2563eb" stroke-width="2"/><path d="${path(b)}" fill="none" stroke="#dc2626" stroke-width="2"/>${xl}</svg>`;
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Kpi({ label, value, sub, tone = "" }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "crit" ? "border-red-200 bg-red-50 dark:bg-red-950/30" : tone === "warn" ? "border-amber-200 bg-amber-50 dark:bg-amber-950/30" : "bg-card"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tone === "crit" ? "text-red-600 dark:text-red-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

export default function Finances() {
  const { data, isLoading } = useQuery<Overview>({ queryKey: ["/api/finances/overview"] });
  const { data: expenseDetail } = useQuery<{ available?: boolean; window?: { start: string; end: string } | null; byAccount?: any[] }>({ queryKey: ["/api/finances/expense-detail"] });
  const monthly = data?.monthly ?? [];
  const bs = data?.balanceSheet;

  // Closed months only — exclude any partial-period row (label like "Jun 2026 (1-20)")
  // so an in-progress month never distorts YTD or the burn/runway headline.
  const closed = monthly.filter((m) => !/\(/.test(String(m.month)));
  const months = closed.map((m) => m.month);
  const income = closed.map((m) => n(m.totalIncome));
  const netInc = closed.map((m) => n(m.netIncome));
  const last = monthly[monthly.length - 1];
  // Burn / runway / company-health come from the LIVE QB trailing-30d P&L
  // (qbLive.netIncome) — the truth — NOT the monthly_financials rollup, which lagged
  // and was inflated by the QB "Match Shopify" double-count (it showed phantom profit
  // and a "HEALTHY" badge while the company is losing money). Fall back to the
  // trailing-3-closed-month average only when no live snapshot exists.
  const liveNet = data?.qbLive?.netIncome ?? null;
  const plBurn = liveNet != null ? -liveNet : avg(netInc.slice(-3).map((x) => -x));
  // Burn basis: prefer CASH (operator-entered bank-confirmed balances — true money
  // movement incl. debt principal) over the accrual P&L number, which swings with
  // income-booking timing (it moved -$31K → +$80K in one night of JE catch-up).
  // Both are shown; the card labels which basis drives the headline.
  const cb = data?.cashBurn ?? null;
  const burnBasis: "cash" | "pl" = cb?.burn30 != null ? "cash" : "pl";
  const burn3 = cb?.burn30 != null ? cb.burn30 : plBurn;
  const cash = bs && bs.cash != null ? bs.cash : 0;
  // Runway is a PROJECTION: assumes the window's pace continues.
  const runwayMo = burn3 > 0 ? cash / burn3 : null;
  const ytdIdx = months.map((m, i) => (/2026/.test(m) ? i : -1)).filter((i) => i >= 0);
  const ytdRev = ytdIdx.reduce((s, i) => s + income[i], 0);
  const ytdNI = ytdIdx.reduce((s, i) => s + netInc[i], 0);

  // health status
  const status = !bs ? { label: "NO DATA", tone: "" }
    : runwayMo != null && runwayMo < 2 ? { label: "CRITICAL", tone: "crit" }
    : runwayMo != null && runwayMo < 4 ? { label: "AT RISK", tone: "warn" }
    : { label: "HEALTHY", tone: "" };

  // expense breakdown (latest month)
  const cats = last?.expenseCategories ? Object.entries(last.expenseCategories).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]) : [];
  const catMax = cats.length ? cats[0][1] : 1;
  const lastRev = n(last?.totalIncome);

  const TREND_N = Math.min(24, months.length);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><DollarSign className="h-5 w-5" /> Finances</h2>
          <p className="text-xs text-muted-foreground">CIPH.R financial command center{bs ? ` · balance sheet as of ${bs.asOf}` : ""}{data?.balanceSheetSource === "quickbooks_live" ? " · debt live from QuickBooks" : data?.balanceSheetSource === "accountant_seed" ? " · source: accountant export (QuickBooks live once connected)" : data?.balanceSheetSource === "accountant_upload" ? " · source: uploaded balance sheet" : ""}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/financial-upload" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 whitespace-nowrap" data-testid="link-upload-financials">
            <UploadCloud className="h-3.5 w-3.5" /> Upload a document
          </Link>
          {bs && <Badge className={status.tone === "crit" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" : status.tone === "warn" ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"} data-testid="badge-company-health">{status.label}</Badge>}
        </div>
      </div>

      {isLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading financials…</CardContent></Card>
      ) : !bs && monthly.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground" data-testid="text-finances-empty">No financial data yet. It populates from the seeded accountant export on deploy, then from QuickBooks once connected.</CardContent></Card>
      ) : (
        <>
          {/* Health KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi label="Cash on Hand" value={fmt(cash)} sub="bank accounts" tone={runwayMo != null && runwayMo < 2 ? "crit" : ""} />
            <Kpi label="Cash Runway" value={runwayMo != null ? `${runwayMo.toFixed(1)} mo` : "—"} sub={runwayMo != null ? `~${Math.round(runwayMo * 30.4)} days · projection off ${burnBasis === "cash" ? "bank pace" : "P&L pace"}` : "cash-flow +"} tone={status.tone} />
            <Kpi
              label="Monthly Burn"
              value={burn3 > 0 ? fmt(burn3) : "cash +"}
              sub={burnBasis === "cash"
                ? `cash basis · bank ${cb!.from!.asOf} → ${cb!.to!.asOf} · P&L: ${plBurn > 0 ? fmt(plBurn) : "positive"}`
                : `P&L basis · trailing-30d · live QB · cash basis ${cb?.reason ? "not available" : "—"}`}
              tone={burn3 > 0 ? "crit" : ""}
            />
            <Kpi label="2026 Revenue" value={fmt(ytdRev)} sub="YTD" />
            <Kpi label="2026 Net Income" value={fmt(ytdNI)} sub="YTD" tone={ytdNI < 0 ? "crit" : ""} />
            <Kpi label="Total Liabilities" value={bs ? fmt(bs.totalLiabilities) : "—"} sub="all debt" tone="crit" />
          </div>

          {/* Live from QuickBooks — real-time cash, receivables, bills due (+ aging) */}
          <QuickBooksLiveCard qbLive={data?.qbLive ?? null} netCashPosition={data?.netCashPosition ?? null} expectedPayouts={data?.expectedPayouts ?? null} />

          {/* Reset Impact — month-over-month trend since the May reset (losses + MER) */}
          <ResetImpactCard />

          {/* Accountant's Executive Summary (ITD narrative + ratios) */}
          <ExecutiveSummaryCard />

          {/* Current-period sales by channel — live, month-to-date */}
          <ShopifyPeriodCard />
          <AmazonPeriodCard />

          {/* Draft orders — live B2B/wholesale quote pipeline */}
          <DraftOrdersCard />

          {/* Existing live cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <FinancialPositionCard />
            <CashRunwayCard />
          </div>

          {/* Incoming cash + credit lines */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ShopifyCashCard />
            <CreditLinesCard balanceSheet={bs ?? null} />
          </div>

          {/* Debt runway — Shopify Capital payoff date */}
          <DebtRunwayCard />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Where the money goes */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingDown className="h-4 w-4" /> Where the Money Goes <span className="text-xs font-normal text-muted-foreground">· {last?.month}</span></CardTitle></CardHeader>
              <CardContent>
                {cats.length === 0 ? <p className="text-sm text-muted-foreground">No expense detail.</p> : (
                  <div className="space-y-1.5">
                    {cats.slice(0, 10).map(([name, v]) => (
                      <div key={name} data-testid={`expense-${name}`}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="truncate pr-2">{name}</span>
                          <span className="tabular-nums font-medium whitespace-nowrap">{fmt(v)}{lastRev > 0 ? ` · ${Math.round((v / lastRev) * 100)}%` : ""}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded mt-0.5"><div className="h-1.5 rounded bg-blue-500" style={{ width: `${Math.max(2, (v / catMax) * 100)}%` }} /></div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Revenue vs Net Income trend */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Revenue vs Net Income</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-4 text-xs mb-1">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded bg-blue-600" /> Revenue</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded bg-red-600" /> Net Income</span>
                </div>
                <MiniTrend months={months.slice(-TREND_N)} a={income.slice(-TREND_N)} b={netInc.slice(-TREND_N)} />
              </CardContent>
            </Card>
          </div>

          {/* Ad spend by channel */}
          {(() => {
            const ch = data?.adChannels ?? [];
            const totalCh = ch.reduce((s, x) => s + x.spend, 0);
            const maxCh = ch.length ? Math.max(...ch.map((x) => x.spend)) : 1;
            const metaCh = ch.find((x) => /meta|facebook/i.test(x.channel) && x.spend > 0);
            return (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base flex items-center gap-2"><Megaphone className="h-4 w-4" /> Ad Spend by Channel <span className="text-xs font-normal text-muted-foreground">· last {data?.adChannelsWindowDays ?? 30} days · {fmt(totalCh)} tracked</span></CardTitle>
                    <Link href="/marketing-analytics" className="text-xs text-primary hover:underline flex items-center gap-1 whitespace-nowrap shrink-0" data-testid="link-ad-analytics">Full ad analytics <ArrowRight className="h-3 w-3" /></Link>
                  </div>
                </CardHeader>
                <CardContent>
                  {ch.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No ad-platform spend tracked yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {ch.map((x) => (
                        <div key={x.channel} data-testid={`adch-${x.channel}`}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5">{x.channel}
                              {x.source && <span className={`text-[10px] px-1 rounded ${x.source === "live" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"}`}>{x.source === "canonical" ? "QuickBooks" : x.source}</span>}
                            </span>
                            <span className="tabular-nums font-medium">{fmt(x.spend)}{totalCh > 0 ? ` · ${Math.round((x.spend / totalCh) * 100)}%` : ""}</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded mt-0.5"><div className="h-1.5 rounded bg-orange-500" style={{ width: `${Math.max(2, (x.spend / maxCh) * 100)}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!metaCh ? (
                    <div className="mt-3 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1" data-testid="text-meta-gap">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>Meta / Facebook shows <b>$0 tracked</b> — Meta Ads isn't connected, so roughly half your ad spend (per the P&amp;L) isn't attributed here. Connect Meta Ads, or upload a Meta report under <b>Upload Financials</b>.</span>
                    </div>
                  ) : metaCh.source === "uploaded" ? (
                    <div className="mt-3 text-xs text-blue-600 dark:text-blue-400 flex items-start gap-1" data-testid="text-meta-uploaded">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>Meta / Facebook spend here is from an <b>uploaded report</b>, not a live sync. Connect Meta Ads for automatic daily numbers.</span>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })()}

          {/* Unified Sales & Ad Performance Overview (merge engine) */}
          <UnifiedPerformanceCard />

          {/* Data Integrity & Sync Health (reconciliation visibility) */}
          <DataHealthCard />

          {/* Year-over-year sales vs ad spend (same-period) */}
          <YoYCard />

          {/* Path to profitability — interactive standard-to-success */}
          <PathToProfitabilityCard />

          {/* Per-SKU product profitability (real BOM cost) */}
          <ProductProfitabilityCard />

          {/* Seasonal demand curve — the year at a glance */}
          <SeasonalDemandCard />

          {/* Forward seasonal inventory-spend forecast */}
          <SeasonalSpendForecastCard />

          {/* Inventory spend anticipation */}
          <InventoryAnticipationCard />

          {/* Profit & savings playground */}
          <ProfitPlaygroundCard monthly={monthly} cash={cash} expenseDetail={expenseDetail} />

          {/* Debt stack */}
          {bs && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Landmark className="h-4 w-4" /> Debt &amp; Position <span className="text-xs font-normal text-muted-foreground">· {bs.source === "quickbooks_live" ? `live from QuickBooks · synced ${bs.asOf}` : `as of ${bs.asOf}`}</span></CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div><div className="text-xs text-muted-foreground">Accounts Payable</div><div className="font-semibold tabular-nums">{fmt(bs.accountsPayable)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Credit Cards</div><div className="font-semibold tabular-nums">{fmt(bs.creditCards)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Short-Term Notes</div><div className="font-semibold tabular-nums">{fmt(bs.shortTermNotes)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Sales Tax Owed</div><div className="font-semibold tabular-nums">{fmt(bs.salesTaxToPay)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Inventory (asset)</div><div className="font-semibold tabular-nums">{fmt(bs.inventory)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Accounts Receivable</div><div className="font-semibold tabular-nums">{fmt(bs.accountsReceivable)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Total Liabilities</div><div className="font-semibold tabular-nums text-red-600 dark:text-red-400">{fmt(bs.totalLiabilities)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Total Equity</div><div className="font-semibold tabular-nums text-red-600 dark:text-red-400">{fmt(bs.totalEquity)}</div></div>
                </div>
                {bs.source === "quickbooks_live" && (
                  <div className="text-[11px] text-muted-foreground mt-2">Debt, A/P, A/R, total liabilities &amp; equity are live from QuickBooks (synced {bs.asOf}). Sales tax &amp; inventory are from the last uploaded balance sheet.</div>
                )}
                {bs.loans && bs.loans.length > 0 && (() => {
                  const rated = bs.loans!.filter((l) => l.rate != null && (l.balance ?? 0) > 0);
                  const wairBase = rated.reduce((s, l) => s + (l.balance ?? 0), 0);
                  const wair = wairBase > 0 ? rated.reduce((s, l) => s + (l.balance ?? 0) * (l.rate as number), 0) / wairBase : null;
                  const rateTone = (r?: number | null) => r == null ? "" : r >= 0.25 ? "text-red-600 dark:text-red-400" : r >= 0.12 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
                  return (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-medium text-muted-foreground">Named loans &amp; notes ({bs.loans!.length})</div>
                      {wair != null && (
                        <div className="text-xs" data-testid="loan-wair">Blended rate (WAIR): <span className={`font-semibold ${rateTone(wair)}`}>{(wair * 100).toFixed(2)}%</span></div>
                      )}
                    </div>
                    <div className="rounded-lg border divide-y">
                      {bs.loans!.slice().sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0)).map((l, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-1.5 text-sm" data-testid={`debt-loan-${i}`}>
                          <span>{l.name}{l.term ? <span className="text-xs text-muted-foreground"> · {l.term}-term</span> : ""}</span>
                          <span className="flex items-center gap-2">
                            {l.rate != null && <span className={`text-xs tabular-nums ${rateTone(l.rate)}`}>{(l.rate * 100).toFixed(2)}%</span>}
                            <span className="tabular-nums font-medium w-20 text-right">{fmt(l.balance)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    {wair != null && <p className="text-[11px] text-muted-foreground mt-1">Weighted by balance across {rated.length} rated note(s). High-rate facilities (≥25%) in red are the first to refinance/retire.</p>}
                  </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          <div className="text-[11px] text-muted-foreground flex items-start gap-1">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>Figures from the accountant export (P&amp;L Jan 2022–{months[months.length - 1]}; Balance Sheet {bs?.asOf}; Executive Summary through May 31, 2026; Shopify Jun 1-6). Nothing estimated — sources are cited per card. Cash runway = cash ÷ 3-month average net loss (cash-only view; debt facilities not counted). Switches to live QuickBooks once connected. Upload newer statements anytime via <b>Upload Financials</b>.</span>
          </div>
        </>
      )}
    </div>
  );
}
