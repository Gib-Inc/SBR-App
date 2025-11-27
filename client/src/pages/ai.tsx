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
import { Brain, Database, Settings2, TrendingUp, CheckCircle, XCircle, Clock, RefreshCw, ShoppingBag, Package, AlertTriangle, Info, Filter, Zap, HelpCircle, Search, FileText, ChevronLeft, ChevronRight, Eye, RotateCcw, Receipt, LogOut, ExternalLink, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AdDemandSignals } from "@/components/ad-demand-signals";
import { IntegrationSettings } from "@/components/integration-settings";
import { IntegrationHealth } from "@/components/integration-health";
import { CreatePOSheet } from "@/components/create-po-sheet";

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
  riskLevel: "NEED_ORDER" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  recommendedAction: "ORDER" | "MONITOR" | "OK";
  recommendedQty: number;
  explanation: string;
  primaryChannel?: string;
  metrics: {
    onHand: number;
    availableForSale: number;
    extensivOnHand: number;
    extensivVariance: number;
    extensivVariancePercent: number;
    dailySalesVelocity: number;
    projectedDaysUntilStockout: number;
    reorderPoint: number;
    returnRate: number;
    supplierLeadTimeDays: number;
    effectiveLeadTime: number;
    supplierScore: number;
    backorderCount: number;
    inboundPO: number;
  };
}

interface InsightsResponse {
  recommendations: SKURecommendation[];
  computedAt: string;
  rulesApplied: AIRules;
  summary: {
    total: number;
    needOrder: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
    actionRequired: number;
    anomalyCount?: number;
    persisted?: number;
  };
}

interface PersistedRecommendation {
  id: string;
  sku: string;
  itemId: string;
  productName: string;
  recommendationType: string;
  riskLevel: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  daysUntilStockout: number | null;
  availableForSale: number | null;
  recommendedQty: number | null;
  stockGapPercent: number | null;
  qtyOnPo: number | null;
  status: "NEW" | "ACCEPTED" | "DISMISSED";
  reasonSummary: string | null;
  sourceSignals: Record<string, unknown> | null;
  adMultiplier: number | null;
  baseVelocity: number | null;
  adjustedVelocity: number | null;
  createdAt: string;
  updatedAt: string;
}

interface PersistedRecommendationsResponse {
  recommendations: PersistedRecommendation[];
  summary: {
    total: number;
    new: number;
    accepted: number;
    dismissed: number;
    highRisk: number;
    actionRequired: number;
  };
  fetchedAt: string;
}

interface LinkedPO {
  poId: string;
  poNumber: string;
  status: string;
  orderDate: string;
  qtyOrdered: number;
  qtyReceived: number;
  supplierName?: string;
}

