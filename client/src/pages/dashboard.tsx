import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, TrendingUp, Package, Clock, ExternalLink, Activity, RefreshCw, Brain, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function Dashboard() {
  const [syncingIntegration, setSyncingIntegration] = useState<string | null>(null);
  const [llmRecommendation, setLlmRecommendation] = useState<string | null>(null);
  const [isGeneratingForecast, setIsGeneratingForecast] = useState(false);
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

  // Sync mutation - must be before early return to avoid hooks violation
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

  const generateLLMForecast = async () => {
    if (!settingsData) {
      toast({
        title: "Configuration Required",
        description: "Please configure an LLM provider in Settings first.",
        variant: "destructive",
      });
      return;
    }

    if (!settingsData.llmProvider || !settingsData.llmApiKey) {
      toast({
        title: "LLM Not Configured",
        description: "Please add your LLM provider and API key in Settings.",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingForecast(true);
    try {
      const payload = {
        atRiskItems: atRiskItems.slice(0, 5),
        inventoryValue: metrics.inventoryValue,
        daysUntilStockout: metrics.daysUntilStockout,
        productionCapacity: metrics.productionCapacity,
      };

      const res = await apiRequest("POST", "/api/llm/ask", {
        provider: settingsData.llmProvider,
        apiKey: settingsData.llmApiKey,
        customEndpoint: settingsData.llmCustomEndpoint,
        taskType: "forecast",
        payload,
      });

      const data = await res.json();
      setLlmRecommendation(data.answer || data.result || "No recommendation generated");
      toast({
        title: "Forecast Generated",
        description: "AI-powered recommendations are ready",
      });
    } catch (error: any) {
      toast({
        title: "Forecast Failed",
        description: error.message || "Failed to generate AI forecast",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingForecast(false);
    }
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

  const metrics = dashboardData?.metrics ?? {
    inventoryValue: 0,
    daysUntilStockout: 0,
    productionCapacity: 0,
    activeAlerts: 0
  };

  const forecast = dashboardData?.forecast ?? {
    constraint: "No data available",
    daysRemaining: 0
  };

  const atRiskItems = (dashboardData?.atRiskItems ?? []) as any[];
  const productionCapacity = dashboardData?.productionCapacity ?? {
    maxUnits: 0,
    constraints: []
  };
  const suppliers = (dashboardData?.suppliers ?? []) as any[];
  const integrations = (dashboardData?.integrations ?? []) as any[];

  // Helper to check if an integration is configured (has API key)
  const isIntegrationConfigured = (integration: any): boolean => {
    if (!integration.settingsKey || !settingsData) return false;
    return !!settingsData[integration.settingsKey];
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Operational overview and inventory forecasting</p>
      </div>

      {/* Metrics Panel */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-inventory-value">
              ${metrics.inventoryValue.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Current stock value</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Days Until Stockout</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-stockout-days">
              {metrics.daysUntilStockout}
            </div>
            <p className="text-xs text-muted-foreground">Based on current usage</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Production Capacity</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-production-capacity">
              {metrics.productionCapacity}
            </div>
            <p className="text-xs text-muted-foreground">Units can be produced</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-active-alerts">
              {metrics.activeAlerts}
            </div>
            <p className="text-xs text-muted-foreground">Items need attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Forecast Section */}
      <Card className="border-destructive/50 bg-destructive/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-lg">Inventory Forecast</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-base" data-testid="text-forecast">
            <span className="font-semibold">You will stock out in {forecast.daysRemaining} days</span>
            {forecast.constraint && (
              <>
                , constraint = <span className="font-mono">{forecast.constraint}</span>
              </>
            )}
          </p>
        </CardContent>
      </Card>

      {/* AI-Powered Recommendations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">AI-Powered Recommendations</CardTitle>
            <p className="text-sm text-muted-foreground">Get intelligent inventory insights</p>
          </div>
          <Button
            onClick={generateLLMForecast}
            disabled={isGeneratingForecast}
            size="sm"
            data-testid="button-generate-forecast"
          >
            {isGeneratingForecast ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>Generate Forecast</>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          {llmRecommendation ? (
            <div className="rounded-md bg-muted p-4" data-testid="text-llm-recommendation">
              <p className="whitespace-pre-wrap text-sm">{llmRecommendation}</p>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Click "Generate Forecast" to get AI-powered inventory recommendations based on your current stock levels and usage patterns.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Smart Analytics */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Smart Analytics</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">AI-powered insights based on usage patterns and sales data</p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="recommendations" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="recommendations" data-testid="tab-recommendations">
                Reorder Recommendations
              </TabsTrigger>
              <TabsTrigger value="forecasts" data-testid="tab-forecasts">
                Demand Forecasts
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="recommendations" className="space-y-4">
              {isLoadingRecommendations ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading recommendations...</p>
              ) : !reorderRecommendations || reorderRecommendations.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No reorder recommendations at this time</p>
              ) : (
                <div className="space-y-3">
                  {reorderRecommendations.slice(0, 5).map((rec: any) => (
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
            </TabsContent>
            
            <TabsContent value="forecasts" className="space-y-4">
              {isLoadingForecasts ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading forecasts...</p>
              ) : !demandForecasts || demandForecasts.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No demand forecasts available</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Current Usage</TableHead>
                      <TableHead className="text-right">Forecast</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                      <TableHead className="text-center">Trend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {demandForecasts.slice(0, 10).map((forecast: any) => (
                      <TableRow key={forecast.itemId}>
                        <TableCell className="font-medium">{forecast.itemName}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {forecast.currentDailyUsage}/day
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end">
                            <span className="font-mono text-sm font-semibold">
                              {forecast.forecastedDailyUsage}/day
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ({forecast.confidenceInterval.low}–{forecast.confidenceInterval.high})
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge 
                            variant={
                              forecast.confidence === 'high' ? 'default' :
                              forecast.confidence === 'medium' ? 'secondary' : 'outline'
                            }
                            data-testid={`confidence-${forecast.itemId}`}
                          >
                            {forecast.confidence}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {forecast.trend === 'increasing' ? (
                            <ArrowUp className="h-4 w-4 text-green-600 inline" data-testid={`trend-${forecast.itemId}`} />
                          ) : forecast.trend === 'decreasing' ? (
                            <ArrowDown className="h-4 w-4 text-red-600 inline" data-testid={`trend-${forecast.itemId}`} />
                          ) : (
                            <Minus className="h-4 w-4 text-muted-foreground inline" data-testid={`trend-${forecast.itemId}`} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* At-Risk Items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top 5 At-Risk Items</CardTitle>
            <p className="text-sm text-muted-foreground">Lowest days of cover</p>
          </CardHeader>
          <CardContent>
            {atRiskItems.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No at-risk items</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Daily Usage</TableHead>
                    <TableHead className="text-right">Days of Cover</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {atRiskItems.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                      <TableCell className="text-right">{item.currentStock}</TableCell>
                      <TableCell className="text-right">{item.dailyUsage}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={item.daysOfCover < 7 ? "destructive" : "secondary"}>
                          {item.daysOfCover} days
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" data-testid={`button-order-${item.id}`}>
                          Order Now
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

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
              <p className="py-4 text-center text-sm text-muted-foreground">No production constraints</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Supplier Quick-Order Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Supplier Quick-Order</CardTitle>
          <p className="text-sm text-muted-foreground">Open supplier catalogs</p>
        </CardHeader>
        <CardContent>
          {suppliers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No suppliers configured</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {suppliers.map((supplier: any) => (
                <Card key={supplier.id}>
                  <CardContent className="flex flex-col items-center gap-4 pt-6">
                    <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
                      <Package className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="text-center">
                      <p className="font-medium">{supplier.name}</p>
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

      {/* Integration Health Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Integration Health</CardTitle>
          <p className="text-sm text-muted-foreground">Service connection status and manual sync</p>
        </CardHeader>
        <CardContent>
          {integrations.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No integrations configured</p>
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
                              integration.status === 'success'
                                ? 'bg-status-online'
                                : integration.status === 'stale'
                                ? 'bg-status-away'
                                : 'bg-status-busy'
                            }`}
                            data-testid={`status-${integration.id}`}
                          />
                          <span className="text-xs font-medium" data-testid={`status-text-${integration.id}`}>
                            {settingsLoading 
                              ? 'Checking...'
                              : settingsError
                              ? (integration.status === 'success' ? 'Connected' : integration.status === 'stale' ? 'Stale' : integration.status === 'failed' ? 'Disconnected' : integration.status || 'Unknown')
                              : !isIntegrationConfigured(integration)
                              ? 'Not configured' 
                              : integration.lastSync === 'Never' && !integration.errorMessage
                              ? 'Configured, never synced'
                              : integration.status === 'success' 
                              ? 'Connected' 
                              : integration.status === 'stale' 
                              ? 'Stale'
                              : integration.status === 'failed'
                              ? 'Disconnected'
                              : integration.status || 'Unknown'}
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
    </div>
  );
}
