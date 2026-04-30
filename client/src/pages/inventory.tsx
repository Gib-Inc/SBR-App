import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Warehouse, Package, AlertTriangle, Loader2, ArrowUp, ArrowDown, ArrowUpDown, ArrowRightLeft, MinusCircle } from "lucide-react";
import { TransferToPyvottDialog } from "@/components/transfer-to-pyvott-dialog";
import { WriteOffStockDialog } from "@/components/write-off-stock-dialog";
import { useInventoryRealtime } from "@/hooks/use-inventory-realtime";

type SnapshotRow = {
  snapshot_date: string;
  location: string;
  sku: string;
  name: string | null;
  qty: number;
  promised?: number;
  source: string;
};

type SkuVelocity = {
  sku: string;
  unitsSold: number;
};

// Minimal shape from /api/items — only the fields we need for the price column.
type ItemsRow = {
  sku: string;
  sellingPrice: number | null;
};

// /api/sales-orders?view=all&withLines=true returns each order with its lines.
// We use this to compute "Committed" — the unshipped quantity sitting on
// open orders for each SKU.
type SalesOrderLineLite = {
  sku: string;
  qtyOrdered: number;
  qtyShipped?: number | null;
  backorderQty?: number | null;
};
type SalesOrderWithLines = {
  id: string;
  status: string;
  lines?: SalesOrderLineLite[];
};

type SkuStatus = "Out" | "Low" | "OK";

type SkuRow = {
  sku: string;
  name: string;
  pyvott: number;
  hildale: number;
  fx: number;
  promised: number;
  committed: number;
  total: number;
  available: number;
  unitsSold: number;
  sellingPrice: number | null;
  status: SkuStatus;
};

type SortColumn =
  | "sku"
  | "name"
  | "unitsSold"
  | "pyvott"
  | "committed"
  | "hildale"
  | "fx"
  | "promised"
  | "total"
  | "available"
  | "status"
  | "price";

type SortDirection = "asc" | "desc";

type SortState = { column: SortColumn; direction: SortDirection };

// Numeric columns default to descending on first click; text columns ascending.
const NUMERIC_COLUMNS: readonly SortColumn[] = ["unitsSold", "pyvott", "committed", "hildale", "fx", "promised", "total", "available", "price"] as const;

// "Available" is the headline number — Total minus what's promised to open
// orders. We highlight in amber once it dips below this many units AND there
// are real customer commitments outstanding.
const AVAILABLE_LOW_THRESHOLD = 10;

// Urgency ordering for status: most urgent (Out) first when asc.
const STATUS_ORDER: Record<SkuStatus, number> = { Out: 0, Low: 1, OK: 2 };

// A SKU is "low stock" if combined qty across locations falls below this number.
const LOW_STOCK_THRESHOLD = 20;

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function SortableHeader({
  column,
  label,
  align = "left",
  currentSort,
  onSort,
}: {
  column: SortColumn;
  label: string;
  align?: "left" | "right";
  currentSort: SortState;
  onSort: (column: SortColumn) => void;
}) {
  const isActive = currentSort.column === column;
  const Icon = !isActive ? ArrowUpDown : currentSort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 font-medium hover:text-foreground transition-colors select-none cursor-pointer"
        data-testid={`sort-${column}`}
      >
        {label}
        <Icon
          className={`h-3.5 w-3.5 ${isActive ? "text-foreground" : "text-muted-foreground/50"}`}
        />
      </button>
    </TableHead>
  );
}

