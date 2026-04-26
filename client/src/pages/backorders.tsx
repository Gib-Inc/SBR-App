import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  ArrowRightLeft,
  ClipboardList,
  Loader2,
  Mail,
  Package,
  PackageOpen,
} from "lucide-react";
import { CreatePODialog } from "@/components/create-po-dialog";
import { TransferToPyvottDialog } from "@/components/transfer-to-pyvott-dialog";

// Backorders page — answers "what do I need to build or order to ship my
// waiting customers?" Aggregates sales-order lines with backorderQty > 0,
// groups by SKU, and surfaces the gap between demand and on-hand stock.

type SalesOrderLineLite = {
  sku: string;
  qtyOrdered: number;
  qtyShipped?: number | null;
  backorderQty?: number | null;
  unitPrice: number | null;
};

type SalesOrderWithLines = {
  id: string;
  orderName?: string | null;
  externalOrderId?: string | null;
  customerName: string;
  customerEmail?: string | null;
  channel: string;
  status: string;
  orderDate: string;
  lines?: SalesOrderLineLite[];
};

type Item = {
  id: string;
  sku: string;
  name: string;
  type: string;
  hildaleQty: number | null;
  pivotQty: number | null;
  currentStock: number | null;
  bomBuildCost?: number | null;
};

type BomEntry = {
  id: string;
  finishedProductId: string;
  componentId: string;
  quantityRequired: number;
  wastagePercent: number;
};

