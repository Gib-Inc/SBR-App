import { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Upload, FileText, Code, Camera, Loader2, CheckCircle2,
  AlertCircle, Trash2, Plus, ImageIcon,
} from "lucide-react";

type EntityType = "suppliers" | "products" | "barcodes";

interface SmartImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: EntityType;
}

const entityLabels: Record<EntityType, string> = {
  suppliers: "Suppliers",
  products: "Products",
  barcodes: "Barcodes",
};

const entityFieldHints: Record<EntityType, string[]> = {
  suppliers: ["name*", "supplierType", "contactName", "email", "phone", "streetAddress", "city", "stateRegion", "postalCode", "country", "paymentTerms", "notes"],
  products: ["name*", "sku*", "type*", "unit", "currentStock", "minStock", "barcode", "notes"],
  barcodes: ["value*", "name*", "sku", "purpose*"],
};

const entityCsvTemplate: Record<EntityType, string> = {
  suppliers: "name,supplierType,contactName,email,phone,streetAddress,city,stateRegion,postalCode,country,paymentTerms,notes\nAcme Corp,supplier,John Smith,john@acme.com,555-0100,123 Main St,Anytown,CA,90210,US,Net 30,",
  products: "name,sku,type,unit,currentStock,minStock,barcode\nWidget A,WGT-001,component,units,100,20,\nFinished Thing,FIN-001,finished_product,units,50,10,",
  barcodes: "value,name,sku,purpose\n012345678901,Widget A,WGT-001,component\n012345678902,Finished Thing,FIN-001,finished_product",
};

