import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Communication = {
  id: string;
  supplierId: string;
  itemId: string | null;
  actionType: string;
  sentBy: string;
  status: string;
  expectedDate: string | null;
  notes: string | null;
  createdAt: string;
};

type Item = {
  id: string;
  sku: string;
  name: string;
  type: string;
};

const ACTION_LABEL: Record<string, string> = {
  REORDER_REQUEST: "Reorder Request",
  PAYMENT_SENT: "Payment Sent",
  DELIVERY_CONFIRMED: "Delivery Confirmed",
  ISSUE_FLAGGED: "Issue Flagged",
};

const STATUS_VARIANT = (status: string): "default" | "secondary" | "destructive" => {
  if (status === "RESOLVED") return "default";
  if (status === "IN_PROGRESS") return "secondary";
  return "destructive"; // PENDING — needs attention
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
};

const SENDER_OPTIONS = ["Clarence", "Sammie", "Matt", "Stacy"];

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
};

export function SupplierCommunications({
  supplierId,
  supplierName,
}: {
  supplierId: string;
  supplierName: string;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const { data, isLoading } = useQuery<Communication[]>({
    queryKey: [`/api/vendor-communications?supplierId=${supplierId}`],
  });

  const rows = data ?? [];

  return (
    <div className="space-y-3" data-testid="supplier-communications">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? "No communications logged yet."
            : `${rows.length} communication${rows.length === 1 ? "" : "s"} on file.`}
        </p>
        <Button size="sm" onClick={() => setLogOpen(true)} data-testid="button-log-communication">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Log Communication
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : rows.length === 0 ? null : (
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Sent by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} data-testid={`comm-row-${c.id}`}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDate(c.createdAt)}</TableCell>
                  <TableCell>{ACTION_LABEL[c.actionType] ?? c.actionType}</TableCell>
                  <TableCell>{c.sentBy}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT(c.status)}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{formatDate(c.expectedDate)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                    {c.notes ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <LogCommunicationDialog
        isOpen={logOpen}
        onClose={() => setLogOpen(false)}
        supplierId={supplierId}
        supplierName={supplierName}
      />
    </div>
  );
}

export function LogCommunicationDialog({
  isOpen,
  onClose,
  supplierId,
  supplierName,
  defaults,
}: {
  isOpen: boolean;
  onClose: () => void;
  supplierId: string;
  supplierName: string;
  defaults?: Partial<{
    itemId: string;
    actionType: string;
    notes: string;
    sentBy: string;
  }>;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [actionType, setActionType] = useState(defaults?.actionType ?? "REORDER_REQUEST");
  const [sentBy, setSentBy] = useState(defaults?.sentBy ?? "Clarence");
  const [status, setStatus] = useState("PENDING");
  const [itemId, setItemId] = useState(defaults?.itemId ?? "");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState(defaults?.notes ?? "");

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ["/api/items"],
    enabled: isOpen,
  });

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.sku.localeCompare(b.sku)),
    [items],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        supplierId,
        itemId: itemId || null,
        actionType,
        sentBy: sentBy.trim(),
        status,
        expectedDate: expectedDate ? new Date(expectedDate).toISOString() : null,
        notes: notes.trim() || null,
      };
      const res = await apiRequest("POST", "/api/vendor-communications", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vendor-communications?supplierId=${supplierId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-communications/recent"] });
      toast({ title: "Logged", description: `${ACTION_LABEL[actionType]} recorded for ${supplierName}.` });
      // Reset form
      setActionType("REORDER_REQUEST");
      setItemId("");
      setExpectedDate("");
      setNotes("");
      setStatus("PENDING");
      onClose();
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Failed to log", description: err.message });
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log Communication — {supplierName}</DialogTitle>
          <DialogDescription>
            Record a phone call, email, or other communication with this vendor.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!sentBy.trim() || mutation.isPending) return;
            mutation.mutate();
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Action</Label>
              <Select value={actionType} onValueChange={setActionType}>
                <SelectTrigger data-testid="select-action-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTION_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Sent by</Label>
              <Select value={sentBy} onValueChange={setSentBy}>
                <SelectTrigger data-testid="select-sent-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENDER_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="RESOLVED">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="expected-date">Expected delivery</Label>
              <Input
                id="expected-date"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                data-testid="input-expected-date"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>SKU affected (optional)</Label>
            <Select value={itemId || "__none__"} onValueChange={(v) => setItemId(v === "__none__" ? "" : v)}>
              <SelectTrigger data-testid="select-item">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {sortedItems.map((it) => (
                  <SelectItem key={it.id} value={it.id}>{it.sku} — {it.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="comm-notes">Notes</Label>
            <Textarea
              id="comm-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What was said, agreed quantities, follow-up actions, etc."
              data-testid="input-notes"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!sentBy.trim() || mutation.isPending}
              data-testid="button-submit-log"
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mutation.isPending ? "Saving…" : "Log Communication"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
