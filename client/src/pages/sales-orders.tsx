import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription 
} from "@/components/ui/dialog";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetFooter 
} from "@/components/ui/sheet";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage 
} from "@/components/ui/form";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Plus, 
  Loader2, 
  Eye, 
  Truck, 
  CheckCircle, 
  XCircle, 
  Trash2, 
  Package 
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import type { SalesOrder, SalesOrderLine, Item } from "@shared/schema";

interface EnrichedSalesOrder extends SalesOrder {
  lines?: SalesOrderLine[];
  totalUnits?: number;
  backorderedUnits?: number;
}

const CHANNEL_COLORS = {
  SHOPIFY: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  AMAZON: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  GHL: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
  DIRECT: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  OTHER: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
};

const STATUS_VARIANTS: Record<string, "secondary" | "default" | "destructive"> = {
  DRAFT: "secondary",
  OPEN: "default",
  PARTIALLY_FULFILLED: "default",
  FULFILLED: "default",
  CANCELLED: "destructive",
};

const STATUS_COLORS = {
  DRAFT: "bg-secondary text-secondary-foreground",
  OPEN: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  PARTIALLY_FULFILLED: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  FULFILLED: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  CANCELLED: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};

const orderLineSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  qtyOrdered: z.coerce.number().min(1, "Quantity must be at least 1"),
});

const newOrderSchema = z.object({
  channel: z.enum(["SHOPIFY", "AMAZON", "GHL", "DIRECT", "OTHER"]),
  customerName: z.string().min(1, "Customer name is required"),
  customerEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  customerPhone: z.string().optional(),
  orderDate: z.string(),
  requiredByDate: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(orderLineSchema).min(1, "At least one line item is required"),
});

type NewOrderFormValues = z.infer<typeof newOrderSchema>;

