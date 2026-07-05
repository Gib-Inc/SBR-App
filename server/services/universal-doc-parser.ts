/**
 * CIPH.R — Universal tolerant document parser.
 *
 * GOAL: 100% acceptance. An uploaded financial document must NEVER be bounced.
 * If we can confidently parse it, we do. If the chosen type is wrong, we
 * auto-detect the right one. If we can't map it at all, we still ACCEPT it,
 * normalize it into a clean table preview, and hand it back for review/mapping
 * rather than rejecting it.
 *
 * This does NOT loosen the anti-hallucination guarantee of the specific parsers:
 * numbers are still extract-only and never invented. What changes is the failure
 * mode — "reject" becomes "accept into review", and common format quirks
 * (delimiter, BOM, leading title rows, currency symbols, wrong type picked) are
 * auto-corrected before parsing.
 *
 * Pure helpers (detectDelimiter, findHeaderRow, gridToObjects) are unit-tested
 * without file IO.
 */
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";
import {
  parseAdSpendRows,
  classifySpreadsheet,
} from "./ad-spend-parser";
import { parsePLWorkbook } from "./pl-xlsx-parser";

export interface DocPreview {
  columns: string[];
  rows: Record<string, any>[]; // capped sample
  totalRows: number;
}

export interface SalvageResult {
  accepted: true; // ALWAYS true — we never reject
  docType: string; // 'pl_xlsx' | 'ad_spend' | 'balance_sheet' | 'bank_statement' | 'generic'
  reclassified: boolean; // true when we changed the type the user picked
  needsReview: boolean; // true for generic/low-confidence accepts
  adjustments: string[]; // what we auto-corrected ("detected ; delimiter", "skipped 3 title rows"…)
  message: string; // human summary, always friendly
  fileName: string;
  // payload — at most one of these is set depending on docType
  result?: any; // the specific parser's payload (months / fields / ad rollup)
  preview?: DocPreview; // for generic accepts and as a fallback table
}

const isPdf = (mime: string, fileName: string) =>
  mime === "application/pdf" || /\.pdf$/i.test(fileName);
const looksCsv = (mime: string, fileName: string) =>
  /\.csv$/i.test(fileName) || mime.includes("csv") || mime.includes("text/plain");

/* ----------------------------- pure helpers ----------------------------- */

/** Pick the most likely delimiter from a CSV sample by counting candidates on
 *  the first few non-empty lines and choosing the one with the most consistent,
 *  highest count. Defaults to comma. */
export function detectDelimiter(sample: string): string {
  const candidates = [",", ";", "\t", "|"];
  const lines = sample
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!lines.length) return ",";
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    // consistency: how often the per-line count equals the modal count
    const modal = counts.sort((a, b) => b - a)[Math.floor(counts.length / 2)];
    const consistent = counts.filter((c) => c === modal).length;
    const score = total + consistent * 2;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** First row that looks like a header: the row (within the first 25) with the
 *  most non-empty cells, preferring rows where most cells are non-numeric
 *  (headers are usually labels). Returns 0 if nothing better is found. */
