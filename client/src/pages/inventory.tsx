import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Warehouse, Package, AlertTriangle, Loader2 } from "lucide-react";

type SnapshotRow = {
  snapshot_date: string;
  location: string;
  sku: string;
  name: string | null;
  qty: number;
  source: string;
};

// A SKU is "low stock" if combined qty across locations falls below this number.
// Teaching note: this is a simple heuristic — once we have real sales velocity
// per SKU we can replace this with "days of cover" instead of a static threshold.
const LOW_STOCK_THRESHOLD = 20;

export default function Inventory() {
  const { data, isLoading, error } = useQuery<SnapshotRow[]>({
    queryKey: ["/api/inventory/snapshot"],
  });

  const rows = data ?? [];

  // Group by SKU so we can show Pyvott + Hildale side by side
  const bySku = useMemo(() => {
    const map = new Map<string, { sku: string; name: string; pyvott: number; hildale: number; total: number }>();
    for (const r of rows) {
      const existing = map.get(r.sku) ?? { sku: r.sku, name: r.name ?? "", pyvott: 0, hildale: 0, total: 0 };
      if (r.location === "Pyvott") existing.pyvott = r.qty;
      if (r.location === "Hildale") existing.hildale = r.qty;
      existing.total = existing.pyvott + existing.hildale;
      if (!existing.name && r.name) existing.name = r.name;
      map.set(r.sku, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  // Top-line KPIs
  const kpis = useMemo(() => {
    const pyvottTotal = rows.filter(r => r.location === "Pyvott").reduce((s, r) => s + r.qty, 0);
    const hildaleTotal = rows.filter(r => r.location === "Hildale").reduce((s, r) => s + r.qty, 0);
    const skuCount = bySku.length;
    const lowStockCount = bySku.filter(s => s.total > 0 && s.total < LOW_STOCK_THRESHOLD).length;
    const outOfStockCount = bySku.filter(s => s.total === 0).length;
    return { pyvottTotal, hildaleTotal, total: pyvottTotal + hildaleTotal, skuCount, lowStockCount, outOfStockCount };
  }, [rows, bySku]);

  const snapshotDate = rows[0]?.snapshot_date ?? null;

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
            Current stock across Pyvott (Spanish Fork) and Hildale warehouses.
          </p>
        </div>
        {snapshotDate && (
          <Badge variant="outline" className="text-sm">
            Snapshot: {snapshotDate}
          </Badge>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Units</CardDescription>
            <CardTitle className="text-3xl">{kpis.total.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Across both warehouses</p>
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
            {kpis.skuCount} SKUs tracked. Sorted by total units on hand.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Pyvott</TableHead>
                <TableHead className="text-right">Hildale</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bySku.map((s) => {
                const status =
                  s.total === 0 ? "Out" : s.total < LOW_STOCK_THRESHOLD ? "Low" : "OK";
                const badgeVariant: "default" | "destructive" | "secondary" =
                  status === "Out" ? "destructive" : status === "Low" ? "secondary" : "default";
                return (
                  <TableRow key={s.sku} data-testid={`row-sku-${s.sku}`}>
                    <TableCell className="font-mono text-xs">{s.sku}</TableCell>
                    <TableCell className="max-w-md">{s.name}</TableCell>
                    <TableCell className="text-right">{s.pyvott.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{s.hildale.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {s.total.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={badgeVariant}>{status}</Badge>
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
        Data source: manual PDF uploads. Live Extensiv/Pyvott sync is pending —
        credentials need to be added to <code>integration_configs</code> before
        auto-sync can populate this view.
      </p>
    </div>
  );
}
