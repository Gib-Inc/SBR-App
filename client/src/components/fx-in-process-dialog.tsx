import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export type FxItem = {
  id: string;
  sku: string;
  name: string;
  fxInProcessQty: number;
};

export function FxInProcessDialog({
  isOpen,
  onClose,
  item,
  prefillZero = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  item: FxItem | null;
  prefillZero?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");

  // Re-seed inputs when the modal (re-)opens or the target item changes.
  useEffect(() => {
    if (!isOpen || !item) return;
    setQuantity(prefillZero ? "0" : String(item.fxInProcessQty ?? 0));
    setNotes("");
  }, [isOpen, item, prefillZero]);

  const invalidateAfterChange = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/inventory/snapshot"] });
    queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/raw-materials/dashboard"] });
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("No item");
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 0) {
        throw new Error("Quantity must be a non-negative whole number");
      }
      const res = await apiRequest("PATCH", "/api/inventory/fx-in-process", {
        itemId: item.id,
        quantity: qty,
        notes: notes.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterChange();
      toast({ title: "FX quantity updated", description: `${item?.sku} set to ${quantity} units.` });
      onClose();
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Update failed", description: err.message });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("No item");
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
        throw new Error("Receive quantity must be a positive whole number");
      }
      if (qty > (item.fxInProcessQty ?? 0)) {
        throw new Error(`Only ${item.fxInProcessQty ?? 0} in process at FX`);
      }
      const res = await apiRequest("POST", "/api/inventory/receive-from-fx", {
        reason: notes.trim() || undefined,
        lines: [{ itemId: item.id, quantity: qty }],
      });
      return res.json() as Promise<{ results: { success: boolean; error?: string; quantity: number }[] }>;
    },
    onSuccess: ({ results }) => {
      invalidateAfterChange();
      const r = results[0];
      if (r?.success) {
        toast({ title: "Received from FX", description: `${r.quantity} units moved to Hildale.` });
        onClose();
      } else {
        toast({ variant: "destructive", title: "Receipt failed", description: r?.error ?? "Unknown error" });
      }
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Receipt failed", description: err.message });
    },
  });

  const fxOnHand = item?.fxInProcessQty ?? 0;
  const busy = updateMutation.isPending || receiveMutation.isPending;
  const enteredQty = Number(quantity);
  const canReceive =
    !!item &&
    fxOnHand > 0 &&
    Number.isFinite(enteredQty) &&
    Number.isInteger(enteredQty) &&
    enteredQty > 0 &&
    enteredQty <= fxOnHand &&
    !busy;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{prefillZero ? "Log FX Order" : "FX In-Production"}</DialogTitle>
          <DialogDescription>
            {item ? (
              <span className="font-mono">{item.sku}</span>
            ) : null}
            {item ? <span> — {item.name}</span> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded border bg-muted/30 p-3 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Currently in production at FX</span>
            <span className="font-semibold tabular-nums" data-testid="fx-current-qty">
              {fxOnHand.toLocaleString()}
            </span>
          </div>

          <div className="space-y-1">
            <Label htmlFor="fx-quantity">Quantity</Label>
            <Input
              id="fx-quantity"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              data-testid="input-fx-quantity"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Update sets the new total. Receive moves units from FX → Hildale.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="fx-notes">Notes</Label>
            <Textarea
              id="fx-notes"
              rows={2}
              placeholder='e.g. "Ordered Apr 30, expected May 21"'
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="input-fx-notes"
            />
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => receiveMutation.mutate()}
            disabled={!canReceive}
            data-testid="button-fx-receive"
          >
            {receiveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ArrowDown className="h-4 w-4 mr-2" />
            )}
            Receive from FX
          </Button>
          <div className="flex gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => updateMutation.mutate()}
              disabled={busy || !item}
              data-testid="button-fx-update"
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {updateMutation.isPending ? "Updating…" : "Update"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
