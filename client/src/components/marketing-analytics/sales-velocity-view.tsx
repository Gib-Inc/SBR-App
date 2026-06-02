import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Zap, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

interface VelocityData {
  summary: { avg_daily_revenue: number; avg_daily_orders: number; peak_day_revenue: number; low_day_revenue: number; days_with_sales: number };
  byDayOfWeek: Array<{ dow: number; dayName: string; avg_order_value: number; avg_orders_per_day: number }>;
  productVelocity: Array<{ sku: string; name: string | null; units_sold: number; revenue: number; units_per_day: number; revenue_per_day: number; current_stock: number; days_of_stock: number | null }>;
}

export function SalesVelocityView({ days }: { days: number }) {
  const { data, isLoading } = useQuery<VelocityData>({
    queryKey: ['/api/marketing-analytics/cmo/sales-velocity', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/sales-velocity?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data?.summary?.avg_daily_revenue) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No sales data for this period.</CardContent></Card>;
  }

  const s = data.summary;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" /> Avg Daily Revenue</div>
          <div className="text-xl font-bold">{fmt(s.avg_daily_revenue)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-xs text-muted-foreground">Avg Daily Orders</div>
          <div className="text-xl font-bold">{s.avg_daily_orders?.toFixed(1)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-xs text-muted-foreground">Peak Day</div>
          <div className="text-xl font-bold text-green-600">{fmt(s.peak_day_revenue)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <div className="text-xs text-muted-foreground">Low Day</div>
          <div className="text-xl font-bold text-red-600">{fmt(s.low_day_revenue)}</div>
        </CardContent></Card>
      </div>

      {data.byDayOfWeek?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Orders by Day of Week</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.byDayOfWeek}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dayName" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => v.toFixed(1)} />
                <Bar dataKey="avg_orders_per_day" fill="#3b82f6" name="Avg Orders/Day" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Product Velocity ({days}d)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Units Sold</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Units/Day</TableHead>
                <TableHead className="text-right">$/Day</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Days Left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.productVelocity?.map(p => (
                <TableRow key={p.sku}>
                  <TableCell>
                    <div className="font-medium">{p.name || p.sku}</div>
                    <div className="text-xs text-muted-foreground">{p.sku}</div>
                  </TableCell>
                  <TableCell className="text-right">{p.units_sold}</TableCell>
                  <TableCell className="text-right">{fmt(p.revenue)}</TableCell>
                  <TableCell className="text-right">{p.units_per_day.toFixed(1)}</TableCell>
                  <TableCell className="text-right">{fmt(p.revenue_per_day)}</TableCell>
                  <TableCell className="text-right">{p.current_stock}</TableCell>
                  <TableCell className="text-right">
                    {p.days_of_stock != null ? (
                      <Badge variant={p.days_of_stock < 14 ? 'destructive' : p.days_of_stock < 30 ? 'outline' : 'default'}>
                        {p.days_of_stock < 999 ? `${Math.round(p.days_of_stock)}d` : '999+'}
                      </Badge>
                    ) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
