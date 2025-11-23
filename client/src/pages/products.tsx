import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Check, X, Trash2, Package, Edit, Upload, ArrowLeftRight, History, Boxes } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ImportProductsDialog } from "@/components/import-products-dialog";
import { TransferDialog } from "@/components/transfer-dialog";
import { ProductionDialog } from "@/components/production-dialog";
import { TransactionHistoryDialog } from "@/components/transaction-history-dialog";

const WAREHOUSE_LOCATIONS = [
  "Spanish Fork",
  "Hildale",
];

function ItemTableRow({ 
  item, 
  onDelete, 
  onUpdate,
  onEditBOM
}: { 
  item: any; 
  onDelete: (item: any) => void;
  onUpdate: (id: string, field: string, value: string | number, onSuccess: () => void, onError: () => void) => void;
  onEditBOM?: (item: any) => void;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (field: string, currentValue: string | number) => {
    setEditingField(field);
    setEditValue(String(currentValue || ""));
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  const saveEdit = () => {
    if (!editingField) return;

    // Validate input
    if (editingField === "currentStock") {
      const numValue = Number(editValue);
      if (isNaN(numValue) || numValue < 0) {
        return; // Keep edit mode open for invalid input
      }
      onUpdate(
        item.id, 
        editingField, 
        numValue,
        () => {
          // Success: exit edit mode
          setEditingField(null);
          setEditValue("");
        },
        () => {
          // Error: keep edit mode open (error toast handled by parent)
        }
      );
    } else if (editingField === "location") {
      // Location field allows empty values (to clear location)
      // Empty string will be normalized to null by storage layer
      const trimmedValue = editValue.trim();
      onUpdate(
        item.id, 
        editingField, 
        trimmedValue,
        () => {
          // Success: exit edit mode
          setEditingField(null);
          setEditValue("");
        },
        () => {
          // Error: keep edit mode open (error toast handled by parent)
        }
      );
    } else {
      const trimmedValue = editValue.trim();
      if (!trimmedValue) {
        return; // Keep edit mode open for empty input
      }
      onUpdate(
        item.id, 
        editingField, 
        trimmedValue,
        () => {
          // Success: exit edit mode
          setEditingField(null);
          setEditValue("");
        },
        () => {
          // Error: keep edit mode open (error toast handled by parent)
        }
      );
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
    <tr className="h-11 border-b hover-elevate" data-testid={`row-item-${item.id}`}>
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
            className="cursor-pointer rounded px-2 py-1 hover-elevate" 
            onClick={() => startEdit("name", item.name)}
            data-testid={`text-item-name-${item.id}`}
          >
            {item.name}
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
            className="cursor-pointer rounded px-2 py-1 font-mono text-sm hover-elevate" 
            onClick={() => startEdit("sku", item.sku)}
            data-testid={`text-item-sku-${item.id}`}
          >
            {item.sku || <span className="text-muted-foreground">—</span>}
          </div>
        )}
      </td>

      {/* Current Stock Column (only for components) */}
      {item.type === "component" && (
        <td className="px-3 align-middle">
          {editingField === "currentStock" ? (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 w-24"
                autoFocus
                data-testid={`input-edit-stock-${item.id}`}
              />
              <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-stock-${item.id}`}>
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-stock-${item.id}`}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div 
              className="cursor-pointer rounded px-2 py-1 hover-elevate text-right" 
              onClick={() => startEdit("currentStock", item.currentStock)}
              data-testid={`text-item-stock-${item.id}`}
            >
              {item.currentStock ?? 0}
            </div>
          )}
        </td>
      )}

      {/* Forecast Column (only for finished products) */}
      {item.type === "finished_product" && (
        <td className="px-3 align-middle">
          <div 
            className="px-2 py-1 text-right font-medium text-primary" 
            data-testid={`text-item-forecast-${item.id}`}
          >
            {item.forecastQty ?? 0}
          </div>
        </td>
      )}

      {/* Hildale Qty Column (only for finished products) */}
      {item.type === "finished_product" && (
        <td className="px-3 align-middle">
          {editingField === "hildaleQty" ? (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 w-24"
                autoFocus
                data-testid={`input-edit-hildale-qty-${item.id}`}
              />
              <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-hildale-qty-${item.id}`}>
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-hildale-qty-${item.id}`}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div 
              className="cursor-pointer rounded px-2 py-1 hover-elevate text-right" 
              onClick={() => startEdit("hildaleQty", item.hildaleQty ?? 0)}
              data-testid={`text-item-hildale-qty-${item.id}`}
            >
              {item.hildaleQty ?? 0}
            </div>
          )}
        </td>
      )}

      {/* Pivot Qty Column (only for finished products) */}
      {item.type === "finished_product" && (
        <td className="px-3 align-middle">
          {editingField === "pivotQty" ? (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 w-24"
                autoFocus
                data-testid={`input-edit-pivot-qty-${item.id}`}
              />
              <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-pivot-qty-${item.id}`}>
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-pivot-qty-${item.id}`}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div 
              className="cursor-pointer rounded px-2 py-1 hover-elevate text-right" 
              onClick={() => startEdit("pivotQty", item.pivotQty ?? 0)}
              data-testid={`text-item-pivot-qty-${item.id}`}
            >
              {item.pivotQty ?? 0}
            </div>
          )}
        </td>
      )}

      {/* BOM Components Column (only for finished products) */}
      {item.type === "finished_product" && (
        <td className="px-3 align-middle text-center">
          {onEditBOM && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEditBOM(item)}
              data-testid={`button-edit-bom-${item.id}`}
            >
              <Edit className="h-3 w-3 mr-1" />
              {item.componentsCount || 0} components
            </Button>
          )}
        </td>
      )}

      {/* Category Column (only for stock inventory) */}
      {item.type === "component" && (
        <td className="px-3 align-middle">
          {editingField === "category" ? (
            <div className="flex items-center gap-2">
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8"
                autoFocus
                data-testid={`input-edit-category-${item.id}`}
              />
              <Button size="icon" variant="ghost" onClick={saveEdit} className="h-8 w-8" data-testid={`button-save-category-${item.id}`}>
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-8 w-8" data-testid={`button-cancel-category-${item.id}`}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div 
              className="cursor-pointer rounded px-2 py-1 hover-elevate" 
              onClick={() => startEdit("category", item.category || "")}
              data-testid={`text-item-category-${item.id}`}
            >
              {item.category || <span className="text-muted-foreground">—</span>}
            </div>
          )}
        </td>
      )}

      {/* Actions Column */}
      <td className="px-3 align-middle">
        <div className="flex gap-1 justify-end">
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

