import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useInventoryRealtime } from "@/hooks/use-inventory-realtime";
import { Boxes, AlertTriangle, ShoppingCart, Check, Pencil, X, Loader2, Package, Clock } from "lucide-react";

interface MaterialRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  onHand: number;
  minStock: number;
  dailyUsage: number;
  daysOfSupply: number;
  orderQty: number;
  orderCost: number | null;
  unitCost: number | null;
  usedIn: { productName: string; productSku: string; qtyPerUnit: number; dailySales: number }[];
}

interface DashboardData {
  materials: MaterialRow[];
  summary: {
    totalComponents: number;
    needsOrder: number;
    criticalLow: number;
    totalOrderCost: number;
  };
}

const formatCurrency = (amount: number | null | undefined): string => {
  if (amount == null) return "–";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
};

export default function RawMaterials() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "order" | "critical">("all");

  // Refetch the dashboard when any item's stock changes server-side. Also
  // catches /api/items invalidations so any hidden cache stays in sync.
  useInventoryRealtime([
    "/api/raw-materials/dashboard",
    "/api/items",
  ]);

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/raw-materials/dashboard"],
  });

  const updateStockMutation = useMutation({
    mutationFn: async ({ id, currentStock }: { id: string; currentStock: number }) => {
      const res = await apiRequest("PATCH", `/api/items/${id}`, { currentStock });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/raw-materials/dashboard"] });
      toast({ title: "Stock updated", description: "Raw material count has been saved." });
      setEditingId(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update stock", variant: "destructive" });
    },
  });

  const materials = data?.materials ?? [];
  const summary = data?.summary ?? { totalComponents: 0, needsOrder: 0, criticalLow: 0, totalOrderCost: 0 };

  const filtered = materials.filter((m) => {
    if (filter === "order") return m.orderQty > 0;
    if (filter === "critical") return m.daysOfSupply < 7 && m.dailyUsage > 0;
    return true;
  });

  // Reorder = current stock at or below the configured minimum, but only when
  // a real minimum is set (min > 0). Items without a minimum get a separate
  // suggested-min hint instead.
  const isReorder = (m: MaterialRow) => m.minStock > 0 && m.onHand <= m.minStock;
  const reorderCount = materials.filter(isReorder).length;
  const suggestedMin = (m: MaterialRow) =>
    !isReorder(m) && (!m.minStock || m.minStock <= 0) && m.dailyUsage > 0
      ? Math.ceil(m.dailyUsage * 14)
      : null;

  const startEdit = (m: MaterialRow) => {
    setEditingId(m.id);
    setEditValue(String(m.onHand));
  };

  const saveEdit = (id: string) => {
    const qty = parseInt(editValue);
    if (isNaN(qty) || qty < 0) {
      toast({ title: "Invalid number", description: "Please enter a valid quantity.", variant: "destructive" });
      return;
    }
    updateStockMutation.mutate({ id, currentStock: qty });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  const getStatusBadge = (m: MaterialRow) => {
    if (m.dailyUsage === 0) return <Badge variant="secondary">No demand</Badge>;
    if (m.daysOfSupply < 7) return <Badge variant="destructive">Critical</Badge>;
    if (m.daysOfSupply < 14) return <Badge className="bg-amber-500 text-white hover:bg-amber-600">Low</Badge>;
    if (m.daysOfSupply < 30) return <Badge className="bg-yellow-500 text-white hover:bg-yellow-600">Watch</Badge>;
    return <Badge variant="default">OK</Badge>;
  };

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading raw materials…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Failed to load raw materials</CardTitle>
            <CardDescription>{(error as Error).message}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6" data-testid="page-raw-materials">
      {reorderCount > 0 && (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400"
          data-testid="banner-reorder"
        >
          <AlertTriangle className="h-4 w-4" />
          <span>
            <strong className="tabular-nums">{reorderCount}</strong> component{reorderCount === 1 ? "" : "s"} need reordering
          </span>
        </div>
      )}

      {/* Page header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Boxes className="h-7 w-7" />
          Raw Materials
        </h1>
        <p className="text-muted-foreground mt-1">
          Current stock, daily usage, and what to order. Tap a count to update it.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="cursor-pointer" onClick={() => setFilter("all")}>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Package className="h-3.5 w-3.5" />
              Total Materials
            </CardDescription>
            <CardTitle className="text-3xl">{summary.totalComponents}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("critical")}>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Critical (&lt;7 days)
            </CardDescription>
            <CardTitle className="text-3xl text-destructive">{summary.criticalLow}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("order")}>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <ShoppingCart className="h-3.5 w-3.5" />
              Needs Order
            </CardDescription>
            <CardTitle className="text-3xl">{summary.needsOrder}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Est. Order Cost</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(summary.totalOrderCost)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filter indicator */}
      {filter !== "all" && (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm">
            Showing: {filter === "order" ? "Needs Order" : "Critical"}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => setFilter("all")}>
            Show all
          </Button>
        </div>
      )}

      {/* Materials table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Material</TableHead>
                  <TableHead className="text-right min-w-[100px]">On Hand</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Daily Use</TableHead>
                  <TableHead className="text-right">Days Left</TableHead>
                  <TableHead className="text-right">Order Qty</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Order Cost</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => (
                  <>
                    <TableRow
                      key={m.id}
                      className="cursor-pointer"
                      onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                      data-testid={`row-material-${m.id}`}
                    >
                      <TableCell>
                        <div>
                          <div className="font-medium text-sm flex items-center gap-1.5 flex-wrap">
                            <span>{m.name}</span>
                            {isReorder(m) && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5" data-testid={`badge-reorder-${m.id}`}>
                                ⚠️ Reorder
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">{m.sku}</div>
                          {suggestedMin(m) !== null && (
                            <div className="text-xs text-muted-foreground mt-0.5" data-testid={`suggested-min-${m.id}`}>
                              Suggested min: {suggestedMin(m)}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {editingId === m.id ? (
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <Input
                              type="number"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-20 h-8 text-right"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit(m.id);
                                if (e.key === "Escape") cancelEdit();
                              }}
                            />
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveEdit(m.id)}>
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className="inline-flex items-center gap-1 font-semibold hover:text-primary transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEdit(m);
                                  }}
                                >
                                  {m.onHand.toLocaleString()}
                                  <Pencil className="h-3 w-3 text-muted-foreground" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Tap to update count</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </TableCell>
                      <TableCell className="text-right hidden md:table-cell text-muted-foreground">
                        {m.dailyUsage > 0 ? m.dailyUsage.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "–"}
                        {m.dailyUsage > 0 && <span className="text-xs ml-0.5">/{m.unit}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.dailyUsage > 0 ? (
                          <span className={m.daysOfSupply < 7 ? "text-destructive font-bold" : m.daysOfSupply < 14 ? "text-amber-600 font-semibold" : ""}>
                            {m.daysOfSupply}d
                          </span>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {m.orderQty > 0 ? m.orderQty.toLocaleString() : "–"}
                      </TableCell>
                      <TableCell className="text-right hidden md:table-cell">
                        {formatCurrency(m.orderCost)}
                      </TableCell>
                      <TableCell className="text-right">
                        {getStatusBadge(m)}
                      </TableCell>
                    </TableRow>
                    {/* Expanded row: shows which products use this material */}
                    {expandedId === m.id && m.usedIn.length > 0 && (
                      <TableRow key={`${m.id}-detail`} className="bg-muted/30">
                        <TableCell colSpan={7} className="py-3">
                          <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Used in {m.usedIn.length} product{m.usedIn.length > 1 ? "s" : ""}:
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {m.usedIn.map((p) => (
                              <div key={p.productSku} className="flex justify-between items-center bg-background rounded px-3 py-1.5 text-sm border">
                                <span className="truncate">{p.productName}</span>
                                <span className="text-muted-foreground ml-2 whitespace-nowrap">
                                  {p.qtyPerUnit} per unit · {p.dailySales}/day
                                </span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {filter !== "all" ? "No materials match this filter." : "No raw materials found. Add components in the Products page."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Daily usage is calculated from sales velocity over the last 90 days × BOM quantities.
        "Order Qty" targets 30 days of supply. Tap any On Hand number to update the count.
      </p>
    </div>
  );
}
