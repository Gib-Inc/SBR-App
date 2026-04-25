import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";

// Mobile shop-floor production logger. SKUs are intentionally hidden everywhere
// — only product names and big numbers. Cards stack vertically. Tap → bottom sheet.

// ─── Card configuration ────────────────────────────────────────────────────

type CardConfig = {
  key: string;
  label: string;
  // SKUs the card represents. If multiple, the sheet asks the user to pick
  // a variant before showing the action rows.
  skus: string[];
  // Optional shorter labels for the variant picker buttons, keyed by SKU.
  variantLabels?: Record<string, string>;
  // If primary SKU(s) aren't found, try matching an item by name pattern
  // (and the optional finishedProduct constraint). Used to track moving SKUs
  // like Bigfoot until the catalog is finalized.
  fallbackNameRegex?: RegExp;
  fallbackTypeFilter?: "finished_product" | "component";
  // The foam component SKU consumed when "Rolls Made" is logged from this card.
  foamComponentSku?: string;
};

const CARDS: CardConfig[] = [
  {
    key: "push-1-0",
    label: "Push Model 1.0",
    skus: ["101-PSH-M1"],
    foamComponentSku: "SBR-COMP-ROLLER-12",
  },
  {
    key: "push-2-0",
    label: "Push Model 2.0",
    skus: ["201-PSH-M2"],
    foamComponentSku: "SBR-COMP-ROLLER-18",
  },
  {
    key: "pull-behind",
    label: "Pull-Behind",
    skus: ["1001-PB-M1", "1200-PB-M2"],
    variantLabels: { "1001-PB-M1": "Original", "1200-PB-M2": "Bigfoot" },
  },
  {
    key: "bigfoot",
    label: "Bigfoot",
    skus: ["SBR-PB-BIGFOOT"],
    fallbackNameRegex: /bigfoot/i,
    fallbackTypeFilter: "finished_product",
  },
];

// Short display names used in the "This Week" copy/list. Falls back to the
// catalog name when a SKU isn't mapped here.
const SHORT_NAMES_BY_SKU: Record<string, string> = {
  "101-PSH-M1": "Push 1.0",
  "201-PSH-M2": "Push 2.0",
  "1001-PB-M1": "Pull-Behind Original",
  "1200-PB-M2": "Bigfoot",
  "SBR-PB-BIGFOOT": "Bigfoot",
};

// ─── Types ─────────────────────────────────────────────────────────────────

type Item = {
  id: string;
  sku: string;
  name: string;
  type: string;
};

type TodayTotals = {
  date: string;
  totals: Record<string, { rolls_made: number; built: number; boxed: number }>;
};

type WeekLog = {
  id: string;
  itemId: string;
  itemName: string;
  actionType: "rolls_made" | "built" | "boxed";
  quantity: number;
  productionDate: string;
  notes: string | null;
  createdAt: string;
};

type WeekResponse = { startDate: string; endDate: string; logs: WeekLog[] };

type ActionKey = "rolls_made" | "built" | "boxed";

type SaveBanner =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string; retry: () => void };

