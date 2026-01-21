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
import { User, Zap, CheckCircle2, XCircle, AlertCircle, Barcode, Loader2, Info, Bot, Copy, ExternalLink, Key } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function Settings() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage account and LLM configuration</p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="account" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="account" data-testid="tab-account">
            <User className="mr-2 h-4 w-4" />
            Account
          </TabsTrigger>
          <TabsTrigger value="llm" data-testid="tab-llm">
            <Zap className="mr-2 h-4 w-4" />
            LLM Configuration
          </TabsTrigger>
          <TabsTrigger value="barcode" data-testid="tab-barcode">
            <Barcode className="mr-2 h-4 w-4" />
            Barcode Settings
          </TabsTrigger>
          <TabsTrigger value="ghl-api" data-testid="tab-ghl-api">
            <Bot className="mr-2 h-4 w-4" />
            GHL Agent API
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="space-y-4">
          <AccountSettings />
        </TabsContent>

        <TabsContent value="llm" className="space-y-4">
          <LLMSettings />
        </TabsContent>

        <TabsContent value="barcode" className="space-y-4">
          <BarcodeSettingsTab />
        </TabsContent>

        <TabsContent value="ghl-api" className="space-y-4">
          <GhlAgentApiSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccountSettings() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Fetch current user info
  const { data: user } = useQuery<{ id: string; email: string }>({
    queryKey: ["/api/auth/me"],
  });

  // Set email from current user when loaded
  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
  }, [user]);

  const updateAccountMutation = useMutation({
    mutationFn: async (data: { email?: string; currentPassword: string; newPassword?: string }) => {
      const res = await apiRequest("PATCH", "/api/users/me", data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update account");
      }
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({
        title: "Success",
        description: "Account updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update account",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    // Validate current password is provided
    if (!currentPassword) {
      toast({
        title: "Error",
        description: "Current password is required to save changes",
        variant: "destructive",
      });
      return;
    }

    // Validate new password matches confirm
    if (newPassword && newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match",
        variant: "destructive",
      });
      return;
    }

    // Validate minimum password length
    if (newPassword && newPassword.length < 8) {
      toast({
        title: "Error",
        description: "New password must be at least 8 characters",
        variant: "destructive",
      });
      return;
    }

    // Check if there's anything to update
    const hasEmailChange = email && email !== user?.email;
    const hasPasswordChange = !!newPassword;

    if (!hasEmailChange && !hasPasswordChange) {
      toast({
        title: "No changes",
        description: "No changes detected to save",
        variant: "destructive",
      });
      return;
    }

    // Build update payload
    const payload: { email?: string; currentPassword: string; newPassword?: string } = {
      currentPassword,
    };

    if (hasEmailChange) {
      payload.email = email;
    }

    if (hasPasswordChange) {
      payload.newPassword = newPassword;
    }

    updateAccountMutation.mutate(payload);
  };

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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Required to save changes"
                data-testid="input-current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep current"
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                data-testid="input-confirm-password"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button 
              onClick={handleSave}
              disabled={updateAccountMutation.isPending}
              data-testid="button-save-account"
            >
              {updateAccountMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LLMSettings() {
  const { toast } = useToast();
  const [llmProvider, setLlmProvider] = useState("chatgpt");
  const [llmModel, setLlmModel] = useState("gpt-5");
  const [llmTemperature, setLlmTemperature] = useState(0.7);
  const [llmMaxTokens, setLlmMaxTokens] = useState(2048);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [isEditingWebhookSecret, setIsEditingWebhookSecret] = useState(false);
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false);
  const [maskedWebhookSecret, setMaskedWebhookSecret] = useState("");

  // Model presets for each provider
  const modelPresets: Record<string, { value: string; label: string }[]> = {
    chatgpt: [
      { value: "gpt-5", label: "GPT-5 (Standard)" },
      { value: "gpt-5.1", label: "GPT-5.1 (Recommended)" },
      { value: "gpt-5.2", label: "GPT-5.2 (Latest)" },
      { value: "gpt-4o", label: "GPT-4o (Legacy)" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini (Budget)" },
    ],
    claude: [
      { value: "claude-3-opus", label: "Claude 3 Opus (Most capable)" },
      { value: "claude-3-sonnet", label: "Claude 3 Sonnet (Balanced)" },
      { value: "claude-3-haiku", label: "Claude 3 Haiku (Fastest)" },
      { value: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet (Latest)" },
    ],
    grok: [
      { value: "grok-1", label: "Grok-1" },
      { value: "grok-2", label: "Grok-2" },
    ],
  };

  // Load existing LLM settings
  const { data: settings } = useQuery<any>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    if (settings) {
      // Coerce legacy "custom" provider to "chatgpt" since custom endpoint is removed
      const provider = settings.llmProvider === 'custom' ? 'chatgpt' : (settings.llmProvider || 'chatgpt');
      setLlmProvider(provider);
      
      // API key comes from env secret, just display masked value
      setHasApiKey(!!settings.hasApiKey);
      setMaskedApiKey(settings.apiKeyMasked || '');
      
      // Webhook secret from database
      setHasWebhookSecret(!!settings.hasWebhookSigningSecret);
      setMaskedWebhookSecret(settings.webhookSigningSecretMasked || '');
      setWebhookSecret('');
      setIsEditingWebhookSecret(false);
      
      setLlmModel(settings.llmModel || 'gpt-5');
      setLlmTemperature(settings.llmTemperature ?? 0.7);
      setLlmMaxTokens(settings.llmMaxTokens ?? 2048);
    }
  }, [settings]);

  // Update model when provider changes
  useEffect(() => {
    const presets = modelPresets[llmProvider];
    if (presets && presets.length > 0) {
      const currentModelValid = presets.some(p => p.value === llmModel);
      if (!currentModelValid) {
        setLlmModel(presets[0].value);
      }
    }
  }, [llmProvider]);

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
      llmModel,
      llmTemperature,
      llmMaxTokens,
    };
    // Only include webhook secret if user entered a new value
    if (webhookSecret.trim()) {
      updates.openaiWebhookSecret = webhookSecret.trim();
    }
    await saveSettingMutation.mutateAsync(updates);
    // Clear webhook input after save - re-fetch will update masked value
    setWebhookSecret('');
    setIsEditingWebhookSecret(false);
  };

  const testConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest("POST", "/api/llm/health-check", {});
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({ success: true, message: `Connection successful! Provider: ${data.provider}` });
        toast({
          title: "Connection Successful",
          description: `LLM provider is responding correctly (${data.provider})`,
        });
      } else {
        throw new Error(data.error || "Connection test failed");
      }
    } catch (error: any) {
      setTestResult({ success: false, message: error.message || "Connection failed" });
      toast({
        title: "Connection Failed",
        description: error.message || "Could not connect to LLM provider",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Active Provider Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active LLM Provider</CardTitle>
          <CardDescription>
            Configure the primary AI provider for all LLM-powered features
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="llm-provider">Provider</Label>
              <Select value={llmProvider} onValueChange={setLlmProvider}>
                <SelectTrigger id="llm-provider" data-testid="select-llm-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chatgpt">ChatGPT (OpenAI)</SelectItem>
                  <SelectItem value="claude">
                    <span className="flex items-center gap-2">
                      Claude (Anthropic)
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">V2</Badge>
                    </span>
                  </SelectItem>
                  <SelectItem value="grok">
                    <span className="flex items-center gap-2">
                      Grok
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">V2</Badge>
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="llm-model">Default Model</Label>
              <Select value={llmModel} onValueChange={setLlmModel}>
                <SelectTrigger id="llm-model" data-testid="select-llm-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelPresets[llmProvider]?.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="llm-api-key">
              {llmProvider === "chatgpt" ? "OpenAI API Key" : 
               llmProvider === "claude" ? "Anthropic API Key" :
               llmProvider === "grok" ? "Grok API Key" : "API Key"}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="llm-api-key"
                type="text"
                readOnly
                value={hasApiKey ? maskedApiKey : "Not configured"}
                className={hasApiKey ? "" : "text-muted-foreground"}
                data-testid="input-llm-api-key"
              />
              {hasApiKey && (
                <Badge variant="outline" className="shrink-0">
                  <CheckCircle2 className="mr-1 h-3 w-3 text-green-500" />
                  Configured
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {hasApiKey 
                ? "API key is managed via Replit Secrets (OPENAI_API_KEY)" 
                : "Add OPENAI_API_KEY in Replit Secrets to configure"}
            </p>
          </div>

          {llmProvider === "chatgpt" && (
            <div className="space-y-2">
              <Label htmlFor="webhook-secret">OpenAI Webhook (signing secret)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="webhook-secret"
                  type={isEditingWebhookSecret ? "password" : "text"}
                  placeholder="Enter webhook signing secret"
                  value={isEditingWebhookSecret ? webhookSecret : (hasWebhookSecret ? maskedWebhookSecret : "")}
                  onFocus={() => setIsEditingWebhookSecret(true)}
                  onBlur={() => { if (!webhookSecret) setIsEditingWebhookSecret(false); }}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  data-testid="input-webhook-secret"
                />
                {hasWebhookSecret && !isEditingWebhookSecret && (
                  <Badge variant="outline" className="shrink-0">
                    <CheckCircle2 className="mr-1 h-3 w-3 text-green-500" />
                    Saved
                  </Badge>
                )}
              </div>
              {!hasWebhookSecret && (
                <p className="text-xs text-muted-foreground">
                  Signing secret from your OpenAI webhook configuration
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="llm-temperature">Temperature: {llmTemperature.toFixed(1)}</Label>
                <span className="text-xs text-muted-foreground">
                  {llmTemperature < 0.3 ? "Focused" : llmTemperature < 0.7 ? "Balanced" : "Creative"}
                </span>
              </div>
              <Slider
                id="llm-temperature"
                min={0}
                max={2}
                step={0.1}
                value={[llmTemperature]}
                onValueChange={([v]) => setLlmTemperature(v)}
                data-testid="slider-temperature"
              />
              <p className="text-xs text-muted-foreground">
                Lower = more deterministic, Higher = more creative
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="llm-max-tokens">Max Tokens</Label>
              <Input
                id="llm-max-tokens"
                type="number"
                min={256}
                max={8192}
                value={llmMaxTokens}
                onChange={(e) => setLlmMaxTokens(parseInt(e.target.value) || 2048)}
                data-testid="input-max-tokens"
              />
              <p className="text-xs text-muted-foreground">
                Maximum response length (256-8192)
              </p>
            </div>
          </div>

          {testResult && (
            <div className={`p-3 rounded-md ${testResult.success ? 'bg-green-500/10 border border-green-500/20' : 'bg-destructive/10 border border-destructive/20'}`}>
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className={`text-sm ${testResult.success ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                  {testResult.message}
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={isTesting || !hasApiKey}
              data-testid="button-test-llm"
            >
              {isTesting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </Button>
            <Button
              onClick={saveLLMProvider}
              disabled={saveSettingMutation.isPending}
              data-testid="button-save-llm-provider"
            >
              {saveSettingMutation.isPending ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info Banner */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="flex items-start gap-3 pt-6">
          <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">AI features moved</p>
            <p className="text-xs text-muted-foreground mt-1">
              LLM features, Vision Capture, and external integrations are now configured from the AI Agent page (Rules tab and Data Sources tab).
            </p>
          </div>
        </CardContent>
      </Card>
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

function GhlAgentApiSettings() {
  const { toast } = useToast();
  const [showApiKey, setShowApiKey] = useState(false);
  
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const apiBaseUrl = `${baseUrl}/api/ghl-agent`;
  
  const { data: apiKeyStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/settings/ghl-agent-api-key-status"],
  });
  
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: `${label} copied to clipboard`,
    });
  };
  
  const endpoints = [
    {
      method: "POST",
      path: "/inventory/reorder-status",
      description: "Get all products below their reorder threshold",
      request: "{}",
      response: '{ "items_need_ordering": [...], "total_items_low": 2 }'
    },
    {
      method: "POST",
      path: "/orders/lookup",
      description: "Find a specific order by order number",
      request: '{ "order_number": "12345" }',
      response: '{ "order": { "order_number", "customer_name", "items", ... } }'
    },
    {
      method: "POST",
      path: "/orders/search",
      description: "Search orders by customer name (partial match)",
      request: '{ "name": "Sarah" }',
      response: '{ "matches": [...], "total_matches": 2 }'
    },
    {
      method: "POST",
      path: "/refunds/calculate",
      description: "Calculate refund amount based on policy",
      request: '{ "order_number": "12345" }',
      response: '{ "refundable": true, "refund_amount": 327.49, ... }'
    },
    {
      method: "POST",
      path: "/refunds/process",
      description: "Process a confirmed refund",
      request: '{ "order_number": "12345", "confirmed": true }',
      response: '{ "refund_id": "REF-2025-001234", "refund_amount": 327.49 }'
    },
    {
      method: "POST",
      path: "/po/create",
      description: "Create a purchase order",
      request: '{ "supplier_name": "ABC Supplies", "auto_generate": true }',
      response: '{ "po_number": "PO-2025-0089", "po_total": 275.00 }'
    },
    {
      method: "POST",
      path: "/tasks/create",
      description: "Create a task in GoHighLevel",
      request: '{ "assigned_to": "John", "task_description": "Follow up", "priority": "high" }',
      response: '{ "task_id": "TASK-12345", "created_in_ghl": true }'
    }
  ];
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            GHL Agent API Configuration
          </CardTitle>
          <CardDescription>
            Connect your GoHighLevel AI Agent to this inventory system using these API endpoints.
            Your agent can read inventory data, look up orders, process refunds, and create purchase orders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>API Base URL</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={apiBaseUrl}
                  readOnly
                  className="font-mono text-sm"
                  data-testid="input-api-base-url"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(apiBaseUrl, "API Base URL")}
                  data-testid="button-copy-base-url"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this as the base URL when configuring your GHL Agent's custom actions
              </p>
            </div>
            
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                API Key Status
              </Label>
              <div className="flex items-center gap-2">
                {apiKeyStatus?.configured ? (
                  <Badge variant="default" className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Configured
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    Not Configured
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Set the <code className="bg-muted px-1 rounded">GHL_AGENT_API_KEY</code> secret in your environment to enable API access.
                Use this same key as the Bearer token in your GHL Agent configuration.
              </p>
            </div>
            
            <div className="rounded-lg border p-4 bg-muted/30">
              <h4 className="font-medium mb-2">Authentication Header</h4>
              <code className="text-sm bg-background px-2 py-1 rounded block">
                Authorization: Bearer YOUR_API_KEY
              </code>
              <p className="text-xs text-muted-foreground mt-2">
                Include this header in all API requests from your GHL Agent
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Available Endpoints</CardTitle>
          <CardDescription>
            Reference for all API endpoints your GHL Agent can use
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {endpoints.map((endpoint, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono">
                    {endpoint.method}
                  </Badge>
                  <code className="text-sm font-mono">{endpoint.path}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(`${apiBaseUrl}${endpoint.path}`, "Endpoint URL")}
                    data-testid={`button-copy-endpoint-${index}`}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">{endpoint.description}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="font-medium">Request:</span>
                    <code className="block bg-muted p-1 rounded mt-1 overflow-x-auto">
                      {endpoint.request}
                    </code>
                  </div>
                  <div>
                    <span className="font-medium">Response:</span>
                    <code className="block bg-muted p-1 rounded mt-1 overflow-x-auto">
                      {endpoint.response}
                    </code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Error Handling</CardTitle>
          <CardDescription>
            All endpoints return consistent error responses
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <code className="block bg-muted p-3 rounded text-sm overflow-x-auto">
{`{
  "status": "error",
  "message": "Detailed error message",
  "error_code": "INVALID_ORDER"
}`}
            </code>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <Badge variant="outline">401 - UNAUTHORIZED</Badge>
              <Badge variant="outline">403 - FORBIDDEN</Badge>
              <Badge variant="outline">404 - NOT_FOUND</Badge>
              <Badge variant="outline">500 - INTERNAL_ERROR</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
