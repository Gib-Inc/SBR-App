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
import { User, Zap, CheckCircle2, XCircle, AlertCircle, Barcode, Loader2, Info } from "lucide-react";
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

function LLMSettings() {
  const { toast } = useToast();
  const [llmProvider, setLlmProvider] = useState("chatgpt");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("gpt-4");
  const [llmTemperature, setLlmTemperature] = useState(0.7);
  const [llmMaxTokens, setLlmMaxTokens] = useState(2048);
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  // Model presets for each provider
  const modelPresets: Record<string, { value: string; label: string }[]> = {
    chatgpt: [
      { value: "gpt-4", label: "GPT-4 (Standard)" },
      { value: "gpt-4-turbo", label: "GPT-4 Turbo (Faster)" },
      { value: "gpt-4o", label: "GPT-4o (Latest)" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini (Cost-effective)" },
      { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo (Budget)" },
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
    custom: [
      { value: "custom-model", label: "Custom Model" },
    ],
  };

  // Load existing LLM settings
  const { data: settings } = useQuery<any>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    if (settings) {
      setLlmProvider(settings.llmProvider || 'chatgpt');
      setHasApiKey(!!(settings.llmApiKey && settings.llmApiKey.trim()));
      setLlmApiKey('');
      setLlmModel(settings.llmModel || 'gpt-4');
      setLlmTemperature(settings.llmTemperature ?? 0.7);
      setLlmMaxTokens(settings.llmMaxTokens ?? 2048);
      setCustomEndpoint(settings.llmCustomEndpoint || '');
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
    if (llmApiKey.trim()) {
      updates.llmApiKey = llmApiKey;
    }
    if (llmProvider === 'custom') {
      updates.llmCustomEndpoint = customEndpoint;
    }
    await saveSettingMutation.mutateAsync(updates);
    if (llmApiKey.trim()) {
      setHasApiKey(true);
      setLlmApiKey('');
    }
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
                  <SelectItem value="claude">Claude (Anthropic)</SelectItem>
                  <SelectItem value="grok">Grok</SelectItem>
                  <SelectItem value="custom">Custom Endpoint</SelectItem>
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

          {llmProvider === "custom" && (
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
          )}

          <div className="space-y-2">
            <Label htmlFor="llm-api-key">
              {llmProvider === "chatgpt" ? "OpenAI API Key" : 
               llmProvider === "claude" ? "Anthropic API Key" :
               llmProvider === "grok" ? "Grok API Key" : "API Key"}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="llm-api-key"
                type="password"
                placeholder={hasApiKey ? "••••••••••••••• (saved)" : "Enter API key..."}
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                data-testid="input-llm-api-key"
              />
              {hasApiKey && (
                <Badge variant="outline" className="shrink-0">
                  <CheckCircle2 className="mr-1 h-3 w-3 text-green-500" />
                  Saved
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {llmProvider === "chatgpt" && "Get your key from platform.openai.com"}
              {llmProvider === "claude" && "Get your key from console.anthropic.com"}
              {llmProvider === "grok" && "Get your key from the Grok platform"}
              {llmProvider === "custom" && "Enter the API key for your custom endpoint"}
            </p>
          </div>

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
