import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  AlertTriangle,
  ClipboardList,
  Mail,
  ExternalLink,
  Send,
  Copy,
  CheckCircle2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getOnlineSupplier } from "@/lib/online-suppliers";

const SENDERS = ["Sammie", "Matt", "Stacy"];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export interface SupplierActionContext {
  itemId: string;
  itemName: string;
  sku: string;
  supplierId: string;
  supplierName: string;
  supplierContactName?: string | null;
  supplierSku?: string | null;
  currentStock: number;
  dailyUsage: number;
  daysLeft: number | null;
  leadTimeDays: number | null;
  recommendedQty: number;
  estimatedCost: number | null;
  unitCost: number | null;
}

type ActionTaken = {
  kind: "create_po" | "email" | "online";
  label: string;
  sentBy: string;
  at: Date;
  detail?: string;
};

function buildEmailMessage(ctx: SupplierActionContext, sentBy: string): string {
  const contact = ctx.supplierContactName?.trim() || ctx.supplierName;
  const days = ctx.daysLeft ?? 0;
  return [
    `Hi ${contact},`,
    "",
    `We need to place an urgent order for ${ctx.itemName}.`,
    "",
    `Quantity needed: ${ctx.recommendedQty.toLocaleString()} units`,
    `Current stock: ${ctx.currentStock.toLocaleString()} (stockout in ${days} day${days === 1 ? "" : "s"})`,
    "",
    "Please confirm availability and earliest ship date.",
    "",
    "Thank you,",
    sentBy,
    "Sticker Burr Roller",
  ].join("\n");
}

