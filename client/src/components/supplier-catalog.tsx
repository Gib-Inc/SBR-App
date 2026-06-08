import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Package, Search, Loader2 } from "lucide-react";

interface SupplierItemRow { id: string; itemId: string; itemName: string; itemSku: string; price: number | null; }
interface StockItem { id: string; sku: string; name: string; price?: number | null; defaultPurchaseCost?: number | null; }

/**
 * Manage a supplier's product catalog — the items they make/supply, with the
 * supplier's unit cost. Linking products here is what makes them PRE-FILL on a
 * new Purchase Order for this supplier (set quantities at order time). Backed by
 * /api/supplier-items (POST link, PATCH price, DELETE unlink).
 */
export function SupplierCatalog({ supplierId, supplierName }: { supplierId: string; supplierName: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");

  const { data: catalog = [], isLoading } = useQuery<SupplierItemRow[]>({
    queryKey: [`/api/supplier-items?supplierId=${supplierId}`],
    enabled: !!supplierId,
  });
  const { data: allItems = [] } = useQuery<StockItem[]>({ queryKey: ["/api/items"], enabled: adding });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [`/api/supplier-items?supplierId=${supplierId}`] });
    qc.invalidateQueries({ queryKey: ["/api/supplier-items"] });
  };

  const linkedIds = useMemo(() => new Set(catalog.map((c) => c.itemId)), [catalog]);

  const addMut = useMutation({
    mutationFn: async (item: StockItem) =>
      (await apiRequest("POST", "/api/supplier-items", {
        supplierId,
        itemId: item.id,
        price: item.defaultPurchaseCost ?? item.price ?? 0,
      })).json(),
    onSuccess: () => { invalidate(); },
    onError: (e: any) => toast({ title: "Couldn't add product", description: e.message, variant: "destructive" }),
  });
  const priceMut = useMutation({
    mutationFn: async ({ id, price }: { id: string; price: number }) =>
      (await apiRequest("PATCH", `/api/supplier-items/${id}`, { price })).json(),
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Couldn't update price", description: e.message, variant: "destructive" }),
  });
  const removeMut = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/supplier-items/${id}`)).json(),
    onSuccess: () => { invalidate(); },
    onError: (e: any) => toast({ title: "Couldn't remove", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems
      .filter((it) => !linkedIds.has(it.id))
      .filter((it) => !q || it.name?.toLowerCase().includes(q) || it.sku?.toLowerCase().includes(q))
      .slice(0, 40);
  }, [allItems, linkedIds, search]);

  const fmt = (v: number | null | undefined) => (v == null ? "—" : "$" + Number(v).toFixed(2));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" /> Catalog — what {supplierName} makes
            <span className="text-xs font-normal text-muted-foreground">({catalog.length})</span>
          </CardTitle>
          <Button size="sm" variant={adding ? "secondary" : "default"} className="h-7 text-xs shrink-0" onClick={() => setAdding((a) => !a)} data-testid="button-toggle-add-catalog">
            <Plus className="h-3 w-3 mr-1" /> {adding ? "Done" : "Add products"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">These pre-fill on a new PO for {supplierName} — you set the quantity (and can tweak the price) at order time.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <div className="rounded-lg border p-2 space-y-2 bg-muted/30">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-7 h-8 text-sm" placeholder="Search products by name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-catalog-search" />
            </div>
            <div className="max-h-48 overflow-y-auto divide-y rounded border bg-background">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">No matching products. Create new ones on the Products page first, then link them here.</p>
              ) : filtered.map((it) => (
                <button key={it.id} className="w-full flex items-center justify-between py-1.5 px-2 text-sm hover:bg-muted/50 text-left" onClick={() => addMut.mutate(it)} disabled={addMut.isPending} data-testid={`catalog-add-${it.id}`}>
                  <span className="truncate min-w-0"><span className="font-medium">{it.name}</span> <span className="text-xs text-muted-foreground">{it.sku}</span></span>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
                </button>
              ))}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : catalog.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No products linked yet. Click <strong>Add products</strong> to list everything {supplierName} makes — then they'll auto-load on every PO.</p>
        ) : (
          <div className="rounded-lg border divide-y">
            {catalog.map((row) => (
              <div key={row.id} className="flex items-center gap-2 px-2 py-1.5 text-sm" data-testid={`catalog-row-${row.itemId}`}>
                <div className="min-w-0 flex-1 truncate"><span className="font-medium">{row.itemName}</span> <span className="text-xs text-muted-foreground">{row.itemSku}</span></div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-muted-foreground">$</span>
                  <Input
                    type="number" step="0.01" className="h-7 w-24 text-sm tabular-nums"
                    defaultValue={row.price ?? 0}
                    onBlur={(e) => { const p = parseFloat(e.target.value); if (!Number.isNaN(p) && p !== (row.price ?? 0)) priceMut.mutate({ id: row.id, price: p }); }}
                    data-testid={`catalog-price-${row.itemId}`}
                  />
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-600" onClick={() => removeMut.mutate(row.id)} disabled={removeMut.isPending} title="Remove from catalog" data-testid={`catalog-remove-${row.itemId}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
