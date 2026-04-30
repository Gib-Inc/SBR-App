import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const SENDER_OPTIONS = ["Sammie", "Matt", "Stacy"];

export type NotifyVendorContext = {
  supplierId: string;
  supplierName: string;
  itemId?: string | null;
  itemName: string;
  sku: string;
  currentStock: number;
  daysLeft: number | null;
  suggestedQty: number;
};

function buildDefaultMessage(ctx: NotifyVendorContext): string {
  const daysPart = ctx.daysLeft != null && ctx.daysLeft >= 0 ? `, ${ctx.daysLeft} days of supply remaining` : "";
  return `Hi ${ctx.supplierName}, we're running low on ${ctx.itemName} (${ctx.sku}). Current stock: ${ctx.currentStock} units${daysPart}. We'd like to place an order for ${ctx.suggestedQty} units. Please confirm availability and lead time.`;
}

export function NotifyVendorDialog({
  isOpen,
  onClose,
  context,
}: {
  isOpen: boolean;
  onClose: () => void;
  context: NotifyVendorContext | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sentBy, setSentBy] = useState("Matt");
  const [message, setMessage] = useState("");
  const [touched, setTouched] = useState(false);

  // Reset/refill message when context changes or dialog opens fresh.
  const defaultMessage = useMemo(
    () => (context ? buildDefaultMessage(context) : ""),
    [context],
  );
  useEffect(() => {
    if (isOpen) {
      setMessage(defaultMessage);
      setTouched(false);
    }
  }, [isOpen, defaultMessage]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!context) throw new Error("No context");
      const res = await apiRequest("POST", "/api/vendor-communications/notify", {
        supplierId: context.supplierId,
        itemId: context.itemId ?? null,
        sentBy,
        message,
      });
      return res.json() as Promise<{ emailSent: boolean; emailError: string | null; recipientEmail: string | null }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-communications/recent"] });
      if (context?.supplierId) {
        queryClient.invalidateQueries({
          queryKey: [`/api/vendor-communications?supplierId=${context.supplierId}`],
        });
      }
      const desc = data.emailSent
        ? `Email sent to ${data.recipientEmail}. Logged to Communications.`
        : data.recipientEmail
          ? `Email send failed (${data.emailError}). Logged to Communications.`
          : `No supplier email on file. Logged to Communications.`;
      toast({
        title: data.emailSent ? "Vendor notified" : "Logged",
        description: desc,
      });
      onClose();
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Failed to notify", description: err.message });
    },
  });

  const canSubmit = !!context && message.trim().length > 0 && !mutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Notify Vendor — {context?.supplierName ?? ""}</DialogTitle>
          <DialogDescription>
            Sends a reorder request and logs it to Communications. Email is best-effort
            (works when SendGrid is configured and the supplier has an email on file).
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            mutation.mutate();
          }}
          className="space-y-3"
        >
          {context && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1" data-testid="notify-context">
              <div><span className="text-muted-foreground">SKU:</span> <span className="font-mono">{context.sku}</span></div>
              <div><span className="text-muted-foreground">Item:</span> {context.itemName}</div>
              <div><span className="text-muted-foreground">Current stock:</span> {context.currentStock.toLocaleString()} · <span className="text-muted-foreground">Suggested order:</span> {context.suggestedQty.toLocaleString()}</div>
            </div>
          )}

          <div className="space-y-1">
            <Label>Sent by</Label>
            <Select value={sentBy} onValueChange={setSentBy}>
              <SelectTrigger data-testid="select-notify-sent-by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SENDER_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="notify-message">Message</Label>
            <Textarea
              id="notify-message"
              rows={6}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setTouched(true);
              }}
              data-testid="input-notify-message"
            />
            {!touched && (
              <p className="text-xs text-muted-foreground">Edit before sending if you need to add specifics.</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} data-testid="button-send-notify">
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {mutation.isPending ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
