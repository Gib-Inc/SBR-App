import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertTriangle, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";

// Three always-on dashboard widgets rendered below the System Overview on
// the Reports page. Each fetches its own data from existing endpoints — no
// new API surface — and handles its own loading state.

const WEEK_START_DAY = 0; // 0 = Sunday (US calendar week)
const VELOCITY_WINDOW_DAYS = 90;
const CRITICAL_LIST_LIMIT = 5;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Returns the Date at 00:00 local time for the start of the calendar week
// that contains `from`. Week starts on Sunday by default.
function startOfWeek(from: Date, weekStartDay: number = WEEK_START_DAY): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const delta = (d.getDay() - weekStartDay + 7) % 7;
  d.setDate(d.getDate() - delta);
  return d;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function DefaultWidgets() {
  return (
    <section
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
      data-testid="default-widgets"
    >
      <WeeklySalesWidget />
      <InventoryHealthWidget />
      <CriticalStockWidget />
    </section>
  );
}

// ─── Widget 1: Weekly Sales by Channel ─────────────────────────────────────

type SalesOrderRow = {
  id: string;
  channel: string; // 'SHOPIFY' | 'AMAZON' | 'GHL' | 'DIRECT' | 'OTHER'
  totalAmount: number;
  orderDate: string;
};

function WeeklySalesWidget() {
  // Window: this week + last week. We pull both in one request and partition
  // client-side so we can compute the % change without a second round-trip.
  const now = new Date();
  const thisWeekStart = startOfWeek(now);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const endExclusive = addDays(thisWeekStart, 7); // tomorrow's week boundary

  const startISO = lastWeekStart.toISOString();
  const endISO = endExclusive.toISOString();

  const { data: orders, isLoading, isError, error } = useQuery<SalesOrderRow[]>({
    queryKey: [
      `/api/sales-orders?view=historical&startDate=${startISO}&endDate=${endISO}`,
    ],
  });

  const stats = useMemo(() => {
    const weekly = { shopify: 0, amazon: 0, total: 0 };
    const lastWeekly = { shopify: 0, amazon: 0, total: 0 };
    for (const o of orders ?? []) {
      const dt = new Date(o.orderDate);
      const target = dt >= thisWeekStart ? weekly : dt >= lastWeekStart ? lastWeekly : null;
      if (!target) continue;
      const channel = (o.channel ?? "").toUpperCase();
      if (channel === "SHOPIFY") target.shopify += o.totalAmount ?? 0;
      else if (channel === "AMAZON") target.amazon += o.totalAmount ?? 0;
      target.total += o.totalAmount ?? 0;
    }
    let pctChange: number | null = null;
    if (lastWeekly.total > 0) {
      pctChange = ((weekly.total - lastWeekly.total) / lastWeekly.total) * 100;
    }
    return { weekly, lastWeekly, pctChange };
  }, [orders, thisWeekStart, lastWeekStart]);

  return (
    <Card data-testid="widget-weekly-sales">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sales This Week</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <WidgetSkeleton />
        ) : isError ? (
          <WidgetError message={(error as Error)?.message ?? "Failed to load"} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  Shopify
                </div>
                <div className="text-3xl font-bold tabular-nums" data-testid="weekly-sales-shopify">
                  {usd.format(stats.weekly.shopify)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  Amazon
                </div>
                <div className="text-3xl font-bold tabular-nums" data-testid="weekly-sales-amazon">
                  {usd.format(stats.weekly.amazon)}
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-baseline justify-between border-t pt-3">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Total</div>
                <div className="text-2xl font-bold tabular-nums" data-testid="weekly-sales-total">
                  {usd.format(stats.weekly.total)}
                </div>
              </div>
              {stats.pctChange !== null && (
                <PctChangeBadge value={stats.pctChange} />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PctChangeBadge({ value }: { value: number }) {
  const positive = value >= 0;
  const Icon = positive ? ArrowUp : ArrowDown;
  const colorClass = positive
    ? "text-green-700 dark:text-green-400"
    : "text-destructive";
  return (
    <div
      className={`flex items-center gap-1 text-sm font-medium ${colorClass}`}
      data-testid="weekly-sales-pct-change"
    >
      <Icon className="h-4 w-4" />
      {Math.abs(value).toFixed(0)}% vs last week
    </div>
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

function CriticalStockWidget() {
  const { data: snapshot, isLoading: snapLoading } = useQuery<SnapshotRow[]>({
    queryKey: ["/api/inventory/snapshot"],
  });
  const { data: velocity, isLoading: velLoading } = useQuery<Velocity[]>({
    queryKey: ["/api/inventory/sales-velocity"],
  });

  const top = useMemo(() => {
    if (!snapshot || !velocity) return [];
    const velMap = new Map<string, number>();
    for (const v of velocity) velMap.set(v.sku, v.unitsSold);

    type Row = { sku: string; name: string; total: number; unitsSold: number };
    const bySku = new Map<string, Row>();
    for (const r of snapshot) {
      const existing =
        bySku.get(r.sku) ??
        ({ sku: r.sku, name: r.name ?? r.sku, total: 0, unitsSold: velMap.get(r.sku) ?? 0 } as Row);
      existing.total += r.qty;
      if (!existing.name && r.name) existing.name = r.name;
      bySku.set(r.sku, existing);
    }

    return Array.from(bySku.values())
      .filter((r) => r.total === 0 && r.unitsSold > 0)
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, CRITICAL_LIST_LIMIT);
  }, [snapshot, velocity]);

  const isLoading = snapLoading || velLoading;

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
            No SKUs are out of stock with active sales.
          </div>
        ) : (
          <ul className="divide-y">
            {top.map((row) => {
              const perDay = Math.max(0, Math.round(row.unitsSold / VELOCITY_WINDOW_DAYS));
              return (
                <li
                  key={row.sku}
                  className="py-2 flex items-center justify-between gap-3"
                  data-testid={`critical-row-${row.sku}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{row.name}</div>
                    <div className="text-xs text-muted-foreground">
                      0 on hand · {perDay} unit{perDay === 1 ? "" : "s"}/day
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold tabular-nums text-destructive">0</div>
                  </div>
                </li>
              );
            })}
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
