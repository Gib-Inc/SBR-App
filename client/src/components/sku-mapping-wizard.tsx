import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Save, AlertTriangle, CheckCircle, XCircle, Link2, Unlink, RefreshCw, Loader2, Sparkles } from "lucide-react";
import { SiShopify, SiAmazon } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Item {
  id: string;
  name: string;
  sku: string;
  type: string;
  upc: string | null;
  shopifyProductId: string | null;
  shopifySku: string | null;
  shopifyVariantId: string | null;
  shopifyInventoryItemId: string | null;
  amazonSku: string | null;
  extensivSku: string | null;
}

interface ShopifyVariant {
  variantId: string;
  variantTitle: string;
  sku: string | null;
  barcode: string | null;
  inventoryItemId: string;
}

interface ShopifyProduct {
  productId: string;
  productTitle: string;
  variants: ShopifyVariant[];
}

interface ShopifyProductsResponse {
  success: boolean;
  products: ShopifyProduct[];
  totalProducts: number;
  totalVariants: number;
  message?: string;
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

  // Enhanced Shopify tab with product fetching and auto-matching
  const [shopifySearchQuery, setShopifySearchQuery] = useState("");
  const [selectedMappings, setSelectedMappings] = useState<Record<string, { 
    productId: string; 
    variantId: string; 
    inventoryItemId: string;
    sku: string | null;
  }>>({});

