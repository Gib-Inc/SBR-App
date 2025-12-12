import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Factory, Package, Loader2, Search, X } from "lucide-react";
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
  selected: boolean;
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
        selected: false,
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
        newMap.set(product.id, { ...product, selected: true, qty: 1 });
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

  const handleRemove = (productId: string) => {
    setSelectedItems((prev) => {
      const newMap = new Map(prev);
      newMap.delete(productId);
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

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Factory className="h-5 w-5" />
            Produce Products
          </DialogTitle>
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
            <ScrollArea className="h-64">
              <div className="space-y-1 pr-4">
                {filteredProducts.map((product) => {
                  const isSelected = selectedItems.has(product.id);
                  const selectedItem = selectedItems.get(product.id);
                  
                  return (
                    <div
                      key={product.id}
                      className={`flex items-center gap-3 rounded-md border p-3 transition-colors ${
                        isSelected ? "border-primary bg-primary/5" : "hover-elevate cursor-pointer"
                      }`}
                      onClick={() => !isSelected && handleToggleSelect(product)}
                      data-testid={`row-batch-production-${product.id}`}
                    >
                      {!isSelected && (
                        <Checkbox
                          checked={false}
                          onCheckedChange={() => handleToggleSelect(product)}
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`checkbox-select-${product.id}`}
                        />
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{product.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{product.sku}</span>
                          <Badge variant="secondary" className="text-xs">
                            {product.componentsCount} components
                          </Badge>
                        </div>
                      </div>

                      {isSelected ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Input
                            type="number"
                            min={1}
                            value={selectedItem?.qty || 1}
                            onChange={(e) => handleQtyChange(product.id, parseInt(e.target.value) || 1)}
                            className="w-20 text-center"
                            data-testid={`input-qty-${product.id}`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemove(product.id)}
                            data-testid={`button-remove-${product.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground whitespace-nowrap">
                          In stock: {product.hildaleQty}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          {selectedArray.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium mb-2">Production Summary ({selectedArray.length} products)</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {selectedArray.map((item) => (
                  <div key={item.id} className="flex justify-between items-center">
                    <span className="text-muted-foreground truncate">{item.name}</span>
                    <Badge variant="outline">{item.qty} units</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
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
            Produce {selectedItems.size > 0 ? `(${selectedItems.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
