import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Factory, Package, Loader2, Search, X, Minus, Plus } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface BatchProductionDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ProductionItem {
  id: string;
  name: string;
  sku: string;
  hildaleQty: number;
  componentsCount: number;
  qty: number;
}

export function BatchProductionDialog({ isOpen, onClose }: BatchProductionDialogProps) {
  const [selectedItems, setSelectedItems] = useState<Map<string, ProductionItem>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const { data: finishedProducts, isLoading } = useQuery<any[]>({
    queryKey: ["/api/items"],
    enabled: isOpen,
  });

  const producibleProducts = useMemo(() => {
    if (!finishedProducts) return [];
    return finishedProducts
      .filter((p: any) => p.type === "finished_product" && (p.componentsCount || 0) > 0)
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        hildaleQty: p.hildaleQty ?? 0,
        componentsCount: p.componentsCount ?? 0,
        qty: 1,
      }));
  }, [finishedProducts]);

  const filteredProducts = useMemo(() => {
    const search = searchQuery.toLowerCase();
    if (!search) return producibleProducts;
    return producibleProducts.filter(
      (p) => p.name.toLowerCase().includes(search) || p.sku.toLowerCase().includes(search)
    );
  }, [producibleProducts, searchQuery]);

  const productionMutation = useMutation({
    mutationFn: async () => {
      const builds = Array.from(selectedItems.values())
        .filter((i) => i.qty > 0)
        .map((i) => ({ finishedProductId: i.id, quantity: i.qty }));
      
      if (builds.length === 0) {
        throw new Error("No items selected for production");
      }

      const res = await apiRequest("POST", "/api/production/batch-build", { builds });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to produce items");
      }
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      const successCount = data.results?.filter((r: any) => r.success).length || 0;
      const failCount = data.results?.filter((r: any) => !r.success).length || 0;
      
      if (failCount > 0) {
        toast({
          title: "Partial Production",
          description: `${successCount} succeeded, ${failCount} failed due to insufficient materials`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Production Complete",
          description: `Successfully produced ${successCount} product types`,
        });
      }
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Production Failed",
        description: error.message,
      });
    },
  });

  const handleToggleSelect = (product: ProductionItem) => {
    setSelectedItems((prev) => {
      const newMap = new Map(prev);
      if (newMap.has(product.id)) {
        newMap.delete(product.id);
      } else {
        newMap.set(product.id, { ...product, qty: 1 });
      }
      return newMap;
    });
  };

  const handleQtyChange = (productId: string, qty: number) => {
    setSelectedItems((prev) => {
      const newMap = new Map(prev);
      const item = newMap.get(productId);
      if (item) {
        newMap.set(productId, { ...item, qty: Math.max(1, qty) });
      }
      return newMap;
    });
  };

  const handleIncrementQty = (productId: string) => {
    setSelectedItems((prev) => {
      const newMap = new Map(prev);
      const item = newMap.get(productId);
      if (item) {
        newMap.set(productId, { ...item, qty: item.qty + 1 });
      }
      return newMap;
    });
  };

  const handleDecrementQty = (productId: string) => {
    setSelectedItems((prev) => {
      const newMap = new Map(prev);
      const item = newMap.get(productId);
      if (item && item.qty > 1) {
        newMap.set(productId, { ...item, qty: item.qty - 1 });
      }
      return newMap;
    });
  };

  const handleClose = () => {
    setSelectedItems(new Map());
    setSearchQuery("");
    onClose();
  };

  const handleProduce = () => {
    if (selectedItems.size === 0) {
      toast({
        variant: "destructive",
        title: "No Items Selected",
        description: "Please select at least one product to produce",
      });
      return;
    }
    productionMutation.mutate();
  };

  const selectedArray = Array.from(selectedItems.values());
  const totalUnits = selectedArray.reduce((sum, item) => sum + item.qty, 0);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Factory className="h-5 w-5" />
            Produce Products
          </DialogTitle>
          <DialogDescription>
            Select products to manufacture and specify quantities. Components will be deducted from Hildale inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-batch-production-search"
            />
          </div>

          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : producibleProducts.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Package className="h-10 w-10" />
              <p className="text-sm">No products with BOM found</p>
              <p className="text-xs">Add components to products first</p>
            </div>
          ) : (
            <ScrollArea className="h-80">
              <div className="space-y-2 pr-4">
                {filteredProducts.map((product) => {
                  const isSelected = selectedItems.has(product.id);
                  const selectedItem = selectedItems.get(product.id);
                  
                  return (
                    <div
                      key={product.id}
                      className={`rounded-lg border p-4 transition-colors ${
                        isSelected 
                          ? "border-primary bg-primary/5" 
                          : "hover-elevate cursor-pointer"
                      }`}
                      data-testid={`row-batch-production-${product.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleSelect(product)}
                          className="mt-1 shrink-0"
                          data-testid={`checkbox-select-${product.id}`}
                        />
                        
                        <div 
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => handleToggleSelect(product)}
                        >
                          <p className="font-medium text-sm leading-tight break-words">
                            {product.name}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className="text-xs text-muted-foreground font-mono">
                              {product.sku}
                            </span>
                            <Badge variant="secondary" className="text-xs shrink-0">
                              {product.componentsCount} components
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Stock: {product.hildaleQty}
                            </span>
                          </div>
                        </div>

                        {isSelected && (
                          <div 
                            className="flex items-center gap-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleDecrementQty(product.id)}
                              disabled={selectedItem?.qty === 1}
                              data-testid={`button-decrement-${product.id}`}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <Input
                              type="number"
                              min={1}
                              value={selectedItem?.qty || 1}
                              onChange={(e) => handleQtyChange(product.id, parseInt(e.target.value) || 1)}
                              className="w-16 text-center h-8"
                              data-testid={`input-qty-${product.id}`}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleIncrementQty(product.id)}
                              data-testid={`button-increment-${product.id}`}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleToggleSelect(product)}
                              data-testid={`button-remove-${product.id}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          {selectedArray.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium">
                  Production Summary
                </p>
                <Badge variant="default">
                  {selectedArray.length} products, {totalUnits} total units
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {selectedArray.map((item) => (
                  <div key={item.id} className="flex justify-between items-center gap-2 p-2 rounded bg-background/50">
                    <span className="text-muted-foreground truncate flex-1 min-w-0" title={item.name}>
                      {item.name}
                    </span>
                    <Badge variant="outline" className="shrink-0">{item.qty} units</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel-batch-production">
            Cancel
          </Button>
          <Button
            onClick={handleProduce}
            disabled={selectedItems.size === 0 || productionMutation.isPending}
            data-testid="button-confirm-batch-production"
          >
            {productionMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Factory className="mr-2 h-4 w-4" />
            )}
            Produce {selectedItems.size > 0 ? `(${totalUnits} units)` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
