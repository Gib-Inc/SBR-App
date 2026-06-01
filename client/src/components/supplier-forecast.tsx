import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Copy, RefreshCw, AlertCircle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const SENDERS = ["Clarence", "Sammie", "Matt", "Stacy"];

type ForecastItem = {
  itemId: string;
  sku: string;
  name: string;
  type: string;
  currentStock: number;
  dailyUsage: number;
  seasonalMultiplier: number;
  effectiveVelocity: number;
  daysOfSupply: number | null;
  openPoQty: number;
  need30: number;
  need60: number;
  need90: number;
  unitCost: number | null;
  leadTimeDays: number | null;
};

type ForecastResponse = {
  supplier: {
    id: string;
    name: string;
    contactName: string | null;
    email: string | null;
    tier: string;
  };
  items: ForecastItem[];
};

const numFmt = new Intl.NumberFormat("en-US");

function buildBriefBody(supplier: ForecastResponse["supplier"], items: ForecastItem[], sender: string): string {
  const contact = supplier.contactName?.trim() || supplier.name;
  const lines: string[] = [];
  lines.push(`Hi ${contact},`);
  lines.push("");
  lines.push("Here is our projected demand for items you supply over the next 90 days:");
  lines.push("");

  const tierItems = items.filter((it) => it.need30 > 0 || it.need60 > 0 || it.need90 > 0 || it.dailyUsage > 0);
  if (tierItems.length === 0) {
    lines.push("(No active demand on file for the items you supply — we'll be in touch as orders pick up.)");
  } else {
    lines.push("Next 30 days:");
    for (const it of tierItems) {
      lines.push(
        `  • ${it.name}: ${numFmt.format(it.need30)} units (current stock: ${numFmt.format(it.currentStock)}, daily usage: ${it.dailyUsage.toFixed(1)}/day${it.seasonalMultiplier !== 1 ? `, seasonal ×${it.seasonalMultiplier}` : ""})`,
      );
    }
    lines.push("");
    lines.push("Next 60 days (cumulative):");
    for (const it of tierItems) {
      lines.push(`  • ${it.name}: ${numFmt.format(it.need60)} units total`);
    }
    lines.push("");
    lines.push("Next 90 days (cumulative):");
    for (const it of tierItems) {
      lines.push(`  • ${it.name}: ${numFmt.format(it.need90)} units total`);
    }
  }

  lines.push("");
  lines.push("Please confirm capacity and let us know any lead time changes we should plan for.");
  lines.push("");
  lines.push("Thank you,");
  lines.push(sender);
  lines.push("Sticker Burr Roller");
  return lines.join("\n");
}

