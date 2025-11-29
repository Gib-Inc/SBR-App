import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type ScanStatus = 
  | "PRODUCT_MATCH" 
  | "BIN_MATCH" 
  | "RETURN_RECEIVED" 
  | "ALREADY_RECEIVED" 
  | "LABEL_NOT_RETURN" 
  | "UNKNOWN_CODE"
  | "ERROR";

export interface ScanResult {
  status: ScanStatus;
  message?: string;
  barcode?: any;
  item?: { id: string; sku: string; name: string };
  bin?: { id: string; name: string };
  returnRequestId?: string;
  salesOrderId?: string;
  rmaNumber?: string;
  skus?: string[];
  inventoryUpdates?: { sku: string; qty: number }[];
  labelLog?: { id: string; type: string; trackingNumber: string };
}

interface UseUnifiedScannerOptions {
  onScanSuccess?: (result: ScanResult) => void;
  onScanError?: (error: Error) => void;
  showToasts?: boolean;
  source?: string;
}

export function useUnifiedScanner(options: UseUnifiedScannerOptions = {}) {
  const { 
    onScanSuccess, 
    onScanError, 
    showToasts = true,
    source = 'WAREHOUSE_SCANNER'
  } = options;
  const { toast } = useToast();
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);

  const scanMutation = useMutation({
    mutationFn: async (code: string): Promise<ScanResult> => {
      const res = await apiRequest("POST", "/api/scans/ingest", { 
        code: code.trim(),
        source 
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to process scan");
      }
      
      return await res.json();
    },
    onSuccess: (result: ScanResult) => {
      setLastResult(result);
      
      if (showToasts) {
        switch (result.status) {
          case "PRODUCT_MATCH":
            toast({
              title: "Product Matched",
              description: result.item 
                ? `${result.item.name} (SKU: ${result.item.sku})`
                : result.message,
            });
            break;
            
          case "BIN_MATCH":
            toast({
              title: "Bin Matched",
              description: result.bin 
                ? `Bin: ${result.bin.name}`
                : result.message,
            });
            break;
            
          case "RETURN_RECEIVED":
            queryClient.invalidateQueries({ queryKey: ["/api/items"] });
            queryClient.invalidateQueries({ queryKey: ["/api/shippo-label-logs"] });
            queryClient.invalidateQueries({ queryKey: ["/api/returns"] });
            // Use inventoryUpdates for accurate count, fallback to skus
            const itemCount = result.inventoryUpdates?.length || result.skus?.length || 0;
            const rmaDisplay = result.rmaNumber || (result.returnRequestId ? `Return #${result.returnRequestId.slice(0, 8)}` : "Return");
            toast({
              title: "Return Received",
              description: `${rmaDisplay} - ${itemCount} item(s) added to inventory`,
              className: "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800",
            });
            break;
            
          case "ALREADY_RECEIVED":
            toast({
              title: "Already Received",
              description: result.message || "This return was already received",
              variant: "destructive",
            });
            break;
            
          case "LABEL_NOT_RETURN":
            toast({
              title: "Non-Return Label",
              description: result.message || "This label is not a return label",
            });
            break;
            
          case "UNKNOWN_CODE":
            toast({
              title: "Unknown Code",
              description: result.message || "Code not recognized",
              variant: "destructive",
            });
            break;
        }
      }
      
      onScanSuccess?.(result);
    },
    onError: (error: Error) => {
      setLastResult({ status: "ERROR", message: error.message });
      
      if (showToasts) {
        toast({
          title: "Scan Error",
          description: error.message || "Failed to process scan",
          variant: "destructive",
        });
      }
      
      onScanError?.(error);
    },
  });

  const scan = useCallback((code: string) => {
    if (!code.trim()) {
      if (showToasts) {
        toast({
          title: "Invalid Input",
          description: "Please enter a barcode or tracking number",
          variant: "destructive",
        });
      }
      return;
    }
    
    scanMutation.mutate(code);
  }, [scanMutation, showToasts, toast]);

  const reset = useCallback(() => {
    setLastResult(null);
    scanMutation.reset();
  }, [scanMutation]);

  return {
    scan,
    reset,
    lastResult,
    isScanning: scanMutation.isPending,
    isError: scanMutation.isError,
    error: scanMutation.error,
  };
}
