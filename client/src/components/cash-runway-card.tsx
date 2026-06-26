import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Gauge, AlertTriangle, RotateCcw } from "lucide-react";

/**
 * CIPH.R Phase 2 — Cash Runway & Scenarios card.
 * Shows runway days across Conservative (90d) / Realistic (30d) / Aggressive (7d)
 * horizons and lets Roger drag What-If sliders (+/-% ad spend, +/-% sales
 * velocity) to recompute cash-out dates in real time, client-side, from the
 * per-scenario inputs the API returns.
 * ANTI-HALLUCINATION: a scenario missing inputs shows "RUNWAY GAPPED: Missing …"
 * rather than a fabricated number.
 */

interface ScenarioInputs {
  cashOnHand: number | null;
  dailyFixedOverhead: number | null;
  dailyAdSpend: number | null;
  dailyMarginContribution: number | null;
}
type ScenarioKey = "conservative" | "realistic" | "aggressive";
interface RunwayResponse {
  success: boolean;
  forecast?: { status: string; dataGaps: string[]; netMarginAverage: number | null };
  scenarioInputs?: Record<ScenarioKey, ScenarioInputs>;
}

const REQUIRED: Array<[keyof ScenarioInputs, string]> = [
  ["cashOnHand", "Cash on Hand"],
  ["dailyFixedOverhead", "Fixed Overhead"],
  ["dailyAdSpend", "Variable Ad Spend"],
  ["dailyMarginContribution", "Sales Velocity x Net Margin"],
];

interface ScenarioCalc {
  days: number | null;
  cashFlowPositive: boolean;
  gaps: string[];
}

/** Client-side mirror of the runway engine, with What-If variance applied. */
function calcScenario(s: ScenarioInputs | undefined, adPct: number, velPct: number): ScenarioCalc {
  if (!s) return { days: null, cashFlowPositive: false, gaps: ["no data"] };
  const gaps = REQUIRED.filter(([k]) => s[k] == null || Number.isNaN(Number(s[k]))).map(([, label]) => label);
  if (gaps.length) return { days: null, cashFlowPositive: false, gaps };
  const adSpend = (s.dailyAdSpend as number) * (1 + adPct / 100);
  const margin = (s.dailyMarginContribution as number) * (1 + velPct / 100);
  const burn = (s.dailyFixedOverhead as number) + adSpend - margin;
  if (burn <= 0) return { days: null, cashFlowPositive: true, gaps: [] };
  return { days: Math.floor((s.cashOnHand as number) / burn), cashFlowPositive: false, gaps: [] };
}

const SCENARIOS: Array<{ key: ScenarioKey; label: string; sub: string }> = [
  { key: "conservative", label: "Conservative", sub: "90-day avg" },
  { key: "realistic", label: "Realistic", sub: "30-day trend" },
  { key: "aggressive", label: "Aggressive", sub: "7-day trend" },
];

function ScenarioColumn({ label, sub, calc }: { label: string; sub: string; calc: ScenarioCalc }) {
  let display: string;
  let tone = "text-foreground";
  if (calc.gaps.length) {
    display = "GAPPED";
    tone = "text-amber-600 dark:text-amber-400";
  } else if (calc.cashFlowPositive) {
    display = "Cash-flow +";
    tone = "text-green-600 dark:text-green-400";
  } else {
    display = `${calc.days}d`;
    if (calc.days != null && calc.days < 60) tone = "text-red-600 dark:text-red-400";
    else if (calc.days != null && calc.days < 120) tone = "text-amber-600 dark:text-amber-400";
    else tone = "text-green-600 dark:text-green-400";
  }
  return (
    <div className="flex-1 text-center" data-testid={`runway-scenario-${label.toLowerCase()}`}>
      <div className={`text-2xl font-bold tabular-nums ${tone}`}>{display}</div>
      <div className="text-xs font-medium">{label}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
      {calc.days != null && !calc.cashFlowPositive && (
        <div className="text-[11px] text-muted-foreground">~{(calc.days / 30).toFixed(1)} mo</div>
      )}
    </div>
  );
}

export function CashRunwayCard() {
  const { data, isLoading } = useQuery<RunwayResponse>({ queryKey: ["/api/ciphr/runway"] });
  const [adPct, setAdPct] = useState(0);
  const [velPct, setVelPct] = useState(0);

  const inputs = data?.scenarioInputs;
  const gapped = data?.forecast?.status === "CALCULATION_GAPPED";
  const calcs = useMemo(
    () => ({
      conservative: calcScenario(inputs?.conservative, adPct, velPct),
      realistic: calcScenario(inputs?.realistic, adPct, velPct),
      aggressive: calcScenario(inputs?.aggressive, adPct, velPct),
    }),
    [inputs, adPct, velPct],
  );

  const hasInputs = !!inputs;
  const dirty = adPct !== 0 || velPct !== 0;

  return (
    <Card data-testid="card-cash-runway">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Cash Runway &amp; Scenarios
        </CardTitle>
        {(() => {
          const st = data?.forecast?.status;
          if (st === "CRITICAL")
            return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" data-testid="badge-runway-status">CRITICAL</Badge>;
          if (st === "WARNING")
            return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid="badge-runway-status">WARNING</Badge>;
          if (gapped)
            return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid="badge-runway-gapped">CALCULATION GAPPED</Badge>;
          return null;
        })()}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !hasInputs ? (
          <p className="text-sm text-muted-foreground" data-testid="text-runway-empty">
            No runway yet. Capture a financial snapshot (Financial Position card) once QuickBooks is connected.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-stretch gap-2">
              {SCENARIOS.map((s) => (
                <ScenarioColumn key={s.key} label={s.label} sub={s.sub} calc={calcs[s.key]} />
              ))}
            </div>

            {gapped && (
              <div className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1" data-testid="text-runway-gaps">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>RUNWAY GAPPED: Missing {(data?.forecast?.dataGaps ?? []).join("; ") || "required inputs"}</span>
              </div>
            )}

            <div className="space-y-3 pt-1 border-t">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">What-If</span>
                {dirty && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      setAdPct(0);
                      setVelPct(0);
                    }}
                    data-testid="button-runway-reset"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" /> Reset
                  </Button>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span>Ad Spend</span>
                  <span className="tabular-nums font-medium">{adPct > 0 ? "+" : ""}{adPct}%</span>
                </div>
                <Slider
                  value={[adPct]}
                  onValueChange={([v]) => setAdPct(v)}
                  min={-50}
                  max={50}
                  step={5}
                  data-testid="slider-ad-spend"
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span>Sales Velocity</span>
                  <span className="tabular-nums font-medium">{velPct > 0 ? "+" : ""}{velPct}%</span>
                </div>
                <Slider
                  value={[velPct]}
                  onValueChange={([v]) => setVelPct(v)}
                  min={-50}
                  max={50}
                  step={5}
                  data-testid="slider-velocity"
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
