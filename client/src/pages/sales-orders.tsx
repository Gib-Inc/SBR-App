import React, { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { 
  Plus, 
  Loader2, 
  Truck, 
  CheckCircle, 
  XCircle, 
  Trash2, 
  Package,
  PackageX,
  ExternalLink,
  Download,
  Upload,
  Share2,
  Calendar,
  History,
  Zap,
  Archive,
  RefreshCcw,
} from "lucide-react";

function GhlConversationIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M12 4L12 14M12 4L8 8M12 4L16 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 8L6 18M6 8L2 12M6 8L10 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
      <path
        d="M18 8L18 18M18 8L14 12M18 8L22 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
    </svg>
  );
}
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, subDays } from "date-fns";
import { Link } from "wouter";
import type { SalesOrder, SalesOrderLine, Item } from "@shared/schema";

interface EnrichedSalesOrder extends SalesOrder {
  lines?: SalesOrderLine[];
  totalUnits?: number;
  backorderedUnits?: number;
  totalBackorderQty?: number;
}

const CHANNEL_COLORS = {
  SHOPIFY: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  AMAZON: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  GHL: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
  DIRECT: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  OTHER: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
};

const STATUS_VARIANTS: Record<string, "secondary" | "default" | "destructive"> = {
  ORDERED: "default",
  PURCHASED: "default",
  SHIPPED: "default",
  DELIVERED: "default",
  PENDING_REFUND: "default",
  REFUNDED: "destructive",
  CANCELLED: "destructive",
};

const STATUS_COLORS = {
  ORDERED: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  PURCHASED: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  SHIPPED: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  DELIVERED: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  PENDING_REFUND: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  REFUNDED: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  CANCELLED: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};

// Production source indicates which warehouse will fulfill the order
const PRODUCTION_SOURCE_COLORS: Record<string, string> = {
  Pivot: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  Hildale: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  Backordered: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};

// Shared date format helper for MM/DD/YYYY
const formatDateMMDDYYYY = (date: Date | string | null | undefined): string => {
  if (!date) return "-";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "-";
  return format(d, 'MM/dd/yyyy');
};

