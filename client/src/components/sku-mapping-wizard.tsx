import { useState, useMemo, useEffect } from "react";
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
import { Search, Save, AlertTriangle, CheckCircle, XCircle, Link2, Unlink, RefreshCw, Loader2, Sparkles, BookOpen, ArrowRightLeft, Download, Play, Package } from "lucide-react";
import { SiShopify, SiAmazon, SiQuickbooks } from "react-icons/si";
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
  quickbooksItemId: string | null;
  quickbooksItemName: string | null;
  quickbooksItemSku: string | null;
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

interface ExtensivProduct {
  sku: string;
  name: string;
  quantity: number;
  upc: string | null;
  warehouseId: string;
}

interface ExtensivProductsResponse {
  success: boolean;
  products: ExtensivProduct[];
  totalProducts: number;
  warehouseId: string;
  message?: string;
}

type SourceType = "shopify" | "amazon" | "extensiv" | "quickbooks" | null;

interface SkuMappingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  source?: SourceType;
  onCompleteSync?: () => void;
}

export function SkuMappingWizard({ isOpen, onClose, source = null, onCompleteSync }: SkuMappingWizardProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState(source || "shopify");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingChanges, setPendingChanges] = useState<Record<string, Partial<Item>>>({});

  useEffect(() => {
    if (isOpen && source) {
      setActiveTab(source);
    } else if (isOpen && !source) {
      setActiveTab("shopify");
    }
  }, [isOpen, source]);

  const { data: items = [], isLoading } = useQuery<Item[]>({
    queryKey: ["/api/items"],
  });

  // Show all items (finished products + components) for SKU mapping
  const allMappableItems = items as Item[];
  // Keep finishedProducts for backward compatibility with other tabs
  const finishedProducts = allMappableItems.filter((item) => item.type === "finished_product");

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

  const handleSkuChange = (itemId: string, channel: "shopifySku" | "amazonSku" | "extensivSku" | "quickbooksItemId", value: string) => {
    setPendingChanges((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [channel]: value.trim() || null,
      },
    }));
  };

  const getCurrentValue = (item: Item, channel: "shopifySku" | "amazonSku" | "extensivSku" | "quickbooksItemId"): string => {
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

  // For Shopify tab, use all items; for other tabs, use finishedProducts
  const filteredProducts = allMappableItems.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getMappingStats = (channel: "shopifySku" | "amazonSku" | "extensivSku" | "quickbooksItemId") => {
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

  // Sync names from Shopify to internal items
  const [isSyncingNames, setIsSyncingNames] = useState(false);
  
  const syncNamesFromShopify = async () => {
    const linkedItems = allMappableItems.filter(item => item.shopifyVariantId);
    if (linkedItems.length === 0) {
      toast({
        title: "No Linked Products",
        description: "Link products to Shopify first to sync names",
      });
      return;
    }
    
    setIsSyncingNames(true);
    let updatedCount = 0;
    
    try {
      for (const item of linkedItems) {
        const linkedVariant = allShopifyVariants.find(v => v.variantId === item.shopifyVariantId);
        if (linkedVariant && linkedVariant.fullName && linkedVariant.fullName !== item.name) {
          await apiRequest("PATCH", `/api/items/${item.id}`, {
            name: linkedVariant.fullName,
          });
          updatedCount++;
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      
      toast({
        title: "Names Synced",
        description: updatedCount > 0 
          ? `Updated ${updatedCount} product name${updatedCount > 1 ? 's' : ''} from Shopify`
          : "All product names already match Shopify",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Sync Failed",
        description: "Failed to sync some product names. Please try again.",
      });
    } finally {
      setIsSyncingNames(false);
    }
  };

  const handleLinkToShopify = (item: Item, variant: typeof allShopifyVariants[0]) => {
    linkToShopifyMutation.mutate({
      itemId: item.id,
      variantId: variant.variantId,
      inventoryItemId: variant.inventoryItemId,
      productId: variant.productId,
      sku: variant.sku,
    });
  };

  // Get all suggested matches for bulk apply
  const getAllSuggestedMatches = () => {
    return filteredProducts
      .filter(item => !item.shopifyVariantId) // Only unmapped items
      .map(item => ({ item, match: getSuggestedMatch(item) }))
      .filter((entry): entry is { item: Item; match: NonNullable<ReturnType<typeof getSuggestedMatch>> } => 
        entry.match !== null
      );
  };

  // Bulk apply all suggested matches
  const [isApplyingAll, setIsApplyingAll] = useState(false);
  
  const applyAllSuggestedMatches = async () => {
    const matches = getAllSuggestedMatches();
    if (matches.length === 0) return;
    
    setIsApplyingAll(true);
    try {
      for (const { item, match } of matches) {
        await linkToShopifyMutation.mutateAsync({
          itemId: item.id,
          variantId: match.variant.variantId,
          inventoryItemId: match.variant.inventoryItemId,
          productId: match.variant.productId,
          sku: match.variant.sku,
        });
      }
      toast({
        title: "All Matches Applied",
        description: `Successfully linked ${matches.length} product${matches.length > 1 ? 's' : ''} to Shopify`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Bulk Apply Failed",
        description: "Some products could not be linked. Please try again.",
      });
    } finally {
      setIsApplyingAll(false);
    }
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

  // Compute unmapped Shopify variants (products in Shopify not linked to any item)
  // Check ALL items (both finished_product and component types) for shopifyVariantId
  const unmappedShopifyVariants = useMemo(() => {
    const linkedVariantIds = new Set(
      items
        .filter(item => item.shopifyVariantId)
        .map(item => item.shopifyVariantId)
    );
    return allShopifyVariants.filter(v => !linkedVariantIds.has(v.variantId));
  }, [allShopifyVariants, items]);

  // State for import modal
  const [showImportPrompt, setShowImportPrompt] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });

  // Import Shopify products as items
  const importShopifyProductsMutation = useMutation({
    mutationFn: async (variants: typeof allShopifyVariants) => {
      const results = { imported: 0, skipped: 0, errors: 0 };
      setImportProgress({ current: 0, total: variants.length });
      
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        try {
          const hasUpc = !!variant.barcode;
          await apiRequest("POST", "/api/items", {
            name: variant.fullName,
            sku: variant.sku || `SHOP-${variant.variantId}`,
            type: hasUpc ? "finished_product" : "component",
            upc: variant.barcode || null,
            shopifyProductId: variant.productId,
            shopifyVariantId: variant.variantId,
            shopifyInventoryItemId: variant.inventoryItemId,
            shopifySku: variant.sku,
          });
          results.imported++;
        } catch (error: any) {
          if (error.message?.includes("already exists") || error.message?.includes("duplicate")) {
            results.skipped++;
          } else {
            results.errors++;
          }
        }
        setImportProgress({ current: i + 1, total: variants.length });
      }
      
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      refetchShopify();
      setShowImportPrompt(false);
      toast({
        title: "Import Complete",
        description: `Imported ${results.imported} product${results.imported !== 1 ? 's' : ''}${results.skipped > 0 ? `, ${results.skipped} skipped` : ''}${results.errors > 0 ? `, ${results.errors} errors` : ''}`,
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Import Failed",
        description: error.message || "Failed to import products",
      });
    },
  });

  // Handle complete sync - callback handles closing, so we just call it
  const handleCompleteSync = () => {
    if (onCompleteSync) {
      onCompleteSync();
    } else {
      onClose();
    }
  };

  // === EXTENSIV TAB LOGIC ===
  const [extensivSearchQuery, setExtensivSearchQuery] = useState("");
  
  // Fetch Extensiv products
  const { data: extensivProducts, isLoading: isLoadingExtensiv, refetch: refetchExtensiv } = useQuery<ExtensivProductsResponse>({
    queryKey: ["/api/integrations/extensiv/products"],
    enabled: activeTab === "extensiv",
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Precompute maps for O(1) lookups - optimized for large catalogs
  const { extensivByUpc, extensivBySku } = useMemo(() => {
    const byUpc = new Map<string, ExtensivProduct>();
    const bySku = new Map<string, ExtensivProduct>();
    
    if (extensivProducts?.products) {
      for (const product of extensivProducts.products) {
        if (product.upc) {
          byUpc.set(product.upc, product);
        }
        bySku.set(product.sku, product);
      }
    }
    
    return { extensivByUpc: byUpc, extensivBySku: bySku };
  }, [extensivProducts]);

  // Auto-suggest Extensiv matches for a product (O(1) lookup)
  const getExtensivSuggestedMatch = (item: Item) => {
    // First try UPC match (highest priority)
    if (item.upc) {
      const upcMatch = extensivByUpc.get(item.upc);
      if (upcMatch) return { product: upcMatch, matchType: 'UPC' as const };
    }
    
    // Then try SKU match (internal SKU or existing extensivSku)
    const skuMatch = extensivBySku.get(item.sku) || 
                     (item.extensivSku ? extensivBySku.get(item.extensivSku) : null);
    if (skuMatch) return { product: skuMatch, matchType: 'SKU' as const };
    
    return null;
  };

  // Link product to Extensiv SKU
  const linkToExtensivMutation = useMutation({
    mutationFn: async (data: { itemId: string; extensivSku: string }) => {
      const response = await apiRequest("PATCH", `/api/items/${data.itemId}`, {
        extensivSku: data.extensivSku,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Linked to Extensiv",
        description: "Product successfully linked to Extensiv SKU",
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

  // Unlink product from Extensiv
  const unlinkFromExtensivMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const response = await apiRequest("PATCH", `/api/items/${itemId}`, {
        extensivSku: null,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Unlinked from Extensiv",
        description: "Product unlinked from Extensiv",
      });
    },
  });

  // Get all suggested Extensiv matches for bulk apply
  const getAllExtensivSuggestedMatches = () => {
    return filteredProducts
      .filter(item => !item.extensivSku) // Only unmapped items
      .map(item => ({ item, match: getExtensivSuggestedMatch(item) }))
      .filter((entry): entry is { item: Item; match: NonNullable<ReturnType<typeof getExtensivSuggestedMatch>> } => 
        entry.match !== null
      );
  };

  // Bulk apply all Extensiv suggested matches
  const [isApplyingAllExtensiv, setIsApplyingAllExtensiv] = useState(false);
  
  const applyAllExtensivSuggestedMatches = async () => {
    const matches = getAllExtensivSuggestedMatches();
    if (matches.length === 0) return;
    
    setIsApplyingAllExtensiv(true);
    try {
      for (const { item, match } of matches) {
        await linkToExtensivMutation.mutateAsync({
          itemId: item.id,
          extensivSku: match.product.sku,
        });
      }
      toast({
        title: "All Matches Applied",
        description: `Successfully linked ${matches.length} product${matches.length > 1 ? 's' : ''} to Extensiv`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Bulk Apply Failed",
        description: "Some products could not be linked. Please try again.",
      });
    } finally {
      setIsApplyingAllExtensiv(false);
    }
  };

  // Filter Extensiv products by search
  const filteredExtensivProducts = useMemo(() => {
    if (!extensivProducts?.products) return [];
    if (!extensivSearchQuery) return extensivProducts.products;
    const query = extensivSearchQuery.toLowerCase();
    return extensivProducts.products.filter(p => 
      p.name.toLowerCase().includes(query) ||
      p.sku.toLowerCase().includes(query) ||
      (p.upc?.toLowerCase().includes(query))
    );
  }, [extensivProducts, extensivSearchQuery]);

  // Render enhanced Shopify tab
  const renderShopifyTab = () => {
    // Use all items for Shopify mapping stats (not just finished products)
    const mappedCount = allMappableItems.filter(p => p.shopifyVariantId).length;
    const unmappedCount = allMappableItems.length - mappedCount;

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
          <SiShopify className="h-12 w-12 text-[#96bf48] mx-auto mb-3" />
          <p className="font-medium">Connect Shopify to Enable Auto-Matching</p>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {shopifyProducts?.message?.includes("not configured") 
              ? "Add your Shopify store credentials in AI Agent → Data Sources to automatically match products by UPC and SKU."
              : shopifyProducts?.message || "Configure Shopify integration to enable product matching."}
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => refetchShopify()} data-testid="button-retry-shopify">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      );
    }

    const suggestedMatches = getAllSuggestedMatches();
    const suggestedCount = suggestedMatches.length;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1">
              <CheckCircle className="h-3 w-3 text-green-500" />
              {mappedCount} Linked
            </Badge>
            <Badge variant="outline" className="gap-1">
              <XCircle className="h-3 w-3 text-orange-500" />
              {unmappedCount} Unmapped
            </Badge>
            {suggestedCount > 0 && (
              <Badge variant="default" className="gap-1 bg-blue-500">
                <Sparkles className="h-3 w-3" />
                {suggestedCount} Suggested
              </Badge>
            )}
            <Badge variant="secondary" className="gap-1">
              <SiShopify className="h-3 w-3" />
              {shopifyProducts.totalVariants} Variants
            </Badge>
            <div className="h-4 w-px bg-border mx-1" />
            <Badge variant="outline" className="gap-1.5 text-xs">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Finished Product
            </Badge>
            <Badge variant="outline" className="gap-1.5 text-xs">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Item Inventory
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {suggestedCount > 0 && (
              <Button 
                size="sm" 
                onClick={applyAllSuggestedMatches}
                disabled={isApplyingAll}
                data-testid="button-apply-all-matches"
              >
                {isApplyingAll ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-1" />
                )}
                Apply All ({suggestedCount})
              </Button>
            )}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={syncNamesFromShopify}
              disabled={isSyncingNames || allMappableItems.filter(item => item.shopifyVariantId).length === 0}
              data-testid="button-sync-names-shopify"
            >
              {isSyncingNames ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4 mr-1" />
              )}
              Sync Names
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetchShopify()} data-testid="button-refresh-shopify">
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>
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
                  <Card key={item.id} className={`${isLinked ? "border-green-500/50" : suggestedMatch ? "border-primary/50" : ""} overflow-hidden`}>
                    <CardContent className="p-3">
                      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 items-center">
                        <div className="min-w-0 overflow-hidden">
                          <div className="font-medium truncate flex items-center gap-2">
                            <span 
                              className={`h-2 w-2 rounded-full flex-shrink-0 ${item.upc ? "bg-green-500" : "bg-blue-500"}`}
                              title={item.upc ? "Finished Product (has UPC)" : "Item Inventory (no UPC)"}
                            />
                            {item.name}
                          </div>
                          <div className="text-sm text-muted-foreground font-mono flex items-center gap-2 overflow-hidden ml-4">
                            <span className="flex-shrink-0">{item.sku}</span>
                            {item.upc && <Badge variant="secondary" className="text-xs flex-shrink-0">UPC: {item.upc}</Badge>}
                          </div>
                        </div>
                        
                        <div className="min-w-0">
                          {isLinked ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 min-w-0 px-3 py-2 bg-green-50 dark:bg-green-950 rounded border border-green-200 dark:border-green-800 overflow-hidden">
                                <div className="flex items-center gap-1 text-sm text-green-700 dark:text-green-300 min-w-0">
                                  <Link2 className="h-4 w-4 flex-shrink-0" />
                                  <span className="font-medium truncate">{linkedVariant?.fullName || item.shopifySku}</span>
                                </div>
                              </div>
                              <Button
                                size="icon"
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
                              <div className="flex-1 min-w-0 px-3 py-2 bg-blue-50 dark:bg-blue-950 rounded border border-blue-200 dark:border-blue-800 overflow-hidden">
                                <div className="flex items-center gap-1 text-sm text-blue-700 dark:text-blue-300 min-w-0">
                                  <Sparkles className="h-4 w-4 flex-shrink-0" />
                                  <span className="font-medium truncate">{suggestedMatch.variant.fullName}</span>
                                </div>
                              </div>
                              <Button
                                size="icon"
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

  // Render enhanced Extensiv tab with auto-matching
  const renderExtensivTab = () => {
    const mappedCount = finishedProducts.filter(p => p.extensivSku).length;
    const unmappedCount = finishedProducts.length - mappedCount;

    if (isLoadingExtensiv) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading Extensiv products...</span>
        </div>
      );
    }

    if (!extensivProducts?.success) {
      return (
        <div className="text-center py-8">
          <svg className="h-12 w-12 text-blue-500 mx-auto mb-3" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <p className="font-medium">Connect Extensiv to Enable Auto-Matching</p>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {extensivProducts?.message?.includes("not configured") 
              ? "Add your Extensiv API credentials in AI Agent → Data Sources to automatically match products by UPC and SKU."
              : extensivProducts?.message || "Configure Extensiv integration to enable product matching."}
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => refetchExtensiv()} data-testid="button-retry-extensiv">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      );
    }

    const suggestedMatches = getAllExtensivSuggestedMatches();
    const suggestedCount = suggestedMatches.length;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1">
              <CheckCircle className="h-3 w-3 text-green-500" />
              {mappedCount} Linked
            </Badge>
            <Badge variant="outline" className="gap-1">
              <XCircle className="h-3 w-3 text-orange-500" />
              {unmappedCount} Unmapped
            </Badge>
            {suggestedCount > 0 && (
              <Badge variant="default" className="gap-1 bg-blue-500">
                <Sparkles className="h-3 w-3" />
                {suggestedCount} Suggested
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {suggestedCount > 0 && (
              <Button
                size="sm"
                onClick={applyAllExtensivSuggestedMatches}
                disabled={isApplyingAllExtensiv}
                data-testid="button-apply-all-extensiv"
              >
                {isApplyingAllExtensiv ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-1" />
                )}
                Apply All Suggested
              </Button>
            )}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetchExtensiv()}
              data-testid="button-refresh-extensiv"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          {extensivProducts.totalProducts} items in Extensiv (Warehouse: {extensivProducts.warehouseId})
        </div>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-2">
            {filteredProducts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? "No products match your search" : "No finished products found"}
              </div>
            ) : (
              filteredProducts.map((item) => {
                const isLinked = !!item.extensivSku;
                const suggestedMatch = !isLinked ? getExtensivSuggestedMatch(item) : null;
                const linkedProduct = isLinked && extensivProducts.products 
                  ? extensivProducts.products.find(p => p.sku === item.extensivSku)
                  : null;

                return (
                  <Card key={item.id} className={`${isLinked ? "border-green-500/50" : suggestedMatch ? "border-primary/50" : ""} overflow-hidden`}>
                    <CardContent className="p-3">
                      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 items-center">
                        <div className="min-w-0 overflow-hidden">
                          <div className="font-medium truncate">{item.name}</div>
                          <div className="text-sm text-muted-foreground font-mono">{item.sku}</div>
                          {item.upc && (
                            <div className="text-xs text-muted-foreground">UPC: {item.upc}</div>
                          )}
                        </div>
                        <div className="min-w-0">
                          {isLinked ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 min-w-0 px-3 py-2 bg-green-50 dark:bg-green-950 rounded border border-green-200 dark:border-green-800 overflow-hidden">
                                <div className="flex items-center gap-1 text-sm text-green-700 dark:text-green-300 min-w-0">
                                  <Link2 className="h-4 w-4 flex-shrink-0" />
                                  <span className="font-medium truncate">
                                    {linkedProduct?.name || item.extensivSku}
                                  </span>
                                </div>
                                {linkedProduct && (
                                  <div className="text-xs text-green-600 dark:text-green-400">
                                    SKU: {linkedProduct.sku} | Qty: {linkedProduct.quantity}
                                  </div>
                                )}
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => unlinkFromExtensivMutation.mutate(item.id)}
                                disabled={unlinkFromExtensivMutation.isPending}
                                data-testid={`button-unlink-extensiv-${item.id}`}
                              >
                                <Unlink className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : suggestedMatch ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 min-w-0 px-3 py-2 bg-blue-50 dark:bg-blue-950 rounded border border-blue-200 dark:border-blue-800 overflow-hidden">
                                <div className="flex items-center gap-1 text-sm text-blue-700 dark:text-blue-300 min-w-0">
                                  <Sparkles className="h-4 w-4 flex-shrink-0" />
                                  <span className="font-medium truncate">{suggestedMatch.product.name}</span>
                                </div>
                                <div className="text-xs text-blue-600 dark:text-blue-400">
                                  SKU: {suggestedMatch.product.sku} | Qty: {suggestedMatch.product.quantity}
                                </div>
                              </div>
                              <Button
                                size="icon"
                                onClick={() => linkToExtensivMutation.mutate({
                                  itemId: item.id,
                                  extensivSku: suggestedMatch.product.sku,
                                })}
                                disabled={linkToExtensivMutation.isPending}
                                data-testid={`button-accept-extensiv-match-${item.id}`}
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <Select
                              value=""
                              onValueChange={(sku) => {
                                if (sku) {
                                  linkToExtensivMutation.mutate({
                                    itemId: item.id,
                                    extensivSku: sku,
                                  });
                                }
                              }}
                            >
                              <SelectTrigger className="w-full" data-testid={`select-extensiv-sku-${item.id}`}>
                                <SelectValue placeholder="Select Extensiv product..." />
                              </SelectTrigger>
                              <SelectContent>
                                <div className="p-2">
                                  <Input
                                    placeholder="Search products..."
                                    value={extensivSearchQuery}
                                    onChange={(e) => setExtensivSearchQuery(e.target.value)}
                                    className="mb-2"
                                  />
                                </div>
                                <ScrollArea className="h-[200px]">
                                  {filteredExtensivProducts.slice(0, 50).map((product) => (
                                    <SelectItem key={product.sku} value={product.sku}>
                                      <div className="flex flex-col">
                                        <span className="truncate">{product.name}</span>
                                        <span className="text-xs text-muted-foreground">
                                          SKU: {product.sku}
                                          {product.upc && ` | UPC: ${product.upc}`}
                                          {` | Qty: ${product.quantity}`}
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
    channel: "shopifySku" | "amazonSku" | "extensivSku" | "quickbooksItemId",
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
                <Card key={item.id} className={`${hasChanges(item.id) ? "border-primary" : ""} overflow-hidden`}>
                  <CardContent className="p-3">
                    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 items-center">
                      <div className="min-w-0 overflow-hidden">
                        <div className="font-medium truncate">{item.name}</div>
                        <div className="text-sm text-muted-foreground font-mono">{item.sku}</div>
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        {getCurrentValue(item, channel) ? (
                          <Link2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <Unlink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        )}
                        <Input
                          value={getCurrentValue(item, channel)}
                          onChange={(e) => handleSkuChange(item.id, channel, e.target.value)}
                          placeholder={placeholder}
                          className="flex-1 min-w-0 font-mono text-sm"
                          data-testid={`input-${channel}-${item.id}`}
                        />
                        {hasChanges(item.id) && (
                          <Button
                            size="icon"
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
      <DialogContent className="max-w-4xl overflow-hidden">
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

          <Tabs value={activeTab} onValueChange={source ? undefined : (value) => setActiveTab(value as "shopify" | "amazon" | "extensiv" | "quickbooks")}>
            {!source && (
              <TabsList className="grid w-full grid-cols-4">
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
                <TabsTrigger value="quickbooks" className="gap-2" data-testid="tab-quickbooks-sku">
                  <SiQuickbooks className="h-4 w-4" />
                  QuickBooks
                </TabsTrigger>
              </TabsList>
            )}

            <TabsContent value="shopify" className="mt-4">
              {renderShopifyTab()}
            </TabsContent>

            <TabsContent value="amazon" className="mt-4">
              {renderChannelTab("amazonSku", "Amazon", "Enter Amazon MSKU")}
            </TabsContent>

            <TabsContent value="extensiv" className="mt-4">
              {renderExtensivTab()}
            </TabsContent>

            <TabsContent value="quickbooks" className="mt-4">
              {renderChannelTab("quickbooksItemId", "QuickBooks", "Enter QuickBooks Item ID")}
            </TabsContent>
          </Tabs>
        </div>

        {/* Import Prompt for unmapped Shopify products */}
        {activeTab === "shopify" && unmappedShopifyVariants.length > 0 && !showImportPrompt && (
          <div className="flex items-center justify-between p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg mt-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm font-medium">
                  {unmappedShopifyVariants.length} Shopify product{unmappedShopifyVariants.length !== 1 ? 's' : ''} not in your system
                </p>
                <p className="text-xs text-muted-foreground">
                  Products with UPC will be added as finished products, others as components
                </p>
              </div>
            </div>
            <Button 
              size="sm" 
              onClick={() => setShowImportPrompt(true)}
              data-testid="button-show-import-prompt"
            >
              <Download className="mr-2 h-4 w-4" />
              Import Products
            </Button>
          </div>
        )}

        {/* Import Confirmation */}
        {showImportPrompt && (
          <div className="p-4 bg-muted rounded-lg mt-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium">Import {unmappedShopifyVariants.length} products from Shopify?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Products will be created based on their UPC/barcode:
                </p>
              </div>
            </div>
            
            {/* Product list with classification badges */}
            <ScrollArea className="h-[200px] border rounded-md bg-background">
              <div className="p-2 space-y-2">
                {unmappedShopifyVariants.map((variant) => {
                  const hasUpc = !!variant.barcode;
                  return (
                    <div 
                      key={variant.variantId} 
                      className="flex items-center justify-between p-2 rounded border bg-card"
                      data-testid={`import-item-${variant.variantId}`}
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        <p className="text-sm font-medium truncate">{variant.fullName}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {variant.sku && (
                            <span className="text-xs text-muted-foreground">SKU: {variant.sku}</span>
                          )}
                          {variant.barcode && (
                            <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-600 border-purple-500/30">
                              UPC: {variant.barcode}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Badge 
                        variant="outline" 
                        className={hasUpc 
                          ? "text-xs bg-green-500/10 text-green-600 border-green-500/30 whitespace-nowrap" 
                          : "text-xs bg-blue-500/10 text-blue-600 border-blue-500/30 whitespace-nowrap"
                        }
                      >
                        {hasUpc ? "Finished Product" : "Item Inventory"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {importShopifyProductsMutation.isPending && (
              <div className="mt-3">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing {importProgress.current} of {importProgress.total}...
                </div>
                <div className="w-full bg-muted-foreground/20 rounded-full h-2 mt-2">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowImportPrompt(false)}
                disabled={importShopifyProductsMutation.isPending}
                data-testid="button-cancel-import"
              >
                Cancel
              </Button>
              <Button 
                size="sm"
                onClick={() => importShopifyProductsMutation.mutate(unmappedShopifyVariants)}
                disabled={importShopifyProductsMutation.isPending}
                data-testid="button-confirm-import"
              >
                {importShopifyProductsMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Yes, Import All
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-between gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose} data-testid="button-close-sku-wizard">
            {totalPendingChanges > 0 ? "Close (Discard Changes)" : "Close"}
          </Button>
          
          {source === "shopify" && onCompleteSync && (
            <Button 
              onClick={handleCompleteSync}
              data-testid="button-complete-sync"
            >
              <Play className="mr-2 h-4 w-4" />
              Complete Sync
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
