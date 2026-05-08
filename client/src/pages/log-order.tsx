import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardEdit, Upload, Loader2, Plus, Trash2, FileText, Camera } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Supplier = { id: string; name: string; leadTimeDays?: number | null };
type Item = { id: string; sku: string; name: string; type: string };

type Line = {
  itemId: string;
  sku: string;
  description: string;
  qty: string;
  unitCost: string;
};

type ParsedInvoice = {
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  expected_delivery_date: string | null;
  line_items: { sku: string | null; description: string; qty: number; unit_cost: number }[];
  total: number | null;
};

const SENDERS = ["Clarence", "Sammie", "Matt", "Stacy"];
const FX_SENDERS = ["Christopher", "Matt", "Sammie", "Clarence"];

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const blankLine = (): Line => ({ itemId: "", sku: "", description: "", qty: "", unitCost: "" });

const isoToday = () => new Date().toISOString().slice(0, 10);

export default function LogOrder() {
  const [tab, setTab] = useState<"supplier" | "fx">("supplier");
  return (
    <div className="p-4 md:p-8 space-y-6" data-testid="page-log-order">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <ClipboardEdit className="h-7 w-7" />
          Log Order
        </h1>
        <p className="text-muted-foreground mt-1">
          Snap an invoice or type it in — creates a purchase order, notifies Roger if you say so,
          and tracks ETA + accuracy automatically.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="supplier" data-testid="tab-supplier-order">Supplier Order</TabsTrigger>
          <TabsTrigger value="fx" data-testid="tab-fx-anticipated">FX Anticipated Production</TabsTrigger>
        </TabsList>
        <TabsContent value="supplier" className="mt-4">
          <SupplierOrderTab />
        </TabsContent>
        <TabsContent value="fx" className="mt-4">
          <FxAnticipatedTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// TAB A — Supplier Order (with optional invoice OCR)
// ──────────────────────────────────────────────────────────────────────

function SupplierOrderTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [supplierId, setSupplierId] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [orderDate, setOrderDate] = useState(isoToday());
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [orderedBy, setOrderedBy] = useState("Clarence");
  const [notifyRoger, setNotifyRoger] = useState(true);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [invoiceTotal, setInvoiceTotal] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [entrySource, setEntrySource] = useState<"manual" | "invoice_upload">("manual");

  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: items = [] } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const itemsBySku = useMemo(() => new Map(items.map((i) => [i.sku, i])), [items]);

  const supplierLeadTime = useMemo(() => {
    const s = suppliers.find((x) => x.id === supplierId);
    return s?.leadTimeDays ?? 5;
  }, [suppliers, supplierId]);

  // Default the supplier to McMaster-Carr if it exists in the list — that's
  // 80%+ of Clarence's traffic per the spec.
  useEffect(() => {
    if (!supplierId && suppliers.length > 0) {
      const mcmaster = suppliers.find((s) => /mcmaster/i.test(s.name));
      setSupplierId(mcmaster?.id ?? suppliers[0].id);
    }
  }, [suppliers, supplierId]);

  // Default the expected-delivery date to today + supplier lead time when
  // it hasn't been set or when the supplier changes. Operator-typed values
  // are preserved.
  useEffect(() => {
    if (expectedDelivery) return;
    const d = new Date();
    d.setDate(d.getDate() + supplierLeadTime);
    setExpectedDelivery(d.toISOString().slice(0, 10));
  }, [supplierLeadTime, expectedDelivery]);

  const linesTotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = Number(l.qty);
        const c = Number(l.unitCost);
        if (!Number.isFinite(q) || !Number.isFinite(c)) return sum;
        return sum + q * c;
      }, 0),
    [lines],
  );

  const onFileChange = (f: File | null) => {
    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    setFile(f);
    if (f.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(f));
    } else {
      setPreviewUrl(null);
    }
  };

  const parseMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Pick a file first");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/orders/parse-invoice", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Parse failed (${res.status})`);
      }
      return res.json() as Promise<{ parsed: ParsedInvoice | null; error?: string }>;
    },
    onSuccess: (data) => {
      if (!data.parsed) {
        toast({
          variant: "destructive",
          title: "Parse failed",
          description: data.error ?? "Couldn't extract structured data. Type it in manually.",
        });
        return;
      }
      const p = data.parsed;
      // Populate the form from parsed data — operator reviews + edits.
      if (p.invoice_number) setInvoiceNumber(p.invoice_number);
      if (p.invoice_date) setOrderDate(p.invoice_date);
      if (p.expected_delivery_date) setExpectedDelivery(p.expected_delivery_date);
      if (p.total != null) setInvoiceTotal(String(p.total));
      // Try to match supplier name against the dropdown.
      if (p.supplier_name) {
        const match = suppliers.find((s) =>
          s.name.toLowerCase().includes(p.supplier_name!.toLowerCase()) ||
          p.supplier_name!.toLowerCase().includes(s.name.toLowerCase()),
        );
        if (match) setSupplierId(match.id);
      }
      const newLines: Line[] = (p.line_items ?? []).map((li) => {
        const sku = (li.sku ?? "").trim();
        const matchedItem = sku ? itemsBySku.get(sku) : undefined;
        return {
          itemId: matchedItem?.id ?? "",
          sku,
          description: li.description ?? "",
          qty: String(li.qty ?? 0),
          unitCost: String(li.unit_cost ?? 0),
        };
      });
      setLines(newLines.length > 0 ? newLines : [blankLine()]);
      setEntrySource("invoice_upload");
      toast({
        title: "Parsed",
        description: `${newLines.length} line${newLines.length === 1 ? "" : "s"} extracted. Review and edit before saving.`,
      });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Parse failed", description: err.message });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (opts: { notify: boolean }) => {
      const cleanLines = lines.filter((l) => l.qty && l.unitCost);
      if (cleanLines.length === 0) throw new Error("Add at least one line item");
      const payload = {
        supplierId,
        invoiceNumber: invoiceNumber || undefined,
        orderDate,
        expectedDelivery,
        orderedBy,
        entrySource,
        notifyRoger: opts.notify,
        invoiceTotal: invoiceTotal ? Number(invoiceTotal) : undefined,
        lines: cleanLines.map((l) => ({
          itemId: l.itemId || undefined,
          sku: l.sku || undefined,
          description: l.description || undefined,
          qty: Number(l.qty),
          unitCost: Number(l.unitCost),
        })),
      };
      const res = await apiRequest("POST", "/api/orders/log-supplier-invoice", payload);
      return res.json() as Promise<{ purchaseOrder: { id: string; poNumber: string }; notifyRoger: boolean }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: `PO ${data.purchaseOrder.poNumber} saved`,
        description: data.notifyRoger ? "Roger notified." : "No Roger notification.",
      });
      // Reset form for the next entry — Clarence orders 4×/week.
      setLines([blankLine()]);
      setInvoiceNumber("");
      setInvoiceTotal("");
      setFile(null);
      setPreviewUrl(null);
      setEntrySource("manual");
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Save failed", description: err.message });
    },
  });

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  const addLine = () => setLines((prev) => [...prev, blankLine()]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* LEFT — Invoice upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Camera className="h-4 w-4" />
            Invoice (optional)
          </CardTitle>
          <CardDescription>
            Drop a photo or PDF — Claude will extract the line items into the form on the right.
            Always review before saving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            className="border-2 border-dashed rounded-lg p-6 text-center hover:bg-muted/30 cursor-pointer transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) onFileChange(f);
            }}
            data-testid="invoice-dropzone"
          >
            <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <div className="text-sm">{file ? file.name : "Drop invoice here, or click to browse"}</div>
            <div className="text-xs text-muted-foreground mt-1">JPG / PNG / PDF</div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              data-testid="invoice-file-input"
            />
          </div>

          {file && (
            <Button
              onClick={() => parseMutation.mutate()}
              disabled={parseMutation.isPending}
              className="w-full"
              data-testid="button-parse-invoice"
            >
              {parseMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              Parse Invoice
            </Button>
          )}

          {previewUrl && (
            <div className="rounded border overflow-hidden max-h-[480px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="invoice preview" className="w-full h-auto" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* RIGHT — Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order Details</CardTitle>
          <CardDescription>
            Auto-populated from the parsed invoice when present, but always editable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger data-testid="select-supplier">
                  <SelectValue placeholder="Pick supplier…" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Invoice / Order #</Label>
              <Input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="from supplier invoice"
                data-testid="input-invoice-number"
              />
            </div>
            <div className="space-y-1">
              <Label>Order date</Label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} data-testid="input-order-date" />
            </div>
            <div className="space-y-1">
              <Label>Expected delivery</Label>
              <Input
                type="date"
                value={expectedDelivery}
                onChange={(e) => setExpectedDelivery(e.target.value)}
                data-testid="input-expected-delivery"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line items</Label>
              <Button variant="ghost" size="sm" onClick={addLine} data-testid="button-add-line">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add line
              </Button>
            </div>
            <div className="rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right w-[80px]">Qty</TableHead>
                    <TableHead className="text-right w-[100px]">Unit $</TableHead>
                    <TableHead className="text-right w-[100px]">Line $</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => {
                    const lineTotal = (Number(l.qty) || 0) * (Number(l.unitCost) || 0);
                    const matched = l.sku ? itemsBySku.get(l.sku) : undefined;
                    return (
                      <TableRow key={i} data-testid={`line-row-${i}`}>
                        <TableCell>
                          <Input
                            value={l.sku}
                            onChange={(e) => {
                              const next = e.target.value;
                              const m = itemsBySku.get(next.trim());
                              updateLine(i, {
                                sku: next,
                                itemId: m?.id ?? "",
                                description: m?.name ?? l.description,
                              });
                            }}
                            placeholder="SBR-…"
                            className="h-8 text-xs font-mono"
                            data-testid={`input-line-sku-${i}`}
                          />
                          {l.sku && !matched && (
                            <div className="text-[10px] text-amber-600 mt-0.5">Unmapped</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            value={l.description}
                            onChange={(e) => updateLine(i, { description: e.target.value })}
                            className="h-8 text-xs"
                            data-testid={`input-line-desc-${i}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            inputMode="numeric"
                            value={l.qty}
                            onChange={(e) => updateLine(i, { qty: e.target.value })}
                            className="h-8 text-right text-xs tabular-nums"
                            data-testid={`input-line-qty-${i}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            inputMode="decimal"
                            step={0.01}
                            value={l.unitCost}
                            onChange={(e) => updateLine(i, { unitCost: e.target.value })}
                            className="h-8 text-right text-xs tabular-nums"
                            data-testid={`input-line-cost-${i}`}
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {lineTotal > 0 ? usd(lineTotal) : "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => removeLine(i)}
                            disabled={lines.length === 1}
                            data-testid={`button-remove-line-${i}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sum of lines</span>
              <span className="font-semibold tabular-nums">{usd(linesTotal)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Invoice total ($)</Label>
              <Input
                type="number"
                inputMode="decimal"
                step={0.01}
                value={invoiceTotal}
                onChange={(e) => setInvoiceTotal(e.target.value)}
                placeholder="from invoice grand total"
                data-testid="input-invoice-total"
              />
              {invoiceTotal && Math.abs(Number(invoiceTotal) - linesTotal) > 0.01 && (
                <div className="text-[11px] text-amber-600">
                  Lines sum to {usd(linesTotal)} — differs by {usd(Math.abs(Number(invoiceTotal) - linesTotal))}.
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label>Sender</Label>
              <Select value={orderedBy} onValueChange={setOrderedBy}>
                <SelectTrigger data-testid="select-sender">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENDERS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id="notify-roger"
              checked={notifyRoger}
              onCheckedChange={(v) => setNotifyRoger(v === true)}
              data-testid="checkbox-notify-roger"
            />
            <Label htmlFor="notify-roger" className="cursor-pointer">
              Notify Roger (rck1967@hotmail.com) when saved
            </Label>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              onClick={() => saveMutation.mutate({ notify: false })}
              disabled={saveMutation.isPending || !supplierId}
              data-testid="button-save-only"
            >
              {saveMutation.isPending && !notifyRoger ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Only
            </Button>
            <Button
              onClick={() => saveMutation.mutate({ notify: notifyRoger })}
              disabled={saveMutation.isPending || !supplierId}
              data-testid="button-save-and-notify"
            >
              {saveMutation.isPending && notifyRoger ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {notifyRoger ? "Save & Notify Roger" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// TAB B — FX Anticipated Production
// ──────────────────────────────────────────────────────────────────────

function FxAnticipatedTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [loggedBy, setLoggedBy] = useState("Christopher");
  const [notes, setNotes] = useState("");

  const { data: items = [] } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const finishedProducts = items.filter((i) => i.type === "finished_product");

  // Default expected delivery to today + 21d (FX's typical lead time).
  useEffect(() => {
    if (expectedDelivery) return;
    const d = new Date();
    d.setDate(d.getDate() + 21);
    setExpectedDelivery(d.toISOString().slice(0, 10));
  }, [expectedDelivery]);

  const mutation = useMutation({
    mutationFn: async () => {
      const qNum = Number(qty);
      if (!itemId) throw new Error("Pick a product");
      if (!Number.isFinite(qNum) || !Number.isInteger(qNum) || qNum <= 0) {
        throw new Error("Qty must be a positive whole number");
      }
      const res = await apiRequest("POST", "/api/orders/log-fx-anticipated", {
        itemId,
        qty: qNum,
        expectedDelivery,
        loggedBy,
        notes: notes.trim() || undefined,
      });
      return res.json() as Promise<{ purchaseOrder: { poNumber: string } }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/snapshot"] });
      toast({
        title: `FX PO ${data.purchaseOrder.poNumber} logged`,
        description: "fx_in_process_qty updated. Visible on Production Priority + Incoming.",
      });
      setItemId("");
      setQty("");
      setNotes("");
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Save failed", description: err.message });
    },
  });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">FX Anticipated Production</CardTitle>
        <CardDescription>
          Log a heads-up from FX before any invoice arrives. Creates an FX PO with build status =
          "Confirmed by Supplier" and bumps fx_in_process_qty so forecasts know the units are
          coming. Roger is NOT notified — these aren't real invoices.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label>Product</Label>
          <Select value={itemId} onValueChange={setItemId}>
            <SelectTrigger data-testid="select-fx-item">
              <SelectValue placeholder="Pick a finished product…" />
            </SelectTrigger>
            <SelectContent>
              {finishedProducts
                .sort((a, b) => a.sku.localeCompare(b.sku))
                .map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    <span className="font-mono text-xs mr-2">{it.sku}</span>
                    {it.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Quantity</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              data-testid="input-fx-qty"
            />
          </div>
          <div className="space-y-1">
            <Label>Expected delivery</Label>
            <Input
              type="date"
              value={expectedDelivery}
              onChange={(e) => setExpectedDelivery(e.target.value)}
              data-testid="input-fx-expected"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Logged by</Label>
          <Select value={loggedBy} onValueChange={setLoggedBy}>
            <SelectTrigger data-testid="select-fx-logged-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FX_SENDERS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Notes</Label>
          <Textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder='e.g. "From Christopher’s call with Beth, 4/30/26"'
            data-testid="input-fx-notes"
          />
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !itemId || !qty}
            data-testid="button-save-fx"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
