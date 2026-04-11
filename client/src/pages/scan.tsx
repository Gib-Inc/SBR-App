import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Clock,
  Package,
  DollarSign,
  CheckCircle2,
  Plus,
  Minus,
  MapPin,
  FileText,
  X,
} from 'lucide-react';

interface Item {
  id: string;
  name: string;
  sku: string;
  upc: string;
  type: 'component' | 'finished_product';
  pivotQty: number;
  hildaleQty: number;
  currentStock: number;
  sellingPrice: number;
  category: string;
  productKind: string;
  minStock: number;
}

interface ScannedItem {
  item: Item | null;
  timestamp: Date;
  upc: string;
  error?: string;
}

interface ReceiveResult {
  success: boolean;
  message: string;
  item: Item;
  previousStock: { pivotQty: number; hildaleQty: number; currentStock: number };
  newStock: { pivotQty: number; hildaleQty: number; currentStock: number };
}

export default function ScanPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [quaggaLoaded, setQuaggaLoaded] = useState(false);
  const [isScanning, setIsScanning] = useState(true);
  const [manualUpc, setManualUpc] = useState('');
  const [recentScans, setRecentScans] = useState<ScannedItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [error, setError] = useState('');
  const scannerRef = useRef<HTMLDivElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const quaggaRef = useRef<any>(null);

  // Receive Stock state
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [receiveQty, setReceiveQty] = useState(1);
  const [receiveLocation, setReceiveLocation] = useState<'PIVOT' | 'HILDALE'>('PIVOT');
  const [receiveNotes, setReceiveNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receiveResult, setReceiveResult] = useState<ReceiveResult | null>(null);

  // Fetch all items on mount
  const { data: items = [] } = useQuery({
    queryKey: ['items'],
    queryFn: async () => {
      const response = await fetch('/api/items');
      if (!response.ok) throw new Error('Failed to fetch items');
      return response.json();
    },
  });

  // Load QuaggaJS script
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js';
    script.onload = () => setQuaggaLoaded(true);
    script.onerror = () => setError('Failed to load barcode scanner library');
    document.head.appendChild(script);
    return () => {
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, []);

  // Initialize Quagga when loaded and scanning
  useEffect(() => {
    if (!quaggaLoaded || !scannerRef.current || !isScanning) return;

    const Quagga = (window as any).Quagga;
    if (!Quagga) return;

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
          setError('Camera access failed. Check permissions or try manual entry.');
          setIsScanning(false);
          return;
        }
        Quagga.onDetected(handleDetection);
        Quagga.start();
        quaggaRef.current = Quagga;
      }
    );

    return () => {
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
  }, [quaggaLoaded, isScanning]);

  const handleDetection = (result: any) => {
    if (result?.codeResult?.code) {
      const scannedUpc = result.codeResult.code;
      processBarcode(scannedUpc);
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      setIsScanning(false);
    }
  };

  const processBarcode = (upc: string) => {
    const foundItem = items.find((item: Item) => item.upc === upc);
    const scannedItem: ScannedItem = {
      item: foundItem || null,
      timestamp: new Date(),
      upc,
      error: foundItem ? undefined : `No item found for UPC: ${upc}`,
    };
    setRecentScans((prev) => [scannedItem, ...prev.slice(0, 9)]);
    setSelectedItem(foundItem || null);
    setError(scannedItem.error || '');
    setShowReceiveForm(false);
    setReceiveResult(null);
    setReceiveQty(1);
    setReceiveNotes('');
    if (foundItem) window.scrollTo(0, 0);
  };

  const handleManualEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualUpc.trim()) {
      processBarcode(manualUpc.trim());
      setManualUpc('');
    }
  };

  const handleScanAgain = () => {
    setSelectedItem(null);
    setError('');
    setManualUpc('');
    setShowReceiveForm(false);
    setReceiveResult(null);
    setReceiveQty(1);
    setReceiveNotes('');
    setIsScanning(true);
  };

  const handleReceiveStock = async () => {
    if (!selectedItem || receiveQty < 1) return;
    setIsSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/inventory/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: selectedItem.id,
          quantity: receiveQty,
          location: receiveLocation,
          notes: receiveNotes || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to receive stock');
      }

      const result: ReceiveResult = await res.json();
      setReceiveResult(result);
      setShowReceiveForm(false);

      // Update the selected item with new stock values
      setSelectedItem(result.item);

      // Invalidate the items cache so future scans have fresh data
      queryClient.invalidateQueries({ queryKey: ['items'] });

      // Vibrate for success
      if (navigator.vibrate) navigator.vibrate([50, 50, 50, 50, 200]);
    } catch (err: any) {
      setError(err.message || 'Failed to receive stock');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (price: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price);

  const getTypeColor = (type: string) =>
    type === 'finished_product'
      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';

  const getTypeBadgeText = (type: string) =>
    type === 'finished_product' ? 'Finished Product' : 'Component';

  const totalStock = selectedItem
    ? (selectedItem.pivotQty || 0) + (selectedItem.hildaleQty || 0)
    : 0;

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-950">
      {/* ── Header ────────────────────────────────────── */}
      <div className="sticky top-0 z-40 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setLocation('/barcodes')} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Back</span>
        </Button>
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Barcode Scanner</h1>
        </div>
        <div className="w-10" />
      </div>

      {/* ── Main Content ──────────────────────────────── */}
      <div className="flex-1 overflow-auto flex flex-col">
        {!selectedItem ? (
          /* ── Scanner View ──────────────────────────── */
          <div className="flex-1 flex flex-col min-h-0">
            {isScanning && quaggaLoaded && (
              <div className="relative flex-1 bg-black overflow-hidden">
                <div ref={scannerRef} className="w-full h-full" />
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-1/4 left-1/4 w-16 h-16 border-t-4 border-l-4 border-green-400" />
                  <div className="absolute top-1/4 right-1/4 w-16 h-16 border-t-4 border-r-4 border-green-400" />
                  <div className="absolute bottom-1/4 left-1/4 w-16 h-16 border-b-4 border-l-4 border-green-400" />
                  <div className="absolute bottom-1/4 right-1/4 w-16 h-16 border-b-4 border-r-4 border-green-400" />
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

            {!quaggaLoaded && !error && (
              <div className="flex-1 flex items-center justify-center bg-slate-100 dark:bg-slate-900 px-4">
                <div className="text-center space-y-4">
                  <Loader2 className="w-12 h-12 animate-spin text-blue-600 dark:text-blue-400 mx-auto" />
                  <p className="text-slate-600 dark:text-slate-300">Loading scanner...</p>
                </div>
              </div>
            )}

            {/* Manual Entry */}
            <div className="bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <form onSubmit={handleManualEntry} className="space-y-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Or enter UPC manually
                </label>
                <div className="flex gap-2">
                  <Input
                    ref={manualInputRef}
                    type="text"
                    inputMode="numeric"
                    placeholder="Enter UPC code"
                    value={manualUpc}
                    onChange={(e) => setManualUpc(e.target.value)}
                    className="flex-1 text-lg h-12"
                  />
                  <Button type="submit" size="lg" className="px-6 h-12" disabled={!manualUpc.trim()}>
                    <Zap className="w-5 h-5" />
                  </Button>
                </div>
              </form>

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                </div>
              )}

              {quaggaLoaded && !isScanning && (
                <Button variant="outline" className="w-full h-12" onClick={() => setIsScanning(true)}>
                  <Camera className="w-4 h-4 mr-2" />
                  Start Camera
                </Button>
              )}
            </div>
          </div>
        ) : (
          /* ── Item Result View ──────────────────────── */
          <div className="flex-1 overflow-auto p-4 space-y-4 pb-48">
            {/* ── Success Banner (after receiving stock) ── */}
            {receiveResult && (
              <div className="bg-green-50 dark:bg-green-950 border-2 border-green-400 dark:border-green-600 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400 flex-shrink-0" />
                  <div>
                    <p className="font-bold text-green-800 dark:text-green-200 text-lg">
                      Stock Received!
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      {receiveResult.message}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-2 text-center">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Before</p>
                    <p className="text-lg font-bold text-slate-500">
                      {(receiveResult.previousStock.pivotQty || 0) + (receiveResult.previousStock.hildaleQty || 0)}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-2 text-center">
                    <p className="text-xs text-slate-500 dark:text-slate-400">After</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">
                      {(receiveResult.newStock.pivotQty || 0) + (receiveResult.newStock.hildaleQty || 0)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Item Details Card ──────────────────── */}
            <Card className={`border-2 ${receiveResult ? 'border-slate-200 dark:border-slate-700' : 'border-green-500 dark:border-green-600 bg-green-50 dark:bg-green-950'}`}>
              <div className="p-4 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white pr-2">
                      {selectedItem.name}
                    </h2>
                    <Badge className={`flex-shrink-0 ${getTypeColor(selectedItem.type)}`}>
                      {getTypeBadgeText(selectedItem.type)}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-3 space-y-1">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">SKU</p>
                    <p className="text-base font-mono font-semibold text-slate-900 dark:text-white truncate">
                      {selectedItem.sku}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-3 space-y-1">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">UPC</p>
                    <p className="text-base font-mono font-semibold text-slate-900 dark:text-white">
                      {selectedItem.upc}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Price</p>
                    </div>
                    <p className="text-base font-semibold text-green-700 dark:text-green-400">
                      {formatCurrency(selectedItem.sellingPrice)}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-3 space-y-1">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Category</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      {selectedItem.category || '—'}
                    </p>
                  </div>
                </div>

                {/* Stock Levels */}
                <div className="bg-white dark:bg-slate-800 rounded-lg p-4 space-y-3 border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <h3 className="font-semibold text-slate-900 dark:text-white">Stock Levels</h3>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                      <span className="text-sm text-slate-600 dark:text-slate-400">Pivot</span>
                      <span className="text-xl font-bold text-slate-900 dark:text-white">
                        {selectedItem.pivotQty ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                      <span className="text-sm text-slate-600 dark:text-slate-400">Hildale</span>
                      <span className="text-xl font-bold text-slate-900 dark:text-white">
                        {selectedItem.hildaleQty ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 bg-blue-50 dark:bg-blue-900/30 -mx-4 -mb-4 px-4 py-3 rounded-b-lg">
                      <span className="font-semibold text-slate-900 dark:text-white">Total</span>
                      <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalStock}</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* ── Receive Stock Form (expanded) ──────── */}
            {showReceiveForm && (
              <Card className="border-2 border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950">
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Package className="w-5 h-5 text-blue-600" />
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">Receive Stock</h3>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setShowReceiveForm(false)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Quantity Stepper — BIG for Clarence */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Quantity Received
                    </label>
                    <div className="flex items-center justify-center gap-4">
                      <Button
                        variant="outline"
                        size="lg"
                        className="w-16 h-16 text-2xl rounded-xl"
                        onClick={() => setReceiveQty(Math.max(1, receiveQty - 1))}
                        disabled={receiveQty <= 1}
                      >
                        <Minus className="w-6 h-6" />
                      </Button>
                      <Input
                        type="number"
                        min={1}
                        value={receiveQty}
                        onChange={(e) => setReceiveQty(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-24 h-16 text-3xl font-bold text-center rounded-xl"
                      />
                      <Button
                        variant="outline"
                        size="lg"
                        className="w-16 h-16 text-2xl rounded-xl"
                        onClick={() => setReceiveQty(receiveQty + 1)}
                      >
                        <Plus className="w-6 h-6" />
                      </Button>
                    </div>
                    {/* Quick quantity buttons */}
                    <div className="flex gap-2 justify-center pt-1">
                      {[5, 10, 25, 50].map((q) => (
                        <Button
                          key={q}
                          variant={receiveQty === q ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setReceiveQty(q)}
                          className="px-4"
                        >
                          {q}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Location Picker */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <MapPin className="w-4 h-4" /> Location
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        variant={receiveLocation === 'PIVOT' ? 'default' : 'outline'}
                        className={`h-14 text-base font-semibold ${
                          receiveLocation === 'PIVOT'
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : ''
                        }`}
                        onClick={() => setReceiveLocation('PIVOT')}
                      >
                        Pivot
                      </Button>
                      <Button
                        variant={receiveLocation === 'HILDALE' ? 'default' : 'outline'}
                        className={`h-14 text-base font-semibold ${
                          receiveLocation === 'HILDALE'
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : ''
                        }`}
                        onClick={() => setReceiveLocation('HILDALE')}
                      >
                        Hildale
                      </Button>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <FileText className="w-4 h-4" /> Notes (optional)
                    </label>
                    <Textarea
                      placeholder="e.g. PO #1234, from FX Industries..."
                      value={receiveNotes}
                      onChange={(e) => setReceiveNotes(e.target.value)}
                      className="text-base"
                      rows={2}
                    />
                  </div>

                  {/* Submit Button */}
                  <Button
                    onClick={handleReceiveStock}
                    disabled={isSubmitting || receiveQty < 1}
                    className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700 text-white rounded-xl"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Receiving...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5 mr-2" />
                        Receive {receiveQty} {receiveQty === 1 ? 'unit' : 'units'} at {receiveLocation}
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            )}

            {/* Error display */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            {/* Recent Scans */}
            {recentScans.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400">Recent Scans</h3>
                </div>
                {recentScans.slice(0, 5).map((scan, idx) => (
                  <div
                    key={idx}
                    className="text-xs bg-slate-50 dark:bg-slate-900 rounded-lg p-2 flex items-center justify-between border border-slate-200 dark:border-slate-700"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 dark:text-white truncate">
                        {scan.item?.name || 'Unknown'}
                      </p>
                      <p className="text-slate-500 dark:text-slate-400 font-mono">{scan.upc}</p>
                    </div>
                    <span className="text-slate-400 text-xs flex-shrink-0 ml-2">
                      {scan.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer Action Buttons (sticky) ────────────── */}
      {selectedItem && (
        <div className="sticky bottom-0 z-30 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 space-y-2">
          {/* Receive Stock — primary action, BIG green button */}
          {!showReceiveForm && !receiveResult && (
            <Button
              onClick={() => setShowReceiveForm(true)}
              className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700 text-white rounded-xl"
            >
              <Package className="w-6 h-6 mr-2" />
              Receive Stock
            </Button>
          )}

          {/* After successful receive — option to receive more or scan next */}
          {receiveResult && (
            <Button
              onClick={() => {
                setReceiveResult(null);
                setShowReceiveForm(true);
                setReceiveQty(1);
                setReceiveNotes('');
              }}
              className="w-full h-12 bg-green-600 hover:bg-green-700 text-white"
            >
              <Plus className="w-5 h-5 mr-2" />
              Receive More of This Item
            </Button>
          )}

          <Button
            onClick={handleScanAgain}
            variant={receiveResult ? 'default' : 'outline'}
            className={`w-full h-12 ${receiveResult ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
          >
            <Camera className="w-5 h-5 mr-2" />
            Scan Next Item
          </Button>
        </div>
      )}
    </div>
  );
}
