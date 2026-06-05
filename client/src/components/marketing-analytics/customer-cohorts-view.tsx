import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Repeat, Users, Crown, RotateCcw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n: number | null | undefined) => n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(1)}%`;
const COLORS = ['#94a3b8', '#3b82f6', '#10b981', '#8b5cf6'];

interface Bucket { label: string; customers: number; revenue: number; avgLtv: number; pctOfRevenue: number }
interface Cohorts {
  totalCustomers: number; repeatCustomers: number; repeatRate: number | null;
  avgOrdersPerCustomer: number | null; oneTime: number; twoOrders: number; threePlus: number;
  top10PctShare: number | null; retention90d: number | null; totalRevenue: number;
  byOrderCount: Bucket[];
}

export function CustomerCohortsView() {
  const { data, isLoading } = useQuery<Cohorts>({ queryKey: ['/api/marketing-analytics/cmo/customer-cohorts'] });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data || data.totalCustomers === 0) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No customer data yet.</CardContent></Card>;
  }

  const buckets = data.byOrderCount ?? [];

  return (
    <div className="space-y-4">
      {/* Headline metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> Total Customers</div>
          <div className="text-2xl font-semibold">{data.totalCustomers.toLocaleString()}</div>
          <div className="text-[11px] text-muted-foreground">{(data.avgOrdersPerCustomer ?? 0).toFixed(2)} orders each avg</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground"><Repeat className="h-3.5 w-3.5" /> Repeat Rate</div>
          <div className={`text-2xl font-semibold ${(data.repeatRate ?? 0) >= 25 ? 'text-green-600' : (data.repeatRate ?? 0) >= 15 ? '' : 'text-amber-600'}`}>{pct(data.repeatRate)}</div>
          <div className="text-[11px] text-muted-foreground">{data.repeatCustomers.toLocaleString()} bought 2+ times</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground"><RotateCcw className="h-3.5 w-3.5" /> 90-Day Retention</div>
          <div className="text-2xl font-semibold">{pct(data.retention90d)}</div>
          <div className="text-[11px] text-muted-foreground">reorder within 90 days</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground"><Crown className="h-3.5 w-3.5" /> Top 10% Share</div>
          <div className="text-2xl font-semibold">{pct(data.top10PctShare)}</div>
          <div className="text-[11px] text-muted-foreground">of revenue from best 10%</div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue by order-count bucket */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Revenue by Customer Frequency</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={buckets}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number, n: string) => n === 'revenue' ? fmt(v) : v} />
                <Bar dataKey="revenue" name="Revenue">
                  {buckets.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Bucket detail table */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Cohort Value Breakdown</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Frequency</TableHead>
                <TableHead className="text-right">Customers</TableHead>
                <TableHead className="text-right">Avg LTV</TableHead>
                <TableHead className="text-right">% of Rev</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {buckets.map(b => (
                  <TableRow key={b.label}>
                    <TableCell className="font-medium">{b.label}</TableCell>
                    <TableCell className="text-right">{b.customers.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{fmt(b.avgLtv)}</TableCell>
                    <TableCell className="text-right">{pct(b.pctOfRevenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Repeat rate and retention are the clearest signal of product-market fit. A healthy DTC repeat rate is 25%+. If the top 10% of customers drive a large share of revenue, a loyalty or VIP program likely pays off.
      </p>
    </div>
  );
}
