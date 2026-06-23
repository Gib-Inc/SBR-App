/**
 * CreditLinesCard — every credit line / debt balance in one place, from the
 * QuickBooks balance sheet the app already pulls. v1 shows balances (credit cards
 * aggregate, each named loan with rate/term, and the remaining liabilities). Per-
 * card limits + utilization come next, once each card is registered with its limit.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard } from "lucide-react";

interface LoanLine { name: string; balance: number | null; term?: string | null; rate?: number | null; }
interface BalanceSheet {
  creditCards: number | null;
  shortTermNotes?: number | null;
  longTermLiabilities?: number | null;
  salesTaxToPay?: number | null;
  totalLiabilities: number | null;
  loans?: LoanLine[];
  asOf?: string;
}

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();

export function CreditLinesCard({ balanceSheet }: { balanceSheet: BalanceSheet | null }) {
  if (!balanceSheet) return null;
  const bs = balanceSheet;

  const lines: { name: string; balance: number; sub?: string }[] = [];
  if (bs.creditCards && bs.creditCards !== 0) lines.push({ name: "Credit cards", balance: bs.creditCards });
  let loanSum = 0;
  for (const l of bs.loans ?? []) {
    const bal = l.balance ?? 0;
    if (bal === 0) continue;
    loanSum += bal;
    const sub = [l.rate != null ? `${l.rate}% APR` : null, l.term].filter(Boolean).join(" · ");
    lines.push({ name: l.name, balance: bal, sub: sub || undefined });
  }
  // Whatever's left in total liabilities that isn't cards or named loans (notes, tax, etc.).
  const total = bs.totalLiabilities ?? 0;
  const other = Math.round((total - (bs.creditCards ?? 0) - loanSum) * 100) / 100;
  if (other > 1) lines.push({ name: "Other liabilities (notes, tax)", balance: other });

  lines.sort((a, b) => b.balance - a.balance);

  return (
    <Card data-testid="card-credit-lines">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4" /> Credit lines &amp; debt</CardTitle>
        <CardDescription>All balances in one place{bs.asOf ? ` · as of ${bs.asOf}` : ""}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No liabilities on the latest balance sheet.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {lines.map((l) => (
              <div key={l.name} className="flex items-center justify-between px-3 py-2 text-sm" data-testid={`creditline-${l.name}`}>
                <span className="min-w-0">
                  <span className="font-medium">{l.name}</span>
                  {l.sub && <span className="ml-2 text-xs text-muted-foreground">{l.sub}</span>}
                </span>
                <span className="shrink-0 tabular-nums">{money(l.balance)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">Total debt</span>
              <span className="tabular-nums font-semibold text-red-600 dark:text-red-400">{money(total)}</span>
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Balances from the QuickBooks balance sheet. Next: register each card's limit + APR to add available credit, utilization, and due dates.
        </p>
      </CardContent>
    </Card>
  );
}
