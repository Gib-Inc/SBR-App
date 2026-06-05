import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, TrendingDown, Minus, DollarSign, ShoppingCart, Users, MapPin, Package, RefreshCw, Megaphone } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { RevenueTargetGauge } from './revenue-target-gauge';
import { NextBestActionView } from './next-best-action-view';
import { WastedSpendView } from './wasted-spend-view';
import type { GeoState, RevenueTarget, ChannelMatrixItem } from './types';

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function TopMetrics() {
  const { data } = useQuery<{ todayRevenue: number; todayOrders: number; yesterdayRevenue: number; yesterdayOrders: number; mtdRevenue: number; mtdOrders: number; aov: number }>({
    queryKey: ['/api/marketing-analytics/cmo/top-metrics'],
  });
  if (!data) return null;
  const todayVsYesterday = data.yesterdayRevenue > 0 ? ((data.todayRevenue - data.yesterdayRevenue) / data.yesterdayRevenue * 100) : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card><CardContent className="pt-3 pb-2">
        <div className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" /> Today</div>
        <div className="text-xl font-bold">{fmt(data.todayRevenue)}</div>
        <div className="text-xs text-muted-foreground">{data.todayOrders} orders
          {todayVsYesterday != null && <span className={todayVsYesterday >= 0 ? 'text-green-600' : 'text-red-600'}> ({todayVsYesterday >= 0 ? '+' : ''}{todayVsYesterday.toFixed(0)}% vs yesterday)</span>}
        </div>
      </CardContent></Card>
      <Card><CardContent className="pt-3 pb-2">
        <div className="text-xs text-muted-foreground flex items-center gap-1"><ShoppingCart className="h-3 w-3" /> MTD Orders</div>
        <div className="text-xl font-bold">{data.mtdOrders.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground">{fmt(data.mtdRevenue)} revenue</div>
      </CardContent></Card>
      <Card><CardContent className="pt-3 pb-2">
        <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Avg Order</div>
        <div className="text-xl font-bold">{fmt(data.aov)}</div>
      </CardContent></Card>
      <Card><CardContent className="pt-3 pb-2">
        <div className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" /> Yesterday</div>
        <div className="text-xl font-bold">{fmt(data.yesterdayRevenue)}</div>
        <div className="text-xs text-muted-foreground">{data.yesterdayOrders} orders</div>
      </CardContent></Card>
    </div>
  );
}

