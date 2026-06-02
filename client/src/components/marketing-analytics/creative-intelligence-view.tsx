import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface FrameworkData {
  framework: string;
  avg_roas: number;
  avg_ctr: number;
  sample_size: number;
  total_spend: number;
  total_revenue: number;
}

interface CreativeData {
  byFramework: FrameworkData[];
  byAvatar: Array<{ avatar: string; avg_roas: number; avg_ctr: number; sample_size: number }>;
  killScale: Array<{ id: string; headline: string; body: string; channel: string; framework: string; roas: number; ctr: number; spend: number; performance_score: number }>;
  roots: Array<{ framework: string; channel: string; avg_roas: number; avg_ctr: number; insight: string; sample_size: number }>;
}

export function CreativeIntelligenceView({ days }: { days: number }) {
  const { data, isLoading } = useQuery<CreativeData>({
    queryKey: ['/api/marketing-analytics/creative-intelligence', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/creative-intelligence?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data || (!data.byFramework?.length && !data.killScale?.length)) {
    return (
      <Card><CardContent className="py-12 text-center text-muted-foreground">
        No creative data yet. Log copy in the copy_assets table and link performance data to see intelligence.
      </CardContent></Card>
    );
  }

  const killList = data.killScale.filter(c => c.roas < 1 && c.spend > 50);
  const scaleList = data.killScale.filter(c => c.roas >= 3 && c.ctr >= 0.01);

  return (
    <div className="space-y-4">
      {data.byFramework?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">ROAS by Framework</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.byFramework}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="framework" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `${v.toFixed(1)}x`} />
                <Bar dataKey="avg_roas" fill="#8b5cf6" name="Avg ROAS" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-green-700">Scale These ({scaleList.length})</CardTitle></CardHeader>
          <CardContent>
            {scaleList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No creatives meeting scale criteria (ROAS 3x+ and CTR 1%+)</p>
            ) : scaleList.slice(0, 5).map(c => (
              <div key={c.id} className="py-2 border-b last:border-0">
                <div className="font-medium text-sm">{c.headline || c.body?.substring(0, 60)}</div>
                <div className="flex gap-2 mt-1">
                  <Badge variant="outline" className="text-green-700">{c.roas.toFixed(1)}x ROAS</Badge>
                  <Badge variant="outline">{(c.ctr * 100).toFixed(1)}% CTR</Badge>
                  <Badge variant="outline">{c.channel}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-red-700">Kill These ({killList.length})</CardTitle></CardHeader>
          <CardContent>
            {killList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No creatives flagged for kill (ROAS below 1x with $50+ spend)</p>
            ) : killList.slice(0, 5).map(c => (
              <div key={c.id} className="py-2 border-b last:border-0">
                <div className="font-medium text-sm">{c.headline || c.body?.substring(0, 60)}</div>
                <div className="flex gap-2 mt-1">
                  <Badge variant="destructive">{c.roas.toFixed(1)}x ROAS</Badge>
                  <Badge variant="outline">${c.spend.toFixed(0)} spent</Badge>
                  <Badge variant="outline">{c.channel}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {data.roots.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Pattern Insights (copy_roots)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.roots.filter(r => r.insight).map((r, i) => (
                <div key={i} className="text-sm bg-muted/50 rounded-lg p-3">
                  <div className="flex gap-2 mb-1">
                    <Badge variant="outline">{r.framework}</Badge>
                    <Badge variant="outline">{r.channel}</Badge>
                    <Badge variant="outline">{r.avg_roas.toFixed(1)}x ROAS</Badge>
                    <Badge variant="outline">{r.sample_size} samples</Badge>
                  </div>
                  <p className="text-muted-foreground">{r.insight}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
