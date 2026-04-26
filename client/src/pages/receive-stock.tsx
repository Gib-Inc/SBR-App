import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronsUpDown,
  Loader2,
  PackagePlus,
  Plus,
  Truck,
  X,
} from "lucide-react";

// Mobile-friendly receive-stock flow for Clarence. Three steps: pick a
// supplier (or skip), enter component lines, confirm. SKUs are intentionally
// hidden — Clarence picks by component name.

type Supplier = { id: string; name: string };
type Item = { id: string; sku: string; name: string; type: string; currentStock: number | null };

type Line = {
  key: string;
  itemId: string;
  quantity: string; // text input; parsed at submit
  lotNumber: string; // optional supplier-provided lot/batch number
};

type LineResult = {
  itemId: string;
  itemName: string;
  success: boolean;
  quantity: number;
  newStock: number;
  error?: string;
};

type Mode = "supplier" | "items" | "done";

let LINE_KEY_SEED = 0;
const newLine = (): Line => ({ key: `l${++LINE_KEY_SEED}`, itemId: "", quantity: "", lotNumber: "" });

export default function ReceiveStock() {
  const [mode, setMode] = useState<Mode>("supplier");
  const [supplierId, setSupplierId] = useState<string | null>(null); // null = skipped
  const [supplierPicked, setSupplierPicked] = useState(false); // distinguishes "not chosen" from "skipped"
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [results, setResults] = useState<LineResult[] | null>(null);

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ["/api/items"],
  });

  const components = useMemo(
    () => items.filter((i) => i.type === "component").sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const itemById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const c of components) m.set(c.id, c);
    return m;
  }, [components]);

  const supplier = supplierId ? suppliers.find((s) => s.id === supplierId) ?? null : null;

  const submitMutation = useMutation({
    mutationFn: async () => {
      const cleanLines = lines
        .filter((l) => l.itemId && l.quantity && Number(l.quantity) > 0)
        .map((l) => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          // Optional lot/batch number — only sent when filled in.
          lotNumber: l.lotNumber.trim() || undefined,
        }));
      const res = await apiRequest("POST", "/api/receive-stock", {
        supplierId: supplierId,
        lines: cleanLines,
      });
      const body = await res.json();
      return body.results as LineResult[];
    },
    onSuccess: (rows) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      setResults(rows);
      setMode("done");
    },
  });

  const startOver = () => {
    setMode("supplier");
    setSupplierId(null);
    setSupplierPicked(false);
    setLines([newLine()]);
    setResults(null);
  };

  return (
    <div className="p-4 mx-auto max-w-2xl space-y-6 pb-20" data-testid="page-receive-stock">
      {mode === "supplier" && (
        <SupplierStep
          suppliers={suppliers}
          value={supplierId}
          onPick={(id) => {
            setSupplierId(id);
            setSupplierPicked(true);
            setMode("items");
          }}
          onSkip={() => {
            setSupplierId(null);
            setSupplierPicked(true);
            setMode("items");
          }}
        />
      )}

      {mode === "items" && (
        <ItemsStep
          supplierName={supplier?.name ?? null}
          components={components}
          itemById={itemById}
          lines={lines}
          setLines={setLines}
          isSubmitting={submitMutation.isPending}
          onBack={() => setMode("supplier")}
          onConfirm={() => submitMutation.mutate()}
          submitError={(submitMutation.error as Error | null) ?? null}
        />
      )}

      {mode === "done" && results && (
        <DoneStep
          results={results}
          supplierName={supplier?.name ?? null}
          onStartOver={startOver}
          onRetryFailed={() => {
            // Pre-load a fresh items step with only the failed lines.
            const failedLines = results
              .filter((r) => !r.success)
              .map((r) => ({ key: `l${++LINE_KEY_SEED}`, itemId: r.itemId, quantity: String(r.quantity), lotNumber: "" }));
            setLines(failedLines.length > 0 ? failedLines : [newLine()]);
            setResults(null);
            setMode("items");
          }}
        />
      )}
    </div>
  );
}

// ─── Step 1: Supplier picker ────────────────────────────────────────────────

