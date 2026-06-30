import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, AlertTriangle, ShieldCheck, CreditCard, Banknote } from "lucide-react";

interface Obligation {
  id: string; label: string; payee: string | null; tier: string;
  amount: number; amountEstimated: boolean; dueDate: string | null; daysUntilDue: number | null;
  status: string; rationale: string | null; anomalyFlag: boolean; anomalyReason: string | null;
}
interface CashOutDay {
  date: string; opening: number; cashIn: number; payNow: number; ending: number;
  unfundedCount: number; endingComplete: boolean;
}
interface Scenario {
  key: string; label: string; pay: any[]; defer: any[]; totalPaid: number;
  endingCash: number; creditDrawn: number; feasible: boolean | null; unfundedInPay: number;
  endingCashComplete: boolean; rationale: string;
}
interface CashOut {
  success: boolean; asOf: string; days: number; rolling: CashOutDay[];
  cashOnHand: number; availableCash: number | null; availableCredit: number | null; totalLiquidity: number | null;
  obligations: Obligation[]; scenarios: Scenario[]; unfundedMustPayCount: number; generatedAt: string;
}

const money = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const dow = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};
const mmdd = (ymd: string) => { const [, m, d] = ymd.split("-"); return `${Number(m)}/${Number(d)}`; };

const TIER_LABEL: Record<string, string> = { mca: "MCA", tier1: "Tax / Payroll", tier2: "Must pay", tier3: "Important", tier4: "Flexible", hold: "Hold" };
const TIER_CLASS: Record<string, string> = {
  mca: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  tier1: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  tier2: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  tier3: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  tier4: "bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400",
  hold: "bg-slate-50 text-slate-400",
};

