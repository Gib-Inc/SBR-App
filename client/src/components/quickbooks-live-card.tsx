import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, Landmark, ArrowDownCircle, ArrowUpCircle, Cloud } from "lucide-react";

interface AgingBuckets { current?: number; d1_30?: number; d31_60?: number; d61_90?: number; d90_plus?: number; }
export interface QbBalanceSheet { totalAssets: number | null; totalCurrentAssets: number | null; totalLiabilities: number | null; totalCurrentLiabilities: number | null; totalEquity: number | null; }
export interface BillDue { vendor: string; amount: number; dueDate: string | null; daysOverdue: number; docNumber: string | null; }
export interface QbLive {
  capturedAt: string;
  cashOnHand: number | null;
  accountsReceivable: number | null;
  accountsPayable: number | null;
  arAging: AgingBuckets | null;
  apAging: AgingBuckets | null;
  netIncome: number | null;
  grossProfit: number | null;
  totalIncome: number | null;
  operatingExpenses: number | null;
  plPeriodStart: string | null;
  plPeriodEnd: string | null;
  confidence: number | null;
  dataGaps: string[];
  balanceSheet?: QbBalanceSheet | null;
  billsDue?: BillDue[];
}

const fmt = (v: number | null | undefined) =>
  v == null ? "—" : (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString();

function timeAgo(iso?: string): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const AGING = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90_plus", label: "90+" },
] as const;

