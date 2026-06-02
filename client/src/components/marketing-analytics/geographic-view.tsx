import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import type { GeoState } from './types';

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function GeographicView({ days }: { days: number }) {
  const { data, isLoading } = useQuery<{ states: GeoState[] }>({
    queryKey: ['/api/marketing-analytics/cmo/geographic', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/geographic?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data?.states || data.states.length === 0) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No geographic data yet.</CardContent></Card>;
  }

  const maxRev = Math.max(...data.states.map(s => s.revenue));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Revenue by State</CardTitle>
        <p className="text-xs text-muted-foreground">Top markets with month-over-month growth. Target ad spend where demand is rising.</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.states.map((s) => (
            <div key={s.state} className="flex items-center gap-3">
              <div className="w-12 text-sm font-medium">{s.state}</div>
              <div className="flex-1 h-6 bg-muted rounded overflow-hidden relative">
                <div className="h-full bg-blue-500/70 rounded" style={{ width: `${(s.revenue / maxRev) * 100}%` }} />
                <span className="absolute inset-y-0 left-2 flex items-center text-xs font-medium">{fmt(s.revenue)}</span>
              </div>
              <div className="w-20 text-right text-xs text-muted-foreground">{s.orders} orders</div>
              <div className="w-16 text-right">
                {s.mom_growth != null ? (
                  <Badge variant="outline" className={`text-xs ${s.mom_growth >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {s.mom_growth >= 0 ? <TrendingUp className="h-3 w-3 mr-0.5 inline" /> : <TrendingDown className="h-3 w-3 mr-0.5 inline" />}
                    {s.mom_growth >= 0 ? '+' : ''}{s.mom_growth.toFixed(0)}%
                  </Badge>
                ) : <span className="text-xs text-muted-foreground">new</span>}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
