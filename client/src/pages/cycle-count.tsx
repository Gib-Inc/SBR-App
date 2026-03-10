import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ClipboardCheck, Plus, ChevronDown, ChevronRight,
  CheckCircle2, AlertTriangle, Clock, User, CalendarDays, Lock
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CycleCountEntry {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  systemQty: number;
  countedQty: number | null;
  variance: number | null;
  notes: string | null;
}

interface CycleCountSession {
  id: string;
  sessionNumber: string;
  status: "OPEN" | "COMMITTED" | "CANCELLED";
  notes: string | null;
  createdByName: string;
  createdAt: string;
  committedAt: string | null;
  totalEntries: number;
  totalVariances: number;
  entries?: CycleCountEntry[];
}

// ─── Session Detail Dialog ────────────────────────────────────────────────────

function SessionDialog({
  session,
  isOpen,
  onClose,
}: {
  session: CycleCountSession;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "counted" | "uncounted" | "variances">("all");

  const { data, isLoading, refetch } = useQuery<CycleCountSession>({
    queryKey: ["/api/cycle-counts", session.id],
    queryFn: async () => {
      const res = await fetch(`/api/cycle-counts/${session.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: isOpen,
  });

  const updateEntryMutation = useMutation({
    mutationFn: async ({ entryId, countedQty, notes }: { entryId: string; countedQty: number; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/cycle-counts/${session.id}/entries/${entryId}`, { countedQty, notes });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => refetch(),
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/cycle-counts/${session.id}/commit`, {});
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Committed!", description: `${data.adjustmentsApplied} entries processed, ${data.totalVariances} stock adjustments applied.` });
      queryClient.invalidateQueries({ queryKey: ["/api/cycle-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      onClose();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Commit failed", description: e.message }),
  });

  const entries = data?.entries ?? [];
  const counted = entries.filter(e => e.countedQty !== null).length;
  const variances = entries.filter(e => e.variance !== null && e.variance !== 0).length;
  const isCommitted = data?.status === "COMMITTED";

  const filtered = entries.filter(e => {
    if (filter === "counted") return e.countedQty !== null;
    if (filter === "uncounted") return e.countedQty === null;
    if (filter === "variances") return e.variance !== null && e.variance !== 0;
    return true;
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              {data?.sessionNumber ?? session.sessionNumber}
              {isCommitted
                ? <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-0">Committed</Badge>
                : <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0">Open</Badge>}
            </DialogTitle>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
            <span>{counted}/{entries.length} counted</span>
            {variances > 0 && <span className="text-amber-600">{variances} variances</span>}
          </div>
        </DialogHeader>

        {/* Filter bar */}
        <div className="flex gap-2">
          {(["all", "uncounted", "counted", "variances"] as const).map(f => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
              className="capitalize text-xs"
            >
              {f === "variances" ? `Variances (${variances})` : f === "uncounted" ? `Uncounted (${entries.length - counted})` : f === "counted" ? `Counted (${counted})` : `All (${entries.length})`}
            </Button>
          ))}
        </div>

        {/* Entries */}
        <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">No entries in this filter</div>
          ) : (
            filtered.map(entry => (
              <EntryRow
                key={entry.id}
                entry={entry}
                isCommitted={isCommitted}
                onUpdate={(countedQty, notes) =>
                  updateEntryMutation.mutate({ entryId: entry.id, countedQty, notes })
                }
              />
            ))
          )}
        </div>

        {/* Commit button */}
        {!isCommitted && (
          <div className="border-t pt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Committing will apply all counted variances as inventory adjustments. This cannot be undone.
            </p>
            <Button
              onClick={() => {
                if (confirm(`Commit this cycle count? ${variances} stock adjustments will be applied.`)) {
                  commitMutation.mutate();
                }
              }}
              disabled={counted === 0 || commitMutation.isPending}
              className="gap-2 ml-4 flex-shrink-0"
            >
              <Lock className="h-4 w-4" />
              {commitMutation.isPending ? "Committing…" : "Commit & Apply"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EntryRow({
  entry,
  isCommitted,
  onUpdate,
}: {
  entry: CycleCountEntry;
  isCommitted: boolean;
  onUpdate: (qty: number, notes?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(entry.countedQty?.toString() ?? "");

  const variance = entry.countedQty !== null ? entry.countedQty - entry.systemQty : null;
  const varColor = variance === null ? "" : variance > 0 ? "text-blue-600 dark:text-blue-400" : variance < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400";

  const save = () => {
    const n = parseInt(value);
    if (!isNaN(n) && n >= 0) {
      onUpdate(n);
      setEditing(false);
    }
  };

  return (
    <div className={`flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/40 ${entry.countedQty !== null ? "bg-muted/20" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{entry.itemName}</div>
        <div className="text-xs text-muted-foreground font-mono">{entry.itemSku}</div>
      </div>

      <div className="text-right min-w-[60px]">
        <div className="text-sm font-mono">{entry.systemQty}</div>
        <div className="text-xs text-muted-foreground">system</div>
      </div>

      <div className="text-right min-w-[80px]">
        {isCommitted ? (
          <div className="text-sm font-mono">{entry.countedQty ?? "—"}</div>
        ) : editing ? (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min="0"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
              className="w-20 h-7 text-right text-sm font-mono"
              autoFocus
            />
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={save}>
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            </Button>
          </div>
        ) : (
          <button
            className="text-sm font-mono cursor-pointer hover:underline text-left w-full text-right"
            onClick={() => { setValue(entry.countedQty?.toString() ?? ""); setEditing(true); }}
          >
            {entry.countedQty !== null ? entry.countedQty : <span className="text-muted-foreground italic text-xs">click to enter</span>}
          </button>
        )}
        <div className="text-xs text-muted-foreground">counted</div>
      </div>

      <div className={`text-right min-w-[50px] font-mono text-sm font-medium ${varColor}`}>
        {variance === null ? "—" : variance === 0 ? "✓" : variance > 0 ? `+${variance}` : variance}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CycleCount() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSession, setSelectedSession] = useState<CycleCountSession | null>(null);
  const [newNotes, setNewNotes] = useState("");

  const { data: sessions = [], isLoading } = useQuery<CycleCountSession[]>({
    queryKey: ["/api/cycle-counts"],
    queryFn: async () => {
      const res = await fetch("/api/cycle-counts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/cycle-counts", { notes: newNotes || undefined });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Count sheet created", description: `${data.totalEntries} components loaded — ${data.sessionNumber}` });
      queryClient.invalidateQueries({ queryKey: ["/api/cycle-counts"] });
      setNewNotes("");
      setSelectedSession(data);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Failed", description: e.message }),
  });

  const openSessions = sessions.filter(s => s.status === "OPEN");
  const committed = sessions.filter(s => s.status === "COMMITTED");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6" />
            Cycle Count
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Physical shelf counts for raw material inventory</p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            placeholder="Optional notes (e.g. End of March count)"
            value={newNotes}
            onChange={e => setNewNotes(e.target.value)}
            className="w-64"
          />
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="gap-2">
            <Plus className="h-4 w-4" />
            {createMutation.isPending ? "Creating…" : "New Count"}
          </Button>
        </div>
      </div>

      {/* Open sessions */}
      {openSessions.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Open</h2>
          {openSessions.map(s => (
            <SessionCard key={s.id} session={s} onClick={() => setSelectedSession(s)} />
          ))}
        </div>
      )}

      {/* Committed history */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">History</h2>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : committed.length === 0 ? (
          <Card><CardContent className="flex h-24 items-center justify-center text-sm text-muted-foreground">No committed counts yet</CardContent></Card>
        ) : (
          committed.map(s => (
            <SessionCard key={s.id} session={s} onClick={() => setSelectedSession(s)} />
          ))
        )}
      </div>

      {selectedSession && (
        <SessionDialog
          session={selectedSession}
          isOpen={true}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}

function SessionCard({ session, onClick }: { session: CycleCountSession; onClick: () => void }) {
  const isCommitted = session.status === "COMMITTED";
  return (
    <button
      className="w-full text-left rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold font-mono text-sm">{session.sessionNumber}</span>
              {isCommitted
                ? <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-0 text-xs">Committed</Badge>
                : <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0 text-xs">Open</Badge>}
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{new Date(session.createdAt).toLocaleDateString()}</span>
              <span className="flex items-center gap-1"><User className="h-3 w-3" />{session.createdByName}</span>
              {session.notes && <span className="italic">{session.notes}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-right text-sm">
          <div>
            <div className="font-semibold">{session.totalEntries}</div>
            <div className="text-xs text-muted-foreground">items</div>
          </div>
          {session.totalVariances > 0 && (
            <div>
              <div className="font-semibold text-amber-600 dark:text-amber-400">{session.totalVariances}</div>
              <div className="text-xs text-muted-foreground">variances</div>
            </div>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </button>
  );
}
