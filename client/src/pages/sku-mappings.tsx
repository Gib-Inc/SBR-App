import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, Pencil, Trash2, Loader2, AlertTriangle, Save, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type SkuMapping = {
  id: string;
  externalSku: string;
  canonicalSku: string;
  source: string;
  notes: string | null;
  createdAt: string;
};

type Orphan = {
  sku: string;
  source: string;
  orderCount: number;
  totalUnits: number;
};

const SOURCES = ["shopify", "amazon", "windsor", "manual"];

export default function SkuMappings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SkuMapping | null>(null);
  const [creating, setCreating] = useState<{ externalSku?: string; source?: string } | null>(null);

  const { data: mappings = [], isLoading } = useQuery<SkuMapping[]>({
    queryKey: ["/api/sku-mappings"],
  });
  const { data: orphanResp } = useQuery<{ orphans: Orphan[] }>({
    queryKey: ["/api/sku-mappings/orphans"],
  });
  const orphans = orphanResp?.orphans ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sku-mappings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sku-mappings/orphans"] });
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/sku-mappings/${id}`, {});
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Mapping deleted" });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Delete failed", description: err.message });
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, SkuMapping[]>();
    for (const m of mappings) {
      const arr = map.get(m.source) ?? [];
      arr.push(m);
      map.set(m.source, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [mappings]);

  return (
    <div className="p-4 md:p-8 space-y-6" data-testid="page-sku-mappings">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Link2 className="h-7 w-7" />
          SKU Mappings
        </h1>
        <p className="text-muted-foreground mt-1">
          Resolve external Shopify / Amazon / Windsor SKUs to canonical SKUs in the items table.
          Webhook handlers and the historical backfill consult these rows before looking up an item.
        </p>
      </div>

      {orphans.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Orphan SKUs ({orphans.length})
            </CardTitle>
            <CardDescription>
              External SKUs found on sales_order_lines that have no canonical mapping and no
              exact match in items.sku. Map them to clear them from this list.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>External SKU</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orphans.map((o) => (
                  <TableRow key={`${o.source}:${o.sku}`} data-testid={`orphan-${o.sku}`}>
                    <TableCell className="font-mono text-xs">{o.sku}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{o.source}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{o.orderCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.totalUnits.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCreating({ externalSku: o.sku, source: o.source })}
                        data-testid={`button-map-orphan-${o.sku}`}
                      >
                        Map →
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Existing Mappings</CardTitle>
            <CardDescription>{mappings.length} on file.</CardDescription>
          </div>
          <Button onClick={() => setCreating({})} data-testid="button-add-mapping">
            <Plus className="h-4 w-4 mr-1" />
            Add Mapping
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : mappings.length === 0 ? (
            <div className="py-8 text-sm text-muted-foreground">No mappings yet.</div>
          ) : (
            grouped.map(([source, rows]) => (
              <div key={source} className="space-y-2 mb-6">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{source}</Badge>
                  <span className="text-xs text-muted-foreground">{rows.length} mapping{rows.length === 1 ? "" : "s"}</span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>External SKU</TableHead>
                      <TableHead>→ Canonical SKU</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((m) => (
                      <TableRow key={m.id} data-testid={`mapping-${m.id}`}>
                        <TableCell className="font-mono text-xs">{m.externalSku}</TableCell>
                        <TableCell className="font-mono text-xs font-medium">{m.canonicalSku}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                          {m.notes ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => setEditing(m)}
                              data-testid={`button-edit-mapping-${m.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm(`Delete mapping ${m.externalSku} → ${m.canonicalSku}?`)) {
                                  deleteMutation.mutate(m.id);
                                }
                              }}
                              data-testid={`button-delete-mapping-${m.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <MappingFormDialog
        isOpen={creating != null || editing != null}
        onClose={() => {
          setCreating(null);
          setEditing(null);
        }}
        editing={editing}
        prefill={creating ?? undefined}
        onSaved={invalidate}
      />
    </div>
  );
}

function MappingFormDialog({
  isOpen,
  onClose,
  editing,
  prefill,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  editing: SkuMapping | null;
  prefill?: { externalSku?: string; source?: string };
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [externalSku, setExternalSku] = useState("");
  const [canonicalSku, setCanonicalSku] = useState("");
  const [source, setSource] = useState("shopify");
  const [notes, setNotes] = useState("");

  // Re-seed inputs whenever the dialog opens for a different row.
  useMemo(() => {
    if (!isOpen) return;
    if (editing) {
      setExternalSku(editing.externalSku);
      setCanonicalSku(editing.canonicalSku);
      setSource(editing.source);
      setNotes(editing.notes ?? "");
    } else {
      setExternalSku(prefill?.externalSku ?? "");
      setCanonicalSku("");
      setSource(prefill?.source ?? "shopify");
      setNotes("");
    }
  }, [isOpen, editing, prefill]);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = { externalSku, canonicalSku, source, notes: notes.trim() || null };
      if (editing) {
        const res = await apiRequest("PATCH", `/api/sku-mappings/${editing.id}`, body);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/sku-mappings", body);
      return res.json();
    },
    onSuccess: () => {
      onSaved();
      toast({ title: editing ? "Mapping updated" : "Mapping added" });
      onClose();
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Save failed", description: err.message });
    },
  });

  const canSave = externalSku.trim() && canonicalSku.trim() && !mutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Mapping" : "Add Mapping"}</DialogTitle>
          <DialogDescription>
            Resolves an external SKU to a canonical SKU when a webhook or backfill arrives.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ext">External SKU</Label>
            <Input
              id="ext"
              value={externalSku}
              onChange={(e) => setExternalSku(e.target.value)}
              placeholder="e.g. SBR-Classic1.0"
              data-testid="input-external-sku"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="canon">Canonical SKU (must exist in items.sku)</Label>
            <Input
              id="canon"
              value={canonicalSku}
              onChange={(e) => setCanonicalSku(e.target.value)}
              placeholder="e.g. SBR-PUSH-1.0"
              data-testid="input-canonical-sku"
            />
          </div>
          <div className="space-y-1">
            <Label>Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger data-testid="select-mapping-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder='e.g. "VERIFY: confirm with Sammie before relying on this"'
              data-testid="input-mapping-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            <X className="h-4 w-4 mr-1" /> Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave} data-testid="button-save-mapping">
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
