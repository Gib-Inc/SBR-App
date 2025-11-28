import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, TrendingDown, Package, ExternalLink, Activity, RefreshCw, ArrowUp, ArrowDown, Minus, HelpCircle, Zap, Lightbulb, AlertTriangle, Info, AlertCircle, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AdDemandSignals } from "@/components/ad-demand-signals";
import { formatDistanceToNow } from "date-fns";

interface AIAtRiskItem {
  id: string;
  name: string;
  sku: string;
  currentStock: number;
  dailyUsage: number;
  daysOfCover: number;
  riskLevel: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  recommendedQty: number;
  recommendedAction: "ORDER" | "MONITOR" | "OK";
  explanation: string;
  capacity?: number;
}

interface AISystemRecommendation {
  id: string;
  title: string;
  description: string;
  suggestedChange: string | null;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: "INTEGRATION_ISSUE" | "INVENTORY_PATTERN" | "PROCESS_IMPROVEMENT" | "SECURITY_CONCERN" | "PERFORMANCE" | "DATA_QUALITY" | "OTHER";
  status: "NEW" | "ACKNOWLEDGED" | "DISMISSED";
  createdAt: string;
}

interface AISystemRecommendationsResponse {
  recommendations: AISystemRecommendation[];
  summary: {
    total: number;
    new: number;
    acknowledged: number;
    dismissed: number;
    bySeverity: { critical: number; high: number; medium: number; low: number };
  };
}



