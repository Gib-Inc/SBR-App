import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { UploadCloud, CheckCircle2, AlertTriangle, FileSpreadsheet, MessageSquareWarning, FileText, Landmark, Banknote, Megaphone } from "lucide-react";

/**
 * CIPH.R — focused financial-document uploader for the accountant.
 * Pick a document type, upload it, REVIEW the extracted figures, then apply.
 * Review-then-apply so a misparse can't silently overwrite the books.
 *  - Monthly P&L (.xlsx)      → months series
 *  - Balance Sheet (PDF/.xlsx)→ buckets + named loans (Claude vision on PDF)
 *  - Bank statement (PDF)     → opening/closing/deposits/withdrawals → cash
 * Plus a discrepancy box to flag anything that looks off.
 */

type DocType = "pl_xlsx" | "balance_sheet" | "bank_statement" | "ad_spend";

interface ParsedMonth {
  month: string;
  totalIncome: number | null;
  grossProfit: number | null;
  totalExpenses: number | null;
  netIncome: number | null;
  expenseCategories: Record<string, number>;
}
interface LoanLine { name: string; balance: number | null; term: string | null; }
interface BalanceSheetFields {
  asOf: string | null; basis: string | null; cash: number | null; accountsReceivable: number | null;
  inventory: number | null; totalCurrentAssets: number | null; totalAssets: number | null;
  accountsPayable: number | null; creditCards: number | null; salesTaxToPay: number | null;
  shortTermNotes: number | null; longTermLiabilities: number | null; totalLiabilities: number | null;
  totalEquity: number | null; loans: LoanLine[];
}
interface BankFields {
  accountName: string | null; bankName: string | null; statementPeriodStart: string | null; statementPeriodEnd: string | null;
  openingBalance: number | null; closingBalance: number | null; totalDeposits: number | null; totalWithdrawals: number | null;
}
interface AdSpendFields {
  platform: string; periodStart: string | null; periodEnd: string | null;
  spend: number | null; impressions: number | null; clicks: number | null;
  conversions: number | null; revenue: number | null; currency: string; rowCount: number; status: string;
}

