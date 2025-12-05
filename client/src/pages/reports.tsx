import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  Trash2,
  BarChart3,
  PieChart,
  LineChart,
  Table2,
  Hash,
  TrendingUp,
  Loader2,
  GripVertical,
  Eye,
  Package,
  AlertTriangle,
  ShoppingCart,
  ClipboardList,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DashboardWidget } from "@/components/dashboard-widget";

type Dashboard = {
  id: string;
  userId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  layout?: any;
  createdAt: Date;
  updatedAt: Date;
  widgets?: Widget[];
};

type Widget = {
  id: string;
  dashboardId: string;
  type: string;
  title: string;
  dataSource: string;
  config: any;
  position: { x: number; y: number; w: number; h: number };
  createdAt: Date;
  updatedAt: Date;
};

const WIDGET_TYPES = [
  { id: "KPI_CARD", label: "KPI Card", icon: Hash, description: "Single metric display" },
  { id: "BAR_CHART", label: "Bar Chart", icon: BarChart3, description: "Compare categories" },
  { id: "LINE_CHART", label: "Line Chart", icon: LineChart, description: "Trends over time" },
  { id: "PIE_CHART", label: "Pie Chart", icon: PieChart, description: "Distribution breakdown" },
  { id: "TABLE", label: "Data Table", icon: Table2, description: "Tabular data view" },
  { id: "LIST", label: "List", icon: List, description: "Simple list view" },
  { id: "PROGRESS", label: "Progress", icon: TrendingUp, description: "Goal tracking" },
];

const DATA_SOURCES = [
  { id: "ITEMS", label: "Products/Items" },
  { id: "SALES_ORDERS", label: "Sales Orders" },
  { id: "PURCHASE_ORDERS", label: "Purchase Orders" },
  { id: "RETURNS", label: "Returns" },
  { id: "SUPPLIERS", label: "Suppliers" },
  { id: "INVENTORY_TRANSACTIONS", label: "Inventory Transactions" },
  { id: "AI_RECOMMENDATIONS", label: "AI Recommendations" },
  { id: "SYSTEM_LOGS", label: "System Logs" },
];

type SystemStats = {
  totalItems: number;
  lowStockItems: number;
  criticalStockItems: number;
  activePOs: number;
  activeSOs: number;
  pendingReturns: number;
  totalInventoryValue: number;
};

