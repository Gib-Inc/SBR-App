import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpenCheck, ScanSearch, ShieldCheck, AlertTriangle, ArrowRight } from "lucide-react";

interface VendorHistoryEntry { account: string; txns: number; total: number }
interface Proposal {
  id: number; txn_type: string; qb_txn_id: string; qb_line_id: string;
  txn_date: string | null; doc_number: string | null; vendor_name: string | null;
  description: string | null; amount: number;
  current_account_name: string; proposed_account_name: string;
  confidence: number; reasoning: string | null;
  vendor_history: VendorHistoryEntry[] | null;
  status: string; apply_error: string | null;
}
interface ScanState { running: boolean; lastRunAt: string | null; lastResult: null | {
  ok: boolean; error?: string; scanned?: number; proposed?: number; skipped?: number;
  staled?: number; truncated?: boolean; llmErrors?: number;
}}
interface Summary {
  pending: number; pendingHigh: number; applied: number; rejected: number;
  appliedAmount: number; pendingAmount: number; highConfidence: number; scan: ScanState;
}

const money = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function ConfidenceBadge({ c, threshold }: { c: number; threshold: number }) {
  const pct = Math.round(c * 100);
  const cls = c >= threshold
    ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300"
    : c >= 0.7
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
      : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300";
  return <Badge className={`${cls} text-[10px] font-semibold tabular-nums`}>{pct}%</Badge>;
}

