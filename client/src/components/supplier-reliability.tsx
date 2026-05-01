import { useQuery } from "@tanstack/react-query";
import { Loader2, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type Reliability = {
  ordersCount: number;
  avgAccuracy: number | null; // 0..1
  avgDeliveryVarianceDays: number | null; // negative = early, positive = late
  band: "green" | "amber" | "red" | "unknown";
};

const BAND_STYLES: Record<Reliability["band"], { bg: string; text: string; label: string }> = {
  green: { bg: "bg-green-500/10 border-green-500/30", text: "text-green-700 dark:text-green-400", label: "Reliable" },
  amber: { bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-700 dark:text-amber-400", label: "Watch" },
  red:   { bg: "bg-destructive/10 border-destructive/30", text: "text-destructive", label: "At risk" },
  unknown: { bg: "bg-muted border-muted", text: "text-muted-foreground", label: "Not enough data" },
};

const formatVariance = (v: number | null): string => {
  if (v == null) return "—";
  const rounded = Math.round(v * 10) / 10;
  if (Math.abs(rounded) < 0.05) return "delivers on time";
  if (rounded > 0) return `delivers ${rounded.toFixed(1)}d late on average`;
  return `delivers ${Math.abs(rounded).toFixed(1)}d early on average`;
};

export function SupplierReliability({ supplierId }: { supplierId: string }) {
  const { data, isLoading } = useQuery<Reliability>({
    queryKey: [`/api/suppliers/${supplierId}/reliability`],
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading reliability…
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const band = data.band ?? "unknown";
  const style = BAND_STYLES[band];
  const accuracyText =
    data.avgAccuracy != null ? `${Math.round(data.avgAccuracy * 100)}% qty accurate` : "—";

  return (
    <Card className={`border ${style.bg}`} data-testid="supplier-reliability">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Reliability (last 90 days)
        </CardTitle>
        <CardDescription>
          Computed at receive time from actual_qty / expected_qty and delivery variance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className={`text-lg font-semibold ${style.text}`}>{style.label}</div>
        <div className="text-sm">
          <span className="font-medium">{accuracyText}</span> ·{" "}
          <span>{formatVariance(data.avgDeliveryVarianceDays)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Based on {data.ordersCount} completed PO{data.ordersCount === 1 ? "" : "s"} in the last
          90 days.
          {data.ordersCount === 0 && " — once orders close, the reliability picture builds itself."}
        </div>
      </CardContent>
    </Card>
  );
}
