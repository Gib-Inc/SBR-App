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
import { Plus, Search, Check, X, Trash2, Package, Edit, Upload, Download, Boxes, ShoppingCart, Brain, Info, DollarSign, Link2, SlidersHorizontal, CheckSquare, Square, ShieldCheck, Loader2, FileEdit, PackageMinus, ClipboardCheck, AlertCircle, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProductMarginChart } from "@/components/product-margin-chart";
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
import { DamageAssessmentPopup } from "@/components/damage-assessment-popup";
import { Factory, ArrowRightLeft } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface DamageAssessmentData {
  returnRequestId: string;
  rmaNumber?: string | null;
  orderNumber?: string | null;
  customerName?: string | null;
  baseRefundAmount?: number | null;
  totalReceived?: number | null;
  shippingCost?: number | null;
  labelFee?: number | null;
  items: Array<{
    id: string;
    sku: string;
    productName: string;
    unitPrice: number | null;
    qtyApproved: number;
    lineTotal: number | null;
    isDamaged: boolean;
    damagePhotoUrl?: string | null;
  }>;
}

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

const SBR_CATEGORIES = [
  "Catch Baskets",
  "Foam Rollers",
  "Frames",
  "Hardware",
  "Packaging",
  "Raw Materials",
  "Screens & Sleeves",
  "Other",
];

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

