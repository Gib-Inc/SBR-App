import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  AlertTriangle, 
  CheckCircle, 
  RefreshCw, 
  Shield, 
  Clock, 
  XCircle, 
  HelpCircle,
  RotateCw,
  Calendar,
  Key
} from "lucide-react";
import { SiShopify, SiAmazon, SiQuickbooks, SiMeta, SiGoogle } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";

type HealthStatus = 'OK' | 'WARNING' | 'CRITICAL' | 'EXPIRED' | 'UNKNOWN';

type HealthCheckProvider = 
  | 'QUICKBOOKS' 
  | 'META_ADS' 
  | 'GOOGLE_ADS' 
  | 'EXTENSIV' 
  | 'SHOPIFY' 
  | 'AMAZON' 
  | 'GOHIGHLEVEL' 
  | 'PHANTOMBUSTER';

interface IntegrationRotationData {
  provider: HealthCheckProvider;
  configId?: string;
  accountName?: string;
  isConnected: boolean;
  tokenLastRotatedAt?: string | null;
  tokenNextRotationAt?: string | null;
  status: HealthStatus;
  daysUntilExpiry?: number;
  message: string;
}

interface IntegrationRotationResponse {
  integrations: IntegrationRotationData[];
}

const PROVIDER_LABELS: Record<HealthCheckProvider, string> = {
  QUICKBOOKS: "QuickBooks Online",
  META_ADS: "Meta Ads",
  GOOGLE_ADS: "Google Ads",
  EXTENSIV: "Extensiv (Pivot)",
  SHOPIFY: "Shopify",
  AMAZON: "Amazon Seller Central",
  GOHIGHLEVEL: "GoHighLevel",
  PHANTOMBUSTER: "PhantomBuster",
};

function getProviderIcon(provider: HealthCheckProvider) {
  switch (provider) {
    case 'SHOPIFY':
      return <SiShopify className="h-5 w-5" />;
    case 'AMAZON':
      return <SiAmazon className="h-5 w-5" />;
    case 'QUICKBOOKS':
      return <SiQuickbooks className="h-5 w-5" />;
    case 'META_ADS':
      return <SiMeta className="h-5 w-5" />;
    case 'GOOGLE_ADS':
      return <SiGoogle className="h-5 w-5" />;
    default:
      return <Key className="h-5 w-5" />;
  }
}

function getStatusIcon(status: HealthStatus) {
  switch (status) {
    case 'OK':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'WARNING':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case 'CRITICAL':
    case 'EXPIRED':
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
  }
}

function getStatusBadgeVariant(status: HealthStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case 'OK':
      return 'default';
    case 'WARNING':
      return 'secondary';
    case 'CRITICAL':
    case 'EXPIRED':
      return 'destructive';
    default:
      return 'outline';
  }
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return 'Not set';
  try {
    return format(new Date(dateString), 'MMM d, yyyy');
  } catch {
    return 'Invalid date';
  }
}