export function SmartImport({ open, onOpenChange, entityType }: SmartImportProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<string>("image");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [jsonText, setJsonText] = useState("[]");
  const [previewRecords, setPreviewRecords] = useState<any[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null);

  const reset = useCallback(() => {
    setJsonText("[]");
    setPreviewRecords([]);
    setImagePreview(null);
    setImportResult(null);
    setIsExtracting(false);
    setIsImporting(false);
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  }, [onOpenChange, reset]);

  // ── Image Upload & Vision Extraction ──
  const handleImageUpload = useCallback(async (file: File) => {
    setImagePreview(URL.createObjectURL(file));
    setIsExtracting(true);
    setImportResult(null);

    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]); // strip data:image/...;base64,
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await apiRequest("POST", "/api/import/extract-from-image", {
        imageBase64: base64,
        mediaType: file.type || "image/png",
        entityType,
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const records = data.records || [];
      setPreviewRecords(records);
      setJsonText(JSON.stringify(records, null, 2));
      setTab("editor");

      toast({
        title: `Extracted ${records.length} ${entityLabels[entityType].toLowerCase()}`,
        description: "Review the data below and click Import to save.",
      });
    } catch (err: any) {
      toast({
        title: "Extraction failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsExtracting(false);
    }
  }, [entityType, toast]);

  const handleImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleImageUpload(file);
    }
  }, [handleImageUpload]);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageUpload(file);
  }, [handleImageUpload]);

  // ── CSV Upload ──
  const handleCsvUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text.trim().split("\n");
      if (lines.length < 2) {
        toast({ title: "Invalid CSV", description: "CSV must have a header row and at least one data row", variant: "destructive" });
        return;
      }

      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      const records: any[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
        if (values.length === 0 || (values.length === 1 && !values[0])) continue;

        const record: any = {};
        headers.forEach((header, idx) => {
          const val = values[idx] || "";
          // Try to convert numeric fields
          if (["currentStock", "minStock", "dailyUsage"].includes(header) && val) {
            record[header] = Number(val) || 0;
          } else {
            record[header] = val || null;
          }
        });
        records.push(record);
      }

      setPreviewRecords(records);
      setJsonText(JSON.stringify(records, null, 2));
      setTab("editor");

      toast({
        title: `Parsed ${records.length} rows from CSV`,
        description: "Review the data below and click Import to save.",
      });
    };
    reader.readAsText(file);
  }, [toast]);

  // ── JSON Editor ──
  const handleJsonChange = useCallback((text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        setPreviewRecords(parsed);
      }
    } catch {
      // Invalid JSON, that's fine while editing
    }
  }, []);

  // ── Bulk Import ──
  const handleImport = useCallback(async () => {
    let records: any[];
    try {
      records = JSON.parse(jsonText);
      if (!Array.isArray(records) || records.length === 0) {
        toast({ title: "Nothing to import", description: "The JSON array is empty", variant: "destructive" });
        return;
      }
    } catch {
      toast({ title: "Invalid JSON", description: "Fix the JSON syntax before importing", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    try {
      const res = await apiRequest("POST", "/api/import/bulk", { entityType, records });
      const result = await res.json();
      setImportResult(result);

      // Invalidate queries to refresh the list
      queryClient.invalidateQueries({ queryKey: [`/api/${entityType === "products" ? "items" : entityType}`] });

      if (result.created > 0) {
        toast({
          title: `Imported ${result.created} ${entityLabels[entityType].toLowerCase()}`,
          description: result.errors.length > 0 ? `${result.errors.length} rows had errors` : "All records imported successfully",
        });
      }
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  }, [jsonText, entityType, toast]);

  const downloadTemplate = useCallback(() => {
    const blob = new Blob([entityCsvTemplate[entityType]], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entityType}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [entityType]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import {entityLabels[entityType]}
          </DialogTitle>
          <DialogDescription>
            Upload a screenshot, CSV file, or paste JSON directly. Claude will extract the data for you to review.
          </DialogDescription>
        </DialogHeader>

        {/* Field hints */}
        <div className="flex flex-wrap gap-1.5 px-1">
          {entityFieldHints[entityType].map(field => (
            <Badge
              key={field}
              variant={field.endsWith("*") ? "default" : "outline"}
              className="text-[10px] px-1.5 py-0 font-mono"
            >
              {field.replace("*", "")}
              {field.endsWith("*") && <span className="text-destructive ml-0.5">*</span>}
            </Badge>
          ))}
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="image" className="gap-1.5">
              <Camera className="h-3.5 w-3.5" /> Screenshot
            </TabsTrigger>
            <TabsTrigger value="csv" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> CSV
            </TabsTrigger>
            <TabsTrigger value="editor" className="gap-1.5">
              <Code className="h-3.5 w-3.5" /> Editor
              {previewRecords.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1">
                  {previewRecords.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Screenshot Tab ── */}
          <TabsContent value="image" className="flex-1 mt-3">
            <div
              className="relative border-2 border-dashed rounded-lg p-8 text-center transition-colors hover:border-primary/50 cursor-pointer min-h-[200px] flex flex-col items-center justify-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleImageDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelect}
              />

              {isExtracting ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="text-sm font-medium">Claude is reading your screenshot...</p>
                  <p className="text-xs text-muted-foreground">Extracting {entityLabels[entityType].toLowerCase()} data</p>
                </div>
              ) : imagePreview ? (
                <div className="flex flex-col items-center gap-3">
                  <img src={imagePreview} alt="Uploaded" className="max-h-[150px] rounded-md border" />
                  <p className="text-xs text-muted-foreground">Click or drop another image to re-extract</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                    <ImageIcon className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Drop a screenshot here or click to browse</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Screenshot a list, spreadsheet, invoice, email — anything with {entityLabels[entityType].toLowerCase()} data
                    </p>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── CSV Tab ── */}
          <TabsContent value="csv" className="flex-1 mt-3 space-y-3">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => csvInputRef.current?.click()}
            >
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.tsv"
                className="hidden"
                onChange={handleCsvUpload}
              />
              <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">Click to upload a CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">First row should be column headers</p>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Download CSV Template
            </Button>
          </TabsContent>

          {/* ── JSON Editor Tab ── */}
          <TabsContent value="editor" className="flex-1 mt-3 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 flex flex-col">
              <textarea
                value={jsonText}
                onChange={(e) => handleJsonChange(e.target.value)}
                className="flex-1 min-h-[250px] max-h-[400px] w-full rounded-lg border bg-[#1a1b26] text-[#a9b1d6] font-mono text-sm p-4 resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                spellCheck={false}
                placeholder={`[\n  {\n    "name": "Example",\n    ...\n  }\n]`}
              />

              {/* Validation status */}
              <div className="flex items-center justify-between mt-2 px-1">
                <div className="flex items-center gap-2">
                  {(() => {
                    try {
                      const parsed = JSON.parse(jsonText);
                      if (Array.isArray(parsed)) {
                        return (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            <span className="text-xs text-green-500">{parsed.length} records ready</span>
                          </>
                        );
                      }
                      return (
                        <>
                          <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
                          <span className="text-xs text-yellow-500">Must be a JSON array</span>
                        </>
                      );
                    } catch {
                      return (
                        <>
                          <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                          <span className="text-xs text-red-500">Invalid JSON</span>
                        </>
                      );
                    }
                  })()}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { setJsonText("[]"); setPreviewRecords([]); }}>
                    <Trash2 className="h-3 w-3" /> Clear
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => {
                    try {
                      setJsonText(JSON.stringify(JSON.parse(jsonText), null, 2));
                    } catch {}
                  }}>
                    Format
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Import results */}
        {importResult && (
          <div className={`rounded-lg p-3 text-sm ${importResult.errors.length > 0 ? "bg-yellow-500/10 border border-yellow-500/30" : "bg-green-500/10 border border-green-500/30"}`}>
            <div className="flex items-center gap-2 font-medium">
              {importResult.errors.length > 0 ? (
                <AlertCircle className="h-4 w-4 text-yellow-500" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
              {importResult.created} imported successfully
              {importResult.errors.length > 0 && `, ${importResult.errors.length} failed`}
            </div>
            {importResult.errors.length > 0 && (
              <ul className="mt-1.5 text-xs text-muted-foreground space-y-0.5">
                {importResult.errors.slice(0, 5).map((err, i) => (
                  <li key={i}>• {err}</li>
                ))}
                {importResult.errors.length > 5 && (
                  <li>...and {importResult.errors.length - 5} more</li>
                )}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {importResult ? "Close" : "Cancel"}
          </Button>
          <Button
            onClick={handleImport}
            disabled={isImporting || previewRecords.length === 0}
            className="gap-1.5"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Importing...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> Import {previewRecords.length > 0 ? `${previewRecords.length} Records` : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
