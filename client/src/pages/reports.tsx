import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  MoreVertical,
  Trash2,
  BarChart3,
  PieChart,
  LineChart,
  Table2,
  Hash,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  GripVertical,
  Package,
  AlertTriangle,
  ShoppingCart,
  ClipboardList,
  PackageOpen,
  RefreshCw,
  List,
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
import { CriticalStockBanner } from "@/components/critical-stock-banner";
import { DefaultWidgets } from "@/components/dashboard-default-widgets";

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
  trend?: { direction: string; value: number; label: string } | null;
};

type ReportWidgetsResponse = {
  dashboardId: string;
  widgets: Widget[];
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
  { id: "REFURB_INVENTORY", label: "Refurbished Inventory" },
  { id: "COMPONENT_CONSUMPTION", label: "Component Consumption (Damage Write-offs)" },
];

type SystemStats = {
  totalItems: number;
  lowStockItems: number;
  criticalStockItems: number;
  activePurchaseOrders: number;
  activeSalesOrders: number;
  pendingReturns: number;
  totalInventoryValue: number;
};

function SystemOverview() {
  const { data: stats, isLoading, refetch } = useQuery<SystemStats>({
    queryKey: ["/api/system/stats"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const kpis = [
    {
      title: "Total Items",
      value: stats?.totalItems || 0,
      icon: Package,
      color: "text-blue-500",
    },
    {
      title: "Low Stock",
      value: stats?.lowStockItems || 0,
      icon: AlertTriangle,
      color: "text-yellow-500",
    },
    {
      title: "Critical Stock",
      value: stats?.criticalStockItems || 0,
      icon: AlertTriangle,
      color: "text-red-500",
    },
    {
      title: "Active POs",
      value: stats?.activePurchaseOrders || 0,
      icon: ClipboardList,
      color: "text-purple-500",
    },
    {
      title: "Active SOs",
      value: stats?.activeSalesOrders || 0,
      icon: ShoppingCart,
      color: "text-green-500",
    },
    {
      title: "Pending Returns",
      value: stats?.pendingReturns || 0,
      icon: PackageOpen,
      color: "text-orange-500",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">System Overview</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          data-testid="button-refresh-stats"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title} data-testid={`kpi-card-${kpi.title.toLowerCase().replace(/\s+/g, '-')}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                <span className="text-sm text-muted-foreground">{kpi.title}</span>
              </div>
              <div className="text-2xl font-bold" data-testid={`text-kpi-${kpi.title.toLowerCase().replace(/\s+/g, '-')}`}>
                {kpi.value.toLocaleString()}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function TrendIndicator({ trend }: { trend?: { direction: string; value: number; label: string } | null }) {
  if (!trend) return null;
  
  const Icon = trend.direction === "up" 
    ? TrendingUp 
    : trend.direction === "down" 
      ? TrendingDown 
      : Minus;
  
  const colorClass = trend.direction === "up" 
    ? "text-green-500" 
    : trend.direction === "down" 
      ? "text-red-500" 
      : "text-muted-foreground";

  return (
    <div className={`flex items-center gap-1 text-xs ${colorClass}`} data-testid="trend-indicator">
      <Icon className="h-3 w-3" />
      <span>{trend.value}%</span>
      <span className="text-muted-foreground ml-1">{trend.label}</span>
    </div>
  );
}

function SortableWidgetCard({
  widget,
  onDelete,
}: {
  widget: Widget;
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
    <Card
      ref={setNodeRef}
      style={style}
      className="relative group"
      data-testid={`widget-card-${widget.id}`}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            data-testid={`widget-drag-handle-${widget.id}`}
          >
            <GripVertical className="h-4 w-4" />
          </div>
          <CardTitle className="text-base font-medium truncate">{widget.title}</CardTitle>
        </div>
        <div className="flex items-center gap-1">
          <TrendIndicator trend={widget.trend} />
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
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive"
                data-testid={`button-delete-widget-${widget.id}`}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Widget
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <DashboardWidget widget={widget} />
      </CardContent>
    </Card>
  );
}

function AddWidgetDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
}) {
  const [type, setType] = useState("");
  const [title, setTitle] = useState("");
  const [dataSource, setDataSource] = useState("");
  const [metric, setMetric] = useState("count");
  const [field, setField] = useState("");
  const [groupBy, setGroupBy] = useState("");

  const handleSubmit = () => {
    if (!type || !title || !dataSource) return;
    
    const config: any = {};
    if (type === "KPI_CARD") {
      config.metric = metric;
      if (field) config.field = field;
    }
    if (["BAR_CHART", "PIE_CHART", "LINE_CHART"].includes(type) && groupBy) {
      config.groupBy = groupBy;
    }
    
    onSubmit({
      type,
      title,
      dataSource,
      config,
      position: { x: 0, y: 0, w: 1, h: 1 },
    });
    
    setType("");
    setTitle("");
    setDataSource("");
    setMetric("count");
    setField("");
    setGroupBy("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Widget</DialogTitle>
          <DialogDescription>
            Configure a new widget to visualize your data.
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

export default function Reports() {
  const { toast } = useToast();
  const [addWidgetOpen, setAddWidgetOpen] = useState(false);

  const { data: reportData, isLoading } = useQuery<ReportWidgetsResponse>({
    queryKey: ["/api/report-widgets"],
  });

  const addWidgetMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/report-widgets", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/report-widgets"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/report-widgets"] });
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
      if (!reportData?.dashboardId) return;
      return apiRequest("POST", `/api/dashboards/${reportData.dashboardId}/widgets/positions`, { updates });
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

  const widgets = reportData?.widgets || [];

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
    <div className="p-6 space-y-6">
      <CriticalStockBanner />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted-foreground">
            System overview and custom widgets
          </p>
        </div>
        <Button onClick={() => setAddWidgetOpen(true)} data-testid="button-add-widget">
          <Plus className="mr-2 h-4 w-4" />
          Add Widget
        </Button>
      </div>

      <SystemOverview />

      <Separator />

      <DefaultWidgets />

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : widgets.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {widgets.map((widget) => (
                <SortableWidgetCard
                  key={widget.id}
                  widget={widget}
                  onDelete={() => deleteWidgetMutation.mutate(widget.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : null}

      <AddWidgetDialog
        open={addWidgetOpen}
        onOpenChange={setAddWidgetOpen}
        onSubmit={(data) => addWidgetMutation.mutate(data)}
      />
    </div>
  );
}
