import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TransferDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: {
    id: string;
    name: string;
    sku: string;
    hildaleQty?: number;
    pivotQty?: number;
  };
}

export function TransferDialog({ isOpen, onClose, item }: TransferDialogProps) {
  const [fromLocation, setFromLocation] = useState<"HILDALE" | "PIVOT">("HILDALE");
  const [toLocation, setToLocation] = useState<"HILDALE" | "PIVOT">("PIVOT");
  const [quantity, setQuantity] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const transferMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/transactions/transfer", {
        itemId: item.id,
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Transfer Successful",
        description: `Transferred ${quantity} units from ${fromLocation} to ${toLocation}`,
      });
      handleClose();
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
    if (quantity <= 0) {
      toast({
        variant: "destructive",
        title: "Invalid Quantity",
        description: "Quantity must be greater than zero",
      });
      return;
    }
    if (fromLocation === toLocation) {
      toast({
        variant: "destructive",
        title: "Invalid Transfer",
        description: "Cannot transfer to the same location",
      });
      return;
    }
    transferMutation.mutate();
  };

  const handleClose = () => {
    setQuantity(0);
    setNotes("");
    setFromLocation("HILDALE");
    setToLocation("PIVOT");
    onClose();
  };

  const swapLocations = () => {
    const temp = fromLocation;
    setFromLocation(toLocation);
    setToLocation(temp);
  };

  const availableAtFrom = fromLocation === "HILDALE" ? (item.hildaleQty ?? 0) : (item.pivotQty ?? 0);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Transfer Inventory</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-sm font-medium">{item.name}</Label>
            <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span>Hildale: {item.hildaleQty ?? 0}</span>
              <span className="text-muted-foreground">|</span>
              <span>Pivot: {item.pivotQty ?? 0}</span>
            </div>
          </div>

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
              <p className="text-xs text-muted-foreground">
                Available: {availableAtFrom} units
              </p>
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
