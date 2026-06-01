import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { YoYWeek, ConversionTrend } from './types';

const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function SeasonalIntelligenceView() {
  const currentYear = new Date().getFullYear();
  const compareYear = currentYear - 1;

  const { data, isLoading } = useQuery<{ yoy: YoYWeek[]; conversionTrends: ConversionTrend[] }>({
    queryKey: ['/api/marketing-analytics/seasonal', { currentYear, compareYear }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/seasonal?currentYear=${currentYear}&compareYear=${compareYear}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data || data.yoy.length === 0) {
    return (
      <Card><CardContent className="py-12 text-center text-muted-foreground">
        No seasonal data yet. This view needs at least one year of sales order history.
      </CardContent></Card>
    );
  }

  const currentTotal = data.yoy.reduce((s, w) => s + (w.current_revenue || 0), 0);
  const priorTotal = data.yoy.reduce((s, w) => s + (w.prior_revenue || 0), 0);
  const yoyChange = priorTotal > 0 ? ((currentTotal - priorTotal) / priorTotal) * 100 : null;

  const currentOrders = data.yoy.reduce((s, w) => s + (w.current_orders || 0), 0);
  const priorOrders = data.yoy.reduce((s, w) => s + (w.prior_orders || 0), 0);

  const chartData = data.yoy.map(w => ({
    week: `W${w.week_num}`,
    [`${currentYear}`]: w.current_revenue || 0,
    [`${compareYear}`]: w.prior_revenue || 0,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">{currentYear} Revenue</div>
          <div className="text-2xl font-semibold text-green-600">{fmt(currentTotal)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">{compareYear} Revenue</div>
          <div className="text-2xl font-semibold">{fmt(priorTotal)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">YoY Change</div>
          <div className="text-2xl font-semibold flex items-center gap-1">
            {yoyChange != null ? (
              <>
                {yoyChange >= 0 ? <TrendingUp className="h-5 w-5 text-green-600" /> : <TrendingDown className="h-5 w-5 text-red-600" />}
                <span className={yoyChange >= 0 ? 'text-green-600' : 'text-red-600'}>{yoyChange >= 0 ? '+' : ''}{yoyChange.toFixed(1)}%</span>
              </>
            ) : 'N/A'}
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">Orders ({currentYear} vs {compareYear})</div>
          <div className="text-2xl font-semibold">{currentOrders.toLocaleString()} <span className="text-sm text-muted-foreground">vs {priorOrders.toLocaleString()}</span></div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Revenue: {currentYear} vs {compareYear} (by week)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Line type="monotone" dataKey={`${currentYear}`} stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey={`${compareYear}`} stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {data.conversionTrends.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Conversion Rate Trend ({currentYear})</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data.conversionTrends.map(t => ({ week: `W${t.week_num}`, convRate: t.conv_rate ? (t.conv_rate * 100) : null, ctr: t.ctr ? (t.ctr * 100) : null }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(1)}%`} />
                <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                <Area type="monotone" dataKey="convRate" fill="#8b5cf6" fillOpacity={0.15} stroke="#8b5cf6" name="Conv Rate" />
                <Area type="monotone" dataKey="ctr" fill="#3b82f6" fillOpacity={0.1} stroke="#3b82f6" name="CTR" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
