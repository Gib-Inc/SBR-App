import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "wouter";
import {
  Plus,
  Search,
  Filter,
  ChevronDown,
  MoreHorizontal,
  FileText,
  FileDown,
  Truck,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  PackageCheck,
  Eye,
  Loader2,
  ClipboardList,
  RefreshCw,
  Mail,
  MailX,
  MailCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { PurchaseOrder, Supplier } from "@shared/schema";

interface PurchaseOrderWithSupplier extends PurchaseOrder {
  supplier?: Supplier;
  lines?: any[];
}

type POStatus =
  | "DRAFT"
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "SENT"
  | "PARTIAL_RECEIVED"
  | "RECEIVED"
  | "CLOSED"
  | "CANCELLED";

const STATUS_CONFIG: Record<POStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  DRAFT: { label: "Draft", variant: "secondary", icon: FileText },
  APPROVAL_PENDING: { label: "Pending Approval", variant: "outline", icon: Clock },
  APPROVED: { label: "Approved", variant: "default", icon: CheckCircle },
  SENT: { label: "Sent", variant: "default", icon: Send },
  PARTIAL_RECEIVED: { label: "Partial", variant: "outline", icon: PackageCheck },
  RECEIVED: { label: "Received", variant: "default", icon: Truck },
  CLOSED: { label: "Closed", variant: "secondary", icon: CheckCircle },
  CANCELLED: { label: "Cancelled", variant: "destructive", icon: XCircle },
};

const STATUS_COLORS: Record<POStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  APPROVAL_PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  APPROVED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  SENT: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  PARTIAL_RECEIVED: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  RECEIVED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  CLOSED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as POStatus] || STATUS_CONFIG.DRAFT;
  const colorClass = STATUS_COLORS[status as POStatus] || STATUS_COLORS.DRAFT;
  const Icon = config.icon;
  
  return (
    <Badge className={`${colorClass} font-medium`} data-testid={`badge-status-${status.toLowerCase()}`}>
      <Icon className="w-3 h-3 mr-1" />
      {config.label}
    </Badge>
  );
}

type EmailStatus = "NOT_SENT" | "SENT" | "FAILED";

const EMAIL_STATUS_CONFIG: Record<EmailStatus, { label: string; icon: any; colorClass: string }> = {
  NOT_SENT: { 
    label: "Not Sent", 
    icon: Mail, 
    colorClass: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" 
  },
  SENT: { 
    label: "Sent", 
    icon: MailCheck, 
    colorClass: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" 
  },
  FAILED: { 
    label: "Failed", 
    icon: MailX, 
    colorClass: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" 
  },
};

function EmailStatusBadge({ 
  status, 
  sentAt, 
  emailTo 
}: { 
  status: string | null | undefined; 
  sentAt?: Date | string | null;
  emailTo?: string | null;
}) {
  const emailStatus = (status || "NOT_SENT") as EmailStatus;
  const config = EMAIL_STATUS_CONFIG[emailStatus] || EMAIL_STATUS_CONFIG.NOT_SENT;
  const Icon = config.icon;
  
  const tooltipContent = emailStatus === "SENT" && sentAt 
    ? `Sent to ${emailTo || "supplier"} on ${format(new Date(sentAt), "MM/dd/yyyy HH:mm")}`
    : emailStatus === "FAILED" 
    ? "Email delivery failed"
    : "Not yet emailed";
  
  return (
    <Badge 
      className={`${config.colorClass} font-medium`} 
      title={tooltipContent}
      data-testid={`badge-email-${emailStatus.toLowerCase()}`}
    >
      <Icon className="w-3 h-3 mr-1" />
      {config.label}
    </Badge>
  );
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "-";
  return format(d, "MM/dd/yyyy");
}