export default function SalesOrders() {
  const { toast } = useToast();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showNewOrderDialog, setShowNewOrderDialog] = useState(false);

  const { data: orders = [], isLoading } = useQuery<EnrichedSalesOrder[]>({
    queryKey: ["/api/sales-orders"],
  });

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ["/api/items"],
  });

  const finishedProducts = useMemo(() => 
    items.filter(item => item.type === "finished_product"),
    [items]
  );

  const { data: selectedOrder } = useQuery<SalesOrder & { lines: SalesOrderLine[] }>({
    queryKey: ["/api/sales-orders", selectedOrderId],
    enabled: !!selectedOrderId,
  });

  const createOrderMutation = useMutation({
    mutationFn: async (data: NewOrderFormValues) => {
      const { lines, ...orderData } = data;
      
      const payload = {
        order: {
          ...orderData,
          customerEmail: orderData.customerEmail || null,
          customerPhone: orderData.customerPhone || null,
          notes: orderData.notes || null,
          orderDate: new Date(orderData.orderDate).toISOString(),
          requiredByDate: orderData.requiredByDate 
            ? new Date(orderData.requiredByDate).toISOString() 
            : null,
        },
        lines: lines.map(line => {
          const product = items.find(i => i.id === line.productId);
          return {
            productId: line.productId,
            sku: product?.sku || "",
            qtyOrdered: line.qtyOrdered,
          };
        }),
      };

      const res = await apiRequest("POST", "/api/sales-orders", payload);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/backorder-snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-forecast-context"] });
      toast({ title: "Sales order created successfully" });
      setShowNewOrderDialog(false);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to create sales order", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const shipOrderMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/sales-orders/${id}/ship`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders", selectedOrderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/backorder-snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-forecast-context"] });
      toast({ title: "Order shipped successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to ship order", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const fulfillOrderMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/sales-orders/${id}/fulfill`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders", selectedOrderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/backorder-snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-forecast-context"] });
      toast({ title: "Order marked as fulfilled" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to fulfill order", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/sales-orders/${id}/cancel`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders", selectedOrderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/backorder-snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-forecast-context"] });
      toast({ title: "Order cancelled" });
      setSelectedOrderId(null);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to cancel order", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const form = useForm<NewOrderFormValues>({
    resolver: zodResolver(newOrderSchema),
    defaultValues: {
      channel: "DIRECT",
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      orderDate: new Date().toISOString().split('T')[0],
      requiredByDate: "",
      notes: "",
      lines: [{ productId: "", qtyOrdered: 1 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  const onSubmitNewOrder = (data: NewOrderFormValues) => {
    createOrderMutation.mutate(data);
  };

  const canShip = selectedOrder && 
    (selectedOrder.status === "OPEN" || selectedOrder.status === "PARTIALLY_FULFILLED") &&
    selectedOrder.lines?.some(line => line.qtyAllocated > line.qtyShipped);

  const canFulfill = selectedOrder && 
    selectedOrder.status !== "FULFILLED" && 
    selectedOrder.status !== "CANCELLED";

  const canCancel = selectedOrder && 
    selectedOrder.status !== "CANCELLED" && 
    selectedOrder.status !== "FULFILLED";

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sales Orders</h1>
          <p className="text-sm text-muted-foreground">
            Manage customer orders and backorders
          </p>
        </div>
        <Button 
          onClick={() => {
            form.reset();
            setShowNewOrderDialog(true);
          }}
          data-testid="button-new-order"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Order
        </Button>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Package className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No sales orders yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first sales order to get started
            </p>
            <Button 
              onClick={() => {
                form.reset();
                setShowNewOrderDialog(true);
              }}
              data-testid="button-create-first-order"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create First Order
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All Orders</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-280px)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead className="text-right">Total Units</TableHead>
                    <TableHead className="text-right">Backordered</TableHead>
                    <TableHead className="sticky right-0 bg-card z-10 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => {
                    const totalUnits = order.totalUnits || 0;
                    const backorderedUnits = order.backorderedUnits || 0;
                    
                    return (
                      <TableRow 
                        key={order.id} 
                        className="hover-elevate"
                        data-testid={`row-order-${order.id}`}
                      >
                        <TableCell className="font-mono text-sm" data-testid={`text-order-id-${order.id}`}>
                          {order.externalOrderId || order.id.slice(0, 8)}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            className={CHANNEL_COLORS[order.channel as keyof typeof CHANNEL_COLORS] || CHANNEL_COLORS.OTHER}
                            data-testid={`badge-channel-${order.id}`}
                          >
                            {order.channel}
                          </Badge>
                        </TableCell>
                        <TableCell data-testid={`text-customer-${order.id}`}>
                          {order.customerName}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            className={STATUS_COLORS[order.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.DRAFT}
                            data-testid={`badge-status-${order.id}`}
                          >
                            {order.status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell data-testid={`text-order-date-${order.id}`}>
                          {format(new Date(order.orderDate), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="text-right" data-testid={`text-total-units-${order.id}`}>
                          {totalUnits}
                        </TableCell>
                        <TableCell 
                          className={`text-right ${backorderedUnits > 0 ? 'text-red-600 dark:text-red-400 font-medium' : ''}`}
                          data-testid={`text-backorder-${order.id}`}
                        >
                          {backorderedUnits}
                        </TableCell>
                        <TableCell className="sticky right-0 bg-card z-10 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedOrderId(order.id)}
                            data-testid={`button-view-${order.id}`}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Order Detail Drawer */}
      <Sheet open={!!selectedOrderId} onOpenChange={(open) => !open && setSelectedOrderId(null)}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          {selectedOrder && (
            <>
              <SheetHeader>
                <SheetTitle>Order Details</SheetTitle>
              </SheetHeader>

              <div className="space-y-6 py-6">
                {/* Order Metadata */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Order ID</Label>
                    <p className="font-mono text-sm" data-testid="text-detail-order-id">
                      {selectedOrder.externalOrderId || selectedOrder.id.slice(0, 8)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Channel</Label>
                    <div className="mt-1">
                      <Badge 
                        className={CHANNEL_COLORS[selectedOrder.channel as keyof typeof CHANNEL_COLORS] || CHANNEL_COLORS.OTHER}
                        data-testid="badge-detail-channel"
                      >
                        {selectedOrder.channel}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Customer</Label>
                    <p className="text-sm" data-testid="text-detail-customer">{selectedOrder.customerName}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <div className="mt-1">
                      <Badge 
                        className={STATUS_COLORS[selectedOrder.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.DRAFT}
                        data-testid="badge-detail-status"
                      >
                        {selectedOrder.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  </div>
                  {selectedOrder.customerEmail && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Email</Label>
                      <p className="text-sm" data-testid="text-detail-email">{selectedOrder.customerEmail}</p>
                    </div>
                  )}
                  {selectedOrder.customerPhone && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Phone</Label>
                      <p className="text-sm" data-testid="text-detail-phone">{selectedOrder.customerPhone}</p>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground">Order Date</Label>
                    <p className="text-sm" data-testid="text-detail-order-date">
                      {format(new Date(selectedOrder.orderDate), 'MMM d, yyyy')}
                    </p>
                  </div>
                  {selectedOrder.requiredByDate && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Required By</Label>
                      <p className="text-sm" data-testid="text-detail-required-date">
                        {format(new Date(selectedOrder.requiredByDate), 'MMM d, yyyy')}
                      </p>
                    </div>
                  )}
                </div>

                {selectedOrder.notes && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Notes</Label>
                    <p className="text-sm mt-1" data-testid="text-detail-notes">{selectedOrder.notes}</p>
                  </div>
                )}

                {/* Order Lines */}
                <div>
                  <Label className="text-sm font-medium mb-2 block">Line Items</Label>
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Ordered</TableHead>
                          <TableHead className="text-right">Allocated</TableHead>
                          <TableHead className="text-right">Shipped</TableHead>
                          <TableHead className="text-right">Backorder</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedOrder.lines?.map((line) => {
                          const product = items.find(i => i.id === line.productId);
                          return (
                            <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                              <TableCell className="font-mono text-sm" data-testid={`text-line-sku-${line.id}`}>
                                {line.sku}
                              </TableCell>
                              <TableCell data-testid={`text-line-product-${line.id}`}>
                                {product?.name || "Unknown"}
                              </TableCell>
                              <TableCell className="text-right" data-testid={`text-line-ordered-${line.id}`}>
                                {line.qtyOrdered}
                              </TableCell>
                              <TableCell className="text-right" data-testid={`text-line-allocated-${line.id}`}>
                                {line.qtyAllocated}
                              </TableCell>
                              <TableCell className="text-right" data-testid={`text-line-shipped-${line.id}`}>
                                {line.qtyShipped}
                              </TableCell>
                              <TableCell 
                                className={`text-right ${line.backorderQty > 0 ? 'text-red-600 dark:text-red-400 font-medium' : ''}`}
                                data-testid={`text-line-backorder-${line.id}`}
                              >
                                {line.backorderQty}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>

              <SheetFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSelectedOrderId(null)}
                  data-testid="button-close-drawer"
                >
                  Close
                </Button>
                {canCancel && (
                  <Button
                    variant="destructive"
                    onClick={() => cancelOrderMutation.mutate(selectedOrder.id)}
                    disabled={cancelOrderMutation.isPending}
                    data-testid="button-cancel-order"
                  >
                    {cancelOrderMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4 mr-2" />
                    )}
                    Cancel Order
                  </Button>
                )}
                {canFulfill && (
                  <Button
                    variant="default"
                    onClick={() => fulfillOrderMutation.mutate(selectedOrder.id)}
                    disabled={fulfillOrderMutation.isPending}
                    data-testid="button-fulfill-order"
                  >
                    {fulfillOrderMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    )}
                    Mark Fulfilled
                  </Button>
                )}
                {canShip && (
                  <Button
                    onClick={() => shipOrderMutation.mutate(selectedOrder.id)}
                    disabled={shipOrderMutation.isPending}
                    data-testid="button-ship-order"
                  >
                    {shipOrderMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Truck className="h-4 w-4 mr-2" />
                    )}
                    Ship
                  </Button>
                )}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* New Order Dialog */}
      <Dialog open={showNewOrderDialog} onOpenChange={setShowNewOrderDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Sales Order</DialogTitle>
            <DialogDescription>
              Add a new customer order with line items
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitNewOrder)} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="channel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Channel</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-channel">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="SHOPIFY">Shopify</SelectItem>
                          <SelectItem value="AMAZON">Amazon</SelectItem>
                          <SelectItem value="GHL">GoHighLevel</SelectItem>
                          <SelectItem value="DIRECT">Direct</SelectItem>
                          <SelectItem value="OTHER">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="customerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-customer-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="customerEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} data-testid="input-customer-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="customerPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer Phone</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-customer-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="orderDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Order Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-order-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="requiredByDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Required By Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-required-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} data-testid="input-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Line Items */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Line Items</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => append({ productId: "", qtyOrdered: 1 })}
                    data-testid="button-add-line"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Line
                  </Button>
                </div>

                <div className="space-y-3">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex gap-3 items-start" data-testid={`line-item-${index}`}>
                      <FormField
                        control={form.control}
                        name={`lines.${index}.productId`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid={`select-product-${index}`}>
                                  <SelectValue placeholder="Select product" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {finishedProducts.map(product => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {product.name} ({product.sku})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`lines.${index}.qtyOrdered`}
                        render={({ field }) => (
                          <FormItem className="w-32">
                            <FormControl>
                              <Input
                                type="number"
                                min="1"
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                                data-testid={`input-qty-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {fields.length > 1 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => remove(index)}
                          data-testid={`button-remove-line-${index}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewOrderDialog(false)}
                  data-testid="button-cancel-dialog"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createOrderMutation.isPending}
                  data-testid="button-submit-order"
                >
                  {createOrderMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Create Order
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
