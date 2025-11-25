import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export default function IntegrationsPage() {
  const { toast } = useToast();
  const [isConfigMode, setIsConfigMode] = useState(false);
  const [apiKey, setApiKey] = useState("");

  // Fetch integration config
  const { data: config, isLoading } = useQuery<IntegrationConfig | null>({
    queryKey: ["/api/integration-configs/EXTENSIV"],
    retry: (failureCount, error: any) => {
      // Don't retry on 404 (no config exists yet)
      if (error?.message?.includes("404")) return false;
      return failureCount < 3;
    },
  });

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("/api/integrations/extensiv/test", {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "Connection Successful" : "Connection Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/integration-configs/EXTENSIV"] });
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
      return await apiRequest("/api/integrations/extensiv/sync", {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "Sync Successful" : "Sync Completed with Warnings",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/integration-configs/EXTENSIV"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync inventory",
        variant: "destructive",
      });
    },
  });

  // Create/Update config mutation
  const saveConfigMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      if (config) {
        return await apiRequest(`/api/integration-configs/${config.id}`, {
          method: "PATCH",
          body: JSON.stringify({ apiKey }),
        });
      } else {
        return await apiRequest("/api/integration-configs", {
          method: "POST",
          body: JSON.stringify({
            provider: "EXTENSIV",
            accountName: "Pivot Warehouse",
            apiKey,
            config: { pivotWarehouseId: "1" },
          }),
        });
      }
    },
    onSuccess: () => {
      toast({
        title: "Configuration Saved",
        description: "Extensiv API key has been saved successfully",
      });
      setIsConfigMode(false);
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/integration-configs/EXTENSIV"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save configuration",
        variant: "destructive",
      });
    },
  });

  const getStatusInfo = () => {
    if (!config || !config.apiKey) {
      return {
        label: "Not Configured",
        variant: "secondary" as const,
        icon: AlertCircle,
        color: "text-muted-foreground",
      };
    }

    if (config.lastSyncStatus === "SUCCESS") {
      return {
        label: "Connected",
        variant: "default" as const,
        icon: CheckCircle2,
        color: "text-green-600 dark:text-green-400",
      };
    }

    if (config.lastSyncStatus === "PENDING") {
      return {
        label: "Syncing...",
        variant: "secondary" as const,
        icon: Loader2,
        color: "text-blue-600 dark:text-blue-400",
      };
    }

    if (config.lastSyncStatus === "FAILED") {
      return {
        label: "Error",
        variant: "destructive" as const,
        icon: XCircle,
        color: "text-red-600 dark:text-red-400",
      };
    }

    return {
      label: "Ready",
      variant: "secondary" as const,
      icon: AlertCircle,
      color: "text-muted-foreground",
    };
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loading-integrations" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="page-integrations">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="heading-integrations">Integrations</h1>
        <p className="text-muted-foreground mt-2" data-testid="text-description">
          Connect external systems to sync inventory, sales, and supplier data
        </p>
      </div>

      <div className="grid gap-6">
        {/* Extensiv Card */}
        <Card data-testid="card-extensiv">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2" data-testid="heading-extensiv">
                  Extensiv (Pivot Warehouse)
                  <StatusIcon className={`h-5 w-5 ${statusInfo.color}`} />
                </CardTitle>
                <CardDescription data-testid="text-extensiv-description">
                  Pivot warehouse inventory will be aligned to Extensiv. Hildale remains managed locally.
                </CardDescription>
              </div>
              <Badge variant={statusInfo.variant} data-testid={`badge-status-${statusInfo.label.toLowerCase().replace(/\s+/g, '-')}`}>
                {statusInfo.label}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {!isConfigMode ? (
              <>
                {config && config.lastSyncAt && (
                  <div className="text-sm text-muted-foreground" data-testid="text-last-sync">
                    Last sync: {format(new Date(config.lastSyncAt), "PPpp")}
                  </div>
                )}

                {config && config.lastSyncMessage && (
                  <Alert data-testid="alert-sync-message">
                    <AlertDescription data-testid="text-sync-message">
                      {config.lastSyncMessage}
                    </AlertDescription>
                  </Alert>
                )}

                {(!config || !config.apiKey) && (
                  <Alert data-testid="alert-not-configured">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription data-testid="text-config-warning">
                      Extensiv API key not configured. Click "Configure" to add your API key, or set the EXTENSIV_API_KEY environment variable.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api-key" data-testid="label-api-key">Extensiv API Key</Label>
                  <Input
                    id="api-key"
                    type="password"
                    placeholder="Enter your Extensiv API key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    data-testid="input-api-key"
                  />
                  <p className="text-sm text-muted-foreground" data-testid="text-api-key-help">
                    This will be stored securely and used for all Extensiv API requests.
                  </p>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex gap-2">
            {!isConfigMode ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setIsConfigMode(true)}
                  data-testid="button-configure"
                >
                  <Settings2 className="h-4 w-4 mr-2" />
                  {config && config.apiKey ? "Update Key" : "Configure"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => testConnectionMutation.mutate()}
                  disabled={(!config || !config.apiKey) || testConnectionMutation.isPending}
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
                  disabled={(!config || !config.apiKey) || syncMutation.isPending}
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
                    setApiKey("");
                  }}
                  data-testid="button-cancel-config"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => saveConfigMutation.mutate(apiKey)}
                  disabled={!apiKey || saveConfigMutation.isPending}
                  data-testid="button-save-config"
                >
                  {saveConfigMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
