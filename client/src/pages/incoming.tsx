import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PackagePlus, Truck, Building2, Loader2 } from "lucide-react";
import { QuickReceiveDialog, type QuickReceiveContext } from "@/components/quick-receive-dialog";

const FX_SUPPLIER_ID = "1";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Statuses that mean "no longer in transit" — exclude from /incoming.
const TERMINAL_PO_STATUS = new Set(["RECEIVED", "CLOSED", "CANCELLED"]);

type PO = {
  id: string;
  poNumber: string;
  supplierId: string | null;
  supplierName: string | null;
  status: string;
  poStatus?: string | null;
  orderDate: string | null;
  expectedDate: string | null;
  expectedCompletionDate?: string | null;
  confirmedQty?: number | null;
  total: number | null;
  isHistorical?: boolean | null;
};

type POLineLite = {
  id: string;
  itemId: string;
  sku: string | null;
  itemName: string | null;
  qtyOrdered: number;
  qtyReceived: number | null;
  unitCost: number | null;
  lineTotal: number | null;
};

type PORow = PO & { lines: POLineLite[]; firstSku: string; firstName: string; primaryQty: number };

const PO_STATUS_LABEL: Record<string, string> = {
  ordered: "Ordered",
  confirmed: "Confirmed",
  in_production: "In Production",
  shipped: "Shipped",
  received: "Received",
};

const PO_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  ordered: "secondary",
  confirmed: "secondary",
  in_production: "default",
  shipped: "default",
  received: "default",
};

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const daysUntil = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (1000 * 60 * 60 * 24));
};

function DaysCell({ iso }: { iso: string | null | undefined }) {
  const d = daysUntil(iso);
  if (d == null) return <span className="text-muted-foreground">—</span>;
  if (d < 0) return <span className="text-destructive font-semibold">{Math.abs(d)}d overdue</span>;
  if (d === 0) return <span className="text-amber-700 dark:text-amber-400 font-semibold">today</span>;
  return <span className="text-green-700 dark:text-green-400">{d}d</span>;
}