export default function PurchaseOrders() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedPO, setSelectedPO] = useState<PurchaseOrderWithSupplier | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const { data: purchaseOrders, isLoading } = useQuery<PurchaseOrderWithSupplier[]>({
    queryKey: ["/api/purchase-orders"],
  });

  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: poDetails, isLoading: isLoadingDetails } = useQuery({
    queryKey: ["/api/purchase-orders", selectedPO?.id, "composite"],
    enabled: !!selectedPO?.id && isDetailOpen,
    queryFn: async () => {
      const res = await fetch(`/api/purchase-orders/${selectedPO?.id}/composite`);
      if (!res.ok) throw new Error("Failed to fetch PO details");
      return res.json();
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ id, action, reason }: { id: string; action: string; reason?: string }) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${id}/${action}`, { reason });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || `Failed to ${action} PO`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "Purchase order updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const sendPOMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${id}/send`, {});
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to send PO");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ 
        title: "PO Sent Successfully", 
        description: `Email sent to ${data.emailTo || "supplier"}` 
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to Send PO", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const handleSendPO = (poId: string) => {
    sendPOMutation.mutate(poId);
  };

  const receiveLinesMutation = useMutation({
    mutationFn: async ({ poId, lineReceipts }: { poId: string; lineReceipts: { lineId: string; qtyReceived: number }[] }) => {
      if (!poId) {
        throw new Error("Purchase order ID is required");
      }
      const res = await apiRequest("POST", `/api/purchase-orders/${poId}/receive`, { lineReceipts });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to receive items");
      }
      return { ...await res.json(), poId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      if (data.poId) {
        queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", data.poId, "composite"] });
      }
      toast({ title: "Items received successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAcceptLine = (poId: string, lineId: string, qtyOrdered: number, qtyReceived: number) => {
    const remaining = qtyOrdered - (qtyReceived || 0);
    if (remaining > 0) {
      receiveLinesMutation.mutate({ 
        poId, 
        lineReceipts: [{ lineId, qtyReceived: remaining }] 
      });
    }
  };

  const handleAcceptAllLines = (poId: string, lines: any[]) => {
    if (!poId || !lines?.length) return;
    
    const lineReceipts = lines
      .filter((line: any) => line?.id && (line.qtyOrdered - (line.qtyReceived || 0)) > 0)
      .map((line: any) => ({
        lineId: line.id,
        qtyReceived: line.qtyOrdered - (line.qtyReceived || 0)
      }));
    
    if (lineReceipts.length > 0) {
      receiveLinesMutation.mutate({ poId, lineReceipts });
    }
  };

  const supplierMap = new Map(suppliers?.map(s => [s.id, s]) || []);

  const enrichedPOs = purchaseOrders?.map(po => ({
    ...po,
    supplier: supplierMap.get(po.supplierId),
  })) || [];

  const filteredPOs = enrichedPOs.filter(po => {
    const matchesSearch = !searchQuery || 
      po.poNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      po.supplier?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      po.supplierName?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || po.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const sortedPOs = [...filteredPOs].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.orderDate).getTime();
    const dateB = new Date(b.createdAt || b.orderDate).getTime();
    return dateB - dateA;
  });

  const statusCounts = enrichedPOs.reduce((acc, po) => {
    acc[po.status] = (acc[po.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleViewDetails = (po: PurchaseOrderWithSupplier) => {
    setSelectedPO(po);
    setIsDetailOpen(true);
  };

  const handleAction = (poId: string, action: string) => {
    transitionMutation.mutate({ id: poId, action });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground">Manage supplier orders and receipts</p>
        </div>
        <Button data-testid="button-create-po">
          <Plus className="h-4 w-4 mr-2" />
          Create PO
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="hover-elevate cursor-pointer" onClick={() => setStatusFilter("all")} data-testid="card-total-orders">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Orders</p>
                <p className="text-2xl font-bold">{enrichedPOs.length}</p>
              </div>
              <ClipboardList className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover-elevate cursor-pointer" onClick={() => setStatusFilter("DRAFT")} data-testid="card-draft-orders">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Drafts</p>
                <p className="text-2xl font-bold">{statusCounts.DRAFT || 0}</p>
              </div>
              <FileText className="h-8 w-8 text-gray-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover-elevate cursor-pointer" onClick={() => setStatusFilter("SENT")} data-testid="card-pending-orders">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Receipt</p>
                <p className="text-2xl font-bold">{(statusCounts.SENT || 0) + (statusCounts.PARTIAL_RECEIVED || 0)}</p>
              </div>
              <Truck className="h-8 w-8 text-indigo-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover-elevate cursor-pointer" onClick={() => setStatusFilter("RECEIVED")} data-testid="card-received-orders">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Received</p>
                <p className="text-2xl font-bold">{statusCounts.RECEIVED || 0}</p>
              </div>
              <PackageCheck className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search PO# or supplier..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-po"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44" data-testid="select-status-filter">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                    <SelectItem key={status} value={status}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] })}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[calc(100vh-400px)] rounded-md border m-4 mt-0">
            <table className="w-full min-w-[900px]">
              <thead className="bg-muted sticky top-0 z-10">
                <tr className="border-b">
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap">PO Number</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Supplier</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Status</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Email</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Order Date</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Expected</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap">Total</th>
                  <th className="sticky right-0 z-20 bg-muted p-3 text-right text-sm font-medium whitespace-nowrap shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedPOs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="h-32 text-center text-muted-foreground">
                      {searchQuery || statusFilter !== "all"
                        ? "No purchase orders match your filters"
                        : "No purchase orders yet. Create your first one!"}
                    </td>
                  </tr>
                ) : (
                  sortedPOs.map((po) => (
                    <tr 
                      key={po.id} 
                      className="border-b last:border-b-0 cursor-pointer hover-elevate"
                      onClick={() => handleViewDetails(po)}
                      data-testid={`row-po-${po.id}`}
                    >
                      <td className="p-3 whitespace-nowrap font-medium">
                        {po.poNumber}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-medium">{po.supplier?.name || po.supplierName || "-"}</span>
                          {po.supplier?.email && (
                            <span className="text-xs text-muted-foreground">{po.supplier.email}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <StatusBadge status={po.status} />
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <EmailStatusBadge 
                          status={(po as any).lastEmailStatus} 
                          sentAt={(po as any).lastEmailSentAt}
                          emailTo={(po as any).emailTo}
                        />
                      </td>
                      <td className="p-3 whitespace-nowrap">{formatDate(po.orderDate)}</td>
                      <td className="p-3 whitespace-nowrap">{formatDate(po.expectedDate)}</td>
                      <td className="p-3 whitespace-nowrap text-right font-medium">
                        {formatCurrency(po.total)}
                      </td>
                      <td className="sticky right-0 z-10 bg-background p-3 whitespace-nowrap shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" data-testid={`button-po-actions-${po.id}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(`/api/purchase-orders/${po.id}/pdf`, '_blank');
                                }}
                              >
                                <FileDown className="h-4 w-4 mr-2" />
                                Download PDF
                              </DropdownMenuItem>
                              {(po.status === "DRAFT" || po.status === "APPROVED") && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem 
                                    onClick={(e) => { 
                                      e.stopPropagation(); 
                                      handleSendPO(po.id); 
                                    }}
                                    disabled={sendPOMutation.isPending}
                                  >
                                    <Mail className="h-4 w-4 mr-2" />
                                    {sendPOMutation.isPending ? "Sending..." : "Send PO"}
                                  </DropdownMenuItem>
                                </>
                              )}
                              {(po.status === "SENT" || po.status === "PARTIAL_RECEIVED") && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleAction(po.id, "bulk-confirm-receipt"); }}>
                                    <PackageCheck className="h-4 w-4 mr-2" />
                                    Confirm Full Receipt
                                  </DropdownMenuItem>
                                </>
                              )}
                              {!["CLOSED", "CANCELLED", "RECEIVED", "PARTIAL_RECEIVED"].includes(po.status) && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={(e) => { e.stopPropagation(); handleAction(po.id, "cancel"); }}
                                  >
                                    <XCircle className="h-4 w-4 mr-2" />
                                    Cancel PO
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              {selectedPO?.poNumber || "Purchase Order Details"}
            </DialogTitle>
            <DialogDescription>
              {selectedPO?.supplier?.name || selectedPO?.supplierName || "Unknown Supplier"}
            </DialogDescription>
          </DialogHeader>

          {isLoadingDetails ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : poDetails ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <StatusBadge status={poDetails.status} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Order Date</p>
                  <p className="font-medium">{formatDate(poDetails.orderDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Expected Date</p>
                  <p className="font-medium">{formatDate(poDetails.expectedDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="font-medium text-lg">{formatCurrency(poDetails.total)}</p>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Email Status</p>
                    <EmailStatusBadge 
                      status={poDetails.lastEmailStatus} 
                      sentAt={poDetails.lastEmailSentAt}
                      emailTo={poDetails.emailTo}
                    />
                  </div>
                  {poDetails.lastEmailSentAt && (
                    <div>
                      <p className="text-sm text-muted-foreground">Sent At</p>
                      <p className="text-sm font-medium">
                        {format(new Date(poDetails.lastEmailSentAt), "MM/dd/yyyy HH:mm")}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Email To</p>
                    <p className="text-sm font-medium">
                      {poDetails.emailTo || poDetails.supplierEmail || selectedPO?.supplier?.email || "-"}
                    </p>
                  </div>
                </div>
                {(poDetails.status === "DRAFT" || poDetails.status === "APPROVED") && (
                  <Button
                    onClick={() => handleSendPO(poDetails.id)}
                    disabled={sendPOMutation.isPending}
                    data-testid="button-send-po-detail"
                  >
                    {sendPOMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Mail className="h-4 w-4 mr-2" />
                        Send PO
                      </>
                    )}
                  </Button>
                )}
              </div>

              {poDetails.notes && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm bg-muted/50 p-3 rounded-md">{poDetails.notes}</p>
                </div>
              )}

              <div>
                <h4 className="font-medium mb-2">Line Items ({poDetails.lines?.length || 0})</h4>
                {poDetails.lines && poDetails.lines.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[700px]">
                      <thead className="bg-muted/50">
                        <tr className="border-b">
                          <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Item</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap">Qty Ordered</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap">Qty Received</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap">Unit Cost</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap">Line Total</th>
                          <th className="sticky right-0 z-10 bg-muted/50 p-3 text-right text-sm font-medium whitespace-nowrap shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {poDetails.lines.map((line: any) => {
                          const remaining = line.qtyOrdered - (line.qtyReceived || 0);
                          const isFullyReceived = remaining <= 0;
                          const canAccept = poDetails?.id && 
                            line?.id && 
                            ['SENT', 'PARTIAL_RECEIVED'].includes(poDetails.status) && 
                            remaining > 0;
                          
                          return (
                            <tr key={line.id} className="border-b last:border-b-0" data-testid={`row-line-${line.id}`}>
                              <td className="p-3 whitespace-nowrap">
                                <div>
                                  <p className="font-medium">{line.item?.name || line.itemName || "-"}</p>
                                  <p className="text-xs text-muted-foreground">{line.item?.sku || line.sku || "-"}</p>
                                </div>
                              </td>
                              <td className="p-3 text-right whitespace-nowrap">{line.qtyOrdered}</td>
                              <td className="p-3 text-right whitespace-nowrap">
                                <span className={isFullyReceived ? "text-green-600" : ""}>
                                  {line.qtyReceived || 0}
                                </span>
                              </td>
                              <td className="p-3 text-right whitespace-nowrap">{formatCurrency(line.unitCost)}</td>
                              <td className="p-3 text-right font-medium whitespace-nowrap">{formatCurrency(line.lineTotal)}</td>
                              <td className="sticky right-0 z-10 bg-background p-3 whitespace-nowrap shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">
                                <div className="flex justify-end">
                                  {canAccept ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleAcceptLine(poDetails.id, line.id, line.qtyOrdered, line.qtyReceived)}
                                      disabled={receiveLinesMutation.isPending}
                                      data-testid={`button-accept-line-${line.id}`}
                                    >
                                      {receiveLinesMutation.isPending ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <>
                                          <CheckCircle className="h-4 w-4 mr-1" />
                                          Accept
                                        </>
                                      )}
                                    </Button>
                                  ) : isFullyReceived ? (
                                    <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                      <CheckCircle className="h-3 w-3 mr-1" />
                                      Received
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">-</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No line items</p>
                )}
              </div>

              {poDetails.receipts && poDetails.receipts.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Receipts ({poDetails.receipts.length})</h4>
                  <div className="space-y-2">
                    {poDetails.receipts.map((receipt: any) => (
                      <div key={receipt.id} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{receipt.receiptNumber}</span>
                          <span className="text-sm text-muted-foreground">
                            {formatDate(receipt.receivedAt)}
                          </span>
                        </div>
                        {receipt.receivedBy && (
                          <p className="text-sm text-muted-foreground">Received by: {receipt.receivedBy}</p>
                        )}
                        {receipt.lines && receipt.lines.length > 0 && (
                          <div className="mt-2 text-sm">
                            <span className="text-muted-foreground">Items: </span>
                            {receipt.lines.map((rl: any) => `${rl.receivedQty} received`).join(", ")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                <div>
                  <p className="text-sm text-muted-foreground">Subtotal</p>
                  <p className="font-medium">{formatCurrency(poDetails.subtotal)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Shipping</p>
                  <p className="font-medium">{formatCurrency(poDetails.shippingCost)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Other Fees</p>
                  <p className="font-medium">{formatCurrency(poDetails.otherFees)}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">Failed to load details</p>
          )}

          <DialogFooter className="gap-2">
            {poDetails?.id && 
             poDetails.lines?.length > 0 &&
             ['SENT', 'PARTIAL_RECEIVED'].includes(poDetails.status) && 
             poDetails.lines.some((line: any) => line?.id && (line.qtyOrdered - (line.qtyReceived || 0)) > 0) && (
              <Button
                onClick={() => handleAcceptAllLines(poDetails.id, poDetails.lines)}
                disabled={receiveLinesMutation.isPending}
                data-testid="button-accept-all-lines"
              >
                {receiveLinesMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Accepting...
                  </>
                ) : (
                  <>
                    <PackageCheck className="h-4 w-4 mr-2" />
                    Accept All
                  </>
                )}
              </Button>
            )}
            <Button variant="outline" onClick={() => setIsDetailOpen(false)} data-testid="button-close-dialog">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
