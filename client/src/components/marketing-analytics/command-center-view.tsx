import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, DollarSign, ShoppingCart, Users, MapPin, RefreshCw, Megaphone, ShieldCheck, AlertTriangle, Database } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { RevenueTargetGauge } from './revenue-target-gauge';
import { NextBestActionView } from './next-best-action-view';
import { WastedSpendView } from './wasted-spend-view';
import type { GeoState, RevenueTarget } from './types';

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

interface AdSpendSummary {
  platforms: Array<{ platform: string; spend: number; source: 'canonical' | 'windsor' | 'uploaded' | 'live' }>;
  totalAdSpend: number | null;
  totalRevenue: number | null;
  blendedRoas: number | null;
  windowDays: number;
}

interface DataHealth {
  generatedAt: string;
  sales: { max_date: string | null; last_synced_at: string | null } | null;
  rawAds: Array<{ platform: string; max_date: string | null; rows: number; spend: number | null }>;
  spendSnapshots: Array<{ platform: string; max_date: string | null; rows: number; spend: number | null; sources: string | null }>;
  schedulers: Array<{ integration_name: string; last_status: string | null; last_success_at: string | null; error_message: string | null }>;
}

const PLATFORM_LABEL: Record<string, string> = {
  GOOGLE: 'Google Ads', META: 'Meta / Facebook', AMAZON: 'Amazon Ads',
  PINTEREST: 'Pinterest', MICROSOFT: 'Microsoft / Bing', TIKTOK: 'TikTok',
};
const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  canonical: { label: 'canonical', cls: 'text-emerald-700 border-emerald-300' },
  windsor: { label: 'Windsor', cls: 'text-emerald-700 border-emerald-300' },
  uploaded: { label: 'upload', cls: 'text-amber-700 border-amber-300' },
  live: { label: 'live', cls: 'text-muted-foreground' },
};

const daysOld = (date: string | null | undefined) => {
  if (!date) return null;
  const ms = Date.now() - new Date(`${date}T00:00:00`).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
};

const sourceDate = (health: DataHealth | undefined, platform: string) => {
  const p = platform.toUpperCase();
  if (p === 'META') return health?.spendSnapshots?.find((s) => s.platform?.toUpperCase() === 'META')?.max_date ?? null;
  if (p === 'GOOGLE') return health?.spendSnapshots?.find((s) => s.platform?.toUpperCase() === 'GOOGLE')?.max_date
    ?? health?.rawAds?.find((r) => r.platform?.toUpperCase().includes('GOOGLE'))?.max_date ?? null;
  if (p === 'AMAZON') return health?.spendSnapshots?.find((s) => s.platform?.toUpperCase() === 'AMAZON')?.max_date
    ?? health?.rawAds?.find((r) => r.platform?.toUpperCase().includes('AMAZON'))?.max_date ?? null;
  return health?.rawAds?.find((r) => r.platform?.toUpperCase() === p)?.max_date ?? null;
};