// ─── Date helpers (operate in user's local TZ) ─────────────────────────────

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatVoxerDate(isoDate: string): string {
  // "2026-04-25" → "Sat Apr 25"
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ─── Display helpers ───────────────────────────────────────────────────────

function shortNameForItem(sku: string | undefined, fallback: string): string {
  if (sku && SHORT_NAMES_BY_SKU[sku]) return SHORT_NAMES_BY_SKU[sku];
  return fallback;
}

// Resolve a card's primary item list. Tries exact SKU matches first; if none of
// the listed SKUs are found and the card has a fallback name pattern, returns
// the first item matching that pattern (and optional type filter).
function resolveCardItems(card: CardConfig, items: Item[]): Item[] {
  const bySku = new Map(items.map((i) => [i.sku, i] as const));
  const direct = card.skus.map((s) => bySku.get(s)).filter((x): x is Item => !!x);
  if (direct.length > 0) return direct;
  if (card.fallbackNameRegex) {
    const fallback = items.find(
      (i) =>
        card.fallbackNameRegex!.test(i.name ?? "") &&
        (!card.fallbackTypeFilter || i.type === card.fallbackTypeFilter),
    );
    if (fallback) return [fallback];
  }
  return [];
}

function actionVerb(action: ActionKey, qty: number): string {
  if (action === "rolls_made") {
    return `${qty} foam roller${qty === 1 ? "" : "s"} made`;
  }
  if (action === "boxed") return `${qty} boxed`;
  return `${qty} built`;
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function Production() {
  const [openSheetKey, setOpenSheetKey] = useState<string | null>(null);
  const today = todayISO();

  const { data: items = [], isLoading: itemsLoading } = useQuery<Item[]>({
    queryKey: ["/api/items"],
  });

  const itemBySku = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of items) m.set(it.sku, it);
    return m;
  }, [items]);

  // Resolve each card's items once (handles fallback name search for cards
  // whose primary SKU isn't in the catalog yet).
  const cardItems = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const card of CARDS) {
      map.set(card.key, resolveCardItems(card, items));
    }
    return map;
  }, [items]);

  // De-duplicated list of tracked item IDs for the today-totals query.
  const trackedItemIds = useMemo(() => {
    const set = new Set<string>();
    for (const list of Array.from(cardItems.values())) {
      for (const it of list) set.add(it.id);
    }
    return Array.from(set);
  }, [cardItems]);

  const { data: todayData } = useQuery<TodayTotals>({
    queryKey: [`/api/production-logs/today-totals?date=${today}&itemIds=${trackedItemIds.join(",")}`],
    enabled: trackedItemIds.length > 0,
  });

  const { data: weekData } = useQuery<WeekResponse>({
    queryKey: [`/api/production-logs/week?endDate=${today}&days=7`],
  });

  const todayTotalForCard = (card: CardConfig): number => {
    if (!todayData) return 0;
    const list = cardItems.get(card.key) ?? [];
    let sum = 0;
    for (const it of list) {
      sum += todayData.totals[it.id]?.built ?? 0;
    }
    return sum;
  };

  const openCard = openSheetKey ? CARDS.find((c) => c.key === openSheetKey) ?? null : null;

  return (
    <div className="p-4 mx-auto max-w-2xl space-y-6" data-testid="page-production">
      <header>
        <h1 className="text-3xl font-bold">Production</h1>
        <p className="text-muted-foreground">Tap a product to log work.</p>
      </header>

      {/* Section 1: Product cards */}
      <section className="space-y-3" aria-label="Log today's work">
        {CARDS.map((card) => {
          const built = todayTotalForCard(card);
          const resolved = cardItems.get(card.key) ?? [];
          const missing = resolved.length === 0;
          return (
            <Card
              key={card.key}
              role="button"
              tabIndex={0}
              onClick={() => !missing && setOpenSheetKey(card.key)}
              onKeyDown={(e) => {
                if (!missing && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setOpenSheetKey(card.key);
                }
              }}
              className={`min-h-[88px] flex items-center justify-between p-5 transition-colors active:bg-accent ${
                missing ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-accent/50"
              }`}
              data-testid={`card-product-${card.key}`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-2xl font-bold leading-tight">{card.label}</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {missing
                    ? "Not in catalog yet"
                    : itemsLoading
                    ? "Loading…"
                    : built === 0
                    ? "Nothing logged today"
                    : `${built} built today`}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                <div className="text-right">
                  <div
                    className="text-4xl font-bold tabular-nums"
                    data-testid={`today-built-${card.key}`}
                  >
                    {built}
                  </div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">
                    today
                  </div>
                </div>
                <ChevronRight className="h-6 w-6 text-muted-foreground" />
              </div>
            </Card>
          );
        })}
      </section>

      {openCard && (
        <ProductionSheet
          card={openCard}
          resolvedItems={cardItems.get(openCard.key) ?? []}
          itemBySku={itemBySku}
          onClose={() => setOpenSheetKey(null)}
        />
      )}

      {/* Section 2: This week */}
      <WeekReport week={weekData} itemBySku={itemBySku} />
    </div>
  );
}

// ─── Bottom sheet ───────────────────────────────────────────────────────────

