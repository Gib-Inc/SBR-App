import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number | null) => n != null ? `${n.toFixed(1)}%` : '—';
const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6'];

interface Platform { platform: string; spend: number; adRevenue: number; conversions: number; roas: number | null }
interface AnnualRow { year: number; revenue: number; adSpend: number; orders: number; customers: number; blendedRoas: number | null; cac: number | null; spendPercent: number | null; platforms: Platform[] }
interface MonthRow { year: number; month: number; monthName: string; revenue: number; adSpend: number; blendedRoas: number | null; cac: number | null; spendPercent: number | null; platforms: any[] }
interface CMOHistory { years: number[]; monthly: MonthRow[]; annual: AnnualRow[] }

export function CMOHistoryView() {
  const { data, isLoading } = useQuery<CMOHistory>({
    queryKey: ['/api/marketing-analytics/cmo/cmo-history'],
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data?.annual?.length) return <Card><CardContent className="py-12 text-center text-muted-foreground">No historical data. Import from the Year/Year tab first.</CardContent></Card>;

  const hasAdData = data.annual.some(a => a.adSpend > 0);

  // Revenue + spend chart data
  const revenueChart = data.annual.map(a => ({
    year: String(a.year),
    Revenue: a.revenue,
    'Ad Spend': a.adSpend,
  }));

  // ROAS + CAC + Spend% trend by year
  const efficiencyChart = data.annual.filter(a => a.blendedRoas != null).map(a => ({
    year: String(a.year),
    'Blended ROAS': a.blendedRoas,
    'Spend %': a.spendPercent,
  }));

  // Monthly ROAS trend (all years combined chronologically)
  const monthlyRoas = data.monthly.filter(m => m.blendedRoas != null).map(m => ({
    label: `${m.monthName} ${String(m.year).slice(2)}`,
    ROAS: m.blendedRoas,
    'Spend %': m.spendPercent,
  }));

  return (
    <div className="space-y-4">
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
                {a.adSpend > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {fmt(a.adSpend)} spend · {pct(a.spendPercent)} of rev
                    {a.blendedRoas && ` · ${a.blendedRoas.toFixed(1)}x ROAS`}
                    {a.cac && ` · ${fmt(a.cac)} CAC`}
                  </div>
                )}
                {a.platforms.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {a.platforms.map(p => (
                      <Badge key={p.platform} variant="outline" className="text-xs">{p.platform} {fmt(p.spend)}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Revenue vs Ad Spend by Year */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Annual Revenue vs Ad Spend</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={revenueChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Bar dataKey="Revenue" fill="#10b981" />
              <Bar dataKey="Ad Spend" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Efficiency trends (only if ad data exists) */}
      {hasAdData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">ROAS Trend by Year</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={efficiencyChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}x`} />
                  <Tooltip formatter={(v: number) => `${v.toFixed(1)}x`} />
                  <Bar dataKey="Blended ROAS" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Ad Spend as % of Revenue</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={efficiencyChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                  <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                  <Bar dataKey="Spend %" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Monthly ROAS timeline */}
      {monthlyRoas.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Blended ROAS (all time)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthlyRoas}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={2} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}x`} />
                <Tooltip formatter={(v: number) => `${v?.toFixed(1)}x`} />
                <Line type="monotone" dataKey="ROAS" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Full table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Annual Performance Summary</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Ad Spend</TableHead>
                <TableHead className="text-right">Spend %</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">CAC</TableHead>
                <TableHead className="text-right">Customers</TableHead>
                <TableHead className="text-right">YoY Growth</TableHead>
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
                    <TableCell className="text-right text-red-600">{a.adSpend > 0 ? fmt(a.adSpend) : '—'}</TableCell>
                    <TableCell className="text-right">
                      {a.spendPercent != null ? (
                        <Badge variant={a.spendPercent < 15 ? 'default' : a.spendPercent < 25 ? 'outline' : 'destructive'} className="text-xs">{pct(a.spendPercent)}</Badge>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-right">{a.blendedRoas ? `${a.blendedRoas.toFixed(1)}x` : '—'}</TableCell>
                    <TableCell className="text-right">{a.cac ? fmt(a.cac) : '—'}</TableCell>
                    <TableCell className="text-right">{a.customers || '—'}</TableCell>
                    <TableCell className="text-right">
                      {growth != null ? <Badge variant={growth >= 0 ? 'default' : 'destructive'} className="text-xs">{growth >= 0 ? '+' : ''}{growth.toFixed(0)}%</Badge> : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!hasAdData && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="py-4 text-sm text-amber-800">
            Ad spend, ROAS, and CAC columns will populate automatically once Google Ads and Meta Ads credentials are connected. Revenue data is complete from 2022.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
