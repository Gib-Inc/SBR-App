import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { QuickReceiveDialog, type QuickReceiveContext } from "@/components/quick-receive-dialog";
import { Factory, Hammer, Plus, Loader2, AlertTriangle, PackageCheck, ChevronRight } from "lucide-react";

/**
 * Builds — what each build shop (FX / Acu-Form / Pednar) is currently making.
 * A build is an open PO to a build shop; its po_status walks the stages. Start a
 * build here, advance its stage, and Mark Received to flow it into inventory.
 */

interface BuildLine { sku: string; name: string; itemType: string; qtyOrdered: number; qtyReceived: number; remaining: number; inProcess: number; }
interface BuildOrder {
  poId: string; poNumber: string; stage: string; stageLabel: string;
  orderedDate: string | null; dueDate: string | null;
  daysInProgress: number | null; daysUntilDue: number | null; overdue: boolean;
  unitsOrdered: number; unitsRemaining: number; lines: BuildLine[];
}
interface ShopBuilds {
  shopId: string; shopName: string; openOrders: number; unitsInBuild: number; overdueCount: number;
  builds: BuildOrder[]; buildableItems: Array<{ itemId: string; sku: string; name: string; itemType: string }>;
}
interface Tracker { success: boolean; shops: ShopBuilds[]; summary: { shops: number; openOrders: number; unitsInBuild: number; overdue: number }; }

const STAGES = ["ordered", "confirmed", "in_production", "shipped", "received"];
const STAGE_LABEL: Record<string, string> = { ordered: "Ordered", confirmed: "Confirmed", in_production: "In Production", shipped: "Shipped", received: "Received" };
const stageVariant = (s: string): "default" | "secondary" | "outline" => (s === "in_production" || s === "shipped" ? "default" : "secondary");
const nextStageBefore = (s: string): string | null => {
  const i = STAGES.indexOf(s);
  if (i < 0 || i >= STAGES.length - 1) return null;
  const next = STAGES[i + 1];
  return next === "received" ? null : next; // "received" is done via Mark Received (moves inventory)
};

