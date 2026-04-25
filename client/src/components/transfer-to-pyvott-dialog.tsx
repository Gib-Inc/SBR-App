import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type FinishedProduct = {
  id: string;
  sku: string;
  name: string;
  type: string;
  hildaleQty: number | null;
};

type Line = {
  itemId: string;
  quantity: string; // text-bound; parsed at submit
};

type TransferResult = {
  itemId: string;
  sku: string;
  quantity: number;
  success: boolean;
  error?: string;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const newLine = (): Line => ({ itemId: "", quantity: "" });

export function TransferToPyvottDialog({ isOpen, onClose }: Props) {
  const { toast } = useToast();
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [reason, setReason] = useState("");

  const { data: items = [], isLoading: loadingItems } = useQuery<FinishedProduct[]>({
    queryKey: ["/api/items"],
    enabled: isOpen,
  });

  const finishedProducts = useMemo(
    () =>
      items
        .filter((i) => i.type === "finished_product")
        .sort((a, b) => a.sku.localeCompare(b.sku)),
    [items],
  );

  // SKUs already chosen in earlier rows shouldn't appear in later picker dropdowns.
  const chosenIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) if (l.itemId) set.add(l.itemId);
    return set;
  }, [lines]);

  useEffect(() => {
    if (!isOpen) {
      setLines([newLine()]);
      setReason("");
    }
  }, [isOpen]);

  const itemById = useMemo(() => {
    const map = new Map<string, FinishedProduct>();
    for (const p of finishedProducts) map.set(p.id, p);
    return map;
  }, [finishedProducts]);

  const updateLine = (index: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, newLine()]);
  const removeLine = (index: number) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));

  // Per-line validation. Returns null when valid.
  const lineErrors = useMemo(() => {
    return lines.map((l) => {
      if (!l.itemId) return null; // empty line; ignored unless quantity set
      const qtyNum = Number(l.quantity);
      if (!l.quantity) return "Enter a quantity";
      if (!Number.isInteger(qtyNum) || qtyNum <= 0) return "Quantity must be a positive whole number";
      const item = itemById.get(l.itemId);
      const available = item?.hildaleQty ?? 0;
      if (qtyNum > available) return `Only ${available} available at Hildale`;
      return null;
    });
  }, [lines, itemById]);

  const validLines = useMemo(
    () =>
      lines
        .map((l, i) => ({ l, i }))
        .filter(({ l, i }) => l.itemId && l.quantity && !lineErrors[i]),
    [lines, lineErrors],
  );

  const hasBlockingError = lineErrors.some((e) => !!e);
  const canSubmit = !hasBlockingError && validLines.length > 0;

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        reason: reason.trim() || undefined,
        lines: validLines.map(({ l }) => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
        })),
      };
      const res = await apiRequest("POST", "/api/inventory/transfer-to-pyvott", payload);
      return (await res.json()) as { results: TransferResult[] };
    },
    onSuccess: ({ results }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/snapshot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      if (failures.length === 0) {
        const total = successes.reduce((s, r) => s + r.quantity, 0);
        toast({
          title: "Transfer recorded",
          description: `Moved ${total} unit${total === 1 ? "" : "s"} across ${successes.length} SKU${successes.length === 1 ? "" : "s"} from Hildale to Pyvott.`,
        });
        onClose();
      } else if (successes.length === 0) {
        toast({
          variant: "destructive",
          title: "Transfer failed",
          description: failures.map((f) => `${f.sku || f.itemId}: ${f.error}`).join("; "),
        });
      } else {
        toast({
          variant: "destructive",
          title: "Partial transfer",
          description: `${successes.length} succeeded, ${failures.length} failed: ${failures.map((f) => `${f.sku || f.itemId} (${f.error})`).join("; ")}`,
        });
      }
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Transfer failed", description: err.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || mutation.isPending) return;
    mutation.mutate();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Transfer to Pyvott</DialogTitle>
          <DialogDescription>
            Record stock leaving Hildale and arriving at Pyvott. Hildale on-hand will
            decrement immediately; Pyvott will catch up on the next Extensiv sync.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>SKUs</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLine}
                data-testid="button-add-transfer-line"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add SKU
              </Button>
            </div>

            <ScrollArea className="max-h-[320px]">
              <div className="space-y-2 pr-4">
                {lines.map((line, index) => {
                  const item = line.itemId ? itemById.get(line.itemId) : undefined;
                  const available = item?.hildaleQty ?? 0;
                  const err = lineErrors[index];
                  return (
                    <div
                      key={index}
                      className="flex items-start gap-2 rounded border bg-muted/30 p-2"
                    >
                      <div className="flex-1 space-y-1">
                        <Select
                          value={line.itemId}
                          onValueChange={(v) => updateLine(index, { itemId: v })}
                          disabled={loadingItems}
                        >
                          <SelectTrigger data-testid={`select-transfer-sku-${index}`}>
                            <SelectValue
                              placeholder={loadingItems ? "Loading…" : "Select SKU…"}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {finishedProducts
                              .filter((p) => p.id === line.itemId || !chosenIds.has(p.id))
                              .map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.sku} — {p.name} (Hildale: {p.hildaleQty ?? 0})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {item && (
                          <p className="text-xs text-muted-foreground">
                            Available at Hildale: {available}
                          </p>
                        )}
                      </div>
                      <div className="w-28">
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          placeholder="Qty"
                          value={line.quantity}
                          onChange={(e) => updateLine(index, { quantity: e.target.value })}
                          disabled={!line.itemId}
                          data-testid={`input-transfer-qty-${index}`}
                        />
                        {err && (
                          <p className="mt-1 text-xs text-destructive" data-testid={`error-line-${index}`}>
                            {err}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(index)}
                        disabled={lines.length === 1}
                        data-testid={`button-remove-line-${index}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transfer-reason">Reason (optional)</Label>
            <Input
              id="transfer-reason"
              type="text"
              placeholder="e.g. Weekly Pyvott replenishment"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="input-transfer-reason"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={mutation.isPending}
              data-testid="button-cancel-transfer-to-pyvott"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || mutation.isPending}
              data-testid="button-submit-transfer-to-pyvott"
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mutation.isPending ? "Transferring…" : "Transfer to Pyvott"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
