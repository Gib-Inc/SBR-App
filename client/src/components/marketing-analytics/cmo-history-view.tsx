import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, TrendingDown, Database } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number | null) => n != null ? `${n.toFixed(1)}%` : '—';
const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6'];

interface Annual { year: number; revenue: number; cogs: number; grossProfit: number; adSpend: number; totalExpenses: number; netIncome: number; orders: number; customers: number; grossMarginPct: number | null; adSpendPct: number | null; roas: number | null; cac: number | null; monthsReported: number }
interface Monthly { year: number; month: number; monthName: string; revenue: number; cogs: number; gross_profit: number; ad_spend: number; total_expenses: number; net_income: number; grossMarginPct: number | null; adSpendPct: number | null; roas: number | null }
interface Data { years: number[]; monthly: Monthly[]; annual: Annual[] }

export function CMOHistoryView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Data>({ queryKey: ['/api/marketing-analytics/cmo/cmo-history'] });

  const seed = useMutation({
    mutationFn: async () => { const r = await apiRequest('POST', '/api/marketing-analytics/cmo/seed-historical'); return r.json(); },
    onSuccess: (d: any) => { qc.invalidateQueries({ queryKey: ['/api/marketing-analytics/cmo/cmo-history'] }); toast({ title: `Imported ${d.inserted} months of P&L data` }); },
    onError: (e: any) => toast({ title: 'Import failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data?.annual?.length) return (
    <Card><CardContent className="py-12 text-center space-y-3">
      <p className="text-muted-foreground">No P&L data loaded.</p>
      <Button onClick={() => seed.mutate()} disabled={seed.isPending}><Database className="h-4 w-4 mr-2" />Import QuickBooks P&L (2022-2026)</Button>
    </CardContent></Card>
  );

  const annualChart = data.annual.map(a => ({
    year: String(a.year), Revenue: a.revenue, COGS: a.cogs, 'Ad Spend': a.adSpend, 'Net Income': a.netIncome,
  }));

  const marginChart = data.annual.map(a => ({
    year: String(a.year), 'Gross Margin': a.grossMarginPct, 'Ad Spend %': a.adSpendPct,
  }));

  const monthlyProfit = data.monthly.map(m => ({
    label: `${m.monthName} ${String(m.year).slice(2)}`,
    Revenue: m.revenue, 'Net Income': m.net_income,
  }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
          {seed.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Database className="h-4 w-4 mr-1" />} Refresh P&L
        </Button>
      </div>

      {/* Annual cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {data.annual.slice().reverse().map((a, i) => {
          const prev = data.annual.find(p => p.year === a.year - 1);
          const growth = prev && prev.revenue > 0 ? ((a.revenue - prev.revenue) / prev.revenue * 100) : null;
          return (
            <Card key={a.year}>
              <CardContent className="pt-3 pb-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold">{a.year}</span>
                  {growth != null && <Badge variant={growth >= 0 ? 'default' : 'destructive'} className="text-xs">{growth >= 0 ? '+' : ''}{growth.toFixed(0)}%</Badge>}
                </div>
                <div className="text-lg font-bold" style={{ color: COLORS[i % COLORS.length] }}>{fmt(a.revenue)}</div>
                <div className="text-xs space-y-0.5 mt-1 text-muted-foreground">
                  <div>Gross margin: <span className={a.grossMarginPct && a.grossMarginPct > 40 ? 'text-green-600' : 'text-red-600'}>{pct(a.grossMarginPct)}</span></div>
                  <div>Ad spend: {fmt(a.adSpend)} ({pct(a.adSpendPct)})</div>
                  <div className={a.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}>Net: {fmt(a.netIncome)}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Revenue breakdown bar chart */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Annual P&L Breakdown</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={annualChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Bar dataKey="Revenue" fill="#10b981" />
              <Bar dataKey="COGS" fill="#f59e0b" />
              <Bar dataKey="Ad Spend" fill="#ef4444" />
              <Bar dataKey="Net Income" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Margin trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Gross Margin % by Year</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={marginChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: number) => `${v?.toFixed(1)}%`} />
                <Legend />
                <Bar dataKey="Gross Margin" fill="#10b981" />
                <Bar dataKey="Ad Spend %" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Revenue vs Net Income</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthlyProfit.slice(-24)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={2} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend />
                <Line type="monotone" dataKey="Revenue" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Net Income" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Full annual table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Annual Performance Summary</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">COGS</TableHead>
                <TableHead className="text-right">Gross %</TableHead>
                <TableHead className="text-right">Ad Spend</TableHead>
                <TableHead className="text-right">Ad %</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Net Income</TableHead>
                <TableHead className="text-right">YoY</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.annual.slice().reverse().map(a => {
                const prev = data.annual.find(p => p.year === a.year - 1);
                const growth = prev && prev.revenue > 0 ? ((a.revenue - prev.revenue) / prev.revenue * 100) : null;
                return (
                  <TableRow key={a.year}>
                    <TableCell className="font-bold">{a.year}</TableCell>
                    <TableCell className="text-right">{fmt(a.revenue)}</TableCell>
                    <TableCell className="text-right">{fmt(a.cogs)}</TableCell>
                    <TableCell className="text-right"><Badge variant={a.grossMarginPct && a.grossMarginPct > 40 ? 'default' : 'destructive'} className="text-xs">{pct(a.grossMarginPct)}</Badge></TableCell>
                    <TableCell className="text-right text-red-600">{fmt(a.adSpend)}</TableCell>
                    <TableCell className="text-right"><Badge variant={a.adSpendPct && a.adSpendPct < 15 ? 'default' : a.adSpendPct && a.adSpendPct < 25 ? 'outline' : 'destructive'} className="text-xs">{pct(a.adSpendPct)}</Badge></TableCell>
                    <TableCell className="text-right">{a.roas ? `${a.roas.toFixed(1)}x` : '—'}</TableCell>
                    <TableCell className="text-right">{fmt(a.totalExpenses)}</TableCell>
                    <TableCell className={`text-right font-medium ${a.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(a.netIncome)}</TableCell>
                    <TableCell className="text-right">{growth != null ? <Badge variant={growth >= 0 ? 'default' : 'destructive'} className="text-xs">{growth >= 0 ? '+' : ''}{growth.toFixed(0)}%</Badge> : '—'}</TableCell>
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