export default function Bookkeeping() {
  const { toast } = useToast();
  const [showDecided, setShowDecided] = useState(false);

  const { data: summary } = useQuery<Summary>({
    queryKey: ["/api/bookkeeping/summary"],
    queryFn: async () => (await apiRequest("GET", "/api/bookkeeping/summary")).json(),
    refetchInterval: (q) => (q.state.data?.scan?.running ? 4000 : false),
  });
  const scanRunning = !!summary?.scan?.running;

  const { data: proposalData, isLoading } = useQuery<{ proposals: Proposal[] }>({
    queryKey: ["/api/bookkeeping/proposals"],
    queryFn: async () => (await apiRequest("GET", "/api/bookkeeping/proposals")).json(),
    refetchInterval: scanRunning ? 5000 : false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/bookkeeping/proposals"] });
    queryClient.invalidateQueries({ queryKey: ["/api/bookkeeping/summary"] });
  };

  const scan = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/bookkeeping/scan", { days: 90 }),
    onSuccess: () => { toast({ title: "Scan started", description: "BOOK.E is sweeping the last 90 days of uncategorized transactions." }); invalidate(); },
    onError: (e: any) => toast({ title: "Scan failed to start", description: e?.message, variant: "destructive" }),
  });

  const decide = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "approve" | "reject" }) =>
      apiRequest("POST", `/api/bookkeeping/proposals/${id}/${action}`),
    onSuccess: invalidate,
    onError: (e: any) => { toast({ title: "Error", description: e?.message, variant: "destructive" }); invalidate(); },
  });

  const approveBatch = useMutation({
    mutationFn: async (ids: number[]) =>
      (await apiRequest("POST", "/api/bookkeeping/approve-batch", { ids })).json(),
    onSuccess: (r: any) => {
      toast({ title: `Applied ${r.applied} to QuickBooks`, description: r.failed ? `${r.failed} failed — see rows below.` : "All recategorizations written." });
      invalidate();
    },
    onError: (e: any) => { toast({ title: "Batch failed", description: e?.message, variant: "destructive" }); invalidate(); },
  });

  const threshold = summary?.highConfidence ?? 0.9;
  const all = proposalData?.proposals ?? [];
  const pending = all.filter((p) => p.status === "pending");
  const failed = all.filter((p) => p.status === "failed");
  const high = pending.filter((p) => p.confidence >= threshold);
  const review = pending.filter((p) => p.confidence < threshold);
  const decided = all.filter((p) => ["applied", "rejected", "stale"].includes(p.status));
  const lastScan = summary?.scan?.lastResult;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpenCheck className="h-6 w-6" /> Bookkeeping Agent</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            BOOK.E sweeps QuickBooks for transactions parked in Uncategorized Expense / Ask My Accountant and proposes
            the right category with a confidence score. Nothing touches QuickBooks until <b>you</b> approve it here.
          </p>
        </div>
        <Button onClick={() => scan.mutate()} disabled={scanRunning || scan.isPending} className="gap-1.5">
          <ScanSearch className="h-4 w-4" /> {scanRunning ? "Scanning…" : "Scan last 90 days"}
        </Button>
      </div>

      {lastScan && !scanRunning && (
        <p className="text-[11px] text-muted-foreground">
          Last scan{summary?.scan?.lastRunAt ? ` (${new Date(summary.scan.lastRunAt).toLocaleString()})` : ""}:{" "}
          {lastScan.ok
            ? `${lastScan.scanned} uncategorized lines found, ${lastScan.proposed} new proposals${lastScan.skipped ? `, ${lastScan.skipped} already proposed` : ""}${lastScan.staled ? `, ${lastScan.staled} fixed in QBO directly` : ""}${lastScan.truncated ? " (capped — scan again for the rest)" : ""}${lastScan.llmErrors ? `, ${lastScan.llmErrors} skipped (model unsure/invalid)` : ""}`
            : `failed — ${lastScan.error}`}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Awaiting review" value={String(summary?.pending ?? "—")} sub={summary ? `${money(summary.pendingAmount)} in limbo` : ""} />
        <Tile label={`High confidence (≥${Math.round(threshold * 100)}%)`} value={String(summary?.pendingHigh ?? "—")} sub="eligible for one-click bulk approve" />
        <Tile label="Applied to QuickBooks" value={String(summary?.applied ?? "—")} sub={summary ? `${money(summary.appliedAmount)} recategorized` : ""} accent="green" />
        <Tile label="Rejected" value={String(summary?.rejected ?? "—")} sub="the agent learns nothing is auto-applied" />
      </div>

      {failed.length > 0 && (
        <Card className="border-red-200 dark:border-red-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" /> Failed to apply ({failed.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">QuickBooks rejected these writes (or the transaction changed since the scan). Approve retries; Reject dismisses.</p>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {failed.map((p) => (
              <ProposalRow key={p.id} p={p} threshold={threshold} decide={decide} busy={decide.isPending || approveBatch.isPending} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> High confidence ({high.length})</CardTitle>
              <p className="text-xs text-muted-foreground">Strong vendor history or unambiguous payee. Spot-check a few, then approve the batch.</p>
            </div>
            {high.length > 0 && (
              <Button size="sm" disabled={approveBatch.isPending}
                onClick={() => approveBatch.mutate(high.map((p) => p.id))}>
                {approveBatch.isPending ? "Applying…" : `Approve all ${high.length} → QuickBooks`}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
           high.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here. Run a scan, or everything high-confidence has been handled.</p> :
           high.map((p) => <ProposalRow key={p.id} p={p} threshold={threshold} decide={decide} busy={decide.isPending || approveBatch.isPending} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Needs your judgment ({review.length})</CardTitle>
          <p className="text-xs text-muted-foreground">
            The agent raised its hand on these — thin history, ambiguous payee, or an amount that doesn't fit the pattern.
            This pile is exactly why a human stays in the loop.
          </p>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {review.length === 0 ? <p className="text-sm text-muted-foreground">Empty — no uncertain proposals outstanding.</p> :
           review.map((p) => <ProposalRow key={p.id} p={p} threshold={threshold} decide={decide} busy={decide.isPending || approveBatch.isPending} />)}
        </CardContent>
      </Card>

      {decided.length > 0 && (
        <div>
          <button className="text-xs text-muted-foreground underline" onClick={() => setShowDecided((s) => !s)}>
            {showDecided ? "Hide" : "Show"} decided ({decided.length})
          </button>
          {showDecided && (
            <div className="space-y-1.5 mt-2">
              {decided.map((p) => <ProposalRow key={p.id} p={p} threshold={threshold} decide={decide} busy readOnly />)}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground pt-1">
        Every approval is written to the audit log with who and when. BOOK.E categorizes and reconciles — it never pays,
        files, or remits anything. Tax stays with a human CPA.
      </p>
    </div>
  );
}

function ProposalRow({ p, threshold, decide, busy, readOnly }: {
  p: Proposal; threshold: number;
  decide: { mutate: (v: { id: number; action: "approve" | "reject" }) => void };
  busy?: boolean; readOnly?: boolean;
}) {
  const hist = p.vendor_history ?? [];
  return (
    <div className={`rounded-lg border px-3 py-2 ${p.status === "applied" ? "bg-green-50/60 dark:bg-green-950/15 border-green-200 dark:border-green-900/30" : p.status === "rejected" || p.status === "stale" ? "opacity-55" : "hover-elevate"}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <ConfidenceBadge c={p.confidence} threshold={threshold} />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">
            {p.vendor_name ?? "(no payee)"}
            <span className="text-[11px] text-muted-foreground ml-2">{p.txn_date ?? ""} · {p.txn_type}{p.doc_number ? ` #${p.doc_number}` : ""}</span>
          </div>
          {p.description && <div className="text-[11px] text-muted-foreground truncate">{p.description}</div>}
        </div>
        <div className="text-right tabular-nums w-24 font-semibold">{money(p.amount)}</div>
        <div className="flex items-center gap-1.5 text-xs min-w-0">
          <span className="text-muted-foreground truncate max-w-[130px]">{p.current_account_name}</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="font-medium truncate max-w-[170px]">{p.proposed_account_name}</span>
        </div>
        {!readOnly && (p.status === "pending" || p.status === "failed") && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy}
              onClick={() => decide.mutate({ id: p.id, action: "approve" })}>Approve</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy}
              onClick={() => decide.mutate({ id: p.id, action: "reject" })}>Reject</Button>
          </div>
        )}
        {(readOnly || !["pending", "failed"].includes(p.status)) && (
          <span className={`text-[11px] font-medium ${p.status === "applied" ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>{p.status}</span>
        )}
      </div>
      {(p.reasoning || hist.length > 0 || p.apply_error) && (
        <div className="text-[11px] text-muted-foreground mt-1 pl-1 space-y-0.5">
          {p.reasoning && <div>{p.reasoning}</div>}
          {hist.length > 0 && (
            <div>History: {hist.map((h) => `${h.account} (${h.txns}×)`).join(" · ")}</div>
          )}
          {p.apply_error && <div className="text-red-600 dark:text-red-400">Apply failed: {p.apply_error}</div>}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "green" }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold tabular-nums ${accent === "green" ? "text-green-600 dark:text-green-400" : ""}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
