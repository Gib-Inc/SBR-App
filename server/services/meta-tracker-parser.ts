/**
 * MetaTrackerParser — parses the team's Facebook Ads tracker (the block Kevin/
 * Matt maintain in Sheets) pasted as raw text. Meta's platform flagged the
 * Windsor OAuth connection, so Meta spend arrives manually for now — this
 * parser + the manual-ingest endpoint make that a 10-second paste in the app
 * instead of a side-channel.
 *
 * Expected shape (tab- or multi-space-separated, tolerant):
 *   Summary ... <Campaign Name>           ← campaign column header (optional)
 *   Monday, June 1   $305.98  4  $986.05  3.22  $76.50  ...
 *   Weekly Report / Total rows            ← ignored (recomputed from days)
 *   $0.00 days                            ← ignored (future placeholder rows)
 *
 * Output: per-day rows (date, spend, purchases, conversionValue) from the
 * FIRST metric block (the Summary block), plus totals computed from the parsed
 * days, the covered period, and the campaign name when detectable. Pure +
 * deterministic (clock injected) — unit tested against Matt's real pastes.
 *
 * GUARDS (Jul 2026): literal broken-formula tokens (#REF!/#DIV/0!/#VALUE!/#N/A)
 * are collected and NAMED — a broken SUMMARY/total cell or >5% broken data rows
 * rejects the paste; below that, broken rows are skipped and hard-flagged. A
 * COGS/margin column (rare) gets missing-COGS rows excluded from margin/ROAS
 * aggregates with a named data gap. Nothing is ever zero-filled.
 */
import { createHash } from "node:crypto";

export interface MetaTrackerDay {
  date: string; // YYYY-MM-DD
  spend: number;
  purchases: number;
  conversionValue: number;
  /** Present only when the paste carries a COGS/margin column. null = missing (0/blank/broken) — a DATA GAP, never plugged. */
  cogs?: number | null;
}

/** A literal spreadsheet error token found in a consumed cell (#REF!, #DIV/0!, #VALUE!, #N/A). */
export interface BrokenCell {
  row: number; // 1-based line number in the paste
  column: string; // consumed column name ("spend", "conversionValue", …) or "col N" for summary cells
  token: string; // the literal broken token, e.g. "#REF!"
}