export default function Builds() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Tracker>({ queryKey: ["/api/build-tracker"] });
  const [startOpen, setStartOpen] = useState(false);
  const [receiveCtx, setReceiveCtx] = useState<QuickReceiveContext | null>(null);

  const advance = useMutation({
    mutationFn: async ({ poId, stage }: { poId: string; stage: string }) =>
      (await apiRequest("PATCH", `/api/purchase-orders/${poId}/po-status`, { poStatus: stage })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/build-tracker"] }),
    onError: (e: Error) => toast({ title: "Couldn't update stage", description: e.message, variant: "destructive" }),
  });

  const s = data?.summary;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal flex items-center gap-2"><Hammer className="h-5 w-5" /> Builds</h1>
          <p className="text-sm text-muted-foreground">What FX, Acu-Form, and Pednar are building — stage, quantity, and what's overdue.</p>
        </div>
        <Button onClick={() => setStartOpen(true)} data-testid="button-start-build">
          <Plus className="h-4 w-4 mr-2" /> Start a build
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="Build shops" value={s?.shops ?? 0} />
        <SummaryTile label="Open builds" value={s?.openOrders ?? 0} />
        <SummaryTile label="Units in build" value={(s?.unitsInBuild ?? 0).toLocaleString()} />
        <SummaryTile label="Overdue" value={s?.overdue ?? 0} alert={(s?.overdue ?? 0) > 0} />
      </div>

      {isLoading && <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading builds…</CardContent></Card>}

      {!isLoading && (data?.shops ?? []).map((shop) => (
        <Card key={shop.shopId} data-testid={`shop-${shop.shopId}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Factory className="h-4 w-4" /> {shop.shopName}
              <span className="text-xs font-normal text-muted-foreground">
                · {shop.openOrders} open · {shop.unitsInBuild.toLocaleString()} units
                {shop.overdueCount > 0 && <span className="text-red-600 dark:text-red-400"> · {shop.overdueCount} overdue</span>}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {shop.builds.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in build here right now.</p>
            ) : (
              shop.builds.map((b) => {
                const next = nextStageBefore(b.stage);
                const itemSummary = b.lines.map((l) => `${l.remaining} × ${l.sku}`).join(", ");
                return (
                  <div key={b.poId} className="rounded-lg border p-3" data-testid={`build-${b.poId}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant={stageVariant(b.stage)}>{b.stageLabel}</Badge>
                        <span className="font-mono text-xs text-muted-foreground">{b.poNumber}</span>
                        {b.overdue && (
                          <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                            <AlertTriangle className="h-3.5 w-3.5" /> {Math.abs(b.daysUntilDue ?? 0)}d overdue
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {next && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => advance.mutate({ poId: b.poId, stage: next })}
                            disabled={advance.isPending}
                            data-testid={`advance-${b.poId}`}>
                            <ChevronRight className="h-3.5 w-3.5 mr-1" /> {STAGE_LABEL[next]}
                          </Button>
                        )}
                        <Button size="sm" className="h-7 text-xs"
                          onClick={() => setReceiveCtx({
                            poId: b.poId, poNumber: b.poNumber, supplierName: shop.shopName,
                            itemSummary, qtyOrdered: b.unitsRemaining || b.unitsOrdered,
                          })}
                          data-testid={`receive-${b.poId}`}>
                          <PackageCheck className="h-3.5 w-3.5 mr-1" /> Mark Received
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 space-y-0.5">
                      {b.lines.map((l) => (
                        <div key={l.sku} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate"><span className="font-mono">{l.sku}</span><span className="text-muted-foreground"> {l.name}</span></span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {l.remaining}{l.qtyReceived > 0 ? ` of ${l.qtyOrdered}` : ""} building
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-1.5 text-[11px] text-muted-foreground">
                      {b.orderedDate ? `Started ${b.orderedDate}` : "Started —"}
                      {b.daysInProgress != null && ` · ${b.daysInProgress}d in progress`}
                      {b.dueDate && ` · due ${b.dueDate}`}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      ))}

      {!isLoading && (data?.shops ?? []).length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No build shops configured.</CardContent></Card>
      )}

      <StartBuildDialog open={startOpen} onOpenChange={setStartOpen} shops={data?.shops ?? []} />
      <QuickReceiveDialog
        isOpen={receiveCtx !== null}
        onClose={() => { setReceiveCtx(null); queryClient.invalidateQueries({ queryKey: ["/api/build-tracker"] }); }}
        context={receiveCtx}
      />
    </div>
  );
}

function SummaryTile({ label, value, alert }: { label: string; value: number | string; alert?: boolean }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-1 ${alert ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div>
    </div>
  );
}

function StartBuildDialog({ open, onOpenChange, shops }: { open: boolean; onOpenChange: (v: boolean) => void; shops: ShopBuilds[] }) {
  const { toast } = useToast();
  const [shopId, setShopId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [dueDate, setDueDate] = useState("");

  const items = useMemo(() => shops.find((s) => s.shopId === shopId)?.buildableItems ?? [], [shops, shopId]);

  const start = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/build-tracker/start", { shopId, itemId, qty: Number(qty), dueDate: dueDate || null })).json(),
    onSuccess: (r: any) => {
      if (r?.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/build-tracker"] });
        toast({ title: `Build started: ${r.poNumber}`, description: `${qty} × ${r.sku} at ${r.shopName}` });
        reset();
        onOpenChange(false);
      } else {
        toast({ title: "Couldn't start build", description: r?.reason ?? "Check the fields and try again.", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Couldn't start build", description: e.message, variant: "destructive" }),
  });

  const reset = () => { setShopId(""); setItemId(""); setQty(""); setDueDate(""); };
  const valid = shopId && itemId && Number(qty) > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Hammer className="h-4 w-4" /> Start a build</DialogTitle>
          <DialogDescription>Record what a shop is building. It lands as an open build, ready to advance and receive.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Shop</label>
            <Select value={shopId} onValueChange={(v) => { setShopId(v); setItemId(""); }}>
              <SelectTrigger data-testid="select-build-shop"><SelectValue placeholder="Pick a build shop" /></SelectTrigger>
              <SelectContent>
                {shops.map((s) => <SelectItem key={s.shopId} value={s.shopId}>{s.shopName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Item</label>
            <Select value={itemId} onValueChange={setItemId} disabled={!shopId}>
              <SelectTrigger data-testid="select-build-item"><SelectValue placeholder={shopId ? "Pick what they're building" : "Pick a shop first"} /></SelectTrigger>
              <SelectContent>
                {items.map((i) => <SelectItem key={i.itemId} value={i.itemId}>{i.sku} — {i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Quantity</label>
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 50" data-testid="input-build-qty" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Due date (optional)</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-build-due" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => start.mutate()} disabled={!valid || start.isPending} data-testid="button-confirm-build">
              {start.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Hammer className="mr-2 h-4 w-4" />}
              Start build
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
