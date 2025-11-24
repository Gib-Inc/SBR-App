import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Check, X, Trash2, Package, Edit, Upload, ArrowLeftRight, History, Boxes, ShoppingCart, Scan, Brain, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ImportProductsDialog } from "@/components/import-products-dialog";
import { TransferDialog } from "@/components/transfer-dialog";
import { ProductionDialog } from "@/components/production-dialog";
import { TransactionHistoryDialog } from "@/components/transaction-history-dialog";
import { ScanInventoryModal } from "@/components/scan-inventory-modal";

const WAREHOUSE_LOCATIONS = [
  "Spanish Fork",
  "Hildale",
];

function ItemTableRow({ 
  item, 
  onDelete, 
  onUpdate,
  onEditBOM,
  onTransfer,
  onProduce,
  onViewHistory,
  onReorder,
  aiRecommendations
}: { 
  item: any; 
  onDelete: (item: any) => void;
  onUpdate: (id: string, field: string, value: string | number, onSuccess: () => void, onError: () => void) => void;
  onEditBOM?: (item: any) => void;
  onTransfer?: (item: any) => void;
  onProduce?: (item: any) => void;
  onViewHistory?: (item: any) => void;
  onReorder?: (item: any) => void;
  aiRecommendations?: any[];
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

    // Validate input - numeric fields: currentStock, hildaleQty, pivotQty
    if (editingField === "currentStock" || editingField === "hildaleQty" || editingField === "pivotQty") {
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

      {/* Supplier Columns (only for components) */}
      {item.type === "component" && (
        <>
          {/* Supplier Name */}
          <td className="px-3 align-middle">
            <div className="px-2 py-1 text-sm" data-testid={`text-supplier-name-${item.id}`}>
              {item.primarySupplier?.supplierName || <span className="text-muted-foreground">No supplier</span>}
            </div>
          </td>

          {/* Supplier SKU */}
          <td className="px-3 align-middle">
            <div className="px-2 py-1 font-mono text-sm" data-testid={`text-supplier-sku-${item.id}`}>
              {item.primarySupplier?.supplierSku || <span className="text-muted-foreground">—</span>}
            </div>
          </td>

          {/* Unit Cost */}
          <td className="px-3 align-middle">
            <div className="px-2 py-1 text-right text-sm" data-testid={`text-unit-cost-${item.id}`}>
              {item.primarySupplier?.unitCost ? `$${item.primarySupplier.unitCost.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
            </div>
          </td>

          {/* MOQ */}
          <td className="px-3 align-middle">
            <div className="px-2 py-1 text-right text-sm" data-testid={`text-moq-${item.id}`}>
              {item.primarySupplier?.minimumOrderQuantity || <span className="text-muted-foreground">—</span>}
            </div>
          </td>

          {/* Lead Time */}
          <td className="px-3 align-middle">
            <div className="px-2 py-1 text-right text-sm" data-testid={`text-lead-time-${item.id}`}>
              {item.primarySupplier?.leadTimeDays || <span className="text-muted-foreground">—</span>}
            </div>
          </td>
        </>
      )}

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

      {/* AI Reorder Column (only for components) */}
      {item.type === "component" && (() => {
        // Get latest recommendation - filter and clone to avoid mutating query cache
        const itemRecommendations = (aiRecommendations?.filter(
          (rec: any) => rec.itemId === item.id && rec.location === null
        ) || []).slice(); // Clone array to avoid mutating query cache
        // Sort by createdAt DESC to get the most recent recommendation
        itemRecommendations.sort((a: any, b: any) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const latestRecommendation = itemRecommendations[0];
        return (
          <td className="px-3 align-middle">
            {latestRecommendation ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 cursor-help">
                      <Brain className="h-3 w-3 text-primary" />
                      <span className="text-sm font-medium" data-testid={`text-ai-qty-${item.id}`}>
                        {latestRecommendation.recommendedQty}
                      </span>
                      <Badge 
                        variant={latestRecommendation.recommendedAction === 'ORDER' ? 'destructive' : 'secondary'}
                        className="text-xs"
                      >
                        {latestRecommendation.recommendedAction}
                      </Badge>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Last updated: {new Date(latestRecommendation.createdAt).toLocaleString()}</p>
                    <p className="text-xs">Current stock: {latestRecommendation.contextSnapshot?.currentStock ?? 0}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <div className="text-sm text-muted-foreground px-2 py-1">—</div>
            )}
          </td>
        );
      })()}

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
      <td className="sticky right-0 z-10 bg-card px-3 align-middle shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">
        <div className="flex gap-1 justify-end">
          {item.type === "finished_product" && onTransfer && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onTransfer(item)}
              data-testid={`button-transfer-${item.id}`}
              className="h-8 w-8"
              title="Transfer between locations"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
          )}
          {item.type === "finished_product" && onProduce && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onProduce(item)}
              data-testid={`button-produce-${item.id}`}
              className="h-8 w-8"
              title="Produce items"
            >
              <Boxes className="h-4 w-4" />
            </Button>
          )}
          {item.type === "component" && onReorder && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onReorder(item)}
              data-testid={`button-reorder-${item.id}`}
              className="h-8 w-8"
              title="Create reorder / add to PO"
            >
              <ShoppingCart className="h-4 w-4" />
            </Button>
          )}
          {onViewHistory && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onViewHistory(item)}
              data-testid={`button-history-${item.id}`}
              className="h-8 w-8"
              title="View transaction history"
            >
              <History className="h-4 w-4" />
            </Button>
          )}
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
  const [bomComponents, setBomComponents] = useState<Array<{ componentId: string; quantity: number }>>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const { data: bomData, isLoading } = useQuery({
    queryKey: ["/api/bom", item?.id],
    enabled: !!item?.id && isOpen,
  });

  // Initialize form state only once when data is loaded
  useEffect(() => {
    if (isOpen && !isLoading && !isInitialized) {
      if (bomData && Array.isArray(bomData) && bomData.length > 0) {
        const transformed = bomData.map((bom: any) => ({
          componentId: bom.componentId,
          quantity: bom.quantityRequired
        }));
        setBomComponents(transformed);
      } else {
        setBomComponents([]);
      }
      setHasChanges(false);
      setIsInitialized(true);
    }
  }, [isOpen, isLoading, bomData, isInitialized]);

  // Reset initialization flag when dialog closes or item changes
  useEffect(() => {
    if (!isOpen) {
      setIsInitialized(false);
      setBomComponents([]);
      setHasChanges(false);
    }
  }, [isOpen]);

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
        
        {isLoading || !isInitialized ? (
          <div className="flex h-64 flex-col items-center justify-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Loading bill of materials...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Define component requirements for this product</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addComponent}
                disabled={updateBOMMutation.isPending}
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
                          disabled={updateBOMMutation.isPending}
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
                          disabled={updateBOMMutation.isPending}
                          data-testid={`input-bom-quantity-${index}`}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeComponent(index)}
                        disabled={updateBOMMutation.isPending}
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
              <Button 
                variant="outline" 
                onClick={() => handleClose(false)} 
                disabled={updateBOMMutation.isPending}
                data-testid="button-cancel-bom"
              >
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
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReorderDialog({ isOpen, onClose, item }: { isOpen: boolean; onClose: () => void; item: any }) {
  const { toast } = useToast();
  const [orderQty, setOrderQty] = useState("");
  const [poMode, setPoMode] = useState<"new" | "existing">("new");
  const [selectedExistingPO, setSelectedExistingPO] = useState("");

  if (!item) return null;

  // CRITICAL: Finished products use hildaleQty + pivotQty, components use currentStock
  const isFinished = item.type === "finished_product";
  const totalStock = isFinished 
    ? (item.hildaleQty ?? 0) + (item.pivotQty ?? 0)
    : (item.currentStock ?? 0);
  
  const dailyUsage = item.dailyUsage ?? 1;
  const daysOfCover = dailyUsage > 0 ? Math.floor(totalStock / dailyUsage) : 0;
  
  // Calculate suggested order quantity
  const targetStock = Math.max(dailyUsage * 30, 100);
  const calculatedOrderQty = Math.max(0, targetStock - totalStock);
  const moq = item.primarySupplier?.minimumOrderQuantity || 0;
  const suggestedOrderQty = moq > 0 ? Math.max(moq, calculatedOrderQty) : calculatedOrderQty;

  // Fetch purchase orders and suppliers for this item's supplier
  const { data: allPOs = [] } = useQuery<any[]>({
    queryKey: ['/api/purchase-orders'],
    enabled: isOpen && !!item.primarySupplier,
  });

  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ['/api/suppliers'],
    enabled: isOpen,
  });

  const supplier = suppliers.find(s => s.id === item.primarySupplier?.supplierId);
  const draftPOs = allPOs.filter(
    po => po.supplierId === supplier?.id && ['DRAFT', 'APPROVAL_PENDING'].includes(po.status)
  );

  const createPOMutation = useMutation({
    mutationFn: async (data: { mode: "new" | "existing"; qty: number; poId?: string }) => {
      if (!supplier) throw new Error("No supplier configured");
      
      const qty = data.qty;
      const unitCost = item.primarySupplier?.unitCost || 0;

      if (data.mode === "new") {
        // Create new PO
        const res = await apiRequest("POST", "/api/purchase-orders", {
          supplierId: supplier.id,
          status: "DRAFT",
          lines: [{
            itemId: item.id,
            qtyOrdered: qty,
            unitCost,
          }],
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      } else {
        // Add to existing PO
        const res = await apiRequest("POST", `/api/purchase-orders/${data.poId}/lines`, {
          lines: [{
            itemId: item.id,
            qtyOrdered: qty,
            unitCost,
          }],
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      toast({ title: poMode === "new" ? "Purchase order created" : "Line added to PO" });
      onClose();
      setOrderQty("");
      setPoMode("new");
      setSelectedExistingPO("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create PO", description: error.message, variant: "destructive" });
    },
  });

  const handleCreatePO = () => {
    const qty = parseInt(orderQty) || suggestedOrderQty;
    
    if (!supplier) {
      toast({ title: "No supplier configured for this item", variant: "destructive" });
      return;
    }

    if (qty <= 0) {
      toast({ title: "Quantity must be greater than 0", variant: "destructive" });
      return;
    }

    if (poMode === "existing" && !selectedExistingPO) {
      toast({ title: "Please select a purchase order", variant: "destructive" });
      return;
    }

    createPOMutation.mutate({
      mode: poMode,
      qty,
      poId: selectedExistingPO,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reorder / Create Purchase Order</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          {/* Item Information */}
          <div>
            <h3 className="font-semibold text-lg mb-2">{item.name}</h3>
            <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>
          </div>

          {/* Current Stock & Coverage */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  {isFinished ? "Total Stock (Hildale + Pivot)" : "Current Stock"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalStock}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {daysOfCover} days of cover at current usage
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Suggested Order Qty</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{suggestedOrderQty}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  ~30 days supply
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Supplier Information */}
          {item.primarySupplier ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Primary Supplier</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Supplier</p>
                    <p className="font-medium">{item.primarySupplier.supplierName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Supplier SKU</p>
                    <p className="font-mono text-sm">{item.primarySupplier.supplierSku || "—"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Unit Cost</p>
                    <p className="font-medium">
                      {item.primarySupplier.unitCost ? `$${item.primarySupplier.unitCost.toFixed(2)}` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">MOQ</p>
                    <p className="font-medium">{item.primarySupplier.minimumOrderQuantity || "—"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Lead Time</p>
                    <p className="font-medium">
                      {item.primarySupplier.leadTimeDays ? `${item.primarySupplier.leadTimeDays} days` : "—"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">No supplier configured for this item</p>
              </CardContent>
            </Card>
          )}

          {/* Order Quantity */}
          <div>
            <Label htmlFor="orderQty">Order Quantity</Label>
            <Input
              id="orderQty"
              type="number"
              min="1"
              placeholder={`Suggested: ${suggestedOrderQty}`}
              value={orderQty}
              onChange={(e) => setOrderQty(e.target.value)}
              data-testid="input-order-qty"
            />
          </div>

          {/* PO Mode Selection */}
          {supplier && draftPOs.length > 0 && (
            <div>
              <Label>Purchase Order</Label>
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    id="mode-new"
                    checked={poMode === "new"}
                    onChange={() => setPoMode("new")}
                    data-testid="radio-new-po"
                  />
                  <Label htmlFor="mode-new" className="cursor-pointer">Create New PO</Label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    id="mode-existing"
                    checked={poMode === "existing"}
                    onChange={() => setPoMode("existing")}
                    data-testid="radio-existing-po"
                  />
                  <Label htmlFor="mode-existing" className="cursor-pointer">Add to Existing Draft PO</Label>
                </div>
                {poMode === "existing" && (
                  <Select value={selectedExistingPO} onValueChange={setSelectedExistingPO}>
                    <SelectTrigger data-testid="select-existing-po">
                      <SelectValue placeholder="Select a draft PO" />
                    </SelectTrigger>
                    <SelectContent>
                      {draftPOs.map(po => (
                        <SelectItem key={po.id} value={po.id}>
                          {po.poNumber} ({po.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button 
              onClick={handleCreatePO}
              disabled={!supplier || createPOMutation.isPending}
              data-testid="button-create-po-from-reorder"
            >
              {createPOMutation.isPending 
                ? "Creating..." 
                : poMode === "new" 
                  ? "Create PO" 
                  : "Add to PO"}
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
                <p className="text-xs text-muted-foreground">Initial stock at manufacturing site</p>
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
                <p className="text-xs text-muted-foreground">Initial stock at warehouse</p>
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
  const [transferItem, setTransferItem] = useState<any>(null);
  const [productionItem, setProductionItem] = useState<any>(null);
  const [historyItem, setHistoryItem] = useState<any>(null);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [scanMode, setScanMode] = useState<"RAW" | "FINISHED">("RAW");
  const [reorderItem, setReorderItem] = useState<any>(null);
  const { toast } = useToast();

  const { data: items, isLoading } = useQuery({
    queryKey: ["/api/items"],
  });

  const { data: aiRecommendations = [] } = useQuery<any[]>({
    queryKey: ["/api/ai-recommendations"],
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
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setScanMode("FINISHED");
                setIsScanModalOpen(true);
              }}
              data-testid="button-scan-finished-products"
            >
              <Scan className="mr-2 h-4 w-4" />
              Scan Finished Products
            </Button>
            <Button
              size="sm"
              onClick={() => setIsCreateFinishedDialogOpen(true)}
              data-testid="button-create-finished-product"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Product
            </Button>
          </div>
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
                  <th className="sticky right-0 z-10 bg-card p-3 text-right text-sm font-medium shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
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
                    onTransfer={setTransferItem}
                    onProduce={setProductionItem}
                    onViewHistory={setHistoryItem}
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
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setScanMode("RAW");
                setIsScanModalOpen(true);
              }}
              data-testid="button-scan-raw-materials"
            >
              <Scan className="mr-2 h-4 w-4" />
              Scan Raw Materials
            </Button>
            <Button
              size="sm"
              onClick={() => setIsCreateStockDialogOpen(true)}
              data-testid="button-create-stock-item"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </div>
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
          <div className="overflow-x-auto overflow-y-visible rounded-md border">
            <table className="w-full min-w-[1200px]">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="p-3 text-left text-sm font-medium">Name</th>
                  <th className="p-3 text-left text-sm font-medium">SKU</th>
                  <th className="p-3 text-left text-sm font-medium">Supplier</th>
                  <th className="p-3 text-left text-sm font-medium">Supplier SKU</th>
                  <th className="p-3 text-right text-sm font-medium">Unit Cost</th>
                  <th className="p-3 text-right text-sm font-medium">MOQ</th>
                  <th className="p-3 text-right text-sm font-medium">Lead Time (days)</th>
                  <th className="p-3 text-right text-sm font-medium">Stock</th>
                  <th className="p-3 text-left text-sm font-medium">AI Reorder</th>
                  <th className="p-3 text-left text-sm font-medium">Category</th>
                  <th className="sticky right-0 z-10 bg-card p-3 text-right text-sm font-medium shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stockInventory.map((item: any) => (
                  <ItemTableRow
                    key={item.id}
                    item={item}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onViewHistory={setHistoryItem}
                    onReorder={setReorderItem}
                    aiRecommendations={aiRecommendations}
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
      
      {/* Transaction Dialogs */}
      {transferItem && (
        <TransferDialog
          isOpen={!!transferItem}
          onClose={() => setTransferItem(null)}
          item={transferItem}
        />
      )}
      {productionItem && (
        <ProductionDialog
          isOpen={!!productionItem}
          onClose={() => setProductionItem(null)}
          item={productionItem}
        />
      )}
      {historyItem && (
        <TransactionHistoryDialog
          isOpen={!!historyItem}
          onClose={() => setHistoryItem(null)}
          item={historyItem}
        />
      )}
      {reorderItem && (
        <ReorderDialog
          isOpen={!!reorderItem}
          onClose={() => setReorderItem(null)}
          item={reorderItem}
        />
      )}
      
      {/* Scan Inventory Modal */}
      <ScanInventoryModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        mode={scanMode}
        context="BOM_PAGE"
        onModeChange={setScanMode}
      />
    </div>
  );
}
