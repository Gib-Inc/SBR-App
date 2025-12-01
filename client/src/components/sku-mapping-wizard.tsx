import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Save, AlertTriangle, CheckCircle, XCircle, Link2, Unlink } from "lucide-react";
import { SiShopify, SiAmazon } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Item {
  id: string;
  name: string;
  sku: string;
  type: string;
  shopifySku: string | null;
  amazonSku: string | null;
  extensivSku: string | null;
}

interface SkuMappingWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SkuMappingWizard({ isOpen, onClose }: SkuMappingWizardProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("shopify");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingChanges, setPendingChanges] = useState<Record<string, Partial<Item>>>({});

  const { data: items = [], isLoading } = useQuery<Item[]>({
    queryKey: ["/api/items"],
  });

  const finishedProducts = (items as Item[]).filter((item) => item.type === "finished_product");

  const updateMutation = useMutation({
    mutationFn: async (updates: { id: string; data: Partial<Item> }) => {
      const response = await apiRequest("PATCH", `/api/items/${updates.id}`, updates.data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: error.message || "Failed to update SKU mapping",
      });
    },
  });

  const handleSkuChange = (itemId: string, channel: "shopifySku" | "amazonSku" | "extensivSku", value: string) => {
    setPendingChanges((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [channel]: value.trim() || null,
      },
    }));
  };

  const getCurrentValue = (item: Item, channel: "shopifySku" | "amazonSku" | "extensivSku"): string => {
    if (pendingChanges[item.id]?.[channel] !== undefined) {
      return pendingChanges[item.id][channel] || "";
    }
    return item[channel] || "";
  };

  const hasChanges = (itemId: string): boolean => {
    return pendingChanges[itemId] !== undefined && Object.keys(pendingChanges[itemId]).length > 0;
  };

  const saveChanges = async (itemId: string) => {
    const changes = pendingChanges[itemId];
    if (!changes) return;

    await updateMutation.mutateAsync({ id: itemId, data: changes });
    setPendingChanges((prev) => {
      const { [itemId]: _, ...rest } = prev;
      return rest;
    });
    toast({
      title: "Saved",
      description: "SKU mapping updated successfully",
    });
  };

  const saveAllChanges = async () => {
    const itemIds = Object.keys(pendingChanges);
    for (const itemId of itemIds) {
      await updateMutation.mutateAsync({ id: itemId, data: pendingChanges[itemId] });
    }
    setPendingChanges({});
    toast({
      title: "All Changes Saved",
      description: `Updated ${itemIds.length} product${itemIds.length > 1 ? "s" : ""}`,
    });
  };

  const filteredProducts = finishedProducts.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getMappingStats = (channel: "shopifySku" | "amazonSku" | "extensivSku") => {
    const mapped = finishedProducts.filter((item) => item[channel]).length;
    const unmapped = finishedProducts.length - mapped;
    return { mapped, unmapped, total: finishedProducts.length };
  };

  const renderChannelTab = (
    channel: "shopifySku" | "amazonSku" | "extensivSku",
    channelLabel: string,
    placeholder: string
  ) => {
    const stats = getMappingStats(channel);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="gap-1">
              <CheckCircle className="h-3 w-3 text-green-500" />
              {stats.mapped} Mapped
            </Badge>
            <Badge variant="outline" className="gap-1">
              <XCircle className="h-3 w-3 text-orange-500" />
              {stats.unmapped} Unmapped
            </Badge>
          </div>
          {Object.keys(pendingChanges).length > 0 && (
            <Button
              size="sm"
              onClick={saveAllChanges}
              disabled={updateMutation.isPending}
              data-testid={`button-save-all-${channel}`}
            >
              <Save className="h-4 w-4 mr-1" />
              Save All Changes
            </Button>
          )}
        </div>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-2">
            {filteredProducts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? "No products match your search" : "No finished products found"}
              </div>
            ) : (
              filteredProducts.map((item) => (
                <Card key={item.id} className={hasChanges(item.id) ? "border-primary" : ""}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.name}</div>
                        <div className="text-sm text-muted-foreground font-mono">{item.sku}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getCurrentValue(item, channel) ? (
                          <Link2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <Unlink className="h-4 w-4 text-muted-foreground" />
                        )}
                        <Input
                          value={getCurrentValue(item, channel)}
                          onChange={(e) => handleSkuChange(item.id, channel, e.target.value)}
                          placeholder={placeholder}
                          className="w-48 font-mono text-sm"
                          data-testid={`input-${channel}-${item.id}`}
                        />
                        {hasChanges(item.id) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => saveChanges(item.id)}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-${channel}-${item.id}`}
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    );
  };

  const totalPendingChanges = Object.keys(pendingChanges).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            SKU Mapping Wizard
            {totalPendingChanges > 0 && (
              <Badge variant="secondary">{totalPendingChanges} unsaved</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products by name or SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
              data-testid="input-sku-wizard-search"
            />
          </div>

          <div className="bg-muted/50 rounded-lg p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5" />
              <div>
                <p className="font-medium">Map external SKUs to your products</p>
                <p className="text-muted-foreground">
                  When orders come in from Shopify, Amazon, or Extensiv, these mappings tell the system which of your
                  products to update. Unmapped SKUs will be flagged for review.
                </p>
              </div>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="shopify" className="gap-2" data-testid="tab-shopify-sku">
                <SiShopify className="h-4 w-4" />
                Shopify
              </TabsTrigger>
              <TabsTrigger value="amazon" className="gap-2" data-testid="tab-amazon-sku">
                <SiAmazon className="h-4 w-4" />
                Amazon
              </TabsTrigger>
              <TabsTrigger value="extensiv" className="gap-2" data-testid="tab-extensiv-sku">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
                Extensiv
              </TabsTrigger>
            </TabsList>

            <TabsContent value="shopify" className="mt-4">
              {renderChannelTab("shopifySku", "Shopify", "Enter Shopify SKU")}
            </TabsContent>

            <TabsContent value="amazon" className="mt-4">
              {renderChannelTab("amazonSku", "Amazon", "Enter Amazon MSKU")}
            </TabsContent>

            <TabsContent value="extensiv" className="mt-4">
              {renderChannelTab("extensivSku", "Extensiv", "Enter Extensiv Item ID")}
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose} data-testid="button-close-sku-wizard">
            {totalPendingChanges > 0 ? "Close (Discard Changes)" : "Close"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