type BackorderRow = {
  sku: string;
  itemId: string | null;
  productName: string;
  ordersWaiting: number;
  unitsNeeded: number;
  stockOnHand: number;
  gap: number;
  blockingComponents: string[];
  estimatedCost: number; // gap × bomBuildCost when available
  orderIds: string[];
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function Backorders() {
  const { toast } = useToast();
  const [createPOOpen, setCreatePOOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  // Pull every order with lines so we can group by SKU. The withLines projection
  // includes backorderQty per line as of the projection update in this commit.
  const {
    data: orders,
    isLoading: ordersLoading,
    isError: ordersError,
    error: ordersErr,
  } = useQuery<SalesOrderWithLines[]>({
    queryKey: ["/api/sales-orders?view=all&withLines=true"],
  });

  const { data: items, isLoading: itemsLoading } = useQuery<Item[]>({
    queryKey: ["/api/items"],
  });

  const { data: bom, isLoading: bomLoading } = useQuery<BomEntry[]>({
    queryKey: ["/api/bom"],
  });

  const isLoading = ordersLoading || itemsLoading || bomLoading;

  const rows = useMemo<BackorderRow[]>(() => {
    if (!orders || !items || !bom) return [];

    const itemBySku = new Map(items.map((i) => [i.sku, i] as const));
    const itemById = new Map(items.map((i) => [i.id, i] as const));
    const bomByProduct = new Map<string, BomEntry[]>();
    for (const e of bom) {
      const list = bomByProduct.get(e.finishedProductId) ?? [];
      list.push(e);
      bomByProduct.set(e.finishedProductId, list);
    }

    type Acc = {
      sku: string;
      ordersWaiting: Set<string>;
      unitsNeeded: number;
      orderIds: Set<string>;
    };
    const bySku = new Map<string, Acc>();

    // Match the Inventory page's "Committed" pattern exactly: exclude
    // terminal statuses, then derive backlog as (qtyOrdered − qtyShipped)
    // for any line where the order isn't done. backorderQty is unreliable
    // (often null even when there's a backlog), so we don't depend on it.
    const TERMINAL = new Set([
      "FULFILLED",
      "CANCELLED",
      "DELIVERED",
      "REFUNDED",
      "PENDING_REFUND",
    ]);

    for (const o of orders) {
      if (TERMINAL.has(o.status)) continue;
      for (const line of o.lines ?? []) {
        if (!line.sku) continue;
        const open = Math.max(0, (line.qtyOrdered ?? 0) - (line.qtyShipped ?? 0));
        if (open <= 0) continue;

        const acc =
          bySku.get(line.sku) ?? {
            sku: line.sku,
            ordersWaiting: new Set<string>(),
            unitsNeeded: 0,
            orderIds: new Set<string>(),
          };
        acc.ordersWaiting.add(o.id);
        acc.orderIds.add(o.id);
        acc.unitsNeeded += open;
        bySku.set(line.sku, acc);
      }
    }

    return Array.from(bySku.values())
      .map((acc) => {
        const item = itemBySku.get(acc.sku) ?? null;
        const stockOnHand = item
          ? (item.hildaleQty ?? 0) + (item.pivotQty ?? 0)
          : 0;
        const gap = Math.max(0, acc.unitsNeeded - stockOnHand);

        // Blocking components = BOM entries where the linked component is at 0.
        // Only meaningful when the gap > 0 (otherwise no need to build more).
        const blocking: string[] = [];
        if (item && gap > 0) {
          const productBom = bomByProduct.get(item.id) ?? [];
          for (const entry of productBom) {
            const comp = itemById.get(entry.componentId);
            if (!comp) continue;
            if ((comp.currentStock ?? 0) === 0) {
              blocking.push(comp.name);
            }
          }
        }

        const buildCost = item?.bomBuildCost ?? 0;
        const estimatedCost = gap > 0 && buildCost > 0 ? gap * buildCost : 0;

        return {
          sku: acc.sku,
          itemId: item?.id ?? null,
          productName: item?.name ?? acc.sku,
          ordersWaiting: acc.ordersWaiting.size,
          unitsNeeded: acc.unitsNeeded,
          stockOnHand,
          gap,
          blockingComponents: blocking.slice(0, 2),
          estimatedCost,
          orderIds: Array.from(acc.orderIds),
        } as BackorderRow;
      })
      // Sort biggest gaps first; rows where we already have stock land at the
      // bottom (gap = 0).
      .sort((a, b) => {
        if (a.gap !== b.gap) return b.gap - a.gap;
        return b.unitsNeeded - a.unitsNeeded;
      });
  }, [orders, items, bom]);

  const totals = useMemo(() => {
    let totalUnits = 0;
    let totalCost = 0;
    for (const r of rows) {
      totalUnits += r.unitsNeeded;
      totalCost += r.estimatedCost;
    }
    return { totalUnits, totalCost };
  }, [rows]);

  const notifyMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const res = await apiRequest("POST", "/api/sales-orders/in-house/notify-delay", { orderIds });
      return await res.json();
    },
    onSuccess: (_data, orderIds) => {
      toast({
        title: "Delay notice queued",
        description: `Notified ${orderIds.length} order${orderIds.length === 1 ? "" : "s"}.`,
      });
    },
    onError: (err: Error) => {
      toast({
        variant: "destructive",
        title: "Notify failed",
        description: err.message || "Could not send delay notice",
      });
    },
  });

  return (
    <div className="p-4 md:p-8 space-y-6" data-testid="page-backorders">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <PackageOpen className="h-7 w-7" />
          Backorders
        </h1>
        <p className="text-muted-foreground mt-1">
          What you need to build or order to ship customers waiting now.
        </p>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : ordersError ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Failed to load backorders</CardTitle>
            <CardDescription>{(ordersErr as Error)?.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
            No active backorders. Every customer currently has stock allocated.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[220px]">Product</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Needed</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Gap</TableHead>
                      <TableHead className="hidden md:table-cell min-w-[180px]">Blocking</TableHead>
                      <TableHead className="text-right">Est. cost</TableHead>
                      <TableHead className="text-right min-w-[260px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.sku} data-testid={`row-backorder-${r.sku}`}>
                        <TableCell className="font-medium">{r.productName}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.ordersWaiting}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {r.unitsNeeded}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.stockOnHand}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={r.gap > 0 ? "destructive" : "default"}
                            className="tabular-nums"
                          >
                            {r.gap > 0 ? `−${r.gap}` : "0"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">
                          {r.blockingComponents.length === 0 ? (
                            r.gap > 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className="text-green-700 dark:text-green-400">In stock</span>
                            )
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {r.blockingComponents.map((c) => (
                                <Badge
                                  key={c}
                                  variant="outline"
                                  className="text-amber-700 dark:text-amber-400 border-amber-500/40"
                                >
                                  ⚠️ {c}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.estimatedCost > 0 ? usd.format(r.estimatedCost) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setCreatePOOpen(true)}
                              data-testid={`button-create-po-${r.sku}`}
                            >
                              <ClipboardList className="mr-1 h-3.5 w-3.5" />
                              Create PO
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setTransferOpen(true)}
                              data-testid={`button-transfer-${r.sku}`}
                            >
                              <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
                              Transfer
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => notifyMutation.mutate(r.orderIds)}
                              disabled={notifyMutation.isPending}
                              data-testid={`button-notify-${r.sku}`}
                            >
                              <Mail className="mr-1 h-3.5 w-3.5" />
                              Notify
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="py-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
                <span>
                  <strong className="tabular-nums">{totals.totalUnits.toLocaleString()}</strong>{" "}
                  unit{totals.totalUnits === 1 ? "" : "s"} backordered across {rows.length} product
                  {rows.length === 1 ? "" : "s"}.
                </span>
                <span className="text-muted-foreground">
                  Estimated cost to clear:{" "}
                  <strong className="text-foreground tabular-nums">
                    {totals.totalCost > 0 ? usd2.format(totals.totalCost) : "—"}
                  </strong>
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <CreatePODialog open={createPOOpen} onOpenChange={setCreatePOOpen} />
      <TransferToPyvottDialog isOpen={transferOpen} onClose={() => setTransferOpen(false)} />

      <p className="text-xs text-muted-foreground">
        Tip: Click a product name on the <Link href="/sales-orders" className="underline">Sales Orders</Link> page to see the customers waiting on it.
      </p>
    </div>
  );
}
