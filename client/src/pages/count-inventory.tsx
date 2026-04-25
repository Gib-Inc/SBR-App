import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  ClipboardList,
  Factory,
  Loader2,
  Warehouse,
  X,
} from "lucide-react";

// Mobile-first multi-step inventory counter for Sammie. SKUs hidden everywhere
// — names only. Progress saved to localStorage so a tab close doesn't lose the
// session.

type Location = "raw-materials" | "hildale" | "pyvott";

type ResolvedItem = {
  display: string;
  itemId: string | null;
  itemName: string | null;
  lastValue: number | null;
  lastCountedAt: string | null;
};

type ItemsResponse = { location: Location; items: ResolvedItem[] };
type LocationsResponse = { lastCountAt: Record<Location, string | null> };
type SubmitResponse = {
  location: Location;
  submittedBy: string;
  summary: { total: number; changed: number; unchanged: number; failed: number };
  results: Array<{ itemId: string; success: boolean; difference: number; before: number; after: number; error?: string }>;
};

type Mode = "location" | "count" | "review" | "done";

const LOCATION_META: Record<Location, { label: string; subtitle: string; icon: typeof Warehouse }> = {
  "raw-materials": {
    label: "Raw Materials",
    subtitle: "Hardware, sleeves, boxes",
    icon: Boxes,
  },
  hildale: {
    label: "Hildale",
    subtitle: "Finished goods + replacement parts",
    icon: Factory,
  },
  pyvott: {
    label: "Pyvott",
    subtitle: "Finished goods at Spanish Fork",
    icon: Warehouse,
  },
};

const LS_KEY = (loc: Location) => `count-inventory:${loc}`;

type StoredCounts = {
  // itemId or display fallback as key. We persist by display name so an
  // unresolved item (itemId=null) can still hold an entered value.
  values: Record<string, number | null>; // null = explicitly skipped
  currentIndex: number;
  savedAt: string;
};

function loadStored(loc: Location): StoredCounts | null {
  try {
    const raw = window.localStorage.getItem(LS_KEY(loc));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as StoredCounts;
  } catch {
    return null;
  }
}

function saveStored(loc: Location, data: StoredCounts) {
  try {
    window.localStorage.setItem(LS_KEY(loc), JSON.stringify(data));
  } catch {
    // best-effort
  }
}

