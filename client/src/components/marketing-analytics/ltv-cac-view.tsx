import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, TrendingUp, AlertTriangle } from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n: number | null | undefined) => n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
const ratio = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(1)}x`;

interface CohortRow {
  year: number; month: number; label: string;
  newCustomers: number; avgLtv: number; avgOrders: number; cohortRevenue: number;
  adSpend: number; spendSource: string; cac: number | null; ltvCacRatio: number | null;
}
interface LtvCacData {
  series: CohortRow[];
  summary: {
    totalNewCustomers: number; totalAdSpend: number;
    blendedCac: number | null; blendedLtv: number | null;
    blendedRatio: number | null; healthy: boolean | null;
  };
}

export function LtvCacView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<LtvCacData>({ queryKey: ['/api/marketing-analytics/cmo/ltv-cac'] });

  const sync = useMutation({
    mutationFn: async () => {
      const r = await apiRequest('POST', '/api/marketing-analytics/cmo/windsor/sync', { days: 90 });
      return r.json();
    },
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ['/api/marketing-analytics/cmo/ltv-cac'] });
      if (d.rowsUpserted > 0) {
        toast({ title: `Windsor sync complete`, description: `${d.rowsUpserted} rows across ${Object.keys(d.platforms || {}).join(', ') || 'no platforms'}` });
      } else {
        toast({ title: 'Windsor sync', description: (d.errors?.[0]) || 'No rows returned. Check the Windsor API key.', variant: 'destructive' });
      }
    },
    onError: (e: any) => toast({ title: 'Windsor sync failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  const s = data?.summary;
  const series = data?.series ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          LTV by acquisition cohort vs blended CAC. Ad spend pulled live via Windsor, with QuickBooks fallback for pre-connection months.
        </p>
        <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />} Sync Windsor
        </Button>
      </div>

      {/* Blended summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground">New customers</div>
          <div className="text-2xl font-semibold">{(s?.totalNewCustomers ?? 0).toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground">Blended CAC</div>
          <div className="text-2xl font-semibold">{fmt(s?.blendedCac)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground">Blended LTV</div>
          <div className="text-2xl font-semibold">{fmt(s?.blendedLtv)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">LTV:CAC {s?.healthy === false && <AlertTriangle className="h-3 w-3 text-red-500" />}</div>
          <div className={`text-2xl font-semibold ${s?.healthy === false ? 'text-red-600' : s?.healthy ? 'text-green-600' : ''}`}>{ratio(s?.blendedRatio)}</div>
          <div className="text-[10px] text-muted-foreground">healthy ≥ 3x</div>
        </CardContent></Card>
      </div>

      {!series.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground space-y-1">
          <p>No cohort data yet.</p>
          <p className="text-xs">Connect platforms in Windsor and hit Sync, or wait for the nightly sync.</p>
        </CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" /> LTV vs CAC by Cohort Month</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={Math.max(0, Math.floor(series.length / 12))} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={v => `${v}x`} />
                  <Tooltip formatter={(v: number, name: string) => name === 'LTV:CAC' ? `${v?.toFixed?.(1)}x` : fmt(v)} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="avgLtv" fill="#10b981" name="Avg LTV" />
                  <Bar yAxisId="left" dataKey="cac" fill="#ef4444" name="CAC" />
                  <Line yAxisId="right" type="monotone" dataKey="ltvCacRatio" stroke="#8b5cf6" strokeWidth={2} dot={false} name="LTV:CAC" />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Cohort Detail</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Cohort</TableHead>
                  <TableHead className="text-right">New Cust.</TableHead>
                  <TableHead className="text-right">Avg LTV</TableHead>
                  <TableHead className="text-right">Avg Orders</TableHead>
                  <TableHead className="text-right">Ad Spend</TableHead>
                  <TableHead className="text-right">CAC</TableHead>
                  <TableHead className="text-right">LTV:CAC</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {series.slice().reverse().map(r => (
                    <TableRow key={`${r.year}-${r.month}`}>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell className="text-right">{r.newCustomers}</TableCell>
                      <TableCell className="text-right">{fmt(r.avgLtv)}</TableCell>
                      <TableCell className="text-right">{r.avgOrders?.toFixed(1)}</TableCell>
                      <TableCell className="text-right">{fmt(r.adSpend)} {r.spendSource === 'historical' && <span className="text-[10px] text-muted-foreground">(QB)</span>}</TableCell>
                      <TableCell className="text-right">{fmt(r.cac)}</TableCell>
                      <TableCell className="text-right">
                        {r.ltvCacRatio != null
                          ? <Badge variant={r.ltvCacRatio >= 3 ? 'default' : 'destructive'} className="text-xs">{ratio(r.ltvCacRatio)}</Badge>
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
