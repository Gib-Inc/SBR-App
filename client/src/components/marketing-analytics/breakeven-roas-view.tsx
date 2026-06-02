import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { BreakevenProduct } from './types';

const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function BreakevenRoasView({ days }: { days: number }) {
  const { data, isLoading } = useQuery<{ products: BreakevenProduct[] }>({
    queryKey: ['/api/marketing-analytics/cmo/breakeven-roas', { days }],
    queryFn: async () => {
      const res = await fetch(`/api/marketing-analytics/cmo/breakeven-roas?days=${days}`, { credentials: 'include' });
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data?.products || data.products.length === 0) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No products with pricing found.</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Break-even ROAS by Product</CardTitle>
        <p className="text-xs text-muted-foreground">Minimum ROAS to be profitable after cost of goods. Below break-even = losing money on ads.</p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">COGS</TableHead>
              <TableHead className="text-right">Break-even</TableHead>
              <TableHead className="text-right">Actual ROAS</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.products.map((p) => (
              <TableRow key={p.sku}>
                <TableCell>
                  <div className="font-medium">{p.name || p.sku}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.sku}
                    {p.costSource === 'estimated' && <Badge variant="outline" className="ml-1 text-xs">est. cost</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right">{fmt(p.price)}</TableCell>
                <TableCell className="text-right">{fmt(p.cogs)}</TableCell>
                <TableCell className="text-right">{p.breakevenRoas ? `${p.breakevenRoas.toFixed(1)}x` : 'N/A'}</TableCell>
                <TableCell className="text-right">{p.actualRoas != null ? `${p.actualRoas.toFixed(1)}x` : '—'}</TableCell>
                <TableCell>
                  {p.actualRoas == null ? <span className="text-xs text-muted-foreground">no ad data</span>
                    : p.belowBreakeven ? <Badge variant="destructive">Losing money</Badge>
                    : <Badge className="bg-green-600">Profitable</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
