import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CalendarDays, Loader2, Package } from "lucide-react";

// "What should we do this week?" panel for /production. Reads
// /api/production/plan-week (which combines BOM × velocity + on-hand stock
// + inbound POs + open backorders) and renders:
//   • Weekly summary line ("This week: 80 Push 1.0, 50 Push 2.0, …")
//   • Materials check (which components fall short, by how much, when restock arrives)
//   • Per-product priority list with "earliest buildable" when blocked
//   • One card per workday (Mon–Fri) with the build assignments

type BlockedBy = {
  componentId: string;
  componentName: string;
  shortBy: number;
  earliestArrival: string | null;
};

type ProductPlan = {
  itemId: string;
  sku: string;
  name: string;
  dailySales: number;
  weeklyTarget: number;
  backordered: number;
  currentStock: number;
  currentBuildable: number;
  weeklyBuildable: number;
  earliestBuildable: string | null;
  blockedBy: BlockedBy[];
  scheduledByDay: Record<string, number>;
};

type MaterialCheck = {
  componentId: string;
  componentName: string;
  required: number;
  onHand: number;
  inboundThisWeek: number;
  gap: number;
  gapAfterInbound: number;
  earliestArrival: string | null;
};

type WeekPlan = {
  weekStart: string;
  weekEnd: string;
  workdays: string[];
  products: ProductPlan[];
  materialsCheck: MaterialCheck[];
};

function fmtMonthDay(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtWeekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
}
function fmtDayOfMonth(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return String(new Date(y, m - 1, d).getDate());
}

export function ProductionPlan() {
  const { data, isLoading, isError, error } = useQuery<WeekPlan>({
    queryKey: ["/api/production/plan-week"],
  });

  // Top-line summary built once. "80 Push 1.0, 50 Push 2.0, 20 Bigfoot".
  const summaryLine = useMemo(() => {
    if (!data) return "";
    const parts = data.products
      .filter((p) => p.weeklyTarget > 0)
      .map((p) => `${p.weeklyTarget} ${p.name}`);
    return parts.join(", ");
  }, [data]);

  // Map workday → list of build assignments rendered on that day's card.
  const scheduleByDay = useMemo(() => {
    const map = new Map<string, Array<{ name: string; qty: number; backordered: boolean }>>();
    if (!data) return map;
    for (const day of data.workdays) map.set(day, []);
    for (const p of data.products) {
      for (const [day, qty] of Object.entries(p.scheduledByDay)) {
        if (qty <= 0) continue;
        const list = map.get(day) ?? [];
        list.push({ name: p.name, qty, backordered: p.backordered > 0 });
        map.set(day, list);
      }
    }
    // Backordered items first within each day.
    for (const list of Array.from(map.values())) {
      list.sort((a, b) => Number(b.backordered) - Number(a.backordered));
    }
    return map;
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </CardContent>
      </Card>
    );
  }
  if (isError) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Couldn't load weekly plan</CardTitle>
          <CardDescription>{(error as Error)?.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!data) return null;

  const hasAnyTarget = data.products.some((p) => p.weeklyTarget > 0);

  return (
    <section className="space-y-3" data-testid="production-plan">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-primary" />
            This Week's Plan
          </CardTitle>
          <CardDescription>
            {fmtMonthDay(data.weekStart)} – {fmtMonthDay(data.weekEnd)} · BOM × 90d velocity + open backorders
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!hasAnyTarget ? (
            <div className="text-sm text-muted-foreground">
              No demand pull this week — sales velocity is zero across all finished products.
            </div>
          ) : (
            <div className="text-sm">
              <span className="font-medium">This week:</span>{" "}
              <span>{summaryLine}</span>
            </div>
          )}

          {data.materialsCheck.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5 mb-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Materials check
              </div>
              <ul className="text-xs space-y-0.5">
                {data.materialsCheck.slice(0, 6).map((m) => (
                  <li key={m.componentId} className="text-muted-foreground" data-testid={`mat-check-${m.componentId}`}>
                    <span className="font-medium text-foreground">{m.componentName}</span>{" "}
                    short by <span className="tabular-nums font-medium text-foreground">{m.gap}</span>
                    {m.earliestArrival && (
                      <> · restock {fmtMonthDay(m.earliestArrival)}</>
                    )}
                    {m.gapAfterInbound > 0 && m.earliestArrival && (
                      <> (still <span className="tabular-nums">{m.gapAfterInbound}</span> short after that PO)</>
                    )}
                  </li>
                ))}
                {data.materialsCheck.length > 6 && (
                  <li className="text-muted-foreground italic">…and {data.materialsCheck.length - 6} more</li>
                )}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-product priority list */}
      {hasAnyTarget && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By product</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y">
              {data.products.filter((p) => p.weeklyTarget > 0).map((p) => (
                <li
                  key={p.itemId}
                  className="py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm"
                  data-testid={`plan-product-${p.sku}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      {p.name}
                      {p.backordered > 0 && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5">
                          {p.backordered} backordered
                        </Badge>
                      )}
                    </div>
                    {p.blockedBy.length > 0 ? (
                      <div className="text-xs text-amber-700 dark:text-amber-400">
                        {p.earliestBuildable
                          ? <>Earliest you can start building is {fmtMonthDay(p.earliestBuildable)} ({p.blockedBy[0].componentName} delivery)</>
                          : <>Blocked: {p.blockedBy.map((b) => b.componentName).slice(0, 2).join(", ")}</>
                        }
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        ~{p.dailySales}/day pull · {p.currentBuildable} buildable now
                      </div>
                    )}
                  </div>
                  <div className="flex items-baseline gap-3 shrink-0 tabular-nums text-sm">
                    <div className="text-right">
                      <div className="font-bold">{p.weeklyBuildable}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        of {p.weeklyTarget}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Day-by-day workweek board */}
      {hasAnyTarget && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="plan-workweek">
          {data.workdays.map((day) => {
            const assignments = scheduleByDay.get(day) ?? [];
            const dayTotal = assignments.reduce((s, a) => s + a.qty, 0);
            return (
              <Card
                key={day}
                className={`min-h-[120px] ${dayTotal === 0 ? "opacity-60" : ""}`}
                data-testid={`plan-day-${day}`}
              >
                <CardHeader className="p-3 pb-1">
                  <CardTitle className="text-xs flex items-center justify-between">
                    <span>{fmtWeekday(day)}</span>
                    <span className="text-muted-foreground tabular-nums">{fmtDayOfMonth(day)}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-1 space-y-1">
                  {assignments.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic flex items-center gap-1">
                      <Package className="h-3 w-3" /> Open
                    </div>
                  ) : (
                    assignments.map((a, i) => (
                      <div
                        key={i}
                        className="text-xs flex items-baseline justify-between gap-1"
                        data-testid={`plan-day-${day}-assignment-${i}`}
                      >
                        <span
                          className={`truncate ${
                            a.backordered ? "text-destructive font-medium" : ""
                          }`}
                        >
                          {a.name}
                        </span>
                        <span className="tabular-nums font-bold shrink-0">{a.qty}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
