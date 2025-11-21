import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Edit, Trash2, Package } from "lucide-react";

export default function Products() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // Fetch products
  const { data: products, isLoading } = useQuery({
    queryKey: ["/api/products"],
  });

  // Fetch all items for BOM builder
  const { data: items } = useQuery({
    queryKey: ["/api/items"],
  });

  const filteredProducts = (products ?? []).filter((product: any) =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    product.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products & BOM</h1>
          <p className="text-sm text-muted-foreground">Manage finished products and bill of materials</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-product">
              <Plus className="mr-2 h-4 w-4" />
              Create New Product
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Create New Product</DialogTitle>
            </DialogHeader>
            <ProductForm
              items={items || []}
              onClose={() => setIsCreateDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-products"
          />
        </div>
      </div>

      {/* Products List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Products</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2">
              <Package className="h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "No products found" : "No products yet. Create your first product to get started."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Components</TableHead>
                  <TableHead className="text-right">Current Stock</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product: any) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">
                        {product.componentsCount || 0} components
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{product.currentStock}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSelectedProduct(product)}
                              data-testid={`button-edit-${product.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl">
                            <DialogHeader>
                              <DialogTitle>Edit Product</DialogTitle>
                            </DialogHeader>
                            <ProductForm
                              product={selectedProduct}
                              items={items || []}
                              onClose={() => setSelectedProduct(null)}
                            />
                          </DialogContent>
                        </Dialog>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-delete-${product.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProductForm({ product, items, onClose }: { product?: any; items: any[]; onClose: () => void }) {
  const [bomComponents, setBomComponents] = useState<Array<{ componentId: string; quantity: number }>>(
    product?.bom ?? []
  );

  const addComponent = () => {
    setBomComponents([...bomComponents, { componentId: "", quantity: 1 }]);
  };

  const removeComponent = (index: number) => {
    setBomComponents(bomComponents.filter((_, i) => i !== index));
  };

  const updateComponent = (index: number, field: string, value: any) => {
    const updated = [...bomComponents];
    updated[index] = { ...updated[index], [field]: value };
    setBomComponents(updated);
  };

  const componentItems = (items ?? []).filter((item: any) => item.type === "component");

  return (
    <div className="space-y-6">
      {/* Product Details */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="product-name">Product Name</Label>
          <Input
            id="product-name"
            placeholder="e.g., Sticker Bur Roller"
            defaultValue={product?.name}
            data-testid="input-product-name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-sku">SKU</Label>
          <Input
            id="product-sku"
            placeholder="e.g., SBR-001"
            defaultValue={product?.sku}
            className="font-mono"
            data-testid="input-product-sku"
          />
        </div>
      </div>

      {/* BOM Components */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">Bill of Materials</h3>
            <p className="text-sm text-muted-foreground">Define component requirements</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addComponent}
            data-testid="button-add-component"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Component
          </Button>
        </div>

        {bomComponents.length === 0 ? (
          <Card>
            <CardContent className="flex h-32 items-center justify-center">
              <p className="text-sm text-muted-foreground">No components added yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {bomComponents.map((component, index) => (
              <div key={index} className="flex items-end gap-3">
                <div className="flex-1 space-y-2">
                  <Label>Component</Label>
                  <Select
                    value={component.componentId}
                    onValueChange={(value) => updateComponent(index, "componentId", value)}
                  >
                    <SelectTrigger data-testid={`select-component-${index}`}>
                      <SelectValue placeholder="Select component" />
                    </SelectTrigger>
                    <SelectContent>
                      {componentItems.map((item: any) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} ({item.sku})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-32 space-y-2">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min="1"
                    value={component.quantity}
                    onChange={(e) => updateComponent(index, "quantity", parseInt(e.target.value) || 1)}
                    data-testid={`input-quantity-${index}`}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeComponent(index)}
                  data-testid={`button-remove-component-${index}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} data-testid="button-cancel">
          Cancel
        </Button>
        <Button data-testid="button-save-product">
          {product ? "Update Product" : "Create Product"}
        </Button>
      </div>
    </div>
  );
}
