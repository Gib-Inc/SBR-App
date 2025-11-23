import { useState, useEffect } from "react";
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
import { Printer, Search } from "lucide-react";

interface PrintLabelsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type LabelFormat = "4x6" | "avery5160" | "avery5161" | "dymo30252";

const LABEL_FORMATS = [
  { value: "4x6", label: "4x6 inch Sheet (Standard)" },
  { value: "avery5160", label: "Avery 5160 (30 labels)" },
  { value: "avery5161", label: "Avery 5161 (20 labels)" },
  { value: "dymo30252", label: "DYMO 30252 (Address)" },
];

interface SelectedItem {
  id: string;
  name: string;
  sku: string;
  barcodeValue?: string;
  quantity: number;
}

export function PrintLabelsDialog({ isOpen, onClose }: PrintLabelsDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(new Map());
  const [labelFormat, setLabelFormat] = useState<LabelFormat>("4x6");

  // Fetch items
  const { data: items } = useQuery<any[]>({
    queryKey: ["/api/items"],
  });

  const allItems = (items ?? []).filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.sku && item.sku.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Toggle item selection
  const toggleItem = (item: any, checked: boolean) => {
    const newSelectedItems = new Map(selectedItems);
    if (checked) {
      newSelectedItems.set(item.id, {
        id: item.id,
        name: item.name,
        sku: item.sku,
        barcodeValue: item.barcodeValue,
        quantity: 1,
      });
    } else {
      newSelectedItems.delete(item.id);
    }
    setSelectedItems(newSelectedItems);
  };

  // Update quantity for selected item
  const updateQuantity = (itemId: string, quantity: number) => {
    const newSelectedItems = new Map(selectedItems);
    const item = newSelectedItems.get(itemId);
    if (item) {
      item.quantity = Math.max(1, quantity);
      setSelectedItems(newSelectedItems);
    }
  };

  // Generate print view
  const handlePrint = () => {
    const selectedArray = Array.from(selectedItems.values());
    
    if (selectedArray.length === 0) {
      return;
    }

    // Create print window with labels
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    // Generate label HTML based on format
    let labelHTML = "";
    const labelWidth = labelFormat === "4x6" ? "4in" : "2.625in";
    const labelHeight = labelFormat === "4x6" ? "6in" : "1in";

    selectedArray.forEach((item) => {
      for (let i = 0; i < item.quantity; i++) {
        labelHTML += `
          <div class="label" style="width: ${labelWidth}; height: ${labelHeight};">
            <div class="label-content">
              <div class="barcode-container">
                ${item.barcodeValue ? `
                  <img src="/api/generate-barcode/${encodeURIComponent(item.barcodeValue)}" 
                       alt="${item.barcodeValue}" 
                       class="barcode-image" />
                ` : `<div class="no-barcode">No Barcode</div>`}
              </div>
              <div class="item-name">${item.name}</div>
              <div class="item-sku">${item.sku}</div>
            </div>
          </div>
        `;
      }
    });

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print Labels</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'IBM Plex Sans', Arial, sans-serif;
            background: white;
          }
          
          .label {
            display: inline-block;
            border: 1px dashed #ccc;
            padding: 12px;
            margin: 0;
            page-break-inside: avoid;
            vertical-align: top;
          }
          
          .label-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            text-align: center;
          }
          
          .barcode-container {
            margin-bottom: 8px;
          }
          
          .barcode-image {
            max-width: 90%;
            height: auto;
            max-height: 60%;
          }
          
          .no-barcode {
            padding: 20px;
            background: #f5f5f5;
            border-radius: 4px;
            color: #666;
            font-size: 12px;
          }
          
          .item-name {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 4px;
            color: #000;
          }
          
          .item-sku {
            font-family: 'Courier New', monospace;
            font-size: 11px;
            color: #666;
          }
          
          @media print {
            body {
              margin: 0;
            }
            
            .label {
              border: none;
            }
            
            @page {
              size: ${labelFormat === "4x6" ? "4in 6in" : "8.5in 11in"};
              margin: 0;
            }
          }
        </style>
      </head>
      <body>
        ${labelHTML}
        <script>
          window.onload = () => {
            setTimeout(() => window.print(), 500);
          };
        </script>
      </body>
      </html>
    `);
    
    printWindow.document.close();
  };

  const handleClose = () => {
    setSearchQuery("");
    setSelectedItems(new Map());
    setLabelFormat("4x6");
    onClose();
  };

  const selectedCount = selectedItems.size;
  const totalLabels = Array.from(selectedItems.values()).reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Print Labels</DialogTitle>
          <DialogDescription>
            Select items and configure label format for printing
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Label Format Selection */}
          <div className="space-y-2">
            <Label htmlFor="label-format">Label Format</Label>
            <Select value={labelFormat} onValueChange={(value) => setLabelFormat(value as LabelFormat)}>
              <SelectTrigger data-testid="select-label-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LABEL_FORMATS.map((format) => (
                  <SelectItem key={format.value} value={format.value}>
                    {format.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selected Items Summary */}
          {selectedCount > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex gap-4">
                    <div>
                      <span className="text-2xl font-bold text-primary">{selectedCount}</span>
                      <span className="text-sm text-muted-foreground ml-2">items selected</span>
                    </div>
                    <div>
                      <span className="text-2xl font-bold text-primary">{totalLabels}</span>
                      <span className="text-sm text-muted-foreground ml-2">total labels</span>
                    </div>
                  </div>
                  <Button
                    onClick={handlePrint}
                    disabled={selectedCount === 0}
                    data-testid="button-print-labels"
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Print {totalLabels} Labels
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Search Bar */}
          <div className="space-y-2">
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
          <div className="space-y-2">
            <Label>Available Items ({allItems.length})</Label>
            <Card>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-y-auto">
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
                            <div className="flex-1">
                              <div className="font-medium">{item.name}</div>
                              <div className="text-sm text-muted-foreground">{item.sku}</div>
                              {item.barcodeValue && (
                                <Badge variant="secondary" className="mt-1 text-xs">
                                  {item.barcodeValue}
                                </Badge>
                              )}
                            </div>
                            {isSelected && (
                              <div className="flex items-center gap-2">
                                <Label className="text-sm">Qty:</Label>
                                <Input
                                  type="number"
                                  min="1"
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
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose} data-testid="button-cancel-print">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
