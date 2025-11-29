import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle, Clock, AlertCircle, Package, Calendar, Building2, DollarSign } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface POLine {
  itemName: string;
  sku: string;
  qtyOrdered: number;
  unitCost: string | number;
  lineTotal: string | number;
}

interface POData {
  poNumber: string;
  orderDate: string;
  expectedDate?: string;
  supplierName: string;
  buyerCompanyName: string;
  total: string | number;
  currency: string;
  acknowledgementStatus: string;
  lines: POLine[];
}

export default function POAcknowledge() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [confirmed, setConfirmed] = useState(false);

  const { data: poData, isLoading, error, refetch } = useQuery<POData>({
    queryKey: ['/api/purchase-orders/by-token', token],
    enabled: !!token,
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/purchase-orders/acknowledge', { token, action: 'ACCEPT' });
      return response.json();
    },
    onSuccess: () => {
      setConfirmed(true);
      refetch();
    },
  });

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'Not specified';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatCurrency = (value: string | number, currency: string = 'USD') => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(numValue || 0);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-4 text-muted-foreground">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" />
              <p>Loading purchase order...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !poData) {
    const errorMessage = (error as any)?.message || 'This confirmation link is invalid or has expired.';
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-4 text-center">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <div>
                <h2 className="text-lg font-semibold">Link Invalid or Expired</h2>
                <p className="text-sm text-muted-foreground mt-2">{errorMessage}</p>
                <p className="text-sm text-muted-foreground mt-4">
                  Please contact the buyer if you believe this is an error.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isAlreadyAcknowledged = ['SUPPLIER_ACCEPTED', 'SUPPLIER_DECLINED', 'INTERNAL_CONFIRMED'].includes(poData.acknowledgementStatus);

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Card>
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Package className="h-12 w-12 text-primary" />
            </div>
            <CardTitle className="text-2xl">Purchase Order Confirmation</CardTitle>
            <CardDescription>
              {poData.buyerCompanyName} has sent you a purchase order
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Package className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">PO Number</p>
                  <p className="font-semibold" data-testid="text-po-number">{poData.poNumber}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Order Date</p>
                  <p className="font-semibold">{formatDate(poData.orderDate)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Buyer</p>
                  <p className="font-semibold">{poData.buyerCompanyName || 'N/A'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Expected Delivery</p>
                  <p className="font-semibold">{formatDate(poData.expectedDate)}</p>
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="font-semibold mb-3">Order Items</h3>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poData.lines.map((line, index) => (
                      <TableRow key={index} data-testid={`row-po-line-${index}`}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{line.itemName}</p>
                            {line.sku && (
                              <p className="text-xs text-muted-foreground">SKU: {line.sku}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{line.qtyOrdered}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(line.unitCost, poData.currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(line.lineTotal, poData.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-end items-center gap-3 py-3 border-t">
              <span className="text-lg font-semibold">Order Total:</span>
              <span className="text-2xl font-bold text-primary" data-testid="text-po-total">
                {formatCurrency(poData.total, poData.currency)}
              </span>
            </div>

            <Separator />

            {isAlreadyAcknowledged || confirmed ? (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 text-center">
                <CheckCircle className="h-12 w-12 text-green-600 dark:text-green-400 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-green-700 dark:text-green-300">
                  Purchase Order Confirmed
                </h3>
                <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                  Thank you for confirming this order. The buyer has been notified.
                </p>
              </div>
            ) : (
              <div className="text-center space-y-4">
                <p className="text-muted-foreground">
                  By clicking the button below, you confirm receipt of this purchase order and your intent to fulfill it.
                </p>
                <Button
                  size="lg"
                  onClick={() => confirmMutation.mutate()}
                  disabled={confirmMutation.isPending}
                  data-testid="button-confirm-po"
                  className="px-8"
                >
                  {confirmMutation.isPending ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent mr-2" />
                      Confirming...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-5 w-5 mr-2" />
                      Confirm Purchase Order
                    </>
                  )}
                </Button>
                {confirmMutation.isError && (
                  <p className="text-sm text-destructive">
                    {(confirmMutation.error as any)?.message || 'Failed to confirm. Please try again.'}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          If you have any questions about this order, please contact {poData.buyerCompanyName || 'the buyer'} directly.
        </p>
      </div>
    </div>
  );
}
