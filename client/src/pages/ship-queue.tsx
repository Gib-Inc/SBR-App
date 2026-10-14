import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Box, Printer, ExternalLink, AlertTriangle, Ruler, Download } from "lucide-react";

interface QueueOrder {
  id: string;
  orderName: string;
  customer: string;
  shopifyUrl: string | null;
  orderDay: string;
  ageDays: number;
  sku?: string;
  qty?: number;
  parcels?: number;
  lines?: Array<{ sku: string; qty: number }>;
  reason?: string;
}

interface QueueBatch {
  boxName: string;
  boxSku: string | null;
  dims: string | null;
  weightOz: number | null;
  notes: string | null;
  orders: QueueOrder[];
}

interface StandardBox {
  label: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  bundle: number;
}

interface ShipQueueData {
  summary: { openOrders: number; batched: number; exceptions: number; oldestDay: number };
  batches: QueueBatch[];
  exceptions: QueueOrder[];
  standardBoxes?: StandardBox[];
}

// Pack & print view: the whole open-order backlog grouped by shipping box, so
// labels get bought in same-box runs instead of one-by-one guessing. Buying
// stays in Shopify admin (deep links per order); this page owns WHICH box.
export default function ShipQueue() {
  const { toast } = useToast();
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [dimDraft, setDimDraft] = useState({ boxName: "", lengthIn: "", widthIn: "", heightIn: "", weightOz: "" });

  const { data, isLoading, error } = useQuery<ShipQueueData>({ queryKey: ["/api/ship-queue"] });

  const saveRule = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ship-queue/rule", body);
      return res.json();
    },
    onSuccess: () => {
      setEditingSku(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ship-queue"] });
      toast({ title: "Packing rule saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  const downloadCsv = (batch: QueueBatch) => {
    const header = "order,customer,sku,qty,parcels,box,dims,age_days,shopify_url";
    const rows = batch.orders.map((o) =>
      [o.orderName, o.customer, o.sku, o.qty, o.parcels, batch.boxName, batch.dims ?? "", o.ageDays, o.shopifyUrl ?? ""]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ship-batch-${batch.boxName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading ship queue…</div>;
  if (error || !data) return <div className="p-6 text-destructive">Failed to load ship queue.</div>;

  const { summary, batches, exceptions } = data;

  return (
    <div className="p-4 md:p-6 space-y-4 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Box className="h-5 w-5" /> Ship Queue</h1>
          <p className="text-sm text-muted-foreground">
            {summary.openOrders} open orders · {summary.batched} batched by box · {summary.exceptions} need a human · oldest {summary.oldestDay}d
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()} data-testid="button-print-manifest">
          <Printer className="h-4 w-4 mr-2" /> Print manifest
        </Button>
      </div>

      {batches.map((batch) => (
        <Card key={batch.boxName} className="break-inside-avoid">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex flex-wrap items-center gap-2">
              {batch.boxName}
              {batch.dims ? (
                <Badge variant="outline" className="font-normal">{batch.dims}</Badge>
              ) : (
                <Badge variant="destructive" className="font-normal">size TBD</Badge>
              )}
              {batch.weightOz != null && <Badge variant="outline" className="font-normal">{(batch.weightOz / 16).toFixed(1)} lb</Badge>}
              <Badge className="font-normal">{batch.orders.length} orders · {batch.orders.reduce((s, o) => s + (o.parcels ?? 1), 0)} boxes</Badge>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="print:hidden" onClick={() => downloadCsv(batch)}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
              {!batch.dims && batch.orders[0]?.sku && (
                <Button size="sm" variant="outline" className="print:hidden" onClick={() => {
                  setEditingSku(batch.orders[0].sku!);
                  setDimDraft({ boxName: batch.boxName, lengthIn: "", widthIn: "", heightIn: "", weightOz: "" });
                }}>
                  <Ruler className="h-4 w-4 mr-1" /> Set size
                </Button>
              )}
            </CardTitle>
            {batch.notes && <p className="text-xs text-muted-foreground">{batch.notes}</p>}
          </CardHeader>
          <CardContent>
            {editingSku && batch.orders[0]?.sku === editingSku && (
              <div className="flex flex-wrap items-end gap-2 mb-3 p-3 rounded-lg border print:hidden">
                <div>
                  <label className="text-xs text-muted-foreground">Standard carton</label>
                  <select
                    className="block h-9 rounded-md border bg-background px-2 text-sm"
                    defaultValue=""
                    onChange={(e) => {
                      const b = (data.standardBoxes ?? []).find((x) => x.label === e.target.value);
                      if (b) setDimDraft((d) => ({ ...d, lengthIn: String(b.lengthIn), widthIn: String(b.widthIn), heightIn: String(b.heightIn) }));
                    }}
                    data-testid="select-standard-box"
                  >
                    <option value="">pick a box…</option>
                    {(data.standardBoxes ?? []).map((b) => (
                      <option key={b.label} value={b.label}>{b.label}</option>
                    ))}
                  </select>
                </div>
                <div><label className="text-xs text-muted-foreground">Box name</label><Input value={dimDraft.boxName} onChange={(e) => setDimDraft({ ...dimDraft, boxName: e.target.value })} className="w-56" /></div>
                {(["lengthIn", "widthIn", "heightIn"] as const).map((k) => (
                  <div key={k}><label className="text-xs text-muted-foreground">{k[0].toUpperCase()}&quot;</label><Input value={dimDraft[k]} onChange={(e) => setDimDraft({ ...dimDraft, [k]: e.target.value })} inputMode="decimal" className="w-20" /></div>
                ))}
                <div><label className="text-xs text-muted-foreground">Weight oz</label><Input value={dimDraft.weightOz} onChange={(e) => setDimDraft({ ...dimDraft, weightOz: e.target.value })} inputMode="decimal" className="w-24" /></div>
                <Button size="sm" onClick={() => saveRule.mutate({ sku: editingSku, ...dimDraft })} disabled={saveRule.isPending}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingSku(null)}>Cancel</Button>
              </div>
            )}
            <div className="rounded-lg border divide-y text-sm">
              {batch.orders.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5" data-testid={`ship-order-${o.orderName}`}>
                  <span className="font-medium w-24">{o.orderName}</span>
                  <span className="flex-1 min-w-32 truncate">{o.customer}</span>
                  <span className="text-xs text-muted-foreground">{o.sku} ×{o.qty}{(o.parcels ?? 1) > 1 ? ` → ${o.parcels} boxes` : ""}</span>
                  <span className={`text-xs tabular-nums ${o.ageDays > 14 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{o.ageDays}d</span>
                  {o.shopifyUrl && (
                    <a href={o.shopifyUrl} target="_blank" rel="noreferrer" className="text-xs underline flex items-center gap-1 print:hidden">
                      label <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {exceptions.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-700 break-inside-avoid">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" /> Needs a human ({exceptions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border divide-y text-sm">
              {exceptions.map((o) => (
                <div key={o.id} className="px-3 py-1.5 flex flex-wrap items-center gap-2">
                  <span className="font-medium w-24">{o.orderName}</span>
                  <span className="flex-1 min-w-32 truncate">{o.customer}</span>
                  <span className="text-xs text-muted-foreground">{(o.lines ?? []).map((l) => `${l.sku} ×${l.qty}`).join(" + ")}</span>
                  <Badge variant="outline" className="text-xs font-normal">{o.reason}</Badge>
                  <span className="text-xs tabular-nums text-muted-foreground">{o.ageDays}d</span>
                  {o.shopifyUrl && (
                    <a href={o.shopifyUrl} target="_blank" rel="noreferrer" className="text-xs underline flex items-center gap-1 print:hidden">
                      label <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
