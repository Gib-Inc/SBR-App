import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Loader2, ChevronsUpDown, Check, AlertTriangle, FileSearch } from "lucide-react";

// Settings → Lot Trace tab. Pick a component + a receive-date window;
// the response shows each lot from that window, the production runs that
// drew from it, and every customer whose shipped order MAY have included a
// unit built from that lot.

type Item = {
  id: string;
  name: string;
  sku: string;
  type: string;
};

type AffectedOrder = {
  orderId: string;
  orderName: string | null;
  customerName: string;
  customerEmail: string | null;
  channel: string;
  shippedQty: number;
  shippedAt: string | null;
};

type ConsumptionEvent = {
  consumedAt: string;
  qtyDrawn: number;
  productionLogId: string | null;
  productionDate: string | null;
  finishedProductId: string | null;
  finishedProductName: string | null;
  builtQty: number | null;
  potentiallyAffectedOrders: AffectedOrder[];
};

type LotTrace = {
  lotId: string;
  lotNumber: string;
  originalQty: number;
  remainingQty: number;
  receivedAt: string;
  supplierId: string | null;
  consumption: ConsumptionEvent[];
};

type TraceResponse = {
  itemId: string;
  itemName: string;
  from: string;
  to: string;
  lots: LotTrace[];
  note: string;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function LotTraceTab() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<{ itemId: string; from: string; to: string } | null>(null);

  const { data: items = [] } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const components = useMemo(
    () => items.filter((i) => i.type === "component").sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const selectedItem = items.find((i) => i.id === itemId) ?? null;

  const { data, isFetching, isError, error } = useQuery<TraceResponse>({
    queryKey: [`/api/lots/trace?itemId=${submittedQuery?.itemId}&from=${submittedQuery?.from}&to=${submittedQuery?.to}`],
    enabled: !!submittedQuery,
  });

  const affectedCount = useMemo(() => {
    if (!data) return 0;
    const orderIds = new Set<string>();
    for (const lot of data.lots) {
      for (const ev of lot.consumption) {
        for (const o of ev.potentiallyAffectedOrders) orderIds.add(o.orderId);
      }
    }
    return orderIds.size;
  }, [data]);

  return (
    <div className="space-y-4" data-testid="lot-trace-tab">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-primary" />
            Lot trace
          </CardTitle>
          <CardDescription>
            Pick a component and a receive-date window. The system walks every lot received in
            that window through to the production runs that consumed it and the orders that
            shipped those finished products afterward.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-[1fr_140px_140px_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Component</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  className="w-full justify-between font-normal h-10"
                  data-testid="lot-trace-component-trigger"
                >
                  <span className="truncate text-left">
                    {selectedItem ? selectedItem.name : "Pick a component…"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[min(92vw,28rem)]" align="start">
                <Command>
                  <CommandInput placeholder="Search components…" />
                  <CommandList>
                    <CommandEmpty>No components found.</CommandEmpty>
                    <CommandGroup>
                      {components.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          onSelect={() => { setItemId(c.id); setPickerOpen(false); }}
                          data-testid={`lot-trace-item-${c.id}`}
                        >
                          <Check className={`mr-2 h-4 w-4 ${itemId === c.id ? "opacity-100" : "opacity-0"}`} />
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1">
            <Label htmlFor="lot-from" className="text-xs">Received from</Label>
            <Input
              id="lot-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-10"
              data-testid="lot-trace-from"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="lot-to" className="text-xs">Received to</Label>
            <Input
              id="lot-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-10"
              data-testid="lot-trace-to"
            />
          </div>

          <Button
            type="button"
            disabled={!itemId || !from || !to || isFetching}
            onClick={() => setSubmittedQuery({ itemId, from, to })}
            className="h-10"
            data-testid="lot-trace-search"
          >
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Trace"}
          </Button>
        </CardContent>
      </Card>

      {isError && (
        <Card className="border-destructive/50">
          <CardContent className="py-4 text-sm text-destructive">
            {(error as Error)?.message ?? "Trace failed"}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card className={`border-amber-500/40 bg-amber-500/5`}>
            <CardContent className="py-3 flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="flex-1">
                <strong className="tabular-nums">{data.lots.length}</strong> lot
                {data.lots.length === 1 ? "" : "s"} of{" "}
                <strong>{data.itemName}</strong> received{" "}
                {fmtDate(data.from)} – {fmtDate(data.to)} ·{" "}
                <strong className="tabular-nums">{affectedCount}</strong> potentially affected order
                {affectedCount === 1 ? "" : "s"}
              </span>
            </CardContent>
          </Card>

          {data.lots.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground text-center">
                No lots of this component received in that window.
              </CardContent>
            </Card>
          ) : (
            data.lots.map((lot) => (
              <Card key={lot.lotId} data-testid={`lot-${lot.lotId}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
                    <span>
                      Lot <span className="font-mono">{lot.lotNumber}</span>
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {lot.remainingQty} of {lot.originalQty} remaining · received {fmtDate(lot.receivedAt)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {lot.consumption.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic">
                      No production runs consumed this lot yet.
                    </div>
                  ) : (
                    lot.consumption.map((ev, idx) => (
                      <div key={idx} className="rounded-md border bg-muted/30 p-3 space-y-2">
                        <div className="text-xs flex items-baseline justify-between gap-3 flex-wrap">
                          <span>
                            <strong className="tabular-nums">{ev.qtyDrawn}</strong> drawn for{" "}
                            <strong>{ev.finishedProductName ?? "(unknown product)"}</strong>
                            {ev.builtQty != null && <> ({ev.builtQty} built)</>}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {fmtDate(ev.productionDate)}
                          </span>
                        </div>
                        {ev.potentiallyAffectedOrders.length === 0 ? (
                          <div className="text-xs text-muted-foreground italic">
                            No matching shipped orders since this build.
                          </div>
                        ) : (
                          <ul className="text-xs space-y-1">
                            {ev.potentiallyAffectedOrders.map((o) => (
                              <li
                                key={o.orderId}
                                className="flex items-baseline justify-between gap-2 flex-wrap"
                                data-testid={`affected-${o.orderId}`}
                              >
                                <span className="min-w-0 truncate">
                                  <span className="font-mono mr-1">{o.orderName ?? o.orderId.slice(0, 8)}</span>
                                  <span className="font-medium">{o.customerName}</span>
                                  {o.customerEmail && (
                                    <span className="text-muted-foreground"> · {o.customerEmail}</span>
                                  )}
                                </span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  <Badge variant="outline" className="text-[10px] mr-1">{o.channel}</Badge>
                                  {o.shippedQty} shipped {fmtDate(o.shippedAt)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ))
          )}

          <p className="text-[11px] text-muted-foreground italic">{data.note}</p>
        </>
      )}
    </div>
  );
}
