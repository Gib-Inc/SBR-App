import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, X, AlertTriangle, Package, Camera, Keyboard, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CameraBarcodeScanner } from "./camera-barcode-scanner";
import type { Item } from "@shared/schema";

type ScanMode = "RAW" | "FINISHED";
type ScanContext = "BARCODES_PAGE" | "BOM_PAGE";

interface RecentScan {
  timestamp: Date;
  barcodeValue: string;
  itemName: string;
  sku: string;
  quantity: number;
  success: boolean;
  error?: string;
}

interface ScanInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: ScanMode;
  context: ScanContext;
  onModeChange?: (mode: ScanMode) => void;
}

type InputMode = "keyboard" | "camera";

export function ScanInventoryModal({
  isOpen,
  onClose,
  mode,
  context,
  onModeChange
}: ScanInventoryModalProps) {
  const [barcodeValue, setBarcodeValue] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>("keyboard");
  const [matchedItem, setMatchedItem] = useState<Item | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  // Auto-refocus input after each scan
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, recentScans]);

  // Fetch items for validation
  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ['/api/items'],
    enabled: isOpen,
  });

  // Clear form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setBarcodeValue("");
      setQuantity("1");
      setRecentScans([]);
      setValidationError(null);
      setInputMode("keyboard");
      setMatchedItem(null);
      setIsLookingUp(false);
    }
  }, [isOpen]);

  // Lookup item when barcode changes
  const lookupItem = useCallback((barcode: string) => {
    if (!barcode.trim() || !items.length) {
      setMatchedItem(null);
      return;
    }
    
    setIsLookingUp(true);
    const trimmedBarcode = barcode.trim();
    const found = items.find((i: Item) => 
      i.barcodeValue === trimmedBarcode || 
      i.sku === trimmedBarcode ||
      i.barcode === trimmedBarcode
    );
    setMatchedItem(found || null);
    setIsLookingUp(false);
    
    if (!found) {
      setValidationError(`No item found matching "${trimmedBarcode}"`);
    } else {
      setValidationError(null);
    }
  }, [items]);

  // Handle barcode value change with item lookup
  const handleBarcodeChange = useCallback((value: string) => {
    setBarcodeValue(value);
    if (value.trim().length >= 3) {
      lookupItem(value);
    } else {
      setMatchedItem(null);
      setValidationError(null);
    }
  }, [lookupItem]);

  // Handle camera scan
  const handleCameraScan = useCallback((barcode: string) => {
    setBarcodeValue(barcode);
    lookupItem(barcode);
    
    toast({
      title: "Barcode Scanned",
      description: `Detected: ${barcode}`,
    });
  }, [lookupItem, toast]);

  const scanMutation = useMutation({
    mutationFn: async (data: { 
      barcodeValue: string; 
      quantity: number;
      mode: ScanMode;
    }) => {
      // Find the item by barcode (same lookup as UI preview)
      const trimmedValue = data.barcodeValue.trim();
      const item = items.find(i => 
        i.barcodeValue === trimmedValue || 
        i.sku === trimmedValue ||
        i.barcode === trimmedValue
      );
      
      if (!item) {
        throw new Error("Barcode not found in system");
      }

      // Validate mode matches item type
      const itemKind = item.type === 'finished_product' ? 'FINISHED' : 'RAW';
      if (itemKind !== data.mode) {
        throw new Error(
          `This barcode belongs to a ${itemKind === 'FINISHED' ? 'Finished Product' : 'Raw Material'}, but you're in ${data.mode === 'FINISHED' ? 'Finished Products' : 'Raw Materials'} mode.`
        );
      }

      // Call appropriate transaction endpoint based on mode
      if (data.mode === 'RAW') {
        // Raw materials: RECEIVE transaction (use HILDALE as default location for stock inventory)
        const res = await apiRequest("POST", "/api/transactions", {
          itemId: item.id,
          itemType: 'RAW',
          type: 'RECEIVE',
          location: 'HILDALE',
          quantity: data.quantity,
          notes: `Scanned via BOM page - Raw Materials received at Hildale`,
        });
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || "Failed to create RECEIVE transaction");
        }
        return { item, transaction: await res.json() };
      } else {
        // Finished products: PRODUCE transaction
        const res = await apiRequest("POST", "/api/transactions/produce", {
          finishedProductId: item.id,
          quantity: data.quantity,
          notes: `Scanned via BOM page - Finished products produced at Hildale`,
        });
        if (!res.ok) {
          const error = await res.json();
          // Handle component shortage errors
          const errorMessage = error.error || error.message || "Failed to create PRODUCE transaction";
          if (errorMessage.includes("Insufficient") || errorMessage.includes("stock")) {
            throw new Error(`Cannot produce: ${errorMessage}`);
          }
          throw new Error(errorMessage);
        }
        return { item, transaction: await res.json() };
      }
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      
      // Add to recent scans
      const newScan: RecentScan = {
        timestamp: new Date(),
        barcodeValue: variables.barcodeValue,
        itemName: data.item.name,
        sku: data.item.sku,
        quantity: variables.quantity,
        success: true,
      };
      setRecentScans(prev => [newScan, ...prev].slice(0, 15));
      
      // Show success banner
      setShowSuccessBanner(true);
      setTimeout(() => setShowSuccessBanner(false), 3000);
      
      const actionType = variables.mode === 'RAW' ? 'Received' : 'Produced';
      toast({
        title: "Scan Successful",
        description: `${actionType} ${variables.quantity}x ${data.item.name} (SKU: ${data.item.sku})`,
      });
      
      // Clear inputs
      setBarcodeValue("");
      setQuantity("1");
      setValidationError(null);
    },
    onError: (error: any, variables) => {
      const failedScan: RecentScan = {
        timestamp: new Date(),
        barcodeValue: variables.barcodeValue,
        itemName: "Scan Failed",
        sku: "-",
        quantity: variables.quantity,
        success: false,
        error: error.message,
      };
      setRecentScans(prev => [failedScan, ...prev].slice(0, 15));
      
      setValidationError(error.message);
      
      toast({
        title: "Scan Failed",
        description: error.message || "Failed to process barcode",
        variant: "destructive",
      });
    },
  });

  const handleScan = () => {
    const trimmedBarcode = barcodeValue.trim();
    const qty = parseInt(quantity, 10);
    
    if (!trimmedBarcode) {
      setValidationError("Please enter a barcode");
      return;
    }
    
    if (isNaN(qty) || qty <= 0) {
      setValidationError("Quantity must be a positive number");
      return;
    }
    
    setValidationError(null);
    scanMutation.mutate({ 
      barcodeValue: trimmedBarcode, 
      quantity: qty,
      mode
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScan();
    }
  };

  const handleClose = () => {
    if (recentScans.length > 0) {
      const successfulScans = recentScans.filter(s => s.success).length;
      if (successfulScans > 0) {
        toast({
          title: "Scanning Session Complete",
          description: `Processed ${successfulScans} successful scan${successfulScans !== 1 ? 's' : ''}`,
        });
      }
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Scan Inventory</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              data-testid="button-close-scan-modal"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Mode Indicator and Toggle */}
          <div className="flex items-center justify-between gap-4 p-4 rounded-lg border bg-muted/50">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              <span className="font-medium">Current Mode:</span>
              <Badge 
                variant={mode === 'FINISHED' ? 'default' : 'secondary'}
                className="text-sm"
                data-testid="badge-scan-mode"
              >
                {mode === 'FINISHED' ? 'Finished Products' : 'Raw Materials'}
              </Badge>
            </div>
            
            {onModeChange && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onModeChange(mode === 'RAW' ? 'FINISHED' : 'RAW')}
                data-testid="button-toggle-mode"
              >
                Switch to {mode === 'RAW' ? 'Finished Products' : 'Raw Materials'}
              </Button>
            )}
          </div>

          {/* Success Banner */}
          {showSuccessBanner && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                Item scanned successfully! Ready for next scan.
              </AlertDescription>
            </Alert>
          )}

          {/* Validation Error */}
          {validationError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          {/* Scan Input Section with Tabs */}
          <div className="space-y-4 p-4 rounded-lg border">
            <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as InputMode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="keyboard" className="gap-2" data-testid="tab-keyboard">
                  <Keyboard className="h-4 w-4" />
                  Scanner / Manual
                </TabsTrigger>
                <TabsTrigger value="camera" className="gap-2" data-testid="tab-camera">
                  <Camera className="h-4 w-4" />
                  Camera
                </TabsTrigger>
              </TabsList>

              <TabsContent value="keyboard" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="barcode-input">Barcode Value</Label>
                  <Input
                    id="barcode-input"
                    ref={inputRef}
                    value={barcodeValue}
                    onChange={(e) => handleBarcodeChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Scan or enter barcode..."
                    disabled={scanMutation.isPending}
                    data-testid="input-scan-barcode"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use hardware barcode scanner or type manually
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="camera" className="mt-4">
                <CameraBarcodeScanner
                  onScan={handleCameraScan}
                  enabled={inputMode === "camera" && isOpen}
                />
              </TabsContent>
            </Tabs>

            {/* Matched Item Preview */}
            {matchedItem && (
              <div className="p-3 rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-800 dark:text-green-200">Item Found</span>
                </div>
                <div className="text-sm">
                  <span className="font-medium">{matchedItem.name}</span>
                  <span className="text-muted-foreground ml-2">SKU: {matchedItem.sku}</span>
                  {matchedItem.type && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      {matchedItem.type === 'finished_product' ? 'Finished' : 'Raw'}
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {/* Looking up indicator */}
            {isLookingUp && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Looking up barcode...
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="quantity-input">Quantity</Label>
              <Input
                id="quantity-input"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={scanMutation.isPending}
                data-testid="input-scan-quantity"
              />
              <p className="text-xs text-muted-foreground">
                {mode === 'RAW' 
                  ? 'Number of units received' 
                  : 'Number of units produced (components will be consumed per BOM)'}
              </p>
            </div>

            <Button
              onClick={handleScan}
              disabled={scanMutation.isPending || !barcodeValue.trim()}
              className="w-full"
              data-testid="button-process-scan"
            >
              {scanMutation.isPending ? 'Processing...' : 'Process Scan'}
            </Button>
          </div>

          {/* Recent Scans Log */}
          {recentScans.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-medium">Recent Scans (This Session)</h3>
              <div className="rounded-lg border max-h-64 overflow-auto">
                <table className="w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2 text-sm font-medium">Time</th>
                      <th className="text-left p-2 text-sm font-medium">Item</th>
                      <th className="text-left p-2 text-sm font-medium">SKU</th>
                      <th className="text-right p-2 text-sm font-medium">Qty</th>
                      <th className="text-left p-2 text-sm font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentScans.map((scan, idx) => (
                      <tr 
                        key={idx} 
                        className="border-b last:border-0"
                        data-testid={`row-scan-${idx}`}
                      >
                        <td className="p-2 text-xs text-muted-foreground">
                          {scan.timestamp.toLocaleTimeString()}
                        </td>
                        <td className="p-2 text-sm">{scan.itemName}</td>
                        <td className="p-2 text-sm font-mono">{scan.sku}</td>
                        <td className="p-2 text-sm text-right">{scan.quantity}</td>
                        <td className="p-2">
                          {scan.success ? (
                            <Badge variant="default" className="text-xs">Success</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              {scan.error ? 'Mode Error' : 'Failed'}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            {recentScans.filter(s => s.success).length} successful scans this session
          </p>
          <Button
            onClick={handleClose}
            data-testid="button-finish-session"
          >
            Finish Session
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
