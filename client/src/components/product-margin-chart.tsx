import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { Loader2 } from "lucide-react";

// 12-month margin% line chart for one finished product. Mounts under the
// cost-rollup modal so the user sees current build cost AND how margin has
// drifted. Backed by /api/products/:id/margin-history.

type MarginPoint = {
  month: string; // YYYY-MM
  buildCost: number;
  marginPct: number | null;
  hadAnyPO: boolean;
  missingComponents: string[];
};

type MarginHistory = {
  productId: string;
  productName: string;
  sellingPrice: number | null;
  sellingPriceNote: string;
  months: MarginPoint[];
  note?: string;
};

function fmtMonthShort(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

export function ProductMarginChart({ productId }: { productId: string }) {
  const { data, isLoading, isError, error } = useQuery<MarginHistory>({
    queryKey: [`/api/products/${productId}/margin-history?months=12`],
  });

  // Drop leading months that have no margin so the chart doesn't open with
  // a flat zero line for products with sparse PO history.
  const chartData = useMemo(() => {
    if (!data) return [];
    const firstWithValue = data.months.findIndex((m) => m.marginPct != null);
    return (firstWithValue === -1 ? [] : data.months.slice(firstWithValue)).map((p) => ({
      ...p,
      monthLabel: fmtMonthShort(p.month),
    }));
  }, [data]);

  const trend = useMemo(() => {
    if (chartData.length < 2) return null;
    const first = chartData.find((p) => p.marginPct != null)?.marginPct;
    const last = [...chartData].reverse().find((p) => p.marginPct != null)?.marginPct;
    if (first == null || last == null) return null;
    return Math.round((last - first) * 10) / 10;
  }, [chartData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="text-xs text-destructive py-2">
        Couldn't load margin history — {(error as Error)?.message}
      </div>
    );
  }
  if (!data || data.months.length === 0 || chartData.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        {data?.note ?? "Not enough PO history to plot margin yet."}
      </div>
    );
  }

  return (
    <div className="space-y-1.5" data-testid="product-margin-chart">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground uppercase tracking-wide">
          Margin trend (12mo)
        </span>
        {trend != null && (
          <span
            className={`tabular-nums font-medium ${
              trend >= 0
                ? "text-green-700 dark:text-green-400"
                : "text-destructive"
            }`}
            data-testid="margin-trend-delta"
          >
            {trend >= 0 ? "+" : ""}
            {trend.toFixed(1)} pts
          </span>
        )}
      </div>

      <div className="h-32 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
            <XAxis
              dataKey="monthLabel"
              tick={{ fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              minTickGap={8}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
              width={36}
            />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              labelFormatter={(label) => `Month: ${label}`}
              formatter={(value: number, name) => {
                if (name === "marginPct") return [`${value.toFixed(1)}%`, "Margin"];
                return [value, name as string];
              }}
            />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="marginPct"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              connectNulls={true}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="text-[10px] text-muted-foreground">
        {data.sellingPriceNote}
      </div>
    </div>
  );
}
