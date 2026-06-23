/**
 * ShopifyCashCard — "money on the way from Shopify". Shows the exact Payments
 * balance + in-transit payouts when the read_shopify_payments scope is granted;
 * otherwise a recent-sales estimate, clearly labeled, so it's useful either way.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Banknote } from "lucide-react";

interface ShopifyCash {
  available: boolean;
  reason?: string;
  total: number | null;
  balance?: number;
  inTransit?: number;
  nextPayoutDate?: string | null;
  estimate: number;
  estimateBasis: { days: number; grossSales: number; orders: number; feeRate: number };
}

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();

export function ShopifyCashCard() {
  const { data, isLoading } = useQuery<ShopifyCash>({ queryKey: ["/api/finances/shopify-payouts"] });
  if (isLoading || !data) return null;

  const exact = data.available && data.total != null;
  const value = exact ? (data.total as number) : data.estimate;

  return (
    <Card data-testid="card-shopify-cash">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Banknote className="h-4 w-4" /> Shopify cash on the way
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums" data-testid="text-shopify-cash">{money(value)}</p>
            {exact ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {money(data.balance ?? 0)} pending{(data.inTransit ?? 0) > 0 ? ` · ${money(data.inTransit as number)} in transit` : ""}
                {data.nextPayoutDate ? ` · next payout ${data.nextPayoutDate}` : ""}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Est. from {data.estimateBasis.orders} Shopify orders, last {data.estimateBasis.days} days, net of ~{Math.round(data.estimateBasis.feeRate * 1000) / 10}% fees.
              </p>
            )}
          </div>
          <Badge variant={exact ? "default" : "secondary"} className="shrink-0">{exact ? "Live" : "Estimate"}</Badge>
        </div>
        {!exact && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Grant the connected app the read_shopify_payments permission for the exact payout balance.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
