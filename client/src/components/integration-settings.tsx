import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, CheckCircle2, XCircle, AlertCircle, RefreshCw, Settings2, Webhook, Trash2, Info, Play, ExternalLink, ChevronDown, Eye, EyeOff } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface ShopifyWebhook {
  id: number;
  topic: string;
  address: string;
  format: string;
  created_at: string;
}

interface IntegrationConfig {
  id: string;
  userId: string;
  provider: string;
  accountName: string | null;
  apiKey: string | null;
  isEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  config: any;
}

type IntegrationType = "EXTENSIV" | "SHOPIFY" | "AMAZON" | "GOHIGHLEVEL" | "PHANTOMBUSTER" | "SHIPPO";

interface IntegrationSettingsProps {
  integrationType: IntegrationType;
  open: boolean;
  onClose: () => void;
  onOpenSkuWizard?: (source?: "shopify" | "amazon" | "extensiv" | "quickbooks") => void;
}

const INTEGRATION_LABELS: Record<IntegrationType, string> = {
  EXTENSIV: "Extensiv (Pivot Warehouse)",
  SHOPIFY: "Shopify",
  AMAZON: "Amazon Seller Central",
  GOHIGHLEVEL: "GoHighLevel",
  PHANTOMBUSTER: "PhantomBuster",
  SHIPPO: "Shippo",
};

const INTEGRATION_DESCRIPTIONS: Record<IntegrationType, string> = {
  EXTENSIV: "Sync inventory from your Extensiv 3PL warehouse",
  SHOPIFY: "Connect your Shopify store to import orders and sync inventory",
  AMAZON: "Integrate with Amazon Seller Central for order management",
  GOHIGHLEVEL: "Connect your CRM for return notifications and task management",
  PHANTOMBUSTER: "Enrich supplier and product data through automated scraping",
  SHIPPO: "Generate return shipping labels and track deliveries",
};

// Helper function to mask API keys (show first 2 + **** + last 4 characters)
function maskApiKey(key: string | undefined | null): string {
  if (!key || key.length < 8) return "";
  const first = key.slice(0, 2);
  const last = key.slice(-4);
  return `${first}****${last}`;
}