export function findHeaderRow(grid: any[][]): number {
  let bestIdx = 0;
  let bestScore = -1;
  const limit = Math.min(25, grid.length);
  for (let i = 0; i < limit; i++) {
    const row = grid[i] || [];
    const cells = row.map((c) => String(c ?? "").trim());
    const nonEmpty = cells.filter(Boolean);
    if (nonEmpty.length < 2) continue;
    const nonNumeric = nonEmpty.filter((c) => Number.isNaN(Number(c.replace(/[$,%()]/g, "")))).length;
    // reward width + textual headers, lightly penalize how far down it is
    const score = nonEmpty.length * 2 + nonNumeric - i * 0.5;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Turn a raw grid into column-keyed row objects using a detected header row.
 *  De-duplicates/blank-fills header names and drops fully-empty rows. */
export function gridToObjects(grid: any[][]): { columns: string[]; rows: Record<string, any>[]; headerRow: number; adjustments: string[] } {
  const adjustments: string[] = [];
  if (!grid.length) return { columns: [], rows: [], headerRow: 0, adjustments };
  const headerRow = findHeaderRow(grid);
  if (headerRow > 0) adjustments.push(`skipped ${headerRow} leading title row(s)`);
  const rawHeader = (grid[headerRow] || []).map((c) => String(c ?? "").trim());
  const seen: Record<string, number> = {};
  const columns = rawHeader.map((h, i) => {
    let name = h || `Column ${i + 1}`;
    if (seen[name] != null) {
      seen[name] += 1;
      name = `${name} (${seen[name]})`;
    } else {
      seen[name] = 0;
    }
    return name;
  });
  const rows: Record<string, any>[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const cells = grid[r] || [];
    if (!cells.some((c) => String(c ?? "").trim() !== "")) continue; // skip blank rows
    const obj: Record<string, any> = {};
    columns.forEach((col, i) => {
      obj[col] = cells[i] ?? null;
    });
    rows.push(obj);
  }
  return { columns, rows, headerRow, adjustments };
}

/* ------------------------------- IO readers ------------------------------ */

/** Read any CSV/XLSX buffer into a normalized { columns, rows } table, auto-
 *  correcting delimiter, BOM and leading junk rows. Throws only if the bytes are
 *  not a readable spreadsheet at all (e.g. a PDF) — callers catch and fall back. */
export function normalizeTabular(buffer: Buffer, fileName = "", mime = ""): { columns: string[]; rows: Record<string, any>[]; adjustments: string[] } {
  const adjustments: string[] = [];
  let grid: any[][];
  if (looksCsv(mime, fileName)) {
    let text = buffer.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
      adjustments.push("stripped a byte-order mark");
    }
    const delim = detectDelimiter(text);
    if (delim !== ",") adjustments.push(`detected '${delim === "\t" ? "tab" : delim}' as the column separator`);
    grid = parseCsv(text, {
      delimiter: delim,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      bom: true,
    }) as any[][];
  } else {
    const wb = XLSX.read(buffer, { type: "buffer", cellFormula: false, cellHTML: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("No worksheet in the file");
    grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null }) as any[][];
    if (wb.SheetNames.length > 1) adjustments.push(`read the first of ${wb.SheetNames.length} sheets ("${wb.SheetNames[0]}")`);
  }
  const { columns, rows, adjustments: a2 } = gridToObjects(grid);
  return { columns, rows, adjustments: [...adjustments, ...a2] };
}

/* ------------------------------- the salvage ----------------------------- */

const PREVIEW_CAP = 50;

function genericAccept(
  fileName: string,
  message: string,
  preview: DocPreview | undefined,
  adjustments: string[],
): SalvageResult {
  return {
    accepted: true,
    docType: "generic",
    reclassified: true,
    needsReview: true,
    adjustments,
    message,
    fileName,
    preview,
  };
}

/**
 * Parse a financial document with 100% acceptance. Order of attempts:
 *  1. the type the user picked (if its specific parser succeeds);
 *  2. auto-detect the real type and parse that (so a wrong pick still works);
 *  3. generic accept — normalize to a clean table preview (or, for a PDF with no
 *     LLM key, accept-and-store) and flag for review. Never rejects.
 *
 * The LLM-backed PDF parsers (balance sheet / bank statement) are passed in as a
 * callback so this module stays free of the Anthropic dependency and is unit-
 * testable; the route supplies it.
 */
export async function salvageParse(opts: {
  buffer: Buffer;
  fileName: string;
  mime: string;
  requestedType: string; // 'auto' | 'pl_xlsx' | 'ad_spend' | 'balance_sheet' | 'bank_statement'
  llmParse?: (docType: "balance_sheet" | "bank_statement", buffer: Buffer, mime: string) => Promise<{ ok: boolean; [k: string]: any }>;
  hasLlmKey?: boolean;
}): Promise<SalvageResult> {
  const { buffer, fileName, mime, requestedType, llmParse, hasLlmKey } = opts;
  const pdf = isPdf(mime, fileName);

  // Tabular readers we can try without an LLM.
  const tryPl = (): SalvageResult | null => {
    try {
      const r = parsePLWorkbook(buffer);
      if (r.ok) return { accepted: true, docType: "pl_xlsx", reclassified: false, needsReview: !!(r.warnings && r.warnings.length), adjustments: [], message: `Read a monthly P&L — ${r.months.length} month(s).`, fileName, result: r };
    } catch { /* fall through */ }
    return null;
  };
  const tryAd = (): SalvageResult | null => {
    try {
      const rows = readRowsLoose(buffer, fileName, mime);
      if (rows.length) {
        const r = parseAdSpendRows(rows, fileName);
        if (r.ok) return { accepted: true, docType: "ad_spend", reclassified: false, needsReview: r.status === "DATA_GAPPED", adjustments: [], message: `Read an ad-spend report — ${r.platform}, ${r.rowCount} row(s).`, fileName, result: r };
      }
    } catch { /* fall through */ }
    return null;
  };
  const tryLlm = async (t: "balance_sheet" | "bank_statement"): Promise<SalvageResult | null> => {
    // No hasLlmKey gate: the underlying parser reads .xlsx WITHOUT a key, and
    // returns ok:false instantly for a key-less PDF (we then fall through).
    if (!llmParse) return null;
    try {
      const r = await llmParse(t, buffer, mime);
      if (r.ok) return { accepted: true, docType: t, reclassified: false, needsReview: !!(r.dataGaps && r.dataGaps.length), adjustments: [], message: `Read a ${t === "balance_sheet" ? "balance sheet" : "bank statement"}.`, fileName, result: r };
    } catch { /* fall through */ }
    return null;
  };

  // 1) Honor the user's pick first.
  let chosen: SalvageResult | null = null;
  if (requestedType === "pl_xlsx") chosen = tryPl();
  else if (requestedType === "ad_spend") chosen = tryAd();
  else if (requestedType === "balance_sheet") chosen = await tryLlm("balance_sheet");
  else if (requestedType === "bank_statement") chosen = await tryLlm("bank_statement");
  if (chosen) return chosen;

  // 2) Auto-detect and parse the real type (wrong pick or 'auto').
  if (!pdf) {
    let keys: string[] = [];
    let firstCol: string[] = [];
    let columns: string[] = [];
    let rows: Record<string, any>[] = [];
    let normAdjust: string[] = [];
    try {
      const t = normalizeTabular(buffer, fileName, mime);
      columns = t.columns;
      rows = t.rows;
      normAdjust = t.adjustments;
      keys = columns;
      firstCol = rows.map((r) => String(r[columns[0]] ?? "")).filter(Boolean).slice(0, 80);
    } catch { /* not tabular */ }

    const kind = classifySpreadsheet(keys, firstCol);
    // A balance sheet (.xlsx) parses without an LLM key — try it when detected.
    if (kind === "balance_sheet" && requestedType !== "balance_sheet") {
      const r = await tryLlm("balance_sheet");
      if (r) {
        r.reclassified = true;
        r.adjustments = [...normAdjust, ...r.adjustments];
        r.message = "Auto-detected this as a balance sheet and read it. " + r.message;
        return r;
      }
    }
    // try in priority order, skipping the one we already tried
    const order: string[] = [];
    if (kind === "ad_spend") order.push("ad_spend", "pl_xlsx");
    else if (kind === "pl_xlsx") order.push("pl_xlsx", "ad_spend");
    else order.push("ad_spend", "pl_xlsx");
    for (const t of order) {
      if (t === requestedType) continue;
      const r = t === "pl_xlsx" ? tryPl() : tryAd();
      if (r) {
        r.reclassified = true;
        r.adjustments = [...normAdjust, ...r.adjustments];
        r.message = `Auto-detected this as ${t === "pl_xlsx" ? "a monthly P&L" : "an ad-spend report"} and read it. ` + r.message;
        return r;
      }
    }

    // 3a) Generic tabular accept — we read it, we just couldn't map it to a type.
    if (columns.length) {
      return genericAccept(
        fileName,
        `Accepted. We read ${rows.length} row(s) and ${columns.length} column(s) but couldn't match a known financial format — review the preview below and pick a type above to map it in.`,
        { columns, rows: rows.slice(0, PREVIEW_CAP), totalRows: rows.length },
        normAdjust,
      );
    }
  }

  // 3b) PDF (or unreadable bytes). Accept and store; auto-extraction needs the
  //     LLM key. Never reject.
  if (pdf) {
    if (llmParse && hasLlmKey) {
      // last-ditch: try the balance-sheet vision reader so a PDF still yields data
      const r = await tryLlm("balance_sheet");
      if (r) { r.reclassified = requestedType !== "balance_sheet"; return r; }
    }
    return genericAccept(
      fileName,
      hasLlmKey
        ? "Accepted. We couldn't auto-extract figures from this PDF — open it and enter the key numbers using a document type above, or report a discrepancy."
        : "Accepted. To auto-extract figures from PDFs, add an Anthropic API key in Settings → LLM Configuration. Until then, enter the numbers manually using a document type above.",
      undefined,
      [],
    );
  }

  // 3c) Truly unreadable bytes — still accept, never reject.
  return genericAccept(
    fileName,
    "Accepted. We couldn't read this file as a spreadsheet — if it should be one, re-export as .csv or .xlsx and re-upload.",
    undefined,
    [],
  );
}

/** Loose row reader for the ad-spend cascade: normalize to objects (handles odd
 *  delimiters/junk rows) so a quirky ad CSV still parses. */
function readRowsLoose(buffer: Buffer, fileName: string, mime: string): Record<string, any>[] {
  try {
    return normalizeTabular(buffer, fileName, mime).rows;
  } catch {
    return [];
  }
}
