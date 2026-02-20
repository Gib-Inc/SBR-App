import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Trash2, Plus, Camera } from "lucide-react";
import { VisionDropZone } from "./vision-drop-zone";

interface ImportProductsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImportProductsDialog({ isOpen, onClose }: ImportProductsDialogProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<string>("screenshot");
  const [records, setRecords] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("default");

  const { data: importProfiles = [] } = useQuery<any[]>({
    queryKey: ["/api/import-profiles"],
    enabled: isOpen,
  });

  const handleExtracted = useCallback((newRecords: any[]) => {
    setRecords(prev => [...prev, ...newRecords]);
    setImportResult(null);
  }, []);

  const updateField = useCallback((index: number, field: string, value: any) => {
    setRecords(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }, []);

  const removeRecord = useCallback((index: number) => {
    setRecords(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleCsvUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text.trim().split("\n");
      if (lines.length < 2) return;

      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      const parsed: any[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
        if (values.length === 0 || (values.length === 1 && !values[0])) continue;

        const record: any = {};
        headers.forEach((header, idx) => {
          const val = values[idx] || "";
          if (["currentStock", "minStock", "dailyUsage", "defaultPurchaseCost"].includes(header) && val) {
            record[header] = Number(val) || 0;
          } else {
            record[header] = val || null;
          }
        });
        if (!record.type) record.type = "component";
        if (!record.sku) record.sku = `IMPORT-${String(i).padStart(3, "0")}`;
        parsed.push(record);
      }

      setRecords(prev => [...prev, ...parsed]);
      toast({ title: `Parsed ${parsed.length} products from CSV` });
    };
    reader.readAsText(file);
  }, [toast]);

  const handleImport = useCallback(async () => {
    const valid = records.filter(r => r.name?.trim() && r.sku?.trim());
    if (valid.length === 0) {
      toast({ title: "No valid products", description: "Each product needs a name and SKU", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    try {
      const res = await apiRequest("POST", "/api/import/bulk", { entityType: "products", records: valid });
      const result = await res.json();
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });

      if (result.created > 0) {
        toast({
          title: `Imported ${result.created} product${result.created !== 1 ? "s" : ""}`,
          description: result.errors.length > 0 ? `${result.errors.length} had errors` : "All imported successfully",
        });
      }
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  }, [records, toast]);

  const handleClose = useCallback(() => {
    setRecords([]);
    setImportResult(null);
    setSelectedFile(null);
    setTab("screenshot");
    onClose();
  }, [onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Products
          </DialogTitle>
          <DialogDescription>
            Drop screenshots from Katana, Shopify, spreadsheets, catalogs — or upload a CSV file.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="screenshot" className="gap-1.5">
              <Camera className="h-3.5 w-3.5" /> Screenshot
            </TabsTrigger>
            <TabsTrigger value="csv" className="gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5" /> CSV File
            </TabsTrigger>
          </TabsList>

          <TabsContent value="screenshot" className="mt-3">
            <VisionDropZone
              entityType="products"
              onExtracted={handleExtracted}
              maxFiles={15}
              compact={records.length > 0}
            />
          </TabsContent>

          <TabsContent value="csv" className="mt-3 space-y-3">
            {importProfiles.length > 0 && (
              <div>
                <label className="text-sm font-medium">Import Profile (Optional)</label>
                <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Default Mapping" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default Mapping</SelectItem>
                    {importProfiles.map((p: any) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => document.getElementById("csv-product-input")?.click()}>
              <input id="csv-product-input" type="file" accept=".csv,.tsv" className="hidden" onChange={handleCsvUpload} />
              <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">{selectedFile ? selectedFile.name : "Click to upload CSV"}</p>
              <p className="text-xs text-muted-foreground mt-1">CSV with headers: name, sku, type, unit, currentStock, minStock</p>
            </div>
          </TabsContent>
        </Tabs>

        {/* Extracted records table */}
        {records.length > 0 && (
          <ScrollArea className="flex-1 max-h-[350px] border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-28">SKU</TableHead>
                  <TableHead className="w-28">Type</TableHead>
                  <TableHead className="w-16">Stock</TableHead>
                  <TableHead className="w-16">Cost</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                    <TableCell>
                      <Input value={record.name || ""} onChange={(e) => updateField(i, "name", e.target.value)} className="h-7 text-sm" placeholder="Product name" />
                    </TableCell>
                    <TableCell>
                      <Input value={record.sku || ""} onChange={(e) => updateField(i, "sku", e.target.value)} className="h-7 text-sm" placeholder="SKU" />
                    </TableCell>
                    <TableCell>
                      <select value={record.type || "component"} onChange={(e) => updateField(i, "type", e.target.value)} className="h-7 w-full rounded border bg-background px-2 text-xs">
                        <option value="component">Component</option>
                        <option value="finished_product">Finished</option>
                      </select>
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={record.currentStock || 0} onChange={(e) => updateField(i, "currentStock", Number(e.target.value))} className="h-7 text-sm w-16" />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={record.defaultPurchaseCost || ""} onChange={(e) => updateField(i, "defaultPurchaseCost", Number(e.target.value) || null)} className="h-7 text-sm w-16" placeholder="$" />
                    </TableCell>
                    <TableCell>
                      <button onClick={() => removeRecord(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                    </TableCell>
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