function RevenueSpark({ days }: { days: number }) {
  const { data } = useQuery<{ days: Array<{ date: string; revenue: number; orders: number }> }>({
    queryKey: ['/api/marketing-analytics/cmo/daily-revenue', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/daily-revenue?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });
  if (!data?.days?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-sm">Daily Revenue ({days}d)</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={data.days}>
            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(d) => d.slice(5)} />
            <YAxis hide />
            <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={(d) => d} />
            <Area type="monotone" dataKey="revenue" fill="#10b981" fillOpacity={0.2} stroke="#10b981" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function TopProducts({ days }: { days: number }) {
  const { data } = useQuery<{ products: Array<{ sku: string; name: string | null; revenue: number; units: number; growth_pct: number | null }> }>({
    queryKey: ['/api/marketing-analytics/cmo/product-mix', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/product-mix?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });
  if (!data?.products?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-sm">Product Mix ({days}d)</CardTitle></CardHeader>
      <CardContent className="p-0">
        {data.products.slice(0, 8).map((p) => (
          <div key={p.sku} className="flex items-center justify-between px-4 py-2 border-b last:border-0 text-sm">
            <div className="min-w-0 flex-1"><span className="font-medium truncate block">{p.name || p.sku}</span></div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-muted-foreground">{p.units} units</span>
              <span className="font-medium w-20 text-right">{fmt(p.revenue)}</span>
              {p.growth_pct != null ? (
                <Badge variant="outline" className={`text-xs w-16 justify-center ${p.growth_pct >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {p.growth_pct >= 0 ? '+' : ''}{p.growth_pct.toFixed(0)}%
                </Badge>
              ) : <span className="w-16 text-xs text-center text-muted-foreground">new</span>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TopStates({ days }: { days: number }) {
  const { data } = useQuery<{ states: GeoState[] }>({
    queryKey: ['/api/marketing-analytics/cmo/geographic', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/geographic?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });
  if (!data?.states?.length) return null;
  const top5 = data.states.slice(0, 5);
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-sm flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Top Markets</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={top5} layout="vertical">
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="state" tick={{ fontSize: 11 }} width={30} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function CustomerInsight({ days }: { days: number }) {
  const { data } = useQuery<{ split: Array<{ customer_type: string; orders: number; revenue: number; aov: number }> }>({
    queryKey: ['/api/marketing-analytics/cmo/customer-split', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/customer-split?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });
  if (!data?.split?.length) return null;
  const newC = data.split.find(s => s.customer_type === 'new');
  const retC = data.split.find(s => s.customer_type === 'returning');
  const total = (newC?.revenue || 0) + (retC?.revenue || 0);
  const newPct = total > 0 ? Math.round((newC?.revenue || 0) / total * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-sm">New vs Returning</CardTitle></CardHeader>
      <CardContent>
        <div className="h-4 w-full rounded-full bg-muted overflow-hidden flex">
          <div className="bg-blue-500 h-full" style={{ width: `${newPct}%` }} />
          <div className="bg-violet-500 h-full" style={{ width: `${100 - newPct}%` }} />
        </div>
        <div className="flex justify-between text-xs mt-2">
          <span className="text-blue-600">New {newPct}% · {fmt(newC?.aov || 0)} AOV</span>
          <span className="text-violet-600">Returning {100 - newPct}% · {fmt(retC?.aov || 0)} AOV</span>
        </div>
      </CardContent>
    </Card>
  );
}

function WindsorAdSpendCard({ days }: { days: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ channels: ChannelMatrixItem[] }>({
    queryKey: ['/api/marketing-analytics/cmo/channel-matrix', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/channel-matrix?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  const sync = useMutation({
    mutationFn: async () => {
      const r = await apiRequest('POST', '/api/marketing-analytics/cmo/windsor/sync', { days: 90 });
      return r.json();
    },
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ['/api/marketing-analytics/cmo/channel-matrix'] });
      if (d.rowsUpserted > 0) {
        toast({ title: 'Windsor sync complete', description: `${d.rowsUpserted} rows across ${Object.keys(d.platforms || {}).join(', ') || 'no platforms'}` });
      } else {
        toast({ title: 'Windsor sync', description: (d.errors?.[0]) || 'No rows returned. Check the Windsor API key.', variant: 'destructive' });
      }
    },
    onError: (e: any) => toast({ title: 'Windsor sync failed', description: e.message, variant: 'destructive' }),
  });

  const channels = data?.channels ?? [];
  const totalSpend = channels.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = channels.reduce((s, c) => s + c.revenue, 0);
  const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : null;

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1">
            <Megaphone className="h-3.5 w-3.5" /> Windsor Ad Spend ({days}d)
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Sync Windsor
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : channels.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">No ad data yet. Hit "Sync Windsor" to pull.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Total Spend</div>
                <div className="text-lg font-bold">{fmt(totalSpend)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Total Revenue</div>
                <div className="text-lg font-bold">{fmt(totalRevenue)}</div>
              </div>
              {blendedRoas != null && (
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Blended ROAS</div>
                  <div className={`text-lg font-bold ${blendedRoas >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                    {blendedRoas.toFixed(1)}x
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-1">
              {channels.map((c) => (
                <div key={c.platform} className="flex items-center justify-between text-sm border-b last:border-0 py-1">
                  <span className="font-medium">{c.platform}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{fmt(c.spend)}</span>
                    <span>{fmt(c.revenue)}</span>
                    <Badge
                      variant="outline"
                      className={`text-xs w-14 justify-center ${(c.roas ?? 0) >= 1 ? 'text-green-700' : 'text-red-700'}`}
                    >
                      {c.roas != null ? `${c.roas.toFixed(1)}x` : 'N/A'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MorningHeadline() {
  const { data: ltv } = useQuery<{ summary: { blendedCac: number | null; blendedRatio: number | null; healthy: boolean | null } }>({
    queryKey: ['/api/marketing-analytics/cmo/ltv-cac'],
  });
  const { data: cohorts } = useQuery<{ repeatRate: number | null; top10PctShare: number | null }>({
    queryKey: ['/api/marketing-analytics/cmo/customer-cohorts'],
  });
  const s = ltv?.summary;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card><CardContent className="pt-3 pb-2">
        <div className="text-xs text-muted-foreground">LTV : CAC</div>
        <div className={`text-xl font-bold ${s?.healthy === false ? 'text-red-600' : s?.healthy ? 'text-green-600' : ''}`}>
          {s?.blendedRatio != null ? `${s.blendedRatio.toFixed(1)}x` : '—'}
        </div>
        <div className="text-xs text-muted-foreground">healthy ≥ 3x</div>
      </CardContent></Card>
      <Card><CardContent className="pt-3 pb-2">
        <div className="text-xs text-muted-foreground">Blended CAC</div>
        <div className="text-xl font-bold">{s?.blendedCac != null ? `$${Math.round(s.blendedCac).toLocaleString()}` : '—'}</div>
        <div className="text-xs text-muted-foreground">cost per new customer</div>
      </CardContent></Card>
      <Card><CardContent className="pt-3 pb-2">
        <div className="text-xs text-muted-foreground">Repeat Rate</div>
        <div className="text-xl font-bold">{cohorts?.repeatRate != null ? `${cohorts.repeatRate.toFixed(1)}%` : '—'}</div>
        <div className="text-xs text-muted-foreground">bought 2+ times</div>
      </CardContent></Card>
      <Card><CardContent className="pt-3 pb-2">
        <div className="text-xs text-muted-foreground">Top 10% Share</div>
        <div className="text-xl font-bold">{cohorts?.top10PctShare != null ? `${cohorts.top10PctShare.toFixed(0)}%` : '—'}</div>
        <div className="text-xs text-muted-foreground">of revenue</div>
      </CardContent></Card>
    </div>
  );
}

export function CommandCenterView({ days }: { days: number }) {
  return (
    <div className="space-y-4">
      <TopMetrics />
      <MorningHeadline />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <RevenueTargetGauge />
          <RevenueSpark days={days} />
          <TopProducts days={days} />
        </div>
        <div className="space-y-4">
          <WindsorAdSpendCard days={days} />
          <WastedSpendView days={days} compact />
          <TopStates days={days} />
          <CustomerInsight days={days} />
        </div>
      </div>

      <NextBestActionView />
    </div>
  );
}
