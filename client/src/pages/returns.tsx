import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Package, ExternalLink, PackageCheck, Receipt, Check, Calendar, History, Zap, Archive, Download, Upload, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { format, subDays } from "date-fns";

interface ReturnRequest {
  id: string;
  externalOrderId: string;
  salesChannel: string;
  salesOrderId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  ghlContactId: string | null;
  status: string;
  resolutionRequested: string;
  resolutionFinal: string | null;
  reason: string | null;
  initiatedVia: string;
  labelProvider: string;
  receiptPrintedAt: string | null;
  receiptPrintCount: number;
  createdAt: string;
  updatedAt: string;
  quickbooksRefundId: string | null;
  quickbooksRefundType: string | null;
  quickbooksRefundCreatedAt: string | null;
}

interface ReturnItem {
  id: string;
  returnRequestId: string;
  salesOrderLineId: string | null;
  inventoryItemId: string;
  sku: string;
  qtyOrdered: number;
  qtyRequested: number;
  qtyApproved: number;
  qtyReceived: number;
  itemReason: string | null;
  disposition: string | null;
  notes: string | null;
}

interface ReturnShipment {
  id: string;
  returnRequestId: string;
  carrier: string;
  trackingNumber: string;
  labelUrl: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface ReturnDetails {
  returnRequest: ReturnRequest;
  items: ReturnItem[];
  shipments: ReturnShipment[];
}

export default function Returns() {
  const { toast } = useToast();
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const [issuingLabelForId, setIssuingLabelForId] = useState<string | null>(null);
  const [showReceiptModalId, setShowReceiptModalId] = useState<string | null>(null);
  const [showConfirmReceiveId, setShowConfirmReceiveId] = useState<string | null>(null);
  
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

  const { data: returns, isLoading } = useQuery<ReturnRequest[]>({
    queryKey: ["/api/returns", viewParam, historyStartDate?.toISOString(), historyEndDate?.toISOString()],
    queryFn: async () => {
      const res = await fetch(`/api/returns?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch returns");
      return res.json();
    },
  });

  const { data: returnDetails } = useQuery<ReturnDetails>({
    queryKey: selectedReturnId ? [`/api/returns/${selectedReturnId}`] : [],
    enabled: !!selectedReturnId,
  });

  const { data: receiptDetails } = useQuery<ReturnDetails>({
    queryKey: showReceiptModalId ? [`/api/returns/${showReceiptModalId}`] : [],
    enabled: !!showReceiptModalId,
  });

  const { data: confirmReceiveDetails } = useQuery<ReturnDetails>({
    queryKey: showConfirmReceiveId ? [`/api/returns/${showConfirmReceiveId}`] : [],
    enabled: !!showConfirmReceiveId,
  });

  const issueLabelMutation = useMutation({
    mutationFn: async (returnId: string) => {
      setIssuingLabelForId(returnId);
      try {
        const res = await apiRequest("POST", `/api/returns/${returnId}/label`, {});
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      } finally {
        setIssuingLabelForId(null);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/returns"] });
      if (selectedReturnId) {
        queryClient.invalidateQueries({ queryKey: [`/api/returns/${selectedReturnId}`] });
      }
      toast({ title: "Return label issued successfully" });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to issue label",
        description: error.message,
      });
    },
  });

  const printReceiptMutation = useMutation({
    mutationFn: async (returnId: string) => {
      const res = await apiRequest("POST", `/api/returns/${returnId}/print-receipt`, {});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/returns"] });
      if (showReceiptModalId) {
        queryClient.invalidateQueries({ queryKey: [`/api/returns/${showReceiptModalId}`] });
      }
      window.print();
      toast({ title: "Receipt print tracked" });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to print receipt",
        description: error.message,
      });
    },
  });

  const postToQuickBooksMutation = useMutation({
    mutationFn: async (returnId: string) => {
      const res = await apiRequest("POST", `/api/returns/${returnId}/post-to-quickbooks`, {});
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to post to QuickBooks");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/returns"] });
      if (selectedReturnId) {
        queryClient.invalidateQueries({ queryKey: [`/api/returns/${selectedReturnId}`] });
      }
      const amount = typeof data.totalAmount === 'number' ? `$${data.totalAmount.toFixed(2)}` : '';
      toast({ 
        title: "Posted to QuickBooks", 
        description: `Credit Memo ${data.quickbooksRefundNumber || data.quickbooksRefundId} created${amount ? ` (${amount})` : ''}` 
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to post to QuickBooks",
        description: error.message,
      });
    },
  });

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'OPEN':
        return 'default';
      case 'LABEL_CREATED':
      case 'LABEL_ISSUED': // Legacy status
      case 'IN_TRANSIT':
        return 'secondary';
      case 'RECEIVED': // Legacy status
      case 'RECEIVED_AT_WAREHOUSE':
      case 'COMPLETED':
        return 'default';
      case 'CANCELLED':
        return 'outline';
      default:
        return 'default';
    }
  };

  const getResolutionColor = (resolution: string) => {
    switch (resolution) {
      case 'REFUND':
        return 'text-red-600 dark:text-red-400';
      case 'REPLACEMENT':
        return 'text-blue-600 dark:text-blue-400';
      case 'STORE_CREDIT':
        return 'text-green-600 dark:text-green-400';
      default:
        return '';
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Return Requests Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Return Requests</h1>
          <p className="text-sm text-muted-foreground">Track and process customer returns</p>
        </div>
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
      </div>

      {/* History Date Range Filter */}
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
                  {returns?.length || 0} archived records
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        const csvContent = [
                          ['Order ID', 'Channel', 'Source', 'Customer', 'Email', 'Status', 'Resolution', 'Reason', 'Created', 'QuickBooks Refund'].join(','),
                          ...(returns || []).map(r => [
                            r.externalOrderId,
                            r.salesChannel,
                            r.initiatedVia,
                            r.customerName,
                            r.customerEmail || '',
                            r.status,
                            r.resolutionFinal || r.resolutionRequested,
                            r.reason || '',
                            format(new Date(r.createdAt), 'yyyy-MM-dd'),
                            r.quickbooksRefundId || ''
                          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
                        ].join('\n');
                        const blob = new Blob([csvContent], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `returns-history-${format(new Date(), 'yyyy-MM-dd')}.csv`;
                        a.click();
                      }}
                      data-testid="button-export-csv-history"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Export
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export returns to CSV</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Return Requests Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            </div>
          ) : !returns || returns.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2">
              <Package className="h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {activeTab === "live" ? "No return requests yet" : "No archived returns found"}
              </p>
              {activeTab === "history" && (
                <p className="text-xs text-muted-foreground">
                  Try adjusting the date range or check back later
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-end px-4 pt-4">
                <Badge variant="secondary" className="text-sm font-medium" data-testid="badge-total-returns">
                  {returns.length} {returns.length === 1 ? 'return' : 'returns'}
                </Badge>
              </div>
              <div className="overflow-auto max-h-[calc(100vh-360px)] rounded-md">
              <table className="w-full table-auto">
                <thead className="bg-muted sticky top-0 z-10">
                  <tr className="border-b">
                    <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Order ID</th>
                    <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Channel</th>
                    <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Source</th>
                    <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Customer</th>
                    <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Status</th>
                    <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Resolution</th>
                    <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">Created</th>
                    <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px sticky right-0 z-10 bg-muted shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
                  </tr>
                </thead>
              <tbody>
                {returns.map((returnRequest) => (
                  <tr
                    key={returnRequest.id}
                    className="h-11 border-b hover-elevate cursor-pointer"
                    onClick={() => setSelectedReturnId(returnRequest.id)}
                    data-testid={`row-return-${returnRequest.id}`}
                  >
                    <td className="px-3 align-middle font-medium whitespace-nowrap">
                      {returnRequest.externalOrderId}
                    </td>
                    <td className="px-3 align-middle whitespace-nowrap">
                      <Badge variant="outline">{returnRequest.salesChannel}</Badge>
                    </td>
                    <td className="px-3 align-middle whitespace-nowrap">
                      <Badge variant={returnRequest.initiatedVia === 'GHL_BOT' ? 'default' : 'secondary'}>
                        {returnRequest.initiatedVia === 'GHL_BOT' ? 'GHL Bot' : 'Manual'}
                      </Badge>
                    </td>
                    <td className="px-3 align-middle whitespace-nowrap">{returnRequest.customerName}</td>
                    <td className="px-3 align-middle whitespace-nowrap">
                      <Badge variant={getStatusBadgeVariant(returnRequest.status)}>
                        {returnRequest.status.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="px-3 align-middle whitespace-nowrap">
                      <span className={getResolutionColor(returnRequest.resolutionRequested)}>
                        {returnRequest.resolutionFinal || returnRequest.resolutionRequested}
                      </span>
                    </td>
                    <td className="px-3 align-middle whitespace-nowrap">
                      {format(new Date(returnRequest.createdAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-3 align-middle text-right whitespace-nowrap sticky right-0 z-10 bg-card shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">
                      <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                        <TooltipProvider>
                          {/* Receipt Icon - Always visible */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => setShowReceiptModalId(returnRequest.id)}
                                data-testid={`button-receipt-${returnRequest.id}`}
                              >
                                <Receipt className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View Return Receipt</TooltipContent>
                          </Tooltip>

                          {/* Issue Label Icon - Only for OPEN status */}
                          {returnRequest.status === 'OPEN' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => issueLabelMutation.mutate(returnRequest.id)}
                                  disabled={issuingLabelForId === returnRequest.id}
                                  data-testid={`button-issue-label-${returnRequest.id}`}
                                >
                                  <Package className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Issue Return Label</TooltipContent>
                            </Tooltip>
                          )}

                          {/* View Label Icon - For statuses with label created */}
                          {['LABEL_CREATED', 'LABEL_ISSUED', 'IN_TRANSIT', 'RECEIVED', 'RECEIVED_AT_WAREHOUSE', 'COMPLETED'].includes(returnRequest.status) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => setSelectedReturnId(returnRequest.id)}
                                  data-testid={`button-view-label-${returnRequest.id}`}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View Shipping Label</TooltipContent>
                            </Tooltip>
                          )}

                          {/* Checkmark Icon - Grey when not received, Green when received */}
                          {['OPEN', 'LABEL_CREATED', 'LABEL_ISSUED', 'IN_TRANSIT'].includes(returnRequest.status) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => setShowConfirmReceiveId(returnRequest.id)}
                                  data-testid={`button-receive-${returnRequest.id}`}
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Mark as Received</TooltipContent>
                            </Tooltip>
                          ) : ['RECEIVED', 'RECEIVED_AT_WAREHOUSE', 'COMPLETED'].includes(returnRequest.status) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  disabled
                                  data-testid={`button-receive-${returnRequest.id}`}
                                >
                                  <Check className="h-4 w-4 text-green-600" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Return already received</TooltipContent>
                            </Tooltip>
                          ) : null}
                        </TooltipProvider>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedReturnId && returnDetails && (
        <ReturnDetailsModal
          returnDetails={returnDetails}
          onClose={() => setSelectedReturnId(null)}
          onIssueLabel={() => issueLabelMutation.mutate(selectedReturnId)}
          isIssuingLabel={issueLabelMutation.isPending}
          onPostToQuickBooks={() => postToQuickBooksMutation.mutate(selectedReturnId!)}
          isPostingToQuickBooks={postToQuickBooksMutation.isPending}
        />
      )}

      {showReceiptModalId && receiptDetails && (
        <ReturnReceiptModal
          returnDetails={receiptDetails}
          onClose={() => setShowReceiptModalId(null)}
          onPrintReceipt={() => printReceiptMutation.mutate(showReceiptModalId)}
          isPrinting={printReceiptMutation.isPending}
        />
      )}

      {showConfirmReceiveId && confirmReceiveDetails && (
        <ConfirmReturnReceiptModal
          returnDetails={confirmReceiveDetails}
          onClose={() => setShowConfirmReceiveId(null)}
          onSuccess={() => setShowConfirmReceiveId(null)}
        />
      )}
    </div>
  );
}

interface ReturnDetailsModalProps {
  returnDetails: ReturnDetails;
  onClose: () => void;
  onIssueLabel: () => void;
  isIssuingLabel: boolean;
  onPostToQuickBooks: () => void;
  isPostingToQuickBooks: boolean;
}

function ReturnDetailsModal({
  returnDetails,
  onClose,
  onIssueLabel,
  isIssuingLabel,
  onPostToQuickBooks,
  isPostingToQuickBooks,
}: ReturnDetailsModalProps) {
  const { returnRequest, items, shipments } = returnDetails;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Return Request Details</DialogTitle>
          <DialogDescription>
            Order #{returnRequest.externalOrderId} · {returnRequest.customerName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground">Sales Channel</Label>
              <p className="font-medium">{returnRequest.salesChannel}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Status</Label>
              <div className="mt-1">
                <Badge>{returnRequest.status.replace(/_/g, ' ')}</Badge>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Initiated Via</Label>
              <div className="mt-1">
                <Badge variant={returnRequest.initiatedVia === 'GHL_BOT' ? 'default' : 'secondary'}>
                  {returnRequest.initiatedVia === 'GHL_BOT' ? 'GHL Bot' : 'Manual UI'}
                </Badge>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Label Provider</Label>
              <p className="font-medium">{returnRequest.labelProvider}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Resolution Requested</Label>
              <p className="font-medium">{returnRequest.resolutionRequested}</p>
            </div>
            {returnRequest.resolutionFinal && (
              <div>
                <Label className="text-muted-foreground">Final Resolution</Label>
                <p className="font-medium">{returnRequest.resolutionFinal}</p>
              </div>
            )}
          </div>

          {returnRequest.reason && (
            <div>
              <Label className="text-muted-foreground">Reason</Label>
              <p className="mt-1">{returnRequest.reason}</p>
            </div>
          )}

          <div>
            <h3 className="font-semibold mb-3">Return Items</h3>
            <div className="rounded-md border overflow-auto">
              <table className="w-full table-auto text-sm">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap w-px">SKU</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap w-px">Ordered</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap w-px">Requested</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap w-px">Approved</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap w-px">Received</th>
                    <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Reason</th>
                    <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Disposition</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="h-11 border-b hover-elevate">
                      <td className="px-3 font-medium whitespace-nowrap">{item.sku}</td>
                      <td className="px-3 text-right whitespace-nowrap">{item.qtyOrdered}</td>
                      <td className="px-3 text-right whitespace-nowrap">{item.qtyRequested}</td>
                      <td className="px-3 text-right whitespace-nowrap">{item.qtyApproved}</td>
                      <td className="px-3 text-right whitespace-nowrap">{item.qtyReceived}</td>
                      <td className="px-3 whitespace-nowrap">
                        {item.itemReason ? (
                          <span className="text-muted-foreground">{item.itemReason}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-3 whitespace-nowrap">
                        {item.disposition ? (
                          <Badge variant="outline">{item.disposition}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {shipments.length > 0 && (
            <div>
              <h3 className="font-semibold mb-3">Shipments</h3>
              <div className="space-y-2">
                {shipments.map((shipment) => (
                  <Card key={shipment.id}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <p className="font-medium">{shipment.carrier}</p>
                          <p className="text-sm text-muted-foreground">
                            Tracking: {shipment.trackingNumber}
                          </p>
                          <Badge variant="outline">{shipment.status.replace(/_/g, ' ')}</Badge>
                        </div>
                        <Button size="sm" variant="outline" asChild>
                          <a
                            href={shipment.labelUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="link-label"
                          >
                            <ExternalLink className="h-4 w-4 mr-1" />
                            View Label
                          </a>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* QuickBooks Info */}
          {returnRequest.quickbooksRefundId && (
            <div className="p-3 bg-green-50 dark:bg-green-950 rounded-md border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-800 dark:text-green-200">
                  Posted to QuickBooks
                </span>
              </div>
              <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                {returnRequest.quickbooksRefundType} #{returnRequest.quickbooksRefundId}
                {returnRequest.quickbooksRefundCreatedAt && (
                  <span> · {format(new Date(returnRequest.quickbooksRefundCreatedAt), 'MMM d, yyyy')}</span>
                )}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            {returnRequest.status === 'OPEN' && (
              <Button
                onClick={onIssueLabel}
                disabled={isIssuingLabel}
                data-testid="button-issue-label"
              >
                Issue Return Label
              </Button>
            )}
            {!returnRequest.quickbooksRefundId && ['RECEIVED_AT_WAREHOUSE', 'RETURNED', 'REFUND_ISSUE_PENDING', 'REFUNDED', 'CLOSED'].includes(returnRequest.status) && (
              <Button
                onClick={onPostToQuickBooks}
                disabled={isPostingToQuickBooks || isIssuingLabel}
                variant="outline"
                data-testid="button-post-to-quickbooks"
              >
                <Receipt className="h-4 w-4 mr-1" />
                {isPostingToQuickBooks ? 'Posting...' : 'Post to QuickBooks'}
              </Button>
            )}
            <Button variant="outline" onClick={onClose} data-testid="button-close">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ReturnReceiptModalProps {
  returnDetails: ReturnDetails;
  onClose: () => void;
  onPrintReceipt: () => void;
  isPrinting: boolean;
}

function ReturnReceiptModal({
  returnDetails,
  onClose,
  onPrintReceipt,
  isPrinting,
}: ReturnReceiptModalProps) {
  const { returnRequest, items, shipments } = returnDetails;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Return Receipt – {returnRequest.externalOrderId}</DialogTitle>
          <DialogDescription>
            Customer: {returnRequest.customerName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Order Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground">Order ID</Label>
              <p className="font-medium">{returnRequest.externalOrderId}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Channel</Label>
              <div className="mt-1">
                <Badge variant="outline">{returnRequest.salesChannel}</Badge>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Source</Label>
              <div className="mt-1">
                <Badge variant={returnRequest.initiatedVia === 'GHL_BOT' ? 'default' : 'secondary'}>
                  {returnRequest.initiatedVia === 'GHL_BOT' ? 'GHL Bot' : 'Manual'}
                </Badge>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Created</Label>
              <p className="font-medium">{format(new Date(returnRequest.createdAt), 'MMM d, yyyy')}</p>
            </div>
          </div>

          {/* Status Summary */}
          <div>
            <h3 className="font-semibold mb-3">Status Summary</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Current Status</Label>
                <div className="mt-1">
                  <Badge>{returnRequest.status.replace(/_/g, ' ')}</Badge>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Resolution</Label>
                <p className="font-medium">
                  {returnRequest.resolutionFinal || returnRequest.resolutionRequested}
                </p>
              </div>
              {shipments.length > 0 && (
                <>
                  <div>
                    <Label className="text-muted-foreground">Carrier</Label>
                    <p className="font-medium">{shipments[0].carrier}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Tracking</Label>
                    <p className="font-medium font-mono text-sm">{shipments[0].trackingNumber}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Line Items Table */}
          <div>
            <h3 className="font-semibold mb-3">Line Items</h3>
            <div className="rounded-md border overflow-auto">
              <table className="w-full table-auto text-sm">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap w-px">SKU</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap w-px">Qty Ordered</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap w-px">Qty Requested</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap w-px">Qty Received</th>
                    <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Disposition</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="h-11 border-b hover-elevate">
                      <td className="px-3 font-medium whitespace-nowrap">{item.sku}</td>
                      <td className="px-3 text-right whitespace-nowrap">{item.qtyOrdered}</td>
                      <td className="px-3 text-right whitespace-nowrap">{item.qtyRequested}</td>
                      <td className="px-3 text-right whitespace-nowrap">{item.qtyReceived}</td>
                      <td className="px-3 whitespace-nowrap">
                        {item.disposition ? (
                          <Badge variant="outline">{item.disposition}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Buttons */}
          <div className="flex justify-end gap-2">
            <Button
              onClick={onPrintReceipt}
              disabled={isPrinting}
              data-testid="button-print-receipt"
            >
              {returnRequest.receiptPrintCount === 0 ? 'Print Receipt' : 'Re-print Receipt'}
            </Button>
            <Button variant="outline" onClick={onClose} data-testid="button-close-receipt">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmReturnReceiptModalProps {
  returnDetails: ReturnDetails;
  onClose: () => void;
  onSuccess: () => void;
}

function ConfirmReturnReceiptModal({ 
  returnDetails, 
  onClose, 
  onSuccess 
}: ConfirmReturnReceiptModalProps) {
  const { toast } = useToast();
  const [condition, setCondition] = useState<'GOOD' | 'DAMAGED' | 'UNKNOWN'>('GOOD');
  const [disposition, setDisposition] = useState<'RESTOCK' | 'SCRAP' | 'INSPECT'>('RESTOCK');
  const [notes, setNotes] = useState('');
  const [applyDamageFee, setApplyDamageFee] = useState(false);
  
  // V1 Damage Fee Logic: 20% fee for damaged returns
  const DAMAGE_FEE_PERCENT = 0.20;
  const orderTotal = returnDetails.returnRequest.orderTotal || 0;
  const refundAmount = applyDamageFee 
    ? orderTotal * (1 - DAMAGE_FEE_PERCENT) 
    : orderTotal;

  const receiveMutation = useMutation({
    mutationFn: async () => {
      // V1: Properly separate physical condition from fee decision
      // isDamaged = physical inspection result (true if condition is DAMAGED)
      // applyDamageFee = whether to charge 20% restocking fee (user decision)
      const res = await apiRequest("POST", `/api/returns/${returnDetails.returnRequest.id}/receive`, {
        condition,
        disposition,
        notes,
        isDamaged: condition === 'DAMAGED', // Physical condition from inspection
        applyDamageFee, // Fee decision (can be overridden by user)
        refundAmount,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/returns"] });
      toast({ title: "Return received successfully" });
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to receive return",
        description: error.message,
      });
    },
  });

  // Update disposition and damage fee based on condition
  const handleConditionChange = (newCondition: 'GOOD' | 'DAMAGED' | 'UNKNOWN') => {
    setCondition(newCondition);
    if (newCondition === 'GOOD') {
      setDisposition('RESTOCK');
      setApplyDamageFee(false); // No fee for items in good condition
    } else if (newCondition === 'DAMAGED') {
      setDisposition('SCRAP');
      setApplyDamageFee(true); // Default to applying damage fee for damaged items
    } else {
      setDisposition('INSPECT');
      setApplyDamageFee(false); // No fee until inspected
    }
  };

  const { returnRequest, items } = returnDetails;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirm Return Receipt – {returnRequest.externalOrderId}</DialogTitle>
          <DialogDescription>
            Process incoming return and update inventory
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Order Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground">Order ID</Label>
              <p className="font-medium">{returnRequest.externalOrderId}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Channel</Label>
              <div className="mt-1">
                <Badge variant="outline">{returnRequest.salesChannel}</Badge>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Customer</Label>
              <p className="font-medium">{returnRequest.customerName}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Status</Label>
              <div className="mt-1">
                <Badge>{returnRequest.status.replace(/_/g, ' ')}</Badge>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Created</Label>
              <p className="font-medium">{format(new Date(returnRequest.createdAt), 'MMM d, yyyy')}</p>
            </div>
          </div>

          {/* Return Items */}
          <div>
            <h3 className="font-semibold mb-3">Items to Receive</h3>
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex justify-between items-center p-3 bg-muted/50 rounded-md">
                  <div>
                    <p className="font-medium">{item.sku}</p>
                    <p className="text-sm text-muted-foreground">
                      Qty to receive: {item.qtyApproved - item.qtyReceived}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Arrival Condition */}
          <div>
            <Label>Arrival Condition</Label>
            <Select 
              value={condition} 
              onValueChange={(value: any) => handleConditionChange(value)}
            >
              <SelectTrigger data-testid="select-condition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GOOD">Good Condition</SelectItem>
                <SelectItem value="DAMAGED">Damaged - Restock</SelectItem>
                <SelectItem value="DAMAGED">Damaged - Scrap</SelectItem>
                <SelectItem value="UNKNOWN">Inspect First</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Disposition */}
          <div>
            <Label>Disposition</Label>
            <Select value={disposition} onValueChange={(value: any) => setDisposition(value)}>
              <SelectTrigger data-testid="select-disposition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(condition === 'GOOD' || condition === 'DAMAGED') && (
                  <SelectItem value="RESTOCK">Restock (add back to inventory)</SelectItem>
                )}
                {condition === 'DAMAGED' && (
                  <SelectItem value="SCRAP">Scrap (damaged/unusable)</SelectItem>
                )}
                {condition === 'UNKNOWN' && (
                  <SelectItem value="INSPECT">Inspect (needs review)</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* V1: Damage Fee Decision Section */}
          {condition === 'DAMAGED' && (
            <div className="p-4 border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div className="flex-1">
                  <Label className="text-sm font-semibold">Damage Restocking Fee</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Apply a 20% restocking fee for damaged merchandise? This fee helps cover inspection and processing costs.
                  </p>
                  <div className="flex items-center gap-3 mt-3">
                    <Switch
                      checked={applyDamageFee}
                      onCheckedChange={setApplyDamageFee}
                      data-testid="switch-damage-fee"
                    />
                    <span className="text-sm font-medium">
                      {applyDamageFee ? 'Apply 20% restocking fee' : 'No fee (full refund)'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Refund Summary */}
          <div className="p-4 bg-muted/50 rounded-lg">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              Refund Summary
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Original Order Total</span>
                <span>${orderTotal.toFixed(2)}</span>
              </div>
              {applyDamageFee && (
                <div className="flex justify-between text-amber-600">
                  <span>Damage Fee (20%)</span>
                  <span>-${(orderTotal * DAMAGE_FEE_PERCENT).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t pt-2 mt-2">
                <span>Refund Amount</span>
                <span className={applyDamageFee ? 'text-amber-600' : 'text-green-600'}>
                  ${refundAmount.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about condition, damage, etc."
              data-testid="textarea-notes"
            />
          </div>

          {/* Bottom Buttons */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => receiveMutation.mutate()}
              disabled={receiveMutation.isPending}
              data-testid="button-mark-received"
            >
              {receiveMutation.isPending ? 'Processing...' : 'Mark Received & Process Refund'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
