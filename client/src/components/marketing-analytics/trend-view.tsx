import { useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, TrendingDown, Minus, Megaphone, Layers, UploadCloud, Loader2 } from "lucide-react";

/**
 * TrendView — "are things getting better, month over month?" Channel and campaign
 * ROAS/spend with a delta vs the prior month and the 8x target. ROAS is platform-
 * attributed (directional), so it answers "improving or decaying," not true profit.
 */

interface TrendPoint {
  month: string; spend: number; revenue: number | null; purchases: number | null;
  roas: number | null; cac: number | null;
  roasDelta: number | null; spendDelta: number | null; dir: "up" | "down" | "flat";
}
interface ChannelTrend { platform: string; points: TrendPoint[]; }
interface CampaignTrend { platform: string; campaign: string; points: TrendPoint[]; latestRoas: number | null; }
interface Resp { success: boolean; target: number; months: string[]; channels: ChannelTrend[]; campaigns: CampaignTrend[]; }

const fmtMonth = (m: string) => {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};
const money = (n: number) => (n >= 1000 ? "$" + (n / 1000).toFixed(1) + "K" : "$" + Math.round(n));
const roasColor = (r: number | null, target: number) => {
  if (r == null) return "text-muted-foreground";
  if (r >= target) return "text-green-600 dark:text-green-400";
  if (r >= 5) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
};

function DirArrow({ dir, delta }: { dir: TrendPoint["dir"]; delta: number | null }) {
  if (delta == null) return null;
  if (dir === "up") return <span className="inline-flex items-center text-green-600 dark:text-green-400" title={`+${delta} vs prior`}><TrendingUp className="h-3 w-3" /></span>;
  if (dir === "down") return <span className="inline-flex items-center text-red-600 dark:text-red-400" title={`${delta} vs prior`}><TrendingDown className="h-3 w-3" /></span>;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

function Cell({ p, target }: { p: TrendPoint | undefined; target: number }) {
  if (!p) return <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">·</td>;
  return (
    <td className="px-2 py-1.5 text-center align-middle">
      {p.roas != null ? (
        <div className={`inline-flex items-center gap-1 font-semibold ${roasColor(p.roas, target)}`}>
          {p.roas.toFixed(2)}× <DirArrow dir={p.dir} delta={p.roasDelta} />
        </div>
      ) : (
        <div className="text-xs text-muted-foreground" title="No revenue recorded for this month (spend-only)">spend only</div>
      )}
      <div className="text-[10px] text-muted-foreground">{money(p.spend)}{p.cac != null ? ` · $${Math.round(p.cac)} CAC` : ""}</div>
    </td>
  );
}

function TrendTable({ months, rows, target, label }: { months: string[]; rows: Array<{ name: string; sub?: string; byMonth: Map<string, TrendPoint> }>; target: number; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">{label}</th>
            {months.map((m) => <th key={m} className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">{fmtMonth(m)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b last:border-0">
              <td className="px-2 py-1.5">
                <div className="font-medium truncate max-w-[220px]">{r.name}</div>
                {r.sub && <div className="text-[10px] text-muted-foreground">{r.sub}</div>}
              </td>
              {months.map((m) => <Cell key={m} p={r.byMonth.get(m)} target={target} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UploadCampaignsButton() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const ingest = useMutation({
    mutationFn: async (csv: string) => {
      const res = await fetch("/api/marketing/campaign-month/ingest", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ csv, fileName: "campaigns.csv" }),
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      if (r?.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/marketing/trend"] });
        toast({ title: `Added ${r.campaigns} campaigns for ${r.month}`, description: `$${Math.round(r.totalSpend).toLocaleString()} spend ingested into the trend.` });
      } else {
        toast({ title: "Couldn't read that file", description: r?.error || "Make sure it's a Meta campaigns export.", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });
  return (
    <>
      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then((txt) => ingest.mutate(txt)); e.target.value = ""; }}
        data-testid="input-campaigns-csv" />
      <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={ingest.isPending} data-testid="button-upload-campaigns">
        {ingest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
        Add monthly campaigns CSV
      </Button>
    </>
  );
}

export function TrendView() {
  const { data, isLoading } = useQuery<Resp>({ queryKey: ["/api/marketing/trend"] });
  if (isLoading) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Loading trend…</CardContent></Card>;
  if (!data || (data.channels.length === 0 && data.campaigns.length === 0)) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No trend data yet. Upload a monthly ad report to start the trend.</CardContent></Card>;
  }
  const months = data.months;

  const channelRows = data.channels.map((c) => ({
    name: c.platform,
    byMonth: new Map(c.points.map((p) => [p.month, p])),
  }));
  const campaignRows = data.campaigns.map((c) => ({
    name: c.campaign,
    sub: c.platform,
    byMonth: new Map(c.points.map((p) => [p.month, p])),
  }));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" /> By channel — month over month</CardTitle>
          <p className="text-xs text-muted-foreground">ROAS with the change vs the prior month. Target is {data.target}× blended. Platform-attributed (directional, reconcile to QuickBooks for true profit).</p>
        </CardHeader>
        <CardContent>
          <TrendTable months={months} rows={channelRows} target={data.target} label="Channel" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Megaphone className="h-4 w-4" /> By campaign — month over month</CardTitle>
            <p className="text-xs text-muted-foreground">Which specific campaigns are climbing or fading. Campaign ROAS starts the month revenue was first uploaded; earlier months show spend only.</p>
          </div>
          <UploadCampaignsButton />
        </CardHeader>
        <CardContent>
          <TrendTable months={months} rows={campaignRows} target={data.target} label="Campaign" />
        </CardContent>
      </Card>
    </div>
  );
}
