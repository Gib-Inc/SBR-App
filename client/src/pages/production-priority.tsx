import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ListOrdered, Copy, Send, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// The four FX-built finished products. SKUs match the catalog (verified
// against the production page's CARDS config — same identifiers).
const FX_PRODUCTS: { sku: string; displayName: string }[] = [
  { sku: "SBR-Extrawide2.0", displayName: "Push 2.0 Extra Wide" },
  { sku: "SBR-PUSH-1.0",     displayName: "Push 1.0" },
  { sku: "SBR-PB-ORIG",      displayName: "Pull-Behind" },
  { sku: "SBR-PB-BIGFOOT",   displayName: "Bigfoot" },
];

// Sales-order statuses that mean "no longer counts as open demand". Lifted
// from the inventory page's terminal set so the open-orders math agrees
// across views.
const TERMINAL_STATUSES = new Set([
  "FULFILLED",
  "CANCELLED",
  "DELIVERED",
  "REFUNDED",
  "PENDING_REFUND",
]);

const SENDERS = ["Clarence", "Sammie", "Matt", "Stacy"];

// FX Industries' supplier row is id='1' in the DB. Pinning to the id (not
// the name) means renames or capitalization edits never break the Send
// button.
const FX_SUPPLIER_ID = "1";

type SalesOrderLineLite = {
  sku: string;
  qtyOrdered: number;
  qtyShipped?: number | null;
};
type SalesOrderWithLines = {
  id: string;
  status: string;
  lines?: SalesOrderLineLite[];
};

type Item = {
  id: string;
  sku: string;
  name: string;
  type: string;
  hildaleQty: number | null;
  extensivOnHandSnapshot: number | null;
  fxInProcessQty: number | null;
};

type Supplier = {
  id: string;
  name: string;
};

type PriorityRow = {
  rank: number;
  sku: string;
  itemId: string | null;
  displayName: string;
  openOrders: number;
  stock: number;
  fxInProcess: number;
  pendingFxPoQty: number;
  earliestExpected: string | null;
  gap: number;
};

type FxIncomingResponse = {
  items: Record<string, { sku: string; pendingQty: number; earliestExpected: string | null }>;
};

