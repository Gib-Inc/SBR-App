import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Search, Download, Upload, Printer, Trash2, Check, X, Barcode as BarcodeIcon, Camera, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CameraCaptureModal } from "@/components/camera-capture-modal";
import { VisionConfirmationDialog } from "@/components/vision-confirmation-dialog";
import { PrintLabelsDialog } from "@/components/print-labels-dialog";
import { ImportWizard } from "@/components/import-wizard";

const barcodeFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  value: z.string().optional(),
  purpose: z.enum(["item", "bin", "finished_product"]),
  sku: z.string().optional(),
  referenceId: z.string().optional(),
});

function formatTypeLabel(purpose: string): string {
  switch (purpose) {
    case "bin":
      return "Bin Location";
    case "finished_product":
      return "Finished Product";
    case "item":
      return "Item Inventory";
    default:
      return purpose;
  }
}

function BarcodeTableRow({ 
  barcode, 
  onPrint, 
  onDelete, 
  onUpdate 
}: { 
  barcode: any; 
  onPrint: (barcode: any) => void; 
  onDelete: (barcode: any) => void;
  onUpdate: (id: string, field: string, value: string) => void;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue || "");
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  const saveEdit = () => {
    if (editingField) {
      onUpdate(barcode.id, editingField, editValue);
      setEditingField(null);
      setEditValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  return (
    <tr className="h-11 border-b hover-elevate" data-testid={`row-barcode-${barcode.id}`}>
      {/* Name Column */}
      <td className="px-3 align-middle whitespace-nowrap">
        {editingField === "name" ? (
          <div className="flex items-center gap-2">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8"
              autoFocus
              data-testid={`input-edit-name-${barcode.id}`}
            />
            <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-name-${barcode.id}`}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-name-${barcode.id}`}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div 
            className="cursor-pointer rounded px-2 py-1 hover-elevate" 
            onClick={() => startEdit("name", barcode.name)}
            data-testid={`text-barcode-name-${barcode.id}`}
          >
            {barcode.name}
          </div>
        )}
      </td>

      {/* Barcode Column */}
      <td className="px-3 align-middle whitespace-nowrap">
        {editingField === "value" ? (
          <div className="flex items-center gap-2">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 font-mono"
              autoFocus
              data-testid={`input-edit-barcode-${barcode.id}`}
            />
            <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-barcode-${barcode.id}`}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-barcode-${barcode.id}`}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div 
            className="cursor-pointer rounded px-2 py-1 hover-elevate" 
            onClick={() => startEdit("value", barcode.value)}
            data-testid={`barcode-image-${barcode.id}`}
          >
            <img 
              src={`/api/barcodes/${barcode.id}/image`} 
              alt={barcode.value}
              className="h-8 w-auto"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.removeAttribute('style');
              }}
            />
            <div className="font-mono text-sm text-center mt-1" style={{ display: 'none' }}>
              {barcode.value}
            </div>
          </div>
        )}
      </td>

      {/* Type Column */}
      <td className="px-3 align-middle whitespace-nowrap">
        {editingField === "purpose" ? (
          <div className="flex items-center gap-2">
            <Select value={editValue} onValueChange={setEditValue}>
              <SelectTrigger className="h-8 w-48" data-testid={`select-edit-type-${barcode.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="finished_product">Finished Product</SelectItem>
                <SelectItem value="item">Item Inventory</SelectItem>
                <SelectItem value="bin">Bin Location</SelectItem>
              </SelectContent>
            </Select>
            <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-type-${barcode.id}`}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-type-${barcode.id}`}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div 
            className="cursor-pointer rounded px-2 py-1 hover-elevate" 
            onClick={() => startEdit("purpose", barcode.purpose)}
            data-testid={`text-barcode-type-${barcode.id}`}
          >
            <Badge variant="secondary">{formatTypeLabel(barcode.purpose)}</Badge>
          </div>
        )}
      </td>

      {/* SKU Column */}
      <td className="px-3 align-middle whitespace-nowrap">
        {editingField === "sku" ? (
          <div className="flex items-center gap-2">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 font-mono"
              autoFocus
              data-testid={`input-edit-sku-${barcode.id}`}
            />
            <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-sku-${barcode.id}`}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-sku-${barcode.id}`}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div 
            className="cursor-pointer rounded px-2 py-1 font-mono text-sm hover-elevate" 
            onClick={() => startEdit("sku", barcode.sku)}
            data-testid={`text-barcode-sku-${barcode.id}`}
          >
            {barcode.sku || <span className="text-muted-foreground">—</span>}
          </div>
        )}
      </td>

      {/* Actions Column */}
      <td className="px-3 align-middle whitespace-nowrap">
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPrint(barcode)}
            data-testid={`button-print-${barcode.id}`}
            className="h-8 w-8"
          >
            <Printer className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            data-testid={`button-download-${barcode.id}`}
            className="h-8 w-8"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(barcode)}
            data-testid={`button-delete-${barcode.id}`}
            className="h-8 w-8"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function ItemTableRow({
  item,
  testIdPrefix,
  onUpdate,
  onDelete,
  onPrint
}: {
  item: any;
  testIdPrefix: string;
  onUpdate: (id: string, field: string, value: string) => void;
  onDelete: (item: any) => void;
  onPrint: (item: any) => void;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue || "");
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  const saveEdit = () => {
    if (editingField) {
      onUpdate(item.id, editingField, editValue);
      setEditingField(null);
      setEditValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  return (
    <tr key={item.id} className="border-b hover-elevate" data-testid={`row-${testIdPrefix}-${item.id}`}>
      <td className="p-3 whitespace-nowrap">
        {item.barcodeValue ? (
          <div className="flex flex-col items-center gap-1">
            <img 
              src={`/api/generate-barcode/${encodeURIComponent(item.barcodeValue)}`} 
              alt={item.barcodeValue}
              className="h-12 w-auto"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No barcode</span>
        )}
      </td>
      <td className="p-3 whitespace-nowrap">
        {editingField === "name" ? (
          <div className="flex items-center gap-2">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8"
              autoFocus
              data-testid={`input-edit-name-${item.id}`}
            />
            <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-name-${item.id}`}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-name-${item.id}`}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div 
            className="cursor-pointer rounded px-2 py-1 text-sm hover-elevate" 
            onClick={() => startEdit("name", item.name)}
            data-testid={`text-item-name-${item.id}`}
          >
            {item.name}
          </div>
        )}
      </td>
      <td className="p-3 whitespace-nowrap">
        {editingField === "sku" ? (
          <div className="flex items-center gap-2">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 font-mono"
              autoFocus
              data-testid={`input-edit-sku-${item.id}`}
            />
            <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-sku-${item.id}`}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-sku-${item.id}`}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div 
            className="cursor-pointer rounded px-2 py-1 text-sm font-mono hover-elevate" 
            onClick={() => startEdit("sku", item.sku)}
            data-testid={`text-item-sku-${item.id}`}
          >
            {item.sku}
          </div>
        )}
      </td>
      <td className="p-3 whitespace-nowrap">
        {editingField === "barcodeValue" ? (
          <div className="flex items-center gap-2">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 font-mono"
              autoFocus
              data-testid={`input-edit-barcode-${item.id}`}
            />
            <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-barcode-${item.id}`}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-barcode-${item.id}`}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div 
            className="cursor-pointer rounded px-2 py-1 text-sm font-mono hover-elevate" 
            onClick={() => startEdit("barcodeValue", item.barcodeValue)}
            data-testid={`text-item-barcode-${item.id}`}
          >
            {item.barcodeValue || "-"}
          </div>
        )}
      </td>
      <td className="p-3 whitespace-nowrap">
        {item.productKind ? (
          <Badge className={`text-xs ${item.productKind === 'FINISHED' ? 'bg-blue-600 text-white' : 'bg-green-600 text-white'}`}>
            {item.productKind}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </td>
      <td className="p-3 whitespace-nowrap">
        {editingField === "barcodeFormat" ? (
          <div className="flex items-center gap-2">
            <Select value={editValue} onValueChange={setEditValue}>
              <SelectTrigger className="h-8 w-[140px]" data-testid={`select-edit-format-${item.id}`}>
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CODE128">CODE128</SelectItem>
                <SelectItem value="EAN13">EAN13</SelectItem>
                <SelectItem value="EAN8">EAN8</SelectItem>
                <SelectItem value="UPC">UPC</SelectItem>
                <SelectItem value="QR">QR Code</SelectItem>
                <SelectItem value="DATA_MATRIX">Data Matrix</SelectItem>
                <SelectItem value="CODE39">CODE39</SelectItem>
              </SelectContent>
            </Select>
            <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-format-${item.id}`}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-format-${item.id}`}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div 
            className="cursor-pointer rounded px-2 py-1" 
            onClick={() => startEdit("barcodeFormat", item.barcodeFormat)}
            data-testid={`text-item-format-${item.id}`}
          >
            <Badge variant="secondary" className="text-xs">
              {item.barcodeFormat || "Not Set"}
            </Badge>
          </div>
        )}
      </td>
      <td className="p-3 whitespace-nowrap">
        {item.barcodeUsage ? (
          <Badge variant="outline" className={`text-xs ${item.barcodeUsage === 'EXTERNAL_GS1' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'}`}>
            {item.barcodeUsage === 'EXTERNAL_GS1' ? 'External (GS1)' : 'Internal'}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </td>
      <td className="p-3 whitespace-nowrap">
        <Badge variant="outline" className="text-xs">
          {item.barcodeSource || "None"}
        </Badge>
      </td>
      <td className="p-3 text-right text-sm whitespace-nowrap">{item.currentStock}</td>
      <td className="sticky right-0 z-10 bg-card p-3 whitespace-nowrap shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">
        <div className="flex gap-1 justify-end">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPrint(item)}
            data-testid={`button-print-${item.id}`}
            className="h-8 w-8"
          >
            <Printer className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(item)}
            data-testid={`button-delete-${item.id}`}
            className="h-8 w-8"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function BarcodeItemsSection({ 
  title, 
  items, 
  searchQuery,
  "data-testid-prefix": testIdPrefix,
  onUpdate,
  onDelete,
  onPrint
}: { 
  title: string; 
  items: any[]; 
  searchQuery: string;
  "data-testid-prefix": string;
  onUpdate: (id: string, field: string, value: string) => void;
  onDelete: (item: any) => void;
  onPrint: (item: any) => void;
}) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 text-lg font-semibold">{title}</h3>
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <BarcodeIcon className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? `No ${title.toLowerCase()} matching your search` : `No ${title.toLowerCase()} yet`}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
        <div className="relative overflow-x-auto rounded-md border">
          <table className="w-full min-w-[900px]">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Barcode</th>
                <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Name</th>
                <th className="p-3 text-left text-sm font-medium whitespace-nowrap">SKU</th>
                <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Barcode Value</th>
                <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Product Kind</th>
                <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Format</th>
                <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Usage</th>
                <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Barcode Source</th>
                <th className="p-3 text-right text-sm font-medium whitespace-nowrap">Stock</th>
                <th className="sticky right-0 z-10 bg-card p-3 text-right text-sm font-medium whitespace-nowrap shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any) => (
                <ItemTableRow
                  key={item.id}
                  item={item}
                  testIdPrefix={testIdPrefix}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  onPrint={onPrint}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Barcodes() {
  const [searchQuery, setSearchQuery] = useState("");
  const [productKindFilter, setProductKindFilter] = useState<string>("all");
  const [barcodeUsageFilter, setBarcodeUsageFilter] = useState<string>("all");
  const [barcodeSourceFilter, setBarcodeSourceFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isPrintLabelsDialogOpen, setIsPrintLabelsDialogOpen] = useState(false);
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isVisionConfirmDialogOpen, setIsVisionConfirmDialogOpen] = useState(false);
  const [visionResult, setVisionResult] = useState<any>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [cameraContext, setCameraContext] = useState<"finished_product" | "item">("finished_product");
  const { toast } = useToast();
  
  // Fetch items with barcode metadata
  const { data: items, isLoading } = useQuery({
    queryKey: ["/api/items"],
  });

  const allItems = (items as any[]) ?? [];
  
  // Apply filters
  let filteredItems = allItems.filter((item: any) => {
    // Search filter
    const matchesSearch = 
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.sku && item.sku.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.barcodeValue && item.barcodeValue.toLowerCase().includes(searchQuery.toLowerCase()));
    
    // Product kind filter
    const matchesProductKind = productKindFilter === "all" || item.productKind === productKindFilter;
    
    // Barcode usage filter
    const matchesBarcodeUsage = barcodeUsageFilter === "all" || item.barcodeUsage === barcodeUsageFilter;
    
    // Barcode source filter
    const matchesBarcodeSource = barcodeSourceFilter === "all" || item.barcodeSource === barcodeSourceFilter;
    
    return matchesSearch && matchesProductKind && matchesBarcodeUsage && matchesBarcodeSource;
  });

  // Apply sorting
  filteredItems = filteredItems.sort((a: any, b: any) => {
    let aValue = a[sortBy] || "";
    let bValue = b[sortBy] || "";
    
    if (sortBy === "name" || sortBy === "sku") {
      aValue = String(aValue).toLowerCase();
      bValue = String(bValue).toLowerCase();
    }
    
    if (aValue < bValue) return sortOrder === "asc" ? -1 : 1;
    if (aValue > bValue) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  // Split filtered items by productKind
  const finishedItems = filteredItems.filter((item: any) => item.productKind === 'FINISHED');
  const rawItems = filteredItems.filter((item: any) => item.productKind === 'RAW');

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const response = await apiRequest("PATCH", `/api/items/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Success",
        description: "Item updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update item",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const response = await apiRequest("DELETE", `/api/items/${itemId}`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Success",
        description: "Item deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete item",
      });
    },
  });


  const handleExport = async () => {
    try {
      const response = await fetch("/api/export/items");
      if (!response.ok) throw new Error("Export failed");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventory-barcodes-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Success",
        description: "Export downloaded successfully",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to export",
      });
    }
  };

  const handleUpdate = (id: string, field: string, value: string) => {
    updateMutation.mutate({
      id,
      updates: { [field]: value },
    });
  };

  const handlePrint = (item: any) => {
    // Check if item has a barcode value
    if (!item.barcodeValue) {
      toast({
        variant: "destructive",
        title: "Cannot Print",
        description: "This item does not have a barcode value assigned.",
      });
      return;
    }

    // Create a print-friendly window with the barcode image
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Print Barcode - ${item.name}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 20px;
            }
            .barcode-container {
              text-align: center;
              border: 2px solid #000;
              padding: 20px;
              margin: 20px;
            }
            img {
              max-width: 100%;
              height: auto;
            }
            h2 {
              margin: 10px 0;
              font-size: 18px;
            }
            .sku {
              font-family: monospace;
              color: #666;
              margin-top: 5px;
            }
            @media print {
              body {
                display: block;
              }
              .no-print {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          <div class="barcode-container">
            <img src="/api/generate-barcode/${encodeURIComponent(item.barcodeValue)}" alt="${item.barcodeValue}" />
            <h2>${item.name}</h2>
            ${item.sku ? `<div class="sku">${item.sku}</div>` : ''}
          </div>
          <script>
            window.onload = () => {
              setTimeout(() => window.print(), 500);
            };
          </script>
        </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  const handleDelete = (barcode: any) => {
    if (confirm(`Are you sure you want to delete barcode "${barcode.name}"?`)) {
      deleteMutation.mutate(barcode.id);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Product Barcodes</h1>
          <p className="text-sm text-muted-foreground">View items with barcode metadata and GS1 configuration</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button 
            variant="outline" 
            onClick={() => setIsImportWizardOpen(true)}
            data-testid="button-import-items"
          >
            <Download className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Button 
            variant="outline" 
            onClick={handleExport}
            data-testid="button-export-barcodes"
          >
            <Upload className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button 
            variant="outline" 
            onClick={() => setIsPrintLabelsDialogOpen(true)}
            data-testid="button-print-labels"
          >
            <Printer className="mr-2 h-4 w-4" />
            Print Labels
          </Button>
          
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-barcode">
                <Plus className="mr-2 h-4 w-4" />
                Create Barcode
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Barcode</DialogTitle>
              </DialogHeader>
              <BarcodeForm onClose={() => setIsCreateDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, SKU, or barcode value..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-barcodes"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">Product Kind:</Label>
            <Select value={productKindFilter} onValueChange={setProductKindFilter}>
              <SelectTrigger className="w-40" data-testid="select-filter-product-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="FINISHED">Finished</SelectItem>
                <SelectItem value="RAW">Raw</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">Usage:</Label>
            <Select value={barcodeUsageFilter} onValueChange={setBarcodeUsageFilter}>
              <SelectTrigger className="w-48" data-testid="select-filter-barcode-usage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="EXTERNAL_GS1">External GS1</SelectItem>
                <SelectItem value="INTERNAL_STOCK">Internal Stock</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">Source:</Label>
            <Select value={barcodeSourceFilter} onValueChange={setBarcodeSourceFilter}>
              <SelectTrigger className="w-48" data-testid="select-filter-barcode-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="AUTO_GENERATED">Auto Generated</SelectItem>
                <SelectItem value="MANUAL_ENTRY">Manual Entry</SelectItem>
                <SelectItem value="EXTERNAL_SYSTEM">External System</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">Sort by:</Label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-32" data-testid="select-sort-by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="sku">SKU</SelectItem>
                <SelectItem value="barcodeValue">Barcode</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
              data-testid="button-toggle-sort-order"
            >
              {sortOrder === "asc" ? "↑" : "↓"}
            </Button>
          </div>

          {(searchQuery || productKindFilter !== "all" || barcodeUsageFilter !== "all" || barcodeSourceFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setProductKindFilter("all");
                setBarcodeUsageFilter("all");
                setBarcodeSourceFilter("all");
              }}
              data-testid="button-clear-filters"
            >
              <X className="mr-2 h-4 w-4" />
              Clear Filters
            </Button>
          )}
        </div>
      </div>

      {/* Items with Barcode Metadata */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        </div>
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="flex h-64 flex-col items-center justify-center gap-2">
            <BarcodeIcon className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? "No items found" : "No items yet. Add items from the Products page to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Finished Products Section */}
          <BarcodeItemsSection 
            title="Finished Products"
            items={finishedItems}
            searchQuery={searchQuery}
            data-testid-prefix="finished"
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onPrint={handlePrint}
          />

          {/* Stock Inventory Section */}
          <BarcodeItemsSection 
            title="Stock Inventory"
            items={rawItems}
            searchQuery={searchQuery}
            data-testid-prefix="stock"
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onPrint={handlePrint}
          />
        </div>
      )}

        {/* Camera and Vision Dialogs */}
        <CameraCaptureModal
          isOpen={isCameraModalOpen}
          onClose={() => setIsCameraModalOpen(false)}
          onImageCaptured={async (imageDataUrl) => {
            setIsAnalyzingImage(true);
            toast({
              title: "Analyzing image...",
              description: "AI is identifying the item from your image.",
            });
            
            try {
              const res = await apiRequest("POST", "/api/vision/identify", { imageDataUrl });
              if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || "Failed to analyze image");
              }
              
              const result = await res.json();
              setVisionResult(result);
              setIsVisionConfirmDialogOpen(true);
              
              toast({
                title: "Item Identified",
                description: `AI identified: ${result.name}`,
              });
            } catch (error: any) {
              toast({
                variant: "destructive",
                title: "Analysis Failed",
                description: error.message || "Failed to identify item from image",
              });
            } finally {
              setIsAnalyzingImage(false);
            }
          }}
        />
        <VisionConfirmationDialog
          isOpen={isVisionConfirmDialogOpen}
          onClose={() => {
            setIsVisionConfirmDialogOpen(false);
            setVisionResult(null);
          }}
          visionResult={visionResult}
          defaultType={cameraContext === "finished_product" ? "finished_product" : "component"}
          onConfirm={async (action, data) => {
            const allItems = (items as any[]) ?? [];
            
            if (action === "create") {
              // Create new item and barcode
              try {
                // First, create the item
                const payload: any = {
                  name: data.name,
                  sku: data.sku || "",
                  type: data.type,
                };
                
                if (data.type === "finished_product") {
                  // Finished products use pivotQty (ready-to-ship) by default
                  payload.pivotQty = data.quantity || 0;
                  payload.hildaleQty = 0;
                  payload.category = null;
                } else {
                  // Components use currentStock
                  payload.currentStock = data.quantity || 0;
                  payload.category = data.category || null;
                  payload.location = data.location || null;
                  payload.pivotQty = 0;
                  payload.hildaleQty = 0;
                }
                
                const itemRes = await apiRequest("POST", "/api/items", payload);
                
                if (!itemRes.ok) {
                  const error = await itemRes.json();
                  throw new Error(error.error || "Failed to create item");
                }
                
                const newItem = await itemRes.json();
                
                // Then, create the barcode
                const barcodePurpose = data.type === "finished_product" ? "finished_product" : "item";
                const barcodeValue = `${data.type === "finished_product" ? "PROD" : "COMP"}-${data.sku || newItem.id}`;
                
                const barcodeRes = await apiRequest("POST", "/api/barcodes", {
                  name: data.name,
                  value: barcodeValue,
                  purpose: barcodePurpose,
                  sku: data.sku || "",
                  referenceId: newItem.id,
                });
                
                if (!barcodeRes.ok) {
                  const error = await barcodeRes.json();
                  throw new Error(error.error || "Failed to create barcode");
                }
                
                await queryClient.invalidateQueries({ queryKey: ["/api/items"] });
                await queryClient.invalidateQueries({ queryKey: ["/api/barcodes"] });
                
                toast({
                  title: "Success",
                  description: `Created new ${data.type === "finished_product" ? "product" : "component"} with barcode: ${data.name}`,
                });
                
                setIsVisionConfirmDialogOpen(false);
                setVisionResult(null);
              } catch (error: any) {
                toast({
                  variant: "destructive",
                  title: "Error",
                  description: error.message || "Failed to create item and barcode",
                });
              }
            } else {
              // Adjust existing stock using transaction system
              const existingItem = allItems.find((item: any) => 
                item.name.toLowerCase() === data.name?.toLowerCase() || 
                (data.sku && item.sku?.toLowerCase() === data.sku.toLowerCase())
              );
              
              if (!existingItem) {
                toast({
                  variant: "destructive",
                  title: "Item Not Found",
                  description: "Could not find existing item. Please create it instead.",
                });
                return;
              }
              
              try {
                const adjustmentQty = data.adjustmentQuantity || 0;
                
                // Use transaction system for all stock adjustments
                let location = 'N/A';
                let itemType = 'component';
                
                if (existingItem.type === 'finished_product') {
                  // For finished products, adjust Pivot location
                  location = 'PIVOT';
                  itemType = 'finished_product';
                }
                
                const res = await apiRequest("POST", "/api/transactions", {
                  itemId: existingItem.id,
                  itemType,
                  type: "ADJUST",
                  location,
                  quantity: adjustmentQty,
                  notes: `Barcode scan adjustment`,
                });
                
                if (!res.ok) {
                  const error = await res.json();
                  throw new Error(error.error || "Failed to adjust stock");
                }
                
                await queryClient.invalidateQueries({ queryKey: ["/api/items"] });
                
                const locationText = itemType === 'finished_product' ? ` at ${location}` : '';
                toast({
                  title: "Success",
                  description: `Adjusted stock for ${existingItem.name}${locationText}: ${adjustmentQty > 0 ? '+' : ''}${adjustmentQty}`,
                });
                
                setIsVisionConfirmDialogOpen(false);
                setVisionResult(null);
              } catch (error: any) {
                toast({
                  variant: "destructive",
                  title: "Error",
                  description: error.message || "Failed to adjust stock",
                });
              }
            }
          }}
        />

        {/* Print Labels Dialog */}
        <PrintLabelsDialog
          isOpen={isPrintLabelsDialogOpen}
          onClose={() => setIsPrintLabelsDialogOpen(false)}
        />

        {/* Import Wizard */}
        <ImportWizard
          open={isImportWizardOpen}
          onOpenChange={setIsImportWizardOpen}
        />
    </div>
  );
}

function BarcodeForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [productKind, setProductKind] = useState<"FINISHED" | "RAW">("RAW");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcodeValue, setBarcodeValue] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const autoGenerateMutation = useMutation({
    mutationFn: async () => {
      const endpoint = productKind === "FINISHED" 
        ? "/api/barcodes/generate-gs1" 
        : "/api/barcodes/generate-internal";
      const res = await apiRequest("POST", endpoint, {});
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to generate barcode");
      }
      return await res.json();
    },
    onSuccess: (data) => {
      setBarcodeValue(data.barcodeValue);
      toast({
        title: "Barcode Generated",
        description: `Generated: ${data.barcodeValue}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createItemMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/items", {
        name,
        sku: sku || `${productKind}-${Date.now()}`,
        type: productKind === "FINISHED" ? "finished_product" : "component",
        productKind,
        barcodeValue,
        barcodeFormat: "CODE128",
        barcodeUsage: productKind === "FINISHED" ? "EXTERNAL_GS1" : "INTERNAL_STOCK",
        barcodeSource: barcodeValue ? "MANUAL" : "AUTO_GENERATED",
        currentStock: 0,
        minStock: 0,
        dailyUsage: 0,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to create item");
      }
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/barcodes"] });
      toast({
        title: "Success",
        description: "Item with barcode created successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAutoGenerate = () => {
    autoGenerateMutation.mutate();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !sku) {
      toast({
        title: "Validation Error",
        description: "Name and SKU are required",
        variant: "destructive",
      });
      return;
    }
    createItemMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="product-kind">Product Type</Label>
        <Select value={productKind} onValueChange={(v: any) => setProductKind(v)}>
          <SelectTrigger id="product-kind" data-testid="select-product-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FINISHED">Finished Product (GS1/GTIN-12)</SelectItem>
            <SelectItem value="RAW">Raw Inventory (Internal Code)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {productKind === "FINISHED" 
            ? "External GS1 barcode for finished products" 
            : "Internal stock code for raw materials"}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Sticker Bur Roller"
          data-testid="input-item-name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sku">SKU *</Label>
        <Input
          id="sku"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder="e.g., SBR-001"
          data-testid="input-item-sku"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="barcode-value">Barcode Value</Label>
        <div className="flex gap-2">
          <Input
            id="barcode-value"
            value={barcodeValue}
            onChange={(e) => setBarcodeValue(e.target.value)}
            placeholder={productKind === "FINISHED" ? "Leave blank or auto-generate GS1" : "Leave blank or auto-generate RAW code"}
            className="font-mono"
            data-testid="input-barcode-value"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={handleAutoGenerate}
            disabled={autoGenerateMutation.isPending}
            data-testid="button-auto-generate"
          >
            {autoGenerateMutation.isPending ? "Generating..." : "Auto-Generate"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {productKind === "FINISHED" 
            ? "12-digit GTIN with check digit (requires GS1 prefix configured)" 
            : "Format: RAW-000001, RAW-000002, etc."}
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          data-testid="button-cancel"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={createItemMutation.isPending}
          data-testid="button-save-item"
        >
          {createItemMutation.isPending ? "Creating..." : "Create Item"}
        </Button>
      </div>
    </form>
  );
}
