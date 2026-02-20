import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { VisionDropZone } from "./vision-drop-zone";
import {
  Loader2, CheckCircle2, AlertCircle, Trash2, Plus,
  Building2, ShoppingBag, Wrench, Upload,
} from "lucide-react";

interface ImportSuppliersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const typeIcons: Record<string, any> = {
  supplier: Building2,
  online: ShoppingBag,
  private: Wrench,
};

const typeLabels: Record<string, string> = {
  supplier: "Supplier",
  online: "Online",
  private: "Private",
};

export function ImportSuppliersDialog({ open, onOpenChange }: ImportSuppliersDialogProps) {
  const { toast } = useToast();
  const [records, setRecords] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null);

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

  const cycleType = useCallback((index: number) => {
    const types = ["supplier", "online", "private"];
    setRecords(prev => prev.map((r, i) => {
      if (i !== index) return r;
      const current = types.indexOf(r.supplierType || "supplier");
      return { ...r, supplierType: types[(current + 1) % types.length] };
    }));
  }, []);

  const handleImport = useCallback(async () => {
    const valid = records.filter(r => r.name?.trim());
    if (valid.length === 0) {
      toast({ title: "No valid suppliers", description: "Each supplier needs at least a name", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    try {
      const res = await apiRequest("POST", "/api/import/bulk", { entityType: "suppliers", records: valid });
      const result = await res.json();
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });

      if (result.created > 0) {
        toast({
          title: `Imported ${result.created} supplier${result.created !== 1 ? "s" : ""}`,
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
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Suppliers
          </DialogTitle>
          <DialogDescription>
            Drop screenshots of supplier lists, business cards, invoices, or any image with supplier info. Claude will extract the data.
          </DialogDescription>
        </DialogHeader>

        {/* Drop zone */}
        <VisionDropZone
          entityType="suppliers"
          onExtracted={handleExtracted}
          maxFiles={15}
          compact={records.length > 0}
        />

        {/* Extracted records table */}
        {records.length > 0 && (
          <ScrollArea className="flex-1 max-h-[400px] border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead className="w-20">Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record, i) => {
                  const TypeIcon = typeIcons[record.supplierType] || Building2;
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell>
                        <button
                          onClick={() => cycleType(i)}
                          className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border hover:bg-muted transition-colors"
                          title="Click to change type"
                        >
                          <TypeIcon className="h-3 w-3" />
                          {typeLabels[record.supplierType] || "Supplier"}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={record.name || ""}
                          onChange={(e) => updateField(i, "name", e.target.value)}
                          className="h-7 text-sm"
                          placeholder="Supplier name"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={record.contactName || ""}
                          onChange={(e) => updateField(i, "contactName", e.target.value)}
                          className="h-7 text-sm"
                          placeholder="Contact"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={record.phone || ""}
                          onChange={(e) => updateField(i, "phone", e.target.value)}
                          className="h-7 text-sm"
                          placeholder="Phone"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={record.email || ""}
                          onChange={(e) => updateField(i, "email", e.target.value)}
                          className="h-7 text-sm"
                          placeholder="Email"
                        />
                      </TableCell>
                      <TableCell>
                        <button onClick={() => removeRecord(i)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        {/* Import result */}
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
          <Button variant="outline" onClick={handleClose}>
            {importResult?.created ? "Done" : "Cancel"}
          </Button>
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
