import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import type { ChannelMatrixItem } from './types';

const QUADRANT_COLORS: Record<string, string> = {
  scale: '#10b981', maintain: '#3b82f6', fix: '#f59e0b', cut: '#ef4444',
};
const QUADRANT_LABELS: Record<string, string> = {
  scale: 'Scale (high ROAS, high spend)',
  maintain: 'Maintain (high ROAS, low spend)',
  fix: 'Fix (low ROAS, high spend)',
  cut: 'Cut (low ROAS, low spend)',
};

export function ChannelOpportunityMatrix({ days }: { days: number }) {
  const { data, isLoading } = useQuery<{ channels: ChannelMatrixItem[] }>({
    queryKey: ['/api/marketing-analytics/cmo/channel-matrix', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/channel-matrix?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <Card><CardContent className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>;
  if (!data?.channels || data.channels.length === 0) {
    return (
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Channel Opportunity Matrix</CardTitle></CardHeader>
      <CardContent className="py-8 text-center text-muted-foreground text-sm">
        No channel data yet. Connect ad platforms to see where to move budget.
      </CardContent></Card>
    );
  }

  const points = data.channels.map((c) => ({ x: c.roas, y: c.spend, platform: c.platform, quadrant: c.quadrant }));

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Channel Opportunity Matrix</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" name="ROAS" tick={{ fontSize: 11 }} label={{ value: 'ROAS →', position: 'bottom', fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name="Spend" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} label={{ value: 'Spend →', angle: -90, position: 'left', fontSize: 11 }} />
            <ReferenceLine x={1} stroke="#9ca3af" strokeDasharray="5 5" />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: number, n: string) => n === 'Spend' ? `$${v.toFixed(0)}` : `${v.toFixed(1)}x`} labelFormatter={() => ''} content={({ payload }) => {
              if (!payload?.[0]) return null;
              const p = payload[0].payload;
              return <div className="bg-background border rounded p-2 text-xs shadow"><div className="font-medium">{p.platform}</div><div>ROAS: {p.x.toFixed(1)}x</div><div>Spend: ${p.y.toFixed(0)}</div><div className="capitalize text-muted-foreground">{p.quadrant}</div></div>;
            }} />
            <Scatter data={points}>
              {points.map((p, i) => <Cell key={i} fill={QUADRANT_COLORS[p.quadrant]} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div className="grid grid-cols-2 gap-2 mt-3">
          {Object.entries(QUADRANT_LABELS).map(([k, label]) => (
            <div key={k} className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: QUADRANT_COLORS[k] }} />
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1">
          {data.channels.map((c) => (
            <div key={c.platform} className="flex items-center justify-between text-sm">
              <span className="font-medium">{c.platform}</span>
              <Badge style={{ backgroundColor: QUADRANT_COLORS[c.quadrant], color: 'white' }} className="capitalize">{c.quadrant}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
