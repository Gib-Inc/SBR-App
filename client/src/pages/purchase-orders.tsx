import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { 
  Search, 
  Filter, 
  Calendar,
  Package,
  CheckCircle2,
  Clock,
  XCircle,
  FileText,
  ChevronDown
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { PurchaseOrder, Supplier } from "@shared/schema";

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: any }> = {
  DRAFT: { bg: "bg-gray-500/10", text: "text-gray-600 dark:text-gray-400", icon: FileText },
  APPROVAL_PENDING: { bg: "bg-yellow-500/10", text: "text-yellow-600 dark:text-yellow-500", icon: Clock },
  APPROVED: { bg: "bg-green-500/10", text: "text-green-600 dark:text-green-500", icon: CheckCircle2 },
  SENT: { bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-500", icon: Package },
  PARTIAL_RECEIVED: { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-500", icon: Package },
  RECEIVED: { bg: "bg-green-500/10", text: "text-green-600 dark:text-green-500", icon: CheckCircle2 },
  CLOSED: { bg: "bg-gray-500/10", text: "text-gray-600 dark:text-gray-400", icon: CheckCircle2 },
  CANCELLED: { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-500", icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_COLORS[status] || STATUS_COLORS.DRAFT;
  const Icon = config.icon;
  
  return (
    <Badge variant="secondary" className={`${config.bg} ${config.text} gap-1`}>
      <Icon className="h-3 w-3" />
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

function PORow({ 
  po, 
  supplier, 
  onSelect 
}: { 
  po: PurchaseOrder; 
  supplier?: Supplier;
  onSelect: (id: string) => void;
}) {
  return (
    <tr 
      className="hover-elevate active-elevate-2 cursor-pointer border-b last:border-0"
      onClick={() => onSelect(po.id)}
      data-testid={`row-po-${po.id}`}
    >
      <td className="px-4 py-3 text-sm font-medium" data-testid={`text-po-number-${po.id}`}>
        {po.poNumber || po.id.slice(0, 8)}
      </td>
      <td className="px-4 py-3 text-sm" data-testid={`text-supplier-${po.id}`}>
        {supplier?.name || 'Unknown'}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={po.status} />
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {format(new Date(po.orderDate), 'MMM dd, yyyy')}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {po.expectedDate ? format(new Date(po.expectedDate), 'MMM dd, yyyy') : '-'}
      </td>
      <td className="px-4 py-3 text-sm font-medium">
        -
      </td>
      <td className="px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" data-testid={`button-actions-${po.id}`}>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelect(po.id); }}>
              View Details
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

export default function PurchaseOrders() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);

  const { data: purchaseOrders, isLoading: loadingPOs } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders"],
  });

  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const supplierMap = new Map(suppliers?.map(s => [s.id, s]) || []);

  const filteredPOs = purchaseOrders?.filter((po) => {
    const supplier = supplierMap.get(po.supplierId);
    const matchesSearch = 
      !searchQuery ||
      po.poNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      supplier?.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || po.status === statusFilter;
    const matchesSupplier = supplierFilter === "all" || po.supplierId === supplierFilter;
    
    return matchesSearch && matchesStatus && matchesSupplier;
  }) || [];

  const stats = {
    total: purchaseOrders?.length || 0,
    draft: purchaseOrders?.filter(po => po.status === 'DRAFT').length || 0,
    pending: purchaseOrders?.filter(po => po.status === 'APPROVAL_PENDING').length || 0,
    active: purchaseOrders?.filter(po => ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'].includes(po.status)).length || 0,
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-none p-6 border-b">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold">Purchase Orders</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage purchase orders and supplier deliveries
            </p>
          </div>
          <Button data-testid="button-create-po">
            <FileText className="h-4 w-4 mr-2" />
            New Purchase Order
          </Button>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total POs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-total">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Draft</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-draft">{stats.draft}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending Approval</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-pending">{stats.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="stat-active">{stats.active}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex-none p-6 border-b">
        <div className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by PO number or supplier..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48" data-testid="select-status-filter">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="APPROVAL_PENDING">Pending Approval</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="SENT">Sent</SelectItem>
              <SelectItem value="PARTIAL_RECEIVED">Partial Received</SelectItem>
              <SelectItem value="RECEIVED">Received</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-48" data-testid="select-supplier-filter">
              <Package className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by supplier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Suppliers</SelectItem>
              {suppliers?.map(supplier => (
                <SelectItem key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">PO Number</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Supplier</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Order Date</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Expected Date</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Total</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingPOs ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3" colSpan={7}>
                        <Skeleton className="h-10 w-full" />
                      </td>
                    </tr>
                  ))
                ) : filteredPOs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                      No purchase orders found
                    </td>
                  </tr>
                ) : (
                  filteredPOs.map((po) => (
                    <PORow
                      key={po.id}
                      po={po}
                      supplier={supplierMap.get(po.supplierId)}
                      onSelect={setSelectedPOId}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
