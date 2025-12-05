import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Brain, Database, Settings2, TrendingUp, CheckCircle, CheckCircle2, XCircle, Clock, RefreshCw, ShoppingBag, Package, AlertTriangle, Info, Filter, Zap, HelpCircle, Search, FileText, ChevronLeft, ChevronRight, RotateCcw, Receipt, Send, Sparkles, Scale, DollarSign, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { IntegrationSettings } from "@/components/integration-settings";
import { CreatePOSheet } from "@/components/create-po-sheet";
import { SkuMappingWizard } from "@/components/sku-mapping-wizard";

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

type SourceDecisionStatus = "ORDER" | "DONT_ORDER" | "NEUTRAL" | "NO_DATA";

interface SourceDecisionMetrics {
  conversions?: number;
  spend?: number;
  roas?: number;
  avgConvPerDay?: number;
  totalSpend?: number;
  projectedCoverageDays?: number;
  velocityTrend?: number;
  salesVelocity?: number;
  orderCount?: number;
  avgOrderValue?: number;
}

interface SourceDecision {
  source: string;
  status: SourceDecisionStatus;
  rationale: string;
  metrics: SourceDecisionMetrics;
  updatedAt: string;
}

interface RecommendationDetail {
  sku: string;
  itemId: string;
  productName: string;
  sourceDecisions: SourceDecision[];
  llmSynthesis?: string;
  finalRecommendation: "ORDER" | "MONITOR" | "OK";
  synthesizedAt?: string;
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
  sourceDecisionsJson: RecommendationDetail | null;
  adMultiplier: number | null;
  baseVelocity: number | null;
  adjustedVelocity: number | null;
  orderTiming: "ORDER_TODAY" | "SAFE_UNTIL_TOMORROW" | null;
  batchLogId: string | null;
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

interface QuickbooksSalesSnapshot {
  id: string;
  sku: string;
  productName: string | null;
  year: number;
  month: number;
  totalQty: number;
  totalRevenue: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface QBDemandHistoryItem {
  id: string;
  productId?: string;
  quickbooksItemId: string;
  sku: string;
  productName?: string;
  year: number;
  month: number;
  qtySold: number;
  qtyReturned: number;
  netQty: number;
  revenue: number;
  lastSyncedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface QBDemandHistoryResponse {
  items: QBDemandHistoryItem[];
  total: number;
  years: number[];
  page: number;
  pageSize: number;
  totalPages: number;
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
      <Card className="mt-8">
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

interface AiAgentSettings {
  id: string;
  userId: string;
  autoSendCriticalPos: boolean;
  criticalRescueDays: number;
  criticalThresholdDays: number;
  highThresholdDays: number;
  mediumThresholdDays: number;
  shopifyTwoWaySync: boolean;
  shopifySafetyBuffer: number;
  amazonTwoWaySync: boolean;
  amazonSafetyBuffer: number;
  extensivTwoWaySync: boolean;
  pivotLowDaysThreshold: number;
  hildaleHighDaysThreshold: number;
  createdAt: string;
  updatedAt: string;
}

function RulesTab() {
  const { toast } = useToast();
  
  // Fetch current rules
  const { data: rules, isLoading } = useQuery<AIRules>({
    queryKey: ["/api/ai/rules"],
  });
  
  // Fetch settings for LLM features
  const { data: settingsData } = useQuery<any>({
    queryKey: ["/api/settings"],
  });
  
  // Fetch AI Agent settings
  const { data: aiAgentSettings } = useQuery<AiAgentSettings>({
    queryKey: ["/api/ai-agent-settings"],
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
  
  // LLM Features state
  const [enableOrderRecommendations, setEnableOrderRecommendations] = useState(false);
  const [enableSupplierRanking, setEnableSupplierRanking] = useState(false);
  const [enableForecasting, setEnableForecasting] = useState(false);
  const [enableVisionCapture, setEnableVisionCapture] = useState(false);
  
  // AI Agent auto-send settings
  const [autoSendCriticalPos, setAutoSendCriticalPos] = useState(false);
  const [criticalRescueDays, setCriticalRescueDays] = useState(7);
  const [shopifyTwoWaySync, setShopifyTwoWaySync] = useState(false);
  const [shopifySafetyBuffer, setShopifySafetyBuffer] = useState(0);
  const [amazonTwoWaySync, setAmazonTwoWaySync] = useState(false);
  const [amazonSafetyBuffer, setAmazonSafetyBuffer] = useState(0);
  const [extensivTwoWaySync, setExtensivTwoWaySync] = useState(false);
  const [pivotLowDaysThreshold, setPivotLowDaysThreshold] = useState(5);
  const [hildaleHighDaysThreshold, setHildaleHighDaysThreshold] = useState(20);
  const [quickbooksIncludeHistory, setQuickbooksIncludeHistory] = useState(false);
  const [quickbooksHistoryMonths, setQuickbooksHistoryMonths] = useState(12);
  const [ordersToFetch, setOrdersToFetch] = useState(250);
  
  // Sync form with fetched rules
  useEffect(() => {
    if (rules) {
      setFormValues(rules);
    }
  }, [rules]);
  
  // Sync LLM features with settings
  useEffect(() => {
    if (settingsData) {
      setEnableOrderRecommendations(settingsData.enableLlmOrderRecommendations || false);
      setEnableSupplierRanking(settingsData.enableLlmSupplierRanking || false);
      setEnableForecasting(settingsData.enableLlmForecasting || false);
      setEnableVisionCapture(settingsData.enableVisionCapture || false);
    }
  }, [settingsData]);
  
  // Sync AI Agent settings
  useEffect(() => {
    if (aiAgentSettings) {
      setAutoSendCriticalPos(aiAgentSettings.autoSendCriticalPos || false);
      setCriticalRescueDays(aiAgentSettings.criticalRescueDays || 7);
      setShopifyTwoWaySync(aiAgentSettings.shopifyTwoWaySync || false);
      setShopifySafetyBuffer(aiAgentSettings.shopifySafetyBuffer || 0);
      setAmazonTwoWaySync(aiAgentSettings.amazonTwoWaySync || false);
      setAmazonSafetyBuffer(aiAgentSettings.amazonSafetyBuffer || 0);
      setExtensivTwoWaySync(aiAgentSettings.extensivTwoWaySync || false);
      setPivotLowDaysThreshold(aiAgentSettings.pivotLowDaysThreshold || 5);
      setHildaleHighDaysThreshold(aiAgentSettings.hildaleHighDaysThreshold || 20);
      setQuickbooksIncludeHistory(aiAgentSettings.quickbooksIncludeHistory || false);
      setQuickbooksHistoryMonths(aiAgentSettings.quickbooksHistoryMonths || 12);
      setOrdersToFetch(aiAgentSettings.ordersToFetch || 250);
    }
  }, [aiAgentSettings]);
  
  // Save mutation for rules (also saves AI features and agent settings)
  const saveMutation = useMutation({
    mutationFn: async (data: { 
      rules: Partial<AIRules>; 
      features: { enableLlmOrderRecommendations: boolean; enableLlmSupplierRanking: boolean; enableLlmForecasting: boolean; enableVisionCapture: boolean };
      agentSettings: { autoSendCriticalPos: boolean; criticalRescueDays: number; shopifyTwoWaySync: boolean; shopifySafetyBuffer: number; amazonTwoWaySync: boolean; amazonSafetyBuffer: number; extensivTwoWaySync: boolean; pivotLowDaysThreshold: number; hildaleHighDaysThreshold: number; quickbooksIncludeHistory: boolean; quickbooksHistoryMonths: number; ordersToFetch: number };
    }) => {
      // Save rules, features, and agent settings in parallel
      await Promise.all([
        apiRequest("PATCH", "/api/ai/rules", data.rules),
        apiRequest("PATCH", "/api/settings", data.features),
        apiRequest("PATCH", "/api/ai-agent-settings", data.agentSettings),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/at-risk"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-agent-settings"] });
      toast({
        title: "Rules Updated",
        description: "AI decision rules, features, and agent settings have been saved.",
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
    saveMutation.mutate({
      rules: formValues,
      features: {
        enableLlmOrderRecommendations: enableOrderRecommendations,
        enableLlmSupplierRanking: enableSupplierRanking,
        enableLlmForecasting: enableForecasting,
        enableVisionCapture: enableVisionCapture,
      },
      agentSettings: {
        autoSendCriticalPos,
        criticalRescueDays,
        shopifyTwoWaySync,
        shopifySafetyBuffer,
        amazonTwoWaySync,
        amazonSafetyBuffer,
        extensivTwoWaySync,
        pivotLowDaysThreshold,
        hildaleHighDaysThreshold,
        quickbooksIncludeHistory,
        quickbooksHistoryMonths,
        ordersToFetch,
      },
    });
  };
  
  if (isLoading) {
    return (
      <Card className="mt-8">
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
      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Decision Engine Rules
          </CardTitle>
          <CardDescription>
            Configure the parameters that drive AI-powered inventory recommendations. These rules determine how the engine calculates risk levels, reorder points, and suggested quantities.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* Sales Velocity Settings */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Sales Velocity
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="velocity-lookback">Lookback Window</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-velocity-lookback-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>How many days of past sales data to analyze when calculating how fast items sell. A longer window gives more stable averages but may miss recent trends.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
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
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="safety-stock">Safety Stock Buffer</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-safety-stock-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>Extra inventory days to keep as a cushion against unexpected demand spikes or supplier delays. Higher values mean less stockout risk but more capital tied up.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
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
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="risk-high">High Risk (Critical)</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-risk-high-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>Items projected to run out within this many days are flagged as critical and need immediate attention. These show as red alerts in your dashboard.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
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
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="risk-medium">Medium Risk</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-risk-medium-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>Items projected to run out within this many days get a warning. These show as yellow alerts—time to start planning a reorder.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
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
              </div>
            </div>
          </div>
          
          {/* Impact Weights */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Scale className="h-4 w-4" />
              Impact Weights
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="return-rate-impact">Return Rate Impact</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-return-rate-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>How much the AI adjusts order quantities based on historical return rates. At 50%, if an item has 10% returns, the AI orders 5% extra to compensate.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
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
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="ad-demand-impact">Ad Demand Signal Impact</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-ad-demand-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>How much to increase demand forecasts when running ad campaigns. Higher values mean more aggressive stock-up when ads are active.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
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
              </div>
            </div>
          </div>
          
          {/* AI Features */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4" />
              AI Features
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="enable-order-recommendations">Order Recommendations</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-order-recommendations-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>When enabled, AI analyzes your inventory levels and sales velocity to suggest when and how much to reorder for each item.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    id="enable-order-recommendations"
                    checked={enableOrderRecommendations}
                    onCheckedChange={setEnableOrderRecommendations}
                    data-testid="switch-order-recommendations"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="enable-supplier-ranking" className="text-muted-foreground">Supplier Ranking</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-supplier-ranking-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>AI will analyze supplier performance (pricing, lead times, reliability) and rank them to help you choose the best supplier for each order.</p>
                      </TooltipContent>
                    </Tooltip>
                    <Badge variant="secondary" className="text-xs">V2</Badge>
                  </div>
                  <Switch
                    id="enable-supplier-ranking"
                    checked={false}
                    disabled
                    data-testid="switch-supplier-ranking"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="enable-forecasting">Demand Forecasting</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-forecasting-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>Uses machine learning to predict future demand based on historical sales patterns, seasonality, and trends.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    id="enable-forecasting"
                    checked={enableForecasting}
                    onCheckedChange={setEnableForecasting}
                    data-testid="switch-forecasting"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="enable-vision-capture">Vision Capture</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-vision-capture-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>Use your device camera to scan and identify inventory items. AI will recognize products and help you add them to your inventory quickly.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    id="enable-vision-capture"
                    checked={enableVisionCapture}
                    onCheckedChange={setEnableVisionCapture}
                    data-testid="switch-vision-capture"
                  />
                </div>
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
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="default-lead-time">Default Lead Time</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-default-lead-time-info" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p>When a supplier doesn't have a specific lead time set, this fallback value is used. It tells the AI how far in advance to recommend ordering.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
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
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="dispute-penalty">Dispute Penalty</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-dispute-penalty-info" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p>Extra buffer days added when ordering from suppliers with past issues. If a supplier has been unreliable, the AI recommends ordering even earlier.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
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
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="min-order-qty">Min Order Quantity</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-min-order-qty-info" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p>The smallest quantity the AI will ever recommend ordering. Even if you only need 2 units, recommendations will be at least this amount.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
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
              </div>
            </div>
          </div>
          
          {/* AI Agent Automation */}
          <div className="space-y-4 pt-4 border-t">
            <h3 className="font-semibold flex items-center gap-2">
              <Send className="h-4 w-4" />
              AI Agent Automation
            </h3>
            <CardDescription className="mb-4">
              Configure automatic actions the AI Agent can take without human approval.
            </CardDescription>
            
            {/* Orders to Fetch - Universal Setting */}
            <div className="p-4 border rounded-lg space-y-4 mb-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="orders-to-fetch">Orders to Fetch</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-orders-fetch-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>Maximum number of orders to fetch when syncing from Shopify, Amazon, and other order sources. Higher values ensure you don't miss orders but take longer to sync.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <span className="text-sm text-muted-foreground">{ordersToFetch} orders</span>
                </div>
                <Slider
                  id="orders-to-fetch"
                  min={10}
                  max={1000}
                  step={10}
                  value={[ordersToFetch]}
                  onValueChange={([val]) => setOrdersToFetch(val)}
                  data-testid="slider-orders-fetch"
                />
                <p className="text-xs text-muted-foreground">
                  Applies to: Shopify, Amazon, and all other order sources
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Auto-Send Critical POs */}
              <div className="p-4 border rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="auto-send-critical-pos">Auto-Send Critical POs</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-auto-send-pos-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>When enabled, the AI Agent will automatically generate and send purchase orders for items at critical stock levels. POs are sent via GoHighLevel to designated suppliers.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    id="auto-send-critical-pos"
                    checked={autoSendCriticalPos}
                    onCheckedChange={setAutoSendCriticalPos}
                    data-testid="switch-auto-send-pos"
                  />
                </div>
                
                {autoSendCriticalPos && (
                  <div className="space-y-2 pl-2 border-l-2 border-primary/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor="critical-rescue-days">Rescue Window</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-rescue-days-info" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p>Auto-send PO when an item has this many days or fewer until stockout. A lower number means less aggressive auto-ordering.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <span className="text-sm text-muted-foreground">{criticalRescueDays} days</span>
                    </div>
                    <Slider
                      id="critical-rescue-days"
                      min={1}
                      max={14}
                      step={1}
                      value={[criticalRescueDays]}
                      onValueChange={([val]) => setCriticalRescueDays(val)}
                      data-testid="slider-rescue-days"
                    />
                  </div>
                )}
              </div>
              
              {/* Shopify Two-Way Sync */}
              <div className="p-4 border rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="shopify-two-way-sync">Shopify Two-Way Sync</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-shopify-sync-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>Push inventory levels back to Shopify when stock changes. This keeps your Shopify store in sync with actual availability.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    id="shopify-two-way-sync"
                    checked={shopifyTwoWaySync}
                    onCheckedChange={setShopifyTwoWaySync}
                    data-testid="switch-shopify-sync"
                  />
                </div>
                
                {shopifyTwoWaySync && (
                  <div className="space-y-2 pl-2 border-l-2 border-primary/20">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="shopify-safety-buffer">Safety Buffer</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-safety-buffer-info" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p>Subtract this amount from available stock when syncing to Shopify. Prevents overselling by keeping a reserve.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        id="shopify-safety-buffer"
                        type="number"
                        min={0}
                        max={100}
                        value={shopifySafetyBuffer}
                        onChange={(e) => setShopifySafetyBuffer(parseInt(e.target.value) || 0)}
                        data-testid="input-safety-buffer"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">units</span>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Amazon Two-Way Sync */}
              <div className="p-4 border rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="amazon-two-way-sync">Amazon Two-Way Sync</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-amazon-sync-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>Push inventory levels back to Amazon Seller Central when stock changes. This app becomes the FBM inventory master, syncing available quantities for mapped products.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    id="amazon-two-way-sync"
                    checked={amazonTwoWaySync}
                    onCheckedChange={setAmazonTwoWaySync}
                    data-testid="switch-amazon-sync"
                  />
                </div>
                
                {amazonTwoWaySync && (
                  <div className="space-y-2 pl-2 border-l-2 border-primary/20">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="amazon-safety-buffer">Safety Buffer</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-amazon-buffer-info" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p>Subtract this amount from available stock when syncing to Amazon. Prevents overselling by keeping a reserve.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        id="amazon-safety-buffer"
                        type="number"
                        min={0}
                        max={100}
                        value={amazonSafetyBuffer}
                        onChange={(e) => setAmazonSafetyBuffer(parseInt(e.target.value) || 0)}
                        data-testid="input-amazon-buffer"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">units</span>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Extensiv/Pivot Two-Way Sync */}
              <div className="p-4 border rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="extensiv-two-way-sync">Extensiv/Pivot Two-Way Sync</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-extensiv-sync-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>Enable two-way sync with Extensiv/Pivot 3PL warehouse. When OFF, only reads inventory from Extensiv. When ON, can push fulfillment orders to Extensiv for mapped products.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    id="extensiv-two-way-sync"
                    checked={extensivTwoWaySync}
                    onCheckedChange={setExtensivTwoWaySync}
                    data-testid="switch-extensiv-sync"
                  />
                </div>
                
                <div className="text-xs text-muted-foreground">
                  Mode: {extensivTwoWaySync ? "2-Way (Orders Enabled)" : "1-Way (Inbound Only)"}
                </div>
                
                <div className="space-y-4 border-t pt-4">
                  <h4 className="text-sm font-medium">Rebalancing Thresholds</h4>
                  <p className="text-xs text-muted-foreground">
                    When Pivot inventory is low AND Hildale inventory is high, a rebalancing alert will be triggered in GoHighLevel.
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor="pivot-low-threshold">Pivot Low Threshold</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-pivot-threshold-info" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p>Days of cover at Pivot below which a rebalance alert triggers. If Pivot has less than this many days of stock, and Hildale has excess, we recommend transferring inventory.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          id="pivot-low-threshold"
                          type="number"
                          min={1}
                          max={30}
                          value={pivotLowDaysThreshold}
                          onChange={(e) => setPivotLowDaysThreshold(parseInt(e.target.value) || 5)}
                          data-testid="input-pivot-threshold"
                        />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">days</span>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor="hildale-high-threshold">Hildale High Threshold</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-hildale-threshold-info" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p>Days of cover at Hildale above which a rebalance alert triggers. If Hildale has more than this many days of stock, excess can be transferred to Pivot.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          id="hildale-high-threshold"
                          type="number"
                          min={1}
                          max={90}
                          value={hildaleHighDaysThreshold}
                          onChange={(e) => setHildaleHighDaysThreshold(parseInt(e.target.value) || 20)}
                          data-testid="input-hildale-threshold"
                        />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">days</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* QuickBooks Demand History for AI Forecasting */}
              <div className="p-4 border rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="quickbooks-include-history">Include QuickBooks Demand History</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-qb-history-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>When enabled, the AI forecasting engine will include historical sales and returns data synced from QuickBooks Online to improve demand predictions.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    id="quickbooks-include-history"
                    checked={quickbooksIncludeHistory}
                    onCheckedChange={setQuickbooksIncludeHistory}
                    data-testid="switch-qb-include-history"
                  />
                </div>
                
                <div className="text-xs text-muted-foreground">
                  QuickBooks History: {quickbooksIncludeHistory ? "Included in AI Forecasting" : "Not Used"}
                </div>
                
                {quickbooksIncludeHistory && (
                  <div className="space-y-2 pl-2 border-l-2 border-primary/20">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="quickbooks-history-months">History Window</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-qb-months-info" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p>Number of months of QuickBooks demand history to include in AI analysis. More months gives better seasonal insights but may include outdated patterns.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        id="quickbooks-history-months"
                        type="number"
                        min={3}
                        max={36}
                        value={quickbooksHistoryMonths}
                        onChange={(e) => setQuickbooksHistoryMonths(parseInt(e.target.value) || 12)}
                        data-testid="input-qb-history-months"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">months</span>
                    </div>
                  </div>
                )}
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

function QuickBooksDemandHistoryTab() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  
  const queryParams = new URLSearchParams();
  if (search) queryParams.set("search", search);
  if (yearFilter !== "all") queryParams.set("year", yearFilter);
  if (monthFilter !== "all") queryParams.set("month", monthFilter);
  queryParams.set("page", String(page));
  queryParams.set("pageSize", String(pageSize));
  
  const { data, isLoading, isFetching, error } = useQuery<QBDemandHistoryResponse>({
    queryKey: ["/api/ai/insights/qb-demand-history", search, yearFilter, monthFilter, page],
    queryFn: async () => {
      const response = await fetch(`/api/ai/insights/qb-demand-history?${queryParams.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch demand history");
      return response.json();
    },
  });

  const monthNames = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const shortMonthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatRelativeTime = (dateStr: string | undefined) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const hasData = data && data.items.length > 0;
  const hasYears = data && data.years.length > 0;
  const isFiltered = search || yearFilter !== "all" || monthFilter !== "all";
  
  const lastSyncedAt = data?.items?.[0]?.lastSyncedAt || data?.items?.[0]?.updatedAt;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              QuickBooks Demand History
            </CardTitle>
            <CardDescription>
              Read-only historical demand imported from QuickBooks for forecasting.
            </CardDescription>
          </div>
          {lastSyncedAt && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Last synced: {formatRelativeTime(lastSyncedAt)}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2 flex-wrap mt-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by SKU or product..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-8 w-56"
              data-testid="input-qb-search"
            />
          </div>
          <Select 
            value={yearFilter} 
            onValueChange={(v) => {
              setYearFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-32" data-testid="select-qb-year">
              <SelectValue placeholder="All years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {hasYears && data.years.map(year => (
                <SelectItem key={year} value={String(year)}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select 
            value={monthFilter} 
            onValueChange={(v) => {
              setMonthFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36" data-testid="select-qb-month">
              <SelectValue placeholder="All months" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                <SelectItem key={m} value={String(m)}>{monthNames[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isFetching && !isLoading && (
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6">
            <Skeleton className="h-64 w-full" />
          </div>
        ) : error ? (
          <div className="h-32 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Failed to load demand history</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2"
                onClick={() => window.location.reload()}
                data-testid="button-qb-retry"
              >
                Retry
              </Button>
            </div>
          </div>
        ) : !hasData && !isFiltered ? (
          <div className="py-16 text-center">
            <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-lg font-medium text-foreground">No QuickBooks demand history</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              Connect QuickBooks and run "Sync Demand Now" from the integrations page to populate demand history.
            </p>
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => navigate("/settings")}
              data-testid="button-open-integrations"
            >
              <Settings2 className="mr-2 h-4 w-4" />
              Open Integrations
            </Button>
          </div>
        ) : !hasData && isFiltered ? (
          <div className="h-32 flex items-center justify-center text-muted-foreground">
            <p>No data matches your filters. Try adjusting the search criteria.</p>
          </div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-400px)] rounded-md border m-4 mt-0">
            <table className="w-full table-auto">
              <thead className="bg-muted sticky top-0 z-10">
                <tr className="border-b">
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap">Product</th>
                  <th className="p-3 text-left text-sm font-medium whitespace-nowrap w-px">SKU</th>
                  <th className="p-3 text-center text-sm font-medium whitespace-nowrap w-px">Period</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Sold</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Returned</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Net Qty</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Revenue</th>
                  <th className="p-3 text-right text-sm font-medium whitespace-nowrap w-px">Synced</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr 
                    key={item.id} 
                    className="border-b last:border-b-0 hover-elevate h-12"
                    data-testid={`row-qb-demand-${item.id}`}
                  >
                    <td className="p-3 align-middle whitespace-nowrap max-w-[200px] truncate" title={item.productName ?? ""}>
                      <span className="font-medium">{item.productName ?? "-"}</span>
                    </td>
                    <td className="p-3 align-middle font-mono text-sm whitespace-nowrap">
                      {item.sku}
                    </td>
                    <td className="p-3 align-middle text-center whitespace-nowrap">
                      {shortMonthNames[item.month]} {item.year}
                    </td>
                    <td className="p-3 align-middle text-right font-medium whitespace-nowrap text-green-600 dark:text-green-400">
                      +{item.qtySold.toLocaleString()}
                    </td>
                    <td className="p-3 align-middle text-right font-medium whitespace-nowrap text-red-600 dark:text-red-400">
                      {item.qtyReturned > 0 ? `-${item.qtyReturned.toLocaleString()}` : "0"}
                    </td>
                    <td className="p-3 align-middle text-right font-bold whitespace-nowrap">
                      {item.netQty.toLocaleString()}
                    </td>
                    <td className="p-3 align-middle text-right whitespace-nowrap">
                      {formatCurrency(item.revenue)}
                    </td>
                    <td className="p-3 align-middle text-right text-muted-foreground whitespace-nowrap text-xs">
                      {formatRelativeTime(item.lastSyncedAt || item.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {hasData && data.totalPages > 1 && (
        <CardFooter className="border-t pt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, data.total)} of {data.total} records
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || isFetching}
              data-testid="button-qb-prev-page"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {data.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
              disabled={page >= data.totalPages || isFetching}
              data-testid="button-qb-next-page"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}

// Column visibility configuration for AI Recommendations
interface ColumnConfig {
  id: string;
  label: string;
  group: "current" | "supplyChain" | "historical" | "financial" | "production";
  visible: boolean;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  // Current State
  { id: "sku", label: "SKU", group: "current", visible: true },
  { id: "productName", label: "Product", group: "current", visible: true },
  { id: "riskLevel", label: "Risk", group: "current", visible: true },
  { id: "orderTiming", label: "Timing", group: "current", visible: true },
  { id: "daysUntilStockout", label: "Days Left", group: "current", visible: true },
  { id: "availableForSale", label: "Available", group: "current", visible: true },
  { id: "hildaleQty", label: "Hildale Qty", group: "current", visible: true },
  { id: "pivotQty", label: "Pivot Qty", group: "current", visible: true },
  
  // Supply Chain
  { id: "supplierLeadTime", label: "Lead Time", group: "supplyChain", visible: true },
  { id: "qtyOnPO", label: "On PO", group: "supplyChain", visible: true },
  { id: "moq", label: "MOQ", group: "supplyChain", visible: false },
  { id: "supplierName", label: "Supplier", group: "supplyChain", visible: true },
  { id: "supplierScore", label: "Supplier Score", group: "supplyChain", visible: false },
  
  // Historical
  { id: "demandRisk", label: "Demand Risk", group: "historical", visible: true },
  { id: "salesVelocity", label: "Velocity", group: "historical", visible: true },
  { id: "velocityTrend", label: "Trend", group: "historical", visible: false },
  { id: "yoySales", label: "YoY Sales", group: "historical", visible: false },
  { id: "stockoutHistory", label: "Stockout Hist", group: "historical", visible: false },
  { id: "returnRate", label: "Return Rate", group: "historical", visible: false },
  
  // Financial
  { id: "unitCost", label: "Unit Cost", group: "financial", visible: false },
  { id: "margin", label: "Margin", group: "financial", visible: false },
  { id: "revenueImpact", label: "Rev Impact", group: "financial", visible: false },
  { id: "carryingCost", label: "Carrying Cost", group: "financial", visible: false },
  
  // Production
  { id: "bomComponents", label: "BOM Components", group: "production", visible: false },
  { id: "productionCapacity", label: "Capacity", group: "production", visible: false },
  { id: "criticality", label: "Criticality", group: "production", visible: false },
];

const COLUMN_GROUPS = {
  current: { label: "Current State", color: "bg-blue-100 dark:bg-blue-900/30" },
  supplyChain: { label: "Supply Chain", color: "bg-green-100 dark:bg-green-900/30" },
  historical: { label: "Historical", color: "bg-purple-100 dark:bg-purple-900/30" },
  financial: { label: "Financial", color: "bg-yellow-100 dark:bg-yellow-900/30" },
  production: { label: "Production", color: "bg-orange-100 dark:bg-orange-900/30" },
};

// Comprehensive AI Recommendations Data Interface
interface AIRecommendationData {
  id: string;
  sku: string;
  productName: string;
  itemId: string;
  
  // Current State
  riskLevel: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  orderTiming: "ORDER_TODAY" | "SAFE_UNTIL_TOMORROW" | null;
  daysUntilStockout: number | null;
  availableForSale: number;
  hildaleQty: number;
  pivotQty: number;
  
  // Supply Chain
  supplierLeadTime: number;
  qtyOnPO: number;
  moq: number | null;
  supplierName: string | null;
  supplierScore: number | null;
  
  // Historical
  adMultiplier: number | null;
  salesVelocity: number;
  velocityTrend: number | null;
  yoySales: number | null;
  stockoutHistory: number;
  returnRate: number | null;
  
  // Financial
  unitCost: number | null;
  margin: number | null;
  revenueImpact: number | null;
  carryingCost: number | null;
  
  // Production
  bomComponents: number;
  productionCapacity: number | null;
  criticality: "HIGH" | "MEDIUM" | "LOW" | null;
  
  // AI Decision
  recommendedQty: number;
  reasonSummary: string | null;
  status: "NEW" | "ACCEPTED" | "DISMISSED";
  createdAt: string;
}

function AIRecommendationsTab() {
  const { toast } = useToast();
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [showColumnEditor, setShowColumnEditor] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [timingFilter, setTimingFilter] = useState<string>("all");
  
  // Fetch comprehensive recommendation data
  const { data: recsData, isLoading, isFetching } = useQuery<{ recommendations: AIRecommendationData[]; summary: any }>({
    queryKey: ["/api/ai/recommendations/comprehensive"],
    queryFn: async () => {
      const response = await fetch("/api/ai/recommendations/comprehensive", {
        credentials: "include",
      });
      if (!response.ok) {
        // Fallback to regular recommendations if comprehensive endpoint doesn't exist yet
        const fallbackResponse = await fetch("/api/ai/recommendations?status=active", {
          credentials: "include",
        });
        if (!fallbackResponse.ok) throw new Error("Failed to fetch recommendations");
        const fallbackData = await fallbackResponse.json();
        // Transform to comprehensive format
        return {
          recommendations: (fallbackData.recommendations || []).map((rec: any) => ({
            id: rec.id,
            sku: rec.sku,
            productName: rec.productName,
            itemId: rec.itemId,
            riskLevel: rec.riskLevel,
            orderTiming: rec.orderTiming,
            daysUntilStockout: rec.daysUntilStockout,
            availableForSale: rec.availableForSale ?? 0,
            hildaleQty: 0,
            pivotQty: rec.availableForSale ?? 0,
            supplierLeadTime: 14,
            qtyOnPO: rec.qtyOnPo ?? 0,
            moq: null,
            supplierName: null,
            supplierScore: null,
            adMultiplier: rec.adMultiplier ?? null,
            salesVelocity: rec.adjustedVelocity ?? rec.baseVelocity ?? 0,
            velocityTrend: null,
            yoySales: null,
            stockoutHistory: 0,
            returnRate: null,
            unitCost: null,
            margin: null,
            revenueImpact: null,
            carryingCost: null,
            bomComponents: 0,
            productionCapacity: null,
            criticality: null,
            recommendedQty: rec.recommendedQty ?? 0,
            reasonSummary: rec.reasonSummary,
            status: rec.status,
            createdAt: rec.createdAt,
          })),
          summary: fallbackData.summary,
        };
      }
      return response.json();
    },
  });
  
  const visibleColumns = columns.filter(c => c.visible);
  
  // Filter recommendations
  const filteredRecs = (recsData?.recommendations || []).filter(rec => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!rec.sku.toLowerCase().includes(query) && 
          !rec.productName.toLowerCase().includes(query)) {
        return false;
      }
    }
    if (riskFilter !== "all" && rec.riskLevel !== riskFilter) return false;
    if (timingFilter !== "all") {
      if (timingFilter === "ORDER_TODAY" && rec.orderTiming !== "ORDER_TODAY") return false;
      if (timingFilter === "SAFE" && rec.orderTiming === "ORDER_TODAY") return false;
    }
    return true;
  });
  
  // Sort by risk level (HIGH first, then ORDER_TODAY)
  const sortedRecs = [...filteredRecs].sort((a, b) => {
    const riskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, UNKNOWN: 3 };
    const riskDiff = (riskOrder[a.riskLevel] || 3) - (riskOrder[b.riskLevel] || 3);
    if (riskDiff !== 0) return riskDiff;
    if (a.orderTiming === "ORDER_TODAY" && b.orderTiming !== "ORDER_TODAY") return -1;
    if (b.orderTiming === "ORDER_TODAY" && a.orderTiming !== "ORDER_TODAY") return 1;
    return (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999);
  });
  
  const getRiskBadgeVariant = (risk: string): "destructive" | "secondary" | "outline" | "default" => {
    switch (risk) {
      case "HIGH": return "destructive";
      case "MEDIUM": return "secondary";
      case "LOW": return "outline";
      default: return "outline";
    }
  };
  
  const formatNumber = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return "-";
    return val.toLocaleString();
  };
  
  const formatPercent = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return "-";
    return `${(val * 100).toFixed(1)}%`;
  };
  
  const formatCurrency = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return "-";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
  };
  
  const renderCellValue = (rec: AIRecommendationData, columnId: string): React.ReactNode => {
    switch (columnId) {
      case "sku":
        return <span className="font-mono text-sm">{rec.sku}</span>;
      case "productName":
        return <span className="max-w-[200px] truncate block">{rec.productName}</span>;
      case "riskLevel":
        return (
          <Badge variant={getRiskBadgeVariant(rec.riskLevel)} className="text-xs">
            {rec.riskLevel}
          </Badge>
        );
      case "orderTiming":
        return rec.orderTiming === "ORDER_TODAY" ? (
          <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-xs">Order Today</Badge>
        ) : (
          <Badge variant="outline" className="text-xs">Safe</Badge>
        );
      case "daysUntilStockout":
        const days = rec.daysUntilStockout;
        return (
          <span className={days !== null && days < 7 ? "text-destructive font-medium" : ""}>
            {days !== null ? `${days}d` : "-"}
          </span>
        );
      case "availableForSale":
        return <span className={rec.availableForSale < 0 ? "text-destructive" : ""}>{formatNumber(rec.availableForSale)}</span>;
      case "hildaleQty":
        return formatNumber(rec.hildaleQty);
      case "pivotQty":
        return formatNumber(rec.pivotQty);
      case "supplierLeadTime":
        return `${rec.supplierLeadTime}d`;
      case "qtyOnPO":
        return formatNumber(rec.qtyOnPO);
      case "moq":
        return formatNumber(rec.moq);
      case "supplierName":
        return rec.supplierName || "-";
      case "supplierScore":
        return rec.supplierScore !== null ? `${rec.supplierScore}/100` : "-";
      case "demandRisk":
        if (rec.adMultiplier === null || rec.adMultiplier <= 1) {
          return <span className="text-muted-foreground">—</span>;
        }
        const surgePercent = Math.round((rec.adMultiplier - 1) * 100);
        return (
          <Badge 
            className={`text-xs ${
              surgePercent >= 30 
                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" 
                : surgePercent >= 15 
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                  : "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
            }`}
            title={`Ad performance indicates ${surgePercent}% potential demand increase`}
          >
            +{surgePercent}% surge
          </Badge>
        );
      case "salesVelocity":
        return `${rec.salesVelocity.toFixed(1)}/day`;
      case "velocityTrend":
        if (rec.velocityTrend === null) return "-";
        const trend = rec.velocityTrend;
        return (
          <span className={trend > 0 ? "text-green-600" : trend < 0 ? "text-red-600" : ""}>
            {trend > 0 ? "+" : ""}{(trend * 100).toFixed(0)}%
          </span>
        );
      case "yoySales":
        return formatNumber(rec.yoySales);
      case "stockoutHistory":
        return rec.stockoutHistory > 0 ? (
          <span className="text-orange-600">{rec.stockoutHistory}x</span>
        ) : "0";
      case "returnRate":
        return formatPercent(rec.returnRate);
      case "unitCost":
        return formatCurrency(rec.unitCost);
      case "margin":
        return formatPercent(rec.margin);
      case "revenueImpact":
        return formatCurrency(rec.revenueImpact);
      case "carryingCost":
        return formatCurrency(rec.carryingCost);
      case "bomComponents":
        return rec.bomComponents > 0 ? `${rec.bomComponents} parts` : "-";
      case "productionCapacity":
        return formatNumber(rec.productionCapacity);
      case "criticality":
        return rec.criticality ? (
          <Badge variant={rec.criticality === "HIGH" ? "destructive" : rec.criticality === "MEDIUM" ? "secondary" : "outline"} className="text-xs">
            {rec.criticality}
          </Badge>
        ) : "-";
      default:
        return "-";
    }
  };
  
  const toggleColumn = (columnId: string) => {
    setColumns(prev => prev.map(col => 
      col.id === columnId ? { ...col, visible: !col.visible } : col
    ));
  };
  
  const toggleGroupColumns = (group: string, visible: boolean) => {
    setColumns(prev => prev.map(col => 
      col.group === group ? { ...col, visible } : col
    ));
  };
  
  if (isLoading) {
    return (
      <Card className="mt-8">
        <CardContent className="pt-6">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-4 mt-8">
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                AI Recommendations
              </CardTitle>
              <CardDescription>
                Comprehensive inventory recommendations with all decision factors.
                {recsData?.summary && (
                  <span className="block text-xs mt-1">
                    {recsData.summary.highRisk || 0} critical • {recsData.summary.total || 0} total items
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search SKU or product..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-48"
                  data-testid="input-ai-rec-search"
                />
              </div>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger className="w-28" data-testid="select-risk-filter-main">
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
              <Select value={timingFilter} onValueChange={setTimingFilter}>
                <SelectTrigger className="w-36" data-testid="select-timing-filter">
                  <Clock className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Timing" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="ORDER_TODAY">Order Today</SelectItem>
                  <SelectItem value="SAFE">Safe Until Tomorrow</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowColumnEditor(true)}
                data-testid="button-edit-columns"
              >
                <Settings2 className="h-4 w-4 mr-2" />
                Edit Columns
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[calc(100vh-350px)]">
            <table className="w-full">
              <thead className="bg-muted sticky top-0 z-10">
                <tr className="border-b">
                  {visibleColumns.map(col => (
                    <th 
                      key={col.id} 
                      className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
                      data-testid={`th-${col.id}`}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap">Rec Qty</th>
                </tr>
              </thead>
              <tbody>
                {sortedRecs.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length + 1} className="h-32 text-center text-muted-foreground">
                      No recommendations found
                    </td>
                  </tr>
                ) : (
                  sortedRecs.map(rec => (
                    <tr 
                      key={rec.id} 
                      className={`border-b last:border-b-0 hover-elevate ${
                        rec.orderTiming === "ORDER_TODAY" ? "bg-amber-50 dark:bg-amber-950/20" : ""
                      }`}
                      data-testid={`row-ai-rec-${rec.id}`}
                    >
                      {visibleColumns.map(col => (
                        <td key={col.id} className="px-3 py-2 text-sm whitespace-nowrap">
                          {renderCellValue(rec, col.id)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-sm whitespace-nowrap font-medium">
                        {rec.recommendedQty > 0 ? (
                          <Badge variant="default">{rec.recommendedQty}</Badge>
                        ) : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
        <CardFooter className="justify-between border-t p-4">
          <p className="text-sm text-muted-foreground">
            Showing {sortedRecs.length} of {recsData?.recommendations?.length || 0} recommendations
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {visibleColumns.length} of {columns.length} columns visible
            </span>
          </div>
        </CardFooter>
      </Card>
      
      {/* Column Editor Dialog */}
      <Dialog open={showColumnEditor} onOpenChange={setShowColumnEditor}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Edit Visible Columns
            </DialogTitle>
            <DialogDescription>
              Select which columns to display. Hidden columns are excluded from AI decision context.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {Object.entries(COLUMN_GROUPS).map(([groupKey, groupConfig]) => (
              <div key={groupKey} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium px-2 py-1 rounded ${groupConfig.color}`}>
                    {groupConfig.label}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleGroupColumns(groupKey, true)}
                      data-testid={`button-show-all-${groupKey}`}
                    >
                      Show All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleGroupColumns(groupKey, false)}
                      data-testid={`button-hide-all-${groupKey}`}
                    >
                      Hide All
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {columns.filter(c => c.group === groupKey).map(col => (
                    <div 
                      key={col.id} 
                      className="flex items-center gap-2 p-2 border rounded hover-elevate cursor-pointer"
                      onClick={() => toggleColumn(col.id)}
                    >
                      <Switch
                        checked={col.visible}
                        onCheckedChange={() => toggleColumn(col.id)}
                        data-testid={`switch-column-${col.id}`}
                      />
                      <Label className="cursor-pointer text-sm">{col.label}</Label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InsightsTab() {
  const { toast } = useToast();
  const [insightsSubTab, setInsightsSubTab] = useState<string>("recommendations");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedItem, setSelectedItem] = useState<PersistedRecommendation | null>(null);
  const [sheetItem, setSheetItem] = useState<PersistedRecommendation | null>(null);
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
  
  // Sync Google Ads demand signals mutation
  const syncGoogleAdsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/ads/google/sync-demand", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to sync Google Ads demand");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/recommendations"] });
      toast({
        title: "Google Ads Synced",
        description: data.message || `Updated ${data.itemsProcessed} recommendations with demand signals.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync Google Ads demand signals",
        variant: "destructive",
      });
    },
  });

  // Sync Meta Ads demand signals mutation
  const syncMetaAdsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/ads/meta/sync-demand", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to sync Meta Ads demand");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/recommendations"] });
      toast({
        title: "Meta Ads Synced",
        description: data.message || `Updated ${data.itemsProcessed} recommendations with demand signals.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync Meta Ads demand signals",
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
  
  const getSourceDecisionBadgeVariant = (status: SourceDecisionStatus): "default" | "secondary" | "outline" | "destructive" => {
    switch (status) {
      case "ORDER": return "default";
      case "DONT_ORDER": return "destructive";
      case "NEUTRAL": return "secondary";
      case "NO_DATA": return "outline";
      default: return "outline";
    }
  };
  
  const getSourceDecisionBadgeText = (status: SourceDecisionStatus): string => {
    switch (status) {
      case "ORDER": return "Order";
      case "DONT_ORDER": return "Hold";
      case "NEUTRAL": return "Neutral";
      case "NO_DATA": return "N/A";
      default: return "N/A";
    }
  };
  
  const getSourceDecision = (rec: PersistedRecommendation, source: string): SourceDecision | undefined => {
    if (!rec.sourceDecisionsJson?.sourceDecisions) return undefined;
    return rec.sourceDecisionsJson.sourceDecisions.find(d => d.source === source);
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
  
  return (
    <div className="space-y-4 mt-8">
      {/* Internal Tabs Switcher */}
      <Tabs value={insightsSubTab} onValueChange={setInsightsSubTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="recommendations" data-testid="tab-ai-recommendations" className="gap-2">
            <Brain className="h-4 w-4" />
            AI Recommendations
          </TabsTrigger>
          <TabsTrigger value="qb-demand" data-testid="tab-qb-demand" className="gap-2">
            <Database className="h-4 w-4" />
            QuickBooks Demand History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="qb-demand">
          <QuickBooksDemandHistoryTab />
        </TabsContent>

        <TabsContent value="recommendations">
          {isLoading ? (
            <Card>
              <CardContent className="pt-6">
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* AI Recommendations Header */}
              <Card>
                <CardHeader>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <CardTitle>AI Recommendations</CardTitle>
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
                        onClick={() => {
                          syncGoogleAdsMutation.mutate();
                          syncMetaAdsMutation.mutate();
                        }}
                        disabled={syncGoogleAdsMutation.isPending || syncMetaAdsMutation.isPending}
                        data-testid="button-sync-all-ads"
                      >
                        <TrendingUp className={`mr-2 h-4 w-4 ${(syncGoogleAdsMutation.isPending || syncMetaAdsMutation.isPending) ? "animate-spin" : ""}`} />
                        Sync Ads
                      </Button>
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
      </Card>
      
      {/* AI Recommendations Table - separate from header card */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full table-auto text-sm">
              <thead className="bg-muted/50">
                <tr className="h-11 border-b">
                  <th className="px-3 text-left font-medium whitespace-nowrap w-px">SKU</th>
                  <th className="px-3 text-left font-medium whitespace-nowrap">Product</th>
                  <th className="px-3 text-left font-medium whitespace-nowrap w-px">Type</th>
                  <th className="px-3 text-left font-medium whitespace-nowrap w-px">Risk</th>
                  <th className="px-3 text-center font-medium whitespace-nowrap w-px">Timing</th>
                  <th className="px-3 text-right font-medium whitespace-nowrap w-px">Days Left</th>
                  <th className="px-3 text-right font-medium whitespace-nowrap w-px">Available for Sale</th>
                  <th className="px-3 text-right font-medium whitespace-nowrap w-px">Gap%</th>
                  <th className="px-3 text-center font-medium whitespace-nowrap w-px">G.Ads</th>
                  <th className="px-3 text-center font-medium whitespace-nowrap w-px">Meta</th>
                  <th className="px-3 text-center font-medium whitespace-nowrap w-px">Shopify</th>
                  <th className="px-3 text-center font-medium whitespace-nowrap w-px">QB</th>
                  <th className="px-3 text-right font-medium whitespace-nowrap w-px">On PO</th>
                  <th className="px-3 text-right font-medium whitespace-nowrap w-px">Rec Qty</th>
                  <th className="px-3 text-right font-medium whitespace-nowrap w-px">Velocity</th>
                  <th className="px-3 text-left font-medium whitespace-nowrap w-px">Status</th>
                  <th className="px-3 text-center font-medium whitespace-nowrap w-px sticky right-0 z-10 bg-muted shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecommendations.length === 0 ? (
                  <tr>
                    <td colSpan={17} className="text-center text-muted-foreground py-8">
                      {recsData?.recommendations.length === 0 
                        ? "No actionable recommendations. Click Refresh to generate new recommendations."
                        : "No items match the selected filters."
                      }
                    </td>
                  </tr>
                ) : (
                  filteredRecommendations.map((rec) => (
                    <tr 
                      key={rec.id} 
                      data-testid={`row-recommendation-${rec.id}`}
                      className={`h-11 border-b hover-elevate cursor-pointer ${rec.status === "DISMISSED" ? "opacity-50" : ""}`}
                      onClick={() => setSelectedItem(rec)}
                    >
                      <td className="px-3 align-middle font-mono text-sm whitespace-nowrap">
                        {rec.sku}
                      </td>
                      <td className="px-3 align-middle whitespace-nowrap max-w-[180px] truncate" title={rec.productName}>
                        {rec.productName}
                      </td>
                      <td className="px-3 align-middle whitespace-nowrap">
                        <span className={`text-sm font-medium ${getTypeBadgeColor(rec.recommendationType ?? "MONITOR")}`}>
                          {(rec.recommendationType ?? "MONITOR").replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-3 align-middle whitespace-nowrap">
                        <Badge 
                          variant={getRiskBadgeVariant(rec.riskLevel)} 
                          data-testid={`badge-risk-${rec.id}`}
                        >
                          {rec.riskLevel}
                        </Badge>
                      </td>
                      <td className="px-3 align-middle text-center whitespace-nowrap">
                        {rec.orderTiming ? (
                          <Badge 
                            variant={rec.orderTiming === "ORDER_TODAY" ? "destructive" : "secondary"}
                            className="text-xs"
                            data-testid={`badge-timing-${rec.id}`}
                          >
                            {rec.orderTiming === "ORDER_TODAY" ? "Order Today" : "Safe Till Tomorrow"}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </td>
                      <td className="px-3 align-middle text-right whitespace-nowrap">
                        {rec.daysUntilStockout ?? "-"}
                      </td>
                      <td className={`px-3 align-middle text-right whitespace-nowrap ${(rec.availableForSale ?? 0) < 0 ? "text-destructive font-bold" : ""}`}>
                        {rec.availableForSale ?? "-"}
                      </td>
                      <td className={`px-3 align-middle text-right whitespace-nowrap ${getStockGapColor(rec.stockGapPercent)}`}>
                        {formatStockGap(rec.stockGapPercent)}
                      </td>
                      <td className="px-3 align-middle text-center whitespace-nowrap">
                        {(() => {
                          const decision = getSourceDecision(rec, "GOOGLE_ADS");
                          return decision ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Badge 
                                    variant={getSourceDecisionBadgeVariant(decision.status)}
                                    className="cursor-pointer text-xs px-1.5"
                                    onClick={(e) => { e.stopPropagation(); setSheetItem(rec); }}
                                  >
                                    {getSourceDecisionBadgeText(decision.status)}
                                  </Badge>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="text-sm">{decision.rationale}</div>
                                {decision.metrics.conversions !== undefined && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {decision.metrics.conversions} conversions, {decision.metrics.projectedCoverageDays?.toFixed(0)}d coverage
                                  </div>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          );
                        })()}
                      </td>
                      <td className="px-3 align-middle text-center whitespace-nowrap">
                        {(() => {
                          const decision = getSourceDecision(rec, "META_ADS");
                          return decision ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Badge 
                                    variant={getSourceDecisionBadgeVariant(decision.status)}
                                    className="cursor-pointer text-xs px-1.5"
                                    onClick={(e) => { e.stopPropagation(); setSheetItem(rec); }}
                                  >
                                    {getSourceDecisionBadgeText(decision.status)}
                                  </Badge>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="text-sm">{decision.rationale}</div>
                                {decision.metrics.avgConvPerDay !== undefined && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {decision.metrics.avgConvPerDay?.toFixed(1)} conv/day, ROAS {decision.metrics.roas?.toFixed(1)}
                                  </div>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          );
                        })()}
                      </td>
                      <td className="px-3 align-middle text-center whitespace-nowrap">
                        {(() => {
                          const decision = getSourceDecision(rec, "SHOPIFY");
                          return decision ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Badge 
                                    variant={getSourceDecisionBadgeVariant(decision.status)}
                                    className="cursor-pointer text-xs px-1.5"
                                    onClick={(e) => { e.stopPropagation(); setSheetItem(rec); }}
                                  >
                                    {getSourceDecisionBadgeText(decision.status)}
                                  </Badge>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="text-sm">{decision.rationale}</div>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          );
                        })()}
                      </td>
                      <td className="px-3 align-middle text-center whitespace-nowrap">
                        {(() => {
                          const decision = getSourceDecision(rec, "QUICKBOOKS");
                          return decision ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Badge 
                                    variant={getSourceDecisionBadgeVariant(decision.status)}
                                    className="cursor-pointer text-xs px-1.5"
                                    onClick={(e) => { e.stopPropagation(); setSheetItem(rec); }}
                                  >
                                    {getSourceDecisionBadgeText(decision.status)}
                                  </Badge>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="text-sm">{decision.rationale}</div>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          );
                        })()}
                      </td>
                      <td className="px-3 align-middle text-right whitespace-nowrap">
                        {rec.qtyOnPo ?? 0}
                      </td>
                      <td className="px-3 align-middle text-right font-medium whitespace-nowrap">
                        {rec.recommendedQty ?? "-"}
                      </td>
                      <td className="px-3 align-middle text-right whitespace-nowrap text-sm">
                        {rec.adjustedVelocity?.toFixed(1) ?? "-"}/d
                        {rec.adMultiplier && rec.adMultiplier > 1 && (
                          <span className="text-purple-500 ml-1" title={`Ad boost: ${rec.adMultiplier.toFixed(1)}x`}>
                            <Zap className="inline h-3 w-3" />
                          </span>
                        )}
                      </td>
                      <td className="px-3 align-middle whitespace-nowrap">
                        <Badge 
                          variant={getStatusBadgeVariant(rec.status)}
                          data-testid={`badge-status-${rec.id}`}
                        >
                          {rec.status}
                        </Badge>
                      </td>
                      <td className="px-3 align-middle whitespace-nowrap sticky right-0 z-10 bg-card shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.1)] dark:shadow-[inset_8px_0_8px_-8px_rgba(0,0,0,0.3)]">
                        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {rec.status === "NEW" && rec.recommendationType !== "OK" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-primary"
                                  onClick={(e) => { e.stopPropagation(); handleCreatePO(rec); }}
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
                                    onClick={(e) => { e.stopPropagation(); updateStatusMutation.mutate({ id: rec.id, status: "ACCEPTED" }); }}
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
                                    onClick={(e) => { e.stopPropagation(); updateStatusMutation.mutate({ id: rec.id, status: "DISMISSED" }); }}
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
                                  onClick={(e) => { e.stopPropagation(); updateStatusMutation.mutate({ id: rec.id, status: "NEW" }); }}
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
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
      
      {/* Source Decisions Slide-over Sheet */}
      <Sheet open={!!sheetItem} onOpenChange={(open) => !open && setSheetItem(null)}>
        <SheetContent className="w-[450px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Source Signals Breakdown
            </SheetTitle>
            <SheetDescription>
              {sheetItem?.productName} ({sheetItem?.sku})
            </SheetDescription>
          </SheetHeader>
          {sheetItem && (
            <div className="mt-6 space-y-6">
              {/* Final recommendation banner */}
              <div className="p-4 rounded-lg bg-muted">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Final Recommendation</span>
                  <Badge variant={
                    sheetItem.recommendationType === "REORDER" ? "default" :
                    sheetItem.recommendationType === "MONITOR" ? "secondary" : "outline"
                  }>
                    {sheetItem.recommendationType?.replace("_", " ") || "N/A"}
                  </Badge>
                </div>
                {sheetItem.sourceDecisionsJson?.llmSynthesis && (
                  <p className="text-sm text-muted-foreground">
                    {sheetItem.sourceDecisionsJson.llmSynthesis}
                  </p>
                )}
              </div>
              
              {/* Source decisions list */}
              <div className="space-y-4">
                <h4 className="text-sm font-medium">Source Signals</h4>
                {sheetItem.sourceDecisionsJson?.sourceDecisions ? (
                  sheetItem.sourceDecisionsJson.sourceDecisions.map((decision) => (
                    <div key={decision.source} className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">
                          {decision.source === "GOOGLE_ADS" ? "Google Ads" :
                           decision.source === "META_ADS" ? "Meta Ads" :
                           decision.source === "SHOPIFY" ? "Shopify" :
                           decision.source === "EXTENSIV" ? "Extensiv" :
                           decision.source === "QUICKBOOKS" ? "QuickBooks" :
                           decision.source}
                        </span>
                        <Badge variant={getSourceDecisionBadgeVariant(decision.status)}>
                          {getSourceDecisionBadgeText(decision.status)}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {decision.rationale}
                      </p>
                      {/* Metrics */}
                      {Object.keys(decision.metrics).length > 0 && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {decision.metrics.conversions !== undefined && (
                            <div>
                              <span className="text-muted-foreground">Conversions:</span>{" "}
                              <span className="font-medium">{decision.metrics.conversions}</span>
                            </div>
                          )}
                          {decision.metrics.spend !== undefined && (
                            <div>
                              <span className="text-muted-foreground">Spend:</span>{" "}
                              <span className="font-medium">${decision.metrics.spend.toFixed(2)}</span>
                            </div>
                          )}
                          {decision.metrics.roas !== undefined && (
                            <div>
                              <span className="text-muted-foreground">ROAS:</span>{" "}
                              <span className="font-medium">{decision.metrics.roas.toFixed(2)}x</span>
                            </div>
                          )}
                          {decision.metrics.projectedCoverageDays !== undefined && (
                            <div>
                              <span className="text-muted-foreground">Coverage:</span>{" "}
                              <span className="font-medium">{decision.metrics.projectedCoverageDays.toFixed(0)} days</span>
                            </div>
                          )}
                          {decision.metrics.velocityTrend !== undefined && (
                            <div>
                              <span className="text-muted-foreground">Velocity Trend:</span>{" "}
                              <span className={`font-medium ${decision.metrics.velocityTrend > 0 ? "text-green-600" : decision.metrics.velocityTrend < 0 ? "text-red-600" : ""}`}>
                                {decision.metrics.velocityTrend > 0 ? "+" : ""}{(decision.metrics.velocityTrend * 100).toFixed(0)}%
                              </span>
                            </div>
                          )}
                          {decision.metrics.salesVelocity !== undefined && (
                            <div>
                              <span className="text-muted-foreground">Sales Velocity:</span>{" "}
                              <span className="font-medium">{decision.metrics.salesVelocity.toFixed(1)}/day</span>
                            </div>
                          )}
                          {decision.metrics.orderCount !== undefined && (
                            <div>
                              <span className="text-muted-foreground">Orders:</span>{" "}
                              <span className="font-medium">{decision.metrics.orderCount}</span>
                            </div>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        Updated: {new Date(decision.updatedAt).toLocaleString()}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No source signals available</p>
                    <p className="text-sm mt-1">Click "Sync Ads" to fetch demand signals from connected platforms.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      
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
      
      {/* AI System Suggestions Section */}
      <SystemSuggestionsSection />
            </div>
          )}
        </TabsContent>
      </Tabs>
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
  details: Record<string, any> | null;
  metadata?: Record<string, any> | null; // Legacy field for backward compatibility
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

interface SyncedRecord {
  id: string;
  orderNumber?: string;
  customerName?: string;
  status?: string;
  totalAmount?: number;
  currency?: string;
  itemCount?: number;
  syncAction?: 'created' | 'updated' | 'skipped';
  syncReason?: string;
}

function SyncedRecordsTable({ records }: { records: SyncedRecord[] }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterAction, setFilterAction] = useState<string>("all");
  
  const filteredRecords = records.filter(record => {
    const matchesSearch = !searchTerm || 
      record.orderNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.id?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAction = filterAction === "all" || record.syncAction === filterAction;
    
    return matchesSearch && matchesAction;
  });
  
  const createdCount = records.filter(r => r.syncAction === 'created').length;
  const updatedCount = records.filter(r => r.syncAction === 'updated').length;
  const skippedCount = records.filter(r => r.syncAction === 'skipped').length;
  
  const getActionBadge = (action?: string) => {
    switch (action) {
      case 'created':
        return <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">Created</Badge>;
      case 'updated':
        return <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20">Updated</Badge>;
      case 'skipped':
        return <Badge className="bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20">Skipped</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };
  
  const formatCurrency = (amount?: number, currency?: string) => {
    if (amount === undefined || amount === null) return "—";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  };
  
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Synced Records ({records.length} total)</p>
        <div className="flex items-center gap-2">
          <Badge className="bg-green-500/10 text-green-600">{createdCount} created</Badge>
          <Badge className="bg-blue-500/10 text-blue-600">{updatedCount} updated</Badge>
          {skippedCount > 0 && (
            <Badge className="bg-yellow-500/10 text-yellow-600">{skippedCount} skipped</Badge>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search by order number or customer..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 h-8 text-sm"
          data-testid="input-sync-records-search"
        />
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-32 h-8 text-sm" data-testid="select-sync-action-filter">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="updated">Updated</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <ScrollArea className="h-[300px] border rounded-lg">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm">
            <tr className="border-b">
              <th className="text-left p-2 font-medium">Order #</th>
              <th className="text-left p-2 font-medium">Customer</th>
              <th className="text-left p-2 font-medium">Status</th>
              <th className="text-right p-2 font-medium">Amount</th>
              <th className="text-center p-2 font-medium">Items</th>
              <th className="text-center p-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center p-4 text-muted-foreground">
                  No records match the filter criteria
                </td>
              </tr>
            ) : (
              filteredRecords.map((record, index) => (
                <tr 
                  key={`${record.id}-${index}`} 
                  className="border-b hover:bg-muted/50"
                  data-testid={`row-sync-record-${index}`}
                >
                  <td className="p-2 font-mono text-xs">{record.orderNumber || record.id}</td>
                  <td className="p-2 max-w-[150px] truncate" title={record.customerName}>
                    {record.customerName || "—"}
                  </td>
                  <td className="p-2">
                    {record.status ? (
                      <Badge variant="outline" className="text-xs">{record.status}</Badge>
                    ) : "—"}
                  </td>
                  <td className="p-2 text-right font-mono text-xs">
                    {formatCurrency(record.totalAmount, record.currency)}
                  </td>
                  <td className="p-2 text-center">{record.itemCount ?? "—"}</td>
                  <td className="p-2 text-center">
                    {getActionBadge(record.syncAction)}
                    {record.syncReason && (
                      <p className="text-xs text-muted-foreground mt-1 max-w-[100px] truncate" title={record.syncReason}>
                        {record.syncReason}
                      </p>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
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
    "CONNECTION_TEST",
    "SALES_SYNC",
    "SALES_SYNC_ERROR",
    "DEMAND_HISTORY_SYNC",
    "DEMAND_HISTORY_SYNC_ERROR",
    "TOKEN_REFRESH",
    "TOKEN_REFRESH_ERROR",
    "BILL_CREATED",
    "BILL_CREATE_ERROR",
    "REFUND_CREATED",
    "REFUND_CREATE_ERROR",
    "VENDOR_CREATED",
  ];
  
  const entityTypes = ["PO", "ORDER", "RETURN", "ITEM", "SUPPLIER", "PURCHASE_ORDER", "RETURN_REQUEST"];
  const sources = ["SYSTEM", "USER", "SHOPIFY", "AMAZON", "GHL", "EXTENSIV", "QUICKBOOKS"];
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
    if (eventType.includes("BILL") || eventType.includes("REFUND") || eventType.includes("TOKEN") || eventType.includes("VENDOR")) return <DollarSign className="h-4 w-4" />;
    if (eventType.includes("PO")) return <FileText className="h-4 w-4" />;
    if (eventType.includes("RETURN")) return <RotateCcw className="h-4 w-4" />;
    if (eventType.includes("ORDER") || eventType.includes("SALES") || eventType.includes("DEMAND")) return <ShoppingBag className="h-4 w-4" />;
    if (eventType.includes("SYNC") || eventType.includes("CONNECTION")) return <RefreshCw className="h-4 w-4" />;
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
        <Card className="mt-8">
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
      <Card className="mt-8">
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
            <table className="w-full table-auto text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Timestamp</th>
                  <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Event</th>
                  <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Entity</th>
                  <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Source</th>
                  <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Status</th>
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
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
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
              
              {/* Synced Records Table for INTEGRATION_SYNC logs */}
              {selectedLog.eventType === "INTEGRATION_SYNC" && 
               selectedLog.details?.syncedRecords && 
               Array.isArray(selectedLog.details.syncedRecords) && 
               selectedLog.details.syncedRecords.length > 0 && (
                <SyncedRecordsTable records={selectedLog.details.syncedRecords} />
              )}
              
              {/* Summary stats for sync logs without detailed records */}
              {selectedLog.eventType === "INTEGRATION_SYNC" && 
               selectedLog.details && 
               !selectedLog.details.syncedRecords && (
                <div className="grid grid-cols-4 gap-3">
                  {selectedLog.details.recordsProcessed !== undefined && (
                    <div className="p-3 bg-muted rounded-lg text-center">
                      <p className="text-2xl font-bold">{selectedLog.details.recordsProcessed}</p>
                      <p className="text-xs text-muted-foreground">Processed</p>
                    </div>
                  )}
                  {selectedLog.details.recordsCreated !== undefined && (
                    <div className="p-3 bg-green-500/10 rounded-lg text-center">
                      <p className="text-2xl font-bold text-green-600">{selectedLog.details.recordsCreated}</p>
                      <p className="text-xs text-muted-foreground">Created</p>
                    </div>
                  )}
                  {selectedLog.details.recordsUpdated !== undefined && (
                    <div className="p-3 bg-blue-500/10 rounded-lg text-center">
                      <p className="text-2xl font-bold text-blue-600">{selectedLog.details.recordsUpdated}</p>
                      <p className="text-xs text-muted-foreground">Updated</p>
                    </div>
                  )}
                  {selectedLog.details.recordsSkipped !== undefined && (
                    <div className="p-3 bg-yellow-500/10 rounded-lg text-center">
                      <p className="text-2xl font-bold text-yellow-600">{selectedLog.details.recordsSkipped}</p>
                      <p className="text-xs text-muted-foreground">Skipped</p>
                    </div>
                  )}
                </div>
              )}
              
              {/* Show raw details for non-sync logs */}
              {selectedLog.eventType !== "INTEGRATION_SYNC" && 
               selectedLog.details && 
               Object.keys(selectedLog.details).length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Details</p>
                  <ScrollArea className="h-[200px]">
                    <pre className="p-3 bg-muted rounded-lg text-xs font-mono overflow-x-auto">
                      {JSON.stringify(selectedLog.details, null, 2)}
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
  const [openIntegration, setOpenIntegration] = useState<"EXTENSIV" | "SHOPIFY" | "AMAZON" | "GOHIGHLEVEL" | null>(null);
  const [showPhantomV2Modal, setShowPhantomV2Modal] = useState(false);
  const [showShopifySyncModal, setShowShopifySyncModal] = useState(false);
  const [shopifySyncMode, setShopifySyncMode] = useState<"merge" | "replace">("merge");
  const [showSkuMappingWizard, setShowSkuMappingWizard] = useState(false);
  const [skuWizardSource, setSkuWizardSource] = useState<"shopify" | "amazon" | "extensiv" | "quickbooks" | null>(null);
  
  // GHL Sync Modal state
  const [showGhlSyncModal, setShowGhlSyncModal] = useState(false);
  const [ghlSyncMode, setGhlSyncMode] = useState<"update" | "align">("update");
  
  // Amazon Sync Modal state
  const [showAmazonSyncModal, setShowAmazonSyncModal] = useState(false);
  const [amazonSyncMode, setAmazonSyncMode] = useState<"import" | "align">("import");
  
  // Extensiv/Pivot Sync Modal state
  const [showExtensivSyncModal, setShowExtensivSyncModal] = useState(false);
  const [extensivSyncMode, setExtensivSyncMode] = useState<"compare" | "align">("compare");
  const [extensivZeroMissing, setExtensivZeroMissing] = useState(false);
  
  // QuickBooks Sync Modal state
  const [showQuickBooksSyncModal, setShowQuickBooksSyncModal] = useState(false);
  const [quickbooksSyncMode, setQuickbooksSyncMode] = useState<"append" | "rebuild">("append");
  const [quickbooksRebuildMonths, setQuickbooksRebuildMonths] = useState(24);

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

  // PhantomBuster is disabled in V1 - no config query needed

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
    // QuickBooks - show modal
    if (source === "quickbooks") {
      setQuickbooksSyncMode("append");
      setQuickbooksRebuildMonths(24);
      setShowQuickBooksSyncModal(true);
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
    // Shopify - open SKU wizard directly
    if (source === "shopify") {
      setSkuWizardSource("shopify");
      setShowSkuMappingWizard(true);
      return;
    }
    // GoHighLevel - show sync options modal
    if (source === "gohighlevel") {
      setGhlSyncMode("update");
      setShowGhlSyncModal(true);
      return;
    }
    // Amazon - show sync options modal
    if (source === "amazon") {
      setAmazonSyncMode("import");
      setShowAmazonSyncModal(true);
      return;
    }
    // Extensiv/Pivot - show sync options modal
    if (source === "extensiv") {
      setExtensivSyncMode("compare");
      setExtensivZeroMissing(false);
      setShowExtensivSyncModal(true);
      return;
    }
    
    // Generic sync for other sources (should not happen in practice)
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

  const handleShopifySync = async () => {
    setShowShopifySyncModal(false);
    setSyncingSource("shopify");
    
    toast({
      title: "Shopify sync started...",
      description: shopifySyncMode === "merge" ? "Importing Shopify data" : "Replacing with Shopify data",
    });
    
    try {
      const response = await apiRequest("POST", `/api/integrations/shopify/sync`, { mode: shopifySyncMode });
      const result = await response.json();
      
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integration-configs/SHOPIFY"] });
      
      if (result.success) {
        const refundsPart = result.refundsCreated > 0 ? `, ${result.refundsCreated} returns synced` : '';
        if (shopifySyncMode === "merge") {
          toast({
            title: "Shopify sync completed",
            description: `${result.createdOrders || 0} orders created, ${result.updatedOrders || 0} orders updated${refundsPart}`,
          });
        } else {
          toast({
            title: "Shopify sync completed (Replace mode)",
            description: `${result.createdOrders || 0} orders created, ${result.updatedOrders || 0} updated, ${result.ordersArchived || 0} removed${refundsPart}, ${result.inventoryMappingsCleared || 0} mappings cleared`,
          });
        }
      } else {
        toast({
          title: "Shopify sync failed",
          description: result.message || "See Logs for details",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Shopify sync failed",
        description: error.message || "See Logs for details",
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  // GoHighLevel Sync Handler
  const handleGhlSync = async () => {
    setShowGhlSyncModal(false);
    setSyncingSource("gohighlevel");
    
    toast({
      title: "GoHighLevel sync started...",
      description: ghlSyncMode === "update" ? "Updating opportunities" : "Aligning and cleaning up GHL",
    });
    
    try {
      const response = await apiRequest("POST", `/api/integrations/gohighlevel/sync`, { mode: ghlSyncMode });
      const result = await response.json();
      
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integration-configs/GOHIGHLEVEL"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/logs"] });
      
      if (result.success) {
        if (ghlSyncMode === "update") {
          toast({
            title: "GoHighLevel sync completed",
            description: `${result.opportunitiesCreated || 0} created, ${result.opportunitiesUpdated || 0} updated, ${result.statusesPulled || 0} status changes pulled`,
          });
        } else {
          toast({
            title: "GoHighLevel sync completed (Align mode)",
            description: `${result.opportunitiesCreated || 0} created, ${result.opportunitiesUpdated || 0} updated, ${result.opportunitiesArchived || 0} orphaned closed`,
          });
        }
      } else {
        toast({
          title: "GoHighLevel sync failed",
          description: result.message || "See Logs for details",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "GoHighLevel sync failed",
        description: error.message || "See Logs for details",
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  // Amazon Sync Handler
  const handleAmazonSync = async () => {
    setShowAmazonSyncModal(false);
    setSyncingSource("amazon");
    
    toast({
      title: "Amazon sync started...",
      description: amazonSyncMode === "import" ? "Importing Amazon orders" : "Aligning Amazon channel",
    });
    
    try {
      const response = await apiRequest("POST", `/api/integrations/amazon/sync`, { mode: amazonSyncMode });
      const result = await response.json();
      
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integration-configs/AMAZON"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/logs"] });
      
      if (result.success) {
        if (amazonSyncMode === "import") {
          toast({
            title: "Amazon sync completed",
            description: `${result.ordersImported || 0} orders imported, ${result.ordersUpdated || 0} updated, ${result.inventoryRecords || 0} inventory records`,
          });
        } else {
          toast({
            title: "Amazon sync completed (Align mode)",
            description: `${result.ordersImported || 0} imported, ${result.ordersUpdated || 0} updated, ${result.ordersArchived || 0} archived, ${result.inventoryPushed || 0} inventory pushed`,
          });
        }
      } else {
        toast({
          title: "Amazon sync failed",
          description: result.message || "See Logs for details",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Amazon sync failed",
        description: error.message || "See Logs for details",
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  // Extensiv/Pivot Sync Handler
  const handleExtensivSync = async () => {
    setShowExtensivSyncModal(false);
    setSyncingSource("extensiv");
    
    toast({
      title: "Extensiv sync started...",
      description: extensivSyncMode === "compare" ? "Comparing inventory" : "Aligning Pivot quantities",
    });
    
    try {
      const response = await apiRequest("POST", `/api/integrations/extensiv/sync`, { 
        mode: extensivSyncMode,
        zeroMissing: extensivZeroMissing 
      });
      const result = await response.json();
      
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integration-configs/EXTENSIV"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/logs"] });
      
      if (result.success) {
        if (extensivSyncMode === "compare") {
          toast({
            title: "Extensiv sync completed",
            description: `${result.itemsCompared || 0} items compared, ${result.discrepancies || 0} discrepancies found`,
          });
        } else {
          toast({
            title: "Extensiv sync completed (Align mode)",
            description: `${result.adjustmentsApplied || 0} Pivot Qty adjustments applied, ${result.itemsFlagged || 0} items flagged`,
          });
        }
      } else {
        toast({
          title: "Extensiv sync failed",
          description: result.message || "See Logs for details",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Extensiv sync failed",
        description: error.message || "See Logs for details",
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  // QuickBooks Sync Handler (updated with modal support)
  const handleQuickBooksSyncWithModal = async () => {
    setShowQuickBooksSyncModal(false);
    setSyncingSource("quickbooks");
    
    // Convert months to years (round up to nearest year)
    const years = Math.max(1, Math.ceil(quickbooksRebuildMonths / 12));
    
    toast({
      title: "QuickBooks sync started...",
      description: quickbooksSyncMode === "append" ? "Appending demand history" : `Rebuilding last ${years} year(s) of demand history`,
    });
    
    try {
      const response = await apiRequest("POST", "/api/quickbooks/sync-demand-history", { 
        mode: quickbooksSyncMode,
        years: years
      });
      const result = await response.json();
      
      refetchQbStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/ai/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/demand-history"] });
      
      if (result.success !== false) {
        if (quickbooksSyncMode === "append") {
          toast({
            title: "QuickBooks sync completed",
            description: result.message || `Demand history updated for ${years} year(s)`,
          });
        } else {
          toast({
            title: "QuickBooks sync completed (Rebuild mode)",
            description: result.message || `Demand history rebuilt for ${years} year(s)`,
          });
        }
      } else {
        toast({
          title: "QuickBooks sync failed",
          description: result.message || "See Logs for details",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "QuickBooks sync failed",
        description: error.message || "See Logs for details",
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  const getConfigStatus = (config: any) => {
    if (!config || !config.apiKey) return "not_configured";
    if (config.lastSyncStatus === "FAILED") return "failed";
    // Treat SUCCESS or never-synced-yet as connected (credentials are configured)
    return "connected";
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
      description: "External demand & supplier research (coming in V2)",
      icon: Database,
      configured: false,
      status: "v2_planned",
      hasConfigDialog: false,
      showRotation: false,
      isV2Placeholder: true,
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
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="data-sources" data-testid="tab-data-sources">
            Data Sources
          </TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-rules">
            Rules
          </TabsTrigger>
          <TabsTrigger value="llm-config" data-testid="tab-llm-config">
            LLM Config
          </TabsTrigger>
          <TabsTrigger value="ai-recommendations" data-testid="tab-ai-recommendations-main">
            AI Recommendations
          </TabsTrigger>
          <TabsTrigger value="order-feedback" data-testid="tab-order-feedback">
            Order Feedback
          </TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">
            Logs
          </TabsTrigger>
        </TabsList>

        {/* Data Sources Tab */}
        <TabsContent value="data-sources" className="space-y-4">
          <Card className="mt-8">
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
                                (source as any).isV2Placeholder
                                  ? "secondary"
                                  : !source.configured
                                  ? "outline"
                                  : source.status === "success" || source.status === "connected"
                                  ? "default"
                                  : source.status === "failed" || source.status === "error"
                                  ? "destructive"
                                  : "secondary"
                              }
                              data-testid={`status-${source.id}`}
                            >
                              {(source as any).isV2Placeholder
                                ? "V2 Planned"
                                : !source.configured
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
                          {(source as any).isV2Placeholder && (
                            <div className="text-xs text-muted-foreground border-t pt-2 mt-1" data-testid={`v2-notice-${source.id}`}>
                              Not available in V1
                            </div>
                          )}
                          {(source as any).showRotation && !(source as any).isV2Placeholder && (
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t pt-2 mt-1" data-testid={`rotation-info-${source.id}`}>
                              {(source as any).lastSyncAt && (
                                <>
                                  <div className="text-muted-foreground">Last Synced</div>
                                  <div className="text-right font-medium" data-testid={`last-synced-${source.id}`}>
                                    {formatRotationDate((source as any).lastSyncAt)}
                                  </div>
                                </>
                              )}
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
                            {(source as any).isV2Placeholder ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setShowPhantomV2Modal(true)}
                                    data-testid={`button-learn-more-${source.id}`}
                                  >
                                    <Info className="mr-2 h-4 w-4" />
                                    Learn more
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>PhantomBuster integration is planned for V2. Not available yet.</p>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <>
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
                                      setOpenIntegration(source.integrationType as "EXTENSIV" | "SHOPIFY" | "AMAZON" | "GOHIGHLEVEL");
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
          
        </TabsContent>

        {/* Rules Tab */}
        <TabsContent value="rules" className="space-y-4">
          <RulesTab />
        </TabsContent>

        {/* LLM Config Tab */}
        <TabsContent value="llm-config" className="space-y-4">
          <LLMConfigTab settingsData={settingsData} />
        </TabsContent>

        {/* AI Recommendations Tab - New comprehensive view */}
        <TabsContent value="ai-recommendations" className="space-y-4">
          <AIRecommendationsTab />
        </TabsContent>

        {/* Order Feedback Tab (formerly Insights) */}
        <TabsContent value="order-feedback" className="space-y-4">
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
          onOpenSkuWizard={(source?: "shopify" | "amazon" | "extensiv" | "quickbooks") => {
            setSkuWizardSource(source || null);
            setShowSkuMappingWizard(true);
          }}
        />
      )}

      {/* PhantomBuster V2 Modal */}
      <Dialog open={showPhantomV2Modal} onOpenChange={setShowPhantomV2Modal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>PhantomBuster – Planned for V2</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              This integration will be used later to pull external demand and supplier intelligence.
            </p>
            <p className="text-sm text-muted-foreground">
              There is no live PhantomBuster integration in this version.
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setShowPhantomV2Modal(false)} data-testid="button-close-phantom-v2-modal">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Shopify Sync Options Modal */}
      <Dialog open={showShopifySyncModal} onOpenChange={setShowShopifySyncModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="title-shopify-sync-options">Shopify Sync Options</DialogTitle>
            <DialogDescription>
              Choose how to reconcile Shopify with this inventory app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <p className="text-sm font-medium">Do you want to remove any data that doesn't match Shopify?</p>
            
            <RadioGroup 
              value={shopifySyncMode} 
              onValueChange={(value: "merge" | "replace") => setShopifySyncMode(value)}
              className="space-y-4"
            >
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${shopifySyncMode === "merge" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setShopifySyncMode("merge")}
              >
                <RadioGroupItem value="merge" id="sync-merge" data-testid="radio-sync-merge" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="sync-merge" className="text-sm font-medium cursor-pointer">
                    Import only (recommended)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Import Shopify orders and inventory without deleting anything that only exists in this app.
                  </p>
                </div>
              </div>
              
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${shopifySyncMode === "replace" ? "border-destructive bg-destructive/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setShopifySyncMode("replace")}
              >
                <RadioGroupItem value="replace" id="sync-replace" data-testid="radio-sync-replace" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="sync-replace" className="text-sm font-medium cursor-pointer">
                    Replace with Shopify (destructive)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Make this app match Shopify by removing local Shopify records that no longer exist in Shopify.
                  </p>
                  <p className="text-xs text-destructive flex items-center gap-1 mt-2">
                    <AlertTriangle className="h-3 w-3" />
                    This may delete test or outdated Shopify records stored only in this app.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
          <div className="flex justify-between gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setShowShopifySyncModal(false);
                setSkuWizardSource("shopify");
                setShowSkuMappingWizard(true);
              }}
              data-testid="button-map-skus-shopify"
            >
              <Link2 className="mr-2 h-4 w-4" />
              Map SKUs First
            </Button>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => setShowShopifySyncModal(false)}
                data-testid="button-cancel-shopify-sync"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleShopifySync}
                data-testid="button-start-shopify-sync"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Start Sync
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* SKU Mapping Wizard */}
      <SkuMappingWizard 
        isOpen={showSkuMappingWizard} 
        onClose={() => {
          setShowSkuMappingWizard(false);
          setSkuWizardSource(null);
        }}
        source={skuWizardSource}
        onCompleteSync={skuWizardSource === "shopify" ? () => {
          setShowSkuMappingWizard(false);
          setSkuWizardSource(null);
          handleShopifySync();
        } : undefined}
      />

      {/* GoHighLevel Sync Options Modal */}
      <Dialog open={showGhlSyncModal} onOpenChange={setShowGhlSyncModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="title-ghl-sync-options">Sync GoHighLevel</DialogTitle>
            <DialogDescription>
              Sync PO/Refund/Stock Warning opportunities with GoHighLevel CRM.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="text-sm text-muted-foreground space-y-2">
              <p>This sync updates opportunities in your configured GHL pipeline stages:</p>
              <ul className="list-disc list-inside text-xs space-y-1 ml-2">
                <li>PO lifecycle (Sent, Delivered, Paid)</li>
                <li>Refund lifecycle (Processing, Refunded)</li>
                <li>Stock warnings (21-30 days, 14-21 days, Order Now)</li>
              </ul>
            </div>
            
            <RadioGroup 
              value={ghlSyncMode} 
              onValueChange={(value: "update" | "align") => setGhlSyncMode(value)}
              className="space-y-4"
            >
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${ghlSyncMode === "update" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setGhlSyncMode("update")}
              >
                <RadioGroupItem value="update" id="ghl-update" data-testid="radio-ghl-update" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="ghl-update" className="text-sm font-medium cursor-pointer">
                    Update only (recommended)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Push ALL POs, Refunds, Sales Orders, and Stock Warnings to GHL (Live + History).
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Orphaned or historical GHL opportunities are logged but not deleted.
                  </p>
                </div>
              </div>
              
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${ghlSyncMode === "align" ? "border-amber-500 bg-amber-500/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setGhlSyncMode("align")}
              >
                <RadioGroupItem value="align" id="ghl-align" data-testid="radio-ghl-align" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="ghl-align" className="text-sm font-medium cursor-pointer">
                    Align GHL with Live data only
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Only sync LIVE items to GHL. Delete opportunities for items in the History tab.
                  </p>
                  <p className="text-xs text-amber-600 flex items-center gap-1 mt-2">
                    <AlertTriangle className="h-3 w-3" />
                    Deletes GHL opportunities for archived/historical items. App data is never deleted.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowGhlSyncModal(false)} data-testid="button-cancel-ghl-sync">
              Cancel
            </Button>
            <Button onClick={handleGhlSync} data-testid="button-start-ghl-sync">
              <RefreshCw className="mr-2 h-4 w-4" />
              Start Sync
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Amazon Sync Options Modal */}
      <Dialog open={showAmazonSyncModal} onOpenChange={setShowAmazonSyncModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="title-amazon-sync-options">Sync Amazon Orders & Inventory</DialogTitle>
            <DialogDescription>
              Import orders from Amazon Seller Central and optionally sync inventory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="text-sm text-muted-foreground space-y-2">
              <p>Orders are always imported from Amazon. Inventory push to Amazon only happens if "Amazon 2-Way Sync" is enabled in Rules.</p>
            </div>
            
            <RadioGroup 
              value={amazonSyncMode} 
              onValueChange={(value: "import" | "align") => setAmazonSyncMode(value)}
              className="space-y-4"
            >
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${amazonSyncMode === "import" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setAmazonSyncMode("import")}
              >
                <RadioGroupItem value="import" id="amazon-import" data-testid="radio-amazon-import" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="amazon-import" className="text-sm font-medium cursor-pointer">
                    Import new/updated orders only (safe mode)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Import new Amazon orders since last sync. Update statuses for existing orders.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    No Sales Orders in this app are deleted, even if removed from Amazon.
                  </p>
                </div>
              </div>
              
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${amazonSyncMode === "align" ? "border-amber-500 bg-amber-500/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setAmazonSyncMode("align")}
              >
                <RadioGroupItem value="align" id="amazon-align" data-testid="radio-amazon-align" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="amazon-align" className="text-sm font-medium cursor-pointer">
                    Align Amazon channel and clean up
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Same as above, plus: mark Amazon orders as ARCHIVED if they no longer exist on Amazon.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    If 2-way sync is ON, push updated Pivot Qty to Amazon for mapped SKUs.
                  </p>
                  <p className="text-xs text-amber-600 flex items-center gap-1 mt-2">
                    <AlertTriangle className="h-3 w-3" />
                    Orders are archived, not deleted. Only Amazon channel is affected.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowAmazonSyncModal(false)} data-testid="button-cancel-amazon-sync">
              Cancel
            </Button>
            <Button onClick={handleAmazonSync} data-testid="button-start-amazon-sync">
              <RefreshCw className="mr-2 h-4 w-4" />
              Start Sync
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Extensiv/Pivot Sync Options Modal */}
      <Dialog open={showExtensivSyncModal} onOpenChange={setShowExtensivSyncModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="title-extensiv-sync-options">Sync Pivot (Extensiv) Inventory</DialogTitle>
            <DialogDescription>
              Sync finished goods inventory with Pivot 3PL via Extensiv.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="text-sm text-muted-foreground space-y-2">
              <p>Extensiv is the source of truth for Pivot Qty (3PL inventory). This sync only adjusts Pivot Qty column; Hildale Qty is never changed by Extensiv.</p>
            </div>
            
            <RadioGroup 
              value={extensivSyncMode} 
              onValueChange={(value: "compare" | "align") => setExtensivSyncMode(value)}
              className="space-y-4"
            >
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${extensivSyncMode === "compare" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setExtensivSyncMode("compare")}
              >
                <RadioGroupItem value="compare" id="extensiv-compare" data-testid="radio-extensiv-compare" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="extensiv-compare" className="text-sm font-medium cursor-pointer">
                    Import and compare (no automatic overrides)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Pull current on-hand from Extensiv. Log any differences but do NOT overwrite Pivot Qty.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Useful for auditing discrepancies before applying changes.
                  </p>
                </div>
              </div>
              
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${extensivSyncMode === "align" ? "border-amber-500 bg-amber-500/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setExtensivSyncMode("align")}
              >
                <RadioGroupItem value="align" id="extensiv-align" data-testid="radio-extensiv-align" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="extensiv-align" className="text-sm font-medium cursor-pointer">
                    Align Pivot Qty with Extensiv (apply adjustments)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Set Pivot Qty equal to Extensiv qty for each mapped SKU. Adjustments are logged.
                  </p>
                  <div className="flex items-center space-x-2 mt-3 pt-2 border-t">
                    <Switch
                      id="extensiv-zero-missing"
                      checked={extensivZeroMissing}
                      onCheckedChange={setExtensivZeroMissing}
                      data-testid="switch-extensiv-zero-missing"
                    />
                    <Label htmlFor="extensiv-zero-missing" className="text-xs cursor-pointer">
                      Zero out Pivot for items not present in Extensiv
                    </Label>
                  </div>
                  <p className="text-xs text-amber-600 flex items-center gap-1 mt-2">
                    <AlertTriangle className="h-3 w-3" />
                    Products, SKUs, orders, and BOM rows are never deleted.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowExtensivSyncModal(false)} data-testid="button-cancel-extensiv-sync">
              Cancel
            </Button>
            <Button onClick={handleExtensivSync} data-testid="button-start-extensiv-sync">
              <RefreshCw className="mr-2 h-4 w-4" />
              Start Sync
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* QuickBooks Sync Options Modal */}
      <Dialog open={showQuickBooksSyncModal} onOpenChange={setShowQuickBooksSyncModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="title-quickbooks-sync-options">Sync QuickBooks Demand & Vendor Data</DialogTitle>
            <DialogDescription>
              Import historical sales, POs/bills, and refunds to build demand history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="text-sm text-muted-foreground space-y-2">
              <p>QuickBooks is used to build demand history for forecasting. No core inventory tables (BOM, Barcodes, Sales Orders, POs) are modified.</p>
            </div>
            
            <RadioGroup 
              value={quickbooksSyncMode} 
              onValueChange={(value: "append" | "rebuild") => setQuickbooksSyncMode(value)}
              className="space-y-4"
            >
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${quickbooksSyncMode === "append" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setQuickbooksSyncMode("append")}
              >
                <RadioGroupItem value="append" id="qb-append" data-testid="radio-qb-append" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="qb-append" className="text-sm font-medium cursor-pointer">
                    Append / update history (safe mode)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Import new transactions since last sync. Update existing demand history rows.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Existing history is preserved even if transactions were removed in QuickBooks.
                  </p>
                </div>
              </div>
              
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${quickbooksSyncMode === "rebuild" ? "border-amber-500 bg-amber-500/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setQuickbooksSyncMode("rebuild")}
              >
                <RadioGroupItem value="rebuild" id="qb-rebuild" data-testid="radio-qb-rebuild" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="qb-rebuild" className="text-sm font-medium cursor-pointer">
                    Rebuild QuickBooks Demand History
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Recalculate demand history for the selected date range from QuickBooks transactions.
                  </p>
                  <div className="flex items-center gap-2 mt-3 pt-2 border-t">
                    <Label htmlFor="qb-months" className="text-xs whitespace-nowrap">
                      Rebuild last
                    </Label>
                    <Select 
                      value={String(quickbooksRebuildMonths)} 
                      onValueChange={(v) => setQuickbooksRebuildMonths(Number(v))}
                    >
                      <SelectTrigger className="w-24 h-8" data-testid="select-qb-months">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="12">12 months</SelectItem>
                        <SelectItem value="24">24 months</SelectItem>
                        <SelectItem value="36">36 months</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-amber-600 flex items-center gap-1 mt-2">
                    <AlertTriangle className="h-3 w-3" />
                    Demand history rows in this range are recalculated. Vendors may be marked inactive.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowQuickBooksSyncModal(false)} data-testid="button-cancel-qb-sync">
              Cancel
            </Button>
            <Button onClick={handleQuickBooksSyncWithModal} data-testid="button-start-qb-sync">
              <RefreshCw className="mr-2 h-4 w-4" />
              Start Sync
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
