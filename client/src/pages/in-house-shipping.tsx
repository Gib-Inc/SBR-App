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
  checks?: string[]; // Human-readable verification results per order
}

interface InHouseData {
  orders: InHouseOrder[];
  summary: {
    total: number;
    totalUnitsToShip: number;
    verified?: boolean;
    extensivVerified?: boolean;
    droppedByShopify?: number;
    droppedByExtensiv?: number;
    droppedByNotes?: number;
    droppedByQty?: number;
    candidatesChecked?: number;
    verifiedAt?: string;
    verifyMs?: number;
  };
  shopDomain?: string | null;
}

interface SyncResult {
  synced: number;
  closed: number;
  closedByShopify?: number;
  closedByExtensiv?: number;
  extensivChecked?: number;
  total: number;
  errors: string[];
  details: Array<{ orderId: string; externalId: string; oldStatus: string; newStatus: string; source?: string }>;
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
          {syncMutation.isPending ? "Syncing…" : "Sync with Shopify & Extensiv"}
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
                      {d.source && <span className="text-xs ml-1">({d.source})</span>}
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

      {/* Verification status banner */}
      {(summary.verified || summary.extensivVerified) && !syncResult && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardContent className="py-3 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">
                Auto-verified
                {summary.verified && summary.extensivVerified ? ' against Shopify + Extensiv'
                  : summary.verified ? ' against Shopify'
                  : ' against Extensiv'}
                {summary.verifyMs ? ` (${(summary.verifyMs / 1000).toFixed(1)}s)` : ''}
              </p>
              {((summary.droppedByShopify || 0) + (summary.droppedByExtensiv || 0) + (summary.droppedByQty || 0)) > 0 ? (
                <p className="text-muted-foreground">
                  Auto-removed {(summary.droppedByShopify || 0) + (summary.droppedByExtensiv || 0) + (summary.droppedByQty || 0)} orders from {summary.candidatesChecked || '?'} candidates:
                  {(summary.droppedByShopify || 0) > 0 && ` ${summary.droppedByShopify} fulfilled in Shopify,`}
                  {(summary.droppedByExtensiv || 0) > 0 && ` ${summary.droppedByExtensiv} shipped by Pyvott/Extensiv,`}
                  {(summary.droppedByQty || 0) > 0 && ` ${summary.droppedByQty} fully shipped.`}
                  {' '}Only orders that genuinely need attention are shown.
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Checked {summary.candidatesChecked || '?'} candidates. All remaining orders need attention.
                </p>
              )}
              {summary.verifiedAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  Last checked: {new Date(summary.verifiedAt).toLocaleTimeString()}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {!summary.verified && !summary.extensivVerified && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Could not verify with Shopify or Extensiv</p>
              <p className="text-muted-foreground">
                Showing orders from local database. Some may already be shipped. Click "Sync" to try again.
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
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              {(summary.verified && summary.extensivVerified) ? (
                <><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Fully Verified</>
              ) : (summary.verified || summary.extensivVerified) ? (
                <><CheckCircle2 className="h-3.5 w-3.5 text-amber-500" /> Partially Verified</>
              ) : (
                <><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Unverified</>
              )}
            </CardDescription>
            <CardTitle className="text-sm text-muted-foreground mt-1">
              {summary.verified && summary.extensivVerified ? "Shopify + Extensiv"
                : summary.verified ? "Shopify only"
                : summary.extensivVerified ? "Extensiv only"
                : "Local DB only"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Batch action bar */}
      {orders.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="outline" size="sm" onClick={toggleSelectAll}>
            {selectedIds.size === orders.length ? "Deselect All" : "Select All"}
          </Button>
          {selectedIds.size > 0 && (
            <>
              {shopDomain && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={openSelectedInShopify}
                >
                  <Tag className="h-4 w-4" />
                  Print Labels ({selectedIds.size})
                </Button>
              )}
              <Button
                size="sm"
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => setShowBatchConfirm(true)}
              >
                <Truck className="h-4 w-4" />
                Fulfilled In-House ({selectedIds.size})
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="gap-2"
                onClick={() => dismissMutation.mutate(Array.from(selectedIds))}
                disabled={dismissMutation.isPending}
              >
                <Package className="h-4 w-4" />
                {dismissMutation.isPending ? "Clearing…" : `Fulfilled by Pyvott (${selectedIds.size})`}
              </Button>
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
        <div className="space-y-3">
          {orders.map((order) => {
            const age = daysAgoNum(order.orderDate);
            return (
              <Card key={order.id} data-testid={`row-order-${order.id}`} className={selectedIds.has(order.id) ? "ring-2 ring-primary" : ""}>
                <CardContent className="p-4">
                  {/* Top row: checkbox, order info, age badge */}
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(order.id)}
                      onChange={() => toggleSelect(order.id)}
                      className="h-5 w-5 rounded border-gray-300 mt-1 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-base font-bold">
                          {order.externalOrderId || order.id.slice(0, 8)}
                        </span>
                        <Badge variant="outline" className="text-xs">{order.channel}</Badge>
                        <Badge
                          variant={age > 3 ? "destructive" : age > 1 ? "secondary" : "default"}
                        >
                          {daysAgo(order.orderDate)}
                        </Badge>
                      </div>
                      <div className="text-sm font-medium mt-1">{order.customerName}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {order.lines.map((line) => {
                          const toShip = line.qtyOrdered - line.qtyShipped;
                          if (toShip <= 0) return null;
                          return (
                            <span key={line.id} className="mr-3">
                              {line.productName || line.sku} × {toShip}
                            </span>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                        <span><strong>{order.totalUnshipped}</strong> unit{order.totalUnshipped !== 1 ? 's' : ''}</span>
                        <span>{formatCurrency(order.totalAmount)}</span>
                      </div>
                      {/* Verification context — shows Sammie what we checked */}
                      {order.checks && order.checks.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {order.checks.map((check, i) => (
                            <span key={i} className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {check.startsWith('Shopify:') ? (
                                <CheckCircle2 className="h-3 w-3 mr-1 text-green-500 shrink-0" />
                              ) : check.startsWith('Extensiv:') ? (
                                <CheckCircle2 className="h-3 w-3 mr-1 text-blue-500 shrink-0" />
                              ) : check.startsWith('Tagged:') ? (
                                <Tag className="h-3 w-3 mr-1 text-amber-500 shrink-0" />
                              ) : (
                                <Package className="h-3 w-3 mr-1 shrink-0" />
                              )}
                              {check}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action buttons — BIG and clear */}
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {/* PRINT LABEL — opens Shopify admin to create/print label */}
                    {(shopDomain && order.externalOrderId) || order.sourceUrl ? (
                      <Button
                        variant="outline"
                        className="gap-2 h-10 px-4 text-sm font-semibold"
                        onClick={() => {
                          const url = shopDomain && order.externalOrderId
                            ? shopifyAdminUrl(shopDomain, order.externalOrderId)
                            : order.sourceUrl;
                          if (url) window.open(url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <Tag className="h-4 w-4" />
                        Print Label
                      </Button>
                    ) : null}

                    {/* FULFILLED IN-HOUSE — ship from Hildale (subtracts inventory) */}
                    <Button
                      className="gap-2 h-10 px-4 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => setConfirmShipId(order.id)}
                    >
                      <Truck className="h-4 w-4" />
                      Fulfilled In-House
                    </Button>

                    {/* FULFILLED BY PYVOTT — dismiss, no inventory change */}
                    <Button
                      variant="secondary"
                      className="gap-2 h-10 px-4 text-sm font-semibold"
                      onClick={() => dismissMutation.mutate([order.id])}
                      disabled={dismissMutation.isPending}
                    >
                      <Package className="h-4 w-4" />
                      Fulfilled by Pyvott
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Confirm Ship Dialog */}
      <Dialog open={!!confirmShipId} onOpenChange={() => setConfirmShipId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fulfilled In-House</DialogTitle>
            <DialogDescription>
              This marks the order as shipped from Hildale and subtracts the quantities from your inventory.
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
              {shipMutation.isPending ? "Shipping…" : "Confirm — Fulfilled In-House"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Confirm Dialog */}
      <Dialog open={showBatchConfirm} onOpenChange={() => !batchProgress && setShowBatchConfirm(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fulfill {selectedIds.size} Orders In-House</DialogTitle>
            <DialogDescription>
              This marks all selected orders as shipped from Hildale and subtracts inventory for each one.
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
              {batchProgress ? "Shipping…" : `Fulfill All ${selectedIds.size} In-House`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="text-xs text-muted-foreground space-y-1">
        <p><strong>Print Label</strong> = open in Shopify to create a shipping label. <strong>Fulfilled In-House</strong> = we shipped it, subtract from inventory. <strong>Fulfilled by Pyvott</strong> = Pyvott handled it, just clear it.</p>
      </div>
    </div>
  );
}
