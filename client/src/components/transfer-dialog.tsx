import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TransferItem {
  id: string;
  name: string;
  sku: string;
  hildaleQty?: number;
  pivotQty?: number;
}

interface TransferDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item?: TransferItem;
  bulkMode?: boolean;
}

interface TransferLineItem {
  itemId: string;
  quantity: number;
}

export function TransferDialog({ isOpen, onClose, item, bulkMode = false }: TransferDialogProps) {
  const [fromLocation, setFromLocation] = useState<"HILDALE" | "PIVOT">("HILDALE");
  const [toLocation, setToLocation] = useState<"HILDALE" | "PIVOT">("PIVOT");
  const [quantity, setQuantity] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [transferItems, setTransferItems] = useState<TransferLineItem[]>([]);
  const { toast } = useToast();

  const { data: allItems = [] } = useQuery<TransferItem[]>({
    queryKey: ["/api/items"],
    enabled: bulkMode && isOpen,
  });

  const finishedProducts = (allItems as any[]).filter((i: any) => i.type === "finished_product");

  useEffect(() => {
    if (isOpen && bulkMode && transferItems.length === 0) {
      setTransferItems([{ itemId: "", quantity: 0 }]);
    }
  }, [isOpen, bulkMode]);

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (bulkMode) {
        const validItems = transferItems.filter(ti => ti.itemId && ti.quantity > 0);
        if (validItems.length === 0) {
          throw new Error("No valid items to transfer");
        }
        
        const results: { itemId: string; name: string; success: boolean; error?: string; qty: number }[] = [];
        
        for (const ti of validItems) {
          const product = finishedProducts.find((p: any) => p.id === ti.itemId);
          const productName = product?.name || ti.itemId;
          
          try {
            const res = await apiRequest("POST", "/api/transactions/transfer", {
              itemId: ti.itemId,
              fromLocation,
              toLocation,
              quantity: ti.quantity,
              notes: notes || undefined,
            });
            
            if (!res.ok) {
              const error = await res.json();
              results.push({ 
                itemId: ti.itemId, 
                name: productName, 
                success: false, 
                error: error.error || "Transfer failed",
                qty: ti.quantity 
              });
            } else {
              results.push({ itemId: ti.itemId, name: productName, success: true, qty: ti.quantity });
            }
          } catch (err: any) {
            results.push({ 
              itemId: ti.itemId, 
              name: productName, 
              success: false, 
              error: err.message || "Network error",
              qty: ti.quantity 
            });
          }
        }
        
        return results;
      } else {
        const res = await apiRequest("POST", "/api/transactions/transfer", {
          itemId: item!.id,
          fromLocation,
          toLocation,
          quantity,
          notes: notes || undefined,
        });
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || "Failed to transfer inventory");
        }
        return await res.json();
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      
      if (bulkMode && Array.isArray(data)) {
        const successes = data.filter(r => r.success);
        const failures = data.filter(r => !r.success);
        
        if (failures.length === 0) {
          const totalQty = successes.reduce((sum, r) => sum + r.qty, 0);
          toast({
            title: "Transfer Successful",
            description: `Transferred ${totalQty} units across ${successes.length} product${successes.length > 1 ? 's' : ''} from ${fromLocation} to ${toLocation}`,
          });
        } else if (successes.length === 0) {
          toast({
            variant: "destructive",
            title: "All Transfers Failed",
            description: failures.map(f => `${f.name}: ${f.error}`).join("; "),
          });
        } else {
          toast({
            variant: "destructive",
            title: "Partial Transfer",
            description: `${successes.length} succeeded, ${failures.length} failed: ${failures.map(f => f.name).join(", ")}`,
          });
        }
        handleClose();
      } else {
        toast({
          title: "Transfer Successful",
          description: `Transferred ${quantity} units from ${fromLocation} to ${toLocation}`,
        });
        handleClose();
      }
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Transfer Failed",
        description: error.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (fromLocation === toLocation) {
      toast({
        variant: "destructive",
        title: "Invalid Transfer",
        description: "Cannot transfer to the same location",
      });
      return;
    }
    
    if (bulkMode) {
      const validItems = transferItems.filter(ti => ti.itemId && ti.quantity > 0);
      if (validItems.length === 0) {
        toast({
          variant: "destructive",
          title: "No Items Selected",
          description: "Please add at least one product with a quantity to transfer",
        });
        return;
      }
      
      const validationErrors: string[] = [];
      for (const ti of validItems) {
        const product = finishedProducts.find((p: any) => p.id === ti.itemId);
        if (!product) {
          validationErrors.push(`Product not found`);
          continue;
        }
        const available = fromLocation === "HILDALE" ? (product.hildaleQty ?? 0) : (product.pivotQty ?? 0);
        if (ti.quantity > available) {
          validationErrors.push(`${product.name}: Only ${available} available at ${fromLocation}`);
        }
      }
      
      if (validationErrors.length > 0) {
        toast({
          variant: "destructive",
          title: "Insufficient Inventory",
          description: validationErrors.join("; "),
        });
        return;
      }
    } else {
      if (quantity <= 0) {
        toast({
          variant: "destructive",
          title: "Invalid Quantity",
          description: "Quantity must be greater than zero",
        });
        return;
      }
      
      const availableQty = fromLocation === "HILDALE" ? (item?.hildaleQty ?? 0) : (item?.pivotQty ?? 0);
      if (quantity > availableQty) {
        toast({
          variant: "destructive",
          title: "Insufficient Inventory",
          description: `Only ${availableQty} units available at ${fromLocation}`,
        });
        return;
      }
    }
    
    transferMutation.mutate();
  };

  const handleClose = () => {
    setQuantity(0);
    setNotes("");
    setFromLocation("HILDALE");
    setToLocation("PIVOT");
    setTransferItems([]);
    onClose();
  };

  const swapLocations = () => {
    const temp = fromLocation;
    setFromLocation(toLocation);
    setToLocation(temp);
  };

  const addTransferItem = () => {
    setTransferItems([...transferItems, { itemId: "", quantity: 0 }]);
  };

  const removeTransferItem = (index: number) => {
    setTransferItems(transferItems.filter((_, i) => i !== index));
  };

  const updateTransferItem = (index: number, field: keyof TransferLineItem, value: string | number) => {
    const updated = [...transferItems];
    if (field === "quantity") {
      updated[index].quantity = typeof value === "string" ? parseInt(value) || 0 : value;
    } else {
      updated[index].itemId = value as string;
    }
    setTransferItems(updated);
  };

  const getItemAvailableQty = (itemId: string) => {
    const foundItem = finishedProducts.find((p: any) => p.id === itemId);
    if (!foundItem) return 0;
    return fromLocation === "HILDALE" ? (foundItem.hildaleQty ?? 0) : (foundItem.pivotQty ?? 0);
  };

  const availableAtFrom = item 
    ? (fromLocation === "HILDALE" ? (item.hildaleQty ?? 0) : (item.pivotQty ?? 0))
    : 0;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>
            {bulkMode ? "Bulk Transfer Inventory" : "Transfer Inventory"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!bulkMode && item && (
            <div>
              <Label className="text-sm font-medium">{item.name}</Label>
              <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span>Hildale: {item.hildaleQty ?? 0}</span>
                <span className="text-muted-foreground">|</span>
                <span>Pivot: {item.pivotQty ?? 0}</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-2">
              <Label htmlFor="from-location">From</Label>
              <Select value={fromLocation} onValueChange={(v) => setFromLocation(v as "HILDALE" | "PIVOT")}>
                <SelectTrigger id="from-location" data-testid="select-from-location">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HILDALE">Hildale</SelectItem>
                  <SelectItem value="PIVOT">Pivot</SelectItem>
                </SelectContent>
              </Select>
              {!bulkMode && (
                <p className="text-xs text-muted-foreground">
                  Available: {availableAtFrom} units
                </p>
              )}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={swapLocations}
              className="mt-6"
              data-testid="button-swap-locations"
            >
              <ArrowRight className="h-4 w-4" />
            </Button>

            <div className="flex-1 space-y-2">
              <Label htmlFor="to-location">To</Label>
              <Select value={toLocation} onValueChange={(v) => setToLocation(v as "HILDALE" | "PIVOT")}>
                <SelectTrigger id="to-location" data-testid="select-to-location">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HILDALE">Hildale</SelectItem>
                  <SelectItem value="PIVOT">Pivot</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {bulkMode ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Products to Transfer</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTransferItem}
                  data-testid="button-add-transfer-item"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Product
                </Button>
              </div>
              <ScrollArea className="max-h-[240px]">
                <div className="space-y-2 pr-4">
                  {transferItems.map((ti, index) => {
                    const selectedItem = finishedProducts.find((p: any) => p.id === ti.itemId);
                    const availableQty = getItemAvailableQty(ti.itemId);
                    return (
                      <div key={index} className="flex items-center gap-2 p-2 rounded border bg-muted/30">
                        <div className="flex-1">
                          <Select
                            value={ti.itemId}
                            onValueChange={(v) => updateTransferItem(index, "itemId", v)}
                          >
                            <SelectTrigger data-testid={`select-product-${index}`}>
                              <SelectValue placeholder="Select product..." />
                            </SelectTrigger>
                            <SelectContent>
                              {finishedProducts.map((product: any) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.name} ({product.sku})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {selectedItem && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Available at {fromLocation}: {availableQty}
                            </p>
                          )}
                        </div>
                        <div className="w-24">
                          <Input
                            type="number"
                            min={0}
                            max={availableQty}
                            value={ti.quantity}
                            onChange={(e) => updateTransferItem(index, "quantity", e.target.value)}
                            placeholder="Qty"
                            data-testid={`input-transfer-qty-${index}`}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeTransferItem(index)}
                          disabled={transferItems.length === 1}
                          data-testid={`button-remove-item-${index}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                placeholder="Enter quantity"
                min={0}
                max={availableAtFrom}
                data-testid="input-transfer-quantity"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this transfer..."
              rows={3}
              data-testid="textarea-transfer-notes"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={transferMutation.isPending}
              data-testid="button-cancel-transfer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={transferMutation.isPending}
              data-testid="button-submit-transfer"
            >
              {transferMutation.isPending ? "Transferring..." : "Transfer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
