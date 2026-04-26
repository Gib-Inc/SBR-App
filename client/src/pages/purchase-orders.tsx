import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Link } from "wouter";
import { CreatePODialog } from "@/components/create-po-dialog";
import { EditPODialog } from "@/components/edit-po-dialog";
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
  CheckCircle2,
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
  Package,
  Pencil,
  Calendar,
  History,
  Zap,
  Archive,
  Download,
  Upload,
  Bot,
  AlertCircle,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { PurchaseOrder, Supplier } from "@shared/schema";

interface PurchaseOrderWithSupplier extends PurchaseOrder {
  supplier?: Supplier;
  lines?: any[];
}

// Unified PO lifecycle status (uses displayStatus from API)
type PODisplayStatus =
  | "DRAFT"
  | "SENT"
  | "ACCEPTED"
  | "PARTIAL"
  | "RECEIVED"
  | "CLOSED"
  | "CANCELLED";

// Legacy status type for backward compatibility
type POStatus = PODisplayStatus | "APPROVAL_PENDING" | "APPROVED" | "PARTIAL_RECEIVED" | "PARTIALLY_RECEIVED";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  DRAFT: { label: "Draft", variant: "secondary", icon: FileText },
  SENT: { label: "Sent", variant: "default", icon: Send },
  ACCEPTED: { label: "Accepted", variant: "default", icon: CheckCircle2 },
  PARTIAL: { label: "Partial", variant: "outline", icon: PackageCheck },
  PARTIALLY_RECEIVED: { label: "Partial", variant: "outline", icon: PackageCheck },
  PARTIAL_RECEIVED: { label: "Partial", variant: "outline", icon: PackageCheck },
  RECEIVED: { label: "Received", variant: "default", icon: Truck },
  CLOSED: { label: "Closed", variant: "secondary", icon: CheckCircle },
  CANCELLED: { label: "Cancelled", variant: "destructive", icon: XCircle },
  // Legacy statuses (show as Draft in unified view)
  APPROVAL_PENDING: { label: "Draft", variant: "secondary", icon: FileText },
  APPROVED: { label: "Draft", variant: "secondary", icon: FileText },
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  SENT: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  ACCEPTED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  PARTIAL: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  PARTIALLY_RECEIVED: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  PARTIAL_RECEIVED: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  RECEIVED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  CLOSED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  // Legacy statuses
  APPROVAL_PENDING: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  APPROVED: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
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

type EmailStatus = "NOT_SENT" | "SENT" | "OPENED" | "FAILED";

