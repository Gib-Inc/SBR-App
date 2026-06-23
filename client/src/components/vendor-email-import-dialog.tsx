import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { queryClient } from "@/lib/queryClient";
import { Loader2, Mail, CheckCircle2, AlertTriangle, Info } from "lucide-react";

/**
 * Paste a vendor order-confirmation email (Uline, McMaster, Home Depot, etc.) and
 * the app parses it, matches the lines to our SKUs by vendor part number, and
 * creates a DRAFT PO for review. Same endpoint an n8n Gmail watcher can POST to.
 */

interface MatchedLine { sku: string; itemName: string; vendorPart: string | null; qty: number; unitCost: number; matchedBy: string; }
interface UnmatchedLine { description: string; vendorPart: string | null; qty: number; unitCost: number; }
interface Result {
  ok: boolean; reason?: string; duplicate?: boolean; poId?: string; poNumber?: string;
  poStatus?: string; autoOrdered?: boolean;
  supplier?: { id: string; name: string }; orderNumber?: string | null;
  matched: MatchedLine[]; unmatched: UnmatchedLine[];
  totals?: { subtotal: number | null; shipping: number | null; tax: number | null; total: number | null };
  error?: string;
}

const money = (n: number) => "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });

const REASON_TEXT: Record<string, string> = {
  empty_email: "Paste the email body first.",
  llm_not_configured: "The email parser isn't configured on the server (ANTHROPIC_API_KEY). Tell the dev to set it.",
  parse_failed: "Couldn't read an order out of that email. Paste the full confirmation (with the line-item table).",
  no_line_items: "No line items found in that email.",
  supplier_not_found: "Couldn't tell which vendor this is from. Add the sender or make sure the vendor exists in Suppliers.",
  no_matched_lines: "Parsed the order, but none of the lines matched a SKU. Map the vendor part numbers under each item's supplier, then retry.",
};

export function VendorEmailImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const run = useMutation({
    mutationFn: async (): Promise<Result> => {
      const res = await fetch("/api/purchase-orders/from-vendor-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ from, subject, text }),
      });
      // The server returns structured JSON (ok:false + reason) even on its own 4xx/5xx,
      // so render those. A non-JSON body means a proxy/gateway error — surface it.
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        const txt = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${txt ? ` — ${txt.slice(0, 120)}` : ""}`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.ok) queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
    },
    onError: (err: any) => {
      setResult({ ok: false, error: err?.message || "Couldn't reach the server. Check your connection and try again.", matched: [], unmatched: [] });
    },
  });

  const reset = () => { setFrom(""); setSubject(""); setText(""); setResult(null); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Log vendor order from email</DialogTitle>
          <DialogDescription>
            Paste a confirmation email from Uline, McMaster, Home Depot, Silver Fox, or Austin Enterprises. It becomes a draft PO you review before it counts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input placeholder="From (e.g. service@uline.com)" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-vendor-email-from" />
            <Input placeholder="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="input-vendor-email-subject" />
          </div>
          <Textarea
            placeholder="Paste the full email body here — including the line-item table with part numbers, quantities, and prices."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="font-mono text-xs"
            data-testid="textarea-vendor-email-body"
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button onClick={() => run.mutate()} disabled={run.isPending || !text.trim()} data-testid="button-parse-vendor-email">
              {run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
              Parse &amp; create draft
            </Button>
          </div>

          {result && <ResultPanel result={result} onReset={reset} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResultPanel({ result, onReset }: { result: Result; onReset: () => void }) {
  if (result.ok && result.duplicate) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30" data-testid="vendor-email-result-duplicate">
        <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300"><Info className="h-4 w-4" /> Already imported</div>
        <p className="mt-1 text-amber-700 dark:text-amber-300/80">This order is already in the system as <span className="font-mono">{result.poNumber}</span>. Nothing was created.</p>
      </div>
    );
  }

  if (result.ok) {
    const matchedSubtotal = result.matched.reduce((s, l) => s + l.qty * l.unitCost, 0);
    const parsedTotal = result.totals?.total ?? null;
    const ordered = result.autoOrdered === true;
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm dark:border-green-900/40 dark:bg-green-950/30" data-testid="vendor-email-result-ok">
        <div className="flex items-center gap-2 font-medium text-green-800 dark:text-green-300">
          <CheckCircle2 className="h-4 w-4" />
          {ordered
            ? `Order ${result.poNumber} logged for ${result.supplier?.name}`
            : `Draft PO ${result.poNumber} created for ${result.supplier?.name}`}
        </div>
        <p className="mt-1 text-green-700 dark:text-green-300/80">
          {result.matched.length} line{result.matched.length === 1 ? "" : "s"} matched · {money(matchedSubtotal)} subtotal
          {parsedTotal != null && Math.abs(parsedTotal - matchedSubtotal) > 0.5 && (
            <span className="text-amber-700 dark:text-amber-300"> · email total was {money(parsedTotal)} (diff is usually tax/shipping or an unmatched line)</span>
          )}
        </p>
        {result.unmatched.length > 0 && <UnmatchedList lines={result.unmatched} />}
        <p className="mt-2 text-xs text-muted-foreground">
          {ordered
            ? "Every line matched, so it's logged as ordered — it's in the Incoming queue, ready to Mark Received when it lands."
            : "Some lines need mapping, so it's held as a draft on the Purchase Orders list. Map the parts, then it's ready to receive."}{" "}
          <button className="underline" onClick={onReset}>Log another</button>
        </p>
      </div>
    );
  }

  // Not ok
  const isReview = result.reason === "no_matched_lines" || result.reason === "supplier_not_found";
  return (
    <div className={`rounded-lg border p-3 text-sm ${isReview ? "border-amber-300 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30" : "border-destructive/40 bg-destructive/5"}`} data-testid="vendor-email-result-error">
      <div className={`flex items-center gap-2 font-medium ${isReview ? "text-amber-800 dark:text-amber-300" : "text-destructive"}`}>
        <AlertTriangle className="h-4 w-4" /> {isReview ? "Needs a quick fix" : "Couldn't import"}
      </div>
      <p className="mt-1 text-muted-foreground">{REASON_TEXT[result.reason || ""] || result.error || "Something went wrong parsing the email."}</p>
      {result.unmatched.length > 0 && <UnmatchedList lines={result.unmatched} />}
    </div>
  );
}

function UnmatchedList({ lines }: { lines: UnmatchedLine[] }) {
  return (
    <div className="mt-2">
      <div className="text-xs font-medium text-muted-foreground">Unmatched lines ({lines.length}):</div>
      <ul className="mt-1 space-y-0.5">
        {lines.map((l, i) => (
          <li key={i} className="text-xs">
            {l.vendorPart && <span className="font-mono">{l.vendorPart}</span>} {l.description} — {l.qty} × {money(l.unitCost)}
          </li>
        ))}
      </ul>
    </div>
  );
}
