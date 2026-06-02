import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const COLORS = ['#10b981', '#3b82f6', '#9ca3af'];

interface MultiYearData {
  years: number[];
  monthly: Array<{ year: number; month: number; monthName: string; revenue: number; orders: number; aov: number; customers: number }>;
  annual: Array<{ year: number; revenue: number; orders: number; aov: number; customers: number }>;
}

export function MultiYearView() {
  const { data, isLoading } = useQuery<MultiYearData>({
    queryKey: ['/api/marketing-analytics/cmo/multi-year'],
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data?.annual?.length) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No multi-year data available.</CardContent></Card>;
  }

  const chartData: any[] = [];
  for (let m = 1; m <= 12; m++) {
    const point: any = { month: ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m] };
    for (const y of data.years) {
      const row = data.monthly.find(r => r.year === y && r.month === m);
      point[String(y)] = row?.revenue || 0;
    }
    chartData.push(point);
  }

  return (
    <div className="space-y-4">
      {/* Annual summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.annual.slice().reverse().map((a, i) => {
          const prev = data.annual.find(p => p.year === a.year - 1);
          const growth = prev && prev.revenue > 0 ? ((a.revenue - prev.revenue) / prev.revenue * 100) : null;
          return (
            <Card key={a.year}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-lg font-bold">{a.year}</span>
                  {growth != null && (
                    <Badge variant={growth >= 0 ? 'default' : 'destructive'} className="text-xs">
                      {growth >= 0 ? <TrendingUp className="h-3 w-3 mr-1 inline" /> : <TrendingDown className="h-3 w-3 mr-1 inline" />}
                      {growth >= 0 ? '+' : ''}{growth.toFixed(0)}% YoY
                    </Badge>
                  )}
                </div>
                <div className="text-2xl font-bold" style={{ color: COLORS[i] || '#666' }}>{fmt(a.revenue)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {a.orders.toLocaleString()} orders · {fmt(a.aov)} AOV · {a.customers.toLocaleString()} customers
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Monthly revenue overlay */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Revenue by Year</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              {data.years.map((y, i) => (
                <Line key={y} type="monotone" dataKey={String(y)} stroke={COLORS[i]}
                  strokeWidth={i === 0 ? 3 : 1.5}
                  strokeDasharray={i > 0 ? '5 5' : undefined}
                  dot={{ r: i === 0 ? 4 : 2 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly comparison table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Month-by-Month Comparison</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                {data.years.map(y => <TableHead key={y} className="text-right">{y} Revenue</TableHead>)}
                <TableHead className="text-right">YoY Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                const monthName = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m];
                const vals = data.years.map(y => data.monthly.find(r => r.year === y && r.month === m)?.revenue || 0);
                const cur = vals[0];
                const prev = vals[1];
                const change = prev > 0 ? ((cur - prev) / prev * 100) : null;
                if (vals.every(v => v === 0)) return null;
                return (
                  <TableRow key={m}>
                    <TableCell className="font-medium">{monthName}</TableCell>
                    {vals.map((v, i) => <TableCell key={i} className="text-right">{v > 0 ? fmt(v) : '—'}</TableCell>)}
                    <TableCell className="text-right">
                      {change != null ? (
                        <Badge variant={change >= 0 ? 'default' : 'destructive'} className="text-xs">
                          {change >= 0 ? '+' : ''}{change.toFixed(0)}%
                        </Badge>
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
