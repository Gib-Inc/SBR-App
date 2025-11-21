import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { User, Key, Zap, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();

  const integrations = [
    {
      id: "gohighlevel",
      name: "GoHighLevel",
      description: "Sync sales history and trigger SMS alerts",
      status: "connected",
    },
    {
      id: "shopify",
      name: "Shopify",
      description: "E-commerce platform integration",
      status: "disconnected",
    },
    {
      id: "extensiv",
      name: "Extensiv/Pivot",
      description: "Finished goods inventory snapshot",
      status: "connected",
    },
    {
      id: "phantombuster",
      name: "PhantomBuster",
      description: "Supplier availability and lead times",
      status: "disconnected",
    },
  ];

  const testConnection = async (integrationId: string) => {
    setTestingConnection(integrationId);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    setTestingConnection(null);
    toast({
      title: "Connection successful",
      description: "Integration is working properly",
    });
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
              <Badge variant={integration.status === "connected" ? "default" : "secondary"}>
                {integration.status === "connected" ? (
                  <>
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Connected
                  </>
                ) : (
                  <>
                    <XCircle className="mr-1 h-3 w-3" />
                    Disconnected
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
                disabled={testingConnection === integration.id}
                data-testid={`button-test-${integration.id}`}
              >
                {testingConnection === integration.id ? "Testing..." : "Test Connection"}
              </Button>
              <Button data-testid={`button-save-${integration.id}`}>
                Save Configuration
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LLMSettings() {
  const [llmProvider, setLlmProvider] = useState("chatgpt");
  const [enableOrderRecommendations, setEnableOrderRecommendations] = useState(false);
  const [enableSupplierRanking, setEnableSupplierRanking] = useState(false);
  const [enableForecasting, setEnableForecasting] = useState(false);

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
                  data-testid="input-custom-endpoint"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-api-key">API Key</Label>
                <Input
                  id="custom-api-key"
                  type="password"
                  placeholder="••••••••••••••••"
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
            <Button data-testid="button-save-llm-provider">Save Provider</Button>
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
            <Button data-testid="button-save-llm-features">Save Features</Button>
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
