/**
 * CreditLinesCard — every card / LOC / loan in one place. Balances sync live from
 * QuickBooks; you register each line's limit + APR + due day once, and the card
 * derives available credit, utilization, and the next due date. Falls back to the
 * balance-sheet aggregate until QuickBooks has synced the per-account balances.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, RefreshCw, Pencil, Plus } from "lucide-react";

interface CreditLine {
  id: string; name: string; type: string; qbAccountName: string | null;
  balance: number; creditLimit: number | null; apr: number | null;
  available: number | null; utilization: number | null;
  dueDay: number | null; nextDue: string | null; highUtilization: boolean;
}
interface Resp {
  lines: CreditLine[];
  totals: { totalBalance: number; totalLimit: number | null; totalAvailable: number | null; blendedUtilization: number | null; count: number };
}
interface LoanLine { name: string; balance: number | null; term?: string | null; rate?: number | null; }
interface BalanceSheet { creditCards: number | null; totalLiabilities: number | null; loans?: LoanLine[]; asOf?: string }

const money = (x: number) => "$" + Math.round(x || 0).toLocaleString();
const utilTone = (u: number | null) =>
  u == null ? "text-muted-foreground" : u >= 80 ? "text-red-600 dark:text-red-400" : u > 30 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";

function EditDialog({ line, onSaved }: { line: CreditLine; onSaved: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(line.creditLimit?.toString() ?? "");
  const [apr, setApr] = useState(line.apr?.toString() ?? "");
  const [due, setDue] = useState(line.dueDay?.toString() ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const body: any = {};
      body.creditLimit = limit === "" ? null : Number(limit);
      body.apr = apr === "" ? null : Number(apr);
      body.dueDay = due === "" ? null : Number(due);
      return (await apiRequest("PATCH", `/api/finances/credit-lines/${line.id}`, body)).json();
    },
    onSuccess: () => { setOpen(false); onSaved(); toast({ title: `Updated ${line.name}` }); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-1.5" data-testid={`button-edit-${line.id}`}><Pencil className="h-3 w-3" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{line.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Credit limit ($)</Label><Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" placeholder="e.g. 25000" /></div>
          <div><Label className="text-xs">APR (%)</Label><Input value={apr} onChange={(e) => setApr(e.target.value)} inputMode="decimal" placeholder="e.g. 21.99" /></div>
          <div><Label className="text-xs">Due day of month (1-31)</Label><Input value={due} onChange={(e) => setDue(e.target.value)} inputMode="numeric" placeholder="e.g. 15" /></div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddDialog({ onSaved }: { onSaved: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [apr, setApr] = useState("");
  const [due, setDue] = useState("");
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/finances/credit-lines", {
      name, type: "card",
      creditLimit: limit === "" ? undefined : Number(limit),
      apr: apr === "" ? undefined : Number(apr),
      dueDay: due === "" ? undefined : Number(due),
    })).json(),
    onSuccess: () => { setOpen(false); setName(""); setLimit(""); setApr(""); setDue(""); onSaved(); toast({ title: "Credit line added" }); },
    onError: (e: Error) => toast({ title: "Add failed", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" data-testid="button-add-line"><Plus className="mr-1 h-3 w-3" /> Add</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add a credit line</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amex Business" /></div>
          <div><Label className="text-xs">Credit limit ($)</Label><Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" /></div>
          <div><Label className="text-xs">APR (%)</Label><Input value={apr} onChange={(e) => setApr(e.target.value)} inputMode="decimal" /></div>
          <div><Label className="text-xs">Due day (1-31)</Label><Input value={due} onChange={(e) => setDue(e.target.value)} inputMode="numeric" /></div>
        </div>
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreditLinesCard({ balanceSheet }: { balanceSheet: BalanceSheet | null }) {
  const { toast } = useToast();
  const { data } = useQuery<Resp>({ queryKey: ["/api/finances/credit-lines"] });
  const refetch = () => queryClient.invalidateQueries({ queryKey: ["/api/finances/credit-lines"] });
  const sync = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/finances/credit-lines/sync", {})).json(),
    onSuccess: (r: any) => { refetch(); toast({ title: r?.synced ? `Synced ${r.synced} accounts from QuickBooks` : (r?.skipped || "Nothing to sync") }); },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const lines = data?.lines ?? [];
  const totals = data?.totals;

  return (
    <Card data-testid="card-credit-lines">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4" /> Credit lines &amp; debt</CardTitle>
          <CardDescription>All balances in one place. Balances from QuickBooks; you set limits + due dates.</CardDescription>
        </div>
        <div className="flex shrink-0 gap-1">
          <AddDialog onSaved={refetch} />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => sync.mutate()} disabled={sync.isPending} data-testid="button-sync-lines">
            <RefreshCw className={`mr-1 h-3 w-3 ${sync.isPending ? "animate-spin" : ""}`} /> Sync
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {lines.length === 0 ? (
          <>
            {balanceSheet && (balanceSheet.totalLiabilities ?? 0) > 0 ? (
              <div className="divide-y rounded-lg border">
                {balanceSheet.creditCards ? (
                  <div className="flex justify-between px-3 py-2 text-sm"><span>Credit cards</span><span className="tabular-nums">{money(balanceSheet.creditCards)}</span></div>
                ) : null}
                {(balanceSheet.loans ?? []).filter((l) => (l.balance ?? 0) !== 0).map((l) => (
                  <div key={l.name} className="flex justify-between px-3 py-2 text-sm"><span>{l.name}{l.rate != null ? <span className="ml-2 text-xs text-muted-foreground">{l.rate}% APR</span> : null}</span><span className="tabular-nums">{money(l.balance ?? 0)}</span></div>
                ))}
                <div className="flex justify-between bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">Total debt</span><span className="tabular-nums font-semibold text-red-600 dark:text-red-400">{money(balanceSheet.totalLiabilities ?? 0)}</span></div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No credit lines yet. Click Sync to pull balances from QuickBooks, or Add to register one manually.</p>
            )}
            <p className="text-[11px] text-muted-foreground">Per-card balances populate from QuickBooks on Sync. Aggregate shown from the balance sheet meanwhile.</p>
          </>
        ) : (
          <>
            {totals && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <span><span className="font-semibold text-red-600 dark:text-red-400">{money(totals.totalBalance)}</span><span className="text-muted-foreground"> owed</span></span>
                {totals.totalAvailable != null && <span><span className="font-semibold">{money(totals.totalAvailable)}</span><span className="text-muted-foreground"> available</span></span>}
                {totals.blendedUtilization != null && <span className={utilTone(totals.blendedUtilization)}><span className="font-semibold">{totals.blendedUtilization}%</span> utilization</span>}
              </div>
            )}
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Line</th>
                    <th className="px-2 py-1.5 text-right font-medium">Balance</th>
                    <th className="px-2 py-1.5 text-right font-medium">Limit</th>
                    <th className="px-2 py-1.5 text-right font-medium">Util.</th>
                    <th className="px-2 py-1.5 text-right font-medium">APR</th>
                    <th className="px-2 py-1.5 text-right font-medium">Due</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l) => (
                    <tr key={l.id} className="hover-elevate" data-testid={`creditline-${l.id}`}>
                      <td className="px-3 py-1.5"><span className="font-medium">{l.name}</span></td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(l.balance)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{l.creditLimit != null ? money(l.creditLimit) : "—"}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${utilTone(l.utilization)}`}>{l.utilization != null ? `${l.utilization}%` : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{l.apr != null ? `${l.apr}%` : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{l.nextDue ? l.nextDue.slice(5) : "—"}</td>
                      <td className="px-2 py-1.5 text-right"><EditDialog line={l} onSaved={refetch} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Set a line's limit + APR + due day with the pencil to light up available credit, utilization, and due-date tracking.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
