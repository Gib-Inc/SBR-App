/**
 * Numeric Grounding — anti-hallucination provenance validator for LLM output (P1-4).
 *
 * Two halves:
 *  1. NUMERIC_GROUNDING_CLAUSE — the shared system-prompt clause that forbids the
 *     model from inventing figures (imported by every numeric-facing prompt).
 *  2. A provenance validator: extract the numeric tokens an LLM placed in its
 *     composed text and check each against a whitelist of values that were
 *     actually present in the data payload. Fail-visible, not fail-silent —
 *     callers append a "[data-check: ...]" caution instead of blocking.
 *
 * Token extraction rules (deliberate scope):
 *  - Dollar amounts ($1,234.56) and percents (12.3%) are always extracted.
 *  - Plain numbers are extracted only when >= 32 (small ints are prose:
 *    "3 campaigns", "one of 10", ROAS ratios like 4.2:1).
 *  - Dates (ISO + US), clock times, and bare years 2020-2030 are ignored.
 */

export const NUMERIC_GROUNDING_CLAUSE =
  "Use ONLY the numbers in the data block below. Never estimate, extrapolate, average, or recall figures. If a value is missing, null, or marked stale, state 'data gap' for that value — never substitute a plausible number.";

export interface NumericToken {
  /** The token exactly as it appeared in the text (e.g. "$1,234.56", "12.3%", "4500"). */
  raw: string;
  /** Parsed numeric value (commas stripped, sign-less magnitude preserved). */
  value: number;
  kind: "dollar" | "percent" | "number";
}

export interface NumericValidationResult {
  ok: boolean;
  violations: NumericToken[];
  totalTokens: number;
}

/** Plain (unlabelled) numbers below this are treated as prose, not data claims. */
const PLAIN_NUMBER_MIN = 32;
/** Bare 4-digit integers in this range are calendar years, not figures. */
const YEAR_MIN = 2020;
const YEAR_MAX = 2030;
/** Relative tolerance for "same number, lightly rounded" (0.5%). */
const RELATIVE_TOLERANCE = 0.005;

function parseNumeric(s: string): number {
  return parseFloat(s.replace(/,/g, ""));
}

function countDecimals(raw: string): number {
  const dot = raw.indexOf(".");
  if (dot < 0) return 0;
  return raw.length - dot - 1;
}

/** Replace a matched span with spaces so later passes can't re-match it. */
function maskSpan(text: string, start: number, length: number): string {
  return text.slice(0, start) + " ".repeat(length) + text.slice(start + length);
}

/**
 * Extract the numeric tokens from LLM-composed text that constitute data claims:
 * dollar amounts, percents, and plain numbers >= 32. Dates, times, small ints,
 * and years 2020-2030 are ignored.
 */
export function extractNumericTokens(text: string): NumericToken[] {
  if (!text) return [];

  // Strip date/time shapes first so their digits never become tokens.
  let working = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (m) => " ".repeat(m.length)) // ISO dates
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, (m) => " ".repeat(m.length)) // US dates
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/gi, (m) => " ".repeat(m.length)); // clock times

  const tokens: NumericToken[] = [];

  // 1. Dollar amounts.
  const dollarRe = /\$\s?(\d[\d,]*(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = dollarRe.exec(working)) !== null) {
    tokens.push({ raw: m[0].trim(), value: parseNumeric(m[1]), kind: "dollar" });
    working = maskSpan(working, m.index, m[0].length);
  }

  // 2. Percents.
  const percentRe = /(\d[\d,]*(?:\.\d+)?)\s?%/g;
  while ((m = percentRe.exec(working)) !== null) {
    tokens.push({ raw: m[0].trim(), value: parseNumeric(m[1]), kind: "percent" });
    working = maskSpan(working, m.index, m[0].length);
  }

  // 3. Plain numbers >= 32, excluding bare years 2020-2030.
  const plainRe = /(?<![\d.,])(\d[\d,]*(?:\.\d+)?)(?![\d.,%])/g;
  while ((m = plainRe.exec(working)) !== null) {
    const value = parseNumeric(m[1]);
    if (!isFinite(value) || value < PLAIN_NUMBER_MIN) continue;
    const isBareYear = Number.isInteger(value) && value >= YEAR_MIN && value <= YEAR_MAX && !m[1].includes(",") && !m[1].includes(".");
    if (isBareYear) continue;
    tokens.push({ raw: m[1], value, kind: "number" });
  }

  return tokens;
}

/**
 * Whitelist of ground-truth numeric values. A token matches when it is exact,
 * within 0.5% relative tolerance, or an exact rounding of a whitelisted value
 * to the token's own decimal precision (16.7 -> "17", 1234.56 -> "$1,235").
 */
export class NumericWhitelist {
  private values: number[] = [];

  add(...vals: Array<number | null | undefined>): this {
    for (const v of vals) {
      if (typeof v === "number" && isFinite(v)) {
        this.values.push(Math.abs(v));
      }
    }
    return this;
  }

  size(): number {
    return this.values.length;
  }

  /** Does `token` (with `decimals` of displayed precision) match any whitelisted value? */
  matches(token: number, decimals: number = 0): boolean {
    const t = Math.abs(token);
    for (const w of this.values) {
      if (t === w) return true;
      if (w !== 0 && Math.abs(t - w) / w <= RELATIVE_TOLERANCE) return true;
      // Exact-rounded: the token is the whitelisted value rounded to the
      // precision the token was written with.
      const factor = Math.pow(10, decimals);
      if (Math.round(w * factor) / factor === t) return true;
    }
    return false;
  }
}

/** Build a whitelist from raw values (null/undefined tolerated and skipped). */
export function buildWhitelist(...values: Array<number | null | undefined>): NumericWhitelist {
  return new NumericWhitelist().add(...values);
}

/**
 * Validate LLM-composed text against a whitelist of ground-truth values.
 * Returns every numeric token that cannot be traced to the whitelist.
 * Callers should fail VISIBLE (append a caution, log a warn) — never silently
 * accept, never block the send.
 */
export function validateNumbersAgainstWhitelist(
  output: string,
  whitelist: NumericWhitelist,
): NumericValidationResult {
  const tokens = extractNumericTokens(output);
  const violations = tokens.filter((t) => !whitelist.matches(t.value, countDecimals(t.raw.replace(/[^\d.,]/g, ""))));
  return { ok: violations.length === 0, violations, totalTokens: tokens.length };
}