// Format currency
const formatCurrency = (amount: number | null | undefined, currency = 'USD'): string => {
  if (amount == null) return "-";
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
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

interface ReturnCreationResult {
  returnRequest: {
    id: string;
    rmaNumber?: string;
    status: string;
    trackingNumber?: string;
    labelUrl?: string;
    carrier?: string;
  };
  items: Array<{
    id: string;
    sku: string;
    qtyRequested: number;
  }>;
  label?: {
    carrier: string;
    trackingNumber: string;
    labelUrl: string;
  } | null;
}

export default function SalesOrders() {
  const { toast } = useToast();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showNewOrderDialog, setShowNewOrderDialog] = useState(false);
  const [showCreateReturnDialog, setShowCreateReturnDialog] = useState(false);
  const [returnCreationResult, setReturnCreationResult] = useState<ReturnCreationResult | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  
  const [activeTab, setActiveTab] = useState<"live" | "history">("live");
  const [historyStartDate, setHistoryStartDate] = useState<Date | undefined>(subDays(new Date(), 30));
  const [historyEndDate, setHistoryEndDate] = useState<Date | undefined>(new Date());
  
  // Cancel and Return dialog states
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showStartReturnDialog, setShowStartReturnDialog] = useState(false);

  const viewParam = activeTab === "live" ? "live" : "historical";
  const queryParams = new URLSearchParams({ view: viewParam });
  if (activeTab === "history" && historyStartDate) {
    queryParams.set("startDate", historyStartDate.toISOString());
  }
  if (activeTab === "history" && historyEndDate) {
    queryParams.set("endDate", historyEndDate.toISOString());
  }

  const { data: orders = [], isLoading } = useQuery<EnrichedSalesOrder[]>({
    queryKey: ["/api/sales-orders", viewParam, historyStartDate?.toISOString(), historyEndDate?.toISOString()],
    queryFn: async () => {
      const res = await fetch(`/api/sales-orders?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch sales orders");
      return res.json();
    },
  });

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ["/api/items"],
  });

  const { data: returns = [] } = useQuery<Array<{ id: string; salesOrderId: string | null }>>({
    queryKey: ["/api/returns"],
  });

  // Fetch AI agent rules for GHL location ID
  const { data: aiAgentRules } = useQuery<{ gohighlevelLocationId?: string }>({
    queryKey: ["/api/ai-agent-rules"],
  });

  const finishedProducts = useMemo(() => 
    items.filter(item => item.type === "finished_product"),
    [items]
  );

  const filteredOrders = useMemo(() => {
    if (channelFilter === "ALL") return orders;
    return orders.filter(order => order.channel === channelFilter);
  }, [orders, channelFilter]);

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
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const res = await apiRequest("POST", `/api/sales-orders/${id}/cancel`, { 
        reason: reason || "Customer requested cancellation",
        notifyCustomer: true,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders", selectedOrderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/backorder-snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-forecast-context"] });
      const details: string[] = [];
      if (data.cancellationResult?.shopifyCancelled) details.push("Shopify");
      if (data.cancellationResult?.ghlUpdated) details.push("GHL");
      const detailText = details.length > 0 ? ` (synced to ${details.join(", ")})` : "";
      toast({ title: `Order cancelled${detailText}` });
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

  const createReturnMutation = useMutation({
    mutationFn: async (data: {
      salesOrderId: string;
      lines: Array<{
        salesOrderLineId: string;
        qtyToReturn: number;
        reason?: string;
      }>;
      overallReason: string;
      generateLabel?: boolean;
    }): Promise<ReturnCreationResult> => {
      const res = await apiRequest("POST", "/api/returns/from-sales-order", data);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (result: ReturnCreationResult) => {
      queryClient.invalidateQueries({ queryKey: ["/api/returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders", selectedOrderId] });
      setReturnCreationResult(result);
      if (result.label) {
        toast({ title: "Return created with shipping label" });
      } else {
        toast({ title: "Return request created" });
      }
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to create return", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const syncShopifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/shopify/reconciliation/trigger", {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (result: { ordersCreated?: number; ordersUpdated?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
      const created = result.ordersCreated || 0;
      const updated = result.ordersUpdated || 0;
      toast({ 
        title: "Shopify Sync Complete",
        description: `${created} orders imported, ${updated} orders updated`
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Sync Failed", 
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

  // State for GHL linking in progress
  const [linkingGhlOrderId, setLinkingGhlOrderId] = useState<string | null>(null);

  // Handle opening GHL Conversation - always use the link endpoint which returns early if already linked
  const handleOpenGhlConversation = async (order: EnrichedSalesOrder) => {
    // If we have a direct conversation URL, open it immediately
    const ghlConversationUrl = (order as any).ghlConversationUrl;
    if (ghlConversationUrl) {
      window.open(ghlConversationUrl, "_blank", "noopener,noreferrer");
      return;
    }

    // Call the link endpoint - it returns early if already linked and provides the locationId
    setLinkingGhlOrderId(order.id);
    try {
      const response = await apiRequest("POST", `/api/sales-orders/${order.id}/link-ghl-contact`, {});
      const data = await response.json() as { 
        success?: boolean; 
        contactId?: string; 
        locationId?: string;
        error?: string;
        message?: string;
      };

      if (data.success && data.contactId && data.locationId) {
        // Invalidate cache if this was a new link (not already linked)
        if (!order.ghlContactId) {
          queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
        }
        
        // Open the contact detail page in GHL (where you can view/start conversations)
        const url = `https://app.gohighlevel.com/v2/location/${data.locationId}/contacts/detail/${data.contactId}`;
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        toast({ 
          title: "Could Not Open GHL Conversation",
          description: data.error || data.message || "Check GHL configuration in Data Sources",
          variant: "destructive"
        });
      }
    } catch (error: any) {
      toast({ 
        title: "Failed to Open GHL Conversation",
        description: error.message || "Check GHL configuration",
        variant: "destructive"
      });
    } finally {
      setLinkingGhlOrderId(null);
    }
  };

  // State machine for order actions based on fulfilled quantities
  const hasAnyFulfilledQty = selectedOrder?.lines?.some(line => (line.qtyFulfilled ?? 0) > 0) ?? false;

  // Ship / Mark Fulfilled: allowed only for ORDERED/PURCHASED orders with no fulfilled items
  const canShip = selectedOrder && 
    ['ORDERED', 'PURCHASED'].includes(selectedOrder.status) && 
    !hasAnyFulfilledQty;

  const canFulfill = selectedOrder && 
    ['ORDERED', 'PURCHASED'].includes(selectedOrder.status) && 
    !hasAnyFulfilledQty;

  // Cancel: allowed only for pre-ship orders (DRAFT, ORDERED, PURCHASED)
  const canCancelFromDrawer = selectedOrder && 
    ['DRAFT', 'ORDERED', 'PURCHASED'].includes(selectedOrder.status) && 
    !hasAnyFulfilledQty;

  // Create Return: allowed only if there are fulfilled items
  const canCreateReturn = selectedOrder && 
    selectedOrder.status !== "CANCELLED" && 
    hasAnyFulfilledQty;

  const cancelTooltip = selectedOrder?.status === "CANCELLED" 
    ? "Order is already cancelled" 
    : hasAnyFulfilledQty 
    ? "Order already fulfilled – use returns instead" 
    : undefined;

  const createReturnTooltip = !hasAnyFulfilledQty 
    ? "No fulfilled items yet – ship the order first" 
    : undefined;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportToCSV = () => {
    const headers = [
      "Order ID",
      "External Order ID",
      "Channel",
      "Customer Name",
      "Customer Email",
      "Customer Phone",
      "Status",
      "Production Status",
      "Order Date",
      "Expected Delivery",
      "Order Total",
      "Currency",
      "Total Units",
      "Backordered",
      "Components Used",
      "Notes"
    ];
    
    const rows = filteredOrders.map(order => [
      order.id,
      order.externalOrderId || "",
      order.channel,
      order.customerName,
      order.customerEmail || "",
      order.customerPhone || "",
      order.status,
      (order as any).productionSource || "Pivot",
      format(new Date(order.orderDate), 'yyyy-MM-dd'),
      (order as any).expectedDeliveryDate ? format(new Date((order as any).expectedDeliveryDate), 'MM/dd/yyyy') : "",
      order.totalAmount || 0,
      order.currency || "USD",
      order.totalUnits || 0,
      order.totalBackorderQty || order.backorderedUnits || 0,
      (order as any).componentsUsed || 0,
      order.notes || ""
    ]);
    
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    ].join("\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales-orders-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    toast({ title: `Exported ${filteredOrders.length} orders to CSV` });
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n');
        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
        
        let importedCount = 0;
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const values = line.match(/("([^"]|"")*"|[^,]*)/g)?.map(v => 
            v.replace(/^"|"$/g, '').replace(/""/g, '"').trim()
          ) || [];
          
          const record: Record<string, string> = {};
          headers.forEach((h, idx) => {
            record[h] = values[idx] || "";
          });
          
          if (record["Customer Name"]) {
            importedCount++;
          }
        }
        
        toast({ 
          title: "Import Complete", 
          description: `Processed ${importedCount} order records. Note: Full import requires backend integration.`
        });
        
        queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
      } catch (error) {
        toast({ 
          title: "Import Failed", 
          description: "Could not parse the CSV file. Please check the format.",
          variant: "destructive"
        });
      }
    };
    reader.readAsText(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

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
        <div className="flex items-center gap-2">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "live" | "history")} className="w-auto">
            <TabsList>
              <TabsTrigger value="live" data-testid="tab-live">
                <Zap className="h-4 w-4 mr-2" />
                Live
              </TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-history">
                <Archive className="h-4 w-4 mr-2" />
                History
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {activeTab === "live" && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline"
                    onClick={() => syncShopifyMutation.mutate()}
                    disabled={syncShopifyMutation.isPending}
                    data-testid="button-sync-shopify"
                  >
                    <RefreshCcw className={`h-4 w-4 mr-2 ${syncShopifyMutation.isPending ? 'animate-spin' : ''}`} />
                    {syncShopifyMutation.isPending ? "Syncing..." : "Sync Shopify"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Fetch recent orders from Shopify to catch any missed webhooks</p>
                </TooltipContent>
              </Tooltip>
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
            </>
          )}
        </div>
      </div>

      {activeTab === "history" && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">Date Range:</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-36" data-testid="button-start-date">
                        <Calendar className="h-4 w-4 mr-2" />
                        {historyStartDate ? format(historyStartDate, "MM/dd/yyyy") : "Start Date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={historyStartDate}
                        onSelect={setHistoryStartDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <span className="text-sm text-muted-foreground">to</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-36" data-testid="button-end-date">
                        <Calendar className="h-4 w-4 mr-2" />
                        {historyEndDate ? format(historyEndDate, "MM/dd/yyyy") : "End Date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={historyEndDate}
                        onSelect={setHistoryEndDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <Badge variant="secondary">
                  <History className="h-3 w-3 mr-1" />
                  {filteredOrders.length} archived records
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileImport}
                  accept=".csv"
                  className="hidden"
                  data-testid="input-import-csv-history"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="button-import-csv-history"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Import
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Import sales orders from CSV</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={exportToCSV}
                      data-testid="button-export-csv-history"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Export
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export orders to CSV</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {orders.length > 0 && (
          <div className="flex items-center justify-end gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-sm font-medium" data-testid="badge-total-orders">
                {filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'}
              </Badge>
              <Select value={channelFilter} onValueChange={setChannelFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-channel-filter">
                  <SelectValue placeholder="Filter by channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Channels</SelectItem>
                  <SelectItem value="SHOPIFY">Shopify</SelectItem>
                  <SelectItem value="AMAZON">Amazon</SelectItem>
                  <SelectItem value="GHL">GoHighLevel</SelectItem>
                  <SelectItem value="DIRECT">Direct</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full table-auto">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="px-2 py-2 text-left text-sm font-medium whitespace-nowrap">Order ID</th>
                <th className="px-2 py-2 text-left text-sm font-medium whitespace-nowrap">Channel</th>
                <th className="px-2 py-2 text-left text-sm font-medium whitespace-nowrap">Customer</th>
                <th className="px-2 py-2 text-left text-sm font-medium whitespace-nowrap">Status</th>
                <th className="px-2 py-2 text-left text-sm font-medium whitespace-nowrap">Production</th>
                <th className="px-2 py-2 text-left text-sm font-medium whitespace-nowrap">Order Date</th>
                <th className="px-2 py-2 text-left text-sm font-medium whitespace-nowrap">{activeTab === "live" ? "Expected Delivery" : "Delivery Date"}</th>
                <th className="px-2 py-2 text-left text-sm font-medium whitespace-nowrap">Ship To</th>
                <th className="px-2 py-2 text-right text-sm font-medium whitespace-nowrap">Total</th>
                <th className="px-2 py-2 text-right text-sm font-medium whitespace-nowrap">Units</th>
                <th className="px-2 py-2 text-right text-sm font-medium whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="h-16 w-16 text-muted-foreground" />
                      <h3 className="text-lg font-medium">
                        {activeTab === "live" ? "No sales orders yet" : "No archived orders found"}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {activeTab === "live" 
                          ? "Create your first sales order to get started" 
                          : "Try adjusting the date range or check back later"
                        }
                      </p>
                      {activeTab === "live" && (
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
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const totalUnits = order.totalUnits || 0;
                  const productionSource = (order as any).productionSource || 'Pivot';
                  
                  // Build Ship To address as single line
                  const shipToAddress = [
                    (order as any).shipToStreet,
                    (order as any).shipToCity,
                    (order as any).shipToState,
                    (order as any).shipToZip,
                    (order as any).shipToCountry
                  ].filter(Boolean).join(', ') || 'No address on file';
                  
                  // Delivery Date: show deliveredAt if available, otherwise expectedDeliveryDate, otherwise "Pending"
                  const deliveredAt = (order as any).deliveredAt;
                  const expectedDeliveryDate = (order as any).expectedDeliveryDate;
                  const deliveryDateDisplay = deliveredAt 
                    ? format(new Date(deliveredAt), 'MMM d, yyyy')
                    : expectedDeliveryDate 
                      ? format(new Date(expectedDeliveryDate), 'MMM d, yyyy')
                      : (activeTab === "history" ? "-" : "Pending");
                  
                  // Determine visible status - now matches database directly
                  // Flow: DRAFT → ORDERED → SHIPPED → DELIVERED (+ PENDING_REFUND, REFUNDED, CANCELLED)
                  const getVisibleStatus = () => {
                    // Check refund states first (override status if return in progress)
                    if (order.returnStatus === 'REFUNDED') {
                      return 'REFUNDED';
                    }
                    // Check if return is in progress (pending refund)
                    const returnInProgress = order.returnStatus && 
                      !['NONE', 'REFUNDED', 'CLOSED', 'CANCELLED', 'REJECTED'].includes(order.returnStatus);
                    if (returnInProgress) {
                      return 'PENDING_REFUND';
                    }
                    // Map legacy statuses to new ones for display
                    if (order.status === 'PURCHASED' || order.status === 'PENDING') {
                      return 'ORDERED';
                    }
                    if (order.status === 'FULFILLED') {
                      return 'DELIVERED';
                    }
                    if (order.status === 'PARTIALLY_FULFILLED') {
                      return 'SHIPPED';
                    }
                    return order.status;
                  };
                  const visibleStatus = getVisibleStatus();
                  
                  // Return eligibility: DELIVERED status + within 30-day window
                  // Fall back to orderDate if deliveredAt is not set (for historical orders)
                  const isDelivered = order.status === 'DELIVERED' || order.status === 'FULFILLED' || visibleStatus === 'DELIVERED';
                  const returnWindowStartDate = deliveredAt 
                    ? new Date(deliveredAt) 
                    : new Date(order.orderDate); // Fallback to order date
                  const isWithinReturnWindow = (new Date().getTime() - returnWindowStartDate.getTime()) <= 30 * 24 * 60 * 60 * 1000;
                  const canStartReturn = isDelivered && isWithinReturnWindow && (!order.returnStatus || order.returnStatus === 'NONE');
                  
                  // Cancel eligibility: pre-ship states only (ORDERED, PURCHASED)
                  const canCancel = ['ORDERED', 'PURCHASED'].includes(order.status) && activeTab === 'live';
                  
                  return (
                    <tr 
                      key={order.id} 
                      className="h-10 border-b hover-elevate cursor-pointer"
                      onClick={() => setSelectedOrderId(order.id)}
                      data-testid={`row-order-${order.id}`}
                    >
                      <td className="px-2 align-middle font-mono text-sm whitespace-nowrap" data-testid={`text-order-id-${order.id}`}>
                        {order.externalOrderId || order.id.slice(0, 8)}
                      </td>
                      <td className="px-2 align-middle whitespace-nowrap">
                        <Badge 
                          className={CHANNEL_COLORS[order.channel as keyof typeof CHANNEL_COLORS] || CHANNEL_COLORS.OTHER}
                          data-testid={`badge-channel-${order.id}`}
                        >
                          {order.channel}
                        </Badge>
                      </td>
                      <td className="px-2 align-middle whitespace-nowrap" data-testid={`text-customer-${order.id}`}>
                        {order.customerName}
                      </td>
                      <td className="px-2 align-middle whitespace-nowrap">
                        <Badge 
                          className={STATUS_COLORS[visibleStatus as keyof typeof STATUS_COLORS] || STATUS_COLORS.PURCHASED}
                          data-testid={`badge-status-${order.id}`}
                        >
                          {visibleStatus.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-2 align-middle whitespace-nowrap">
                        <Badge 
                          className={PRODUCTION_SOURCE_COLORS[productionSource] || PRODUCTION_SOURCE_COLORS.Pivot}
                          data-testid={`badge-production-${order.id}`}
                        >
                          {productionSource}
                        </Badge>
                      </td>
                      <td className="px-2 align-middle whitespace-nowrap" data-testid={`text-order-date-${order.id}`}>
                        {format(new Date(order.orderDate), 'MMM d, yyyy')}
                      </td>
                      <td className="px-2 align-middle whitespace-nowrap" data-testid={`text-delivery-date-${order.id}`}>
                        {deliveryDateDisplay}
                      </td>
                      <td className="px-2 align-middle whitespace-nowrap max-w-[200px] truncate" data-testid={`text-ship-to-${order.id}`} title={shipToAddress}>
                        <span className="text-sm text-muted-foreground">{shipToAddress}</span>
                      </td>
                      <td className="px-2 align-middle text-right whitespace-nowrap" data-testid={`text-order-total-${order.id}`}>
                        {formatCurrency(order.totalAmount, order.currency)}
                      </td>
                      <td className="px-2 align-middle text-right whitespace-nowrap" data-testid={`text-total-units-${order.id}`}>
                        {totalUnits}
                      </td>
                      <td className="px-2 align-middle text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {/* Open in Shopify Button */}
                          {order.channel === 'SHOPIFY' && order.sourceUrl && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(order.sourceUrl!, "_blank", "noopener,noreferrer");
                                  }}
                                  data-testid={`button-open-shopify-${order.id}`}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Open in Shopify</TooltipContent>
                            </Tooltip>
                          )}

                          {/* GHL Conversation Button */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    handleOpenGhlConversation(order);
                                  }}
                                  disabled={linkingGhlOrderId === order.id}
                                  data-testid={`button-ghl-conversation-${order.id}`}
                                >
                                  {linkingGhlOrderId === order.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <GhlConversationIcon className="h-4 w-4" />
                                  )}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {(order as any).ghlConversationUrl || order.ghlContactId 
                                ? "Open GHL Conversation" 
                                : "Link & Open GHL Conversation"}
                            </TooltipContent>
                          </Tooltip>

                          {/* Cancel/Return Button - context-dependent */}
                          {activeTab === 'live' ? (
                            // Live tab: Show Cancel button for pre-ship orders
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (canCancel) {
                                        setSelectedOrderId(order.id);
                                        setShowCancelDialog(true);
                                      }
                                    }}
                                    disabled={!canCancel}
                                    data-testid={`button-cancel-${order.id}`}
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {canCancel ? "Cancel Order" : "Cannot cancel - order already shipped"}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            // History tab: Show Return button for delivered orders
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (canStartReturn) {
                                        setSelectedOrderId(order.id);
                                        setShowStartReturnDialog(true);
                                      }
                                    }}
                                    disabled={!canStartReturn}
                                    data-testid={`button-return-${order.id}`}
                                  >
                                    <PackageX className="h-4 w-4" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {canStartReturn 
                                  ? "Start Return" 
                                  : !isDelivered 
                                    ? "Order not delivered" 
                                    : !isWithinReturnWindow 
                                      ? "Return window expired (30 days)" 
                                      : "Return already in progress"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                        className={STATUS_COLORS[selectedOrder.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.PURCHASED}
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
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full table-auto">
                      <thead className="bg-muted/50">
                        <tr className="border-b">
                          <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">SKU</th>
                          <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Product</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Ordered</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Fulfilled</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Returned</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Backorder</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(!selectedOrder.lines || selectedOrder.lines.length === 0) ? (
                          <tr>
                            <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground text-sm">
                              No line items found. Click "Sync Shopify" to refresh order data.
                            </td>
                          </tr>
                        ) : (
                          selectedOrder.lines.map((line) => {
                            const product = items.find(i => i.id === line.productId);
                            const displayName = product?.name || line.productName || line.sku || "Unknown";
                            return (
                              <tr key={line.id} className="border-b last:border-0" data-testid={`row-line-${line.id}`}>
                                <td className="px-3 py-2 align-middle font-mono text-sm whitespace-nowrap" data-testid={`text-line-sku-${line.id}`}>
                                  {line.sku}
                                </td>
                                <td className="px-3 py-2 align-middle whitespace-nowrap max-w-[200px] truncate" title={displayName} data-testid={`text-line-product-${line.id}`}>
                                  {displayName}
                                </td>
                                <td className="px-3 py-2 align-middle text-right whitespace-nowrap" data-testid={`text-line-ordered-${line.id}`}>
                                  {line.qtyOrdered}
                                </td>
                                <td className="px-3 py-2 align-middle text-right whitespace-nowrap" data-testid={`text-line-fulfilled-${line.id}`}>
                                  {line.qtyFulfilled ?? 0}
                                </td>
                                <td className="px-3 py-2 align-middle text-right whitespace-nowrap" data-testid={`text-line-returned-${line.id}`}>
                                  {line.returnedQty ?? 0}
                                </td>
                                <td 
                                  className={`px-3 py-2 align-middle text-right whitespace-nowrap ${line.backorderQty > 0 ? 'text-red-600 dark:text-red-400 font-medium' : ''}`}
                                  data-testid={`text-line-backorder-${line.id}`}
                                >
                                  {line.backorderQty}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <SheetFooter className="gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => setSelectedOrderId(null)}
                  data-testid="button-close-drawer"
                >
                  Close
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="outline"
                        onClick={() => setShowCreateReturnDialog(true)}
                        disabled={!canCreateReturn}
                        data-testid="button-create-return"
                      >
                        <PackageX className="h-4 w-4 mr-2" />
                        Create Return
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {createReturnTooltip && (
                    <TooltipContent>{createReturnTooltip}</TooltipContent>
                  )}
                </Tooltip>
                {canCancelFromDrawer ? (
                  <Button
                    variant="destructive"
                    onClick={() => cancelOrderMutation.mutate({ id: selectedOrder.id, reason: "Customer requested cancellation" })}
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
                ) : (selectedOrder?.status !== "CANCELLED" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="destructive"
                          disabled={true}
                          data-testid="button-cancel-order-disabled"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Cancel Order
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {cancelTooltip && (
                      <TooltipContent>{cancelTooltip}</TooltipContent>
                    )}
                  </Tooltip>
                ))}
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

      {/* Create Return Dialog */}
      {selectedOrder && (
        <Dialog 
          open={showCreateReturnDialog} 
          onOpenChange={(open) => {
            setShowCreateReturnDialog(open);
            if (!open) {
              setReturnCreationResult(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            {returnCreationResult ? (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    Return Created Successfully
                  </DialogTitle>
                  <DialogDescription>
                    Return {returnCreationResult.returnRequest.rmaNumber || returnCreationResult.returnRequest.id.slice(0, 8)} has been created
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  {returnCreationResult.label && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Truck className="h-4 w-4" />
                          Shipping Label Generated
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Carrier:</span>
                            <div className="font-medium">{returnCreationResult.label.carrier}</div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Tracking Number:</span>
                            <div className="font-medium font-mono">{returnCreationResult.label.trackingNumber}</div>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => window.open(returnCreationResult.label?.labelUrl, '_blank')}
                          data-testid="button-download-label"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download Return Label
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  <div className="border rounded-lg p-4">
                    <div className="text-sm font-medium mb-2">Items Being Returned:</div>
                    <div className="space-y-2">
                      {returnCreationResult.items.map((item) => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span className="font-mono">{item.sku}</span>
                          <span className="text-muted-foreground">Qty: {item.qtyRequested}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    asChild
                    data-testid="button-view-return"
                  >
                    <Link href="/returns">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View in Returns
                    </Link>
                  </Button>
                  <Button
                    onClick={() => {
                      setShowCreateReturnDialog(false);
                      setReturnCreationResult(null);
                    }}
                    data-testid="button-close-return-dialog"
                  >
                    Done
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Create Return Request</DialogTitle>
                  <DialogDescription>
                    Create a return request for order {selectedOrder.externalOrderId || selectedOrder.id.slice(0, 8)}
                  </DialogDescription>
                </DialogHeader>

                <CreateReturnForm
                  order={selectedOrder}
                  onSubmit={(data) => {
                    createReturnMutation.mutate({
                      salesOrderId: selectedOrder.id,
                      lines: data.items.map(item => ({
                        salesOrderLineId: item.salesOrderLineId,
                        qtyToReturn: item.qtyRequested,
                      })),
                      overallReason: data.reason,
                      generateLabel: true,
                    });
                  }}
                  isPending={createReturnMutation.isPending}
                  onCancel={() => setShowCreateReturnDialog(false)}
                />
              </>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Cancel Order Confirmation Dialog (Live tab) */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this order? This action will:
              <ul className="list-disc ml-4 mt-2 space-y-1 text-sm">
                <li>Cancel the order in Shopify (if applicable)</li>
                <li>Update the GHL opportunity to "Lost" status</li>
                <li>Release allocated inventory back to available stock</li>
                <li>Mark the order as CANCELLED</li>
              </ul>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(false)}
              data-testid="button-cancel-dialog-no"
            >
              No, keep order
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedOrderId) {
                  cancelOrderMutation.mutate({ id: selectedOrderId, reason: "Customer requested cancellation" });
                  setShowCancelDialog(false);
                }
              }}
              disabled={cancelOrderMutation.isPending}
              data-testid="button-cancel-dialog-yes"
            >
              {cancelOrderMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Yes, cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Start Return Confirmation Dialog (History tab) */}
      <Dialog open={showStartReturnDialog} onOpenChange={setShowStartReturnDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start Return</DialogTitle>
            <DialogDescription>
              Start a return for this order? This will:
              <ul className="list-disc ml-4 mt-2 space-y-1 text-sm">
                <li>Create a return request in the system</li>
                <li>Generate a return shipping label (if address is on file)</li>
                <li>Create a GHL opportunity in the Refunds pipeline</li>
                <li>Send instructions to the customer via SMS</li>
              </ul>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowStartReturnDialog(false)}
              data-testid="button-start-return-no"
            >
              No
            </Button>
            <Button
              onClick={() => {
                // Open the existing Create Return dialog
                setShowStartReturnDialog(false);
                if (selectedOrderId) {
                  setShowCreateReturnDialog(true);
                }
              }}
              data-testid="button-start-return-yes"
            >
              <PackageX className="h-4 w-4 mr-2" />
              Yes, start return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Create Return Form Component (scoped within sales-orders page)
interface CreateReturnFormProps {
  order: EnrichedSalesOrder;
  onSubmit: (data: {
    resolutionRequested: string;
    reason: string;
    items: Array<{
      inventoryItemId: string;
      sku: string;
      qtyOrdered: number;
      qtyRequested: number;
      salesOrderLineId: string;
    }>;
  }) => void;
  isPending: boolean;
  onCancel: () => void;
}

const returnFormSchema = z.object({
  resolutionRequested: z.string().min(1, "Resolution type is required"),
  reason: z.string().min(1, "Reason is required"),
  items: z.array(z.object({
    salesOrderLineId: z.string(),
    inventoryItemId: z.string(),
    sku: z.string(),
    qtyOrdered: z.number(),
    qtyFulfilled: z.number().min(1, "Must have fulfilled items to return"),
    qtyRequested: z.number().min(1, "Quantity must be at least 1"),
    selected: z.boolean(),
  }).refine((item) => !item.selected || (item.qtyRequested >= 1 && item.qtyRequested <= item.qtyFulfilled), {
    message: "Quantity must be between 1 and fulfilled quantity for selected items"
  })).refine(items => items.filter(item => item.selected && item.qtyRequested >= 1 && item.qtyRequested <= item.qtyFulfilled).length > 0, {
    message: "At least one valid item with fulfilled quantity must be selected",
  }),
});

function CreateReturnForm({ order, onSubmit, isPending, onCancel }: CreateReturnFormProps) {
  const form = useForm<z.infer<typeof returnFormSchema>>({
    resolver: zodResolver(returnFormSchema),
    defaultValues: {
      resolutionRequested: "REFUND",
      reason: "",
      items: (order.lines || [])
        .filter(line => (line.qtyFulfilled || 0) > 0)
        .map(line => ({
          salesOrderLineId: line.id,
          inventoryItemId: line.productId || '',
          sku: line.sku,
          qtyOrdered: line.qtyOrdered,
          qtyFulfilled: line.qtyFulfilled || 0,
          qtyRequested: line.qtyFulfilled || 0,
          selected: false,
        })),
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
    const selectedItems = data.items
      .filter(item => item.selected && item.qtyRequested > 0 && item.qtyRequested <= item.qtyFulfilled)
      .map(item => ({
        inventoryItemId: item.inventoryItemId,
        sku: item.sku,
        qtyOrdered: item.qtyOrdered,
        qtyRequested: item.qtyRequested,
        salesOrderLineId: item.salesOrderLineId,
      }));

    onSubmit({
      resolutionRequested: data.resolutionRequested,
      reason: data.reason,
      items: selectedItems,
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="resolutionRequested"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Resolution Requested</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-resolution">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="REFUND">Refund</SelectItem>
                    <SelectItem value="REPLACEMENT">Replacement</SelectItem>
                    <SelectItem value="STORE_CREDIT">Store Credit</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Return Reason</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-reason">
                      <SelectValue placeholder="Select reason" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="DEFECTIVE">Defective/Damaged</SelectItem>
                    <SelectItem value="WRONG_ITEM">Wrong Item Sent</SelectItem>
                    <SelectItem value="NOT_AS_DESCRIBED">Not As Described</SelectItem>
                    <SelectItem value="CHANGED_MIND">Changed Mind</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-3">
          <FormLabel>Select Items to Return</FormLabel>
          {form.watch("items").filter(item => item.qtyFulfilled > 0).length === 0 ? (
            <div className="border rounded-lg p-6 text-center text-muted-foreground">
              No items available to return (nothing has been fulfilled yet)
            </div>
          ) : (
            <div className="border rounded-lg divide-y">
              {form.watch("items").map((item, index) => {
                if (item.qtyFulfilled <= 0) return null;

                return (
                  <div key={item.salesOrderLineId} className="p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <FormField
                        control={form.control}
                        name={`items.${index}.selected`}
                        render={({ field }) => (
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                data-testid={`checkbox-item-${index}`}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <div className="flex-1">
                        <div className="font-medium">{item.sku}</div>
                        <div className="text-sm text-muted-foreground">
                          Ordered: {item.qtyOrdered} • Fulfilled: {item.qtyFulfilled} • Max returnable: {item.qtyFulfilled}
                        </div>
                      </div>
                      <FormField
                        control={form.control}
                        name={`items.${index}.qtyRequested`}
                        render={({ field }) => (
                          <FormItem className="w-24">
                            <FormControl>
                              <Input
                                type="number"
                                min="1"
                                max={item.qtyFulfilled}
                                value={field.value === 0 ? '' : field.value}
                                onChange={(e) => {
                                  const rawValue = e.target.value;
                                  if (rawValue === '') {
                                    field.onChange(0);  // Temporarily set to 0 to allow clearing
                                  } else {
                                    const numValue = parseInt(rawValue);
                                    if (!isNaN(numValue)) {
                                      field.onChange(numValue);
                                    }
                                  }
                                }}
                                onBlur={() => {
                                  const currentValue = field.value;
                                  if (currentValue === 0 || currentValue === null || currentValue === undefined || isNaN(currentValue)) {
                                    field.onChange(Math.min(1, item.qtyFulfilled));
                                  } else if (currentValue < 1) {
                                    field.onChange(1);
                                  } else if (currentValue > item.qtyFulfilled) {
                                    field.onChange(item.qtyFulfilled);
                                  }
                                  // Trigger validation
                                  form.trigger(`items.${index}.qtyRequested`);
                                }}
                                disabled={!form.watch(`items.${index}.selected`)}
                                data-testid={`input-qty-return-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {form.formState.errors.items?.root && (
            <p className="text-sm text-destructive">{form.formState.errors.items.root.message}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
            data-testid="button-cancel-return"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            data-testid="button-submit-return"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <PackageX className="h-4 w-4 mr-2" />
            )}
            Create Return
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
