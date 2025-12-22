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
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Brain, Database, Settings2, TrendingUp, CheckCircle, CheckCircle2, XCircle, Clock, RefreshCw, ShoppingBag, Package, AlertTriangle, Info, Filter, Zap, HelpCircle, Search, FileText, ChevronLeft, ChevronRight, ChevronDown, RotateCcw, Receipt, Send, Sparkles, Scale, DollarSign, Link2, Building, History, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { IntegrationSettings } from "@/components/integration-settings";
import { CreatePOSheet } from "@/components/create-po-sheet";
import { SkuMappingWizard } from "@/components/sku-mapping-wizard";

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

interface OrderFeedbackResponse {
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
  shopifyInventorySunsetDate: string | null;
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
  
  // AI Agent auto-send settings
  const [autoSendCriticalPos, setAutoSendCriticalPos] = useState(false);
  const [criticalRescueDays, setCriticalRescueDays] = useState(7);
  const [shopifyTwoWaySync, setShopifyTwoWaySync] = useState(false);
  const [shopifySafetyBuffer, setShopifySafetyBuffer] = useState(0);
  const [shopifyInventorySunsetDate, setShopifyInventorySunsetDate] = useState<string | null>(null);
  const [amazonTwoWaySync, setAmazonTwoWaySync] = useState(false);
  const [amazonSafetyBuffer, setAmazonSafetyBuffer] = useState(0);
  const [extensivTwoWaySync, setExtensivTwoWaySync] = useState(false);
  const [pivotLowDaysThreshold, setPivotLowDaysThreshold] = useState(5);
  const [hildaleHighDaysThreshold, setHildaleHighDaysThreshold] = useState(20);
  const [quickbooksIncludeHistory, setQuickbooksIncludeHistory] = useState(false);
  const [quickbooksHistoryMonths, setQuickbooksHistoryMonths] = useState(12);
  const [quickbooksWebhookVerifierToken, setQuickbooksWebhookVerifierToken] = useState("");
  const [ordersToFetch, setOrdersToFetch] = useState(250);
  
  // Sync form with fetched rules
  useEffect(() => {
    if (rules) {
      setFormValues(rules);
    }
  }, [rules]);
  
