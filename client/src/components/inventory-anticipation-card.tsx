import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PackageCheck, AlertTriangle } from "lucide-react";

/**
 * CIPH.R — Inventory-Spend Anticipation.
 * Upcoming restock cost + WHEN cash is needed, from active reorder alerts joined
 * with item cost + velocity. Items missing a cost are shown but not counted in
 * the total (anti-hallucination).
 */

type Bucket = "overdue" | "d0_30" | "d31_60" | "d61_90" | "d90_plus" | "unknown";
interface Item {
  sku: string; name: string; supplierName: string | null;
  recommendedQty: number | null; unitCost: number | null; projectedCost: number | null;
  currentStock: number; daysOfCover: number | null; bucket: Bucket;
}
interface Resp { success: boolean; items: Item[]; totalKnownCost: number; missingCostCount: number; buckets: Record<Bucket, number>; }

const fmt = (v: number) => "$" + Math.round(v).toLocaleString();
const BUCKETS: { key: Bucket; label: string; tone: string }[] = [
  { key: "overdue", label: "Overdue", tone: "text-red-600 dark:text-red-400" },
  { key: "d0_30", label: "0–30 days", tone: "text-red-600 dark:text-red-400" },
  { key: "d31_60", label: "31–60 days", tone: "text-amber-600 dark:text-amber-400" },
  { key: "d61_90", label: "61–90 days", tone: "" },
  { key: "d90_plus", label: "90+ days", tone: "" },
];

export function InventoryAnticipationCard() {
  const { data, isLoading } = useQuery<Resp>({ queryKey: ["/api/finances/inventory-anticipation"] });
  const items = data?.items ?? [];
  const buckets = data?.buckets;

  return (
    <Card data-testid="card-inventory-anticipation">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><PackageCheck className="h-4 w-4" /> Inventory Spend Anticipation</CardTitle>
        {data && <p className="text-xs text-muted-foreground">{fmt(data.totalKnownCost)} anticipated restock cost · {items.length} item(s){data.missingCostCount > 0 ? ` · ${data.missingCostCount} missing a cost` : ""}</p>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-inv-empty">No active reorder alerts — nothing to anticipate right now.</p>
        ) : (
          <div className="space-y-4">
            {/* timeline */}
            {buckets && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {BUCKETS.map((b) => (
                  <div key={b.key} className="rounded-lg border p-2 text-center" data-testid={`inv-bucket-${b.key}`}>
                    <div className={`text-base font-bold tabular-nums ${b.tone}`}>{fmt(buckets[b.key] || 0)}</div>
                    <div className="text-[11px] text-muted-foreground">{b.label}</div>
                  </div>
                ))}
              </div>
            )}
            {/* soonest items */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground text-right">
                  <th className="text-left py-1">Item</th><th className="py-1">Qty</th><th className="py-1">Cost</th><th className="py-1">Days left</th>
                </tr></thead>
                <tbody>
                  {items.slice(0, 8).map((it) => (
                    <tr key={it.sku + it.name} className="border-t text-right" data-testid={`inv-item-${it.sku}`}>
                      <td className="text-left py-1"><span className="font-medium">{it.name}</span> <span className="text-muted-foreground text-xs">{it.sku}</span></td>
                      <td className="tabular-nums">{it.recommendedQty ?? "—"}</td>
                      <td className="tabular-nums">{it.projectedCost == null ? <span className="text-amber-600 dark:text-amber-400 text-xs">cost?</span> : fmt(it.projectedCost)}</td>
                      <td className={`tabular-nums ${it.daysOfCover != null && it.daysOfCover <= 30 ? "text-red-600 dark:text-red-400" : ""}`}>{it.daysOfCover == null ? "—" : it.daysOfCover <= 0 ? "out" : `${it.daysOfCover}d`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && data.missingCostCount > 0 && (
              <div className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{data.missingCostCount} item(s) have no purchase cost set — add a default cost on the item so their restock spend is included.</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
