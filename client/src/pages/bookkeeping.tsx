import { useEffect, useRef, useState } from "react";
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
interface RpItem {
  txnType: string; qbTxnId: string; qbLineId: string; date: string | null;
  payee: string; description: string | null; amount: number; account: string;
  accountClass: string; reason: string;
}
interface RpReview {
  ok: boolean; error?: string; count: number; totalAmount: number; windowDays: number;
  byReason: Record<string, { count: number; amount: number }>; items: RpItem[];
}
interface DailyJeLine {
  Description?: string;
  Amount: number;
  JournalEntryLineDetail: {
    PostingType: "Debit" | "Credit";
    AccountRef: { value: string; name?: string };
  };
}
interface DailyJeProposal {
  id: number;
  target_date: string;
  channel: string;
  doc_number: string;
  lines: DailyJeLine[];
  feeder: {
    // null on a money field = "not available" (a source row is missing the
    // column) — the server blocks the draft rather than showing a made-up $0.
    orders?: number; total?: number | null; subtotal?: number | null; tax?: number | null;
    discounts?: number | null; refunds?: number | null; refundItems?: number;
    shippingDerived?: number | null; revenueExTax?: number | null; taxExcluded?: number | null;
    ordersMissingTotal?: number; ordersMissingSubtotal?: number; ordersMissingTax?: number;
    ordersMissingDiscount?: number; refundItemsMissingUnitPrice?: number;
    ordersExcludedCancelled?: number; gappedOrderNames?: string[];
  } | null;
  status: string;
  block_reason: string | null;
  posted_je_id: string | null;
  created_at: string;
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

  const { data: rp } = useQuery<RpReview>({
    queryKey: ["/api/bookkeeping/related-party-review"],
    queryFn: async () => (await apiRequest("GET", "/api/bookkeeping/related-party-review")).json(),
  });

  const { data: dailyJeData } = useQuery<{ proposals: DailyJeProposal[] }>({
    queryKey: ["/api/bookkeeping/daily-je"],
    queryFn: async () => (await apiRequest("GET", "/api/bookkeeping/daily-je")).json(),
  });

