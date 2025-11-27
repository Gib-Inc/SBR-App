import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Brain, Database, Settings2, TrendingUp, CheckCircle, XCircle, Clock, RefreshCw, ShoppingBag, Package, AlertTriangle, Info, Filter, Zap, HelpCircle, Search, FileText, ChevronLeft, ChevronRight, Eye, RotateCcw } from "lucide-react";
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

interface AIRules {
  velocityLookbackDays: number;
  safetyStockDays: number;
  riskThresholdHighDays: number;
  riskThresholdMediumDays: number;
  returnRateImpact: number;
  adDemandImpact: number;
  supplierDisputePenaltyDays: number;
  defaultLeadTimeDays: number;
  minOrderQuantity: number;
}

interface SKURecommendation {
  itemId: string;
  sku: string;
  productName: string;
  riskLevel: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  recommendedAction: "ORDER" | "MONITOR" | "OK";
  recommendedQty: number;
  explanation: string;
  metrics: {
    onHand: number;
    dailySalesVelocity: number;
    projectedDaysUntilStockout: number;
    reorderPoint: number;
    returnRate: number;
    supplierLeadTimeDays: number;
    effectiveLeadTime: number;
    supplierScore: number;
  };
}

interface InsightsResponse {
  recommendations: SKURecommendation[];
  computedAt: string;
  rulesApplied: AIRules;
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
    actionRequired: number;
  };
}

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

