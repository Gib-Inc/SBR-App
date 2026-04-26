import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

// Performance tab for a single supplier. Pulls /api/purchase-orders and
// /api/supplier-items, filters by supplierId, and computes:
//   • OTDR — received-on-time / total-received
//   • Avg actual lead time vs quoted (from supplier_items.leadTimeDays)
//   • Total spend last 12 months
//   • Outstanding balance (open POs not yet paid)
//   • Last order date
//
// Computed client-side to avoid adding a new endpoint.

type PurchaseOrder = {
  id: string;
  supplierId: string | null;
  status: string;
  total: number | null;
  orderDate: string | null;
  createdAt: string | null;
  expectedDate: string | null;
  receivedAt: string | null;
  paidAt: string | null;
  isHistorical?: boolean;
};

type SupplierItem = {
  id: string;
  supplierId: string;
  itemId: string;
  leadTimeDays: number | null;
  isDesignatedSupplier: boolean;
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const PAID_STATUSES = new Set(["RECEIVED", "CLOSED", "CANCELLED"]);
const OPEN_STATUSES = new Set(["APPROVED", "SENT", "ACCEPTED", "PARTIAL", "PARTIALLY_RECEIVED"]);

function diffDays(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const aT = new Date(a).getTime();
  const bT = new Date(b).getTime();
  if (Number.isNaN(aT) || Number.isNaN(bT)) return null;
  return Math.round((aT - bT) / (1000 * 60 * 60 * 24));
}

export type SupplierMetrics = {
  otdr: number | null; // 0–100
  receivedCount: number;
  onTimeCount: number;
  avgActualLeadTime: number | null;
  quotedLeadTime: number | null;
  spend12mo: number;
  outstandingBalance: number;
  lastOrderDate: string | null;
};

export function computeSupplierMetrics(
  pos: PurchaseOrder[],
  supplierItems: SupplierItem[],
  supplierId: string,
): SupplierMetrics {
  const now = Date.now();
  const yearAgo = now - 365 * 24 * 60 * 60 * 1000;

  const mine = pos.filter((p) => p.supplierId === supplierId && !p.isHistorical);
  const received = mine.filter(
    (p) => p.receivedAt != null && (p.status === "RECEIVED" || p.status === "PARTIAL" || p.status === "PARTIALLY_RECEIVED" || p.status === "CLOSED"),
  );

  let onTimeCount = 0;
  const leadTimes: number[] = [];
  for (const p of received) {
    if (p.expectedDate && p.receivedAt) {
      const expT = new Date(p.expectedDate).getTime();
      const recT = new Date(p.receivedAt).getTime();
      if (!Number.isNaN(expT) && !Number.isNaN(recT) && recT <= expT) {
        onTimeCount++;
      }
    }
    const lt = diffDays(p.receivedAt, p.createdAt ?? p.orderDate);
    if (lt != null && lt >= 0) leadTimes.push(lt);
  }
  const otdr = received.length > 0 ? (onTimeCount / received.length) * 100 : null;
  const avgActualLeadTime = leadTimes.length > 0
    ? Math.round(leadTimes.reduce((s, n) => s + n, 0) / leadTimes.length)
    : null;

  // Quoted lead time = max across this supplier's designated supplier_items rows
  // (falls back to any row if no designated). Conservative pick — slowest item
  // sets the supplier-level expectation.
  const supplierLT = supplierItems.filter((si) => si.supplierId === supplierId && (si.leadTimeDays ?? 0) > 0);
  const designated = supplierLT.filter((si) => si.isDesignatedSupplier);
  const ltSource = designated.length > 0 ? designated : supplierLT;
  const quotedLeadTime = ltSource.length > 0
    ? Math.max(...ltSource.map((si) => si.leadTimeDays ?? 0))
    : null;

  let spend12mo = 0;
  for (const p of received) {
    const recT = p.receivedAt ? new Date(p.receivedAt).getTime() : 0;
    if (recT >= yearAgo) spend12mo += p.total ?? 0;
  }

  let outstanding = 0;
  for (const p of mine) {
    if (OPEN_STATUSES.has(p.status) && !p.paidAt) {
      outstanding += p.total ?? 0;
    }
  }

  const orderDates = mine
    .map((p) => p.orderDate ?? p.createdAt)
    .filter((d): d is string => !!d)
    .sort();
  const lastOrderDate = orderDates.length > 0 ? orderDates[orderDates.length - 1] : null;

  return {
    otdr: otdr != null ? Math.round(otdr * 10) / 10 : null,
    receivedCount: received.length,
    onTimeCount,
    avgActualLeadTime,
    quotedLeadTime,
    spend12mo: Math.round(spend12mo * 100) / 100,
    outstandingBalance: Math.round(outstanding * 100) / 100,
    lastOrderDate,
  };
}

export function reliabilityColor(otdr: number | null): "green" | "amber" | "red" | "muted" {
  if (otdr == null) return "muted";
  if (otdr >= 90) return "green";
  if (otdr >= 70) return "amber";
  return "red";
}

export function ReliabilityBadge({ otdr }: { otdr: number | null }) {
  const color = reliabilityColor(otdr);
  if (color === "muted") {
    return (
      <Badge variant="outline" className="text-muted-foreground" data-testid="reliability-badge">
        —
      </Badge>
    );
  }
  const cls =
    color === "green"
      ? "bg-green-600/10 text-green-700 dark:text-green-400 border-green-600/30"
      : color === "amber"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
        : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <Badge variant="outline" className={cls} data-testid="reliability-badge">
      {(otdr ?? 0).toFixed(0)}%
    </Badge>
  );
}

