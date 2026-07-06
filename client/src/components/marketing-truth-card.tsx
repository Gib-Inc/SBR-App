import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target, AlertTriangle, ShieldAlert } from "lucide-react";

/**
 * Marketing Truth — the front-and-center number the business steers by
 * (finance audit §3/§5). Blended MER + Contribution MER vs their breakevens,
 * composed server-side from the canonical engines — never per-channel pixel
 * ROAS, never raw ad feeds.
 *
 * HONESTY RULE: when any input is shaky the card SAYS SO instead of rendering
 * a confident number — "unreliable" hides the verdict entirely and names the
 * broken feed; "directional" shows the number with an amber warning. A precise
 * ROAS on a broken denominator is the failure this card exists to kill.
 */

interface Truth {
  blendedMer: number | null;
  merBreakevenMeasured: number | null;
  merBreakevenStatic: number;
  merVerdict: "above" | "below" | "unavailable";
  contributionMer: number | null;
  contributionVerdict: "above" | "below" | "unavailable";
  contributionMarginPct: number | null;
  headline: string | null;
  netRevenue30d: number;
  marketingSpend30d: number | null;
  marginNotes: string[];
  confidence: "high" | "directional" | "unreliable";
  confidenceReasons: string[];
  governorGate: { gatesAt: number; measuredBreakeven: number | null; aligned: boolean };
}

const money = (v: number | null | undefined) =>
  v == null ? "—" : `$${Math.round(v).toLocaleString()}`;

function MetricBlock(props: {
  label: string;
  value: number | null;
  breakevenLine: string;
  verdict: "above" | "below" | "unavailable";
  sub: string;
}) {
  const color =
    props.verdict === "above" ? "text-green-600" :
    props.verdict === "below" ? "text-red-600" : "text-muted-foreground";
  return (
    <div className="flex-1 min-w-[200px]">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{props.label}</div>
      <div className={`text-4xl font-bold tabular-nums ${color}`}>
        {props.value == null ? "—" : `${props.value.toFixed(2)}×`}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{props.breakevenLine}</div>
      <div className="text-xs text-muted-foreground">{props.sub}</div>
    </div>
  );
}

export function MarketingTruthCard() {
  const { data, isLoading, isError } = useQuery<{ success: boolean; truth: Truth }>({
    queryKey: ["/api/marketing-truth"],
    refetchInterval: 5 * 60 * 1000,
  });

  const t = data?.truth;

  return (
    <Card data-testid="marketing-truth-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Marketing Truth — blended, trailing 30d
          </span>
          {t && (
            <Badge
              variant={t.confidence === "high" ? "default" : t.confidence === "directional" ? "secondary" : "destructive"}
            >
              {t.confidence === "high" ? "confident" : t.confidence}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <div className="text-sm text-muted-foreground">Computing from canonical engines…</div>}

        {isError && (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">Couldn't compute marketing truth</span> — the endpoint
              errored. A truth tile that fails silently is a lie by omission; treat the number as
              unknown until this loads.
            </div>
          </div>
        )}

        {t && t.confidence === "unreliable" && (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Number withheld — an input can't be trusted right now</div>
              <ul className="list-disc ml-4 mt-1">
                {t.confidenceReasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          </div>
        )}

        {t && t.confidence !== "unreliable" && (
          <>
            <div className="flex flex-wrap gap-6">
              <MetricBlock
                label="Blended MER (revenue)"
                value={t.blendedMer}
                breakevenLine={`breakeven ${t.merBreakevenMeasured != null ? `${t.merBreakevenMeasured.toFixed(2)}× (measured)` : "unmeasured"} · ${t.merBreakevenStatic}× house rule`}
                verdict={t.merVerdict}
                sub={`${money(t.netRevenue30d)} revenue ÷ ${money(t.marketingSpend30d)} total marketing`}
              />
              <MetricBlock
                label="Contribution MER (profit)"
                value={t.contributionMer}
                breakevenLine="breakeven 1.00× — below this, marketing buys revenue at a loss"
                verdict={t.contributionVerdict}
                sub={`margin ${t.contributionMarginPct != null ? `${(t.contributionMarginPct * 100).toFixed(1)}%` : "—"} after COGS · fees · freight`}
              />
            </div>

            {t.headline && <div className="text-sm font-medium">{t.headline}</div>}

            {t.confidence === "directional" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <ul className="list-disc ml-4">
                  {t.confidenceReasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}

            <div className="text-[11px] text-muted-foreground space-y-0.5">
              {t.marginNotes.map((n, i) => <div key={i}>· {n}</div>)}
              {!t.governorGate.aligned && (
                <div>
                  · scale authorization still gates at {t.governorGate.gatesAt}× (conservative house rule)
                  {t.governorGate.measuredBreakeven != null &&
                    ` vs the measured ${t.governorGate.measuredBreakeven.toFixed(2)}× breakeven — aligning it is an operator decision`}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
