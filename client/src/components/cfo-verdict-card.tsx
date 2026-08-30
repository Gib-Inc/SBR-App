/**
 * CfoVerdictCard — the Daily CFO Verdict (Operation CFO, Build 1).
 *
 * Compact morning picture composed server-side from the canonical modules only
 * (/api/cfo/verdict). Every number renders WITH its provenance chip
 * (source · as-of · status) and every gap renders as a stated gap — never a 0.
 * The one action affordance (cash "tap to update") links to the EXISTING
 * bank-balance entry flow on /cash-out; nothing here writes anything.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Gauge, Wallet, Hourglass, Megaphone, Percent, Droplets, Boxes, ListChecks, ArrowRight, Scale,
} from "lucide-react";

type VerdictStatus = "ok" | "amber" | "red" | "gap";
interface Stamp<T = number> { value: T | null; source: string; asOf: string | null; status: VerdictStatus; note?: string }
interface FeedChip { feed: string; status: VerdictStatus; detail: string; latestPeriodEnd: string | null; daysOld: number | null }
interface LeakLine { platform: string; spendNoPurchase: number; windows: number; latestPeriodEnd: string | null }
interface InventoryRiskLine {
  sku: string; name: string; unitsSoldWindow: number; dailyVelocity: number; position: number;
  buckets: { pivotQty: number; hildaleQty: number; availableForSaleQty: number } | null;
  daysLeft: number | null; status: VerdictStatus; note?: string;
}
interface PushSignalLine extends InventoryRiskLine {
  frame: { sku: string; name: string; stock: number; onOrder: number } | null;
  framesOnOrder: number | null;
}
interface DecisionItem { kind: string; title: string; why: string; source: string; asOf: string | null }
interface CfoVerdict {
  generatedAt: string;
  overall: { status: VerdictStatus; headline: string };
  cash: Stamp<number> & { staleDays: number | null; updateHref: string };
  runway: Stamp<number> & { basis: string; burnRatePerDay: number | null; cashFlowPositive: boolean; debtServiceMonthly: number | null; debtBlindBalance: number | null };
  mer: Stamp<number> & { gate: number; measuredBreakeven: number | null; contributionMer: number | null; confidence: string; confidenceReasons: string[]; feeds: FeedChip[] };
  contribution: Stamp<number> & { marginPctDisplay: string | null; cogsPlugShare: number | null; caveats: string[] };
  workingCapital: Stamp<number> & {
    itemsCosted: number; itemsUncosted: number; unitsUncosted: number;
    daysOnHand: Stamp<number>; turns: Stamp<number>;
  };
  cashLeaks: Stamp<number> & { leaks: LeakLine[]; awaiting: string[] };
  inventory: Stamp<number> & { topMovers: InventoryRiskLine[]; pushSignal: PushSignalLine | null };
  decisions: Stamp<number> & { items: DecisionItem[] };
}

const money = (n: number) => "$" + Math.round(n).toLocaleString();

const STATUS_DOT: Record<VerdictStatus, string> = {
  ok: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  gap: "bg-slate-400",
};
const STATUS_BADGE: Record<VerdictStatus, string> = {
  ok: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  red: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  gap: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function fmtAsOf(asOf: string | null): string | null {
  if (!asOf) return null;
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return asOf;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The provenance chip: source · as-of · status dot. Always visible. */
function Chip({ s, label }: { s: { source: string; asOf: string | null; status: VerdictStatus }; label?: string }) {
  const asOf = fmtAsOf(s.asOf);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
      title={`${s.source}${s.asOf ? ` · as of ${s.asOf}` : ""}`}
      data-testid={label ? `chip-${label}` : undefined}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[s.status]}`} />
      <span className="truncate">{s.source.split("(")[0].trim()}</span>
      {asOf && <span className="shrink-0">· {asOf}</span>}
    </span>
  );
}

function Tile({ icon, label, value, sub, section, testId, children }: {
  icon: React.ReactNode; label: string; value: string; sub?: string | null;
  section: { source: string; asOf: string | null; status: VerdictStatus; note?: string };
  testId: string; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-2.5 space-y-1 min-w-0" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
      <div className={`text-lg font-semibold leading-tight ${section.status === "red" ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground leading-snug">{sub}</div>}
      {section.note && <div className="text-[11px] leading-snug text-muted-foreground">{section.note}</div>}
      {children}
      <Chip s={section} label={testId} />
    </div>
  );
}

