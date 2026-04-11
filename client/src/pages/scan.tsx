import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowLeft,
  Camera,
  Loader2,
  Zap,
  AlertCircle,
  Package,
  CheckCircle2,
  Plus,
  Minus,
  MapPin,
  FileText,
  AlertTriangle,
} from 'lucide-react';

// ─── Type Definitions ──────────────────────────────────────────────────────

type ScanState = 'camera' | 'confirm' | 'quantity' | 'success';

interface Item {
  id: string;
  name: string;
  sku: string;
  upc: string;
  type: 'component' | 'finished_product';
  pivotQty: number;
  hildaleQty: number;
  currentStock: number;
  category: string;
  minStock: number;
}

interface LookupResponse {
  item: Item;
}

interface ReceiveResponse {
  success: boolean;
  message: string;
  item: Item;
  transaction: {
    id: string;
    itemId: string;
    quantity: number;
    location: string;
    notes?: string;
    createdAt: string;
  };
  previousStock: {
    pivotQty: number;
    hildaleQty: number;
    currentStock: number;
  };
  newStock: {
    pivotQty: number;
    hildaleQty: number;
    currentStock: number;
  };
  reorderAlert?: {
    triggered: boolean;
    currentStock?: number;
    reorderPoint?: number;
  };
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function ScanPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // State machine: camera -> confirm -> quantity -> success
  const [state, setState] = useState<ScanState>('camera');

  // Shared state across all states
  const [currentItem, setCurrentItem] = useState<Item | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Camera state
  const [quaggaLoaded, setQuaggaLoaded] = useState(false);
  const [isScanning, setIsScanning] = useState(true);
  const [manualUpc, setManualUpc] = useState('');
  const scannerRef = useRef<HTMLDivElement>(null);
  const quaggaRef = useRef<any>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Quantity state
  const [receiveQty, setReceiveQty] = useState(1);
  const [receiveLocation, setReceiveLocation] = useState<'PIVOT' | 'HILDALE'>('PIVOT');
  const [receiveNotes, setReceiveNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Success state
  const [lastResult, setLastResult] = useState<ReceiveResponse | null>(null);
  const successTimeoutRef = useRef<NodeJS.Timeout>();

  // ─── Effects: Load QuaggaJS Script ────────────────────────────────────

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js';
    script.onload = () => setQuaggaLoaded(true);
    script.onerror = () => {
      setError('Failed to load barcode scanner library. Use manual entry.');
      setQuaggaLoaded(false);
    };
    document.head.appendChild(script);

    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);

  // ─── Effects: Initialize/Cleanup Quagga When in Camera State ──────────

  useEffect(() => {
    if (state !== 'camera' || !quaggaLoaded || !scannerRef.current || !isScanning) {
      return;
    }

    const Quagga = (window as any).Quagga;
    if (!Quagga) return;

    let mounted = true;

    Quagga.init(
      {
        inputStream: {
          name: 'Live',
          type: 'LiveStream',
          target: scannerRef.current,
          constraints: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        decoder: {
          readers: ['upc_reader', 'upc_e_reader', 'ean_reader', 'ean_8_reader', 'code_128_reader'],
        },
        locate: true,
      },
      (err: any) => {
        if (err) {
          console.error('Quagga init error:', err);
          if (mounted) {
            setError('Camera access required. Please allow camera in browser settings.');
            setIsScanning(false);
          }
          return;
        }

        if (mounted) {
          Quagga.onDetected(handleDetection);
          Quagga.start();
          quaggaRef.current = Quagga;
        }
      }
    );

    return () => {
      mounted = false;
      try {
        if (quaggaRef.current) {
          quaggaRef.current.stop();
          quaggaRef.current.offDetected(handleDetection);
          quaggaRef.current = null;
        }
      } catch (e) {
        // ignore cleanup errors
      }
    };
  }, [state, quaggaLoaded, isScanning]);

  // ─── Effects: Auto-return to Camera State After 5 Seconds on Success ────

  useEffect(() => {
    if (state === 'success') {
      successTimeoutRef.current = setTimeout(() => {
        returnToCamera();
      }, 5000);
    }

    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, [state]);

  // ─── Handlers ──────────────────────────────────────────────────────────

  const handleDetection = (result: any) => {
    if (result?.codeResult?.code) {
      const scannedUpc = result.codeResult.code;
      // Debounce to avoid duplicate detections
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        performBarcodeLookup(scannedUpc);
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        setIsScanning(false);
      }, 300);
    }
  };

