import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle2 } from "lucide-react";

interface ProductionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: {
    id: string;
    name: string;
    sku: string;
    type: string;
  };
}

interface BOMComponent {
  componentId: string;
  componentName: string;
  componentSku: string;
  quantityRequired: number;
  currentStock: number;
}

export function ProductionDialog({ isOpen, onClose, item }: ProductionDialogProps) {
  const [quantity, setQuantity] = useState<number>(1);
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const { data: bomData, isLoading: bomLoading } = useQuery({
    queryKey: ["/api/bill-of-materials", { finishedProductId: item.id }],
    enabled: isOpen && item.type === "finished_product",
  });

  const { data: itemsData } = useQuery({
    queryKey: ["/api/items"],
    enabled: isOpen,
  });

  const productionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/transactions/produce", {
        finishedProductId: item.id,
        quantity,
        notes: notes || undefined,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to produce items");
      }
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Production Successful",
        description: `Produced ${quantity} units of ${item.name}`,
      });
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (quantity <= 0) {
      toast({
        variant: "destructive",
        title: "Invalid Quantity",
        description: "Quantity must be greater than zero",
      });
      return;
    }
    productionMutation.mutate();
  };

  const handleClose = () => {
    setQuantity(1);
    setNotes("");
    onClose();
  };

  const bomArray = Array.isArray(bomData) ? bomData : [];
  const itemsArray = Array.isArray(itemsData) ? itemsData : [];

  const components: BOMComponent[] = bomArray.map((bom: any) => {
    const component = itemsArray.find((i: any) => i.id === bom.componentId);
    return {
      componentId: bom.componentId,
      componentName: component?.name || "Unknown",
      componentSku: component?.sku || "",
      quantityRequired: bom.quantityRequired,
      currentStock: component?.currentStock ?? 0,
    };
  });

  const canProduce = components.every(
    (c) => c.currentStock >= c.quantityRequired * quantity
  );

  const insufficientComponents = components.filter(
    (c) => c.currentStock < c.quantityRequired * quantity
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Produce Finished Product</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-sm font-medium">{item.name}</Label>
            <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="quantity">Quantity to Produce</Label>
            <Input
              id="quantity"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              placeholder="Enter quantity"
              min={1}
              data-testid="input-production-quantity"
            />
          </div>

          <div className="space-y-2">
            <Label>Bill of Materials</Label>
            {bomLoading ? (
              <div className="text-sm text-muted-foreground">Loading BOM...</div>
            ) : components.length === 0 ? (
              <div className="text-sm text-destructive">
                No Bill of Materials defined. Cannot produce without BOM.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-2 text-left">Component</th>
                        <th className="px-3 py-2 text-right">Required</th>
                        <th className="px-3 py-2 text-right">Available</th>
                        <th className="px-3 py-2 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {components.map((comp) => {
                        const required = comp.quantityRequired * quantity;
                        const sufficient = comp.currentStock >= required;
                        return (
                          <tr key={comp.componentId} className="border-b last:border-0">
                            <td className="px-3 py-2">
                              <div>{comp.componentName}</div>
                              <div className="text-xs text-muted-foreground">{comp.componentSku}</div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {required}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {comp.currentStock}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {sufficient ? (
                                <CheckCircle2 className="inline h-4 w-4 text-green-600" />
                              ) : (
                                <AlertCircle className="inline h-4 w-4 text-destructive" />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {!canProduce && (
                  <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                    <p className="font-medium">Insufficient Materials</p>
                    <ul className="mt-1 list-inside list-disc text-xs">
                      {insufficientComponents.map((comp) => (
                        <li key={comp.componentId}>
                          {comp.componentName}: Need {comp.quantityRequired * quantity}, have {comp.currentStock}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Production Result</Label>
            <div className="rounded border p-3 text-sm">
              <p>
                After production, <span className="font-medium">{quantity} units</span> of{" "}
                <span className="font-medium">{item.name}</span> will be added to{" "}
                <Badge variant="secondary">Hildale</Badge> location.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this production run..."
              rows={2}
              data-testid="textarea-production-notes"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={productionMutation.isPending}
              data-testid="button-cancel-production"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={productionMutation.isPending || !canProduce || components.length === 0}
              data-testid="button-submit-production"
            >
              {productionMutation.isPending ? "Producing..." : "Produce"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
