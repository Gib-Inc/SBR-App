import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wand2, ExternalLink, Loader2 } from "lucide-react";

interface ItemCostSettingsDialogProps {
  item: any;
  isOpen: boolean;
  onClose: () => void;
}

export function ItemCostSettingsDialog({ item, isOpen, onClose }: ItemCostSettingsDialogProps) {
  const { toast } = useToast();
  const [supplierProductUrl, setSupplierProductUrl] = useState("");
  const [defaultPurchaseCost, setDefaultPurchaseCost] = useState("");
  const [currency, setCurrency] = useState("USD");
  
  useEffect(() => {
    if (item && isOpen) {
      setSupplierProductUrl(item.supplierProductUrl || "");
      setDefaultPurchaseCost(item.defaultPurchaseCost?.toString() || "");
      setCurrency(item.currency || "USD");
    }
  }, [item, isOpen]);

  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      const response = await apiRequest("PATCH", `/api/items/${item.id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Success",
        description: "Cost settings updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update cost settings",
      });
    },
  });

  const suggestCostMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/items/${item.id}/auto-suggest-cost`, {});
      return response.json();
    },
    onSuccess: (data) => {
      if (data.updated) {
        queryClient.invalidateQueries({ queryKey: ["/api/items"] });
        setDefaultPurchaseCost(data.price?.toString() || "");
        toast({
          title: "Cost Suggested",
          description: `Found price: $${data.price?.toFixed(2)} from supplier page`,
        });
      } else if (data.price) {
        toast({
          title: "Price Found",
          description: `Found $${data.price.toFixed(2)} (not applied: ${data.reason})`,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Could Not Suggest",
          description: data.reason || "Could not find a reliable price on the supplier page",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to suggest cost",
      });
    },
  });

  const handleSave = () => {
    const updates: any = {
      supplierProductUrl: supplierProductUrl.trim() || null,
      currency,
    };

    const cost = parseFloat(defaultPurchaseCost);
    if (!isNaN(cost) && cost > 0) {
      updates.defaultPurchaseCost = cost;
      updates.costSource = "MANUAL";
      updates.lastCostUpdatedAt = new Date().toISOString();
    } else if (defaultPurchaseCost === "") {
      updates.defaultPurchaseCost = null;
    }

    updateMutation.mutate(updates, {
      onSuccess: () => {
        onClose();
      },
    });
  };

  const handleSuggestCost = () => {
    suggestCostMutation.mutate();
  };

  const canSuggestCost = supplierProductUrl && (!defaultPurchaseCost || parseFloat(defaultPurchaseCost) === 0);

  const getCostSourceBadge = () => {
    if (!item?.costSource || !item?.defaultPurchaseCost) return null;
    
    switch (item.costSource) {
      case "AUTO_SCRAPED":
        return <Badge variant="secondary">Auto-scraped</Badge>;
      case "API":
        return <Badge variant="secondary">From API</Badge>;
      case "MANUAL":
      default:
        return <Badge variant="outline">Manual</Badge>;
    }
  };

  if (!item) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cost Settings - {item.name}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="defaultPurchaseCost">Default Purchase Cost</Label>
              {getCostSourceBadge()}
            </div>
            <div className="flex gap-2">
              <div className="flex-1 flex gap-2">
                <span className="flex items-center px-3 bg-muted rounded-l-md border border-r-0">$</span>
                <Input
                  id="defaultPurchaseCost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={defaultPurchaseCost}
                  onChange={(e) => setDefaultPurchaseCost(e.target.value)}
                  placeholder="0.00"
                  className="rounded-l-none"
                  data-testid="input-default-purchase-cost"
                />
              </div>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="w-20"
                maxLength={3}
                placeholder="USD"
                data-testid="input-currency"
              />
            </div>
            {item.lastCostUpdatedAt && (
              <p className="text-xs text-muted-foreground">
                Last updated: {new Date(item.lastCostUpdatedAt).toLocaleDateString()}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="supplierProductUrl">Supplier Product URL</Label>
            <div className="flex gap-2">
              <Input
                id="supplierProductUrl"
                type="url"
                value={supplierProductUrl}
                onChange={(e) => setSupplierProductUrl(e.target.value)}
                placeholder="https://supplier.com/product/123"
                data-testid="input-supplier-product-url"
              />
              {supplierProductUrl && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => window.open(supplierProductUrl, "_blank")}
                  title="Open supplier page"
                  data-testid="button-open-supplier-url"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              URL to the supplier's product page for price suggestions
            </p>
          </div>

          {canSuggestCost && (
            <Button
              variant="secondary"
              onClick={handleSuggestCost}
              disabled={suggestCostMutation.isPending}
              className="w-full"
              data-testid="button-suggest-cost"
            >
              {suggestCostMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Fetching price...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Suggest cost from supplier
                </>
              )}
            </Button>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-cost-settings">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              data-testid="button-save-cost-settings"
            >
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