  const performBarcodeLookup = async (barcode: string) => {
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch(`/api/scan/lookup/${encodeURIComponent(barcode)}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 404) {
          setError('Barcode not recognized. Check the product list or enter manually.');
        } else {
          setError('Connection failed. Check your internet.');
        }
        setIsLoading(false);
        return;
      }

      const data: LookupResponse = await response.json();
      setCurrentItem(data.item);
      setState('confirm');
    } catch (err) {
      setError('Connection failed. Check your internet.');
      console.error('Lookup error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualUpc.trim()) return;
    await performBarcodeLookup(manualUpc.trim());
    setManualUpc('');
  };

  const handleConfirmItem = () => {
    setReceiveQty(1);
    setReceiveNotes('');
    setReceiveLocation('PIVOT');
    setState('quantity');
  };

  const handleBackFromConfirm = () => {
    setCurrentItem(null);
    setError('');
    setIsScanning(true);
    setState('camera');
  };

  const handleReceiveStock = async () => {
    if (!currentItem || receiveQty < 1) return;

    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/inventory/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          itemId: currentItem.id,
          quantity: receiveQty,
          location: receiveLocation,
          notes: receiveNotes || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to receive stock');
      }

      const result: ReceiveResponse = await response.json();
      setLastResult(result);
      setCurrentItem(result.item);
      setState('success');

      // Vibrate for success
      if (navigator.vibrate) navigator.vibrate([50, 50, 50, 50, 200]);

      // Invalidate items cache
      queryClient.invalidateQueries({ queryKey: ['items'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to receive stock');
    } finally {
      setIsSubmitting(false);
    }
  };

  const returnToCamera = () => {
    setCurrentItem(null);
    setLastResult(null);
    setError('');
    setManualUpc('');
    setIsScanning(true);
    setState('camera');
  };

  // ─── Derived Values ───────────────────────────────────────────────────

  const totalStock = currentItem
    ? (currentItem.pivotQty || 0) + (currentItem.hildaleQty || 0)
    : 0;

  const newTotalStock = lastResult
    ? (lastResult.newStock.pivotQty || 0) + (lastResult.newStock.hildaleQty || 0)
    : 0;

  const prevTotalStock = lastResult
    ? (lastResult.previousStock.pivotQty || 0) + (lastResult.previousStock.hildaleQty || 0)
    : 0;

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-slate-950">
      {/* Header with back button and SBR branding */}
      <div className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation('/')}
          className="gap-2 text-white hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Home</span>
        </Button>
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-green-500" />
          <h1 className="text-lg font-semibold text-white">SBR Scanner</h1>
        </div>
        <div className="w-10" />
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto flex flex-col">
        {state === 'camera' && (
          /* ─── STATE 1: CAMERA VIEW ──────────────────────────────────── */
          <div className="flex-1 flex flex-col min-h-0">
            {/* Camera feed */}
            {isScanning && quaggaLoaded && (
              <div className="relative flex-1 bg-black overflow-hidden">
                <div ref={scannerRef} className="w-full h-full" />
                {/* Scan frame overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-1/4 left-1/4 w-16 h-16 border-t-4 border-l-4 border-green-500" />
                  <div className="absolute top-1/4 right-1/4 w-16 h-16 border-t-4 border-r-4 border-green-500" />
                  <div className="absolute bottom-1/4 left-1/4 w-16 h-16 border-b-4 border-l-4 border-green-500" />
                  <div className="absolute bottom-1/4 right-1/4 w-16 h-16 border-b-4 border-r-4 border-green-500" />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <div className="w-1 h-8 bg-red-500 opacity-75 absolute left-1/2 -translate-x-1/2" />
                    <div className="w-8 h-1 bg-red-500 opacity-75 absolute top-1/2 -translate-y-1/2" />
                  </div>
                  <div className="absolute bottom-8 left-0 right-0 text-center">
                    <p className="text-white text-sm font-medium drop-shadow-lg animate-pulse">
                      Point camera at barcode
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Loading indicator */}
            {!quaggaLoaded && !error && (
              <div className="flex-1 flex items-center justify-center bg-slate-900 px-4">
                <div className="text-center space-y-4">
                  <Loader2 className="w-12 h-12 animate-spin text-green-500 mx-auto" />
                  <p className="text-slate-300">Loading scanner...</p>
                </div>
              </div>
            )}

            {/* Manual entry section */}
            <div className="bg-slate-900 border-t border-slate-800 p-4 space-y-3">
              <form onSubmit={handleManualEntry} className="space-y-2">
                <label className="text-xs font-medium text-slate-400">Or enter UPC manually</label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="Enter UPC code"
                    value={manualUpc}
                    onChange={(e) => setManualUpc(e.target.value)}
                    className="flex-1 text-lg h-12 bg-slate-800 border-slate-700 text-white placeholder-slate-500"
                  />
                  <Button
                    type="submit"
                    size="lg"
                    className="px-6 h-12 bg-green-600 hover:bg-green-700 text-white"
                    disabled={!manualUpc.trim() || isLoading}
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                  </Button>
                </div>
              </form>

              {/* Error display */}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-950 rounded-lg border border-red-800">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              {/* Restart camera button */}
              {quaggaLoaded && !isScanning && (
                <Button
                  variant="outline"
                  className="w-full h-12 bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
                  onClick={() => setIsScanning(true)}
                >
                  <Camera className="w-4 h-4 mr-2" />
                  Start Camera
                </Button>
              )}
            </div>
          </div>
        )}

        {state === 'confirm' && currentItem && (
          /* ─── STATE 2: CONFIRM ITEM ─────────────────────────────────── */
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* Item card */}
            <Card className="border-2 border-green-600 bg-slate-900 border-slate-800">
              <div className="p-4 space-y-4">
                {/* Product name */}
                <div className="space-y-2">
                  <h2 className="text-3xl font-bold text-white">{currentItem.name}</h2>
                  <Badge className="bg-blue-600 text-white text-sm">
                    {currentItem.type === 'finished_product' ? 'Finished Product' : 'Component'}
                  </Badge>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-800 rounded-lg p-3 space-y-1">
                    <p className="text-xs font-medium text-slate-400">SKU</p>
                    <p className="text-base font-mono font-semibold text-green-400 truncate">
                      {currentItem.sku}
                    </p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-3 space-y-1">
                    <p className="text-xs font-medium text-slate-400">UPC</p>
                    <p className="text-base font-mono font-semibold text-slate-300">
                      {currentItem.upc}
                    </p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-3 space-y-1">
                    <p className="text-xs font-medium text-slate-400">Category</p>
                    <p className="text-sm font-medium text-slate-300">{currentItem.category || 'N/A'}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-3 space-y-1">
                    <p className="text-xs font-medium text-slate-400">Min Stock</p>
                    <p className="text-sm font-medium text-slate-300">{currentItem.minStock}</p>
                  </div>
                </div>

                {/* Stock levels section */}
                <div className="bg-slate-800 rounded-lg p-4 space-y-3 border border-slate-700">
                  <h3 className="font-semibold text-white">Stock Levels</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between py-2 border-b border-slate-700">
                      <span className="text-sm text-slate-400">Pivot</span>
                      <span className="text-2xl font-bold text-white">{currentItem.pivotQty}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-slate-700">
                      <span className="text-sm text-slate-400">Hildale</span>
                      <span className="text-2xl font-bold text-white">{currentItem.hildaleQty}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 bg-green-950 -mx-4 -mb-4 px-4 py-3 rounded-b-lg">
                      <span className="font-semibold text-white">Total</span>
                      <span className="text-3xl font-bold text-green-500">{totalStock}</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {state === 'quantity' && currentItem && (
          /* ─── STATE 3: ENTER QUANTITY ──────────────────────────────── */
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <Card className="border-2 border-blue-600 bg-slate-900 border-slate-800">
              <div className="p-4 space-y-6">
                {/* Quantity input section */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-white">Quantity to Receive</label>
                  <div className="flex items-center justify-center gap-4">
                    <Button
                      variant="outline"
                      className="w-16 h-16 text-2xl bg-slate-800 border-slate-700 hover:bg-slate-700"
                      onClick={() => setReceiveQty(Math.max(1, receiveQty - 1))}
                      disabled={receiveQty <= 1}
                    >
                      <Minus className="w-6 h-6 text-white" />
                    </Button>
                    <Input
                      type="number"
                      min={1}
                      value={receiveQty}
                      onChange={(e) => setReceiveQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-24 h-16 text-3xl font-bold text-center bg-slate-800 border-slate-700 text-white rounded-xl"
                    />
                    <Button
                      variant="outline"
                      className="w-16 h-16 text-2xl bg-slate-800 border-slate-700 hover:bg-slate-700"
                      onClick={() => setReceiveQty(receiveQty + 1)}
                    >
                      <Plus className="w-6 h-6 text-white" />
                    </Button>
                  </div>

                  {/* Quick qty buttons */}
                  <div className="flex gap-2 justify-center pt-2">
                    {[5, 10, 25, 50, 100].map((q) => (
                      <Button
                        key={q}
                        variant={receiveQty === q ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setReceiveQty(q)}
                        className={
                          receiveQty === q
                            ? 'bg-green-600 hover:bg-green-700 text-white'
                            : 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700'
                        }
                      >
                        {q}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Location selector */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-white flex items-center gap-2">
                    <MapPin className="w-4 h-4" /> Receive Location
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      className={`h-14 text-base font-semibold ${
                        receiveLocation === 'PIVOT'
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700'
                      }`}
                      variant={receiveLocation === 'PIVOT' ? 'default' : 'outline'}
                      onClick={() => setReceiveLocation('PIVOT')}
                    >
                      Pivot
                    </Button>
                    <Button
                      className={`h-14 text-base font-semibold ${
                        receiveLocation === 'HILDALE'
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700'
                      }`}
                      variant={receiveLocation === 'HILDALE' ? 'default' : 'outline'}
                      onClick={() => setReceiveLocation('HILDALE')}
                    >
                      Hildale
                    </Button>
                  </div>
                </div>

                {/* Notes section */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-white flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Notes (optional)
                  </label>
                  <Textarea
                    placeholder="e.g. PO #1234, from supplier..."
                    value={receiveNotes}
                    onChange={(e) => setReceiveNotes(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white placeholder-slate-500 text-base"
                    rows={2}
                  />
                </div>
              </div>
            </Card>
          </div>
        )}

        {state === 'success' && lastResult && currentItem && (
          /* ─── STATE 4: SUCCESS ──────────────────────────────────────── */
          <div className="flex-1 overflow-auto p-4 space-y-4 flex flex-col items-center justify-center">
            {/* Big checkmark */}
            <div className="mb-4">
              <CheckCircle2 className="w-24 h-24 text-green-500" />
            </div>

            {/* Success message */}
            <Card className="w-full max-w-sm border-2 border-green-600 bg-slate-900 border-slate-800">
              <div className="p-6 space-y-4 text-center">
                <h2 className="text-2xl font-bold text-green-500">Stock Received!</h2>
                <p className="text-white text-lg">{currentItem.name}</p>
                <p className="text-slate-300">
                  {receiveQty} units at <span className="font-semibold text-green-400">{receiveLocation}</span>
                </p>

                {/* Stock comparison */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="bg-slate-800 rounded-lg p-3 space-y-1">
                    <p className="text-xs text-slate-400">Before</p>
                    <p className="text-2xl font-bold text-slate-300">{prevTotalStock}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-3 space-y-1">
                    <p className="text-xs text-slate-400">After</p>
                    <p className="text-2xl font-bold text-green-500">{newTotalStock}</p>
                  </div>
                </div>

                {/* Reorder alert if needed */}
                {lastResult.reorderAlert?.triggered && (
                  <div className="flex items-start gap-2 p-3 bg-amber-950 rounded-lg border border-amber-800 mt-4">
                    <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div className="text-left">
                      <p className="text-sm font-semibold text-amber-300">Still below reorder point</p>
                      <p className="text-xs text-amber-200">
                        {lastResult.reorderAlert.currentStock}/{lastResult.reorderAlert.reorderPoint}
                      </p>
                    </div>
                  </div>
                )}

                <p className="text-sm text-slate-400 pt-2">Returning to camera in 5 seconds...</p>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Bottom action buttons */}
      {state === 'confirm' && currentItem && (
        <div className="sticky bottom-0 bg-slate-900 border-t border-slate-800 p-4 space-y-2">
          <Button
            onClick={handleConfirmItem}
            className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700 text-white rounded-lg"
          >
            <Package className="w-6 h-6 mr-2" />
            Receive Stock
          </Button>
          <Button
            onClick={handleBackFromConfirm}
            variant="outline"
            className="w-full h-12 bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
          >
            Not This Item?
          </Button>
        </div>
      )}

      {state === 'quantity' && (
        <div className="sticky bottom-0 bg-slate-900 border-t border-slate-800 p-4 space-y-2">
          <Button
            onClick={handleReceiveStock}
            disabled={isSubmitting || receiveQty < 1}
            className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700 text-white rounded-lg"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Receiving...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5 mr-2" />
                Receive {receiveQty} {receiveQty === 1 ? 'Unit' : 'Units'}
              </>
            )}
          </Button>
          <Button
            onClick={() => setState('confirm')}
            variant="outline"
            className="w-full h-12 bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
            disabled={isSubmitting}
          >
            Back
          </Button>
        </div>
      )}

      {state === 'success' && (
        <div className="sticky bottom-0 bg-slate-900 border-t border-slate-800 p-4">
          <Button
            onClick={returnToCamera}
            className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700 text-white rounded-lg"
          >
            <Camera className="w-6 h-6 mr-2" />
            Scan Another
          </Button>
        </div>
      )}
    </div>
  );
}
