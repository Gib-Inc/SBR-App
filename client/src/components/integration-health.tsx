import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, CheckCircle, RefreshCw, Shield, Clock, XCircle, HelpCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type HealthStatus = 'OK' | 'WARNING' | 'CRITICAL' | 'EXPIRED' | 'UNKNOWN';

interface HealthEntry {
  status: HealthStatus;
  daysUntilExpiry?: number;
  message: string;
}

interface IntegrationHealthSummary {
  quickbooks?: HealthEntry;
  metaAds?: HealthEntry;
  googleAds?: HealthEntry;
  integrations: Record<string, HealthEntry>;
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

function HealthStatusRow({ 
  name, 
  entry 
}: { 
  name: string; 
  entry: HealthEntry;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0">
      <div className="flex items-center gap-2">
        {getStatusIcon(entry.status)}
        <span className="font-medium text-sm">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        {entry.daysUntilExpiry !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{entry.daysUntilExpiry}d</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{entry.message}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Badge variant={getStatusBadgeVariant(entry.status)} className="text-xs">
          {entry.status}
        </Badge>
      </div>
    </div>
  );
}

export function IntegrationHealth() {
  const { toast } = useToast();
  
  const { data: healthData, isLoading, error } = useQuery<IntegrationHealthSummary>({
    queryKey: ['/api/integration-health'],
    refetchInterval: 60000,
  });
  
  const runHealthCheckMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/integration-health/check");
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/integration-health'] });
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
  
  const hasAnyIntegrations = healthData && (
    healthData.quickbooks || 
    healthData.metaAds || 
    healthData.googleAds || 
    Object.keys(healthData.integrations || {}).length > 0
  );
  
  const hasCriticalOrWarning = healthData && (
    healthData.quickbooks?.status === 'CRITICAL' ||
    healthData.quickbooks?.status === 'EXPIRED' ||
    healthData.quickbooks?.status === 'WARNING' ||
    healthData.metaAds?.status === 'CRITICAL' ||
    healthData.metaAds?.status === 'EXPIRED' ||
    healthData.metaAds?.status === 'WARNING' ||
    healthData.googleAds?.status === 'CRITICAL' ||
    healthData.googleAds?.status === 'EXPIRED' ||
    healthData.googleAds?.status === 'WARNING' ||
    Object.values(healthData.integrations || {}).some(
      e => e.status === 'CRITICAL' || e.status === 'EXPIRED' || e.status === 'WARNING'
    )
  );
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
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
          Monitor token expiry and API key health across all integrations
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            Unable to load integration health status
          </p>
        ) : !hasAnyIntegrations ? (
          <p className="text-sm text-muted-foreground">
            No integrations configured yet. Connect data sources above to monitor their health.
          </p>
        ) : (
          <div className="space-y-1">
            {hasCriticalOrWarning && (
              <div className="flex items-center gap-2 p-2 mb-2 rounded-md bg-destructive/10 border border-destructive/20">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="text-sm text-destructive">
                  Some integrations need attention - check token expiry and rotate keys as needed
                </span>
              </div>
            )}
            
            {healthData.quickbooks && (
              <HealthStatusRow name="QuickBooks" entry={healthData.quickbooks} />
            )}
            
            {healthData.metaAds && (
              <HealthStatusRow name="Meta Ads" entry={healthData.metaAds} />
            )}
            
            {healthData.googleAds && (
              <HealthStatusRow name="Google Ads" entry={healthData.googleAds} />
            )}
            
            {Object.entries(healthData.integrations || {}).map(([provider, entry]) => (
              <HealthStatusRow key={provider} name={provider} entry={entry} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
