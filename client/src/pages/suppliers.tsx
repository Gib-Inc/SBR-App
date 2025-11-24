import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Building2, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { PurchaseOrder, SupplierLead, Supplier } from "@shared/schema";

export default function Suppliers() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("purchase-orders");

  const { data: purchaseOrders = [], isLoading: isLoadingPOs } = useQuery<PurchaseOrder[]>({
    queryKey: ['/api/purchase-orders'],
  });

  const { data: supplierLeads = [], isLoading: isLoadingLeads } = useQuery<SupplierLead[]>({
    queryKey: ['/api/supplier-leads'],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['/api/suppliers'],
  });

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground">
            Manage purchase orders, supplier relationships, and discovery pipeline
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="purchase-orders" data-testid="tab-purchase-orders">
            <Building2 className="h-4 w-4 mr-2" />
            PO History & Issues
          </TabsTrigger>
          <TabsTrigger value="discovery" data-testid="tab-discovery">
            <TrendingUp className="h-4 w-4 mr-2" />
            Discovery & Creation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="purchase-orders" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>Purchase Orders</CardTitle>
              <Button size="sm" data-testid="button-create-po">
                <Plus className="h-4 w-4 mr-2" />
                Create PO
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search purchase orders..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-po"
                  />
                </div>
              </div>

              {isLoadingPOs ? (
                <div className="text-center py-8 text-muted-foreground">Loading purchase orders...</div>
              ) : purchaseOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No purchase orders yet. Create your first one to get started.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium">PO #</th>
                        <th className="text-left p-2 font-medium">Supplier</th>
                        <th className="text-left p-2 font-medium">Status</th>
                        <th className="text-left p-2 font-medium">Order Date</th>
                        <th className="text-left p-2 font-medium">Sent</th>
                        <th className="text-left p-2 font-medium">Received</th>
                        <th className="text-left p-2 font-medium">Paid</th>
                        <th className="text-left p-2 font-medium">Issues</th>
                        <th className="text-right p-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseOrders.map((po) => (
                        <tr key={po.id} className="border-b hover-elevate" data-testid={`row-po-${po.id}`}>
                          <td className="p-2">
                            <span className="font-mono text-sm">{po.id.slice(0, 8)}</span>
                          </td>
                          <td className="p-2">
                            {suppliers.find((s) => s.id === po.supplierId)?.name || 'Unknown'}
                          </td>
                          <td className="p-2">
                            <Badge variant={
                              po.status === 'RECEIVED' ? 'default' :
                              po.status === 'SENT' ? 'secondary' :
                              'outline'
                            } data-testid={`badge-status-${po.id}`}>
                              {po.status}
                            </Badge>
                          </td>
                          <td className="p-2 text-sm">
                            {po.orderDate ? new Date(po.orderDate).toLocaleDateString() : '-'}
                          </td>
                          <td className="p-2 text-sm">
                            {po.sentAt ? new Date(po.sentAt).toLocaleDateString() : '-'}
                          </td>
                          <td className="p-2 text-sm">
                            {po.receivedAt ? new Date(po.receivedAt).toLocaleDateString() : '-'}
                          </td>
                          <td className="p-2 text-sm">
                            {po.paidAt ? new Date(po.paidAt).toLocaleDateString() : '-'}
                          </td>
                          <td className="p-2">
                            {po.hasIssue && (
                              <Badge variant="destructive" data-testid={`badge-issue-${po.id}`}>
                                {po.issueStatus}
                              </Badge>
                            )}
                          </td>
                          <td className="p-2 text-right">
                            <Button size="sm" variant="ghost" data-testid={`button-view-po-${po.id}`}>
                              View
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="discovery" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>Supplier Leads</CardTitle>
              <Button size="sm" data-testid="button-create-lead">
                <Plus className="h-4 w-4 mr-2" />
                Add Lead
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search leads..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-lead"
                  />
                </div>
              </div>

              {isLoadingLeads ? (
                <div className="text-center py-8 text-muted-foreground">Loading supplier leads...</div>
              ) : supplierLeads.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No supplier leads yet. Add your first lead to get started.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium">Name</th>
                        <th className="text-left p-2 font-medium">Website</th>
                        <th className="text-left p-2 font-medium">Source</th>
                        <th className="text-left p-2 font-medium">Status</th>
                        <th className="text-left p-2 font-medium">Category</th>
                        <th className="text-left p-2 font-medium">Last Contacted</th>
                        <th className="text-right p-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierLeads.map((lead) => (
                        <tr key={lead.id} className="border-b hover-elevate" data-testid={`row-lead-${lead.id}`}>
                          <td className="p-2 font-medium">{lead.name}</td>
                          <td className="p-2">
                            {lead.websiteUrl ? (
                              <a 
                                href={lead.websiteUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-primary hover:underline text-sm"
                              >
                                Visit
                              </a>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-2">
                            <Badge variant="outline" data-testid={`badge-source-${lead.id}`}>
                              {lead.source}
                            </Badge>
                          </td>
                          <td className="p-2">
                            <Badge variant={
                              lead.status === 'CONVERTED' ? 'default' :
                              lead.status === 'CONTACTED' ? 'secondary' :
                              'outline'
                            } data-testid={`badge-status-${lead.id}`}>
                              {lead.status}
                            </Badge>
                          </td>
                          <td className="p-2 text-sm">{lead.category || '-'}</td>
                          <td className="p-2 text-sm">
                            {lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleDateString() : '-'}
                          </td>
                          <td className="p-2 text-right">
                            <Button size="sm" variant="ghost" data-testid={`button-view-lead-${lead.id}`}>
                              View
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