export default function Incoming() {
  const [receiveContext, setReceiveContext] = useState<QuickReceiveContext | null>(null);

  const { data: pos = [], isLoading: posLoading } = useQuery<PO[]>({
    queryKey: ["/api/purchase-orders"],
  });

  // Fetch lines for each in-transit PO. Ideally this would be one batch call;
  // doing it client-side keeps the new page from needing a new server route.
  const inTransitPOs = useMemo(
    () =>
      pos.filter((po) => {
        if (po.isHistorical) return false;
        if (TERMINAL_PO_STATUS.has(po.status)) return false;
        if ((po.poStatus ?? "ordered") === "received") return false;
        return true;
      }),
    [pos],
  );

  const linesQueries = useQuery<Record<string, POLineLite[]>>({
    queryKey: ["/api/purchase-orders/in-transit-lines", inTransitPOs.map((p) => p.id).sort().join(",")],
    enabled: inTransitPOs.length > 0,
    queryFn: async () => {
      const out: Record<string, POLineLite[]> = {};
      // Reuse the existing composite endpoint (returns PO + lines + supplier
      // + receipts) — bit of overfetch but no new endpoint needed.
      const results = await Promise.all(
        inTransitPOs.map(async (po) => {
          const res = await fetch(`/api/purchase-orders/${po.id}/composite`, {
            credentials: "include",
          });
          if (!res.ok) return null;
          const body = await res.json();
          return { id: po.id, lines: (body.lines ?? []) as POLineLite[] };
        }),
      );
      for (const r of results) {
        if (r) out[r.id] = r.lines;
      }
      return out;
    },
  });

  const enriched = useMemo<PORow[]>(() => {
    const lineMap = linesQueries.data ?? {};
    return inTransitPOs.map((po) => {
      const lines = lineMap[po.id] ?? [];
      const first = lines[0];
      const totalQty = lines.reduce((s, l) => s + (l.qtyOrdered ?? 0), 0);
      return {
        ...po,
        lines,
        firstSku: first?.sku ?? "—",
        firstName: first?.itemName ?? "—",
        primaryQty: totalQty,
      };
    });
  }, [inTransitPOs, linesQueries.data]);

  const fxRows = useMemo(() => enriched.filter((r) => r.supplierId === FX_SUPPLIER_ID), [enriched]);
  const supplierRows = useMemo(() => enriched.filter((r) => r.supplierId !== FX_SUPPLIER_ID), [enriched]);

  const totalValue = enriched.reduce((s, r) => s + (r.total ?? 0), 0);

  const openReceive = (row: PORow) => {
    const summary = row.lines.length === 1
      ? `${row.lines[0].qtyOrdered.toLocaleString()} × ${row.lines[0].sku ?? ""} — ${row.lines[0].itemName ?? ""}`
      : `${row.primaryQty.toLocaleString()} units across ${row.lines.length} lines`;
    setReceiveContext({
      poId: row.id,
      poNumber: row.poNumber,
      supplierName: row.supplierName ?? "",
      itemSummary: summary,
      qtyOrdered: row.primaryQty,
    });
  };

  const isLoading = posLoading || linesQueries.isLoading;

  return (
    <div className="p-4 md:p-8 space-y-6" data-testid="page-incoming">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Truck className="h-7 w-7" />
          Incoming
        </h1>
        <p className="text-muted-foreground mt-1">
          Everything ordered but not yet received. Tap "Mark Received" when it lands.
        </p>
      </div>

      {/* From Suppliers (Components) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            From Suppliers (Components)
          </CardTitle>
          <CardDescription>
            Open POs to non-FX suppliers (McMaster, Uline, Pednar, etc.).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : supplierRows.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">
              Nothing in transit from suppliers right now.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Qty Ordered</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Expected Arrival</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplierRows.map((row) => {
                  const ps = row.poStatus ?? "ordered";
                  return (
                    <TableRow key={row.id} data-testid={`incoming-supplier-${row.id}`}>
                      <TableCell>
                        <div className="font-medium">{row.firstName}</div>
                        <div className="text-xs font-mono text-muted-foreground">
                          {row.firstSku}
                          {row.lines.length > 1 && (
                            <span className="ml-1 text-[11px]">+{row.lines.length - 1} more</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{row.supplierName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.primaryQty.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.total != null ? usd.format(row.total) : "—"}
                      </TableCell>
                      <TableCell>{formatDate(row.orderDate)}</TableCell>
                      <TableCell>
                        <div>{formatDate(row.expectedDate)}</div>
                        <div className="text-xs"><DaysCell iso={row.expectedDate} /></div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={PO_STATUS_VARIANT[ps] ?? "secondary"}>
                          {PO_STATUS_LABEL[ps] ?? ps}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => openReceive(row)}
                          data-testid={`button-receive-${row.id}`}
                        >
                          <PackagePlus className="h-3.5 w-3.5 mr-1" />
                          Mark Received
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* From FX Industries (Frames/Units) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-4 w-4 text-amber-600" />
            From FX Industries (Frames/Units)
          </CardTitle>
          <CardDescription>
            Open POs to FX (supplier id="1"). Build status mirrors po_status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : fxRows.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">No open FX orders.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Frames Ordered</TableHead>
                  <TableHead className="text-right">Confirmed</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Expected Completion</TableHead>
                  <TableHead>Build Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fxRows.map((row) => {
                  const ps = row.poStatus ?? "ordered";
                  const expected = row.expectedCompletionDate ?? row.expectedDate;
                  return (
                    <TableRow key={row.id} data-testid={`incoming-fx-${row.id}`}>
                      <TableCell>
                        <div className="font-medium">{row.firstName}</div>
                        <div className="text-xs font-mono text-muted-foreground">{row.firstSku}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.primaryQty.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.confirmedQty != null ? row.confirmedQty.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.total != null ? usd.format(row.total) : "—"}
                      </TableCell>
                      <TableCell>{formatDate(row.orderDate)}</TableCell>
                      <TableCell>
                        <div>{formatDate(expected)}</div>
                        <div className="text-xs"><DaysCell iso={expected} /></div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={PO_STATUS_VARIANT[ps] ?? "secondary"}>
                          {PO_STATUS_LABEL[ps] ?? ps}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => openReceive(row)}
                          data-testid={`button-receive-fx-${row.id}`}
                        >
                          <PackagePlus className="h-3.5 w-3.5 mr-1" />
                          Mark Received
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="text-sm text-center text-muted-foreground" data-testid="incoming-total">
        Total in transit: <span className="font-semibold">{usd.format(totalValue)}</span> across{" "}
        <span className="font-semibold">{enriched.length}</span> order
        {enriched.length === 1 ? "" : "s"}.
      </div>

      <QuickReceiveDialog
        isOpen={receiveContext != null}
        onClose={() => setReceiveContext(null)}
        context={receiveContext}
      />
    </div>
  );
}
