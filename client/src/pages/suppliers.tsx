import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  Wrench,
  Search,
  Plus,
  Pencil,
  Mail,
  Phone,
  MapPin,
  Loader2,
  Users,
  ShoppingBag,
  Upload,
} from "lucide-react";
import { EditSupplierDialog } from "@/components/edit-supplier-dialog";
import { ReliabilityBadge, computeSupplierMetrics } from "@/components/supplier-performance";
import { ImportSuppliersDialog } from "@/components/import-suppliers-dialog";
import type { Supplier } from "@shared/schema";

export default function Suppliers() {
  const [activeTab, setActiveTab] = useState("existing");
  const [searchQuery, setSearchQuery] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [dialogMode, setDialogMode] = useState<"edit" | "create">("edit");
  const [importOpen, setImportOpen] = useState(false);

  const { data: suppliers = [], isLoading, refetch } = useQuery<Supplier[]>({
    queryKey: ['/api/suppliers'],
  });

  // Pull POs + supplier_items once so the Reliability column can compute OTDR
  // per supplier without N+1 fetches.
  const { data: allPOs = [] } = useQuery<any[]>({ queryKey: ['/api/purchase-orders'] });
  const { data: allSupplierItems = [] } = useQuery<any[]>({ queryKey: ['/api/supplier-items'] });
  const reliabilityBySupplier = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const s of suppliers) {
      const m = computeSupplierMetrics(allPOs as any, allSupplierItems as any, s.id);
      map.set(s.id, m.otdr);
    }
    return map;
  }, [suppliers, allPOs, allSupplierItems]);

  const filteredSuppliers = useMemo(() => {
    if (!searchQuery.trim()) return suppliers;
    const query = searchQuery.toLowerCase();
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        (s.email && s.email.toLowerCase().includes(query)) ||
        (s.contactName && s.contactName.toLowerCase().includes(query))
    );
  }, [suppliers, searchQuery]);

  const handleEditSupplier = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setDialogMode("edit");
    setEditDialogOpen(true);
  };

  const handleAddSupplier = () => {
    setSelectedSupplier(null);
    setDialogMode("create");
    setEditDialogOpen(true);
  };

  const handleDialogSaved = () => {
    refetch();
  };

  return (
    <div className="flex flex-col gap-6 p-6" data-testid="page-suppliers">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">
          Suppliers
        </h1>
        <p className="text-muted-foreground" data-testid="text-page-subtitle">
          Manage supplier information used throughout the app
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="existing" data-testid="tab-existing">
            <Users className="mr-2 h-4 w-4" />
            Existing
          </TabsTrigger>
          <TabsTrigger value="discover" data-testid="tab-discover">
            <Search className="mr-2 h-4 w-4" />
            Discover
          </TabsTrigger>
        </TabsList>

        <TabsContent value="existing" className="mt-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-suppliers"
                />
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" data-testid="badge-supplier-count">
                  {filteredSuppliers.length} supplier{filteredSuppliers.length !== 1 ? "s" : ""}
                </Badge>
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <Upload className="mr-2 h-4 w-4" />
                  Import
                </Button>
                <Button onClick={handleAddSupplier} data-testid="button-add-supplier">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Supplier
                </Button>
              </div>
            </div>

            <Card data-testid="card-suppliers-table">
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredSuppliers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">
                      {searchQuery
                        ? "No suppliers match your search"
                        : "No suppliers yet. Add your first supplier!"}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[180px]">Supplier Name</TableHead>
                          <TableHead className="min-w-[150px]">Contact Name</TableHead>
                          <TableHead className="min-w-[200px]">Email</TableHead>
                          <TableHead className="min-w-[140px]">Phone</TableHead>
                          <TableHead className="min-w-[250px]">Address</TableHead>
                          <TableHead className="min-w-[100px]">Payment Terms</TableHead>
                          <TableHead className="min-w-[100px]">PO Activity</TableHead>
                          <TableHead className="w-[110px] text-center">Reliability</TableHead>
                          <TableHead className="w-[80px] text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSuppliers.map((supplier) => (
                          <TableRow
                            key={supplier.id}
                            data-testid={`row-supplier-${supplier.id}`}
                            className="cursor-pointer hover-elevate"
                            onClick={() => handleEditSupplier(supplier)}
                          >
                            <TableCell className="font-medium" data-testid={`text-supplier-name-${supplier.id}`}>
                              <div className="flex items-center gap-2">
                                {supplier.name}
                                {(supplier as any).supplierType === "online" && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 font-normal">
                                    <ShoppingBag className="h-3 w-3" /> Online
                                  </Badge>
                                )}
                                {(supplier as any).supplierType === "private" && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 font-normal">
                                    <Wrench className="h-3 w-3" /> Private
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell data-testid={`text-contact-name-${supplier.id}`}>
                              {supplier.contactName || (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell data-testid={`text-email-${supplier.id}`}>
                              {supplier.email ? (
                                <div className="flex items-center gap-1">
                                  <Mail className="h-3 w-3 text-muted-foreground" />
                                  <span className="truncate max-w-[180px]">{supplier.email}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell data-testid={`text-phone-${supplier.id}`}>
                              {supplier.phone ? (
                                <div className="flex items-center gap-1">
                                  <Phone className="h-3 w-3 text-muted-foreground" />
                                  <span>{supplier.phone}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell data-testid={`text-address-${supplier.id}`}>
                              {supplier.city || supplier.stateRegion || supplier.country ? (
                                <div className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <span className="truncate max-w-[220px]">
                                    {[supplier.city, supplier.stateRegion, supplier.country]
                                      .filter(Boolean)
                                      .join(", ")}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell data-testid={`text-payment-terms-${supplier.id}`}>
                              {supplier.paymentTerms ? (
                                <Badge variant="outline">{supplier.paymentTerms}</Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell data-testid={`text-po-activity-${supplier.id}`}>
                              <div className="flex items-center gap-1 text-sm">
                                <span className="font-medium">{supplier.poSentCount || 0}</span>
                                <span className="text-muted-foreground">/</span>
                                <span className="font-medium">{supplier.poReceivedCount || 0}</span>
                                <span className="text-muted-foreground text-xs ml-1">(sent/recv)</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center" data-testid={`text-reliability-${supplier.id}`}>
                              <ReliabilityBadge otdr={reliabilityBySupplier.get(supplier.id) ?? null} />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditSupplier(supplier);
                                }}
                                data-testid={`button-edit-supplier-${supplier.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="discover" className="mt-6">
          <div className="flex items-center justify-center flex-1 min-h-[400px]">
            <Card className="max-w-md w-full" data-testid="card-discover-coming-soon">
              <CardContent className="pt-6 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <Wrench className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Coming soon</h3>
                <p className="text-muted-foreground" data-testid="text-discover-description">
                  Supplier discovery tools are coming in V2. This will help you find and
                  evaluate new suppliers for your business.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <EditSupplierDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        supplier={selectedSupplier}
        mode={dialogMode}
        onSaved={handleDialogSaved}
      />
      <ImportSuppliersDialog
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </div>
  );
}
