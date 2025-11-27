import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printer, Search, AlertCircle, CheckCircle2, HelpCircle, ChevronLeft, ChevronRight, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface PrintLabelsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type PrinterStatus = "checking" | "ready" | "unknown" | "error";

interface LabelFormatConfig {
  value: string;
  label: string;
  shortLabel: string;
  description: string;
  icon: string;
  pageWidth: string;
  pageHeight: string;
  labelWidth: string;
  labelHeight: string;
  columns: number;
  rows: number;
  marginTop: string;
  marginLeft: string;
  gapX: string;
  gapY: string;
}

const LABEL_FORMATS: LabelFormatConfig[] = [
  {
    value: "4x6-thermal",
    label: "4x6 Thermal",
    shortLabel: "4x6",
    description: "Shipping labels",
    icon: "4×6",
    pageWidth: "4in",
    pageHeight: "6in",
    labelWidth: "4in",
    labelHeight: "6in",
    columns: 1,
    rows: 1,
    marginTop: "0",
    marginLeft: "0",
    gapX: "0",
    gapY: "0",
  },
  {
    value: "2x1-thermal",
    label: "2x1 Thermal",
    shortLabel: "2x1",
    description: "Small product labels",
    icon: "2×1",
    pageWidth: "2in",
    pageHeight: "1in",
    labelWidth: "2in",
    labelHeight: "1in",
    columns: 1,
    rows: 1,
    marginTop: "0",
    marginLeft: "0",
    gapX: "0",
    gapY: "0",
  },
  {
    value: "0.5x2-thermal",
    label: "½×2 Thermal",
    shortLabel: "½×2",
    description: "Tiny product tags",
    icon: "½×2",
    pageWidth: "2in",
    pageHeight: "0.5in",
    labelWidth: "2in",
    labelHeight: "0.5in",
    columns: 1,
    rows: 1,
    marginTop: "0",
    marginLeft: "0",
    gapX: "0",
    gapY: "0",
  },
  {
    value: "avery5160",
    label: "Avery 5160",
    shortLabel: "5160",
    description: '30/sheet (1" × 2⅝")',
    icon: "30",
    pageWidth: "8.5in",
    pageHeight: "11in",
    labelWidth: "2.625in",
    labelHeight: "1in",
    columns: 3,
    rows: 10,
    marginTop: "0.5in",
    marginLeft: "0.1875in",
    gapX: "0.125in",
    gapY: "0in",
  },
  {
    value: "avery5163",
    label: "Avery 5163",
    shortLabel: "5163",
    description: '10/sheet (2" × 4")',
    icon: "10",
    pageWidth: "8.5in",
    pageHeight: "11in",
    labelWidth: "4in",
    labelHeight: "2in",
    columns: 2,
    rows: 5,
    marginTop: "0.5in",
    marginLeft: "0.15625in",
    gapX: "0.1875in",
    gapY: "0in",
  },
];

interface SelectedItem {
  id: string;
  name: string;
  sku: string;
  barcodeValue?: string;
  internalCode?: string;
  quantity: number;
}

interface LabelData {
  productName: string;
  sku: string;
  barcodeValue: string;
  internalCode?: string;
}

const STORAGE_KEY_FORMAT = "printLabels_lastFormat";
const STORAGE_KEY_QUANTITIES = "printLabels_quantities";

