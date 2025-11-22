import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Package } from "lucide-react";

interface VisionResult {
  name: string;
  sku: string | null;
  quantity: number | null;
  type: "component" | "finished_product";
  category: string | null;
  location: string | null;
  confidence: number;
  description: string;
}

interface VisionConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  visionResult: VisionResult | null;
  onConfirm: (action: "create" | "adjust", data: Partial<VisionResult> & { adjustmentQuantity?: number }) => void;
  isLoading?: boolean;
}

const WAREHOUSE_LOCATIONS = [
  "Spanish Fork",
  "Hildale",
];

export function VisionConfirmationDialog({
  isOpen,
  onClose,
  visionResult,
  onConfirm,
  isLoading = false,
}: VisionConfirmationDialogProps) {
  const [action, setAction] = useState<"create" | "adjust">("create");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState<number>(0);
  const [adjustmentQuantity, setAdjustmentQuantity] = useState<number>(0);
  const [itemType, setItemType] = useState<"component" | "finished_product">("component");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState<string>("");

  useEffect(() => {
    if (visionResult) {
      setName(visionResult.name || "");
      setSku(visionResult.sku || "");
      setQuantity(visionResult.quantity || 0);
      setAdjustmentQuantity(visionResult.quantity || 0);
      setItemType(visionResult.type || "component");
      setCategory(visionResult.category || "");
      setLocation(visionResult.location || "");
    }
  }, [visionResult]);

  const handleConfirm = () => {
    if (action === "create") {
      onConfirm(action, {
        name,
        sku,
        quantity,
        type: itemType,
        category: itemType === "component" ? category : undefined,
        location: itemType === "finished_product" ? location : undefined,
      });
    } else {
      onConfirm(action, {
        name,
        sku,
        adjustmentQuantity,
      });
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onClose();
    }
  };

  if (!visionResult) return null;

  const confidenceColor =
    visionResult.confidence >= 0.8 ? "default" :
    visionResult.confidence >= 0.5 ? "secondary" : "destructive";

  const confidenceLabel =
    visionResult.confidence >= 0.8 ? "High Confidence" :
    visionResult.confidence >= 0.5 ? "Medium Confidence" : "Low Confidence";

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Confirm Item Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Confidence Badge */}
          <div className="flex items-center justify-between">
            <Badge variant={confidenceColor}>
              {visionResult.confidence >= 0.8 ? (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              ) : (
                <AlertCircle className="mr-1 h-3 w-3" />
              )}
              {confidenceLabel} ({Math.round(visionResult.confidence * 100)}%)
            </Badge>
          </div>

          {/* AI Description */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>AI Analysis:</strong> {visionResult.description}
            </AlertDescription>
          </Alert>

          {/* Action Selection */}
          <div className="space-y-2">
            <Label>Action</Label>
            <Select value={action} onValueChange={(value: any) => setAction(value)}>
              <SelectTrigger data-testid="select-vision-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="create">Create New Item</SelectItem>
                <SelectItem value="adjust">Adjust Existing Stock</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vision-name">Item Name *</Label>
              <Input
                id="vision-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-vision-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vision-sku">SKU</Label>
              <Input
                id="vision-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                data-testid="input-vision-sku"
              />
            </div>

            {action === "create" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="vision-quantity">Initial Quantity *</Label>
                  <Input
                    id="vision-quantity"
                    type="number"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                    data-testid="input-vision-quantity"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vision-type">Item Type *</Label>
                  <Select value={itemType} onValueChange={(value: any) => setItemType(value)}>
                    <SelectTrigger id="vision-type" data-testid="select-vision-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="component">Component</SelectItem>
                      <SelectItem value="finished_product">Finished Product</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {itemType === "component" && (
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="vision-category">Category</Label>
                    <Input
                      id="vision-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="e.g., Fasteners, Electronics"
                      data-testid="input-vision-category"
                    />
                  </div>
                )}

                {itemType === "finished_product" && (
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="vision-location">Warehouse Location</Label>
                    <Select value={location || "none"} onValueChange={(value) => setLocation(value === "none" ? "" : value)}>
                      <SelectTrigger id="vision-location" data-testid="select-vision-location">
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— No location —</SelectItem>
                        {WAREHOUSE_LOCATIONS.map((loc) => (
                          <SelectItem key={loc} value={loc}>
                            {loc}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            {action === "adjust" && (
              <div className="col-span-2 space-y-2">
                <Label htmlFor="vision-adjustment">Quantity to Add *</Label>
                <Input
                  id="vision-adjustment"
                  type="number"
                  value={adjustmentQuantity}
                  onChange={(e) => setAdjustmentQuantity(parseInt(e.target.value) || 0)}
                  data-testid="input-vision-adjustment"
                />
                <p className="text-xs text-muted-foreground">
                  Enter a positive number to add stock or negative to subtract
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || !name || (action === "create" && quantity < 0)}
            data-testid="button-confirm-vision"
          >
            {isLoading ? "Processing..." : action === "create" ? "Create Item" : "Adjust Stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