  const decideDailyJe = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "approve" | "reject" | "redraft" }) =>
      apiRequest("POST", `/api/bookkeeping/daily-je/${id}/${action}`),
    onSuccess: (_r, v) => {
      toast({
        title: v.action === "approve" ? "Posted to QuickBooks" : v.action === "redraft" ? "Re-drafted" : "Rejected",
        description:
          v.action === "approve" ? "The journal entry was written to QuickBooks."
          : v.action === "redraft" ? "The day was drafted fresh through the full guard pass. Nothing posts without a new Approve."
          : "Nothing was posted. Use Re-draft below if this was a mis-click.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bookkeeping/daily-je"] });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e?.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/bookkeeping/daily-je"] });
    },
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
  const rpItems = rp?.items ?? [];
  // Collapse recurring same-payee+reason clusters (owner draws, weekly family pay) into one
  // summary line each; show genuinely distinct one-offs individually so they don't get buried.
  const rpGroups = Array.from(
    rpItems.reduce((m, it) => {
      const k = `${it.payee}||${it.reason}`;
      const g = m.get(k) ?? { key: k, payee: it.payee, reason: it.reason, items: [] as RpItem[], total: 0 };
      g.items.push(it); g.total += it.amount; m.set(k, g);
      return m;
    }, new Map<string, { key: string; payee: string; reason: string; items: RpItem[]; total: number }>()).values(),
  ).sort((a, b) => b.total - a.total);
  const rpRecurring = rpGroups.filter((g) => g.items.length >= 3);
  const rpSingles = rpGroups.filter((g) => g.items.length < 3).flatMap((g) => g.items).sort((a, b) => b.amount - a.amount);
  const dailyJes = dailyJeData?.proposals ?? [];
  // 'posting' = an approve is mid-flight (or a crashed one awaiting reconcile) — keep it visible.
  const dailyJeOpen = dailyJes.filter((p) => ["pending", "blocked", "posting"].includes(p.status));
  const dailyJeDecided = dailyJes.filter((p) => ["approved_posted", "rejected", "superseded"].includes(p.status));
  const dailyJeRejected = dailyJeDecided.filter((p) => p.status === "rejected").slice(0, 10);

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

      {lastScan?.ok && !scanRunning && (summary?.pending ?? 0) === 0 && high.length === 0 && review.length === 0 && failed.length === 0 && !(rp && rp.count > 0) && (
        <Card className="border-green-200 bg-green-50/50 dark:border-green-900/40 dark:bg-green-950/20">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldCheck className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-green-800 dark:text-green-300">Connected and watching — your books are clean.</p>
              <p className="text-muted-foreground mt-0.5">
                The last scan checked QuickBooks and found <b>0</b> transactions parked in Uncategorized. That is the
                healthy state, not a malfunction: your books code everything to a real account, so there is nothing to
                recategorize. BOOK.E runs on every scan and will surface anything that ever lands in a holding account.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Awaiting review" value={String(summary?.pending ?? "—")} sub={summary ? `${money(summary.pendingAmount)} in limbo` : ""} />
        <Tile label={`High confidence (≥${Math.round(threshold * 100)}%)`} value={String(summary?.pendingHigh ?? "—")} sub="eligible for one-click bulk approve" />
        <Tile label="Applied to QuickBooks" value={String(summary?.applied ?? "—")} sub={summary ? `${money(summary.appliedAmount)} recategorized` : ""} accent="green" />
        <Tile label="Rejected" value={String(summary?.rejected ?? "—")} sub="the agent learns nothing is auto-applied" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpenCheck className="h-4 w-4" /> Daily sales entries ({dailyJeOpen.length})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Each night the app drafts the prior day's sales journal entries (one per channel) from order data.
            Review the source numbers and the exact QuickBooks lines, then Approve — nothing posts until you do.
            Blocked drafts show why they cannot be posted safely.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {dailyJeOpen.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No daily sales entries waiting. New drafts appear each morning for the prior day.
            </p>
          ) : (
            dailyJeOpen.map((p) => (
              <DailyJeRow key={p.id} p={p} decide={decideDailyJe} busy={decideDailyJe.isPending} />
            ))
          )}
          {dailyJeRejected.length > 0 && (
            <div className="pt-1 space-y-1">
              <p className="text-[11px] text-muted-foreground">Recently rejected (re-draftable):</p>
              {dailyJeRejected.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground pl-1">
                  <span className="truncate">
                    {p.channel === "SHOPIFY" ? "Shopify" : "Amazon"} {String(p.target_date).slice(0, 10)}
                    <span className="ml-1 opacity-60">#{p.doc_number}</span>
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px]" disabled={decideDailyJe.isPending}
                    onClick={() => decideDailyJe.mutate({ id: p.id, action: "redraft" })}>Re-draft</Button>
                </div>
              ))}
            </div>
          )}
          {dailyJeDecided.length > 0 && (
            <p className="text-[11px] text-muted-foreground pt-1">
              {dailyJeDecided.filter((p) => p.status === "approved_posted").length} posted ·{" "}
              {dailyJeDecided.filter((p) => p.status === "rejected").length} rejected ·{" "}
              {dailyJeDecided.filter((p) => p.status === "superseded").length} superseded by fresher drafts
            </p>
          )}
        </CardContent>
      </Card>

      {rp && rp.count > 0 && (
        <Card className="border-amber-200 dark:border-amber-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Owner &amp; related-party review ({rpRecurring.length + rpSingles.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              What a bookkeeper pulls from your books for the reasonable-comp and personal-expense review. Recurring
              patterns (your draws, weekly family pay) are rolled up; one-off items are listed so they don't get buried.
              Correctly recorded — flagged for you and your CPA, never changed here.
            </p>
          </CardHeader>
          <CardContent className="space-y-0">
            {rpRecurring.map((g) => (
              <div key={g.key} className="flex items-center justify-between gap-3 py-2 mb-1.5 rounded-md bg-muted/50 px-3 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{g.payee}</span>
                  <span className="text-xs text-muted-foreground"> · {g.items.length}× · {g.reason} — reviewed in aggregate, not line by line</span>
                </div>
                <div className="tabular-nums font-semibold whitespace-nowrap">{money(g.total)}</div>
              </div>
            ))}
            {rpSingles.length > 0 && rpRecurring.length > 0 && (
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground pt-1 pb-0.5">One-off items to eyeball</div>
            )}
            {rpSingles.slice(0, 40).map((it) => (
              <div key={`${it.qbTxnId}:${it.qbLineId}`} className="flex items-center justify-between gap-3 py-1.5 border-b last:border-0 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{it.payee} <span className="text-xs font-normal text-muted-foreground">· {it.reason}</span></div>
                  <div className="text-xs text-muted-foreground truncate">{it.date ?? "—"} · {it.account}{it.description ? ` · ${it.description}` : ""}</div>
                </div>
                <div className="tabular-nums font-semibold whitespace-nowrap">{money(it.amount)}</div>
              </div>
            ))}
            {rpSingles.length > 40 && <p className="text-xs text-muted-foreground pt-2">+ {rpSingles.length - 40} more…</p>}
          </CardContent>
        </Card>
      )}

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
           high.length === 0 ? <p className="text-sm text-muted-foreground">No high-confidence proposals waiting. A zero here is normal for your books — it means nothing is parked in Uncategorized to recategorize.</p> :
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
          {review.length === 0 ? <p className="text-sm text-muted-foreground">Nothing flagged for your judgment right now.</p> :
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

const money2 = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function DailyJeRow({ p, decide, busy }: {
  p: DailyJeProposal;
  decide: { mutate: (v: { id: number; action: "approve" | "reject" | "redraft" }) => void };
  busy?: boolean;
}) {
  // Synchronous double-click guard: React's isPending only disables the
  // button on the NEXT render — a fast double-click fires two mutations in
  // the same tick. The ref flips immediately; the server-side atomic claim
  // (409 on the loser) is the real lock, this just avoids the noisy toast.
  const firedRef = useRef(false);
  useEffect(() => { if (!busy) firedRef.current = false; }, [busy]);
  const fire = (action: "approve" | "reject" | "redraft") => {
    if (firedRef.current) return;
    firedRef.current = true;
    decide.mutate({ id: p.id, action });
  };
  const f = p.feeder ?? {};
  const isShopify = p.channel === "SHOPIFY";
  const blocked = p.status === "blocked";
  const posting = p.status === "posting";
  const feederBits: Array<[string, string]> = isShopify
    ? [
        ["Orders", String(f.orders ?? "—")],
        ["Total", money2(f.total)],
        ["Tax", money2(f.tax)],
        ["Discounts", money2(f.discounts)],
        ["Refunds", money2(f.refunds)],
      ]
    : [
        ["Orders", String(f.orders ?? "—")],
        ["Total", money2(f.total)],
        ["Tax excluded", money2(f.taxExcluded)],
        ["Revenue ex-tax", money2(f.revenueExTax)],
      ];
  return (
    <div className={`rounded-lg border px-3 py-2 ${blocked ? "border-amber-300 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/15" : "hover-elevate"}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <Badge className={`text-[10px] font-semibold ${isShopify ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300" : "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-300"}`}>
          {isShopify ? "Shopify" : "Amazon"}
        </Badge>
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            {String(p.target_date).slice(0, 10)}
            <span className="text-[11px] text-muted-foreground ml-2">#{p.doc_number}</span>
          </div>
        </div>
        {posting && (
          <Badge className="bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300 text-[10px] font-semibold">
            Posting to QuickBooks…
          </Badge>
        )}
        {!blocked && !posting && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy}
              onClick={() => fire("approve")}>Approve → QuickBooks</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy}
              onClick={() => fire("reject")}>Reject</Button>
          </div>
        )}
        {blocked && (
          <div className="flex items-center gap-1.5">
            <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300 text-[10px] font-semibold">Blocked</Badge>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy}
              onClick={() => fire("redraft")}>Re-draft now</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy}
              onClick={() => fire("reject")}>Dismiss</Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground mt-1 pl-1">
        {feederBits.map(([label, val]) => (
          <span key={label}>{label}: <span className="tabular-nums font-medium text-foreground">{val}</span></span>
        ))}
        {(f.ordersMissingTotal ?? 0) > 0 && <span className="text-amber-700 dark:text-amber-400">{f.ordersMissingTotal} order(s) missing total — not available</span>}
        {(f.ordersMissingSubtotal ?? 0) > 0 && <span className="text-amber-700 dark:text-amber-400">{f.ordersMissingSubtotal} order(s) missing subtotal — not available</span>}
        {(f.ordersMissingTax ?? 0) > 0 && <span className="text-amber-700 dark:text-amber-400">{f.ordersMissingTax} order(s) missing tax — not available</span>}
        {(f.ordersMissingDiscount ?? 0) > 0 && <span className="text-amber-700 dark:text-amber-400">{f.ordersMissingDiscount} order(s) missing discount — not available</span>}
        {(f.refundItemsMissingUnitPrice ?? 0) > 0 && <span className="text-amber-700 dark:text-amber-400">{f.refundItemsMissingUnitPrice} refund line(s) missing unit price — not available</span>}
        {(f.ordersExcludedCancelled ?? 0) > 0 && <span>{f.ordersExcludedCancelled} cancelled order(s) excluded</span>}
      </div>
      {blocked && p.block_reason && (
        <div className="text-[11px] text-amber-800 dark:text-amber-300 mt-1 pl-1 flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" /> <span>{p.block_reason}</span>
        </div>
      )}
      <div className="mt-1.5 pl-1 space-y-0.5">
        {(p.lines ?? []).map((l, i) => {
          const d = l.JournalEntryLineDetail;
          const dr = d.PostingType === "Debit";
          return (
            <div key={i} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-muted-foreground truncate">
                <span className={`font-semibold mr-1.5 ${dr ? "" : "pl-4"}`}>{dr ? "Dr" : "Cr"}</span>
                {d.AccountRef.name ?? d.AccountRef.value}
                <span className="ml-1 opacity-60">({d.AccountRef.value})</span>
              </span>
              <span className="tabular-nums font-medium whitespace-nowrap">{money2(l.Amount)}</span>
            </div>
          );
        })}
      </div>
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
