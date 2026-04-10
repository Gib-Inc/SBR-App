import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Truck, Package, ExternalLink, CheckCircle2, Loader2,
  AlertTriangle, Clock, RefreshCw, Tag, Check, ArchiveX,
} from "lucide-react";

interface OrderLine {
  id: string;
  sku: string;
  productName: string | null;
  qtyOrdered: number;
  qtyShipped: number;
  qtyAllocated: number;
}

interface InHouseOrder {
  id: string;
  externalOrderId: string | null;
  channel: string;
  customerName: string;
  customerEmail: string | null;
  status: string;
  orderDate: string;
  totalAmount: number;
  sourceUrl: string | null;
  lines: OrderLine[];
  totalOrdered: number;
  totalShipped: number;
  totalUnshipped: number;
}

interface InHouseData {
  orders: InHouseOrder[];
  summary: {
    total: number;
    totalUnitsToShip: number;
  };
  shopDomain?: string | null;
}

interface SyncResult {
  synced: number;
  closed: number;
  total: number;
  errors: string[];
  details: Array<{ orderId: string; externalId: string; oldStatus: string; newStatus: string }>;
  message: string;
}

const formatDate = (d: string) => {
  const date = new Date(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

const daysAgo = (d: string) => {
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
};

const daysAgoNum = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));

/** Build Shopify admin URL for an order */
const shopifyAdminUrl = (shopDomain: string | null | undefined, externalOrderId: string | null) => {
  if (!shopDomain || !externalOrderId) return null;
  return `https://${shopDomain}/admin/orders/${externalOrderId}`;
};

