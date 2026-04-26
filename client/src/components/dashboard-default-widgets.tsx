import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, AlertTriangle, ArrowRight } from "lucide-react";

// Default Reports dashboard widgets. Each fetches its own data from existing
// endpoints — no new API surface — and handles its own loading state.

const VELOCITY_WINDOW_DAYS = 90;
const CRITICAL_LIST_LIMIT = 5;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const numFmt = new Intl.NumberFormat("en-US");

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function DefaultWidgets() {
  return (
    <section className="space-y-4" data-testid="default-widgets">
      <ProductPerformanceWidget />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InventoryHealthWidget />
        <CriticalStockWidget />
      </div>
    </section>
  );
}

// ─── Widget 1: Product Performance (units + revenue, 7d / 30d / 60d) ──────

type SalesOrderLineLite = {
  sku: string;
  qtyOrdered: number;
  qtyShipped?: number | null;
  unitPrice: number | null;
};

type SalesOrderWithLines = {
  id: string;
  orderDate: string;
  lines?: SalesOrderLineLite[];
};

type PerProduct = { units: number; revenue: number };
type PerWindow = Record<string, PerProduct>; // keyed by product SKU
type AllWindows = { d7: PerWindow; d30: PerWindow; d60: PerWindow };

const PRODUCTS: Array<{ sku: string; label: string }> = [
  { sku: "SBR-PUSH-1.0",     label: "Push 1.0" },
  { sku: "SBR-Extrawide2.0", label: "Push 2.0 Extra Wide" },
  { sku: "SBR-PB-ORIG",      label: "Pull-Behind Original" },
  { sku: "SBR-PB-BIGFOOT",   label: "Pull-Behind Bigfoot" },
];

const WINDOWS: Array<{ key: keyof AllWindows; label: string; days: number }> = [
  { key: "d7",  label: "7 days",  days: 7 },
  { key: "d30", label: "30 days", days: 30 },
  { key: "d60", label: "60 days", days: 60 },
];

function emptyWindow(): PerWindow {
  const w: PerWindow = {};
  for (const p of PRODUCTS) w[p.sku] = { units: 0, revenue: 0 };
  return w;
}