const formatToday = () => {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

export default function ProductionPriority() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sentBy, setSentBy] = useState("Clarence");
  const [editedEmail, setEditedEmail] = useState<string | null>(null);

  const { data: orders = [], isLoading: ordersLoading } = useQuery<SalesOrderWithLines[]>({
    queryKey: ["/api/sales-orders?view=all&withLines=true"],
  });
  const { data: items = [], isLoading: itemsLoading } = useQuery<Item[]>({
    queryKey: ["/api/items"],
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });
  const { data: fxIncoming } = useQuery<FxIncomingResponse>({
    queryKey: ["/api/purchase-orders/fx-incoming"],
  });

  const itemBySku = useMemo(() => {
    const map = new Map<string, Item>();
    for (const it of items) map.set(it.sku, it);
    return map;
  }, [items]);

  // Sum unshipped units across all non-terminal sales orders, keyed by SKU.
  // Same logic the Inventory page uses for the Committed column so the two
  // views can't disagree.
  const openBySku = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      if (TERMINAL_STATUSES.has(o.status)) continue;
      for (const line of o.lines ?? []) {
        if (!line.sku) continue;
        const open = Math.max(0, (line.qtyOrdered ?? 0) - (line.qtyShipped ?? 0));
        if (open <= 0) continue;
        map.set(line.sku, (map.get(line.sku) ?? 0) + open);
      }
    }
    return map;
  }, [orders]);

  const rows = useMemo<PriorityRow[]>(() => {
    const built = FX_PRODUCTS.map(({ sku, displayName }) => {
      const item = itemBySku.get(sku);
      const stock = (item?.hildaleQty ?? 0) + (item?.extensivOnHandSnapshot ?? 0);
      const openOrders = openBySku.get(sku) ?? 0;
      const incoming = item ? fxIncoming?.items[item.id] : undefined;
      return {
        sku,
        itemId: item?.id ?? null,
        displayName,
        openOrders,
        stock,
        fxInProcess: item?.fxInProcessQty ?? 0,
        // Per-item pending PO qty (po_status in ordered/confirmed). Lines that
        // have moved to in_production/shipped are already counted in
        // fxInProcessQty by the auto-update, so we don't double-count them.
        pendingFxPoQty: incoming?.pendingQty ?? 0,
        earliestExpected: incoming?.earliestExpected ?? null,
        gap: Math.max(0, openOrders - stock),
        rank: 0,
      };
    });
    built.sort((a, b) => b.gap - a.gap);
    built.forEach((r, i) => (r.rank = i + 1));
    return built;
  }, [itemBySku, openBySku, fxIncoming]);

  const fxSupplier = useMemo(
    () => suppliers.find((s) => s.id === FX_SUPPLIER_ID) ?? null,
    [suppliers],
  );

  // The email template — auto-generated from the table rows so the message
  // and the data on the page can never drift. Top-ranked entry is tagged
  // URGENT to match the spec's example.
  const generatedEmail = useMemo(() => {
    const today = formatToday();
    const lines: string[] = [];
    lines.push("Hi Beth,");
    lines.push("");
    lines.push(`Here is our current build priority as of ${today}:`);
    lines.push("");
    rows.forEach((r) => {
      const prefix = `${r.rank}. ${r.rank === 1 ? "URGENT — " : ""}${r.displayName}`;
      const stats = `${r.openOrders} units needed, ${r.stock} in stock, ${r.gap} gap`;
      const trailer = r.rank === 1 ? " Please prioritize these frames immediately." : "";
      lines.push(`${prefix}: ${stats}.${trailer}`);
    });
    lines.push("");
    lines.push("Please confirm receipt and current build queue.");
    lines.push("");
    lines.push("Thank you,");
    lines.push(sentBy);
    lines.push("Sticker Burr Roller");
    return lines.join("\n");
  }, [rows, sentBy]);

  const emailText = editedEmail ?? generatedEmail;

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!fxSupplier) throw new Error("FX Industries supplier not found in database");
      const res = await apiRequest("POST", "/api/vendor-communications/notify", {
        supplierId: fxSupplier.id,
        sentBy,
        message: emailText,
      });
      return res.json() as Promise<{ emailSent: boolean; emailError: string | null; recipientEmail: string | null }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-communications/recent"] });
      if (fxSupplier) {
        queryClient.invalidateQueries({
          queryKey: [`/api/vendor-communications?supplierId=${fxSupplier.id}`],
        });
      }
      const desc = data.emailSent
        ? `Email sent to ${data.recipientEmail}. Logged to Communications.`
        : data.recipientEmail
          ? `Email send failed (${data.emailError}). Logged to Communications.`
          : `No email on file for FX Industries. Logged to Communications.`;
      toast({ title: data.emailSent ? "Sent to FX" : "Logged", description: desc });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Send failed", description: err.message });
    },
  });

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(emailText);
      toast({ title: "Copied", description: "Email body is on your clipboard." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Copy failed", description: err?.message ?? "Clipboard unavailable" });
    }
  };

  const isLoading = ordersLoading || itemsLoading;

  return (
    <div className="p-4 md:p-8 space-y-6" data-testid="page-production-priority">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <ListOrdered className="h-7 w-7" />
          Production Priority — as of {formatToday()}
        </h1>
        <p className="text-muted-foreground mt-1">Send this to FX Industries to confirm build queue</p>
      </div>

      {!fxSupplier && (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400"
          data-testid="banner-no-fx-supplier"
        >
          <AlertTriangle className="h-4 w-4" />
          <span>
            FX Industries supplier (id="{FX_SUPPLIER_ID}") not found. The "Send to FX" button is
            disabled until that row exists in the suppliers table.
          </span>
        </div>
      )}

      {/* Priority table */}
      <Card>
        <CardHeader>
          <CardTitle>Build Priority</CardTitle>
          <CardDescription>
            Ranked by gap (open orders minus stock), highest first. Live data —
            refreshes on every page load.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Priority</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Open Orders</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">In Production (FX)</TableHead>
                  <TableHead className="text-right">Incoming from FX</TableHead>
                  <TableHead className="text-right">Gap</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const action =
                    r.gap > 0 && r.rank === 1
                      ? { label: "URGENT", variant: "destructive" as const }
                      : r.gap > 0
                        ? { label: "Build", variant: "default" as const }
                        : { label: "OK", variant: "secondary" as const };
                  return (
                    <TableRow key={r.sku} data-testid={`priority-row-${r.sku}`}>
                      <TableCell className="font-bold tabular-nums">#{r.rank}</TableCell>
                      <TableCell>
                        <div>{r.displayName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{r.sku}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.openOrders.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.stock.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-amber-700 dark:text-amber-400 tabular-nums">
                        {r.fxInProcess > 0 ? r.fxInProcess.toLocaleString() : "–"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(() => {
                          const incoming = r.fxInProcess + r.pendingFxPoQty;
                          if (incoming === 0) return <span className="text-muted-foreground">–</span>;
                          const days =
                            r.earliestExpected != null
                              ? Math.ceil(
                                  (new Date(r.earliestExpected).getTime() - Date.now()) /
                                    (1000 * 60 * 60 * 24),
                                )
                              : null;
                          return (
                            <div className="flex flex-col items-end">
                              <span className="font-semibold">{incoming.toLocaleString()}</span>
                              <span className="text-xs text-muted-foreground">
                                {r.stock.toLocaleString()} stock · {incoming.toLocaleString()} incoming
                                {days != null ? ` · ${days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}` : ""}
                              </span>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold tabular-nums ${
                          r.gap > 0 ? "text-destructive" : ""
                        }`}
                      >
                        {r.gap.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={action.variant}>{action.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Email panel */}
      <Card>
        <CardHeader>
          <CardTitle>Email to FX Industries</CardTitle>
          <CardDescription>
            Auto-generated from the table above. Edit if you need to add specifics, then copy or send.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3 items-start">
            <div className="space-y-1">
              <Label>Sent by</Label>
              <Select value={sentBy} onValueChange={setSentBy}>
                <SelectTrigger data-testid="select-priority-sent-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENDERS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="priority-email">Message</Label>
              <Textarea
                id="priority-email"
                rows={14}
                value={emailText}
                onChange={(e) => setEditedEmail(e.target.value)}
                className="font-mono text-sm"
                data-testid="input-priority-email"
              />
              {editedEmail !== null && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={() => setEditedEmail(null)}
                  data-testid="button-reset-email"
                >
                  Reset to generated
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-end">
            <Button variant="outline" onClick={copyEmail} data-testid="button-copy-email">
              <Copy className="h-4 w-4 mr-2" />
              Copy Email
            </Button>
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={!fxSupplier || sendMutation.isPending}
              data-testid="button-send-to-fx"
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send to FX
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
