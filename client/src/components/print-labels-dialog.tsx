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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Printer, Search, Eye, AlertCircle, CheckCircle2, HelpCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PrintLabelsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type PrinterStatus = "checking" | "ready" | "unknown" | "error";

interface LabelFormatConfig {
  value: string;
  label: string;
  description: string;
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
    label: "4x6 Thermal Label",
    description: "Single label per page, ideal for thermal printers",
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
    label: "2x1 Thermal Label",
    description: "Small thermal label for compact items",
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
    value: "avery5160",
    label: "Avery 5160 (30 labels/sheet)",
    description: "Standard address labels, 1\" x 2-5/8\"",
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
    label: "Avery 5163 (10 labels/sheet)",
    description: "Shipping labels, 2\" x 4\"",
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

// Session storage keys for persistence
const STORAGE_KEY_FORMAT = "printLabels_lastFormat";
const STORAGE_KEY_QUANTITIES = "printLabels_quantities";

export function PrintLabelsDialog({ isOpen, onClose }: PrintLabelsDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(new Map());
  const [labelFormat, setLabelFormat] = useState<string>(() => {
    return sessionStorage.getItem(STORAGE_KEY_FORMAT) || "4x6-thermal";
  });
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>("checking");
  const [activeTab, setActiveTab] = useState("select");
  const [validationError, setValidationError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Fetch items
  const { data: items } = useQuery<any[]>({
    queryKey: ["/api/items"],
  });

  // Check printer capability on mount
  useEffect(() => {
    if (isOpen) {
      checkPrinterStatus();
      // Load saved quantities
      loadSavedQuantities();
    }
  }, [isOpen]);

  // Save format preference when changed
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY_FORMAT, labelFormat);
  }, [labelFormat]);

  // Save quantities when changed
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
        const quantities = JSON.parse(saved);
        // Will apply when items are selected
      }
    } catch (e) {
      // Ignore parse errors
    }
  };

  const checkPrinterStatus = () => {
    setPrinterStatus("checking");
    
    try {
      // Check if window.print exists
      if (typeof window.print !== "function") {
        setPrinterStatus("error");
        return;
      }

      // Check for headless browser indicators
      const isHeadless = 
        navigator.webdriver === true ||
        /HeadlessChrome/.test(navigator.userAgent) ||
        /PhantomJS/.test(navigator.userAgent);

      if (isHeadless) {
        setPrinterStatus("error");
        return;
      }

      // Check if matchMedia exists (another indicator of print capability)
      if (typeof window.matchMedia === "function") {
        const printMedia = window.matchMedia("print");
        if (printMedia) {
          setPrinterStatus("ready");
          return;
        }
      }

      // If we got here, print should work but we can't fully verify
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

  // Toggle item selection
  const toggleItem = (item: any, checked: boolean) => {
    const newSelectedItems = new Map(selectedItems);
    if (checked) {
      // Try to load saved quantity
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

  // Update quantity for selected item
  const updateQuantity = (itemId: string, quantity: number) => {
    const newSelectedItems = new Map(selectedItems);
    const item = newSelectedItems.get(itemId);
    if (item) {
      item.quantity = Math.max(1, Math.min(100, quantity));
      setSelectedItems(newSelectedItems);
    }
  };

  const formatConfig = LABEL_FORMATS.find(f => f.value === labelFormat) || LABEL_FORMATS[0];

  // Generate labels array for preview/print
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

  // Generate print view
  const handlePrint = () => {
    if (selectedItems.size === 0) {
      setValidationError("Select at least one item to print.");
      return;
    }

    // Show warning if printer status is error
    if (printerStatus === "error") {
      toast({
        title: "Printer Status Unknown",
        description: "We couldn't verify a printer. Your system may still handle printing, but check your printer settings.",
        variant: "default",
      });
    }

    const labels = generateLabels();
    const config = formatConfig;

    // Create print window with labels
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({
        title: "Popup Blocked",
        description: "Please allow popups to print labels.",
        variant: "destructive",
      });
      return;
    }

    // Generate label HTML
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

    // Calculate if we need sheet layout
    const isSheetLayout = config.columns > 1 || config.rows > 1;
    const labelsPerPage = config.columns * config.rows;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print Labels</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Arial', sans-serif;
            background: white;
          }
          
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
          
          .page:last-child {
            page-break-after: auto;
          }
          
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
          
          .label:last-child {
            page-break-after: auto;
          }
          
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
          
          .barcode-container svg {
            max-width: 95%;
            max-height: 100%;
            height: auto;
          }
          
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
            body {
              margin: 0;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            
            @page {
              size: ${config.pageWidth} ${config.pageHeight};
              margin: 0;
            }
          }
          
          @media screen {
            body {
              background: #f0f0f0;
              padding: 20px;
            }
            
            .page {
              background: white;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
              margin-bottom: 20px;
            }
            
            .label {
              border: 1px dashed #ccc;
            }
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
            setTimeout(function() {
              window.print();
            }, 300);
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
    setActiveTab("select");
    setValidationError(null);
    onClose();
  };

  const selectedCount = selectedItems.size;
  const totalLabels = Array.from(selectedItems.values()).reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const getPrinterStatusBadge = () => {
    switch (printerStatus) {
      case "checking":
        return (
          <Badge variant="secondary" className="gap-1">
            <HelpCircle className="h-3 w-3" />
            Printer: Checking...
          </Badge>
        );
      case "ready":
        return (
          <Badge variant="secondary" className="gap-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            <CheckCircle2 className="h-3 w-3" />
            Printer: Ready
          </Badge>
        );
      case "error":
        return (
          <Badge variant="secondary" className="gap-1 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
            <AlertCircle className="h-3 w-3" />
            Printer: Error
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1">
            <HelpCircle className="h-3 w-3" />
            Printer: Unknown
          </Badge>
        );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <DialogTitle>Print Labels</DialogTitle>
              <DialogDescription>
                Select items and configure label format for printing
              </DialogDescription>
            </div>
            {getPrinterStatusBadge()}
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
            <TabsTrigger value="select" data-testid="tab-select-items">
              Select Items
            </TabsTrigger>
            <TabsTrigger 
              value="preview" 
              disabled={selectedCount === 0}
              data-testid="tab-preview"
            >
              <Eye className="mr-2 h-4 w-4" />
              Preview ({totalLabels})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="select" className="flex-1 overflow-hidden flex flex-col mt-4">
            <div className="space-y-4 flex-1 flex flex-col min-h-0">
              {/* Label Format Selection */}
              <div className="space-y-2 flex-shrink-0">
                <Label htmlFor="label-format">Label Format</Label>
                <Select value={labelFormat} onValueChange={setLabelFormat}>
                  <SelectTrigger data-testid="select-label-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LABEL_FORMATS.map((format) => (
                      <SelectItem key={format.value} value={format.value}>
                        <div className="flex flex-col">
                          <span>{format.label}</span>
                          <span className="text-xs text-muted-foreground">{format.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Selected Items Summary */}
              {selectedCount > 0 && (
                <Card className="flex-shrink-0">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex gap-4">
                        <div>
                          <span className="text-2xl font-bold text-primary">{selectedCount}</span>
                          <span className="text-sm text-muted-foreground ml-2">items</span>
                        </div>
                        <div>
                          <span className="text-2xl font-bold text-primary">{totalLabels}</span>
                          <span className="text-sm text-muted-foreground ml-2">labels</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setActiveTab("preview")}
                          data-testid="button-show-preview"
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Preview
                        </Button>
                        <Button
                          onClick={handlePrint}
                          data-testid="button-print-labels"
                        >
                          <Printer className="mr-2 h-4 w-4" />
                          Print
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Validation Error */}
              {validationError && (
                <div className="flex items-center gap-2 text-destructive text-sm flex-shrink-0">
                  <AlertCircle className="h-4 w-4" />
                  {validationError}
                </div>
              )}

              {/* Search Bar */}
              <div className="space-y-2 flex-shrink-0">
                <Label>Search Items</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or SKU..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-items"
                  />
                </div>
              </div>

              {/* Item Selection List */}
              <div className="flex-1 flex flex-col min-h-0">
                <Label className="mb-2">Available Items ({allItems.length})</Label>
                <Card className="flex-1 min-h-0">
                  <CardContent className="p-0 h-full">
                    <ScrollArea className="h-[300px]">
                      {allItems.length === 0 ? (
                        <div className="flex items-center justify-center p-8 text-muted-foreground">
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
                                className="flex items-center gap-4 p-4 hover-elevate"
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => toggleItem(item, checked as boolean)}
                                  data-testid={`checkbox-item-${item.id}`}
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium truncate">{item.name}</div>
                                  <div className="text-sm text-muted-foreground">{item.sku}</div>
                                  {(item.barcodeValue || item.sku) && (
                                    <Badge variant="secondary" className="mt-1 text-xs">
                                      Barcode: {item.barcodeValue || item.sku}
                                    </Badge>
                                  )}
                                </div>
                                {isSelected && (
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <Label className="text-sm">Qty:</Label>
                                    <Input
                                      type="number"
                                      min="1"
                                      max="100"
                                      value={selectedItem?.quantity || 1}
                                      onChange={(e) =>
                                        updateQuantity(item.id, parseInt(e.target.value) || 1)
                                      }
                                      className="w-20"
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
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="flex-1 overflow-hidden flex flex-col mt-4">
            <div className="flex-1 flex flex-col min-h-0 space-y-4">
              {/* Preview Header */}
              <div className="flex items-center justify-between flex-shrink-0">
                <div>
                  <h3 className="font-semibold">Label Preview</h3>
                  <p className="text-sm text-muted-foreground">
                    {formatConfig.label} - {totalLabels} label{totalLabels !== 1 ? 's' : ''}
                  </p>
                </div>
                <Button onClick={handlePrint} data-testid="button-print-from-preview">
                  <Printer className="mr-2 h-4 w-4" />
                  Print Labels
                </Button>
              </div>

              {/* Preview Area */}
              <Card className="flex-1 min-h-0 overflow-hidden">
                <CardContent className="p-4 h-full">
                  <ScrollArea className="h-full">
                    <div 
                      ref={previewRef}
                      className="space-y-4"
                    >
                      <LabelPreview 
                        labels={generateLabels()} 
                        config={formatConfig}
                      />
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Action Buttons */}
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

// Helper function to escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Generate sheet-based HTML for multi-label pages
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

// Preview component for in-modal preview
function LabelPreview({ labels, config }: { labels: LabelData[], config: LabelFormatConfig }) {
  const isSheetLayout = config.columns > 1 || config.rows > 1;
  const labelsPerPage = config.columns * config.rows;
  
  // Group labels into pages for sheet layouts
  const pages: LabelData[][] = [];
  if (isSheetLayout) {
    for (let i = 0; i < labels.length; i += labelsPerPage) {
      pages.push(labels.slice(i, i + labelsPerPage));
    }
  } else {
    // Each label is its own page for thermal
    pages.push(labels);
  }

  if (labels.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        No labels to preview
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {isSheetLayout ? (
        // Sheet layout preview
        pages.map((pageLabels, pageIdx) => (
          <div 
            key={pageIdx}
            className="border rounded-lg p-4 bg-white dark:bg-card"
          >
            <div className="text-xs text-muted-foreground mb-2">
              Page {pageIdx + 1} of {pages.length}
            </div>
            <div 
              className="grid gap-2"
              style={{
                gridTemplateColumns: `repeat(${config.columns}, 1fr)`,
              }}
            >
              {pageLabels.map((label, idx) => (
                <LabelCell key={idx} label={label} compact={true} />
              ))}
            </div>
          </div>
        ))
      ) : (
        // Thermal/single label preview
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          {labels.map((label, idx) => (
            <LabelCell key={idx} label={label} compact={false} />
          ))}
        </div>
      )}
    </div>
  );
}

// Individual label cell for preview
function LabelCell({ label, compact }: { label: LabelData, compact: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Generate barcode using canvas (for preview)
    if (canvasRef.current && label.barcodeValue) {
      try {
        // We'll use a simple visual representation for preview
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const barWidth = compact ? 1 : 2;
          const barHeight = compact ? 30 : 50;
          canvas.width = label.barcodeValue.length * barWidth * 11;
          canvas.height = barHeight + 15;
          
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          ctx.fillStyle = 'black';
          // Simple barcode-like pattern for preview
          for (let i = 0; i < label.barcodeValue.length * 11; i++) {
            if (Math.random() > 0.4) {
              ctx.fillRect(i * barWidth, 0, barWidth, barHeight);
            }
          }
          
          // Add text below
          ctx.font = `${compact ? 8 : 10}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(label.barcodeValue, canvas.width / 2, barHeight + 12);
        }
      } catch (e) {
        console.error('Preview barcode error:', e);
      }
    }
  }, [label.barcodeValue, compact]);

  return (
    <div 
      className={`border rounded bg-white dark:bg-card flex flex-col items-center justify-center text-center ${
        compact ? 'p-2' : 'p-4'
      }`}
      style={{
        minHeight: compact ? '60px' : '120px',
      }}
    >
      <div className="flex-1 flex items-center justify-center">
        <canvas 
          ref={canvasRef} 
          className={compact ? 'max-h-8' : 'max-h-16'}
          style={{ maxWidth: '100%' }}
        />
      </div>
      <div className={`font-bold ${compact ? 'text-xs' : 'text-sm'} mt-1 truncate max-w-full`}>
        {label.productName}
      </div>
      <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-muted-foreground font-mono`}>
        {label.sku}
      </div>
      {label.internalCode && (
        <div className={`${compact ? 'text-[8px]' : 'text-[10px]'} text-muted-foreground`}>
          {label.internalCode}
        </div>
      )}
    </div>
  );
}
