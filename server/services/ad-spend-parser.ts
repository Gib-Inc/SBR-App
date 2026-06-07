/**
 * CIPH.R Unified Performance Hub — ad-spend report parser (Meta/Google CSV/XLSX).
 *
 * Reads an exported ad report into a single period-level rollup: platform,
 * date range, spend, impressions, clicks, conversions, revenue. Feeds the
 * marketing_spend_snapshots table.
 *
 * ANTI-HALLUCINATION: extract-only. Spend is REQUIRED — a sheet with no
 * spend/cost column is rejected (ok:false), never zero-filled. Impressions /
 * clicks / period that can't be found are recorded in dataGaps and the result
 * is marked status 'DATA_GAPPED'. Nothing is estimated or trended.
 *
 * The pure core (classifySpreadsheet, detectPlatform, parseAdSpendRows) takes
 * plain objects so it is fully unit-tested without file IO.
 */
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";

export type SpreadsheetKind = "ad_spend" | "pl_xlsx" | "balance_sheet" | "unknown";

export interface AdSpendResult {
  ok: boolean;
  error?: string;
  platform: string;
  periodStart: string | null;
  periodEnd: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  currency: string;
  rowCount: number;
  dataGaps: string[];
  status: "OK" | "DATA_GAPPED";
  warnings: string[];
  detectedFormat?: string;
}

const norm = (s: any) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const num = (v: any): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[$,()%]/g, "").replace(/[a-zA-Z]/g, "").trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : neg ? -n : n;
};

// Find the first header in `keys` whose normalized form matches any candidate
// (exact-normalized OR contains). Returns the original key, or null.
function findCol(keys: string[], candidates: string[]): string | null {
  const nk = keys.map((k) => ({ k, n: norm(k) }));
  for (const cand of candidates) {
    const c = norm(cand);
    const exact = nk.find((x) => x.n === c);
    if (exact) return exact.k;
  }
  for (const cand of candidates) {
    const c = norm(cand);
    const part = nk.find((x) => x.n.includes(c));
    if (part) return part.k;
  }
  return null;
}

const SPEND_COLS = ["amount spent", "amountspentusd", "spend", "cost", "total spent", "amount", "ad spend"];
const IMPR_COLS = ["impressions", "impr", "impressions served"];
const CLICK_COLS = ["link clicks", "clicks", "clicks all"];
const CONV_COLS = ["results", "conversions", "purchases", "conv", "website purchases"];
const REV_COLS = ["purchase conversion value", "conversion value", "conv value", "revenue", "sales", "total conversion value", "purchases conversion value"];
const DATE_COLS = ["day", "date", "reporting starts", "reporting ends", "week", "month", "date range"];
const START_COLS = ["reporting starts", "start date", "day", "date", "week", "month"];
const END_COLS = ["reporting ends", "end date"];
const NAME_COLS = ["campaign name", "campaign", "ad set name", "adset name", "ad name", "ad group", "ad group name"];
const isTotalName = (v: any): boolean => {
  const s = String(v ?? "").trim();
  if (!s) return true; // blank campaign name = Meta/Google account-total row
  return /^(total|account total|grand total|results from \d|—)/i.test(s);
};

export function detectPlatform(keys: string[], fileName = ""): string {
  const hay = norm(fileName + " " + keys.join(" "));
  if (/(meta|facebook|fbads|\bfb\b)/.test(hay) || hay.includes("facebook")) return "META";
  if (hay.includes("google") || hay.includes("adwords")) return "GOOGLE";
  if (hay.includes("amazon")) return "AMAZON";
  if (hay.includes("tiktok")) return "TIKTOK";
  if (hay.includes("microsoft") || hay.includes("bing")) return "MICROSOFT";
  if (hay.includes("pinterest")) return "PINTEREST";
  return "OTHER";
}

