/**
 * CfoApprovalQueueCard — the Approval Queue (Operation CFO, Build 2).
 *
 * Renders every pending human decision aggregated server-side from the EXISTING
 * approval flows (/api/cfo/approval-queue) with its full evidence attached.
 * Approve buttons call the EXISTING gated endpoints the server named — this
 * component invents no write paths and holds no permissions: SoD/role gates
 * stay server-side where they already live (a non-owner tapping a PO approve
 * gets the server's 403). Items without an existing endpoint render as manual
 * steps with instructions. Dismiss is view-local only — nothing is persisted.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  ClipboardCheck, FileCheck2, Boxes, ShoppingCart, Landmark, ShieldAlert, ArrowRight, X,
} from "lucide-react";

type ApprovalKind = "recon_proposed" | "inventory_drift" | "po_draft" | "stale_bank" | "truth_check";
interface ApproveAction { method: string; path: string; payload: Record<string, unknown> | null; gate: string; label: string }
interface ManualStep { instructions: string; href: string | null }
interface QueueItem {
  id: string; kind: ApprovalKind; title: string;
  evidence: Record<string, unknown>;
  source: string; asOf: string | null;
  approveAction: ApproveAction | null; manualStep: ManualStep | null;
  dismissable: boolean;
}
interface ApprovalQueue { generatedAt: string; count: number; items: QueueItem[]; problems: string[] }

const KIND_ICON: Record<ApprovalKind, React.ReactNode> = {
  recon_proposed: <FileCheck2 className="h-3.5 w-3.5" />,
  inventory_drift: <Boxes className="h-3.5 w-3.5" />,
  po_draft: <ShoppingCart className="h-3.5 w-3.5" />,
  stale_bank: <Landmark className="h-3.5 w-3.5" />,
  truth_check: <ShieldAlert className="h-3.5 w-3.5" />,
};
const KIND_LABEL: Record<ApprovalKind, string> = {
  recon_proposed: "Proposed correction",
  inventory_drift: "Inventory drift",
  po_draft: "Purchase order",
  stale_bank: "Bank balance",
  truth_check: "Truth check",
};

function fmtAsOf(asOf: string | null): string | null {
  if (!asOf) return null;
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return asOf;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Structured evidence rendered as verbatim key/value lines (arrays get a compact table). */
function Evidence({ evidence }: { evidence: Record<string, unknown> }) {
  return (
    <div className="space-y-0.5 text-[11px] text-muted-foreground">
      {Object.entries(evidence).map(([k, v]) => {
        if (v == null) return null;
        if (Array.isArray(v)) {
          return (
            <div key={k}>
              <span className="font-medium">{k}:</span>
              <div className="ml-2 space-y-0.5">
                {v.length === 0 && <div>—</div>}
                {v.map((row: any, i: number) =>
                  row && typeof row === "object" ? (
                    <div key={i} className="tabular-nums">
                      {"sku" in row ? `${row.sku ?? "?"} · ` : ""}
                      {"qtyOrdered" in row ? `${row.qtyOrdered} × $${row.unitCost} = $${row.lineTotal}` : JSON.stringify(row)}
                    </div>
                  ) : (
                    <div key={i}>{String(row)}</div>
                  ),
                )}
              </div>
            </div>
          );
        }
        if (typeof v === "object") {
          return (
            <div key={k}><span className="font-medium">{k}:</span> {JSON.stringify(v)}</div>
          );
        }
        return (
          <div key={k}><span className="font-medium">{k}:</span> {String(v)}</div>
        );
      })}
    </div>
  );
}

