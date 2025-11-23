import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { User, Key, Zap, CheckCircle2, XCircle, AlertCircle, Barcode } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function Settings() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage account, integrations, and LLM configuration</p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="account" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="account" data-testid="tab-account">
            <User className="mr-2 h-4 w-4" />
            Account
          </TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations">
            <Key className="mr-2 h-4 w-4" />
            Integrations
          </TabsTrigger>
          <TabsTrigger value="llm" data-testid="tab-llm">
            <Zap className="mr-2 h-4 w-4" />
            LLM Configuration
          </TabsTrigger>
          <TabsTrigger value="barcode" data-testid="tab-barcode">
            <Barcode className="mr-2 h-4 w-4" />
            Barcode Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="space-y-4">
          <AccountSettings />
        </TabsContent>

        <TabsContent value="integrations" className="space-y-4">
          <IntegrationSettings />
        </TabsContent>

        <TabsContent value="llm" className="space-y-4">
          <LLMSettings />
        </TabsContent>

        <TabsContent value="barcode" className="space-y-4">
          <BarcodeSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccountSettings() {
  const { toast } = useToast();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account Information</CardTitle>
          <CardDescription>Update your account details and password</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                data-testid="input-current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                data-testid="input-confirm-password"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button data-testid="button-save-account">Save Changes</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function IntegrationSettings() {
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    gohighlevel: '',
    shopify: '',
    extensiv: '',
    phantombuster: '',
  });
  const { toast } = useToast();

  // Load existing settings
  const { data: settings } = useQuery<any>({
    queryKey: ["/api/settings"],
  });

  // Load integration health status
  const { data: integrationHealth } = useQuery<any[]>({
    queryKey: ["/api/integrations/health"],
  });

  useEffect(() => {
    if (settings) {
      setApiKeys({
        gohighlevel: settings.gohighlevelApiKey || '',
        shopify: settings.shopifyApiKey || '',
        extensiv: settings.extensivApiKey || '',
        phantombuster: settings.phantombusterApiKey || '',
      });
    }
  }, [settings]);

  const healthData = integrationHealth || [];
  
  // Helper to check if API key is configured
  const hasValidApiKey = (apiKeyField: string): boolean => {
    if (!settings) return false;
    const apiKey = settings[apiKeyField];
    return !!(apiKey && apiKey.trim());
  };
  
  const integrations = [
    {
      id: "gohighlevel",
      name: "GoHighLevel",
      description: "Sync sales history and trigger SMS alerts",
      status: hasValidApiKey("gohighlevelApiKey") 
        ? (healthData.find((h: any) => h.integrationName === "gohighlevel")?.lastStatus || "pending_setup")
        : "pending_setup",
      apiKeyField: "gohighlevelApiKey",
    },
    {
      id: "shopify",
      name: "Shopify",
      description: "E-commerce platform integration",
      status: hasValidApiKey("shopifyApiKey")
        ? (healthData.find((h: any) => h.integrationName === "shopify")?.lastStatus || "pending_setup")
        : "pending_setup",
      apiKeyField: "shopifyApiKey",
    },
    {
      id: "extensiv",
      name: "Extensiv/Pivot",
      description: "Finished goods inventory snapshot",
      status: hasValidApiKey("extensivApiKey")
        ? (healthData.find((h: any) => h.integrationName === "extensiv")?.lastStatus || "pending_setup")
        : "pending_setup",
      apiKeyField: "extensivApiKey",
    },
    {
      id: "phantombuster",
      name: "PhantomBuster",
      description: "Supplier availability and lead times",
      status: hasValidApiKey("phantombusterApiKey")
        ? (healthData.find((h: any) => h.integrationName === "phantombuster")?.lastStatus || "pending_setup")
        : "pending_setup",
      apiKeyField: "phantombusterApiKey",
    },
  ];

  const saveApiKeyMutation = useMutation({
    mutationFn: async ({ integrationId, apiKey, apiKeyField }: { integrationId: string; apiKey: string; apiKeyField: string }) => {
      const res = await apiRequest("PATCH", "/api/settings", {
        [apiKeyField]: apiKey,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to save API key");
      }
      return await res.json();
    },
    onSuccess: async (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/health"] });
      
      const integrationName = integrations.find(i => i.id === variables.integrationId)?.name;
      toast({
        title: "API Key Saved",
        description: `${integrationName} API key saved. Testing connection...`,
      });
      
      // Automatically test the connection if API key is not empty
      if (variables.apiKey && variables.apiKey.trim()) {
        setTestingConnection(variables.integrationId);
        try {
          const res = await apiRequest("POST", `/api/integrations/${variables.integrationId}/sync`, {});
          if (!res.ok) {
            throw new Error("Connection test failed");
          }
          await res.json();
          queryClient.invalidateQueries({ queryKey: ["/api/integrations/health"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
          toast({
            title: "Connection Verified",
            description: `${integrationName} is connected and working`,
          });
        } catch (error: any) {
          toast({
            title: "Connection Failed",
            description: `${integrationName} API key saved but connection test failed. Please verify your API key.`,
            variant: "destructive",
          });
        } finally {
          setTestingConnection(null);
        }
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save API key",
        variant: "destructive",
      });
    },
  });

  const testConnection = async (integrationId: string) => {
    setTestingConnection(integrationId);
    try {
      const res = await apiRequest("POST", `/api/integrations/${integrationId}/sync`, {});
      await res.json();
      toast({
        title: "Connection successful",
        description: "Integration is working properly",
      });
    } catch (error: any) {
      toast({
        title: "Connection failed",
        description: error.message || "Could not connect to integration",
        variant: "destructive",
      });
    } finally {
      setTestingConnection(null);
    }
  };

  return (
    <div className="space-y-4">
      {integrations.map((integration) => (
        <Card key={integration.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-lg">{integration.name}</CardTitle>
                <CardDescription>{integration.description}</CardDescription>
              </div>
              <Badge variant={
                !hasValidApiKey(integration.apiKeyField)
                  ? "outline"
                  : integration.status === "success" || integration.status === "connected"
                  ? "default"
                  : integration.status === "failed" || integration.status === "error"
                  ? "destructive"
                  : "secondary"
              }>
                {!hasValidApiKey(integration.apiKeyField) ? (
                  <>
                    <AlertCircle className="mr-1 h-3 w-3" />
                    Not Configured
                  </>
                ) : integration.status === "success" || integration.status === "connected" ? (
                  <>
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Connected
                  </>
                ) : integration.status === "failed" || integration.status === "error" ? (
                  <>
                    <XCircle className="mr-1 h-3 w-3" />
                    Failed
                  </>
                ) : (
                  <>
                    <AlertCircle className="mr-1 h-3 w-3" />
                    Pending Test
                  </>
                )}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${integration.id}-api-key`}>API Key</Label>
              <Input
                id={`${integration.id}-api-key`}
                type="password"
                placeholder="••••••••••••••••"
                value={apiKeys[integration.id] || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, [integration.id]: e.target.value })}
                data-testid={`input-api-key-${integration.id}`}
              />
              <p className="text-xs text-muted-foreground">
                Your API key will be encrypted and stored securely
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => testConnection(integration.id)}
                disabled={testingConnection === integration.id || !apiKeys[integration.id]}
                data-testid={`button-test-${integration.id}`}
              >
                {testingConnection === integration.id ? "Testing..." : "Test Connection"}
              </Button>
              <Button
                onClick={() => saveApiKeyMutation.mutate({ 
                  integrationId: integration.id, 
                  apiKey: apiKeys[integration.id] || '',
                  apiKeyField: integration.apiKeyField,
                })}
                disabled={saveApiKeyMutation.isPending || !apiKeys[integration.id]}
                data-testid={`button-save-${integration.id}`}
              >
                {saveApiKeyMutation.isPending ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LLMSettings() {
  const { toast } = useToast();
  const [llmProvider, setLlmProvider] = useState("chatgpt");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [enableOrderRecommendations, setEnableOrderRecommendations] = useState(false);
  const [enableSupplierRanking, setEnableSupplierRanking] = useState(false);
  const [enableForecasting, setEnableForecasting] = useState(false);
  const [enableVisionCapture, setEnableVisionCapture] = useState(false);
  const [visionProvider, setVisionProvider] = useState("gpt-4-vision");
  const [visionModel, setVisionModel] = useState("gpt-4o");

  // Load existing LLM settings
  const { data: settings } = useQuery<any>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    if (settings) {
      setLlmProvider(settings.llmProvider || 'chatgpt');
      setLlmApiKey(settings.llmApiKey || '');
      setCustomEndpoint(settings.llmCustomEndpoint || '');
      setEnableOrderRecommendations(settings.enableLlmOrderRecommendations || false);
      setEnableSupplierRanking(settings.enableLlmSupplierRanking || false);
      setEnableForecasting(settings.enableLlmForecasting || false);
      setEnableVisionCapture(settings.enableVisionCapture || false);
      setVisionProvider(settings.visionProvider || 'gpt-4-vision');
      setVisionModel(settings.visionModel || 'gpt-4o');
    }
  }, [settings]);

  const saveSettingMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PATCH", "/api/settings", data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to save settings");
      }
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Success",
        description: "Settings saved successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    },
  });

  const saveLLMProvider = async () => {
    const updates: Record<string, any> = {
      llmProvider,
      llmApiKey,
    };
    if (llmProvider === 'custom') {
      updates.llmCustomEndpoint = customEndpoint;
    }
    await saveSettingMutation.mutateAsync(updates);
  };

  const saveLLMFeatures = async () => {
    await saveSettingMutation.mutateAsync({
      enableLlmOrderRecommendations: enableOrderRecommendations,
      enableLlmSupplierRanking: enableSupplierRanking,
      enableLlmForecasting: enableForecasting,
    });
  };

  const saveVisionSettings = async () => {
    await saveSettingMutation.mutateAsync({
      enableVisionCapture,
      visionProvider,
      visionModel,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">LLM Provider Selection</CardTitle>
          <CardDescription>
            Choose an AI provider for inventory decisions and forecasting
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="llm-provider">Provider</Label>
            <Select value={llmProvider} onValueChange={setLlmProvider}>
              <SelectTrigger id="llm-provider" data-testid="select-llm-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chatgpt">ChatGPT (OpenAI)</SelectItem>
                <SelectItem value="claude">Claude (Anthropic)</SelectItem>
                <SelectItem value="grok">Grok</SelectItem>
                <SelectItem value="custom">Custom Endpoint</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {llmProvider === "custom" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="custom-endpoint">Custom Endpoint URL</Label>
                <Input
                  id="custom-endpoint"
                  type="url"
                  placeholder="https://api.example.com/v1"
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                  data-testid="input-custom-endpoint"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-api-key">API Key</Label>
                <Input
                  id="custom-api-key"
                  type="password"
                  placeholder="••••••••••••••••"
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  data-testid="input-custom-api-key"
                />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="llm-api-key">
                {llmProvider === "chatgpt" ? "OpenAI API Key" : 
                 llmProvider === "claude" ? "Anthropic API Key" :
                 llmProvider === "grok" ? "Grok API Key" : "API Key"}
              </Label>
              <Input
                id="llm-api-key"
                type="password"
                placeholder="••••••••••••••••"
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                data-testid="input-llm-api-key"
              />
              <p className="text-xs text-muted-foreground">
                Get your API key from the{" "}
                {llmProvider === "chatgpt" && "OpenAI dashboard"}
                {llmProvider === "claude" && "Anthropic console"}
                {llmProvider === "grok" && "Grok platform"}
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={saveLLMProvider}
              disabled={saveSettingMutation.isPending}
              data-testid="button-save-llm-provider"
            >
              {saveSettingMutation.isPending ? "Saving..." : "Save Provider"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">LLM Features</CardTitle>
          <CardDescription>
            Enable AI-powered features for inventory management
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enable-order-recommendations">Order Recommendations</Label>
              <p className="text-sm text-muted-foreground">
                AI suggests optimal reorder quantities and timing
              </p>
            </div>
            <Switch
              id="enable-order-recommendations"
              checked={enableOrderRecommendations}
              onCheckedChange={setEnableOrderRecommendations}
              data-testid="switch-order-recommendations"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enable-supplier-ranking">Supplier Ranking</Label>
              <p className="text-sm text-muted-foreground">
                AI ranks suppliers based on price, lead time, and reliability
              </p>
            </div>
            <Switch
              id="enable-supplier-ranking"
              checked={enableSupplierRanking}
              onCheckedChange={setEnableSupplierRanking}
              data-testid="switch-supplier-ranking"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enable-forecasting">Demand Forecasting</Label>
              <p className="text-sm text-muted-foreground">
                AI predicts future demand based on historical data
              </p>
            </div>
            <Switch
              id="enable-forecasting"
              checked={enableForecasting}
              onCheckedChange={setEnableForecasting}
              data-testid="switch-forecasting"
            />
          </div>

          <div className="flex justify-end">
            <Button
              onClick={saveLLMFeatures}
              disabled={saveSettingMutation.isPending}
              data-testid="button-save-llm-features"
            >
              {saveSettingMutation.isPending ? "Saving..." : "Save Features"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Vision Capture (Camera Scanner)</CardTitle>
          <CardDescription>
            Use device camera to identify and add inventory items with AI vision
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enable-vision-capture">Enable Vision Capture</Label>
              <p className="text-sm text-muted-foreground">
                Allow camera-based item scanning and AI identification
              </p>
            </div>
            <Switch
              id="enable-vision-capture"
              checked={enableVisionCapture}
              onCheckedChange={setEnableVisionCapture}
              data-testid="switch-vision-capture"
            />
          </div>

          {enableVisionCapture && (
            <>
              <div className="space-y-2">
                <Label htmlFor="vision-provider">Vision Provider</Label>
                <Select value={visionProvider} onValueChange={setVisionProvider}>
                  <SelectTrigger id="vision-provider" data-testid="select-vision-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-4-vision">GPT-4 Vision (OpenAI)</SelectItem>
                    <SelectItem value="claude-vision">Claude Vision (Anthropic)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {visionProvider === "gpt-4-vision"
                    ? "Uses your OpenAI API key configured above"
                    : "Uses your Anthropic API key configured above"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="vision-model">Vision Model</Label>
                <Select value={visionModel} onValueChange={setVisionModel}>
                  <SelectTrigger id="vision-model" data-testid="select-vision-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {visionProvider === "gpt-4-vision" ? (
                      <>
                        <SelectItem value="gpt-4o">GPT-4o (Recommended)</SelectItem>
                        <SelectItem value="gpt-4o-mini">GPT-4o Mini (Faster)</SelectItem>
                        <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="claude-3-opus">Claude 3 Opus</SelectItem>
                        <SelectItem value="claude-3-sonnet">Claude 3 Sonnet (Recommended)</SelectItem>
                        <SelectItem value="claude-3-haiku">Claude 3 Haiku (Faster)</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="flex justify-end">
            <Button
              onClick={saveVisionSettings}
              disabled={saveSettingMutation.isPending}
              data-testid="button-save-vision-settings"
            >
              {saveSettingMutation.isPending ? "Saving..." : "Save Vision Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {(enableOrderRecommendations || enableSupplierRanking || enableForecasting) && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <Zap className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">AI Features Enabled</p>
              <p className="text-xs text-muted-foreground">
                LLM will be used for {
                  [
                    enableOrderRecommendations && "order recommendations",
                    enableSupplierRanking && "supplier ranking",
                    enableForecasting && "demand forecasting"
                  ].filter(Boolean).join(", ")
                }
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BarcodeSettingsTab() {
  const { toast } = useToast();
  const [gs1Prefix, setGs1Prefix] = useState("");
  const [itemRefDigits, setItemRefDigits] = useState(6);

  // Fetch barcode settings
  const { data: barcodeSettings } = useQuery<any>({
    queryKey: ["/api/barcode-settings"],
  });

  // Update state when data loads
  useEffect(() => {
    if (barcodeSettings) {
      setGs1Prefix(barcodeSettings.gs1Prefix || "");
      setItemRefDigits(barcodeSettings.itemRefDigits || 6);
    }
  }, [barcodeSettings]);

  // Save barcode settings mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/barcode-settings", {
        gs1Prefix: gs1Prefix || null,
        itemRefDigits,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to save barcode settings");
      }
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/barcode-settings"] });
      toast({
        title: "Settings saved",
        description: "Barcode settings updated successfully",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save barcode settings",
      });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">GS1 Configuration</CardTitle>
          <CardDescription>
            Configure your GS1 company prefix and barcode generation settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="gs1-prefix">GS1 Company Prefix</Label>
              <Input
                id="gs1-prefix"
                value={gs1Prefix}
                onChange={(e) => setGs1Prefix(e.target.value)}
                placeholder="Leave blank until registered"
                data-testid="input-gs1-prefix"
              />
              <p className="text-sm text-muted-foreground">
                Your registered GS1 company prefix (optional)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-ref-digits">Item Reference Digits</Label>
              <Input
                id="item-ref-digits"
                type="number"
                value={itemRefDigits}
                onChange={(e) => setItemRefDigits(parseInt(e.target.value) || 6)}
                min="4"
                max="12"
                data-testid="input-item-ref-digits"
              />
              <p className="text-sm text-muted-foreground">
                Number of digits for item reference codes (4-12)
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button 
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="button-save-barcode-settings"
            >
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Barcode Counters</CardTitle>
          <CardDescription>
            Current barcode generation counters (read-only)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Next Item Reference</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={barcodeSettings?.nextItemRef || 1}
                  disabled
                  data-testid="text-next-item-ref"
                />
                <Badge variant="secondary">Read-only</Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Next Internal Code</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={barcodeSettings?.nextInternalCode || 1000}
                  disabled
                  data-testid="text-next-internal-code"
                />
                <Badge variant="secondary">Read-only</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
