import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Trash2,
  Loader2,
  CalendarIcon,
  Package,
  Search,
  AlertCircle,
  UserPlus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Supplier, Item } from "@shared/schema";
import { cn } from "@/lib/utils";

interface DraftLineItem {
  id: string;
  itemId: string;
  sku: string;
  name: string;
  qtyOrdered: number;
  unitCost: number;
  taxAmount: number; // Manual tax input
  taxRate?: number | null; // Tax percentage from QuickBooks
  quickbooksItemId?: string | null;
}

interface CreatePODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPOCreated?: (poId: string) => void;
}

export function CreatePODialog({ 
  open, 
  onOpenChange,
  onPOCreated,
}: CreatePODialogProps) {
  const { toast } = useToast();
  
  const [supplierId, setSupplierId] = useState<string>("");
  const [orderDate, setOrderDate] = useState<Date>(new Date());
  const [expectedDate, setExpectedDate] = useState<Date | undefined>(undefined);
  const [shippingCost, setShippingCost] = useState<string>("0");
  const [taxes, setTaxes] = useState<string>("0");
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([]);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  

  // Add Supplier inline modal state
  const [addSupplierOpen, setAddSupplierOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierEmail, setNewSupplierEmail] = useState("");

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['/api/suppliers'],
    enabled: open,
  });

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ['/api/items'],
    enabled: open,
  });

  // Create supplier mutation
  const createSupplierMutation = useMutation({
    mutationFn: async (data: { name: string; email: string }) => {
      const res = await apiRequest("POST", "/api/suppliers", data);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to create supplier");
      }
      return res.json();
    },
    onSuccess: (newSupplier: Supplier) => {
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
      setSupplierId(newSupplier.id);
      setAddSupplierOpen(false);
      setNewSupplierName("");
      setNewSupplierEmail("");
      toast({
        title: "Supplier created",
        description: `${newSupplier.name} has been added and selected`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateSupplier = useCallback(() => {
    if (!newSupplierName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a supplier name",
        variant: "destructive",
      });
      return;
    }
    createSupplierMutation.mutate({
      name: newSupplierName.trim(),
      email: newSupplierEmail.trim() || "",
    });
  }, [newSupplierName, newSupplierEmail, createSupplierMutation, toast]);

  const handleSupplierChange = useCallback((value: string) => {
    if (value === "__add_new__") {
      setAddSupplierOpen(true);
    } else {
      setSupplierId(value);
    }
  }, []);

  // Filter to component items only (matching Stock Inventory) and deduplicate by ID
  const stockInventoryItems = useMemo(() => {
    // Filter for component type only (raw materials / Stock Inventory items)
    // POs are for ordering raw materials, not finished products
    const componentItems = items.filter(item => item.type === "component");
    
    // Deduplicate by item ID to prevent duplicates from joins
    const uniqueItems = new Map<string, Item>();
    for (const item of componentItems) {
      if (!uniqueItems.has(item.id)) {
        uniqueItems.set(item.id, item);
      }
    }
    return Array.from(uniqueItems.values());
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!productSearchQuery) return stockInventoryItems;
    const query = productSearchQuery.toLowerCase();
    return stockInventoryItems.filter(item =>
      item.name.toLowerCase().includes(query) ||
      item.sku.toLowerCase().includes(query)
    );
  }, [stockInventoryItems, productSearchQuery]);

  const subtotal = useMemo(() => {
    return lineItems.reduce((sum, line) => sum + (line.qtyOrdered * line.unitCost), 0);
  }, [lineItems]);

  // Calculate taxes from manual line item taxAmount inputs
  const lineTaxTotal = useMemo(() => {
    return lineItems.reduce((sum, line) => sum + (line.taxAmount || 0), 0);
  }, [lineItems]);

  // Calculate taxes from line item tax rates (from QuickBooks)
  const calculatedTaxFromLines = useMemo(() => {
    return lineItems.reduce((sum, line) => {
      if (line.taxRate && line.taxRate > 0) {
        const lineSubtotal = line.qtyOrdered * line.unitCost;
        return sum + (lineSubtotal * line.taxRate / 100);
      }
      return sum;
    }, 0);
  }, [lineItems]);

  // Use line tax amounts first, then QB calculated tax, then manual input
  const effectiveTaxes = useMemo(() => {
    if (lineTaxTotal > 0) {
      return lineTaxTotal;
    }
    if (calculatedTaxFromLines > 0) {
      return calculatedTaxFromLines;
    }
    return parseFloat(taxes) || 0;
  }, [lineTaxTotal, calculatedTaxFromLines, taxes]);

  const total = useMemo(() => {
    const shipping = parseFloat(shippingCost) || 0;
    return subtotal + shipping + effectiveTaxes;
  }, [subtotal, shippingCost, effectiveTaxes]);

  const isValid = useMemo(() => {
    if (!supplierId) return false;
    if (lineItems.length === 0) return false;
    return lineItems.every(line => line.qtyOrdered > 0 && line.unitCost > 0);
  }, [supplierId, lineItems]);

  const validateForm = useCallback(() => {
    const newErrors: Record<string, string> = {};
    
    if (!supplierId) {
      newErrors.supplier = "Please select a supplier";
    }
    if (lineItems.length === 0) {
      newErrors.lineItems = "Please add at least one line item";
    }
    const invalidQtyLines = lineItems.filter(line => line.qtyOrdered < 1);
    if (invalidQtyLines.length > 0) {
      newErrors.lineItems = "All line items must have quantity > 0";
    }
    const invalidCostLines = lineItems.filter(line => line.unitCost <= 0);
    if (invalidCostLines.length > 0) {
      newErrors.lineItems = "All line items must have a unit cost > 0";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [supplierId, lineItems]);

  const createAndSendMutation = useMutation({
    mutationFn: async () => {
      if (!validateForm()) {
        throw new Error("Please fix the form errors before submitting");
      }
      
      // Calculate effectiveTaxes: use line-level QB taxes if available, else manual input
      const lineTaxTotal = lineItems.reduce((sum, line) => {
        if (line.taxRate && line.taxRate > 0) {
          const lineSubtotal = line.qtyOrdered * line.unitCost;
          return sum + (lineSubtotal * line.taxRate / 100);
        }
        return sum;
      }, 0);
      const effectiveTaxAmount = lineTaxTotal > 0 ? lineTaxTotal : (parseFloat(taxes) || 0);

      const payload = {
        supplierId,
        orderDate: orderDate.toISOString(),
        expectedDate: expectedDate ? expectedDate.toISOString() : undefined,
        shippingCost: parseFloat(shippingCost) || 0,
        taxes: effectiveTaxAmount,
        lines: lineItems.map(line => ({
          itemId: line.itemId,
          qtyOrdered: line.qtyOrdered,
          unitCost: line.unitCost,
          taxAmount: line.taxAmount || 0,
        })),
      };

      // Step 1: Create the PO
      const createRes = await apiRequest("POST", '/api/purchase-orders', payload);
      if (!createRes.ok) {
        const errorData = await createRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to create purchase order");
      }
      const createdPO = await createRes.json();

      // Step 2: Send the PO via email
      const sendRes = await apiRequest("POST", `/api/purchase-orders/${createdPO.id}/send`);
      if (!sendRes.ok) {
        const sendError = await sendRes.json().catch(() => ({}));
        // PO was created but send failed - still return success with warning
        return { ...createdPO, sendError: sendError.error || "Email send failed" };
      }
      
      const sendResult = await sendRes.json();
      return { ...createdPO, sent: true, emailResult: sendResult };
    },
    onSuccess: (result: any) => {
      if (result.sendError) {
        toast({
          title: "PO Created (Email Failed)",
          description: `PO ${result.poNumber} was created but email failed: ${result.sendError}. You can resend from the PO details.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Purchase Order Sent",
          description: `PO ${result.poNumber || result.id} has been created and sent to the supplier.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      if (onPOCreated && result.id) {
        onPOCreated(result.id);
      }
      resetAndClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create and send purchase order",
        variant: "destructive",
      });
    },
  });

  const resetAndClose = useCallback(() => {
    setSupplierId("");
    setOrderDate(new Date());
    setExpectedDate(undefined);
    setShippingCost("0");
    setTaxes("0");
    setLineItems([]);
    setProductSearchQuery("");
    setErrors({});
    setSelectedItemIds(new Set());
    onOpenChange(false);
  }, [onOpenChange]);

  // Toggle item selection for multi-select
  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedItemIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  }, []);

  // Add all selected items to line items and close dialog (batched update)
  const handleAddSelectedItems = useCallback(() => {
    const itemsToAdd = items.filter(item => selectedItemIds.has(item.id));
    
    setLineItems(prev => {
      const updatedLines = [...prev];
      const newLines: DraftLineItem[] = [];
      
      itemsToAdd.forEach(item => {
        const existingIndex = updatedLines.findIndex(l => l.itemId === item.id);
        if (existingIndex !== -1) {
          // Increment quantity for existing item
          updatedLines[existingIndex] = {
            ...updatedLines[existingIndex],
            qtyOrdered: updatedLines[existingIndex].qtyOrdered + 1
          };
        } else {
          // Create new line item with default cost
          const itemWithAny = item as any;
          const defaultCost = itemWithAny.defaultPurchaseCost || 
                              itemWithAny.primarySupplier?.unitCost || 
                              itemWithAny.primarySupplier?.price || 
                              0;
          
          newLines.push({
            id: `temp-${Date.now()}-${item.id}`,
            itemId: item.id,
            sku: item.sku,
            name: item.name,
            qtyOrdered: 1,
            unitCost: defaultCost,
            taxAmount: 0,
          });
        }
      });
      
      return [...updatedLines, ...newLines];
    });
    
    // Reset and close dialog
    setSelectedItemIds(new Set());
    setProductSearchQuery("");
    setProductSearchOpen(false);
  }, [items, selectedItemIds]);

  const handleUpdateLineQty = useCallback((lineId: string, qty: number) => {
    if (qty < 1) return;
    setLineItems(prev => prev.map(l => 
      l.id === lineId ? { ...l, qtyOrdered: qty } : l
    ));
  }, []);

  const handleUpdateLineUnitCost = useCallback((lineId: string, cost: number) => {
    if (cost < 0) return;
    setLineItems(prev => prev.map(l => 
      l.id === lineId ? { ...l, unitCost: cost } : l
    ));
  }, []);

  const handleUpdateLineTax = useCallback((lineId: string, tax: number) => {
    if (tax < 0) return;
    setLineItems(prev => prev.map(l => 
      l.id === lineId ? { ...l, taxAmount: tax } : l
    ));
  }, []);

  const handleRemoveLine = useCallback((lineId: string) => {
    setLineItems(prev => prev.filter(l => l.id !== lineId));
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const selectedSupplier = suppliers.find(s => s.id === supplierId);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) resetAndClose();
      else onOpenChange(isOpen);
    }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">New Purchase Order</DialogTitle>
          <DialogDescription>
            Create a new purchase order. Status will be set to Draft until sent to supplier.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-1">
          <div className="space-y-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="supplier">Supplier *</Label>
                <Select value={supplierId} onValueChange={handleSupplierChange}>
                  <SelectTrigger 
                    id="supplier" 
                    className={cn(!supplierId && errors.supplier && "border-destructive")}
                    data-testid="select-supplier"
                  >
                    <SelectValue placeholder="Select a supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((supplier) => (
                      <SelectItem 
                        key={supplier.id} 
                        value={supplier.id}
                        data-testid={`select-supplier-option-${supplier.id}`}
                      >
                        {supplier.name}
                        {supplier.email && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            ({supplier.email})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                    {suppliers.length > 0 && (
                      <SelectSeparator />
                    )}
                    <SelectItem 
                      value="__add_new__"
                      data-testid="select-supplier-add-new"
                    >
                      <span className="flex items-center gap-2 text-primary">
                        <UserPlus className="h-4 w-4" />
                        + Add Supplier Manually
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {selectedSupplier && (
                  <p className="text-xs text-muted-foreground">
                    {selectedSupplier.email || selectedSupplier.phone || "No contact info"}
                  </p>
                )}
                {errors.supplier && (
                  <p className="text-xs text-destructive" data-testid="error-supplier">
                    {errors.supplier}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Order Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                        data-testid="button-order-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(orderDate, "MM/dd/yyyy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={orderDate}
                        onSelect={(date) => date && setOrderDate(date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label>Expected Delivery</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !expectedDate && "text-muted-foreground"
                        )}
                        data-testid="button-expected-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {expectedDate ? format(expectedDate, "MM/dd/yyyy") : "Optional"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={expectedDate}
                        onSelect={setExpectedDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">Line Items *</Label>
                <Button size="sm" onClick={() => setProductSearchOpen(true)} data-testid="button-add-line-item">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </Button>
                
                {/* Add Item Modal - uses Dialog for guaranteed scrolling */}
                <Dialog open={productSearchOpen} onOpenChange={(open) => {
                  setProductSearchOpen(open);
                  if (!open) {
                    setSelectedItemIds(new Set());
                    setProductSearchQuery("");
                  }
                }}>
                  <DialogContent className="max-w-2xl p-0">
                    <DialogHeader className="px-4 pt-4 pb-2">
                      <DialogTitle>Add Item from Stock Inventory</DialogTitle>
                      <DialogDescription>
                        Select items to add to this purchase order
                      </DialogDescription>
                    </DialogHeader>
                    
                    {/* Search input */}
                    <div className="px-4 pb-2">
                      <div className="flex items-center border rounded-md px-3 py-2">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        <Input
                          placeholder="Search by SKU or name..."
                          value={productSearchQuery}
                          onChange={(e) => setProductSearchQuery(e.target.value)}
                          className="h-8 border-0 p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                          data-testid="input-product-search"
                        />
                      </div>
                    </div>
                    
                    {/* Count and selected count */}
                    <div className="px-4 py-1 text-xs font-medium text-muted-foreground flex justify-between">
                      <span>Stock Inventory ({filteredItems.length} items)</span>
                      {selectedItemIds.size > 0 && (
                        <span className="text-primary">{selectedItemIds.size} selected</span>
                      )}
                    </div>
                    
                    {/* Scrollable items list with checkboxes */}
                    <div className="px-2" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                      {filteredItems.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          No items found.
                        </div>
                      ) : (
                        filteredItems.map((item) => {
                          const isSelected = selectedItemIds.has(item.id);
                          const isAlreadyAdded = lineItems.some(l => l.itemId === item.id);
                          return (
                            <div
                              key={item.id}
                              onClick={() => toggleItemSelection(item.id)}
                              className={cn(
                                "flex items-center gap-3 w-full text-left px-3 py-2 rounded cursor-pointer",
                                isSelected ? "bg-primary/10" : "hover:bg-accent hover:text-accent-foreground"
                              )}
                              data-testid={`item-option-${item.id}`}
                            >
                              <Checkbox 
                                checked={isSelected}
                                onCheckedChange={() => toggleItemSelection(item.id)}
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`checkbox-item-${item.id}`}
                              />
                              <div className="flex-1 min-w-0">
                                <span className="font-mono text-sm font-medium">{item.sku}</span>
                                <span className="ml-2 text-sm text-muted-foreground truncate">{item.name}</span>
                              </div>
                              {isAlreadyAdded && (
                                <Badge variant="secondary" className="text-xs">Already added</Badge>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                    
                    {/* Footer with Add button */}
                    <DialogFooter className="px-4 py-3 border-t">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setProductSearchOpen(false);
                          setSelectedItemIds(new Set());
                          setProductSearchQuery("");
                        }}
                        data-testid="button-cancel-add-items"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleAddSelectedItems}
                        disabled={selectedItemIds.size === 0}
                        data-testid="button-confirm-add-items"
                      >
                        Add {selectedItemIds.size > 0 ? `(${selectedItemIds.size})` : ""} Items
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              {lineItems.length === 0 ? (
                <div className="border rounded-md p-8 text-center text-muted-foreground">
                  <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p>No items added yet</p>
                  <p className="text-sm">Click "Add Item" to search and add products</p>
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40%]">Item</TableHead>
                        <TableHead className="w-[10%] text-center">Qty</TableHead>
                        <TableHead className="w-[15%] text-right">Unit Cost</TableHead>
                        <TableHead className="w-[12%] text-right">Tax</TableHead>
                        <TableHead className="w-[15%] text-right">Line Total</TableHead>
                        <TableHead className="w-[8%]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.map((line) => (
                        <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                          <TableCell>
                            <div>
                              <span className="font-medium">{line.sku}</span>
                              <p className="text-sm text-muted-foreground truncate max-w-[250px]">
                                {line.name}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="1"
                              value={line.qtyOrdered}
                              onChange={(e) => handleUpdateLineQty(line.id, parseInt(e.target.value) || 1)}
                              className="w-20 text-center mx-auto"
                              data-testid={`input-qty-${line.id}`}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-muted-foreground">$</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.unitCost}
                                onChange={(e) => handleUpdateLineUnitCost(line.id, parseFloat(e.target.value) || 0)}
                                className="w-20 text-right"
                                data-testid={`input-cost-${line.id}`}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-muted-foreground">$</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.taxAmount}
                                onChange={(e) => handleUpdateLineTax(line.id, parseFloat(e.target.value) || 0)}
                                className="w-16 text-right"
                                data-testid={`input-tax-${line.id}`}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(line.qtyOrdered * line.unitCost + line.taxAmount)}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleRemoveLine(line.id)}
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              data-testid={`button-remove-${line.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="shipping">Shipping Cost</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        id="shipping"
                        type="number"
                        min="0"
                        step="0.01"
                        value={shippingCost}
                        onChange={(e) => setShippingCost(e.target.value)}
                        className="pl-7"
                        data-testid="input-shipping-cost"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="taxes">Taxes</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        id="taxes"
                        type="number"
                        min="0"
                        step="0.01"
                        value={taxes}
                        onChange={(e) => setTaxes(e.target.value)}
                        className="pl-7"
                        data-testid="input-taxes"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal ({lineItems.length} items)</span>
                  <span data-testid="text-subtotal">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Shipping</span>
                  <span>{formatCurrency(parseFloat(shippingCost) || 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Taxes{calculatedTaxFromLines > 0 ? " (from QuickBooks)" : ""}
                  </span>
                  <span>{formatCurrency(effectiveTaxes)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between font-medium">
                  <span>Total</span>
                  <span className="text-lg" data-testid="text-total">{formatCurrency(total)}</span>
                </div>
              </div>
            </div>

            {errors.lineItems && (
              <div className="flex items-center gap-2 text-destructive text-sm" data-testid="error-line-items">
                <AlertCircle className="h-4 w-4" />
                <span>{errors.lineItems}</span>
              </div>
            )}
            {!isValid && !errors.lineItems && !errors.supplier && (supplierId || lineItems.length > 0) && (
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm" data-testid="text-validation-hint">
                <AlertCircle className="h-4 w-4" />
                <span>
                  {!supplierId ? "Please select a supplier" : 
                   lineItems.length === 0 ? "Please add at least one line item" :
                   lineItems.some(l => l.qtyOrdered < 1) ? "All line items must have quantity > 0" :
                   lineItems.some(l => l.unitCost <= 0) ? "All line items must have unit cost > 0" :
                   "Please complete all required fields"}
                </span>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={resetAndClose}
            disabled={createAndSendMutation.isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button 
            onClick={() => createAndSendMutation.mutate()}
            disabled={!isValid || createAndSendMutation.isPending}
            data-testid="button-send-po"
          >
            {createAndSendMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              "Send PO"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Add Supplier Inline Dialog */}
      <Dialog open={addSupplierOpen} onOpenChange={setAddSupplierOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Supplier</DialogTitle>
            <DialogDescription>
              Enter the supplier details. You can add more info later in Suppliers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-supplier-name">Supplier Name *</Label>
              <Input
                id="new-supplier-name"
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="e.g., Acme Manufacturing"
                data-testid="input-new-supplier-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-supplier-email">Email (optional)</Label>
              <Input
                id="new-supplier-email"
                type="email"
                value={newSupplierEmail}
                onChange={(e) => setNewSupplierEmail(e.target.value)}
                placeholder="e.g., orders@acme.com"
                data-testid="input-new-supplier-email"
              />
              <p className="text-xs text-muted-foreground">
                Used for sending purchase orders
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddSupplierOpen(false);
                setNewSupplierName("");
                setNewSupplierEmail("");
              }}
              disabled={createSupplierMutation.isPending}
              data-testid="button-cancel-supplier"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateSupplier}
              disabled={!newSupplierName.trim() || createSupplierMutation.isPending}
              data-testid="button-create-supplier"
            >
              {createSupplierMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Supplier
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
