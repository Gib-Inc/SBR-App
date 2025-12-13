import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Package, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ReturnItemForAssessment {
  id: string;
  sku: string;
  productName: string;
  unitPrice: number | null;
  qtyApproved: number;
  lineTotal: number | null;
  isDamaged: boolean;
  damagePhotoUrl?: string | null;
}

interface DamageAssessmentPopupProps {
  isOpen: boolean;
  onClose: () => void;
  returnRequestId: string;
  rmaNumber?: string | null;
  orderNumber?: string | null;
  customerName?: string | null;
  baseRefundAmount?: number | null;
  totalReceived?: number | null;
  shippingCost?: number | null;
  labelFee?: number | null;
  items: ReturnItemForAssessment[];
  onAssessmentComplete?: () => void;
}

const DAMAGE_PERCENT = 0.10;

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "$0.00";
  return `$${amount.toFixed(2)}`;
}

export function DamageAssessmentPopup({
  isOpen,
  onClose,
  returnRequestId,
  rmaNumber,
  orderNumber,
  customerName,
  baseRefundAmount,
  totalReceived,
  shippingCost,
  labelFee,
  items,
  onAssessmentComplete,
}: DamageAssessmentPopupProps) {
  const { toast } = useToast();
  const [damageStatus, setDamageStatus] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    items.forEach(item => {
      initial[item.id] = item.isDamaged || false;
    });
    return initial;
  });

  const toggleDamage = (itemId: string) => {
    setDamageStatus(prev => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  const calculateDamageDeduction = (): number => {
    let total = 0;
    items.forEach(item => {
      if (damageStatus[item.id]) {
        const lineTotal = item.lineTotal || (item.unitPrice || 0) * item.qtyApproved;
        total += lineTotal * DAMAGE_PERCENT;
      }
    });
    return Math.round(total * 100) / 100;
  };

  const damageDeduction = calculateDamageDeduction();
  const finalRefund = Math.max(0, (baseRefundAmount || 0) - damageDeduction);
  const hasDamagedItems = Object.values(damageStatus).some(v => v);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const itemsPayload = items.map(item => ({
        id: item.id,
        isDamaged: damageStatus[item.id] || false,
      }));

      const res = await apiRequest("POST", `/api/returns/${returnRequestId}/assess-damage`, {
        items: itemsPayload,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to submit damage assessment");
      }

      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      
      toast({
        title: "Damage Assessment Complete",
        description: `Final refund amount: ${formatCurrency(data.finalRefundAmount)}`,
      });

      onAssessmentComplete?.();
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Assessment Failed",
        description: error.message || "Failed to submit damage assessment",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    submitMutation.mutate();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Damage Assessment
          </DialogTitle>
          <DialogDescription>
            Check off any damaged items. A 10% deduction will be applied per damaged item.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          <div className="p-3 rounded-lg border bg-muted/50 space-y-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {rmaNumber && (
                <div>
                  <span className="text-muted-foreground">RMA:</span>{" "}
                  <span className="font-medium">{rmaNumber}</span>
                </div>
              )}
              {orderNumber && (
                <div>
                  <span className="text-muted-foreground">Order:</span>{" "}
                  <span className="font-medium">{orderNumber}</span>
                </div>
              )}
              {customerName && (
                <div>
                  <span className="text-muted-foreground">Customer:</span>{" "}
                  <span className="font-medium">{customerName}</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Total Received:</span>{" "}
                <span className="font-medium">{formatCurrency(totalReceived)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Shipping:</span>{" "}
                <span className="font-medium">-{formatCurrency(shippingCost)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Label Fee:</span>{" "}
                <span className="font-medium">-{formatCurrency(labelFee)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Base Refund:</span>{" "}
                <span className="font-medium">{formatCurrency(baseRefundAmount)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-medium text-sm">Return Items</h3>
            <div className="rounded-lg border divide-y">
              {items.map((item) => {
                const lineTotal = item.lineTotal || (item.unitPrice || 0) * item.qtyApproved;
                const damageAmount = damageStatus[item.id] ? lineTotal * DAMAGE_PERCENT : 0;
                
                return (
                  <div
                    key={item.id}
                    className="p-3 flex items-center gap-3 hover-elevate cursor-pointer"
                    onClick={() => toggleDamage(item.id)}
                    data-testid={`damage-item-${item.id}`}
                  >
                    <Checkbox
                      checked={damageStatus[item.id]}
                      onCheckedChange={() => toggleDamage(item.id)}
                      data-testid={`checkbox-damage-${item.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {item.productName}
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                        <span>SKU: {item.sku}</span>
                        <span>Qty: {item.qtyApproved}</span>
                        <span>Line Total: {formatCurrency(lineTotal)}</span>
                      </div>
                    </div>
                    {damageStatus[item.id] && (
                      <Badge variant="destructive" className="text-xs whitespace-nowrap">
                        -{formatCurrency(damageAmount)}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {hasDamagedItems && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Damage deduction: <strong>{formatCurrency(damageDeduction)}</strong> (10% of damaged items)
              </AlertDescription>
            </Alert>
          )}

          <div className="p-3 rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-800 dark:text-green-200">
                Final Refund Amount
              </span>
            </div>
            <div className="text-2xl font-bold text-green-700 dark:text-green-300 mt-1">
              {formatCurrency(finalRefund)}
            </div>
            {hasDamagedItems && (
              <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                {formatCurrency(baseRefundAmount)} - {formatCurrency(damageDeduction)} = {formatCurrency(finalRefund)}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitMutation.isPending} data-testid="button-submit-assessment">
            {submitMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Assessment"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