function ProductionSheet({
  card,
  resolvedItems,
  itemBySku,
  onClose,
}: {
  card: CardConfig;
  resolvedItems: Item[];
  itemBySku: Map<string, Item>;
  onClose: () => void;
}) {
  const today = todayISO();
  const requiresVariant = resolvedItems.length > 1;
  const [selectedSku, setSelectedSku] = useState<string | null>(
    requiresVariant ? null : resolvedItems[0]?.sku ?? null,
  );
  const [date, setDate] = useState(today);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [notes, setNotes] = useState("");
  const [rolls, setRolls] = useState(0);
  const [built, setBuilt] = useState(0);
  const [boxed, setBoxed] = useState(0);
  const [banner, setBanner] = useState<SaveBanner>({ kind: "idle" });
  const bannerTimer = useRef<number | null>(null);
  const [mode, setMode] = useState<"main" | "report">("main");

  useEffect(() => {
    return () => {
      if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    };
  }, []);

  const selectedItem = selectedSku ? itemBySku.get(selectedSku) ?? null : null;
  const titleName = selectedItem
    ? shortNameForItem(selectedItem.sku, selectedItem.name)
    : card.label;

  const reset = () => {
    setRolls(0);
    setBuilt(0);
    setBoxed(0);
    setNotes("");
  };

  const submitMutation = useMutation({
    mutationFn: async (payload: {
      itemId: string;
      entries: Array<{ actionType: ActionKey; quantity: number }>;
    }) => {
      const results: Array<{
        actionType: ActionKey;
        quantity: number;
        ok: boolean;
        error?: string;
        warnings?: string[];
      }> = [];
      const foamItem = card.foamComponentSku ? itemBySku.get(card.foamComponentSku) : undefined;
      for (const entry of payload.entries) {
        try {
          const res = await apiRequest("POST", "/api/production-logs", {
            itemId: payload.itemId,
            actionType: entry.actionType,
            quantity: entry.quantity,
            productionDate: date,
            notes: notes || undefined,
            componentItemId: entry.actionType === "rolls_made" ? foamItem?.id : undefined,
          });
          const body = await res.json();
          results.push({
            actionType: entry.actionType,
            quantity: entry.quantity,
            ok: true,
            warnings: body.warnings ?? [],
          });
        } catch (err: any) {
          results.push({
            actionType: entry.actionType,
            quantity: entry.quantity,
            ok: false,
            error: err?.message ?? "Unknown error",
          });
        }
      }
      return results;
    },
  });

  const runSubmit = (entries: Array<{ actionType: ActionKey; quantity: number }>) => {
    if (!selectedItem) return;
    setBanner({ kind: "saving" });
    submitMutation.mutate(
      { itemId: selectedItem.id, entries },
      {
        onSuccess: (results) => {
          queryClient.invalidateQueries({ queryKey: ["/api/items"] });
          queryClient.invalidateQueries({
            predicate: (q) =>
              typeof q.queryKey[0] === "string" &&
              (q.queryKey[0] as string).startsWith("/api/production-logs"),
          });

          const failed = results.filter((r) => !r.ok);
          if (failed.length > 0) {
            const first = failed[0];
            const remaining = results
              .filter((r) => !r.ok)
              .map((r) => ({ actionType: r.actionType, quantity: r.quantity }));
            setBanner({
              kind: "error",
              message: `${first.actionType} failed — ${first.error}`,
              retry: () => runSubmit(remaining),
            });
            return;
          }

          const parts = results.map((r) => {
            if (r.actionType === "rolls_made") return actionVerb(r.actionType, r.quantity);
            return `${r.quantity} ${titleName} ${r.actionType === "built" ? "built" : "boxed"}`;
          });
          const allWarnings = results.flatMap((r) => r.warnings ?? []);
          const warningSuffix = allWarnings.length > 0 ? `  ⚠ ${allWarnings.join(" ")}` : "";
          setBanner({
            kind: "success",
            message: `✓ Saved — ${parts.join(", ")} logged${warningSuffix}`,
          });
          reset();
          if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
          bannerTimer.current = window.setTimeout(() => setBanner({ kind: "idle" }), 4000);
        },
      },
    );
  };

  const doSave = () => {
    if (!selectedItem) return;
    const entries: Array<{ actionType: ActionKey; quantity: number }> = [];
    if (rolls > 0) entries.push({ actionType: "rolls_made", quantity: rolls });
    if (built > 0) entries.push({ actionType: "built", quantity: built });
    if (boxed > 0) entries.push({ actionType: "boxed", quantity: boxed });
    if (entries.length === 0) {
      setBanner({
        kind: "error",
        message: "Enter a quantity in at least one row.",
        retry: () => setBanner({ kind: "idle" }),
      });
      return;
    }
    runSubmit(entries);
  };

  const showReportSubmitted = () => {
    setMode("main");
    setBanner({ kind: "success", message: "✓ Report submitted" });
    if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner({ kind: "idle" }), 4000);
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] overflow-y-auto rounded-t-2xl"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-2xl font-bold flex items-center gap-2">
            {mode === "report" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 -ml-2"
                onClick={() => setMode("main")}
                aria-label="Back"
                data-testid="button-back-from-report"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            {mode === "report" ? "Report an issue" : titleName}
          </SheetTitle>
        </SheetHeader>

        {mode === "report" && selectedItem && (
          <IssueReportForm
            item={selectedItem}
            onSubmitted={showReportSubmitted}
          />
        )}

        {mode === "main" && requiresVariant && !selectedSku && (
          <div className="mt-4 space-y-2" data-testid="variant-picker">
            <Label className="text-sm text-muted-foreground">Which one?</Label>
            <div className="grid grid-cols-1 gap-2">
              {resolvedItems.map((item) => {
                const label = card.variantLabels?.[item.sku] ?? item.name;
                return (
                  <Button
                    key={item.sku}
                    variant="outline"
                    className="h-14 text-lg justify-start"
                    onClick={() => setSelectedSku(item.sku)}
                    data-testid={`variant-${item.sku}`}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {mode === "main" && selectedSku && selectedItem && (
          <div className="mt-4 space-y-4">
            <BuildableHint itemId={selectedItem.id} />
            <ActionRow
              icon="🔩"
              label="Rolls Made"
              hint="foam roller production"
              value={rolls}
              onChange={setRolls}
              testId="row-rolls-made"
            />
            <ActionRow
              icon="🔨"
              label="Built"
              hint="assembled units (deducts components)"
              value={built}
              onChange={setBuilt}
              testId="row-built"
            />
            <ActionRow
              icon="📦"
              label="Boxed"
              hint="packaged (no stock change)"
              value={boxed}
              onChange={setBoxed}
              testId="row-boxed"
            />

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Date: <span className="font-medium text-foreground">{formatVoxerDate(date)}</span>
              </span>
              {showDatePicker ? (
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value || today)}
                  className="w-44 h-10"
                  data-testid="date-picker"
                />
              ) : (
                <button
                  type="button"
                  className="text-primary underline text-sm h-10 px-2"
                  onClick={() => setShowDatePicker(true)}
                  data-testid="show-date-picker"
                >
                  Different date?
                </button>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="prod-notes" className="text-sm text-muted-foreground">
                Notes (optional)
              </Label>
              <Input
                id="prod-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. short on sleeves"
                className="h-12 text-base"
                data-testid="input-notes"
              />
            </div>

            {banner.kind === "success" && (
              <div
                className="rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400"
                data-testid="banner-success"
              >
                {banner.message}
              </div>
            )}
            {banner.kind === "error" && (
              <div
                className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-start justify-between gap-3"
                data-testid="banner-error"
              >
                <span>✗ {banner.message}</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => banner.retry()}
                  data-testid="button-retry"
                >
                  Retry
                </Button>
              </div>
            )}

            <Button
              onClick={doSave}
              disabled={banner.kind === "saving"}
              className="w-full h-14 text-lg bg-green-600 hover:bg-green-700 text-white"
              data-testid="button-log-it"
            >
              {banner.kind === "saving" ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="mr-2 h-5 w-5" />
                  Log It
                </>
              )}
            </Button>

            <button
              type="button"
              onClick={() => setMode("report")}
              className="block mx-auto text-sm text-muted-foreground underline h-10 px-2"
              data-testid="link-report-issue"
            >
              Report an issue
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Read-only pre-build hint shown at the top of the sheet. Hidden when there's
// no BOM for the product. Threshold: ≥10 buildable = green, 1–9 = amber,
// 0 = red.
function BuildableHint({ itemId }: { itemId: string }) {
  type Buildable = {
    hasBOM: boolean;
    canBuild: number | null;
    limitingComponentName: string | null;
  };
  const { data, isLoading } = useQuery<Buildable>({
    queryKey: [`/api/production-logs/buildable?itemId=${itemId}`],
  });

  if (isLoading || !data || !data.hasBOM) return null;

  const can = data.canBuild ?? 0;
  if (can >= 10) {
    return (
      <div
        className="rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm font-medium text-green-700 dark:text-green-400"
        data-testid="buildable-hint"
      >
        ✅ Enough for {can} unit{can === 1 ? "" : "s"}
      </div>
    );
  }
  if (can > 0) {
    const limit = data.limitingComponentName ?? "a component";
    return (
      <div
        className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-medium text-amber-700 dark:text-amber-400"
        data-testid="buildable-hint"
      >
        ⚠️ Enough for {can} unit{can === 1 ? "" : "s"} — {limit} is the limit
      </div>
    );
  }
  return (
    <div
      className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm font-medium text-destructive"
      data-testid="buildable-hint"
    >
      🔴 Missing components — check stock
    </div>
  );
}

// In-sheet issue report form. Shown when the sheet's mode === "report".
function IssueReportForm({
  item,
  onSubmitted,
}: {
  item: Item;
  onSubmitted: () => void;
}) {
  const ISSUE_TYPES: Array<{ value: string; label: string }> = [
    { value: "defective_component", label: "Defective component" },
    { value: "short_shipment", label: "Short shipment" },
    { value: "equipment_problem", label: "Equipment problem" },
    { value: "other", label: "Other" },
  ];
  const [issueType, setIssueType] = useState<string>("");
  const [issueNotes, setIssueNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/shop-issues", {
        itemId: item.id,
        issueType,
        notes: issueNotes,
      });
      return await res.json();
    },
    onSuccess: () => {
      onSubmitted();
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to submit");
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!issueType) {
      setError("Pick an issue type.");
      return;
    }
    if (!issueNotes.trim()) {
      setError("Notes are required.");
      return;
    }
    mutation.mutate();
  };

  const titleName = shortNameForItem(item.sku, item.name);

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <div className="rounded-md bg-muted/50 p-3 text-sm">
        Item: <span className="font-medium">{titleName}</span>
      </div>

      <div className="space-y-1">
        <Label htmlFor="issue-type" className="text-sm text-muted-foreground">
          Issue type
        </Label>
        <Select value={issueType} onValueChange={setIssueType}>
          <SelectTrigger id="issue-type" className="h-12 text-base" data-testid="select-issue-type">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {ISSUE_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="issue-notes" className="text-sm text-muted-foreground">
          Notes
        </Label>
        <Textarea
          id="issue-notes"
          value={issueNotes}
          onChange={(e) => setIssueNotes(e.target.value)}
          placeholder="Describe what happened"
          rows={4}
          className="text-base"
          data-testid="textarea-issue-notes"
        />
      </div>

      {error && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-start justify-between gap-3"
          data-testid="banner-issue-error"
        >
          <span>✗ {error}</span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => mutation.mutate()}
            data-testid="button-retry-issue"
          >
            Retry
          </Button>
        </div>
      )}

      <Button
        type="submit"
        disabled={mutation.isPending}
        className="w-full h-14 text-lg"
        data-testid="button-submit-issue"
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Submitting…
          </>
        ) : (
          "Submit Report"
        )}
      </Button>
    </form>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  value,
  onChange,
  testId,
}: {
  icon: string;
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
  testId: string;
}) {
  const set = (n: number) => onChange(Math.max(0, Math.floor(n)));
  return (
    <div className="rounded-lg border bg-muted/30 p-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold flex items-center gap-2">
            <span aria-hidden>{icon}</span>
            {label}
          </div>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-12 w-12"
            onClick={() => set(value - 1)}
            disabled={value <= 0}
            aria-label={`Decrease ${label}`}
            data-testid={`${testId}-decrement`}
          >
            <Minus className="h-5 w-5" />
          </Button>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={value === 0 ? "" : String(value)}
            onChange={(e) => set(Number(e.target.value) || 0)}
            placeholder="0"
            className="h-12 w-20 text-center text-2xl font-bold tabular-nums"
            data-testid={`${testId}-input`}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-12 w-12"
            onClick={() => set(value + 1)}
            aria-label={`Increase ${label}`}
            data-testid={`${testId}-increment`}
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── This week ─────────────────────────────────────────────────────────────

function buildWeekLines(
  week: WeekResponse | undefined,
  itemBySku: Map<string, Item>,
): Array<{ date: string; line: string }> {
  if (!week) return [];

  const skuByItemId = new Map<string, string>();
  for (const item of Array.from(itemBySku.values())) skuByItemId.set(item.id, item.sku);

  // Collapse multiple log rows into a single phrase per (date, action, item).
  type Bucket = Map<ActionKey, Map<string, { qty: number; itemName: string }>>;
  const byDate = new Map<string, Bucket>();
  for (const log of week.logs) {
    if (!byDate.has(log.productionDate)) byDate.set(log.productionDate, new Map());
    const bucket = byDate.get(log.productionDate)!;
    if (!bucket.has(log.actionType)) bucket.set(log.actionType, new Map());
    const inner = bucket.get(log.actionType)!;
    const existing = inner.get(log.itemId) ?? { qty: 0, itemName: log.itemName };
    existing.qty += log.quantity;
    inner.set(log.itemId, existing);
  }

  const dates = Array.from(byDate.keys()).sort((a, b) => (a < b ? 1 : -1));
  const result: Array<{ date: string; line: string }> = [];
  for (const date of dates) {
    const bucket = byDate.get(date)!;
    const phrases: string[] = [];

    const built = bucket.get("built");
    if (built) {
      for (const [itemId, info] of Array.from(built.entries())) {
        const sku = skuByItemId.get(itemId);
        const name = shortNameForItem(sku, info.itemName);
        phrases.push(`${info.qty} ${name} built`);
      }
    }
    const boxed = bucket.get("boxed");
    if (boxed) {
      for (const [itemId, info] of Array.from(boxed.entries())) {
        const sku = skuByItemId.get(itemId);
        const name = shortNameForItem(sku, info.itemName);
        phrases.push(`${info.qty} ${name} boxed`);
      }
    }
    const rolls = bucket.get("rolls_made");
    if (rolls) {
      let total = 0;
      for (const v of Array.from(rolls.values())) total += v.qty;
      if (total > 0) phrases.push(`${total} foam roller${total === 1 ? "" : "s"} made`);
    }

    if (phrases.length === 0) continue;
    result.push({ date, line: `${formatVoxerDate(date)} — ${phrases.join(", ")}` });
  }
  return result;
}

function WeekReport({
  week,
  itemBySku,
}: {
  week: WeekResponse | undefined;
  itemBySku: Map<string, Item>;
}) {
  const lines = useMemo(() => buildWeekLines(week, itemBySku), [week, itemBySku]);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const onCopy = async () => {
    const text = lines.map((l) => l.line).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="space-y-3" aria-label="This week">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">This Week</h2>
        <span className="text-xs text-muted-foreground">
          {lines.length} day{lines.length === 1 ? "" : "s"} of activity
        </span>
      </div>

      {lines.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">
          Nothing logged this week yet.
        </Card>
      ) : (
        <Card className="divide-y" data-testid="week-list">
          {lines.map((l) => (
            <div key={l.date} className="p-3 text-base" data-testid={`week-row-${l.date}`}>
              {l.line}
            </div>
          ))}
        </Card>
      )}

      <Button
        onClick={onCopy}
        disabled={lines.length === 0}
        className="w-full h-14 text-base"
        variant="outline"
        data-testid="button-copy-week"
      >
        {copied ? (
          <>
            <Check className="mr-2 h-5 w-5 text-green-600" />
            Copied!
          </>
        ) : (
          <>
            <ClipboardCheck className="mr-2 h-5 w-5" />
            📋 Copy Weekly Report
          </>
        )}
      </Button>
    </section>
  );
}
