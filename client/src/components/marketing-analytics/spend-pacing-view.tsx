import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { SpendPacingData } from './types';

const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function SpendPacingView({ days }: { days: number }) {
  const { data, isLoading } = useQuery<SpendPacingData>({
    queryKey: ['/api/marketing-analytics/spend-pacing', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/spend-pacing?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data || !data.daily || data.daily.length === 0) {
    return (
      <Card><CardContent className="py-12 text-center text-muted-foreground">
        No ad spend data yet. Connect Google Ads or Meta Ads in Settings to start tracking.
      </CardContent></Card>
    );
  }

  const budgetCeiling = 7000;
  const overBudget = data.projectedMonthEnd > budgetCeiling;
  const ratio = data.spendRevenueRatio ? (data.spendRevenueRatio * 100).toFixed(1) : 'N/A';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">MTD Spend</div>
          <div className="text-2xl font-semibold">{fmt(data.mtdSpend)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">Projected Month-End</div>
          <div className={`text-2xl font-semibold ${overBudget ? 'text-red-600' : ''}`}>
            {fmt(data.projectedMonthEnd)}
            {overBudget && <AlertTriangle className="inline h-4 w-4 ml-1" />}
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">MTD Revenue (ads)</div>
          <div className="text-2xl font-semibold text-green-600">{fmt(data.mtdRevenue)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-1">Spend:Revenue Ratio</div>
          <div className="text-2xl font-semibold">{ratio}%</div>
          <Badge variant="outline" className="text-xs mt-1">Target: under 15%</Badge>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Daily Spend vs Revenue</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data.daily}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Area type="monotone" dataKey="revenue" fill="#10b981" fillOpacity={0.15} stroke="#10b981" name="Revenue" />
              <Area type="monotone" dataKey="spend" fill="#ef4444" fillOpacity={0.15} stroke="#ef4444" name="Spend" />
              <ReferenceLine y={budgetCeiling / 30} stroke="#f59e0b" strokeDasharray="5 5" label="Daily ceiling" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