export function SupplierActionDialog({
  isOpen,
  onClose,
  context,
  onCreatePO,
}: {
  isOpen: boolean;
  onClose: () => void;
  context: SupplierActionContext | null;
  /**
   * Called when the operator picks "Create Purchase Order". The host page
   * is responsible for opening CreatePODialog with the supplier + line
   * pre-filled. After the host successfully closes the dialog, call
   * `onPOSaved(poNumber?)` on the action dialog to log the completion to
   * vendor_communications. We don't fire it from here because we need the
   * resulting poNumber for the audit notes.
   */
  onCreatePO?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sentBy, setSentBy] = useState("Matt");
  const [emailMode, setEmailMode] = useState(false);
  const [message, setMessage] = useState("");
  const [actionsTaken, setActionsTaken] = useState<ActionTaken[]>([]);
  // After "Order Online", give the operator a follow-up form to log the
  // order they just placed externally (invoice number, total cost, ETA).
  // Hidden until they actually click Order Online.
  const [logOrderMode, setLogOrderMode] = useState(false);
  const [logQty, setLogQty] = useState("");
  const [logInvoice, setLogInvoice] = useState("");
  const [logCost, setLogCost] = useState("");
  const [logExpected, setLogExpected] = useState("");

  const defaultMessage = useMemo(
    () => (context ? buildEmailMessage(context, sentBy) : ""),
    [context, sentBy],
  );

  const prevSenderRef = useRef("Matt");

  useEffect(() => {
    if (isOpen) {
      setEmailMode(false);
      setLogOrderMode(false);
      setMessage(defaultMessage);
      setActionsTaken([]);
      prevSenderRef.current = sentBy;
      // Seed log-order defaults from the situation context.
      if (context) {
        setLogQty(String(context.recommendedQty));
        setLogCost(context.estimatedCost != null ? String(context.estimatedCost) : "");
        const eta = new Date();
        eta.setDate(eta.getDate() + (context.leadTimeDays ?? 7));
        setLogExpected(eta.toISOString().slice(0, 10));
        setLogInvoice("");
      }
    }
    // Re-seed only on (re)open or item swap. Sender changes are handled by
    // the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, context?.itemId]);

  // When the sender changes mid-session, swap the signature line — but only
  // if the user hasn't customised the body. We check by comparing to the
  // template generated for the previous sender.
  useEffect(() => {
    if (!isOpen || !context) return;
    if (prevSenderRef.current === sentBy) return;
    const oldDefault = buildEmailMessage(context, prevSenderRef.current);
    const newDefault = buildEmailMessage(context, sentBy);
    setMessage((prev) => (prev === oldDefault ? newDefault : prev));
    prevSenderRef.current = sentBy;
  }, [sentBy, isOpen, context]);

  const online = getOnlineSupplier(context?.supplierName);

  const logCommunication = async (
    actionType: "REORDER_REQUEST" | "CREATE_PO" | "ONLINE_ORDER",
    notes: string,
  ) => {
    if (!context) return null;
    try {
      const res = await apiRequest("POST", "/api/vendor-communications", {
        supplierId: context.supplierId,
        itemId: context.itemId,
        actionType,
        sentBy,
        status: "PENDING",
        notes,
      });
      return await res.json();
    } catch (err: any) {
      // Non-fatal — the action itself succeeded; we just couldn't log it.
      console.warn("[SupplierAction] Failed to log to vendor_communications:", err?.message);
      return null;
    }
  };

  const recordAction = (entry: ActionTaken) => {
    setActionsTaken((prev) => [...prev, entry]);
  };

  const invalidateAfter = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/vendor-communications/recent"] });
    if (context?.supplierId) {
      queryClient.invalidateQueries({
        queryKey: [`/api/vendor-communications?supplierId=${context.supplierId}`],
      });
    }
  };

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      if (!context) throw new Error("No context");
      const res = await apiRequest("POST", "/api/vendor-communications/notify", {
        supplierId: context.supplierId,
        itemId: context.itemId,
        sentBy,
        message,
      });
      return res.json() as Promise<{ emailSent: boolean; emailError: string | null; recipientEmail: string | null }>;
    },
    onSuccess: (data) => {
      invalidateAfter();
      const desc = data.emailSent
        ? `Email sent to ${data.recipientEmail}.`
        : data.recipientEmail
          ? `Email send failed (${data.emailError}). Logged to Communications.`
          : "No supplier email on file. Logged to Communications.";
      toast({ title: data.emailSent ? "Vendor notified" : "Logged", description: desc });
      recordAction({
        kind: "email",
        label: "Email Sent",
        sentBy,
        at: new Date(),
        detail: data.emailSent
          ? `to ${data.recipientEmail}`
          : data.recipientEmail
            ? "delivery failed — paper trail saved"
            : "no email on file — paper trail saved",
      });
      setEmailMode(false);
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Send failed", description: err.message });
    },
  });

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast({ title: "Copied", description: "Email body is on your clipboard." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Copy failed", description: err?.message ?? "Clipboard unavailable" });
    }
  };

  const handleCreatePO = async () => {
    if (!context || !onCreatePO) return;
    await logCommunication(
      "CREATE_PO",
      `Drafted PO via Take Action modal — ${context.recommendedQty} ${context.sku} @ ${context.unitCost != null ? usd.format(context.unitCost) : "?"} ea`,
    );
    invalidateAfter();
    recordAction({
      kind: "create_po",
      label: "Create PO",
      sentBy,
      at: new Date(),
      detail: `${context.recommendedQty.toLocaleString()} units pre-filled`,
    });
    onCreatePO();
    onClose();
  };

  const handleOnlineOrder = async () => {
    if (!context || !online) return;
    const query = (context.supplierSku?.trim() || context.itemName).trim();
    const url = online.searchUrl(query);
    window.open(url, "_blank", "noopener,noreferrer");
    await logCommunication(
      "ONLINE_ORDER",
      `Opened ${online.displayName} search for "${query}" — operator placed order on vendor site`,
    );
    invalidateAfter();
    recordAction({
      kind: "online",
      label: `Online Order (${online.displayName})`,
      sentBy,
      at: new Date(),
      detail: `searched: ${query}`,
    });
  };

  const quickLogMutation = useMutation({
    mutationFn: async () => {
      if (!context) throw new Error("No context");
      const qNum = Number(logQty);
      const cNum = logCost ? Number(logCost) : null;
      if (!Number.isFinite(qNum) || !Number.isInteger(qNum) || qNum <= 0) {
        throw new Error("Quantity must be a positive whole number");
      }
      const res = await apiRequest("POST", "/api/purchase-orders/quick-log", {
        supplierId: context.supplierId,
        itemId: context.itemId,
        qtyOrdered: qNum,
        totalCost: cNum,
        invoiceNumber: logInvoice.trim() || undefined,
        expectedDate: logExpected || undefined,
      });
      return res.json() as Promise<{ purchaseOrder: { id: string; poNumber: string } }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      invalidateAfter();
      toast({
        title: "Order logged",
        description: `PO ${data.purchaseOrder.poNumber} created.`,
      });
      recordAction({
        kind: "online",
        label: `Logged: ${data.purchaseOrder.poNumber}`,
        sentBy,
        at: new Date(),
        detail: logInvoice ? `invoice ${logInvoice}` : `${logQty} units`,
      });
      setLogOrderMode(false);
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Log failed", description: err.message });
    },
  });

  const busy = sendEmailMutation.isPending || quickLogMutation.isPending;
  const lastActionWasOnline = actionsTaken.some((a) => a.kind === "online");

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Action Required — {context?.itemName ?? ""}
          </DialogTitle>
          <DialogDescription>Pick a path. Whatever you choose is logged to Communications.</DialogDescription>
        </DialogHeader>

        {/* SECTION 1 — Situation */}
        {context && (
          <section className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm" data-testid="action-situation">
            <div className="font-semibold text-base mb-2">Situation</div>
            <SituationRow label="Component" value={`${context.itemName}`} mono={false} />
            <SituationRow label="SKU" value={context.sku} mono />
            <SituationRow label="Current stock" value={`${context.currentStock.toLocaleString()} units`} />
            <SituationRow
              label="Daily consumption"
              value={
                context.dailyUsage > 0
                  ? `${context.dailyUsage.toLocaleString(undefined, { maximumFractionDigits: 1 })}/day`
                  : "no demand"
              }
            />
            <SituationRow
              label="Days until stockout"
              value={
                context.daysLeft != null
                  ? `${context.daysLeft} day${context.daysLeft === 1 ? "" : "s"}`
                  : "n/a"
              }
              valueClass={
                context.daysLeft != null &&
                context.leadTimeDays != null &&
                context.daysLeft < context.leadTimeDays
                  ? "text-destructive font-bold"
                  : ""
              }
            />
            <SituationRow label="Supplier" value={context.supplierName} />
            <SituationRow
              label="Supplier lead time"
              value={
                context.leadTimeDays != null
                  ? `${context.leadTimeDays} days`
                  : "not on file"
              }
            />
            <SituationRow label="Recommended order qty" value={`${context.recommendedQty.toLocaleString()} units`} />
            <SituationRow
              label="Estimated cost"
              value={context.estimatedCost != null ? usd.format(context.estimatedCost) : "—"}
            />
          </section>
        )}

        {/* SECTION 2 — Choose Action */}
        <section className="space-y-3" data-testid="action-choose">
          <div className="font-semibold text-base flex items-center justify-between">
            <span>Choose Action</span>
            <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <Label htmlFor="action-sent-by" className="text-xs">Acting as:</Label>
              <Select value={sentBy} onValueChange={setSentBy}>
                <SelectTrigger id="action-sent-by" className="w-[110px] h-7" data-testid="select-action-sender">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENDERS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!emailMode ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button
                variant="default"
                className="h-auto flex-col py-3 gap-1"
                onClick={handleCreatePO}
                disabled={!context || !onCreatePO}
                data-testid="action-create-po"
              >
                <ClipboardList className="h-5 w-5" />
                <span className="font-semibold">Create Purchase Order</span>
                <span className="text-xs font-normal opacity-90">Pre-filled draft, no email</span>
              </Button>

              <Button
                variant="outline"
                className="h-auto flex-col py-3 gap-1"
                onClick={() => setEmailMode(true)}
                disabled={!context}
                data-testid="action-email"
              >
                <Mail className="h-5 w-5" />
                <span className="font-semibold">Email Supplier</span>
                <span className="text-xs font-normal text-muted-foreground">Editable message + send</span>
              </Button>

              {online && (
                <Button
                  variant="outline"
                  className="h-auto flex-col py-3 gap-1"
                  onClick={handleOnlineOrder}
                  disabled={!context}
                  data-testid="action-online"
                >
                  <ExternalLink className="h-5 w-5" />
                  <span className="font-semibold">Order Online</span>
                  <span className="text-xs font-normal text-muted-foreground">{online.displayName}</span>
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-md border bg-background p-3" data-testid="action-email-form">
              <div className="text-sm text-muted-foreground">
                Editable. Sender signature stays in sync with the dropdown above.
              </div>
              <Textarea
                rows={10}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="font-mono text-sm"
                data-testid="input-action-email"
              />
              <div className="flex flex-col sm:flex-row gap-2 justify-end">
                <Button variant="ghost" onClick={() => setEmailMode(false)} disabled={busy}>
                  ← Back
                </Button>
                <Button variant="outline" onClick={handleCopyEmail} disabled={busy} data-testid="action-email-copy">
                  <Copy className="h-4 w-4 mr-2" />
                  Copy to Clipboard
                </Button>
                <Button
                  onClick={() => sendEmailMutation.mutate()}
                  disabled={busy || message.trim().length === 0}
                  data-testid="action-email-send"
                >
                  {sendEmailMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Send Email
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* "Just ordered this" follow-up — appears after Order Online,
            offers a 4-field form that creates a PO from the externally-
            placed order. Hidden until the operator clicks Order Online
            so we don't clutter the modal up-front. */}
        {context && lastActionWasOnline && !logOrderMode && (
          <section
            className="rounded-md border border-blue-500/40 bg-blue-500/10 p-3 flex items-center justify-between gap-3"
            data-testid="just-ordered-prompt"
          >
            <span className="text-sm font-medium">Did you place the order? Log it so it shows on Incoming.</span>
            <Button size="sm" onClick={() => setLogOrderMode(true)} data-testid="button-open-log-order">
              Log it →
            </Button>
          </section>
        )}

        {context && logOrderMode && (
          <section
            className="rounded-md border bg-background p-3 space-y-3"
            data-testid="log-order-form"
          >
            <div className="font-semibold text-sm">Log the order you just placed</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Supplier</div>
                <div className="font-medium">{context.supplierName}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Item</div>
                <div className="font-medium truncate">{context.sku} — {context.itemName}</div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="log-qty">Quantity</Label>
                <Input
                  id="log-qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={logQty}
                  onChange={(e) => setLogQty(e.target.value)}
                  data-testid="input-log-qty"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="log-cost">Total cost</Label>
                <Input
                  id="log-cost"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  value={logCost}
                  onChange={(e) => setLogCost(e.target.value)}
                  data-testid="input-log-cost"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="log-invoice">Invoice / order #</Label>
                <Input
                  id="log-invoice"
                  type="text"
                  value={logInvoice}
                  onChange={(e) => setLogInvoice(e.target.value)}
                  data-testid="input-log-invoice"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="log-expected">Expected delivery</Label>
                <Input
                  id="log-expected"
                  type="date"
                  value={logExpected}
                  onChange={(e) => setLogExpected(e.target.value)}
                  data-testid="input-log-expected"
                />
                <p className="text-[11px] text-muted-foreground">
                  Defaults to today + supplier lead time ({context.leadTimeDays ?? 7}d).
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setLogOrderMode(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                onClick={() => quickLogMutation.mutate()}
                disabled={busy || !logQty}
                data-testid="button-confirm-log-order"
              >
                {quickLogMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Confirm Order
              </Button>
            </div>
          </section>
        )}

        {/* SECTION 3 — Log */}
        {actionsTaken.length > 0 && (
          <section className="rounded-md border bg-muted/30 p-3 space-y-1.5" data-testid="action-log">
            <div className="font-semibold text-sm flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Actions taken this session
            </div>
            <ul className="space-y-1">
              {actionsTaken.map((a, i) => (
                <li key={i} className="text-xs flex items-center justify-between gap-2">
                  <span>
                    <Badge variant="outline" className="mr-2 text-[10px] py-0 h-4">
                      {a.label}
                    </Badge>
                    {a.detail && <span className="text-muted-foreground">{a.detail} · </span>}
                    by {a.sentBy}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {a.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SituationRow({
  label,
  value,
  mono,
  valueClass,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${mono ? "font-mono" : "font-medium"} ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}
