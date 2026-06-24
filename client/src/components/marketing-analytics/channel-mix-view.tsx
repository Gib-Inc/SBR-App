import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ChannelMixData } from './types';

const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function ChannelMixView({ days }: { days: number }) {
  const { data, isLoading } = useQuery<ChannelMixData>({
    queryKey: ['/api/marketing-analytics/channel-mix', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/channel-mix?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data || !data.channels || data.channels.length === 0) {
    return (
      <Card><CardContent className="py-12 text-center text-muted-foreground">
        No channel data yet. Connect ad platforms in Settings to see channel performance.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">Total Spend</div>
          <div className="text-2xl font-semibold text-red-600">{fmt(data.totalSpend)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">Total Revenue</div>
          <div className="text-2xl font-semibold text-green-600">{fmt(data.totalRevenue)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">Media ROAS (attributed)</div>
          <div className="text-2xl font-semibold text-violet-600">{data.blendedRoas ? `${data.blendedRoas.toFixed(1)}x` : 'N/A'}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">TACOS</div>
          <div className="text-2xl font-semibold">{data.tacos ? `${(data.tacos * 100).toFixed(1)}%` : 'N/A'}</div>
          <div className="text-xs text-muted-foreground">Total ad cost of sale</div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Spend by Channel</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={data.channels} dataKey="spend" nameKey="platform" cx="50%" cy="50%" outerRadius={80} label={({ platform, percent }) => `${platform} ${(percent * 100).toFixed(0)}%`}>
                  {data.channels.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">CPA by Channel</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.channels}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="platform" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                <Bar dataKey="cpa" fill="#8b5cf6" name="CPA" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Channel Breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.channels.map((ch, i) => (
              <div key={ch.platform} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="font-medium">{ch.platform}</span>
                </div>
                <div className="flex gap-6 text-right">
                  <span className="text-muted-foreground w-20">{fmt(ch.spend)} spend</span>
                  <span className="text-muted-foreground w-20">{fmt(ch.revenue)} rev</span>
                  <Badge variant="outline">{ch.roas ? `${ch.roas.toFixed(1)}x` : 'N/A'}</Badge>
                  <span className="text-muted-foreground w-16">{ch.cpa ? `$${ch.cpa.toFixed(0)} CPA` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