export function PrintLabelsDialog({ isOpen, onClose }: PrintLabelsDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(new Map());
  const [labelFormat, setLabelFormat] = useState<string>(() => {
    return sessionStorage.getItem(STORAGE_KEY_FORMAT) || "4x6-thermal";
  });
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>("checking");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const { toast } = useToast();

  const { data: items } = useQuery<any[]>({
    queryKey: ["/api/items"],
  });

  useEffect(() => {
    if (isOpen) {
      checkPrinterStatus();
      loadSavedQuantities();
    }
  }, [isOpen]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY_FORMAT, labelFormat);
  }, [labelFormat]);

  useEffect(() => {
    if (selectedItems.size > 0) {
      const quantities: Record<string, number> = {};
      selectedItems.forEach((item, id) => {
        quantities[id] = item.quantity;
      });
      sessionStorage.setItem(STORAGE_KEY_QUANTITIES, JSON.stringify(quantities));
    }
  }, [selectedItems]);

  const loadSavedQuantities = () => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_QUANTITIES);
      if (saved) {
        JSON.parse(saved);
      }
    } catch (e) {}
  };

  const checkPrinterStatus = () => {
    setPrinterStatus("checking");
    
    try {
      if (typeof window.print !== "function") {
        setPrinterStatus("error");
        return;
      }

      const isHeadless = 
        navigator.webdriver === true ||
        /HeadlessChrome/.test(navigator.userAgent) ||
        /PhantomJS/.test(navigator.userAgent);

      if (isHeadless) {
        setPrinterStatus("error");
        return;
      }

      if (typeof window.matchMedia === "function") {
        const printMedia = window.matchMedia("print");
        if (printMedia) {
          setPrinterStatus("ready");
          return;
        }
      }

      setPrinterStatus("ready");
    } catch (error) {
      setPrinterStatus("unknown");
    }
  };

  const allItems = (items ?? []).filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.sku && item.sku.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const toggleItem = (item: any, checked: boolean) => {
    const newSelectedItems = new Map(selectedItems);
    if (checked) {
      let savedQuantity = 1;
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY_QUANTITIES);
        if (saved) {
          const quantities = JSON.parse(saved);
          savedQuantity = quantities[item.id] || 1;
        }
      } catch (e) {}

      newSelectedItems.set(item.id, {
        id: item.id,
        name: item.name,
        sku: item.sku,
        barcodeValue: item.barcodeValue || item.sku,
        internalCode: item.internalCode,
        quantity: savedQuantity,
      });
    } else {
      newSelectedItems.delete(item.id);
    }
    setSelectedItems(newSelectedItems);
    setValidationError(null);
  };

  const updateQuantity = (itemId: string, quantity: number) => {
    const newSelectedItems = new Map(selectedItems);
    const item = newSelectedItems.get(itemId);
    if (item) {
      item.quantity = Math.max(1, Math.min(100, quantity));
      setSelectedItems(newSelectedItems);
    }
  };

  const formatConfig = LABEL_FORMATS.find(f => f.value === labelFormat) || LABEL_FORMATS[0];

  const generateLabels = useCallback((): LabelData[] => {
    const labels: LabelData[] = [];
    selectedItems.forEach((item) => {
      for (let i = 0; i < item.quantity; i++) {
        labels.push({
          productName: item.name,
          sku: item.sku,
          barcodeValue: item.barcodeValue || item.sku,
          internalCode: item.internalCode,
        });
      }
    });
    return labels;
  }, [selectedItems]);

  useEffect(() => {
    const labels = generateLabels();
    if (previewIndex >= labels.length && labels.length > 0) {
      setPreviewIndex(labels.length - 1);
    } else if (labels.length === 0) {
      setPreviewIndex(0);
    }
  }, [selectedItems, generateLabels, previewIndex]);

  const handlePrint = () => {
    if (selectedItems.size === 0) {
      setValidationError("Select at least one item to print.");
      return;
    }

    if (printerStatus === "error") {
      toast({
        title: "Printer Status Unknown",
        description: "We couldn't verify a printer. Your system may still handle printing, but check your printer settings.",
        variant: "default",
      });
    }

    const labels = generateLabels();
    const config = formatConfig;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({
        title: "Popup Blocked",
        description: "Please allow popups to print labels.",
        variant: "destructive",
      });
      return;
    }

    const labelHTML = labels.map((label, idx) => `
      <div class="label" data-label-index="${idx}">
        <div class="label-content">
          <div class="barcode-container">
            <svg id="barcode-${idx}"></svg>
          </div>
          <div class="product-name">${escapeHtml(label.productName)}</div>
          <div class="sku">SKU: ${escapeHtml(label.sku)}</div>
          ${label.internalCode ? `<div class="internal-code">${escapeHtml(label.internalCode)}</div>` : ''}
        </div>
      </div>
    `).join('');

    const isSheetLayout = config.columns > 1 || config.rows > 1;
    const labelsPerPage = config.columns * config.rows;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print Labels</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Arial', sans-serif; background: white; }
          .page {
            width: ${config.pageWidth};
            height: ${config.pageHeight};
            padding-top: ${config.marginTop};
            padding-left: ${config.marginLeft};
            display: ${isSheetLayout ? 'flex' : 'block'};
            flex-wrap: wrap;
            align-content: flex-start;
            page-break-after: always;
          }
          .page:last-child { page-break-after: auto; }
          .label {
            width: ${config.labelWidth};
            height: ${config.labelHeight};
            ${isSheetLayout ? `margin-right: ${config.gapX}; margin-bottom: ${config.gapY};` : ''}
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            ${!isSheetLayout ? 'page-break-after: always;' : ''}
          }
          .label:last-child { page-break-after: auto; }
          .label-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: ${isSheetLayout ? '4px' : '12px'};
            width: 100%;
            height: 100%;
          }
          .barcode-container {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 0;
            width: 100%;
            max-height: ${isSheetLayout ? '50%' : '60%'};
          }
          .barcode-container svg { max-width: 95%; max-height: 100%; height: auto; }
          .product-name {
            font-weight: 700;
            font-size: ${isSheetLayout ? '9px' : '14px'};
            line-height: 1.2;
            margin-top: ${isSheetLayout ? '2px' : '8px'};
            color: #000;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .sku {
            font-family: 'Courier New', monospace;
            font-size: ${isSheetLayout ? '8px' : '11px'};
            color: #333;
            margin-top: 2px;
          }
          .internal-code {
            font-size: ${isSheetLayout ? '7px' : '9px'};
            color: #666;
            margin-top: 1px;
          }
          .no-barcode {
            padding: 8px;
            background: #f5f5f5;
            border-radius: 4px;
            color: #666;
            font-size: 10px;
          }
          @media print {
            body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            @page { size: ${config.pageWidth} ${config.pageHeight}; margin: 0; }
          }
          @media screen {
            body { background: #f0f0f0; padding: 20px; }
            .page { background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 20px; }
            .label { border: 1px dashed #ccc; }
          }
        </style>
      </head>
      <body>
        ${isSheetLayout ? generateSheetHTML(labels, config, labelsPerPage) : `<div class="page">${labelHTML}</div>`}
        <script>
          function generateBarcodes() {
            const labels = ${JSON.stringify(labels)};
            labels.forEach((label, idx) => {
              const element = document.getElementById('barcode-' + idx);
              if (element && label.barcodeValue) {
                try {
                  JsBarcode(element, label.barcodeValue, {
                    format: "CODE128",
                    width: ${isSheetLayout ? 1 : 2},
                    height: ${isSheetLayout ? 30 : 60},
                    displayValue: true,
                    fontSize: ${isSheetLayout ? 10 : 14},
                    margin: 2,
                    textMargin: 2
                  });
                } catch (e) {
                  console.error('Barcode error for', label.barcodeValue, e);
                  element.parentNode.innerHTML = '<div class="no-barcode">Invalid Barcode</div>';
                }
              }
            });
          }
          window.onload = function() {
            generateBarcodes();
            setTimeout(function() { window.print(); }, 300);
          };
        <\/script>
      </body>
      </html>
    `);
    
    printWindow.document.close();
  };

  const handleClose = () => {
    setSearchQuery("");
    setSelectedItems(new Map());
    setValidationError(null);
    setPreviewIndex(0);
    onClose();
  };

  const selectedCount = selectedItems.size;
  const totalLabels = Array.from(selectedItems.values()).reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const labels = generateLabels();
  const maxPreviewIndex = Math.max(0, labels.length - 1);

  const getPrinterStatusBadge = () => {
    switch (printerStatus) {
      case "checking":
        return (
          <Badge variant="secondary" className="gap-1">
            <HelpCircle className="h-3 w-3" />
            Checking...
          </Badge>
        );
      case "ready":
        return (
          <Badge variant="secondary" className="gap-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            <CheckCircle2 className="h-3 w-3" />
            Ready
          </Badge>
        );
      case "error":
        return (
          <Badge variant="secondary" className="gap-1 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
            <AlertCircle className="h-3 w-3" />
            Not Found
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1">
            <HelpCircle className="h-3 w-3" />
            Unknown
          </Badge>
        );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <DialogTitle>Print Labels</DialogTitle>
              <DialogDescription>
                Select items, choose format, and print barcode labels
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Printer className="h-4 w-4 text-muted-foreground" />
              {getPrinterStatusBadge()}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 gap-4">
          {/* Label Format Cards */}
          <div className="flex-shrink-0" role="radiogroup" aria-label="Label Format">
            <Label className="mb-2 block text-sm font-medium">Label Format</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {LABEL_FORMATS.map((format, idx) => (
                <button
                  key={format.value}
                  type="button"
                  role="radio"
                  aria-checked={labelFormat === format.value}
                  tabIndex={labelFormat === format.value ? 0 : -1}
                  onClick={() => setLabelFormat(format.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      const nextIdx = (idx + 1) % LABEL_FORMATS.length;
                      setLabelFormat(LABEL_FORMATS[nextIdx].value);
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const prevIdx = (idx - 1 + LABEL_FORMATS.length) % LABEL_FORMATS.length;
                      setLabelFormat(LABEL_FORMATS[prevIdx].value);
                    }
                  }}
                  className={cn(
                    "relative flex flex-col items-center p-3 rounded-lg border-2 transition-all text-left focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                    labelFormat === format.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover-elevate"
                  )}
                  data-testid={`format-card-${format.value}`}
                >
                  <div className={cn(
                    "text-lg font-bold",
                    labelFormat === format.value ? "text-primary" : "text-muted-foreground"
                  )}>
                    {format.icon}
                  </div>
                  <div className="text-sm font-medium mt-1">{format.label}</div>
                  <div className="text-xs text-muted-foreground text-center">{format.description}</div>
                  {labelFormat === format.value && (
                    <div className="absolute top-1 right-1">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Main Content: Items Selection + Preview Side by Side */}
          <div className="flex-1 flex gap-4 min-h-0">
            {/* Left: Item Selection */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Label className="text-sm font-medium">Select Items</Label>
                {selectedCount > 0 && (
                  <Badge variant="secondary" className="ml-auto">
                    {selectedCount} selected
                  </Badge>
                )}
              </div>
              
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name or SKU..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-items"
                />
              </div>

              <Card className="flex-1 min-h-0">
                <CardContent className="p-0 h-full">
                  <ScrollArea className="h-[280px]">
                    {allItems.length === 0 ? (
                      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                        <Package className="h-8 w-8 mb-2 opacity-50" />
                        {searchQuery ? "No items found" : "No items available"}
                      </div>
                    ) : (
                      <div className="divide-y">
                        {allItems.map((item) => {
                          const isSelected = selectedItems.has(item.id);
                          const selectedItem = selectedItems.get(item.id);
                          
                          return (
                            <div
                              key={item.id}
                              className={cn(
                                "flex items-center gap-3 p-3 hover-elevate",
                                isSelected && "bg-primary/5"
                              )}
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) => toggleItem(item, checked as boolean)}
                                data-testid={`checkbox-item-${item.id}`}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{item.name}</div>
                                <div className="text-xs text-muted-foreground font-mono">{item.sku}</div>
                              </div>
                              {isSelected && (
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <Label className="text-xs text-muted-foreground">Qty:</Label>
                                  <Input
                                    type="number"
                                    min="1"
                                    max="100"
                                    value={selectedItem?.quantity || 1}
                                    onChange={(e) =>
                                      updateQuantity(item.id, parseInt(e.target.value) || 1)
                                    }
                                    className="w-16 h-8 text-sm"
                                    data-testid={`input-quantity-${item.id}`}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {validationError && (
                <div className="flex items-center gap-2 text-destructive text-sm mt-2">
                  <AlertCircle className="h-4 w-4" />
                  {validationError}
                </div>
              )}
            </div>

            {/* Right: Label Preview Carousel */}
            <div className="w-64 flex flex-col flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Preview</Label>
                {totalLabels > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {previewIndex + 1} of {labels.length}
                  </span>
                )}
              </div>

              <Card className="flex-1 flex flex-col">
                <CardContent className="flex-1 flex flex-col p-4">
                  {labels.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                      <Package className="h-12 w-12 mb-2 opacity-30" />
                      <p className="text-sm text-center">Select items to preview labels</p>
                    </div>
                  ) : (
                    <>
                      {/* Preview Label */}
                      <div className="flex-1 flex items-center justify-center">
                        <LabelPreviewCard 
                          label={labels[previewIndex]} 
                          format={formatConfig}
                        />
                      </div>

                      {/* Carousel Controls */}
                      {labels.length > 1 && (
                        <div className="flex items-center justify-center gap-2 mt-3">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
                            disabled={previewIndex === 0}
                            data-testid="button-preview-prev"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <div className="flex gap-1">
                            {labels.slice(0, Math.min(5, labels.length)).map((_, idx) => (
                              <button
                                key={idx}
                                className={cn(
                                  "h-2 w-2 rounded-full transition-colors",
                                  idx === previewIndex ? "bg-primary" : "bg-muted-foreground/30"
                                )}
                                onClick={() => setPreviewIndex(idx)}
                                data-testid={`button-preview-dot-${idx}`}
                              />
                            ))}
                            {labels.length > 5 && (
                              <span className="text-xs text-muted-foreground ml-1">+{labels.length - 5}</span>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setPreviewIndex(Math.min(maxPreviewIndex, previewIndex + 1))}
                            disabled={previewIndex === maxPreviewIndex}
                            data-testid="button-preview-next"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Summary */}
              {totalLabels > 0 && (
                <div className="mt-2 p-3 rounded-lg bg-muted/50 text-center">
                  <span className="text-2xl font-bold text-primary">{totalLabels}</span>
                  <span className="text-sm text-muted-foreground ml-1">
                    label{totalLabels !== 1 ? 's' : ''} total
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex justify-between gap-2 pt-4 border-t flex-shrink-0">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel-print">
            Cancel
          </Button>
          <Button
            onClick={handlePrint}
            disabled={selectedCount === 0}
            data-testid="button-print-labels-footer"
          >
            <Printer className="mr-2 h-4 w-4" />
            Print {totalLabels > 0 ? `${totalLabels} Labels` : 'Labels'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function generateSheetHTML(
  labels: LabelData[], 
  config: LabelFormatConfig, 
  labelsPerPage: number
): string {
  const pages: string[] = [];
  
  for (let i = 0; i < labels.length; i += labelsPerPage) {
    const pageLabels = labels.slice(i, i + labelsPerPage);
    const labelHTML = pageLabels.map((label, idx) => {
      const globalIdx = i + idx;
      return `
        <div class="label" data-label-index="${globalIdx}">
          <div class="label-content">
            <div class="barcode-container">
              <svg id="barcode-${globalIdx}"></svg>
            </div>
            <div class="product-name">${escapeHtml(label.productName)}</div>
            <div class="sku">SKU: ${escapeHtml(label.sku)}</div>
            ${label.internalCode ? `<div class="internal-code">${escapeHtml(label.internalCode)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
    
    pages.push(`<div class="page">${labelHTML}</div>`);
  }
  
  return pages.join('');
}

function LabelPreviewCard({ label, format }: { label: LabelData, format: LabelFormatConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isSheetLayout = format.columns > 1 || format.rows > 1;

  useEffect(() => {
    if (canvasRef.current && label.barcodeValue) {
      try {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const barWidth = 1.5;
          const barHeight = isSheetLayout ? 35 : 50;
          canvas.width = Math.min(180, label.barcodeValue.length * barWidth * 11);
          canvas.height = barHeight + 18;
          
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          ctx.fillStyle = 'black';
          let x = 10;
          for (let i = 0; i < label.barcodeValue.length; i++) {
            const charCode = label.barcodeValue.charCodeAt(i);
            for (let j = 0; j < 11; j++) {
              if ((charCode + j) % 2 === 0) {
                ctx.fillRect(x, 0, barWidth, barHeight);
              }
              x += barWidth;
            }
          }
          
          ctx.font = '11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(label.barcodeValue, canvas.width / 2, barHeight + 14);
        }
      } catch (e) {
        console.error('Preview barcode error:', e);
      }
    }
  }, [label.barcodeValue, isSheetLayout]);

  return (
    <div className="w-full border rounded-lg bg-white p-4 flex flex-col items-center text-center shadow-sm">
      <canvas 
        ref={canvasRef} 
        className="max-h-16 mb-2"
        style={{ maxWidth: '100%' }}
      />
      <div className="font-bold text-sm text-black truncate max-w-full">
        {label.productName}
      </div>
      <div className="text-xs text-gray-600 font-mono">
        SKU: {label.sku}
      </div>
      {label.internalCode && (
        <div className="text-[10px] text-gray-500">
          {label.internalCode}
        </div>
      )}
    </div>
  );
}
