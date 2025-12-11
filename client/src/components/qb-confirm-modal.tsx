import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle, XCircle, Search, AlertTriangle, DollarSign, Building2, Percent } from "lucide-react";
import { SiQuickbooks } from "react-icons/si";

interface QBItem {
  quickbooksItemId: string;
  name: string;
  sku: string;
  purchaseCost: number | null;
  unitPrice: number | null;
  type: string;
  taxRate: number | null;
}

interface QBVendor {
  quickbooksVendorId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface QBLookupResult {
  success: boolean;
  item?: QBItem;
  vendor?: QBVendor;
  error?: string;
}

interface QBSearchItem {
  id: string;
  name: string;
  sku: string | null;
  type: string;
  purchaseCost: number | null;
  preferredVendorName: string | null;
}

interface QBConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemSku: string;
  itemName: string;
  onApply: (data: {
    unitCost: number;
    taxRate: number | null;
    vendorName: string | null;
    vendorId: string | null;
    quickbooksItemId: string | null;
  }) => void;
  onManual: () => void;
}

export function QBConfirmModal({
  isOpen,
  onClose,
  itemSku,
  itemName,
  onApply,
  onManual,
}: QBConfirmModalProps) {
  const [loading, setLoading] = useState(false);
  const [qbData, setQBData] = useState<QBLookupResult | null>(null);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<QBSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    if (isOpen && itemSku) {
      lookupItem();
    }
  }, [isOpen, itemSku]);

  useEffect(() => {
    if (!isOpen) {
      setQBData(null);
      setSearchMode(false);
      setSearchQuery("");
      setSearchResults([]);
    }
  }, [isOpen]);

  const lookupItem = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/quickbooks/items/lookup/${encodeURIComponent(itemSku)}`);
      const data = await response.json();
      setQBData(data);
      
      if (!data.success) {
        setSearchMode(true);
        setSearchQuery(itemName);
      }
    } catch (error) {
      setQBData({ success: false, error: "Failed to connect to QuickBooks" });
      setSearchMode(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (searchQuery.length < 2) return;
    
    setSearchLoading(true);
    try {
      const response = await fetch(`/api/quickbooks/items/search?q=${encodeURIComponent(searchQuery)}&limit=10`);
      const data = await response.json();
      if (data.success) {
        setSearchResults(data.items || []);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSelectSearchResult = async (item: QBSearchItem) => {
    if (item.sku) {
      setLoading(true);
      try {
        const response = await fetch(`/api/quickbooks/items/lookup/${encodeURIComponent(item.sku)}`);
        const data = await response.json();
        setQBData(data);
        setSearchMode(false);
      } catch (error) {
        console.error("Lookup error:", error);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleApplyQBData = () => {
    if (qbData?.success && qbData.item) {
      onApply({
        unitCost: qbData.item.purchaseCost || 0,
        taxRate: qbData.item.taxRate,
        vendorName: qbData.vendor?.name || null,
        vendorId: qbData.vendor?.quickbooksVendorId || null,
        quickbooksItemId: qbData.item.quickbooksItemId,
      });
    }
    onClose();
  };

  const handleManualEntry = () => {
    onManual();
    onClose();
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return "N/A";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-qb-modal-title">
            <SiQuickbooks className="h-5 w-5 text-green-600" />
            Use QuickBooks Info?
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">Looking up in QuickBooks...</p>
            </div>
          ) : qbData?.success && qbData.item ? (
            <div className="space-y-4">
              {/* Warning for Inventory items - POs are only for NonInventory (raw materials) */}
              {qbData.item.type === "Inventory" && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <div className="font-medium text-amber-800 dark:text-amber-200">Finished Product Detected</div>
                    <div className="text-amber-700 dark:text-amber-300 mt-1">
                      This is an Inventory item (finished product). Purchase orders are typically for NonInventory items (raw materials). 
                      You may want to use manual entry or search for the raw material version.
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Item</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={qbData.item.type === "NonInventory" ? "text-green-600 border-green-600" : "text-amber-600 border-amber-600"}>
                      {qbData.item.type}
                    </Badge>
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Found
                    </Badge>
                  </div>
                </div>
                
                <div className="text-sm text-muted-foreground">
                  {qbData.item.name}
                  {qbData.item.sku && (
                    <span className="ml-2 text-xs">({qbData.item.sku})</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground">Unit Cost</div>
                      <div className="font-medium">{formatCurrency(qbData.item.purchaseCost)}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Percent className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground">Tax Rate</div>
                      <div className="font-medium">
                        {qbData.item.taxRate !== null ? `${qbData.item.taxRate}%` : "N/A"}
                      </div>
                    </div>
                  </div>
                </div>

                {qbData.vendor && (
                  <div className="pt-2 border-t">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="text-xs text-muted-foreground">Preferred Vendor</div>
                        <div className="font-medium">{qbData.vendor.name}</div>
                        {qbData.vendor.email && (
                          <div className="text-xs text-muted-foreground">{qbData.vendor.email}</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : searchMode ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
                <span className="text-sm">
                  No exact match found for SKU: {itemSku}
                </span>
              </div>
              
              <div className="space-y-2">
                <Label>Search QuickBooks for similar items</Label>
                <div className="flex gap-2">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name..."
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    data-testid="input-qb-search"
                  />
                  <Button 
                    size="icon" 
                    variant="outline" 
                    onClick={handleSearch}
                    disabled={searchLoading || searchQuery.length < 2}
                    data-testid="button-qb-search"
                  >
                    {searchLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {searchResults.length > 0 && (
                <ScrollArea className="h-48">
                  <div className="space-y-2">
                    {searchResults.map((item) => (
                      <button
                        key={item.id}
                        className="w-full p-3 text-left rounded-lg border hover-elevate transition-colors"
                        onClick={() => handleSelectSearchResult(item)}
                        data-testid={`button-qb-result-${item.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-sm">{item.name}</div>
                          <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                            {item.type}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          {item.sku && <span>SKU: {item.sku}</span>}
                          {item.purchaseCost && (
                            <span>{formatCurrency(item.purchaseCost)}</span>
                          )}
                          {item.preferredVendorName && (
                            <span>{item.preferredVendorName}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {searchResults.length === 0 && searchQuery && !searchLoading && (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  No matching items found
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <XCircle className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                {qbData?.error || "Could not load QuickBooks data"}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={handleManualEntry}
            data-testid="button-qb-manual"
          >
            Enter Manually
          </Button>
          {qbData?.success && qbData.item && (
            <Button 
              onClick={handleApplyQBData}
              data-testid="button-qb-apply"
            >
              <SiQuickbooks className="h-4 w-4 mr-2" />
              Use QuickBooks Info
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
