import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, AlertTriangle, ShieldCheck } from "lucide-react";

interface Obligation {
  id: string; label: string; payee: string | null; category: string; tier: string;
  amount: number; amountEstimated: boolean; dueDate: string | null; daysUntilDue: number | null;
  criticality: string; payFrom: string | null; status: string; rationale: string | null;
  anomalyFlag: boolean; anomalyReason: string | null; runningCashAfter: number | null;
}
interface Position {
  cashOnHand: number; cashAsOf: string | null; dailySalesRunRate: number; windowDays: number;
  projectedIncome: number; receivablesInbound: number; totalDue: number; tier1Due: number; projectedLow: number;
}
interface CashFlow { success: boolean; position: Position; obligations: Obligation[]; generatedAt: string; }

const money = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

const TIER_LABEL: Record<string, string> = { mca: "MCA", tier1: "Tax / Payroll", tier2: "Must pay", tier3: "Important", tier4: "Flexible", hold: "Hold" };
const TIER_CLASS: Record<string, string> = {
  mca: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  tier1: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  tier2: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  tier3: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  tier4: "bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400",
  hold: "bg-slate-50 text-slate-400",
};

function fmtDue(d: string | null, days: number | null) {
  if (!d) return { txt: "no date", cls: "text-muted-foreground" };
  const cls = days == null ? "" : days < 0 ? "text-red-600 font-semibold dark:text-red-400" : days <= 7 ? "text-orange-600 dark:text-orange-400" : "";
  const rel = days == null ? "" : days < 0 ? ` (${-days}d late)` : days === 0 ? " (today)" : ` (${days}d)`;
  return { txt: d + rel, cls };
}

export default function CashFlow() {
  const { toast } = useToast();
  const [windowDays, setWindowDays] = useState(30);

  // Explicit queryFn: the default getQueryFn joins the key with "/", which would
  // request /api/finances/cash-flow/30 (no such route → SPA HTML → JSON parse
  // error). Send windowDays as the query string the route actually reads. The
  // 2-element key keeps a distinct cache entry per window and lets the prefix
  // invalidation below still match.
  const { data, isLoading } = useQuery<CashFlow>({
    queryKey: ["/api/finances/cash-flow", windowDays],
    queryFn: async () => (await apiRequest("GET", `/api/finances/cash-flow?windowDays=${windowDays}`)).json(),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      apiRequest("PUT", `/api/finances/cash-obligation/${id}/status`, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/finances/cash-flow"] }); },
    onError: (e: any) => toast({ title: "Error", description: e?.message, variant: "destructive" }),
  });

  const p = data?.position;
  const obls = data?.obligations ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6" /> Cash Flow Command</h1>
        <p className="text-sm text-muted-foreground">What to pay, in what order, before cash runs out. Tax and payroll rank above vendor bills. This view <b>recommends and tracks</b> — it never moves money.</p>
      </div>

      {/* Runway */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Cash on hand" value={money(p?.cashOnHand)} sub={p?.cashAsOf ? `as of ${p.cashAsOf}` : ""} />
        <Tile label={`+ Projected income (${p?.windowDays ?? windowDays}d)`} value={money(p?.projectedIncome)} sub={p ? `${money(p.dailySalesRunRate)}/day run-rate` : ""} />
        <Tile label="− Due in window" value={money(p?.totalDue)} sub={p ? `${money(p.tier1Due)} tax/payroll` : ""} />
        <Tile label="= Projected low" value={money(p?.projectedLow)} accent={p && p.projectedLow < 0 ? "red" : "green"}
              sub={p && p.projectedLow < 0 ? "short before income lands" : "covered"} />
        {/* A/R shown for visibility but NOT counted in the runway: it's currently a
            single unverified Amazon accrual journal entry, not a granular payout feed. */}
        <Tile label="Money on its way (A/R)" value={money(p?.receivablesInbound)}
              sub="unverified accrual · confirm w/ Roger · not in runway" />
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Window:</span>
        {[7, 14, 30, 60].map((w) => (
          <button key={w} onClick={() => setWindowDays(w)}
            className={`px-2.5 py-1 rounded text-xs border ${windowDays === w ? "bg-primary text-primary-foreground border-primary" : "border-border hover-elevate"}`}>{w}d</button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Pay order (highest priority first)</CardTitle>
          <p className="text-xs text-muted-foreground">Pay top-down until the running balance gets uncomfortable. Tax/payroll carry penalties and personal trust-fund exposure, so they sit near the top.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
           obls.length === 0 ? <p className="text-sm text-muted-foreground">Nothing due in this window. Tax and payroll obligations generate automatically; add vendor bills as they come in.</p> : (
            <div className="space-y-1.5">
              {obls.map((o) => {
                const due = fmtDue(o.dueDate, o.daysUntilDue);
                return (
                  <div key={o.id} className={`rounded-lg border px-3 py-2 ${o.status === "approved" ? "bg-green-50/60 dark:bg-green-950/15 border-green-200 dark:border-green-900/30" : o.status === "deferred" ? "opacity-55" : "hover-elevate"}`} data-testid={`obl-${o.id}`}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge className={`${TIER_CLASS[o.tier] ?? TIER_CLASS.tier3} text-[10px] font-semibold`}>{TIER_LABEL[o.tier] ?? o.tier}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate flex items-center gap-1.5">
                          {o.label}
                          {o.anomalyFlag && <span title={o.anomalyReason ?? "flagged"}><AlertTriangle className="h-3.5 w-3.5 text-red-500" /></span>}
                        </div>
                        {o.payee && o.payee !== o.label && <div className="text-[11px] text-muted-foreground truncate">{o.payee}</div>}
                      </div>
                      <div className={`text-xs w-32 text-right ${due.cls}`}>{due.txt}</div>
                      <div className="text-right tabular-nums w-24 font-semibold">{money(o.amount)}{o.amountEstimated && <span className="text-[10px] text-muted-foreground ml-1">est</span>}</div>
                      <div className="text-[11px] text-muted-foreground w-28 text-right truncate">{o.payFrom ? `from ${o.payFrom}` : ""}</div>
                      <div className="text-[11px] tabular-nums w-24 text-right text-muted-foreground">{o.runningCashAfter != null ? `→ ${money(o.runningCashAfter)}` : ""}</div>
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
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground pt-3">Every Approve / Defer / Mark-paid is recorded with who and when (audit trail). The app never pays a bill — approval is the signal for a person to pay it in the bank or QuickBooks. Tax figures are working estimates; Roger confirms.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "red" | "green" }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold tabular-nums ${accent === "red" ? "text-red-600 dark:text-red-400" : accent === "green" ? "text-green-600 dark:text-green-400" : ""}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
