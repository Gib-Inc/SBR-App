import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, DollarSign, AlertTriangle } from "lucide-react";

/**
 * CIPH.R — Financial Position card. Shows the latest QuickBooks financial
 * snapshot (cash on hand, AR/AP, P&L summary) with a data-health status.
 * ANTI-HALLUCINATION: any field the snapshot couldn't pull is shown as
 * "DATA GAPPED" — never a fabricated number — and listed below the card.
 */

interface FinancialSnapshot {
  id: string;
  capturedAt: string;
  cashOnHand: string | null;
  accountsReceivable: string | null;
  accountsPayable: string | null;
  operatingExpenses: string | null;
  grossProfit: string | null;
  netIncome: string | null;
  totalIncome: string | null;
  plPeriodStart: string | null;
  plPeriodEnd: string | null;
  dataGaps: string[] | null;
  confidence: number | null;
}

const fmtMoney = (v: string | null): string | null =>
  v == null
    ? null
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));

function healthStatus(snap: FinancialSnapshot | null): { label: string; tone: string } {
  if (!snap) return { label: "NO DATA", tone: "bg-muted text-muted-foreground" };
  const ageHrs = (Date.now() - new Date(snap.capturedAt).getTime()) / 3_600_000;
  const gaps = snap.dataGaps?.length ?? 0;
  const conf = snap.confidence ?? 0;
  if (conf === 100 && gaps === 0 && ageHrs <= 26) {
    return { label: "HEALTHY", tone: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" };
  }
  return { label: "NEEDS UPDATE", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" };
}

export function FinancialPositionCard() {
  const { data, isLoading } = useQuery<{ success: boolean; snapshot: FinancialSnapshot | null }>({
    queryKey: ["/api/quickbooks/financial-snapshot"],
  });

  const capture = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/quickbooks/financial-snapshot/capture"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/financial-snapshot"] }),
  });

  const snap = data?.snapshot ?? null;
  const status = healthStatus(snap);
  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Cash on Hand", value: fmtMoney(snap?.cashOnHand ?? null) },
    { label: "Accounts Receivable", value: fmtMoney(snap?.accountsReceivable ?? null) },
    { label: "Accounts Payable", value: fmtMoney(snap?.accountsPayable ?? null) },
    { label: "Operating Expenses (30d)", value: fmtMoney(snap?.operatingExpenses ?? null) },
    { label: "Net Income (30d)", value: fmtMoney(snap?.netIncome ?? null) },
  ];

  return (
    <Card data-testid="card-financial-position">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <DollarSign className="h-4 w-4" /> Financial Position
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge className={status.tone} data-testid="badge-financial-health">
            {status.label}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => capture.mutate()}
            disabled={capture.isPending}
            data-testid="button-financial-refresh"
            title="Pull the current position from QuickBooks"
          >
            <RefreshCw className={`h-4 w-4 ${capture.isPending ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !snap ? (
          <p className="text-sm text-muted-foreground" data-testid="text-financial-empty">
            No snapshot yet. Connect QuickBooks, then refresh to capture the current position.
          </p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{r.label}</span>
                {r.value == null ? (
                  <span className="text-amber-600 dark:text-amber-400 text-xs font-medium">DATA GAPPED</span>
                ) : (
                  <span className="font-medium tabular-nums">{r.value}</span>
                )}
              </div>
            ))}
            <div className="pt-2 mt-1 border-t flex items-center justify-between text-xs text-muted-foreground">
              <span data-testid="text-financial-confidence">Confidence {snap.confidence ?? 0}%</span>
              <span>As of {new Date(snap.capturedAt).toLocaleString()}</span>
            </div>
            {(snap.dataGaps?.length ?? 0) > 0 && (
              <div className="pt-1 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  {snap.dataGaps!.length} data gap(s): {snap.dataGaps!.slice(0, 3).join("; ")}
                  {snap.dataGaps!.length > 3 ? "…" : ""}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
