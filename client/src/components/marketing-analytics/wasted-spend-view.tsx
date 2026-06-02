import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { WastedSpend } from './types';

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function WastedSpendView({ days, compact = false }: { days: number; compact?: boolean }) {
  const { data, isLoading } = useQuery<WastedSpend>({
    queryKey: ['/api/marketing-analytics/cmo/wasted-spend', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/wasted-spend?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <Card><CardContent className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>;

  const total = data?.totalWasted || 0;
  const count = data?.count || 0;

  return (
    <Card className={total > 0 ? 'border-red-200' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {total > 0 && <AlertTriangle className="h-4 w-4 text-red-600" />}
          Wasted Spend
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-red-600">{fmt(total)}</div>
        <div className="text-xs text-muted-foreground mb-3">
          {count} product{count !== 1 ? 's' : ''} spending below break-even ROAS
        </div>
        {!compact && data?.items && data.items.length > 0 && (
          <div className="space-y-2">
            {data.items.map((item) => (
              <div key={item.sku} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                <span className="font-medium">{item.name || item.sku}</span>
                <div className="flex gap-2 items-center">
                  <span className="text-muted-foreground">{fmt(item.spend)}</span>
                  <Badge variant="destructive" className="text-xs">
                    {item.actualRoas?.toFixed(1)}x vs {item.breakevenRoas?.toFixed(1)}x needed
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
        {total === 0 && <div className="text-sm text-muted-foreground">No spend below break-even. Every campaign is profitable.</div>}
      </CardContent>
    </Card>
  );
}
