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
import { Plus, Search, Download, Printer, Trash2, Check, X, Barcode as BarcodeIcon, Camera } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CameraCaptureModal } from "@/components/camera-capture-modal";
import { VisionConfirmationDialog } from "@/components/vision-confirmation-dialog";

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
      <td className="px-3 align-middle">
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
      <td className="px-3 align-middle">
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
      <td className="px-3 align-middle">
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
      <td className="px-3 align-middle">
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
      <td className="px-3 align-middle">
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

export default function Barcodes() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isScanDialogOpen, setIsScanDialogOpen] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isVisionConfirmDialogOpen, setIsVisionConfirmDialogOpen] = useState(false);
  const [visionResult, setVisionResult] = useState<any>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [cameraContext, setCameraContext] = useState<"finished_product" | "item">("finished_product");
  const { toast } = useToast();
  
  // Fetch items for matching
  const { data: items } = useQuery({
    queryKey: ["/api/items"],
  });

  // Fetch barcodes
  const { data: barcodes, isLoading } = useQuery({
    queryKey: ["/api/barcodes"],
  });

  const filteredBarcodes = ((barcodes as any[]) ?? []).filter((barcode: any) =>
    barcode.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (barcode.sku && barcode.sku.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const finishedProductBarcodes = filteredBarcodes.filter((b: any) => b.purpose === "finished_product" || b.purpose === "bin");
  const itemInventoryBarcodes = filteredBarcodes.filter((b: any) => b.purpose === "item");

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const response = await apiRequest("PATCH", `/api/barcodes/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/barcodes"] });
      toast({
        title: "Success",
        description: "Barcode updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update barcode",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (barcodeId: string) => {
      const response = await apiRequest("DELETE", `/api/barcodes/${barcodeId}`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/barcodes"] });
      toast({
        title: "Success",
        description: "Barcode deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete barcode",
      });
    },
  });

  const handleUpdate = (id: string, field: string, value: string) => {
    updateMutation.mutate({
      id,
      updates: { [field]: value },
    });
  };

  const handlePrint = (barcode: any) => {
    // Create a print-friendly window with the barcode image
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Print Barcode - ${barcode.name}</title>
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
            <img src="/api/barcodes/${barcode.id}/image" alt="${barcode.value}" />
            <h2>${barcode.name}</h2>
            ${barcode.sku ? `<div class="sku">${barcode.sku}</div>` : ''}
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Barcodes</h1>
          <p className="text-sm text-muted-foreground">Manage barcodes for items and bins</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isScanDialogOpen} onOpenChange={setIsScanDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-scan-inventory">
                <BarcodeIcon className="mr-2 h-4 w-4" />
                Scan Inventory
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Scan Barcode</DialogTitle>
              </DialogHeader>
              <ScanDialog onClose={() => setIsScanDialogOpen(false)} />
            </DialogContent>
          </Dialog>
          
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

      {/* Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search barcodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-barcodes"
          />
        </div>
      </div>

      {/* Barcodes Sections */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        </div>
      ) : filteredBarcodes.length === 0 ? (
        <Card>
          <CardContent className="flex h-64 flex-col items-center justify-center gap-2">
            <BarcodeIcon className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? "No barcodes found" : "No barcodes yet. Create your first barcode to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {/* Finished Products Section */}
          {finishedProductBarcodes.length > 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Finished Products</h2>
                  <p className="text-sm text-muted-foreground">Barcodes for finished products</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCameraContext("finished_product");
                    setIsCameraModalOpen(true);
                  }}
                  data-testid="button-scan-finished-product-barcode"
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Scan Item
                </Button>
              </div>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr className="border-b">
                      <th className="p-3 text-left text-sm font-medium">Name</th>
                      <th className="p-3 text-left text-sm font-medium">Barcode</th>
                      <th className="p-3 text-left text-sm font-medium">Type</th>
                      <th className="p-3 text-left text-sm font-medium">SKU</th>
                      <th className="p-3 text-left text-sm font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finishedProductBarcodes.map((barcode: any) => (
                      <BarcodeTableRow 
                        key={barcode.id} 
                        barcode={barcode} 
                        onPrint={handlePrint} 
                        onDelete={handleDelete}
                        onUpdate={handleUpdate}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Item Inventory Section */}
          {itemInventoryBarcodes.length > 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Item Inventory</h2>
                  <p className="text-sm text-muted-foreground">Barcodes for inventory items and components</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCameraContext("item");
                    setIsCameraModalOpen(true);
                  }}
                  data-testid="button-scan-item-inventory-barcode"
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Scan Item
                </Button>
              </div>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr className="border-b">
                      <th className="p-3 text-left text-sm font-medium">Name</th>
                      <th className="p-3 text-left text-sm font-medium">Barcode</th>
                      <th className="p-3 text-left text-sm font-medium">Type</th>
                      <th className="p-3 text-left text-sm font-medium">SKU</th>
                      <th className="p-3 text-left text-sm font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemInventoryBarcodes.map((barcode: any) => (
                      <BarcodeTableRow 
                        key={barcode.id} 
                        barcode={barcode} 
                        onPrint={handlePrint} 
                        onDelete={handleDelete}
                        onUpdate={handleUpdate}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Print Layout Info */}
      <Card className="bg-muted/50">
        <CardContent className="flex items-center gap-3 pt-6">
          <BarcodeIcon className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Print on plain paper</p>
            <p className="text-xs text-muted-foreground">
              Barcodes are optimized for standard A4/Letter paper printing
            </p>
          </div>
        </CardContent>
      </Card>

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
              const itemRes = await apiRequest("POST", "/api/items", {
                name: data.name,
                sku: data.sku || "",
                currentStock: data.quantity || 0,
                type: data.type,
                category: data.category || null,
                location: data.location || null,
              });
              
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
            // Adjust existing stock
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
              const newStock = existingItem.currentStock + (data.adjustmentQuantity || 0);
              
              const res = await apiRequest("PATCH", `/api/items/${existingItem.id}`, {
                currentStock: Math.max(0, newStock),
              });
              
              if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || "Failed to adjust stock");
              }
              
              await queryClient.invalidateQueries({ queryKey: ["/api/items"] });
              
              toast({
                title: "Success",
                description: `Adjusted stock for ${existingItem.name}: ${existingItem.currentStock} → ${newStock}`,
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
    </div>
  );
}

function BarcodeForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data: items } = useQuery({
    queryKey: ["/api/items"],
  });

  const { data: bins } = useQuery({
    queryKey: ["/api/bins"],
  });

  const { data: barcodes } = useQuery({
    queryKey: ["/api/barcodes"],
  });

  const form = useForm<z.infer<typeof barcodeFormSchema>>({
    resolver: zodResolver(barcodeFormSchema),
    defaultValues: {
      name: "",
      value: "",
      purpose: "bin",
      sku: "",
      referenceId: undefined,
    },
  });

  const purpose = useWatch({ control: form.control, name: "purpose" });

  // Generate preview of auto-generated barcode value
  const getPlaceholder = () => {
    if (!barcodes) return "e.g., BIN-001";
    const samePurposeBarcodes = (barcodes as any[]).filter(b => b.purpose === purpose);
    const counter = samePurposeBarcodes.length + 1;
    const paddedCounter = counter.toString().padStart(3, '0');
    
    switch (purpose) {
      case 'bin':
        return `Will auto-generate: BIN-${paddedCounter}`;
      case 'item':
        return `Will auto-generate: ITEM-${paddedCounter}`;
      case 'finished_product':
        return `Will auto-generate: PROD-${paddedCounter}`;
      default:
        return "e.g., BAR-001";
    }
  };

  const createBarcodeMutation = useMutation({
    mutationFn: async (data: z.infer<typeof barcodeFormSchema>) => {
      const res = await apiRequest("POST", "/api/barcodes", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/barcodes"] });
      toast({
        title: "Success",
        description: "Barcode created successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create barcode",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof barcodeFormSchema>) => {
    createBarcodeMutation.mutate(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., Bin A-1 Barcode"
                  data-testid="input-barcode-name"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="value"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Barcode Value (Optional)</FormLabel>
              <FormControl>
                <Input
                  placeholder={getPlaceholder()}
                  className="font-mono"
                  data-testid="input-barcode-value"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Leave blank to auto-generate or customize as needed
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="purpose"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-barcode-type">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="bin">Bin Location</SelectItem>
                  <SelectItem value="finished_product">Finished Product</SelectItem>
                  <SelectItem value="item">Item Inventory</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="sku"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SKU (Optional)</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., BIN-A1"
                  className="font-mono"
                  data-testid="input-barcode-sku"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
            disabled={createBarcodeMutation.isPending}
            data-testid="button-save-barcode"
          >
            {createBarcodeMutation.isPending ? "Creating..." : "Create Barcode"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function ScanDialog({ onClose }: { onClose: () => void }) {
  const [barcodeValue, setBarcodeValue] = useState("");
  const [scanResult, setScanResult] = useState<any>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const scanMutation = useMutation({
    mutationFn: async (data: { barcodeValue: string; autoConfirm: boolean }) => {
      const res = await apiRequest("POST", "/api/inventory/scan", data);
      return await res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/items"] });
        toast({
          title: "Success",
          description: data.message,
        });
        
        if (bulkMode) {
          // In bulk mode, just clear the input and keep scanning
          setBarcodeValue("");
          setScanResult(null);
        } else {
          // In regular mode, show the result
          setScanResult(data);
          setBarcodeValue("");
        }
      } else if (data.requiresItemSelection) {
        // Bin scanned, need item selection
        setScanResult(data);
        toast({
          title: "Info",
          description: data.message,
          variant: "default",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to scan barcode",
        variant: "destructive",
      });
      setBarcodeValue("");
    },
  });

  const handleScan = () => {
    if (!barcodeValue.trim()) return;
    scanMutation.mutate({ barcodeValue: barcodeValue.trim(), autoConfirm: bulkMode });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScan();
    }
  };

  const handleConfirmScan = () => {
    setScanResult(null);
    setBarcodeValue("");
  };

  const handleCancelScan = () => {
    setScanResult(null);
    setBarcodeValue("");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="bulk-mode"
            checked={bulkMode}
            onChange={(e) => setBulkMode(e.target.checked)}
            className="h-4 w-4"
          />
          <Label htmlFor="bulk-mode" className="text-sm">
            Bulk Mode (No Prompts)
          </Label>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={barcodeValue}
          onChange={(e) => setBarcodeValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Scan or enter barcode..."
          className="font-mono"
          autoFocus
          data-testid="input-scan-barcode"
        />
        <Button
          onClick={handleScan}
          disabled={!barcodeValue.trim() || scanMutation.isPending}
          data-testid="button-submit-scan"
        >
          {scanMutation.isPending ? "Scanning..." : "Scan"}
        </Button>
      </div>

      {scanResult && !bulkMode && scanResult.success && (
        <Card className="border-green-500">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Check className="h-5 w-5 text-green-500" />
                <span className="font-medium">{scanResult.message}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                <p><strong>Item:</strong> {scanResult.item?.name}</p>
                <p><strong>New Stock:</strong> {scanResult.item?.currentStock}</p>
                <p><strong>Quantity Added:</strong> +{scanResult.quantityAdded}</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleCancelScan} data-testid="button-close-result">
                  Close
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {scanResult && scanResult.requiresItemSelection && (
        <Card className="border-yellow-500">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <BarcodeIcon className="h-5 w-5 text-yellow-500" />
                <span className="font-medium">{scanResult.message}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Bin scanning requires item selection. Please link this barcode to a specific item in the barcode management interface.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleCancelScan} data-testid="button-cancel-bin-scan">
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="text-xs text-muted-foreground">
        <p><strong>Bulk Mode:</strong> Automatically updates inventory without confirmation prompts for faster processing.</p>
        <p><strong>Regular Mode:</strong> Shows a confirmation after each scan with details about the update.</p>
      </div>
    </div>
  );
}
