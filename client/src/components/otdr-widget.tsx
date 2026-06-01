import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDown, ArrowUp, Loader2, Target, ChevronRight } from "lucide-react";

// On-Time Delivery Rate widget — top-of-Reports headline + click-through
// modal listing the orders that broke the SLA. Backed by /api/otdr/summary
// (current 30d vs previous 30d, plus the late-order detail).

type LateOrder = {
  orderId: string;
  orderName: string | null;
  externalOrderId: string | null;
  customerName: string;
  customerEmail: string | null;
  channel: string;
  requiredByDate: string;
  deliveredAt: string;
  daysLate: number;
};

type OtdrSummary = {
  target: number;
  current: { pct: number | null; total: number; onTime: number };
  previous: { pct: number | null; total: number; onTime: number };
  delta: number | null;
  lateOrders: LateOrder[];
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function OtdrWidget() {
  const [drillOpen, setDrillOpen] = useState(false);
  const { data, isLoading, isError, error } = useQuery<OtdrSummary>({
    queryKey: ["/api/otdr/summary"],
  });

  // Group late orders by likely root cause for the drill-down — currently
  // only "channel" since the SO doesn't carry an explicit lateness reason.
  // The grouping makes "one stockout caused 12 late orders" patterns visible.
  const groupedByChannel = useMemo(() => {
    if (!data?.lateOrders) return [] as Array<{ channel: string; count: number }>;
    const m = new Map<string, number>();
    for (const o of data.lateOrders) m.set(o.channel, (m.get(o.channel) ?? 0) + 1);
    return Array.from(m.entries())
      .map(([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  const meeting = data?.current.pct != null && data.current.pct >= data.target;

  return (
    <>
      <Card data-testid="widget-otdr">
        <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
          <div className="space-y-0.5">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              OTDR last 30 days
            </CardTitle>
            <CardDescription>
              On-time delivery rate · target {data?.target ?? 90}%
            </CardDescription>
          </div>
          {data?.current.total ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDrillOpen(true)}
              data-testid="otdr-drill-down"
              className="text-xs"
            >
              {data.lateOrders.length} late
              <ChevronRight className="ml-0.5 h-3 w-3" />
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : isError ? (
            <div className="text-sm text-destructive">
              Couldn't load OTDR — {(error as Error)?.message ?? "error"}
            </div>
          ) : !data || data.current.pct === null ? (
            <div className="text-sm text-muted-foreground py-2">
              Not enough delivered orders in window yet.
            </div>
          ) : (
            <div className="flex items-baseline gap-3 flex-wrap">
              <span
                className={`text-4xl font-bold tabular-nums ${
                  meeting ? "text-green-700 dark:text-green-400" : "text-destructive"
                }`}
                data-testid="otdr-current-pct"
              >
                {data.current.pct.toFixed(1)}%
              </span>
              {data.delta != null && (
                <span
                  className={`text-sm font-medium inline-flex items-center gap-0.5 ${
                    data.delta >= 0
                      ? "text-green-700 dark:text-green-400"
                      : "text-destructive"
                  }`}
                  data-testid="otdr-delta"
                >
                  {data.delta >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  {Math.abs(data.delta).toFixed(1)} pts vs prior 30d
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                {data.current.onTime} / {data.current.total} on-time
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={drillOpen} onOpenChange={setDrillOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Late orders — last 30 days</DialogTitle>
            <DialogDescription>
              {data?.lateOrders.length ?? 0} orders shipped past the customer's required-by date.
              {groupedByChannel.length > 1 && (
                <span className="block mt-1 text-xs">
                  By channel:{" "}
                  {groupedByChannel.map((g, i) => (
                    <span key={g.channel}>
                      {i > 0 && " · "}
                      <span className="font-medium">{g.channel}</span> ({g.count})
                    </span>
                  ))}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {!data || data.lateOrders.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No late orders in the window. 🎉
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Required by</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Days late</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lateOrders.map((o) => (
                  <TableRow key={o.orderId} data-testid={`late-order-${o.orderId}`}>
                    <TableCell className="font-mono text-xs">
                      {o.orderName ?? o.externalOrderId ?? o.orderId.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{o.customerName}</div>
                      {o.customerEmail && (
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {o.customerEmail}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{o.channel}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {fmtDate(o.requiredByDate)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {fmtDate(o.deliveredAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Badge variant="destructive">+{o.daysLate}d</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