function QueueRow({ item, onDismiss }: { item: QueueItem; onDismiss: (id: string) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [armed, setArmed] = useState(false);

  const approve = useMutation({
    mutationFn: async (a: ApproveAction) => apiRequest(a.method, a.path, a.payload ?? undefined),
    onSuccess: () => {
      toast({ title: "Approved", description: `${item.title} — sent through the existing gate.` });
      queryClient.invalidateQueries({ queryKey: ["/api/cfo/approval-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cfo/verdict"] });
    },
    onError: (e: any) => {
      // Permission lives server-side — a 403 here is the existing gate doing its job.
      toast({ title: "Not applied", description: e?.message ?? String(e), variant: "destructive" });
    },
    onSettled: () => setArmed(false),
  });

  const asOf = fmtAsOf(item.asOf);
  return (
    <div className="rounded-lg border p-2.5 space-y-1.5" data-testid={`queue-item-${item.id}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-muted-foreground">{KIND_ICON[item.kind]}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug">{item.title}</div>
          <div className="text-[10px] text-muted-foreground truncate" title={item.source}>
            {KIND_LABEL[item.kind]} · {item.source.split("(")[0].trim()}{asOf ? ` · ${asOf}` : ""}
          </div>
        </div>
        {item.dismissable && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            title="Dismiss from this view (nothing is persisted — it returns on reload if still pending)"
            onClick={() => onDismiss(item.id)}
            data-testid={`dismiss-${item.id}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* PO cash-out date beside the landed cost — the basis is ALWAYS stated (assumed terms never silent) */}
      {item.kind === "po_draft" && item.evidence.cashOutBasis != null && (
        <div className="text-[11px] leading-snug text-muted-foreground" data-testid={`cashout-${item.id}`}>
          <span className="font-medium">Cash out:</span>{" "}
          <span className="tabular-nums">{item.evidence.cashOutDate != null ? String(item.evidence.cashOutDate) : "date unavailable"}</span>
          {typeof item.evidence.total === "number" && ` · landed $${Math.round(item.evidence.total).toLocaleString()}`}
          {" — "}{String(item.evidence.cashOutBasis)}
        </div>
      )}

      <details className="text-[11px]">
        <summary className="cursor-pointer text-muted-foreground select-none">Evidence</summary>
        <div className="mt-1 rounded border bg-muted/30 p-2">
          <Evidence evidence={item.evidence} />
        </div>
      </details>

      {item.approveAction ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={armed ? "destructive" : "outline"}
            className="h-7 text-xs"
            disabled={approve.isPending}
            onClick={() => (armed ? approve.mutate(item.approveAction!) : setArmed(true))}
            data-testid={`approve-${item.id}`}
          >
            {approve.isPending ? "Applying…" : armed ? `Confirm: ${item.approveAction.label}` : item.approveAction.label}
          </Button>
          {armed && !approve.isPending && (
            <button type="button" className="text-[11px] text-muted-foreground hover:underline" onClick={() => setArmed(false)}>
              cancel
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" title={item.approveAction.gate}>
            via {item.approveAction.method} {item.approveAction.path.split("?")[0]}
          </span>
        </div>
      ) : item.manualStep ? (
        <div className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium">Manual step:</span> {item.manualStep.instructions}
          {item.manualStep.href && (
            <Link href={item.manualStep.href} className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">
              open <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function CfoApprovalQueueCard() {
  const { data, isLoading } = useQuery<{ success: boolean; queue: ApprovalQueue }>({
    queryKey: ["/api/cfo/approval-queue"],
  });
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const q = data?.queue;

  if (isLoading) {
    return (
      <Card data-testid="card-approval-queue">
        <CardContent className="p-4 text-sm text-muted-foreground">Gathering pending decisions…</CardContent>
      </Card>
    );
  }
  if (!q) return null;

  const visible = q.items.filter((i) => !dismissed.has(i.id));

  return (
    <Card data-testid="card-approval-queue">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4" /> Approval Queue
          <span className="ml-auto rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums" data-testid="badge-queue-count">
            {visible.length}
          </span>
        </CardTitle>
        <CardDescription>
          Every pending human decision, evidence attached. Approve taps call the existing gated endpoints — permission stays
          server-side; nothing here moves without you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {q.problems.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" data-testid="queue-problems">
            Partial view — {q.problems.join("; ")}
          </div>
        )}
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="queue-empty">
            {q.items.length > 0
              ? "All visible items dismissed for this view — they return on reload if still pending."
              : "Queue clear — no pending human decisions in any monitored flow."}
          </p>
        ) : (
          visible.map((item) => (
            <QueueRow key={item.id} item={item} onDismiss={(id) => setDismissed((s) => new Set(s).add(id))} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
