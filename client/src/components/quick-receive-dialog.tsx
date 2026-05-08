import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, PackageCheck } from "lucide-react";
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

// Mobile-first single-screen receive flow for Clarence's /incoming page.
// One number input, one optional notes field, one big green Confirm button.
// Used for both component POs and FX POs — the server's quick-receive
// endpoint figures out which inventory column to update based on the PO's
// supplier and line item types.

export interface QuickReceiveContext {
  poId: string;
  poNumber: string;
  supplierName: string;
  itemSummary: string; // e.g. "200 × SBR-Extrawide2.0 — Push 2.0"
  qtyOrdered: number;
}

export function QuickReceiveDialog({
  isOpen,
  onClose,
  context,
}: {
  isOpen: boolean;
  onClose: () => void;
  context: QuickReceiveContext | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (isOpen && context) {
      setQty(String(context.qtyOrdered));
      setNotes("");
    }
  }, [isOpen, context]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context) throw new Error("No context");
      const num = Number(qty);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
        throw new Error("Enter a whole number ≥ 0");
      }
      const res = await apiRequest("POST", `/api/purchase-orders/${context.poId}/quick-receive`, {
        quantityReceived: num,
        notes: notes.trim() || undefined,
      });
      return res.json() as Promise<{
        applied: { sku: string; received: number; effect: string }[];
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/snapshot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/raw-materials/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders/fx-incoming"] });
      const summary = data.applied.length
        ? data.applied.map((a) => `${a.sku} +${a.received}`).join(", ")
        : "no inventory effect";
      toast({ title: "Receipt confirmed", description: summary });
      onClose();
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Receive failed", description: err.message });
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <PackageCheck className="h-6 w-6 text-green-600" />
            Receive
          </DialogTitle>
          <DialogDescription className="text-base">
            {context?.itemSummary ?? ""}
            <div className="text-sm text-muted-foreground mt-1">
              PO {context?.poNumber} — {context?.supplierName}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label htmlFor="quick-receive-qty" className="text-base">
              How many did you receive?
            </Label>
            <Input
              id="quick-receive-qty"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="text-3xl h-16 text-center font-bold tabular-nums"
              autoFocus
              data-testid="input-quick-receive-qty"
            />
            <p className="text-xs text-muted-foreground text-center">
              Defaults to ordered ({context?.qtyOrdered.toLocaleString() ?? "—"}). Edit if short.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="quick-receive-notes" className="text-base">
              Any damaged or missing?
            </Label>
            <Textarea
              id="quick-receive-notes"
              rows={2}
              placeholder="Optional — e.g. 5 short, 2 dented"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-base"
              data-testid="input-quick-receive-notes"
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="w-full h-14 text-lg bg-green-600 hover:bg-green-700 text-white"
            data-testid="button-quick-receive-confirm"
          >
            {mutation.isPending ? (
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-5 w-5 mr-2" />
            )}
            Confirm Receipt
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={mutation.isPending}
            className="w-full"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
