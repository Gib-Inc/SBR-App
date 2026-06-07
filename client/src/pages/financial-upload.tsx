import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { UploadCloud, CheckCircle2, AlertTriangle, FileSpreadsheet, MessageSquareWarning } from "lucide-react";

/**
 * CIPH.R — focused financial-document uploader for the accountant.
 * Upload a Monthly P&L (.xlsx) → review the extracted figures → apply to the app
 * (review-then-apply, so a misparse can't silently overwrite the books).
 * Plus a discrepancy box to flag anything that looks off.
 */

interface ParsedMonth {
  month: string;
  totalIncome: number | null;
  grossProfit: number | null;
  totalExpenses: number | null;
  netIncome: number | null;
  expenseCategories: Record<string, number>;
}

const fmt = (v: number | null) => (v == null ? "—" : (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString());

export default function FinancialUpload() {
  const { toast } = useToast();
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [parsed, setParsed] = useState<ParsedMonth[] | null>(null);
  const [meta, setMeta] = useState<{ fileName?: string; detectedFormat?: string; warnings?: string[] } | null>(null);
  const [applied, setApplied] = useState(false);
  const [reporter, setReporter] = useState("");
  const [discrepancy, setDiscrepancy] = useState("");
  const [discSent, setDiscSent] = useState(false);

  const onFile = async (file: File) => {
    setParsing(true); setParsed(null); setApplied(false); setMeta(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/financial-upload/parse", { method: "POST", body: fd, credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Could not parse the file.");
      setParsed(json.months);
      setMeta({ fileName: json.fileName, detectedFormat: json.detectedFormat, warnings: json.warnings });
    } catch (e: any) {
      toast({ title: "Couldn't read that file", description: e.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const apply = async () => {
    if (!parsed) return;
    setApplying(true);
    try {
      const res = await apiRequest("POST", "/api/financial-upload/apply", { months: parsed });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Apply failed.");
      setApplied(true);
      toast({ title: "Applied", description: `${json.applied} month(s) updated in the Finances tab.` });
    } catch (e: any) {
      toast({ title: "Apply failed", description: e.message, variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const sendDiscrepancy = async () => {
    if (!discrepancy.trim()) return;
    try {
      const res = await apiRequest("POST", "/api/financial-upload/discrepancy", {
        message: discrepancy, reportedBy: reporter || undefined, documentName: meta?.fileName,
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not send.");
      setDiscSent(true); setDiscrepancy("");
      toast({ title: "Thank you", description: "Your note was sent to the SBR team." });
    } catch (e: any) {
      toast({ title: "Couldn't send", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Financial Documents</h1>
        <p className="text-sm text-muted-foreground">Upload the monthly Profit &amp; Loss (.xlsx). You'll review the figures before anything updates.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><UploadCloud className="h-4 w-4" /> 1 · Upload Monthly P&amp;L (.xlsx)</CardTitle></CardHeader>
        <CardContent>
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-8 cursor-pointer hover:bg-muted/40" data-testid="dropzone-financial">
            <UploadCloud className="h-7 w-7 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{parsing ? "Reading…" : "Click to choose a .xlsx file"}</span>
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={parsing}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} data-testid="input-financial-file" />
          </label>
        </CardContent>
      </Card>

      {parsed && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">2 · Review {meta?.fileName ? `— ${meta.fileName}` : ""}</CardTitle>
            {meta?.detectedFormat && <p className="text-xs text-muted-foreground">Detected format: {meta.detectedFormat} · {parsed.length} month(s)</p>}
          </CardHeader>
          <CardContent>
            {meta?.warnings && meta.warnings.length > 0 && (
              <div className="mb-3 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /><span>{meta.warnings.join(" · ")}</span></div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground text-right">
                  <th className="text-left py-1">Month</th><th className="py-1">Revenue</th><th className="py-1">Gross Profit</th><th className="py-1">Expenses</th><th className="py-1">Net Income</th>
                </tr></thead>
                <tbody>
                  {parsed.map((m) => (
                    <tr key={m.month} className="border-t text-right" data-testid={`review-${m.month}`}>
                      <td className="text-left py-1 font-medium">{m.month}</td>
                      <td className="tabular-nums">{fmt(m.totalIncome)}</td>
                      <td className="tabular-nums">{fmt(m.grossProfit)}</td>
                      <td className="tabular-nums">{fmt(m.totalExpenses)}</td>
                      <td className={`tabular-nums ${m.netIncome != null && m.netIncome < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{fmt(m.netIncome)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={apply} disabled={applying || applied} data-testid="button-apply-financials">
                {applied ? <><CheckCircle2 className="h-4 w-4 mr-1" /> Applied</> : applying ? "Applying…" : "Apply to Finances tab"}
              </Button>
              {applied && <span className="text-sm text-green-600 dark:text-green-400">Updated — the Finances tab now reflects these numbers.</span>}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><MessageSquareWarning className="h-4 w-4" /> Report a discrepancy</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">See something off (a number, a missing account, a categorization)? Tell the SBR team here.</p>
          <Input placeholder="Your name (optional)" value={reporter} onChange={(e) => setReporter(e.target.value)} data-testid="input-reporter" />
          <Textarea placeholder="Describe the discrepancy…" rows={4} value={discrepancy} onChange={(e) => setDiscrepancy(e.target.value)} data-testid="input-discrepancy" />
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={sendDiscrepancy} disabled={!discrepancy.trim()} data-testid="button-send-discrepancy">Send to SBR team</Button>
            {discSent && <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Sent</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
