import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Search, Download, Printer, Trash2, Check, X, Barcode as BarcodeIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const barcodeFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  value: z.string().min(1, "Barcode value is required"),
  purpose: z.enum(["item", "bin", "finished_product"]),
  sku: z.string().optional(),
  referenceId: z.string().optional(),
});

function formatTypeLabel(purpose: string): string {
  switch (purpose) {
    case "bin":
      return "Finished Product";
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
    <tr className="border-b hover-elevate" data-testid={`row-barcode-${barcode.id}`}>
      {/* Name Column */}
      <td className="p-3">
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
      <td className="p-3">
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
            className="cursor-pointer rounded px-2 py-1 font-mono text-sm hover-elevate" 
            onClick={() => startEdit("value", barcode.value)}
            data-testid={`text-barcode-value-${barcode.id}`}
          >
            {barcode.value}
          </div>
        )}
      </td>

      {/* Type Column */}
      <td className="p-3">
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
      <td className="p-3">
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
      <td className="p-3">
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
  const { toast } = useToast();

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
    // Open print dialog with barcode
    const printWindow = window.open(`/print/barcode/${barcode.id}`, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
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
              <div>
                <h2 className="text-lg font-semibold">Finished Products</h2>
                <p className="text-sm text-muted-foreground">Barcodes for finished products</p>
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
              <div>
                <h2 className="text-lg font-semibold">Item Inventory</h2>
                <p className="text-sm text-muted-foreground">Barcodes for inventory items and components</p>
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
              <FormLabel>Barcode Value</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., BIN-A1-001"
                  className="font-mono"
                  data-testid="input-barcode-value"
                  {...field}
                />
              </FormControl>
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
