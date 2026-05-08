import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Package, Calendar as CalendarIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Mirrors the server's poStatus enum.
type PoStatus = "ordered" | "confirmed" | "in_production" | "shipped" | "received";

const STATUS_OPTIONS: { value: PoStatus; label: string }[] = [
  { value: "ordered", label: "Ordered" },
  { value: "confirmed", label: "Confirmed by Supplier" },
  { value: "in_production", label: "In Production" },
  { value: "shipped", label: "Shipped" },
  { value: "received", label: "Received" },
];

const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label])) as Record<
  PoStatus,
  string
>;

const STATUS_VARIANT: Record<PoStatus, "default" | "secondary" | "destructive"> = {
  ordered: "secondary",
  confirmed: "secondary",
  in_production: "default",
  shipped: "default",
  received: "default",
};

const FX_SUPPLIER_ID = "1";

type LineLite = {
  id: string;
  itemId: string;
  sku: string | null;
  itemName: string | null;
  qtyOrdered: number;
  qtyReceived?: number | null;
  item?: { sku?: string | null; name?: string | null; type?: string | null } | null;
};

type POForSection = {
  id: string;
  poNumber: string;
  supplierId: string | null;
  orderDate: string | null;
  expectedDate: string | null;
  expectedCompletionDate?: string | null;
  confirmedQty?: number | null;
  poStatus?: string | null;
};

type SupplierForSection = {
  id: string;
  name: string;
} | null;

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const daysBetween = (target: string | null | undefined): number | null => {
  if (!target) return null;
  const t = new Date(target).getTime();
  if (Number.isNaN(t)) return null;
  const ms = t - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
};

