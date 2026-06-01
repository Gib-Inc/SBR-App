import { useQuery } from "@tanstack/react-query";
import { Loader2, Mail, FileText, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Communication = {
  id: string;
  actionType: string;
  sentBy: string;
  status: string;
  notes: string | null;
  createdAt: string;
};

type POSummary = {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string | null;
  total: number | null;
};

type TimelineResponse = {
  lastBrief: Communication | null;
  recentCommunications: Communication[];
  recentPurchaseOrders: POSummary[];
  lastContactAt: string | null;
  daysSinceContact: number | null;
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const ACTION_LABEL: Record<string, string> = {
  REORDER_REQUEST: "Reorder Request",
  PAYMENT_SENT: "Payment Sent",
  DELIVERY_CONFIRMED: "Delivery Confirmed",
  ISSUE_FLAGGED: "Issue Flagged",
  CREATE_PO: "Created PO",
  ONLINE_ORDER: "Online Order",
  FORECAST_BRIEF: "Forecast Brief",
};

export function SupplierTimeline({ supplierId }: { supplierId: string }) {
  const { data, isLoading } = useQuery<TimelineResponse>({
    queryKey: [`/api/suppliers/${supplierId}/timeline`],
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading timeline…
      </div>
    );
  }
  if (!data) return null;

  const days = data.daysSinceContact;
  const daysClass =
    days == null
      ? "text-muted-foreground"
      : days > 30
        ? "text-destructive"
        : days > 14
          ? "text-amber-700 dark:text-amber-400"
          : "text-green-700 dark:text-green-400";
  const daysText =
    days == null
      ? "no contact on file"
      : days === 0
        ? "today"
        : days === 1
          ? "1 day"
          : `${days} days`;

  return (
    <div className="space-y-4" data-testid="supplier-timeline">
      <div className="rounded-md border bg-muted/30 p-3 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Last contact</div>
          <div className={`font-semibold ${daysClass}`}>
            {daysText} ago{data.lastContactAt ? ` · ${formatDate(data.lastContactAt)}` : ""}
          </div>
        </div>
        <Badge variant={days != null && days > 30 ? "destructive" : days != null && days > 14 ? "secondary" : "default"}>
          {days != null && days > 30 ? "Stale" : days != null && days > 14 ? "Watch" : "Fresh"}
        </Badge>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Last Forecast Brief
        </h4>
        {data.lastBrief ? (
          <div className="rounded border p-3 text-sm space-y-1" data-testid="timeline-last-brief">
            <div className="flex items-center justify-between">
              <span>{formatDate(data.lastBrief.createdAt)} · sent by {data.lastBrief.sentBy}</span>
              <Badge variant="outline">{data.lastBrief.status}</Badge>
            </div>
            {data.lastBrief.notes && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">View body</summary>
                <pre className="whitespace-pre-wrap font-mono mt-2 p-2 rounded bg-muted/50 max-h-64 overflow-y-auto">
                  {data.lastBrief.notes}
                </pre>
              </details>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No forecast brief sent yet.</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Recent Communications
          </h4>
          {data.recentCommunications.length === 0 ? (
            <div className="text-sm text-muted-foreground">None yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {data.recentCommunications.map((c) => (
                <li key={c.id} className="text-xs flex justify-between border-b pb-1">
                  <span>
                    <span className="font-medium">{ACTION_LABEL[c.actionType] ?? c.actionType}</span>
                    <span className="text-muted-foreground"> · by {c.sentBy}</span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatDate(c.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Recent POs
          </h4>
          {data.recentPurchaseOrders.length === 0 ? (
            <div className="text-sm text-muted-foreground">No POs on file.</div>
          ) : (
            <ul className="space-y-1.5">
              {data.recentPurchaseOrders.map((po) => (
                <li key={po.id} className="text-xs flex justify-between border-b pb-1">
                  <span>
                    <span className="font-medium font-mono">{po.poNumber}</span>
                    <Badge variant="outline" className="ml-2 text-[10px] py-0 h-4">{po.status}</Badge>
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {po.total != null ? usd.format(po.total) : "—"} · {formatDate(po.orderDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
