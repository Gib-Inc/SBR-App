import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Sunrise, AlertTriangle, ArrowRight } from "lucide-react";
import { Link } from "wouter";

// Inline render of /api/briefing/daily on the Reports page. The cron writes
// it nightly; this card serves the cached payload (or computes on demand if
// no cache yet) so the user sees today's snapshot when they open the page.

type BriefingPayload = {
  date: string;
  generatedAt: string;
  otdr: { last7Days: number | null; target: number; sampleSize: number };
  push2Extrawide: {
    sku: string;
    name: string | null;
    inStock: boolean;
    daysOutOfStock: number | null;
    onHand: number;
  };
  topCriticalComponents: Array<{
    name: string;
    currentStock: number;
    daysUntilStockout: number;
    dailyUsage: number;
  }>;
  draftPOs: { count: number; totalDollars: number };
  inHouseQueueCount: number;
  shopIssues24h: {
    count: number;
    items: Array<{ itemName: string; issueType: string; notes: string; createdAt: string }>;
  };
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatDate(iso: string): string {
  // YYYY-MM-DD → "Sat Apr 25"
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function MorningBriefingCard() {
  const { data, isLoading, isError, error } = useQuery<BriefingPayload>({
    queryKey: ["/api/briefing/daily"],
  });

  return (
    <Card data-testid="widget-morning-briefing">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sunrise className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          Morning Briefing
        </CardTitle>
        <CardDescription>
          {data ? formatDate(data.date) : "Today's snapshot"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isError ? (
          <div className="text-sm text-destructive">
            Couldn't load briefing — {(error as Error)?.message ?? "error"}
          </div>
        ) : !data ? (
          <div className="text-sm text-muted-foreground py-2">No briefing available yet.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* OTDR */}
            <Section title="OTDR last 7 days">
              {data.otdr.last7Days === null ? (
                <span className="text-sm text-muted-foreground">
                  Not enough delivered orders in window
                </span>
              ) : (
                <OTDRRow value={data.otdr.last7Days} target={data.otdr.target} sample={data.otdr.sampleSize} />
              )}
            </Section>

            {/* Push 2.0 */}
            <Section title="Push 2.0 Extra Wide">
              {data.push2Extrawide.inStock ? (
                <div className="text-sm">
                  <span className="font-bold tabular-nums text-green-700 dark:text-green-400">
                    {data.push2Extrawide.onHand}
                  </span>{" "}
                  on hand
                </div>
              ) : (
                <div className="text-sm">
                  <AlertTriangle className="inline h-4 w-4 text-destructive mr-1" />
                  Out of stock
                  {data.push2Extrawide.daysOutOfStock != null && (
                    <span className="text-muted-foreground">
                      {" "}— {data.push2Extrawide.daysOutOfStock} day
                      {data.push2Extrawide.daysOutOfStock === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              )}
            </Section>

            {/* Critical components */}
            <Section title="Top 3 critical components" className="lg:col-span-2">
              {data.topCriticalComponents.length === 0 ? (
                <span className="text-sm text-muted-foreground">No components in critical zone.</span>
              ) : (
                <ul className="text-sm divide-y">
                  {data.topCriticalComponents.map((c) => (
                    <li
                      key={c.name}
                      className="py-1.5 flex items-center justify-between gap-3"
                      data-testid={`briefing-critical-${c.name}`}
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="text-xs tabular-nums shrink-0">
                        <span className={c.daysUntilStockout < 7 ? "text-destructive font-semibold" : "text-amber-700 dark:text-amber-400"}>
                          {c.daysUntilStockout}d
                        </span>
                        <span className="text-muted-foreground"> · {c.currentStock} on hand</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Draft POs */}
            <Section title="Draft POs waiting approval">
              <div className="text-sm">
                <span className="font-bold tabular-nums">{data.draftPOs.count}</span>
                {data.draftPOs.totalDollars > 0 && (
                  <span className="text-muted-foreground"> · {usd.format(data.draftPOs.totalDollars)}</span>
                )}
                {data.draftPOs.count > 0 && (
                  <Link
                    href="/purchase-orders"
                    className="ml-2 text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    Review <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </Section>

            {/* In-house queue */}
            <Section title="In-house shipping queue">
              <div className="text-sm">
                <span className="font-bold tabular-nums">{data.inHouseQueueCount}</span>
                <span className="text-muted-foreground"> orders to ship</span>
                {data.inHouseQueueCount > 0 && (
                  <Link
                    href="/in-house-shipping"
                    className="ml-2 text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    Open queue <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </Section>

            {/* Shop issues */}
            <Section title="Shop issues last 24h" className="lg:col-span-2">
              {data.shopIssues24h.count === 0 ? (
                <span className="text-sm text-muted-foreground">None reported.</span>
              ) : (
                <div>
                  <div className="text-sm">
                    <span className="font-bold tabular-nums text-amber-700 dark:text-amber-400">
                      {data.shopIssues24h.count}
                    </span>
                    <span className="text-muted-foreground"> reported</span>
                  </div>
                  <ul className="mt-2 text-xs space-y-1">
                    {data.shopIssues24h.items.slice(0, 5).map((i, idx) => (
                      <li key={idx} className="text-muted-foreground">
                        <span className="font-medium text-foreground">{i.itemName}</span>{" "}
                        — {i.issueType.replace(/_/g, " ")}: {i.notes}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-md border bg-muted/30 p-3 ${className ?? ""}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function OTDRRow({ value, target, sample }: { value: number; target: number; sample: number }) {
  const meeting = value >= target;
  return (
    <div className="text-sm">
      <span className={`text-2xl font-bold tabular-nums ${meeting ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
        {value.toFixed(1)}%
      </span>
      <span className="text-muted-foreground ml-2 text-xs">
        target {target}% · {sample} order{sample === 1 ? "" : "s"}
      </span>
    </div>
  );
}
