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
import { User, Users, Zap, CheckCircle2, XCircle, AlertCircle, Barcode, Loader2, Info, Bot, Copy, ExternalLink, Key, Eye, EyeOff, RefreshCw, FileText, Shield, Mail, UserPlus, Trash2, RotateCcw, Clock, Crown, Database } from "lucide-react";
import { DataQualityTab } from "@/components/data-quality-tab";
import { Link } from "wouter";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";

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
            GHL Connector
          </TabsTrigger>
          <TabsTrigger value="team" data-testid="tab-team">
            <Users className="mr-2 h-4 w-4" />
            Team
          </TabsTrigger>
          <TabsTrigger value="data-quality" data-testid="tab-data-quality">
            <Database className="mr-2 h-4 w-4" />
            Data Quality
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

        <TabsContent value="team" className="space-y-4">
          <TeamManagement />
        </TabsContent>

        <TabsContent value="data-quality" className="space-y-4">
          <DataQualityTab />
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

      <BusinessSettings />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Legal Documents
          </CardTitle>
          <CardDescription>
            Review our terms of service and privacy practices
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/legal/eula">
              <Button variant="outline" className="w-full sm:w-auto gap-2" data-testid="link-settings-eula">
                <FileText className="h-4 w-4" />
                End User License Agreement
                <ExternalLink className="h-3 w-3" />
              </Button>
            </Link>
            <Link href="/legal/privacy">
              <Button variant="outline" className="w-full sm:w-auto gap-2" data-testid="link-settings-privacy">
                <Shield className="h-4 w-4" />
                Privacy Policy
                <ExternalLink className="h-3 w-3" />
              </Button>
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            These documents comply with Utah Consumer Privacy Act (UCPA) and Arizona state law requirements.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function BusinessSettings() {
  const { toast } = useToast();
  const [accountantPhone, setAccountantPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load settings
  useEffect(() => {
    fetch("/api/settings", { credentials: "include" })
      .then(res => res.json())
      .then(data => {
        if (data.accountantPhone) setAccountantPhone(data.accountantPhone);
        setIsLoaded(true);
      })
      .catch(() => setIsLoaded(true));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await apiRequest("PATCH", "/api/settings", { accountantPhone });
      if (!res.ok) throw new Error("Failed to save");
      toast({ title: "Saved", description: "Business settings updated" });
    } catch {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Business Settings</CardTitle>
        <CardDescription>Configure business contacts and operations</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="accountant-phone">Accountant Phone Number</Label>
          <Input
            id="accountant-phone"
            type="tel"
            placeholder="(555) 123-4567"
            value={accountantPhone}
            onChange={(e) => setAccountantPhone(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Used to notify your accountant when private source deliveries need a check written.
          </p>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving || !isLoaded} size="sm">
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LLMSettings() {
  const { toast } = useToast();
  const [llmProvider, setLlmProvider] = useState("claude");
  const [llmModel, setLlmModel] = useState("claude-sonnet-4-5");
  const [llmTemperature, setLlmTemperature] = useState(0.7);
  const [llmMaxTokens, setLlmMaxTokens] = useState(2048);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState("");
  const [isEditingApiKey, setIsEditingApiKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [isEditingWebhookSecret, setIsEditingWebhookSecret] = useState(false);
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false);
  const [maskedWebhookSecret, setMaskedWebhookSecret] = useState("");

  // Model presets for each provider
  const modelPresets: Record<string, { value: string; label: string }[]> = {
    chatgpt: [
      { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (Recommended)" },
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (Fast/Budget)" },
      { value: "claude-opus-4-5", label: "Claude Opus 4.5 (Most Capable)" },
    ],
    claude: [
      { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (Recommended)" },
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (Fast/Budget)" },
      { value: "claude-opus-4-5", label: "Claude Opus 4.5 (Most Capable)" },
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
      const provider = settings.llmProvider === 'custom' ? 'claude' : (settings.llmProvider || 'claude');
      setLlmProvider(provider);
      
      // API key from database (source of truth)
      setHasApiKey(!!settings.hasApiKey);
      setMaskedApiKey(settings.apiKeyMasked || '');
      setNewApiKey('');
      setIsEditingApiKey(false);
      
      // Webhook secret from database
      setHasWebhookSecret(!!settings.hasWebhookSigningSecret);
      setMaskedWebhookSecret(settings.webhookSigningSecretMasked || '');
      setWebhookSecret('');
      setIsEditingWebhookSecret(false);
      
      setLlmModel(settings.llmModel || 'claude-sonnet-4-5');
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
    // Include API key if user entered a new value
    if (newApiKey.trim()) {
      updates.llmApiKey = newApiKey.trim();
    }
    // Only include webhook secret if user entered a new value
    if (webhookSecret.trim()) {
      updates.openaiWebhookSecret = webhookSecret.trim();
    }
    await saveSettingMutation.mutateAsync(updates);
    // Clear editing states after save - re-fetch will update masked values
    setNewApiKey('');
    setIsEditingApiKey(false);
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
                  <SelectItem value="claude">Claude (Anthropic)</SelectItem>
                  <SelectItem value="chatgpt">Claude (Legacy Label)</SelectItem>
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
              {llmProvider === "chatgpt" ? "Anthropic API Key" : 
               llmProvider === "claude" ? "Anthropic API Key" :
               llmProvider === "grok" ? "Grok API Key" : "API Key"}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="llm-api-key"
                type={isEditingApiKey ? "password" : "text"}
                readOnly={!isEditingApiKey}
                placeholder={hasApiKey ? undefined : "sk-ant-..."}
                value={isEditingApiKey ? newApiKey : (hasApiKey ? maskedApiKey : "")}
                onClick={() => {
                  if (!isEditingApiKey) {
                    setIsEditingApiKey(true);
                    setNewApiKey('');
                  }
                }}
                onChange={(e) => setNewApiKey(e.target.value)}
                onBlur={() => {
                  if (!newApiKey.trim()) {
                    setIsEditingApiKey(false);
                  }
                }}
                className={!hasApiKey && !isEditingApiKey ? "text-muted-foreground" : ""}
                data-testid="input-llm-api-key"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
              />
              {hasApiKey && !isEditingApiKey && (
                <Badge variant="outline" className="shrink-0">
                  <CheckCircle2 className="mr-1 h-3 w-3 text-green-500" />
                  Configured
                </Badge>
              )}
              {isEditingApiKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsEditingApiKey(false);
                    setNewApiKey('');
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {hasApiKey 
                ? "Click the field to update your API key" 
                : "Paste your Anthropic API key to enable AI features"}
            </p>
          </div>

          {llmProvider === "chatgpt" && (
            <div className="space-y-2">
              <Label htmlFor="webhook-secret">Webhook Signing Secret</Label>
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
                  Signing secret for webhook verification
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
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const apiBaseUrl = `${baseUrl}/api/ghl-agent`;
  
  const { data: apiKeyStatus, refetch: refetchStatus } = useQuery<{ 
    configured: boolean;
    keyPrefix: string | null;
    hasDbKey: boolean;
    lastUsedAt: string | null;
  }>({
    queryKey: ["/api/settings/sbr-ghl-connector-key-status"],
  });
  
  const generateKeyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/sbr-ghl-connector-key/generate");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setGeneratedKey(data.apiKey);
        setShowApiKey(true);
        refetchStatus();
        toast({
          title: "API Key Generated",
          description: "Copy your key now - it won't be shown again!",
        });
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to generate key",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
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
    },
    {
      method: "POST",
      path: "/returns/initiate",
      description: "Initiate a return for an order with label generation",
      request: '{ "order_number": "12345" }',
      response: '{ "status": "success", "return_id": "RET-2025-001234", "order_number": "12345", "customer_name": "Sarah Miller", "return_tracking": "1Z999BB9876543210", "return_label_url": "https://...", "items": [...], "estimated_arrival": "2025-01-28" }'
    }
  ];
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            GHL Connector Configuration
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
            
            <div className="space-y-4">
              <Label className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                API Key
              </Label>
              
              {generatedKey ? (
                <div className="rounded-lg border border-primary p-4 bg-primary/5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Key Generated
                    </Badge>
                    <span className="text-sm text-destructive font-medium">Copy now - won't be shown again!</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={showApiKey ? generatedKey : generatedKey.replace(/./g, '•')}
                      readOnly
                      className="font-mono text-sm"
                      data-testid="input-generated-api-key"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowApiKey(!showApiKey)}
                      data-testid="button-toggle-key-visibility"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="default"
                      size="icon"
                      onClick={() => copyToClipboard(generatedKey, "API Key")}
                      data-testid="button-copy-generated-key"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : apiKeyStatus?.hasDbKey ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="default" className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Active
                    </Badge>
                    <code className="text-sm font-mono bg-muted px-2 py-1 rounded">{apiKeyStatus.keyPrefix}</code>
                    {apiKeyStatus.lastUsedAt && (
                      <span className="text-xs text-muted-foreground">
                        Last used: {new Date(apiKeyStatus.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => generateKeyMutation.mutate()}
                    disabled={generateKeyMutation.isPending}
                    data-testid="button-regenerate-api-key"
                  >
                    {generateKeyMutation.isPending ? (
                      <>Generating...</>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Regenerate Key
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Regenerating will invalidate the current key. You'll need to update your GHL Agent configuration.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                    <XCircle className="h-3 w-3" />
                    Not Configured
                  </Badge>
                  <Button
                    onClick={() => generateKeyMutation.mutate()}
                    disabled={generateKeyMutation.isPending}
                    data-testid="button-generate-api-key"
                  >
                    {generateKeyMutation.isPending ? (
                      <>Generating...</>
                    ) : (
                      <>
                        <Key className="h-4 w-4 mr-2" />
                        Generate API Key
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Generate a secure API key to allow your GHL Agent to access this system.
                  </p>
                </div>
              )}
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

// ============================================================================
// TEAM MANAGEMENT
// ============================================================================

interface TeamUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

function TeamManagement() {
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [resetDialog, setResetDialog] = useState<{ open: boolean; user: TeamUser | null; result: { link: string; emailSent: boolean; sentTo: string } | null }>({ open: false, user: null, result: null });
  const [removeDialog, setRemoveDialog] = useState<{ open: boolean; user: TeamUser | null }>({ open: false, user: null });

  const { data: currentUser } = useQuery<{ id: string; email: string }>({ queryKey: ["/api/auth/me"] });
  const { data: users = [], isLoading: usersLoading } = useQuery<TeamUser[]>({ queryKey: ["/api/admin/users"] });
  const { data: invites = [], isLoading: invitesLoading } = useQuery<PendingInvite[]>({ queryKey: ["/api/admin/invites"] });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/invite-user", { email: inviteEmail, role: inviteRole });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: (data) => {
      setInviteLink(data.inviteLink);
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invites"] });
      toast({ title: "Invite sent!", description: data.invite?.email ? `Invite created for ${data.invite.email}` : "Invite link generated" });
    },
    onError: (err: Error) => toast({ title: "Failed to invite", description: err.message, variant: "destructive" }),
  });

  const resetMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", "/api/admin/reset-password", { userId });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: (data) => {
      setResetDialog(prev => ({ ...prev, result: { link: data.resetLink, emailSent: data.emailSent, sentTo: data.sentTo } }));
      toast({ title: "Password reset sent", description: data.emailSent ? `Reset email sent to ${data.sentTo}` : "Reset link generated (email not configured)" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${userId}`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setRemoveDialog({ open: false, user: null });
      toast({ title: "User removed" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/invites/${id}`);
      if (!res.ok) throw new Error("Failed to revoke");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invites"] });
      toast({ title: "Invite revoked" });
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}/role`, { role });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Role updated" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
    catch { return "—"; }
  };

  const isExpired = (d: string) => new Date(d) < new Date();

  return (
    <div className="space-y-6">
      {/* Team Members */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-lg">Team Members</CardTitle>
            <CardDescription>{users.length} member{users.length !== 1 ? "s" : ""}</CardDescription>
          </div>
          <Button size="sm" onClick={() => { setShowInviteDialog(true); setInviteLink(null); }}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite Member
          </Button>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-1">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-medium text-sm">
                      {(u.name || u.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{u.name || u.email.split("@")[0]}</span>
                        {u.role === "admin" && (
                          <Badge variant="secondary" className="text-xs gap-1 shrink-0">
                            <Crown className="h-3 w-3" /> Admin
                          </Badge>
                        )}
                        {u.role === "warehouse" && (
                          <Badge variant="outline" className="text-xs gap-1 shrink-0 text-amber-700 dark:text-amber-400 border-amber-400">
                            Warehouse
                          </Badge>
                        )}
                        {u.id === currentUser?.id && (
                          <Badge variant="outline" className="text-xs shrink-0">You</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                  </div>
                  {u.id !== currentUser?.id && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Select
                        value={u.role}
                        onValueChange={(role) => roleMutation.mutate({ userId: u.id, role })}
                      >
                        <SelectTrigger className="h-8 w-[120px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {/* New role taxonomy. Legacy values kept so an
                              admin/member row still renders correctly until
                              the operator picks a new role. */}
                          <SelectItem value="owner">Owner</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="floor">Floor</SelectItem>
                          <SelectItem value="office">Office</SelectItem>
                          <SelectItem value="admin" disabled>Admin (legacy)</SelectItem>
                          <SelectItem value="member" disabled>Member (legacy)</SelectItem>
                          <SelectItem value="warehouse" disabled>Warehouse (legacy)</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => { setResetDialog({ open: true, user: u, result: null }); }}
                        title="Reset password"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setRemoveDialog({ open: true, user: u })}
                        title="Remove user"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Invites */}
      {(invites.length > 0 || invitesLoading) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pending Invites</CardTitle>
            <CardDescription>Invites waiting to be accepted</CardDescription>
          </CardHeader>
          <CardContent>
            {invitesLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-1">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
                        <Mail className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{inv.email}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {isExpired(inv.expiresAt) ? (
                            <span className="text-destructive">Expired</span>
                          ) : (
                            <span>Expires {formatDate(inv.expiresAt)}</span>
                          )}
                          <span>·</span>
                          <span className="capitalize">{inv.role}</span>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => revokeInviteMutation.mutate(inv.id)}
                      title="Revoke invite"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invite Dialog */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>They'll receive a link to set up their account.</DialogDescription>
          </DialogHeader>
          {inviteLink ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <span className="text-sm font-medium">Invite created!</span>
              </div>
              <div className="space-y-2">
                <Label>Invite Link</Label>
                <div className="flex gap-2">
                  <Input value={inviteLink} readOnly className="text-xs font-mono bg-muted" />
                  <Button size="icon" variant="outline" onClick={() => copyToClipboard(inviteLink)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Share this link with the person you're inviting. It expires in 7 days.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowInviteDialog(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email Address</Label>
                <Input
                  id="invite-email" type="email" placeholder="colleague@company.com"
                  value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member — can view and edit inventory</SelectItem>
                    <SelectItem value="admin">Admin — full access including team management</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowInviteDialog(false)}>Cancel</Button>
                <Button onClick={() => inviteMutation.mutate()} disabled={!inviteEmail || inviteMutation.isPending}>
                  {inviteMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</> : <><Mail className="mr-2 h-4 w-4" /> Send Invite</>}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={resetDialog.open} onOpenChange={(open) => { if (!open) setResetDialog({ open: false, user: null, result: null }); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              {resetDialog.result
                ? "Password reset link generated."
                : `Send a password reset link to ${resetDialog.user?.email}`}
            </DialogDescription>
          </DialogHeader>
          {resetDialog.result ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {resetDialog.result.emailSent ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                    <span className="text-sm">Reset email sent to <strong>{resetDialog.result.sentTo}</strong></span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-5 w-5 text-orange-500 shrink-0" />
                    <span className="text-sm">Email not configured. Share the link manually.</span>
                  </>
                )}
              </div>
              <div className="space-y-2">
                <Label>Reset Link</Label>
                <div className="flex gap-2">
                  <Input value={resetDialog.result.link} readOnly className="text-xs font-mono bg-muted" />
                  <Button size="icon" variant="outline" onClick={() => copyToClipboard(resetDialog.result!.link)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">This link expires in 24 hours.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setResetDialog({ open: false, user: null, result: null })}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetDialog({ open: false, user: null, result: null })}>Cancel</Button>
              <Button onClick={() => resetDialog.user && resetMutation.mutate(resetDialog.user.id)} disabled={resetMutation.isPending}>
                {resetMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</> : <><RotateCcw className="mr-2 h-4 w-4" /> Send Reset Link</>}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Remove User Confirmation */}
      <AlertDialog open={removeDialog.open} onOpenChange={(open) => { if (!open) setRemoveDialog({ open: false, user: null }); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{removeDialog.user?.name || removeDialog.user?.email}</strong>? They will lose access immediately and this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeDialog.user && removeMutation.mutate(removeDialog.user.id)}
            >
              {removeMutation.isPending ? "Removing..." : "Remove User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
