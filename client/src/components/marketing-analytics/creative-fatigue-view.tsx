import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Flame, TrendingDown, CheckCircle2 } from 'lucide-react';
import type { FatigueCreative } from './types';

const STATUS: Record<string, { color: string; icon: any; label: string }> = {
  fatiguing: { color: 'text-red-600', icon: Flame, label: 'Fatiguing' },
  declining: { color: 'text-amber-600', icon: TrendingDown, label: 'Declining' },
  stable: { color: 'text-green-600', icon: CheckCircle2, label: 'Stable' },
  insufficient_data: { color: 'text-muted-foreground', icon: CheckCircle2, label: 'Not enough data' },
};

export function CreativeFatigueView({ days }: { days: number }) {
  const { data, isLoading } = useQuery<{ creatives: FatigueCreative[] }>({
    queryKey: ['/api/marketing-analytics/cmo/creative-fatigue', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/creative-fatigue?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data?.creatives || data.creatives.length === 0) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No creative performance data yet. This populates when ads report CTR over time.</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Creative Fatigue Forecast</CardTitle>
        <p className="text-xs text-muted-foreground">Predicts when each creative's CTR drops below the kill threshold. Queue replacements before they die.</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.creatives.map((c) => {
            const s = STATUS[c.status] || STATUS.stable;
            const Icon = s.icon;
            return (
              <div key={c.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Icon className={`h-4 w-4 shrink-0 ${s.color}`} />
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{c.headline || 'Untitled creative'}</div>
                    {c.channel && <div className="text-xs text-muted-foreground">{c.channel}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.currentCtr != null && <span className="text-xs text-muted-foreground">{(c.currentCtr * 100).toFixed(2)}% CTR</span>}
                  {c.daysToKill != null && <Badge variant={c.daysToKill < 7 ? 'destructive' : 'outline'} className="text-xs">{c.daysToKill}d left</Badge>}
                  <Badge variant="outline" className={`text-xs ${s.color}`}>{s.label}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
