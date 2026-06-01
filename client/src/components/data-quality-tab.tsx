import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

// Settings → Data Quality tab. Pulls /api/data-quality/summary and
// renders one card per check with a count, the first 10 offending rows,
// and a Fix link to the relevant page where they can be cleaned up.

type Sample = { id: string; label: string; hint?: string | null };
type Check = {
  id: string;
  label: string;
  description: string;
  count: number;
  samples: Sample[];
  fixUrl: string;
};
type Summary = { checks: Check[] };

export function DataQualityTab() {
  const { data, isLoading, isError, error } = useQuery<Summary>({
    queryKey: ["/api/data-quality/summary"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (isError) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Couldn't load data quality</CardTitle>
          <CardDescription>{(error as Error)?.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const checks = data?.checks ?? [];
  const totalIssues = checks.reduce((s, c) => s + c.count, 0);
  const cleanCount = checks.filter((c) => c.count === 0).length;

  return (
    <div className="space-y-4" data-testid="data-quality-tab">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Data quality at a glance</CardTitle>
          <CardDescription>
            Where the system disagrees with reality. Fix the count, the rest of the app gets smarter.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-baseline gap-4 flex-wrap">
          <div>
            <div className="text-3xl font-bold tabular-nums">{totalIssues.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">total issues</div>
          </div>
          <div>
            <div className="text-3xl font-bold tabular-nums text-green-700 dark:text-green-400">
              {cleanCount}
            </div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              of {checks.length} checks clean
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {checks.map((c) => (
          <CheckCard key={c.id} check={c} />
        ))}
      </div>
    </div>
  );
}

function CheckCard({ check }: { check: Check }) {
  const clean = check.count === 0;
  return (
    <Card data-testid={`dq-check-${check.id}`}>
      <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0 gap-3">
        <div className="space-y-0.5 min-w-0">
          <CardTitle className="text-sm flex items-center gap-1.5">
            {clean ? (
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            )}
            <span className="truncate">{check.label}</span>
          </CardTitle>
          <CardDescription className="text-xs">{check.description}</CardDescription>
        </div>
        <Badge
          variant={clean ? "outline" : "destructive"}
          className="tabular-nums shrink-0"
          data-testid={`dq-count-${check.id}`}
        >
          {check.count.toLocaleString()}
        </Badge>
      </CardHeader>
      <CardContent className="pt-0">
        {clean ? (
          <div className="text-xs text-muted-foreground py-1">All clear.</div>
        ) : (
          <>
            <ul className="text-xs space-y-1 mb-3">
              {check.samples.map((s) => (
                <li
                  key={s.id}
                  className="flex items-baseline justify-between gap-2 truncate"
                  data-testid={`dq-sample-${check.id}-${s.id}`}
                >
                  <span className="truncate font-medium text-foreground">{s.label}</span>
                  {s.hint && (
                    <span className="text-muted-foreground truncate text-right max-w-[50%]">
                      {s.hint}
                    </span>
                  )}
                </li>
              ))}
              {check.count > check.samples.length && (
                <li className="text-muted-foreground italic">
                  …and {(check.count - check.samples.length).toLocaleString()} more
                </li>
              )}
            </ul>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="w-full"
              data-testid={`dq-fix-${check.id}`}
            >
              <Link href={check.fixUrl}>
                Fix <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
