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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Package, ExternalLink, PackageCheck } from "lucide-react";
import { format } from "date-fns";

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
  createdAt: string;
  updatedAt: string;
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
  const [showReceiveModal, setShowReceiveModal] = useState(false);

  const { data: returns, isLoading } = useQuery<ReturnRequest[]>({
    queryKey: ["/api/returns"],
  });

  const { data: returnDetails } = useQuery<ReturnDetails>({
    queryKey: selectedReturnId ? [`/api/returns/${selectedReturnId}`] : [],
    enabled: !!selectedReturnId,
  });

  const issueLabelMutation = useMutation({
    mutationFn: async (returnId: string) => {
      return await apiRequest("POST", `/api/returns/${returnId}/label`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/returns"] });
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

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'OPEN':
        return 'default';
      case 'LABEL_ISSUED':
      case 'IN_TRANSIT':
        return 'secondary';
      case 'RECEIVED':
      case 'REFUNDED':
      case 'REPLACED':
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
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Returns</h1>
          <p className="text-sm text-muted-foreground">
            Manage customer return requests and inventory restocking
          </p>
        </div>
      </div>

      {/* Return Requests Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Return Requests</h2>
            <p className="text-sm text-muted-foreground">Track and process customer returns</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          </div>
        ) : !returns || returns.length === 0 ? (
          <Card>
            <CardContent className="flex h-48 flex-col items-center justify-center gap-2">
              <Package className="h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No return requests yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="p-3 text-left text-sm font-medium">Order ID</th>
                  <th className="p-3 text-left text-sm font-medium">Channel</th>
                  <th className="p-3 text-left text-sm font-medium">Source</th>
                  <th className="p-3 text-left text-sm font-medium">Customer</th>
                  <th className="p-3 text-left text-sm font-medium">Status</th>
                  <th className="p-3 text-left text-sm font-medium">Resolution</th>
                  <th className="p-3 text-left text-sm font-medium">Created</th>
                  <th className="p-3 text-right text-sm font-medium">Actions</th>
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
                    <td className="px-3 align-middle font-medium">
                      {returnRequest.externalOrderId}
                    </td>
                    <td className="px-3 align-middle">
                      <Badge variant="outline">{returnRequest.salesChannel}</Badge>
                    </td>
                    <td className="px-3 align-middle">
                      <Badge variant={returnRequest.initiatedVia === 'GHL_BOT' ? 'default' : 'secondary'}>
                        {returnRequest.initiatedVia === 'GHL_BOT' ? 'GHL Bot' : 'Manual'}
                      </Badge>
                    </td>
                    <td className="px-3 align-middle">{returnRequest.customerName}</td>
                    <td className="px-3 align-middle">
                      <Badge variant={getStatusBadgeVariant(returnRequest.status)}>
                        {returnRequest.status.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="px-3 align-middle">
                      <span className={getResolutionColor(returnRequest.resolutionRequested)}>
                        {returnRequest.resolutionFinal || returnRequest.resolutionRequested}
                      </span>
                    </td>
                    <td className="px-3 align-middle">
                      {format(new Date(returnRequest.createdAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-3 align-middle text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedReturnId(returnRequest.id);
                          setShowReceiveModal(true);
                        }}
                        disabled={returnRequest.status === 'RECEIVED' || returnRequest.status === 'REFUNDED' || returnRequest.status === 'REPLACED'}
                        data-testid={`button-receive-${returnRequest.id}`}
                      >
                        <PackageCheck className="h-4 w-4 mr-1" />
                        Receive
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedReturnId && returnDetails && !showReceiveModal && (
        <ReturnDetailsModal
          returnDetails={returnDetails}
          onClose={() => setSelectedReturnId(null)}
          onIssueLabel={() => issueLabelMutation.mutate(selectedReturnId)}
          isIssuingLabel={issueLabelMutation.isPending}
        />
      )}

      {selectedReturnId && returnDetails && showReceiveModal && (
        <ReceiveReturnModal
          returnDetails={returnDetails}
          onClose={() => {
            setShowReceiveModal(false);
            setSelectedReturnId(null);
          }}
          onSuccess={() => {
            setShowReceiveModal(false);
            setSelectedReturnId(null);
          }}
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
}

function ReturnDetailsModal({
  returnDetails,
  onClose,
  onIssueLabel,
  isIssuingLabel,
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
            <h3 className="font-semibold mb-3">Items</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Disposition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.sku}</TableCell>
                    <TableCell className="text-right">{item.qtyOrdered}</TableCell>
                    <TableCell className="text-right">{item.qtyRequested}</TableCell>
                    <TableCell className="text-right">{item.qtyApproved}</TableCell>
                    <TableCell className="text-right">{item.qtyReceived}</TableCell>
                    <TableCell>
                      {item.itemReason ? (
                        <span className="text-sm text-muted-foreground">{item.itemReason}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.disposition ? (
                        <Badge variant="outline">{item.disposition}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <Button variant="outline" onClick={onClose} data-testid="button-close">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ReceiveReturnModalProps {
  returnDetails: ReturnDetails;
  onClose: () => void;
  onSuccess: () => void;
}

function ReceiveReturnModal({ returnDetails, onClose, onSuccess }: ReceiveReturnModalProps) {
  const { toast } = useToast();
  const [itemsData, setItemsData] = useState(
    returnDetails.items.map((item) => ({
      returnItemId: item.id,
      qtyReceived: item.qtyApproved,
      disposition: 'RESTOCK' as 'RESTOCK' | 'SCRAP' | 'INSPECT',
      notes: '',
    }))
  );
  const [resolutionFinal, setResolutionFinal] = useState<string>(
    returnDetails.returnRequest.resolutionRequested
  );

  const receiveMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/returns/${returnDetails.returnRequest.id}/receive`, {
        items: itemsData,
        resolutionFinal,
      });
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

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive Return</DialogTitle>
          <DialogDescription>
            Process incoming return for order #{returnDetails.returnRequest.externalOrderId}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <Label>Final Resolution</Label>
            <Select value={resolutionFinal} onValueChange={setResolutionFinal}>
              <SelectTrigger data-testid="select-resolution">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="REFUND">Refund</SelectItem>
                <SelectItem value="REPLACEMENT">Replacement</SelectItem>
                <SelectItem value="STORE_CREDIT">Store Credit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <h3 className="font-semibold mb-3">Items</h3>
            <div className="space-y-4">
              {itemsData.map((itemData, index) => {
                const originalItem = returnDetails.items[index];
                return (
                  <Card key={itemData.returnItemId}>
                    <CardContent className="pt-4 space-y-3">
                      <div className="font-medium">{originalItem.sku}</div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label>Qty Received</Label>
                          <Input
                            type="number"
                            min={0}
                            max={originalItem.qtyApproved}
                            value={itemData.qtyReceived}
                            onChange={(e) => {
                              const newData = [...itemsData];
                              newData[index].qtyReceived = parseInt(e.target.value) || 0;
                              setItemsData(newData);
                            }}
                            data-testid={`input-qty-${originalItem.sku}`}
                          />
                        </div>
                        <div className="col-span-2">
                          <Label>Disposition</Label>
                          <Select
                            value={itemData.disposition}
                            onValueChange={(value: any) => {
                              const newData = [...itemsData];
                              newData[index].disposition = value;
                              setItemsData(newData);
                            }}
                          >
                            <SelectTrigger data-testid={`select-disposition-${originalItem.sku}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="RESTOCK">Restock (add back to inventory)</SelectItem>
                              <SelectItem value="SCRAP">Scrap (damaged/unusable)</SelectItem>
                              <SelectItem value="INSPECT">Inspect (needs review)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label>Notes (optional)</Label>
                        <Textarea
                          value={itemData.notes}
                          onChange={(e) => {
                            const newData = [...itemsData];
                            newData[index].notes = e.target.value;
                            setItemsData(newData);
                          }}
                          placeholder="Add notes about condition, damage, etc."
                          data-testid={`textarea-notes-${originalItem.sku}`}
                        />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => receiveMutation.mutate()}
              disabled={receiveMutation.isPending}
              data-testid="button-confirm-receive"
            >
              Confirm Receipt
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
