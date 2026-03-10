import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, PackageCheck, User, CalendarDays, DollarSign, ExternalLink } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DirectOrder {
  id: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  status: string;
  orderDate: string;
  totalAmount: number;
  notes: string | null;
}

interface FinishedProduct {
  id: string;
  name: string;
  sku: string;
  hildaleQty: number;
  sellingPrice: number | null;
}

// ─── New Order Dialog ─────────────────────────────────────────────────────────

function NewOrderDialog({ isOpen, onClose, products }: {
  isOpen: boolean;
  onClose: () => void;
  products: FinishedProduct[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; qtyOrdered: number; unitPrice: number }>>([
    { productId: "", qtyOrdered: 1, unitPrice: 0 }
  ]);

  const addLine = () => setLines([...lines, { productId: "", qtyOrdered: 1, unitPrice: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, value: any) => {
    const next = [...lines];
    next[i] = { ...next[i], [field]: value };
    // Auto-fill price from product's sellingPrice
    if (field === "productId") {
      const product = products.find(p => p.id === value);
      if (product?.sellingPrice) next[i].unitPrice = product.sellingPrice;
    }
    setLines(next);
  };

  const totalAmount = lines.reduce((s, l) => s + (l.unitPrice ?? 0) * l.qtyOrdered, 0);
  const canSubmit = customerName.trim() && lines.every(l => l.productId && l.qtyOrdered > 0);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/direct-orders", {
        customerName: customerName.trim(),
        customerEmail: customerEmail || undefined,
        customerPhone: customerPhone || undefined,
        notes: notes || undefined,
        lines: lines.map(l => ({
          productId: l.productId,
          sku: products.find(p => p.id === l.productId)?.sku ?? "",
          productName: products.find(p => p.id === l.productId)?.name ?? "",
          qtyOrdered: l.qtyOrdered,
          unitPrice: l.unitPrice,
        })),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Order created", description: `Direct order for ${customerName} logged.` });
      queryClient.invalidateQueries({ queryKey: ["/api/direct-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      onClose();
      setCustomerName(""); setCustomerEmail(""); setCustomerPhone(""); setNotes("");
      setLines([{ productId: "", qtyOrdered: 1, unitPrice: 0 }]);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Failed", description: e.message }),
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Direct / Hildale Order</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Customer info */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 space-y-1">
              <Label>Customer name <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. Tractor Supply Co. – St. George" value={customerName} onChange={e => setCustomerName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Email</Label>
              <Input type="email" placeholder="optional" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Phone</Label>
              <Input type="tel" placeholder="optional" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Products</Label>
              <Button type="button" size="sm" variant="outline" onClick={addLine} className="gap-1 text-xs">
                <Plus className="h-3 w-3" /> Add line
              </Button>
            </div>

            {lines.map((line, i) => {
              const product = products.find(p => p.id === line.productId);
              return (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    {i === 0 && <Label className="text-xs text-muted-foreground">Product</Label>}
                    <Select value={line.productId} onValueChange={v => updateLine(i, "productId", v)}>
                      <SelectTrigger className={!line.productId ? "border-destructive" : ""}>
                        <SelectValue placeholder="Select product" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} — {p.hildaleQty} at Hildale
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-20 space-y-1">
                    {i === 0 && <Label className="text-xs text-muted-foreground">Qty</Label>}
                    <Input
                      type="number"
                      min="1"
                      value={line.qtyOrdered}
                      onChange={e => updateLine(i, "qtyOrdered", parseInt(e.target.value) || 1)}
                      className="text-right font-mono"
                    />
                  </div>
                  <div className="w-28 space-y-1">
                    {i === 0 && <Label className="text-xs text-muted-foreground">Unit price</Label>}
                    <div className="flex items-center">
                      <span className="text-sm text-muted-foreground px-2">$</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={e => updateLine(i, "unitPrice", parseFloat(e.target.value) || 0)}
                        className="text-right font-mono pl-0"
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLine(i)}
                    disabled={lines.length === 1}
                    className="mb-0.5"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}

            <div className="flex justify-end pt-1">
              <span className="text-sm font-semibold">
                Total: ${totalAmount.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label className="text-muted-foreground">Notes</Label>
            <Textarea placeholder="e.g. Picked up in person, paid by check" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} className="gap-2">
              <PackageCheck className="h-4 w-4" />
              {mutation.isPending ? "Creating…" : "Create Order"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = {
    ORDERED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    SHIPPED: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
    DELIVERED: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  };
  return <Badge className={`${map[status] ?? ""} border-0 text-xs`}>{status}</Badge>;
}

export default function DirectOrders() {
  const [showNew, setShowNew] = useState(false);

  const { data: orders = [], isLoading } = useQuery<DirectOrder[]>({
    queryKey: ["/api/direct-orders"],
    queryFn: async () => {
      const res = await fetch("/api/direct-orders", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: allItems = [] } = useQuery<FinishedProduct[]>({
    queryKey: ["/api/items"],
  });

  const products = (allItems as any[]).filter(i => i.type === "finished_product") as FinishedProduct[];

  const totalRevenue = orders
    .filter(o => o.status !== "CANCELLED")
    .reduce((s, o) => s + (o.totalAmount ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackageCheck className="h-6 w-6" />
            Direct Orders
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Distributor and Hildale walk-in orders packed by Clarence</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xl font-bold">${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="text-xs text-muted-foreground">total revenue</div>
          </div>
          <Button onClick={() => setShowNew(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Order
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">Loading…</div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col h-48 items-center justify-center gap-3 text-muted-foreground">
            <PackageCheck className="h-10 w-10 opacity-30" />
            <p className="text-sm">No direct orders yet.</p>
            <Button variant="outline" size="sm" onClick={() => setShowNew(true)}>Create your first order</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left p-3 font-medium">Customer</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Date</th>
                <th className="text-right p-3 font-medium">Total</th>
                <th className="text-left p-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => (
                <tr key={order.id} className="border-t hover:bg-muted/20">
                  <td className="p-3">
                    <div className="font-medium">{order.customerName}</div>
                    {order.customerEmail && <div className="text-xs text-muted-foreground">{order.customerEmail}</div>}
                    {order.customerPhone && <div className="text-xs text-muted-foreground">{order.customerPhone}</div>}
                  </td>
                  <td className="p-3">{statusBadge(order.status)}</td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(order.orderDate).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right font-mono">
                    {order.totalAmount > 0 ? `$${order.totalAmount.toFixed(2)}` : "—"}
                  </td>
                  <td className="p-3 text-muted-foreground text-xs max-w-xs truncate">{order.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewOrderDialog isOpen={showNew} onClose={() => setShowNew(false)} products={products} />
    </div>
  );
}