export function SupplierPerformance({ supplierId }: { supplierId: string }) {
  const { data: pos = [], isLoading: posLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders"],
  });
  const { data: supplierItems = [], isLoading: siLoading } = useQuery<SupplierItem[]>({
    queryKey: ["/api/supplier-items"],
  });

  const m = useMemo(
    () => computeSupplierMetrics(pos as any, supplierItems as any, supplierId),
    [pos, supplierItems, supplierId],
  );

  if (posLoading || siLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const lastOrderLabel = m.lastOrderDate
    ? new Date(m.lastOrderDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="supplier-performance">
      <MetricCard title="On-time delivery rate" subtitle={`${m.onTimeCount} of ${m.receivedCount} received POs on time`}>
        {m.otdr == null ? (
          <span className="text-muted-foreground text-sm">No received POs yet</span>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-bold tabular-nums ${
              m.otdr >= 90 ? "text-green-700 dark:text-green-400" :
              m.otdr >= 70 ? "text-amber-700 dark:text-amber-400" :
              "text-destructive"
            }`}>
              {m.otdr.toFixed(1)}%
            </span>
            <ReliabilityBadge otdr={m.otdr} />
          </div>
        )}
      </MetricCard>

      <MetricCard
        title="Average lead time"
        subtitle={
          m.quotedLeadTime != null
            ? `Quoted ${m.quotedLeadTime}d`
            : "Quoted lead time not set"
        }
      >
        {m.avgActualLeadTime == null ? (
          <span className="text-muted-foreground text-sm">No data</span>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">
              {m.avgActualLeadTime}d
            </span>
            {m.quotedLeadTime != null && (
              <span className={`text-xs ${
                m.avgActualLeadTime > m.quotedLeadTime
                  ? "text-destructive font-medium"
                  : "text-muted-foreground"
              }`}>
                {m.avgActualLeadTime > m.quotedLeadTime
                  ? `+${m.avgActualLeadTime - m.quotedLeadTime}d vs quote`
                  : "On / under quote"}
              </span>
            )}
          </div>
        )}
      </MetricCard>

      <MetricCard title="Spend last 12 months" subtitle="Sum of received PO totals">
        <span className="text-3xl font-bold tabular-nums">
          {m.spend12mo > 0 ? usd.format(m.spend12mo) : "—"}
        </span>
      </MetricCard>

      <MetricCard title="Outstanding balance" subtitle="Approved / sent POs not yet paid">
        <span className={`text-3xl font-bold tabular-nums ${
          m.outstandingBalance > 0 ? "text-amber-700 dark:text-amber-400" : ""
        }`}>
          {m.outstandingBalance > 0 ? usd.format(m.outstandingBalance) : "$0"}
        </span>
      </MetricCard>

      <MetricCard title="Last order" subtitle="Most recent PO order date" className="sm:col-span-2">
        <span className="text-2xl font-medium">{lastOrderLabel}</span>
      </MetricCard>
    </div>
  );
}

function MetricCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className} data-testid={`metric-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        {subtitle && <CardDescription className="text-xs">{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}