const EMAIL_STATUS_CONFIG: Record<EmailStatus, { label: string; icon: any; colorClass: string }> = {
  NOT_SENT: { 
    label: "Not Sent", 
    icon: Mail, 
    colorClass: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" 
  },
  SENT: { 
    label: "Sent", 
    icon: MailCheck, 
    colorClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" 
  },
  OPENED: { 
    label: "Opened", 
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
  
  const tooltipContent = emailStatus === "OPENED" && sentAt 
    ? `Opened by ${emailTo || "supplier"} (sent ${format(new Date(sentAt), "MM/dd/yyyy HH:mm")})`
    : emailStatus === "SENT" && sentAt 
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

type AckStatus = "NONE" | "PENDING" | "SUPPLIER_ACCEPTED" | "INTERNAL_CONFIRMED" | "EXPIRED";

const ACK_STATUS_CONFIG: Record<AckStatus, { label: string; icon: any; colorClass: string }> = {
  NONE: { 
    label: "—", 
    icon: Clock, 
    colorClass: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500" 
  },
  PENDING: { 
    label: "Pending", 
    icon: Clock, 
    colorClass: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" 
  },
  SUPPLIER_ACCEPTED: { 
    label: "Confirmed", 
    icon: CheckCircle2, 
    colorClass: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" 
  },
  INTERNAL_CONFIRMED: { 
    label: "Verified", 
    icon: CheckCircle2, 
    colorClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" 
  },
  EXPIRED: { 
    label: "Expired", 
    icon: Clock, 
    colorClass: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500" 
  },
};

function AckStatusBadge({ 
  status, 
  acknowledgedAt 
}: { 
  status: string | null | undefined; 
  acknowledgedAt?: Date | string | null;
}) {
  const ackStatus = (status || "NONE") as AckStatus;
  if (ackStatus === "NONE") return null;
  
  const config = ACK_STATUS_CONFIG[ackStatus] || ACK_STATUS_CONFIG.NONE;
  const Icon = config.icon;
  
  const tooltipContent = acknowledgedAt 
    ? `${config.label} on ${format(new Date(acknowledgedAt), "MM/dd/yyyy HH:mm")}`
    : config.label;
  
  return (
    <Badge 
      className={`${config.colorClass} font-medium ml-1`} 
      title={tooltipContent}
      data-testid={`badge-ack-${ackStatus.toLowerCase()}`}
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

function calculateLeadTime(sentAt: Date | string | null | undefined, receivedAt: Date | string | null | undefined): string {
  if (!sentAt || !receivedAt) return "—";
  const sent = new Date(sentAt);
  const received = new Date(receivedAt);
  if (isNaN(sent.getTime()) || isNaN(received.getTime())) return "—";
  const diffMs = received.getTime() - sent.getTime();
  if (diffMs < 0) return "—";
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "<1 day";
  if (diffDays === 1) return "1 day";
  return `${diffDays} days`;
}

export default function PurchaseOrders() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedPO, setSelectedPO] = useState<PurchaseOrderWithSupplier | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingPO, setEditingPO] = useState<PurchaseOrderWithSupplier | null>(null);
  
  const [activeTab, setActiveTab] = useState<"live" | "history">("live");
  const [historyStartDate, setHistoryStartDate] = useState<Date | undefined>(subDays(new Date(), 30));
  const [historyEndDate, setHistoryEndDate] = useState<Date | undefined>(new Date());

  const viewParam = activeTab === "live" ? "live" : "historical";
  const queryParams = new URLSearchParams({ view: viewParam });
  if (activeTab === "history" && historyStartDate) {
    queryParams.set("startDate", historyStartDate.toISOString());
  }
  if (activeTab === "history" && historyEndDate) {
    queryParams.set("endDate", historyEndDate.toISOString());
  }

  const { data: purchaseOrders, isLoading } = useQuery<PurchaseOrderWithSupplier[]>({
    queryKey: ["/api/purchase-orders", viewParam, historyStartDate?.toISOString(), historyEndDate?.toISOString()],
    queryFn: async () => {
      const res = await fetch(`/api/purchase-orders?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch purchase orders");
      return res.json();
    },
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

  const recalculateStatusMutation = useMutation({
    mutationFn: async (poId: string) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${poId}/recalculate-status`, {});
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to recalculate status");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      if (data.previousStatus && data.newStatus && data.previousStatus !== data.newStatus) {
        toast({ title: `Status updated from ${data.previousStatus} to ${data.newStatus}` });
      } else {
        toast({ title: "Status is already correct" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const markAcceptedMutation = useMutation({
    mutationFn: async (poId: string) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${poId}/mark-accepted-internal`, {});
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to mark as accepted");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      if (selectedPO?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", selectedPO.id, "composite"] });
      }
      toast({ title: "PO marked as accepted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const [editingShipping, setEditingShipping] = useState(false);
  const [editingOtherFees, setEditingOtherFees] = useState(false);
  const [shippingValue, setShippingValue] = useState<string>("");
  const [otherFeesValue, setOtherFeesValue] = useState<string>("");

  const updateFinancialsMutation = useMutation({
    mutationFn: async ({ poId, shippingCost, otherFees }: { poId: string; shippingCost?: number; otherFees?: number }) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${poId}/update-financials`, { shippingCost, otherFees });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update financials");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      if (selectedPO?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", selectedPO.id, "composite"] });
      }
      toast({ title: "Financial details updated" });
      setEditingShipping(false);
      setEditingOtherFees(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSaveShipping = () => {
    if (!selectedPO?.id) return;
    const value = parseFloat(shippingValue) || 0;
    updateFinancialsMutation.mutate({ poId: selectedPO.id, shippingCost: value });
  };

  const handleSaveOtherFees = () => {
    if (!selectedPO?.id) return;
    const value = parseFloat(otherFeesValue) || 0;
    updateFinancialsMutation.mutate({ poId: selectedPO.id, otherFees: value });
  };

  const startEditShipping = () => {
    setShippingValue(String(poDetails?.shippingCost || 0));
    setEditingShipping(true);
  };

  const startEditOtherFees = () => {
    setOtherFeesValue(String(poDetails?.otherFees || 0));
    setEditingOtherFees(true);
  };

  const calculateValueReceived = () => {
    if (!poDetails?.lines?.length) return 0;
    return poDetails.lines.reduce((sum: number, line: any) => {
      return sum + ((line.qtyReceived || 0) * (line.unitCost || 0));
    }, 0);
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
    
    // Use displayStatus for filtering (unified lifecycle status)
    const poDisplayStatus = (po as any).displayStatus || po.status;
    const matchesStatus = statusFilter === "all" || poDisplayStatus === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const sortedPOs = [...filteredPOs].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.orderDate).getTime();
    const dateB = new Date(b.createdAt || b.orderDate).getTime();
    return dateB - dateA;
  });

  // Use displayStatus for status counts
  const statusCounts = enrichedPOs.reduce((acc, po) => {
    const displayStatus = (po as any).displayStatus || po.status;
    acc[displayStatus] = (acc[displayStatus] || 0) + 1;
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
            <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-po">
              <Plus className="h-4 w-4 mr-2" />
              Create PO
            </Button>
          )}
        </div>
      </div>

      {activeTab === "live" && (
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
      )}

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
                  {sortedPOs.length} archived records
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" data-testid="button-export-po">
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="SENT">Sent</SelectItem>
                  <SelectItem value="ACCEPTED">Accepted</SelectItem>
                  <SelectItem value="PARTIAL">Partial</SelectItem>
                  <SelectItem value="RECEIVED">Received</SelectItem>
                  <SelectItem value="CLOSED">Closed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Badge variant="secondary" className="text-sm font-medium" data-testid="badge-total-pos">
                {sortedPOs.length} {sortedPOs.length === 1 ? 'PO' : 'POs'}
              </Badge>
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
            <table className="w-full table-auto">
              <thead className="bg-muted sticky top-0 z-10">
                <tr className="border-b">
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">PO Number</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Supplier</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Status</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Email</th>
                  <th className="p-3 text-center text-sm font-medium whitespace-nowrap w-px">Items</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Order Date</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Expected</th>
                  <th className="p-3 text-center text-sm font-medium whitespace-nowrap w-px">Lead Time</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Total</th>
                  <th className="sticky right-0 z-20 bg-muted p-3 text-right text-sm font-medium whitespace-nowrap w-px shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedPOs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="h-32 text-center text-muted-foreground">
                      {searchQuery || statusFilter !== "all"
                        ? "No purchase orders match your filters"
                        : "No purchase orders yet. Create your first one!"}
                    </td>
                  </tr>
                ) : (
                  sortedPOs.map((po) => {
                    const isAutoDraft = (po as any).isAutoDraft === true;
                    return (
                    <tr 
                      key={po.id} 
                      className={`border-b last:border-b-0 cursor-pointer hover-elevate h-12 ${
                        isAutoDraft 
                          ? "bg-amber-50 dark:bg-amber-950/30 border-l-4 border-l-amber-400" 
                          : ""
                      }`}
                      onClick={() => handleViewDetails(po)}
                      data-testid={`row-po-${po.id}`}
                    >
                      <td className="p-3 align-middle whitespace-nowrap font-medium">
                        <div className="flex items-center gap-2">
                          {isAutoDraft && (
                            <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          )}
                          {po.poNumber}
                        </div>
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap">
                        <span className="font-medium">{po.supplier?.name || po.supplierName || "-"}</span>
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap">
                        <StatusBadge status={(po as any).displayStatus || po.status} />
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap">
                        <EmailStatusBadge 
                          status={(po as any).lastEmailStatus} 
                          sentAt={(po as any).lastEmailSentAt}
                          emailTo={(po as any).emailTo}
                        />
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Package className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm" data-testid={`text-po-items-${po.id}`}>
                            {(po as any).totalItemsOrdered || po.lines?.length || "—"}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap">{formatDate(po.orderDate)}</td>
                      <td className="p-3 align-middle whitespace-nowrap" data-testid={`text-expected-${po.id}`}>
                        {po.expectedDate ? (
                          formatDate(po.expectedDate)
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            Lead time unknown
                          </span>
                        )}
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap text-center text-muted-foreground" data-testid={`text-lead-time-${po.id}`}>
                        {calculateLeadTime(po.sentAt, po.receivedAt)}
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap text-right font-medium">
                        {formatCurrency(po.total)}
                      </td>
                      <td className={`sticky right-0 z-10 p-3 align-middle whitespace-nowrap shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)] ${isAutoDraft ? "bg-amber-50 dark:bg-amber-950/30" : "bg-background"}`}>
                        <div className="flex justify-end gap-2">
                          {/* Show Verify & Send button for AI-generated draft POs */}
                          {isAutoDraft && ((po as any).displayStatus === "DRAFT" || po.status === "DRAFT") && (
                            <Button
                              size="sm"
                              variant="default"
                              className="bg-amber-600 hover:bg-amber-700 text-white"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingPO(po);
                                setIsEditOpen(true);
                              }}
                              data-testid={`button-verify-send-${po.id}`}
                            >
                              <AlertCircle className="h-3.5 w-3.5 mr-1" />
                              Verify & Send
                            </Button>
                          )}
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
                              {/* Show Edit for Draft status */}
                              {((po as any).displayStatus === "DRAFT" || po.status === "DRAFT" || po.status === "APPROVAL_PENDING" || po.status === "APPROVED") && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingPO(po);
                                      setIsEditOpen(true);
                                    }}
                                    data-testid={`button-edit-po-${po.id}`}
                                  >
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Edit PO
                                  </DropdownMenuItem>
                                </>
                              )}
                              {/* Show Send PO for Draft status */}
                              {((po as any).displayStatus === "DRAFT" || po.status === "DRAFT" || po.status === "APPROVED") && (
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
                              {/* Show Confirm Receipt for Sent, Accepted, or Partial status */}
                              {["SENT", "ACCEPTED", "PARTIAL"].includes((po as any).displayStatus || po.status) && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleAction(po.id, "bulk-confirm-receipt"); }}>
                                    <PackageCheck className="h-4 w-4 mr-2" />
                                    Confirm Full Receipt
                                  </DropdownMenuItem>
                                </>
                              )}
                              {/* Show Cancel for open statuses */}
                              {!["CLOSED", "CANCELLED", "RECEIVED"].includes((po as any).displayStatus || po.status) && (
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
                  );})
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
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
                  <StatusBadge status={poDetails.displayStatus || poDetails.status} />
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
                <div className="flex items-center gap-4 flex-wrap">
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
                <div className="flex items-center gap-2">
                  {/* Show Send PO for Draft status */}
                  {(poDetails.displayStatus === "DRAFT" || poDetails.status === "DRAFT" || poDetails.status === "APPROVED") && (
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
                  {/* Show Mark as Accepted only when displayStatus is SENT (not yet accepted) */}
                  {(poDetails.displayStatus || poDetails.status) === "SENT" && (
                    <Button
                      variant="outline"
                      onClick={() => markAcceptedMutation.mutate(poDetails.id)}
                      disabled={markAcceptedMutation.isPending}
                      data-testid="button-mark-accepted"
                    >
                      {markAcceptedMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Marking...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Mark as Accepted
                        </>
                      )}
                    </Button>
                  )}
                </div>
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
                    <table className="w-full table-auto">
                      <thead className="bg-muted/50">
                        <tr className="border-b">
                          <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Item</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Qty Ordered</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Qty Received</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Unit Cost</th>
                          <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Line Total</th>
                          <th className="sticky right-0 z-10 bg-muted/50 p-3 text-right text-sm font-medium whitespace-nowrap w-px shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {poDetails.lines.map((line: any) => {
                          const remaining = line.qtyOrdered - (line.qtyReceived || 0);
                          const isFullyReceived = remaining <= 0;
                          // Allow accepting items when status is Sent, Accepted, or Partial
                          const displayStatus = poDetails.displayStatus || poDetails.status;
                          const canAccept = poDetails?.id && 
                            line?.id && 
                            ['SENT', 'ACCEPTED', 'PARTIAL', 'PARTIAL_RECEIVED'].includes(displayStatus) && 
                            remaining > 0;
                          
                          return (
                            <tr key={line.id} className="border-b last:border-b-0" data-testid={`row-line-${line.id}`}>
                              <td className="p-3">
                                <div className="max-w-[180px]">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <p className="font-medium truncate cursor-default">{line.item?.name || line.itemName || "-"}</p>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs">
                                      <p>{line.item?.name || line.itemName || "-"}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                  <p className="text-xs text-muted-foreground truncate">{line.item?.sku || line.sku || "-"}</p>
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

              <div className="space-y-3 pt-4 border-t">
                <h4 className="font-medium">Financial Summary</h4>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Subtotal</span>
                    <span className="font-medium" data-testid="text-po-subtotal">{formatCurrency(poDetails.subtotal)}</span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Shipping</span>
                    {editingShipping ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={shippingValue}
                          onChange={(e) => setShippingValue(e.target.value)}
                          className="w-24 h-8 text-right"
                          autoFocus
                          data-testid="input-shipping-cost"
                        />
                        <Button size="sm" variant="ghost" onClick={handleSaveShipping} disabled={updateFinancialsMutation.isPending} data-testid="button-save-shipping">
                          {updateFinancialsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingShipping(false)} data-testid="button-cancel-shipping">
                          <XCircle className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <span 
                        className="font-medium cursor-pointer hover:underline" 
                        onClick={startEditShipping}
                        title="Click to edit"
                        data-testid="text-po-shipping"
                      >
                        {formatCurrency(poDetails.shippingCost)}
                      </span>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Other Fees</span>
                    {editingOtherFees ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={otherFeesValue}
                          onChange={(e) => setOtherFeesValue(e.target.value)}
                          className="w-24 h-8 text-right"
                          autoFocus
                          data-testid="input-other-fees"
                        />
                        <Button size="sm" variant="ghost" onClick={handleSaveOtherFees} disabled={updateFinancialsMutation.isPending} data-testid="button-save-fees">
                          {updateFinancialsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingOtherFees(false)} data-testid="button-cancel-fees">
                          <XCircle className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <span 
                        className="font-medium cursor-pointer hover:underline" 
                        onClick={startEditOtherFees}
                        title="Click to edit"
                        data-testid="text-po-other-fees"
                      >
                        {formatCurrency(poDetails.otherFees)}
                      </span>
                    )}
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t">
                    <span className="text-sm font-medium">Total</span>
                    <span className="font-bold text-lg" data-testid="text-po-total">{formatCurrency(poDetails.total)}</span>
                  </div>
                </div>

                {poDetails.lines?.some((line: any) => (line.qtyReceived || 0) > 0) && (
                  <div className="mt-3 pt-3 border-t">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Value Ordered</span>
                      <span className="font-medium" data-testid="text-value-ordered">{formatCurrency(poDetails.subtotal)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Value Received</span>
                      <span className="font-medium text-green-600" data-testid="text-value-received">{formatCurrency(calculateValueReceived())}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">Failed to load details</p>
          )}

          <DialogFooter className="gap-2">
            {/* Edit button for Draft POs */}
            {poDetails?.id && 
             ['DRAFT', 'APPROVAL_PENDING', 'APPROVED'].includes(poDetails.status) && (
              <Button
                variant="outline"
                onClick={() => {
                  setEditingPO({ ...selectedPO, lines: poDetails.lines } as PurchaseOrderWithSupplier);
                  setIsDetailOpen(false);
                  setIsEditOpen(true);
                }}
                data-testid="button-edit-po-detail"
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edit PO
              </Button>
            )}
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
            {poDetails?.id && 
             poDetails.status === 'PARTIAL_RECEIVED' &&
             poDetails.lines?.length > 0 &&
             poDetails.lines.every((line: any) => (line.qtyReceived || 0) >= line.qtyOrdered) && (
              <Button
                onClick={() => recalculateStatusMutation.mutate(poDetails.id)}
                disabled={recalculateStatusMutation.isPending}
                data-testid="button-recalculate-status"
              >
                {recalculateStatusMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Update Status to Received
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

      <CreatePODialog 
        open={isCreateOpen} 
        onOpenChange={setIsCreateOpen}
        onPOCreated={(poId) => {
          queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
        }}
      />

      <EditPODialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        purchaseOrder={editingPO}
        onPOUpdated={(poId) => {
          queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
          if (selectedPO?.id === poId) {
            queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", poId, "composite"] });
          }
        }}
      />
    </div>
  );
}
