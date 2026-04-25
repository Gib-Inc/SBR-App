import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const HEADLINE_SKU = "SBR-Extrawide2.0";
const HEADLINE_NAME = 'Push 2.0 Extra Wide 18" Roller';
const HEADLINE_MESSAGE =
  "🔴 CRITICALLY OUT OF STOCK — 0 units available. ~20 units/day velocity. Oversold at Pyvott.";
const OTHER_CRITICAL_VELOCITY_THRESHOLD = 50; // 90-day units sold
const DISMISS_KEY = `critical-banner:${HEADLINE_SKU}:dismissed`;

type SnapshotRow = {
  location: string;
  sku: string;
  name: string | null;
  qty: number;
};

type SkuVelocity = {
  sku: string;
  unitsSold: number;
};

type Aggregated = {
  sku: string;
  name: string;
  pyvott: number;
  hildale: number;
  total: number;
  unitsSold: number;
};

export function CriticalStockBanner() {
  const { data: snapshot } = useQuery<SnapshotRow[]>({
    queryKey: ["/api/inventory/snapshot"],
  });
  const { data: velocity } = useQuery<SkuVelocity[]>({
    queryKey: ["/api/inventory/sales-velocity"],
  });

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  });
  const [otherOpen, setOtherOpen] = useState(false);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // sessionStorage unavailable (private mode etc.) — keep in-memory dismissal only
    }
  };

  // If the headline SKU is restocked while the user is on the page, clear the
  // dismissal so a future stockout will alert again.
  useEffect(() => {
    if (!snapshot) return;
    let pyvott = 0;
    let hildale = 0;
    for (const r of snapshot) {
      if (r.sku !== HEADLINE_SKU) continue;
      if (r.location === "Pyvott") pyvott += r.qty;
      if (r.location === "Hildale") hildale += r.qty;
    }
    if (pyvott + hildale > 0 && window.sessionStorage.getItem(DISMISS_KEY) === "1") {
      window.sessionStorage.removeItem(DISMISS_KEY);
      setDismissed(false);
    }
  }, [snapshot]);

  const { headline, otherCritical } = useMemo(() => {
    const aggregateMap = new Map<string, Aggregated>();
    const velocityMap = new Map<string, number>();
    for (const v of velocity ?? []) velocityMap.set(v.sku, v.unitsSold);

    for (const r of snapshot ?? []) {
      const existing =
        aggregateMap.get(r.sku) ??
        ({
          sku: r.sku,
          name: r.name ?? r.sku,
          pyvott: 0,
          hildale: 0,
          total: 0,
          unitsSold: velocityMap.get(r.sku) ?? 0,
        } as Aggregated);
      if (r.location === "Pyvott") existing.pyvott += r.qty;
      if (r.location === "Hildale") existing.hildale += r.qty;
      existing.total = existing.pyvott + existing.hildale;
      if (!existing.name && r.name) existing.name = r.name;
      aggregateMap.set(r.sku, existing);
    }

    const headlineRow = aggregateMap.get(HEADLINE_SKU) ?? null;
    const headlineCritical = !!headlineRow && headlineRow.total === 0;

    const others = Array.from(aggregateMap.values())
      .filter(
        (row) =>
          row.sku !== HEADLINE_SKU &&
          row.total === 0 &&
          row.unitsSold > OTHER_CRITICAL_VELOCITY_THRESHOLD,
      )
      .sort((a, b) => b.unitsSold - a.unitsSold);

    return { headline: headlineCritical, otherCritical: others };
  }, [snapshot, velocity]);

  if (!headline || dismissed) return null;

  return (
    <div className="space-y-3" data-testid="critical-stock-banner">
      <Alert variant="destructive" className="pr-12">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle data-testid="critical-banner-title">{HEADLINE_NAME}</AlertTitle>
        <AlertDescription className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span data-testid="critical-banner-message">{HEADLINE_MESSAGE}</span>
          <Button
            asChild
            variant="destructive"
            size="sm"
            className="shrink-0"
            data-testid="critical-banner-view-inventory"
          >
            <Link href="/inventory">View Inventory</Link>
          </Button>
        </AlertDescription>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Dismiss alert"
          onClick={dismiss}
          className="absolute right-2 top-2 h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
          data-testid="critical-banner-dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </Alert>

      {otherCritical.length > 0 && (
        <Collapsible
          open={otherOpen}
          onOpenChange={setOtherOpen}
          data-testid="other-critical-collapsible"
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-between border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              data-testid="other-critical-toggle"
            >
              <span>
                Other critical items ({otherCritical.length})
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${otherOpen ? "rotate-180" : ""}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {otherCritical.map((row) => (
              <div
                key={row.sku}
                className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
                data-testid={`other-critical-row-${row.sku}`}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{row.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{row.sku}</div>
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0 pl-3">
                  0 on hand · {row.unitsSold.toLocaleString()} sold (90d)
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
