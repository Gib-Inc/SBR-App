import { useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Trash2, Plus, Camera } from "lucide-react";
import { VisionDropZone } from "./vision-drop-zone";

/* ── CSV helpers ─────────────────────────────────────────────── */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "", inQ = false, row: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') { inQ = true; }
    else if (ch === "," || ch === "\t") { row.push(cur.trim()); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur.trim());
      if (row.some(c => c)) rows.push(row);
      row = []; cur = "";
    } else cur += ch;
  }
  row.push(cur.trim());
  if (row.some(c => c)) rows.push(row);
  return rows;
}

const HEADER_MAP: Record<string, string> = {
  name: "name", product: "name", "product name": "name", "item name": "name", item: "name", description: "name",
  sku: "sku", "item code": "sku", "product code": "sku", code: "sku", "part number": "sku", "part #": "sku",
  type: "type", category: "type", "product type": "type", kind: "type",
  unit: "unit", uom: "unit", "unit of measure": "unit", units: "unit",
  stock: "currentStock", "current stock": "currentStock", qty: "currentStock", quantity: "currentStock", "on hand": "currentStock", "in stock": "currentStock",
  "min stock": "minStock", "minimum stock": "minStock", "reorder point": "minStock", "min qty": "minStock", "safety stock": "minStock",
  "daily usage": "dailyUsage", usage: "dailyUsage", "avg daily": "dailyUsage", velocity: "dailyUsage",
  cost: "defaultPurchaseCost", price: "defaultPurchaseCost", "unit cost": "defaultPurchaseCost", "purchase cost": "defaultPurchaseCost", "unit price": "defaultPurchaseCost",
  barcode: "barcode", upc: "barcode", ean: "barcode", gtin: "barcode",
};