function clearStored(loc: Location) {
  try {
    window.localStorage.removeItem(LS_KEY(loc));
  } catch {
    // best-effort
  }
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "Never counted";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never counted";
  return `Last counted ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export default function CountInventory() {
  const [mode, setMode] = useState<Mode>("location");
  const [location, setLocation] = useState<Location | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [doneSummary, setDoneSummary] = useState<SubmitResponse | null>(null);

  const { data: locationsData } = useQuery<LocationsResponse>({
    queryKey: ["/api/count-inventory/locations"],
  });

  const { data: itemsData, isLoading: itemsLoading, isError: itemsError, error: itemsErr } = useQuery<ItemsResponse>({
    queryKey: [`/api/count-inventory/items?location=${location}`],
    enabled: mode === "count" || mode === "review",
  });

  const items = itemsData?.items ?? [];

  // When entering count mode, hydrate from localStorage if a prior session exists.
  useEffect(() => {
    if (mode !== "count" || !location) return;
    const stored = loadStored(location);
    if (stored) {
      setCounts(stored.values ?? {});
      setCurrentIndex(Math.min(stored.currentIndex ?? 0, Math.max(items.length - 1, 0)));
    }
    // Re-hydrate only when the location actively changes / we re-enter count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, location, itemsData?.items?.length]);

  // Persist on any change while we're in count mode.
  useEffect(() => {
    if (mode !== "count" || !location) return;
    saveStored(location, {
      values: counts,
      currentIndex,
      savedAt: new Date().toISOString(),
    });
  }, [counts, currentIndex, mode, location]);

  const startLocation = (loc: Location) => {
    setLocation(loc);
    setCurrentIndex(0);
    setCounts({});
    setMode("count");
  };

  const exitToPicker = () => {
    setMode("location");
    setLocation(null);
    setCounts({});
    setCurrentIndex(0);
    setDoneSummary(null);
    queryClient.invalidateQueries({ queryKey: ["/api/count-inventory/locations"] });
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!location) throw new Error("No location selected");
      const payload = {
        location,
        counts: items
          .filter((it) => it.itemId)
          .map((it) => {
            const key = it.itemId!;
            const stored = counts[key];
            return stored == null ? null : { itemId: key, actualQty: stored };
          })
          .filter((x): x is { itemId: string; actualQty: number } => x !== null),
      };
      const res = await apiRequest("POST", "/api/count-inventory/submit", payload);
      return (await res.json()) as SubmitResponse;
    },
    onSuccess: (data) => {
      if (location) clearStored(location);
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/snapshot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/count-inventory/locations"] });
      setDoneSummary(data);
      setMode("done");
    },
  });

  return (
    <div className="p-4 mx-auto max-w-2xl space-y-6 pb-20" data-testid="page-count-inventory">
      {mode === "location" && (
        <LocationPicker
          lastCountAt={locationsData?.lastCountAt ?? { "raw-materials": null, hildale: null, pyvott: null }}
          onPick={startLocation}
        />
      )}

      {mode === "count" && location && (
        <>
          {itemsLoading ? (
            <CenteredSpinner />
          ) : itemsError ? (
            <ErrorPanel
              message={(itemsErr as Error)?.message ?? "Failed to load items"}
              onBack={exitToPicker}
            />
          ) : items.length === 0 ? (
            <ErrorPanel message="No items configured for this location." onBack={exitToPicker} />
          ) : (
            <CountStep
              location={location}
              items={items}
              counts={counts}
              setCounts={setCounts}
              currentIndex={currentIndex}
              setCurrentIndex={setCurrentIndex}
              onFinish={() => setMode("review")}
              onCancel={exitToPicker}
            />
          )}
        </>
      )}

      {mode === "review" && location && (
        <ReviewStep
          location={location}
          items={items}
          counts={counts}
          isSubmitting={submitMutation.isPending}
          submitError={submitMutation.error as Error | null}
          onBack={() => setMode("count")}
          onSubmit={() => submitMutation.mutate()}
          onRetry={() => submitMutation.mutate()}
        />
      )}

      {mode === "done" && location && doneSummary && (
        <DoneStep summary={doneSummary} onAnother={exitToPicker} />
      )}
    </div>
  );
}

// ─── Step 1: Location picker ───────────────────────────────────────────────

function LocationPicker({
  lastCountAt,
  onPick,
}: {
  lastCountAt: Record<Location, string | null>;
  onPick: (loc: Location) => void;
}) {
  const order: Location[] = ["raw-materials", "hildale", "pyvott"];
  return (
    <>
      <header>
        <h1 className="text-3xl font-bold">Count Inventory</h1>
        <p className="text-muted-foreground mt-1">Pick a location to start counting.</p>
      </header>

      <section className="space-y-3" aria-label="Location picker">
        {order.map((loc) => {
          const meta = LOCATION_META[loc];
          const Icon = meta.icon;
          const stored = loadStored(loc);
          const inProgress = stored && Object.keys(stored.values).length > 0;
          return (
            <Card
              key={loc}
              role="button"
              tabIndex={0}
              onClick={() => onPick(loc)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(loc);
                }
              }}
              className="min-h-[110px] flex items-center gap-4 p-5 cursor-pointer hover:bg-accent/50 active:bg-accent transition-colors"
              data-testid={`location-${loc}`}
            >
              <div className="rounded-lg bg-primary/10 p-3 shrink-0">
                <Icon className="h-7 w-7 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-2xl font-bold leading-tight">{meta.label}</div>
                <div className="text-sm text-muted-foreground mt-0.5">{meta.subtitle}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {formatTimestamp(lastCountAt[loc])}
                  {inProgress && (
                    <span className="ml-2 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                      • In progress
                    </span>
                  )}
                </div>
              </div>
              <ArrowRight className="h-6 w-6 text-muted-foreground shrink-0" />
            </Card>
          );
        })}
      </section>
    </>
  );
}

// ─── Step 2: Item-by-item card ──────────────────────────────────────────────

function CountStep({
  location,
  items,
  counts,
  setCounts,
  currentIndex,
  setCurrentIndex,
  onFinish,
  onCancel,
}: {
  location: Location;
  items: ResolvedItem[];
  counts: Record<string, number | null>;
  setCounts: React.Dispatch<React.SetStateAction<Record<string, number | null>>>;
  currentIndex: number;
  setCurrentIndex: (n: number) => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const item = items[currentIndex];
  const itemKey = item?.itemId ?? `__display:${item?.display}`;
  const storedValue = counts[itemKey];
  const [draft, setDraft] = useState<string>(
    storedValue == null ? "" : String(storedValue),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the draft on item change. Autofocus the input.
  useEffect(() => {
    setDraft(storedValue == null ? "" : String(storedValue));
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  if (!item) {
    return <ErrorPanel message="Item index out of range." onBack={onCancel} />;
  }

  const total = items.length;
  const progressPct = ((currentIndex + 1) / total) * 100;
  const meta = LOCATION_META[location];
  const isUnmatched = !item.itemId;

  const commit = (value: number | null) => {
    setCounts((prev) => ({ ...prev, [itemKey]: value }));
  };

  const advance = () => {
    if (currentIndex >= total - 1) onFinish();
    else setCurrentIndex(currentIndex + 1);
  };

  const onSaveAndNext = () => {
    const n = Number(draft);
    if (draft === "" || !Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return; // button is disabled in this state; defensive
    }
    commit(n);
    advance();
  };

  const onSkip = () => {
    commit(null);
    advance();
  };

  const onPrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const canSave = draft !== "" && Number.isInteger(Number(draft)) && Number(draft) >= 0;

  return (
    <>
      {/* Header with progress + cancel */}
      <header className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{meta.label}</span>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            data-testid="button-exit-count"
          >
            <X className="h-4 w-4" /> Exit
          </button>
        </div>
        <div className="flex items-center justify-between text-sm font-medium">
          <span data-testid="progress-label">
            {currentIndex + 1} of {total}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {Math.round(progressPct)}%
          </span>
        </div>
        <div className="h-2 bg-muted rounded overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${progressPct}%` }}
            data-testid="progress-bar"
          />
        </div>
      </header>

      <Card className="p-6 space-y-5" data-testid="count-card">
        <div>
          <div className="text-3xl font-bold leading-tight" data-testid="item-name">
            {item.display}
          </div>
          {isUnmatched ? (
            <div className="mt-2 text-sm text-amber-700 dark:text-amber-400">
              ⚠️ Not found in catalog — skip this one.
            </div>
          ) : (
            <div className="mt-2 text-base text-muted-foreground">
              Last recorded: <span className="font-semibold text-foreground tabular-nums">{item.lastValue ?? 0}</span>
            </div>
          )}
        </div>

        {!isUnmatched && (
          <div>
            <label htmlFor="count-input" className="sr-only">Count</label>
            <Input
              id="count-input"
              ref={inputRef}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSave) {
                  e.preventDefault();
                  onSaveAndNext();
                }
              }}
              placeholder="0"
              className="h-20 text-5xl font-bold text-center tabular-nums"
              data-testid="count-input"
            />
          </div>
        )}

        <Button
          onClick={onSaveAndNext}
          disabled={!canSave || isUnmatched}
          className="w-full h-14 text-lg bg-green-600 hover:bg-green-700 text-white"
          data-testid="button-save-next"
        >
          <Check className="mr-2 h-5 w-5" />
          {currentIndex === total - 1 ? "Save & Review" : "Save & Next →"}
        </Button>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onPrev}
            disabled={currentIndex === 0}
            className="h-12"
            data-testid="button-prev"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Prev
          </Button>
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-muted-foreground underline h-12 px-3"
            data-testid="button-skip"
          >
            Skip
          </button>
        </div>
      </Card>
    </>
  );
}

