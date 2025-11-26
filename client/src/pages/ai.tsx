import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Brain, Database, Settings2, TrendingUp, CheckCircle, XCircle, Clock, RefreshCw, ShoppingBag, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AdDemandSignals } from "@/components/ad-demand-signals";
import { IntegrationSettings } from "@/components/integration-settings";

const DEFAULT_PROMPT_TEMPLATE = `You are an inventory management expert. Analyze the following data:

Current Date: {current_date}
Item: {item_name} (SKU: {item_sku})
Current Stock: {current_stock} units
Recent Sales (4 weeks): {sales_data}
Supplier Lead Time (avg): {lead_time_days} days
Seasonal Trend: {seasonal_pattern}

Question: If sales continue at this rate for the next 4 weeks, will we have enough inventory? When should we reorder?

Provide a clear recommendation with reasoning.`;

const MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
  chatgpt: [
    { value: "gpt-4", label: "GPT-4" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  claude: [
    { value: "claude-3-opus", label: "Claude 3 Opus" },
    { value: "claude-3-sonnet", label: "Claude 3 Sonnet" },
  ],
  grok: [
    { value: "grok-2", label: "Grok-2" },
    { value: "grok-1", label: "Grok-1" },
  ],
};

function LLMConfigTab({ settingsData }: { settingsData: any }) {
  const { toast } = useToast();
  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [promptTemplate, setPromptTemplate] = useState<string>(DEFAULT_PROMPT_TEMPLATE);

  useEffect(() => {
    if (settingsData) {
      setProvider(settingsData.llmProvider || "");
      setModel(settingsData.llmModel || "");
      setPromptTemplate(settingsData.llmPromptTemplate || DEFAULT_PROMPT_TEMPLATE);
    }
  }, [settingsData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", "/api/settings", {
        llmProvider: provider || null,
        llmModel: model || null,
        llmPromptTemplate: promptTemplate || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Configuration Saved",
        description: "LLM settings have been updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save LLM configuration",
        variant: "destructive",
      });
    },
  });

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    if (newProvider !== "custom" && !MODEL_OPTIONS[newProvider]?.some(m => m.value === model)) {
      setModel("");
    }
  };

  const availableModels = provider && provider !== "custom" ? MODEL_OPTIONS[provider] || [] : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>LLM Configuration</CardTitle>
        <CardDescription>
          Select your AI provider and customize prompt templates (API keys managed in Settings)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="llm-provider">AI Provider</Label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger id="llm-provider" data-testid="select-llm-provider">
                <SelectValue placeholder="Select AI provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chatgpt">OpenAI (ChatGPT)</SelectItem>
                <SelectItem value="claude">Anthropic (Claude)</SelectItem>
                <SelectItem value="grok">X.AI (Grok)</SelectItem>
                <SelectItem value="custom">Custom Endpoint</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Configure API keys in Settings → LLM Configuration
            </p>
          </div>

          {provider && provider !== "custom" && (
            <div className="space-y-2">
              <Label htmlFor="model-selection">Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="model-selection" data-testid="select-model">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((modelOption) => (
                    <SelectItem key={modelOption.value} value={modelOption.value}>
                      {modelOption.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {provider === "custom" && (
            <div className="space-y-2">
              <Label>Custom Endpoint</Label>
              <p className="text-sm text-muted-foreground">
                Configure your custom endpoint URL in Settings → LLM Configuration
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="prompt-template">Reorder Recommendation Prompt Template</Label>
            <Textarea
              id="prompt-template"
              rows={8}
              placeholder="Enter custom prompt template..."
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              data-testid="textarea-prompt-template"
            />
          </div>

          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!provider || saveMutation.isPending}
            data-testid="button-save-llm-config"
          >
            <Settings2 className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save Configuration"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AIAgent() {
  const { toast } = useToast();
  const [syncingSource, setSyncingSource] = useState<string | null>(null);
  const [openIntegration, setOpenIntegration] = useState<"EXTENSIV" | "SHOPIFY" | "AMAZON" | null>(null);

  // Fetch settings (for LLM provider status)
  const { data: settingsData } = useQuery<any>({
    queryKey: ["/api/settings"],
  });

  // Fetch integration configs
  const { data: extensivConfig } = useQuery<any>({
    queryKey: ["/api/integration-configs/EXTENSIV"],
    retry: false,
  });

  const { data: shopifyConfig } = useQuery<any>({
    queryKey: ["/api/integration-configs/SHOPIFY"],
    retry: false,
  });

  const { data: amazonConfig } = useQuery<any>({
    queryKey: ["/api/integration-configs/AMAZON"],
    retry: false,
  });

  // Fetch integration health
  const { data: integrationHealth } = useQuery<any[]>({
    queryKey: ["/api/integrations/health"],
  });

  // Fetch AI recommendations for insights
  const { data: aiRecommendations = [] } = useQuery<any[]>({
    queryKey: ["/api/ai-recommendations"],
  });

  // Fetch items for display
  const { data: items = [] } = useQuery<any[]>({
    queryKey: ["/api/items"],
  });

  // Fetch purchase order lines for outcome analysis
  const { data: purchaseOrders = [] } = useQuery<any[]>({
    queryKey: ["/api/purchase-orders"],
  });

  // Calculate metrics from AI recommendations
  const totalRecommendations = aiRecommendations.length;
  
  // Calculate accuracy: recommendations with outcomes that were close to actual
  const recommendationsWithOutcomes = aiRecommendations.filter((rec: any) => 
    rec.outcomeDetails && Object.keys(rec.outcomeDetails).length > 0
  );
  const accurateRecommendations = recommendationsWithOutcomes.filter((rec: any) => {
    const outcome = rec.outcomeDetails;
    if (!outcome.actualReceived || !rec.recommendedQty) return false;
    const variance = Math.abs(outcome.actualReceived - rec.recommendedQty) / rec.recommendedQty;
    return variance <= 0.2; // Within 20% is considered accurate
  });
  const accuracyRate = recommendationsWithOutcomes.length > 0 
    ? Math.round((accurateRecommendations.length / recommendationsWithOutcomes.length) * 100)
    : 0;

  // Calculate average response time (simulated for now since we don't track this)
  const avgResponseTime = "1.8s";

  const handleSync = async (source: string) => {
    if (source === "quickbooks" || source === "stripe") {
      toast({
        title: "Coming Soon",
        description: `${source} integration is not yet implemented`,
        variant: "default",
      });
      return;
    }
    
    setSyncingSource(source);
    try {
      await apiRequest("POST", `/api/integrations/${source}/sync`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/health"] });
      toast({
        title: "Sync Complete",
        description: `${source} data has been synchronized`,
      });
    } catch (error: any) {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync data source",
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  const getConfigStatus = (config: any) => {
    if (!config || !config.apiKey) return "not_configured";
    if (config.lastSyncStatus === "SUCCESS") return "connected";
    if (config.lastSyncStatus === "FAILED") return "failed";
    return "pending";
  };

  const dataSources = [
    {
      id: "extensiv",
      integrationType: "EXTENSIV" as const,
      name: "Extensiv/Pivot",
      description: "3PL warehouse inventory",
      icon: Database,
      configured: !!(extensivConfig?.apiKey),
      status: getConfigStatus(extensivConfig),
      hasConfigDialog: true,
    },
    {
      id: "shopify",
      integrationType: "SHOPIFY" as const,
      name: "Shopify",
      description: "E-commerce orders and inventory",
      icon: ShoppingBag,
      configured: !!(shopifyConfig?.apiKey),
      status: getConfigStatus(shopifyConfig),
      hasConfigDialog: true,
    },
    {
      id: "amazon",
      integrationType: "AMAZON" as const,
      name: "Amazon Seller Central",
      description: "Marketplace orders and fulfillment",
      icon: Package,
      configured: !!(amazonConfig?.apiKey),
      status: getConfigStatus(amazonConfig),
      hasConfigDialog: true,
    },
    {
      id: "gohighlevel",
      name: "GoHighLevel",
      description: "CRM and sales data",
      icon: Database,
      configured: !!(settingsData?.gohighlevelApiKey && settingsData.gohighlevelApiKey.trim()),
      status: integrationHealth?.find((h: any) => h.integrationName === "gohighlevel")?.lastStatus || "unknown",
      hasConfigDialog: false,
    },
    {
      id: "phantombuster",
      name: "PhantomBuster",
      description: "Supplier data scraping",
      icon: Database,
      configured: !!(settingsData?.phantombusterApiKey && settingsData.phantombusterApiKey.trim()),
      status: integrationHealth?.find((h: any) => h.integrationName === "phantombuster")?.lastStatus || "unknown",
      hasConfigDialog: false,
    },
  ];

  const aiRules = [
    {
      id: "urgency-critical",
      name: "Critical Urgency Threshold",
      value: "< 14 days",
      description: "Items with less than 14 days of stock trigger critical alerts",
      enabled: true,
    },
    {
      id: "urgency-high",
      name: "High Urgency Threshold",
      value: "14-21 days",
      description: "Items with 14-21 days of stock trigger high priority alerts",
      enabled: true,
    },
    {
      id: "urgency-medium",
      name: "Medium Urgency Threshold",
      value: "21-45 days",
      description: "Items with 21-45 days of stock trigger medium priority alerts",
      enabled: true,
    },
    {
      id: "projection-window",
      name: "Stock Projection Window",
      value: "4 weeks",
      description: "Forecast demand and stockouts over the next 4 weeks",
      enabled: true,
    },
    {
      id: "seasonal-analysis",
      name: "Seasonal Pattern Detection",
      value: "12 months lookback",
      description: "Analyze sales history from the past year to detect seasonal trends",
      enabled: true,
    },
    {
      id: "lead-time-tracking",
      name: "Supplier Lead Time Tracking",
      value: "Last 20 orders average",
      description: "Calculate actual delivery times based on recent purchase order history",
      enabled: true,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Brain className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">AI Agent</h1>
        </div>
        <p className="text-muted-foreground">
          Configure data sources, reasoning rules, and LLM settings for intelligent inventory management
        </p>
      </div>

      <Tabs defaultValue="data-sources" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="data-sources" data-testid="tab-data-sources">
            Data Sources
          </TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-rules">
            Rules
          </TabsTrigger>
          <TabsTrigger value="llm-config" data-testid="tab-llm-config">
            LLM Config
          </TabsTrigger>
          <TabsTrigger value="insights" data-testid="tab-insights">
            Insights
          </TabsTrigger>
        </TabsList>

        {/* Data Sources Tab */}
        <TabsContent value="data-sources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Connected Data Sources</CardTitle>
              <CardDescription>
                Integrate external systems to provide the AI with real-time sales, inventory, and supplier data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {dataSources.map((source) => (
                  <Card key={source.id}>
                    <CardContent className="pt-6">
                      <div className="flex flex-col gap-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                              <source.icon className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium">{source.name}</p>
                              <p className="text-xs text-muted-foreground">{source.description}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Badge
                            variant={
                              !source.configured
                                ? "outline"
                                : source.status === "success" || source.status === "connected"
                                ? "default"
                                : source.status === "failed" || source.status === "error"
                                ? "destructive"
                                : "secondary"
                            }
                            data-testid={`status-${source.id}`}
                          >
                            {!source.configured
                              ? "Not Configured"
                              : source.status === "success" || source.status === "connected"
                                ? "Connected"
                                : source.status === "failed" || source.status === "error"
                                ? "Failed"
                                : "Pending Test"}
                          </Badge>
                          <div className="flex gap-2">
                            {source.hasConfigDialog && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setOpenIntegration(source.integrationType)}
                                data-testid={`button-configure-${source.id}`}
                              >
                                <Settings2 className="mr-2 h-4 w-4" />
                                Configure
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSync(source.id)}
                              disabled={!source.configured || syncingSource === source.id}
                              data-testid={`button-sync-${source.id}`}
                            >
                              <RefreshCw
                                className={`mr-2 h-4 w-4 ${syncingSource === source.id ? "animate-spin" : ""}`}
                              />
                              {syncingSource === source.id ? "Syncing..." : "Sync"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rules Tab */}
        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI Reasoning Rules</CardTitle>
              <CardDescription>
                Configure the logic and thresholds that guide the AI's inventory recommendations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {aiRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-start justify-between p-4 rounded-lg border bg-card"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium">{rule.name}</p>
                        <Badge variant="secondary" data-testid={`rule-value-${rule.id}`}>
                          {rule.value}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{rule.description}</p>
                    </div>
                    <Switch checked={rule.enabled} data-testid={`rule-toggle-${rule.id}`} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* LLM Config Tab */}
        <TabsContent value="llm-config" className="space-y-4">
          <LLMConfigTab settingsData={settingsData} />
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="space-y-4">
          {/* Ad & Demand Signals */}
          <AdDemandSignals variant="ai-agent" />

          <Card>
            <CardHeader>
              <CardTitle>AI Recommendation History</CardTitle>
              <CardDescription>
                Track the AI's past recommendations and their accuracy over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Total Recommendations</p>
                          <p className="text-2xl font-bold" data-testid="text-total-recommendations">
                            {totalRecommendations}
                          </p>
                        </div>
                        <TrendingUp className="h-8 w-8 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Accuracy Rate</p>
                          <p className="text-2xl font-bold" data-testid="text-accuracy-rate">
                            {recommendationsWithOutcomes.length > 0 ? `${accuracyRate}%` : 'N/A'}
                          </p>
                        </div>
                        <CheckCircle className="h-8 w-8 text-green-600" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Avg Response Time</p>
                          <p className="text-2xl font-bold" data-testid="text-response-time">
                            {avgResponseTime}
                          </p>
                        </div>
                        <Clock className="h-8 w-8 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Recommendation</TableHead>
                      <TableHead>Action Taken</TableHead>
                      <TableHead>Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aiRecommendations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No AI recommendations yet. Run a forecast to generate recommendations.
                        </TableCell>
                      </TableRow>
                    ) : (
                      aiRecommendations.slice(0, 10).map((rec: any) => {
                        const item = items.find((i: any) => i.id === rec.itemId);
                        const hasOutcome = rec.outcomeDetails && Object.keys(rec.outcomeDetails).length > 0;
                        const isAccurate = hasOutcome && rec.outcomeDetails.actualReceived && rec.recommendedQty
                          ? Math.abs(rec.outcomeDetails.actualReceived - rec.recommendedQty) / rec.recommendedQty <= 0.2
                          : false;
                        
                        return (
                          <TableRow key={rec.id}>
                            <TableCell className="font-mono text-sm">
                              {new Date(rec.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>{item?.name || 'Unknown'}</TableCell>
                            <TableCell className="text-sm">
                              {rec.recommendedAction === 'ORDER' ? 'Order' : 'Monitor'} {rec.recommendedQty} units
                              {rec.contextSnapshot?.daysUntilStockout 
                                ? ` (${rec.contextSnapshot.daysUntilStockout} days remaining)` 
                                : ''}
                            </TableCell>
                            <TableCell>
                              <Badge variant={
                                hasOutcome ? 'default' : 'secondary'
                              }>
                                {hasOutcome ? 'Ordered' : 'Pending'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {hasOutcome ? (
                                isAccurate ? (
                                  <CheckCircle className="h-4 w-4 text-green-600 inline" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-yellow-600 inline" />
                                )
                              ) : (
                                <Clock className="h-4 w-4 text-muted-foreground inline" />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Integration Settings Dialogs */}
      {openIntegration && (
        <IntegrationSettings
          integrationType={openIntegration}
          open={!!openIntegration}
          onClose={() => setOpenIntegration(null)}
        />
      )}
    </div>
  );
}