// Classify a spreadsheet by its headers + first-column row labels so the
// universal uploader can auto-route without an explicit docType.
export function classifySpreadsheet(keys: string[], firstColLabels: string[] = []): SpreadsheetKind {
  const hasSpend = !!findCol(keys, SPEND_COLS);
  const hasAdSignal = !!findCol(keys, IMPR_COLS) || !!findCol(keys, CLICK_COLS);
  if (hasSpend && hasAdSignal) return "ad_spend";

  const labels = firstColLabels.map(norm);
  const hasLabel = (...c: string[]) => labels.some((l) => c.some((x) => l.includes(norm(x))));
  // P&L: month columns or Total Income / Net Income rows
  const monthHeader = keys.some((k) => /^[a-z]{3}\d{4}$/.test(norm(k))) || keys.some((k) => norm(k) === "current");
  if (monthHeader || hasLabel("total income", "net income", "gross profit", "cost of goods sold")) return "pl_xlsx";
  // Balance sheet: liability/equity labels
  if (hasLabel("total liabilities", "total equity", "accounts payable", "notes payable", "total assets")) return "balance_sheet";
  return "unknown";
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

export function toISODate(v: any): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // M/D/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/); // Mon D, YYYY
  if (m) { const mo = MONTHS[m[1].toLowerCase()]; if (mo) return `${m[3]}-${mo}-${m[2].padStart(2, "0")}`; }
  m = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/); // Mon YYYY
  if (m) { const mo = MONTHS[m[1].toLowerCase()]; if (mo) return `${m[2]}-${mo}-01`; }
  return null;
}

