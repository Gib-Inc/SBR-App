/**
 * CIPH.R — Balance Sheet + Bank Statement parser for the accountant uploader.
 *
 * Mirrors invoice-parser-service.ts: Claude vision reads a PDF/image and returns
 * structured JSON we hydrate a REVIEW screen from. Nothing is written until the
 * operator confirms (review-then-apply), so a misparse can't silently overwrite
 * the books. Balance Sheets can also arrive as .xlsx (label-scan fallback).
 *
 * ANTI-HALLUCINATION: extract-only. Every field Claude can't find is left null
 * and recorded in dataGaps as "DATA GAPPED: <field>" — never invented. The
 * vision prompt explicitly forbids guessing, and confidence is the share of
 * core fields actually populated.
 */
import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";

const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

// ---- shared shapes -------------------------------------------------------

export interface LoanLine {
  name: string;
  balance: number | null;
  term: "short" | "long" | null;
}

export interface BalanceSheetFields {
  asOf: string | null;
  basis: string | null;
  cash: number | null;
  accountsReceivable: number | null;
  inventory: number | null;
  totalCurrentAssets: number | null;
  totalAssets: number | null;
  accountsPayable: number | null;
  creditCards: number | null;
  salesTaxToPay: number | null;
  shortTermNotes: number | null;
  longTermLiabilities: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  loans: LoanLine[];
}

export interface BankStatementFields {
  accountName: string | null;
  bankName: string | null;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  totalDeposits: number | null;
  totalWithdrawals: number | null;
}

export interface ParsedDoc<T> {
  ok: boolean;
  error?: string;
  detectedFormat?: string;
  fields: T;
  loans?: LoanLine[];
  dataGaps: string[];
  confidence: number; // 0-100
  rawResponse?: string;
}

// core fields whose presence drives confidence + DATA GAPPED for each doc type
const BS_CORE: (keyof BalanceSheetFields)[] = [
  "cash", "accountsReceivable", "accountsPayable", "inventory",
  "creditCards", "shortTermNotes", "totalLiabilities", "totalEquity",
];
const BANK_CORE: (keyof BankStatementFields)[] = [
  "closingBalance", "openingBalance", "totalDeposits", "totalWithdrawals",
];

export const numOrNull = (v: any): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  let s = String(v).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s); // accounting negatives: (1,234.00)
  s = s.replace(/[$,()]/g, "").trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : neg ? -n : n;
};

const strOrNull = (v: any): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

// ---- pure normalizers (unit-tested) -------------------------------------

export function normalizeBalanceSheet(obj: any): { fields: BalanceSheetFields; dataGaps: string[]; confidence: number } {
  const o = obj && typeof obj === "object" ? obj : {};
  const loansRaw = Array.isArray(o.loans) ? o.loans : [];
  const loans: LoanLine[] = loansRaw
    .map((l: any) => ({
      name: strOrNull(l?.name) ?? "",
      balance: numOrNull(l?.balance),
      term: l?.term === "short" || l?.term === "long" ? l.term : null,
    }))
    .filter((l: LoanLine) => l.name);

  const fields: BalanceSheetFields = {
    asOf: strOrNull(o.asOf),
    basis: strOrNull(o.basis),
    cash: numOrNull(o.cash),
    accountsReceivable: numOrNull(o.accountsReceivable),
    inventory: numOrNull(o.inventory),
    totalCurrentAssets: numOrNull(o.totalCurrentAssets),
    totalAssets: numOrNull(o.totalAssets),
    accountsPayable: numOrNull(o.accountsPayable),
    creditCards: numOrNull(o.creditCards),
    salesTaxToPay: numOrNull(o.salesTaxToPay),
    shortTermNotes: numOrNull(o.shortTermNotes),
    longTermLiabilities: numOrNull(o.longTermLiabilities),
    totalLiabilities: numOrNull(o.totalLiabilities),
    totalEquity: numOrNull(o.totalEquity),
    loans,
  };

  const dataGaps: string[] = [];
  let have = 0;
  for (const k of BS_CORE) {
    if (fields[k] == null) dataGaps.push(`DATA GAPPED: ${k}`);
    else have++;
  }
  const confidence = Math.round((have / BS_CORE.length) * 100);
  return { fields, dataGaps, confidence };
}

