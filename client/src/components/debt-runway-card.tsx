/**
 * DebtRunwayCard — when the Shopify Capital 17% skim ends. Projects the advance
 * balance to $0 from the live Shopify sales pace and shows the payoff date plus
 * the paydown curve. The revolving Shopify Credit line is shown separately (it
 * has no auto-payoff — it only shrinks from surplus).
 */
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarCheck, Banknote } from "lucide-react";

interface RunwayMonth { month: number; year: number; label: string; projShopifySales: number; remittance: number; balanceAfter: number }
interface DebtRunway {
  rate: number;
  totalCapital: number;
  capitalLines: { name: string; balance: number }[];
  totalCredit: number;
  creditLines: { name: string; balance: number }[];
  monthlyShopify: number;
  monthlyRemittanceNow: number;
  payoff: { label: string; year: number; monthsAway: number } | null;
  schedule: RunwayMonth[];
}

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();
const moneyK = (n: number) => "$" + Math.round((n || 0) / 1000) + "K";

export function DebtRunwayCard() {
  const { data, isLoading } = useQuery<DebtRunway>({ queryKey: ["/api/finances/debt-runway"] });
  if (isLoading || !data) return null;
  if (data.totalCapital <= 0 && data.totalCredit <= 0) return null;

  // Chart: start at today's balance, then each projected month.
  const chartData = [{ label: "Now", balance: data.totalCapital }, ...data.schedule.map((m) => ({ label: `${m.label}${m.year !== new Date().getFullYear() ? " '" + String(m.year).slice(2) : ""}`, balance: m.balanceAfter }))];

  return (
    <Card data-testid="card-debt-runway">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-4 w-4" /> Debt runway — Shopify Capital</CardTitle>
        <CardDescription>
          The {Math.round(data.rate * 100)}% sales remittance pays this down automatically. Projected from your live Shopify sales pace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span><span className="text-muted-foreground">Balance </span><span className="font-semibold">{money(data.totalCapital)}</span></span>
          <span><span className="text-muted-foreground">~{Math.round(data.rate * 100)}% of sales/mo </span><span className="font-semibold">{money(data.monthlyRemittanceNow)}</span></span>
          {data.payoff && (
            <span className="ml-auto flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
              <CalendarCheck className="h-3.5 w-3.5" />
              Paid off <span className="font-semibold">{data.payoff.label} {data.payoff.year}</span>
              <span className="text-muted-foreground">({data.payoff.monthsAway} mo)</span>
            </span>
          )}
        </div>

        <div className="h-40 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
              <defs>
                <linearGradient id="runwayFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval={0} minTickGap={2} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={40} tickFormatter={moneyK} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [money(v), "Balance"]} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="balance" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#runwayFill)" dot={{ r: 2 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {data.totalCredit > 0 && (
          <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
            <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-muted-foreground">
              Shopify Credit <span className="font-semibold text-foreground">{money(data.totalCredit)}</span> is revolving — no auto-payoff. It only pays down from surplus (a profitable month), so it has no fixed date.
            </p>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Projected at {Math.round(data.rate * 100)}% of a ~{money(data.monthlyShopify)}/mo Shopify run-rate, seasonally adjusted. Updates as sales land; confirm the exact remittance rate against your advance agreement.
        </p>
      </CardContent>
    </Card>
  );
}