export function parseAdSpendRows(rows: Record<string, any>[], fileName = ""): AdSpendResult {
  const warnings: string[] = [];
  const dataGaps: string[] = [];
  const base: AdSpendResult = {
    ok: false, platform: "OTHER", periodStart: null, periodEnd: null,
    spend: null, impressions: null, clicks: null, conversions: null, revenue: null,
    currency: "USD", rowCount: 0, dataGaps, status: "DATA_GAPPED", warnings,
  };
  if (!rows.length) return { ...base, error: "The file has no data rows." };

  const keys = Object.keys(rows[0]);
  const platform = detectPlatform(keys, fileName);
  if (platform === "OTHER") warnings.push("Platform could not be inferred from the file — stored as OTHER. Rename the file (e.g. include 'Meta' or 'Google') to tag it.");

  const spendCol = findCol(keys, SPEND_COLS);
  if (!spendCol) {
    return { ...base, platform, error: "No spend/cost column found — this doesn't look like an ad-spend report." };
  }
  const imprCol = findCol(keys, IMPR_COLS);
  const clickCol = findCol(keys, CLICK_COLS);
  const convCol = findCol(keys, CONV_COLS);
  const revCol = findCol(keys, REV_COLS);
  const nameCol = findCol(keys, NAME_COLS);
  const startCol = findCol(keys, START_COLS);
  const endCol = findCol(keys, END_COLS);
  const dateCol = startCol || findCol(keys, DATE_COLS);

  // currency from a "(USD)" style spend header or explicit currency column
  let currency = "USD";
  const curMatch = spendCol.match(/\(([A-Z]{3})\)/);
  if (curMatch) currency = curMatch[1];
  const curCol = findCol(keys, ["currency"]);
  if (curCol && rows[0][curCol]) currency = String(rows[0][curCol]).trim().toUpperCase().slice(0, 3) || currency;

  // Exclude summary/total rows so we never double-count. Meta/Google exports
  // include an account-total row (blank or "Total …" campaign name) whose spend
  // equals the sum of the individual rows — adding both would 2× the spend.
  let dataRows = rows;
  let droppedTotalRow = false;
  if (nameCol) {
    const kept = rows.filter((r) => !isTotalName(r[nameCol]));
    if (kept.length && kept.length < rows.length) { dataRows = kept; droppedTotalRow = true; }
  } else {
    // No name column: if one row's spend ≈ the sum of the others, it's the total.
    const spends = rows.map((r) => num(r[spendCol]) ?? 0);
    const grand = spends.reduce((a, b) => a + b, 0);
    const maxIdx = spends.indexOf(Math.max(...spends));
    const maxVal = spends[maxIdx];
    if (rows.length > 2 && maxVal > 0 && Math.abs(maxVal - (grand - maxVal)) <= Math.max(0.02, maxVal * 0.01)) {
      dataRows = rows.filter((_, i) => i !== maxIdx);
      droppedTotalRow = true;
    }
  }
  if (droppedTotalRow) warnings.push("Skipped a summary/total row so spend isn't double-counted.");

  let spend = 0, impressions = 0, clicks = 0, conversions = 0, revenue = 0;
  let anyImpr = false, anyClick = false, anyConv = false, anyRev = false;
  const startDates: string[] = [];
  const endDates: string[] = [];
  for (const r of dataRows) {
    const sv = num(r[spendCol]); if (sv != null) spend += sv;
    if (imprCol) { const v = num(r[imprCol]); if (v != null) { impressions += v; anyImpr = true; } }
    if (clickCol) { const v = num(r[clickCol]); if (v != null) { clicks += v; anyClick = true; } }
    if (convCol) { const v = num(r[convCol]); if (v != null) { conversions += v; anyConv = true; } }
    if (revCol) { const v = num(r[revCol]); if (v != null) { revenue += v; anyRev = true; } }
    if (dateCol) { const d = toISODate(r[dateCol]); if (d) startDates.push(d); }
    if (endCol && endCol !== dateCol) { const d = toISODate(r[endCol]); if (d) endDates.push(d); }
  }

  startDates.sort();
  endDates.sort();
  // Period: prefer a distinct start col (min) + end col (max). Otherwise min/max
  // of the single date column.
  const periodStart = startDates.length ? startDates[0] : null;
  const periodEnd = endDates.length ? endDates[endDates.length - 1] : (startDates.length ? startDates[startDates.length - 1] : null);

  if (!imprCol || !anyImpr) dataGaps.push("DATA GAPPED: impressions");
  if (!clickCol || !anyClick) dataGaps.push("DATA GAPPED: clicks");
  if (!periodStart) dataGaps.push("DATA GAPPED: period");

  return {
    ok: true,
    platform,
    periodStart,
    periodEnd,
    spend: Math.round(spend * 100) / 100,
    impressions: anyImpr ? impressions : null,
    clicks: anyClick ? clicks : null,
    conversions: anyConv ? conversions : null,
    revenue: anyRev ? Math.round(revenue * 100) / 100 : null,
    currency,
    rowCount: dataRows.length,
    dataGaps,
    status: dataGaps.length ? "DATA_GAPPED" : "OK",
    warnings,
    detectedFormat: `${platform} ad report (${dataRows.length} rows)`,
  };
}

// IO wrapper: read a CSV or XLSX buffer to row objects, then parse.
export function readSpreadsheetRows(buffer: Buffer, fileName = "", mime = ""): Record<string, any>[] {
  const isCsv = /\.csv$/i.test(fileName) || mime.includes("csv");
  if (isCsv) {
    return parseCsv(buffer, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }) as Record<string, any>[];
  }
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, any>[];
}

export function parseAdSpendBuffer(buffer: Buffer, fileName = "", mime = ""): AdSpendResult {
  let rows: Record<string, any>[];
  try {
    rows = readSpreadsheetRows(buffer, fileName, mime);
  } catch (e: any) {
    return {
      ok: false, error: `Could not read the file: ${e?.message ?? e}`,
      platform: "OTHER", periodStart: null, periodEnd: null, spend: null, impressions: null,
      clicks: null, conversions: null, revenue: null, currency: "USD", rowCount: 0,
      dataGaps: [], status: "DATA_GAPPED", warnings: [],
    };
  }
  return parseAdSpendRows(rows, fileName);
}
