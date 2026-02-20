import { useState, useCallback, useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { VisionDropZone } from "./vision-drop-zone";
import {
  Loader2, CheckCircle2, AlertCircle, Trash2, Plus,
  Building2, ShoppingBag, Wrench, Upload, FileSpreadsheet, Camera,
} from "lucide-react";

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
  name: "name", "supplier name": "name", company: "name", "company name": "name", vendor: "name", "vendor name": "name", business: "name",
  type: "supplierType", "supplier type": "supplierType",
  contact: "contactName", "contact name": "contactName", "contact person": "contactName", representative: "contactName", rep: "contactName",
  email: "email", "email address": "email", "e-mail": "email",
  phone: "phone", "phone number": "phone", tel: "phone", telephone: "phone", mobile: "phone",
  address: "streetAddress", "street address": "streetAddress", street: "streetAddress", "address line 1": "streetAddress",
  city: "city", town: "city",
  state: "stateRegion", region: "stateRegion", province: "stateRegion", "state/region": "stateRegion",
  zip: "postalCode", "zip code": "postalCode", "postal code": "postalCode", "post code": "postalCode",
  country: "country",
  "payment terms": "paymentTerms", terms: "paymentTerms", "pay terms": "paymentTerms",
  website: "catalogUrl", url: "catalogUrl", "web site": "catalogUrl", site: "catalogUrl",
  notes: "notes", note: "notes", comments: "notes",
};

function mapHeader(raw: string) {
  return HEADER_MAP[raw.toLowerCase().replace(/[^a-z0-9 /]/g, "").trim()] || raw;
}

/* ── Component ───────────────────────────────────────────────── */

const typeIcons: Record<string, any> = { supplier: Building2, online: ShoppingBag, private: Wrench };
const typeLabels: Record<string, string> = { supplier: "Supplier", online: "Online", private: "Private" };

interface ImportSuppliersDialogProps { open: boolean; onOpenChange: (open: boolean) => void; }

export function ImportSuppliersDialog({ open, onOpenChange }: ImportSuppliersDialogProps) {
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

  const cycleType = useCallback((i: number) => {
    const types = ["supplier", "online", "private"];
    setRecords(p => p.map((r, idx) => {
      if (idx !== i) return r;
      const cur = types.indexOf(r.supplierType || "supplier");
      return { ...r, supplierType: types[(cur + 1) % types.length] };
    }));
  }, []);

  /** Build combined address string for display */
  const getAddress = (r: any) => {
    return [r.streetAddress, r.city, r.stateRegion, r.postalCode].filter(Boolean).join(", ");
  };

  /** Set combined address back into streetAddress (simple approach) */
  const setAddress = (i: number, value: string) => {
    updateField(i, "streetAddress", value);
    // Clear individual fields since we're using a single input
    updateField(i, "city", null);
    updateField(i, "stateRegion", null);
    updateField(i, "postalCode", null);
  };

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
          if (v) rec[field] = v;
        });
        // Normalize supplier type
        if (rec.supplierType) {
          const t = rec.supplierType.toLowerCase();
          if (t.includes("online") || t.includes("web") || t.includes("ecom")) rec.supplierType = "online";
          else if (t.includes("private") || t.includes("individual") || t.includes("contract")) rec.supplierType = "private";
          else rec.supplierType = "supplier";
        } else rec.supplierType = "supplier";
        if (rec.name) parsed.push(rec);
      }
      setRecords(p => [...p, ...parsed]);
      setImportResult(null);
      toast({ title: `Parsed ${parsed.length} suppliers from CSV` });
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
    const valid = records.filter(r => r.name?.trim());
    if (!valid.length) { toast({ title: "Each supplier needs a name", variant: "destructive" }); return; }
    setIsImporting(true);
    try {
      const res = await apiRequest("POST", "/api/import/bulk", { entityType: "suppliers", records: valid });
      const result = await res.json();
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      if (result.created > 0) toast({ title: `Imported ${result.created} supplier${result.created !== 1 ? "s" : ""}`, description: result.errors.length ? `${result.errors.length} had errors` : "All imported successfully" });
    } catch (err: any) { toast({ title: "Import failed", description: err.message, variant: "destructive" }); }
    finally { setIsImporting(false); }
  }, [records, toast]);

  const handleClose = useCallback(() => { setRecords([]); setImportResult(null); setCsvFileName(null); setTab("screenshot"); onOpenChange(false); }, [onOpenChange]);

  /* ── Render ────────────────────────────────────────────────── */

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[95vw] w-[1100px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Import Suppliers</DialogTitle>
          <DialogDescription>Drop screenshots of supplier lists, business cards, invoices — or upload a CSV file.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="screenshot" className="gap-1.5"><Camera className="h-3.5 w-3.5" /> Screenshot</TabsTrigger>
            <TabsTrigger value="csv" className="gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" /> CSV File</TabsTrigger>
          </TabsList>

          <TabsContent value="screenshot" className="mt-3">
            <VisionDropZone entityType="suppliers" onExtracted={handleExtracted} maxFiles={15} compact={records.length > 0} />
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
              <p className="text-xs text-muted-foreground mt-1">Headers: name, contact, email, phone, address, city, state, zip, payment terms</p>
            </div>
          </TabsContent>
        </Tabs>

        {/* ── Preview table matching supplier page columns ──── */}
        {records.length > 0 && (
          <ScrollArea className="flex-1 max-h-[400px] border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead className="w-20">Type</TableHead>
                  <TableHead className="min-w-[160px]">Supplier Name</TableHead>
                  <TableHead className="min-w-[140px]">Contact Name</TableHead>
                  <TableHead className="min-w-[180px]">Email</TableHead>
                  <TableHead className="w-32">Phone</TableHead>
                  <TableHead className="min-w-[200px]">Address</TableHead>
                  <TableHead className="w-28">Payment Terms</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r, i) => {
                  const TypeIcon = typeIcons[r.supplierType] || Building2;
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell>
                        <button onClick={() => cycleType(i)} className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border hover:bg-muted transition-colors" title="Click to change type">
                          <TypeIcon className="h-3 w-3" />
                          {typeLabels[r.supplierType] || "Supplier"}
                        </button>
                      </TableCell>
                      <TableCell><Input value={r.name || ""} onChange={e => updateField(i, "name", e.target.value)} className="h-7 text-sm" placeholder="Company or person" /></TableCell>
                      <TableCell><Input value={r.contactName || ""} onChange={e => updateField(i, "contactName", e.target.value)} className="h-7 text-sm" placeholder="Contact person" /></TableCell>
                      <TableCell><Input value={r.email || ""} onChange={e => updateField(i, "email", e.target.value)} className="h-7 text-sm" placeholder="Email" /></TableCell>
                      <TableCell><Input value={r.phone || ""} onChange={e => updateField(i, "phone", e.target.value)} className="h-7 text-sm" placeholder="Phone" /></TableCell>
                      <TableCell><Input value={getAddress(r)} onChange={e => setAddress(i, e.target.value)} className="h-7 text-sm" placeholder="Street, City, State ZIP" /></TableCell>
                      <TableCell><Input value={r.paymentTerms || ""} onChange={e => updateField(i, "paymentTerms", e.target.value)} className="h-7 text-sm" placeholder="Net 30" /></TableCell>
                      <TableCell><button onClick={() => removeRecord(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></TableCell>
                    </TableRow>
                  );
                })}
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
              {isImporting ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing...</> : <><Plus className="h-4 w-4" /> Import {records.length} Supplier{records.length !== 1 ? "s" : ""}</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
