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
import { Truck, Package, ExternalLink, CheckCircle2, Loader2, AlertTriangle, Clock, Undo2 } from "lucide-react";

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

export default function InHouseShipping() {
  const { toast } = useToast();
  const [confirmShipId, setConfirmShipId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<InHouseData>({
    queryKey: ["/api/sales-orders/in-house"],
  });

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

  const orders = data?.orders ?? [];
  const summary = data?.summary ?? { total: 0, totalUnitsToShip: 0 };
  const confirmOrder = orders.find(o => o.id === confirmShipId);

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
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Truck className="h-7 w-7" />
          In-House Shipping
        </h1>
        <p className="text-muted-foreground mt-1">
          Orders that need to be packed and shipped from Hildale.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 max-w-lg">
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
      </div>

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
                  {orders.map((order) => (
                    <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
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
                            Date.now() - new Date(order.orderDate).getTime() > 3 * 24 * 60 * 60 * 1000
                              ? "destructive"
                              : Date.now() - new Date(order.orderDate).getTime() > 1 * 24 * 60 * 60 * 1000
                              ? "secondary"
                              : "default"
                          }
                        >
                          {daysAgo(order.orderDate)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <TooltipProvider>
                            {/* Shopify label link */}
                            {order.sourceUrl && order.channel === "SHOPIFY" && (
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

                            {/* Ship button */}
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
                              <TooltipContent>Mark as shipped (updates Hildale inventory)</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
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

      <p className="text-xs text-muted-foreground">
        These are orders routed to Hildale because Pyvott was out of stock. Click "Ship" after packing to update inventory.
        Orders older than 3 days are flagged red.
      </p>
    </div>
  );
}
