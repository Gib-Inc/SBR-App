import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Search,
  Building2,
  TrendingUp,
  Package,
  Clock,
  CheckCircle,
  XCircle,
  Send,
  FileText,
  AlertCircle,
  Truck,
  MessageSquare,
  Brain,
  TrendingDown,
  Flag,
  PackageCheck,
  Mail,
  Receipt,
  RefreshCw,
  Loader2,
  ExternalLink,
  UserPlus,
  Globe,
  Phone,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CreatePOSheet } from "@/components/create-po-sheet";
import type { PurchaseOrder, Supplier, Item, PurchaseOrderLine, SupplierLead } from "@shared/schema";

interface POSummary {
  total: number;
  draft: number;
  approvalPending: number;
  approved: number;
  sent: number;
  partialReceived: number;
  received: number;
  closed: number;
  cancelled: number;
}

interface EnrichedPO extends PurchaseOrder {
  lines?: PurchaseOrderLine[];
}

interface PhantomAgent {
  id: string;
  name: string;
  status: string;
  lastEndStatus?: string;
}

interface DiscoveryJobState {
  isRunning: boolean;
  containerId?: string;
  agentId?: string;
  keywords?: string;
  location?: string;
}

export default function Suppliers() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("purchase-orders");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [selectedPO, setSelectedPO] = useState<string | null>(null);
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState<string | null>(null);
  const [showOpenDisputeDialog, setShowOpenDisputeDialog] = useState<string | null>(null);
  const [showResolveDisputeDialog, setShowResolveDisputeDialog] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [showCreatePOSheet, setShowCreatePOSheet] = useState(false);
  
  // Discovery state
  const [discoveryKeywords, setDiscoveryKeywords] = useState("");
  const [discoveryLocation, setDiscoveryLocation] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [discoveryJob, setDiscoveryJob] = useState<DiscoveryJobState>({ isRunning: false });
  const [leadSearchQuery, setLeadSearchQuery] = useState("");

  const { data: poSummary } = useQuery<POSummary>({
    queryKey: ['/api/purchase-orders/summary'],
  });

  const { data: purchaseOrders = [], isLoading: isLoadingPOs } = useQuery<EnrichedPO[]>({
    queryKey: ['/api/purchase-orders'],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['/api/suppliers'],
  });

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ['/api/items'],
  });

  const { data: selectedPOData } = useQuery<PurchaseOrder & { lines: PurchaseOrderLine[] }>({
    queryKey: ['/api/purchase-orders', selectedPO],
    enabled: !!selectedPO,
  });

  // Query QuickBooks bill for selected PO
  const { data: selectedPOBill } = useQuery<{
    hasBill: boolean;
    billId?: string;
    billNumber?: string;
    status?: string;
    totalAmount?: number;
    createdAt?: string;
  }>({
    queryKey: ['/api/purchase-orders', selectedPO, 'bill-status'],
    enabled: !!selectedPO,
  });

  // Query PO data for confirm dialog
  const { data: confirmPOData } = useQuery<PurchaseOrder & { lines: PurchaseOrderLine[] }>({
    queryKey: ['/api/purchase-orders', showConfirmDialog],
    enabled: !!showConfirmDialog,
  });

  // Query PO data for dispute dialogs
  const { data: disputePOData } = useQuery<PurchaseOrder & { lines: PurchaseOrderLine[] }>({
    queryKey: ['/api/purchase-orders', showOpenDisputeDialog || showResolveDisputeDialog],
    enabled: !!(showOpenDisputeDialog || showResolveDisputeDialog),
  });

  // PhantomBuster discovery queries
  const { data: phantomAgents, isLoading: isLoadingAgents } = useQuery<{ success: boolean; agents: PhantomAgent[]; message: string }>({
    queryKey: ['/api/suppliers/discovery/phantombuster/agents'],
    enabled: activeTab === 'discovery',
  });

  const { data: supplierLeads = [], isLoading: isLoadingLeads, refetch: refetchLeads } = useQuery<SupplierLead[]>({
    queryKey: ['/api/supplier-leads'],
    enabled: activeTab === 'discovery',
  });

  // Run discovery mutation
  const runDiscoveryMutation = useMutation({
    mutationFn: async (params: { agentId: string; keywords: string; location?: string }) => {
      const res = await apiRequest('POST', '/api/suppliers/discovery/phantombuster/run', params);
      return res.json() as Promise<{ success: boolean; containerId?: string; message: string }>;
    },
    onSuccess: async (data: { success: boolean; containerId?: string; message: string }) => {
      if (data.success && data.containerId) {
        setDiscoveryJob({
          isRunning: true,
          containerId: data.containerId,
          agentId: selectedAgentId,
          keywords: discoveryKeywords,
          location: discoveryLocation,
        });
        toast({
          title: "Discovery Started",
          description: "Searching for suppliers... This may take 30-60 seconds.",
        });
        // Poll for results
        setTimeout(() => pollResults(data.containerId!), 5000);
      } else {
        toast({
          title: "Discovery Failed",
          description: data.message,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Discovery Error",
        description: error.message || "Failed to start discovery",
        variant: "destructive",
      });
    },
  });

  // Poll for results
  const pollResults = async (containerId: string) => {
    try {
      const res = await apiRequest('POST', '/api/suppliers/discovery/phantombuster/results', {
        agentId: discoveryJob.agentId || selectedAgentId,
        containerId,
        keywords: discoveryJob.keywords || discoveryKeywords,
        location: discoveryJob.location || discoveryLocation,
      });
      const result = await res.json() as { success: boolean; leadsFound?: number; leadsSaved?: number; message: string };

      if (result.success) {
        setDiscoveryJob({ isRunning: false });
        toast({
          title: "Discovery Complete",
          description: result.message,
        });
        refetchLeads();
        queryClient.invalidateQueries({ queryKey: ['/api/supplier-leads'] });
      } else {
        // Still running, poll again
        if (discoveryJob.isRunning) {
          setTimeout(() => pollResults(containerId), 5000);
        }
      }
    } catch (error: any) {
      setDiscoveryJob({ isRunning: false });
      toast({
        title: "Polling Error",
        description: error.message || "Failed to get results",
        variant: "destructive",
      });
    }
  };

  // Convert lead to supplier mutation
  const convertLeadMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const res = await apiRequest('POST', `/api/supplier-leads/${leadId}/convert`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Lead Converted",
        description: "Successfully created new supplier from lead",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/supplier-leads'] });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
    },
    onError: (error: any) => {
      toast({
        title: "Conversion Failed",
        description: error.message || "Failed to convert lead",
        variant: "destructive",
      });
    },
  });

  // Filter supplier leads
  const filteredLeads = useMemo(() => {
    if (!leadSearchQuery) return supplierLeads;
    const query = leadSearchQuery.toLowerCase();
    return supplierLeads.filter(lead =>
      lead.name.toLowerCase().includes(query) ||
      lead.companyName?.toLowerCase().includes(query) ||
      lead.contactEmail?.toLowerCase().includes(query) ||
      lead.location?.toLowerCase().includes(query)
    );
  }, [supplierLeads, leadSearchQuery]);

  // Filter purchase orders
  const filteredPOs = useMemo(() => {
    return purchaseOrders.filter(po => {
      const supplier = suppliers.find(s => s.id === po.supplierId);
      const supplierName = supplier?.name?.toLowerCase() || '';
      
      const matchesSearch = 
        (po.poNumber?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
        supplierName.includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || po.status === statusFilter;
      const matchesSupplier = supplierFilter === 'all' || String(po.supplierId) === supplierFilter;

      return matchesSearch && matchesStatus && matchesSupplier;
    });
  }, [purchaseOrders, searchQuery, statusFilter, supplierFilter, suppliers]);

  // Calculate analytics from filtered POs
  const filteredAnalytics = useMemo(() => {
    // Status counts
    const needsReview = filteredPOs.filter(po => po.issueStatus === 'OPEN').length;
    const draft = filteredPOs.filter(po => po.status === 'DRAFT').length;
    const approvalPending = filteredPOs.filter(po => po.status === 'APPROVAL_PENDING').length;
    const activeOpen = filteredPOs.filter(po => 
      po.status === 'SENT' || 
      po.status === 'PARTIAL_RECEIVED' || 
      po.status === 'APPROVAL_PENDING' || 
      po.status === 'APPROVED'
    ).length;
    
    // Business metrics
    const sent = filteredPOs.filter(po => po.sentAt !== null).length;
    const paid = filteredPOs.filter(po => po.paidAt !== null).length;
    const delivered = filteredPOs.filter(po => po.receivedAt !== null).length;
    
    const deliveredPOs = filteredPOs.filter(po => po.sentAt && po.receivedAt);
    let avgDeliveryDays: number | null = null;
    if (deliveredPOs.length > 0) {
      const totalDays = deliveredPOs.reduce((sum, po) => {
        const sentDate = new Date(po.sentAt!);
        const receivedDate = new Date(po.receivedAt!);
        const days = Math.ceil((receivedDate.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24));
        return sum + days;
      }, 0);
      avgDeliveryDays = Math.round(totalDays / deliveredPOs.length);
    }
    
    return { needsReview, draft, approvalPending, activeOpen, sent, paid, delivered, avgDeliveryDays };
  }, [filteredPOs]);

  // Helper to get products ordered summary
  const getProductsSummary = (lines?: PurchaseOrderLine[]) => {
    if (!lines || lines.length === 0) return '-';
    const summaryParts = lines.slice(0, 3).map(line => {
      const item = items.find(i => i.id === line.itemId);
      return `${line.qtyOrdered}x ${item?.name || 'Unknown'}`;
    });
    if (lines.length > 3) {
      summaryParts.push(`+${lines.length - 3} more`);
    }
    return summaryParts.join(', ');
  };

  // Helper to calculate order total
  const getOrderTotal = (lines?: PurchaseOrderLine[]) => {
    if (!lines || lines.length === 0) return 0;
    return lines.reduce((sum, line) => sum + (line.qtyOrdered * (line.unitCost || 0)), 0);
  };

  // Helper to calculate days to receive
  const getDaysToReceive = (orderDate: Date | null, receivedAt: Date | null) => {
    if (!orderDate || !receivedAt) return null;
    const diffMs = new Date(receivedAt).getTime() - new Date(orderDate).getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  };

  const approvePOMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${id}/approve`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      toast({ title: "PO approved successfully" });
      setSelectedPO(null);
    },
  });

  const rejectPOMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${id}/reject`, { reason });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      toast({ title: "PO rejected and returned to draft" });
      setSelectedPO(null);
    },
  });

  const sendPOMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${id}/send`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      toast({ title: "PO marked as sent" });
      setSelectedPO(null);
    },
  });

  const closePOMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${id}/close`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      toast({ title: "PO closed successfully" });
      setSelectedPO(null);
    },
  });

  const cancelPOMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${id}/cancel`, { reason });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      toast({ title: "PO cancelled" });
      setSelectedPO(null);
    },
  });

  const confirmReceiptMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${id}/confirm-receipt`, {});
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to confirm receipt");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/items'] });
      toast({ title: "PO marked as received and stock updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to confirm receipt",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const toggleDisputeMutation = useMutation({
    mutationFn: async ({ id, action, reason, resolutionNotes }: { 
      id: string; 
      action: 'open' | 'resolve'; 
      reason?: string;
      resolutionNotes?: string;
    }) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${id}/toggle-dispute`, { 
        action, 
        reason,
        resolutionNotes 
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update dispute status");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      toast({ 
        title: variables.action === 'open' 
          ? "Dispute opened - GHL team will be notified" 
          : "Dispute marked as resolved" 
      });
      // Clear modal states and text fields
      setShowOpenDisputeDialog(null);
      setShowResolveDisputeDialog(null);
      setDisputeReason("");
      setResolutionNotes("");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update dispute",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const bulkConfirmReceiptMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${id}/bulk-confirm-receipt`, {});
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to confirm receipt");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/items'] });
      toast({ title: "Order marked as fully received and inventory updated" });
      setShowConfirmDialog(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to confirm receipt",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const createBillMutation = useMutation({
    mutationFn: async (poId: string) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${poId}/create-bill`, {});
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create QuickBooks bill");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders', selectedPO, 'bill-status'] });
      toast({ title: "QuickBooks bill created successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create bill",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  return (
    <div className="w-full max-w-full min-w-0 overflow-x-hidden px-4 md:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground">
            Manage purchase orders, supplier relationships, and discovery pipeline
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="purchase-orders" data-testid="tab-purchase-orders">
            <Building2 className="h-4 w-4 mr-2" />
            PO History & Issues
          </TabsTrigger>
          <TabsTrigger value="discovery" data-testid="tab-discovery">
            <TrendingUp className="h-4 w-4 mr-2" />
            Discovery & Creation
            <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 h-4">V2</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="purchase-orders" className="w-full max-w-full min-w-0 space-y-4">
          {/* Compact Analytics Cards - 8 cards in 2 rows */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Row 1: Status Overview Cards */}
            <Card data-testid="card-needs-review" className="h-20">
              <CardHeader className="pb-1 pt-3">
                <CardTitle className="text-xs font-medium text-muted-foreground">Needs Review</CardTitle>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="text-xl font-bold text-destructive">{filteredAnalytics.needsReview}</div>
                <p className="text-xs text-muted-foreground">POs in dispute</p>
              </CardContent>
            </Card>
            <Card data-testid="card-draft" className="h-20">
              <CardHeader className="pb-1 pt-3">
                <CardTitle className="text-xs font-medium text-muted-foreground">Draft</CardTitle>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="text-xl font-bold">{filteredAnalytics.draft}</div>
              </CardContent>
            </Card>
            <Card data-testid="card-approval" className="h-20">
              <CardHeader className="pb-1 pt-3">
                <CardTitle className="text-xs font-medium text-muted-foreground">Pending Approval</CardTitle>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="text-xl font-bold">{filteredAnalytics.approvalPending}</div>
              </CardContent>
            </Card>
            <Card data-testid="card-active" className="h-20">
              <CardHeader className="pb-1 pt-3">
                <CardTitle className="text-xs font-medium text-muted-foreground">Active/Open</CardTitle>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="text-xl font-bold">{filteredAnalytics.activeOpen}</div>
              </CardContent>
            </Card>
            
            {/* Row 2: Business Metrics Cards */}
            <Card data-testid="card-sent" className="h-20">
              <CardHeader className="pb-1 pt-3">
                <CardTitle className="text-xs font-medium text-muted-foreground">POs Sent</CardTitle>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="text-xl font-bold">{filteredAnalytics.sent}</div>
              </CardContent>
            </Card>
            <Card data-testid="card-paid" className="h-20">
              <CardHeader className="pb-1 pt-3">
                <CardTitle className="text-xs font-medium text-muted-foreground">POs Paid</CardTitle>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="text-xl font-bold">{filteredAnalytics.paid}</div>
              </CardContent>
            </Card>
            <Card data-testid="card-delivered" className="h-20">
              <CardHeader className="pb-1 pt-3">
                <CardTitle className="text-xs font-medium text-muted-foreground">POs Delivered</CardTitle>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="text-xl font-bold">{filteredAnalytics.delivered}</div>
              </CardContent>
            </Card>
            <Card data-testid="card-avg-delivery" className="h-20">
              <CardHeader className="pb-1 pt-3">
                <CardTitle className="text-xs font-medium text-muted-foreground">Avg Delivery</CardTitle>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="text-xl font-bold">
                  {filteredAnalytics.avgDeliveryDays !== null ? `${filteredAnalytics.avgDeliveryDays}d` : '—'}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* PO Table Section */}
          <div className="flex flex-col gap-4">
            {/* Section Heading */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Purchase Orders</h2>
                <p className="text-sm text-muted-foreground">Track and manage supplier purchase orders</p>
              </div>
              <Button size="sm" onClick={() => setShowCreatePOSheet(true)} data-testid="button-create-po">
                <Plus className="h-4 w-4 mr-2" />
                Create PO
              </Button>
            </div>

            {/* Search and Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by PO# or supplier..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-po"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="APPROVAL_PENDING">Pending Approval</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="SENT">Sent</SelectItem>
                  <SelectItem value="PARTIAL_RECEIVED">Partial Received</SelectItem>
                  <SelectItem value="RECEIVED">Received</SelectItem>
                  <SelectItem value="CLOSED">Closed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger className="w-[200px]" data-testid="select-supplier-filter">
                  <SelectValue placeholder="Filter by supplier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Suppliers</SelectItem>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Data Table */}
            {isLoadingPOs ? (
              <div className="flex h-48 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
              </div>
            ) : filteredPOs.length === 0 ? (
              <Card>
                <CardContent className="flex h-48 flex-col items-center justify-center gap-2">
                  <Building2 className="h-12 w-12 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {purchaseOrders.length === 0 
                      ? "No purchase orders yet. Create your first one to get started."
                      : "No purchase orders match your filters."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="relative max-h-[600px] overflow-y-auto rounded-md border">
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[1100px]">
                    <thead className="sticky top-0 bg-muted/50 z-10">
                      <tr className="border-b">
                        <th className="p-3 text-left text-sm font-medium whitespace-nowrap bg-muted/50">PO #</th>
                        <th className="p-3 text-left text-sm font-medium whitespace-nowrap bg-muted/50">Supplier</th>
                        <th className="p-3 text-left text-sm font-medium whitespace-nowrap bg-muted/50">Products Ordered</th>
                        <th className="p-3 text-left text-sm font-medium whitespace-nowrap bg-muted/50">Status</th>
                        <th className="p-3 text-left text-sm font-medium whitespace-nowrap bg-muted/50">Order Date</th>
                        <th className="p-3 text-left text-sm font-medium whitespace-nowrap bg-muted/50">Expected</th>
                        <th className="p-3 text-left text-sm font-medium whitespace-nowrap bg-muted/50">Received</th>
                        <th className="p-3 text-left text-sm font-medium whitespace-nowrap bg-muted/50">Days to Receive</th>
                        <th className="p-3 text-left text-sm font-medium whitespace-nowrap bg-muted/50">GHL Rep</th>
                        <th className="p-3 text-right text-sm font-medium whitespace-nowrap bg-muted/50">Total</th>
                        <th className="sticky right-0 z-10 p-3 text-right text-sm font-medium whitespace-nowrap bg-muted/50 shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPOs.map((po) => {
                          const daysToReceive = getDaysToReceive(po.orderDate, po.receivedAt);
                          const orderTotal = getOrderTotal(po.lines);
                          const canConfirm = po.status === 'SENT' || po.status === 'PARTIAL_RECEIVED';
                          
                          return (
                            <tr 
                              key={po.id} 
                              className="h-11 border-b hover-elevate cursor-pointer" 
                              data-testid={`row-po-${po.id}`}
                              onClick={() => setSelectedPO(po.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedPO(po.id);
                                }
                              }}
                              tabIndex={0}
                              role="button"
                              aria-label={`View purchase order ${po.poNumber}`}
                            >
                              <td className="px-3 align-middle whitespace-nowrap">
                                <span className="font-mono text-sm font-medium">{po.poNumber}</span>
                              </td>
                              <td className="px-3 align-middle whitespace-nowrap">
                                {suppliers.find((s) => s.id === po.supplierId)?.name || 'Unknown'}
                              </td>
                              <td className="px-3 align-middle whitespace-nowrap">
                                <span className="text-sm max-w-xs truncate block" title={getProductsSummary(po.lines)}>
                                  {getProductsSummary(po.lines)}
                                </span>
                              </td>
                              <td className="px-3 align-middle whitespace-nowrap">
                                {po.issueStatus === 'OPEN' ? (
                                  <Badge variant="destructive" data-testid={`badge-dispute-${po.id}`}>
                                    <Flag className="h-3 w-3 mr-1" />
                                    In Dispute
                                  </Badge>
                                ) : (
                                  <Badge variant={
                                    po.status === 'RECEIVED' || po.status === 'CLOSED' ? 'default' :
                                    po.status === 'SENT' || po.status === 'APPROVED' ? 'secondary' :
                                    po.status === 'CANCELLED' ? 'destructive' :
                                    'outline'
                                  } data-testid={`badge-status-${po.id}`}>
                                    {po.status.replace('_', ' ')}
                                  </Badge>
                                )}
                              </td>
                              <td className="px-3 align-middle text-sm whitespace-nowrap">
                                {po.orderDate ? new Date(po.orderDate).toLocaleDateString() : '-'}
                              </td>
                              <td className="px-3 align-middle text-sm whitespace-nowrap">
                                {po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : '-'}
                              </td>
                              <td className="px-3 align-middle text-sm whitespace-nowrap">
                                {po.receivedAt ? new Date(po.receivedAt).toLocaleDateString() : '-'}
                              </td>
                              <td className="px-3 align-middle text-sm whitespace-nowrap">
                                {daysToReceive !== null ? `${daysToReceive} days` : '-'}
                              </td>
                              <td className="px-3 align-middle text-sm whitespace-nowrap">
                                {po.ghlRepName || '-'}
                              </td>
                              <td className="px-3 align-middle text-sm text-right whitespace-nowrap font-medium">
                                ${orderTotal.toFixed(2)}
                              </td>
                              <td className="sticky right-0 z-10 bg-card px-3 align-middle text-right whitespace-nowrap shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">
                                <div className="flex items-center justify-end gap-1">
                                  {/* Dispute / Resolve Icon */}
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (po.issueStatus === 'OPEN') {
                                        setShowResolveDisputeDialog(po.id);
                                      } else {
                                        setShowOpenDisputeDialog(po.id);
                                      }
                                    }}
                                    data-testid={`button-dispute-${po.id}`}
                                    aria-label={
                                      po.issueStatus === 'OPEN' 
                                        ? "Resolve dispute" 
                                        : po.issueStatus === 'RESOLVED'
                                        ? "Dispute was resolved"
                                        : "Open dispute and notify in GHL"
                                    }
                                    title={
                                      po.issueStatus === 'OPEN' 
                                        ? "Resolve dispute" 
                                        : po.issueStatus === 'RESOLVED'
                                        ? "Dispute was resolved"
                                        : "Open dispute & notify in GHL"
                                    }
                                  >
                                    <Flag className={`h-4 w-4 ${
                                      po.issueStatus === 'OPEN' ? 'fill-destructive text-destructive' : 
                                      po.issueStatus === 'RESOLVED' ? 'text-muted-foreground' : 
                                      ''
                                    }`} />
                                  </Button>
                                  {/* Confirm Received Icon */}
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (canConfirm) {
                                        setShowConfirmDialog(po.id);
                                      }
                                    }}
                                    disabled={!canConfirm}
                                    data-testid={`button-confirm-receipt-${po.id}`}
                                    aria-label={
                                      canConfirm
                                        ? "Confirm order received in full"
                                        : "Receiving not available in this status"
                                    }
                                    title={
                                      canConfirm
                                        ? "Confirm order received in full"
                                        : "Receiving not available in this status"
                                    }
                                  >
                                    <PackageCheck className={`h-4 w-4 ${canConfirm ? '' : 'text-muted-foreground'}`} />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="discovery" className="w-full max-w-full min-w-0 space-y-4">
          {/* V2 Coming Soon Notice */}
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Search className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Supplier Discovery</h3>
              <Badge variant="outline" className="mb-4">Coming in V2</Badge>
              <p className="text-muted-foreground max-w-md">
                Automated supplier discovery via PhantomBuster web scraping will be available in V2. 
                This feature will help you find new suppliers based on keywords and location filters.
              </p>
              <div className="mt-6 p-4 bg-muted/50 rounded-lg max-w-md">
                <p className="text-sm text-muted-foreground">
                  <strong>V2 Features:</strong> LinkedIn & Google scraping, lead management, 
                  automatic supplier conversion, and discovery analytics.
                </p>
              </div>
            </CardContent>
          </Card>
          
          {/* Hidden for V1 - Discovery Form */}
          {false && <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Run Supplier Discovery
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!phantomAgents?.success || phantomAgents.agents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-2">PhantomBuster not configured</p>
                  <p className="text-sm text-muted-foreground">
                    Configure your PhantomBuster API key in Settings → AI Agent → Data Sources
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="discovery-agent">PhantomBuster Agent</Label>
                    <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                      <SelectTrigger data-testid="select-agent">
                        <SelectValue placeholder="Select agent..." />
                      </SelectTrigger>
                      <SelectContent>
                        {phantomAgents.agents.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>
                            {agent.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="discovery-keywords">Search Keywords</Label>
                    <Input
                      id="discovery-keywords"
                      placeholder="e.g., plastic injection molding"
                      value={discoveryKeywords}
                      onChange={(e) => setDiscoveryKeywords(e.target.value)}
                      data-testid="input-keywords"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="discovery-location">Location (optional)</Label>
                    <Input
                      id="discovery-location"
                      placeholder="e.g., Shenzhen, China"
                      value={discoveryLocation}
                      onChange={(e) => setDiscoveryLocation(e.target.value)}
                      data-testid="input-location"
                    />
                  </div>
                  <div className="space-y-2 flex items-end">
                    <Button
                      onClick={() => runDiscoveryMutation.mutate({
                        agentId: selectedAgentId,
                        keywords: discoveryKeywords,
                        location: discoveryLocation || undefined,
                      })}
                      disabled={!selectedAgentId || !discoveryKeywords || discoveryJob.isRunning || runDiscoveryMutation.isPending}
                      className="w-full"
                      data-testid="button-run-discovery"
                    >
                      {discoveryJob.isRunning || runDiscoveryMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Searching...
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4 mr-2" />
                          Run Discovery
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>}

          {/* Hidden for V1 - Leads Table */}
          {false && <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Supplier Leads
                </CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search leads..."
                      value={leadSearchQuery}
                      onChange={(e) => setLeadSearchQuery(e.target.value)}
                      className="pl-9 w-64"
                      data-testid="input-search-leads"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => refetchLeads()}
                    data-testid="button-refresh-leads"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingLeads ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredLeads.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No supplier leads yet</p>
                  <p className="text-sm text-muted-foreground">
                    Run a discovery search to find potential suppliers
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/50 sticky top-0 z-10">
                      <tr>
                        <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Name</th>
                        <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Company</th>
                        <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Contact</th>
                        <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Location</th>
                        <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Source</th>
                        <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Status</th>
                        <th className="h-11 px-3 text-center font-medium text-muted-foreground whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeads.map((lead) => (
                        <tr key={lead.id} className="h-11 border-b hover-elevate" data-testid={`row-lead-${lead.id}`}>
                          <td className="px-3 text-sm whitespace-nowrap">{lead.name}</td>
                          <td className="px-3 text-sm whitespace-nowrap">{lead.companyName || '-'}</td>
                          <td className="px-3 text-sm whitespace-nowrap">
                            <div className="flex flex-col gap-1">
                              {lead.contactEmail && (
                                <div className="flex items-center gap-1 text-xs">
                                  <Mail className="h-3 w-3" />
                                  <a href={`mailto:${lead.contactEmail}`} className="text-primary hover:underline">
                                    {lead.contactEmail}
                                  </a>
                                </div>
                              )}
                              {lead.contactPhone && (
                                <div className="flex items-center gap-1 text-xs">
                                  <Phone className="h-3 w-3" />
                                  <span>{lead.contactPhone}</span>
                                </div>
                              )}
                              {!lead.contactEmail && !lead.contactPhone && '-'}
                            </div>
                          </td>
                          <td className="px-3 text-sm whitespace-nowrap">{lead.location || '-'}</td>
                          <td className="px-3 whitespace-nowrap">
                            <Badge variant="outline" className="text-xs">
                              {lead.source?.replace('PHANTOMBUSTER_', '') || 'MANUAL'}
                            </Badge>
                          </td>
                          <td className="px-3 whitespace-nowrap">
                            <Badge
                              variant={
                                lead.status === 'CONVERTED' ? 'default' :
                                lead.status === 'CONTACTED' ? 'secondary' :
                                lead.status === 'REJECTED' ? 'destructive' :
                                'outline'
                              }
                              className="text-xs"
                            >
                              {lead.status}
                            </Badge>
                          </td>
                          <td className="px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {lead.websiteUrl && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => window.open(lead.websiteUrl!, '_blank')}
                                  title="Visit website"
                                  data-testid={`button-visit-${lead.id}`}
                                >
                                  <Globe className="h-4 w-4" />
                                </Button>
                              )}
                              {lead.status !== 'CONVERTED' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => convertLeadMutation.mutate(lead.id)}
                                  disabled={convertLeadMutation.isPending}
                                  title="Convert to supplier"
                                  data-testid={`button-convert-${lead.id}`}
                                >
                                  <UserPlus className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>}
        </TabsContent>
      </Tabs>

      {/* PO Detail Dialog */}
      <Dialog open={!!selectedPO} onOpenChange={() => setSelectedPO(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Purchase Order {selectedPOData?.poNumber}
            </DialogTitle>
            <DialogDescription>
              Supplier: {suppliers.find(s => s.id === selectedPOData?.supplierId)?.name || 'Unknown'}
            </DialogDescription>
          </DialogHeader>
          
          {selectedPOData && (
            <div className="space-y-4">
              {/* Status and Dates */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge>{selectedPOData.status.replace('_', ' ')}</Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Order Date</Label>
                  <div className="mt-1 text-sm">
                    {selectedPOData.orderDate ? new Date(selectedPOData.orderDate).toLocaleDateString() : '-'}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Expected Date</Label>
                  <div className="mt-1 text-sm">
                    {selectedPOData.expectedDate ? new Date(selectedPOData.expectedDate).toLocaleDateString() : '-'}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Received Date</Label>
                  <div className="mt-1 text-sm">
                    {selectedPOData.receivedAt ? new Date(selectedPOData.receivedAt).toLocaleDateString() : '-'}
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div>
                <h3 className="text-sm font-semibold mb-2">PO Line Items</h3>
                <div className="border rounded-md overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0 z-10">
                      <tr>
                        <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Item</th>
                        <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">AI Suggested</th>
                        <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Ordered</th>
                        <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Received</th>
                        <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Remaining</th>
                        <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Unit Cost</th>
                        <th className="h-11 px-3 text-center font-medium text-muted-foreground whitespace-nowrap">Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPOData.lines.map(line => {
                        const item = items.find(i => i.id === line.itemId);
                        const remaining = line.qtyOrdered - line.qtyReceived;
                        const aiSuggested = line.recommendedQtyAtOrderTime;
                        // Use finalOrderedQty if available, otherwise fall back to qtyOrdered
                        const ordered = line.finalOrderedQty !== null && line.finalOrderedQty !== undefined 
                          ? line.finalOrderedQty 
                          : line.qtyOrdered;
                        let decisionStatus = 'NONE';
                        let decisionVariant: 'default' | 'secondary' | 'destructive' | 'outline' = 'outline';
                        
                        if (aiSuggested !== null && aiSuggested !== undefined) {
                          if (ordered === aiSuggested) {
                            decisionStatus = 'ACCEPTED';
                            decisionVariant = 'default';
                          } else if (ordered > aiSuggested) {
                            decisionStatus = 'INCREASED';
                            decisionVariant = 'secondary';
                          } else if (ordered < aiSuggested && ordered > 0) {
                            decisionStatus = 'REDUCED';
                            decisionVariant = 'secondary';
                          } else if (ordered === 0) {
                            decisionStatus = 'IGNORED';
                            decisionVariant = 'destructive';
                          }
                        }
                        
                        return (
                          <tr key={line.id} className="h-11 border-b hover-elevate">
                            <td className="px-3 whitespace-nowrap">{item?.name || 'Unknown'}</td>
                            <td className="px-3 text-right whitespace-nowrap">
                              {aiSuggested !== null && aiSuggested !== undefined ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Brain className="h-3 w-3 text-primary" />
                                  <span>{aiSuggested}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-3 text-right font-medium whitespace-nowrap">{ordered}</td>
                            <td className="px-3 text-right whitespace-nowrap">{line.qtyReceived}</td>
                            <td className="px-3 text-right whitespace-nowrap">{remaining}</td>
                            <td className="px-3 text-right whitespace-nowrap">
                              ${line.unitCost?.toFixed(2) || '0.00'}
                            </td>
                            <td className="px-3 text-center">
                              <Badge variant={decisionVariant} className="text-xs">
                                {decisionStatus}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Notes */}
              {selectedPOData.notes && (
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{selectedPOData.notes}</p>
                </div>
              )}

              {/* QuickBooks Bill Status */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Receipt className="h-4 w-4" />
                      QuickBooks Bill
                    </Label>
                  </div>
                  {selectedPOBill?.hasBill ? (
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          Bill #{selectedPOBill.billNumber || selectedPOBill.billId}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant={
                            selectedPOBill.status === 'PAID' ? 'default' : 
                            selectedPOBill.status === 'ERROR' ? 'destructive' : 'secondary'
                          }>
                            {selectedPOBill.status}
                          </Badge>
                          {selectedPOBill.totalAmount && (
                            <span>${selectedPOBill.totalAmount.toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => createBillMutation.mutate(selectedPOData.id)}
                      disabled={createBillMutation.isPending || !['RECEIVED', 'CLOSED'].includes(selectedPOData.status)}
                      data-testid="button-create-qb-bill"
                    >
                      {createBillMutation.isPending ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-2" />
                          Create Bill in QB
                        </>
                      )}
                    </Button>
                  )}
                </div>
                {!['RECEIVED', 'CLOSED'].includes(selectedPOData.status) && !selectedPOBill?.hasBill && (
                  <p className="text-xs text-muted-foreground mt-1">
                    PO must be Received or Closed to create a bill
                  </p>
                )}
              </div>

              {/* Actions */}
              <DialogFooter className="gap-2">
                {selectedPOData.status === 'APPROVAL_PENDING' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const reason = prompt("Reason for rejection:");
                        if (reason) rejectPOMutation.mutate({ id: selectedPOData.id, reason });
                      }}
                      data-testid="button-reject-po"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Reject
                    </Button>
                    <Button
                      onClick={() => approvePOMutation.mutate(selectedPOData.id)}
                      data-testid="button-approve-po"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Approve
                    </Button>
                  </>
                )}
                
                {selectedPOData.status === 'APPROVED' && (
                  <Button
                    onClick={() => sendPOMutation.mutate(selectedPOData.id)}
                    data-testid="button-send-po"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Mark Sent
                  </Button>
                )}
                
                {['SENT', 'PARTIAL_RECEIVED'].includes(selectedPOData.status) && (
                  <Button
                    onClick={() => {
                      setShowReceiveDialog(true);
                    }}
                    data-testid="button-receive-po"
                  >
                    <Truck className="h-4 w-4 mr-2" />
                    Receive Items
                  </Button>
                )}
                
                {selectedPOData.status === 'RECEIVED' && (
                  <Button
                    onClick={() => closePOMutation.mutate(selectedPOData.id)}
                    data-testid="button-close-po"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Close PO
                  </Button>
                )}
                
                {!['RECEIVED', 'CLOSED', 'CANCELLED'].includes(selectedPOData.status) && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      const reason = prompt("Reason for cancellation:");
                      if (reason) cancelPOMutation.mutate({ id: selectedPOData.id, reason });
                    }}
                    data-testid="button-cancel-po"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk Confirm Receipt Dialog */}
      <Dialog open={!!showConfirmDialog} onOpenChange={() => setShowConfirmDialog(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Confirm Full Receipt</DialogTitle>
            <DialogDescription>
              {confirmPOData && (
                <span>
                  Supplier: {suppliers.find(s => s.id === confirmPOData.supplierId)?.name || 'Unknown'}
                  {' • '}
                  PO: {confirmPOData.poNumber}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {confirmPOData && (
            <div className="space-y-4">
              {/* PO Metadata */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">Order Date</Label>
                  <div>{confirmPOData.orderDate ? new Date(confirmPOData.orderDate).toLocaleDateString() : '-'}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Expected Date</Label>
                  <div>{confirmPOData.expectedDate ? new Date(confirmPOData.expectedDate).toLocaleDateString() : '-'}</div>
                </div>
              </div>

              {/* Line Items Summary */}
              <div>
                <Label className="text-sm font-medium mb-2 block">Line Items to Receive</Label>
                <div className="border rounded-md">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr className="border-b">
                        <th className="text-left p-2 text-xs font-medium">Item</th>
                        <th className="text-right p-2 text-xs font-medium">Qty Ordered</th>
                        <th className="text-right p-2 text-xs font-medium">Already Received</th>
                        <th className="text-right p-2 text-xs font-medium">Will Receive</th>
                      </tr>
                    </thead>
                    <tbody>
                      {confirmPOData.lines && confirmPOData.lines.map(line => {
                        const item = items.find(i => i.id === line.itemId);
                        const remaining = line.qtyOrdered - line.qtyReceived;
                        return (
                          <tr key={line.id} className="border-b last:border-0">
                            <td className="p-2 text-sm">{item?.name || 'Unknown'}</td>
                            <td className="p-2 text-sm text-right">{line.qtyOrdered}</td>
                            <td className="p-2 text-sm text-right">{line.qtyReceived}</td>
                            <td className="p-2 text-sm text-right font-medium">{remaining}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Confirmation Question */}
              <div className="bg-muted/50 border rounded-md p-3 text-sm">
                <p className="font-medium">Do you want to mark this PO as fully received and update inventory based on all ordered quantities?</p>
                <p className="text-muted-foreground text-xs mt-1">This will create RECEIVE transactions for all remaining quantities.</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (showConfirmDialog) {
                  bulkConfirmReceiptMutation.mutate(showConfirmDialog);
                }
              }}
              disabled={bulkConfirmReceiptMutation.isPending}
              data-testid="button-confirm-bulk-receipt"
            >
              {bulkConfirmReceiptMutation.isPending ? "Confirming..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Open Dispute Dialog */}
      <Dialog open={!!showOpenDisputeDialog} onOpenChange={() => {
        setShowOpenDisputeDialog(null);
        setDisputeReason("");
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Open Dispute</DialogTitle>
            <DialogDescription>
              {disputePOData && showOpenDisputeDialog === disputePOData.id && (
                <span>
                  Supplier: {suppliers.find(s => s.id === disputePOData.supplierId)?.name || 'Unknown'}
                  {' • '}
                  PO: {disputePOData.poNumber}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {disputePOData && showOpenDisputeDialog === disputePOData.id && (
            <div className="space-y-4">
              {/* PO Metadata */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">Order Date</Label>
                  <div>{disputePOData.orderDate ? new Date(disputePOData.orderDate).toLocaleDateString() : '-'}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Expected Date</Label>
                  <div>{disputePOData.expectedDate ? new Date(disputePOData.expectedDate).toLocaleDateString() : '-'}</div>
                </div>
              </div>

              {/* Reason for Dispute */}
              <div className="space-y-2">
                <Label htmlFor="dispute-reason">Reason for Dispute</Label>
                <Textarea
                  id="dispute-reason"
                  placeholder="Describe the issue with this order (e.g., late delivery, damaged items, quantity mismatch, etc.)"
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  rows={4}
                  data-testid="textarea-dispute-reason"
                />
              </div>

              <div className="bg-muted/50 border rounded-md p-3 text-sm">
                <p className="text-muted-foreground text-xs">
                  Opening a dispute will notify the GHL team for manual review and mark this PO as needing attention.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowOpenDisputeDialog(null);
              setDisputeReason("");
            }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (showOpenDisputeDialog) {
                  toggleDisputeMutation.mutate({ 
                    id: showOpenDisputeDialog, 
                    action: 'open',
                    reason: disputeReason || 'No specific reason provided' 
                  });
                }
              }}
              disabled={toggleDisputeMutation.isPending}
              data-testid="button-confirm-open-dispute"
            >
              {toggleDisputeMutation.isPending ? "Opening..." : "Open Dispute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Dispute Dialog */}
      <Dialog open={!!showResolveDisputeDialog} onOpenChange={() => {
        setShowResolveDisputeDialog(null);
        setResolutionNotes("");
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Resolve Dispute</DialogTitle>
            <DialogDescription>
              {disputePOData && showResolveDisputeDialog === disputePOData.id && (
                <span>
                  Supplier: {suppliers.find(s => s.id === disputePOData.supplierId)?.name || 'Unknown'}
                  {' • '}
                  PO: {disputePOData.poNumber}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {disputePOData && showResolveDisputeDialog === disputePOData.id && (
            <div className="space-y-4">
              {/* PO Metadata */}
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">Order Date</Label>
                  <div>{disputePOData.orderDate ? new Date(disputePOData.orderDate).toLocaleDateString() : '-'}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Expected Date</Label>
                  <div>{disputePOData.expectedDate ? new Date(disputePOData.expectedDate).toLocaleDateString() : '-'}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Dispute Opened</Label>
                  <div>{disputePOData.issueOpenedAt ? new Date(disputePOData.issueOpenedAt).toLocaleDateString() : '-'}</div>
                </div>
              </div>

              {/* Original Dispute Reason */}
              {disputePOData.issueNotes && (
                <div className="space-y-2">
                  <Label>Original Dispute Reason</Label>
                  <div className="bg-muted/50 border rounded-md p-3 text-sm">
                    {disputePOData.issueNotes}
                  </div>
                </div>
              )}

              {/* Resolution Notes */}
              <div className="space-y-2">
                <Label htmlFor="resolution-notes">Resolution Notes</Label>
                <Textarea
                  id="resolution-notes"
                  placeholder="Describe how the dispute was resolved (e.g., refund issued, replacement sent, etc.)"
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  rows={4}
                  data-testid="textarea-resolution-notes"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowResolveDisputeDialog(null);
              setResolutionNotes("");
            }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (showResolveDisputeDialog) {
                  toggleDisputeMutation.mutate({ 
                    id: showResolveDisputeDialog, 
                    action: 'resolve',
                    resolutionNotes: resolutionNotes || 'Marked as resolved without specific notes' 
                  });
                }
              }}
              disabled={toggleDisputeMutation.isPending}
              data-testid="button-confirm-resolve-dispute"
            >
              {toggleDisputeMutation.isPending ? "Resolving..." : "Mark Resolved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive Items Dialog */}
      <ReceiveItemsDialog
        open={showReceiveDialog}
        onOpenChange={setShowReceiveDialog}
        poId={selectedPO}
        poData={selectedPOData}
        items={items}
      />

      {/* Create PO Sheet */}
      <CreatePOSheet
        open={showCreatePOSheet}
        onOpenChange={setShowCreatePOSheet}
      />
    </div>
  );
}

// Receiving Dialog Component
function ReceiveItemsDialog({
  open,
  onOpenChange,
  poId,
  poData,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poId: string | null;
  poData?: PurchaseOrder & { lines: PurchaseOrderLine[] };
  items: Item[];
}) {
  const { toast } = useToast();
  const [lineReceipts, setLineReceipts] = useState<Record<string, number>>({});

  const receiveMutation = useMutation({
    mutationFn: async (receipts: { lineId: string; qtyReceived: number }[]) => {
      if (!poId) throw new Error("No PO selected");
      const res = await apiRequest("POST", `/api/purchase-orders/${poId}/receive`, {
        lineReceipts: receipts,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to receive items");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/items'] });
      toast({ title: "Items received successfully" });
      setLineReceipts({});
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to receive items", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const handleReceive = () => {
    const receipts = Object.entries(lineReceipts)
      .filter(([, qty]) => qty > 0)
      .map(([lineId, qtyReceived]) => ({ lineId, qtyReceived }));

    if (receipts.length === 0) {
      toast({ title: "No quantities entered", variant: "destructive" });
      return;
    }

    receiveMutation.mutate(receipts);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Receive Items</DialogTitle>
          <DialogDescription>
            Enter the quantities received for each line item
          </DialogDescription>
        </DialogHeader>

        {poData && (
          <div className="space-y-4">
            <div className="border rounded-md">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr className="border-b">
                    <th className="text-left p-2 text-xs font-medium">Item</th>
                    <th className="text-right p-2 text-xs font-medium">Ordered</th>
                    <th className="text-right p-2 text-xs font-medium">Already Received</th>
                    <th className="text-right p-2 text-xs font-medium">Remaining</th>
                    <th className="text-right p-2 text-xs font-medium">Receive Now</th>
                  </tr>
                </thead>
                <tbody>
                  {poData.lines.map(line => {
                    const item = items.find(i => i.id === line.itemId);
                    const remaining = line.qtyOrdered - line.qtyReceived;
                    return (
                      <tr key={line.id} className="border-b">
                        <td className="p-2 text-sm">{item?.name || 'Unknown'}</td>
                        <td className="p-2 text-sm text-right">{line.qtyOrdered}</td>
                        <td className="p-2 text-sm text-right">{line.qtyReceived}</td>
                        <td className="p-2 text-sm text-right font-medium">{remaining}</td>
                        <td className="p-2">
                          <Input
                            type="number"
                            min="0"
                            max={remaining}
                            defaultValue={remaining}
                            onChange={(e) => {
                              const qty = parseInt(e.target.value) || 0;
                              setLineReceipts(prev => ({ ...prev, [line.id]: qty }));
                            }}
                            className="w-20 text-right"
                            data-testid={`input-receive-qty-${line.id}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleReceive}
                disabled={receiveMutation.isPending}
                data-testid="button-confirm-receive"
              >
                {receiveMutation.isPending ? "Receiving..." : "Confirm Receipt"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
