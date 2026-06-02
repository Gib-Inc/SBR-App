import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, UserPlus, Repeat } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { CustomerSplit } from './types';

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function CustomerSplitView({ days }: { days: number }) {
  const { data, isLoading } = useQuery<CustomerSplit>({
    queryKey: ['/api/marketing-analytics/cmo/customer-split', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/customer-split?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data?.split || data.split.length === 0) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No customer data yet.</CardContent></Card>;
  }

  const newC = data.split.find(s => s.customer_type === 'new');
  const retC = data.split.find(s => s.customer_type === 'returning');
  const totalRev = data.split.reduce((s, x) => s + x.revenue, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><UserPlus className="h-3.5 w-3.5" /> New Customers</div>
            <div className="text-2xl font-semibold">{fmt(newC?.revenue || 0)}</div>
            <div className="text-xs text-muted-foreground">{newC?.orders || 0} orders · {fmt(newC?.aov || 0)} AOV · {totalRev > 0 ? Math.round((newC?.revenue || 0) / totalRev * 100) : 0}% of revenue</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Repeat className="h-3.5 w-3.5" /> Returning Customers</div>
            <div className="text-2xl font-semibold">{fmt(retC?.revenue || 0)}</div>
            <div className="text-xs text-muted-foreground">{retC?.orders || 0} orders · {fmt(retC?.aov || 0)} AOV · {totalRev > 0 ? Math.round((retC?.revenue || 0) / totalRev * 100) : 0}% of revenue</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Average Order Value by Channel</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.byChannel}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey="aov" fill="#3b82f6" name="AOV" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