export function IntegrationSettings({ integrationType, open, onClose, onOpenSkuWizard }: IntegrationSettingsProps) {
  const { toast } = useToast();
  const [isConfigMode, setIsConfigMode] = useState(false);

  // Form state for different integration types
  const [apiKey, setApiKey] = useState("");
  const [pivotWarehouseId, setPivotWarehouseId] = useState("1");
  const [extensivBaseUrl, setExtensivBaseUrl] = useState("https://api.skubana.com/v1");
  const [extensivPushOrders, setExtensivPushOrders] = useState(false);
  
  // Shopify fields
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [apiVersion, setApiVersion] = useState("2024-01");
  const [shopifyPivotLocationId, setShopifyPivotLocationId] = useState("");
  const [shopifyHildaleLocationId, setShopifyHildaleLocationId] = useState("");
  const [showLegacyLocationNote, setShowLegacyLocationNote] = useState(false);
  const [syncOrders, setSyncOrders] = useState(true);
  const [pushInventory, setPushInventory] = useState(false);
  
  // Amazon fields
  const [sellerId, setSellerId] = useState("");
  const [marketplaceIds, setMarketplaceIds] = useState("");
  const [region, setRegion] = useState("NA");
  const [refreshToken, setRefreshToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [amazonSyncOrders, setAmazonSyncOrders] = useState(true);
  const [amazonPushInventory, setAmazonPushInventory] = useState(false);
  
  // GoHighLevel fields
  const [ghlApiKey, setGhlApiKey] = useState("");
  const [ghlLocationId, setGhlLocationId] = useState("");
  const [ghlWebhookSecret, setGhlWebhookSecret] = useState("");
  
  // PhantomBuster fields
  const [phantomApiKey, setPhantomApiKey] = useState("");
  const [phantomAgentIds, setPhantomAgentIds] = useState("");
  
  // Shippo fields
  const [shippoApiKey, setShippoApiKey] = useState("");
  const [shippoReturnLabelMinFee, setShippoReturnLabelMinFee] = useState("30");
  const [shippoHildaleAddress, setShippoHildaleAddress] = useState("");
  const [shippoPricingMode, setShippoPricingMode] = useState<"actual" | "fixed">("actual");
  const [showShippoApiKey, setShowShippoApiKey] = useState(false);

  // Fetch integration config
  const { data: config, isLoading } = useQuery<IntegrationConfig | null>({
    queryKey: [`/api/integration-configs/${integrationType}`],
    enabled: open,
    retry: (failureCount, error: any) => {
      if (error?.message?.includes("404")) return false;
      return failureCount < 3;
    },
  });

  // Fetch AI Agent settings to check if two-way sync is enabled (for Shopify, Amazon, and Extensiv)
  const { data: aiAgentSettings } = useQuery<{
    shopifyTwoWaySync: boolean;
    shopifySafetyBuffer: number;
    amazonTwoWaySync: boolean;
    amazonSafetyBuffer: number;
    extensivTwoWaySync: boolean;
    pivotLowDaysThreshold: number;
    hildaleHighDaysThreshold: number;
  } | null>({
    queryKey: ["/api/ai-agent-settings"],
    enabled: open && (integrationType === "SHOPIFY" || integrationType === "AMAZON" || integrationType === "EXTENSIV"),
  });

  const shopifyTwoWaySyncEnabled = aiAgentSettings?.shopifyTwoWaySync ?? false;
  const amazonTwoWaySyncEnabled = aiAgentSettings?.amazonTwoWaySync ?? false;
  const extensivTwoWaySyncEnabled = aiAgentSettings?.extensivTwoWaySync ?? false;

  // Shopify Webhooks
  const { data: webhooksData, isLoading: webhooksLoading, refetch: refetchWebhooks } = useQuery<{ webhooks: ShopifyWebhook[] }>({
    queryKey: ["/api/shopify/webhooks"],
    enabled: open && integrationType === "SHOPIFY" && !!config?.apiKey,
  });

  const registerWebhooksMutation = useMutation({
    mutationFn: async () => {
      const baseUrl = window.location.origin;
      const callbackUrl = `${baseUrl}/api/webhooks/shopify`;
      return apiRequest("POST", "/api/shopify/webhooks/register-orders", { callbackUrl });
    },
    onSuccess: () => {
      toast({ title: "Webhooks Registered", description: "Real-time order notifications are now active" });
      refetchWebhooks();
    },
    onError: (error: any) => {
      toast({ title: "Failed to Register Webhooks", description: error.message, variant: "destructive" });
    },
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: async (webhookId: number) => {
      return apiRequest("DELETE", `/api/shopify/webhooks/${webhookId}`);
    },
    onSuccess: () => {
      toast({ title: "Webhook Removed", description: "Webhook has been unregistered" });
      refetchWebhooks();
    },
    onError: (error: any) => {
      toast({ title: "Failed to Remove Webhook", description: error.message, variant: "destructive" });
    },
  });

  const [testingWebhookId, setTestingWebhookId] = useState<number | null>(null);
  const testWebhookMutation = useMutation({
    mutationFn: async (webhookId: number) => {
      setTestingWebhookId(webhookId);
      return apiRequest("GET", `/api/shopify/webhooks/${webhookId}/test`);
    },
    onSuccess: (data: any) => {
      toast({ 
        title: "Webhook Verified", 
        description: data.message || "Webhook is active and registered with Shopify"
      });
      setTestingWebhookId(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "Webhook Test Failed", 
        description: error.message || "Could not verify webhook with Shopify", 
        variant: "destructive" 
      });
      setTestingWebhookId(null);
    },
  });

  const allWebhooks = webhooksData?.webhooks || [];
  
  const webhooksByCategory = {
    orders: allWebhooks.filter(w => w.topic.startsWith('orders/')),
    carts: allWebhooks.filter(w => w.topic.startsWith('carts/')),
    products: allWebhooks.filter(w => w.topic.startsWith('products/')),
    inventory: allWebhooks.filter(w => w.topic.startsWith('inventory_levels/')),
    fulfillments: allWebhooks.filter(w => w.topic.startsWith('fulfillments/')),
    refunds: allWebhooks.filter(w => w.topic.startsWith('refunds/')),
  };
  
  const orderWebhooks = webhooksByCategory.orders;

  // Initialize form fields when config loads
  useEffect(() => {
    if (config && config.apiKey) {
      setApiKey("");
      if (integrationType === "EXTENSIV") {
        setPivotWarehouseId(config.config?.pivotWarehouseId || "1");
        setExtensivBaseUrl(config.config?.baseUrl || "https://api.skubana.com/v1");
        setExtensivPushOrders(config.config?.pushOrders || false);
      } else if (integrationType === "SHOPIFY") {
        setShopDomain(config.config?.shopDomain || "");
        setAccessToken("");
        setApiVersion(config.config?.apiVersion || "2024-01");
        
        // Multi-location support: prefer new fields, fallback to legacy locationId
        const legacyLocationId = config.config?.locationId || "";
        const pivotId = config.config?.pivotLocationId || "";
        const hildaleId = config.config?.hildaleLocationId || "";
        
        // If only legacy locationId exists, pre-fill it as Pivot and show note
        if (legacyLocationId && !pivotId) {
          setShopifyPivotLocationId(legacyLocationId);
          setShowLegacyLocationNote(true);
        } else {
          setShopifyPivotLocationId(pivotId);
          setShowLegacyLocationNote(false);
        }
        setShopifyHildaleLocationId(hildaleId);
        
        setSyncOrders(config.config?.syncOrders !== false);
        setPushInventory(config.config?.pushInventory || false);
      } else if (integrationType === "AMAZON") {
        setSellerId(config.config?.sellerId || "");
        setMarketplaceIds(config.config?.marketplaceIds?.join(", ") || "");
        setRegion(config.config?.region || "NA");
        setRefreshToken("");
        setClientId(config.config?.clientId || "");
        setClientSecret("");
        setAmazonSyncOrders(config.config?.syncOrders !== false);
        setAmazonPushInventory(config.config?.pushInventory || false);
      } else if (integrationType === "GOHIGHLEVEL") {
        setGhlApiKey("");
        setGhlLocationId(config.config?.locationId || "");
        setGhlWebhookSecret(config.config?.webhookSecret || "");
      } else if (integrationType === "PHANTOMBUSTER") {
        setPhantomApiKey("");
        setPhantomAgentIds(config.config?.agentIds?.join(", ") || "");
      } else if (integrationType === "SHIPPO") {
        setShippoApiKey("");
        setShippoReturnLabelMinFee(config.config?.returnLabelMinFeeUsd?.toString() || "30");
        setShippoHildaleAddress(config.config?.hildaleAddress || "");
        // Default to "fixed" if existing fee is set and no explicit pricingMode stored (backward compat)
        const storedMode = config.config?.pricingMode;
        const hasExistingFee = config.config?.returnLabelMinFeeUsd !== undefined && config.config?.returnLabelMinFeeUsd !== null;
        setShippoPricingMode(storedMode || (hasExistingFee ? "fixed" : "actual"));
        setShowShippoApiKey(false);
      }
    }
  }, [config, integrationType]);

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const endpoint = integrationType.toLowerCase();
      const response = await apiRequest("POST", `/api/integrations/${endpoint}/test`);
      return await response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "Connection Successful" : "Connection Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/integration-configs/${integrationType}`] });
    },
    onError: (error: Error) => {
      toast({
        title: "Test Failed",
        description: error.message || "Failed to test connection",
        variant: "destructive",
      });
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const endpoint = integrationType.toLowerCase();
      const response = await apiRequest("POST", `/api/integrations/${endpoint}/sync`);
      return await response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "Sync Successful" : "Sync Completed with Warnings",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/integration-configs/${integrationType}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-orders"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync data",
        variant: "destructive",
      });
    },
  });

  // Save configuration mutation
  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      let configData: any = {};
      
      if (integrationType === "EXTENSIV") {
        configData = { 
          pivotWarehouseId,
          baseUrl: extensivBaseUrl,
          pushOrders: extensivPushOrders,
        };
      } else if (integrationType === "SHOPIFY") {
        configData = {
          shopDomain,
          apiVersion,
          pivotLocationId: shopifyPivotLocationId,
          hildaleLocationId: shopifyHildaleLocationId,
          syncOrders,
          pushInventory,
        };
      } else if (integrationType === "AMAZON") {
        configData = {
          sellerId,
          marketplaceIds: marketplaceIds.split(",").map((id) => id.trim()).filter(Boolean),
          region,
          clientId,
          syncOrders: amazonSyncOrders,
          pushInventory: amazonPushInventory,
        };
      } else if (integrationType === "GOHIGHLEVEL") {
        configData = {
          locationId: ghlLocationId,
          webhookSecret: ghlWebhookSecret, // Empty string clears the secret
        };
      } else if (integrationType === "PHANTOMBUSTER") {
        configData = {
          agentIds: phantomAgentIds.split(",").map((id) => id.trim()).filter(Boolean),
        };
      } else if (integrationType === "SHIPPO") {
        configData = {
          hildaleAddress: shippoHildaleAddress,
          pricingMode: shippoPricingMode,
          ...(shippoPricingMode === "fixed" && { returnLabelMinFeeUsd: parseFloat(shippoReturnLabelMinFee) || 30 }),
        };
      }

      const payload: any = {
        provider: integrationType,
        accountName: integrationType === "SHOPIFY" ? shopDomain : integrationType === "AMAZON" ? sellerId : integrationType === "GOHIGHLEVEL" ? "GoHighLevel" : integrationType === "PHANTOMBUSTER" ? "PhantomBuster" : integrationType === "SHIPPO" ? "Shippo" : "Pivot Warehouse",
        config: configData,
      };

      // Include credentials based on integration type
      if (integrationType === "EXTENSIV") {
        if (apiKey) payload.apiKey = apiKey;
      } else if (integrationType === "SHOPIFY") {
        if (accessToken) payload.apiKey = accessToken;
      } else if (integrationType === "AMAZON") {
        if (refreshToken) payload.apiKey = refreshToken;
        else if (config?.apiKey) payload.apiKey = config.apiKey;
        if (clientSecret) {
          payload.config.clientSecret = clientSecret;
        }
      } else if (integrationType === "GOHIGHLEVEL") {
        if (ghlApiKey) payload.apiKey = ghlApiKey;
        else if (config?.apiKey) payload.apiKey = config.apiKey;
      } else if (integrationType === "PHANTOMBUSTER") {
        if (phantomApiKey) payload.apiKey = phantomApiKey;
        else if (config?.apiKey) payload.apiKey = config.apiKey;
      } else if (integrationType === "SHIPPO") {
        if (shippoApiKey) payload.apiKey = shippoApiKey;
        else if (config?.apiKey) payload.apiKey = config.apiKey;
      }

      if (config) {
        return await apiRequest("PATCH", `/api/integration-configs/${config.id}`, payload);
      } else {
        return await apiRequest("POST", "/api/integration-configs", payload);
      }
    },
    onSuccess: () => {
      toast({
        title: "Configuration Saved",
        description: `${INTEGRATION_LABELS[integrationType]} settings have been saved successfully`,
      });
      setIsConfigMode(false);
      clearFormFields();
      queryClient.invalidateQueries({ queryKey: [`/api/integration-configs/${integrationType}`] });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save configuration",
        variant: "destructive",
      });
    },
  });

  const clearFormFields = () => {
    setApiKey("");
    setAccessToken("");
    setRefreshToken("");
    setClientSecret("");
    setGhlApiKey("");
    setGhlWebhookSecret("");
    setPhantomApiKey("");
    setShippoApiKey("");
    setShowLegacyLocationNote(false);
  };

  const handleClose = () => {
    setIsConfigMode(false);
    clearFormFields();
    onClose();
  };

  const isFormValid = () => {
    if (integrationType === "EXTENSIV") {
      return config?.apiKey || apiKey;
    } else if (integrationType === "SHOPIFY") {
      return shopDomain && (config?.apiKey || accessToken);
    } else if (integrationType === "AMAZON") {
      return sellerId && marketplaceIds && clientId && (config?.apiKey || refreshToken);
    } else if (integrationType === "GOHIGHLEVEL") {
      return ghlLocationId && (config?.apiKey || ghlApiKey);
    } else if (integrationType === "PHANTOMBUSTER") {
      return config?.apiKey || phantomApiKey;
    } else if (integrationType === "SHIPPO") {
      return config?.apiKey || shippoApiKey;
    }
    return false;
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent data-testid={`dialog-${integrationType.toLowerCase()}-settings`}>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid={`dialog-${integrationType.toLowerCase()}-settings`}>
        <DialogHeader>
          <DialogTitle data-testid={`heading-${integrationType.toLowerCase()}-settings`}>
            {INTEGRATION_LABELS[integrationType]}
          </DialogTitle>
          <DialogDescription data-testid={`text-${integrationType.toLowerCase()}-description`}>
            {INTEGRATION_DESCRIPTIONS[integrationType]}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Amazon Mode Display */}
          {integrationType === "AMAZON" && config && config.apiKey && !isConfigMode && (
            <div className="space-y-3 p-4 rounded-lg bg-muted/50" data-testid="section-amazon-status">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Sync Mode</span>
                <Badge 
                  variant={amazonTwoWaySyncEnabled ? "default" : "secondary"}
                  data-testid="badge-amazon-mode"
                >
                  {amazonTwoWaySyncEnabled 
                    ? (config.config?.pushInventory ? "2-Way (Inventory Push Enabled)" : "2-Way (Push Off)")
                    : "1-Way (Inbound Only)"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Import Orders</span>
                <span className="text-sm">{config.config?.syncOrders !== false ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Inventory Push</span>
                <span className="text-sm">
                  {!amazonTwoWaySyncEnabled 
                    ? "Disabled (1-Way Mode)" 
                    : config.config?.pushInventory 
                      ? "Enabled" 
                      : "Disabled"}
                </span>
              </div>
              {config.config?.region && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Region</span>
                  <span className="text-sm font-mono">{config.config.region}</span>
                </div>
              )}
              {config.config?.sellerId && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Seller ID</span>
                  <span className="text-sm font-mono">{config.config.sellerId}</span>
                </div>
              )}
            </div>
          )}

          {/* Shopify Mode Display */}
          {integrationType === "SHOPIFY" && config && config.apiKey && !isConfigMode && (
            <div className="space-y-3 p-4 rounded-lg bg-muted/50" data-testid="section-shopify-status">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Sync Mode</span>
                <Badge 
                  variant={shopifyTwoWaySyncEnabled ? "default" : "secondary"}
                  data-testid="badge-shopify-mode"
                >
                  {shopifyTwoWaySyncEnabled 
                    ? (config.config?.pushInventory ? "2-Way (Inventory Push Enabled)" : "2-Way (Push Off)")
                    : "1-Way (Inbound Only)"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Import Orders</span>
                <span className="text-sm">{config.config?.syncOrders !== false ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Inventory Push</span>
                <span className="text-sm">
                  {!shopifyTwoWaySyncEnabled 
                    ? "Disabled (1-Way Mode)" 
                    : config.config?.pushInventory 
                      ? "Enabled" 
                      : "Disabled"}
                </span>
              </div>
              <div className="pt-2 border-t">
                <span className="text-sm font-medium">Inventory Locations</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Pivot (Pyvott - 3PL)</span>
                <span className="text-sm font-mono">
                  {config.config?.pivotLocationId || config.config?.locationId || "Not configured"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Hildale (Sticker Burr HQ)</span>
                <span className="text-sm font-mono">
                  {config.config?.hildaleLocationId || "Not configured"}
                </span>
              </div>
            </div>
          )}

          {/* Extensiv Mode Display */}
          {integrationType === "EXTENSIV" && config && config.apiKey && !isConfigMode && (
            <div className="space-y-3 p-4 rounded-lg bg-muted/50" data-testid="section-extensiv-status">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Sync Mode</span>
                <Badge 
                  variant={extensivTwoWaySyncEnabled ? "default" : "secondary"}
                  data-testid="badge-extensiv-mode"
                >
                  {extensivTwoWaySyncEnabled 
                    ? (config.config?.pushOrders ? "2-Way (Orders Enabled)" : "2-Way (Push Off)")
                    : "1-Way (Inbound Only)"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Inventory Sync</span>
                <span className="text-sm">Enabled (always)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Push Orders</span>
                <span className="text-sm">
                  {!extensivTwoWaySyncEnabled 
                    ? "Disabled (1-Way Mode)" 
                    : config.config?.pushOrders 
                      ? "Enabled" 
                      : "Disabled"}
                </span>
              </div>
              {config.config?.pivotWarehouseId && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Warehouse ID</span>
                  <span className="text-sm font-mono">{config.config.pivotWarehouseId}</span>
                </div>
              )}
            </div>
          )}

          {config && config.lastSyncAt && !isConfigMode && (
            <div className="text-sm text-muted-foreground" data-testid="text-last-sync">
              Last sync: {format(new Date(config.lastSyncAt), "PPpp")}
            </div>
          )}

          {config && config.lastSyncMessage && !isConfigMode && (
            <Alert data-testid="alert-sync-message">
              <AlertDescription data-testid="text-sync-message">
                {config.lastSyncMessage}
              </AlertDescription>
            </Alert>
          )}

          {(!config || !config.apiKey) && !isConfigMode && (
            <Alert data-testid="alert-not-configured">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription data-testid="text-config-warning">
                {integrationType} is not configured. Click "Configure" to add your credentials.
              </AlertDescription>
            </Alert>
          )}

          {isConfigMode && (
            <div className="space-y-4">
              {integrationType === "EXTENSIV" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="api-key" data-testid="label-api-key">
                      Extensiv API Key
                    </Label>
                    <Input
                      id="api-key"
                      type="password"
                      placeholder="Enter your Extensiv API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      data-testid="input-api-key"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="extensiv-base-url" data-testid="label-base-url">
                      API Base URL
                    </Label>
                    <Input
                      id="extensiv-base-url"
                      placeholder="https://api.skubana.com/v1"
                      value={extensivBaseUrl}
                      onChange={(e) => setExtensivBaseUrl(e.target.value)}
                      data-testid="input-base-url"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="warehouse-id" data-testid="label-warehouse-id">
                      Pivot Warehouse ID
                    </Label>
                    <Input
                      id="warehouse-id"
                      placeholder="1"
                      value={pivotWarehouseId}
                      onChange={(e) => setPivotWarehouseId(e.target.value)}
                      data-testid="input-warehouse-id"
                    />
                    <p className="text-xs text-muted-foreground">
                      The Extensiv warehouse ID for your Pivot 3PL location.
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label 
                        htmlFor="extensiv-push-orders" 
                        className={!extensivTwoWaySyncEnabled ? "text-muted-foreground" : ""}
                        data-testid="label-push-orders"
                      >
                        Push Orders to Extensiv
                      </Label>
                      {!extensivTwoWaySyncEnabled && (
                        <p className="text-xs text-muted-foreground">
                          Enable "Extensiv Two-Way Sync" in AI Agent → Rules to unlock this option
                        </p>
                      )}
                    </div>
                    <Switch
                      id="extensiv-push-orders"
                      checked={extensivPushOrders}
                      onCheckedChange={setExtensivPushOrders}
                      disabled={!extensivTwoWaySyncEnabled}
                      data-testid="switch-push-orders"
                    />
                  </div>
                </>
              )}

              {integrationType === "SHOPIFY" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="shop-domain" data-testid="label-shop-domain">
                      Shop Domain
                    </Label>
                    <Input
                      id="shop-domain"
                      placeholder="your-store.myshopify.com"
                      value={shopDomain}
                      onChange={(e) => setShopDomain(e.target.value)}
                      data-testid="input-shop-domain"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="access-token" data-testid="label-access-token">
                      Access Token
                    </Label>
                    <Input
                      id="access-token"
                      type="password"
                      placeholder="Enter your Shopify access token"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      data-testid="input-access-token"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="api-version" data-testid="label-api-version">
                      API Version
                    </Label>
                    <Input
                      id="api-version"
                      placeholder="2024-01"
                      value={apiVersion}
                      onChange={(e) => setApiVersion(e.target.value)}
                      data-testid="input-api-version"
                    />
                  </div>
                  
                  {/* Real-time Webhooks Section - Prominent placement after API Version */}
                  {config?.apiKey && (
                    <div className="space-y-3 pt-3 border-t">
                      {/* Alert for webhooks not configured */}
                      {allWebhooks.length === 0 && !webhooksLoading && (
                        <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950" data-testid="alert-webhooks-needed">
                          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          <AlertDescription className="text-amber-800 dark:text-amber-200">
                            <strong>Connect Shopify Webhooks</strong> to receive instant notifications for orders, inventory, products, and more. 
                            Without webhooks, data will only sync when you manually trigger a sync.
                          </AlertDescription>
                        </Alert>
                      )}
                      
                      <div className="flex items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <Label className="flex items-center gap-1.5">
                            <Webhook className="h-4 w-4" />
                            Real-time Webhooks
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p>These webhooks are hidden in your Shopify UI because they were created through the API. Manual webhooks appear in Settings → Notifications → Webhooks, but API webhooks do not.</p>
                              </TooltipContent>
                            </Tooltip>
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Receive instant notifications for orders, products, inventory, and more
                          </p>
                        </div>
                        {allWebhooks.length > 0 ? (
                          <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:text-green-400 dark:border-green-800 dark:bg-green-950" data-testid="badge-webhooks-active">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {allWebhooks.length} Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground" data-testid="badge-webhooks-inactive">
                            Not Configured
                          </Badge>
                        )}
                      </div>
                      
                      {webhooksLoading ? (
                        <div className="flex items-center justify-center py-2">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : allWebhooks.length > 0 ? (
                        <Collapsible>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="w-full justify-between" data-testid="button-toggle-webhooks">
                              <span className="text-xs text-muted-foreground">
                                {webhooksByCategory.orders.length} orders, {webhooksByCategory.carts.length} carts, {webhooksByCategory.products.length} products, {webhooksByCategory.inventory.length} inventory, {webhooksByCategory.fulfillments.length} fulfillments, {webhooksByCategory.refunds.length} refunds
                              </span>
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="space-y-2 pt-2">
                            {allWebhooks.map(webhook => (
                              <div key={webhook.id} className="p-2 rounded bg-muted/50 space-y-1.5" data-testid={`webhook-row-${webhook.id}`}>
                                <div className="flex items-center justify-between">
                                  <span className="font-mono text-sm font-medium">{webhook.topic}</span>
                                  <div className="flex items-center gap-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          onClick={() => testWebhookMutation.mutate(webhook.id)}
                                          disabled={testWebhookMutation.isPending && testingWebhookId === webhook.id}
                                          data-testid={`button-test-webhook-${webhook.id}`}
                                        >
                                          {testWebhookMutation.isPending && testingWebhookId === webhook.id ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                          ) : (
                                            <Play className="h-3 w-3 text-green-600" />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Test Connection</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          onClick={() => deleteWebhookMutation.mutate(webhook.id)}
                                          disabled={deleteWebhookMutation.isPending}
                                          data-testid={`button-delete-webhook-${webhook.id}`}
                                        >
                                          <Trash2 className="h-3 w-3 text-destructive" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Remove Webhook</TooltipContent>
                                    </Tooltip>
                                  </div>
                                </div>
                                <div className="text-xs text-muted-foreground space-y-0.5">
                                  <div className="flex items-center gap-1">
                                    <span className="text-muted-foreground/70">ID:</span>
                                    <span className="font-mono">{webhook.id}</span>
                                  </div>
                                  <div className="flex items-start gap-1">
                                    <span className="text-muted-foreground/70 shrink-0">Callback:</span>
                                    <span className="font-mono break-all">{webhook.address}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </CollapsibleContent>
                        </Collapsible>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => registerWebhooksMutation.mutate()}
                          disabled={registerWebhooksMutation.isPending}
                          className="w-full"
                          data-testid="button-register-webhooks"
                        >
                          {registerWebhooksMutation.isPending ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                              Registering...
                            </>
                          ) : (
                            <>
                              <Webhook className="h-3 w-3 mr-1.5" />
                              Register All Webhooks
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  )}
                  
                  {/* Inventory Locations Section */}
                  <div className="space-y-4 pt-2 border-t">
                    <div>
                      <Label className="text-sm font-medium">Inventory Locations</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Configure Shopify location IDs for multi-warehouse inventory sync.
                        Find these in Shopify Admin → Settings → Locations → select a location → copy the numeric ID from the URL.
                      </p>
                    </div>
                    
                    {showLegacyLocationNote && (
                      <Alert data-testid="alert-legacy-location">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          We detected a legacy inventory location. It has been mapped to Pivot. You can add a separate Hildale location ID if needed.
                        </AlertDescription>
                      </Alert>
                    )}
                    
                    <div className="space-y-2">
                      <Label htmlFor="shopify-pivot-location-id" data-testid="label-shopify-pivot-location-id">
                        Pivot Location ID (Pyvott – 3PL)
                      </Label>
                      <Input
                        id="shopify-pivot-location-id"
                        placeholder="Enter Pivot location ID (e.g., 12345678901)"
                        value={shopifyPivotLocationId}
                        onChange={(e) => setShopifyPivotLocationId(e.target.value)}
                        data-testid="input-shopify-pivot-location-id"
                      />
                      <p className="text-xs text-muted-foreground">
                        Customer orders ship from this 3PL location. Maps to Pivot Qty in BOM.
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="shopify-hildale-location-id" data-testid="label-shopify-hildale-location-id">
                        Hildale Location ID (Sticker Burr HQ)
                      </Label>
                      <Input
                        id="shopify-hildale-location-id"
                        placeholder="Enter Hildale location ID (optional)"
                        value={shopifyHildaleLocationId}
                        onChange={(e) => setShopifyHildaleLocationId(e.target.value)}
                        data-testid="input-shopify-hildale-location-id"
                      />
                      <p className="text-xs text-muted-foreground">
                        Internal production warehouse. Maps to Hildale Qty in BOM. Only changes via PO receipts and transfers.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="sync-orders" data-testid="label-sync-orders">
                      Import Orders from Shopify
                    </Label>
                    <Switch
                      id="sync-orders"
                      checked={syncOrders}
                      onCheckedChange={setSyncOrders}
                      data-testid="switch-sync-orders"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label 
                        htmlFor="push-inventory" 
                        className={!shopifyTwoWaySyncEnabled ? "text-muted-foreground" : ""}
                        data-testid="label-push-inventory"
                      >
                        Push Inventory to Shopify
                      </Label>
                      {!shopifyTwoWaySyncEnabled && (
                        <p className="text-xs text-muted-foreground">
                          Enable "Shopify Two-Way Sync" in AI Agent → Rules to unlock this option
                        </p>
                      )}
                    </div>
                    <Switch
                      id="push-inventory"
                      checked={pushInventory}
                      onCheckedChange={setPushInventory}
                      disabled={!shopifyTwoWaySyncEnabled}
                      data-testid="switch-push-inventory"
                    />
                  </div>
                </>
              )}

              {integrationType === "AMAZON" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="seller-id" data-testid="label-seller-id">
                      Seller ID
                    </Label>
                    <Input
                      id="seller-id"
                      placeholder="Enter your Amazon Seller ID"
                      value={sellerId}
                      onChange={(e) => setSellerId(e.target.value)}
                      data-testid="input-seller-id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="marketplace-ids" data-testid="label-marketplace-ids">
                      Primary Marketplace ID
                    </Label>
                    <Input
                      id="marketplace-ids"
                      placeholder="ATVPDKIKX0DER (US)"
                      value={marketplaceIds}
                      onChange={(e) => setMarketplaceIds(e.target.value)}
                      data-testid="input-marketplace-ids"
                    />
                    <p className="text-xs text-muted-foreground">
                      Common: ATVPDKIKX0DER (US), A2EUQ1WTGCTBG2 (CA), A1F83G8C2ARO7P (UK)
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="region" data-testid="label-region">
                      Region
                    </Label>
                    <select
                      id="region"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      data-testid="select-region"
                    >
                      <option value="NA">North America (NA)</option>
                      <option value="EU">Europe (EU)</option>
                      <option value="FE">Far East (FE)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-id" data-testid="label-client-id">
                      SP-API LWA Client ID
                    </Label>
                    <Input
                      id="client-id"
                      placeholder="amzn1.application-oa2-client.xxx"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      data-testid="input-client-id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-secret" data-testid="label-client-secret">
                      SP-API LWA Client Secret
                    </Label>
                    <Input
                      id="client-secret"
                      type="password"
                      placeholder="Enter your LWA client secret"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      data-testid="input-client-secret"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="refresh-token" data-testid="label-refresh-token">
                      Refresh Token
                    </Label>
                    <Input
                      id="refresh-token"
                      type="password"
                      placeholder="Enter your Amazon refresh token"
                      value={refreshToken}
                      onChange={(e) => setRefreshToken(e.target.value)}
                      data-testid="input-refresh-token"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="amazon-sync-orders" data-testid="label-amazon-sync-orders">
                      Import Orders from Amazon
                    </Label>
                    <Switch
                      id="amazon-sync-orders"
                      checked={amazonSyncOrders}
                      onCheckedChange={setAmazonSyncOrders}
                      data-testid="switch-amazon-sync-orders"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label 
                        htmlFor="amazon-push-inventory" 
                        className={!amazonTwoWaySyncEnabled ? "text-muted-foreground" : ""}
                        data-testid="label-amazon-push-inventory"
                      >
                        Push Inventory to Amazon
                      </Label>
                      {!amazonTwoWaySyncEnabled && (
                        <p className="text-xs text-muted-foreground">
                          Enable "Amazon Two-Way Sync" in AI Agent &rarr; Rules to unlock this option
                        </p>
                      )}
                    </div>
                    <Switch
                      id="amazon-push-inventory"
                      checked={amazonPushInventory}
                      onCheckedChange={setAmazonPushInventory}
                      disabled={!amazonTwoWaySyncEnabled}
                      data-testid="switch-amazon-push-inventory"
                    />
                  </div>
                </>
              )}

              {integrationType === "GOHIGHLEVEL" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="ghl-api-key" data-testid="label-ghl-api-key">
                      API Key {config?.apiKey && <span className="text-muted-foreground font-normal">(Connected)</span>}
                    </Label>
                    <Input
                      id="ghl-api-key"
                      type="password"
                      placeholder={config?.apiKey ? maskApiKey(config.apiKey) : "Enter your GoHighLevel API key"}
                      value={ghlApiKey}
                      onChange={(e) => setGhlApiKey(e.target.value)}
                      data-testid="input-ghl-api-key"
                    />
                    <p className="text-xs text-muted-foreground">
                      {config?.apiKey 
                        ? "Leave blank to keep existing key, or enter a new key to replace it"
                        : "Get your API key from GoHighLevel Settings → API Keys"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ghl-location-id" data-testid="label-ghl-location-id">
                      Location ID
                    </Label>
                    <Input
                      id="ghl-location-id"
                      placeholder="Enter your GoHighLevel Location ID"
                      value={ghlLocationId}
                      onChange={(e) => setGhlLocationId(e.target.value)}
                      data-testid="input-ghl-location-id"
                    />
                    <p className="text-xs text-muted-foreground">
                      Find your Location ID in Settings → Business Profile → Location ID
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ghl-webhook-secret" data-testid="label-ghl-webhook-secret">
                      AI Agent Webhook Secret (Optional)
                    </Label>
                    <Input
                      id="ghl-webhook-secret"
                      type="password"
                      placeholder="Enter a secret for AI Agent custom actions"
                      value={ghlWebhookSecret}
                      onChange={(e) => setGhlWebhookSecret(e.target.value)}
                      data-testid="input-ghl-webhook-secret"
                    />
                    <p className="text-xs text-muted-foreground">
                      Used to authenticate AI Agent custom actions (e.g., return labels). Use this same secret as the X-GHL-Secret header in your GHL Custom Actions.
                    </p>
                  </div>
                </>
              )}

              {integrationType === "PHANTOMBUSTER" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="phantom-api-key" data-testid="label-phantom-api-key">
                      API Key
                    </Label>
                    <Input
                      id="phantom-api-key"
                      type="password"
                      placeholder="Enter your PhantomBuster API key"
                      value={phantomApiKey}
                      onChange={(e) => setPhantomApiKey(e.target.value)}
                      data-testid="input-phantom-api-key"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phantom-agent-ids" data-testid="label-phantom-agent-ids">
                      Phantom Agent IDs (comma-separated, optional)
                    </Label>
                    <Input
                      id="phantom-agent-ids"
                      placeholder="agent123, agent456"
                      value={phantomAgentIds}
                      onChange={(e) => setPhantomAgentIds(e.target.value)}
                      data-testid="input-phantom-agent-ids"
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional: Specify default phantom agent IDs to use for enrichment
                    </p>
                  </div>
                </>
              )}

              {integrationType === "SHIPPO" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="shippo-api-key" data-testid="label-shippo-api-key">
                      API Key
                    </Label>
                    <div className="relative">
                      <Input
                        id="shippo-api-key"
                        type={showShippoApiKey ? "text" : "password"}
                        placeholder="Enter your Shippo API key"
                        value={shippoApiKey}
                        onChange={(e) => setShippoApiKey(e.target.value)}
                        className="pr-10"
                        data-testid="input-shippo-api-key"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowShippoApiKey(!showShippoApiKey)}
                        data-testid="button-toggle-shippo-api-key"
                      >
                        {showShippoApiKey ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Get your API key from Shippo Dashboard → API → API Tokens
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label data-testid="label-shippo-pricing-mode">
                      Label Pricing Mode
                    </Label>
                    <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/30">
                      <span className={`text-sm ${shippoPricingMode === "actual" ? "font-medium" : "text-muted-foreground"}`}>
                        Actual Cost
                      </span>
                      <Switch
                        checked={shippoPricingMode === "fixed"}
                        onCheckedChange={(checked) => setShippoPricingMode(checked ? "fixed" : "actual")}
                        data-testid="switch-shippo-pricing-mode"
                      />
                      <span className={`text-sm ${shippoPricingMode === "fixed" ? "font-medium" : "text-muted-foreground"}`}>
                        Fixed Price
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {shippoPricingMode === "actual" 
                        ? "Use the actual Shippo label cost for return label fees" 
                        : "Always charge the fixed price below for return labels"}
                    </p>
                  </div>
                  {shippoPricingMode === "fixed" && (
                    <div className="space-y-2">
                      <Label htmlFor="shippo-min-fee" data-testid="label-shippo-min-fee">
                        Fixed Return Label Fee (USD)
                      </Label>
                      <Input
                        id="shippo-min-fee"
                        type="number"
                        placeholder="30"
                        value={shippoReturnLabelMinFee}
                        onChange={(e) => setShippoReturnLabelMinFee(e.target.value)}
                        data-testid="input-shippo-min-fee"
                      />
                      <p className="text-xs text-muted-foreground">
                        Fixed fee to charge customers for return labels, regardless of actual cost.
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="shippo-hildale-address" data-testid="label-shippo-hildale-address">
                      Hildale Warehouse Address
                    </Label>
                    <Input
                      id="shippo-hildale-address"
                      placeholder="123 Main St, Hildale, UT 84784"
                      value={shippoHildaleAddress}
                      onChange={(e) => setShippoHildaleAddress(e.target.value)}
                      data-testid="input-shippo-hildale-address"
                    />
                    <p className="text-xs text-muted-foreground">
                      Destination address for return shipments. Used when creating return labels.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {!isConfigMode ? (
            <>
              <Button
                variant="outline"
                onClick={() => setIsConfigMode(true)}
                data-testid="button-configure"
              >
                <Settings2 className="h-4 w-4 mr-2" />
                {config && config.apiKey ? "Update Settings" : "Configure"}
              </Button>
              <Button
                variant="outline"
                onClick={() => testConnectionMutation.mutate()}
                disabled={!isFormValid() || testConnectionMutation.isPending}
                data-testid="button-test-connection"
              >
                {testConnectionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Test Connection
              </Button>
              <Button
                onClick={() => {
                  if ((integrationType === "SHOPIFY" || integrationType === "AMAZON" || integrationType === "EXTENSIV") && onOpenSkuWizard) {
                    onClose();
                    const sourceMap: Record<string, "shopify" | "amazon" | "extensiv"> = {
                      SHOPIFY: "shopify",
                      AMAZON: "amazon",
                      EXTENSIV: "extensiv",
                    };
                    onOpenSkuWizard(sourceMap[integrationType]);
                  } else {
                    syncMutation.mutate();
                  }
                }}
                disabled={!isFormValid() || syncMutation.isPending}
                data-testid="button-sync-now"
              >
                {syncMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Sync Now
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setIsConfigMode(false);
                  clearFormFields();
                }}
                data-testid="button-cancel-config"
              >
                Cancel
              </Button>
              <Button
                onClick={() => saveConfigMutation.mutate()}
                disabled={saveConfigMutation.isPending}
                data-testid="button-save-config"
              >
                {saveConfigMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Save Configuration
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