// ─── Step 3: Review ─────────────────────────────────────────────────────────

function ReviewStep({
  location,
  items,
  counts,
  isSubmitting,
  submitError,
  onBack,
  onSubmit,
  onRetry,
}: {
  location: Location;
  items: ResolvedItem[];
  counts: Record<string, number | null>;
  isSubmitting: boolean;
  submitError: Error | null;
  onBack: () => void;
  onSubmit: () => void;
  onRetry: () => void;
}) {
  const meta = LOCATION_META[location];

  type Row = {
    display: string;
    last: number | null;
    next: number | null; // null = skipped
    changed: boolean;
    unmatched: boolean;
  };
  const rows: Row[] = items.map((it) => {
    const key = it.itemId ?? `__display:${it.display}`;
    const next = counts[key] === undefined ? null : counts[key];
    const last = it.lastValue ?? 0;
    const changed = next !== null && next !== last;
    return {
      display: it.display,
      last: it.lastValue,
      next,
      changed,
      unmatched: !it.itemId,
    };
  });

  const changedCount = rows.filter((r) => r.changed).length;
  const skippedCount = rows.filter((r) => r.next === null).length;

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Review — {meta.label}</h1>
        <p className="text-muted-foreground">
          {changedCount} changed · {rows.length - changedCount - skippedCount} same · {skippedCount} skipped
        </p>
      </header>

      <Card className="divide-y" data-testid="review-list">
        {rows.map((r) => (
          <div
            key={r.display}
            className={`flex items-center justify-between gap-3 p-3 text-base ${
              r.changed ? "bg-green-600/5" : ""
            }`}
            data-testid={`review-row-${r.display}`}
          >
            <div className="min-w-0">
              <div className={`font-medium ${r.unmatched ? "text-muted-foreground line-through" : ""}`}>
                {r.display}
              </div>
              {r.unmatched && (
                <div className="text-xs text-amber-700 dark:text-amber-400">Not in catalog</div>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0 tabular-nums">
              <span className="text-sm text-muted-foreground">{r.last ?? "—"}</span>
              <span className="text-muted-foreground">→</span>
              {r.next === null ? (
                <span className="text-muted-foreground" data-testid="review-skipped">—</span>
              ) : (
                <span
                  className={`text-lg font-bold ${
                    r.changed ? "text-green-700 dark:text-green-400" : ""
                  }`}
                  data-testid="review-next"
                >
                  {r.next}
                </span>
              )}
            </div>
          </div>
        ))}
      </Card>

      {submitError && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-start justify-between gap-3"
          data-testid="banner-submit-error"
        >
          <span>✗ Submit failed — {submitError.message}</span>
          <Button size="sm" variant="destructive" onClick={onRetry} data-testid="button-retry-submit">
            Retry
          </Button>
        </div>
      )}

      <Button
        onClick={onSubmit}
        disabled={isSubmitting}
        className="w-full h-14 text-lg bg-green-600 hover:bg-green-700 text-white"
        data-testid="button-submit-count"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Submitting…
          </>
        ) : (
          <>
            <Check className="mr-2 h-5 w-5" /> Submit Count
          </>
        )}
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="block mx-auto text-sm text-muted-foreground underline h-10 px-2"
        data-testid="button-back-to-edit"
      >
        ← Go back and edit
      </button>
    </>
  );
}

