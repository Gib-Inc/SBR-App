import { useQuery } from "@tanstack/react-query";
import { Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

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

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2, 173 58% 39%))",
  "hsl(var(--chart-3, 197 37% 24%))",
  "hsl(var(--chart-4, 43 74% 66%))",
  "hsl(var(--chart-5, 27 87% 67%))",
];

function KPICard({ data }: { data: { value: number; label: string; trend?: { direction: string; value: number } } }) {
  const TrendIcon = data.trend?.direction === "up" 
    ? TrendingUp 
    : data.trend?.direction === "down" 
      ? TrendingDown 
      : Minus;

  const trendColor = data.trend?.direction === "up" 
    ? "text-green-500" 
    : data.trend?.direction === "down" 
      ? "text-red-500" 
      : "text-muted-foreground";

  return (
    <div className="flex flex-col items-center justify-center py-4" data-testid="widget-kpi-card">
      <div className="text-4xl font-bold" data-testid="text-kpi-value">
        {typeof data.value === "number" ? data.value.toLocaleString() : data.value}
      </div>
      <div className="text-sm text-muted-foreground mt-1" data-testid="text-kpi-label">{data.label}</div>
      {data.trend && (
        <div className={`flex items-center gap-1 mt-2 ${trendColor}`} data-testid="text-kpi-trend">
          <TrendIcon className="h-4 w-4" />
          <span className="text-sm">{data.trend.value}%</span>
        </div>
      )}
    </div>
  );
}

function BarChartWidget({ data }: { data: { name: string; value: number }[] }) {
  if (!data || data.length === 0) {
    return <EmptyState />;
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 10 }} />
        <YAxis className="text-xs" tick={{ fontSize: 10 }} />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: "hsl(var(--popover))", 
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
          }} 
        />
        <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineChartWidget({ data }: { data: { name: string; value: number }[] }) {
  if (!data || data.length === 0) {
    return <EmptyState />;
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 10 }} />
        <YAxis className="text-xs" tick={{ fontSize: 10 }} />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: "hsl(var(--popover))", 
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
          }} 
        />
        <Line 
          type="monotone" 
          dataKey="value" 
          stroke="hsl(var(--primary))" 
          strokeWidth={2}
          dot={{ fill: "hsl(var(--primary))", strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function AreaChartWidget({ data }: { data: { name: string; value: number }[] }) {
  if (!data || data.length === 0) {
    return <EmptyState />;
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 10 }} />
        <YAxis className="text-xs" tick={{ fontSize: 10 }} />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: "hsl(var(--popover))", 
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
          }} 
        />
        <Area 
          type="monotone" 
          dataKey="value" 
          stroke="hsl(var(--primary))" 
          fill="hsl(var(--primary) / 0.2)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function PieChartWidget({ data }: { data: { name: string; value: number; percentage: number }[] }) {
  if (!data || data.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col h-full">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={30}
            outerRadius={55}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip 
            contentStyle={{ 
              backgroundColor: "hsl(var(--popover))", 
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
            }}
            formatter={(value: number, name: string) => [value.toLocaleString(), name]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 px-2 mt-1">
        {data.map((entry, index) => (
          <div key={entry.name} className="flex items-center gap-1.5 text-xs">
            <div 
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0" 
              style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
            />
            <span className="text-muted-foreground truncate max-w-[80px]" title={entry.name}>
              {entry.name}
            </span>
            <span className="text-foreground font-medium">{entry.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TableWidget({ data }: { data: Record<string, any>[] }) {
  if (!data || data.length === 0) {
    return <EmptyState />;
  }

  const columns = Object.keys(data[0] || {});

  return (
    <div className="overflow-x-auto max-h-[200px] overflow-y-auto" data-testid="widget-table">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background">
          <tr>
            {columns.map((col) => (
              <th key={col} className="text-left p-2 border-b font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-b last:border-0" data-testid={`row-table-${i}`}>
              {columns.map((col) => (
                <td key={col} className="p-2 text-muted-foreground">
                  {formatCellValue(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListWidget({ data }: { data: { label: string; value?: any; id?: string }[] }) {
  if (!data || data.length === 0) {
    return <EmptyState />;
  }

  return (
    <ul className="space-y-2" data-testid="widget-list">
      {data.map((item, i) => (
        <li key={item.id || i} className="flex items-center justify-between p-2 rounded-md bg-muted/50" data-testid={`list-item-${item.id || i}`}>
          <span className="text-sm" data-testid={`text-list-label-${item.id || i}`}>{item.label}</span>
          {item.value !== undefined && (
            <Badge variant="secondary" data-testid={`badge-list-value-${item.id || i}`}>{formatCellValue(item.value)}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProgressWidget({ data }: { data: { current: number; target: number; percentage: number } }) {
  return (
    <div className="flex flex-col items-center justify-center py-4 space-y-4" data-testid="widget-progress">
      <div className="text-center">
        <div className="text-3xl font-bold" data-testid="text-progress-current">{data.current.toLocaleString()}</div>
        <div className="text-sm text-muted-foreground" data-testid="text-progress-target">of {data.target.toLocaleString()}</div>
      </div>
      <Progress value={data.percentage} className="w-full" data-testid="progress-bar" />
      <div className="text-sm font-medium" data-testid="text-progress-percentage">{data.percentage}% Complete</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
      No data available
    </div>
  );
}

function formatCellValue(value: any): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DashboardWidget({ widget }: { widget: Widget }) {
  const { data, isLoading, error } = useQuery<{ data: any }>({
    queryKey: ["/api/widgets", widget.id, "data"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-32 text-destructive text-sm">
        Failed to load data
      </div>
    );
  }

  const widgetData = data?.data;

  switch (widget.type) {
    case "KPI_CARD":
      return <KPICard data={widgetData || { value: 0, label: "Count" }} />;
    case "BAR_CHART":
      return <BarChartWidget data={widgetData || []} />;
    case "LINE_CHART":
      return <LineChartWidget data={widgetData || []} />;
    case "AREA_CHART":
      return <AreaChartWidget data={widgetData || []} />;
    case "PIE_CHART":
      return <PieChartWidget data={widgetData || []} />;
    case "TABLE":
      return <TableWidget data={widgetData || []} />;
    case "LIST":
      return <ListWidget data={widgetData || []} />;
    case "PROGRESS":
      return <ProgressWidget data={widgetData || { current: 0, target: 100, percentage: 0 }} />;
    default:
      return <EmptyState />;
  }
}