export default function Inventory() {
  // Refetch the three queries this page reads when any item's stock changes
  // server-side. Sales-orders too — committed/available depend on it.
  useInventoryRealtime([
    "/api/inventory/snapshot",
    "/api/items",
    "/api/sales-orders",
  ]);

  const { data, isLoading, error } = useQuery<SnapshotRow[]>({
    queryKey: ["/api/inventory/snapshot"],
  });

  // Fetch sales velocity (last 90 days) for best-seller sorting
  const { data: velocityData } = useQuery<SkuVelocity[]>({
    queryKey: ["/api/inventory/sales-velocity"],
  });

  // Fetch items for selling_price. Endpoint returns more fields than we need —
  // we pick only sku + sellingPrice when building the lookup map.
  const { data: itemsData } = useQuery<ItemsRow[]>({
    queryKey: ["/api/items"],
  });

  // Pull all orders with their lines so we can show how many of each SKU are
  // already committed to open orders. No new endpoint — the ?withLines=true
  // projection added earlier surfaces qtyOrdered + qtyShipped per line.
  const { data: ordersData } = useQuery<SalesOrderWithLines[]>({
    queryKey: ["/api/sales-orders?view=all&withLines=true"],
  });

  const rows = data ?? [];
  const velocity = velocityData ?? [];
  const items = itemsData ?? [];
  const orders = ordersData ?? [];

  const [sort, setSort] = useState<SortState>({ column: "unitsSold", direction: "desc" });
  const [transferOpen, setTransferOpen] = useState(false);
  const [writeOffOpen, setWriteOffOpen] = useState(false);

  const onSort = (column: SortColumn) => {
    setSort((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      const defaultDir: SortDirection = NUMERIC_COLUMNS.includes(column) ? "desc" : "asc";
      return { column, direction: defaultDir };
    });
  };

  // Build a lookup map: SKU → unitsSold (for sorting)
  const velocityMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of velocity) {
      map.set(v.sku, v.unitsSold);
    }
    return map;
  }, [velocity]);

  // Build a lookup map: SKU → sellingPrice
  const priceMap = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const item of items) {
      map.set(item.sku, item.sellingPrice ?? null);
    }
    return map;
  }, [items]);

  // Build a lookup map: SKU → committed units across active sales orders.
  // "Committed" = unshipped portion (qtyOrdered − qtyShipped) on any order
  // that hasn't been cancelled/refunded/delivered/fulfilled. Shipped lines
  // drop out automatically because their unshipped portion is zero.
  // qtyOrdered/qtyShipped use ?? 0 so a null qtyShipped is treated as
  // "nothing shipped yet" (committed = full ordered quantity), not NaN.
  const committedMap = useMemo(() => {
    const TERMINAL = new Set([
      "FULFILLED",
      "CANCELLED",
      "DELIVERED",
      "REFUNDED",
      "PENDING_REFUND",
    ]);
    const map = new Map<string, number>();
    for (const o of orders) {
      if (TERMINAL.has(o.status)) continue;
      for (const line of o.lines ?? []) {
        if (!line.sku) continue;
        const open = Math.max(0, (line.qtyOrdered ?? 0) - (line.qtyShipped ?? 0));
        if (open <= 0) continue;
        map.set(line.sku, (map.get(line.sku) ?? 0) + open);
      }
    }
    return map;
  }, [orders]);

  // Group by SKU so we can show Pyvott + Committed + Hildale + Available
  // side by side. Status and sellingPrice are materialized here so sorting
  // can reference them directly.
  const bySku = useMemo(() => {
    const map = new Map<string, SkuRow>();
    for (const r of rows) {
      const existing = map.get(r.sku) ?? {
        sku: r.sku,
        name: r.name ?? "",
        pyvott: 0,
        hildale: 0,
        fx: 0,
        promised: 0,
        committed: committedMap.get(r.sku) ?? 0,
        total: 0,
        available: 0,
        unitsSold: velocityMap.get(r.sku) ?? 0,
        sellingPrice: priceMap.get(r.sku) ?? null,
        status: "Out" as SkuStatus,
      };
      if (r.location === "Pyvott") {
        existing.pyvott = r.qty;
        existing.promised = r.promised ?? 0;
      }
      if (r.location === "Hildale") existing.hildale = r.qty;
      if (r.location === "FX") existing.fx = r.qty;
      existing.total = existing.pyvott + existing.hildale + existing.fx;
      existing.available = existing.total - existing.committed;
      existing.status =
        existing.total === 0 ? "Out" : existing.total < LOW_STOCK_THRESHOLD ? "Low" : "OK";
      if (!existing.name && r.name) existing.name = r.name;
      map.set(r.sku, existing);
    }
    return Array.from(map.values());
  }, [rows, velocityMap, priceMap, committedMap]);

  // Apply active sort. Nulls on price always go last regardless of direction.
  // Tiebreaker: when sorting by the default (unitsSold desc), use total desc
  // as a secondary sort so the initial render matches the prior behavior.
  const sortedBySku = useMemo(() => {
    const out = [...bySku];
    const { column, direction } = sort;
    const mult = direction === "asc" ? 1 : -1;

    out.sort((a, b) => {
      let primary = 0;

      if (column === "price") {
        const aNull = a.sellingPrice == null;
        const bNull = b.sellingPrice == null;
        if (aNull && bNull) primary = 0;
        else if (aNull) return 1; // a last, always
        else if (bNull) return -1; // b last, always
        else primary = (a.sellingPrice! - b.sellingPrice!) * mult;
      } else if (column === "status") {
        primary = (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * mult;
      } else if (column === "sku") {
        primary = a.sku.localeCompare(b.sku) * mult;
      } else if (column === "name") {
        primary = a.name.localeCompare(b.name) * mult;
      } else {
        // numeric: unitsSold | pyvott | committed | hildale | promised | total | available
        primary = ((a[column] as number) - (b[column] as number)) * mult;
      }

      if (primary !== 0) return primary;

      // Stable secondary ordering: default case keeps the original tiebreaker
      // (total desc when sorting by units sold). Other columns fall back to
      // units sold desc so ordering is deterministic.
      if (column === "unitsSold") return b.total - a.total;
      return b.unitsSold - a.unitsSold;
    });

    return out;
  }, [bySku, sort]);

  // Top-line KPIs
  const kpis = useMemo(() => {
    const pyvottTotal = rows.filter((r) => r.location === "Pyvott").reduce((s, r) => s + r.qty, 0);
    const hildaleTotal = rows.filter((r) => r.location === "Hildale").reduce((s, r) => s + r.qty, 0);
    const fxTotal = rows.filter((r) => r.location === "FX").reduce((s, r) => s + r.qty, 0);
    const skuCount = bySku.length;
    const lowStockCount = bySku.filter((s) => s.total > 0 && s.total < LOW_STOCK_THRESHOLD).length;
    const outOfStockCount = bySku.filter((s) => s.total === 0).length;
    return {
      pyvottTotal,
      hildaleTotal,
      fxTotal,
      total: pyvottTotal + hildaleTotal + fxTotal,
      skuCount,
      lowStockCount,
      outOfStockCount,
    };
  }, [rows, bySku]);

  const snapshotDate = rows[0]?.snapshot_date ?? null;
  // Hide the badge entirely when the snapshot is older than 48 hours so
  // we don't display a stale "Snapshot: APR 10" that misleads anyone.
  const FRESH_WINDOW_MS = 48 * 60 * 60 * 1000;
  const snapshotIsFresh = (() => {
    if (!snapshotDate) return false;
    const t = new Date(snapshotDate).getTime();
    if (Number.isNaN(t)) return false;
    return Date.now() - t <= FRESH_WINDOW_MS;
  })();

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading inventory…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Failed to load inventory</CardTitle>
            <CardDescription>{(error as Error).message}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6" data-testid="page-inventory">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Warehouse className="h-7 w-7" />
            Inventory
          </h1>
          <p className="text-muted-foreground mt-1">
            Current stock across Pyvott (Spanish Fork), Hildale, and FX (in production).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {snapshotDate && snapshotIsFresh && (
            <Badge variant="outline" className="text-sm" data-testid="snapshot-badge">
              Last updated: {snapshotDate}
            </Badge>
          )}
          <Button
            onClick={() => setTransferOpen(true)}
            data-testid="button-open-transfer-to-pyvott"
          >
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            Transfer to Pyvott
          </Button>
          <Button
            variant="destructive"
            onClick={() => setWriteOffOpen(true)}
            data-testid="button-open-write-off-stock"
          >
            <MinusCircle className="mr-2 h-4 w-4" />
            Write Off Stock
          </Button>
        </div>
      </div>

      <TransferToPyvottDialog
        isOpen={transferOpen}
        onClose={() => setTransferOpen(false)}
      />

      <WriteOffStockDialog
        isOpen={writeOffOpen}
        onClose={() => setWriteOffOpen(false)}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Units</CardDescription>
            <CardTitle className="text-3xl">{kpis.total.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Pyvott + Hildale + FX</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pyvott (Spanish Fork)</CardDescription>
            <CardTitle className="text-3xl">{kpis.pyvottTotal.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">3PL fulfillment warehouse</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>In Production (FX)</CardDescription>
            <CardTitle className="text-3xl text-amber-700 dark:text-amber-400">
              {kpis.fxTotal.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Being built at FX Industries</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Hildale HQ</CardDescription>
            <CardTitle className="text-3xl">{kpis.hildaleTotal.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Manufacturing + reserve stock</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Low / Out of Stock
            </CardDescription>
            <CardTitle className="text-3xl">
              {kpis.lowStockCount + kpis.outOfStockCount}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {kpis.outOfStockCount} out · {kpis.lowStockCount} below {LOW_STOCK_THRESHOLD}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* SKU table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Stock by SKU
          </CardTitle>
          <CardDescription>
            {kpis.skuCount} SKUs tracked. Click any column header to sort.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader column="sku" label="SKU" currentSort={sort} onSort={onSort} />
                <SortableHeader column="name" label="Product" currentSort={sort} onSort={onSort} />
                <SortableHeader column="unitsSold" label="Sold (90d)" align="right" currentSort={sort} onSort={onSort} />
                <SortableHeader column="pyvott" label="Pyvott" align="right" currentSort={sort} onSort={onSort} />
                <SortableHeader column="committed" label="Committed" align="right" currentSort={sort} onSort={onSort} />
                <SortableHeader column="fx" label="In Production (FX)" align="right" currentSort={sort} onSort={onSort} />
                <SortableHeader column="hildale" label="Hildale" align="right" currentSort={sort} onSort={onSort} />
                <SortableHeader column="promised" label="Promised" align="right" currentSort={sort} onSort={onSort} />
                <SortableHeader column="total" label="Total" align="right" currentSort={sort} onSort={onSort} />
                <SortableHeader column="available" label="Available" align="right" currentSort={sort} onSort={onSort} />
                <SortableHeader column="status" label="Status" align="right" currentSort={sort} onSort={onSort} />
                <SortableHeader column="price" label="Price" align="right" currentSort={sort} onSort={onSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedBySku.map((s) => {
                const badgeVariant: "default" | "destructive" | "secondary" =
                  s.status === "Out" ? "destructive" : s.status === "Low" ? "secondary" : "default";
                return (
                  <TableRow key={s.sku} data-testid={`row-sku-${s.sku}`}>
                    <TableCell className="font-mono text-xs">{s.sku}</TableCell>
                    <TableCell className="max-w-md">{s.name}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {s.unitsSold > 0 ? s.unitsSold.toLocaleString() : "–"}
                    </TableCell>
                    <TableCell className="text-right">{s.pyvott.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {s.committed > 0 ? s.committed.toLocaleString() : "–"}
                    </TableCell>
                    <TableCell className="text-right text-amber-700 dark:text-amber-400">
                      {s.fx > 0 ? s.fx.toLocaleString() : "–"}
                    </TableCell>
                    <TableCell className="text-right">{s.hildale.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{s.promised.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {s.total.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${
                        s.committed > 0 && s.available < AVAILABLE_LOW_THRESHOLD
                          ? "text-amber-700 dark:text-amber-400"
                          : ""
                      }`}
                      data-testid={`available-${s.sku}`}
                    >
                      {s.available.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={badgeVariant}>{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {s.sellingPrice == null ? "–" : priceFormatter.format(s.sellingPrice)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Source footnote */}
      <p className="text-xs text-muted-foreground">
        Pyvott column is live from Extensiv (updates on each sync). Hildale
        column reflects the latest manual count sheet entry.
      </p>
    </div>
  );
}
