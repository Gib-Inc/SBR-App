import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, AlertCircle, RefreshCw, Settings2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

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

type IntegrationType = "EXTENSIV" | "SHOPIFY" | "AMAZON" | "GOHIGHLEVEL" | "PHANTOMBUSTER";

interface IntegrationSettingsProps {
  integrationType: IntegrationType;
  open: boolean;
  onClose: () => void;
  onOpenSkuWizard?: (source?: "shopify" | "amazon" | "extensiv" | "quickbooks") => void;
}

const INTEGRATION_LABELS = {
  EXTENSIV: "Extensiv (Pivot Warehouse)",
  SHOPIFY: "Shopify",
  AMAZON: "Amazon Seller Central",
  GOHIGHLEVEL: "GoHighLevel",
  PHANTOMBUSTER: "PhantomBuster",
};

const INTEGRATION_DESCRIPTIONS = {
  EXTENSIV: "Sync inventory from your Extensiv 3PL warehouse",
  SHOPIFY: "Connect your Shopify store to import orders and sync inventory",
  AMAZON: "Integrate with Amazon Seller Central for order management",
  GOHIGHLEVEL: "Connect your CRM for return notifications and task management",
  PHANTOMBUSTER: "Enrich supplier and product data through automated scraping",
};

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
  
  // PhantomBuster fields
  const [phantomApiKey, setPhantomApiKey] = useState("");
  const [phantomAgentIds, setPhantomAgentIds] = useState("");

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
      } else if (integrationType === "PHANTOMBUSTER") {
        setPhantomApiKey("");
        setPhantomAgentIds(config.config?.agentIds?.join(", ") || "");
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
        };
      } else if (integrationType === "PHANTOMBUSTER") {
        configData = {
          agentIds: phantomAgentIds.split(",").map((id) => id.trim()).filter(Boolean),
        };
      }

      const payload: any = {
        provider: integrationType,
        accountName: integrationType === "SHOPIFY" ? shopDomain : integrationType === "AMAZON" ? sellerId : integrationType === "GOHIGHLEVEL" ? "GoHighLevel" : integrationType === "PHANTOMBUSTER" ? "PhantomBuster" : "Pivot Warehouse",
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
    setPhantomApiKey("");
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
                      API Key
                    </Label>
                    <Input
                      id="ghl-api-key"
                      type="password"
                      placeholder="Enter your GoHighLevel API key"
                      value={ghlApiKey}
                      onChange={(e) => setGhlApiKey(e.target.value)}
                      data-testid="input-ghl-api-key"
                    />
                    <p className="text-xs text-muted-foreground">
                      Get your API key from GoHighLevel Settings → API Keys
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