// Dedicated clean row for Stock Inventory with missing data indicators
function StockInventoryRow({
  item,
  showCategory,
  onDelete,
  onUpdate,
  onReorder,
  onCostSettings,
  aiRecommendations,
  safetyStockDays,
}: {
  item: any;
  showCategory: boolean;
  onDelete: (item: any) => void;
  onUpdate: (id: string, field: string, value: string | number, onSuccess: () => void, onError: () => void) => void;
  onReorder?: (item: any) => void;
  onCostSettings?: (item: any) => void;
  aiRecommendations?: any[];
  safetyStockDays?: number;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (field: string, val: string | number) => {
    setEditingField(field);
    setEditValue(String(val || ""));
  };
  const cancelEdit = () => { setEditingField(null); setEditValue(""); };
  const saveEdit = () => {
    if (!editingField) return;
    const isNumeric = editingField === "currentStock";
    const val = isNumeric ? Number(editValue) : editValue.trim();
    if (isNumeric && isNaN(val as number)) return;
    if (!isNumeric && !val) return;
    onUpdate(item.id, editingField, val as string | number, () => { setEditingField(null); setEditValue(""); }, () => {});
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveEdit();
    else if (e.key === "Escape") cancelEdit();
  };

  const missingSupplier = !item.primarySupplier?.supplierName;
  const missingCost = !item.primarySupplier?.unitCost;
  const missingVendorSku = !item.primarySupplier?.supplierSku;
  const missingUpc = !item.upc;

  const totalFields = 4;
  const filledFields = [!missingSupplier, !missingCost, !missingVendorSku, !missingUpc].filter(Boolean).length;
  const completePct = Math.round((filledFields / totalFields) * 100);

  const MissingBadge = ({ label }: { label: string }) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-xs cursor-help">
            <AlertCircle className="h-3 w-3" />
            <span>Missing</span>
          </span>
        </TooltipTrigger>
        <TooltipContent><p className="text-xs">{label} not set</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const itemRecommendation = aiRecommendations?.filter(
    (r: any) => r.itemId === item.id && r.status === "pending"
  ).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const bufferDays = safetyStockDays ?? 21;
  const dailyUsage = item.dailyUsage || 0;
  const currentStock = item.currentStock ?? 0;
  const safetyStockGap = Math.max(0, Math.ceil(dailyUsage * bufferDays - currentStock));

  return (
    <tr className="h-11 border-b hover:bg-muted/20 transition-colors" data-testid={`row-stock-${item.id}`}>
      {/* Category column (flat list mode) */}
      {showCategory && (
        <td className="px-3 align-middle whitespace-nowrap">
          {editingField === "category" ? (
            <div className="flex items-center gap-1">
              <select
                className="h-7 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                autoFocus
                onBlur={() => { if (editValue) saveEdit(); else cancelEdit(); }}
              >
                <option value="">Select...</option>
                {SBR_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={saveEdit} className="text-green-600"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={cancelEdit} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <span
              className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium cursor-pointer hover:bg-muted/80"
              onClick={() => startEdit("category", item.category || "")}
              title="Click to change category"
            >
              {item.category || <span className="text-amber-500">Set category</span>}
            </span>
          )}
        </td>
      )}

      {/* Name */}
      <td className="px-3 align-middle whitespace-nowrap">
        <div className="flex items-center gap-2">
          {editingField === "name" ? (
            <div className="flex items-center gap-1">
              <input
                className="h-7 w-40 rounded border border-border bg-background px-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
              <button onClick={saveEdit} className="text-green-600 hover:text-green-700"><Check className="h-4 w-4" /></button>
              <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <span
              className="cursor-pointer hover:underline text-sm font-medium"
              onClick={() => startEdit("name", item.name)}
            >
              {item.name}
            </span>
          )}
          {/* Completeness dot */}
          {completePct < 100 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`h-2 w-2 rounded-full flex-shrink-0 cursor-help ${completePct === 0 ? "bg-red-500" : completePct < 75 ? "bg-amber-500" : "bg-yellow-400"}`} />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{filledFields}/{totalFields} key fields filled ({completePct}%)</p>
                  {missingSupplier && <p className="text-xs text-amber-400">· Supplier missing</p>}
                  {missingCost && <p className="text-xs text-amber-400">· Unit cost missing</p>}
                  {missingVendorSku && <p className="text-xs text-amber-400">· Vendor SKU missing</p>}
                  {missingUpc && <p className="text-xs text-amber-400">· UPC missing</p>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </td>

      {/* SKU */}
      <td className="px-3 align-middle whitespace-nowrap">
        <span className="font-mono text-xs text-muted-foreground">{item.sku || "—"}</span>
      </td>

      {/* Supplier */}
      <td className="px-3 align-middle whitespace-nowrap">
        {missingSupplier
          ? <MissingBadge label="Supplier" />
          : <span className="text-sm">{item.primarySupplier.supplierName}</span>
        }
      </td>

      {/* Vendor SKU */}
      <td className="px-3 align-middle whitespace-nowrap">
        {missingVendorSku
          ? <MissingBadge label="Vendor SKU" />
          : <span className="font-mono text-xs">{item.primarySupplier.supplierSku}</span>
        }
      </td>

      {/* UPC */}
      <td className="px-3 align-middle whitespace-nowrap">
        {editingField === "upc" ? (
          <div className="flex items-center gap-1">
            <input
              className="h-7 w-32 rounded border border-border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter UPC..."
              autoFocus
            />
            <button onClick={saveEdit} className="text-green-600"><Check className="h-3.5 w-3.5" /></button>
            <button onClick={cancelEdit} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : missingUpc ? (
          <span
            className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-xs cursor-pointer hover:underline"
            onClick={() => startEdit("upc", "")}
            title="Click to add UPC"
          >
            <AlertCircle className="h-3 w-3" />
            <span>Add UPC</span>
          </span>
        ) : (
          <span
            className="font-mono text-xs cursor-pointer hover:underline"
            onClick={() => startEdit("upc", item.upc)}
          >
            {item.upc}
          </span>
        )}
      </td>

      {/* Unit Cost */}
      <td className="px-3 align-middle whitespace-nowrap text-right">
        {missingCost
          ? <MissingBadge label="Unit cost" />
          : <span className="text-sm font-mono">${item.primarySupplier.unitCost.toFixed(2)}</span>
        }
      </td>

      {/* Safety Stock Gap */}
      <td className="px-3 align-middle whitespace-nowrap text-right">
        {safetyStockGap > 0
          ? <span className="text-amber-600 dark:text-amber-400 font-medium text-sm">{safetyStockGap}</span>
          : <span className="text-green-600 dark:text-green-400 text-sm">0</span>
        }
      </td>

      {/* MOQ */}
      <td className="px-3 align-middle whitespace-nowrap text-right">
        <span className="text-sm">{item.primarySupplier?.minimumOrderQuantity || <span className="text-muted-foreground">—</span>}</span>
      </td>

      {/* Lead Time */}
      <td className="px-3 align-middle whitespace-nowrap text-right">
        <span className="text-sm">
          {item.primarySupplier?.leadTimeDays
            ? `${item.primarySupplier.leadTimeDays}d`
            : <span className="text-muted-foreground">—</span>
          }
        </span>
      </td>

      {/* Stock */}
      <td className="px-3 align-middle whitespace-nowrap text-right">
        {editingField === "currentStock" ? (
          <div className="flex items-center justify-end gap-1">
            <input
              type="number"
              className="h-7 w-20 rounded border border-border bg-background px-2 text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button onClick={saveEdit} className="text-green-600"><Check className="h-4 w-4" /></button>
            <button onClick={cancelEdit} className="text-muted-foreground"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <span
            className="cursor-pointer font-mono text-sm hover:underline"
            onClick={() => startEdit("currentStock", currentStock)}
          >
            {currentStock}
          </span>
        )}
      </td>

      {/* AI Reorder */}
      <td className="px-3 align-middle whitespace-nowrap">
        {itemRecommendation ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onReorder?.(item)}
                  className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <Brain className="h-3.5 w-3.5" />
                  Order {itemRecommendation.recommendedOrderQty}
                </button>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs max-w-48">{itemRecommendation.reason || "AI reorder recommendation"}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="sticky right-0 z-10 bg-card px-3 align-middle whitespace-nowrap shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">
        <div className="flex items-center justify-end gap-1">
          {onCostSettings && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onCostSettings(item)}>
                    <DollarSign className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Cost settings</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(item)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs">Delete item</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </td>
    </tr>
  );
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
  safetyStockDays,
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
  safetyStockDays?: number;
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
            {item.upc ? (
              item.upc
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 cursor-help">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span className="text-xs">Missing</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">UPC/GTIN required for marketplace identification</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
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

          {/* Safety Stock Gap (Calculated: dailyUsage * 21 - currentStock) */}
          <td className="px-3 align-middle whitespace-nowrap">
            <div className="px-2 py-1 text-right text-sm" data-testid={`text-safety-stock-gap-${item.id}`}>
              {(() => {
                const dailyUsage = item.dailyUsage || 0;
                const bufferDays = 21;
                const currentStock = item.currentStock ?? 0;
                const calculated = Math.max(0, Math.ceil(dailyUsage * bufferDays - currentStock));
                return calculated > 0 ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={calculated > 0 ? "text-amber-600 dark:text-amber-400 font-medium cursor-help" : ""}>
                          {calculated}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">Units needed for {bufferDays}-day safety buffer</p>
                        <p className="text-xs text-muted-foreground">Daily usage: {dailyUsage.toFixed(1)} | Stock: {currentStock}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <span className="text-green-600 dark:text-green-400">0</span>
                );
              })()}
            </div>
          </td>

          {/* Supplier MOQ */}
          <td className="px-3 align-middle whitespace-nowrap">
            <div className="px-2 py-1 text-right text-sm" data-testid={`text-supplier-moq-${item.id}`}>
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

      {/* Extensiv Column (only for finished products) - Extensiv mirror */}
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

      {/* Sell Price Column — inline editable, finished products only */}
      {item.type === "finished_product" && (
        <td className="px-3 align-middle whitespace-nowrap text-right">
          {editingField === "sellingPrice" ? (
            <div className="flex items-center gap-1 justify-end">
              <span className="text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                className="h-7 w-24 text-right text-sm"
                autoFocus
              />
              <Button size="icon" variant="ghost" onClick={saveEdit} className="h-7 w-7"><Check className="h-3 w-3" /></Button>
              <Button size="icon" variant="ghost" onClick={cancelEdit} className="h-7 w-7"><X className="h-3 w-3" /></Button>
            </div>
          ) : (
            <div
              className="cursor-pointer rounded px-2 py-1 hover-elevate text-right text-sm"
              onClick={() => startEdit("sellingPrice", item.sellingPrice ?? "")}
              data-testid={`text-selling-price-${item.id}`}
            >
              {item.sellingPrice != null
                ? `$${Number(item.sellingPrice).toFixed(2)}`
                : <span className="text-muted-foreground italic">Set price</span>}
            </div>
          )}
        </td>
      )}

      {/* Margin Column — calculated from sellingPrice vs bomBuildCost, read-only.
          A bomBuildCost of 0 or null means we don't actually know what it costs
          to build this product, so showing 100% (selling price ÷ selling price)
          would be false data. Suppress the % until cost is genuinely > 0. */}
      {item.type === "finished_product" && (
        <td className="px-3 align-middle whitespace-nowrap text-right text-sm">
          {item.sellingPrice != null && item.sellingPrice > 0 && item.bomBuildCost != null && item.bomBuildCost > 0 ? (() => {
            const margin = item.sellingPrice - item.bomBuildCost;
            const pct = (margin / item.sellingPrice) * 100;
            const color = pct >= 40 ? "text-green-600 dark:text-green-400"
              : pct >= 20 ? "text-yellow-600 dark:text-yellow-400"
              : "text-red-600 dark:text-red-400";
            return (
              <span className={color} title={`Build cost: $${item.bomBuildCost.toFixed(2)}`}>
                {pct.toFixed(1)}%
              </span>
            );
          })() : <span className="text-muted-foreground" title="Cost not confirmed — set BOM costs to compute margin">—</span>}
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
  const [bomComponents, setBomComponents] = useState<Array<{ componentId: string; quantity: number; wastagePercent: number }>>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const { data: bomData, isLoading } = useQuery({
    queryKey: ["/api/bom", item?.id],
    enabled: !!item?.id && isOpen,
  });

  const { data: costRollup } = useQuery({
    queryKey: ["/api/bom", item?.id, "cost-rollup"],
    queryFn: async () => {
      const res = await fetch(`/api/bom/${item.id}/cost-rollup`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!item?.id && isOpen,
  });

  // Initialize form state only once when data is loaded
  useEffect(() => {
    if (isOpen && !isLoading && !isInitialized) {
      if (bomData && Array.isArray(bomData) && bomData.length > 0) {
        const transformed = bomData.map((bom: any) => ({
          componentId: bom.componentId,
          quantity: bom.quantityRequired,
          wastagePercent: bom.wastagePercent ?? 0,
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
    mutationFn: async (components: Array<{ componentId: string; quantity: number; wastagePercent: number }>) => {
      const response = await apiRequest("POST", `/api/bom/${item.id}`, { components: components.map(c => ({
        componentId: c.componentId,
        quantity: c.quantity,
        wastagePercent: c.wastagePercent,
      })) });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to update BOM" }));
        throw new Error(errorData.error || "Failed to update BOM");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bom", item.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/bom", item.id, "cost-rollup"] });
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
    setBomComponents([...bomComponents, { componentId: "", quantity: 1, wastagePercent: 0 }]);
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
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {bomComponents.map((component, index) => {
                  const isInvalid = !component.componentId || component.quantity <= 0;
                  return (
                    <div key={index} className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Component</Label>
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
                      <div className="w-24 space-y-1">
                        <Label className="text-xs">Qty</Label>
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
                      <div className="w-24 space-y-1">
                        <Label className="text-xs flex items-center gap-1">
                          Waste %
                          <span className="text-muted-foreground cursor-help" title="Extra material consumed per unit. E.g. 5 = 5% more than qty required.">ⓘ</span>
                        </Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={component.wastagePercent ?? 0}
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value);
                            updateComponent(index, "wastagePercent", isNaN(parsed) ? 0 : parsed);
                          }}
                          disabled={updateBOMMutation.isPending}
                          data-testid={`input-bom-wastage-${index}`}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeComponent(index)}
                        disabled={updateBOMMutation.isPending}
                        data-testid={`button-remove-bom-component-${index}`}
                        className="mb-0.5"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Cost Rollup Panel */}
            {costRollup && (
              <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between font-medium">
                  <span>Cost Summary</span>
                  {costRollup.hasMissingCosts && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">⚠ Some component costs missing</span>
                  )}
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Build cost</span>
                  <span className="font-mono">
                    {costRollup.totalBuildCost != null ? `$${costRollup.totalBuildCost.toFixed(2)}` : "—"}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Sell price</span>
                  <span className="font-mono">
                    {costRollup.sellingPrice != null ? `$${costRollup.sellingPrice.toFixed(2)}` : <span className="italic">Not set</span>}
                  </span>
                </div>
                {costRollup.grossMargin != null && (
                  <>
                    <div className="border-t pt-2 flex justify-between font-medium">
                      <span>Gross margin</span>
                      <span className={`font-mono ${costRollup.marginPercent >= 40 ? "text-green-600 dark:text-green-400" : costRollup.marginPercent >= 20 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>
                        ${costRollup.grossMargin.toFixed(2)} ({costRollup.marginPercent.toFixed(1)}%)
                      </span>
                    </div>
                  </>
                )}

                {/* 12-month margin trend — surfaces what's eroded on the cost
                    side (sellingPrice held constant; PO history drives builds). */}
                {item?.id && (
                  <div className="border-t pt-2">
                    <ProductMarginChart productId={item.id} />
                  </div>
                )}

                {/* Per-component "No price set" callout — shows which BOM lines
                    are blocking the margin so the user knows what to update. */}
                {Array.isArray(costRollup.lines) && costRollup.lines.some((l: any) => l.missingCost) && (
                  <div className="border-t pt-2 space-y-1">
                    <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      Components without a supplier price:
                    </div>
                    <ul className="text-xs space-y-0.5">
                      {costRollup.lines
                        .filter((l: any) => l.missingCost)
                        .map((l: any) => (
                          <li
                            key={l.componentId}
                            className="text-muted-foreground flex items-center gap-1.5"
                            data-testid={`missing-cost-${l.componentId}`}
                          >
                            <span className="text-amber-600 dark:text-amber-400">⚠</span>
                            <span className="font-medium text-foreground">{l.componentName}</span>
                            <span>— No price set</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
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

function ReorderDialog({ isOpen, onClose, item, aiRecommendations = [] }: { isOpen: boolean; onClose: () => void; item: any; aiRecommendations?: any[] }) {
  const { toast } = useToast();
  const [orderQty, setOrderQty] = useState("");
  const [poMode, setPoMode] = useState<"new" | "existing">("new");
  const [selectedExistingPO, setSelectedExistingPO] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");

  if (!item) return null;

  // CRITICAL: Finished products use hildaleQty + pivotQty, components use currentStock
  const isFinished = item.type === "finished_product";
  const totalStock = isFinished 
    ? (item.hildaleQty ?? 0) + (item.pivotQty ?? 0)
    : (item.currentStock ?? 0);
  
  // No floor on dailyUsage — when nothing is selling we want days-of-cover
  // and safety-stock gap to honestly read 0/—, not a phantom number derived
  // from a pretend 1/day rate.
  const dailyUsage = item.dailyUsage ?? 0;
  const daysOfCover = dailyUsage > 0 ? Math.floor(totalStock / dailyUsage) : 0;

  // Calculate safety stock gap (21-day buffer)
  const safetyStockGap = dailyUsage > 0 ? Math.max(0, Math.ceil(dailyUsage * 21 - totalStock)) : 0;
  const supplierMOQ = item.primarySupplier?.minimumOrderQuantity || 0;

  // Fetch purchase orders and suppliers
  const { data: allPOs = [] } = useQuery<any[]>({
    queryKey: ['/api/purchase-orders'],
    enabled: isOpen,
  });

  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ['/api/suppliers'],
    enabled: isOpen,
  });

  // Use primary supplier if available, otherwise use selected supplier
  const supplier = item.primarySupplier 
    ? suppliers.find(s => s.id === item.primarySupplier?.supplierId)
    : suppliers.find(s => s.id === selectedSupplierId);
  const draftPOs = allPOs.filter(
    po => po.supplierId === supplier?.id && ['DRAFT', 'APPROVAL_PENDING'].includes(po.status)
  );

  const createAndSendPOMutation = useMutation({
    mutationFn: async (data: { mode: "new" | "existing"; qty: number; poId?: string }) => {
      if (!supplier) throw new Error("No supplier configured");
      
      const qty = data.qty;
      const unitCost = item.defaultPurchaseCost || item.primarySupplier?.unitCost || item.primarySupplier?.price || 0;

      if (data.mode === "new") {
        // Create new PO as DRAFT first
        const createRes = await apiRequest("POST", "/api/purchase-orders", {
          supplierId: supplier.id,
          status: "DRAFT",
          lines: [{
            itemId: item.id,
            qtyOrdered: qty,
            unitCost,
          }],
        });
        if (!createRes.ok) {
          const errText = await createRes.text();
          throw new Error(errText || "Failed to create purchase order");
        }
        const newPO = await createRes.json();
        
        // Immediately send the PO
        const sendRes = await apiRequest("POST", `/api/purchase-orders/${newPO.id}/send`, {});
        if (!sendRes.ok) {
          const sendErr = await sendRes.json();
          throw new Error(sendErr.error || "PO created but failed to send email. Check supplier has a valid email address.");
        }
        const sentPO = await sendRes.json();
        return { ...sentPO, emailSent: true };
      } else {
        // Add to existing PO (stays as draft - user can send separately)
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
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      // Use result.emailSent flag to determine which toast to show (set only for new POs that were sent)
      if (result.emailSent) {
        toast({ 
          title: "Purchase order sent!", 
          description: result.emailTo ? `Email sent to ${result.emailTo}` : "Email sent to supplier",
        });
      } else {
        toast({ title: "Line added to PO" });
      }
      onClose();
      setOrderQty("");
      setPoMode("new");
      setSelectedExistingPO("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send PO", description: error.message, variant: "destructive" });
    },
  });

  const handleSendPO = () => {
    const qty = parseInt(orderQty) || safetyStockGap;
    
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

    createAndSendPOMutation.mutate({
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

          {/* Current Stock, Safety Stock Gap & AI Recommendation - side by side */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {isFinished ? "Total Stock" : "Current Stock"}
              </p>
              <div className="text-xl font-bold">{totalStock}</div>
              <p className="text-[10px] text-muted-foreground">{daysOfCover} days cover</p>
            </Card>
            <Card className="p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Safety Stock Gap</p>
              <div className="text-xl font-bold">{safetyStockGap}</div>
              <p className="text-[10px] text-muted-foreground">21-day buffer</p>
            </Card>
            {(() => {
              const itemRecs = aiRecommendations.filter((r: any) => r.itemId === item.id && r.status === 'pending');
              const latestRec = itemRecs.length > 0 ? itemRecs[itemRecs.length - 1] : null;
              return (
                <Card className="p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    AI Rec
                  </p>
                  <div className="text-xl font-bold text-primary">
                    {latestRec ? (latestRec.suggestedQty || latestRec.quantity || "—") : "—"}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {latestRec ? "LLM suggestion" : "No rec available"}
                  </p>
                </Card>
              );
            })()}
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
                    <p className="text-sm text-muted-foreground">Supplier MOQ</p>
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
              <CardHeader>
                <CardTitle className="text-sm font-medium">Select Supplier</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">No primary supplier configured. Select a supplier for this order:</p>
                <Select 
                  value={selectedSupplierId} 
                  onValueChange={setSelectedSupplierId}
                >
                  <SelectTrigger data-testid="select-supplier-for-order">
                    <SelectValue placeholder="Choose a supplier..." />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              placeholder={`Suggested: ${safetyStockGap}`}
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
              onClick={handleSendPO}
              disabled={!supplier || createAndSendPOMutation.isPending}
              data-testid="button-send-po-from-reorder"
            >
              {createAndSendPOMutation.isPending 
                ? "Sending..." 
                : poMode === "new" 
                  ? "Send PO" 
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
  // Cost settings fields
  const [defaultPurchaseCost, setDefaultPurchaseCost] = useState("");
  const [purchaseCurrency, setPurchaseCurrency] = useState("USD");
  const [supplierProductUrl, setSupplierProductUrl] = useState("");

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
      setDefaultPurchaseCost("");
      setPurchaseCurrency("USD");
      setSupplierProductUrl("");
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
    
    // Cost settings (for both finished products and components)
    if (defaultPurchaseCost.trim()) {
      payload.defaultPurchaseCost = defaultPurchaseCost.trim();
      payload.purchaseCurrency = purchaseCurrency;
    }
    if (supplierProductUrl.trim()) {
      payload.supplierProductUrl = supplierProductUrl.trim();
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
                  <Label htmlFor="extensiv-qty">Extensiv Qty</Label>
                  <Input
                    id="extensiv-qty"
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
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="category" data-testid="input-create-category">
                  <SelectValue placeholder="Select a category..." />
                </SelectTrigger>
                <SelectContent>
                  {SBR_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          
          {/* Cost Settings (Optional) */}
          <div className="space-y-3 border-t pt-4">
            <Label className="text-sm font-medium">Cost Settings (Optional)</Label>
            <div className="space-y-2">
              <Label htmlFor="purchase-cost" className="text-xs">Default Purchase Cost</Label>
              <div className="flex gap-2">
                <span className="flex items-center text-sm text-muted-foreground w-4">
                  {purchaseCurrency === "USD" || purchaseCurrency === "CAD" ? "$" : 
                   purchaseCurrency === "EUR" ? "€" : 
                   purchaseCurrency === "GBP" ? "£" : 
                   purchaseCurrency === "CNY" ? "¥" : "$"}
                </span>
                <Input
                  id="purchase-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={defaultPurchaseCost}
                  onChange={(e) => setDefaultPurchaseCost(e.target.value)}
                  placeholder="0.00"
                  className="flex-1"
                  data-testid="input-create-purchase-cost"
                />
                <select
                  value={purchaseCurrency}
                  onChange={(e) => setPurchaseCurrency(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  data-testid="select-create-currency"
                >
                  <option value="USD">USD</option>
                  <option value="CAD">CAD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="CNY">CNY</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-url" className="text-xs">Supplier Product URL</Label>
              <Input
                id="supplier-url"
                value={supplierProductUrl}
                onChange={(e) => setSupplierProductUrl(e.target.value)}
                placeholder="https://supplier.com/product/123"
                data-testid="input-create-supplier-url"
              />
              <p className="text-xs text-muted-foreground">URL to the supplier's product page for price suggestions</p>
            </div>
          </div>
          
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
  const fieldLabel = field === "hildaleQty" ? "Hildale" : field === "pivotQty" ? "Extensiv" : field === "currentStock" ? "Stock" : field;

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
  const [stockSortField, setStockSortField] = useState<string>("category");
  const [stockSortDir, setStockSortDir] = useState<"asc" | "desc">("asc");
  const [groupByCategory, setGroupByCategory] = useState(true);
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
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [isBatchProductionOpen, setIsBatchProductionOpen] = useState(false);
  const [transferItem, setTransferItem] = useState<any>(null);
  const [isBulkTransferOpen, setIsBulkTransferOpen] = useState(false);
  const [damageAssessmentData, setDamageAssessmentData] = useState<DamageAssessmentData | null>(null);
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

  const { data: aiAgentRules } = useQuery<{ safetyStockDays?: number }>({
    queryKey: ["/api/ai-agent-rules"],
  });
  
  const safetyStockDays = aiAgentRules?.safetyStockDays ?? 7;

  const allItems = (items as any[]) ?? [];
  
  const filteredItems = allItems.filter((item: any) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.sku && item.sku.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const finishedProducts = filteredItems.filter((item: any) => item.type === "finished_product");
  const stockInventory = filteredItems.filter((item: any) => item.type === "component");

  // Sort stock inventory
  const sortedStockInventory = [...stockInventory].sort((a: any, b: any) => {
    let aVal: any, bVal: any;
    if (stockSortField === "category") {
      aVal = (a.category || "Uncategorized").toLowerCase();
      bVal = (b.category || "Uncategorized").toLowerCase();
      if (aVal === bVal) {
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        return aVal.localeCompare(bVal);
      }
    } else if (stockSortField === "name") {
      aVal = a.name.toLowerCase();
      bVal = b.name.toLowerCase();
    } else if (stockSortField === "supplier") {
      aVal = (a.primarySupplier?.supplierName || "").toLowerCase();
      bVal = (b.primarySupplier?.supplierName || "").toLowerCase();
    } else if (stockSortField === "cost") {
      // Nulls always last, regardless of direction
      const aCost = a.primarySupplier?.unitCost;
      const bCost = b.primarySupplier?.unitCost;
      if (aCost == null && bCost == null) return 0;
      if (aCost == null) return 1;
      if (bCost == null) return -1;
      aVal = aCost;
      bVal = bCost;
    } else if (stockSortField === "stock") {
      aVal = a.currentStock ?? 0;
      bVal = b.currentStock ?? 0;
    } else {
      aVal = a.name.toLowerCase();
      bVal = b.name.toLowerCase();
    }
    const cmp = typeof aVal === "string" ? aVal.localeCompare(bVal) : (aVal - bVal);
    return stockSortDir === "asc" ? cmp : -cmp;
  });

  // Group by category
  const stockByCategory: Record<string, any[]> = {};
  for (const item of sortedStockInventory) {
    const cat = item.category || "Uncategorized";
    if (!stockByCategory[cat]) stockByCategory[cat] = [];
    stockByCategory[cat].push(item);
  }
  const categoryOrder = Object.keys(stockByCategory).sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  const handleStockSort = (field: string) => {
    if (stockSortField === field) {
      setStockSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setStockSortField(field);
      setStockSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (stockSortField !== field) return <span className="ml-1 text-muted-foreground/40">↕</span>;
    return <span className="ml-1">{stockSortDir === "asc" ? "↑" : "↓"}</span>;
  };

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
        description: `${item.name} ${field === "hildaleQty" ? "Hildale" : field === "pivotQty" ? "Extensiv" : "Stock"} quantity updated to ${newValue}`,
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
              onClick={() => setIsBulkTransferOpen(true)}
              data-testid="button-bulk-transfer"
            >
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Transfer
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
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Extensiv</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Available for Sale</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Days to Stockout</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Sell Price</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Margin</th>
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
            <p className="text-sm text-muted-foreground">
              Components and raw materials · {sortedStockInventory.length} items
              {sortedStockInventory.filter((i: any) => !i.primarySupplier?.supplierName || !i.primarySupplier?.unitCost).length > 0 && (
                <span className="ml-2 text-amber-600 dark:text-amber-400 font-medium">
                  ⚠ {sortedStockInventory.filter((i: any) => !i.primarySupplier?.supplierName || !i.primarySupplier?.unitCost).length} items with missing data
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <button
              onClick={() => setGroupByCategory(g => !g)}
              className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${groupByCategory ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:text-foreground"}`}
            >
              {groupByCategory ? "Grouped" : "Flat List"}
            </button>
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
        ) : sortedStockInventory.length === 0 ? (
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
                  {groupByCategory && <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px text-muted-foreground">Category</th>}
                  <th
                    className="p-3 text-left text-sm font-medium whitespace-nowrap cursor-pointer select-none hover:bg-muted/80"
                    onClick={() => handleStockSort("name")}
                  >
                    Name <SortIcon field="name" />
                  </th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">SKU</th>
                  <th
                    className="p-3 text-left text-sm font-medium whitespace-nowrap w-px cursor-pointer select-none hover:bg-muted/80"
                    onClick={() => handleStockSort("supplier")}
                  >
                    Supplier <SortIcon field="supplier" />
                  </th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Vendor SKU</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">UPC</th>
                  <th
                    className="p-3 text-right text-sm font-medium whitespace-nowrap w-px cursor-pointer select-none hover:bg-muted/80"
                    onClick={() => handleStockSort("cost")}
                  >
                    Unit Cost <SortIcon field="cost" />
                  </th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Safety Stock Gap</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">MOQ</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Lead Time</th>
                  <th
                    className="p-3 text-right text-sm font-medium whitespace-nowrap w-px cursor-pointer select-none hover:bg-muted/80"
                    onClick={() => handleStockSort("stock")}
                  >
                    Stock <SortIcon field="stock" />
                  </th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">AI Reorder</th>
                  <th className="sticky right-0 z-10 bg-card p-3 text-right text-sm font-medium whitespace-nowrap w-px shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groupByCategory ? (
                  categoryOrder.map((cat) => (
                    <>
                      {/* Category header row */}
                      <tr key={`cat-header-${cat}`} className="bg-muted/30 border-b border-t">
                        <td
                          colSpan={14}
                          className="px-3 py-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cat}</span>
                            <span className="text-xs text-muted-foreground">({stockByCategory[cat].length})</span>
                            {stockByCategory[cat].some((i: any) => !i.primarySupplier?.supplierName || !i.primarySupplier?.unitCost || !i.primarySupplier?.supplierSku) && (
                              <span className="text-xs text-amber-600 dark:text-amber-400">· missing data</span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {stockByCategory[cat].map((item: any) => (
                        <StockInventoryRow
                          key={item.id}
                          item={item}
                          showCategory={true}
                          onUpdate={handleUpdate}
                          onDelete={handleDelete}
                          onReorder={setReorderItem}
                          onCostSettings={setCostSettingsItem}
                          aiRecommendations={aiRecommendations}
                          safetyStockDays={safetyStockDays}
                        />
                      ))}
                    </>
                  ))
                ) : (
                  sortedStockInventory.map((item: any) => (
                    <StockInventoryRow
                      key={item.id}
                      item={item}
                      showCategory={true}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                      onReorder={setReorderItem}
                      onCostSettings={setCostSettingsItem}
                      aiRecommendations={aiRecommendations}
                      safetyStockDays={safetyStockDays}
                    />
                  ))
                )}
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
      
      {/* Transfer Dialog - Single Item */}
      {transferItem && (
        <TransferDialog
          isOpen={!!transferItem}
          onClose={() => setTransferItem(null)}
          item={transferItem}
        />
      )}
      
      {/* Transfer Dialog - Bulk Mode */}
      <TransferDialog
        isOpen={isBulkTransferOpen}
        onClose={() => setIsBulkTransferOpen(false)}
        bulkMode={true}
      />
      
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
          aiRecommendations={aiRecommendations}
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
        onReturnScanDetected={(data) => {
          setIsScanModalOpen(false);
          setDamageAssessmentData({
            returnRequestId: data.returnRequestId,
            rmaNumber: data.rmaNumber,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            baseRefundAmount: data.baseRefundAmount,
            totalReceived: data.totalReceived,
            shippingCost: data.shippingCost,
            labelFee: data.labelFee,
            items: data.items,
          });
        }}
      />
      
      {/* Damage Assessment Popup */}
      {damageAssessmentData && (
        <DamageAssessmentPopup
          isOpen={!!damageAssessmentData}
          onClose={() => setDamageAssessmentData(null)}
          returnRequestId={damageAssessmentData.returnRequestId}
          rmaNumber={damageAssessmentData.rmaNumber}
          orderNumber={damageAssessmentData.orderNumber}
          customerName={damageAssessmentData.customerName}
          baseRefundAmount={damageAssessmentData.baseRefundAmount}
          totalReceived={damageAssessmentData.totalReceived}
          shippingCost={damageAssessmentData.shippingCost}
          labelFee={damageAssessmentData.labelFee}
          items={damageAssessmentData.items}
          onAssessmentComplete={() => setDamageAssessmentData(null)}
        />
      )}
      
      {/* SKU Mapping Wizard */}
      <SkuMappingWizard
        isOpen={isSkuMappingWizardOpen}
        onClose={() => setIsSkuMappingWizardOpen(false)}
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