function mapHeader(raw: string) {
  return HEADER_MAP[raw.toLowerCase().replace(/[^a-z0-9 #]/g, "").trim()] || raw;
}

/* ── Component ───────────────────────────────────────────────── */

interface ImportProductsDialogProps { isOpen: boolean; onClose: () => void; }

export function ImportProductsDialog({ isOpen, onClose }: ImportProductsDialogProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState("screenshot");
  const [records, setRecords] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null);
  const [csvDragOver, setCsvDragOver] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  const handleExtracted = useCallback((r: any[]) => { setRecords(p => [...p, ...r]); setImportResult(null); }, []);
  const updateField = useCallback((i: number, f: string, v: any) => { setRecords(p => p.map((r, idx) => idx === i ? { ...r, [f]: v } : r)); }, []);
  const removeRecord = useCallback((i: number) => { setRecords(p => p.filter((_, idx) => idx !== i)); }, []);

  /* ── CSV processing ────────────────────────────────────────── */

  const processCsvFile = useCallback((file: File) => {
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(reader.result as string);
      if (rows.length < 2) { toast({ title: "CSV is empty", variant: "destructive" }); return; }
      const headers = rows[0].map(mapHeader);
      const parsed: any[] = [];
      for (let i = 1; i < rows.length; i++) {
        const vals = rows[i];
        const rec: any = {};
        headers.forEach((field, idx) => {
          const v = vals[idx] || "";
          if (!v) return;
          if (["currentStock", "minStock", "dailyUsage", "defaultPurchaseCost"].includes(field)) rec[field] = Number(v) || 0;
          else rec[field] = v;
        });
        if (rec.type) {
          const t = rec.type.toLowerCase();
          rec.type = (t.includes("finish") || t.includes("product") || t === "fp") ? "finished_product" : "component";
        } else rec.type = "component";
        if (!rec.sku) rec.sku = `IMPORT-${String(i).padStart(3, "0")}`;
        if (rec.name) parsed.push(rec);
      }
      setRecords(p => [...p, ...parsed]);
      setImportResult(null);
      toast({ title: `Parsed ${parsed.length} products from CSV` });
    };
    reader.readAsText(file);
  }, [toast]);

  const onCsvDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setCsvDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && /\.(csv|tsv|txt)$/i.test(file.name)) processCsvFile(file);
    else toast({ title: "Please drop a CSV or TSV file", variant: "destructive" });
  }, [processCsvFile, toast]);

  const onCsvSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) processCsvFile(f); e.target.value = "";
  }, [processCsvFile]);

  /* ── Import ────────────────────────────────────────────────── */

  const handleImport = useCallback(async () => {
    const valid = records.filter(r => r.name?.trim() && r.sku?.trim());
    if (!valid.length) { toast({ title: "Each product needs a name and SKU", variant: "destructive" }); return; }
    setIsImporting(true);
    try {
      const res = await apiRequest("POST", "/api/import/bulk", { entityType: "products", records: valid });
      const result = await res.json();
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      if (result.created > 0) toast({ title: `Imported ${result.created} product${result.created !== 1 ? "s" : ""}`, description: result.errors.length ? `${result.errors.length} had errors` : "All imported successfully" });
    } catch (err: any) { toast({ title: "Import failed", description: err.message, variant: "destructive" }); }
    finally { setIsImporting(false); }
  }, [records, toast]);

  const handleClose = useCallback(() => { setRecords([]); setImportResult(null); setCsvFileName(null); setTab("screenshot"); onClose(); }, [onClose]);

  /* ── Render ────────────────────────────────────────────────── */

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-[95vw] w-[1100px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Import Products</DialogTitle>
          <DialogDescription>Drop screenshots from Katana, Shopify, spreadsheets, catalogs — or upload a CSV file.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="screenshot" className="gap-1.5"><Camera className="h-3.5 w-3.5" /> Screenshot</TabsTrigger>
            <TabsTrigger value="csv" className="gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" /> CSV File</TabsTrigger>
          </TabsList>

          <TabsContent value="screenshot" className="mt-3">
            <VisionDropZone entityType="products" onExtracted={handleExtracted} maxFiles={15} compact={records.length > 0} />
          </TabsContent>

          <TabsContent value="csv" className="mt-3">
            <input ref={csvRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={onCsvSelect} />
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all ${csvDragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-muted-foreground/25 hover:border-primary/50"}`}
              onClick={() => csvRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setCsvDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setCsvDragOver(false); }}
              onDrop={onCsvDrop}
            >
              <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">
                {csvFileName ? csvFileName : <><span className="text-primary">Drop CSV here</span> or click to browse</>}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Headers: name, sku, type, unit, stock, min stock, daily usage, cost, barcode</p>
            </div>
          </TabsContent>
        </Tabs>

        {/* ── Preview table ──────────────────────────────────── */}
        {records.length > 0 && (
          <ScrollArea className="flex-1 max-h-[400px] border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead className="min-w-[170px]">Name</TableHead>
                  <TableHead className="w-28">SKU</TableHead>
                  <TableHead className="w-28">Type</TableHead>
                  <TableHead className="w-20">Unit</TableHead>
                  <TableHead className="w-20">Stock</TableHead>
                  <TableHead className="w-24">Min Stock</TableHead>
                  <TableHead className="w-24">Daily Usage</TableHead>
                  <TableHead className="w-24">Cost</TableHead>
                  <TableHead className="w-28">Barcode</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                    <TableCell><Input value={r.name || ""} onChange={e => updateField(i, "name", e.target.value)} className="h-7 text-sm" placeholder="Product name" /></TableCell>
                    <TableCell><Input value={r.sku || ""} onChange={e => updateField(i, "sku", e.target.value)} className="h-7 text-sm" placeholder="SKU" /></TableCell>
                    <TableCell>
                      <select value={r.type || "component"} onChange={e => updateField(i, "type", e.target.value)} className="h-7 w-full rounded border bg-background px-2 text-xs">
                        <option value="component">Component</option>
                        <option value="finished_product">Finished</option>
                      </select>
                    </TableCell>
                    <TableCell><Input value={r.unit || "units"} onChange={e => updateField(i, "unit", e.target.value)} className="h-7 text-sm w-20" /></TableCell>
                    <TableCell><Input type="number" value={r.currentStock ?? 0} onChange={e => updateField(i, "currentStock", Number(e.target.value))} className="h-7 text-sm w-20" /></TableCell>
                    <TableCell><Input type="number" value={r.minStock ?? 0} onChange={e => updateField(i, "minStock", Number(e.target.value))} className="h-7 text-sm w-24" /></TableCell>
                    <TableCell><Input type="number" step="0.1" value={r.dailyUsage ?? 0} onChange={e => updateField(i, "dailyUsage", Number(e.target.value))} className="h-7 text-sm w-24" /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={r.defaultPurchaseCost ?? ""} onChange={e => updateField(i, "defaultPurchaseCost", e.target.value ? Number(e.target.value) : null)} className="h-7 text-sm w-24" placeholder="$" /></TableCell>
                    <TableCell><Input value={r.barcode || ""} onChange={e => updateField(i, "barcode", e.target.value)} className="h-7 text-sm w-28" placeholder="UPC/EAN" /></TableCell>
                    <TableCell><button onClick={() => removeRecord(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        {importResult && (
          <div className={`rounded-lg p-3 text-sm ${importResult.errors.length > 0 ? "bg-yellow-500/10 border border-yellow-500/30" : "bg-green-500/10 border border-green-500/30"}`}>
            <div className="flex items-center gap-2 font-medium">
              {importResult.errors.length > 0 ? <AlertCircle className="h-4 w-4 text-yellow-500" /> : <CheckCircle2 className="h-4 w-4 text-green-500" />}
              {importResult.created} imported{importResult.errors.length > 0 && `, ${importResult.errors.length} failed`}
            </div>
            {importResult.errors.length > 0 && (
              <ul className="mt-1 text-xs text-muted-foreground space-y-0.5">
                {importResult.errors.slice(0, 5).map((err, i) => <li key={i}>• {err}</li>)}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>{importResult?.created ? "Done" : "Cancel"}</Button>
          {records.length > 0 && !importResult?.created && (
            <Button onClick={handleImport} disabled={isImporting} className="gap-1.5">
              {isImporting ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing...</> : <><Plus className="h-4 w-4" /> Import {records.length} Product{records.length !== 1 ? "s" : ""}</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
