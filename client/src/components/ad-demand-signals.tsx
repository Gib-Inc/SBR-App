import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, DollarSign, ShoppingCart, Eye, MousePointer } from "lucide-react";
import { SiGoogle, SiFacebook, SiTiktok, SiShopify, SiAmazon } from "react-icons/si";

interface AdDemandSignalsProps {
  variant?: "dashboard" | "ai-agent";
}

export function AdDemandSignals({ variant = "dashboard" }: AdDemandSignalsProps) {
  // Fetch forecast contexts
  const { data: forecastContexts, isLoading } = useQuery<any[]>({
    queryKey: ["/api/forecast-context"],
  });

  // Fetch channels
  const { data: channels } = useQuery<any[]>({
    queryKey: ["/api/channels"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ad & Demand Signals</CardTitle>
          <p className="text-sm text-muted-foreground">Multi-channel sales & advertising performance</p>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">Loading channel data...</p>
        </CardContent>
      </Card>
    );
  }

  if (!forecastContexts || forecastContexts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ad & Demand Signals</CardTitle>
          <p className="text-sm text-muted-foreground">Multi-channel sales & advertising performance</p>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            No data available. Data will appear after the daily sync runs or you can manually trigger a refresh.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Calculate aggregate metrics
  const aggregatedMetrics = forecastContexts.reduce(
    (acc, context) => ({
      totalSales7d: acc.totalSales7d + (context.unitsSold7d || 0),
      totalSales30d: acc.totalSales30d + (context.unitsSold30d || 0),
      totalRevenue7d: acc.totalRevenue7d + (context.revenue7d || 0),
      totalRevenue30d: acc.totalRevenue30d + (context.revenue30d || 0),
      shopifySales7d: acc.shopifySales7d + (context.shopifyUnitsSold7d || 0),
      shopifySales30d: acc.shopifySales30d + (context.shopifyUnitsSold30d || 0),
      shopifyRevenue7d: acc.shopifyRevenue7d + (context.shopifyRevenue7d || 0),
      shopifyRevenue30d: acc.shopifyRevenue30d + (context.shopifyRevenue30d || 0),
      amazonSales7d: acc.amazonSales7d + (context.amazonUnitsSold7d || 0),
      amazonSales30d: acc.amazonSales30d + (context.amazonUnitsSold30d || 0),
      amazonRevenue7d: acc.amazonRevenue7d + (context.amazonRevenue7d || 0),
      amazonRevenue30d: acc.amazonRevenue30d + (context.amazonRevenue30d || 0),
      googleAdSpend7d: acc.googleAdSpend7d + (context.googleAdSpend7d || 0),
      googleAdSpend30d: acc.googleAdSpend30d + (context.googleAdSpend30d || 0),
      googleConversions7d: acc.googleConversions7d + (context.googleConversions7d || 0),
      metaAdSpend7d: acc.metaAdSpend7d + (context.metaAdSpend7d || 0),
      metaAdSpend30d: acc.metaAdSpend30d + (context.metaAdSpend30d || 0),
      metaConversions7d: acc.metaConversions7d + (context.metaConversions7d || 0),
      tiktokAdSpend7d: acc.tiktokAdSpend7d + (context.tiktokAdSpend7d || 0),
      tiktokAdSpend30d: acc.tiktokAdSpend30d + (context.tiktokAdSpend30d || 0),
      tiktokConversions7d: acc.tiktokConversions7d + (context.tiktokConversions7d || 0),
    }),
    {
      totalSales7d: 0,
      totalSales30d: 0,
      totalRevenue7d: 0,
      totalRevenue30d: 0,
      shopifySales7d: 0,
      shopifySales30d: 0,
      shopifyRevenue7d: 0,
      shopifyRevenue30d: 0,
      amazonSales7d: 0,
      amazonSales30d: 0,
      amazonRevenue7d: 0,
      amazonRevenue30d: 0,
      googleAdSpend7d: 0,
      googleAdSpend30d: 0,
      googleConversions7d: 0,
      metaAdSpend7d: 0,
      metaAdSpend30d: 0,
      metaConversions7d: 0,
      tiktokAdSpend7d: 0,
      tiktokAdSpend30d: 0,
      tiktokConversions7d: 0,
    }
  );

  // Calculate growth rates (7d vs 30d average)
  const avgDaily7d = aggregatedMetrics.totalSales7d / 7;
  const avgDaily30d = aggregatedMetrics.totalSales30d / 30;
  const salesGrowthRate = avgDaily30d > 0 ? ((avgDaily7d - avgDaily30d) / avgDaily30d) * 100 : 0;

  const avgRevDaily7d = aggregatedMetrics.totalRevenue7d / 7;
  const avgRevDaily30d = aggregatedMetrics.totalRevenue30d / 30;
  const revenueGrowthRate = avgRevDaily30d > 0 ? ((avgRevDaily7d - avgRevDaily30d) / avgRevDaily30d) * 100 : 0;

  // Calculate ROAS for each platform
  const googleRoas = aggregatedMetrics.googleAdSpend7d > 0
    ? forecastContexts.reduce((sum, c) => sum + (c.googleRoas7d || 0), 0) / forecastContexts.filter(c => c.googleRoas7d > 0).length
    : 0;
  
  const metaRoas = aggregatedMetrics.metaAdSpend7d > 0
    ? forecastContexts.reduce((sum, c) => sum + (c.metaRoas7d || 0), 0) / forecastContexts.filter(c => c.metaRoas7d > 0).length
    : 0;
  
  const tiktokRoas = aggregatedMetrics.tiktokAdSpend7d > 0
    ? forecastContexts.reduce((sum, c) => sum + (c.tiktokRoas7d || 0), 0) / forecastContexts.filter(c => c.tiktokRoas7d > 0).length
    : 0;

  const totalAdSpend7d = aggregatedMetrics.googleAdSpend7d + aggregatedMetrics.metaAdSpend7d + aggregatedMetrics.tiktokAdSpend7d;

  if (variant === "dashboard") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ad & Demand Signals</CardTitle>
          <p className="text-sm text-muted-foreground">Multi-channel sales & advertising performance (7-day view)</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Sales Overview */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShoppingCart className="h-4 w-4" />
                <span>Total Sales (7d)</span>
              </div>
              <div className="text-2xl font-bold" data-testid="text-total-sales-7d">
                {aggregatedMetrics.totalSales7d.toLocaleString()} units
              </div>
              <div className="flex items-center gap-1 text-xs">
                {salesGrowthRate > 0 ? (
                  <TrendingUp className="h-3 w-3 text-green-600" />
                ) : salesGrowthRate < 0 ? (
                  <TrendingDown className="h-3 w-3 text-red-600" />
                ) : null}
                <span className={salesGrowthRate > 0 ? "text-green-600" : salesGrowthRate < 0 ? "text-red-600" : "text-muted-foreground"}>
                  {salesGrowthRate > 0 ? "+" : ""}{salesGrowthRate.toFixed(1)}% vs 30d avg
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <DollarSign className="h-4 w-4" />
                <span>Revenue (7d)</span>
              </div>
              <div className="text-2xl font-bold" data-testid="text-revenue-7d">
                ${aggregatedMetrics.totalRevenue7d.toLocaleString()}
              </div>
              <div className="flex items-center gap-1 text-xs">
                {revenueGrowthRate > 0 ? (
                  <TrendingUp className="h-3 w-3 text-green-600" />
                ) : revenueGrowthRate < 0 ? (
                  <TrendingDown className="h-3 w-3 text-red-600" />
                ) : null}
                <span className={revenueGrowthRate > 0 ? "text-green-600" : revenueGrowthRate < 0 ? "text-red-600" : "text-muted-foreground"}>
                  {revenueGrowthRate > 0 ? "+" : ""}{revenueGrowthRate.toFixed(1)}% vs 30d avg
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Eye className="h-4 w-4" />
                <span>Ad Spend (7d)</span>
              </div>
              <div className="text-2xl font-bold" data-testid="text-ad-spend-7d">
                ${totalAdSpend7d.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">
                Across all platforms
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MousePointer className="h-4 w-4" />
                <span>Avg ROAS</span>
              </div>
              <div className="text-2xl font-bold" data-testid="text-avg-roas">
                {totalAdSpend7d > 0 ? ((googleRoas + metaRoas + tiktokRoas) / 3).toFixed(2) : "0.00"}x
              </div>
              <div className="text-xs text-muted-foreground">
                Return on ad spend
              </div>
            </div>
          </div>

          {/* Channel Breakdown */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Sales by Channel</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Shopify */}
              <div className="flex items-center gap-3 rounded-md border p-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#96BF48]/10">
                  <SiShopify className="h-5 w-5 text-[#96BF48]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Shopify</p>
                  <p className="text-xs text-muted-foreground">
                    {aggregatedMetrics.shopifySales7d} units · ${aggregatedMetrics.shopifyRevenue7d.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Amazon */}
              <div className="flex items-center gap-3 rounded-md border p-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#FF9900]/10">
                  <SiAmazon className="h-5 w-5 text-[#FF9900]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Amazon</p>
                  <p className="text-xs text-muted-foreground">
                    {aggregatedMetrics.amazonSales7d} units · ${aggregatedMetrics.amazonRevenue7d.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Ad Platform Performance */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Ad Platform Performance</h4>
            <div className="grid grid-cols-1 gap-3">
              {/* Google Ads */}
              {aggregatedMetrics.googleAdSpend7d > 0 && (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#4285F4]/10">
                      <SiGoogle className="h-5 w-5 text-[#4285F4]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Google Ads</p>
                      <p className="text-xs text-muted-foreground">
                        ${aggregatedMetrics.googleAdSpend7d.toLocaleString()} spend · {aggregatedMetrics.googleConversions7d} conversions
                      </p>
                    </div>
                  </div>
                  <Badge variant={googleRoas >= 2 ? "default" : googleRoas >= 1 ? "secondary" : "outline"}>
                    {googleRoas.toFixed(2)}x ROAS
                  </Badge>
                </div>
              )}

              {/* Meta Ads */}
              {aggregatedMetrics.metaAdSpend7d > 0 && (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#0866FF]/10">
                      <SiFacebook className="h-5 w-5 text-[#0866FF]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Meta Ads</p>
                      <p className="text-xs text-muted-foreground">
                        ${aggregatedMetrics.metaAdSpend7d.toLocaleString()} spend · {aggregatedMetrics.metaConversions7d} conversions
                      </p>
                    </div>
                  </div>
                  <Badge variant={metaRoas >= 2 ? "default" : metaRoas >= 1 ? "secondary" : "outline"}>
                    {metaRoas.toFixed(2)}x ROAS
                  </Badge>
                </div>
              )}

              {/* TikTok Ads */}
              {aggregatedMetrics.tiktokAdSpend7d > 0 && (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#000000]/10">
                      <SiTiktok className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">TikTok Ads</p>
                      <p className="text-xs text-muted-foreground">
                        ${aggregatedMetrics.tiktokAdSpend7d.toLocaleString()} spend · {aggregatedMetrics.tiktokConversions7d} conversions
                      </p>
                    </div>
                  </div>
                  <Badge variant={tiktokRoas >= 2 ? "default" : tiktokRoas >= 1 ? "secondary" : "outline"}>
                    {tiktokRoas.toFixed(2)}x ROAS
                  </Badge>
                </div>
              )}

              {totalAdSpend7d === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No ad performance data available for the last 7 days
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // AI Agent variant - more detailed table view
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Ad & Demand Signals</CardTitle>
        <p className="text-sm text-muted-foreground">Detailed cross-channel performance for AI forecasting</p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">7d Sales</TableHead>
              <TableHead className="text-right">30d Sales</TableHead>
              <TableHead className="text-right">Shopify</TableHead>
              <TableHead className="text-right">Amazon</TableHead>
              <TableHead className="text-right">Ad Spend</TableHead>
              <TableHead className="text-right">Avg ROAS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {forecastContexts.slice(0, 10).map((context: any) => {
              const avgRoas = [context.googleRoas7d, context.metaRoas7d, context.tiktokRoas7d]
                .filter(r => r > 0)
                .reduce((sum, r, _, arr) => sum + r / arr.length, 0);
              
              const totalAdSpend = (context.googleAdSpend7d || 0) + (context.metaAdSpend7d || 0) + (context.tiktokAdSpend7d || 0);

              return (
                <TableRow key={context.productId}>
                  <TableCell className="font-medium">{context.productId.slice(0, 8)}...</TableCell>
                  <TableCell className="text-right font-mono text-sm">{context.onHandTotal}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{context.unitsSold7d}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{context.unitsSold30d}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{context.shopifyUnitsSold7d}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{context.amazonUnitsSold7d}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    ${totalAdSpend.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={avgRoas >= 2 ? "default" : avgRoas >= 1 ? "secondary" : "outline"}>
                      {avgRoas > 0 ? `${avgRoas.toFixed(2)}x` : "—"}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
