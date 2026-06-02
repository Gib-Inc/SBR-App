import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { RevenueTarget } from './types';

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function RevenueTargetGauge() {
  const { data, isLoading } = useQuery<RevenueTarget>({
    queryKey: ['/api/marketing-analytics/cmo/revenue-target'],
  });

  if (isLoading) return <Card><CardContent className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>;
  if (!data) return null;

  const progress = Math.min(data.targetProgressPercent, 100);
  const onPace = data.pacePercent >= 100;
  const TrendIcon = data.trend === 'up' ? TrendingUp : data.trend === 'down' ? TrendingDown : Minus;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Revenue vs Target</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-3xl font-bold">{fmt(data.mtdRevenue)}</span>
            <span className="text-sm text-muted-foreground">of {fmt(data.monthlyTarget)}</span>
          </div>
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${onPace ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${progress}%` }} />
          </div>
          <div className="text-xs text-muted-foreground mt-1">{data.targetProgressPercent.toFixed(0)}% of monthly target</div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Projected Month-End</div>
            <div className="font-semibold">{fmt(data.projectedMonthEnd)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Pace</div>
            <Badge variant={onPace ? 'default' : 'destructive'}>{data.pacePercent.toFixed(0)}% {onPace ? 'on track' : 'behind'}</Badge>
          </div>
          <div className="col-span-2 flex items-center gap-2 pt-1 border-t">
            <TrendIcon className={`h-4 w-4 ${data.trend === 'up' ? 'text-green-600' : data.trend === 'down' ? 'text-red-600' : 'text-muted-foreground'}`} />
            <span className="text-xs text-muted-foreground">
              Last 7 days {fmt(data.last7)} vs prior {fmt(data.prior7)}
              {data.trendPercent != null && ` (${data.trendPercent >= 0 ? '+' : ''}${data.trendPercent.toFixed(0)}%)`}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
