import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronsUpDown, Loader2, AlertTriangle } from "lucide-react";

type Item = {
  id: string;
  sku: string;
  name: string;
  type: string;
  hildaleQty: number | null;
  currentStock: number | null;
};

type LocationKey = "HILDALE" | "COMPONENT";

const REASONS = ["Damaged", "Defective", "Lost", "Scrap", "Other"] as const;

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function WriteOffStockDialog({ isOpen, onClose }: Props) {
  const { toast } = useToast();
  const [location, setLocation] = useState<LocationKey | "">("");
  const [itemId, setItemId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ["/api/items"],
    enabled: isOpen,
  });

  // Filter the picker to items matching the chosen location.
  const candidates = useMemo(() => {
    if (location === "HILDALE") {
      return items.filter((i) => i.type === "finished_product").sort((a, b) => a.name.localeCompare(b.name));
    }
    if (location === "COMPONENT") {
      return items.filter((i) => i.type === "component").sort((a, b) => a.name.localeCompare(b.name));
    }
    return [];
  }, [items, location]);

  const selectedItem = items.find((i) => i.id === itemId) ?? null;

  // Reset selection when location changes so a stale item doesn't survive.
  useEffect(() => {
    setItemId("");
  }, [location]);

  // Clear everything when the dialog closes.
  useEffect(() => {
    if (!isOpen) {
      setLocation("");
      setItemId("");
      setQuantity("");
      setReason("");
      setNotes("");
      setError(null);
    }
  }, [isOpen]);

  const currentBalance = selectedItem
    ? location === "HILDALE"
      ? selectedItem.hildaleQty ?? 0
      : selectedItem.currentStock ?? 0
    : null;

  const qtyNum = Number(quantity);
  const qtyValid = quantity !== "" && Number.isInteger(qtyNum) && qtyNum > 0;
  const projected = currentBalance !== null && qtyValid ? currentBalance - qtyNum : null;
  const willHitFloor = projected !== null && projected < -10;

  const canSubmit = !!location && !!itemId && qtyValid && !!reason && !willHitFloor;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/inventory/writeoff", {
        itemId,
        location,
        quantity: qtyNum,
        reason,
        notes: notes.trim() || undefined,
      });
      return await res.json();
    },
    onSuccess: (data: { itemName: string; quantity: number; after: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/snapshot"] });
      toast({
        title: "✓ Written off",
        description: `${data.quantity} ${data.itemName} written off. Balance now ${data.after}.`,
      });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to write off");
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    mutation.mutate();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Write Off Stock
          </DialogTitle>
          <DialogDescription>
            Record damaged, lost, or scrapped stock. The system records this as a
            negative inventory transaction.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="writeoff-location" className="text-sm">Location</Label>
            <Select value={location} onValueChange={(v) => setLocation(v as LocationKey)}>
              <SelectTrigger id="writeoff-location" className="h-12" data-testid="select-writeoff-location">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HILDALE">Hildale (finished goods)</SelectItem>
                <SelectItem value="COMPONENT">Component (raw materials)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-sm">Item</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  disabled={!location}
                  className="w-full h-12 justify-between text-base font-normal"
                  data-testid="button-pick-writeoff-item"
                >
                  <span className="truncate text-left">
                    {selectedItem ? selectedItem.name : location ? "Pick an item…" : "Pick a location first"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[min(92vw,28rem)]" align="start">
                <Command>
                  <CommandInput placeholder="Search items…" />
                  <CommandList>
                    <CommandEmpty>No matching items.</CommandEmpty>
                    <CommandGroup>
                      {candidates.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          onSelect={() => {
                            setItemId(c.id);
                            setPickerOpen(false);
                          }}
                          data-testid={`writeoff-item-${c.id}`}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${itemId === c.id ? "opacity-100" : "opacity-0"}`}
                          />
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {selectedItem && currentBalance !== null && (
              <p className="text-xs text-muted-foreground">
                Current balance: <span className="tabular-nums font-medium">{currentBalance}</span>
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="writeoff-qty" className="text-sm">Quantity</Label>
            <Input
              id="writeoff-qty"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="h-12 text-xl font-bold tabular-nums"
              data-testid="input-writeoff-qty"
            />
            {projected !== null && (
              <p className={`text-xs ${willHitFloor ? "text-destructive" : "text-muted-foreground"}`}>
                Resulting balance: <span className="tabular-nums font-medium">{projected}</span>
                {willHitFloor && (
                  <span className="block">
                    Below the −10 floor — reduce the quantity to proceed.
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="writeoff-reason" className="text-sm">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="writeoff-reason" className="h-12" data-testid="select-writeoff-reason">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="writeoff-notes" className="text-sm">Notes (optional)</Label>
            <Input
              id="writeoff-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened?"
              className="h-12 text-base"
              data-testid="input-writeoff-notes"
            />
          </div>

          {error && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-start justify-between gap-3"
              data-testid="banner-writeoff-error"
            >
              <span>✗ {error}</span>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => mutation.mutate()}
                data-testid="button-retry-writeoff"
              >
                Retry
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={mutation.isPending}
              data-testid="button-cancel-writeoff"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!canSubmit || mutation.isPending}
              data-testid="button-submit-writeoff"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Writing off…
                </>
              ) : (
                "Write Off"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