  // Fetch Shopify products
  const { data: shopifyProducts, isLoading: isLoadingShopify, refetch: refetchShopify } = useQuery<ShopifyProductsResponse>({
    queryKey: ["/api/integrations/shopify/products"],
    enabled: activeTab === "shopify",
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Flatten variants for easier searching
  const allShopifyVariants = useMemo(() => {
    if (!shopifyProducts?.products) return [];
    return shopifyProducts.products.flatMap(product => 
      product.variants.map(variant => ({
        ...variant,
        productId: product.productId,
        productTitle: product.productTitle,
        fullName: `${product.productTitle}${variant.variantTitle !== 'Default' ? ` - ${variant.variantTitle}` : ''}`,
      }))
    );
  }, [shopifyProducts]);

  // Precompute maps for O(1) lookups - optimized for large catalogs
  const { variantByUpc, variantBySku } = useMemo(() => {
    const byUpc = new Map<string, typeof allShopifyVariants[0]>();
    const bySku = new Map<string, typeof allShopifyVariants[0]>();
    
    for (const variant of allShopifyVariants) {
      if (variant.barcode) {
        byUpc.set(variant.barcode, variant);
      }
      if (variant.sku) {
        bySku.set(variant.sku, variant);
      }
    }
    
    return { variantByUpc: byUpc, variantBySku: bySku };
  }, [allShopifyVariants]);

  // Auto-suggest matches for a product (O(1) lookup using precomputed maps)
  const getSuggestedMatch = (item: Item) => {
    // First try UPC match (highest priority)
    if (item.upc) {
      const upcMatch = variantByUpc.get(item.upc);
      if (upcMatch) return { variant: upcMatch, matchType: 'UPC' as const };
    }
    
    // Then try SKU match (internal SKU or existing shopifySku)
    const skuMatch = variantBySku.get(item.sku) || 
                     (item.shopifySku ? variantBySku.get(item.shopifySku) : null);
    if (skuMatch) return { variant: skuMatch, matchType: 'SKU' as const };
    
    return null;
  };

  // Link product to Shopify variant
  const linkToShopifyMutation = useMutation({
    mutationFn: async (data: { itemId: string; variantId: string; inventoryItemId: string; productId: string; sku: string | null }) => {
      const response = await apiRequest("PATCH", `/api/items/${data.itemId}`, {
        shopifyProductId: data.productId,
        shopifyVariantId: data.variantId,
        shopifyInventoryItemId: data.inventoryItemId,
        shopifySku: data.sku,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Linked to Shopify",
        description: "Product successfully linked to Shopify variant",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Link Failed",
        description: error.message || "Failed to link product",
      });
    },
  });

  // Unlink product from Shopify
  const unlinkFromShopifyMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const response = await apiRequest("PATCH", `/api/items/${itemId}`, {
        shopifyProductId: null,
        shopifyVariantId: null,
        shopifyInventoryItemId: null,
        shopifySku: null,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Unlinked from Shopify",
        description: "Product unlinked from Shopify",
      });
    },
  });

  const handleLinkToShopify = (item: Item, variant: typeof allShopifyVariants[0]) => {
    linkToShopifyMutation.mutate({
      itemId: item.id,
      variantId: variant.variantId,
      inventoryItemId: variant.inventoryItemId,
      productId: variant.productId,
      sku: variant.sku,
    });
  };

  // Filter Shopify variants by search
  const filteredShopifyVariants = useMemo(() => {
    if (!shopifySearchQuery) return allShopifyVariants;
    const query = shopifySearchQuery.toLowerCase();
    return allShopifyVariants.filter(v => 
      v.fullName.toLowerCase().includes(query) ||
      (v.sku?.toLowerCase().includes(query)) ||
      (v.barcode?.toLowerCase().includes(query))
    );
  }, [allShopifyVariants, shopifySearchQuery]);

  // Render enhanced Shopify tab
  const renderShopifyTab = () => {
    const mappedCount = finishedProducts.filter(p => p.shopifyVariantId).length;
    const unmappedCount = finishedProducts.length - mappedCount;

    if (isLoadingShopify) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading Shopify products...</span>
        </div>
      );
    }

    if (!shopifyProducts?.success) {
      return (
        <div className="text-center py-8">
          <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto mb-3" />
          <p className="font-medium">Unable to load Shopify products</p>
          <p className="text-sm text-muted-foreground mb-4">
            {shopifyProducts?.message || "Configure Shopify integration in Settings"}
          </p>
          <Button variant="outline" onClick={() => refetchShopify()} data-testid="button-retry-shopify">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="gap-1">
              <CheckCircle className="h-3 w-3 text-green-500" />
              {mappedCount} Linked
            </Badge>
            <Badge variant="outline" className="gap-1">
              <XCircle className="h-3 w-3 text-orange-500" />
              {unmappedCount} Unmapped
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <SiShopify className="h-3 w-3" />
              {shopifyProducts.totalVariants} Variants
            </Badge>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchShopify()} data-testid="button-refresh-shopify">
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-2">
            {filteredProducts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? "No products match your search" : "No finished products found"}
              </div>
            ) : (
              filteredProducts.map((item) => {
                const suggestedMatch = getSuggestedMatch(item);
                const isLinked = !!item.shopifyVariantId;
                const linkedVariant = isLinked ? allShopifyVariants.find(v => v.variantId === item.shopifyVariantId) : null;

                return (
                  <Card key={item.id} className={isLinked ? "border-green-500/50" : suggestedMatch ? "border-primary/50" : ""}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.name}</div>
                          <div className="text-sm text-muted-foreground font-mono flex items-center gap-2">
                            <span>{item.sku}</span>
                            {item.upc && <Badge variant="secondary" className="text-xs">UPC: {item.upc}</Badge>}
                          </div>
                        </div>
                        
                        <div className="flex flex-col gap-2 min-w-[280px]">
                          {isLinked ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 px-3 py-2 bg-green-50 dark:bg-green-950 rounded border border-green-200 dark:border-green-800">
                                <div className="flex items-center gap-1 text-sm text-green-700 dark:text-green-300">
                                  <Link2 className="h-4 w-4" />
                                  <span className="font-medium truncate">{linkedVariant?.fullName || item.shopifySku}</span>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => unlinkFromShopifyMutation.mutate(item.id)}
                                disabled={unlinkFromShopifyMutation.isPending}
                                data-testid={`button-unlink-${item.id}`}
                              >
                                <Unlink className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : suggestedMatch ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 px-3 py-2 bg-blue-50 dark:bg-blue-950 rounded border border-blue-200 dark:border-blue-800">
                                <div className="flex items-center gap-1 text-sm text-blue-700 dark:text-blue-300">
                                  <Sparkles className="h-4 w-4" />
                                  <span className="font-medium truncate">{suggestedMatch.variant.fullName}</span>
                                  <Badge variant="secondary" className="text-xs ml-auto">{suggestedMatch.matchType}</Badge>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => handleLinkToShopify(item, suggestedMatch.variant)}
                                disabled={linkToShopifyMutation.isPending}
                                data-testid={`button-accept-match-${item.id}`}
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <Select
                              value=""
                              onValueChange={(variantId) => {
                                const variant = allShopifyVariants.find(v => v.variantId === variantId);
                                if (variant) handleLinkToShopify(item, variant);
                              }}
                            >
                              <SelectTrigger className="w-full" data-testid={`select-shopify-variant-${item.id}`}>
                                <SelectValue placeholder="Select Shopify variant..." />
                              </SelectTrigger>
                              <SelectContent>
                                <div className="p-2">
                                  <Input
                                    placeholder="Search variants..."
                                    value={shopifySearchQuery}
                                    onChange={(e) => setShopifySearchQuery(e.target.value)}
                                    className="mb-2"
                                  />
                                </div>
                                <ScrollArea className="h-[200px]">
                                  {filteredShopifyVariants.slice(0, 50).map((variant) => (
                                    <SelectItem key={variant.variantId} value={variant.variantId}>
                                      <div className="flex flex-col">
                                        <span className="truncate">{variant.fullName}</span>
                                        <span className="text-xs text-muted-foreground">
                                          {variant.sku && `SKU: ${variant.sku}`}
                                          {variant.sku && variant.barcode && ' | '}
                                          {variant.barcode && `UPC: ${variant.barcode}`}
                                        </span>
                                      </div>
                                    </SelectItem>
                                  ))}
                                </ScrollArea>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    );
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
              {renderShopifyTab()}
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