export function SupplierForecast({ supplierId }: { supplierId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sender, setSender] = useState("Matt");
  const [message, setMessage] = useState("");
  const [touched, setTouched] = useState(false);

  const { data, isLoading, refetch } = useQuery<ForecastResponse>({
    queryKey: [`/api/suppliers/${supplierId}/forecast`],
  });

  const items = data?.items ?? [];
  const supplier = data?.supplier;

  const generated = useMemo(
    () => (supplier ? buildBriefBody(supplier, items, sender) : ""),
    [supplier, items, sender],
  );

  // Re-seed the message when the supplier loads or the sender changes,
  // unless the operator has typed edits — then the textarea is theirs.
  useEffect(() => {
    if (!touched) setMessage(generated);
  }, [generated, touched]);

  const seasonalMutation = useMutation({
    mutationFn: async ({ itemId, multiplier }: { itemId: string; multiplier: number }) => {
      const res = await apiRequest("PATCH", `/api/items/${itemId}/seasonal-multiplier`, {
        seasonalMultiplier: multiplier,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/suppliers/${supplierId}/forecast`] });
      queryClient.invalidateQueries({ queryKey: ["/api/raw-materials/dashboard"] });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Update failed", description: err.message });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/suppliers/${supplierId}/forecast-brief`, {
        sentBy: sender,
        message,
      });
      return res.json() as Promise<{ emailSent: boolean; emailError: string | null; recipientEmail: string | null }>;
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: [`/api/suppliers/${supplierId}/forecast`] });
      queryClient.invalidateQueries({ queryKey: [`/api/suppliers/${supplierId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: [`/api/vendor-communications?supplierId=${supplierId}`] });
      const desc = r.emailSent
        ? `Email sent to ${r.recipientEmail}.`
        : r.recipientEmail
          ? `Email send failed (${r.emailError}). Logged to Communications.`
          : "No supplier email on file. Logged to Communications.";
      toast({ title: r.emailSent ? "Brief sent" : "Brief logged", description: desc });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Send failed", description: err.message });
    },
  });

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast({ title: "Copied", description: "Brief is on your clipboard." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Copy failed", description: err?.message ?? "Clipboard unavailable" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading forecast…
      </div>
    );
  }

  if (!data || items.length === 0) {
    return (
      <div className="rounded border bg-muted/30 p-4 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4 inline mr-2" />
        This supplier doesn't have any linked items yet. Add some on the Details tab to enable forecasting.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="supplier-forecast">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Current Standing & 30 / 60 / 90-day Outlook</h3>
        <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-forecast">
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="rounded border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">Daily Use</TableHead>
              <TableHead className="text-right">Days Left</TableHead>
              <TableHead className="text-right">Open POs</TableHead>
              <TableHead className="w-[110px]">Seasonal</TableHead>
              <TableHead className="text-right">Need 30d</TableHead>
              <TableHead className="text-right">Need 60d</TableHead>
              <TableHead className="text-right">Need 90d</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => (
              <TableRow key={it.itemId} data-testid={`forecast-row-${it.itemId}`}>
                <TableCell>
                  <div className="font-medium">{it.name}</div>
                  <div className="text-xs font-mono text-muted-foreground">{it.sku}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{numFmt.format(it.currentStock)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {it.dailyUsage > 0 ? it.dailyUsage.toFixed(1) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {it.daysOfSupply != null ? `${it.daysOfSupply}d` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {it.openPoQty > 0 ? numFmt.format(it.openPoQty) : "—"}
                </TableCell>
                <TableCell>
                  <SeasonalCell
                    item={it}
                    onChange={(v) => seasonalMutation.mutate({ itemId: it.itemId, multiplier: v })}
                    pending={seasonalMutation.isPending}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums font-semibold">
                  {it.need30 > 0 ? numFmt.format(it.need30) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {it.need60 > 0 ? numFmt.format(it.need60) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {it.need90 > 0 ? numFmt.format(it.need90) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Forecast Brief</h3>
        <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-3 items-start">
          <div>
            <Label className="text-xs">Sent by</Label>
            <Select value={sender} onValueChange={setSender}>
              <SelectTrigger data-testid="select-forecast-sender">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SENDERS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Default Matt for strategic-supplier briefs. Sender's email is the SendGrid reply-to.
            </p>
          </div>
          <div>
            <Label htmlFor="forecast-msg" className="text-xs">Message (auto-generates from the table)</Label>
            <Textarea
              id="forecast-msg"
              rows={14}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setTouched(true);
              }}
              className="font-mono text-xs"
              data-testid="input-forecast-msg"
            />
            {touched && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline mt-1"
                onClick={() => {
                  setTouched(false);
                  setMessage(generated);
                }}
              >
                Reset to generated
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={copyEmail} data-testid="button-copy-brief">
            <Copy className="h-4 w-4 mr-2" />
            Copy
          </Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending || !message.trim()}
            data-testid="button-send-brief"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Forecast Brief
          </Button>
        </div>
      </div>
    </div>
  );
}

// Inline edit cell for an item's seasonal multiplier. Saves on blur or
// Enter; debounces would be nice but for a small list the simple flow is
// clearer. Bounded 0..10 server-side.
function SeasonalCell({
  item,
  onChange,
  pending,
}: {
  item: ForecastItem;
  onChange: (v: number) => void;
  pending: boolean;
}) {
  const [val, setVal] = useState(String(item.seasonalMultiplier));
  useEffect(() => {
    setVal(String(item.seasonalMultiplier));
  }, [item.seasonalMultiplier]);

  const commit = () => {
    const n = Number(val);
    if (!Number.isFinite(n) || n === item.seasonalMultiplier) return;
    onChange(n);
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        max={10}
        step={0.1}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className="h-7 w-16 text-sm text-right tabular-nums"
        disabled={pending}
        data-testid={`input-seasonal-${item.itemId}`}
      />
      <span className="text-[11px] text-muted-foreground">×</span>
    </div>
  );
}
