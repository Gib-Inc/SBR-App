import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, TrendingDown, Database } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#9ca3af', '#ec4899'];

interface MonthRow { year: number; month: number; monthName: string; revenue: number; source: string; orders: number | null; customers: number | null }
interface AnnualRow { year: number; revenue: number; orders: number; customers: number; monthsReported: number }
interface FullYearData { years: number[]; monthly: MonthRow[]; annual: AnnualRow[] }

export function MultiYearView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<FullYearData>({
    queryKey: ['/api/marketing-analytics/cmo/full-year'],
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/marketing-analytics/cmo/seed-historical');
      return res.json();
    },
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/marketing-analytics/cmo/full-year'] });
      toast({ title: `Historical data imported: ${d.inserted} months` });
    },
    onError: (e: any) => toast({ title: 'Import failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data?.annual?.length) {
    return (
      <Card><CardContent className="py-12 text-center space-y-3">
        <p className="text-muted-foreground">No multi-year data available.</p>
        <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
          {seedMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Database className="h-4 w-4 mr-2" />}
          Import Historical Sales (2022-2026)
        </Button>
      </CardContent></Card>
    );
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
      <div className="flex items-center justify-between">
        <div />
        <Button variant="outline" size="sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
          {seedMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Database className="h-4 w-4 mr-1" />}
          Refresh Historical
        </Button>
      </div>

      {/* Annual summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {data.annual.slice().reverse().map((a, i) => {
          const prev = data.annual.find(p => p.year === a.year - 1);
          const growth = prev && prev.revenue > 0 ? ((a.revenue - prev.revenue) / prev.revenue * 100) : null;
          return (
            <Card key={a.year}>
              <CardContent className="pt-3 pb-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold">{a.year}</span>
                  {growth != null && (
                    <Badge variant={growth >= 0 ? 'default' : 'destructive'} className="text-xs">
                      {growth >= 0 ? '+' : ''}{growth.toFixed(0)}%
                    </Badge>
                  )}
                </div>
                <div className="text-xl font-bold" style={{ color: COLORS[i % COLORS.length] }}>{fmt(a.revenue)}</div>
                <div className="text-xs text-muted-foreground">{a.monthsReported} months reported</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Monthly revenue overlay */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Revenue — All Years</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              {data.years.slice().reverse().map((y, i) => (
                <Line key={y} type="monotone" dataKey={String(y)} stroke={COLORS[i % COLORS.length]}
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
                {data.years.slice().reverse().map(y => <TableHead key={y} className="text-right">{y}</TableHead>)}
                <TableHead className="text-right">YoY</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                const monthName = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m];
                const vals = data.years.slice().reverse().map(y => data.monthly.find(r => r.year === y && r.month === m)?.revenue || 0);
                const cur = vals[0];
                const prev = vals[1];
                const change = prev > 0 ? ((cur - prev) / prev * 100) : null;
                if (vals.every(v => v === 0)) return null;
                return (
                  <TableRow key={m}>
                    <TableCell className="font-medium">{monthName}</TableCell>
                    {vals.map((v, i) => (
                      <TableCell key={i} className="text-right">{v > 0 ? fmt(v) : '—'}</TableCell>
                    ))}
                    <TableCell className="text-right">
                      {change != null && cur > 0 ? (
                        <Badge variant={change >= 0 ? 'default' : 'destructive'} className="text-xs">
                          {change >= 0 ? <TrendingUp className="h-3 w-3 mr-0.5 inline" /> : <TrendingDown className="h-3 w-3 mr-0.5 inline" />}
                          {change >= 0 ? '+' : ''}{change.toFixed(0)}%
                        </Badge>
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Annual totals row */}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell>Total</TableCell>
                {data.years.slice().reverse().map(y => {
                  const a = data.annual.find(r => r.year === y);
                  return <TableCell key={y} className="text-right">{a ? fmt(a.revenue) : '—'}</TableCell>;
                })}
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
