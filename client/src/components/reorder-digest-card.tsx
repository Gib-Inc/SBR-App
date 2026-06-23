/**
 * ReorderDigestCard — the "make reordering as easy as possible" surface.
 *
 * One glance on the Purchase Orders page tells Matt what each vendor needs this
 * week (velocity × BOM vs on-hand + on-order), the stockout count, and the real
 * material COGS rate retiring the 35% plug. Each vendor expands into its line
 * list with suggested order quantities. "Refresh" force-regenerates the digest.
 * Draft-for-approval by design — it never emails a vendor on its own.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Package, AlertTriangle, RefreshCw, ChevronRight, ShoppingCart, ExternalLink } from "lucide-react";

interface DigestLine {
  sku: string;
  name: string;
  suggestedOrderQty: number;
  urgency: string;
  weeksCover: number | null;
  seasonalFactor?: number;
}
interface VendorNeeds {
  vendorId: string;
  vendorName: string;
  topUrgency: string;
  lineCount: number;
  estCost: number;
  lines: DigestLine[];
  orderOnline?: boolean;
  vendorUrl?: string | null;
}
interface Digest {
  available: boolean;
  generatedAt?: string;
  summary?: { vendors: number; toOrder: number; stockout: number; estCost: number };
  byVendor?: VendorNeeds[];
  message?: string;
}
interface CogsMonth {
  month: string;
  cogsRatePct: number;
  coveragePct: number;
}
interface CogsActual {
  months: CogsMonth[];
  budget: { measuredRatePct: number; projectedCogs: number; basisMonths: number };
}

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();

function urgencyClass(u: string): string {
  if (u === "STOCKOUT") return "text-red-600 dark:text-red-400";
  if (u === "CRITICAL") return "text-amber-600 dark:text-amber-400";
  if (u === "LOW") return "text-muted-foreground";
  return "text-muted-foreground";
}

const httpUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const prettyUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");

export function ReorderDigestCard({ live = false }: { live?: boolean } = {}) {
  // live=true reads the always-current reorder needs; otherwise the stored weekly
  // digest. The page uses live so it never goes stale.
  const endpoint = live ? "/api/reorder/needs" : "/api/reorder/digest";
  const { data: raw, isLoading } = useQuery<any>({ queryKey: [endpoint] });
  const { data: cogs } = useQuery<CogsActual>({ queryKey: ["/api/finances/cogs-actual"] });
  const run = useMutation({
    mutationFn: async () => {
      if (live) return { available: true };
      const r = await apiRequest("POST", "/api/reorder/digest/run", {});
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [endpoint] }),
  });

  if (isLoading) return null;

  // Normalize live needs ({summary, byVendor}) into the digest shape.
  const data: Digest | undefined = live
    ? (raw ? { available: true, summary: raw.summary, byVendor: raw.byVendor, generatedAt: null } : undefined)
    : raw;
  const summary = data?.summary;
  const vendors = data?.byVendor || [];
  const cogsRate = cogs?.budget?.measuredRatePct;

  return (
    <Card className="shrink-0" data-testid="card-reorder-digest">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4" />
          Reorder this week
        </CardTitle>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          data-testid="button-run-digest"
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${run.isPending ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data?.available ? (
          <p className="text-sm text-muted-foreground" data-testid="text-digest-empty">
            {data?.message || "No reorder digest yet. Click Refresh to generate this week's list."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span data-testid="stat-vendors">
                <span className="font-semibold">{summary?.vendors ?? 0}</span>
                <span className="text-muted-foreground"> vendors</span>
              </span>
              <span data-testid="stat-toorder">
                <span className="font-semibold">{summary?.toOrder ?? 0}</span>
                <span className="text-muted-foreground"> SKUs to order</span>
              </span>
              <span data-testid="stat-stockout">
                <span className={`font-semibold ${(summary?.stockout ?? 0) > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                  {summary?.stockout ?? 0}
                </span>
                <span className="text-muted-foreground"> stockouts</span>
              </span>
              <span data-testid="stat-estcost">
                <span className="font-semibold">{money(summary?.estCost ?? 0)}</span>
                <span className="text-muted-foreground"> est. cost</span>
              </span>
              {cogsRate != null && cogsRate > 0 && (
                <span className="ml-auto text-muted-foreground" data-testid="stat-cogs-rate">
                  COGS <span className="font-semibold text-foreground">{cogsRate.toFixed(1)}%</span> of revenue
                </span>
              )}
            </div>

            {vendors.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to reorder right now. You are well stocked.</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {vendors.map((v) => (
                  <details key={v.vendorId} className="group" data-testid={`vendor-${v.vendorId}`}>
                    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm hover-elevate">
                      <span className="flex min-w-0 items-center gap-2">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                        {v.topUrgency === "STOCKOUT" && (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                        )}
                        <span className="truncate font-medium">{v.vendorName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{v.lineCount} SKUs</span>
                        {v.orderOnline && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            <ShoppingCart className="h-3 w-3" /> buy online
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{money(v.estCost)}</span>
                    </summary>
                    <div className="space-y-1 px-3 pb-2 pl-8">
                      {v.orderOnline && (
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                          <ShoppingCart className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                          <span className="text-muted-foreground">Self-serve — order this list at</span>
                          {v.vendorUrl ? (
                            <a href={httpUrl(v.vendorUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-blue-700 underline dark:text-blue-300" data-testid={`link-vendor-${v.vendorId}`}>
                              {prettyUrl(v.vendorUrl)} <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="font-medium">{v.vendorName}</span>
                          )}
                          <span className="text-muted-foreground">— no PO to send.</span>
                        </div>
                      )}
                      {v.lines.map((l) => (
                        <div key={l.sku} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate">
                            <span className="font-mono">{l.sku}</span>
                            <span className="text-muted-foreground"> {l.name}</span>
                          </span>
                          <span className="shrink-0 whitespace-nowrap">
                            {l.seasonalFactor != null && l.seasonalFactor >= 1.15 && (
                              <span className="mr-1 text-amber-600 dark:text-amber-400" title={`Seasonal: ordering ${Math.round((l.seasonalFactor - 1) * 100)}% more to prep for the peak`}>↑{l.seasonalFactor}×</span>
                            )}
                            {l.seasonalFactor != null && l.seasonalFactor <= 0.85 && (
                              <span className="mr-1 text-muted-foreground" title={`Seasonal: ordering ${Math.round((1 - l.seasonalFactor) * 100)}% less heading into the off-season`}>↓{l.seasonalFactor}×</span>
                            )}
                            <span className={urgencyClass(l.urgency)}>order {l.suggestedOrderQty}</span>
                            {l.weeksCover != null && (
                              <span className="text-muted-foreground"> · {l.weeksCover}w left</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}

            {data.generatedAt && (
              <p className="text-[11px] text-muted-foreground" data-testid="text-digest-generated">
                Generated {new Date(data.generatedAt).toLocaleString()} · draft for your approval, no vendor emailed automatically
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