function AgingRow({ buckets, overdueTone }: { buckets: AgingBuckets | null; overdueTone: string }) {
  if (!buckets) return null;
  return (
    <div className="grid grid-cols-5 gap-1 mt-2">
      {AGING.map((b) => {
        const v = (buckets as any)[b.key] as number | undefined;
        const overdue = b.key !== "current" && (v ?? 0) > 0;
        return (
          <div key={b.key} className="text-center">
            <div className="text-[10px] text-muted-foreground">{b.label}</div>
            <div className={`text-xs tabular-nums font-medium ${overdue ? overdueTone : ""}`}>{fmt(v ?? 0)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function QuickBooksLiveCard({ qbLive, netCashPosition }: { qbLive: QbLive | null; netCashPosition?: number | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const refresh = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/quickbooks/financial-snapshot/capture", {})).json(),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["/api/finances/overview"] });
      if (d?.success) toast({ title: "QuickBooks synced", description: "Live cash, receivables and bills refreshed." });
      else toast({ title: "Couldn't sync QuickBooks", description: d?.error || "QuickBooks may be disconnected.", variant: "destructive" });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const ap = qbLive?.apAging;
  const apOverdue = ap ? (ap.d1_30 || 0) + (ap.d31_60 || 0) + (ap.d61_90 || 0) + (ap.d90_plus || 0) : 0;

  return (
    <Card data-testid="card-qb-live">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Cloud className="h-4 w-4" /> Live from QuickBooks
            <span className="text-xs font-normal text-muted-foreground">
              {qbLive?.capturedAt ? `· synced ${timeAgo(qbLive.capturedAt)}` : "· not synced yet"}
              {qbLive?.confidence != null ? ` · ${qbLive.confidence}% complete` : ""}
            </span>
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-qb-refresh">
            {refresh.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!qbLive ? (
          <p className="text-sm text-muted-foreground">No live snapshot yet. Hit <strong>Refresh</strong> to pull cash on hand, receivables, and bills due straight from QuickBooks.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Landmark className="h-3.5 w-3.5" /> Cash on Hand</div>
              <div className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">{fmt(qbLive.cashOnHand)}</div>
              <div className="text-[11px] text-muted-foreground mt-1">across bank accounts</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><ArrowDownCircle className="h-3.5 w-3.5" /> Receivables (owed to you)</div>
              <div className="text-2xl font-bold tabular-nums">{fmt(qbLive.accountsReceivable)}</div>
              <AgingRow buckets={qbLive.arAging} overdueTone="text-amber-600 dark:text-amber-400" />
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><ArrowUpCircle className="h-3.5 w-3.5" /> Bills Due (you owe)</div>
              <div className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">{fmt(qbLive.accountsPayable)}</div>
              <AgingRow buckets={qbLive.apAging} overdueTone="text-red-600 dark:text-red-400" />
              {apOverdue > 0 && <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">{fmt(apOverdue)} overdue</div>}
            </div>
          </div>
        )}
        {qbLive?.dataGaps && qbLive.dataGaps.length > 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">{qbLive.dataGaps.length} field(s) not found in QuickBooks — left blank, not estimated.</p>
        )}
        {qbLive && (qbLive.netIncome != null || qbLive.totalIncome != null) && (
          <div className="mt-3 pt-3 border-t grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div><div className="text-muted-foreground">Income (30d)</div><div className="font-semibold tabular-nums">{fmt(qbLive.totalIncome)}</div></div>
            <div><div className="text-muted-foreground">Gross Profit</div><div className="font-semibold tabular-nums">{fmt(qbLive.grossProfit)}</div></div>
            <div><div className="text-muted-foreground">Operating Exp.</div><div className="font-semibold tabular-nums">{fmt(qbLive.operatingExpenses)}</div></div>
            <div><div className="text-muted-foreground">Net Income (30d)</div><div className={`font-semibold tabular-nums ${qbLive.netIncome != null && qbLive.netIncome < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{fmt(qbLive.netIncome)}</div></div>
          </div>
        )}

        {/* Live balance-sheet totals + net cash position */}
        {qbLive && (qbLive.balanceSheet || netCashPosition != null) && (
          <div className="mt-3 pt-3 border-t">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Balance Sheet (live)</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              <div><div className="text-muted-foreground">Total Assets</div><div className="font-semibold tabular-nums">{fmt(qbLive.balanceSheet?.totalAssets)}</div></div>
              <div><div className="text-muted-foreground">Current Assets</div><div className="font-semibold tabular-nums">{fmt(qbLive.balanceSheet?.totalCurrentAssets)}</div></div>
              <div><div className="text-muted-foreground">Total Liabilities</div><div className="font-semibold tabular-nums text-red-600 dark:text-red-400">{fmt(qbLive.balanceSheet?.totalLiabilities)}</div></div>
              <div><div className="text-muted-foreground">Equity</div><div className={`font-semibold tabular-nums ${(qbLive.balanceSheet?.totalEquity ?? 0) < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{fmt(qbLive.balanceSheet?.totalEquity)}</div></div>
              <div><div className="text-muted-foreground">Net Cash Position</div><div className={`font-semibold tabular-nums ${(netCashPosition ?? 0) < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>{fmt(netCashPosition)}</div></div>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">Net cash position = cash + receivables − bills due (what cash would be if everything outstanding settled).</div>
          </div>
        )}

        {/* Bills to pay — ranked, overdue first */}
        {qbLive?.billsDue && qbLive.billsDue.length > 0 && (
          <div className="mt-3 pt-3 border-t">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Bills to pay · {qbLive.billsDue.length} open</div>
            <div className="max-h-56 overflow-y-auto rounded border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/50"><tr className="text-left">
                  <th className="px-2 py-1 font-medium">Vendor</th>
                  <th className="px-2 py-1 font-medium">Due</th>
                  <th className="px-2 py-1 font-medium text-right">Amount</th>
                </tr></thead>
                <tbody>
                  {qbLive.billsDue.map((b, i) => (
                    <tr key={i} className="border-t" data-testid={`bill-due-${i}`}>
                      <td className="px-2 py-1 truncate max-w-[180px]" title={b.vendor}>{b.vendor}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {b.dueDate || "—"}
                        {b.daysOverdue > 0 && <span className="ml-1 text-[10px] text-red-600 dark:text-red-400">{b.daysOverdue}d late</span>}
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums font-medium ${b.daysOverdue > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{fmt(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