export function CfoVerdictCard() {
  const { data, isLoading } = useQuery<{ success: boolean; verdict: CfoVerdict }>({
    queryKey: ["/api/cfo/verdict"],
  });
  const v = data?.verdict;

  if (isLoading) {
    return (
      <Card data-testid="card-cfo-verdict">
        <CardContent className="p-4 text-sm text-muted-foreground">Composing the CFO verdict…</CardContent>
      </Card>
    );
  }
  if (!v) return null;

  return (
    <Card data-testid="card-cfo-verdict">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" /> Daily CFO Verdict
          <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[v.overall.status]}`} data-testid="badge-cfo-overall">
            {v.overall.status.toUpperCase()}
          </span>
        </CardTitle>
        <CardDescription>{v.overall.headline} Every number carries its source and as-of date; missing feeds say so — nothing is silently zero.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {/* CASH */}
          <Tile
            icon={<Wallet className="h-3.5 w-3.5" />} label="Cash (bank-confirmed)"
            value={v.cash.value != null ? money(v.cash.value) : "awaiting entry"}
            sub={v.cash.staleDays != null ? `confirmed ${v.cash.staleDays} day(s) ago` : null}
            section={v.cash} testId="cfo-cash"
          >
            <Link href={v.cash.updateHref} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline" data-testid="link-cfo-cash-update">
              Tap to update from the bank <ArrowRight className="h-3 w-3" />
            </Link>
          </Tile>

          {/* RUNWAY */}
          <Tile
            icon={<Hourglass className="h-3.5 w-3.5" />} label="Runway (debt-aware)"
            value={v.runway.cashFlowPositive ? "cash-flow +" : v.runway.value != null ? `${v.runway.value} days` : "gapped"}
            sub={v.runway.basis}
            section={v.runway} testId="cfo-runway"
          />

          {/* WORKING CAPITAL — inventory turns + days-on-hand beside runway */}
          <Tile
            icon={<Scale className="h-3.5 w-3.5" />} label="Working capital (inventory)"
            value={v.workingCapital.daysOnHand.value != null ? `${v.workingCapital.daysOnHand.value} days on hand` : "gapped"}
            sub={[
              v.workingCapital.value != null ? `${money(v.workingCapital.value)} at WAC` : "value unavailable",
              v.workingCapital.turns.value != null ? `${v.workingCapital.turns.value} turns/yr` : null,
            ].filter(Boolean).join(" · ")}
            section={v.workingCapital} testId="cfo-working-capital"
          >
            {v.workingCapital.daysOnHand.note && v.workingCapital.daysOnHand.note !== v.workingCapital.note && (
              <div className="text-[11px] leading-snug text-muted-foreground">{v.workingCapital.daysOnHand.note}</div>
            )}
          </Tile>

          {/* MER */}
          <Tile
            icon={<Megaphone className="h-3.5 w-3.5" />} label={`Blended MER vs ${v.mer.gate}x gate`}
            value={v.mer.value != null ? `${v.mer.value.toFixed(2)}x` : "unavailable"}
            sub={v.mer.measuredBreakeven != null ? `measured breakeven ${v.mer.measuredBreakeven.toFixed(2)}x · confidence: ${v.mer.confidence}` : `confidence: ${v.mer.confidence}`}
            section={v.mer} testId="cfo-mer"
          >
            <div className="flex flex-wrap gap-1">
              {v.mer.feeds.map((f) => (
                <span key={f.feed} className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground" title={f.detail}>
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[f.status]}`} />
                  {f.feed}{f.daysOld != null ? ` ${f.daysOld}d` : ""}
                </span>
              ))}
            </div>
          </Tile>

          {/* CONTRIBUTION */}
          <Tile
            icon={<Percent className="h-3.5 w-3.5" />} label="Contribution margin (30d)"
            value={v.contribution.marginPctDisplay ?? "unavailable"}
            sub={v.contribution.caveats[0] ?? null}
            section={v.contribution} testId="cfo-contribution"
          />

          {/* CASH LEAKS */}
          <Tile
            icon={<Droplets className="h-3.5 w-3.5" />} label="Cash leaks (zero-purchase spend)"
            value={v.cashLeaks.status === "gap" ? "awaiting feed" : v.cashLeaks.value != null && v.cashLeaks.value > 0 ? money(v.cashLeaks.value) : "none detected"}
            section={v.cashLeaks} testId="cfo-leaks"
          >
            {v.cashLeaks.leaks.length > 0 && (
              <div className="space-y-0.5 text-[11px] text-muted-foreground">
                {v.cashLeaks.leaks.slice(0, 3).map((l) => (
                  <div key={l.platform}>{l.platform}: {money(l.spendNoPurchase)} across {l.windows} window(s)</div>
                ))}
              </div>
            )}
          </Tile>

          {/* INVENTORY */}
          <Tile
            icon={<Boxes className="h-3.5 w-3.5" />} label="Inventory risk (days left)"
            value={v.inventory.value != null ? `${v.inventory.value} days (tightest mover)` : "no velocity data"}
            section={v.inventory} testId="cfo-inventory"
          >
            <div className="space-y-0.5 text-[11px] text-muted-foreground">
              {v.inventory.topMovers.slice(0, 3).map((m) => (
                <div key={m.sku} className="flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[m.status]}`} />
                  <span className="truncate">{m.sku}</span>
                  <span className="ml-auto shrink-0 tabular-nums">{m.daysLeft != null ? `${m.daysLeft}d` : "no sales"}</span>
                </div>
              ))}
              {v.inventory.pushSignal && (
                <div className={`mt-1 rounded border px-1.5 py-1 leading-snug ${v.inventory.pushSignal.status === "red" ? "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400" : ""}`} data-testid="cfo-push-signal">
                  <span className="font-medium">{v.inventory.pushSignal.sku}</span>
                  {" · pivot "}{v.inventory.pushSignal.buckets?.pivotQty ?? "—"}
                  {" · afs "}{v.inventory.pushSignal.buckets?.availableForSaleQty ?? "—"}
                  {" · frames on order "}{v.inventory.pushSignal.framesOnOrder != null ? v.inventory.pushSignal.framesOnOrder : "data gap"}
                  {v.inventory.pushSignal.daysLeft != null ? ` · ${v.inventory.pushSignal.daysLeft}d left` : ""}
                </div>
              )}
            </div>
          </Tile>
        </div>

        {/* DECISIONS TODAY */}
        <div className="rounded-lg border p-2.5 space-y-1.5" data-testid="cfo-decisions">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ListChecks className="h-3.5 w-3.5" /> Decisions today
            <span className="ml-auto"><Chip s={v.decisions} label="cfo-decisions" /></span>
          </div>
          {v.decisions.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{v.decisions.note ?? "Nothing queued."}</p>
          ) : (
            <ol className="space-y-1">
              {v.decisions.items.map((d, i) => (
                <li key={`${d.kind}-${i}`} className="text-sm leading-snug">
                  <span className="font-medium">{i + 1}. {d.title}</span>
                  <span className="text-muted-foreground"> — {d.why}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