function SystemOverview() {
  const { data: items = [], isLoading: itemsLoading } = useQuery<any[]>({
    queryKey: ["/api/items"],
  });

  const { data: purchaseOrders = [], isLoading: posLoading } = useQuery<any[]>({
    queryKey: ["/api/purchase-orders"],
  });

  const { data: salesOrders = [], isLoading: sosLoading } = useQuery<any[]>({
    queryKey: ["/api/sales-orders"],
  });

  const { data: returns = [], isLoading: returnsLoading } = useQuery<any[]>({
    queryKey: ["/api/returns"],
  });

  const isLoading = itemsLoading || posLoading || sosLoading || returnsLoading;

  const stats = useMemo(() => {
    if (isLoading) return null;
    
    const totalItems = items.length;
    const lowStockItems = items.filter((item: any) => {
      const availableQty = (item.hildaleQty || 0) + (item.pivotQty || 0);
      const safetyStock = item.safetyStock || 0;
      return availableQty > 0 && availableQty <= safetyStock;
    }).length;
    const criticalStockItems = items.filter((item: any) => {
      const availableQty = (item.hildaleQty || 0) + (item.pivotQty || 0);
      return availableQty <= 0;
    }).length;
    
    const activePOs = purchaseOrders.filter((po: any) => 
      !["RECEIVED", "CLOSED", "CANCELLED"].includes(po.status)
    ).length;
    
    const activeSOs = salesOrders.filter((so: any) => 
      !["FULFILLED", "CANCELLED"].includes(so.status)
    ).length;
    
    const pendingReturns = returns.filter((ret: any) => 
      !["REFUNDED", "REPLACEMENT_SENT", "CLOSED", "REJECTED", "CANCELLED", "COMPLETED", "RECEIVED", "RECEIVED_AT_WAREHOUSE"].includes(ret.status)
    ).length;
    
    const totalInventoryValue = items.reduce((sum: number, item: any) => {
      const qty = (item.hildaleQty || 0) + (item.pivotQty || 0);
      const cost = item.purchaseCost || 0;
      return sum + (qty * cost);
    }, 0);
    
    return {
      totalItems,
      lowStockItems,
      criticalStockItems,
      activePOs,
      activeSOs,
      pendingReturns,
      totalInventoryValue,
    };
  }, [items, purchaseOrders, salesOrders, returns, isLoading]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
        {Array.from({ length: 7 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="animate-pulse space-y-2">
                <div className="h-4 w-16 bg-muted rounded" />
                <div className="h-8 w-12 bg-muted rounded" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const overviewCards = [
    {
      label: "Total Items",
      value: stats.totalItems,
      icon: Package,
      color: "text-primary",
    },
    {
      label: "Low Stock",
      value: stats.lowStockItems,
      icon: AlertTriangle,
      color: stats.lowStockItems > 0 ? "text-yellow-500" : "text-muted-foreground",
    },
    {
      label: "Critical Stock",
      value: stats.criticalStockItems,
      icon: AlertTriangle,
      color: stats.criticalStockItems > 0 ? "text-red-500" : "text-muted-foreground",
    },
    {
      label: "Active POs",
      value: stats.activePOs,
      icon: ClipboardList,
      color: "text-blue-500",
    },
    {
      label: "Active SOs",
      value: stats.activeSOs,
      icon: ShoppingCart,
      color: "text-green-500",
    },
    {
      label: "Pending Returns",
      value: stats.pendingReturns,
      icon: PackageOpen,
      color: stats.pendingReturns > 0 ? "text-orange-500" : "text-muted-foreground",
    },
    {
      label: "Inventory Value",
      value: `$${stats.totalInventoryValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      icon: TrendingUp,
      color: "text-primary",
    },
  ];

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">System Overview</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {overviewCards.map((card) => (
          <Card key={card.label} data-testid={`card-overview-${card.label.toLowerCase().replace(/\s+/g, '-')}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <card.icon className={`h-4 w-4 ${card.color}`} />
                <span className="text-xs text-muted-foreground">{card.label}</span>
              </div>
              <div className="text-2xl font-bold" data-testid={`text-overview-${card.label.toLowerCase().replace(/\s+/g, '-')}`}>
                {card.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SortableWidget({
  widget,
  onEdit,
  onDelete,
}: {
  widget: Widget;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative group"
      data-testid={`widget-${widget.id}`}
    >
      <Card className="h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                {...attributes}
                {...listeners}
                className="cursor-grab hover-elevate p-1 rounded"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground" />
              </div>
              <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  data-testid={`button-widget-menu-${widget.id}`}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit} data-testid={`button-edit-widget-${widget.id}`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive"
                  data-testid={`button-delete-widget-${widget.id}`}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent>
          <DashboardWidget widget={widget} />
        </CardContent>
      </Card>
    </div>
  );
}

function CreateDashboardDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; description?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim() || undefined });
    setName("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Dashboard</DialogTitle>
          <DialogDescription>
            Create a new custom dashboard to visualize your data.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., Sales Overview"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-dashboard-name"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="A brief description of this dashboard"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-dashboard-description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-create-dashboard">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim()} data-testid="button-submit-create-dashboard">
            Create Dashboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddWidgetDialog({
  open,
  onOpenChange,
  onSubmit,
  dashboardId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  dashboardId: string;
}) {
  const [type, setType] = useState("");
  const [title, setTitle] = useState("");
  const [dataSource, setDataSource] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [metric, setMetric] = useState("count");
  const [field, setField] = useState("");

  const handleSubmit = () => {
    if (!type || !title || !dataSource) return;
    
    const config: any = { metric };
    if (groupBy) config.groupBy = groupBy;
    if (field) config.field = field;
    
    onSubmit({
      dashboardId,
      type,
      title,
      dataSource,
      config,
      position: { x: 0, y: 0, w: 4, h: 3 },
    });
    
    setType("");
    setTitle("");
    setDataSource("");
    setGroupBy("");
    setMetric("count");
    setField("");
  };

  const selectedWidgetType = WIDGET_TYPES.find((w) => w.id === type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Widget</DialogTitle>
          <DialogDescription>
            Configure a new widget for your dashboard.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Widget Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {WIDGET_TYPES.map((wt) => (
                <Card
                  key={wt.id}
                  className={`cursor-pointer hover-elevate ${type === wt.id ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setType(wt.id)}
                  data-testid={`widget-type-${wt.id}`}
                >
                  <CardContent className="p-3 flex items-center gap-2">
                    <wt.icon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">{wt.label}</div>
                      <div className="text-xs text-muted-foreground">{wt.description}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="widget-title">Title</Label>
            <Input
              id="widget-title"
              placeholder="e.g., Total Orders"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-widget-title"
            />
          </div>
          
          <div className="grid gap-2">
            <Label>Data Source</Label>
            <Select value={dataSource} onValueChange={setDataSource}>
              <SelectTrigger data-testid="select-data-source">
                <SelectValue placeholder="Select data source" />
              </SelectTrigger>
              <SelectContent>
                {DATA_SOURCES.map((ds) => (
                  <SelectItem key={ds.id} value={ds.id}>
                    {ds.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {type === "KPI_CARD" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Metric</Label>
                <Select value={metric} onValueChange={setMetric}>
                  <SelectTrigger data-testid="select-metric">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">Count</SelectItem>
                    <SelectItem value="sum">Sum</SelectItem>
                    <SelectItem value="avg">Average</SelectItem>
                    <SelectItem value="min">Minimum</SelectItem>
                    <SelectItem value="max">Maximum</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {metric !== "count" && (
                <div className="grid gap-2">
                  <Label>Field</Label>
                  <Input
                    placeholder="e.g., total, quantity"
                    value={field}
                    onChange={(e) => setField(e.target.value)}
                    data-testid="input-widget-field"
                  />
                </div>
              )}
            </div>
          )}
          
          {(type === "BAR_CHART" || type === "PIE_CHART" || type === "LINE_CHART") && (
            <div className="grid gap-2">
              <Label>Group By Field</Label>
              <Input
                placeholder="e.g., status, type"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                data-testid="input-group-by"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-add-widget">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!type || !title || !dataSource}
            data-testid="button-submit-add-widget"
          >
            Add Widget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DashboardSection({
  dashboard,
  onDelete,
}: {
  dashboard: Dashboard;
  onDelete: () => void;
}) {
  const { toast } = useToast();
  const [addWidgetOpen, setAddWidgetOpen] = useState(false);

  const { data: dashboardData, isLoading } = useQuery<Dashboard>({
    queryKey: ["/api/dashboards", dashboard.id],
  });

  const addWidgetMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", `/api/dashboards/${dashboard.id}/widgets`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboards", dashboard.id] });
      setAddWidgetOpen(false);
      toast({ title: "Widget added successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to add widget",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteWidgetMutation = useMutation({
    mutationFn: async (widgetId: string) => {
      return apiRequest("DELETE", `/api/widgets/${widgetId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboards", dashboard.id] });
      toast({ title: "Widget deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete widget",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updatePositionsMutation = useMutation({
    mutationFn: async (updates: any[]) => {
      return apiRequest("POST", `/api/dashboards/${dashboard.id}/widgets/positions`, { updates });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update positions",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const widgets = dashboardData?.widgets || [];

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      const oldIndex = widgets.findIndex((w) => w.id === active.id);
      const newIndex = widgets.findIndex((w) => w.id === over.id);
      
      const reordered = arrayMove(widgets, oldIndex, newIndex);
      const updates = reordered.map((w, index) => ({
        id: w.id,
        position: { ...w.position, y: index },
      }));
      
      updatePositionsMutation.mutate(updates);
    }
  };

  return (
    <div className="space-y-4" data-testid={`dashboard-section-${dashboard.id}`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{dashboard.name}</h3>
          {dashboard.description && (
            <p className="text-sm text-muted-foreground">{dashboard.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setAddWidgetOpen(true)} 
            data-testid={`button-add-widget-${dashboard.id}`}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Widget
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                data-testid={`button-dashboard-menu-${dashboard.id}`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive"
                data-testid={`button-delete-dashboard-${dashboard.id}`}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Dashboard
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : widgets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <LayoutGrid className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground text-center mb-3">
              No widgets yet. Add widgets to visualize your data.
            </p>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setAddWidgetOpen(true)} 
              data-testid={`button-add-first-widget-${dashboard.id}`}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Widget
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {widgets.map((widget) => (
                <SortableWidget
                  key={widget.id}
                  widget={widget}
                  onEdit={() => {}}
                  onDelete={() => deleteWidgetMutation.mutate(widget.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <AddWidgetDialog
        open={addWidgetOpen}
        onOpenChange={setAddWidgetOpen}
        onSubmit={(data) => addWidgetMutation.mutate(data)}
        dashboardId={dashboard.id}
      />
    </div>
  );
}

export default function Reports() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: dashboards = [], isLoading } = useQuery<Dashboard[]>({
    queryKey: ["/api/dashboards"],
  });

  const createDashboardMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      return apiRequest("POST", "/api/dashboards", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboards"] });
      setCreateOpen(false);
      toast({ title: "Dashboard created successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create dashboard",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteDashboardMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/dashboards/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboards"] });
      toast({ title: "Dashboard deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete dashboard",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted-foreground">
            System overview and custom dashboards
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-create-dashboard">
          <Plus className="mr-2 h-4 w-4" />
          Create Dashboard
        </Button>
      </div>

      <SystemOverview />

      <Separator />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Custom Dashboards</h2>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : dashboards.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No dashboards yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first custom dashboard to get started
            </p>
            <Button onClick={() => setCreateOpen(true)} data-testid="button-create-first-dashboard">
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Dashboard
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {dashboards.map((dashboard) => (
            <DashboardSection
              key={dashboard.id}
              dashboard={dashboard}
              onDelete={() => deleteDashboardMutation.mutate(dashboard.id)}
            />
          ))}
        </div>
      )}

      <CreateDashboardDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(data) => createDashboardMutation.mutate(data)}
      />
    </div>
  );
}