function ProductPerformanceWidget() {
  // Single fetch for the widest window (60d). Three client-side passes filter
  // by date and aggregate per product.
  const startISO = daysAgoISO(60);
  const { data: orders, isLoading, isError, error } = useQuery<SalesOrderWithLines[]>({
    queryKey: [
      `/api/sales-orders?view=historical&startDate=${startISO}&withLines=true`,
    ],
  });

  const aggregates = useMemo<AllWindows>(() => {
    const out: AllWindows = { d7: emptyWindow(), d30: emptyWindow(), d60: emptyWindow() };
    if (!orders) return out;
    const trackedSkus = new Set(PRODUCTS.map((p) => p.sku));
    const now = Date.now();
    const cutoffs = {
      d7:  now - 7  * 24 * 60 * 60 * 1000,
      d30: now - 30 * 24 * 60 * 60 * 1000,
      d60: now - 60 * 24 * 60 * 60 * 1000,
    };
    for (const order of orders) {
      const t = new Date(order.orderDate).getTime();
      if (Number.isNaN(t) || t < cutoffs.d60) continue;
      const buckets: Array<keyof AllWindows> = ["d60"];
      if (t >= cutoffs.d30) buckets.push("d30");
      if (t >= cutoffs.d7) buckets.push("d7");
      for (const line of order.lines ?? []) {
        if (!trackedSkus.has(line.sku)) continue;
        const qty = line.qtyOrdered ?? 0;
        const revenue = qty * (line.unitPrice ?? 0);
        for (const b of buckets) {
          out[b][line.sku].units += qty;
          out[b][line.sku].revenue += revenue;
        }
      }
    }
    return out;
  }, [orders]);

  const totals = useMemo(() => {
    const t: Record<keyof AllWindows, PerProduct> = {
      d7: { units: 0, revenue: 0 },
      d30: { units: 0, revenue: 0 },
      d60: { units: 0, revenue: 0 },
    };
    for (const w of WINDOWS) {
      for (const p of PRODUCTS) {
        t[w.key].units += aggregates[w.key][p.sku].units;
        t[w.key].revenue += aggregates[w.key][p.sku].revenue;
      }
    }
    return t;
  }, [aggregates]);

  return (
    <Card data-testid="widget-product-performance">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Product Performance</CardTitle>
        <CardDescription>Units sold and revenue by product</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <WidgetSkeleton />
        ) : isError ? (
          <WidgetError message={(error as Error)?.message ?? "Failed to load"} />
        ) : (
          <>
            {/* Desktop: side-by-side table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[34%]">Product</TableHead>
                    {WINDOWS.map((w) => (
                      <TableHead key={w.key} className="text-right">{w.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PRODUCTS.map((p) => (
                    <TableRow key={p.sku} data-testid={`product-perf-row-${p.sku}`}>
                      <TableCell className="font-medium">{p.label}</TableCell>
                      {WINDOWS.map((w) => {
                        const cell = aggregates[w.key][p.sku];
                        return (
                          <TableCell key={w.key} className="text-right tabular-nums">
                            <div className="font-semibold">
                              {numFmt.format(cell.units)} units
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {usd.format(cell.revenue)}
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell>Total</TableCell>
                    {WINDOWS.map((w) => (
                      <TableCell key={w.key} className="text-right tabular-nums">
                        <div>{numFmt.format(totals[w.key].units)} units</div>
                        <div className="text-xs text-muted-foreground">
                          {usd.format(totals[w.key].revenue)}
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* Mobile: per-product card with stacked period rows */}
            <div className="md:hidden space-y-3">
              {PRODUCTS.map((p) => (
                <div
                  key={p.sku}
                  className="rounded-md border bg-muted/30 p-3"
                  data-testid={`product-perf-mobile-${p.sku}`}
                >
                  <div className="font-medium text-base mb-2">{p.label}</div>
                  <div className="space-y-1.5">
                    {WINDOWS.map((w) => {
                      const cell = aggregates[w.key][p.sku];
                      return (
                        <div
                          key={w.key}
                          className="flex items-baseline justify-between text-sm tabular-nums"
                        >
                          <span className="text-muted-foreground">{w.label}</span>
                          <span>
                            <span className="font-semibold">{numFmt.format(cell.units)}</span>
                            <span className="text-muted-foreground"> units · </span>
                            <span>{usd.format(cell.revenue)}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="rounded-md border bg-muted/50 p-3 font-semibold">
                <div className="text-base mb-2">Total</div>
                <div className="space-y-1.5">
                  {WINDOWS.map((w) => (
                    <div
                      key={w.key}
                      className="flex items-baseline justify-between text-sm tabular-nums"
                    >
                      <span className="text-muted-foreground font-normal">{w.label}</span>
                      <span>
                        {numFmt.format(totals[w.key].units)} units · {usd.format(totals[w.key].revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Widget 2: Inventory Health ───────────────────────────────────────────

type ItemRow = {
  id: string;
  sku: string;
  name: string;
  type: string;
  hildaleQty: number | null;
  extensivOnHandSnapshot: number | null;
  minStock: number | null;
};

function InventoryHealthWidget() {
  const { data: items, isLoading, isError, error } = useQuery<ItemRow[]>({
    queryKey: ["/api/items"],
  });

  const stats = useMemo(() => {
    const finished = (items ?? []).filter((i) => i.type === "finished_product");
    let inStock = 0;
    let outOfStock = 0;
    let critical = 0;
    for (const it of finished) {
      const total = (it.extensivOnHandSnapshot ?? 0) + (it.hildaleQty ?? 0);
      const min = it.minStock ?? 0;
      if (total === 0) outOfStock++;
      else {
        inStock++;
        if (min > 0 && total < min) critical++;
      }
    }
    return { tracked: finished.length, inStock, outOfStock, critical };
  }, [items]);

  return (
    <Card data-testid="widget-inventory-health">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Inventory Status</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <WidgetSkeleton />
        ) : isError ? (
          <WidgetError message={(error as Error)?.message ?? "Failed to load"} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <HealthCell label="Total SKUs" value={stats.tracked} testId="inv-total" />
            <HealthCell
              label="In Stock"
              value={stats.inStock}
              valueClass="text-green-700 dark:text-green-400"
              testId="inv-in-stock"
            />
            <HealthCell
              label="Out of Stock"
              value={stats.outOfStock}
              valueClass={stats.outOfStock > 0 ? "text-destructive" : undefined}
              testId="inv-out-of-stock"
            />
            <HealthCell
              label="Below Min"
              value={stats.critical}
              valueClass={stats.critical > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
              testId="inv-critical"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HealthCell({
  label,
  value,
  valueClass,
  testId,
}: {
  label: string;
  value: number;
  valueClass?: string;
  testId: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div
        className={`text-3xl font-bold tabular-nums mt-1 ${valueClass ?? ""}`}
        data-testid={testId}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

// ─── Widget 3: Critical Stock Alerts ──────────────────────────────────────

type SnapshotRow = {
  location: string;
  sku: string;
  name: string | null;
  qty: number;
};

type Velocity = { sku: string; unitsSold: number };

type ItemForWidget = {
  id: string;
  name: string;
  type: string;
  currentStock: number | null;
  minStock: number | null;
  dailyUsage: number | null;
};

type AttentionRow =
  | { key: string; kind: "out"; name: string; perDay: number; rate: number }
  | {
      key: string;
      kind: "low";
      name: string;
      onHand: number;
      minStock: number;
      dailyUsage: number;
      rate: number;
    };

function CriticalStockWidget() {
  const { data: snapshot, isLoading: snapLoading } = useQuery<SnapshotRow[]>({
    queryKey: ["/api/inventory/snapshot"],
  });
  const { data: velocity, isLoading: velLoading } = useQuery<Velocity[]>({
    queryKey: ["/api/inventory/sales-velocity"],
  });
  const { data: items, isLoading: itemsLoading } = useQuery<ItemForWidget[]>({
    queryKey: ["/api/items"],
  });

  const top = useMemo<AttentionRow[]>(() => {
    if (!snapshot || !velocity || !items) return [];

    // 1. Finished goods at total = 0 with active sales (existing logic).
    const velMap = new Map<string, number>();
    for (const v of velocity) velMap.set(v.sku, v.unitsSold);

    type Bucket = { sku: string; name: string; total: number; unitsSold: number };
    const bySku = new Map<string, Bucket>();
    for (const r of snapshot) {
      const existing =
        bySku.get(r.sku) ??
        ({ sku: r.sku, name: r.name ?? r.sku, total: 0, unitsSold: velMap.get(r.sku) ?? 0 } as Bucket);
      existing.total += r.qty;
      if (!existing.name && r.name) existing.name = r.name;
      bySku.set(r.sku, existing);
    }
    const outRows: AttentionRow[] = Array.from(bySku.values())
      .filter((r) => r.total === 0 && r.unitsSold > 0)
      .map((r) => ({
        key: `out:${r.sku}`,
        kind: "out",
        name: r.name,
        perDay: Math.max(0, Math.round(r.unitsSold / VELOCITY_WINDOW_DAYS)),
        rate: r.unitsSold / VELOCITY_WINDOW_DAYS,
      }));

    // 2. Components at or below their configured minimum (min > 0).
    const lowRows: AttentionRow[] = items
      .filter(
        (i) =>
          i.type === "component" &&
          (i.minStock ?? 0) > 0 &&
          (i.currentStock ?? 0) <= (i.minStock ?? 0),
      )
      .map((i) => ({
        key: `low:${i.id}`,
        kind: "low",
        name: i.name,
        onHand: i.currentStock ?? 0,
        minStock: i.minStock ?? 0,
        dailyUsage: i.dailyUsage ?? 0,
        rate: i.dailyUsage ?? 0,
      }));

    // Two-tier sort: out-of-stock first, then below-min; secondary rate desc.
    return [...outRows, ...lowRows]
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "out" ? -1 : 1;
        return b.rate - a.rate;
      })
      .slice(0, CRITICAL_LIST_LIMIT);
  }, [snapshot, velocity, items]);

  const isLoading = snapLoading || velLoading || itemsLoading;

  return (
    <Card data-testid="widget-critical-stock">
      <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Needs Attention
        </CardTitle>
        <Link
          href="/inventory"
          className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
          data-testid="critical-view-all"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <WidgetSkeleton />
        ) : top.length === 0 ? (
          <div className="text-sm text-muted-foreground py-2">
            Stock is healthy across SKUs and components.
          </div>
        ) : (
          <ul className="divide-y">
            {top.map((row) =>
              row.kind === "out" ? (
                <li
                  key={row.key}
                  className="py-2 flex items-center justify-between gap-3"
                  data-testid={`critical-row-${row.key}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{row.name}</div>
                    <div className="text-xs text-destructive font-medium">Out of stock</div>
                    <div className="text-xs text-muted-foreground">
                      0 on hand · {row.perDay} unit{row.perDay === 1 ? "" : "s"}/day
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold tabular-nums text-destructive">0</div>
                  </div>
                </li>
              ) : (
                <li
                  key={row.key}
                  className="py-2 flex items-center justify-between gap-3"
                  data-testid={`critical-row-${row.key}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{row.name}</div>
                    <div className="text-xs text-amber-700 dark:text-amber-400 font-medium">Low component stock</div>
                    <div className="text-xs text-muted-foreground">
                      {row.onHand} on hand · min {row.minStock}
                      {row.dailyUsage > 0 && (
                        <>
                          {" · "}
                          {row.dailyUsage.toLocaleString(undefined, { maximumFractionDigits: 1 })}/day
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className="text-base font-bold tabular-nums text-amber-700 dark:text-amber-400"
                    >
                      {row.onHand}
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Shared ────────────────────────────────────────────────────────────────

function WidgetSkeleton() {
  return (
    <div className="flex items-center justify-center h-20 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

function WidgetError({ message }: { message: string }) {
  return (
    <div className="text-sm text-destructive">
      Couldn't load — {message}
    </div>
  );
}
