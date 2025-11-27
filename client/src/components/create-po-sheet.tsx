import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Plus,
  Minus,
  Send,
  Mail,
  MessageSquare,
  Building2,
  Package,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Supplier, Item } from "@shared/schema";

interface ItemWithCriticality extends Item {
  daysUntilStockout: number;
}

interface PrefilledItem {
  itemId: string;
  quantity: number;
  unitCost?: number;
  aiRecommendationId?: string;
  sku?: string;
  name?: string;
}

interface CreatePOSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefilledSupplierId?: string;
  prefilledItems?: PrefilledItem[];
  onPOCreated?: (poId: string) => void;
}

interface SelectedItem {
  itemId: string;
  quantity: number;
  unitCost?: number;
  aiRecommendationId?: string;
}

export function CreatePOSheet({ 
  open, 
  onOpenChange,
  prefilledSupplierId,
  prefilledItems,
  onPOCreated,
}: CreatePOSheetProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"supplier" | "items" | "review">("supplier");
  const [isNewSupplier, setIsNewSupplier] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sendVia, setSendVia] = useState<"EMAIL" | "SMS">("EMAIL");
  const [notes, setNotes] = useState("");
  const [generatedContent, setGeneratedContent] = useState<{
    subject: string;
    body: string;
    smsMessage: string;
  } | null>(null);
  const [hasInitializedPrefill, setHasInitializedPrefill] = useState(false);

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['/api/suppliers'],
    enabled: open,
  });
  
  // Initialize with prefilled data when sheet opens
  const isPrefilled = !!(prefilledSupplierId || prefilledItems?.length);
  if (open && isPrefilled && !hasInitializedPrefill && suppliers.length > 0) {
    if (prefilledSupplierId) {
      const supplier = suppliers.find(s => s.id === prefilledSupplierId);
      if (supplier) {
        setSelectedSupplierId(prefilledSupplierId);
        setSupplierEmail(supplier.email || "");
        setSupplierPhone(supplier.phone || "");
      }
    }
    if (prefilledItems?.length) {
      setSelectedItems(prefilledItems.map(item => ({
        itemId: item.itemId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        aiRecommendationId: item.aiRecommendationId,
      })));
      // Skip to items step if we have prefilled items
      if (prefilledSupplierId) {
        setStep("items");
      }
    }
    setHasInitializedPrefill(true);
  }

  const { data: itemsWithCriticality = [], isLoading: isLoadingItems } = useQuery<ItemWithCriticality[]>({
    queryKey: ['/api/items/critical-order'],
    enabled: open && step !== "supplier",
  });

  const createAndSendMutation = useMutation({
    mutationFn: async (data: {
      supplierId?: string;
      supplierName?: string;
      supplierEmail?: string;
      supplierPhone?: string;
      items: SelectedItem[];
      sendVia: "EMAIL" | "SMS";
      notes: string;
      isNewSupplier: boolean;
    }) => {
      const res = await apiRequest("POST", '/api/purchase-orders/create-and-send', data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create purchase order");
      }
      return res.json();
    },
    onSuccess: (result: any) => {
      if (result.ghlResult?.success) {
        toast({
          title: "PO Created & Sent",
          description: `PO ${result.purchaseOrder?.poNumber} was sent via ${result.ghlResult.sentMethod}`,
        });
      } else {
        toast({
          title: "PO Created",
          description: `PO ${result.purchaseOrder?.poNumber} was created but sending failed: ${result.ghlResult?.error || 'GHL not configured'}`,
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ai/recommendations'] });
      // Notify parent if callback provided
      if (onPOCreated && result.purchaseOrder?.id) {
        onPOCreated(result.purchaseOrder.id);
      }
      resetAndClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create purchase order",
        variant: "destructive",
      });
    },
  });

  const resetAndClose = () => {
    setStep("supplier");
    setIsNewSupplier(false);
    setSelectedSupplierId("");
    setNewSupplierName("");
    setSupplierEmail("");
    setSupplierPhone("");
    setSelectedItems([]);
    setSearchQuery("");
    setSendVia("EMAIL");
    setNotes("");
    setGeneratedContent(null);
    setHasInitializedPrefill(false);
    onOpenChange(false);
  };

  const selectedSupplier = suppliers.find(s => s.id === selectedSupplierId);

  const filteredItems = useMemo(() => {
    if (!searchQuery) return itemsWithCriticality;
    const query = searchQuery.toLowerCase();
    return itemsWithCriticality.filter(item =>
      item.name.toLowerCase().includes(query) ||
      item.sku.toLowerCase().includes(query)
    );
  }, [itemsWithCriticality, searchQuery]);

  const toggleItemSelection = (itemId: string) => {
    setSelectedItems(prev => {
      const existing = prev.find(i => i.itemId === itemId);
      if (existing) {
        return prev.filter(i => i.itemId !== itemId);
      }
      return [...prev, { itemId, quantity: 1 }];
    });
  };

  const updateItemQuantity = (itemId: string, quantity: number) => {
    if (quantity < 1) return;
    setSelectedItems(prev =>
      prev.map(item =>
        item.itemId === itemId ? { ...item, quantity } : item
      )
    );
  };

  const updateItemUnitCost = (itemId: string, unitCost: number | undefined) => {
    setSelectedItems(prev =>
      prev.map(item =>
        item.itemId === itemId ? { ...item, unitCost } : item
      )
    );
  };

  const getRiskColor = (daysUntilStockout: number) => {
    if (daysUntilStockout <= 7) return "destructive";
    if (daysUntilStockout <= 14) return "default";
    if (daysUntilStockout <= 30) return "secondary";
    return "outline";
  };

  const getRiskLabel = (daysUntilStockout: number) => {
    if (daysUntilStockout <= 7) return "Critical";
    if (daysUntilStockout <= 14) return "High";
    if (daysUntilStockout <= 30) return "Medium";
    if (daysUntilStockout >= 9999) return "OK";
    return "Low";
  };

  const canProceedFromSupplier = () => {
    if (isNewSupplier) {
      return newSupplierName.trim() && (supplierEmail.trim() || supplierPhone.trim());
    }
    return selectedSupplierId && (selectedSupplier?.email || selectedSupplier?.phone || supplierEmail || supplierPhone);
  };

  const canProceedFromItems = () => {
    return selectedItems.length > 0;
  };

  const handleSubmit = () => {
    createAndSendMutation.mutate({
      supplierId: isNewSupplier ? undefined : selectedSupplierId,
      supplierName: isNewSupplier ? newSupplierName : selectedSupplier?.name,
      supplierEmail: supplierEmail || selectedSupplier?.email || undefined,
      supplierPhone: supplierPhone || selectedSupplier?.phone || undefined,
      items: selectedItems,
      sendVia,
      notes,
      isNewSupplier,
    });
  };

  const renderSupplierStep = () => (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="new-supplier"
            checked={isNewSupplier}
            onCheckedChange={(checked) => {
              setIsNewSupplier(!!checked);
              if (checked) {
                setSelectedSupplierId("");
              } else {
                setNewSupplierName("");
                setSupplierEmail("");
                setSupplierPhone("");
              }
            }}
            data-testid="checkbox-new-supplier"
          />
          <Label htmlFor="new-supplier">Create new supplier</Label>
        </div>
      </div>

      {isNewSupplier ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-supplier-name">Supplier Name</Label>
            <Input
              id="new-supplier-name"
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
              placeholder="Enter supplier name"
              data-testid="input-new-supplier-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-email">Email</Label>
            <Input
              id="supplier-email"
              type="email"
              value={supplierEmail}
              onChange={(e) => setSupplierEmail(e.target.value)}
              placeholder="supplier@example.com"
              data-testid="input-supplier-email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-phone">Phone</Label>
            <Input
              id="supplier-phone"
              type="tel"
              value={supplierPhone}
              onChange={(e) => setSupplierPhone(e.target.value)}
              placeholder="+1 555-123-4567"
              data-testid="input-supplier-phone"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Select Supplier</Label>
            <Select
              value={selectedSupplierId}
              onValueChange={(value) => {
                setSelectedSupplierId(value);
                const supplier = suppliers.find(s => s.id === value);
                if (supplier) {
                  setSupplierEmail(supplier.email || "");
                  setSupplierPhone(supplier.phone || "");
                }
              }}
            >
              <SelectTrigger data-testid="select-supplier">
                <SelectValue placeholder="Choose a supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      <span>{supplier.name}</span>
                      {!supplier.email && !supplier.phone && (
                        <Badge variant="outline" className="ml-2 text-xs">No contact</Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedSupplierId && (
            <div className="space-y-4 p-4 border rounded-md bg-muted/30">
              {!selectedSupplier?.email && !selectedSupplier?.phone ? (
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  <p className="text-sm font-medium">
                    This supplier has no contact info. Please enter email or phone:
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Override contact info for this PO (optional):
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="override-email">Email</Label>
                <Input
                  id="override-email"
                  type="email"
                  value={supplierEmail}
                  onChange={(e) => setSupplierEmail(e.target.value)}
                  placeholder={selectedSupplier?.email || "Enter email address"}
                  data-testid="input-override-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="override-phone">Phone</Label>
                <Input
                  id="override-phone"
                  type="tel"
                  value={supplierPhone}
                  onChange={(e) => setSupplierPhone(e.target.value)}
                  placeholder={selectedSupplier?.phone || "Enter phone number"}
                  data-testid="input-override-phone"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderItemsStep = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search items by name or SKU..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          data-testid="input-search-items"
        />
      </div>

      <p className="text-sm text-muted-foreground">
        Items sorted by urgency (most critical first). Selected: {selectedItems.length}
      </p>

      <ScrollArea className="h-[400px] border rounded-md">
        <div className="p-2 space-y-1">
          {isLoadingItems ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filteredItems.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No items found</p>
          ) : (
            filteredItems.map((item) => {
              const selected = selectedItems.find(i => i.itemId === item.id);
              const stock = item.type === 'finished_product' 
                ? (item.pivotQty || 0)
                : item.currentStock;

              return (
                <div
                  key={item.id}
                  className={`p-3 rounded-md border cursor-pointer transition-colors ${
                    selected ? 'border-primary bg-primary/5' : 'hover-elevate'
                  }`}
                  onClick={() => toggleItemSelection(item.id)}
                  data-testid={`item-row-${item.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={!!selected}
                        onCheckedChange={() => toggleItemSelection(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`checkbox-item-${item.id}`}
                      />
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-sm">
                        <p>Stock: {stock}</p>
                        <p className="text-muted-foreground">
                          {item.daysUntilStockout >= 9999 ? 'No usage' : `${item.daysUntilStockout}d left`}
                        </p>
                      </div>
                      <Badge variant={getRiskColor(item.daysUntilStockout)}>
                        {getRiskLabel(item.daysUntilStockout)}
                      </Badge>
                    </div>
                  </div>

                  {selected && (
                    <div
                      className="mt-3 pt-3 border-t flex items-center gap-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`qty-${item.id}`} className="text-sm">Qty:</Label>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() => updateItemQuantity(item.id, selected.quantity - 1)}
                            data-testid={`button-decrease-qty-${item.id}`}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <Input
                            id={`qty-${item.id}`}
                            type="number"
                            min="1"
                            value={selected.quantity}
                            onChange={(e) => updateItemQuantity(item.id, parseInt(e.target.value) || 1)}
                            className="w-16 h-7 text-center"
                            data-testid={`input-qty-${item.id}`}
                          />
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() => updateItemQuantity(item.id, selected.quantity + 1)}
                            data-testid={`button-increase-qty-${item.id}`}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`cost-${item.id}`} className="text-sm">Unit $:</Label>
                        <Input
                          id={`cost-${item.id}`}
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={selected.unitCost || ""}
                          onChange={(e) => updateItemUnitCost(item.id, e.target.value ? parseFloat(e.target.value) : undefined)}
                          className="w-20 h-7"
                          data-testid={`input-cost-${item.id}`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );

  const renderReviewStep = () => {
    const supplierName = isNewSupplier ? newSupplierName : selectedSupplier?.name;
    const email = supplierEmail || selectedSupplier?.email;
    const phone = supplierPhone || selectedSupplier?.phone;

    return (
      <div className="space-y-6">
        <div className="p-4 border rounded-md space-y-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <span className="font-medium">{supplierName}</span>
            {isNewSupplier && <Badge variant="secondary">New</Badge>}
          </div>
          {email && <p className="text-sm text-muted-foreground">Email: {email}</p>}
          {phone && <p className="text-sm text-muted-foreground">Phone: {phone}</p>}
        </div>

        <div className="space-y-2">
          <h4 className="font-medium flex items-center gap-2">
            <Package className="h-4 w-4" />
            Items ({selectedItems.length})
          </h4>
          <div className="border rounded-md divide-y max-h-[150px] overflow-auto">
            {selectedItems.map((si) => {
              const item = itemsWithCriticality.find(i => i.id === si.itemId);
              return (
                <div key={si.itemId} className="p-2 flex items-center justify-between">
                  <span className="text-sm">{item?.name || si.itemId}</span>
                  <div className="text-sm text-muted-foreground">
                    Qty: {si.quantity}
                    {si.unitCost && ` @ $${si.unitCost.toFixed(2)}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <Label>Send via:</Label>
          <RadioGroup
            value={sendVia}
            onValueChange={(value) => setSendVia(value as "EMAIL" | "SMS")}
            className="flex gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="EMAIL" id="send-email" disabled={!email} data-testid="radio-send-email" />
              <Label
                htmlFor="send-email"
                className={`flex items-center gap-2 ${!email ? 'opacity-50' : ''}`}
              >
                <Mail className="h-4 w-4" />
                Email
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="SMS" id="send-sms" disabled={!phone} data-testid="radio-send-sms" />
              <Label
                htmlFor="send-sms"
                className={`flex items-center gap-2 ${!phone ? 'opacity-50' : ''}`}
              >
                <MessageSquare className="h-4 w-4" />
                SMS
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="po-notes">Additional Notes (optional)</Label>
          <Textarea
            id="po-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any special instructions for the supplier..."
            rows={3}
            data-testid="textarea-po-notes"
          />
        </div>

        <div className="p-3 bg-muted/50 rounded-md flex items-start gap-2">
          <Sparkles className="h-4 w-4 mt-0.5 text-primary" />
          <p className="text-sm text-muted-foreground">
            A professional PO message will be automatically generated using AI before sending.
          </p>
        </div>
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[500px] sm:max-w-[500px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Create Purchase Order
          </SheetTitle>
          <SheetDescription>
            {step === "supplier" && "Select or create a supplier for this order"}
            {step === "items" && "Choose items to include in this purchase order"}
            {step === "review" && "Review and send your purchase order"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 my-4">
          <div className={`flex-1 h-1 rounded ${step === "supplier" || step === "items" || step === "review" ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`flex-1 h-1 rounded ${step === "items" || step === "review" ? 'bg-primary' : 'bg-muted'}`} />
          <div className={`flex-1 h-1 rounded ${step === "review" ? 'bg-primary' : 'bg-muted'}`} />
        </div>

        <div className="flex-1 overflow-auto py-4">
          {step === "supplier" && renderSupplierStep()}
          {step === "items" && renderItemsStep()}
          {step === "review" && renderReviewStep()}
        </div>

        <SheetFooter className="gap-2">
          {step !== "supplier" && (
            <Button
              variant="outline"
              onClick={() => setStep(step === "items" ? "supplier" : "items")}
              data-testid="button-back"
            >
              Back
            </Button>
          )}
          
          {step === "supplier" && (
            <Button
              onClick={() => setStep("items")}
              disabled={!canProceedFromSupplier()}
              data-testid="button-next-supplier"
            >
              Next: Select Items
            </Button>
          )}
          
          {step === "items" && (
            <Button
              onClick={() => setStep("review")}
              disabled={!canProceedFromItems()}
              data-testid="button-next-items"
            >
              Next: Review ({selectedItems.length})
            </Button>
          )}
          
          {step === "review" && (
            <Button
              onClick={handleSubmit}
              disabled={createAndSendMutation.isPending}
              data-testid="button-create-and-send"
            >
              {createAndSendMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Create & Send PO
                </>
              )}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
