/**
 * StockVarianceCard — where the app's sellable counter has drifted from the 3PL
 * physical. The app keeps availableForSaleQty (decremented by sales) separate from
 * pivotQty (the Extensiv 3PL count); restocks update pivot but not afs, so afs
 * drifts low. This card flags those gaps so a count can true them up.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Scale, AlertTriangle } from "lucide-react";

type VarianceFlag = "OK" | "AFS_STALE" | "AFS_AHEAD" | "NEGATIVE";
interface Row {
  itemId: string; sku: string; name: string;
  hildale: number; pivot: number; afs: number;
  appOnHand: number; truePhysical: number; drift: number; flag: VarianceFlag;
}
interface Resp {
  rows: Row[];
  summary: { products: number; afsStale: number; afsAhead: number; negative: number; totalDriftUnits: number };
}

const FLAG_LABEL: Record<VarianceFlag, string> = {
  OK: "OK", AFS_STALE: "Sellable understated", AFS_AHEAD: "Ahead of 3PL", NEGATIVE: "Negative",
};
function flagBadge(flag: VarianceFlag) {
  if (flag === "AFS_STALE") return <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">{FLAG_LABEL[flag]}</Badge>;
  if (flag === "NEGATIVE") return <Badge variant="outline" className="border-red-300 text-red-700 dark:text-red-400">{FLAG_LABEL[flag]}</Badge>;
  if (flag === "AFS_AHEAD") return <Badge variant="outline" className="text-muted-foreground">{FLAG_LABEL[flag]}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">OK</Badge>;
}

export function StockVarianceCard() {
  const { data, isLoading } = useQuery<Resp>({ queryKey: ["/api/inventory/stock-variance"] });
  if (isLoading || !data) return null;
  const flagged = data.rows.filter((r) => r.flag !== "OK");
  if (flagged.length === 0) {
    return (
      <Card data-testid="card-stock-variance">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4" /> Stock variance</CardTitle>
          <CardDescription>Sellable counter and 3PL physical are in agreement. Nothing to true up.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card data-testid="card-stock-variance">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4" /> Stock variance</CardTitle>
        <CardDescription>
          Where the app's sellable count drifted from the 3PL physical. These are units sitting at Pivot that the app isn't counting as sellable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <span className="font-semibold">{data.summary.afsStale}</span>
            <span className="text-muted-foreground">products understated</span>
          </span>
          <span><span className="font-semibold">{Math.round(data.summary.totalDriftUnits).toLocaleString()}</span><span className="text-muted-foreground"> units uncounted as sellable</span></span>
          {data.summary.negative > 0 && (
            <span className="text-red-600 dark:text-red-400"><span className="font-semibold">{data.summary.negative}</span> negative</span>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Product</th>
                <th className="px-2 py-1.5 text-right font-medium">Hildale</th>
                <th className="px-2 py-1.5 text-right font-medium">3PL (Pivot)</th>
                <th className="px-2 py-1.5 text-right font-medium">Sellable</th>
                <th className="px-2 py-1.5 text-right font-medium">Drift</th>
                <th className="px-3 py-1.5 text-right font-medium">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {flagged.map((r) => (
                <tr key={r.itemId} className="hover-elevate" data-testid={`row-variance-${r.sku}`}>
                  <td className="px-3 py-1.5">
                    <span className="font-mono text-xs">{r.sku}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{r.name}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{r.hildale}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.pivot}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.afs}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${r.drift > 0 ? "text-amber-600 dark:text-amber-400" : r.drift < 0 ? "text-muted-foreground" : ""}`}>
                    {r.drift > 0 ? "+" : ""}{r.drift}
                  </td>
                  <td className="px-3 py-1.5 text-right">{flagBadge(r.flag)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          "Sellable" (available-for-sale) is decremented by every order but isn't replenished when Extensiv restocks Pivot, so it drifts below the real 3PL count. A physical count → adjustment trues it up. Note: Shopify availability comes from Extensiv directly, so this drift does not block sales.
        </p>
      </CardContent>
    </Card>
  );
}