  // Sync AI Agent settings
  useEffect(() => {
    if (aiAgentSettings) {
      setAutoSendCriticalPos(aiAgentSettings.autoSendCriticalPos || false);
      setCriticalRescueDays(aiAgentSettings.criticalRescueDays || 7);
      setShopifyTwoWaySync(aiAgentSettings.shopifyTwoWaySync || false);
      setShopifySafetyBuffer(aiAgentSettings.shopifySafetyBuffer || 0);
      setShopifyInventorySunsetDate(aiAgentSettings.shopifyInventorySunsetDate || null);
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
  
  // Save mutation for rules and agent settings
  const saveMutation = useMutation({
    mutationFn: async (data: { 
      rules: Partial<AIRules>; 
      agentSettings: { autoSendCriticalPos: boolean; criticalRescueDays: number; shopifyTwoWaySync: boolean; shopifySafetyBuffer: number; shopifyInventorySunsetDate: string | null; amazonTwoWaySync: boolean; amazonSafetyBuffer: number; extensivTwoWaySync: boolean; pivotLowDaysThreshold: number; hildaleHighDaysThreshold: number; quickbooksIncludeHistory: boolean; quickbooksHistoryMonths: number; ordersToFetch: number };
    }) => {
      // Save rules and agent settings in parallel
      await Promise.all([
        apiRequest("PATCH", "/api/ai/rules", data.rules),
        apiRequest("PATCH", "/api/ai-agent-settings", data.agentSettings),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/at-risk"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-agent-settings"] });
      toast({
        title: "Rules Updated",
        description: "AI decision rules and agent settings have been saved.",
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
      agentSettings: {
        autoSendCriticalPos,
        criticalRescueDays,
        shopifyTwoWaySync,
        shopifySafetyBuffer,
        shopifyInventorySunsetDate,
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
                    <Label htmlFor="safety-stock">Safety Stock Buffer (MOQ)</Label>
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
          
          {/* Supplier & Lead Time */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Package className="h-4 w-4" />
              Supplier & Lead Time
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                
                {/* Shopify Inventory Sunset Date */}
                <div className="space-y-2 pt-2 border-t">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="shopify-sunset-date">Shopify Inventory Sync Until</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-shopify-sunset-info" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>Temporary: Sync Available For Sale quantities from Shopify until this date. After this date, Extensiv becomes the sole source for inventory levels.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      id="shopify-sunset-date"
                      type="date"
                      value={shopifyInventorySunsetDate ? new Date(shopifyInventorySunsetDate).toISOString().split('T')[0] : ''}
                      onChange={(e) => setShopifyInventorySunsetDate(e.target.value ? new Date(e.target.value).toISOString() : null)}
                      data-testid="input-shopify-sunset-date"
                    />
                    {shopifyInventorySunsetDate && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShopifyInventorySunsetDate(null)}
                        data-testid="button-clear-sunset-date"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  {shopifyInventorySunsetDate && (
                    <p className="text-xs text-muted-foreground">
                      Shopify inventory sync active until: {new Date(shopifyInventorySunsetDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}
                    </p>
                  )}
                </div>
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
              
              {/* QuickBooks Webhook Configuration */}
              <div className="p-4 border rounded-lg space-y-4">
                <div className="flex items-center gap-1.5">
                  <Link2 className="h-4 w-4" />
                  <Label htmlFor="quickbooks-webhook-verifier-token" className="font-medium">QuickBooks Webhook Verifier Token</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" data-testid="icon-qb-webhook-info" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p>Paste the webhook verifier token from your Intuit Developer Webhooks page. This is used to verify that webhook calls really come from QuickBooks.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="quickbooks-webhook-verifier-token"
                  type="password"
                  placeholder="Enter your QuickBooks webhook verifier token"
                  value={quickbooksWebhookVerifierToken}
                  onChange={(e) => setQuickbooksWebhookVerifierToken(e.target.value)}
                  data-testid="input-qb-webhook-verifier-token"
                />
                <p className="text-xs text-muted-foreground">
                  Find this in Intuit Developer Portal → Webhooks → Show verifier token. Used to authenticate incoming webhook notifications.
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

interface DailySalesSnapshot {
  id: string;
  date: string;
  totalRevenue: number;
  totalOrders: number;
  totalUnits: number;
  totalRefunds: number;
  netRevenue: number;
  channelBreakdown: { shopify?: { revenue: number; orders: number }; amazon?: { revenue: number; orders: number }; direct?: { revenue: number; orders: number } } | null;
  dayOverDayChange: number | null;
  weekOverWeekChange: number | null;
  monthOverMonthChange: number | null;
  yearOverYearChange: number | null;
  rolling7DayAvgRevenue: number | null;
  rolling30DayAvgRevenue: number | null;
  source: string;
  lastSyncedAt: string;
}

interface DailySalesResponse {
  snapshots: DailySalesSnapshot[];
  dateRange: { startDate: string; endDate: string };
  count: number;
}

function QuickBooksDemandHistoryTab() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const { toast } = useToast();
  
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

  // Daily sales snapshots for trend cards
  const { data: dailySalesData } = useQuery<DailySalesResponse>({
    queryKey: ["/api/daily-sales-snapshots", 30],
    queryFn: async () => {
      const response = await fetch(`/api/daily-sales-snapshots?days=30`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch daily sales");
      return response.json();
    },
  });

  // Backfill mutation
  const backfillMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/daily-sales-snapshots/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ days: 30 }),
      });
      if (!response.ok) throw new Error("Failed to backfill");
      return response.json();
    },
    onSuccess: (data) => {
      toast({ title: "Backfill Complete", description: `Processed ${data.processed} days of sales data` });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-sales-snapshots"] });
    },
    onError: (error: Error) => {
      toast({ title: "Backfill Failed", description: error.message, variant: "destructive" });
    },
  });

  // Get today's snapshot
  const todayStr = new Date().toISOString().split('T')[0];
  const todaySnapshot = dailySalesData?.snapshots.find(s => s.date === todayStr);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0];
  const yesterdaySnapshot = dailySalesData?.snapshots.find(s => s.date === yesterdayStr);

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
  const hasDailySalesData = dailySalesData && dailySalesData.count > 0;

  const formatChange = (change: number | null | undefined) => {
    if (change === null || change === undefined) return "-";
    const sign = change >= 0 ? "+" : "";
    return `${sign}${change.toFixed(1)}%`;
  };

  const getChangeColor = (change: number | null | undefined) => {
    if (change === null || change === undefined) return "text-muted-foreground";
    if (change > 10) return "text-green-600 dark:text-green-400";
    if (change > 0) return "text-green-500";
    if (change > -10) return "text-red-500";
    return "text-red-600 dark:text-red-400";
  };

  return (
    <div className="space-y-4">
      {/* Daily Sales Trend Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Today's Revenue</CardDescription>
            <CardTitle className="text-2xl">
              {todaySnapshot ? formatCurrency(todaySnapshot.totalRevenue) : "-"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">vs Yesterday:</span>
              <span className={getChangeColor(todaySnapshot?.dayOverDayChange)}>
                {formatChange(todaySnapshot?.dayOverDayChange)}
              </span>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Yesterday's Revenue</CardDescription>
            <CardTitle className="text-2xl">
              {yesterdaySnapshot ? formatCurrency(yesterdaySnapshot.totalRevenue) : "-"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{yesterdaySnapshot?.totalOrders ?? 0} orders</span>
              <span className="text-muted-foreground">{yesterdaySnapshot?.totalUnits ?? 0} units</span>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>7-Day Avg Revenue</CardDescription>
            <CardTitle className="text-2xl">
              {todaySnapshot?.rolling7DayAvgRevenue 
                ? formatCurrency(todaySnapshot.rolling7DayAvgRevenue) 
                : (yesterdaySnapshot?.rolling7DayAvgRevenue 
                    ? formatCurrency(yesterdaySnapshot.rolling7DayAvgRevenue) 
                    : "-")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">vs Same Week Last Year:</span>
              <span className={getChangeColor(yesterdaySnapshot?.yearOverYearChange)}>
                {formatChange(yesterdaySnapshot?.yearOverYearChange)}
              </span>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Data Status</CardDescription>
            <CardTitle className="text-lg">
              {hasDailySalesData ? `${dailySalesData.count} days` : "No data"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => backfillMutation.mutate()}
              disabled={backfillMutation.isPending}
              data-testid="button-backfill-daily-sales"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${backfillMutation.isPending ? "animate-spin" : ""}`} />
              {backfillMutation.isPending ? "Processing..." : "Backfill 30 Days"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Original QuickBooks Demand History Card */}
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
    </div>
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
  { id: "bomComponents", label: "Product Components", group: "production", visible: false },
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

// Batch Decision Timeline Types
interface BatchDecision {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  reason: string;
  totalSkus: number | null;
  processedSkus: number | null;
  criticalItemsFound: number | null;
  orderTodayCount: number | null;
  safeUntilTomorrowCount: number | null;
  llmProvider: string | null;
  llmModel: string | null;
  llmResponseTimeMs: number | null;
  errorMessage: string | null;
  aiDecisionSummary: string | null;
  staffDecisionSummary: string | null;
  percentDifference: number | null;
  urgencyLevel: string | null;
  primarySupplierId: string | null;
  supplierName: string | null;
  recommendationsCount: number;
  acceptedCount: number;
  dismissedCount: number;
  totalRecommendedQty: number;
}

interface TimelineEvent {
  id: string;
  type: "SALE" | "PO_RECEIPT" | "RETURN" | "INVENTORY_ADJUST" | "TRANSFER" | "LLM_DECISION";
  timestamp: string;
  description: string;
  details?: Record<string, unknown>;
  channel?: string;
  quantity?: number;
  sku?: string;
}

interface ContextSnapshot {
  sku: string;
  itemId: string;
  productName: string;
  productType?: string;
  hildaleQty: number;
  pivotQty: number;
  availableForSale: number;
  dailyVelocity: number;
  daysUntilStockout: number;
  leadTimeDays: number;
  inboundPO: number;
  backorders: number;
  returnRate: number;
  adMultiplier: number;
  supplierScore: number;
  safetyStockDays: number;
  riskThresholdHighDays: number;
  riskThresholdMediumDays: number;
}

interface RecommendationWithContext {
  id: string;
  sku: string;
  productName: string;
  riskLevel: string;
  recommendedQty: number | null;
  daysUntilStockout: number | null;
  orderTiming: "ORDER_TODAY" | "SAFE_UNTIL_TOMORROW" | null;
  reasonSummary: string | null;
  status: string;
  sourceSignals: Record<string, unknown> | null;
  contextSnapshot: ContextSnapshot | null;
  baseVelocity: number | null;
  adjustedVelocity: number | null;
  adMultiplier: number | null;
}

interface BatchTimelineResponse {
  batchLog: BatchDecision;
  timeline: TimelineEvent[];
  recommendations: RecommendationWithContext[];
  windowStart: string;
  windowEnd: string;
}

// Timeline Event Card Component - Shopify inspired single-line card
function TimelineEventCard({ event }: { event: TimelineEvent }) {
  const getEventIcon = () => {
    switch (event.type) {
      case "SALE":
        return <ShoppingBag className="h-4 w-4 text-blue-500" />;
      case "PO_RECEIPT":
        return <Package className="h-4 w-4 text-green-500" />;
      case "RETURN":
        return <RotateCcw className="h-4 w-4 text-orange-500" />;
      case "INVENTORY_ADJUST":
        return <Scale className="h-4 w-4 text-purple-500" />;
      case "TRANSFER":
        return <Send className="h-4 w-4 text-cyan-500" />;
      case "LLM_DECISION":
        return <Brain className="h-4 w-4 text-primary" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getEventBgColor = () => {
    switch (event.type) {
      case "LLM_DECISION":
        return "bg-primary/10 border-primary/20";
      case "SALE":
        return "bg-blue-500/10 border-blue-500/20";
      case "PO_RECEIPT":
        return "bg-green-500/10 border-green-500/20";
      case "RETURN":
        return "bg-orange-500/10 border-orange-500/20";
      default:
        return "bg-muted/50 border-border";
    }
  };

  return (
    <div 
      className={`flex items-center gap-3 px-3 py-2 rounded-md border ${getEventBgColor()}`}
      data-testid={`timeline-event-${event.type.toLowerCase()}-${event.id}`}
    >
      <div className="flex-shrink-0">{getEventIcon()}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" data-testid={`text-event-description-${event.id}`}>{event.description}</p>
      </div>
      {event.quantity !== undefined && (
        <Badge variant="secondary" className="flex-shrink-0 text-xs" data-testid={`badge-quantity-${event.id}`}>
          {event.quantity > 0 ? "+" : ""}{event.quantity}
        </Badge>
      )}
      <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap" data-testid={`text-time-${event.id}`}>
        {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}

// Batch Timeline Modal Component - Shopify-inspired design
function BatchTimelineModal({ 
  batchId, 
  isOpen, 
  onClose 
}: { 
  batchId: string | null; 
  isOpen: boolean; 
  onClose: () => void;
}) {
  const [showAllEvents, setShowAllEvents] = useState(false);
  
  // Reset showAllEvents when batchId changes
  useEffect(() => {
    setShowAllEvents(false);
  }, [batchId]);
  
  const { data, isLoading } = useQuery<BatchTimelineResponse>({
    queryKey: ["/api/ai-batch-logs", batchId, "timeline"],
    enabled: !!batchId && isOpen,
  });

  if (!batchId) return null;

  // Helper to get urgency color classes
  const getUrgencyStyles = (urgency: string | null) => {
    switch (urgency) {
      case "HIGH":
        return { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-600 dark:text-red-400", icon: "text-red-500" };
      case "MEDIUM":
        return { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-600 dark:text-amber-400", icon: "text-amber-500" };
      case "LOW":
        return { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-600 dark:text-green-400", icon: "text-green-500" };
      default:
        return { bg: "bg-muted/50", border: "border-border", text: "text-muted-foreground", icon: "text-muted-foreground" };
    }
  };

  // Helper to format trigger reason
  const formatTriggerReason = (reason: string) => {
    switch (reason) {
      case "SCHEDULED_10AM": return "10:00 AM Scheduled";
      case "SCHEDULED_3PM": return "3:00 PM Scheduled";
      case "CRITICAL_TRIGGER": return "Critical Threshold";
      case "MANUAL": return "Manual Trigger";
      default: return reason?.replace(/_/g, " ");
    }
  };

  // Group timeline events by type for display
  const visibleEvents = showAllEvents ? data?.timeline : data?.timeline.slice(0, 8);
  const hiddenCount = (data?.timeline.length || 0) - 8;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col p-0" data-testid="dialog-batch-timeline">
        {/* Header with Priority Badge and Timestamp */}
        <div className="px-6 pt-6 pb-4 border-b">
          <DialogHeader>
            <div className="flex items-center justify-between gap-4">
              <DialogTitle className="flex items-center gap-2 text-xl" data-testid="text-timeline-title">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Brain className="h-5 w-5 text-primary" />
                </div>
                AI Batch Decision
              </DialogTitle>
              {data && (
                <div className="flex items-center gap-2 mr-4">
                  <Badge variant="outline" className="text-xs gap-1">
                    <Clock className="h-3 w-3" />
                    {data.batchLog.startedAt 
                      ? new Date(data.batchLog.startedAt).toLocaleString([], { 
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                        })
                      : "—"}
                  </Badge>
                  <Badge 
                    variant={data.batchLog.urgencyLevel === "HIGH" ? "destructive" : data.batchLog.urgencyLevel === "MEDIUM" ? "default" : "secondary"}
                    className="text-sm px-3 py-1"
                    data-testid="badge-urgency-level"
                  >
                    {data.batchLog.urgencyLevel || "Unknown"} Priority
                  </Badge>
                </div>
              )}
            </div>
            <DialogDescription data-testid="text-timeline-description">
              {data ? formatTriggerReason(data.batchLog.reason) : "Review the AI analysis and events that informed this decision"}
            </DialogDescription>
          </DialogHeader>
        </div>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : data ? (
          <div className="flex-1 overflow-y-auto">
            {/* Agent Decision Card - Clean redesigned layout */}
            <div className="p-6">
              <div className={`rounded-xl border-2 ${getUrgencyStyles(data.batchLog.urgencyLevel).border} ${getUrgencyStyles(data.batchLog.urgencyLevel).bg} overflow-hidden`}>
                {/* Metrics Grid - Show first */}
                <div className="px-5 py-4 bg-background/50">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="text-center p-3 rounded-lg bg-background border">
                      <div className="text-2xl font-bold text-foreground" data-testid="metric-total-skus">
                        {data.batchLog.totalSkus || 0}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Products Analyzed</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-background border">
                      <div className="text-2xl font-bold text-red-600" data-testid="metric-critical-items">
                        {data.batchLog.criticalItemsFound || 0}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Critical Items</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-background border">
                      <div className="text-2xl font-bold text-amber-600" data-testid="metric-order-today">
                        {data.batchLog.orderTodayCount || 0}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Order Today</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-background border">
                      <div className="text-2xl font-bold text-green-600" data-testid="metric-safe">
                        {data.batchLog.safeUntilTomorrowCount || 0}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Safe Until Tomorrow</div>
                    </div>
                  </div>
                </div>

                {/* Decision Summary - After metrics */}
                <div className="px-5 py-4 border-t border-inherit">
                  <div className="flex items-start gap-3">
                    <p className="text-base leading-relaxed flex-1" data-testid="text-decision-summary">
                      {data.batchLog.aiDecisionSummary || 
                       `Analyzed ${data.batchLog.totalSkus || 0} products and identified ${data.batchLog.criticalItemsFound || 0} items requiring immediate attention. ${
                         data.batchLog.orderTodayCount ? `${data.batchLog.orderTodayCount} products should be ordered today to prevent stockouts.` : 
                         "Current inventory levels are sufficient for the near term."
                       }`}
                    </p>
                    {(data.batchLog.criticalItemsFound ?? 0) > 0 && (
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            onClose();
                            window.location.href = "/products?tab=stock-inventory";
                          }}
                          data-testid="button-view-critical-skus"
                        >
                          <AlertTriangle className="h-4 w-4 mr-2" />
                          View Critical SKUs
                        </Button>
                        {data.batchLog.llmResponseTimeMs && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Zap className="h-3 w-3" />
                            {(data.batchLog.llmResponseTimeMs / 1000).toFixed(1)}s response
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Action Buttons */}
                {(data.batchLog.criticalItemsFound ?? 0) > 0 && data.batchLog.primarySupplierId && (
                  <div className="px-5 py-4 border-t border-inherit bg-background/30 flex flex-wrap items-center justify-end gap-3">
                    <Button
                      size="sm"
                      onClick={() => {
                        onClose();
                        window.location.href = `/purchase-orders?create=true&supplier=${data.batchLog.primarySupplierId}`;
                      }}
                      data-testid="button-create-po"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Create Purchase Order
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Collapsible Report Sections */}
            <div className="px-6 pb-4 space-y-3">
              {/* Sales Report Section - Current Sales Data */}
              <details className="group border rounded-lg" data-testid="section-sales-report">
                <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate bg-muted/20">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Sales Report
                    {data.salesReport?.month?.netRevenue != null && (
                      <Badge variant="secondary" className="text-xs ml-2">
                        ${(data.salesReport.month.netRevenue || 0).toLocaleString()} / 30d
                      </Badge>
                    )}
                  </h4>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-4 py-4 space-y-4">
                  {data.salesReport ? (
                    <>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="p-3 bg-muted/30 rounded-lg">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Today</p>
                          <p className="text-lg font-semibold">{data.salesReport.today?.orders ?? 0} orders</p>
                          <p className="text-sm text-muted-foreground">{data.salesReport.today?.units ?? 0} units · ${(data.salesReport.today?.netRevenue ?? 0).toLocaleString()}</p>
                        </div>
                        <div className="p-3 bg-muted/30 rounded-lg">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Last 7 Days</p>
                          <p className="text-lg font-semibold">{data.salesReport.week?.orders ?? 0} orders</p>
                          <p className="text-sm text-muted-foreground">{data.salesReport.week?.units ?? 0} units · ${(data.salesReport.week?.netRevenue ?? 0).toLocaleString()}</p>
                        </div>
                        <div className="p-3 bg-muted/30 rounded-lg">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Last 30 Days</p>
                          <p className="text-lg font-semibold">{data.salesReport.month?.orders ?? 0} orders</p>
                          <p className="text-sm text-muted-foreground">{data.salesReport.month?.units ?? 0} units · ${(data.salesReport.month?.netRevenue ?? 0).toLocaleString()}</p>
                        </div>
                      </div>
                      {(data.salesReport.month?.refunds ?? 0) > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Refunds (30d): ${(data.salesReport.month?.refunds ?? 0).toLocaleString()}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No sales data available.</p>
                  )}
                </div>
              </details>

              {/* PO Report Section - Purchase Orders Status */}
              <details className="group border rounded-lg" data-testid="section-po-report">
                <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate bg-muted/20">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    PO Report
                    {data.poReport?.totalInbound != null && (
                      <Badge variant="secondary" className="text-xs ml-2">
                        {(data.poReport.totalInbound || 0).toLocaleString()} inbound
                      </Badge>
                    )}
                  </h4>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-4 py-4 space-y-4">
                  {data.poReport ? (
                    <>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {Object.entries(data.poReport.byStatus || {}).map(([status, count]) => (
                          <Badge key={status} variant="outline" className="text-xs">
                            {status}: {count as number}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span>Total POs: <strong>{data.poReport.totalPOs ?? 0}</strong></span>
                        <span>Inbound Units: <strong>{(data.poReport.totalInbound ?? 0).toLocaleString()}</strong></span>
                      </div>
                      {data.poReport.pendingPOs && data.poReport.pendingPOs.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Pending Deliveries</p>
                          <div className="space-y-1">
                            {data.poReport.pendingPOs.slice(0, 5).map((po: any) => (
                              <div key={po.poNumber} className="flex items-center justify-between text-sm py-1 px-2 bg-muted/20 rounded">
                                <span className="font-mono">{po.poNumber}</span>
                                <span className="text-muted-foreground">{po.supplier}</span>
                                <Badge variant="outline" className="text-xs">{po.status}</Badge>
                                <span>{po.totalQty ?? 0} units</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {data.poReport.skuPoBreakdown && data.poReport.skuPoBreakdown.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                            SKU-Level Breakdown
                            {data.poReport.skusWithNoPo > 0 && (
                              <Badge variant="destructive" className="text-xs ml-2">
                                {data.poReport.skusWithNoPo} without PO
                              </Badge>
                            )}
                          </p>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">SKU</TableHead>
                                <TableHead className="text-xs text-center">Qty Pending</TableHead>
                                <TableHead className="text-xs text-center">POs</TableHead>
                                <TableHead className="text-xs">Status</TableHead>
                                <TableHead className="text-xs">Expected</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {data.poReport.skuPoBreakdown.slice(0, 20).map((item: any) => (
                                <TableRow 
                                  key={item.sku} 
                                  data-testid={`sku-po-row-${item.sku}`}
                                  className={!item.hasPendingPo ? "bg-destructive/5" : ""}
                                >
                                  <TableCell className="font-mono text-xs py-2">{item.sku}</TableCell>
                                  <TableCell className="text-center font-medium py-2">
                                    {item.hasPendingPo ? item.totalQtyPending : "-"}
                                  </TableCell>
                                  <TableCell className="text-center py-2">{item.poCount}</TableCell>
                                  <TableCell className="py-2">
                                    {item.hasPendingPo ? (
                                      <div className="flex flex-wrap gap-1">
                                        {[...new Set(item.pos.map((p: any) => p.status))].map((status: string) => (
                                          <Badge key={status} variant="outline" className="text-xs">{status}</Badge>
                                        ))}
                                      </div>
                                    ) : (
                                      <Badge variant="destructive" className="text-xs">NO PO</Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground py-2">
                                    {item.pos[0]?.expectedDate 
                                      ? new Date(item.pos[0].expectedDate).toLocaleDateString() 
                                      : '-'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          {data.poReport.skuPoBreakdown.length > 20 && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Showing 20 of {data.poReport.skuPoBreakdown.length} SKUs
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No PO data available.</p>
                  )}
                </div>
              </details>

              {/* QuickBooks Report Section - Historical Sales Data */}
              <details className="group border rounded-lg" data-testid="section-quickbooks-report">
                <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate bg-muted/20">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Receipt className="h-4 w-4" />
                    QuickBooks Report
                    {data.quickbooksReport?.yearTotals?.revenue != null && (
                      <Badge variant="secondary" className="text-xs ml-2">
                        {data.quickbooksReport.year} · ${(data.quickbooksReport.yearTotals.revenue || 0).toLocaleString()}
                      </Badge>
                    )}
                  </h4>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-4 py-4 space-y-4">
                  {data.quickbooksReport && (data.quickbooksReport.yearTotals?.qty ?? 0) > 0 ? (
                    <>
                      <div className="flex items-center gap-4 text-sm mb-3">
                        <span>Year: <strong>{data.quickbooksReport.year}</strong></span>
                        <span>Total Units: <strong>{(data.quickbooksReport.yearTotals?.qty ?? 0).toLocaleString()}</strong></span>
                        <span>Revenue: <strong>${(data.quickbooksReport.yearTotals?.revenue ?? 0).toLocaleString()}</strong></span>
                      </div>
                      <div className="grid grid-cols-6 gap-2">
                        {(data.quickbooksReport.byMonth || []).map((m: any) => (
                          <div key={m.month} className="text-center p-2 bg-muted/20 rounded">
                            <p className="text-xs font-medium">{m.monthName}</p>
                            <p className="text-sm font-semibold">{(m.totalQty ?? 0).toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">${((m.totalRevenue ?? 0) / 1000).toFixed(1)}k</p>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No QuickBooks historical data available.</p>
                  )}
                </div>
              </details>

              {/* Ads Report Section - Meta & Google Ads Summaries */}
              <details className="group border rounded-lg" data-testid="section-ads-report">
                <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate bg-muted/20">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Ads Report
                    <Badge variant="outline" className="text-xs ml-2">Coming Soon</Badge>
                  </h4>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-4 py-4">
                  <p className="text-sm text-muted-foreground">
                    Meta and Google Ads performance summaries will appear here once connected. This data helps the AI agent make better ordering decisions based on ad spend and demand signals.
                  </p>
                </div>
              </details>

              {/* Inventory Report Section - Pivot & Hildale Qty by SKU */}
              {data.recommendations && data.recommendations.length > 0 && (
                <details className="group border rounded-lg" data-testid="section-inventory-report">
                  <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate bg-muted/20">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      Inventory Report
                      <Badge variant="secondary" className="text-xs ml-2">
                        {data.recommendations.length} SKUs
                      </Badge>
                    </h4>
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="px-4 py-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-32">SKU</TableHead>
                          <TableHead className="text-right">Pivot Qty</TableHead>
                          <TableHead className="text-right">Hildale Qty</TableHead>
                          <TableHead className="text-right">Available</TableHead>
                          <TableHead className="text-right">Days to Stockout</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.recommendations.map((rec) => (
                          <TableRow key={rec.id} data-testid={`inventory-row-${rec.sku}`}>
                            <TableCell className="font-mono text-sm">{rec.sku}</TableCell>
                            <TableCell className="text-right">{rec.contextSnapshot?.pivotQty ?? 0}</TableCell>
                            <TableCell className="text-right">{rec.contextSnapshot?.hildaleQty ?? 0}</TableCell>
                            <TableCell className="text-right">{rec.contextSnapshot?.availableForSale ?? 0}</TableCell>
                            <TableCell className={`text-right ${(rec.contextSnapshot?.daysUntilStockout ?? 999) <= 7 ? "text-red-600 font-medium" : ""}`}>
                              {rec.contextSnapshot?.daysUntilStockout ?? "∞"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </details>
              )}

            </div>
          </div>
        ) : (
          <div className="text-center py-16 text-muted-foreground">
            Failed to load timeline data
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BatchDecisionsSection() {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  
  // Fetch batch decisions
  const { data: batchDecisions, isLoading } = useQuery<BatchDecision[]>({
    queryKey: ["/api/ai-batch-decisions"],
    queryFn: async () => {
      const res = await fetch("/api/ai-batch-decisions", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch batch decisions");
      return res.json();
    },
  });

  const getUrgencyBadge = (urgency: string | null) => {
    switch (urgency) {
      case "HIGH":
        return <Badge variant="destructive">High</Badge>;
      case "MEDIUM":
        return <Badge variant="default">Medium</Badge>;
      case "LOW":
        return <Badge variant="secondary">Low</Badge>;
      default:
        return <Badge variant="outline">-</Badge>;
    }
  };

  const getReasonLabel = (reason: string) => {
    switch (reason) {
      case "SCHEDULED_10AM":
        return "10AM Batch";
      case "SCHEDULED_3PM":
        return "3PM Batch";
      case "CRITICAL_TRIGGER":
        return "Critical";
      case "MANUAL":
        return "Manual";
      default:
        return reason;
    }
  };

  const formatPercentDiff = (diff: number | null) => {
    if (diff === null) return "-";
    const sign = diff >= 0 ? "+" : "";
    return `${sign}${diff.toFixed(0)}%`;
  };

  return (
    <div className="mt-8 space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <Brain className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle>AI Batch Decisions</CardTitle>
              <CardDescription>
                Timeline view of LLM inventory decisions. Click a row to see events that led to each decision.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : !batchDecisions?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No batch decisions yet.</p>
              <p className="text-sm mt-1">Decisions run automatically at 10AM and 3PM Mountain time.</p>
            </div>
          ) : (
            <div className="overflow-x-auto" data-testid="table-batch-decisions">
              <table className="w-full table-auto text-sm">
                <thead className="bg-muted/50">
                  <tr className="h-11 border-b">
                    <th className="px-4 text-left font-medium whitespace-nowrap" data-testid="header-date">Date</th>
                    <th className="px-4 text-left font-medium whitespace-nowrap" data-testid="header-ai-decision">AI Decision</th>
                    <th className="px-4 text-left font-medium whitespace-nowrap" data-testid="header-staff-decision">Staff Decision</th>
                    <th className="px-4 text-center font-medium whitespace-nowrap" data-testid="header-moq">MOQ</th>
                    <th className="px-4 text-center font-medium whitespace-nowrap" data-testid="header-accuracy">Accuracy</th>
                    <th className="px-4 text-center font-medium whitespace-nowrap" data-testid="header-urgency">Urgency</th>
                    <th className="px-4 text-left font-medium whitespace-nowrap" data-testid="header-supplier">Supplier</th>
                    <th className="px-4 text-center font-medium whitespace-nowrap" data-testid="header-trigger">Trigger</th>
                  </tr>
                </thead>
                <tbody>
                  {batchDecisions.map((batch) => (
                    <tr
                      key={batch.id}
                      data-testid={`row-batch-${batch.id}`}
                      className="h-12 border-b hover-elevate cursor-pointer"
                      onClick={() => setSelectedBatchId(batch.id)}
                    >
                      <td className="px-4 align-middle whitespace-nowrap" data-testid={`cell-date-${batch.id}`}>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {new Date(batch.startedAt).toLocaleDateString()}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(batch.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 align-middle max-w-[250px]" data-testid={`cell-ai-decision-${batch.id}`}>
                        <p className="truncate">
                          {batch.aiDecisionSummary || `${batch.orderTodayCount || 0} items need ordering, ${batch.criticalItemsFound || 0} critical`}
                        </p>
                      </td>
                      <td className="px-4 align-middle max-w-[200px]" data-testid={`cell-staff-decision-${batch.id}`}>
                        <p className="truncate text-muted-foreground">
                          {batch.staffDecisionSummary || `${batch.acceptedCount}/${batch.recommendationsCount} accepted`}
                        </p>
                      </td>
                      <td className="px-4 align-middle text-center font-mono" data-testid={`cell-moq-${batch.id}`}>
                        {batch.totalRecommendedQty > 0 ? batch.totalRecommendedQty.toLocaleString() : "-"}
                      </td>
                      <td className="px-4 align-middle text-center" data-testid={`cell-accuracy-${batch.id}`}>
                        <span className={`font-mono ${
                          batch.percentDifference !== null 
                            ? batch.percentDifference >= 0 
                              ? "text-green-600" 
                              : "text-red-500"
                            : ""
                        }`}>
                          {formatPercentDiff(batch.percentDifference)}
                        </span>
                      </td>
                      <td className="px-4 align-middle text-center" data-testid={`cell-urgency-${batch.id}`}>
                        {getUrgencyBadge(batch.urgencyLevel)}
                      </td>
                      <td className="px-4 align-middle whitespace-nowrap max-w-[150px]" data-testid={`cell-supplier-${batch.id}`}>
                        <span className="truncate block">
                          {batch.supplierName || "-"}
                        </span>
                      </td>
                      <td className="px-4 align-middle text-center" data-testid={`cell-trigger-${batch.id}`}>
                        <Badge variant={batch.reason === "CRITICAL_TRIGGER" ? "destructive" : "outline"} className="text-xs" data-testid={`badge-trigger-${batch.id}`}>
                          {getReasonLabel(batch.reason)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline Modal */}
      <BatchTimelineModal
        batchId={selectedBatchId}
        isOpen={!!selectedBatchId}
        onClose={() => setSelectedBatchId(null)}
      />
    </div>
  );
}

function OrderFeedbackTab() {
  const { toast } = useToast();
  const [feedbackSubTab, setFeedbackSubTab] = useState<string>("recommendations");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedItem, setSelectedItem] = useState<PersistedRecommendation | null>(null);
  const [sheetItem, setSheetItem] = useState<PersistedRecommendation | null>(null);
  const [createPOOpen, setCreatePOOpen] = useState(false);
  const [createPOData, setCreatePOData] = useState<{
    supplierId?: string;
    recommendationId?: string; // Track recommendation ID for cache invalidation
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
  
  // Sync selectedItem with fresh data when recsData updates (e.g., after PO creation)
  useEffect(() => {
    if (selectedItem && recsData?.recommendations) {
      const fresh = recsData.recommendations.find(r => r.id === selectedItem.id);
      if (fresh && JSON.stringify(fresh) !== JSON.stringify(selectedItem)) {
        setSelectedItem(fresh);
      }
    }
  }, [recsData, selectedItem]);
  
  // Refresh mutation - triggers decision engine recalculation and persistence
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/ai/insights?refresh=true", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to refresh");
      return response.json() as Promise<OrderFeedbackResponse>;
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
          recommendationId: rec.id,
          items: [itemData],
        });
      } else {
        // Supplier not found or error - still open sheet without supplier
        console.warn("No designated supplier found for item:", rec.itemId);
        setCreatePOData({
          recommendationId: rec.id,
          items: [itemData],
        });
      }
      setCreatePOOpen(true);
    } catch (error) {
      console.error("Failed to get supplier info:", error);
      // Still open the PO sheet, just without pre-filled supplier
      setCreatePOData({
        recommendationId: rec.id,
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
    // Invalidate linked POs cache so the modal shows the new PO
    // Use createPOData.recommendationId as it's always set, even when modal isn't open
    const recId = createPOData?.recommendationId || selectedItem?.id;
    if (recId) {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/recommendations", recId, "linked-pos"] });
    }
    // Also invalidate the main recommendations list to update status
    queryClient.invalidateQueries({ queryKey: ["/api/ai/recommendations"] });
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
      <Tabs value={feedbackSubTab} onValueChange={setFeedbackSubTab}>
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
          {/* Batch Decisions Table - Timeline View */}
          <BatchDecisionsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// NOTE: Item-level recommendations table removed - only batch decisions remain

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

interface SystemLogEntry {
  id: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  severity: string;
  code: string | null;
  message: string;
  details: Record<string, any> | null;
  createdAt: string;
}

interface AIBatchLogEntry {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  reason: string;
  affectedSkus: string[] | null;
  totalSkus: number;
  processedSkus: number;
  criticalItemsFound: number;
  orderTodayCount: number;
  safeUntilTomorrowCount: number;
  llmProvider: string | null;
  llmModel: string | null;
  llmResponseTimeMs: number | null;
  errorMessage: string | null;
  aiDecisionSummary: string | null;
  urgencyLevel: string | null;
  createdAt: string;
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
  const { toast } = useToast();
  const [logSubTab, setLogSubTab] = useState<"audit" | "system" | "scheduler">("audit");
  const [wsConnected, setWsConnected] = useState(false);
  
  // Audit logs state
  const [page, setPage] = useState(1);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  
  // System logs state
  const [sysLogSeverity, setSysLogSeverity] = useState<string>("all");
  const [sysLogType, setSysLogType] = useState<string>("all");
  const [sysLogSearch, setSysLogSearch] = useState("");
  const [selectedSysLog, setSelectedSysLog] = useState<SystemLogEntry | null>(null);
  
  // Scheduler/batch logs state
  const [selectedBatchLog, setSelectedBatchLog] = useState<AIBatchLogEntry | null>(null);
  
  const pageSize = 25;
  
  // WebSocket connection for real-time log updates
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/logs`;
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    
    const connect = () => {
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        setWsConnected(true);
        console.log("[WebSocket] Connected to logs stream");
      };
      
      ws.onclose = () => {
        setWsConnected(false);
        console.log("[WebSocket] Disconnected, reconnecting in 3s...");
        reconnectTimeout = setTimeout(connect, 3000);
      };
      
      ws.onerror = (error) => {
        console.error("[WebSocket] Error:", error);
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "audit") {
            queryClient.invalidateQueries({ queryKey: ["/api/ai/logs"] });
          } else if (message.type === "system") {
            queryClient.invalidateQueries({ queryKey: ["/api/system-logs"] });
          } else if (message.type === "batch") {
            queryClient.invalidateQueries({ queryKey: ["/api/ai-batch-logs"] });
          }
        } catch (err) {
          console.error("[WebSocket] Failed to parse message:", err);
        }
      };
    };
    
    connect();
    
    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);
  
  // Build query params for audit logs
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
  
  // Audit logs query
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
  
  // System logs query
  const { data: systemLogsData, isLoading: sysLoading, refetch: refetchSysLogs, isFetching: sysFetching } = useQuery<SystemLogEntry[]>({
    queryKey: ["/api/system-logs", sysLogSeverity, sysLogType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sysLogSeverity !== "all") params.set("severity", sysLogSeverity);
      if (sysLogType !== "all") params.set("type", sysLogType);
      const response = await fetch(`/api/system-logs?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch system logs");
      return response.json();
    },
  });
  
  // AI batch logs query
  const { data: batchLogsData, isLoading: batchLoading, refetch: refetchBatchLogs, isFetching: batchFetching } = useQuery<AIBatchLogEntry[]>({
    queryKey: ["/api/ai-batch-logs"],
  });
  
  const eventTypes = [
    "PO_CREATED", "PO_SENT_GHL_EMAIL", "PO_SENT_GHL_SMS", "PO_SEND_FAILED",
    "SALES_ORDER_IMPORTED", "RETURN_CREATED", "RETURN_LABEL_ISSUED", "RETURN_RECEIVED",
    "INVENTORY_UPDATED", "AI_RECOMMENDATION", "INTEGRATION_SYNC", "SHOPIFY_SYNC",
    "AMAZON_SYNC", "CONNECTION_TEST", "SALES_SYNC", "SALES_SYNC_ERROR",
    "DEMAND_HISTORY_SYNC", "DEMAND_HISTORY_SYNC_ERROR", "TOKEN_REFRESH",
    "TOKEN_REFRESH_ERROR", "BILL_CREATED", "BILL_CREATE_ERROR",
    "REFUND_CREATED", "REFUND_CREATE_ERROR", "VENDOR_CREATED",
  ];
  
  const systemLogTypes = [
    "SKU_MISMATCH", "API_ERROR", "EXTENSIV_SYNC", "EXTENSIV_REBALANCE_ALERT",
    "EXTENSIV_ACTIVITY_SYNC", "SHIPPO_ERROR", "GHL_SYNC_ERROR", "GHL_SYNC_INFO",
    "RETURN_EVENT", "INVENTORY_ADJUSTMENT", "SHOPIFY_RECONCILIATION", "INFO", "WARNING", "ERROR",
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
  
  const getSeverityBadge = (severity: string) => {
    switch (severity?.toUpperCase()) {
      case "ERROR": return <Badge variant="destructive" className="text-xs">ERROR</Badge>;
      case "WARNING": return <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-xs">WARNING</Badge>;
      case "INFO": return <Badge variant="secondary" className="text-xs">INFO</Badge>;
      default: return <Badge variant="outline" className="text-xs">{severity}</Badge>;
    }
  };
  
  const getBatchStatusBadge = (status: string) => {
    switch (status?.toUpperCase()) {
      case "SUCCESS": return <Badge variant="default" className="text-xs">SUCCESS</Badge>;
      case "FAILED": return <Badge variant="destructive" className="text-xs">FAILED</Badge>;
      case "RUNNING": return <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-400 text-xs">RUNNING</Badge>;
      case "PARTIAL": return <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-xs">PARTIAL</Badge>;
      default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
  };
  
  const getReasonBadge = (reason: string) => {
    switch (reason) {
      case "SCHEDULED_10AM": return <Badge variant="outline" className="text-xs">10 AM Batch</Badge>;
      case "SCHEDULED_3PM": return <Badge variant="outline" className="text-xs">3 PM Batch</Badge>;
      case "CRITICAL_TRIGGER": return <Badge className="bg-red-500/20 text-red-700 dark:text-red-400 text-xs">Critical Trigger</Badge>;
      case "MANUAL": return <Badge variant="secondary" className="text-xs">Manual</Badge>;
      default: return <Badge variant="outline" className="text-xs">{reason}</Badge>;
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
  
  const formatDuration = (startStr: string, endStr: string | null) => {
    if (!endStr) return "In progress...";
    const start = new Date(startStr);
    const end = new Date(endStr);
    const durationMs = end.getTime() - start.getTime();
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
    return `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
  };
  
  const handleClearFilters = () => {
    setEventTypeFilter("all");
    setEntityTypeFilter("all");
    setSourceFilter("all");
    setStatusFilter("all");
    setSearchQuery("");
    setPage(1);
  };
  
  const handleExportLogs = () => {
    let exportData: any[] = [];
    let filename = "";
    
    if (logSubTab === "audit" && logsData?.logs) {
      exportData = logsData.logs;
      filename = `audit-logs-${new Date().toISOString().split('T')[0]}.json`;
    } else if (logSubTab === "system" && systemLogsData) {
      exportData = systemLogsData;
      filename = `system-logs-${new Date().toISOString().split('T')[0]}.json`;
    } else if (logSubTab === "scheduler" && batchLogsData) {
      exportData = batchLogsData;
      filename = `scheduler-logs-${new Date().toISOString().split('T')[0]}.json`;
    }
    
    if (exportData.length === 0) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Logs exported", description: `Downloaded ${filename}` });
  };
  
  const hasActiveFilters = eventTypeFilter !== "all" || entityTypeFilter !== "all" || sourceFilter !== "all" || statusFilter !== "all" || searchQuery !== "";
  
  // Filter system logs by search
  const filteredSystemLogs = (systemLogsData || []).filter(log => {
    if (!sysLogSearch) return true;
    const searchLower = sysLogSearch.toLowerCase();
    return (
      log.message.toLowerCase().includes(searchLower) ||
      log.type.toLowerCase().includes(searchLower) ||
      log.code?.toLowerCase().includes(searchLower) ||
      log.entityId?.toLowerCase().includes(searchLower)
    );
  });
  
  return (
    <div className="space-y-4">
      <Card className="mt-8">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Developer Logs
                {wsConnected && (
                  <Badge variant="outline" className="ml-2 text-xs bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse" />
                    Live
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-2">
                Comprehensive logging for debugging, monitoring, and auditing system activity
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportLogs}
                data-testid="button-export-logs"
              >
                <FileText className="mr-2 h-4 w-4" />
                Export JSON
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (logSubTab === "audit") refetch();
                  else if (logSubTab === "system") refetchSysLogs();
                  else refetchBatchLogs();
                }}
                disabled={isFetching || sysFetching || batchFetching}
                data-testid="button-refresh-logs"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${(isFetching || sysFetching || batchFetching) ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Inner tabs for log types */}
          <Tabs value={logSubTab} onValueChange={(v) => setLogSubTab(v as any)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="audit" data-testid="tab-audit-logs">
                <History className="mr-2 h-4 w-4" />
                Audit Logs
              </TabsTrigger>
              <TabsTrigger value="system" data-testid="tab-system-logs">
                <AlertTriangle className="mr-2 h-4 w-4" />
                System Logs
              </TabsTrigger>
              <TabsTrigger value="scheduler" data-testid="tab-scheduler-logs">
                <Clock className="mr-2 h-4 w-4" />
                Scheduler Logs
              </TabsTrigger>
            </TabsList>
            
            {/* AUDIT LOGS TAB */}
            <TabsContent value="audit" className="space-y-4">
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
                  <Button size="sm" variant="ghost" onClick={handleClearFilters} data-testid="button-clear-filters">
                    <XCircle className="mr-1 h-4 w-4" />
                    Clear
                  </Button>
                )}
              </div>
              
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <>
                  {/* Audit Logs Table */}
                  <div className="rounded-md border overflow-auto max-h-[500px]">
                    <table className="w-full table-auto text-sm">
                      <thead className="bg-muted sticky top-0 z-10">
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
                              <td className="px-4 text-muted-foreground whitespace-nowrap font-mono text-xs">
                                {formatDate(log.createdAt)}
                              </td>
                              <td className="px-4">
                                <div className="flex items-center gap-2 whitespace-nowrap">
                                  {getEventIcon(log.eventType)}
                                  <span className="font-medium">{log.eventType.replace(/_/g, " ")}</span>
                                </div>
                              </td>
                              <td className="px-4 whitespace-nowrap">
                                {log.entityType ? <Badge variant="outline" className="text-xs">{log.entityType}</Badge> : <span className="text-muted-foreground">-</span>}
                              </td>
                              <td className="px-4 whitespace-nowrap">{log.source || "-"}</td>
                              <td className="px-4 whitespace-nowrap">
                                {log.status ? <Badge variant={getStatusBadgeVariant(log.status)} className="text-xs">{log.status}</Badge> : <span className="text-muted-foreground">-</span>}
                              </td>
                              <td className="px-4 max-w-[300px] truncate">{log.description || "-"}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="h-32 text-center">
                              <div className="flex flex-col items-center gap-2 text-muted-foreground py-8">
                                <FileText className="h-8 w-8" />
                                <p className="font-medium">No logs found</p>
                                <p className="text-sm">{hasActiveFilters ? "Try adjusting your filters" : "Logs will appear here"}</p>
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
                        Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, logsData.pagination.total)} of {logsData.pagination.total}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} data-testid="button-prev-page">
                          <ChevronLeft className="h-4 w-4" /> Previous
                        </Button>
                        <span className="text-sm text-muted-foreground px-2">Page {page} of {logsData.pagination.totalPages}</span>
                        <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(logsData.pagination.totalPages, p + 1))} disabled={page >= logsData.pagination.totalPages} data-testid="button-next-page">
                          Next <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </TabsContent>
            
            {/* SYSTEM LOGS TAB */}
            <TabsContent value="system" className="space-y-4">
              {/* System logs filters */}
              <div className="flex flex-wrap items-center gap-3 p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Filters:</span>
                </div>
                
                <Select value={sysLogSeverity} onValueChange={setSysLogSeverity}>
                  <SelectTrigger className="w-[130px]" data-testid="select-sys-severity">
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severity</SelectItem>
                    <SelectItem value="ERROR">ERROR</SelectItem>
                    <SelectItem value="WARNING">WARNING</SelectItem>
                    <SelectItem value="INFO">INFO</SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={sysLogType} onValueChange={setSysLogType}>
                  <SelectTrigger className="w-[180px]" data-testid="select-sys-type">
                    <SelectValue placeholder="Log Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {systemLogTypes.map((type) => (
                      <SelectItem key={type} value={type}>{type.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search message, code, entity..."
                    value={sysLogSearch}
                    onChange={(e) => setSysLogSearch(e.target.value)}
                    className="pl-8 w-[220px]"
                    data-testid="input-search-sys-logs"
                  />
                </div>
              </div>
              
              {/* Stats summary */}
              {systemLogsData && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-red-500/10 rounded-lg text-center">
                    <p className="text-2xl font-bold text-red-600">{systemLogsData.filter(l => l.severity === "ERROR").length}</p>
                    <p className="text-xs text-muted-foreground">Errors</p>
                  </div>
                  <div className="p-3 bg-yellow-500/10 rounded-lg text-center">
                    <p className="text-2xl font-bold text-yellow-600">{systemLogsData.filter(l => l.severity === "WARNING").length}</p>
                    <p className="text-xs text-muted-foreground">Warnings</p>
                  </div>
                  <div className="p-3 bg-blue-500/10 rounded-lg text-center">
                    <p className="text-2xl font-bold text-blue-600">{systemLogsData.filter(l => l.severity === "INFO").length}</p>
                    <p className="text-xs text-muted-foreground">Info</p>
                  </div>
                </div>
              )}
              
              {sysLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <div className="rounded-md border overflow-auto max-h-[500px]">
                  <table className="w-full table-auto text-sm">
                    <thead className="bg-muted sticky top-0 z-10">
                      <tr>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Timestamp</th>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Severity</th>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Type</th>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Code</th>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSystemLogs.length > 0 ? (
                        filteredSystemLogs.slice(0, 100).map((log) => (
                          <tr 
                            key={log.id} 
                            className="h-11 border-b hover-elevate cursor-pointer" 
                            data-testid={`row-syslog-${log.id}`}
                            onClick={() => setSelectedSysLog(log)}
                          >
                            <td className="px-4 text-muted-foreground whitespace-nowrap font-mono text-xs">
                              {formatDate(log.createdAt)}
                            </td>
                            <td className="px-4 whitespace-nowrap">{getSeverityBadge(log.severity)}</td>
                            <td className="px-4 whitespace-nowrap">
                              <Badge variant="outline" className="text-xs">{log.type.replace(/_/g, " ")}</Badge>
                            </td>
                            <td className="px-4 whitespace-nowrap font-mono text-xs">{log.code || "-"}</td>
                            <td className="px-4 max-w-[400px] truncate">{log.message}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="h-32 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground py-8">
                              <AlertTriangle className="h-8 w-8" />
                              <p className="font-medium">No system logs found</p>
                              <p className="text-sm">System events will appear here</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
            
            {/* SCHEDULER LOGS TAB */}
            <TabsContent value="scheduler" className="space-y-4">
              {/* Scheduler stats */}
              {batchLogsData && batchLogsData.length > 0 && (
                <div className="grid grid-cols-4 gap-3">
                  <div className="p-3 bg-muted rounded-lg text-center">
                    <p className="text-2xl font-bold">{batchLogsData.length}</p>
                    <p className="text-xs text-muted-foreground">Total Runs</p>
                  </div>
                  <div className="p-3 bg-green-500/10 rounded-lg text-center">
                    <p className="text-2xl font-bold text-green-600">{batchLogsData.filter(l => l.status === "SUCCESS").length}</p>
                    <p className="text-xs text-muted-foreground">Successful</p>
                  </div>
                  <div className="p-3 bg-red-500/10 rounded-lg text-center">
                    <p className="text-2xl font-bold text-red-600">{batchLogsData.filter(l => l.status === "FAILED").length}</p>
                    <p className="text-xs text-muted-foreground">Failed</p>
                  </div>
                  <div className="p-3 bg-blue-500/10 rounded-lg text-center">
                    <p className="text-2xl font-bold text-blue-600">
                      {batchLogsData.reduce((sum, l) => sum + (l.criticalItemsFound || 0), 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">Critical Items Found</p>
                  </div>
                </div>
              )}
              
              {batchLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <div className="rounded-md border overflow-auto max-h-[500px]">
                  <table className="w-full table-auto text-sm">
                    <thead className="bg-muted sticky top-0 z-10">
                      <tr>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Started</th>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Duration</th>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Reason</th>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap w-px">Status</th>
                        <th className="h-11 px-4 text-center font-medium text-muted-foreground whitespace-nowrap w-px">SKUs</th>
                        <th className="h-11 px-4 text-center font-medium text-muted-foreground whitespace-nowrap w-px">Critical</th>
                        <th className="h-11 px-4 text-center font-medium text-muted-foreground whitespace-nowrap w-px">Order Today</th>
                        <th className="h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">LLM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchLogsData && batchLogsData.length > 0 ? (
                        batchLogsData.map((log) => (
                          <tr 
                            key={log.id} 
                            className="h-11 border-b hover-elevate cursor-pointer" 
                            data-testid={`row-batch-${log.id}`}
                            onClick={() => setSelectedBatchLog(log)}
                          >
                            <td className="px-4 text-muted-foreground whitespace-nowrap font-mono text-xs">
                              {formatDate(log.startedAt)}
                            </td>
                            <td className="px-4 whitespace-nowrap font-mono text-xs">
                              {formatDuration(log.startedAt, log.finishedAt)}
                            </td>
                            <td className="px-4 whitespace-nowrap">{getReasonBadge(log.reason)}</td>
                            <td className="px-4 whitespace-nowrap">{getBatchStatusBadge(log.status)}</td>
                            <td className="px-4 text-center font-mono">{log.processedSkus}/{log.totalSkus}</td>
                            <td className="px-4 text-center">
                              {log.criticalItemsFound > 0 ? (
                                <Badge className="bg-red-500/20 text-red-700 dark:text-red-400">{log.criticalItemsFound}</Badge>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </td>
                            <td className="px-4 text-center font-mono">{log.orderTodayCount || 0}</td>
                            <td className="px-4 whitespace-nowrap text-xs">
                              {log.llmProvider && log.llmModel ? (
                                <span className="font-mono">{log.llmProvider}/{log.llmModel}</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={8} className="h-32 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground py-8">
                              <Clock className="h-8 w-8" />
                              <p className="font-medium">No scheduler runs found</p>
                              <p className="text-sm">AI batch runs will appear here (10 AM and 3 PM MT)</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      
      {/* Audit Log Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedLog && getEventIcon(selectedLog.eventType)}
              {selectedLog?.eventType.replace(/_/g, " ")}
            </DialogTitle>
            <DialogDescription>{selectedLog && formatDate(selectedLog.createdAt)}</DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-sm text-muted-foreground">Entity Type</p><p className="font-medium">{selectedLog.entityType || "N/A"}</p></div>
                <div><p className="text-sm text-muted-foreground">Entity ID</p><p className="font-medium font-mono text-sm">{selectedLog.entityId || "N/A"}</p></div>
                <div><p className="text-sm text-muted-foreground">Source</p><p className="font-medium">{selectedLog.source || "N/A"}</p></div>
                <div><p className="text-sm text-muted-foreground">Status</p>{selectedLog.status ? <Badge variant={getStatusBadgeVariant(selectedLog.status)}>{selectedLog.status}</Badge> : <span>N/A</span>}</div>
              </div>
              {selectedLog.description && (
                <div><p className="text-sm text-muted-foreground mb-1">Description</p><div className="p-3 bg-muted rounded-lg"><p className="text-sm">{selectedLog.description}</p></div></div>
              )}
              {selectedLog.eventType === "INTEGRATION_SYNC" && selectedLog.details?.syncedRecords && Array.isArray(selectedLog.details.syncedRecords) && selectedLog.details.syncedRecords.length > 0 && (
                <SyncedRecordsTable records={selectedLog.details.syncedRecords} />
              )}
              {selectedLog.details && Object.keys(selectedLog.details).length > 0 && !selectedLog.details.syncedRecords && (
                <div><p className="text-sm text-muted-foreground mb-1">Details (JSON)</p><ScrollArea className="h-[200px]"><pre className="p-3 bg-muted rounded-lg text-xs font-mono overflow-x-auto">{JSON.stringify(selectedLog.details, null, 2)}</pre></ScrollArea></div>
              )}
              {selectedLog.performedByUserId && (
                <div><p className="text-sm text-muted-foreground">Performed By</p><p className="font-medium font-mono text-sm">{selectedLog.performedByUserId}</p></div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      
      {/* System Log Detail Dialog */}
      <Dialog open={!!selectedSysLog} onOpenChange={(open) => !open && setSelectedSysLog(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              System Log Details
            </DialogTitle>
            <DialogDescription>{selectedSysLog && formatDate(selectedSysLog.createdAt)}</DialogDescription>
          </DialogHeader>
          {selectedSysLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-sm text-muted-foreground">Severity</p>{getSeverityBadge(selectedSysLog.severity)}</div>
                <div><p className="text-sm text-muted-foreground">Type</p><Badge variant="outline">{selectedSysLog.type}</Badge></div>
                <div><p className="text-sm text-muted-foreground">Code</p><p className="font-mono text-sm">{selectedSysLog.code || "N/A"}</p></div>
                <div><p className="text-sm text-muted-foreground">Entity</p><p className="font-mono text-sm">{selectedSysLog.entityType ? `${selectedSysLog.entityType}: ${selectedSysLog.entityId || "N/A"}` : "N/A"}</p></div>
              </div>
              <div><p className="text-sm text-muted-foreground mb-1">Message</p><div className="p-3 bg-muted rounded-lg"><p className="text-sm">{selectedSysLog.message}</p></div></div>
              {selectedSysLog.details && Object.keys(selectedSysLog.details).length > 0 && (
                <div><p className="text-sm text-muted-foreground mb-1">Details (JSON)</p><ScrollArea className="h-[250px]"><pre className="p-3 bg-muted rounded-lg text-xs font-mono overflow-x-auto">{JSON.stringify(selectedSysLog.details, null, 2)}</pre></ScrollArea></div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Batch Log Detail Dialog */}
      <Dialog open={!!selectedBatchLog} onOpenChange={(open) => !open && setSelectedBatchLog(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              AI Batch Run Details
            </DialogTitle>
            <DialogDescription>{selectedBatchLog && formatDate(selectedBatchLog.startedAt)}</DialogDescription>
          </DialogHeader>
          {selectedBatchLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-sm text-muted-foreground">Reason</p>{getReasonBadge(selectedBatchLog.reason)}</div>
                <div><p className="text-sm text-muted-foreground">Status</p>{getBatchStatusBadge(selectedBatchLog.status)}</div>
                <div><p className="text-sm text-muted-foreground">Duration</p><p className="font-mono">{formatDuration(selectedBatchLog.startedAt, selectedBatchLog.finishedAt)}</p></div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="p-3 bg-muted rounded-lg text-center"><p className="text-xl font-bold">{selectedBatchLog.processedSkus}/{selectedBatchLog.totalSkus}</p><p className="text-xs text-muted-foreground">SKUs Processed</p></div>
                <div className="p-3 bg-red-500/10 rounded-lg text-center"><p className="text-xl font-bold text-red-600">{selectedBatchLog.criticalItemsFound}</p><p className="text-xs text-muted-foreground">Critical</p></div>
                <div className="p-3 bg-orange-500/10 rounded-lg text-center"><p className="text-xl font-bold text-orange-600">{selectedBatchLog.orderTodayCount}</p><p className="text-xs text-muted-foreground">Order Today</p></div>
                <div className="p-3 bg-green-500/10 rounded-lg text-center"><p className="text-xl font-bold text-green-600">{selectedBatchLog.safeUntilTomorrowCount}</p><p className="text-xs text-muted-foreground">Safe Tomorrow</p></div>
              </div>
              {selectedBatchLog.llmProvider && (
                <div className="grid grid-cols-3 gap-4">
                  <div><p className="text-sm text-muted-foreground">LLM Provider</p><p className="font-medium">{selectedBatchLog.llmProvider}</p></div>
                  <div><p className="text-sm text-muted-foreground">Model</p><p className="font-mono text-sm">{selectedBatchLog.llmModel || "N/A"}</p></div>
                  <div><p className="text-sm text-muted-foreground">Response Time</p><p className="font-mono text-sm">{selectedBatchLog.llmResponseTimeMs ? `${selectedBatchLog.llmResponseTimeMs}ms` : "N/A"}</p></div>
                </div>
              )}
              {selectedBatchLog.aiDecisionSummary && (
                <div><p className="text-sm text-muted-foreground mb-1">AI Decision Summary</p><div className="p-3 bg-muted rounded-lg"><p className="text-sm">{selectedBatchLog.aiDecisionSummary}</p></div></div>
              )}
              {selectedBatchLog.errorMessage && (
                <div><p className="text-sm text-muted-foreground mb-1">Error Message</p><div className="p-3 bg-red-500/10 rounded-lg border border-red-500/20"><p className="text-sm text-red-700 dark:text-red-400">{selectedBatchLog.errorMessage}</p></div></div>
              )}
              {selectedBatchLog.affectedSkus && selectedBatchLog.affectedSkus.length > 0 && (
                <div><p className="text-sm text-muted-foreground mb-1">Affected SKUs ({selectedBatchLog.affectedSkus.length})</p><div className="flex flex-wrap gap-1 p-3 bg-muted rounded-lg max-h-[150px] overflow-y-auto">{selectedBatchLog.affectedSkus.slice(0, 50).map((sku, i) => (<Badge key={i} variant="outline" className="text-xs font-mono">{sku}</Badge>))}{selectedBatchLog.affectedSkus.length > 50 && <Badge variant="secondary">+{selectedBatchLog.affectedSkus.length - 50} more</Badge>}</div></div>
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
  const [syncingAttribution, setSyncingAttribution] = useState(false);
  const [openIntegration, setOpenIntegration] = useState<"EXTENSIV" | "SHOPIFY" | "AMAZON" | "GOHIGHLEVEL" | "SHIPPO" | null>(null);
  const [showPhantomV2Modal, setShowPhantomV2Modal] = useState(false);
  const [showAttributionModal, setShowAttributionModal] = useState(false);
  const [attributionMode, setAttributionMode] = useState<"incremental" | "backfill">("incremental");
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
  
  // QuickBooks Settings Dialog state
  const [showQbSettingsDialog, setShowQbSettingsDialog] = useState(false);
  const [qbClientId, setQbClientId] = useState("");
  const [qbClientSecret, setQbClientSecret] = useState("");
  const [qbWebhookToken, setQbWebhookToken] = useState("");
  const [savingQbCredentials, setSavingQbCredentials] = useState(false);
  const [testingQbConnection, setTestingQbConnection] = useState(false);

  // Handle QuickBooks OAuth callback params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const qbStatus = urlParams.get('quickbooks');
    
    if (qbStatus === 'connected') {
      toast({
        title: "QuickBooks Connected",
        description: "Successfully connected to QuickBooks. You can now sync sales data.",
      });
      // Clean up URL params
      const newUrl = window.location.pathname + (urlParams.has('tab') ? `?tab=${urlParams.get('tab')}` : '');
      window.history.replaceState({}, '', newUrl);
      // Refetch status
      refetchQbStatus();
    } else if (qbStatus === 'error') {
      toast({
        title: "Connection Failed",
        description: "Failed to connect to QuickBooks. Please try again.",
        variant: "destructive",
      });
      // Clean up URL params
      const newUrl = window.location.pathname + (urlParams.has('tab') ? `?tab=${urlParams.get('tab')}` : '');
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

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

  const { data: shippoConfig } = useQuery<any>({
    queryKey: ["/api/integration-configs/SHIPPO"],
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
      const data = await response.json();
      if (data.authUrl) {
        // Direct navigation - browsers don't block this like popups
        window.location.href = data.authUrl;
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

  // Commerce Attribution Sync Handler
  const handleAttributionSync = async () => {
    setShowAttributionModal(false);
    setSyncingAttribution(true);
    
    toast({
      title: "Commerce Attribution sync started...",
      description: attributionMode === "backfill" ? "Processing historical orders" : "Processing new orders",
    });
    
    try {
      const response = await apiRequest("POST", `/api/integrations/shopify/commerce-attribution/sync`, { 
        mode: attributionMode 
      });
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Commerce Attribution sync completed",
          description: `${result.ordersProcessed || 0} orders, ${result.customersUpdated || 0} customers, ${result.contactsUpdated || 0} GHL contacts updated`,
        });
      } else {
        toast({
          title: "Attribution sync failed",
          description: result.message || "See Logs for details",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Attribution sync failed",
        description: error.message || "See Logs for details",
        variant: "destructive",
      });
    } finally {
      setSyncingAttribution(false);
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
    {
      id: "shippo",
      integrationType: "SHIPPO" as const,
      name: "Shippo",
      description: "Return labels & shipping",
      icon: Package,
      configured: !!(shippoConfig?.apiKey),
      status: getConfigStatus(shippoConfig),
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

      <Tabs defaultValue="order-feedback" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="order-feedback" data-testid="tab-order-feedback">
            Order Feedback
          </TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">
            Logs
          </TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-rules">
            Rules
          </TabsTrigger>
          <TabsTrigger value="data-sources" data-testid="tab-data-sources">
            Data Sources
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
                                      setShowQbSettingsDialog(true);
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
                                      setOpenIntegration(source.integrationType as "EXTENSIV" | "SHOPIFY" | "AMAZON" | "GOHIGHLEVEL" | "SHIPPO");
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
                                {source.id === "shopify" && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setShowAttributionModal(true)}
                                        disabled={!source.configured || syncingAttribution}
                                        data-testid="button-attribution-sync"
                                      >
                                        <Users
                                          className={`mr-2 h-4 w-4 ${syncingAttribution ? "animate-spin" : ""}`}
                                        />
                                        {syncingAttribution ? "Syncing..." : "Attribution"}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Sync customer purchase sources (Amazon/Shopify) to GHL</p>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
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

        {/* Order Feedback Tab (formerly Insights) */}
        <TabsContent value="order-feedback" className="space-y-4">
          <OrderFeedbackTab />
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

      {/* Commerce Attribution Sync Modal */}
      <Dialog open={showAttributionModal} onOpenChange={setShowAttributionModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="title-attribution-sync-options">Commerce Attribution Sync</DialogTitle>
            <DialogDescription>
              Sync customer purchase sources from Shopify to GoHighLevel custom fields and tags.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="text-sm text-muted-foreground space-y-2">
              <p>This sync analyzes Shopify orders to determine customer purchase sources:</p>
              <ul className="list-disc list-inside text-xs space-y-1 ml-2">
                <li>First purchase source (Amazon, Shopify, or Unknown)</li>
                <li>Latest purchase source for repeat customers</li>
                <li>Purchase count and lifetime value</li>
                <li>First and last purchase dates</li>
              </ul>
            </div>
            
            <RadioGroup 
              value={attributionMode} 
              onValueChange={(value: "incremental" | "backfill") => setAttributionMode(value)}
              className="space-y-4"
            >
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${attributionMode === "incremental" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setAttributionMode("incremental")}
              >
                <RadioGroupItem value="incremental" id="attr-incremental" data-testid="radio-attr-incremental" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="attr-incremental" className="text-sm font-medium cursor-pointer">
                    Incremental (recommended)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Process orders since the last sync. Fast and efficient for regular use.
                  </p>
                </div>
              </div>
              
              <div 
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${attributionMode === "backfill" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => setAttributionMode("backfill")}
              >
                <RadioGroupItem value="backfill" id="attr-backfill" data-testid="radio-attr-backfill" />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="attr-backfill" className="text-sm font-medium cursor-pointer">
                    Backfill (historical)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Process all historical orders. Use for initial setup or to rebuild attribution data.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
          <div className="flex justify-end gap-2">
            <Button 
              variant="outline" 
              onClick={() => setShowAttributionModal(false)}
              data-testid="button-cancel-attribution-sync"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleAttributionSync}
              data-testid="button-start-attribution-sync"
            >
              <Users className="mr-2 h-4 w-4" />
              Start Sync
            </Button>
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
          <div className="flex justify-between gap-2">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={async () => {
                try {
                  toast({ title: "Linking GHL contacts...", description: "This may take a few minutes" });
                  const response = await apiRequest("POST", "/api/integrations/gohighlevel/backfill-contacts");
                  const data = await response.json();
                  if (data.success) {
                    toast({ 
                      title: "Contact linking complete", 
                      description: `Linked ${data.linked} orders to GHL contacts${data.failed > 0 ? `, ${data.failed} failed` : ''}` 
                    });
                  } else {
                    toast({ title: "Contact linking failed", description: data.message, variant: "destructive" });
                  }
                } catch (err: any) {
                  toast({ title: "Error", description: err.message, variant: "destructive" });
                }
              }}
              data-testid="button-ghl-backfill-contacts"
            >
              <Users className="mr-2 h-4 w-4" />
              Link Missing Contacts
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowGhlSyncModal(false)} data-testid="button-cancel-ghl-sync">
                Cancel
              </Button>
              <Button onClick={handleGhlSync} data-testid="button-start-ghl-sync">
                <RefreshCw className="mr-2 h-4 w-4" />
                Start Sync
              </Button>
            </div>
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
                    Products, SKUs, orders, and product rows are never deleted.
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

      {/* QuickBooks Settings Dialog */}
      <Dialog open={showQbSettingsDialog} onOpenChange={setShowQbSettingsDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="title-quickbooks-settings">QuickBooks Online Settings</DialogTitle>
            <DialogDescription>
              Configure your QuickBooks connection credentials.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="qb-client-id">Client ID</Label>
              <Input
                id="qb-client-id"
                type="text"
                placeholder="Enter QuickBooks Client ID"
                value={qbClientId}
                onChange={(e) => setQbClientId(e.target.value)}
                data-testid="input-qb-client-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qb-client-secret">Client Secret</Label>
              <Input
                id="qb-client-secret"
                type="password"
                placeholder="Enter QuickBooks Client Secret"
                value={qbClientSecret}
                onChange={(e) => setQbClientSecret(e.target.value)}
                data-testid="input-qb-client-secret"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="qb-webhook-token">Webhook Verifier Token</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p>Found in your Intuit Developer Portal under Webhooks. Used to verify webhook notifications are from QuickBooks.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="qb-webhook-token"
                type="password"
                placeholder="Enter Webhook Verifier Token"
                value={qbWebhookToken}
                onChange={(e) => setQbWebhookToken(e.target.value)}
                data-testid="input-qb-webhook-token"
              />
            </div>
            
            {quickbooksStatus?.isConnected && (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">Connected to QuickBooks</span>
                </div>
                {quickbooksStatus?.companyName && (
                  <p className="text-xs text-muted-foreground mt-1">Company: {quickbooksStatus.companyName}</p>
                )}
              </div>
            )}
          </div>
          <div className="flex justify-between gap-2">
            <div>
              {quickbooksStatus?.isConnected ? (
                <Button 
                  variant="destructive" 
                  size="sm"
                  onClick={async () => {
                    try {
                      await apiRequest("POST", "/api/quickbooks/disconnect");
                      refetchQbStatus();
                      toast({ title: "Disconnected", description: "QuickBooks has been disconnected." });
                    } catch (error: any) {
                      toast({ title: "Error", description: error.message, variant: "destructive" });
                    }
                  }}
                  data-testid="button-qb-disconnect"
                >
                  Disconnect
                </Button>
              ) : (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={async () => {
                    try {
                      const response = await apiRequest("GET", "/api/quickbooks/auth-url");
                      const data = await response.json();
                      if (data.authUrl) {
                        window.open(data.authUrl, '_blank');
                        toast({ 
                          title: "OAuth Window Opened", 
                          description: "Complete the QuickBooks login in the new tab, then return here." 
                        });
                      }
                    } catch (error: any) {
                      toast({ title: "Error", description: error.message, variant: "destructive" });
                    }
                  }}
                  data-testid="button-qb-connect-oauth"
                >
                  Connect via OAuth
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => setShowQbSettingsDialog(false)} 
                data-testid="button-qb-settings-cancel"
              >
                Cancel
              </Button>
              <Button 
                onClick={async () => {
                  setSavingQbCredentials(true);
                  try {
                    // Save webhook token if provided
                    if (qbWebhookToken) {
                      await apiRequest("PATCH", "/api/quickbooks/webhook-config", { webhookVerifierToken: qbWebhookToken });
                    }
                    // Test connection
                    const response = await apiRequest("POST", "/api/quickbooks/test-connection");
                    const data = await response.json();
                    if (data.success) {
                      toast({ title: "Success", description: "QuickBooks connection verified!" });
                      refetchQbStatus();
                      setShowQbSettingsDialog(false);
                    } else {
                      toast({ title: "Connection Failed", description: data.error || "Could not verify connection", variant: "destructive" });
                    }
                  } catch (error: any) {
                    toast({ title: "Error", description: error.message, variant: "destructive" });
                  } finally {
                    setSavingQbCredentials(false);
                  }
                }}
                disabled={savingQbCredentials}
                data-testid="button-qb-save-test"
              >
                {savingQbCredentials ? "Testing..." : "Save & Test"}
              </Button>
            </div>
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
              <p>QuickBooks is used to build demand history for forecasting. No core inventory tables (Products, Barcodes, Sales Orders, POs) are modified.</p>
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
