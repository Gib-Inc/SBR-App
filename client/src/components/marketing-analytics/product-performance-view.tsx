import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, Package } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ProductData } from './types';

const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function ConflictBadge({ conflict }: { conflict: string | null }) {
  if (!conflict) return null;
  if (conflict === 'LOW_STOCK_HIGH_SPEND') {
    return <Badge variant="destructive" className="text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Low Stock + High Spend</Badge>;
  }
  return <Badge variant="outline" className="text-xs text-amber-700 border-amber-300"><Package className="h-3 w-3 mr-1" />High Stock, No Ads</Badge>;
}

export function ProductPerformanceView({ days }: { days: number }) {
  const { data, isLoading } = useQuery<{ products: ProductData[] }>({
    queryKey: ['/api/marketing-analytics/product-performance', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/product-performance?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data || !data.products || data.products.length === 0) {
    return (
      <Card><CardContent className="py-12 text-center text-muted-foreground">
        No product-level ad data yet. This view populates when ad platforms report SKU-level performance.
      </CardContent></Card>
    );
  }

  const conflicts = data.products.filter(p => p.conflict);

  return (
    <div className="space-y-4">
      {conflicts.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-4 pb-3">
            <div className="text-sm font-medium text-amber-800 mb-2">{conflicts.length} product{conflicts.length > 1 ? 's' : ''} flagged</div>
            <div className="space-y-1">
              {conflicts.map(p => (
                <div key={p.sku} className="flex items-center gap-2 text-sm">
                  <ConflictBadge conflict={p.conflict} />
                  <span>{p.name || p.sku}</span>
                  {p.days_of_stock != null && <span className="text-muted-foreground">({p.days_of_stock.toFixed(0)} days stock)</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Product Ad Performance</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">Conv.</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Days Left</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.products.map(p => (
                <TableRow key={p.sku}>
                  <TableCell>
                    <div className="font-medium">{p.name || p.sku}</div>
                    <div className="text-xs text-muted-foreground">{p.sku}</div>
                  </TableCell>
                  <TableCell className="text-right">{fmt(p.spend)}</TableCell>
                  <TableCell className="text-right">{fmt(p.revenue)}</TableCell>
                  <TableCell className="text-right">
                    {p.roas ? <Badge variant={p.roas >= 3 ? 'default' : p.roas >= 1 ? 'outline' : 'destructive'}>{p.roas.toFixed(1)}x</Badge> : 'N/A'}
                  </TableCell>
                  <TableCell className="text-right">{p.conversions}</TableCell>
                  <TableCell className="text-right">{p.available_qty ?? 'N/A'}</TableCell>
                  <TableCell className="text-right">{p.days_of_stock != null ? `${p.days_of_stock.toFixed(0)}d` : 'N/A'}</TableCell>
                  <TableCell><ConflictBadge conflict={p.conflict} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
