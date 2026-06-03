import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Monitor, Smartphone, Tablet, Globe } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n: number | null | undefined) => n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];

interface Campaign { platform: string; campaign: string; spend: number; revenue: number; impressions: number; clicks: number; conversions: number; roas: number | null; cpc: number | null; ctr: number | null }
interface Device { device: string; platform: string; spend: number; revenue: number; impressions: number; clicks: number; conversions: number; roas: number | null; cpc: number | null }
interface GeoRow { country: string; adSpend: number; adRevenue: number; conversions: number; roas: number | null; salesRevenue: number; salesOrders: number }

const DeviceIcon = ({ d }: { d: string }) => {
  if (d === 'mobile') return <Smartphone className="h-3.5 w-3.5" />;
  if (d === 'tablet') return <Tablet className="h-3.5 w-3.5" />;
  return <Monitor className="h-3.5 w-3.5" />;
};

export function ChannelDeepDiveView({ days }: { days: number }) {
  const { data: campaigns, isLoading: cLoading } = useQuery<Campaign[]>({
    queryKey: ['/api/marketing-analytics/cmo/campaign-breakdown', { days }],
    queryFn: async () => { const r = await fetch(`/api/marketing-analytics/cmo/campaign-breakdown?days=${days}`, { credentials: 'include' }); return r.json(); },
  });
  const { data: devices, isLoading: dLoading } = useQuery<Device[]>({
    queryKey: ['/api/marketing-analytics/cmo/device-breakdown', { days }],
    queryFn: async () => { const r = await fetch(`/api/marketing-analytics/cmo/device-breakdown?days=${days}`, { credentials: 'include' }); return r.json(); },
  });
  const { data: geo, isLoading: gLoading } = useQuery<GeoRow[]>({
    queryKey: ['/api/marketing-analytics/cmo/ad-geo', { days }],
    queryFn: async () => { const r = await fetch(`/api/marketing-analytics/cmo/ad-geo?days=${days}`, { credentials: 'include' }); return r.json(); },
  });

  const loading = cLoading || dLoading || gLoading;
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  const hasCampaigns = campaigns && campaigns.length > 0;
  const hasDevices = devices && devices.length > 0;
  const hasGeo = geo && geo.length > 0;

  if (!hasCampaigns && !hasDevices && !hasGeo) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">
      <p>No campaign/device/geo data yet.</p>
      <p className="text-xs mt-1">Run a Windsor sync with 90 days. If only "_all" rows appear, Windsor may not be reporting these dimensions for your connected sources.</p>
    </CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      {/* Campaign breakdown */}
      {hasCampaigns && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Top Campaigns by Spend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.min(300, campaigns.length * 32 + 40)}>
              <BarChart data={campaigns.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="campaign" tick={{ fontSize: 9 }} width={140} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="spend" name="Spend">
                  {campaigns.slice(0, 10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">CPC</TableHead>
                <TableHead className="text-right">CTR</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {campaigns.slice(0, 20).map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-[200px] truncate text-xs">{c.campaign}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{c.platform}</Badge></TableCell>
                    <TableCell className="text-right">{fmt(c.spend)}</TableCell>
                    <TableCell className="text-right">{fmt(c.revenue)}</TableCell>
                    <TableCell className="text-right">
                      {c.roas != null ? <Badge variant={c.roas >= 3 ? 'default' : c.roas >= 1 ? 'outline' : 'destructive'} className="text-xs">{c.roas.toFixed(1)}x</Badge> : '—'}
                    </TableCell>
                    <TableCell className="text-right">{c.cpc != null ? `$${c.cpc.toFixed(2)}` : '—'}</TableCell>
                    <TableCell className="text-right">{c.ctr != null ? `${c.ctr.toFixed(1)}%` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Device breakdown */}
        {hasDevices && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Performance by Device</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="text-right">CPC</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {devices.map((d, i) => (
                    <TableRow key={i}>
                      <TableCell className="flex items-center gap-1.5"><DeviceIcon d={d.device} /> {d.device}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{d.platform}</Badge></TableCell>
                      <TableCell className="text-right">{fmt(d.spend)}</TableCell>
                      <TableCell className="text-right">
                        {d.roas != null ? <Badge variant={d.roas >= 3 ? 'default' : d.roas >= 1 ? 'outline' : 'destructive'} className="text-xs">{d.roas.toFixed(1)}x</Badge> : '—'}
                      </TableCell>
                      <TableCell className="text-right">{d.cpc != null ? `$${d.cpc.toFixed(2)}` : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Geo breakdown */}
        {hasGeo && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Globe className="h-4 w-4" /> Ad Spend vs Sales Revenue by Country</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Ad Spend</TableHead>
                  <TableHead className="text-right">Ad ROAS</TableHead>
                  <TableHead className="text-right">Sales Rev</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {geo.map((g, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{g.country}</TableCell>
                      <TableCell className="text-right">{fmt(g.adSpend)}</TableCell>
                      <TableCell className="text-right">
                        {g.roas != null ? <Badge variant={g.roas >= 3 ? 'default' : g.roas >= 1 ? 'outline' : 'destructive'} className="text-xs">{g.roas.toFixed(1)}x</Badge> : '—'}
                      </TableCell>
                      <TableCell className="text-right">{fmt(g.salesRevenue)}</TableCell>
                      <TableCell className="text-right">{g.salesOrders}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
