import { useQuery } from "@tanstack/react-query";

/**
 * Data-as-of bar: the real freshness of each finance data source, so a frozen
 * number reads as visibly stale. Backed by GET /api/finances/data-freshness,
 * which computes the staleness status server-side. Drop it onto any finance page.
 */
interface FreshSource {
  source: string;
  kind: string; // "synced_at" (hours-fresh) | "covers_through" (period-scale)
  asOf: string | null;
  ageHours: number | null;
  status: string; // fresh | stale | very_stale | unknown
}
interface Freshness {
  success: boolean;
  asOf: string;
  worstStatus: string;
  sources: FreshSource[];
}

const DOT: Record<string, string> = {
  fresh: "bg-green-500",
  stale: "bg-amber-500",
  very_stale: "bg-red-500",
  unknown: "bg-gray-400",
};

function ageLabel(s: FreshSource): string {
  if (!s.asOf) return "no data";
  if (s.kind === "synced_at") {
    const h = s.ageHours ?? 0;
    if (h < 1) return "just now";
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }
  // covers_through: the latest period the data spans to
  return `thru ${s.asOf.slice(0, 10)}`;
}

export function DataFreshnessBar({ className = "" }: { className?: string }) {
  const { data } = useQuery<Freshness>({ queryKey: ["/api/finances/data-freshness"] });
  if (!data?.sources?.length) return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}
      data-testid="data-freshness"
    >
      <span className="font-medium">Data as of:</span>
      {data.sources.map((s) => (
        <span key={s.source} className="inline-flex items-center gap-1" title={s.asOf ?? "no data"}>
          <span className={`inline-block h-2 w-2 rounded-full ${DOT[s.status] ?? DOT.unknown}`} />
          {s.source}: {ageLabel(s)}
        </span>
      ))}
    </div>
  );
}
