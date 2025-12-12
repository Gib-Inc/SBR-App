import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScanLine, Camera, Keyboard, Loader2 } from "lucide-react";
import { useScan } from "@/contexts/scan-context";
import { CameraBarcodeScanner } from "./camera-barcode-scanner";

type InputMode = "keyboard" | "camera";

export function ScanButton() {
  const [open, setOpen] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("keyboard");
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { scan, isScanning, lastResult } = useScan();

  useEffect(() => {
    if (open && inputMode === "keyboard" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open, inputMode]);

  useEffect(() => {
    if (!open) {
      setCode("");
    }
  }, [open]);

  useEffect(() => {
    if (lastResult && lastResult.status !== "PENDING_DAMAGE_ASSESSMENT") {
      if (lastResult.status === "RETURN_RECEIVED" || 
          lastResult.status === "PRODUCT_MATCH" || 
          lastResult.status === "BIN_MATCH") {
        setCode("");
        inputRef.current?.focus();
      }
    }
  }, [lastResult]);

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (code.trim()) {
      scan(code.trim());
    }
  }, [code, scan]);

  const handleCameraScan = useCallback((barcode: string) => {
    scan(barcode);
  }, [scan]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      <Button 
        variant="outline" 
        size="icon" 
        onClick={() => setOpen(true)}
        data-testid="button-scan"
      >
        <ScanLine className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5" />
              Scan
            </DialogTitle>
            <DialogDescription>
              Scan a barcode, SKU, or return tracking number
            </DialogDescription>
          </DialogHeader>

          <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as InputMode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="keyboard" className="flex items-center gap-2">
                <Keyboard className="h-4 w-4" />
                Keyboard
              </TabsTrigger>
              <TabsTrigger value="camera" className="flex items-center gap-2">
                <Camera className="h-4 w-4" />
                Camera
              </TabsTrigger>
            </TabsList>

            <TabsContent value="keyboard" className="space-y-4 pt-4">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="scan-input">Code</Label>
                  <Input
                    ref={inputRef}
                    id="scan-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Scan or type barcode/tracking number..."
                    autoComplete="off"
                    data-testid="input-scan-code"
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={isScanning || !code.trim()}
                  data-testid="button-process-scan"
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <ScanLine className="h-4 w-4 mr-2" />
                      Process Scan
                    </>
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="camera" className="pt-4">
              <CameraBarcodeScanner
                onScan={handleCameraScan}
                enabled={inputMode === "camera" && open}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
