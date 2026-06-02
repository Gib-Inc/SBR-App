import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n: number | null) => n != null ? `$${Math.round(n).toLocaleString('en-US')}` : 'N/A';
const pct = (n: number | null) => n != null ? `${n.toFixed(1)}%` : 'N/A';
const fmtMonth = (m: string) => {
  const d = new Date(m + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

interface BlendedMonth {
  month: string;
  totalRevenue: number;
  adSpend: number;
  adRevenue: number;
  blendedRoas: number | null;
  adRoas: number | null;
  cac: number | null;
  newCustomers: number;
  conversions: number;
  spendToRevenueRatio: number | null;
}

interface AdSpendRow {
  month: string;
  platform: string;
  spend: number;
  revenue: number;
  conversions: number;
  roas: number | null;
  cpa: number | null;
}

export function MonthlyPerformanceView() {
  const { data: blended, isLoading: bLoad } = useQuery<BlendedMonth[]>({
    queryKey: ['/api/marketing-analytics/cmo/monthly-blended'],
  });
  const { data: adSpend, isLoading: aLoad } = useQuery<AdSpendRow[]>({
    queryKey: ['/api/marketing-analytics/cmo/monthly-ad-spend'],
  });

  const isLoading = bLoad || aLoad;
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  const months = blended || [];
  const adRows = adSpend || [];

  if (months.length === 0) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No monthly data yet. Revenue data appears after Shopify orders sync.</CardContent></Card>;
  }

  const chartData = months.map(m => ({
    month: fmtMonth(m.month),
    Revenue: m.totalRevenue,
    'Ad Spend': m.adSpend,
  }));

  const roasData = months.map(m => ({
    month: fmtMonth(m.month),
    'Blended ROAS': m.blendedRoas,
    'Ad ROAS': m.adRoas,
  }));

  // Group ad spend by month for the per-channel table
  const latestMonth = months[months.length - 1]?.month;
  const latestAds = adRows.filter(r => r.month === latestMonth);

  return (
    <div className="space-y-4">
      {/* Monthly revenue vs ad spend */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Revenue vs Ad Spend</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Bar dataKey="Revenue" fill="#10b981" />
              <Bar dataKey="Ad Spend" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly ROAS trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly ROAS Trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={roasData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}x`} />
                <Tooltip formatter={(v: number) => v ? `${v.toFixed(1)}x` : 'N/A'} />
                <Legend />
                <Line type="monotone" dataKey="Blended ROAS" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Ad ROAS" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly CAC Trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={months.map(m => ({ month: fmtMonth(m.month), CAC: m.cac, Customers: m.newCustomers }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v: number, name: string) => name === 'CAC' ? fmt(v) : v} />
                <Legend />
                <Line type="monotone" dataKey="CAC" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Monthly summary table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Summary</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Ad Spend</TableHead>
                <TableHead className="text-right">Spend %</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">CAC</TableHead>
                <TableHead className="text-right">Customers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.slice().reverse().map(m => (
                <TableRow key={m.month}>
                  <TableCell className="font-medium">{fmtMonth(m.month)}</TableCell>
                  <TableCell className="text-right">{fmt(m.totalRevenue)}</TableCell>
                  <TableCell className="text-right text-red-600">{fmt(m.adSpend)}</TableCell>
                  <TableCell className="text-right">
                    {m.spendToRevenueRatio != null ? (
                      <Badge variant={m.spendToRevenueRatio < 15 ? 'default' : m.spendToRevenueRatio < 25 ? 'outline' : 'destructive'} className="text-xs">
                        {pct(m.spendToRevenueRatio)}
                      </Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-right">{m.blendedRoas ? `${m.blendedRoas.toFixed(1)}x` : '—'}</TableCell>
                  <TableCell className="text-right">{m.cac ? fmt(m.cac) : '—'}</TableCell>
                  <TableCell className="text-right">{m.newCustomers}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Current month ad spend by channel */}
      {latestAds.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Ad Spend by Channel — {fmtMonth(latestMonth!)}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="text-right">Conv.</TableHead>
                  <TableHead className="text-right">CPA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latestAds.map(a => (
                  <TableRow key={a.platform}>
                    <TableCell className="font-medium">{a.platform}</TableCell>
                    <TableCell className="text-right">{fmt(a.spend)}</TableCell>
                    <TableCell className="text-right">{fmt(a.revenue)}</TableCell>
                    <TableCell className="text-right">{a.roas ? `${a.roas.toFixed(1)}x` : '—'}</TableCell>
                    <TableCell className="text-right">{a.conversions}</TableCell>
                    <TableCell className="text-right">{a.cpa ? fmt(a.cpa) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