function LinkedPOsSection({ recommendationId }: { recommendationId: string }) {
  const { data, isLoading } = useQuery<{ linkedPOs: LinkedPO[] }>({
    queryKey: ["/api/ai/recommendations", recommendationId, "linked-pos"],
    enabled: !!recommendationId,
  });
  
  if (isLoading) {
    return (
      <div className="border-t pt-4">
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  
  const linkedPOs = data?.linkedPOs || [];
  
  if (linkedPOs.length === 0) {
    return null;
  }
  
  const getPOStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      DRAFT: "bg-gray-100 text-gray-800",
      SENT: "bg-blue-100 text-blue-800",
      CONFIRMED: "bg-purple-100 text-purple-800",
      PARTIALLY_RECEIVED: "bg-yellow-100 text-yellow-800",
      RECEIVED: "bg-green-100 text-green-800",
      CANCELLED: "bg-red-100 text-red-800",
    };
    return variants[status] || "bg-gray-100 text-gray-800";
  };
  
  return (
    <div className="border-t pt-4">
      <p className="text-sm font-medium mb-2 flex items-center gap-2">
        <FileText className="h-4 w-4" />
        Linked Purchase Orders ({linkedPOs.length})
      </p>
      <div className="space-y-2">
        {linkedPOs.map((po) => (
          <div 
            key={po.poId} 
            className="flex items-center justify-between p-2 bg-muted rounded-lg text-sm"
            data-testid={`linked-po-${po.poId}`}
          >
            <div className="flex items-center gap-3">
              <span className="font-mono font-medium">{po.poNumber}</span>
              <Badge className={getPOStatusBadge(po.status)}>
                {po.status}
              </Badge>
              {po.supplierName && (
                <span className="text-muted-foreground">{po.supplierName}</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span>
                {po.qtyReceived}/{po.qtyOrdered} received
              </span>
              <span className="text-muted-foreground">
                {new Date(po.orderDate).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedItem, setSelectedItem] = useState<PersistedRecommendation | null>(null);
  const [createPOOpen, setCreatePOOpen] = useState(false);
  const [createPOData, setCreatePOData] = useState<{
    supplierId?: string;
    items: Array<{
      itemId: string;
      quantity: number;
      aiRecommendationId: string;
      sku?: string;
      name?: string;
    }>;
  } | null>(null);
  
  // Fetch persisted recommendations from database
  // Map frontend status filter to API query parameter
  const apiStatusParam = statusFilter === "all" ? "all" : statusFilter === "active" ? "active" : statusFilter;
  const { data: recsData, isLoading, isFetching } = useQuery<PersistedRecommendationsResponse>({
    queryKey: ["/api/ai/recommendations", apiStatusParam],
    queryFn: async () => {
      const response = await fetch(`/api/ai/recommendations?status=${apiStatusParam}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch recommendations");
      return response.json();
    },
  });
  
  // Refresh mutation - triggers decision engine recalculation and persistence
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/ai/insights?refresh=true", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to refresh");
      return response.json() as Promise<InsightsResponse>;
    },
    onSuccess: (data) => {
      // Invalidate all recommendation queries (different status filters)
      queryClient.invalidateQueries({ queryKey: ["/api/ai/recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/insights"] });
      toast({
        title: "Recommendations Updated",
        description: `AI recalculated recommendations. ${data.summary.persisted ?? 0} actionable items saved.`,
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
  
  // Status update mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return await apiRequest("PATCH", `/api/ai/recommendations/${id}`, { status });
    },
    onSuccess: () => {
      // Invalidate all recommendation queries to update counts across all filters
      queryClient.invalidateQueries({ queryKey: ["/api/ai/recommendations"] });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update recommendation status",
        variant: "destructive",
      });
    },
  });
  
  // Handler to create PO from recommendation
  const handleCreatePO = async (rec: PersistedRecommendation) => {
    // Create item data with sku/name defaults
    const itemData = {
      itemId: rec.itemId,
      quantity: rec.recommendedQty || 1,
      aiRecommendationId: rec.id,
      sku: rec.sku,
      name: rec.productName,
    };
    
    try {
      // Fetch designated supplier for this item
      const response = await fetch(`/api/items/${rec.itemId}/designated-supplier`, {
        credentials: "include",
      });
      
      // Check if response is OK before parsing
      if (response.ok) {
        const data = await response.json();
        // Set up PO data with pre-filled values including supplier
        setCreatePOData({
          supplierId: data.supplier?.id,
          items: [itemData],
        });
      } else {
        // Supplier not found or error - still open sheet without supplier
        console.warn("No designated supplier found for item:", rec.itemId);
        setCreatePOData({
          items: [itemData],
        });
      }
      setCreatePOOpen(true);
    } catch (error) {
      console.error("Failed to get supplier info:", error);
      // Still open the PO sheet, just without pre-filled supplier
      setCreatePOData({
        items: [itemData],
      });
      setCreatePOOpen(true);
    }
  };
  
  // Callback when PO is successfully created
  const handlePOCreated = (poId: string) => {
    toast({
      title: "PO Created",
      description: "Purchase order created from recommendation. Status updated to Accepted.",
    });
    setCreatePOOpen(false);
    setCreatePOData(null);
  };
  
  // Filter recommendations based on status and risk
  const filteredRecommendations = (recsData?.recommendations || []).filter(rec => {
    // Status filter: "active" = NEW + ACCEPTED, or specific status
    if (statusFilter === "active" && rec.status === "DISMISSED") return false;
    if (statusFilter !== "active" && statusFilter !== "all" && rec.status !== statusFilter) return false;
    if (riskFilter !== "all" && rec.riskLevel !== riskFilter) return false;
    if (typeFilter !== "all" && rec.recommendationType !== typeFilter) return false;
    return true;
  });
  
  const getRiskBadgeVariant = (risk: string): "destructive" | "secondary" | "outline" | "default" => {
    switch (risk) {
      case "HIGH": return "destructive";
      case "MEDIUM": return "secondary";
      case "LOW": return "outline";
      default: return "outline";
    }
  };
  
  const getStatusBadgeVariant = (status: string): "default" | "secondary" | "outline" => {
    switch (status) {
      case "NEW": return "default";
      case "ACCEPTED": return "secondary";
      case "DISMISSED": return "outline";
      default: return "outline";
    }
  };
  
  const getTypeBadgeColor = (type: string): string => {
    switch (type) {
      case "REORDER": return "text-red-600 dark:text-red-400";
      case "ADS_SPIKE": return "text-purple-600 dark:text-purple-400";
      case "CHECK_VARIANCE": return "text-yellow-600 dark:text-yellow-400";
      case "HIGH_RETURNS": return "text-orange-600 dark:text-orange-400";
      case "MONITOR": return "text-blue-600 dark:text-blue-400";
      default: return "";
    }
  };
  
  const formatStockGap = (gap: number | null): string => {
    if (gap === null) return "-";
    const sign = gap >= 0 ? "+" : "";
    return `${sign}${gap.toFixed(0)}%`;
  };
  
  const getStockGapColor = (gap: number | null): string => {
    if (gap === null) return "";
    if (gap < -50) return "text-destructive font-bold";
    if (gap < -20) return "text-red-500";
    if (gap < 0) return "text-orange-500";
    return "text-green-600";
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
  
  const summary = recsData?.summary || { total: 0, new: 0, accepted: 0, dismissed: 0, highRisk: 0, actionRequired: 0 };
  
  return (
    <div className="space-y-4">
      {/* Ad Demand Signals */}
      <AdDemandSignals variant="ai-agent" />
      
      {/* Summary Cards - Status-based counts */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold" data-testid="text-total-recs">{summary.total}</p>
              <p className="text-sm text-muted-foreground">Total Active</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-primary">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-primary" data-testid="text-new-recs">{summary.new}</p>
              <p className="text-sm text-muted-foreground">New</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600" data-testid="text-accepted-recs">{summary.accepted}</p>
              <p className="text-sm text-muted-foreground">Accepted</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-muted-foreground" data-testid="text-dismissed-recs">{summary.dismissed}</p>
              <p className="text-sm text-muted-foreground">Dismissed</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-destructive" data-testid="text-high-risk-recs">{summary.highRisk}</p>
              <p className="text-sm text-muted-foreground">High Risk</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-orange-500" data-testid="text-action-required">{summary.actionRequired}</p>
              <p className="text-sm text-muted-foreground">Needs Action</p>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Recommendations Table with horizontal scroll and sticky action column */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle>SKU Recommendations</CardTitle>
              <CardDescription>
                Actionable inventory recommendations. Accept or dismiss to track decisions.
                {recsData?.fetchedAt && (
                  <span className="block text-xs mt-1">
                    Data as of: {new Date(recsData.fetchedAt).toLocaleString()}
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-28" data-testid="select-status-filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="NEW">New</SelectItem>
                  <SelectItem value="ACCEPTED">Accepted</SelectItem>
                  <SelectItem value="DISMISSED">Dismissed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger className="w-28" data-testid="select-risk-filter">
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
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-36" data-testid="select-type-filter">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="REORDER">Reorder</SelectItem>
                  <SelectItem value="ADS_SPIKE">Ads Spike</SelectItem>
                  <SelectItem value="CHECK_VARIANCE">Variance</SelectItem>
                  <SelectItem value="HIGH_RETURNS">Returns</SelectItem>
                  <SelectItem value="MONITOR">Monitor</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending || isFetching}
                data-testid="button-refresh-recommendations"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshMutation.isPending || isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap sticky left-0 bg-background z-10">SKU</TableHead>
                  <TableHead className="whitespace-nowrap">Product</TableHead>
                  <TableHead className="whitespace-nowrap">Type</TableHead>
                  <TableHead className="whitespace-nowrap">Risk</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Days Left</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Avail</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Gap%</TableHead>
                  <TableHead className="whitespace-nowrap text-right">On PO</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Rec Qty</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Velocity</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap sticky right-0 bg-background z-10 text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecommendations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                      {recsData?.recommendations.length === 0 
                        ? "No actionable recommendations. Click Refresh to generate new recommendations."
                        : "No items match the selected filters."
                      }
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRecommendations.map((rec) => (
                    <TableRow 
                      key={rec.id} 
                      data-testid={`row-recommendation-${rec.id}`}
                      className={rec.status === "DISMISSED" ? "opacity-50" : ""}
                    >
                      <TableCell className="font-mono text-sm whitespace-nowrap sticky left-0 bg-background z-10">
                        {rec.sku}
                      </TableCell>
                      <TableCell className="whitespace-nowrap max-w-[180px] truncate" title={rec.productName}>
                        {rec.productName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className={`text-sm font-medium ${getTypeBadgeColor(rec.recommendationType ?? "MONITOR")}`}>
                          {(rec.recommendationType ?? "MONITOR").replace("_", " ")}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge 
                          variant={getRiskBadgeVariant(rec.riskLevel)} 
                          data-testid={`badge-risk-${rec.id}`}
                        >
                          {rec.riskLevel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {rec.daysUntilStockout ?? "-"}
                      </TableCell>
                      <TableCell className={`text-right whitespace-nowrap ${(rec.availableForSale ?? 0) < 0 ? "text-destructive font-bold" : ""}`}>
                        {rec.availableForSale ?? "-"}
                      </TableCell>
                      <TableCell className={`text-right whitespace-nowrap ${getStockGapColor(rec.stockGapPercent)}`}>
                        {formatStockGap(rec.stockGapPercent)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {rec.qtyOnPo ?? 0}
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {rec.recommendedQty ?? "-"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap text-sm">
                        {rec.adjustedVelocity?.toFixed(1) ?? "-"}/d
                        {rec.adMultiplier && rec.adMultiplier > 1 && (
                          <span className="text-purple-500 ml-1" title={`Ad boost: ${rec.adMultiplier.toFixed(1)}x`}>
                            <Zap className="inline h-3 w-3" />
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge 
                          variant={getStatusBadgeVariant(rec.status)}
                          data-testid={`badge-status-${rec.id}`}
                        >
                          {rec.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap sticky right-0 bg-background z-10">
                        <div className="flex items-center justify-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setSelectedItem(rec)}
                                data-testid={`button-details-${rec.id}`}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View details</TooltipContent>
                          </Tooltip>
                          {rec.status === "NEW" && rec.recommendationType !== "OK" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-primary"
                                  onClick={() => handleCreatePO(rec)}
                                  data-testid={`button-create-po-${rec.id}`}
                                >
                                  <Send className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Create Purchase Order</TooltipContent>
                            </Tooltip>
                          )}
                          {rec.status === "NEW" && (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-green-600"
                                    onClick={() => updateStatusMutation.mutate({ id: rec.id, status: "ACCEPTED" })}
                                    disabled={updateStatusMutation.isPending}
                                    data-testid={`button-accept-${rec.id}`}
                                  >
                                    <CheckCircle className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Accept recommendation</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground"
                                    onClick={() => updateStatusMutation.mutate({ id: rec.id, status: "DISMISSED" })}
                                    disabled={updateStatusMutation.isPending}
                                    data-testid={`button-dismiss-${rec.id}`}
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Dismiss recommendation</TooltipContent>
                              </Tooltip>
                            </>
                          )}
                          {rec.status !== "NEW" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => updateStatusMutation.mutate({ id: rec.id, status: "NEW" })}
                                  disabled={updateStatusMutation.isPending}
                                  data-testid={`button-reset-${rec.id}`}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Reset to New</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      
      {/* Details Modal */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Recommendation Details
            </DialogTitle>
            <DialogDescription>
              {selectedItem?.productName} ({selectedItem?.sku})
            </DialogDescription>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={getRiskBadgeVariant(selectedItem.riskLevel)}>
                  {selectedItem.riskLevel} Risk
                </Badge>
                <Badge variant={getStatusBadgeVariant(selectedItem.status)}>
                  {selectedItem.status}
                </Badge>
                <span className={`text-sm font-medium ${getTypeBadgeColor(selectedItem.recommendationType ?? "MONITOR")}`}>
                  {(selectedItem.recommendationType ?? "MONITOR").replace("_", " ")}
                </span>
                {selectedItem.recommendedQty && selectedItem.recommendedQty > 0 && (
                  <Badge variant="outline">
                    Order {selectedItem.recommendedQty} units
                  </Badge>
                )}
              </div>
              
              {selectedItem.reasonSummary && (
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm" data-testid="text-reason-summary">{selectedItem.reasonSummary}</p>
                </div>
              )}
              
              {/* Metrics grid */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Available for Sale</p>
                  <p className={`font-medium ${(selectedItem.availableForSale ?? 0) < 0 ? "text-destructive" : ""}`}>
                    {selectedItem.availableForSale ?? 0} units
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Days Until Stockout</p>
                  <p className="font-medium">{selectedItem.daysUntilStockout ?? "N/A"} days</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Stock Gap</p>
                  <p className={`font-medium ${getStockGapColor(selectedItem.stockGapPercent)}`}>
                    {formatStockGap(selectedItem.stockGapPercent)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Qty on Open POs</p>
                  <p className="font-medium">{selectedItem.qtyOnPo ?? 0} units</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Base Velocity</p>
                  <p className="font-medium">{selectedItem.baseVelocity?.toFixed(2) ?? "N/A"}/day</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Adjusted Velocity</p>
                  <p className="font-medium">
                    {selectedItem.adjustedVelocity?.toFixed(2) ?? "N/A"}/day
                    {selectedItem.adMultiplier && selectedItem.adMultiplier > 1 && (
                      <span className="text-purple-500 ml-1">
                        ({selectedItem.adMultiplier.toFixed(1)}x ads)
                      </span>
                    )}
                  </p>
                </div>
              </div>
              
              {/* Source signals */}
              {selectedItem.sourceSignals && Object.keys(selectedItem.sourceSignals).length > 0 && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-2">Source Signals</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(selectedItem.sourceSignals).map(([key, value]) => (
                      <Badge key={key} variant="outline" className="text-xs">
                        {key}: {typeof value === "number" ? value.toFixed(2) : String(value)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Linked POs section */}
              <LinkedPOsSection recommendationId={selectedItem.id} />
              
              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t">
                {selectedItem.status === "NEW" && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        updateStatusMutation.mutate({ id: selectedItem.id, status: "DISMISSED" });
                        setSelectedItem(null);
                      }}
                      disabled={updateStatusMutation.isPending}
                      data-testid="button-modal-dismiss"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Dismiss
                    </Button>
                    <Button
                      onClick={() => {
                        updateStatusMutation.mutate({ id: selectedItem.id, status: "ACCEPTED" });
                        setSelectedItem(null);
                      }}
                      disabled={updateStatusMutation.isPending}
                      data-testid="button-modal-accept"
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Accept
                    </Button>
                  </>
                )}
                {selectedItem.status !== "NEW" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      updateStatusMutation.mutate({ id: selectedItem.id, status: "NEW" });
                      setSelectedItem(null);
                    }}
                    disabled={updateStatusMutation.isPending}
                    data-testid="button-modal-reset"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset to New
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Create PO Sheet */}
      <CreatePOSheet
        open={createPOOpen}
        onOpenChange={(open) => {
          setCreatePOOpen(open);
          if (!open) setCreatePOData(null);
        }}
        prefilledSupplierId={createPOData?.supplierId}
        prefilledItems={createPOData?.items}
        onPOCreated={handlePOCreated}
      />
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
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
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
  
  // Build query params - must be inside the component to use state values
  const buildQueryParams = () => {
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("pageSize", pageSize.toString());
    if (eventTypeFilter !== "all") params.set("eventType", eventTypeFilter);
    if (entityTypeFilter !== "all") params.set("entityType", entityTypeFilter);
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (searchQuery) params.set("search", searchQuery);
    return params.toString();
  };
  
  const { data: logsData, isLoading, refetch, isFetching } = useQuery<LogsResponse>({
    queryKey: ["/api/ai/logs", page, eventTypeFilter, entityTypeFilter, sourceFilter, statusFilter, searchQuery],
    queryFn: async () => {
      const response = await fetch(`/api/ai/logs?${buildQueryParams()}`, {
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
          {logsData?.pagination && logsData.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-2">
              <p className="text-sm text-muted-foreground">
                Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, logsData.pagination.total)} of {logsData.pagination.total} logs
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
                  Page {page} of {logsData.pagination.totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage(p => Math.min(logsData.pagination.totalPages, p + 1))}
                  disabled={page >= logsData.pagination.totalPages}
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

  // Fetch Meta Ads and Google Ads platform configs (uses OAuth)
  const { data: metaAdsConfig, refetch: refetchMetaAds } = useQuery<any>({
    queryKey: ["/api/ads/meta/config"],
    retry: false,
  });

  const { data: googleAdsConfig, refetch: refetchGoogleAds } = useQuery<any>({
    queryKey: ["/api/ads/google/config"],
    retry: false,
  });

  // Fetch QuickBooks status (uses OAuth, not API key)
  const { data: quickbooksStatus, refetch: refetchQbStatus } = useQuery<{
    configured: boolean;
    isConnected: boolean;
    companyName?: string;
    lastSalesSyncAt?: string;
    lastSalesSyncStatus?: string;
  }>({
    queryKey: ["/api/quickbooks/status"],
    retry: false,
  });

  const handleQuickBooksConnect = async () => {
    try {
      const response = await apiRequest("GET", "/api/quickbooks/auth-url");
      if (response.authUrl) {
        window.open(response.authUrl, "_blank", "width=600,height=700");
      }
    } catch (error: any) {
      toast({
        title: "Connection Error",
        description: error.message || "Failed to initiate QuickBooks connection",
        variant: "destructive",
      });
    }
  };

  const handleQuickBooksSync = async () => {
    setSyncingSource("quickbooks");
    try {
      const result = await apiRequest("POST", "/api/quickbooks/sync-sales", { years: 3 });
      refetchQbStatus();
      toast({
        title: "Sync Complete",
        description: result.message || "QuickBooks sales history synchronized",
      });
    } catch (error: any) {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync QuickBooks data",
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  // Meta Ads OAuth handlers
  const handleMetaAdsConnect = async () => {
    try {
      const response = await apiRequest("GET", "/api/ads/meta/auth-url");
      if (response.authUrl) {
        window.open(response.authUrl, "_blank", "width=600,height=700");
      }
    } catch (error: any) {
      toast({
        title: "Connection Error",
        description: error.message || "Failed to initiate Meta Ads connection",
        variant: "destructive",
      });
    }
  };

  const handleMetaAdsDisconnect = async () => {
    try {
      await apiRequest("POST", "/api/ads/meta/disconnect", {});
      refetchMetaAds();
      toast({
        title: "Disconnected",
        description: "Meta Ads has been disconnected",
      });
    } catch (error: any) {
      toast({
        title: "Disconnect Failed",
        description: error.message || "Failed to disconnect Meta Ads",
        variant: "destructive",
      });
    }
  };

  const handleMetaAdsSync = async () => {
    setSyncingSource("meta-ads");
    try {
      await apiRequest("POST", "/api/ads/meta/sync", {});
      refetchMetaAds();
      toast({
        title: "Sync Complete",
        description: "Meta Ads metrics synchronized",
      });
    } catch (error: any) {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync Meta Ads data",
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  // Google Ads OAuth handlers
  const handleGoogleAdsConnect = async () => {
    try {
      const response = await apiRequest("GET", "/api/ads/google/auth-url");
      if (response.authUrl) {
        window.open(response.authUrl, "_blank", "width=600,height=700");
      }
    } catch (error: any) {
      toast({
        title: "Connection Error",
        description: error.message || "Failed to initiate Google Ads connection",
        variant: "destructive",
      });
    }
  };

  const handleGoogleAdsDisconnect = async () => {
    try {
      await apiRequest("POST", "/api/ads/google/disconnect", {});
      refetchGoogleAds();
      toast({
        title: "Disconnected",
        description: "Google Ads has been disconnected",
      });
    } catch (error: any) {
      toast({
        title: "Disconnect Failed",
        description: error.message || "Failed to disconnect Google Ads",
        variant: "destructive",
      });
    }
  };

  const handleGoogleAdsSync = async () => {
    setSyncingSource("google-ads");
    try {
      await apiRequest("POST", "/api/ads/google/sync", {});
      refetchGoogleAds();
      toast({
        title: "Sync Complete",
        description: "Google Ads metrics synchronized",
      });
    } catch (error: any) {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync Google Ads data",
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  const handleQuickBooksDisconnect = async () => {
    try {
      await apiRequest("POST", "/api/quickbooks/disconnect");
      refetchQbStatus();
      toast({
        title: "Disconnected",
        description: "QuickBooks has been disconnected",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to disconnect QuickBooks",
        variant: "destructive",
      });
    }
  };

  const handleSync = async (source: string) => {
    if (source === "quickbooks") {
      handleQuickBooksSync();
      return;
    }
    if (source === "stripe") {
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
    {
      id: "quickbooks",
      integrationType: "QUICKBOOKS" as const,
      name: "QuickBooks Online",
      description: "Financial data & PO-to-Bill sync",
      icon: Receipt,
      configured: quickbooksStatus?.isConnected ?? false,
      status: quickbooksStatus?.isConnected ? "connected" : "not_configured",
      hasConfigDialog: false,
      isOAuth: true,
      companyName: quickbooksStatus?.companyName,
      lastSyncAt: quickbooksStatus?.lastSalesSyncAt,
    },
    {
      id: "meta-ads",
      integrationType: "META_ADS" as const,
      name: "Meta Ads",
      description: "Facebook/Instagram ad performance",
      icon: TrendingUp,
      configured: metaAdsConfig?.isConnected ?? false,
      status: metaAdsConfig?.isConnected ? "connected" : "not_configured",
      hasConfigDialog: false,
      isOAuth: true,
      accountName: metaAdsConfig?.accountName,
      lastSyncAt: metaAdsConfig?.lastSyncAt,
    },
    {
      id: "google-ads",
      integrationType: "GOOGLE_ADS" as const,
      name: "Google Ads",
      description: "Google ad performance & shopping",
      icon: TrendingUp,
      configured: googleAdsConfig?.isConnected ?? false,
      status: googleAdsConfig?.isConnected ? "connected" : "not_configured",
      hasConfigDialog: false,
      isOAuth: true,
      accountName: googleAdsConfig?.accountName,
      lastSyncAt: googleAdsConfig?.lastSyncAt,
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
                          <div className="flex items-center gap-2 flex-wrap">
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
                            {source.id === "quickbooks" && (source as any).companyName && (
                              <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                                {(source as any).companyName}
                              </span>
                            )}
                            {(source.id === "meta-ads" || source.id === "google-ads") && (source as any).accountName && (
                              <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                                {(source as any).accountName}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            {source.id === "quickbooks" ? (
                              source.configured ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleSync(source.id)}
                                    disabled={syncingSource === source.id}
                                    data-testid={`button-sync-${source.id}`}
                                  >
                                    <RefreshCw
                                      className={`mr-2 h-4 w-4 ${syncingSource === source.id ? "animate-spin" : ""}`}
                                    />
                                    {syncingSource === source.id ? "Syncing..." : "Sync Sales"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleQuickBooksDisconnect}
                                    data-testid="button-disconnect-quickbooks"
                                  >
                                    <LogOut className="mr-2 h-4 w-4" />
                                    Disconnect
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={handleQuickBooksConnect}
                                  data-testid="button-connect-quickbooks"
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Connect QuickBooks
                                </Button>
                              )
                            ) : source.id === "meta-ads" ? (
                              source.configured ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleMetaAdsSync}
                                    disabled={syncingSource === source.id}
                                    data-testid="button-sync-meta-ads"
                                  >
                                    <RefreshCw
                                      className={`mr-2 h-4 w-4 ${syncingSource === source.id ? "animate-spin" : ""}`}
                                    />
                                    {syncingSource === source.id ? "Syncing..." : "Sync"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleMetaAdsDisconnect}
                                    data-testid="button-disconnect-meta-ads"
                                  >
                                    <LogOut className="mr-2 h-4 w-4" />
                                    Disconnect
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={handleMetaAdsConnect}
                                  data-testid="button-connect-meta-ads"
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Connect Meta Ads
                                </Button>
                              )
                            ) : source.id === "google-ads" ? (
                              source.configured ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleGoogleAdsSync}
                                    disabled={syncingSource === source.id}
                                    data-testid="button-sync-google-ads"
                                  >
                                    <RefreshCw
                                      className={`mr-2 h-4 w-4 ${syncingSource === source.id ? "animate-spin" : ""}`}
                                    />
                                    {syncingSource === source.id ? "Syncing..." : "Sync"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleGoogleAdsDisconnect}
                                    data-testid="button-disconnect-google-ads"
                                  >
                                    <LogOut className="mr-2 h-4 w-4" />
                                    Disconnect
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={handleGoogleAdsConnect}
                                  data-testid="button-connect-google-ads"
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Connect Google Ads
                                </Button>
                              )
                            ) : (
                              <>
                                {source.hasConfigDialog && source.integrationType !== "QUICKBOOKS" && source.integrationType !== "META_ADS" && source.integrationType !== "GOOGLE_ADS" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setOpenIntegration(source.integrationType as "EXTENSIV" | "SHOPIFY" | "AMAZON" | "GOHIGHLEVEL" | "PHANTOMBUSTER")}
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
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
          
          {/* Integration Health Monitoring */}
          <IntegrationHealth />
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