// ─── Step 4: Done ───────────────────────────────────────────────────────────

function DoneStep({
  summary,
  onAnother,
}: {
  summary: SubmitResponse;
  onAnother: () => void;
}) {
  const meta = LOCATION_META[summary.location];
  const ts = new Date().toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Card className="p-8 text-center space-y-4" data-testid="done-card">
      <div className="text-5xl">✓</div>
      <div className="text-2xl font-bold" data-testid="done-message">
        Count submitted — {summary.summary.changed} item{summary.summary.changed === 1 ? "" : "s"} updated for {meta.label}
      </div>
      <div className="text-sm text-muted-foreground">
        {summary.summary.unchanged} unchanged · {summary.summary.failed} failed · {ts}
      </div>
      {summary.summary.failed > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive text-left">
          Some items did not save:
          <ul className="list-disc list-inside mt-1">
            {summary.results.filter((r) => !r.success).slice(0, 5).map((r) => (
              <li key={r.itemId}>{r.error ?? "Unknown error"}</li>
            ))}
          </ul>
        </div>
      )}
      <Button
        onClick={onAnother}
        className="w-full h-14 text-lg"
        data-testid="button-count-another"
      >
        <ClipboardList className="mr-2 h-5 w-5" />
        Count another location
      </Button>
    </Card>
  );
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function CenteredSpinner() {
  return (
    <div className="flex items-center justify-center h-40 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

function ErrorPanel({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <Card className="p-5 space-y-3 text-center">
      <div className="text-destructive font-medium">{message}</div>
      <Button onClick={onBack} variant="outline" className="h-12">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to locations
      </Button>
    </Card>
  );
}