function RulesTab() {
  const { toast } = useToast();
  
  // Fetch current rules
  const { data: rules, isLoading } = useQuery<AIRules>({
    queryKey: ["/api/ai/rules"],
  });
  
  // Local state for form
  const [formValues, setFormValues] = useState<AIRules>({
    velocityLookbackDays: 14,
    safetyStockDays: 7,
    riskThresholdHighDays: 0,
    riskThresholdMediumDays: 7,
    returnRateImpact: 0.5,
    adDemandImpact: 0.2,
    supplierDisputePenaltyDays: 3,
    defaultLeadTimeDays: 7,
    minOrderQuantity: 1,
  });
  
  // Sync form with fetched rules
  useEffect(() => {
    if (rules) {
      setFormValues(rules);
    }
  }, [rules]);
  
  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<AIRules>) => {
      return await apiRequest("PATCH", "/api/ai/rules", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/at-risk"] });
      toast({
        title: "Rules Updated",
        description: "AI decision rules have been saved. Recommendations will be recalculated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save AI rules",
        variant: "destructive",
      });
    },
  });
  
  const handleSave = () => {
    saveMutation.mutate(formValues);
  };
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Decision Engine Rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Decision Engine Rules
          </CardTitle>
          <CardDescription>
            Configure the parameters that drive AI-powered inventory recommendations. These rules determine how the engine calculates risk levels, reorder points, and suggested quantities.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Sales Velocity Settings */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Sales Velocity
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="velocity-lookback">Lookback Window</Label>
                  <span className="text-sm text-muted-foreground">{formValues.velocityLookbackDays} days</span>
                </div>
                <Slider
                  id="velocity-lookback"
                  min={7}
                  max={90}
                  step={1}
                  value={[formValues.velocityLookbackDays]}
                  onValueChange={([val]) => setFormValues(prev => ({ ...prev, velocityLookbackDays: val }))}
                  data-testid="slider-velocity-lookback"
                />
                <p className="text-xs text-muted-foreground">
                  Number of days of sales history to analyze for velocity calculation
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="safety-stock">Safety Stock Buffer</Label>
                  <span className="text-sm text-muted-foreground">{formValues.safetyStockDays} days</span>
                </div>
                <Slider
                  id="safety-stock"
                  min={0}
                  max={30}
                  step={1}
                  value={[formValues.safetyStockDays]}
                  onValueChange={([val]) => setFormValues(prev => ({ ...prev, safetyStockDays: val }))}
                  data-testid="slider-safety-stock"
                />
                <p className="text-xs text-muted-foreground">
                  Extra days of inventory to maintain as safety buffer
                </p>
              </div>
            </div>
          </div>
          
          {/* Risk Thresholds */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Risk Thresholds
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="risk-high">High Risk (Critical)</Label>
                  <span className="text-sm text-muted-foreground">&le; {formValues.riskThresholdHighDays} days</span>
                </div>
                <Slider
                  id="risk-high"
                  min={0}
                  max={14}
                  step={1}
                  value={[formValues.riskThresholdHighDays]}
                  onValueChange={([val]) => setFormValues(prev => ({ ...prev, riskThresholdHighDays: val }))}
                  data-testid="slider-risk-high"
                />
                <p className="text-xs text-muted-foreground">
                  Items with this many days (or fewer) until stockout are HIGH risk
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="risk-medium">Medium Risk</Label>
                  <span className="text-sm text-muted-foreground">&le; {formValues.riskThresholdMediumDays} days</span>
                </div>
                <Slider
                  id="risk-medium"
                  min={1}
                  max={30}
                  step={1}
                  value={[formValues.riskThresholdMediumDays]}
                  onValueChange={([val]) => setFormValues(prev => ({ ...prev, riskThresholdMediumDays: val }))}
                  data-testid="slider-risk-medium"
                />
                <p className="text-xs text-muted-foreground">
                  Items with this many days (or fewer) until stockout are MEDIUM risk
                </p>
              </div>
            </div>
          </div>
          
          {/* Impact Weights */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Info className="h-4 w-4" />
              Impact Weights
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="return-rate-impact">Return Rate Impact</Label>
                  <span className="text-sm text-muted-foreground">{Math.round(formValues.returnRateImpact * 100)}%</span>
                </div>
                <Slider
                  id="return-rate-impact"
                  min={0}
                  max={100}
                  step={5}
                  value={[formValues.returnRateImpact * 100]}
                  onValueChange={([val]) => setFormValues(prev => ({ ...prev, returnRateImpact: val / 100 }))}
                  data-testid="slider-return-rate"
                />
                <p className="text-xs text-muted-foreground">
                  How much to factor in historical return rates when calculating order quantities
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ad-demand-impact">Ad Demand Signal Impact</Label>
                  <span className="text-sm text-muted-foreground">{Math.round(formValues.adDemandImpact * 100)}%</span>
                </div>
                <Slider
                  id="ad-demand-impact"
                  min={0}
                  max={100}
                  step={5}
                  value={[formValues.adDemandImpact * 100]}
                  onValueChange={([val]) => setFormValues(prev => ({ ...prev, adDemandImpact: val / 100 }))}
                  data-testid="slider-ad-demand"
                />
                <p className="text-xs text-muted-foreground">
                  How much to boost demand projections when ad campaigns are active
                </p>
              </div>
            </div>
          </div>
          
          {/* Supplier & Lead Time */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Package className="h-4 w-4" />
              Supplier & Lead Time
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="default-lead-time">Default Lead Time</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="default-lead-time"
                    type="number"
                    min={1}
                    max={60}
                    value={formValues.defaultLeadTimeDays}
                    onChange={(e) => setFormValues(prev => ({ ...prev, defaultLeadTimeDays: parseInt(e.target.value) || 7 }))}
                    data-testid="input-default-lead-time"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">days</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Used when supplier lead time is unknown
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="dispute-penalty">Dispute Penalty</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="dispute-penalty"
                    type="number"
                    min={0}
                    max={14}
                    value={formValues.supplierDisputePenaltyDays}
                    onChange={(e) => setFormValues(prev => ({ ...prev, supplierDisputePenaltyDays: parseInt(e.target.value) || 0 }))}
                    data-testid="input-dispute-penalty"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">days</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Extra buffer for suppliers with dispute history
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="min-order-qty">Min Order Quantity</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="min-order-qty"
                    type="number"
                    min={1}
                    max={1000}
                    value={formValues.minOrderQuantity}
                    onChange={(e) => setFormValues(prev => ({ ...prev, minOrderQuantity: parseInt(e.target.value) || 1 }))}
                    data-testid="input-min-order-qty"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">units</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Minimum quantity for any order recommendation
                </p>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="border-t pt-6">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid="button-save-rules"
          >
            <Settings2 className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save Rules"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function InsightsTab() {
  const { toast } = useToast();
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [selectedItem, setSelectedItem] = useState<SKURecommendation | null>(null);
  
  // Fetch insights from decision engine
  const { data: insights, isLoading, refetch, isFetching } = useQuery<InsightsResponse>({
    queryKey: ["/api/ai/insights"],
  });
  
  // Refresh mutation
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/ai/insights?refresh=true", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to refresh");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/insights"] });
      toast({
        title: "Recommendations Refreshed",
        description: "AI has recalculated all inventory recommendations",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Refresh Failed",
        description: error.message || "Failed to refresh recommendations",
        variant: "destructive",
      });
    },
  });
  
  // Filter recommendations
  const filteredRecommendations = (insights?.recommendations || []).filter(rec => {
    if (riskFilter !== "all" && rec.riskLevel !== riskFilter) return false;
    if (actionFilter !== "all" && rec.recommendedAction !== actionFilter) return false;
    return true;
  });
  
  const getRiskBadgeVariant = (risk: string) => {
    switch (risk) {
      case "HIGH": return "destructive";
      case "MEDIUM": return "secondary";
      case "LOW": return "outline";
      default: return "outline";
    }
  };
  
  const getActionBadgeVariant = (action: string) => {
    switch (action) {
      case "ORDER": return "default";
      case "MONITOR": return "secondary";
      default: return "outline";
    }
  };
  
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Ad Demand Signals */}
      <AdDemandSignals variant="ai-agent" />
      
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold" data-testid="text-total-skus">{insights?.summary.total || 0}</p>
              <p className="text-sm text-muted-foreground">Total SKUs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-destructive" data-testid="text-high-risk">{insights?.summary.high || 0}</p>
              <p className="text-sm text-muted-foreground">High Risk</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-orange-500" data-testid="text-medium-risk">{insights?.summary.medium || 0}</p>
              <p className="text-sm text-muted-foreground">Medium Risk</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600" data-testid="text-low-risk">{insights?.summary.low || 0}</p>
              <p className="text-sm text-muted-foreground">Low Risk</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-primary" data-testid="text-action-required">{insights?.summary.actionRequired || 0}</p>
              <p className="text-sm text-muted-foreground">Need Order</p>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Recommendations Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle>SKU Recommendations</CardTitle>
              <CardDescription>
                AI-generated inventory recommendations based on sales velocity, stock levels, and risk factors
                {insights?.computedAt && (
                  <span className="block text-xs mt-1">
                    Last computed: {new Date(insights.computedAt).toLocaleString()}
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger className="w-32" data-testid="select-risk-filter">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Risk" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Risks</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-32" data-testid="select-action-filter">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="ORDER">Order</SelectItem>
                  <SelectItem value="MONITOR">Monitor</SelectItem>
                  <SelectItem value="OK">OK</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending || isFetching}
                data-testid="button-refresh-insights"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshMutation.isPending || isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">SKU</TableHead>
                  <TableHead className="whitespace-nowrap">Product</TableHead>
                  <TableHead className="whitespace-nowrap text-right">On Hand</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Velocity</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Days Left</TableHead>
                  <TableHead className="whitespace-nowrap">Risk</TableHead>
                  <TableHead className="whitespace-nowrap">Action</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Rec. Qty</TableHead>
                  <TableHead className="whitespace-nowrap text-center">Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecommendations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8 whitespace-nowrap">
                      {insights?.recommendations.length === 0 
                        ? "No inventory data available. Add items to see recommendations."
                        : "No items match the selected filters."
                      }
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRecommendations.map((rec) => (
                    <TableRow key={rec.itemId} data-testid={`row-recommendation-${rec.itemId}`}>
                      <TableCell className="font-mono text-sm whitespace-nowrap">{rec.sku}</TableCell>
                      <TableCell className="whitespace-nowrap max-w-[200px] truncate" title={rec.productName}>
                        {rec.productName}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{rec.metrics?.onHand ?? 0}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {(rec.metrics?.dailySalesVelocity ?? 0).toFixed(1)}/day
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {Math.floor(rec.metrics?.projectedDaysUntilStockout ?? 0)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={getRiskBadgeVariant(rec.riskLevel)} data-testid={`badge-risk-${rec.itemId}`}>
                          {rec.riskLevel}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={getActionBadgeVariant(rec.recommendedAction)} data-testid={`badge-action-${rec.itemId}`}>
                          {rec.recommendedAction}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {rec.recommendedQty > 0 ? rec.recommendedQty : "-"}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setSelectedItem(rec)}
                              data-testid={`button-why-${rec.itemId}`}
                            >
                              <HelpCircle className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View explanation</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
      
      {/* Why Modal */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              AI Recommendation Explanation
            </DialogTitle>
            <DialogDescription>
              {selectedItem?.productName} ({selectedItem?.sku})
            </DialogDescription>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={getRiskBadgeVariant(selectedItem.riskLevel)}>
                  {selectedItem.riskLevel} Risk
                </Badge>
                <Badge variant={getActionBadgeVariant(selectedItem.recommendedAction)}>
                  {selectedItem.recommendedAction}
                </Badge>
                {selectedItem.recommendedQty > 0 && (
                  <Badge variant="outline">
                    Order {selectedItem.recommendedQty} units
                  </Badge>
                )}
              </div>
              
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm" data-testid="text-explanation">{selectedItem.explanation}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">On Hand</p>
                  <p className="font-medium">{selectedItem.metrics?.onHand ?? 0} units</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Daily Velocity</p>
                  <p className="font-medium">{(selectedItem.metrics?.dailySalesVelocity ?? 0).toFixed(2)} units/day</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Days Until Stockout</p>
                  <p className="font-medium">{Math.floor(selectedItem.metrics?.projectedDaysUntilStockout ?? 0)} days</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Reorder Point</p>
                  <p className="font-medium">{selectedItem.metrics?.reorderPoint ?? 0} units</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Return Rate</p>
                  <p className="font-medium">{((selectedItem.metrics?.returnRate ?? 0) * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Supplier Lead Time</p>
                  <p className="font-medium">{selectedItem.metrics?.supplierLeadTimeDays ?? 7} days</p>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2">
                {(selectedItem.metrics?.supplierScore ?? 100) < 80 && (
                  <Badge variant="outline" className="text-xs text-orange-600">
                    Supplier Score: {selectedItem.metrics?.supplierScore ?? 0}/100
                  </Badge>
                )}
                {(selectedItem.metrics?.returnRate ?? 0) > 0.1 && (
                  <Badge variant="outline" className="text-xs text-yellow-600">
                    High Return Rate
                  </Badge>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface AuditLogEntry {
  id: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  source: string | null;
  status: string | null;
  description: string | null;
  metadata: Record<string, any> | null;
  performedByUserId: string | null;
  createdAt: string;
}

interface LogsResponse {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function LogsTab() {
  const [page, setPage] = useState(1);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  
  const pageSize = 25;
  
  // Build query params
  const queryParams = new URLSearchParams();
  queryParams.set("page", page.toString());
  queryParams.set("pageSize", pageSize.toString());
  if (eventTypeFilter !== "all") queryParams.set("eventType", eventTypeFilter);
  if (entityTypeFilter !== "all") queryParams.set("entityType", entityTypeFilter);
  if (sourceFilter !== "all") queryParams.set("source", sourceFilter);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (searchQuery) queryParams.set("search", searchQuery);
  
  const { data: logsData, isLoading, refetch, isFetching } = useQuery<LogsResponse>({
    queryKey: ["/api/ai/logs", page, eventTypeFilter, entityTypeFilter, sourceFilter, statusFilter, searchQuery],
    queryFn: async () => {
      const response = await fetch(`/api/ai/logs?${queryParams.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch logs");
      return response.json();
    },
  });
  
  const eventTypes = [
    "PO_CREATED",
    "PO_SENT_GHL_EMAIL",
    "PO_SENT_GHL_SMS",
    "PO_SEND_FAILED",
    "SALES_ORDER_IMPORTED",
    "RETURN_CREATED",
    "RETURN_LABEL_ISSUED",
    "RETURN_RECEIVED",
    "INVENTORY_UPDATED",
    "AI_RECOMMENDATION",
    "INTEGRATION_SYNC",
    "SHOPIFY_SYNC",
    "AMAZON_SYNC",
  ];
  
  const entityTypes = ["PO", "ORDER", "RETURN", "ITEM", "SUPPLIER"];
  const sources = ["SYSTEM", "USER", "SHOPIFY", "AMAZON", "GHL", "EXTENSIV"];
  const statuses = ["SUCCESS", "FAILED", "PENDING", "INFO"];
  
  const getStatusBadgeVariant = (status: string | null) => {
    switch (status?.toUpperCase()) {
      case "SUCCESS": return "default" as const;
      case "FAILED": return "destructive" as const;
      case "PENDING": return "secondary" as const;
      default: return "outline" as const;
    }
  };
  
  const getEventIcon = (eventType: string) => {
    if (eventType.includes("PO")) return <FileText className="h-4 w-4" />;
    if (eventType.includes("RETURN")) return <RotateCcw className="h-4 w-4" />;
    if (eventType.includes("ORDER") || eventType.includes("SALES")) return <ShoppingBag className="h-4 w-4" />;
    if (eventType.includes("SYNC")) return <RefreshCw className="h-4 w-4" />;
    return <Info className="h-4 w-4" />;
  };
  
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };
  
  const handleClearFilters = () => {
    setEventTypeFilter("all");
    setEntityTypeFilter("all");
    setSourceFilter("all");
    setStatusFilter("all");
    setSearchQuery("");
    setPage(1);
  };
  
  const hasActiveFilters = eventTypeFilter !== "all" || entityTypeFilter !== "all" || sourceFilter !== "all" || statusFilter !== "all" || searchQuery !== "";
  
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-96" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                System Logs
              </CardTitle>
              <CardDescription>
                Track all system events including order imports, returns, PO sending, and AI decisions
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="button-refresh-logs"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>
            
            <Select value={eventTypeFilter} onValueChange={(v) => { setEventTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]" data-testid="select-event-type">
                <SelectValue placeholder="Event Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                {eventTypes.map((type) => (
                  <SelectItem key={type} value={type}>{type.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={entityTypeFilter} onValueChange={(v) => { setEntityTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]" data-testid="select-entity-type">
                <SelectValue placeholder="Entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {entityTypes.map((type) => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[130px]" data-testid="select-source">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {sources.map((source) => (
                  <SelectItem key={source} value={source}>{source}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[120px]" data-testid="select-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {statuses.map((status) => (
                  <SelectItem key={status} value={status}>{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                className="pl-8 w-[180px]"
                data-testid="input-search-logs"
              />
            </div>
            
            {hasActiveFilters && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleClearFilters}
                data-testid="button-clear-filters"
              >
                <XCircle className="mr-1 h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
          
          {/* Logs Table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px] whitespace-nowrap">Timestamp</TableHead>
                  <TableHead className="w-[180px] whitespace-nowrap">Event</TableHead>
                  <TableHead className="w-[100px] whitespace-nowrap">Entity</TableHead>
                  <TableHead className="w-[100px] whitespace-nowrap">Source</TableHead>
                  <TableHead className="w-[100px] whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap">Description</TableHead>
                  <TableHead className="w-[60px] whitespace-nowrap">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsData?.logs && logsData.logs.length > 0 ? (
                  logsData.logs.map((log) => (
                    <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDate(log.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          {getEventIcon(log.eventType)}
                          <span className="text-sm font-medium">{log.eventType.replace(/_/g, " ")}</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {log.entityType ? (
                          <Badge variant="outline" className="text-xs">
                            {log.entityType}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {log.source || "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {log.status ? (
                          <Badge variant={getStatusBadgeVariant(log.status)} className="text-xs">
                            {log.status}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm max-w-[300px] truncate">
                        {log.description || "-"}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setSelectedLog(log)}
                          data-testid={`button-view-log-${log.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <FileText className="h-8 w-8" />
                        <p>No logs found</p>
                        {hasActiveFilters && (
                          <Button size="sm" variant="link" onClick={handleClearFilters}>
                            Clear filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          
          {/* Pagination */}
          {logsData && logsData.totalPages > 1 && (
            <div className="flex items-center justify-between px-2">
              <p className="text-sm text-muted-foreground">
                Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, logsData.total)} of {logsData.total} logs
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground px-2">
                  Page {page} of {logsData.totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage(p => Math.min(logsData.totalPages, p + 1))}
                  disabled={page >= logsData.totalPages}
                  data-testid="button-next-page"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Log Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedLog && getEventIcon(selectedLog.eventType)}
              {selectedLog?.eventType.replace(/_/g, " ")}
            </DialogTitle>
            <DialogDescription>
              {selectedLog && formatDate(selectedLog.createdAt)}
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Entity Type</p>
                  <p className="font-medium">{selectedLog.entityType || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Entity ID</p>
                  <p className="font-medium font-mono text-sm">{selectedLog.entityId || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Source</p>
                  <p className="font-medium">{selectedLog.source || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  {selectedLog.status ? (
                    <Badge variant={getStatusBadgeVariant(selectedLog.status)}>
                      {selectedLog.status}
                    </Badge>
                  ) : (
                    <span>N/A</span>
                  )}
                </div>
              </div>
              
              {selectedLog.description && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Description</p>
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm">{selectedLog.description}</p>
                  </div>
                </div>
              )}
              
              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Metadata</p>
                  <ScrollArea className="h-[200px]">
                    <pre className="p-3 bg-muted rounded-lg text-xs font-mono overflow-x-auto">
                      {JSON.stringify(selectedLog.metadata, null, 2)}
                    </pre>
                  </ScrollArea>
                </div>
              )}
              
              {selectedLog.performedByUserId && (
                <div>
                  <p className="text-sm text-muted-foreground">Performed By</p>
                  <p className="font-medium font-mono text-sm">{selectedLog.performedByUserId}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AIAgent() {
  const { toast } = useToast();
  const [syncingSource, setSyncingSource] = useState<string | null>(null);
  const [openIntegration, setOpenIntegration] = useState<"EXTENSIV" | "SHOPIFY" | "AMAZON" | "GOHIGHLEVEL" | "PHANTOMBUSTER" | null>(null);

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

  const { data: ghlConfig } = useQuery<any>({
    queryKey: ["/api/integration-configs/GOHIGHLEVEL"],
    retry: false,
  });

  const { data: phantomConfig } = useQuery<any>({
    queryKey: ["/api/integration-configs/PHANTOMBUSTER"],
    retry: false,
  });

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
      integrationType: "GOHIGHLEVEL" as const,
      name: "GoHighLevel",
      description: "CRM and sales data",
      icon: Database,
      configured: !!(ghlConfig?.apiKey),
      status: getConfigStatus(ghlConfig),
      hasConfigDialog: true,
    },
    {
      id: "phantombuster",
      integrationType: "PHANTOMBUSTER" as const,
      name: "PhantomBuster",
      description: "Supplier data scraping",
      icon: Database,
      configured: !!(phantomConfig?.apiKey),
      status: getConfigStatus(phantomConfig),
      hasConfigDialog: true,
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
          Configure data sources, decision rules, and LLM settings for intelligent inventory management
        </p>
      </div>

      <Tabs defaultValue="data-sources" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
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
          <TabsTrigger value="logs" data-testid="tab-logs">
            Logs
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
          <RulesTab />
        </TabsContent>

        {/* LLM Config Tab */}
        <TabsContent value="llm-config" className="space-y-4">
          <LLMConfigTab settingsData={settingsData} />
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="space-y-4">
          <InsightsTab />
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-4">
          <LogsTab />
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
