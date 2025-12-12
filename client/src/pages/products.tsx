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
import { Plus, Search, Check, X, Trash2, Package, Edit, Upload, Download, Boxes, ShoppingCart, Scan, Brain, Info, DollarSign, Link2, SlidersHorizontal, CheckSquare, Square, ShieldCheck, Loader2, FileEdit, PackageMinus, ClipboardCheck, AlertCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { SiShopify, SiAmazon } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ImportProductsDialog } from "@/components/import-products-dialog";
import { ScanInventoryModal } from "@/components/scan-inventory-modal";
import { ItemCostSettingsDialog } from "@/components/item-cost-settings-dialog";
import { SkuMappingWizard } from "@/components/sku-mapping-wizard";
import { Textarea } from "@/components/ui/textarea";
import { BatchProductionDialog } from "@/components/batch-production-dialog";
import { TransferDialog } from "@/components/transfer-dialog";
import { Factory, ArrowRightLeft } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const WAREHOUSE_LOCATIONS = [
  "Spanish Fork",
  "Hildale",
];

interface ChannelColumnVisibility {
  shopifySku: boolean;
  amazonSku: boolean;
  extensivSku: boolean;
  upc: boolean;
}

const COLUMN_VISIBILITY_STORAGE_KEY = "bom-channel-column-visibility";

function getDefaultColumnVisibility(): ChannelColumnVisibility {
  return {
    shopifySku: true,
    amazonSku: true,
    extensivSku: true,
    upc: true,
  };
}

function loadColumnVisibility(): ChannelColumnVisibility {
  if (typeof window === "undefined") {
    return getDefaultColumnVisibility();
  }
  try {
    const stored = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (stored) {
      return { ...getDefaultColumnVisibility(), ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error("Failed to load column visibility:", e);
  }
  return getDefaultColumnVisibility();
}

function saveColumnVisibility(visibility: ChannelColumnVisibility) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(visibility));
  } catch (e) {
    console.error("Failed to save column visibility:", e);
  }
}

