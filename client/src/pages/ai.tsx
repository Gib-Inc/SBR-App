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
import { Brain, Database, Settings2, TrendingUp, CheckCircle, CheckCircle2, XCircle, Clock, RefreshCw, ShoppingBag, Package, AlertTriangle, Info, Filter, Zap, HelpCircle, Search, FileText, ChevronLeft, ChevronRight, RotateCcw, Receipt, Send, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AdDemandSignals } from "@/components/ad-demand-signals";
import { IntegrationSettings } from "@/components/integration-settings";
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
    { value: "gpt-4o", label: "GPT-4o (Latest)" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "o1-preview", label: "o1 Preview" },
    { value: "o1-mini", label: "o1 Mini" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  claude: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
    { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  ],
  google: [
    { value: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  ],
  grok: [
    { value: "grok-2", label: "Grok-2" },
    { value: "grok-1", label: "Grok-1" },
  ],
};

const PROVIDER_OPTIONS = [
  { value: "chatgpt", label: "OpenAI (ChatGPT)" },
  { value: "claude", label: "Anthropic (Claude)" },
  { value: "google", label: "Google (Gemini)" },
  { value: "grok", label: "X.AI (Grok)" },
  { value: "custom", label: "Custom Endpoint" },
];

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
  const [promptTemplate, setPromptTemplate] = useState<string>(DEFAULT_PROMPT_TEMPLATE);
  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [temperature, setTemperature] = useState<number>(0.7);
  const [maxTokens, setMaxTokens] = useState<number>(2048);
  
  // AI Prompt Generator modal state
  const [promptGeneratorOpen, setPromptGeneratorOpen] = useState(false);
  const [promptGeneratorInput, setPromptGeneratorInput] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const hasApiKey = !!settingsData?.llmApiKey;

  useEffect(() => {
    if (settingsData) {
      setPromptTemplate(settingsData.llmPromptTemplate || DEFAULT_PROMPT_TEMPLATE);
      setProvider(settingsData.llmProvider || "");
      setModel(settingsData.llmModel || "");
      setTemperature(settingsData.llmTemperature ?? 0.7);
      setMaxTokens(settingsData.llmMaxTokens ?? 2048);
    }
  }, [settingsData]);

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const models = MODEL_OPTIONS[newProvider];
    if (models && models.length > 0) {
      setModel(models[0].value);
    } else {
      setModel("");
    }
  };

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", "/api/settings", {
        llmProvider: provider || null,
        llmModel: model || null,
        llmTemperature: temperature,
        llmMaxTokens: maxTokens,
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
        description: error.message || "Failed to save configuration",
        variant: "destructive",
      });
    },
  });

  const savePromptMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", "/api/settings", {
        llmPromptTemplate: promptTemplate || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Configuration Saved",
        description: "Prompt template has been updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save configuration",
        variant: "destructive",
      });
    },
  });

  const generatePromptTemplate = async () => {
    if (!promptGeneratorInput.trim()) {
      toast({
        title: "Input Required",
        description: "Please describe what you want the AI to accomplish",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setGeneratedPrompt("");
    try {
      const metaPrompt = `You are an expert at writing prompts for inventory management AI systems. Based on the user's desired outcome, create an optimized prompt template for generating reorder recommendations. The prompt must use these placeholders: {item_name}, {item_sku}, {current_stock}, {current_date}, {sales_data}, {lead_time_days}, {seasonal_pattern}, {daily_usage}. User's desired outcome: ${promptGeneratorInput}`;
      
      const data = await apiRequest("POST", "/api/llm/ask", {
        prompt: metaPrompt,
      }) as { answer?: string };
      
      if (data?.answer) {
        setGeneratedPrompt(data.answer);
      } else {
        throw new Error("No response from AI");
      }
    } catch (error: any) {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate prompt template",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUsePrompt = () => {
    setPromptTemplate(generatedPrompt);
    setPromptGeneratorOpen(false);
    setPromptGeneratorInput("");
    setGeneratedPrompt("");
    toast({
      title: "Prompt template updated successfully",
    });
  };

  const availableModels = MODEL_OPTIONS[provider] || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            AI Provider Configuration
          </CardTitle>
          <CardDescription>
            Configure your AI provider to power intelligent inventory recommendations and analysis. Manage your API key in Settings → LLM Configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="llm-provider">Provider</Label>
              <Select value={provider} onValueChange={handleProviderChange}>
                <SelectTrigger id="llm-provider" data-testid="select-llm-provider">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="llm-model">Model</Label>
              <Select 
                value={model} 
                onValueChange={setModel}
                disabled={!provider || provider === "custom"}
              >
                <SelectTrigger id="llm-model" data-testid="select-llm-model">
                  <SelectValue placeholder={provider === "custom" ? "N/A for custom" : "Select a model"} />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50">
            <div className="flex items-center gap-2">
              <Label className="text-muted-foreground text-sm">API Key Status:</Label>
              {hasApiKey ? (
                <Badge variant="outline" className="text-xs">
                  <CheckCircle2 className="mr-1 h-3 w-3 text-green-500" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-amber-600">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  Not Set
                </Badge>
              )}
            </div>
            <Button variant="link" size="sm" className="ml-auto h-auto p-0" asChild>
              <a href="/settings?tab=llm">Manage API Key</a>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="llm-temperature">Temperature</Label>
              <div className="flex items-center gap-3">
                <Slider
                  id="llm-temperature"
                  min={0}
                  max={2}
                  step={0.1}
                  value={[temperature]}
                  onValueChange={([val]) => setTemperature(val)}
                  className="flex-1"
                  data-testid="slider-llm-temperature"
                />
                <span className="w-12 text-right font-mono text-sm">{temperature.toFixed(1)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Lower values produce more focused responses, higher values increase creativity.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="llm-max-tokens">Max Tokens</Label>
              <Input
                id="llm-max-tokens"
                type="number"
                min={100}
                max={8192}
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value) || 2048)}
                data-testid="input-llm-max-tokens"
              />
              <p className="text-xs text-muted-foreground">
                Maximum length of AI responses (100-8192).
              </p>
            </div>
          </div>

          <Button
            onClick={() => saveConfigMutation.mutate()}
            disabled={saveConfigMutation.isPending || !provider}
            className="w-full md:w-auto"
            data-testid="button-save-llm-config"
          >
            {saveConfigMutation.isPending ? "Saving..." : "Save Configuration"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Prompt Template</CardTitle>
          <CardDescription>
            Customize the prompt template used for reorder recommendations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            onClick={() => setPromptGeneratorOpen(true)}
            className="w-full md:w-auto"
            data-testid="button-ai-prompt-generator"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            AI Prompt Generator
          </Button>
          
          <div className="space-y-2">
            <Label htmlFor="prompt-template">Reorder Recommendation Prompt</Label>
            <Textarea
              id="prompt-template"
              rows={8}
              placeholder="Enter custom prompt template..."
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              data-testid="textarea-prompt-template"
            />
            <p className="text-xs text-muted-foreground">
              This template is used when generating AI-powered reorder recommendations. Use placeholders like {'{item_name}'}, {'{current_stock}'}, {'{daily_usage}'}.
            </p>
          </div>

          <Button
            onClick={() => savePromptMutation.mutate()}
            disabled={savePromptMutation.isPending}
            data-testid="button-save-prompt-template"
          >
            {savePromptMutation.isPending ? "Saving..." : "Save Prompt Template"}
          </Button>
        </CardContent>
      </Card>

      {/* AI Prompt Generator Modal */}
      <Dialog open={promptGeneratorOpen} onOpenChange={setPromptGeneratorOpen}>
        <DialogContent className="sm:max-w-[600px] p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI Prompt Generator
            </DialogTitle>
            <DialogDescription>
              Describe your inventory management goals and priorities, and AI will create an optimized prompt template for you
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="prompt-generator-input">Describe what you want the AI to accomplish</Label>
              <Textarea
                id="prompt-generator-input"
                rows={5}
                placeholder="Example: Focus on fast-moving items and seasonal trends, prioritize suppliers with shorter lead times"
                value={promptGeneratorInput}
                onChange={(e) => setPromptGeneratorInput(e.target.value)}
                data-testid="textarea-prompt-generator-input"
              />
            </div>

            <Button
              onClick={generatePromptTemplate}
              disabled={isGenerating || !promptGeneratorInput.trim()}
              className="w-full"
              data-testid="button-generate-prompt"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Prompt
                </>
              )}
            </Button>

            {generatedPrompt && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Generated Prompt Preview</Label>
                  <Textarea
                    rows={8}
                    value={generatedPrompt}
                    readOnly
                    className="bg-muted"
                    data-testid="textarea-generated-prompt-preview"
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={generatePromptTemplate}
                    disabled={isGenerating}
                    className="flex-1"
                    data-testid="button-regenerate-prompt"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Regenerate
                  </Button>
                  <Button
                    onClick={handleUsePrompt}
                    className="flex-1"
                    data-testid="button-use-this-prompt"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Use This Prompt
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
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

// Performance tracking data type
interface PerformanceRecord {
  id: string;
  sku: string;
  productName: string;
  aiRecommendedQty: number;
  actualOrderQty: number;
  variancePercent: number;
  date: string;
  status: "Followed AI" | "Partially Followed" | "Ignored";
}

function InsightsTab() {
  const [dateRangeFilter, setDateRangeFilter] = useState<string>("30");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortColumn, setSortColumn] = useState<keyof PerformanceRecord>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  
  // Fetch all recommendations to track performance across all statuses
  const { data: recsData, isLoading } = useQuery<PersistedRecommendationsResponse>({
    queryKey: ["/api/ai/recommendations", "all"],
    queryFn: async () => {
      const response = await fetch(`/api/ai/recommendations?status=all`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch recommendations");
      return response.json();
    },
  });
  
  // Transform recommendations into performance records
  const performanceRecords: PerformanceRecord[] = (recsData?.recommendations || [])
    .filter(rec => rec.recommendedQty && rec.recommendedQty > 0)
    .map(rec => {
      const aiQty = rec.recommendedQty ?? 0;
      // Determine actual ordered quantity and status based on recommendation status
      let actualQty: number;
      let status: "Followed AI" | "Partially Followed" | "Ignored";
      
      if (rec.status === "DISMISSED") {
        // Dismissed recommendations = Ignored (no order placed)
        actualQty = 0;
        status = "Ignored";
      } else if (rec.status === "ACCEPTED") {
        // Accepted recommendations - use qtyOnPo if available
        actualQty = rec.qtyOnPo ?? aiQty;
        const variance = aiQty > 0 ? Math.abs(((actualQty - aiQty) / aiQty) * 100) : 0;
        if (variance <= 10) {
          status = "Followed AI";
        } else if (variance <= 25) {
          status = "Partially Followed";
        } else {
          status = "Partially Followed"; // Still partially followed if accepted
        }
      } else {
        // NEW status - pending action
        actualQty = 0;
        status = "Ignored"; // No action taken yet
      }
      
      const variance = aiQty > 0 ? ((actualQty - aiQty) / aiQty) * 100 : 0;
      
      return {
        id: rec.id,
        sku: rec.sku,
        productName: rec.productName,
        aiRecommendedQty: aiQty,
        actualOrderQty: actualQty,
        variancePercent: variance,
        date: rec.updatedAt || rec.createdAt,
        status,
      };
    });
  
  // Filter by date range
  const now = new Date();
  const filteredByDate = performanceRecords.filter(record => {
    if (dateRangeFilter === "all") return true;
    const recordDate = new Date(record.date);
    const daysAgo = parseInt(dateRangeFilter);
    const cutoff = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return recordDate >= cutoff;
  });
  
  // Filter by status
  const filteredRecords = filteredByDate.filter(record => {
    if (statusFilter === "all") return true;
    return record.status === statusFilter;
  });
  
  // Sort records
  const sortedRecords = [...filteredRecords].sort((a, b) => {
    let aVal: any = a[sortColumn];
    let bVal: any = b[sortColumn];
    
    // Handle date sorting
    if (sortColumn === "date") {
      aVal = new Date(aVal).getTime();
      bVal = new Date(bVal).getTime();
    }
    
    // Handle string sorting
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDirection === "asc" 
        ? aVal.localeCompare(bVal) 
        : bVal.localeCompare(aVal);
    }
    
    // Handle number sorting
    if (sortDirection === "asc") {
      return aVal - bVal;
    }
    return bVal - aVal;
  });
  
  const handleSort = (column: keyof PerformanceRecord) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };
  
  const getSortIcon = (column: keyof PerformanceRecord) => {
    if (sortColumn !== column) {
      return <span className="text-muted-foreground/50 ml-1">⇅</span>;
    }
    return <span className="text-primary ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>;
  };
  
  const getVarianceColor = (variance: number): string => {
    const absVariance = Math.abs(variance);
    if (absVariance <= 10) return "text-green-600 dark:text-green-400";
    if (absVariance <= 25) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };
  
  const getStatusBadgeVariant = (status: string): "default" | "secondary" | "outline" => {
    switch (status) {
      case "Followed AI": return "default";
      case "Partially Followed": return "secondary";
      case "Ignored": return "outline";
      default: return "outline";
    }
  };
  
  if (isLoading) {
    return (
      <div className="space-y-4">
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
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                AI Recommendation Performance
              </CardTitle>
              <CardDescription>
                Track how closely your ordering decisions align with AI recommendations
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={dateRangeFilter} onValueChange={setDateRangeFilter}>
                <SelectTrigger className="w-36" data-testid="select-date-range-filter">
                  <SelectValue placeholder="Date Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40" data-testid="select-status-filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="Followed AI">Followed AI</SelectItem>
                  <SelectItem value="Partially Followed">Partially Followed</SelectItem>
                  <SelectItem value="Ignored">Ignored</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="h-11 border-b">
                  <th 
                    className="px-3 text-left font-medium whitespace-nowrap cursor-pointer hover:bg-muted/70"
                    onClick={() => handleSort("sku")}
                    data-testid="th-sku"
                  >
                    SKU {getSortIcon("sku")}
                  </th>
                  <th 
                    className="px-3 text-left font-medium whitespace-nowrap cursor-pointer hover:bg-muted/70"
                    onClick={() => handleSort("productName")}
                    data-testid="th-product-name"
                  >
                    Product Name {getSortIcon("productName")}
                  </th>
                  <th 
                    className="px-3 text-right font-medium whitespace-nowrap cursor-pointer hover:bg-muted/70"
                    onClick={() => handleSort("aiRecommendedQty")}
                    data-testid="th-ai-qty"
                  >
                    AI Recommended Qty {getSortIcon("aiRecommendedQty")}
                  </th>
                  <th 
                    className="px-3 text-right font-medium whitespace-nowrap cursor-pointer hover:bg-muted/70"
                    onClick={() => handleSort("actualOrderQty")}
                    data-testid="th-actual-qty"
                  >
                    Actual Order Qty {getSortIcon("actualOrderQty")}
                  </th>
                  <th 
                    className="px-3 text-right font-medium whitespace-nowrap cursor-pointer hover:bg-muted/70"
                    onClick={() => handleSort("variancePercent")}
                    data-testid="th-variance"
                  >
                    Variance % {getSortIcon("variancePercent")}
                  </th>
                  <th 
                    className="px-3 text-left font-medium whitespace-nowrap cursor-pointer hover:bg-muted/70"
                    onClick={() => handleSort("date")}
                    data-testid="th-date"
                  >
                    Date {getSortIcon("date")}
                  </th>
                  <th 
                    className="px-3 text-left font-medium whitespace-nowrap cursor-pointer hover:bg-muted/70"
                    onClick={() => handleSort("status")}
                    data-testid="th-status"
                  >
                    Status {getSortIcon("status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRecords.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted-foreground py-8">
                      <div className="flex flex-col items-center gap-2">
                        <TrendingUp className="h-8 w-8 text-muted-foreground/50" />
                        <p>No performance data available for the selected filters.</p>
                        <p className="text-xs">Accept or dismiss AI recommendations to start tracking performance.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedRecords.map((record) => (
                    <tr 
                      key={record.id} 
                      data-testid={`row-performance-${record.id}`}
                      className="h-11 border-b hover-elevate"
                    >
                      <td className="px-3 align-middle font-mono text-sm whitespace-nowrap">
                        {record.sku}
                      </td>
                      <td className="px-3 align-middle whitespace-nowrap max-w-[200px] truncate" title={record.productName}>
                        {record.productName}
                      </td>
                      <td className="px-3 align-middle text-right whitespace-nowrap font-medium">
                        {record.aiRecommendedQty}
                      </td>
                      <td className="px-3 align-middle text-right whitespace-nowrap font-medium">
                        {record.actualOrderQty}
                      </td>
                      <td className={`px-3 align-middle text-right whitespace-nowrap font-medium ${getVarianceColor(record.variancePercent)}`}>
                        {record.variancePercent >= 0 ? "+" : ""}{record.variancePercent.toFixed(1)}%
                      </td>
                      <td className="px-3 align-middle whitespace-nowrap">
                        {new Date(record.date).toLocaleDateString()}
                      </td>
                      <td className="px-3 align-middle whitespace-nowrap">
                        <Badge 
                          variant={getStatusBadgeVariant(record.status)}
                          data-testid={`badge-status-${record.id}`}
                        >
                          {record.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Interface for System Recommendations (matches schema)
interface SystemRecommendation {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: "INTEGRATION_ISSUE" | "INVENTORY_PATTERN" | "PROCESS_IMPROVEMENT" | "SECURITY_CONCERN" | "PERFORMANCE" | "DATA_QUALITY" | "OTHER";
  title: string;
  description: string;
  suggestedChange: string;
  status: "NEW" | "ACKNOWLEDGED" | "DISMISSED";
  reviewPeriodStart?: string;
  reviewPeriodEnd?: string;
  createdAt: string;
  acknowledgedAt?: string;
  dismissedAt?: string;
}

interface SystemRecommendationsResponse {
  recommendations: SystemRecommendation[];
  summary: {
    total: number;
    new: number;
    acknowledged: number;
    dismissed: number;
    bySeverity: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    byCategory: {
      integration_issue: number;
      inventory_pattern: number;
      process_improvement: number;
      security_concern: number;
      performance: number;
      data_quality: number;
      other: number;
    };
  };
  fetchedAt: string;
}

function SystemSuggestionsSection() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("NEW");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedSuggestion, setSelectedSuggestion] = useState<SystemRecommendation | null>(null);
  
  // Build query string
  const queryParams = new URLSearchParams();
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (severityFilter !== "all") queryParams.set("severity", severityFilter);
  if (categoryFilter !== "all") queryParams.set("category", categoryFilter);
  const queryString = queryParams.toString();
  
  const { data, isLoading, isFetching } = useQuery<SystemRecommendationsResponse>({
    queryKey: [`/api/ai/system-recommendations${queryString ? `?${queryString}` : ""}`],
    staleTime: 60000,
  });
  
  // Manual review trigger
  const reviewMutation = useMutation({
    mutationFn: async (periodDays: number) => {
      return await apiRequest("POST", "/api/ai/system-recommendations/run-review", { periodDays });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/system-recommendations"] });
      toast({
        title: "Review Complete",
        description: "AI system review has completed. Check for new suggestions.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Review Failed",
        description: error.message || "Failed to run system review",
        variant: "destructive",
      });
    },
  });
  
  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return await apiRequest("PATCH", `/api/ai/system-recommendations/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/system-recommendations"] });
      setSelectedSuggestion(null);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update recommendation status",
        variant: "destructive",
      });
    },
  });
  
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "CRITICAL": return "text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30";
      case "HIGH": return "text-orange-600 bg-orange-100 dark:text-orange-400 dark:bg-orange-900/30";
      case "MEDIUM": return "text-yellow-600 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900/30";
      case "LOW": return "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30";
      default: return "";
    }
  };
  
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "INTEGRATION_ISSUE": return <Database className="h-4 w-4" />;
      case "INVENTORY_PATTERN": return <Package className="h-4 w-4" />;
      case "PROCESS_IMPROVEMENT": return <Settings2 className="h-4 w-4" />;
      case "SECURITY_CONCERN": return <AlertTriangle className="h-4 w-4" />;
      case "PERFORMANCE": return <Zap className="h-4 w-4" />;
      case "DATA_QUALITY": return <CheckCircle className="h-4 w-4" />;
      default: return <Info className="h-4 w-4" />;
    }
  };
  
  const summary = data?.summary;
  const recommendations = data?.recommendations || [];
  
  if (isLoading) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI System Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              AI System Suggestions
            </CardTitle>
            <CardDescription>
              Weekly AI-powered review of system logs and operations. Identifies improvement opportunities.
              {data?.fetchedAt && (
                <span className="block text-xs mt-1">
                  Last reviewed: {new Date(data.fetchedAt).toLocaleString()}
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32" data-testid="select-system-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="NEW">New</SelectItem>
                <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
                <SelectItem value="DISMISSED">Dismissed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-28" data-testid="select-system-severity-filter">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-44" data-testid="select-system-category-filter">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="INTEGRATION_ISSUE">Integration Issue</SelectItem>
                <SelectItem value="INVENTORY_PATTERN">Inventory Pattern</SelectItem>
                <SelectItem value="PROCESS_IMPROVEMENT">Process Improvement</SelectItem>
                <SelectItem value="SECURITY_CONCERN">Security Concern</SelectItem>
                <SelectItem value="PERFORMANCE">Performance</SelectItem>
                <SelectItem value="DATA_QUALITY">Data Quality</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => reviewMutation.mutate(7)}
              disabled={reviewMutation.isPending || isFetching}
              data-testid="button-run-system-review"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${reviewMutation.isPending ? "animate-spin" : ""}`} />
              Run Review
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Summary badges */}
        {summary && (
          <div className="flex flex-wrap gap-2 mb-4">
            <Badge variant="outline" data-testid="badge-system-total">
              {summary.total} Total
            </Badge>
            {summary.bySeverity.critical > 0 && (
              <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" data-testid="badge-system-critical">
                {summary.bySeverity.critical} Critical
              </Badge>
            )}
            {summary.bySeverity.high > 0 && (
              <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" data-testid="badge-system-high">
                {summary.bySeverity.high} High
              </Badge>
            )}
            {summary.new > 0 && (
              <Badge variant="default" data-testid="badge-system-new">
                {summary.new} New
              </Badge>
            )}
          </div>
        )}
        
        {/* Recommendations list */}
        {recommendations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Brain className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No system suggestions found.</p>
            <p className="text-sm mt-1">Run a review to analyze recent system activity.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <div
                key={rec.id}
                className="border rounded-lg p-4 hover-elevate cursor-pointer transition-colors"
                onClick={() => setSelectedSuggestion(rec)}
                data-testid={`system-suggestion-${rec.id}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={`p-2 rounded-lg ${getSeverityColor(rec.severity)}`}>
                      {getCategoryIcon(rec.category)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium truncate">{rec.title}</h4>
                        <Badge variant="outline" className="text-xs">
                          {rec.category.replace(/_/g, " ")}
                        </Badge>
                        <Badge className={`text-xs ${getSeverityColor(rec.severity)}`}>
                          {rec.severity}
                        </Badge>
                        {rec.status !== "NEW" && (
                          <Badge variant={rec.status === "ACKNOWLEDGED" ? "secondary" : "outline"} className="text-xs">
                            {rec.status}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {rec.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {rec.status === "NEW" && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateStatusMutation.mutate({ id: rec.id, status: "ACKNOWLEDGED" });
                              }}
                              disabled={updateStatusMutation.isPending}
                              data-testid={`button-acknowledge-system-${rec.id}`}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Acknowledge</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateStatusMutation.mutate({ id: rec.id, status: "DISMISSED" });
                              }}
                              disabled={updateStatusMutation.isPending}
                              data-testid={`button-dismiss-system-${rec.id}`}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Dismiss</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      
      {/* Detail Dialog */}
      <Dialog open={!!selectedSuggestion} onOpenChange={(open) => !open && setSelectedSuggestion(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              System Suggestion
            </DialogTitle>
            <DialogDescription>
              Review period: {selectedSuggestion?.reviewPeriodStart ? new Date(selectedSuggestion.reviewPeriodStart).toLocaleDateString() : ""} - {selectedSuggestion?.reviewPeriodEnd ? new Date(selectedSuggestion.reviewPeriodEnd).toLocaleDateString() : ""}
            </DialogDescription>
          </DialogHeader>
          {selectedSuggestion && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={getSeverityColor(selectedSuggestion.severity)}>
                  {selectedSuggestion.severity}
                </Badge>
                <Badge variant="outline">
                  {selectedSuggestion.category.replace(/_/g, " ")}
                </Badge>
                {selectedSuggestion.status !== "NEW" && (
                  <Badge variant={selectedSuggestion.status === "ACKNOWLEDGED" ? "secondary" : "outline"}>
                    {selectedSuggestion.status}
                  </Badge>
                )}
              </div>
              
              <div>
                <h4 className="font-medium mb-2">{selectedSuggestion.title}</h4>
                <p className="text-sm text-muted-foreground">{selectedSuggestion.description}</p>
              </div>
              
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Suggested Change
                </p>
                <p className="text-sm" data-testid="text-suggested-change">{selectedSuggestion.suggestedChange}</p>
              </div>
              
              <div className="text-xs text-muted-foreground">
                Created: {new Date(selectedSuggestion.createdAt).toLocaleString()}
              </div>
              
              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t">
                {selectedSuggestion.status === "NEW" && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => updateStatusMutation.mutate({ id: selectedSuggestion.id, status: "DISMISSED" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid="button-modal-dismiss-system"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Dismiss
                    </Button>
                    <Button
                      onClick={() => updateStatusMutation.mutate({ id: selectedSuggestion.id, status: "ACKNOWLEDGED" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid="button-modal-acknowledge-system"
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Acknowledge
                    </Button>
                  </>
                )}
                {selectedSuggestion.status !== "NEW" && (
                  <Button
                    variant="outline"
                    onClick={() => updateStatusMutation.mutate({ id: selectedSuggestion.id, status: "NEW" })}
                    disabled={updateStatusMutation.isPending}
                    data-testid="button-modal-reset-system"
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
    </Card>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => refetch()}
                    disabled={isFetching}
                    data-testid="button-refresh-logs"
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                    Refresh Logs
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reload the latest system logs</TooltipContent>
              </Tooltip>
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
          <div className="rounded-md border overflow-auto max-h-[500px]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Timestamp</th>
                  <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Event</th>
                  <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Entity</th>
                  <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Source</th>
                  <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Description</th>
                </tr>
              </thead>
              <tbody>
                {logsData?.logs && logsData.logs.length > 0 ? (
                  logsData.logs.map((log) => (
                    <tr 
                      key={log.id} 
                      className="h-11 border-b hover-elevate cursor-pointer" 
                      data-testid={`row-log-${log.id}`}
                      onClick={() => setSelectedLog(log)}
                    >
                      <td className="px-4 text-muted-foreground whitespace-nowrap">
                        {formatDate(log.createdAt)}
                      </td>
                      <td className="px-4">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          {getEventIcon(log.eventType)}
                          <span className="font-medium">{log.eventType.replace(/_/g, " ")}</span>
                        </div>
                      </td>
                      <td className="px-4 whitespace-nowrap">
                        {log.entityType ? (
                          <Badge variant="outline" className="text-xs">
                            {log.entityType}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 whitespace-nowrap">
                        {log.source || "-"}
                      </td>
                      <td className="px-4 whitespace-nowrap">
                        {log.status ? (
                          <Badge variant={getStatusBadgeVariant(log.status)} className="text-xs">
                            {log.status}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 max-w-[300px] truncate">
                        {log.description || "-"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground py-8">
                        <FileText className="h-8 w-8" />
                        <p className="font-medium">No logs found</p>
                        <p className="text-sm">
                          {hasActiveFilters 
                            ? "Try adjusting your filters to see more results" 
                            : "System logs will appear here as actions occur"}
                        </p>
                        {hasActiveFilters && (
                          <Button size="sm" variant="link" onClick={handleClearFilters}>
                            Clear all filters
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
    tokenLastRotatedAt?: string;
    tokenNextRotationAt?: string;
  }>({
    queryKey: ["/api/quickbooks/status"],
    retry: false,
  });

  // Helper function to format rotation dates
  const formatRotationDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return "Never";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return "Never";
    }
  };

  // Helper function to calculate next required rotation (90 days from last rotation)
  const getNextRotationDate = (lastRotatedAt: string | null | undefined): string => {
    if (!lastRotatedAt) return "Set up credentials first";
    try {
      const lastDate = new Date(lastRotatedAt);
      const nextDate = new Date(lastDate.getTime() + 90 * 24 * 60 * 60 * 1000);
      return formatRotationDate(nextDate.toISOString());
    } catch {
      return "Unknown";
    }
  };

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
      showRotation: true,
      lastRotatedAt: ghlConfig?.tokenLastRotatedAt,
      nextRotationAt: ghlConfig?.tokenNextRotationAt,
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
      showRotation: true,
      lastRotatedAt: phantomConfig?.tokenLastRotatedAt,
      nextRotationAt: phantomConfig?.tokenNextRotationAt,
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
      showRotation: true,
      lastRotatedAt: quickbooksStatus?.tokenLastRotatedAt,
      nextRotationAt: quickbooksStatus?.tokenNextRotationAt,
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
      showRotation: true,
      lastRotatedAt: metaAdsConfig?.tokenLastRotatedAt,
      nextRotationAt: metaAdsConfig?.tokenNextRotationAt,
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
      showRotation: true,
      lastRotatedAt: googleAdsConfig?.tokenLastRotatedAt,
      nextRotationAt: googleAdsConfig?.tokenNextRotationAt,
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
                          {(source as any).showRotation && (
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t pt-2 mt-1" data-testid={`rotation-info-${source.id}`}>
                              <div className="text-muted-foreground">Last Rotated</div>
                              <div className="text-right font-medium" data-testid={`last-rotated-${source.id}`}>
                                {formatRotationDate((source as any).lastRotatedAt)}
                              </div>
                              <div className="text-muted-foreground">Next Required</div>
                              <div className="text-right font-medium" data-testid={`next-rotation-${source.id}`}>
                                {(source as any).nextRotationAt 
                                  ? formatRotationDate((source as any).nextRotationAt)
                                  : getNextRotationDate((source as any).lastRotatedAt)}
                              </div>
                            </div>
                          )}
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => {
                                if (source.id === "quickbooks") {
                                  if (!source.configured) {
                                    handleQuickBooksConnect();
                                  } else {
                                    handleQuickBooksDisconnect();
                                  }
                                } else if (source.id === "meta-ads") {
                                  if (!source.configured) {
                                    handleMetaAdsConnect();
                                  } else {
                                    handleMetaAdsDisconnect();
                                  }
                                } else if (source.id === "google-ads") {
                                  if (!source.configured) {
                                    handleGoogleAdsConnect();
                                  } else {
                                    handleGoogleAdsDisconnect();
                                  }
                                } else {
                                  setOpenIntegration(source.integrationType as "EXTENSIV" | "SHOPIFY" | "AMAZON" | "GOHIGHLEVEL" | "PHANTOMBUSTER");
                                }
                              }}
                              data-testid={`button-configure-${source.id}`}
                            >
                              <Settings2 className="mr-2 h-4 w-4" />
                              Configure
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                if (source.id === "quickbooks") {
                                  handleQuickBooksSync();
                                } else if (source.id === "meta-ads") {
                                  handleMetaAdsSync();
                                } else if (source.id === "google-ads") {
                                  handleGoogleAdsSync();
                                } else {
                                  handleSync(source.id);
                                }
                              }}
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
