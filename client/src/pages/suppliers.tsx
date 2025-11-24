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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { PurchaseOrder, SupplierLead, Supplier, Item, PurchaseOrderLine } from "@shared/schema";

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

export default function Suppliers() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("purchase-orders");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [selectedPO, setSelectedPO] = useState<string | null>(null);
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);

  const { data: poSummary } = useQuery<POSummary>({
    queryKey: ['/api/purchase-orders/summary'],
  });

  const { data: purchaseOrders = [], isLoading: isLoadingPOs } = useQuery<EnrichedPO[]>({
    queryKey: ['/api/purchase-orders'],
  });

  const { data: supplierLeads = [], isLoading: isLoadingLeads } = useQuery<SupplierLead[]>({
    queryKey: ['/api/supplier-leads'],
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

  // Calculate Active/Open count (SENT + PARTIAL_RECEIVED + APPROVAL_PENDING + APPROVED)
  const activeOpenCount = useMemo(() => {
    if (!poSummary) return 0;
    return poSummary.sent + poSummary.partialReceived + poSummary.approvalPending + poSummary.approved;
  }, [poSummary]);

  // Filter purchase orders
  const filteredPOs = purchaseOrders.filter(po => {
    const matchesSearch = 
      (po.poNumber?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      suppliers.find(s => s.id === po.supplierId)?.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || po.status === statusFilter;
    const matchesSupplier = supplierFilter === 'all' || po.supplierId === supplierFilter;

    return matchesSearch && matchesStatus && matchesSupplier;
  });

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

  const disputePOMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/purchase-orders/${id}/dispute`, { reason });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create dispute");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      toast({ title: "Dispute initiated - GHL team will be notified" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create dispute",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  return (
    <div className="container mx-auto py-6 space-y-6">
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
          </TabsTrigger>
        </TabsList>

        <TabsContent value="purchase-orders" className="space-y-4">
          {/* Summary Cards - 4 Compact Cards */}
          {poSummary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card data-testid="card-total">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total POs</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{poSummary.total}</div>
                </CardContent>
              </Card>
              <Card data-testid="card-draft">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Draft</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{poSummary.draft}</div>
                </CardContent>
              </Card>
              <Card data-testid="card-approval-pending">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Pending Approval</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{poSummary.approvalPending}</div>
                </CardContent>
              </Card>
              <Card data-testid="card-active">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Active / Open</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{activeOpenCount}</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* PO Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>Purchase Orders</CardTitle>
              <Button size="sm" data-testid="button-create-po">
                <Plus className="h-4 w-4 mr-2" />
                Create PO
              </Button>
            </CardHeader>
            <CardContent>
              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
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
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isLoadingPOs ? (
                <div className="text-center py-8 text-muted-foreground">Loading purchase orders...</div>
              ) : filteredPOs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {purchaseOrders.length === 0 
                    ? "No purchase orders yet. Create your first one to get started."
                    : "No purchase orders match your filters."}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium whitespace-nowrap">PO #</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Supplier</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Products Ordered</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Status</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Order Date</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Expected</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Received</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">Days to Receive</th>
                        <th className="text-left p-2 font-medium whitespace-nowrap">GHL Rep</th>
                        <th className="text-right p-2 font-medium whitespace-nowrap">Total</th>
                        <th className="text-right p-2 font-medium whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPOs.map((po) => {
                        const daysToReceive = getDaysToReceive(po.orderDate, po.receivedAt);
                        const orderTotal = getOrderTotal(po.lines);
                        return (
                          <tr key={po.id} className="border-b hover-elevate" data-testid={`row-po-${po.id}`}>
                            <td className="p-2">
                              <span className="font-mono text-sm font-medium">{po.poNumber}</span>
                            </td>
                            <td className="p-2 whitespace-nowrap">
                              {suppliers.find((s) => s.id === po.supplierId)?.name || 'Unknown'}
                            </td>
                            <td className="p-2">
                              <span className="text-sm max-w-xs truncate block" title={getProductsSummary(po.lines)}>
                                {getProductsSummary(po.lines)}
                              </span>
                            </td>
                            <td className="p-2">
                              <Badge variant={
                                po.status === 'RECEIVED' || po.status === 'CLOSED' ? 'default' :
                                po.status === 'SENT' || po.status === 'APPROVED' ? 'secondary' :
                                po.status === 'CANCELLED' ? 'destructive' :
                                'outline'
                              } data-testid={`badge-status-${po.id}`}>
                                {po.status.replace('_', ' ')}
                              </Badge>
                            </td>
                            <td className="p-2 text-sm whitespace-nowrap">
                              {po.orderDate ? new Date(po.orderDate).toLocaleDateString() : '-'}
                            </td>
                            <td className="p-2 text-sm whitespace-nowrap">
                              {po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : '-'}
                            </td>
                            <td className="p-2 text-sm whitespace-nowrap">
                              {po.receivedAt ? new Date(po.receivedAt).toLocaleDateString() : '-'}
                            </td>
                            <td className="p-2 text-sm whitespace-nowrap">
                              {daysToReceive !== null ? `${daysToReceive} days` : '-'}
                            </td>
                            <td className="p-2 text-sm whitespace-nowrap">
                              {po.ghlRepName || '-'}
                            </td>
                            <td className="p-2 text-sm text-right whitespace-nowrap font-medium">
                              ${orderTotal.toFixed(2)}
                            </td>
                            <td className="p-2 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1">
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  onClick={() => setSelectedPO(po.id)}
                                  data-testid={`button-view-po-${po.id}`}
                                >
                                  View
                                </Button>
                                {po.status === 'RECEIVED' && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => confirmReceiptMutation.mutate(po.id)}
                                    disabled={confirmReceiptMutation.isPending}
                                    data-testid={`button-confirm-receipt-${po.id}`}
                                    title="Confirm receipt and update stock"
                                  >
                                    <CheckCircle className="h-4 w-4" />
                                  </Button>
                                )}
                                {['SENT', 'PARTIAL_RECEIVED', 'RECEIVED'].includes(po.status) && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      const reason = prompt("Describe the issue with this PO:");
                                      if (reason) disputePOMutation.mutate({ id: po.id, reason });
                                    }}
                                    disabled={disputePOMutation.isPending}
                                    data-testid={`button-dispute-${po.id}`}
                                    title="Create dispute (GHL)"
                                  >
                                    <MessageSquare className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="discovery" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>Supplier Leads</CardTitle>
              <Button size="sm" data-testid="button-create-lead">
                <Plus className="h-4 w-4 mr-2" />
                Add Lead
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search leads..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-lead"
                  />
                </div>
              </div>

              {isLoadingLeads ? (
                <div className="text-center py-8 text-muted-foreground">Loading supplier leads...</div>
              ) : supplierLeads.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No supplier leads yet. Add your first lead to get started.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium">Name</th>
                        <th className="text-left p-2 font-medium">Website</th>
                        <th className="text-left p-2 font-medium">Source</th>
                        <th className="text-left p-2 font-medium">Status</th>
                        <th className="text-left p-2 font-medium">Category</th>
                        <th className="text-left p-2 font-medium">Last Contacted</th>
                        <th className="text-right p-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierLeads.map((lead) => (
                        <tr key={lead.id} className="border-b hover-elevate" data-testid={`row-lead-${lead.id}`}>
                          <td className="p-2 font-medium">{lead.name}</td>
                          <td className="p-2">
                            {lead.websiteUrl ? (
                              <a 
                                href={lead.websiteUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-primary hover:underline text-sm"
                              >
                                Visit
                              </a>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-2">
                            <Badge variant="outline" data-testid={`badge-source-${lead.id}`}>
                              {lead.source}
                            </Badge>
                          </td>
                          <td className="p-2">
                            <Badge variant={
                              lead.status === 'CONVERTED' ? 'default' :
                              lead.status === 'CONTACTED' ? 'secondary' :
                              'outline'
                            } data-testid={`badge-status-${lead.id}`}>
                              {lead.status}
                            </Badge>
                          </td>
                          <td className="p-2 text-sm">{lead.category || '-'}</td>
                          <td className="p-2 text-sm">
                            {lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleDateString() : '-'}
                          </td>
                          <td className="p-2 text-right">
                            <Button size="sm" variant="ghost" data-testid={`button-view-lead-${lead.id}`}>
                              View
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
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
                <Label className="text-sm font-medium">Line Items</Label>
                <div className="mt-2 border rounded-md">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr className="border-b">
                        <th className="text-left p-2 text-xs font-medium">Item</th>
                        <th className="text-right p-2 text-xs font-medium">Ordered</th>
                        <th className="text-right p-2 text-xs font-medium">Received</th>
                        <th className="text-right p-2 text-xs font-medium">Remaining</th>
                        <th className="text-right p-2 text-xs font-medium">Unit Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPOData.lines.map(line => {
                        const item = items.find(i => i.id === line.itemId);
                        const remaining = line.qtyOrdered - line.qtyReceived;
                        return (
                          <tr key={line.id} className="border-b">
                            <td className="p-2 text-sm">{item?.name || 'Unknown'}</td>
                            <td className="p-2 text-sm text-right">{line.qtyOrdered}</td>
                            <td className="p-2 text-sm text-right">{line.qtyReceived}</td>
                            <td className="p-2 text-sm text-right">{remaining}</td>
                            <td className="p-2 text-sm text-right">
                              ${line.unitCost?.toFixed(2) || '0.00'}
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

      {/* Receive Items Dialog */}
      <ReceiveItemsDialog
        open={showReceiveDialog}
        onOpenChange={setShowReceiveDialog}
        poId={selectedPO}
        poData={selectedPOData}
        items={items}
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