const fmt = (v: number | null | undefined) => (v == null ? "—" : (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString());

const DOC_TYPES: { id: DocType; label: string; icon: any; accept: string; hint: string }[] = [
  { id: "pl_xlsx", label: "Monthly P&L", icon: FileSpreadsheet, accept: ".xlsx,.xls", hint: "QuickBooks Profit & Loss export (.xlsx)" },
  { id: "balance_sheet", label: "Balance Sheet", icon: Landmark, accept: ".pdf,.xlsx,.xls,image/*", hint: "PDF or .xlsx — pulls cash, debt buckets, and each named loan" },
  { id: "bank_statement", label: "Bank Statement", icon: Banknote, accept: ".pdf,image/*", hint: "PDF — pulls the ending balance to update cash on hand" },
  { id: "ad_spend", label: "Ad Spend Report", icon: Megaphone, accept: ".csv,.xlsx,.xls", hint: "Meta/Google CSV or XLSX — spend, impressions, clicks for the period" },
];

export default function FinancialUpload() {
  const { toast } = useToast();
  const [docType, setDocType] = useState<DocType>(() => {
    // Allow deep-linking to a type, e.g. /financial-upload?type=ad_spend from Ad Analytics.
    try {
      const t = new URLSearchParams(window.location.search).get("type");
      if (t && ["pl_xlsx", "balance_sheet", "bank_statement", "ad_spend"].includes(t)) return t as DocType;
    } catch { /* no window/search */ }
    return "pl_xlsx";
  });
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const [months, setMonths] = useState<ParsedMonth[] | null>(null);
  const [bs, setBs] = useState<BalanceSheetFields | null>(null);
  const [bank, setBank] = useState<BankFields | null>(null);
  const [ad, setAd] = useState<AdSpendFields | null>(null);
  const [generic, setGeneric] = useState<{ columns: string[]; rows: Record<string, any>[]; totalRows: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // friendly "accepted" + what we auto-corrected
  const [meta, setMeta] = useState<{ fileName?: string; detectedFormat?: string; warnings?: string[]; dataGaps?: string[]; confidence?: number } | null>(null);

  const [reporter, setReporter] = useState("");
  const [discrepancy, setDiscrepancy] = useState("");
  const [discSent, setDiscSent] = useState(false);
  const [recon, setRecon] = useState<{ action: string; field?: string | null; oldValue?: string | null; newValue?: string | null; reason: string }[] | null>(null);

  const reset = () => { setMonths(null); setBs(null); setBank(null); setAd(null); setGeneric(null); setNotice(null); setMeta(null); setApplied(false); setRecon(null); };
  const pickType = (t: DocType) => { setDocType(t); reset(); };

  const onFile = async (file: File) => {
    setParsing(true); reset();
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", docType);
      const res = await fetch("/api/financial-upload/parse", { method: "POST", body: fd, credentials: "include" });
      const json = await res.json();
      // The server accepts every document (success:true). A hard failure only
      // happens on a true network/server fault — otherwise we always render.
      if (!json || json.success === false) throw new Error(json?.error || "Upload failed — please retry.");

      // The server is authoritative about the type: it may have auto-detected the
      // real one (a wrong pick still works) or fallen back to a generic preview.
      const serverType: DocType | "generic" = json.docType || docType;
      if (serverType !== docType && ["pl_xlsx", "balance_sheet", "bank_statement", "ad_spend"].includes(serverType)) {
        setDocType(serverType as DocType); // reflect the corrected type in the selector
      }

      setMeta({ fileName: json.fileName, detectedFormat: json.detectedFormat, warnings: json.warnings, dataGaps: json.dataGaps, confidence: json.confidence });
      const adj = Array.isArray(json.adjustments) && json.adjustments.length
        ? ` Auto-corrected: ${json.adjustments.join("; ")}.` : "";
      setNotice((json.message || "Accepted.") + adj);

      if (serverType === "pl_xlsx") setMonths(json.months || []);
      else if (serverType === "balance_sheet") setBs(json.fields || null);
      else if (serverType === "ad_spend") setAd(json.fields || null);
      else if (serverType === "bank_statement") setBank(json.fields || null);
      else setGeneric(json.preview || { columns: [], rows: [], totalRows: 0 });

      toast({
        title: json.reclassified ? "Accepted — auto-detected the type" : "Accepted",
        description: json.message || undefined,
      });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      let json: any;
      if (docType === "pl_xlsx") {
        if (!months) return;
        json = await (await apiRequest("POST", "/api/financial-upload/apply", { months, fileName: meta?.fileName })).json();
        if (!json.success) throw new Error(json.error || "Apply failed.");
        const s = json.summary || {};
        toast({ title: "Applied", description: `${json.applied} month(s) reconciled — ${s.UPDATED || 0} updated, ${s.ADDED || 0} added, ${s.KEPT || 0} kept.` });
      } else if (docType === "balance_sheet") {
        if (!bs) return;
        json = await (await apiRequest("POST", "/api/financial-upload/apply-balance-sheet", { fields: bs, loans: bs.loans, dataGaps: meta?.dataGaps, confidence: meta?.confidence, fileName: meta?.fileName })).json();
        if (!json.success) throw new Error(json.error || "Apply failed.");
        const bsS = json.summary || {};
        toast({ title: "Applied", description: `Balance sheet reconciled — ${bsS.UPDATED || 0} updated, ${bsS.ADDED || 0} added, ${bsS.KEPT || 0} kept (nothing wiped).` });
      } else if (docType === "ad_spend") {
        if (!ad) return;
        json = await (await apiRequest("POST", "/api/financial-upload/apply-ad-spend", { fields: ad, dataGaps: meta?.dataGaps, fileName: meta?.fileName })).json();
        if (!json.success) throw new Error(json.error || "Apply failed.");
        const verb = json.action === "DISREGARDED" ? "No change" : json.action === "SUPERSEDED" ? "Replaced" : "Added";
        toast({ title: verb, description: json.message || `${ad.platform} ad spend (${fmt(ad.spend)}) saved.` });
      } else {
        if (!bank) return;
        json = await (await apiRequest("POST", "/api/financial-upload/apply-bank-statement", { fields: bank, dataGaps: meta?.dataGaps, confidence: meta?.confidence, fileName: meta?.fileName })).json();
        if (!json.success) throw new Error(json.error || "Apply failed.");
        toast({ title: "Applied", description: `Cash on hand updated to ${fmt(bank.closingBalance)}.` });
      }
      setRecon(Array.isArray(json.reconciliation) ? json.reconciliation : null);
      setApplied(true);
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

  const active = DOC_TYPES.find((d) => d.id === docType)!;
  const hasReview = !!((docType === "pl_xlsx" && months) || (docType === "balance_sheet" && bs) || (docType === "bank_statement" && bank) || (docType === "ad_spend" && ad) || generic);

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2"><FileText className="h-5 w-5" /> Financial &amp; Ad Documents</h1>
        <p className="text-sm text-muted-foreground">P&amp;L, balance sheet, bank statement, or ad report (Meta / Google / Amazon). It auto-detects the type and accepts any format — you review before anything updates.</p>
      </div>

      {/* Doc-type selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {DOC_TYPES.map((d) => {
          const Icon = d.icon;
          const sel = d.id === docType;
          return (
            <button key={d.id} onClick={() => pickType(d.id)} data-testid={`doctype-${d.id}`}
              className={`text-left rounded-lg border p-3 transition ${sel ? "border-primary ring-1 ring-primary bg-primary/5" : "hover:bg-muted/40"}`}>
              <div className="flex items-center gap-2 font-medium text-sm"><Icon className="h-4 w-4" /> {d.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{d.hint}</div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><UploadCloud className="h-4 w-4" /> 1 · Upload {active.label}</CardTitle></CardHeader>
        <CardContent>
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-8 cursor-pointer hover:bg-muted/40" data-testid="dropzone-financial">
            <UploadCloud className="h-7 w-7 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{parsing ? "Reading…" : `Click to choose a file (${active.accept.replace(/image\/\*/, "image")})`}</span>
            <input type="file" accept={active.accept} className="hidden" disabled={parsing}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} data-testid="input-financial-file" />
          </label>
          {docType !== "pl_xlsx" && <p className="text-[11px] text-muted-foreground mt-2">PDFs are read with Claude vision. Anything it can't find is flagged DATA GAPPED — never guessed.</p>}
        </CardContent>
      </Card>

      {hasReview && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">2 · Review {meta?.fileName ? `— ${meta.fileName}` : ""}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {meta?.detectedFormat ? `Detected: ${meta.detectedFormat}` : ""}
              {docType === "pl_xlsx" && months ? ` · ${months.length} month(s)` : ""}
              {meta?.confidence != null ? ` · confidence ${meta.confidence}%` : ""}
            </p>
          </CardHeader>
          <CardContent>
            {notice && (
              <div className="mb-3 text-xs rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 px-2.5 py-2 flex items-start gap-1.5" data-testid="accept-notice">
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{notice}</span>
              </div>
            )}
            {meta?.warnings && meta.warnings.length > 0 && (
              <div className="mb-3 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /><span>{meta.warnings.join(" · ")}</span></div>
            )}
            {meta?.dataGaps && meta.dataGaps.length > 0 && (
              <div className="mb-3 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1" data-testid="data-gaps">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /><span>{meta.dataGaps.length} field(s) not found — left blank, not estimated: {meta.dataGaps.map((g) => g.replace("DATA GAPPED: ", "")).join(", ")}</span>
              </div>
            )}

            {/* P&L review */}
            {docType === "pl_xlsx" && months && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted-foreground text-right">
                    <th className="text-left py-1">Month</th><th className="py-1">Revenue</th><th className="py-1">Gross Profit</th><th className="py-1">Expenses</th><th className="py-1">Net Income</th>
                  </tr></thead>
                  <tbody>
                    {months.map((m) => (
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
            )}

            {/* Balance sheet review */}
            {docType === "balance_sheet" && bs && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  {([
                    ["Cash", bs.cash], ["Accounts Receivable", bs.accountsReceivable], ["Inventory", bs.inventory], ["Accounts Payable", bs.accountsPayable],
                    ["Credit Cards", bs.creditCards], ["Short-Term Notes", bs.shortTermNotes], ["Long-Term Liabilities", bs.longTermLiabilities], ["Sales Tax Owed", bs.salesTaxToPay],
                    ["Total Liabilities", bs.totalLiabilities], ["Total Equity", bs.totalEquity],
                  ] as [string, number | null][]).map(([label, v]) => (
                    <div key={label}><div className="text-xs text-muted-foreground">{label}</div><div className="font-semibold tabular-nums">{fmt(v)}</div></div>
                  ))}
                </div>
                {bs.asOf && <p className="text-xs text-muted-foreground mt-2">As of {bs.asOf}{bs.basis ? ` · ${bs.basis} basis` : ""}</p>}
                {bs.loans && bs.loans.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Named loans / notes ({bs.loans.length})</div>
                    <table className="w-full text-sm">
                      <tbody>
                        {bs.loans.map((l, i) => (
                          <tr key={i} className="border-t" data-testid={`loan-${i}`}>
                            <td className="py-1">{l.name}{l.term ? <span className="text-xs text-muted-foreground"> · {l.term}-term</span> : ""}</td>
                            <td className="py-1 text-right tabular-nums font-medium">{fmt(l.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* Bank statement review */}
            {docType === "bank_statement" && bank && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {([
                  ["Bank", bank.bankName as any], ["Account", bank.accountName as any],
                  ["Period start", bank.statementPeriodStart as any], ["Period end", bank.statementPeriodEnd as any],
                ] as [string, string | null][]).map(([label, v]) => (
                  <div key={label}><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{v || "—"}</div></div>
                ))}
                <div><div className="text-xs text-muted-foreground">Opening Balance</div><div className="font-semibold tabular-nums">{fmt(bank.openingBalance)}</div></div>
                <div><div className="text-xs text-muted-foreground">Closing Balance</div><div className="font-semibold tabular-nums text-green-600 dark:text-green-400">{fmt(bank.closingBalance)}</div></div>
                <div><div className="text-xs text-muted-foreground">Total Deposits</div><div className="font-semibold tabular-nums">{fmt(bank.totalDeposits)}</div></div>
                <div><div className="text-xs text-muted-foreground">Total Withdrawals</div><div className="font-semibold tabular-nums">{fmt(bank.totalWithdrawals)}</div></div>
              </div>
            )}

            {/* Ad spend review */}
            {docType === "ad_spend" && ad && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Platform</div><div className="font-medium">{ad.platform}</div></div>
                <div><div className="text-xs text-muted-foreground">Period</div><div className="font-medium">{ad.periodStart || "—"}{ad.periodEnd && ad.periodEnd !== ad.periodStart ? ` → ${ad.periodEnd}` : ""}</div></div>
                <div><div className="text-xs text-muted-foreground">Rows parsed</div><div className="font-medium tabular-nums">{ad.rowCount}</div></div>
                <div><div className="text-xs text-muted-foreground">Currency</div><div className="font-medium">{ad.currency}</div></div>
                <div><div className="text-xs text-muted-foreground">Spend</div><div className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">{fmt(ad.spend)}</div></div>
                <div><div className="text-xs text-muted-foreground">Impressions</div><div className="font-semibold tabular-nums">{ad.impressions == null ? "—" : ad.impressions.toLocaleString()}</div></div>
                <div><div className="text-xs text-muted-foreground">Clicks</div><div className="font-semibold tabular-nums">{ad.clicks == null ? "—" : ad.clicks.toLocaleString()}</div></div>
                <div><div className="text-xs text-muted-foreground">Platform revenue</div><div className="font-semibold tabular-nums">{fmt(ad.revenue)}</div></div>
              </div>
            )}

            {/* Generic accept — we read the file but couldn't map it to a known
                type. Show the table so nothing is lost; the user can re-pick a
                type above to map it into the books. */}
            {generic && (
              <div data-testid="generic-preview">
                {generic.columns.length > 0 ? (
                  <>
                    <div className="overflow-x-auto rounded border">
                      <table className="w-full text-xs">
                        <thead><tr className="bg-muted/50 text-left">
                          {generic.columns.map((c) => <th key={c} className="px-2 py-1 font-medium whitespace-nowrap">{c}</th>)}
                        </tr></thead>
                        <tbody>
                          {generic.rows.slice(0, 25).map((r, i) => (
                            <tr key={i} className="border-t">
                              {generic.columns.map((c) => <td key={c} className="px-2 py-1 whitespace-nowrap tabular-nums">{r[c] == null ? "" : String(r[c])}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Showing {Math.min(25, generic.rows.length)} of {generic.totalRows} row(s). We accepted this file but couldn't match it to a known financial format. If it's a P&L, balance sheet, bank statement, or ad report, pick that type above and re-upload to map it in — otherwise it's recorded here for review.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Accepted. There's nothing to preview for this file type — use a document type above, or "Report a discrepancy" to flag it for the team.</p>
                )}
              </div>
            )}

            {!generic && (
              <div className="mt-4 flex items-center gap-3">
                <Button onClick={apply} disabled={applying || applied} data-testid="button-apply-financials">
                  {applied ? <><CheckCircle2 className="h-4 w-4 mr-1" /> Applied</> : applying ? "Applying…" : `Apply to Finances tab`}
                </Button>
                {applied && <span className="text-sm text-green-600 dark:text-green-400">Updated — the Finances tab now reflects this.</span>}
              </div>
            )}

            {/* Reconciliation decision log — what was added / changed / kept / disregarded */}
            {applied && recon && recon.length > 0 && (
              <div className="mt-3 rounded-lg border bg-muted/30 p-3" data-testid="reconciliation-report">
                <div className="text-xs font-medium mb-1.5">Reconciliation — what changed vs. existing data</div>
                <ul className="space-y-1">
                  {recon.slice(0, 30).map((d, i) => {
                    const tone = d.action === "KEPT" || d.action === "DISREGARDED" ? "text-muted-foreground"
                      : d.action === "UPDATED" || d.action === "SUPERSEDED" ? "text-amber-600 dark:text-amber-400"
                      : "text-green-600 dark:text-green-400";
                    return (
                      <li key={i} className="text-xs flex items-start gap-2">
                        <span className={`shrink-0 font-semibold ${tone}`}>{d.action}</span>
                        <span className="text-muted-foreground">{d.reason}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] text-muted-foreground mt-1.5">Nothing is overwritten silently: a missing value never wipes an existing one, identical re-uploads are no-ops, and superseded rows are kept for audit.</p>
              </div>
            )}
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