export default function CashOut() {
  const { toast } = useToast();
  const [days, setDays] = useState(3);

  const { data, isLoading } = useQuery<CashOut>({
    queryKey: ["/api/finances/cash-out", days],
    queryFn: async () => (await apiRequest("GET", `/api/finances/cash-out?days=${days}`)).json(),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      apiRequest("PUT", `/api/finances/cash-obligation/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/finances/cash-out"] }),
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  const rolling = data?.rolling ?? [];
  const scenarios = data?.scenarios ?? [];
  const obls = data?.obligations ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6" /> Cash Out</h1>
        <p className="text-sm text-muted-foreground">A rolling view of cash in, what to pay, and what's left — with what-if scenarios. This view <b>recommends and tracks</b>; it never moves money. You authorize each pay.</p>
      </div>

      {/* Liquidity */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Cash on hand" value={money(data?.cashOnHand)} icon={<Banknote className="h-3.5 w-3.5" />} />
        <Tile label="Available cash (lines)" value={money(data?.availableCash)} sub="drawable LOC room" />
        <Tile label="Available credit (cards)" value={money(data?.availableCredit)} icon={<CreditCard className="h-3.5 w-3.5" />} />
        <Tile label="Total liquidity" value={money(data?.totalLiquidity)} accent="green" sub="cash + lines + cards" />
      </div>

      {!!data?.unfundedMustPayCount && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/15 px-3 py-2 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <span><b>{data.unfundedMustPayCount}</b> unavoidable obligation{data.unfundedMustPayCount > 1 ? "s have" : " has"} an unknown amount (MCA / tax / debt not yet entered). Pay-now totals and the day-by-day endings are a <b>best case</b> — the real outflow is larger. Enter the amounts to firm it up.</span>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Horizon:</span>
        {[3, 5, 7].map((w) => (
          <button key={w} onClick={() => setDays(w)}
            className={`px-2.5 py-1 rounded text-xs border ${days === w ? "bg-primary text-primary-foreground border-primary" : "border-border hover-elevate"}`}>{w} days</button>
        ))}
      </div>

      {/* Rolling day-by-day */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Rolling cash, day by day</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <table className="w-full text-sm tabular-nums" style={{ minWidth: 420 }}>
              <thead>
                <tr className="text-muted-foreground text-xs">
                  <th className="text-left font-normal pb-1.5"></th>
                  {rolling.map((d) => (
                    <th key={d.date} className="text-right font-medium pb-1.5 px-2">{dow(d.date)} · {mmdd(d.date)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row label="Opening cash" days={rolling} pick={(d) => money(d.opening)} />
                <Row label="+ Cash in (payouts)" days={rolling} pick={(d) => (d.cashIn ? money(d.cashIn) : "—")} cls="text-green-700 dark:text-green-400" />
                <Row label="− Pay now" days={rolling} pick={(d) => (d.payNow ? money(d.payNow) : "—")} cls="text-red-700 dark:text-red-400" />
                <tr className="border-t">
                  <td className="py-1.5 font-medium">= Ending</td>
                  {rolling.map((d) => (
                    <td key={d.date} className={`text-right px-2 py-1.5 font-semibold ${d.ending < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {money(d.ending)}{!d.endingComplete && <span title={`${d.unfundedCount} obligation(s) this day have an unknown amount — ending is a best case`} className="text-amber-600 dark:text-amber-400">*</span>}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
          {rolling.some((d) => !d.endingComplete) && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 pt-2 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> * Some obligations have an unknown amount (estimated), so that day's ending is a best case — the real outflow is larger. Enter the amounts to firm it up.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Scenarios */}
      <div>
        <h2 className="text-base font-semibold mb-2 flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> What-to-pay scenarios</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {scenarios.map((s) => (
            <Card key={s.key} className={s.feasible === false ? "border-red-300 dark:border-red-900/50" : ""}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{s.label}</span>
                  {s.feasible === false
                    ? <Badge className="bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 text-[10px]">over credit</Badge>
                    : s.feasible === null
                      ? <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300 text-[10px]">credit unknown</Badge>
                      : null}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-2xl font-bold tabular-nums ${s.endingCash < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-300"}`}>{money(s.endingCash)}{!s.endingCashComplete && <span className="text-amber-600 dark:text-amber-400" title="some pay items have an unknown amount — best case">*</span>}</span>
                  <span className="text-[11px] text-muted-foreground">cash after</span>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>Pays <b>{s.pay.length}</b> ({money(s.totalPaid)}){s.defer.length > 0 && <> · defers <b>{s.defer.length}</b></>}</div>
                  {s.creditDrawn > 0 && <div className="text-amber-700 dark:text-amber-400">Draws {money(s.creditDrawn)} of credit</div>}
                  {s.unfundedInPay > 0 && <div className="text-amber-700 dark:text-amber-400">{s.unfundedInPay} item(s) with unknown amount</div>}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">{s.rationale}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Pay-now list with authorize controls */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pay order — you authorize each one</CardTitle>
          <p className="text-xs text-muted-foreground">Highest priority first. Approve marks intent; Mark-paid records it (with who and when). The app never pays a bill — it's the signal for a person to pay it in the bank or QuickBooks.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
           obls.length === 0 ? <p className="text-sm text-muted-foreground">Nothing due in this window.</p> : (
            <div className="space-y-1.5">
              {obls.map((o) => (
                <div key={o.id} className={`rounded-lg border px-3 py-2 ${o.status === "approved" ? "bg-green-50/60 dark:bg-green-950/15 border-green-200 dark:border-green-900/30" : o.status === "deferred" ? "opacity-55" : "hover-elevate"}`} data-testid={`cashout-obl-${o.id}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge className={`${TIER_CLASS[o.tier] ?? TIER_CLASS.tier3} text-[10px] font-semibold`}>{TIER_LABEL[o.tier] ?? o.tier}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate flex items-center gap-1.5">{o.label}
                        {o.anomalyFlag && <span title={o.anomalyReason ?? "flagged"}><AlertTriangle className="h-3.5 w-3.5 text-red-500" /></span>}
                      </div>
                      {o.payee && o.payee !== o.label && <div className="text-[11px] text-muted-foreground truncate">{o.payee}</div>}
                    </div>
                    <div className="text-right tabular-nums w-28 font-semibold">
                      {o.amountEstimated && o.amount <= 0
                        ? <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />amount unknown</span>
                        : <>{money(o.amount)}{o.amountEstimated && <span className="text-[10px] text-muted-foreground ml-1">est</span>}</>}
                    </div>
                    <div className="flex items-center gap-1">
                      {o.status === "pending" && <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStatus.mutate({ id: o.id, status: "approved" })}>Approve</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStatus.mutate({ id: o.id, status: "deferred" })}>Defer</Button>
                      </>}
                      {o.status === "approved" && <>
                        <span className="text-[11px] text-green-700 dark:text-green-400 font-medium">approved</span>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStatus.mutate({ id: o.id, status: "paid" })}>Mark paid</Button>
                      </>}
                      {o.status === "deferred" && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStatus.mutate({ id: o.id, status: "pending" })}>Un-defer</Button>}
                    </div>
                  </div>
                  {o.rationale && <div className="text-[11px] text-muted-foreground mt-1 pl-1">{o.rationale}</div>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, days, pick, cls }: { label: string; days: CashOutDay[]; pick: (d: CashOutDay) => string; cls?: string }) {
  return (
    <tr>
      <td className="py-1 text-muted-foreground">{label}</td>
      {days.map((d) => <td key={d.date} className={`text-right px-2 py-1 ${cls ?? ""}`}>{pick(d)}</td>)}
    </tr>
  );
}

function Tile({ label, value, sub, accent, icon }: { label: string; value: string; sub?: string; accent?: "red" | "green"; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] text-muted-foreground flex items-center gap-1">{icon}{label}</div>
        <div className={`text-xl font-bold tabular-nums ${accent === "red" ? "text-red-600 dark:text-red-400" : accent === "green" ? "text-green-700 dark:text-green-300" : ""}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