export interface MetaTrackerParse {
  ok: boolean;
  /** Set to "broken formula cells" when the paste is rejected by the broken-cell guard. */
  error?: string;
  campaign: string;
  periodStart: string | null;
  periodEnd: string | null;
  days: MetaTrackerDay[];
  totalSpend: number;
  totalPurchases: number;
  totalConversionValue: number;
  roas: number;
  /** Broken formula cells found in consumed cells — always named, never silently eaten. */
  brokenCells: BrokenCell[];
  /** Named data gaps (e.g. missing COGS) — stated, never zero-filled. */
  dataGaps: string[];
  /** True when the paste carries a COGS/margin column. */
  hasCogsColumn: boolean;
  /** Sum of COGS over rows that HAVE COGS (null when no COGS column / no rows with COGS). */
  totalCogs: number | null;
  /** Margin (conversionValue − COGS) and margin-ROAS computed ONLY over rows with COGS — rows missing COGS are excluded, not plugged. */
  totalMargin: number | null;
  marginRoas: number | null;
  warnings: string[];
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const DAY_ROW = /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*,?\s+([a-z]+)\s+(\d{1,2})\b/i;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Literal spreadsheet error tokens. The source workbook currently carries
// hundreds of broken formula cells (#REF! etc.) — the guard NAMES them instead
// of letting money() quietly turn them into skipped rows.
const BROKEN_TOKEN = /#REF!|#DIV\/0!|#VALUE!|#N\/A/;

/** sha256 of the raw pasted text — byte-identical re-paste dedup for /ingest. */
export function hashRawText(text: string): string {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
}

function money(s: string | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Split a row on tabs when present, else runs of 2+ spaces. */
function cells(line: string): string[] {
  const byTab = line.split("\t").map((c) => c.trim());
  if (byTab.length > 2) return byTab;
  return line.trim().split(/\s{2,}/).map((c) => c.trim());
}

/**
 * Infer the year for "June 1"-style dates (the tracker omits it): use the
 * reference year, but if that lands more than ~45 days in the future, it's
 * last year's sheet (e.g. a December tracker pasted in January).
 */
export function inferYear(month: number, day: number, now: Date): number {
  const y = now.getFullYear();
  const candidate = new Date(Date.UTC(y, month - 1, day));
  const horizon = new Date(now.getTime() + 45 * 86_400_000);
  return candidate.getTime() > horizon.getTime() ? y - 1 : y;
}

export function parseMetaTracker(text: string, now: Date = new Date()): MetaTrackerParse {
  const warnings: string[] = [];
  const dataGaps: string[] = [];
  const brokenCells: BrokenCell[] = [];
  const lines = (text || "").split(/\r?\n/);

  // Campaign name: first header-ish line cell that isn't a metric label.
  let campaign = "Meta (manual)";
  for (const line of lines.slice(0, 6)) {
    for (const c of cells(line)) {
      if (/^(summary|ad spend|purchases?|co?n?versions? value|roas|cost per result|total|date|facebook ads|sticker burr|cogs|cost of goods|gross margin|margin)/i.test(c)) continue;
      if (c.length >= 4 && /[a-z]/i.test(c) && !DAY_ROW.test(c) && !BROKEN_TOKEN.test(c)) {
        campaign = c;
        break;
      }
    }
    if (campaign !== "Meta (manual)") break;
  }

  // COGS/margin column: detected from the first metric-header row (the one that
  // names "Ad Spend"). Typical Meta pastes have none — then this is a no-op.
  let cogsIdx = -1;
  for (const line of lines) {
    const cs = cells(line);
    if (!cs.some((c) => /^ad ?spend/i.test(c))) continue;
    cogsIdx = cs.findIndex((c) => /^(cogs|cost of goods|gross margin|margin)\b/i.test(c));
    break;
  }
  const hasCogsColumn = cogsIdx >= 0;

  const days: MetaTrackerDay[] = [];
  const seen = new Set<string>();
  let summaryBroken = false;
  let dayRowCount = 0;
  let brokenDayRows = 0;

  for (let li = 0; li < lines.length; li++) {
    const t = lines[li].trim();
    if (!t) continue;

    // SUMMARY/total rows: not consumed for numbers (totals are recomputed from
    // days) but a broken token here means the sheet itself is broken → reject.
    if (/^(weekly report|total\b|summary)/i.test(t)) {
      cells(t).forEach((c, ci) => {
        const tok = c.match(BROKEN_TOKEN);
        if (tok) {
          brokenCells.push({ row: li + 1, column: `col ${ci + 1}`, token: tok[0] });
          summaryBroken = true;
        }
      });
      continue;
    }

    const m = t.match(DAY_ROW);
    if (!m) continue;
    const month = MONTHS[m[1].toLowerCase()];
    const dayNum = parseInt(m[2], 10);
    if (!month || !dayNum || dayNum > 31) continue;
    dayRowCount++;

    const cs = cells(t);
    // cells[0] = the date label; metrics follow: spend, purchases, value, roas, cpr
    const consumed: Array<[number, string]> = [[1, "spend"], [2, "purchases"], [3, "conversionValue"]];
    if (hasCogsColumn) consumed.push([cogsIdx, "cogs"]);
    let rowBroken = false;
    for (const [ci, name] of consumed) {
      const tok = (cs[ci] ?? "").match(BROKEN_TOKEN);
      if (tok) {
        brokenCells.push({ row: li + 1, column: name, token: tok[0] });
        rowBroken = true;
      }
    }
    if (rowBroken) {
      brokenDayRows++;
      warnings.push(`Broken formula cell(s) on "${t.slice(0, 32)}…" — row skipped (hard-flagged, not plugged).`);
      continue;
    }

    const spend = money(cs[1]);
    const purchases = money(cs[2]);
    const value = money(cs[3]);
    if (spend == null) {
      warnings.push(`Could not read spend on "${t.slice(0, 32)}…" — row skipped.`);
      continue;
    }
    if (spend <= 0 && (value ?? 0) <= 0) continue; // future placeholder rows

    const year = inferYear(month, dayNum, now);
    const date = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    if (seen.has(date)) {
      warnings.push(`Duplicate row for ${date} — kept the first.`);
      continue;
    }
    seen.add(date);
    const day: MetaTrackerDay = { date, spend: r2(spend), purchases: Math.round(purchases ?? 0), conversionValue: r2(value ?? 0) };
    if (hasCogsColumn) {
      const cogs = money(cs[cogsIdx]);
      day.cogs = cogs != null && cogs > 0 ? r2(cogs) : null; // 0/blank COGS = missing, never plugged
    }
    days.push(day);
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  const totalSpend = r2(days.reduce((s, d) => s + d.spend, 0));
  const totalPurchases = days.reduce((s, d) => s + d.purchases, 0);
  const totalConversionValue = r2(days.reduce((s, d) => s + d.conversionValue, 0));

  // BROKEN-CELL GUARD: a broken SUMMARY/total cell, or >5% of data rows broken,
  // rejects the whole paste — the caller must fix the sheet, we never eat it.
  if (summaryBroken || (dayRowCount > 0 && brokenDayRows / dayRowCount > 0.05)) {
    return {
      ok: false,
      error: "broken formula cells",
      campaign, periodStart: null, periodEnd: null, days: [],
      totalSpend: 0, totalPurchases: 0, totalConversionValue: 0, roas: 0,
      brokenCells, dataGaps, hasCogsColumn, totalCogs: null, totalMargin: null, marginRoas: null,
      warnings: [
        ...warnings,
        summaryBroken
          ? `Broken formula token in a SUMMARY/total cell — paste rejected. Fix the sheet and re-paste (${brokenCells.length} broken cell(s) named).`
          : `${brokenDayRows} of ${dayRowCount} data rows (${Math.round((brokenDayRows / dayRowCount) * 100)}%) have broken formula cells — paste rejected. Fix the sheet and re-paste.`,
      ],
    };
  }

  // COGS GUARD: margin/ROAS aggregates ONLY over rows that have COGS; rows with
  // COGS 0/null are excluded and surfaced as a named data gap — never plugged.
  let totalCogs: number | null = null;
  let totalMargin: number | null = null;
  let marginRoas: number | null = null;
  if (hasCogsColumn) {
    const withCogs = days.filter((d) => d.cogs != null);
    const missing = days.length - withCogs.length;
    if (missing > 0) dataGaps.push(`COGS missing for ${missing} row${missing === 1 ? "" : "s"} — margin/ROAS on those rows not computed`);
    if (withCogs.length > 0) {
      totalCogs = r2(withCogs.reduce((s, d) => s + (d.cogs as number), 0));
      totalMargin = r2(withCogs.reduce((s, d) => s + (d.conversionValue - (d.cogs as number)), 0));
      const spendWithCogs = withCogs.reduce((s, d) => s + d.spend, 0);
      marginRoas = spendWithCogs > 0 ? r2((totalMargin as number) / spendWithCogs) : null;
    }
  }

  return {
    ok: days.length > 0,
    campaign,
    periodStart: days[0]?.date ?? null,
    periodEnd: days[days.length - 1]?.date ?? null,
    days,
    totalSpend,
    totalPurchases,
    totalConversionValue,
    roas: totalSpend > 0 ? r2(totalConversionValue / totalSpend) : 0,
    brokenCells,
    dataGaps,
    hasCogsColumn,
    totalCogs,
    totalMargin,
    marginRoas,
    warnings: days.length ? warnings : [...warnings, "No spend days found — check the paste includes the daily rows."],
  };
}