function SupplierStep({
  suppliers,
  value,
  onPick,
  onSkip,
}: {
  suppliers: Supplier[];
  value: string | null;
  onPick: (id: string) => void;
  onSkip: () => void;
}) {
  const [pending, setPending] = useState<string | null>(value);

  return (
    <>
      <header>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <PackagePlus className="h-7 w-7" /> Receive Stock
        </h1>
        <p className="text-muted-foreground mt-1">Who's delivering this load?</p>
      </header>

      <Card className="p-5 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="supplier" className="text-sm font-medium">
            Supplier
          </Label>
          <Select value={pending ?? ""} onValueChange={setPending}>
            <SelectTrigger id="supplier" className="h-14 text-lg" data-testid="select-supplier">
              <SelectValue placeholder="Select supplier…" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">No suppliers configured.</div>
              ) : (
                suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-base">
                    {s.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={() => pending && onPick(pending)}
          disabled={!pending}
          className="w-full h-14 text-lg"
          data-testid="button-supplier-continue"
        >
          Continue
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>

        <button
          type="button"
          onClick={onSkip}
          className="block mx-auto text-sm text-muted-foreground underline h-10 px-2"
          data-testid="link-skip-supplier"
        >
          Don't see your supplier? Skip
        </button>
      </Card>
    </>
  );
}

// ─── Step 2: Item entry ─────────────────────────────────────────────────────

function ItemsStep({
  supplierName,
  components,
  itemById,
  lines,
  setLines,
  isSubmitting,
  onBack,
  onConfirm,
  submitError,
}: {
  supplierName: string | null;
  components: Item[];
  itemById: Map<string, Item>;
  lines: Line[];
  setLines: React.Dispatch<React.SetStateAction<Line[]>>;
  isSubmitting: boolean;
  onBack: () => void;
  onConfirm: () => void;
  submitError: Error | null;
}) {
  const usedItemIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of lines) if (l.itemId) s.add(l.itemId);
    return s;
  }, [lines]);

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const removeLine = (key: string) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  };
  const addLine = () => setLines((prev) => [...prev, newLine()]);

  // Per-line validation: positive integer qty, non-empty itemId.
  const lineErrors = lines.map((l) => {
    if (!l.itemId && !l.quantity) return null; // empty line — ignored
    if (!l.itemId) return "Pick a component";
    if (!l.quantity) return "Enter a quantity";
    const n = Number(l.quantity);
    if (!Number.isInteger(n) || n <= 0) return "Quantity must be a positive whole number";
    return null;
  });
  const validLines = lines.filter((l, i) => l.itemId && l.quantity && !lineErrors[i]);
  const hasErrors = lineErrors.some((e) => !!e);
  const canSubmit = validLines.length > 0 && !hasErrors;
  const buttonLabel = `Receive ${validLines.length} item${validLines.length === 1 ? "" : "s"}${supplierName ? ` from ${supplierName}` : ""}`;

  return (
    <>
      <header className="space-y-1">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 h-10 -ml-2 px-2"
          data-testid="button-back-to-supplier"
        >
          <ArrowLeft className="h-4 w-4" /> Change supplier
        </button>
        <h1 className="text-3xl font-bold">What did you receive?</h1>
        <p className="text-muted-foreground inline-flex items-center gap-1.5">
          <Truck className="h-4 w-4" />
          {supplierName ?? "No supplier picked"}
        </p>
      </header>

      <Card className="p-4 space-y-3">
        {lines.map((line, index) => (
          <ItemRow
            key={line.key}
            line={line}
            error={lineErrors[index]}
            components={components}
            usedItemIds={usedItemIds}
            itemById={itemById}
            canRemove={lines.length > 1}
            onChange={(patch) => updateLine(line.key, patch)}
            onRemove={() => removeLine(line.key)}
            testIndex={index}
          />
        ))}

        <Button
          type="button"
          variant="outline"
          onClick={addLine}
          className="w-full h-12"
          data-testid="button-add-line"
        >
          <Plus className="mr-2 h-4 w-4" /> Add another item
        </Button>
      </Card>

      {submitError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-start justify-between gap-3">
          <span>✗ {submitError.message}</span>
        </div>
      )}

      <Button
        onClick={onConfirm}
        disabled={!canSubmit || isSubmitting}
        className="w-full h-14 text-lg bg-green-600 hover:bg-green-700 text-white"
        data-testid="button-receive-confirm"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Receiving…
          </>
        ) : (
          <>
            <Check className="mr-2 h-5 w-5" /> {buttonLabel}
          </>
        )}
      </Button>
    </>
  );
}

