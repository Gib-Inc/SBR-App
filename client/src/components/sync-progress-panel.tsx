import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, RefreshCw, CheckCircle2, AlertCircle, ShoppingBag, Users, Calendar, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SyncSummary {
  totalOrdersFetched?: number;
  uniqueCustomers?: number;
  skippedNoContact?: number;
  skippedCancelledRefunded?: number;
  oldestOrderDate?: string | null;
  newestOrderDate?: string | null;
}

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
  contactsMatched: number;
  contactsCreated: number;
  unknownContacts: number;
  errorCount: number;
  summaryJson?: SyncSummary | null;
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
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative w-10 h-10 flex items-center justify-center">
      <svg className="transform -rotate-90 w-10 h-10">
        <circle
          cx="20"
          cy="20"
          r={radius}
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          className="text-muted-foreground/20"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          className="text-primary transition-all duration-300"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset,
          }}
        />
      </svg>
      <span className="absolute text-[10px] font-semibold">{Math.round(percentage)}%</span>
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

  const contactsMatched = currentRun.contactsMatched || 0;
  const contactsCreated = currentRun.contactsCreated || 0;
  const ghlTotal = contactsMatched + contactsCreated;

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-card shadow-lg",
        "animate-in slide-in-from-bottom-4 fade-in duration-300"
      )}
      data-testid="sync-progress-panel"
    >
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-3">
          {isRunning ? (
            <CircularProgress percentage={percentage} />
          ) : isComplete ? (
            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
          ) : (
            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-5 w-5 text-destructive" />
            </div>
          )}
          <div>
            <span className="font-medium text-sm block">
              Attribution Sync
            </span>
            <span className="text-xs text-muted-foreground">
              {isRunning ? "In progress..." : isComplete ? "Complete" : "Failed"}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleDismiss}
          data-testid="button-dismiss-sync"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
            <ShoppingBag className="h-4 w-4 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Shopify</span>
              <span className="text-sm text-muted-foreground">
                {ordersProcessed.toLocaleString()} / {totalOrders.toLocaleString()}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              Gathering orders & customer data
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
            <Users className="h-4 w-4 text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">GoHighLevel</span>
              <span className="text-sm text-muted-foreground">
                {ghlTotal.toLocaleString()} synced
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {contactsMatched} matched, {contactsCreated} created
            </span>
          </div>
        </div>

        {isRunning && totalOrders > 0 && (
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 rounded-full"
              style={{ width: `${percentage}%` }}
            />
          </div>
        )}

        {/* Show summary stats when complete */}
        {isComplete && currentRun.summaryJson && (
          <div className="mt-3 pt-3 border-t space-y-2">
            {/* Date range */}
            {currentRun.summaryJson.oldestOrderDate && currentRun.summaryJson.newestOrderDate && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>
                  Orders from {new Date(currentRun.summaryJson.oldestOrderDate).toLocaleDateString()} to {new Date(currentRun.summaryJson.newestOrderDate).toLocaleDateString()}
                </span>
              </div>
            )}
            
            {/* Total orders fetched */}
            {currentRun.summaryJson.totalOrdersFetched && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShoppingBag className="h-3 w-3" />
                <span>
                  {currentRun.summaryJson.totalOrdersFetched.toLocaleString()} orders → {currentRun.summaryJson.uniqueCustomers?.toLocaleString() || 0} unique customers
                </span>
              </div>
            )}

            {/* Skipped orders */}
            {((currentRun.summaryJson.skippedNoContact || 0) > 0 || (currentRun.summaryJson.skippedCancelledRefunded || 0) > 0) && (
              <div className="flex items-center gap-2 text-xs text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                <span>
                  Skipped: {currentRun.summaryJson.skippedNoContact || 0} no email/phone, {currentRun.summaryJson.skippedCancelledRefunded || 0} cancelled
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
