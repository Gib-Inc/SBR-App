import { useState, useMemo, useCallback, useEffect } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  AlertCircle,
  Pencil,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Supplier, Item, PurchaseOrder, PurchaseOrderLine } from "@shared/schema";
import { cn } from "@/lib/utils";

interface DraftLineItem {
  id: string;
  itemId: string;
  sku: string;
  name: string;
  qtyOrdered: number;
  unitCost: number;
}

interface POWithLines extends PurchaseOrder {
  lines?: PurchaseOrderLine[];
}

interface EditPODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrder: POWithLines | null;
  onPOUpdated?: (poId: string) => void;
}

export function EditPODialog({ 
  open, 
  onOpenChange,
  purchaseOrder,
  onPOUpdated,
}: EditPODialogProps) {
  const { toast } = useToast();
  
  const [supplierId, setSupplierId] = useState<string>("");
  const [orderDate, setOrderDate] = useState<Date>(new Date());
  const [expectedDate, setExpectedDate] = useState<Date | undefined>(undefined);
  const [shippingCost, setShippingCost] = useState<string>("0");
  const [otherFees, setOtherFees] = useState<string>("0");
  const [notes, setNotes] = useState<string>("");
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([]);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['/api/suppliers'],
    enabled: open,
  });

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ['/api/items'],
    enabled: open,
  });

  const { 
    data: compositeData, 
    isLoading: isLoadingComposite, 
    isError: isCompositeError,
    error: compositeError,
    refetch: refetchComposite 
  } = useQuery({
    queryKey: ['/api/purchase-orders', purchaseOrder?.id, 'composite-edit'],
    enabled: !!(open && purchaseOrder?.id),
    staleTime: 0,
    retry: 2,
    queryFn: async () => {
      const res = await fetch(`/api/purchase-orders/${purchaseOrder?.id}/composite`);
      if (!res.ok) throw new Error("Failed to fetch PO details");
      const data = await res.json();
      if (!data.lines || !Array.isArray(data.lines)) {
        throw new Error("Failed to load line items");
      }
      return data;
    },
  });

  const hasLoadedLines = !!(compositeData?.lines && compositeData.lines.length > 0) || 
                         !!(purchaseOrder?.lines && purchaseOrder.lines.length > 0);

  const effectivePO = useMemo(() => {
    if (compositeData && compositeData.lines) {
      return { ...purchaseOrder, ...compositeData };
    }
    if (purchaseOrder?.lines && purchaseOrder.lines.length > 0) {
      return purchaseOrder;
    }
    return purchaseOrder;
  }, [purchaseOrder, compositeData]);

  useEffect(() => {
    if (open && effectivePO) {
      setSupplierId(effectivePO.supplierId || "");
      setOrderDate(effectivePO.orderDate ? new Date(effectivePO.orderDate) : new Date());
      setExpectedDate(effectivePO.expectedDate ? new Date(effectivePO.expectedDate) : undefined);
      setShippingCost(String(effectivePO.shippingCost || 0));
      setOtherFees(String(effectivePO.otherFees || 0));
      setNotes(effectivePO.notes || "");
      
      if (effectivePO.lines && effectivePO.lines.length > 0) {
        const mappedLines: DraftLineItem[] = effectivePO.lines.map((line: any) => ({
          id: line.id,
          itemId: line.itemId,
          sku: line.sku || "",
          name: line.itemName || "",
          qtyOrdered: line.qtyOrdered,
          unitCost: line.unitCost,
        }));
        setLineItems(mappedLines);
      } else {
        setLineItems([]);
      }
    }
  }, [open, effectivePO]);

  const filteredItems = useMemo(() => {
    if (!productSearchQuery) return items.slice(0, 50);
    const query = productSearchQuery.toLowerCase();
    return items.filter(item =>
      item.name.toLowerCase().includes(query) ||
      item.sku.toLowerCase().includes(query)
    ).slice(0, 50);
  }, [items, productSearchQuery]);

  const subtotal = useMemo(() => {
    return lineItems.reduce((sum, line) => sum + (line.qtyOrdered * line.unitCost), 0);
  }, [lineItems]);

  const total = useMemo(() => {
    const shipping = parseFloat(shippingCost) || 0;
    const other = parseFloat(otherFees) || 0;
    return subtotal + shipping + other;
  }, [subtotal, shippingCost, otherFees]);

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

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!purchaseOrder?.id) {
        throw new Error("No purchase order to update");
      }
      if (!validateForm()) {
        throw new Error("Please fix the form errors before submitting");
      }
      
      const payload = {
        supplierId,
        orderDate: orderDate.toISOString(),
        expectedDate: expectedDate ? expectedDate.toISOString() : null,
        shippingCost: parseFloat(shippingCost) || 0,
        otherFees: parseFloat(otherFees) || 0,
        notes: notes || null,
        lines: lineItems.map(line => ({
          id: line.id.startsWith('temp-') ? undefined : line.id,
          itemId: line.itemId,
          qtyOrdered: line.qtyOrdered,
          unitCost: line.unitCost,
        })),
      };

      const res = await apiRequest("PUT", `/api/purchase-orders/${purchaseOrder.id}`, payload);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update purchase order");
      }
      return res.json();
    },
    onSuccess: (result: any) => {
      toast({
        title: "Purchase Order Updated",
        description: `PO ${result.poNumber || purchaseOrder?.poNumber || result.id} has been updated successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      if (purchaseOrder?.id) {
        queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders', purchaseOrder.id, 'composite'] });
      }
      if (onPOUpdated && result.id) {
        onPOUpdated(result.id);
      }
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update purchase order",
        variant: "destructive",
      });
    },
  });

  const handleClose = useCallback(() => {
    setErrors({});
    onOpenChange(false);
  }, [onOpenChange]);

  const handleAddItem = useCallback((item: Item) => {
    const existingLine = lineItems.find(l => l.itemId === item.id);
    if (existingLine) {
      setLineItems(prev => prev.map(l => 
        l.itemId === item.id 
          ? { ...l, qtyOrdered: l.qtyOrdered + 1 }
          : l
      ));
    } else {
      const newLine: DraftLineItem = {
        id: `temp-${Date.now()}`,
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        qtyOrdered: 1,
        unitCost: 0,
      };
      setLineItems(prev => [...prev, newLine]);
    }
    setProductSearchOpen(false);
    setProductSearchQuery("");
  }, [lineItems]);

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
  const canEdit = purchaseOrder && ['DRAFT', 'APPROVAL_PENDING', 'APPROVED'].includes(purchaseOrder.status);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) handleClose();
      else onOpenChange(isOpen);
    }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-edit-dialog-title">
            <Pencil className="h-5 w-5" />
            Edit Purchase Order {purchaseOrder?.poNumber || ""}
          </DialogTitle>
          <DialogDescription>
            {canEdit 
              ? "Make changes to this draft purchase order."
              : "This purchase order cannot be edited because it has been sent or received."}
          </DialogDescription>
        </DialogHeader>

        {!canEdit ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <AlertCircle className="h-5 w-5 mr-2" />
            Only draft purchase orders can be edited.
          </div>
        ) : isLoadingComposite ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">Loading purchase order details...</span>
          </div>
        ) : isCompositeError ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="flex items-center text-destructive">
              <AlertCircle className="h-5 w-5 mr-2" />
              <span>Failed to load purchase order details</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {(compositeError as Error)?.message || "Unable to load line items for editing"}
            </p>
            <Button 
              variant="outline" 
              onClick={() => refetchComposite()}
              data-testid="button-retry-load"
            >
              Try Again
            </Button>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 px-1">
              <div className="space-y-6 py-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="supplier">Supplier *</Label>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                      <SelectTrigger 
                        id="supplier" 
                        className={cn(!supplierId && errors.supplier && "border-destructive")}
                        data-testid="select-edit-supplier"
                      >
                        <SelectValue placeholder="Select a supplier" />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((supplier) => (
                          <SelectItem 
                            key={supplier.id} 
                            value={supplier.id}
                            data-testid={`select-edit-supplier-option-${supplier.id}`}
                          >
                            {supplier.name}
                            {supplier.email && (
                              <span className="text-muted-foreground ml-2 text-xs">
                                ({supplier.email})
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedSupplier && (
                      <p className="text-xs text-muted-foreground">
                        {selectedSupplier.email || selectedSupplier.phone || "No contact info"}
                      </p>
                    )}
                    {errors.supplier && (
                      <p className="text-xs text-destructive" data-testid="error-edit-supplier">
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
                            data-testid="button-edit-order-date"
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
                            data-testid="button-edit-expected-date"
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

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any notes or special instructions..."
                    className="resize-none"
                    rows={3}
                    data-testid="textarea-edit-notes"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-medium">Line Items *</Label>
                    <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                      <PopoverTrigger asChild>
                        <Button size="sm" data-testid="button-edit-add-line-item">
                          <Plus className="h-4 w-4 mr-1" />
                          Add Item
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0" align="end">
                        <Command>
                          <CommandInput 
                            placeholder="Search by SKU or name..." 
                            value={productSearchQuery}
                            onValueChange={setProductSearchQuery}
                            data-testid="input-edit-product-search"
                          />
                          <CommandList>
                            <CommandEmpty>No items found.</CommandEmpty>
                            <CommandGroup heading="Products">
                              {filteredItems.map((item) => (
                                <CommandItem
                                  key={item.id}
                                  value={`${item.sku} ${item.name}`}
                                  onSelect={() => handleAddItem(item)}
                                  className="cursor-pointer"
                                  data-testid={`edit-item-option-${item.id}`}
                                >
                                  <Package className="mr-2 h-4 w-4 text-muted-foreground" />
                                  <div className="flex-1">
                                    <span className="font-medium">{item.sku}</span>
                                    <span className="ml-2 text-muted-foreground">{item.name}</span>
                                  </div>
                                  <span className="text-xs text-muted-foreground">
                                    Stock: {item.currentStock}
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
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
                            <TableHead className="w-[50%]">Item</TableHead>
                            <TableHead className="w-[15%] text-center">Qty</TableHead>
                            <TableHead className="w-[15%] text-right">Unit Cost</TableHead>
                            <TableHead className="w-[15%] text-right">Line Total</TableHead>
                            <TableHead className="w-[5%]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {lineItems.map((line) => (
                            <TableRow key={line.id} data-testid={`edit-row-line-${line.id}`}>
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
                                  data-testid={`edit-input-qty-${line.id}`}
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
                                    className="w-24 text-right"
                                    data-testid={`edit-input-cost-${line.id}`}
                                  />
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(line.qtyOrdered * line.unitCost)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleRemoveLine(line.id)}
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  data-testid={`button-edit-remove-${line.id}`}
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
                        <Label htmlFor="edit-shipping">Shipping Cost</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input
                            id="edit-shipping"
                            type="number"
                            min="0"
                            step="0.01"
                            value={shippingCost}
                            onChange={(e) => setShippingCost(e.target.value)}
                            className="pl-7"
                            data-testid="input-edit-shipping-cost"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-otherFees">Other Fees</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input
                            id="edit-otherFees"
                            type="number"
                            min="0"
                            step="0.01"
                            value={otherFees}
                            onChange={(e) => setOtherFees(e.target.value)}
                            className="pl-7"
                            data-testid="input-edit-other-fees"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal ({lineItems.length} items)</span>
                      <span data-testid="text-edit-subtotal">{formatCurrency(subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Shipping</span>
                      <span>{formatCurrency(parseFloat(shippingCost) || 0)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Other Fees</span>
                      <span>{formatCurrency(parseFloat(otherFees) || 0)}</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between font-medium">
                      <span>Total</span>
                      <span className="text-lg" data-testid="text-edit-total">{formatCurrency(total)}</span>
                    </div>
                  </div>
                </div>

                {errors.lineItems && (
                  <div className="flex items-center gap-2 text-destructive text-sm" data-testid="error-edit-line-items">
                    <AlertCircle className="h-4 w-4" />
                    <span>{errors.lineItems}</span>
                  </div>
                )}
                {!isValid && !errors.lineItems && !errors.supplier && (supplierId || lineItems.length > 0) && (
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm" data-testid="text-edit-validation-hint">
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
                onClick={handleClose}
                disabled={updateMutation.isPending}
                data-testid="button-edit-cancel"
              >
                Cancel
              </Button>
              <Button 
                onClick={() => updateMutation.mutate()}
                disabled={!isValid || updateMutation.isPending}
                data-testid="button-save-edit-po"
              >
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
