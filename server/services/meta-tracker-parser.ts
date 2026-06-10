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
 */

export interface MetaTrackerDay {
  date: string; // YYYY-MM-DD
  spend: number;
  purchases: number;
  conversionValue: number;
}

export interface MetaTrackerParse {
  ok: boolean;
  campaign: string;
  periodStart: string | null;
  periodEnd: string | null;
  days: MetaTrackerDay[];
  totalSpend: number;
  totalPurchases: number;
  totalConversionValue: number;
  roas: number;
  warnings: string[];
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const DAY_ROW = /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*,?\s+([a-z]+)\s+(\d{1,2})\b/i;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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
  const lines = (text || "").split(/\r?\n/);

  // Campaign name: first header-ish line cell that isn't a metric label.
  let campaign = "Meta (manual)";
  for (const line of lines.slice(0, 6)) {
    for (const c of cells(line)) {
      if (/^(summary|ad spend|purchases?|co?n?versions? value|roas|cost per result|total|date|facebook ads|sticker burr)/i.test(c)) continue;
      if (c.length >= 4 && /[a-z]/i.test(c) && !DAY_ROW.test(c)) {
        campaign = c;
        break;
      }
    }
    if (campaign !== "Meta (manual)") break;
  }

  const days: MetaTrackerDay[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const t = line.trim();
    if (!t || /^(weekly report|total\b|summary)/i.test(t)) continue;
    const m = t.match(DAY_ROW);
    if (!m) continue;
    const month = MONTHS[m[1].toLowerCase()];
    const dayNum = parseInt(m[2], 10);
    if (!month || !dayNum || dayNum > 31) continue;

    const cs = cells(t);
    // cells[0] = the date label; metrics follow: spend, purchases, value, roas, cpr
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
    days.push({ date, spend: r2(spend), purchases: Math.round(purchases ?? 0), conversionValue: r2(value ?? 0) });
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  const totalSpend = r2(days.reduce((s, d) => s + d.spend, 0));
  const totalPurchases = days.reduce((s, d) => s + d.purchases, 0);
  const totalConversionValue = r2(days.reduce((s, d) => s + d.conversionValue, 0));

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
    warnings: days.length ? warnings : [...warnings, "No spend days found — check the paste includes the daily rows."],
  };
}
