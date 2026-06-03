import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n: number | null | undefined) => n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(0)}%`;

interface BomItem {
  sku: string; name: string; price: number;
  componentCount: number; missingCostCount: number;
  cogs: number | null; missingComponents: string[]; adSpend: number;
  status: 'complete' | 'missing_costs' | 'no_bom';
}
interface BomData {
  summary: { total: number; complete: number; missingCosts: number; noBom: number; completePct: number | null; spendOnEstimated: number };
  items: BomItem[];
}

const STATUS = {
  complete: { label: 'Complete', icon: CheckCircle2, cls: 'text-green-700', variant: 'default' as const },
  missing_costs: { label: 'Missing costs', icon: AlertTriangle, cls: 'text-amber-700', variant: 'outline' as const },
  no_bom: { label: 'No BOM', icon: XCircle, cls: 'text-red-700', variant: 'destructive' as const },
};

export function BomCompletenessView({ days }: { days: number }) {
  const { data, isLoading } = useQuery<BomData>({
    queryKey: ['/api/marketing-analytics/cmo/bom-completeness', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/bom-completeness?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data?.items?.length) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No finished products with a selling price found.</CardContent></Card>;
  }

  const s = data.summary;
  // Show incomplete first (the actionable ones), then complete.
  const items = [...data.items].sort((a, b) => {
    const order = { no_bom: 0, missing_costs: 1, complete: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return b.adSpend - a.adSpend;
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground">BOM Coverage</div>
          <div className="text-2xl font-semibold">{pct(s.completePct)}</div>
          <div className="text-[11px] text-muted-foreground">{s.complete} of {s.total} products complete</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Missing Costs</div>
          <div className="text-2xl font-semibold">{s.missingCosts}</div>
          <div className="text-[11px] text-muted-foreground">have a BOM but no component cost</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-red-600" /> No BOM</div>
          <div className="text-2xl font-semibold">{s.noBom}</div>
          <div className="text-[11px] text-muted-foreground">no recipe entered yet</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground">Spend on Estimated COGS</div>
          <div className="text-2xl font-semibold text-amber-600">{fmt(s.spendOnEstimated)}</div>
          <div className="text-[11px] text-muted-foreground">break-even ROAS is a guess here</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">BOM Completeness by Product</CardTitle>
          <p className="text-xs text-muted-foreground">Fill in component costs for the high-spend products first — that's where break-even ROAS accuracy pays off most. Until then those SKUs use an estimated 60% margin.</p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Ad Spend ({days}d)</TableHead>
              <TableHead className="text-right">Components</TableHead>
              <TableHead className="text-right">COGS</TableHead>
              <TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {items.map(item => {
                const st = STATUS[item.status];
                const Icon = st.icon;
                return (
                  <TableRow key={item.sku}>
                    <TableCell>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.sku}</div>
                      {item.missingComponents.length > 0 && (
                        <div className="text-[11px] text-amber-700 mt-0.5">missing: {item.missingComponents.slice(0, 4).join(', ')}{item.missingComponents.length > 4 ? '…' : ''}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{fmt(item.price)}</TableCell>
                    <TableCell className="text-right">{item.adSpend > 0 ? fmt(item.adSpend) : '—'}</TableCell>
                    <TableCell className="text-right">{item.componentCount > 0 ? `${item.componentCount - item.missingCostCount}/${item.componentCount}` : '—'}</TableCell>
                    <TableCell className="text-right">{fmt(item.cogs)}</TableCell>
                    <TableCell>
                      <Badge variant={st.variant} className="text-xs"><Icon className="h-3 w-3 mr-1" />{st.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