function ItemRow({
  line,
  error,
  components,
  usedItemIds,
  itemById,
  canRemove,
  onChange,
  onRemove,
  testIndex,
}: {
  line: Line;
  error: string | null;
  components: Item[];
  usedItemIds: Set<string>;
  itemById: Map<string, Item>;
  canRemove: boolean;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
  testIndex: number;
}) {
  const [open, setOpen] = useState(false);
  const selected = line.itemId ? itemById.get(line.itemId) : undefined;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2" data-testid={`line-${testIndex}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full h-12 justify-between text-base font-normal"
                data-testid={`button-pick-item-${testIndex}`}
              >
                <span className="truncate text-left">
                  {selected ? selected.name : "Pick a component…"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[min(92vw,28rem)]" align="start">
              <Command>
                <CommandInput placeholder="Search components…" />
                <CommandList>
                  <CommandEmpty>No components found.</CommandEmpty>
                  <CommandGroup>
                    {components.map((c) => {
                      const isUsedElsewhere = usedItemIds.has(c.id) && c.id !== line.itemId;
                      return (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          disabled={isUsedElsewhere}
                          onSelect={() => {
                            if (isUsedElsewhere) return;
                            onChange({ itemId: c.id });
                            setOpen(false);
                          }}
                          data-testid={`command-item-${c.id}`}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${line.itemId === c.id ? "opacity-100" : "opacity-0"}`}
                          />
                          <span className="flex-1">{c.name}</span>
                          {isUsedElsewhere && (
                            <span className="text-xs text-muted-foreground ml-2">already added</span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {selected && (
            <p className="mt-1 text-xs text-muted-foreground">
              Current stock: <span className="tabular-nums">{selected.currentStock ?? 0}</span>
            </p>
          )}
        </div>

        <Input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={line.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          placeholder="Qty"
          disabled={!line.itemId}
          className="w-24 h-12 text-center text-xl font-bold tabular-nums"
          data-testid={`input-qty-${testIndex}`}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-12 w-12 shrink-0"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Remove line"
          data-testid={`button-remove-${testIndex}`}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
      {/* Optional supplier-provided lot/batch number. When filled, the
          server creates an inventory_lots row so future BOM_CONSUMPTION
          events can FIFO-draw from this lot for traceability. */}
      {line.itemId && (
        <Input
          type="text"
          value={line.lotNumber}
          onChange={(e) => onChange({ lotNumber: e.target.value })}
          placeholder="Lot # (optional)"
          className="h-9 text-sm"
          data-testid={`input-lot-${testIndex}`}
        />
      )}
      {error && (
        <p className="text-xs text-destructive" data-testid={`line-error-${testIndex}`}>
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Step 3: Done ───────────────────────────────────────────────────────────

function DoneStep({
  results,
  supplierName,
  onStartOver,
  onRetryFailed,
}: {
  results: LineResult[];
  supplierName: string | null;
  onStartOver: () => void;
  onRetryFailed: () => void;
}) {
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  return (
    <Card className="p-6 space-y-4" data-testid="receive-done">
      <div>
        <h1 className="text-2xl font-bold">Done.</h1>
        <p className="text-muted-foreground">
          {succeeded.length} received{supplierName ? ` from ${supplierName}` : ""}.
          {failed.length > 0 && ` ${failed.length} failed.`}
        </p>
      </div>

      <ul className="divide-y">
        {results.map((r, i) => (
          <li key={i} className="py-2 flex items-start gap-2 text-sm" data-testid={`result-${i}`}>
            {r.success ? (
              <span className="text-green-700 dark:text-green-400 font-bold mt-0.5">✓</span>
            ) : (
              <span className="text-destructive font-bold mt-0.5">✗</span>
            )}
            <div className="flex-1 min-w-0">
              {r.success ? (
                <span>
                  <span className="font-semibold tabular-nums">{r.quantity}</span> {r.itemName} received.{" "}
                  <span className="text-muted-foreground">
                    Stock now <span className="tabular-nums text-foreground font-medium">{r.newStock}</span>.
                  </span>
                </span>
              ) : (
                <span>
                  <span className="font-medium">{r.itemName || r.itemId}</span>{" "}
                  <span className="text-destructive">— {r.error ?? "failed"}</span>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-col sm:flex-row gap-2">
        {failed.length > 0 && (
          <Button
            onClick={onRetryFailed}
            variant="outline"
            className="h-12 sm:flex-1"
            data-testid="button-retry-failed"
          >
            Retry failed ({failed.length})
          </Button>
        )}
        <Button
          onClick={onStartOver}
          className="h-12 sm:flex-1"
          data-testid="button-start-over"
        >
          <PackagePlus className="mr-2 h-5 w-5" /> Receive more
        </Button>
      </div>
    </Card>
  );
}
