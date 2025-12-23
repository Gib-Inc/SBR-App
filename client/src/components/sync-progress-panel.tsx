import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SyncRun {
  id: string;
  mode: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  totalOrders: number;
  ordersProcessed: number;
  customersUpdated: number;
  contactsUpdated: number;
  unknownContacts: number;
  errorCount: number;
}

interface SyncStatus {
  isRunning: boolean;
}

interface SyncStatusResponse {
  success: boolean;
  status: SyncStatus | null;
  recentRuns: SyncRun[];
}

function CircularProgress({ percentage }: { percentage: number }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative w-12 h-12 flex items-center justify-center">
      <svg className="transform -rotate-90 w-12 h-12">
        <circle
          cx="24"
          cy="24"
          r={radius}
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
          className="text-muted-foreground/20"
        />
        <circle
          cx="24"
          cy="24"
          r={radius}
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          className="text-primary transition-all duration-300"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset,
          }}
        />
      </svg>
      <span className="absolute text-xs font-medium">{Math.round(percentage)}%</span>
    </div>
  );
}

export function SyncProgressPanel() {
  const [isVisible, setIsVisible] = useState(false);
  const [wasRunning, setWasRunning] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [completedRunId, setCompletedRunId] = useState<string | null>(null);

  const { data, isError } = useQuery<SyncStatusResponse>({
    queryKey: ["/api/integrations/shopify/commerce-attribution/status"],
    refetchInterval: isVisible ? 2000 : 10000,
    staleTime: 1000,
  });

  const currentRun = data?.recentRuns?.[0];
  const isRunning = data?.status?.isRunning ?? false;
  const isComplete = currentRun?.status === "success" || currentRun?.status === "partial";
  const isFailed = currentRun?.status === "failed";

  useEffect(() => {
    if (isRunning && !wasRunning) {
      setIsVisible(true);
      setIsDismissed(false);
      setCompletedRunId(null);
    }

    if (!isRunning && wasRunning && currentRun) {
      setCompletedRunId(currentRun.id);
      setTimeout(() => {
        if (!isDismissed) {
          setIsVisible(false);
        }
      }, 5000);
    }

    setWasRunning(isRunning);
  }, [isRunning, wasRunning, currentRun, isDismissed]);

  useEffect(() => {
    if (currentRun && currentRun.status === "running") {
      setIsVisible(true);
      setIsDismissed(false);
    }
  }, [currentRun?.id]);

  const handleDismiss = () => {
    setIsDismissed(true);
    setIsVisible(false);
  };

  if (!isVisible || isDismissed || !currentRun) {
    return null;
  }

  const totalOrders = currentRun.totalOrders || 0;
  const ordersProcessed = currentRun.ordersProcessed || 0;
  const percentage = totalOrders > 0 ? (ordersProcessed / totalOrders) * 100 : 0;
  const showProgress = isRunning || (completedRunId === currentRun.id);

  if (!showProgress && !isComplete && !isFailed) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-card shadow-lg",
        "animate-in slide-in-from-bottom-4 fade-in duration-300"
      )}
      data-testid="sync-progress-panel"
    >
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          {isRunning && <RefreshCw className="h-4 w-4 animate-spin text-primary" />}
          {isComplete && <CheckCircle2 className="h-4 w-4 text-green-500" />}
          {isFailed && <AlertCircle className="h-4 w-4 text-destructive" />}
          <span className="font-medium text-sm">
            {isRunning ? "Attribution Sync" : isComplete ? "Sync Complete" : "Sync Failed"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleDismiss}
          data-testid="button-dismiss-sync"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-4">
          {isRunning ? (
            <CircularProgress percentage={percentage} />
          ) : (
            <div className="w-12 h-12 flex items-center justify-center">
              {isComplete ? (
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              ) : (
                <AlertCircle className="h-8 w-8 text-destructive" />
              )}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold tabular-nums">
                {ordersProcessed.toLocaleString()}
              </span>
              {totalOrders > 0 && (
                <span className="text-muted-foreground text-sm">
                  / {totalOrders.toLocaleString()} customers
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
              <span>{currentRun.contactsUpdated} synced to GHL</span>
              {currentRun.unknownContacts > 0 && (
                <span>{currentRun.unknownContacts} not in GHL</span>
              )}
              {currentRun.errorCount > 0 && (
                <span className="text-destructive">{currentRun.errorCount} errors</span>
              )}
            </div>
          </div>
        </div>

        {isRunning && totalOrders > 0 && (
          <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 rounded-full"
              style={{ width: `${percentage}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