function BOMDialog({ 
  item, 
  isOpen, 
  onClose,
  allItems
}: { 
  item: any; 
  isOpen: boolean; 
  onClose: () => void;
  allItems: any[];
}) {
  const { toast } = useToast();
  const [bomComponents, setBomComponents] = useState<Array<{ componentId: string; quantity: number }>>(
    item?.bom ?? []
  );
  const [hasChanges, setHasChanges] = useState(false);

  const { data: bomData, isLoading } = useQuery({
    queryKey: ["/api/bom", item?.id],
    enabled: !!item?.id && isOpen,
  });

  // Sync bomData from query into local state ONLY when dialog first opens
  useEffect(() => {
    if (isOpen && !isLoading) {
      if (bomData && Array.isArray(bomData)) {
        // Transform backend format to form format
        // Backend returns: { id, finishedProductId, componentId, quantityRequired }
        // Form expects: { componentId, quantity }
        const transformed = bomData.map((bom: any) => ({
          componentId: bom.componentId,
          quantity: bom.quantityRequired
        }));
        setBomComponents(transformed);
      } else {
        setBomComponents([]);
      }
      setHasChanges(false);
    }
  }, [isOpen, item?.id, bomData, isLoading]);

  const updateBOMMutation = useMutation({
    mutationFn: async (components: Array<{ componentId: string; quantity: number }>) => {
      const response = await apiRequest("POST", `/api/bom/${item.id}`, { components });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to update BOM" }));
        throw new Error(errorData.error || "Failed to update BOM");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bom", item.id] });
      setHasChanges(false);
      toast({
        title: "Success",
        description: "BOM updated successfully",
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update BOM",
      });
    },
  });

  const addComponent = () => {
    setBomComponents([...bomComponents, { componentId: "", quantity: 1 }]);
    setHasChanges(true);
  };

  const removeComponent = (index: number) => {
    setBomComponents(bomComponents.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const updateComponent = (index: number, field: string, value: any) => {
    const updated = [...bomComponents];
    updated[index] = { ...updated[index], [field]: value };
    setBomComponents(updated);
    setHasChanges(true);
  };

  const handleSave = () => {
    const validComponents = bomComponents.filter(c => c.componentId && c.quantity > 0);
    
    // Validate that we have at least some valid components or user is clearing the BOM
    if (bomComponents.length > 0 && validComponents.length === 0) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Please select a component and enter a quantity greater than 0, or remove empty rows.",
      });
      return;
    }
    
    updateBOMMutation.mutate(validComponents);
  };

  const handleClose = (open: boolean) => {
    if (!open && hasChanges) {
      if (confirm("You have unsaved changes. Are you sure you want to close?")) {
        setHasChanges(false);
        onClose();
      }
    } else if (!open) {
      onClose();
    }
  };

  const componentItems = allItems.filter((i: any) => i.type === "component");

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Bill of Materials - {item?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Define component requirements for this product</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addComponent}
              data-testid="button-add-bom-component"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Component
            </Button>
          </div>

          {bomComponents.length === 0 ? (
            <Card>
              <CardContent className="flex h-32 items-center justify-center">
                <p className="text-sm text-muted-foreground">No components added yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {bomComponents.map((component, index) => {
                const isInvalid = !component.componentId || component.quantity <= 0;
                return (
                  <div key={index} className="flex items-end gap-3">
                    <div className="flex-1 space-y-2">
                      <Label>Component</Label>
                      <Select
                        value={component.componentId}
                        onValueChange={(value) => updateComponent(index, "componentId", value)}
                      >
                        <SelectTrigger 
                          data-testid={`select-bom-component-${index}`}
                          className={!component.componentId ? "border-destructive" : ""}
                        >
                          <SelectValue placeholder="Select component" />
                        </SelectTrigger>
                        <SelectContent>
                          {componentItems.map((i: any) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.name} ({i.sku})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-32 space-y-2">
                      <Label>Quantity</Label>
                      <Input
                        type="number"
                        min="1"
                        value={component.quantity || ""}
                        onChange={(e) => {
                          const parsed = parseInt(e.target.value);
                          updateComponent(index, "quantity", isNaN(parsed) ? 0 : parsed);
                        }}
                        className={component.quantity <= 0 ? "border-destructive" : ""}
                        data-testid={`input-bom-quantity-${index}`}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeComponent(index)}
                      data-testid={`button-remove-bom-component-${index}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => handleClose(false)} data-testid="button-cancel-bom">
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={updateBOMMutation.isPending}
              data-testid="button-save-bom"
            >
              {updateBOMMutation.isPending ? "Saving..." : "Save BOM"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateItemDialog({ isOpen, onClose, isFinished }: { isOpen: boolean; onClose: () => void; isFinished: boolean }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [currentStock, setCurrentStock] = useState("0");
  const [category, setCategory] = useState("");
  const [hildaleQty, setHildaleQty] = useState("0");
  const [pivotQty, setPivotQty] = useState("0");

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/items", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Success",
        description: `${isFinished ? "Finished product" : "Stock item"} created successfully`,
      });
      onClose();
      setName("");
      setSku("");
      setCurrentStock("0");
      setCategory("");
      setHildaleQty("0");
      setPivotQty("0");
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create item",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const hildaleQtyNum = Number(hildaleQty) || 0;
    const pivotQtyNum = Number(pivotQty) || 0;
    
    const payload: any = {
      name,
      sku,
      type: isFinished ? "finished_product" : "component",
    };
    
    if (isFinished) {
      // Finished products: ONLY pivotQty and hildaleQty
      payload.hildaleQty = hildaleQtyNum;
      payload.pivotQty = pivotQtyNum;
      payload.category = null;
    } else {
      // Components: currentStock and category
      payload.currentStock = Number(currentStock);
      payload.category = category;
      payload.hildaleQty = 0;
      payload.pivotQty = 0;
    }
    
    createMutation.mutate(payload);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create {isFinished ? "Finished Product" : "Stock Item"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isFinished ? "e.g., Sticker Bur Roller" : "e.g., Spring 2.5in"}
              required
              data-testid="input-create-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sku">SKU</Label>
            <Input
              id="sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="e.g., SBR-001"
              className="font-mono"
              required
              data-testid="input-create-sku"
            />
          </div>
          {!isFinished && (
            <div className="space-y-2">
              <Label htmlFor="stock">Current Stock</Label>
              <Input
                id="stock"
                type="number"
                value={currentStock}
                onChange={(e) => setCurrentStock(e.target.value)}
                min="0"
                data-testid="input-create-stock"
              />
            </div>
          )}
          {isFinished && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="hildale-qty">Hildale Qty</Label>
                <Input
                  id="hildale-qty"
                  type="number"
                  value={hildaleQty}
                  onChange={(e) => setHildaleQty(e.target.value)}
                  min="0"
                  data-testid="input-create-hildale-qty"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pivot-qty">Pivot Qty</Label>
                <Input
                  id="pivot-qty"
                  type="number"
                  value={pivotQty}
                  onChange={(e) => setPivotQty(e.target.value)}
                  min="0"
                  data-testid="input-create-pivot-qty"
                />
              </div>
            </div>
          )}
          {!isFinished && (
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., Hardware, Springs, Nuts"
                data-testid="input-create-category"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-create">
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-create">
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function BOM() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateFinishedDialogOpen, setIsCreateFinishedDialogOpen] = useState(false);
  const [isCreateStockDialogOpen, setIsCreateStockDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingBOMItem, setEditingBOMItem] = useState<any>(null);
  const { toast } = useToast();

  const { data: items, isLoading } = useQuery({
    queryKey: ["/api/items"],
  });

  const allItems = (items as any[]) ?? [];
  
  const filteredItems = allItems.filter((item: any) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.sku && item.sku.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const finishedProducts = filteredItems.filter((item: any) => item.type === "finished_product");
  const stockInventory = filteredItems.filter((item: any) => item.type === "component");

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

  const handleUpdate = (id: string, field: string, value: string | number, onSuccess: () => void, onError: () => void) => {
    const item = allItems.find((i: any) => i.id === id);
    if (!item) {
      onError();
      return;
    }

    let updates: any = { [field]: value };

    // Finished products: Do NOT update currentStock - use only pivotQty and hildaleQty
    // Components: currentStock remains the source of truth
    // No automatic recalculation needed - backend can compute totalOwned on read if needed

    updateMutation.mutate(
      { id, updates },
      {
        onSuccess: () => {
          onSuccess();
        },
        onError: () => {
          onError();
        }
      }
    );
  };

  const handleDelete = (item: any) => {
    if (confirm(`Delete ${item.name}? This action cannot be undone.`)) {
      deleteMutation.mutate(item.id);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">BOM</h1>
          <p className="text-sm text-muted-foreground">Manage finished products and stock inventory</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setIsImportDialogOpen(true)}
          data-testid="button-import-products"
        >
          <Upload className="mr-2 h-4 w-4" />
          Import Products
        </Button>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-items"
          />
        </div>
      </div>

      {/* Finished Products Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Finished Products</h2>
            <p className="text-sm text-muted-foreground">Products with bill of materials</p>
          </div>
          <Button
            size="sm"
            onClick={() => setIsCreateFinishedDialogOpen(true)}
            data-testid="button-create-finished-product"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        </div>
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          </div>
        ) : finishedProducts.length === 0 ? (
          <Card>
            <CardContent className="flex h-48 flex-col items-center justify-center gap-2">
              <Package className="h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "No finished products found" : "No finished products yet"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="p-3 text-left text-sm font-medium">Name</th>
                  <th className="p-3 text-left text-sm font-medium">SKU</th>
                  <th className="p-3 text-right text-sm font-medium">Forecast</th>
                  <th className="p-3 text-right text-sm font-medium">Hildale Qty</th>
                  <th className="p-3 text-right text-sm font-medium">Pivot Qty</th>
                  <th className="p-3 text-center text-sm font-medium">BOM</th>
                  <th className="p-3 text-right text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {finishedProducts.map((item: any) => (
                  <ItemTableRow
                    key={item.id}
                    item={item}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onEditBOM={setEditingBOMItem}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stock Inventory Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Stock Inventory</h2>
            <p className="text-sm text-muted-foreground">Components and raw materials</p>
          </div>
          <Button
            size="sm"
            onClick={() => setIsCreateStockDialogOpen(true)}
            data-testid="button-create-stock-item"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Item
          </Button>
        </div>
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          </div>
        ) : stockInventory.length === 0 ? (
          <Card>
            <CardContent className="flex h-48 flex-col items-center justify-center gap-2">
              <Package className="h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "No stock items found" : "No stock items yet"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="p-3 text-left text-sm font-medium">Name</th>
                  <th className="p-3 text-left text-sm font-medium">SKU</th>
                  <th className="p-3 text-right text-sm font-medium">Stock</th>
                  <th className="p-3 text-left text-sm font-medium">Category</th>
                  <th className="p-3 text-right text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stockInventory.map((item: any) => (
                  <ItemTableRow
                    key={item.id}
                    item={item}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CreateItemDialog
        isOpen={isCreateFinishedDialogOpen}
        onClose={() => setIsCreateFinishedDialogOpen(false)}
        isFinished={true}
      />
      <CreateItemDialog
        isOpen={isCreateStockDialogOpen}
        onClose={() => setIsCreateStockDialogOpen(false)}
        isFinished={false}
      />
      {editingBOMItem && (
        <BOMDialog
          item={editingBOMItem}
          isOpen={!!editingBOMItem}
          onClose={() => setEditingBOMItem(null)}
          allItems={allItems}
        />
      )}
      <ImportProductsDialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
      />
    </div>
  );
}