export function normalizeBankStatement(obj: any): { fields: BankStatementFields; dataGaps: string[]; confidence: number } {
  const o = obj && typeof obj === "object" ? obj : {};
  const fields: BankStatementFields = {
    accountName: strOrNull(o.accountName),
    bankName: strOrNull(o.bankName),
    statementPeriodStart: strOrNull(o.statementPeriodStart),
    statementPeriodEnd: strOrNull(o.statementPeriodEnd),
    openingBalance: numOrNull(o.openingBalance),
    closingBalance: numOrNull(o.closingBalance),
    totalDeposits: numOrNull(o.totalDeposits),
    totalWithdrawals: numOrNull(o.totalWithdrawals),
  };
  const dataGaps: string[] = [];
  let have = 0;
  for (const k of BANK_CORE) {
    if (fields[k] == null) dataGaps.push(`DATA GAPPED: ${k}`);
    else have++;
  }
  const confidence = Math.round((have / BANK_CORE.length) * 100);
  return { fields, dataGaps, confidence };
}

// ---- xlsx balance-sheet fallback (label scan, unit-tested) --------------

const BS_LABELS: Record<keyof Omit<BalanceSheetFields, "asOf" | "basis" | "loans">, string[]> = {
  cash: ["total bank accounts", "total cash", "cash and cash equivalents", "total bank"],
  accountsReceivable: ["total accounts receivable", "accounts receivable (a/r)", "total a/r"],
  inventory: ["inventory", "inventory asset", "total inventory"],
  totalCurrentAssets: ["total current assets"],
  totalAssets: ["total assets"],
  accountsPayable: ["total accounts payable", "accounts payable (a/p)", "total a/p"],
  creditCards: ["total credit cards", "credit cards"],
  salesTaxToPay: ["sales tax payable", "total sales tax payable", "sales tax to pay"],
  shortTermNotes: ["total notes payable", "notes payable", "total short-term notes", "short-term notes payable"],
  longTermLiabilities: ["total long-term liabilities", "long-term liabilities", "total long term liabilities"],
  totalLiabilities: ["total liabilities"],
  totalEquity: ["total equity", "total stockholders' equity", "total owner's equity"],
};

export function parseBalanceSheetXlsx(buffer: Buffer): ParsedDoc<BalanceSheetFields> {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellFormula: false, cellHTML: false });
  } catch (e: any) {
    return emptyBS(`Could not read the spreadsheet: ${e?.message ?? e}`);
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return emptyBS("No worksheet found in the file.");
  const g = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null }) as any[][];

  const lastNum = (row: any[]): number | null => {
    for (let i = row.length - 1; i >= 1; i--) {
      const n = numOrNull(row[i]);
      if (n != null) return n;
    }
    return null;
  };
  const raw: any = {};
  for (const row of g) {
    const label = String((row && row[0]) ?? "").trim().toLowerCase();
    if (!label) continue;
    for (const key of Object.keys(BS_LABELS) as (keyof typeof BS_LABELS)[]) {
      if (raw[key] != null) continue;
      if (BS_LABELS[key].some((l) => label === l)) {
        const v = lastNum(row);
        if (v != null) raw[key] = v;
      }
    }
  }
  const { fields, dataGaps, confidence } = normalizeBalanceSheet(raw);
  if (confidence === 0) {
    return { ...emptyBS("Couldn't find balance-sheet rows (Cash, Accounts Payable, Total Liabilities…). The export may be an empty template — try the PDF instead."), detectedFormat: "Balance Sheet (.xlsx)" };
  }
  return { ok: true, detectedFormat: "Balance Sheet (.xlsx)", fields, loans: fields.loans, dataGaps, confidence };
}

function emptyBS(error: string): ParsedDoc<BalanceSheetFields> {
  const { fields, dataGaps, confidence } = normalizeBalanceSheet({});
  return { ok: false, error, fields, loans: [], dataGaps, confidence };
}

// ---- Claude vision callers ----------------------------------------------

const BS_SYSTEM = `Extract the company Balance Sheet into JSON. Return ONLY valid JSON, no markdown, no commentary. Schema:
{
  "asOf": "YYYY-MM-DD" or null,
  "basis": "Accrual" | "Cash" | null,
  "cash": number or null (total of all bank/cash accounts),
  "accountsReceivable": number or null,
  "inventory": number or null,
  "totalCurrentAssets": number or null,
  "totalAssets": number or null,
  "accountsPayable": number or null,
  "creditCards": number or null (total credit-card liabilities),
  "salesTaxToPay": number or null,
  "shortTermNotes": number or null (total short-term notes/loans payable),
  "longTermLiabilities": number or null,
  "totalLiabilities": number or null,
  "totalEquity": number or null,
  "loans": [ { "name": string, "balance": number, "term": "short" | "long" or null } ]
}
For "loans", list EVERY individually-named note payable, loan, line of credit, or credit facility in the liabilities section, with its balance and whether it is short- or long-term. Use null for anything not present. NEVER invent or estimate a number.`;