function ItemTableRow({ 
  item, 
  onDelete, 
  onUpdate,
  onEditBOM,
  onTransfer,
  onProduce,
  onViewHistory,
  onReorder,
  onCostSettings,
  aiRecommendations,
  backorderSnapshots,
  columnVisibility,
}: { 
  item: any; 
  onDelete: (item: any) => void;
  onUpdate: (id: string, field: string, value: string | number, onSuccess: () => void, onError: () => void) => void;
  onEditBOM?: (item: any) => void;
  onTransfer?: (item: any) => void;
  onProduce?: (item: any) => void;
  onViewHistory?: (item: any) => void;
  onReorder?: (item: any) => void;
  onCostSettings?: (item: any) => void;
  aiRecommendations?: any[];
  backorderSnapshots?: any[];
  columnVisibility?: ChannelColumnVisibility;
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
    <tr className="h-11 border-b hover-elevate transition-all duration-300" data-testid={`row-item-${item.id}`} data-item-id={item.id}>
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
      <td className="px-3 align-middle whitespace-nowrap">
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

      {/* Shopify SKU Column (only for finished products when column is visible) */}
      {item.type === "finished_product" && (columnVisibility?.shopifySku ?? true) && (
        <td className="px-3 align-middle whitespace-nowrap">
          <div className="font-mono text-sm" data-testid={`text-shopify-sku-${item.id}`}>
            {item.shopifySku || <span className="text-muted-foreground">—</span>}
          </div>
        </td>
      )}

      {/* Amazon SKU Column (only for finished products when column is visible) */}
      {item.type === "finished_product" && (columnVisibility?.amazonSku ?? true) && (
        <td className="px-3 align-middle whitespace-nowrap">
          <div className="font-mono text-sm" data-testid={`text-amazon-sku-${item.id}`}>
            {item.amazonSku || <span className="text-muted-foreground">—</span>}
          </div>
        </td>
      )}

      {/* Extensiv SKU Column (only for finished products when column is visible) */}
      {item.type === "finished_product" && (columnVisibility?.extensivSku ?? true) && (
        <td className="px-3 align-middle whitespace-nowrap">
          <div className="font-mono text-sm" data-testid={`text-extensiv-sku-${item.id}`}>
            {item.extensivSku || <span className="text-muted-foreground">—</span>}
          </div>
        </td>
      )}

      {/* UPC Column (only for finished products when column is visible) */}
      {item.type === "finished_product" && (columnVisibility?.upc ?? true) && (
        <td className="px-3 align-middle whitespace-nowrap">
          <div className="font-mono text-sm" data-testid={`text-upc-${item.id}`}>
            {item.upc || <span className="text-muted-foreground">—</span>}
          </div>
        </td>
      )}

      {/* Supplier Columns (only for components) */}
      {item.type === "component" && (
        <>
          {/* Supplier Name */}
          <td className="px-3 align-middle whitespace-nowrap">
            <div className="px-2 py-1 text-sm" data-testid={`text-supplier-name-${item.id}`}>
              {item.primarySupplier?.supplierName || <span className="text-muted-foreground">No supplier</span>}
            </div>
          </td>

          {/* Supplier SKU */}
          <td className="px-3 align-middle whitespace-nowrap">
            <div className="px-2 py-1 font-mono text-sm" data-testid={`text-supplier-sku-${item.id}`}>
              {item.primarySupplier?.supplierSku || <span className="text-muted-foreground">—</span>}
            </div>
          </td>

          {/* Unit Cost */}
          <td className="px-3 align-middle whitespace-nowrap">
            <div className="px-2 py-1 text-right text-sm" data-testid={`text-unit-cost-${item.id}`}>
              {item.primarySupplier?.unitCost ? `$${item.primarySupplier.unitCost.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
            </div>
          </td>

          {/* MOQ */}
          <td className="px-3 align-middle whitespace-nowrap">
            <div className="px-2 py-1 text-right text-sm" data-testid={`text-moq-${item.id}`}>
              {item.primarySupplier?.minimumOrderQuantity || <span className="text-muted-foreground">—</span>}
            </div>
          </td>

          {/* Lead Time */}
          <td className="px-3 align-middle whitespace-nowrap">
            <div className="px-2 py-1 text-right text-sm" data-testid={`text-lead-time-${item.id}`}>
              {item.primarySupplier?.leadTimeDays || <span className="text-muted-foreground">—</span>}
            </div>
          </td>
        </>
      )}

      {/* Current Stock Column (only for components) */}
      {item.type === "component" && (
        <td className="px-3 align-middle whitespace-nowrap">
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
          <td className="px-3 align-middle whitespace-nowrap">
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
        <td className="px-3 align-middle whitespace-nowrap">
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
        <td className="px-3 align-middle whitespace-nowrap">
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

      {/* Pivot Qty Column (only for finished products) - Extensiv mirror */}
      {item.type === "finished_product" && (
        <td className="px-3 align-middle whitespace-nowrap">
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

      {/* Available for Sale Column (only for finished products) - Live projected 3PL stock */}
      {item.type === "finished_product" && (
        <td className="px-3 align-middle whitespace-nowrap text-right" data-testid={`text-available-for-sale-${item.id}`}>
          <span className={
            (item.availableForSaleQty ?? 0) < 0 
              ? "text-red-600 dark:text-red-400 font-bold"
              : (item.availableForSaleQty ?? 0) !== (item.pivotQty ?? 0) 
                ? "text-blue-600 dark:text-blue-400 font-medium" 
                : ""
          }>
            {item.availableForSaleQty ?? 0}
          </span>
        </td>
      )}

      {/* Days to Stockout Column (only for finished products) */}
      {item.type === "finished_product" && (
        <td className="px-3 align-middle whitespace-nowrap text-right" data-testid={`text-days-to-stockout-${item.id}`}>
          {(() => {
            const availableQty = item.availableForSaleQty ?? 0;
            const velocity = item.dailyUsage || 0;
            
            if (velocity <= 0 || availableQty <= 0) {
              return <span className="text-muted-foreground">—</span>;
            }
            
            const daysToStockout = Math.round(availableQty / velocity);
            
            let cellClass = "";
            if (daysToStockout < 7) {
              cellClass = "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-bold";
            } else if (daysToStockout < 21) {
              cellClass = "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium";
            } else {
              cellClass = "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300";
            }
            
            return (
              <span className={`px-2 py-0.5 rounded text-sm ${cellClass}`}>
                {daysToStockout}d
              </span>
            );
          })()}
        </td>
      )}

      {/* Backorders Column (only for finished products) */}
      {item.type === "finished_product" && (
        <td className="px-3 align-middle whitespace-nowrap">
          {(() => {
            const snapshot = backorderSnapshots?.find((s: any) => s.productId === item.id);
            const totalBackorderedQty = snapshot?.totalBackorderedQty || 0;
            const hasBackorders = totalBackorderedQty > 0;

            return (
              <div className="flex items-center gap-2 justify-end" data-testid={`text-backorders-${item.id}`}>
                <span className={hasBackorders ? "text-orange-600 dark:text-orange-400 font-medium" : ""}>
                  {totalBackorderedQty}
                </span>
                {hasBackorders && (
                  <Badge variant="outline" className="text-orange-600 dark:text-orange-400 border-orange-600 dark:border-orange-400">
                    Backordered
                  </Badge>
                )}
              </div>
            );
          })()}
        </td>
      )}

      {/* Category Column (only for stock inventory) */}
      {item.type === "component" && (
        <td className="px-3 align-middle whitespace-nowrap">
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
      <td className="sticky right-0 z-10 bg-card px-3 align-middle whitespace-nowrap shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">
        <div className="flex gap-1 justify-end">
          {item.type === "finished_product" && onEditBOM && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEditBOM(item)}
                    data-testid={`button-edit-bom-${item.id}`}
                    className="h-8 w-8"
                  >
                    <Boxes className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{item.componentsCount || 0} components</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {item.type === "finished_product" && onTransfer && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onTransfer(item)}
                    data-testid={`button-transfer-${item.id}`}
                    className="h-8 w-8"
                  >
                    <PackageMinus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Transfer between warehouses</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
          {item.type === "component" && onCostSettings && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onCostSettings(item)}
              data-testid={`button-cost-settings-${item.id}`}
              className="h-8 w-8"
              title="Cost settings"
            >
              <DollarSign className="h-4 w-4" />
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
        description: "Components updated successfully",
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
          <DialogTitle>Edit Components - {item?.name}</DialogTitle>
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
                {updateBOMMutation.isPending ? "Saving..." : "Save Components"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuickOrderDialog({ 
  isOpen, 
  onClose, 
  stockItems 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  stockItems: any[];
}) {
  const { toast } = useToast();
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [selectedItems, setSelectedItems] = useState<Map<string, number>>(new Map());
  const [isCreating, setIsCreating] = useState(false);

  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ['/api/suppliers'],
    enabled: isOpen,
  });

  const itemsForSupplier = selectedSupplierId 
    ? stockItems.filter(item => item.primarySupplier?.supplierId === selectedSupplierId)
    : [];

  const handleQtyChange = (itemId: string, qty: number) => {
    const newSelected = new Map(selectedItems);
    if (qty > 0) {
      newSelected.set(itemId, qty);
    } else {
      newSelected.delete(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleSelectAll = () => {
    const newSelected = new Map<string, number>();
    itemsForSupplier.forEach(item => {
      const suggestedQty = Math.max(item.primarySupplier?.minimumOrderQuantity || 10, 10);
      newSelected.set(item.id, suggestedQty);
    });
    setSelectedItems(newSelected);
  };

  const handleClearAll = () => {
    setSelectedItems(new Map());
  };

  const createPOMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSupplierId || selectedItems.size === 0) {
        throw new Error("Select items to order");
      }

      const lines = Array.from(selectedItems.entries()).map(([itemId, qty]) => {
        const item = stockItems.find(i => i.id === itemId);
        return {
          itemId,
          qtyOrdered: qty,
          unitCost: item?.defaultPurchaseCost || item?.primarySupplier?.unitCost || 0,
        };
      });

      const res = await apiRequest("POST", "/api/purchase-orders", {
        supplierId: selectedSupplierId,
        status: "DRAFT",
        lines,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      toast({ 
        title: "Purchase Order Created", 
        description: `PO created with ${selectedItems.size} line items` 
      });
      handleClose();
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to create PO", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const handleClose = () => {
    setSelectedSupplierId("");
    setSelectedItems(new Map());
    setIsCreating(false);
    onClose();
  };

  const totalItems = selectedItems.size;
  const totalQty = Array.from(selectedItems.values()).reduce((sum, qty) => sum + qty, 0);
  const totalCost = Array.from(selectedItems.entries()).reduce((sum, [itemId, qty]) => {
    const item = stockItems.find(i => i.id === itemId);
    const unitCost = item?.defaultPurchaseCost || item?.primarySupplier?.unitCost || 0;
    return sum + (qty * unitCost);
  }, 0);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Quick Order from Supplier
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Select a supplier and add items to create a new purchase order
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Select Supplier</Label>
            <Select value={selectedSupplierId} onValueChange={(value) => {
              setSelectedSupplierId(value);
              setSelectedItems(new Map());
            }}>
              <SelectTrigger data-testid="select-quick-order-supplier">
                <SelectValue placeholder="Choose a supplier..." />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((supplier: any) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedSupplierId && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {itemsForSupplier.length} items available from this supplier
                </span>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleSelectAll}
                    data-testid="button-select-all-items"
                  >
                    Select All
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleClearAll}
                    data-testid="button-clear-all-items"
                  >
                    Clear All
                  </Button>
                </div>
              </div>

              <div className="border rounded-md max-h-[300px] overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-muted sticky top-0">
                    <tr className="border-b">
                      <th className="p-2 text-left text-xs font-medium">Item</th>
                      <th className="p-2 text-right text-xs font-medium">Stock</th>
                      <th className="p-2 text-right text-xs font-medium">MOQ</th>
                      <th className="p-2 text-right text-xs font-medium">Unit Cost</th>
                      <th className="p-2 text-center text-xs font-medium w-32">Order Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsForSupplier.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-muted-foreground">
                          No items linked to this supplier
                        </td>
                      </tr>
                    ) : (
                      itemsForSupplier.map(item => {
                        const qty = selectedItems.get(item.id) || 0;
                        const unitCost = item.defaultPurchaseCost || item.primarySupplier?.unitCost || 0;
                        return (
                          <tr key={item.id} className={`border-b last:border-b-0 ${qty > 0 ? 'bg-primary/5' : ''}`}>
                            <td className="p-2">
                              <div>
                                <span className="font-medium text-sm">{item.name}</span>
                                <span className="text-xs text-muted-foreground block">{item.sku}</span>
                              </div>
                            </td>
                            <td className="p-2 text-right text-sm">{item.currentStock ?? 0}</td>
                            <td className="p-2 text-right text-sm">{item.primarySupplier?.minimumOrderQuantity || '-'}</td>
                            <td className="p-2 text-right text-sm">
                              {unitCost > 0 ? `$${unitCost.toFixed(2)}` : '-'}
                            </td>
                            <td className="p-2">
                              <Input
                                type="number"
                                min={0}
                                value={qty || ''}
                                onChange={(e) => handleQtyChange(item.id, parseInt(e.target.value) || 0)}
                                className="w-24 text-center"
                                placeholder="0"
                                data-testid={`input-order-qty-${item.id}`}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {totalItems > 0 && (
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Order Summary</p>
                        <p className="text-xs text-muted-foreground">
                          {totalItems} items • {totalQty} total units
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">
                          ${totalCost.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">Estimated Total</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleClose} data-testid="button-cancel-quick-order">
              Cancel
            </Button>
            <Button 
              onClick={() => createPOMutation.mutate()} 
              disabled={selectedItems.size === 0 || createPOMutation.isPending}
              data-testid="button-create-quick-order"
            >
              {createPOMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>Create Purchase Order</>
              )}
            </Button>
          </div>
        </div>
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
      const unitCost = item.defaultPurchaseCost || item.primarySupplier?.unitCost || item.primarySupplier?.price || 0;

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
  // Channel SKU fields (for finished products)
  const [shopifySku, setShopifySku] = useState("");
  const [amazonSku, setAmazonSku] = useState("");
  const [extensivSku, setExtensivSku] = useState("");
  const [upc, setUpc] = useState("");

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
      setShopifySku("");
      setAmazonSku("");
      setExtensivSku("");
      setUpc("");
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
      // Finished products: ONLY pivotQty and hildaleQty + channel SKUs
      payload.hildaleQty = hildaleQtyNum;
      payload.pivotQty = pivotQtyNum;
      payload.category = null;
      // Add channel SKUs (only non-empty values)
      if (shopifySku.trim()) payload.shopifySku = shopifySku.trim();
      if (amazonSku.trim()) payload.amazonSku = amazonSku.trim();
      if (extensivSku.trim()) payload.extensivSku = extensivSku.trim();
      if (upc.trim()) payload.upc = upc.trim();
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
            <>
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
              
              {/* Channel SKU Mappings */}
              <div className="space-y-3 border-t pt-4">
                <Label className="text-sm font-medium">Source SKUs (Optional)</Label>
                <p className="text-xs text-muted-foreground">Map this product to external sales channels</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="shopify-sku" className="text-xs">Shopify SKU</Label>
                    <Input
                      id="shopify-sku"
                      value={shopifySku}
                      onChange={(e) => setShopifySku(e.target.value)}
                      placeholder="e.g., SHOP-001"
                      className="font-mono text-sm"
                      data-testid="input-create-shopify-sku"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="amazon-sku" className="text-xs">Amazon SKU</Label>
                    <Input
                      id="amazon-sku"
                      value={amazonSku}
                      onChange={(e) => setAmazonSku(e.target.value)}
                      placeholder="e.g., AMZ-001"
                      className="font-mono text-sm"
                      data-testid="input-create-amazon-sku"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="extensiv-sku" className="text-xs">Extensiv SKU</Label>
                    <Input
                      id="extensiv-sku"
                      value={extensivSku}
                      onChange={(e) => setExtensivSku(e.target.value)}
                      placeholder="e.g., EXT-001"
                      className="font-mono text-sm"
                      data-testid="input-create-extensiv-sku"
                    />
                  </div>
                </div>
              </div>
              
              {/* UPC Field */}
              <div className="space-y-2 border-t pt-4">
                <Label htmlFor="upc" className="text-sm font-medium">UPC (Optional)</Label>
                <Input
                  id="upc"
                  value={upc}
                  onChange={(e) => setUpc(e.target.value)}
                  placeholder="e.g., 012345678901"
                  className="font-mono text-sm"
                  data-testid="input-create-upc"
                />
                <p className="text-xs text-muted-foreground">GS1/UPC/GTIN barcode for marketplace identification</p>
              </div>
            </>
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

const INVENTORY_CHANGE_REASONS = [
  { value: "offline_sale", label: "Offline Sale", icon: PackageMinus, description: "Sold outside of tracked channels" },
  { value: "updated_count", label: "Updated Count", icon: ClipboardCheck, description: "Physical recount or inventory audit" },
  { value: "product_produced", label: "Product Produced", icon: Boxes, description: "Manufactured or assembled new units" },
  { value: "other", label: "Other", icon: FileEdit, description: "Other adjustment reason" },
];

function InventoryChangeReasonDialog({
  isOpen,
  onClose,
  item,
  field,
  oldValue,
  newValue,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  item: any;
  field: string;
  oldValue: number;
  newValue: number;
  onConfirm: (reason: string, notes?: string) => void;
}) {
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [notes, setNotes] = useState("");

  const delta = newValue - oldValue;
  const deltaDisplay = delta > 0 ? `+${delta}` : `${delta}`;
  const fieldLabel = field === "hildaleQty" ? "Hildale" : field === "pivotQty" ? "Pivot" : field === "currentStock" ? "Stock" : field;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReason) return;
    onConfirm(selectedReason, notes || undefined);
    setSelectedReason("");
    setNotes("");
  };

  const handleClose = () => {
    setSelectedReason("");
    setNotes("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Inventory Adjustment
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md bg-muted p-3 space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Product:</span>
              <span className="font-medium">{item.name}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Location:</span>
              <span className="font-medium">{fieldLabel}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Change:</span>
              <span className={`font-bold ${delta > 0 ? 'text-green-600 dark:text-green-400' : delta < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                {oldValue} → {newValue} ({deltaDisplay})
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>What caused this change?</Label>
            <RadioGroup value={selectedReason} onValueChange={setSelectedReason} className="space-y-2">
              {INVENTORY_CHANGE_REASONS.map((reason) => (
                <label
                  key={reason.value}
                  className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                    selectedReason === reason.value 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover-elevate'
                  }`}
                >
                  <RadioGroupItem value={reason.value} className="mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <reason.icon className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{reason.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{reason.description}</p>
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional context..."
              className="resize-none"
              rows={2}
              data-testid="input-adjustment-notes"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose} data-testid="button-cancel-adjustment">
              Cancel
            </Button>
            <Button type="submit" disabled={!selectedReason} data-testid="button-confirm-adjustment">
              Confirm Change
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
  const [pendingQuantityChange, setPendingQuantityChange] = useState<{
    item: any;
    field: string;
    oldValue: number;
    newValue: number;
    onSuccess: () => void;
    onError: () => void;
  } | null>(null);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [scanMode, setScanMode] = useState<"RAW" | "FINISHED">("RAW");
  const [reorderItem, setReorderItem] = useState<any>(null);
  const [costSettingsItem, setCostSettingsItem] = useState<any>(null);
  const [isSkuMappingWizardOpen, setIsSkuMappingWizardOpen] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<ChannelColumnVisibility>(getDefaultColumnVisibility);
  const [isVerifyingSkus, setIsVerifyingSkus] = useState(false);
  const [verificationResults, setVerificationResults] = useState<any>(null);
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [showQuickOrderDialog, setShowQuickOrderDialog] = useState(false);
  const [selectedSupplierForOrder, setSelectedSupplierForOrder] = useState<string>("");
  const [quickOrderItems, setQuickOrderItems] = useState<Array<{itemId: string; sku: string; name: string; qty: number}>>([]);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [isBatchProductionOpen, setIsBatchProductionOpen] = useState(false);
  const [transferItem, setTransferItem] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    const stored = loadColumnVisibility();
    setColumnVisibility(stored);
  }, []);
  
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const itemId = params.get('item');
    const action = params.get('action');
    
    if (itemId) {
      setHighlightedItemId(itemId);
      
      setTimeout(() => {
        const itemElement = document.querySelector(`[data-item-id="${itemId}"]`);
        if (itemElement) {
          itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          itemElement.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
          setTimeout(() => {
            itemElement.classList.remove('ring-2', 'ring-primary', 'ring-offset-2');
          }, 3000);
        }
      }, 500);
      
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleColumnVisibilityChange = (column: keyof ChannelColumnVisibility, visible: boolean) => {
    const newVisibility = { ...columnVisibility, [column]: visible };
    setColumnVisibility(newVisibility);
    saveColumnVisibility(newVisibility);
  };

  const handleVerifyChannelSkus = async () => {
    setIsVerifyingSkus(true);
    setVerificationResults(null);
    try {
      const response = await apiRequest("POST", "/api/integrations/verify-channel-skus", {});
      const results = await response.json();
      setVerificationResults(results);
      setIsVerifyModalOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Verification Failed",
        description: error.message || "Failed to verify channel SKUs",
      });
    } finally {
      setIsVerifyingSkus(false);
    }
  };

  const { data: items, isLoading } = useQuery({
    queryKey: ["/api/items"],
  });

  const { data: aiRecommendations = [] } = useQuery<any[]>({
    queryKey: ["/api/ai-recommendations"],
  });

  const { data: backorderSnapshots = [] } = useQuery<any[]>({
    queryKey: ["/api/backorder-snapshots"],
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

    // Intercept quantity field changes to show reason dialog
    const isQuantityField = field === "hildaleQty" || field === "pivotQty" || field === "currentStock";
    if (isQuantityField) {
      const oldValue = item[field] ?? 0;
      const newValue = typeof value === 'number' ? value : parseInt(String(value), 10);
      
      // Only show dialog if value actually changed
      if (oldValue !== newValue) {
        setPendingQuantityChange({
          item,
          field,
          oldValue,
          newValue,
          onSuccess,
          onError,
        });
        return;
      }
    }

    // For non-quantity fields, proceed directly
    let updates: any = { [field]: value };
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

  const handleQuantityChangeWithReason = async (
    item: any,
    field: string,
    newValue: number,
    reason: string,
    notes: string | undefined,
    onSuccess: () => void,
    onError: () => void
  ) => {
    const oldValue = item[field] ?? 0;
    const delta = newValue - oldValue;

    try {
      // First update the item
      const updates = { [field]: newValue };
      await new Promise<void>((resolve, reject) => {
        updateMutation.mutate(
          { id: item.id, updates },
          {
            onSuccess: () => resolve(),
            onError: () => reject(new Error("Update failed"))
          }
        );
      });

      // Then log the adjustment to AI Agent Logs
      await apiRequest("POST", "/api/logs/inventory-adjustment", {
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        field,
        oldValue,
        newValue,
        delta,
        reason,
        notes,
      });

      onSuccess();
      toast({
        title: "Inventory Updated",
        description: `${item.name} ${field === "hildaleQty" ? "Hildale" : field === "pivotQty" ? "Pivot" : "Stock"} quantity updated to ${newValue}`,
      });
    } catch (error) {
      onError();
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: "Failed to update inventory",
      });
    }
  };

  const handleDelete = (item: any) => {
    if (confirm(`Delete ${item.name}? This action cannot be undone.`)) {
      deleteMutation.mutate(item.id);
    }
  };

  const handleExport = async () => {
    try {
      const response = await fetch("/api/export/items");
      if (!response.ok) throw new Error("Export failed");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `products-inventory-${new Date().toISOString().split('T')[0]}.csv`;
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

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="text-sm text-muted-foreground">Manage finished products and stock inventory</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setIsSkuMappingWizardOpen(true)}
            data-testid="button-sku-mapping-wizard"
          >
            <Link2 className="mr-2 h-4 w-4" />
            SKU Mapping
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsImportDialogOpen(true)}
            data-testid="button-import-products"
          >
            <Download className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            data-testid="button-export-products"
          >
            <Upload className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setScanMode("FINISHED");
              setIsScanModalOpen(true);
            }}
            data-testid="button-scan-inventory"
          >
            <Scan className="mr-2 h-4 w-4" />
            Scan
          </Button>
        </div>
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
            <p className="text-sm text-muted-foreground">Products with component recipes</p>
          </div>
          <div className="flex gap-2">
            {/* Edit Columns Popover (only affects Finished Products table) */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-edit-columns">
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56" align="end">
                <div className="space-y-3">
                  <div className="font-medium text-sm">Show/Hide Channel SKU Columns</div>
                  <p className="text-xs text-muted-foreground">Only applies to Finished Products table</p>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={columnVisibility.shopifySku}
                        onCheckedChange={(checked) => handleColumnVisibilityChange("shopifySku", !!checked)}
                        data-testid="checkbox-column-shopify"
                      />
                      <SiShopify className="h-4 w-4 text-green-600" />
                      <span className="text-sm">Shopify SKU</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={columnVisibility.amazonSku}
                        onCheckedChange={(checked) => handleColumnVisibilityChange("amazonSku", !!checked)}
                        data-testid="checkbox-column-amazon"
                      />
                      <SiAmazon className="h-4 w-4 text-orange-500" />
                      <span className="text-sm">Amazon SKU</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={columnVisibility.extensivSku}
                        onCheckedChange={(checked) => handleColumnVisibilityChange("extensivSku", !!checked)}
                        data-testid="checkbox-column-extensiv"
                      />
                      <Package className="h-4 w-4 text-blue-600" />
                      <span className="text-sm">Extensiv SKU</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={columnVisibility.upc}
                        onCheckedChange={(checked) => handleColumnVisibilityChange("upc", !!checked)}
                        data-testid="checkbox-column-upc"
                      />
                      <Package className="h-4 w-4 text-purple-600" />
                      <span className="text-sm">UPC</span>
                    </label>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            {/* Check SKU Mapping Status Button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleVerifyChannelSkus}
                    disabled={isVerifyingSkus}
                    data-testid="button-verify-channel-skus"
                  >
                    {isVerifyingSkus ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-2 h-4 w-4" />
                    )}
                    SKU Status
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>View mapping counts for each channel</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
              variant="outline"
              size="sm"
              onClick={() => setIsBatchProductionOpen(true)}
              data-testid="button-batch-production"
            >
              <Factory className="mr-2 h-4 w-4" />
              Produce Product
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
          <div className="overflow-x-auto overflow-y-visible rounded-md border">
            <table className="w-full table-auto">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Name</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">SKU</th>
                  {columnVisibility.shopifySku && (
                    <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">
                      <div className="flex items-center gap-1">
                        <SiShopify className="h-3.5 w-3.5 text-green-600" />
                        Shopify SKU
                      </div>
                    </th>
                  )}
                  {columnVisibility.amazonSku && (
                    <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">
                      <div className="flex items-center gap-1">
                        <SiAmazon className="h-3.5 w-3.5 text-orange-500" />
                        Amazon SKU
                      </div>
                    </th>
                  )}
                  {columnVisibility.extensivSku && (
                    <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">
                      <div className="flex items-center gap-1">
                        <Package className="h-3.5 w-3.5 text-blue-600" />
                        Extensiv SKU
                      </div>
                    </th>
                  )}
                  {columnVisibility.upc && (
                    <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">
                      <div className="flex items-center gap-1">
                        <Package className="h-3.5 w-3.5 text-purple-600" />
                        UPC
                      </div>
                    </th>
                  )}
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Forecast</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Hildale Qty</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Pivot Qty</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Available for Sale</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Days to Stockout</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Backorders</th>
                  <th className="sticky right-0 z-10 bg-card p-3 text-right text-sm font-medium whitespace-nowrap w-px shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
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
                    backorderSnapshots={backorderSnapshots}
                    columnVisibility={columnVisibility}
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
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowQuickOrderDialog(true)}
              data-testid="button-quick-order-supplier"
            >
              <ShoppingCart className="mr-2 h-4 w-4" />
              Quick Order
            </Button>
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
            <table className="w-full table-auto">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Name</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">SKU</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Supplier</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Supplier SKU</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Unit Cost</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">MOQ</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Lead Time</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Stock</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">AI Reorder</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Category</th>
                  <th className="sticky right-0 z-10 bg-card p-3 text-right text-sm font-medium whitespace-nowrap w-px shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stockInventory.map((item: any) => (
                  <ItemTableRow
                    key={item.id}
                    item={item}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onReorder={setReorderItem}
                    onCostSettings={setCostSettingsItem}
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
      
      {/* Batch Production Dialog */}
      <BatchProductionDialog
        isOpen={isBatchProductionOpen}
        onClose={() => setIsBatchProductionOpen(false)}
      />
      
      {/* Transfer Dialog */}
      {transferItem && (
        <TransferDialog
          isOpen={!!transferItem}
          onClose={() => setTransferItem(null)}
          item={transferItem}
        />
      )}
      
      {/* Inventory Change Reason Dialog */}
      {pendingQuantityChange && (
        <InventoryChangeReasonDialog
          isOpen={!!pendingQuantityChange}
          onClose={() => {
            pendingQuantityChange.onError();
            setPendingQuantityChange(null);
          }}
          item={pendingQuantityChange.item}
          field={pendingQuantityChange.field}
          oldValue={pendingQuantityChange.oldValue}
          newValue={pendingQuantityChange.newValue}
          onConfirm={(reason: string, notes?: string) => {
            handleQuantityChangeWithReason(
              pendingQuantityChange.item,
              pendingQuantityChange.field,
              pendingQuantityChange.newValue,
              reason,
              notes,
              pendingQuantityChange.onSuccess,
              pendingQuantityChange.onError
            );
            setPendingQuantityChange(null);
          }}
        />
      )}
      {reorderItem && (
        <ReorderDialog
          isOpen={!!reorderItem}
          onClose={() => setReorderItem(null)}
          item={reorderItem}
        />
      )}
      {costSettingsItem && (
        <ItemCostSettingsDialog
          isOpen={!!costSettingsItem}
          onClose={() => setCostSettingsItem(null)}
          item={costSettingsItem}
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
      
      {/* SKU Mapping Wizard */}
      <SkuMappingWizard
        isOpen={isSkuMappingWizardOpen}
        onClose={() => setIsSkuMappingWizardOpen(false)}
      />

      {/* Quick Order from Supplier Dialog */}
      <QuickOrderDialog
        isOpen={showQuickOrderDialog}
        onClose={() => {
          setShowQuickOrderDialog(false);
          setSelectedSupplierForOrder("");
          setQuickOrderItems([]);
        }}
        stockItems={stockInventory}
      />

      {/* Verify Channel SKUs Results Modal */}
      <Dialog open={isVerifyModalOpen} onOpenChange={setIsVerifyModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Channel SKU Verification
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Verifies that mapped SKUs exist in each external channel via API
            </p>
          </DialogHeader>
          {verificationResults && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4">
                {/* Shopify Summary */}
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <SiShopify className="h-4 w-4 text-green-600" />
                        <span className="font-medium">Shopify</span>
                      </div>
                      {verificationResults.shopify?.apiStatus === "verified" && (
                        <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                          <Check className="mr-1 h-3 w-3" />
                          Verified
                        </Badge>
                      )}
                      {verificationResults.shopify?.apiStatus === "error" && (
                        <Badge variant="outline" className="bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                          <AlertCircle className="mr-1 h-3 w-3" />
                          Error
                        </Badge>
                      )}
                      {verificationResults.shopify?.apiStatus === "not_configured" && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Not Setup
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Found in Shopify:</span>
                        <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                          {verificationResults.shopify?.ok || 0}
                        </Badge>
                      </div>
                      {verificationResults.shopify?.missing > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Not Found:</span>
                          <Badge variant="outline" className="bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                            {verificationResults.shopify?.missing || 0}
                          </Badge>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Not Mapped:</span>
                        <Badge variant="outline" className="bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
                          {verificationResults.shopify?.unmapped || 0}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {/* Amazon Summary */}
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <SiAmazon className="h-4 w-4 text-orange-500" />
                        <span className="font-medium">Amazon</span>
                      </div>
                      {verificationResults.amazon?.apiStatus === "mapping_only" && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Mapping Only
                        </Badge>
                      )}
                      {verificationResults.amazon?.apiStatus === "not_configured" && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Not Setup
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mapped:</span>
                        <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                          {verificationResults.amazon?.ok || 0}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Not Mapped:</span>
                        <Badge variant="outline" className="bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
                          {verificationResults.amazon?.unmapped || 0}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {/* Extensiv Summary */}
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-blue-600" />
                        <span className="font-medium">Extensiv</span>
                      </div>
                      {verificationResults.extensiv?.apiStatus === "verified" && (
                        <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                          <Check className="mr-1 h-3 w-3" />
                          Verified
                        </Badge>
                      )}
                      {verificationResults.extensiv?.apiStatus === "error" && (
                        <Badge variant="outline" className="bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                          <AlertCircle className="mr-1 h-3 w-3" />
                          Error
                        </Badge>
                      )}
                      {verificationResults.extensiv?.apiStatus === "not_configured" && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Not Setup
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Found in Extensiv:</span>
                        <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                          {verificationResults.extensiv?.ok || 0}
                        </Badge>
                      </div>
                      {verificationResults.extensiv?.missing > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Not Found:</span>
                          <Badge variant="outline" className="bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                            {verificationResults.extensiv?.missing || 0}
                          </Badge>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Not Mapped:</span>
                        <Badge variant="outline" className="bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
                          {verificationResults.extensiv?.unmapped || 0}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Missing Items Details */}
              {(verificationResults.shopify?.missingItems?.length > 0 ||
                verificationResults.extensiv?.missingItems?.length > 0) && (
                <div className="space-y-3">
                  <h3 className="font-medium text-sm flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                    SKUs Not Found in External Systems
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    These channel SKUs were configured but could not be found via API lookup
                  </p>
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full table-auto text-sm">
                      <thead className="bg-muted/50">
                        <tr className="border-b">
                          <th className="p-2 text-left whitespace-nowrap w-px">Channel</th>
                          <th className="p-2 text-left whitespace-nowrap w-px">Channel SKU</th>
                          <th className="p-2 text-left whitespace-nowrap">Product Name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {verificationResults.shopify?.missingItems?.map((item: any, idx: number) => (
                          <tr key={`shopify-${idx}`} className="border-b">
                            <td className="p-2">
                              <div className="flex items-center gap-1">
                                <SiShopify className="h-3 w-3 text-green-600" />
                                Shopify
                              </div>
                            </td>
                            <td className="p-2 font-mono text-xs">{item.sku}</td>
                            <td className="p-2 text-muted-foreground">{item.name}</td>
                          </tr>
                        ))}
                        {verificationResults.extensiv?.missingItems?.map((item: any, idx: number) => (
                          <tr key={`extensiv-${idx}`} className="border-b">
                            <td className="p-2">
                              <div className="flex items-center gap-1">
                                <Package className="h-3 w-3 text-blue-600" />
                                Extensiv
                              </div>
                            </td>
                            <td className="p-2 font-mono text-xs">{item.sku}</td>
                            <td className="p-2 text-muted-foreground">{item.name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Notes */}
              {verificationResults.notes && (
                <div className="text-sm text-muted-foreground">
                  <p>{verificationResults.notes}</p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsVerifyModalOpen(false);
                    setIsSkuMappingWizardOpen(true);
                  }}
                  data-testid="button-open-mapping-wizard"
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  Open SKU Mapping
                </Button>
                <Button onClick={() => setIsVerifyModalOpen(false)} data-testid="button-close-verify-modal">
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