export function POInTransitSection({
  po,
  supplier,
  lines,
}: {
  po: POForSection;
  supplier: SupplierForSection;
  lines: LineLite[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const initialStatus = ((po.poStatus as PoStatus | null) ?? "ordered") as PoStatus;
  const [status, setStatus] = useState<PoStatus>(initialStatus);

  const isFxPO = po.supplierId === FX_SUPPLIER_ID;
  const expectedDate = po.expectedDate;
  const daysRemaining = daysBetween(expectedDate);
  const totalUnits = useMemo(
    () => lines.reduce((sum, l) => sum + (l.qtyOrdered ?? 0), 0),
    [lines],
  );

  const mutation = useMutation({
    mutationFn: async (next: PoStatus) => {
      const res = await apiRequest("PATCH", `/api/purchase-orders/${po.id}/po-status`, {
        poStatus: next,
      });
      return res.json() as Promise<{ applied: { sku: string; effect: string; qty: number }[] }>;
    },
    onSuccess: (data, next) => {
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${po.id}/composite`] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/snapshot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders/fx-incoming"] });

      const fxNote =
        data.applied.length > 0
          ? ` ${data.applied.map((a) => `${a.sku} ${a.effect}${a.qty}`).join(", ")}`
          : "";
      toast({
        title: "Status updated",
        description: `${po.poNumber}: ${STATUS_LABEL[next]}.${fxNote}`,
      });
    },
    onError: (err: Error) => {
      // Revert local state if the server rejected the change.
      setStatus(initialStatus);
      toast({ variant: "destructive", title: "Update failed", description: err.message });
    },
  });

  const handleChange = (next: string) => {
    const ok = STATUS_OPTIONS.some((o) => o.value === next);
    if (!ok) return;
    setStatus(next as PoStatus);
    mutation.mutate(next as PoStatus);
  };

  const daysLine = (() => {
    if (status === "received") return "Delivered";
    if (daysRemaining == null) return "No expected date";
    if (daysRemaining < 0) return `${Math.abs(daysRemaining)}d overdue`;
    if (daysRemaining === 0) return "Due today";
    return `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} until expected delivery`;
  })();

  return (
    <Card data-testid="po-in-transit-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4" />
          In Transit
        </CardTitle>
        <CardDescription>
          {isFxPO
            ? "Status changes auto-update fx_in_process_qty for finished-product lines."
            : "Tracking-only — non-FX PO, no inventory side effects on status change."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground text-xs uppercase">Supplier</div>
            <div className="font-medium">{supplier?.name ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs uppercase">Order Date</div>
            <div className="font-medium">{formatDate(po.orderDate)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs uppercase flex items-center gap-1">
              <CalendarIcon className="h-3 w-3" />
              Expected
            </div>
            <div className="font-medium">{formatDate(expectedDate)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs uppercase">Days Remaining</div>
            <div
              className={`font-medium ${
                daysRemaining != null && daysRemaining < 0 && status !== "received"
                  ? "text-destructive"
                  : ""
              }`}
            >
              {daysLine}
            </div>
          </div>
        </div>

        {isFxPO && <FxConfirmationFields po={po} />}

        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">Build status:</div>
          <Select
            value={status}
            onValueChange={handleChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger className="w-[220px]" data-testid="select-po-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {lines.length > 0 && (
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty Ordered</TableHead>
                  <TableHead className="text-right">Qty Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const isFinished = l.item?.type === "finished_product";
                  return (
                    <TableRow key={l.id} data-testid={`po-line-${l.id}`}>
                      <TableCell className="font-mono text-xs">
                        {l.sku ?? l.item?.sku ?? "—"}
                        {isFxPO && isFinished && (
                          <Badge variant="outline" className="ml-2 text-[10px] py-0 h-4">FX-built</Badge>
                        )}
                      </TableCell>
                      <TableCell>{l.itemName ?? l.item?.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.qtyOrdered.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {(l.qtyReceived ?? 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell colSpan={2} className="font-semibold text-right">Total</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {totalUnits.toLocaleString()}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Inline editable confirmation fields for FX POs. Saves via the existing
// PATCH /api/purchase-orders/:id (which accepts partial updates of any
// schema field). Lets Matt or Sammie record what FX agreed to build and
// when, separate from the operator-facing build-status dropdown.
function FxConfirmationFields({ po }: { po: POForSection }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmedQty, setConfirmedQty] = useState(
    po.confirmedQty != null ? String(po.confirmedQty) : "",
  );
  const [completionDate, setCompletionDate] = useState(
    po.expectedCompletionDate
      ? new Date(po.expectedCompletionDate).toISOString().slice(0, 10)
      : "",
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {};
      if (confirmedQty.trim() === "") {
        body.confirmedQty = null;
      } else {
        const n = Number(confirmedQty);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
          throw new Error("Confirmed qty must be a non-negative integer");
        }
        body.confirmedQty = n;
      }
      body.expectedCompletionDate = completionDate
        ? new Date(completionDate).toISOString()
        : null;
      const res = await apiRequest("PATCH", `/api/purchase-orders/${po.id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${po.id}/composite`] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "FX confirmation saved" });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Save failed", description: err.message });
    },
  });

  return (
    <div className="rounded-md border bg-amber-500/5 border-amber-500/30 p-3 space-y-2">
      <div className="text-sm font-medium text-amber-700 dark:text-amber-400">
        FX confirmation
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor={`fx-conf-qty-${po.id}`}>
            Confirmed qty
          </label>
          <input
            id={`fx-conf-qty-${po.id}`}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={confirmedQty}
            onChange={(e) => setConfirmedQty(e.target.value)}
            className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
            placeholder="(blank = same as ordered)"
            data-testid="input-fx-confirmed-qty"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor={`fx-comp-date-${po.id}`}>
            Expected completion
          </label>
          <input
            id={`fx-comp-date-${po.id}`}
            type="date"
            value={completionDate}
            onChange={(e) => setCompletionDate(e.target.value)}
            className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
            data-testid="input-fx-completion-date"
          />
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
          data-testid="button-save-fx-confirmation"
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Confirmed qty is what FX agreed to build (often less than ordered if they're capacity-
        constrained). When set on a single-line PO, the auto-update on status changes uses this
        value instead of the original qty.
      </p>
    </div>
  );
}