export default function Dashboard() {
  const [syncingIntegration, setSyncingIntegration] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch dashboard data
  const { data: dashboardData, isLoading } = useQuery<any>({
    queryKey: ["/api/dashboard"],
  });

  // Fetch settings to check if integrations are configured
  const { data: settingsData, isLoading: settingsLoading, error: settingsError } = useQuery<any>({
    queryKey: ["/api/settings"],
  });

  // Fetch reorder recommendations
  const { data: reorderRecommendations, isLoading: isLoadingRecommendations } = useQuery<any[]>({
    queryKey: ["/api/llm/reorder-recommendations"],
  });

  // Fetch demand forecasts
  const { data: demandForecasts, isLoading: isLoadingForecasts } = useQuery<any[]>({
    queryKey: ["/api/llm/demand-forecast"],
  });

  // Fetch AI-powered at-risk items from decision engine
  const { data: aiAtRiskItems, isLoading: isLoadingAIAtRisk } = useQuery<AIAtRiskItem[]>({
    queryKey: ["/api/ai/at-risk"],
    staleTime: 60000,
  });

  // Fetch AI System Recommendations (weekly LLM review suggestions)
  const { data: systemRecommendationsData, isLoading: isLoadingSystemRecs } = useQuery<AISystemRecommendationsResponse>({
    queryKey: ["/api/ai/system-recommendations?status=NEW&limit=5"],
    staleTime: 300000,
  });

  // Fix in GHL mutation - Creates Draft POs and optionally links to GHL
  const [isFixingInGhl, setIsFixingInGhl] = useState(false);
  const fixInGhlMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/dashboard/stock/fix-in-ghl", {});
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to create purchase orders");
      }
      return await res.json();
    },
    onSuccess: (data) => {
      if (data.purchaseOrdersCreated > 0) {
        const poNumbers = data.purchaseOrders?.map((po: any) => po.poNumber).join(", ") || "";
        
        if (data.primaryGhlOpportunityUrl) {
          window.open(data.primaryGhlOpportunityUrl, "_blank", "noopener,noreferrer");
          toast({
            title: "Purchase Orders Created",
            description: `Created ${data.purchaseOrdersCreated} PO(s): ${poNumbers}. Opening GoHighLevel for approval workflow.`,
          });
        } else {
          toast({
            title: "Purchase Orders Created",
            description: `Created ${data.purchaseOrdersCreated} draft PO(s): ${poNumbers}. Review in Purchase Orders page.`,
          });
        }
        queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      } else {
        toast({
          title: "No Action Needed",
          description: data.message || "No items require immediate action.",
        });
      }
      setIsFixingInGhl(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create purchase orders. Please try again.",
        variant: "destructive",
      });
      setIsFixingInGhl(false);
    },
  });

  const handleFixInGhl = () => {
    setIsFixingInGhl(true);
    fixInGhlMutation.mutate();
  };

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest("POST", `/api/integrations/${id}/sync`, {});
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Sync failed");
      }
      return await res.json();
    },
    onSuccess: (_, { name }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/health"] });
      toast({
        title: "Sync Complete",
        description: `${name} data has been synchronized successfully`,
      });
      setSyncingIntegration(null);
    },
    onError: (error: any, { name }) => {
      toast({
        title: "Sync Failed",
        description: error.message || `Failed to sync ${name}. Please check your API configuration and try again.`,
        variant: "destructive",
      });
      setSyncingIntegration(null);
    },
  });

  const handleSync = (integration: any) => {
    if (!integration.id) {
      toast({
        title: "Error",
        description: "Integration ID is missing. Please refresh the page and try again.",
        variant: "destructive",
      });
      return;
    }
    setSyncingIntegration(integration.id);
    syncMutation.mutate({ id: integration.id, name: integration.name });
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const productionCapacity = dashboardData?.productionCapacity ?? {
    maxUnits: 0,
    constraints: []
  };
  const suppliers = (dashboardData?.suppliers ?? []) as any[];
  const integrations = (dashboardData?.integrations ?? []) as any[];

  // Helper to check if an integration is configured (has API key)
  const isIntegrationConfigured = (integration: any): boolean => {
    if (!integration.settingsKey || !settingsData) return false;
    const apiKey = settingsData[integration.settingsKey];
    return !!(apiKey && apiKey.trim());
  };


  // Calculate stock warning banner data from at-risk items
  const atRiskCount = aiAtRiskItems?.length ?? 0;
  const minDaysToStockout = aiAtRiskItems?.length 
    ? Math.min(...aiAtRiskItems.map(item => item.daysOfCover ?? Infinity))
    : Infinity;
  
  // Determine priority based on minimum days to stockout
  const getStockPriority = (days: number): 'critical' | 'high' | 'medium' | null => {
    if (days <= 3) return 'critical';
    if (days <= 7) return 'high';
    if (days <= 21) return 'medium';
    return null;
  };
  const stockPriority = getStockPriority(minDaysToStockout);
  
  // Check if there are high/critical items for the Fix in GHL button
  const hasHighCriticalItems = aiAtRiskItems?.some(item => {
    const days = item.daysOfCover ?? Infinity;
    return days <= 7; // high or critical
  }) ?? false;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Stock Warning Banner */}
      {atRiskCount > 0 && stockPriority && (
        <div 
          className={`flex items-center justify-between gap-4 px-4 py-3 rounded-lg ${
            stockPriority === 'critical' || stockPriority === 'high'
              ? 'bg-red-600 text-white'
              : 'bg-yellow-400 text-yellow-900'
          }`}
          data-testid="banner-stock-warning"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <span className="font-medium">
              Stock warning: {atRiskCount} item{atRiskCount !== 1 ? 's' : ''} at risk, earliest stockout in {minDaysToStockout} day{minDaysToStockout !== 1 ? 's' : ''}.
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                size="sm"
                variant={stockPriority === 'critical' || stockPriority === 'high' ? 'secondary' : 'default'}
                onClick={handleFixInGhl}
                disabled={!hasHighCriticalItems || isFixingInGhl}
                data-testid="button-fix-in-ghl"
              >
                {isFixingInGhl ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Wrench className="h-4 w-4 mr-2" />
                )}
                Fix in GHL
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {hasHighCriticalItems 
                ? "Create draft purchase orders in GoHighLevel for critical items" 
                : "No critical items to fix"}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Operational overview and inventory forecasting</p>
      </div>

      {/* Top 15 At-Risk Items */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Top 15 At-Risk Items
              </CardTitle>
              <p className="text-sm text-muted-foreground">AI-powered risk analysis with production capacity</p>
            </div>
            {isLoadingAIAtRisk && (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!aiAtRiskItems || aiAtRiskItems.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              {isLoadingAIAtRisk ? (
                <>
                  <RefreshCw className="h-8 w-8 text-muted-foreground animate-spin" />
                  <p className="text-sm text-muted-foreground">Analyzing inventory...</p>
                </>
              ) : (
                <>
                  <Zap className="h-8 w-8 text-muted-foreground" />
                  <p className="font-medium text-muted-foreground">All items healthy</p>
                  <p className="text-sm text-muted-foreground">No stock shortages or risk alerts detected.</p>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-md border overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Item</th>
                    <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Risk</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Stock</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Days Left</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Capacity</th>
                    <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Action</th>
                    <th className="h-11 px-3 text-center font-medium text-muted-foreground whitespace-nowrap">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {aiAtRiskItems.slice(0, 15).map((item: AIAtRiskItem) => (
                    <tr key={item.id} className="h-11 border-b hover-elevate" data-testid={`row-at-risk-${item.id}`}>
                      <td className="px-3 whitespace-nowrap">
                        <div>
                          <p className="font-medium">{item.name}</p>
                          <p className="text-xs font-mono text-muted-foreground">{item.sku}</p>
                        </div>
                      </td>
                      <td className="px-3 whitespace-nowrap">
                        <Badge 
                          variant={
                            item.riskLevel === "HIGH" ? "destructive" : 
                            item.riskLevel === "MEDIUM" ? "secondary" : 
                            "outline"
                          }
                          data-testid={`badge-risk-${item.id}`}
                        >
                          {item.riskLevel}
                        </Badge>
                      </td>
                      <td className="px-3 text-right whitespace-nowrap">{item.currentStock}</td>
                      <td className="px-3 text-right whitespace-nowrap">
                        <Badge variant={item.daysOfCover <= 0 ? "destructive" : item.daysOfCover < 7 ? "secondary" : "outline"}>
                          {item.daysOfCover} days
                        </Badge>
                      </td>
                      <td className="px-3 text-right whitespace-nowrap font-mono">
                        {item.capacity !== undefined ? item.capacity : "-"}
                      </td>
                      <td className="px-3 whitespace-nowrap">
                        {item.recommendedAction === "ORDER" && item.recommendedQty > 0 ? (
                          <Button size="sm" variant="default" data-testid={`button-order-${item.id}`}>
                            Order {item.recommendedQty}
                          </Button>
                        ) : item.recommendedAction === "MONITOR" ? (
                          <Badge variant="secondary">Monitor</Badge>
                        ) : (
                          <Badge variant="outline">OK</Badge>
                        )}
                      </td>
                      <td className="px-3 text-center whitespace-nowrap">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              data-testid={`button-why-${item.id}`}
                            >
                              <HelpCircle className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-xs">
                            <p className="text-sm">{item.explanation}</p>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reorder Recommendations (standalone) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Reorder Recommendations</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">AI-suggested reorder quantities based on usage patterns</p>
        </CardHeader>
        <CardContent>
          {isLoadingRecommendations ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading recommendations...</p>
          ) : !reorderRecommendations || reorderRecommendations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Package className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium text-muted-foreground">No reorder recommendations</p>
              <p className="text-sm text-muted-foreground">Your inventory levels look good. Check back after more sales activity.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reorderRecommendations.slice(0, 10).map((rec: any) => (
                <Card key={rec.itemId}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium">{rec.itemName}</p>
                          <Badge 
                            variant={
                              rec.urgencyLevel === 'critical' ? 'destructive' :
                              rec.urgencyLevel === 'high' ? 'default' : 'secondary'
                            }
                            data-testid={`urgency-${rec.itemId}`}
                          >
                            {rec.urgencyLevel}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{rec.reason}</p>
                        <div className="flex gap-4 text-xs">
                          <span>Current: {rec.currentStock}</span>
                          <span>Suggested: {rec.suggestedOrderQty}</span>
                          <span>Days until stockout: {rec.daysUntilStockout}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Demand Forecasts (standalone) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Demand Forecasts</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">Predicted usage based on historical patterns</p>
        </CardHeader>
        <CardContent>
          {isLoadingForecasts ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading forecasts...</p>
          ) : !demandForecasts || demandForecasts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium text-muted-foreground">No demand forecasts yet</p>
              <p className="text-sm text-muted-foreground">Forecasts appear once there's enough sales history to analyze trends.</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="h-11 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">Item</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Current Usage</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Forecast</th>
                    <th className="h-11 px-3 text-right font-medium text-muted-foreground whitespace-nowrap">Confidence</th>
                    <th className="h-11 px-3 text-center font-medium text-muted-foreground whitespace-nowrap">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {demandForecasts.slice(0, 15).map((forecast: any) => (
                    <tr key={forecast.itemId} className="h-11 border-b hover-elevate">
                      <td className="px-3 font-medium whitespace-nowrap">{forecast.itemName}</td>
                      <td className="px-3 text-right font-mono text-sm whitespace-nowrap">
                        {forecast.currentDailyUsage}/day
                      </td>
                      <td className="px-3 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end">
                          <span className="font-mono text-sm font-semibold">
                            {forecast.forecastedDailyUsage}/day
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({forecast.confidenceInterval.low}–{forecast.confidenceInterval.high})
                          </span>
                        </div>
                      </td>
                      <td className="px-3 text-right whitespace-nowrap">
                        <Badge 
                          variant={
                            forecast.confidence === 'high' ? 'default' :
                            forecast.confidence === 'medium' ? 'secondary' : 'outline'
                          }
                          data-testid={`confidence-${forecast.itemId}`}
                        >
                          {forecast.confidence}
                        </Badge>
                      </td>
                      <td className="px-3 text-center whitespace-nowrap">
                        {forecast.trend === 'increasing' ? (
                          <ArrowUp className="h-4 w-4 text-green-600 inline" data-testid={`trend-${forecast.itemId}`} />
                        ) : forecast.trend === 'decreasing' ? (
                          <ArrowDown className="h-4 w-4 text-red-600 inline" data-testid={`trend-${forecast.itemId}`} />
                        ) : (
                          <Minus className="h-4 w-4 text-muted-foreground inline" data-testid={`trend-${forecast.itemId}`} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ad & Demand Signals */}
      <AdDemandSignals variant="dashboard" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Production Capacity Calculator */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Production Capacity</CardTitle>
            <p className="text-sm text-muted-foreground">Maximum producible units</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Max Units</span>
              <span className="text-2xl font-bold" data-testid="text-max-units">
                {productionCapacity.maxUnits}
              </span>
            </div>
            {productionCapacity.constraints && productionCapacity.constraints.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">Component Availability</p>
                {productionCapacity.constraints.map((constraint: any, index: number) => (
                  <div key={index} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{constraint.name}</span>
                      <span className="font-mono text-xs">
                        {constraint.available}/{constraint.required}
                      </span>
                    </div>
                    <Progress value={(constraint.available / constraint.required) * 100} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <Package className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No constraints calculated. Add components with Bill of Materials to see production limits.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Supplier Quick-Order Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Supplier Quick-Order</CardTitle>
            <p className="text-sm text-muted-foreground">Open supplier catalogs</p>
          </CardHeader>
          <CardContent>
            {suppliers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Package className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium text-muted-foreground">No suppliers yet</p>
                <p className="text-sm text-muted-foreground">Add suppliers with catalog URLs to enable quick ordering.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {suppliers.slice(0, 4).map((supplier: any) => (
                  <Card key={supplier.id}>
                    <CardContent className="flex flex-col items-center gap-3 pt-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                        <Package className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-sm">{supplier.name}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => supplier.catalogUrl && window.open(supplier.catalogUrl, '_blank')}
                        disabled={!supplier.catalogUrl}
                        data-testid={`button-supplier-${supplier.id}`}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open Catalog
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Integration Health Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Integration Health</CardTitle>
          <p className="text-sm text-muted-foreground">Service connection status and manual sync</p>
        </CardHeader>
        <CardContent>
          {integrations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Activity className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium text-muted-foreground">No integrations configured</p>
              <p className="text-sm text-muted-foreground">Connect Shopify, Amazon, or other services via AI Agent → Data Sources.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {integrations.map((integration: any) => (
                <Card key={integration.id || integration.name}>
                  <CardContent className="flex flex-col gap-3 pt-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                        <Activity className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{integration.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div
                            className={`h-2 w-2 rounded-full ${
                              settingsLoading || settingsError
                                ? 'bg-muted-foreground'
                                : !isIntegrationConfigured(integration)
                                ? 'bg-muted-foreground'
                                : integration.status === 'success' || integration.status === 'connected'
                                ? 'bg-status-online'
                                : integration.status === 'failed' || integration.status === 'error'
                                ? 'bg-status-busy'
                                : 'bg-status-away'
                            }`}
                            data-testid={`status-${integration.id}`}
                          />
                          <span className="text-xs font-medium" data-testid={`status-text-${integration.id}`}>
                            {settingsLoading 
                              ? 'Checking...'
                              : settingsError
                              ? 'Error loading config'
                              : !isIntegrationConfigured(integration)
                              ? 'Not configured' 
                              : integration.status === 'success' || integration.status === 'connected'
                              ? 'Connected' 
                              : integration.status === 'failed' || integration.status === 'error'
                              ? 'Failed'
                              : 'Pending Test'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Last sync: {integration.lastSync || 'Never'}</p>
                      </div>
                    </div>
                    {integration.errorMessage && (
                      <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2">
                        <p className="text-xs text-destructive" data-testid={`error-${integration.id}`}>
                          {integration.errorMessage}
                        </p>
                      </div>
                    )}
                    {integration.lastAlertAt && !integration.errorMessage && (
                      <div className="text-xs text-muted-foreground">
                        Last alert: {integration.lastAlertAt}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSync(integration)}
                      disabled={!integration.id || syncingIntegration === integration.id}
                      data-testid={`button-sync-${integration.id}`}
                      className="w-full"
                    >
                      <RefreshCw className={`mr-2 h-4 w-4 ${syncingIntegration === integration.id ? 'animate-spin' : ''}`} />
                      {syncingIntegration === integration.id ? 'Syncing...' : 'Sync Now'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI System Suggestions (Weekly LLM Review) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">System Suggestions</CardTitle>
            </div>
            {systemRecommendationsData?.summary && systemRecommendationsData.summary.new > 0 && (
              <Badge variant="default" data-testid="badge-new-suggestions">
                {systemRecommendationsData.summary.new} new
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">AI-generated improvement recommendations from weekly system review</p>
        </CardHeader>
        <CardContent>
          {isLoadingSystemRecs ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading suggestions...</p>
          ) : !systemRecommendationsData?.recommendations || systemRecommendationsData.recommendations.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground mb-2">No new suggestions</p>
              <p className="text-xs text-muted-foreground">
                The AI reviews system logs weekly and will suggest improvements when issues are detected.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {systemRecommendationsData.recommendations.slice(0, 5).map((rec) => (
                <div 
                  key={rec.id} 
                  className="flex items-start gap-3 p-3 rounded-md border"
                  data-testid={`system-suggestion-${rec.id}`}
                >
                  <div className="mt-0.5">
                    {rec.severity === "CRITICAL" ? (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    ) : rec.severity === "HIGH" ? (
                      <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    ) : rec.severity === "MEDIUM" ? (
                      <Info className="h-4 w-4 text-blue-500" />
                    ) : (
                      <Lightbulb className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm truncate">{rec.title}</p>
                      <Badge 
                        variant={
                          rec.severity === "CRITICAL" ? "destructive" :
                          rec.severity === "HIGH" ? "default" : 
                          "secondary"
                        }
                        className="shrink-0"
                      >
                        {rec.severity.toLowerCase()}
                      </Badge>
                      <Badge variant="outline" className="shrink-0">
                        {rec.category.toLowerCase().replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{rec.description}</p>
                  </div>
                </div>
              ))}
              {systemRecommendationsData.summary.new > 5 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  +{systemRecommendationsData.summary.new - 5} more suggestions. View all in AI Agent Insights.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
