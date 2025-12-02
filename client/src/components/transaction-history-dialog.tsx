import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowDownCircle, ArrowUpCircle, ArrowRightLeft, Settings, Package, TrendingUp } from "lucide-react";

interface TransactionHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: {
    id: string;
    name: string;
    sku: string;
  };
}

const transactionTypeIcons = {
  RECEIVE: ArrowDownCircle,
  SHIP: ArrowUpCircle,
  TRANSFER_IN: ArrowRightLeft,
  TRANSFER_OUT: ArrowRightLeft,
  PRODUCE: Package,
  ADJUST: Settings,
};

const transactionTypeColors = {
  RECEIVE: "text-green-600",
  SHIP: "text-red-600",
  TRANSFER_IN: "text-blue-600",
  TRANSFER_OUT: "text-orange-600",
  PRODUCE: "text-purple-600",
  ADJUST: "text-gray-600",
};

const transactionTypeLabels = {
  RECEIVE: "Received",
  SHIP: "Shipped",
  TRANSFER_IN: "Transfer In",
  TRANSFER_OUT: "Transfer Out",
  PRODUCE: "Production",
  ADJUST: "Adjustment",
};

export function TransactionHistoryDialog({ isOpen, onClose, item }: TransactionHistoryDialogProps) {
  const { data: transactions, isLoading } = useQuery({
    queryKey: ["/api/transactions", item.id],
    enabled: isOpen,
  });

  const transactionArray = Array.isArray(transactions) ? transactions : [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Transaction History</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">{item.name}</Label>
            <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>
          </div>

          <div className="rounded border max-h-[50vh] overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Loading transaction history...
              </div>
            ) : transactionArray.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No transactions found for this item.
              </div>
            ) : (
              <table className="w-full table-auto text-sm">
                <thead className="sticky top-0 bg-muted/50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left whitespace-nowrap w-px">Date/Time</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap w-px">Type</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap w-px">Location</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap w-px">Quantity</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {transactionArray.map((txn: any) => {
                    const Icon = transactionTypeIcons[txn.type as keyof typeof transactionTypeIcons];
                    const colorClass = transactionTypeColors[txn.type as keyof typeof transactionTypeColors];
                    const typeLabel = transactionTypeLabels[txn.type as keyof typeof transactionTypeLabels];
                    const isIncrease = ['RECEIVE', 'TRANSFER_IN', 'PRODUCE'].includes(txn.type);
                    
                    return (
                      <tr key={txn.id} className="border-b last:border-0 hover-elevate" data-testid={`row-transaction-${txn.id}`}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {format(new Date(txn.createdAt), "MMM dd, yyyy HH:mm")}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {Icon && <Icon className={`h-4 w-4 ${colorClass}`} />}
                            <span className="text-xs">{typeLabel}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {txn.location !== 'N/A' ? (
                            <Badge variant="secondary" className="text-xs">
                              {txn.location}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          <span className={isIncrease ? "text-green-600" : "text-red-600"}>
                            {isIncrease ? '+' : '-'}{txn.quantity}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-xs truncate">
                          {txn.notes || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            Total transactions: {transactionArray.length}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Label({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={className}>{children}</div>;
}