export default function InHouseShipping() {
  const { toast } = useToast();
  const [confirmShipId, setConfirmShipId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; errors: string[] } | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const { data, isLoading, error } = useQuery<InHouseData>({
    queryKey: ["/api/sales-orders/in-house"],
    refetchInterval: 60_000,
  });

  // Shopify sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-orders/in-house/sync", {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Sync failed");
      }
      return res.json() as Promise<SyncResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders/in-house"] });
      setSyncResult(result);
      toast({
        title: `Shopify sync complete`,
        description: result.message,
        variant: result.closed > 0 ? undefined : "default",
      });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  // Dismiss mutation — marks orders as already shipped WITHOUT touching inventory
  const dismissMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const res = await apiRequest("POST", "/api/sales-orders/in-house/dismiss", {
        orderIds,
        reason: "manual audit",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Dismiss failed");
      }
      return res.json() as Promise<{ dismissed: number; total: number; errors: string[]; message: string }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders/in-house"] });
      setSelectedIds(new Set());
      toast({
        title: "Orders cleared",
        description: result.message,
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to dismiss", description: err.message, variant: "destructive" });
    },
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const orders = data?.orders ?? [];
    if (selectedIds.size === orders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orders.map(o => o.id)));
    }
  };

  const shipMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiRequest("POST", `/api/sales-orders/${orderId}/ship`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to ship order");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders/in-house"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/snapshot"] });
      toast({ title: "Order shipped!", description: "Hildale inventory has been updated." });
      setConfirmShipId(null);
    },
    onError: (err: any) => {
      toast({ title: "Ship failed", description: err.message, variant: "destructive" });
      setConfirmShipId(null);
    },
  });

  const batchShip = async () => {
    const ids = Array.from(selectedIds);
    setBatchProgress({ done: 0, total: ids.length, errors: [] });
    const errors: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      try {
        const res = await apiRequest("POST", `/api/sales-orders/${ids[i]}/ship`, {});
        if (!res.ok) {
          const err = await res.json();
          errors.push(err.error || `Order ${ids[i]} failed`);
        }
      } catch (e: any) {
        errors.push(e.message || `Order ${ids[i]} failed`);
      }
      setBatchProgress({ done: i + 1, total: ids.length, errors });
    }

    queryClient.invalidateQueries({ queryKey: ["/api/sales-orders/in-house"] });
    queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inventory/snapshot"] });

    const successCount = ids.length - errors.length;
    toast({
      title: `Batch complete: ${successCount} shipped`,
      description: errors.length > 0 ? `${errors.length} failed` : "All orders shipped successfully!",
      variant: errors.length > 0 ? "destructive" : undefined,
    });

    setSelectedIds(new Set());
    setShowBatchConfirm(false);
    setBatchProgress(null);
  };

  /** Open selected orders in Shopify admin (batch label workflow) */
  const openSelectedInShopify = () => {
    const shopDomain = data?.shopDomain;
    if (!shopDomain) {
      toast({ title: "No Shopify domain", description: "Shopify is not configured.", variant: "destructive" });
      return;
    }
    const orders = data?.orders.filter(o => selectedIds.has(o.id) && o.externalOrderId) ?? [];
    if (orders.length === 0) return;

    // Open up to 10 at a time to avoid popup blockers
    const maxOpen = 10;
    const toOpen = orders.slice(0, maxOpen);
    for (const order of toOpen) {
      const url = shopifyAdminUrl(shopDomain, order.externalOrderId);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    }
    if (orders.length > maxOpen) {
      toast({
        title: `Opened ${maxOpen} of ${orders.length}`,
        description: `Browsers limit popup tabs. Open the remaining ${orders.length - maxOpen} after finishing these.`,
      });
    }
  };

  const orders = data?.orders ?? [];
  const summary = data?.summary ?? { total: 0, totalUnitsToShip: 0 };
  const shopDomain = data?.shopDomain;
  const confirmOrder = orders.find(o => o.id === confirmShipId);

  // Split orders into stale (>10 days) and active
  const staleOrders = orders.filter(o => daysAgoNum(o.orderDate) > 10);
  const activeOrders = orders.filter(o => daysAgoNum(o.orderDate) <= 10);

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading shipping queue…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Failed to load shipping queue</CardTitle>
            <CardDescription>{(error as Error).message}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6" data-testid="page-in-house-shipping">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Truck className="h-7 w-7" />
            In-House Shipping
          </h1>
          <p className="text-muted-foreground mt-1">
            Orders that need to be packed and shipped from Hildale.
          </p>
        </div>
        {/* Sync with Shopify button */}
        <Button
          variant="outline"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="gap-2 self-start"
        >
          <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Syncing…" : "Sync with Shopify"}
        </Button>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <Card className={syncResult.closed > 0 ? "border-green-500/50 bg-green-500/5" : ""}>
          <CardContent className="py-3 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">{syncResult.message}</p>
              {syncResult.details.length > 0 && (
                <div className="mt-1 text-muted-foreground">
                  {syncResult.details.slice(0, 5).map(d => (
                    <div key={d.orderId}>
                      Order {d.externalId}: {d.oldStatus} → {d.newStatus}
                    </div>
                  ))}
                  {syncResult.details.length > 5 && (
                    <div>+ {syncResult.details.length - 5} more</div>
                  )}
                </div>
              )}
              <button
                className="text-xs text-muted-foreground underline mt-1"
                onClick={() => setSyncResult(null)}
              >
                Dismiss
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stale orders warning */}
      {staleOrders.length > 0 && !syncResult && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">
                {staleOrders.length} order{staleOrders.length !== 1 ? 's' : ''} older than 10 days
              </p>
              <p className="text-muted-foreground">
                These were likely already shipped. Click "Sync with Shopify" to auto-close any that are fulfilled.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Package className="h-3.5 w-3.5" />
              Orders to Ship
            </CardDescription>
            <CardTitle className="text-3xl">{summary.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Truck className="h-3.5 w-3.5" />
              Total Units
            </CardDescription>
            <CardTitle className="text-3xl">{summary.totalUnitsToShip}</CardTitle>
          </CardHeader>
        </Card>
        {staleOrders.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Likely Shipped
              </CardDescription>
              <CardTitle className="text-3xl text-amber-500">{staleOrders.length}</CardTitle>
            </CardHeader>
          </Card>
        )}
      </div>

      {/* Batch action bar */}
      {orders.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="outline" size="sm" onClick={toggleSelectAll}>
            {selectedIds.size === orders.length ? "Deselect All" : "Select All"}
          </Button>
          {selectedIds.size > 0 && (
            <>
              <Button
                size="sm"
                variant="default"
                className="gap-2"
                onClick={() => setShowBatchConfirm(true)}
              >
                <Truck className="h-4 w-4" />
                Ship {selectedIds.size} Order{selectedIds.size !== 1 ? "s" : ""}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="gap-2"
                onClick={() => dismissMutation.mutate(Array.from(selectedIds))}
                disabled={dismissMutation.isPending}
              >
                <Check className="h-4 w-4" />
                {dismissMutation.isPending ? "Clearing…" : `Already Shipped (${selectedIds.size})`}
              </Button>
              {shopDomain && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={openSelectedInShopify}
                >
                  <Tag className="h-4 w-4" />
                  Create Labels in Shopify ({selectedIds.size})
                </Button>
              )}
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} selected
              </span>
            </>
          )}
        </div>
      )}

      {/* Orders table */}
      {orders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-3" />
            <p className="text-lg font-medium">All caught up!</p>
            <p className="text-muted-foreground">No orders waiting to ship from Hildale.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === orders.length && orders.length > 0}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </TableHead>
                    <TableHead className="min-w-[120px]">Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden md:table-cell">Items</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="hidden md:table-cell text-right">Total</TableHead>
                    <TableHead className="text-center">Age</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => {
                    const age = daysAgoNum(order.orderDate);
                    const isStale = age > 10;
                    return (
                      <TableRow
                        key={order.id}
                        data-testid={`row-order-${order.id}`}
                        className={`${selectedIds.has(order.id) ? "bg-primary/5" : ""} ${isStale ? "opacity-60" : ""}`}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(order.id)}
                            onChange={() => toggleSelect(order.id)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-sm font-medium">
                            {order.externalOrderId || order.id.slice(0, 8)}
                          </div>
                          <div className="text-xs text-muted-foreground">{order.channel}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm truncate max-w-[150px]">{order.customerName}</div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="text-sm space-y-0.5">
                            {order.lines.slice(0, 2).map((line) => (
                              <div key={line.id} className="text-muted-foreground truncate max-w-[200px]">
                                {line.productName || line.sku} × {line.qtyOrdered - line.qtyShipped}
                              </div>
                            ))}
                            {order.lines.length > 2 && (
                              <div className="text-xs text-muted-foreground">+{order.lines.length - 2} more</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="font-semibold">{order.totalUnshipped}</span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-right">
                          {formatCurrency(order.totalAmount)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={
                              age > 3 ? "destructive"
                              : age > 1 ? "secondary"
                              : "default"
                            }
                          >
                            {daysAgo(order.orderDate)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <TooltipProvider>
                              {/* Shopify admin link (for creating label) */}
                              {shopDomain && order.externalOrderId && order.channel === "SHOPIFY" && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8"
                                      onClick={() => {
                                        const url = shopifyAdminUrl(shopDomain, order.externalOrderId);
                                        if (url) window.open(url, "_blank", "noopener,noreferrer");
                                      }}
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Open in Shopify Admin</TooltipContent>
                                </Tooltip>
                              )}
                              {/* Fallback: customer-facing link if no admin URL */}
                              {(!shopDomain || !order.externalOrderId) && order.sourceUrl && order.channel === "SHOPIFY" && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8"
                                      onClick={() => {
                                        window.open(order.sourceUrl!, "_blank", "noopener,noreferrer");
                                      }}
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Open in Shopify</TooltipContent>
                                </Tooltip>
                              )}

                              {/* Already Shipped — dismiss without touching inventory */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:text-green-500"
                                    onClick={() => dismissMutation.mutate([order.id])}
                                    disabled={dismissMutation.isPending}
                                  >
                                    <Check className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Already shipped — remove from list (no inventory change)</TooltipContent>
                              </Tooltip>

                              {/* Ship button — marks shipped AND subtracts inventory */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="default"
                                    className="gap-1"
                                    onClick={() => setConfirmShipId(order.id)}
                                  >
                                    <Truck className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Ship</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Ship now — updates Hildale inventory counts</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirm Ship Dialog */}
      <Dialog open={!!confirmShipId} onOpenChange={() => setConfirmShipId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Shipment</DialogTitle>
            <DialogDescription>
              This will mark the order as shipped and subtract the quantities from Hildale inventory.
            </DialogDescription>
          </DialogHeader>
          {confirmOrder && (
            <div className="space-y-3 py-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Order</span>
                <span className="font-mono font-medium">{confirmOrder.externalOrderId || confirmOrder.id.slice(0, 8)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Customer</span>
                <span className="font-medium">{confirmOrder.customerName}</span>
              </div>
              <div className="border-t pt-2 space-y-1">
                {confirmOrder.lines.map((line) => {
                  const toShip = line.qtyOrdered - line.qtyShipped;
                  if (toShip <= 0) return null;
                  return (
                    <div key={line.id} className="flex justify-between text-sm">
                      <span>{line.productName || line.sku}</span>
                      <span className="font-semibold">× {toShip}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmShipId(null)}>Cancel</Button>
            <Button
              onClick={() => confirmShipId && shipMutation.mutate(confirmShipId)}
              disabled={shipMutation.isPending}
              className="gap-2"
            >
              <Truck className="h-4 w-4" />
              {shipMutation.isPending ? "Shipping…" : "Confirm Ship"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Confirm Dialog */}
      <Dialog open={showBatchConfirm} onOpenChange={() => !batchProgress && setShowBatchConfirm(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ship {selectedIds.size} Orders</DialogTitle>
            <DialogDescription>
              This will mark all selected orders as shipped and update Hildale inventory for each one.
            </DialogDescription>
          </DialogHeader>
          {batchProgress ? (
            <div className="py-4 space-y-3">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">
                  Shipping {batchProgress.done} of {batchProgress.total}…
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
                />
              </div>
              {batchProgress.errors.length > 0 && (
                <div className="text-sm text-destructive">
                  {batchProgress.errors.length} error{batchProgress.errors.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          ) : (
            <div className="py-2">
              <p className="text-sm text-muted-foreground">
                {selectedIds.size} order{selectedIds.size !== 1 ? "s" : ""} with{" "}
                {orders.filter(o => selectedIds.has(o.id)).reduce((s, o) => s + o.totalUnshipped, 0)} total units will be shipped from Hildale.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchConfirm(false)} disabled={!!batchProgress}>
              Cancel
            </Button>
            <Button onClick={batchShip} disabled={!!batchProgress} className="gap-2">
              <Truck className="h-4 w-4" />
              {batchProgress ? "Shipping…" : `Ship All ${selectedIds.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="text-xs text-muted-foreground space-y-1">
        <p><strong>Ship</strong> = ship now and subtract from Hildale inventory. <strong>✓</strong> = already shipped elsewhere, just clear it from the list.</p>
        <p>"Sync with Shopify" auto-checks Shopify for orders already fulfilled. "Already Shipped" lets you manually clear them.</p>
      </div>
    </div>
  );
}
