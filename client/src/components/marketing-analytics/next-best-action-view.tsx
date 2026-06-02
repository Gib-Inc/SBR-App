import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, RefreshCw } from 'lucide-react';
import type { Recommendation } from './types';

export function NextBestActionView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const { data, isLoading } = useQuery<{ recommendations: Recommendation[] | null; generatedAt: string | null }>({
    queryKey: ['/api/marketing-analytics/cmo/next-best-action'],
  });

  const refresh = useMutation({
    mutationFn: async () => {
      setGenerating(true);
      const res = await apiRequest('POST', '/api/marketing-analytics/cmo/next-best-action/refresh', { force: true });
      return res.json();
    },
    onSuccess: (d) => {
      setGenerating(false);
      queryClient.invalidateQueries({ queryKey: ['/api/marketing-analytics/cmo/next-best-action'] });
      if (d.error) toast({ title: 'Could not generate', description: d.error, variant: 'destructive' });
      else toast({ title: 'Recommendations updated' });
    },
    onError: (e: any) => { setGenerating(false); toast({ title: 'Error', description: e.message, variant: 'destructive' }); },
  });

  const recs = data?.recommendations;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-600" /> Next Best Actions</CardTitle>
          <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Generate
          </Button>
        </div>
        {data?.generatedAt && <p className="text-xs text-muted-foreground">Updated {new Date(data.generatedAt).toLocaleDateString()}</p>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !recs || recs.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No recommendations yet. Click Generate to have Claude analyze your data and rank the next moves.
          </div>
        ) : (
          <div className="space-y-3">
            {recs.map((r) => (
              <div key={r.rank} className="border rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="shrink-0">{r.rank}</Badge>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{r.title}</div>
                    <p className="text-sm text-muted-foreground mt-1">{r.rationale}</p>
                    <p className="text-sm mt-1">{r.action}</p>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="secondary" className="text-xs">{r.expectedImpact}</Badge>
                      <Badge variant="outline" className="text-xs">→ {r.owner}</Badge>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
