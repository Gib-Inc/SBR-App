import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, AlertTriangle, Radio } from "lucide-react";

/**
 * CIPH.R Data Integrity & Sync Health (Phase 3) — read-only view of the whole
 * reconciliation system: recent keep/change/add/disregard decisions, Extensiv
 * guard-skip alerts, the "already bitten" suspect count, and per-integration
 * last sync. Honest 'none' states; nothing invented.
 */

interface Decision { dataType: string; entityKey: string; action: string; field: string | null; reason: string; source: string | null; createdAt: string; }
interface GuardSkip { message: string; createdAt: string; }
interface SyncStatus { provider: string; enabled: boolean; lastSyncAt: string | null; lastSyncStatus: string | null; }
interface Resp {
  success: boolean;
  actionCounts: Record<string, number>;
  totalDecisions: number;
  recentDecisions: Decision[];
  guardSkips: GuardSkip[];
  suspectCount: number;
  syncStatus: SyncStatus[];
}

const ACTION_TONE: Record<string, string> = {
  ADDED: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  UPDATED: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  SUPERSEDED: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  KEPT: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  DISREGARDED: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};
const ACTIONS = ["ADDED", "UPDATED", "KEPT", "SUPERSEDED", "DISREGARDED"];
const ago = (iso: string) => { const d = (Date.now() - new Date(iso).getTime()) / 86400000; return d < 1 ? "today" : d < 2 ? "1d ago" : `${Math.floor(d)}d ago`; };
const syncTone = (s: string | null) => s === "SUCCESS" ? "text-green-600 dark:text-green-400" : s === "FAILED" ? "text-red-600 dark:text-red-400" : "text-muted-foreground";

export function DataHealthCard() {
  const { data, isLoading } = useQuery<Resp>({ queryKey: ["/api/finances/data-health"] });
  if (isLoading || !data?.success) return null;

  return (
    <Card data-testid="card-data-health">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Data Integrity &amp; Sync Health</CardTitle>
        <p className="text-xs text-muted-foreground">Every keep / change / add / disregard decision, the sync guards, and integration status — so nothing changes silently.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Decision counts */}
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((a) => (
            <span key={a} className={`text-xs px-2 py-1 rounded ${ACTION_TONE[a]}`} data-testid={`health-count-${a}`}>
              {a} <b className="tabular-nums">{data.actionCounts[a] || 0}</b>
            </span>
          ))}
          <span className="text-xs px-2 py-1 text-muted-foreground">· {data.totalDecisions} logged decisions</span>
        </div>

        {/* Guard skips + already-bitten */}
        {(data.guardSkips.length > 0 || data.suspectCount > 0) && (
          <div className="space-y-1.5">
            {data.guardSkips.map((g, i) => (
              <div key={i} className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded px-2 py-1 flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /><span>Sync guard blocked a bad write {ago(g.createdAt)}: {g.message}</span>
              </div>
            ))}
            {data.suspectCount > 0 && (
              <div className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1" data-testid="health-suspects">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /><span><b>{data.suspectCount}</b> finished SKU(s) at 0 sellable but sold recently — verify against the warehouse (possible past zero-out). See /api/inventory/sync-integrity.</span>
              </div>
            )}
          </div>
        )}

        {/* Per-integration sync status */}
        {data.syncStatus.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">Integrations</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {data.syncStatus.map((s) => (
                <div key={s.provider} className="rounded-lg border p-2 text-xs">
                  <div className="flex items-center gap-1 font-medium"><Radio className="h-3 w-3" /> {s.provider}</div>
                  <div className={syncTone(s.lastSyncStatus)}>{s.lastSyncStatus || (s.enabled ? "—" : "off")}</div>
                  <div className="text-[10px] text-muted-foreground">{s.lastSyncAt ? ago(s.lastSyncAt) : "never synced"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent decisions */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Recent reconciliation decisions</div>
          {data.recentDecisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reconciliation activity yet.</p>
          ) : (
            <div className="rounded-lg border divide-y max-h-72 overflow-y-auto">
              {data.recentDecisions.map((d, i) => (
                <div key={i} className="px-3 py-1.5 text-xs flex items-start gap-2" data-testid={`health-decision-${i}`}>
                  <span className={`shrink-0 px-1 rounded text-[10px] font-semibold ${ACTION_TONE[d.action] || "bg-slate-100 text-slate-600"}`}>{d.action}</span>
                  <span className="text-muted-foreground"><span className="text-foreground">{d.entityKey}</span> — {d.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
