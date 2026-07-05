/**
 * CIPH.R — Monthly P&L (.xlsx) parser for the accountant uploader.
 *
 * Handles the two QuickBooks export layouts we've seen:
 *  - "% of Total Income" (each month is a CURRENT $ column + a % column)
 *  - standard monthly P&L (one value column per month)
 *
 * ANTI-HALLUCINATION: extract-only. If it can't find the month columns or the
 * Total Income / Net Income rows, it returns ok:false with a clear message
 * rather than guessing. Missing line items are left null, never invented.
 */
import * as XLSX from "xlsx";

export interface ParsedMonth {
  month: string;
  totalIncome: number | null;
  totalCogs: number | null;
  grossProfit: number | null;
  totalExpenses: number | null;
  netOperatingIncome: number | null;
  netIncome: number | null;
  expenseCategories: Record<string, number>;
}
export interface ParseResult {
  ok: boolean;
  error?: string;
  detectedFormat?: string;
  months: ParsedMonth[];
  warnings: string[];
}

const num = (v: any): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.round(v * 100) / 100;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[$,()]/g, "");
  const n = Number(s);
  return Number.isNaN(n) ? null : neg ? -n : n;
};

const CAT_LABELS = [
  "Advertising & Marketing", "Contract Labor", "Equipment Rental", "Insurance",
  "Interest, Bank Fees & Service Charges", "Merchant Account Fees", "Office Expenses",
  "Patent Royalties", "Payroll Expenses", "Professional Services - Legal, Accounting, Etc",
  "QuickBooks Payments Fees", "Rent - Building & Property", "Repairs & Maintenance",
  "Shop Supplies", "Taxes Paid - USTC Corporate Tax", "Travel", "Utilities",
  "Vehicle Expenses", "Memberships, Dues & Subscriptions", "Phone & Internet Service",
];

const MONTH_RE = /^[A-Z][a-z]{2}\s+\d{4}$/; // "Jan 2026"

export function parsePLWorkbook(buffer: Buffer): ParseResult {
  const warnings: string[] = [];
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellFormula: false, cellHTML: false });
  } catch (e: any) {
    return { ok: false, error: `Could not read the spreadsheet: ${e?.message ?? e}`, months: [], warnings };
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { ok: false, error: "No worksheet found in the file.", months: [], warnings };
  const g = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null }) as any[][];

  // Detect layout: the "% of Total Income" export has a row of "CURRENT" headers.
  let hr = -1;
  for (let i = 0; i < g.length; i++) {
    if ((g[i] || []).some((c) => String(c).trim().toUpperCase() === "CURRENT")) { hr = i; break; }
  }
  let valueCols: number[] = [];
  let months: string[] = [];
  let format: string;
  if (hr >= 0) {
    (g[hr] || []).forEach((c, idx) => { if (String(c).trim().toUpperCase() === "CURRENT") valueCols.push(idx); });
    months = valueCols.map((c) => String((g[hr - 1] || [])[c] ?? "").trim());
    format = "% of Total Income (CURRENT columns)";
  } else {
    let mr = -1;
    for (let i = 0; i < Math.min(10, g.length); i++) {
      if ((g[i] || []).filter((c) => MONTH_RE.test(String(c ?? "").trim())).length >= 2) { mr = i; break; }
    }
    if (mr < 0) {
      return { ok: false, error: "Couldn't find a month header row (e.g. 'Jan 2026'). Is this a monthly P&L export?", months: [], warnings };
    }
    (g[mr] || []).forEach((c, idx) => { const s = String(c ?? "").trim(); if (MONTH_RE.test(s)) { valueCols.push(idx); months.push(s); } });
    format = "Standard monthly P&L";
  }
  if (!months.length) return { ok: false, error: "No month columns detected in the file.", months: [], warnings };

  const findRow = (...labels: string[]): number => {
    for (let i = 0; i < g.length; i++) {
      const a = g[i] && g[i][0] ? String(g[i][0]).trim().toLowerCase() : "";
      if (labels.some((l) => a === l.toLowerCase())) return i;
    }
    return -1;
  };
  const ser = (...labels: string[]): (number | null)[] | null => {
    const ri = findRow(...labels);
    return ri < 0 ? null : valueCols.map((c) => num(g[ri][c]));
  };

  const totalIncome = ser("Total for Income", "Total Income");
  const netIncome = ser("Net Income");
  if (!totalIncome || !netIncome) {
    return { ok: false, error: `Couldn't find the Total Income / Net Income rows — unrecognized P&L layout (detected: ${format}).`, months: [], warnings };
  }
  const totalCogs = ser("Total for Cost of Goods Sold", "Total Cost of Goods Sold");
  const grossProfit = ser("Gross Profit");
  const totalExpenses = ser("Total for Expenses", "Total Expenses");
  const netOperatingIncome = ser("Net Operating Income");
  if (!totalExpenses) warnings.push("Total Expenses row not found — left blank for affected months.");
  if (!grossProfit) warnings.push("Gross Profit row not found — left blank.");

  const cats: Record<string, (number | null)[]> = {};
  for (const l of CAT_LABELS) {
    const s = ser("Total for " + l, l);
    if (s) cats[l] = s;
  }

  const out: ParsedMonth[] = months
    .map((m, i) => {
      const ec: Record<string, number> = {};
      for (const k of Object.keys(cats)) { const v = cats[k][i]; if (v != null) ec[k] = v; }
      return {
        month: m,
        totalIncome: totalIncome[i],
        totalCogs: totalCogs ? totalCogs[i] : null,
        grossProfit: grossProfit ? grossProfit[i] : null,
        totalExpenses: totalExpenses ? totalExpenses[i] : null,
        netOperatingIncome: netOperatingIncome ? netOperatingIncome[i] : null,
        netIncome: netIncome[i],
        expenseCategories: ec,
      };
    })
    // drop summary/empty columns (e.g. a trailing "Total") with no income or net
    .filter((r) => MONTH_RE.test(r.month) && (r.totalIncome != null || r.netIncome != null));

  if (!out.length) return { ok: false, error: "Found month columns but no values — the export may be an empty template.", months: [], warnings };
  return { ok: true, detectedFormat: format, months: out, warnings };
}