const BANK_SYSTEM = `Extract this bank statement summary into JSON. Return ONLY valid JSON, no markdown, no commentary. Schema:
{
  "accountName": string or null,
  "bankName": string or null,
  "statementPeriodStart": "YYYY-MM-DD" or null,
  "statementPeriodEnd": "YYYY-MM-DD" or null,
  "openingBalance": number or null,
  "closingBalance": number or null (the ending balance for the period),
  "totalDeposits": number or null,
  "totalWithdrawals": number or null
}
Use null for anything not present. NEVER invent or estimate a number.`;

async function callVisionJson(
  fileBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  systemPrompt: string,
  userText: string,
): Promise<{ obj: any | null; error?: string; rawResponse?: string }> {
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");
  if (!isPdf && !isImage) return { obj: null, error: `Unsupported file type: ${mimeType}` };

  const client = new Anthropic({ apiKey });
  const base64 = fileBuffer.toString("base64");
  const userContent: any[] = [{ type: "text", text: userText }];
  if (isPdf) {
    userContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } });
  } else {
    userContent.push({ type: "image", source: { type: "base64", media_type: mimeType, data: base64 } });
  }

  let rawResponse = "";
  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
    rawResponse = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  } catch (err: any) {
    return { obj: null, error: err?.message ?? "Anthropic API call failed" };
  }
  const cleaned = rawResponse.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return { obj: JSON.parse(cleaned), rawResponse };
  } catch (err: any) {
    return { obj: null, error: `Could not parse Claude response as JSON: ${err?.message ?? "unknown"}`, rawResponse };
  }
}

export async function parseBalanceSheetDoc(buffer: Buffer, mimeType: string, apiKey: string): Promise<ParsedDoc<BalanceSheetFields>> {
  const isXlsx = mimeType.includes("sheet") || mimeType.includes("excel") || mimeType === "application/octet-stream";
  if (isXlsx && mimeType !== "application/pdf") {
    return parseBalanceSheetXlsx(buffer);
  }
  if (!apiKey) return { ...emptyBS("No Anthropic API key configured. Add your key in Settings → LLM Configuration."), detectedFormat: "Balance Sheet (PDF)" };
  const { obj, error, rawResponse } = await callVisionJson(buffer, mimeType, apiKey, BS_SYSTEM, "Extract the balance sheet. Reply with the JSON only.");
  if (!obj) return { ...emptyBS(error || "Could not read the document."), detectedFormat: "Balance Sheet (PDF)", rawResponse };
  const { fields, dataGaps, confidence } = normalizeBalanceSheet(obj);
  if (confidence === 0) return { ...emptyBS("No balance-sheet figures could be extracted from this document."), detectedFormat: "Balance Sheet (PDF)", rawResponse };
  return { ok: true, detectedFormat: "Balance Sheet (PDF)", fields, loans: fields.loans, dataGaps, confidence, rawResponse };
}

export async function parseBankStatementDoc(buffer: Buffer, mimeType: string, apiKey: string): Promise<ParsedDoc<BankStatementFields>> {
  const empty = (error: string, fmt = "Bank statement (PDF)"): ParsedDoc<BankStatementFields> => {
    const { fields, dataGaps, confidence } = normalizeBankStatement({});
    return { ok: false, error, detectedFormat: fmt, fields, dataGaps, confidence };
  };
  if (!apiKey) return empty("No Anthropic API key configured. Add your key in Settings → LLM Configuration.");
  const { obj, error, rawResponse } = await callVisionJson(buffer, mimeType, apiKey, BANK_SYSTEM, "Extract the bank statement summary. Reply with the JSON only.");
  if (!obj) return { ...empty(error || "Could not read the document."), rawResponse };
  const { fields, dataGaps, confidence } = normalizeBankStatement(obj);
  if (fields.closingBalance == null) {
    return { ...empty("Couldn't find an ending/closing balance on this statement."), fields, dataGaps, confidence, rawResponse };
  }
  return { ok: true, detectedFormat: "Bank statement (PDF)", fields, dataGaps, confidence, rawResponse };
}
