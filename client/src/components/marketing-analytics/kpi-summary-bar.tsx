import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { DollarSign, TrendingUp, Target, Users, Loader2 } from 'lucide-react';
import type { KPIData } from './types';

const fmt = (n: number | null) => n != null ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : 'N/A';

export function KPISummaryBar() {
  const { data, isLoading } = useQuery<KPIData>({
    queryKey: ['/api/marketing-analytics/kpis'],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const kpis = [
    { label: 'Ad Spend (30d)', value: fmt(data?.mtd_spend ?? null), icon: DollarSign, color: 'text-red-600' },
    { label: 'Revenue (30d)', value: fmt(data?.mtd_revenue ?? null), icon: TrendingUp, color: 'text-green-600' },
    { label: 'Media ROAS (ads)', value: data?.blended_roas ? `${data.blended_roas.toFixed(1)}x` : 'N/A', icon: Target, color: 'text-violet-600' },
    { label: 'Orders (30d)', value: data?.total_conversions?.toLocaleString() ?? '0', icon: Users, color: 'text-blue-600' },
    { label: 'Cost / Order', value: data?.avg_cpa ? `$${data.avg_cpa.toFixed(2)}` : 'N/A', icon: DollarSign, color: 'text-amber-600' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {kpis.map((k) => (
        <Card key={k.label}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <k.icon className={`h-3.5 w-3.5 ${k.color}`} />
              {k.label}
            </div>
            <div className="text-xl font-semibold">{k.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