function IntegrationHealthCard({ 
  integration,
  onRotate 
}: { 
  integration: IntegrationRotationData;
  onRotate: (provider: HealthCheckProvider, configId?: string) => void;
}) {
  return (
    <Card className="flex flex-col" data-testid={`card-integration-health-${integration.provider.toLowerCase()}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {getProviderIcon(integration.provider)}
            <CardTitle className="text-sm font-medium truncate">
              {PROVIDER_LABELS[integration.provider]}
            </CardTitle>
          </div>
          <Badge variant={getStatusBadgeVariant(integration.status)} className="text-xs shrink-0">
            {getStatusIcon(integration.status)}
            <span className="ml-1">{integration.status}</span>
          </Badge>
        </div>
        {integration.accountName && (
          <CardDescription className="text-xs truncate">
            {integration.accountName}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex-1 space-y-3 pt-0">
        <div className="space-y-1 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Last Rotation:
            </span>
            <span className="font-medium text-right">
              {formatDate(integration.tokenLastRotatedAt)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Next Due:
            </span>
            <span className="font-medium text-right">
              {formatDate(integration.tokenNextRotationAt)}
            </span>
          </div>
        </div>
        
        {integration.daysUntilExpiry !== undefined && (
          <p className="text-xs text-muted-foreground">{integration.message}</p>
        )}

        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => onRotate(integration.provider, integration.configId)}
          data-testid={`button-rotate-${integration.provider.toLowerCase()}`}
        >
          <RotateCw className="h-4 w-4 mr-2" />
          Rotate Now
        </Button>
      </CardContent>
    </Card>
  );
}

export function IntegrationHealth() {
  const { toast } = useToast();
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<HealthCheckProvider | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | undefined>();
  
  const { data: rotationData, isLoading, error } = useQuery<IntegrationRotationResponse>({
    queryKey: ['/api/integration-health/rotation'],
    refetchInterval: 60000,
  });
  
  const runHealthCheckMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/integration-health/check");
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/integration-health'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integration-health/rotation'] });
      toast({
        title: "Health Check Complete",
        description: `Checked ${data.results?.length || 0} integrations, ${data.alertsSent || 0} alerts sent`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Health Check Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const rotateMutation = useMutation({
    mutationFn: async ({ provider, configId }: { provider: HealthCheckProvider; configId?: string }) => {
      return await apiRequest("POST", "/api/integration-health/rotate", { provider, configId });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/integration-health/rotation'] });
      queryClient.invalidateQueries({ queryKey: ['/api/audit-logs'] });
      toast({
        title: "Rotation Recorded",
        description: data.message || "Token rotation has been logged. Remember to update your credentials.",
      });
      setRotateDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Rotation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRotateClick = (provider: HealthCheckProvider, configId?: string) => {
    setSelectedProvider(provider);
    setSelectedConfigId(configId);
    setRotateDialogOpen(true);
  };

  const handleConfirmRotate = () => {
    if (selectedProvider) {
      rotateMutation.mutate({ provider: selectedProvider, configId: selectedConfigId });
    }
  };

  const integrations = rotationData?.integrations || [];
  const hasIntegrations = integrations.length > 0;
  
  const hasCriticalOrWarning = integrations.some(
    i => i.status === 'CRITICAL' || i.status === 'EXPIRED' || i.status === 'WARNING'
  );
  
  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Integration Health</CardTitle>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runHealthCheckMutation.mutate()}
              disabled={runHealthCheckMutation.isPending}
              data-testid="button-run-health-check"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${runHealthCheckMutation.isPending ? 'animate-spin' : ''}`} />
              {runHealthCheckMutation.isPending ? 'Checking...' : 'Run Check'}
            </Button>
          </div>
          <CardDescription>
            Monitor token expiry and manage credential rotation for all integrations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          ) : error ? (
            <p className="text-sm text-muted-foreground">
              Unable to load integration health status
            </p>
          ) : !hasIntegrations ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Shield className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">No integrations configured yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Connect data sources above to monitor their health
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {hasCriticalOrWarning && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                  <span className="text-sm text-destructive">
                    Some integrations need attention - check token expiry and rotate keys as needed
                  </span>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {integrations.map((integration) => (
                  <IntegrationHealthCard
                    key={integration.provider}
                    integration={integration}
                    onRotate={handleRotateClick}
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={rotateDialogOpen} onOpenChange={setRotateDialogOpen}>
        <DialogContent data-testid="dialog-rotate-confirmation">
          <DialogHeader>
            <DialogTitle>Confirm Token Rotation</DialogTitle>
            <DialogDescription>
              This action records that you have rotated the credentials for{' '}
              <strong>{selectedProvider ? PROVIDER_LABELS[selectedProvider] : 'this integration'}</strong>.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-3">
            <div className="p-3 rounded-md bg-muted">
              <h4 className="font-medium text-sm mb-2">Important</h4>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>This does NOT automatically rotate your credentials</li>
                <li>You must manually update the API key/token in Settings</li>
                <li>This action logs the rotation event for compliance tracking</li>
                <li>Next rotation reminder will be set based on your rotation interval</li>
              </ul>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setRotateDialogOpen(false)}
              data-testid="button-cancel-rotate"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmRotate}
              disabled={rotateMutation.isPending}
              data-testid="button-confirm-rotate"
            >
              {rotateMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Recording...
                </>
              ) : (
                <>
                  <RotateCw className="h-4 w-4 mr-2" />
                  Confirm Rotation
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
