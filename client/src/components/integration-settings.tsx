import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

type IntegrationType = "EXTENSIV" | "SHOPIFY" | "AMAZON";

interface IntegrationSettingsProps {
  integrationType: IntegrationType;
  open: boolean;
  onClose: () => void;
}

const INTEGRATION_LABELS = {
  EXTENSIV: "Extensiv (Pivot Warehouse)",
  SHOPIFY: "Shopify",
  AMAZON: "Amazon Seller Central",
};

const INTEGRATION_DESCRIPTIONS = {
  EXTENSIV: "Sync inventory from your Extensiv 3PL warehouse",
  SHOPIFY: "Connect your Shopify store to import orders and sync inventory",
  AMAZON: "Integrate with Amazon Seller Central for order management",
};

export function IntegrationSettings({ integrationType, open, onClose }: IntegrationSettingsProps) {
  const { toast } = useToast();
  const [isConfigMode, setIsConfigMode] = useState(false);

  // Form state for different integration types
  const [apiKey, setApiKey] = useState("");
  const [pivotWarehouseId, setPivotWarehouseId] = useState("1");
  
  // Shopify fields
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [apiVersion, setApiVersion] = useState("2024-01");
  const [syncOrders, setSyncOrders] = useState(true);
  
  // Amazon fields
  const [sellerId, setSellerId] = useState("");
  const [marketplaceIds, setMarketplaceIds] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [amazonSyncOrders, setAmazonSyncOrders] = useState(true);

  // Fetch integration config
  const { data: config, isLoading } = useQuery<IntegrationConfig | null>({
    queryKey: [`/api/integration-configs/${integrationType}`],
    enabled: open,
    retry: (failureCount, error: any) => {
      if (error?.message?.includes("404")) return false;
      return failureCount < 3;
    },
  });

  // Initialize form fields when config loads
  useEffect(() => {
    if (config && config.apiKey) {
      setApiKey("");
      if (integrationType === "EXTENSIV") {
        setPivotWarehouseId(config.config?.pivotWarehouseId || "1");
      } else if (integrationType === "SHOPIFY") {
        setShopDomain(config.config?.shopDomain || "");
        setAccessToken("");
        setApiVersion(config.config?.apiVersion || "2024-01");
        setSyncOrders(config.config?.syncOrders !== false);
      } else if (integrationType === "AMAZON") {
        setSellerId(config.config?.sellerId || "");
        setMarketplaceIds(config.config?.marketplaceIds?.join(", ") || "");
        setRefreshToken("");
        setClientId(config.config?.clientId || "");
        setClientSecret("");
        setAmazonSyncOrders(config.config?.syncOrders !== false);
      }
    }
  }, [config, integrationType]);

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const endpoint = integrationType.toLowerCase();
      return await apiRequest(`/api/integrations/${endpoint}/test`, {
        method: "POST",
      });
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
      return await apiRequest(`/api/integrations/${endpoint}/sync`, {
        method: "POST",
      });
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
        configData = { pivotWarehouseId };
      } else if (integrationType === "SHOPIFY") {
        configData = {
          shopDomain,
          apiVersion,
          syncOrders,
        };
      } else if (integrationType === "AMAZON") {
        configData = {
          sellerId,
          marketplaceIds: marketplaceIds.split(",").map((id) => id.trim()).filter(Boolean),
          clientId,
          syncOrders: amazonSyncOrders,
        };
      }

      const payload: any = {
        provider: integrationType,
        accountName: integrationType === "SHOPIFY" ? shopDomain : integrationType === "AMAZON" ? sellerId : "Pivot Warehouse",
        config: configData,
      };

      // Include credentials based on integration type
      if (integrationType === "EXTENSIV" && apiKey) {
        payload.apiKey = apiKey;
      } else if (integrationType === "SHOPIFY" && accessToken) {
        payload.apiKey = accessToken;
      } else if (integrationType === "AMAZON" && (refreshToken || clientSecret)) {
        payload.apiKey = refreshToken || config?.apiKey;
        if (clientSecret) {
          payload.config.clientSecret = clientSecret;
        }
      }

      if (config) {
        return await apiRequest(`/api/integration-configs/${config.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        return await apiRequest("/api/integration-configs", {
          method: "POST",
          body: JSON.stringify(payload),
        });
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
                  <div className="flex items-center justify-between">
                    <Label htmlFor="sync-orders" data-testid="label-sync-orders">
                      Sync Orders
                    </Label>
                    <Switch
                      id="sync-orders"
                      checked={syncOrders}
                      onCheckedChange={setSyncOrders}
                      data-testid="switch-sync-orders"
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
                      Marketplace IDs (comma-separated)
                    </Label>
                    <Input
                      id="marketplace-ids"
                      placeholder="ATVPDKIKX0DER, A2EUQ1WTGCTBG2"
                      value={marketplaceIds}
                      onChange={(e) => setMarketplaceIds(e.target.value)}
                      data-testid="input-marketplace-ids"
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
                  <div className="space-y-2">
                    <Label htmlFor="client-id" data-testid="label-client-id">
                      Client ID
                    </Label>
                    <Input
                      id="client-id"
                      placeholder="Enter your Amazon client ID"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      data-testid="input-client-id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-secret" data-testid="label-client-secret">
                      Client Secret
                    </Label>
                    <Input
                      id="client-secret"
                      type="password"
                      placeholder="Enter your Amazon client secret"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      data-testid="input-client-secret"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="amazon-sync-orders" data-testid="label-amazon-sync-orders">
                      Sync Orders
                    </Label>
                    <Switch
                      id="amazon-sync-orders"
                      checked={amazonSyncOrders}
                      onCheckedChange={setAmazonSyncOrders}
                      data-testid="switch-amazon-sync-orders"
                    />
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
                onClick={() => syncMutation.mutate()}
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