function DecisionBrief({ days }: { days: number }) {
  const { data: spend } = useQuery<AdSpendSummary>({
    queryKey: ['/api/marketing-analytics/cmo/ad-spend-summary', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/ad-spend-summary?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });
  const { data: health } = useQuery<DataHealth>({ queryKey: ['/api/marketing-analytics/cmo/data-health'] });

  const salesAge = daysOld(health?.sales?.max_date);
  const stalePlatforms = (spend?.platforms ?? [])
    .filter((p) => p.spend > 0)
    .map((p) => ({ ...p, maxDate: sourceDate(health, p.platform) }))
    .filter((p) => {
      const age = daysOld(p.maxDate);
      return age == null || age > 7;
    });
  const schedulerFailures = (health?.schedulers ?? []).filter((s) => s.last_status && s.last_status !== 'success');
  const isStale = (salesAge != null && salesAge > 2) || stalePlatforms.length > 0 || schedulerFailures.length > 0;
  const roas = spend?.blendedRoas ?? null;
  const spendTotal = spend?.totalAdSpend ?? null;
  const revenue = spend?.totalRevenue ?? null;
  const decision =
    isStale ? 'Read with caution'
      : roas == null ? 'Waiting on data'
      : roas >= 8 ? 'Decision-grade: scale carefully'
      : roas >= 5 ? 'Decision-grade: hold and watch'
      : 'Decision-grade: fix before scaling';

  return (
    <Alert className={isStale ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20' : 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20'}>
      {isStale ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
      <AlertTitle className="flex flex-wrap items-center gap-2">
        <span>{decision}</span>
        <Badge variant="outline" className={isStale ? 'border-amber-400 text-amber-700' : 'border-emerald-400 text-emerald-700'}>
          {isStale ? 'freshness warning' : 'fresh inputs'}
        </Badge>
      </AlertTitle>
      <AlertDescription>
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
          <p className="leading-relaxed">
            Media ROAS is <span className="font-semibold text-foreground">{roas != null ? `${roas.toFixed(2)}x` : 'not available'}</span>
            {spendTotal != null && revenue != null ? <> on <span className="font-semibold text-foreground">{fmt(spendTotal)}</span> corrected media spend and <span className="font-semibold text-foreground">{fmt(revenue)}</span> revenue.</> : '.'}
            {' '}Headline spend uses the canonical engine; raw ad rows are diagnostic only.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border bg-background/70 p-2">
              <div className="text-muted-foreground">Sales data through</div>
              <div className="font-medium text-foreground">{health?.sales?.max_date ?? 'unknown'}</div>
            </div>
            <div className="rounded border bg-background/70 p-2">
              <div className="text-muted-foreground">Ad spend health</div>
              <div className="font-medium text-foreground">{stalePlatforms.length ? `${stalePlatforms.length} stale source${stalePlatforms.length > 1 ? 's' : ''}` : 'current enough'}</div>
            </div>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function DataFreshnessPanel({ days }: { days: number }) {
  const { data } = useQuery<DataHealth>({ queryKey: ['/api/marketing-analytics/cmo/data-health'] });
  const { data: spend } = useQuery<AdSpendSummary>({
    queryKey: ['/api/marketing-analytics/cmo/ad-spend-summary', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/ad-spend-summary?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });
  const rows = (spend?.platforms ?? []).filter((p) => p.spend > 0).map((p) => {
    const maxDate = sourceDate(data, p.platform);
    const age = daysOld(maxDate);
    return { ...p, maxDate, age };
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1"><Database className="h-3.5 w-3.5" /> Data Freshness</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Daily sales</div>
            <div className="font-medium">{data?.sales?.max_date ?? 'unknown'}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-muted-foreground">Last sales sync</div>
            <div className="font-medium truncate">{data?.sales?.last_synced_at ? data.sales.last_synced_at.slice(0, 16) : 'unknown'}</div>
          </div>
        </div>
        <div className="space-y-1">
          {rows.map((p) => (
            <div key={p.platform} className="flex items-center justify-between gap-3 text-xs border-b last:border-0 py-1.5">
              <span className="font-medium">{PLATFORM_LABEL[p.platform] || p.platform}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{p.maxDate ?? 'unknown'}</span>
                <Badge variant="outline" className={p.age == null || p.age > 7 ? 'text-amber-700 border-amber-300' : 'text-emerald-700 border-emerald-300'}>
                  {p.age == null ? 'unknown' : `${p.age}d old`}
                </Badge>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Decision mode hides raw-feed noise. Deep-dive reports may still use older diagnostic feeds for shape, clicks, or attribution.
        </p>
      </CardContent>
    </Card>
  );
}

function AdSpendByChannelCard({ days }: { days: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<AdSpendSummary>({
    queryKey: ['/api/marketing-analytics/cmo/ad-spend-summary', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/ad-spend-summary?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  const sync = useMutation({
    mutationFn: async () => {
      const r = await apiRequest('POST', '/api/marketing-analytics/cmo/windsor/sync', { days: 90 });
      return r.json();
    },
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ['/api/marketing-analytics/cmo/ad-spend-summary'] });
      qc.invalidateQueries({ queryKey: ['/api/marketing-analytics/cmo/channel-matrix'] });
      qc.invalidateQueries({ queryKey: ['/api/marketing-analytics/kpis'] });
      if (d.rowsUpserted > 0) {
        toast({ title: 'Windsor sync complete', description: `${d.rowsUpserted} rows across ${Object.keys(d.platforms || {}).join(', ') || 'no platforms'}` });
      } else {
        toast({ title: 'Windsor sync', description: (d.errors?.[0]) || 'No rows returned. Check the Windsor API key.', variant: 'destructive' });
      }
    },
    onError: (e: any) => toast({ title: 'Windsor sync failed', description: e.message, variant: 'destructive' }),
  });

  const platforms = (data?.platforms ?? []).filter((p) => p.spend > 0);
  const totalSpend = data?.totalAdSpend ?? 0;
  const totalRevenue = data?.totalRevenue ?? null;
  const blendedRoas = data?.blendedRoas ?? null;
  const hasUpload = platforms.some((p) => p.source === 'uploaded');

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1">
            <Megaphone className="h-3.5 w-3.5" /> Ad Spend by Channel ({days}d)
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
        ) : platforms.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">No ad spend tracked in this window. Hit "Sync Windsor" to pull.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Total Spend</div>
                <div className="text-lg font-bold">{fmt(totalSpend)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Revenue</div>
                <div className="text-lg font-bold">{totalRevenue != null ? fmt(totalRevenue) : '—'}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Media ROAS (ads only)</div>
                <div className={`text-lg font-bold ${blendedRoas != null && blendedRoas >= 1 ? 'text-green-600' : 'text-foreground'}`}>
                  {blendedRoas != null ? `${blendedRoas.toFixed(1)}x` : 'N/A'}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              {platforms.map((p) => {
                const badge = SOURCE_BADGE[p.source] || SOURCE_BADGE.live;
                const pct = totalSpend > 0 ? Math.round((p.spend / totalSpend) * 100) : 0;
                return (
                  <div key={p.platform} className="flex items-center justify-between text-sm border-b last:border-0 py-1">
                    <span className="font-medium">{PLATFORM_LABEL[p.platform] || p.platform}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                      <span className="font-medium w-20 text-right">{fmt(p.spend)}</span>
                      <Badge variant="outline" className={`text-[10px] w-16 justify-center ${badge.cls}`}>
                        {badge.label}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Source of truth: Windsor (authoritative) &gt; uploaded CSV &gt; live. Matches the Finances unified view.
              {hasUpload && ' Upload-tagged platforms are from a manual CSV — connect them in Windsor for daily auto-sync.'}
            </p>
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
      <DecisionBrief days={days} />
      <TopMetrics />
      <MorningHeadline />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <RevenueTargetGauge />
          <RevenueSpark days={days} />
          <TopProducts days={days} />
        </div>
        <div className="space-y-4">
          <AdSpendByChannelCard days={days} />
          <DataFreshnessPanel days={days} />
          <WastedSpendView days={days} compact />
          <TopStates days={days} />
          <CustomerInsight days={days} />
        </div>
      </div>

      <NextBestActionView />
    </div>
  );
}
