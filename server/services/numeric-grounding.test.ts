/**
 * P1-4 — numeric provenance validator tests.
 * Exact / rounded / violation / small-int-ignore behavior for the
 * anti-hallucination gate that checks LLM-composed text against the
 * values actually present in the data payload.
 */
import { describe, it, expect } from "vitest";
import {
  extractNumericTokens,
  buildWhitelist,
  validateNumbersAgainstWhitelist,
  NUMERIC_GROUNDING_CLAUSE,
} from "./numeric-grounding";

describe("extractNumericTokens", () => {
  it("extracts dollar amounts with commas and decimals", () => {
    const tokens = extractNumericTokens("Spend: $1,234.56 and $0.99 and $ 42");
    expect(tokens.map(t => t.value)).toEqual([1234.56, 0.99, 42]);
    expect(tokens.every(t => t.kind === "dollar")).toBe(true);
  });

  it("extracts percents regardless of size", () => {
    const tokens = extractNumericTokens("Return rate: 3.4% vs 27% baseline");
    expect(tokens.map(t => t.value)).toEqual([3.4, 27]);
    expect(tokens.every(t => t.kind === "percent")).toBe(true);
  });

  it("extracts plain numbers only when >= 32", () => {
    const tokens = extractNumericTokens("31 units then 32 units then 4,500 impressions");
    expect(tokens.map(t => t.value)).toEqual([32, 4500]);
  });

  it("ignores small ints used as prose and ROAS ratios", () => {
    expect(extractNumericTokens("3 campaigns, ROAS 4.2:1, one of 10")).toEqual([]);
  });

  it("ignores bare years 2020-2030 but not adjacent values", () => {
    const tokens = extractNumericTokens("2026 targets vs 2019 and 2031");
    expect(tokens.map(t => t.value)).toEqual([2019, 2031]);
  });

  it("still extracts a comma-formatted or dollar value in the year range", () => {
    const tokens = extractNumericTokens("owed $2,026 total 2,025");
    expect(tokens.map(t => t.value)).toEqual([2026, 2025]);
  });

  it("ignores dates and clock times", () => {
    expect(extractNumericTokens("2026-07-16 TRAP CHECK at 7:30 AM on 07/16/2026")).toEqual([]);
  });

  it("returns empty for empty/no-number text", () => {
    expect(extractNumericTokens("")).toEqual([]);
    expect(extractNumericTokens("no figures here")).toEqual([]);
  });
});

describe("buildWhitelist / matches", () => {
  it("matches exact values", () => {
    const wl = buildWhitelist(1234.56, 88);
    expect(wl.matches(1234.56, 2)).toBe(true);
    expect(wl.matches(88, 0)).toBe(true);
  });

  it("matches within 0.5% relative tolerance", () => {
    const wl = buildWhitelist(1234.56);
    expect(wl.matches(1230, 0)).toBe(true); // 0.37% off
    expect(wl.matches(1100, 0)).toBe(false); // ~11% off
  });

  it("matches exact-rounded to the token's precision", () => {
    const wl = buildWhitelist(16.666, 1234.56);
    expect(wl.matches(17, 0)).toBe(true);    // round(16.666, 0) = 17
    expect(wl.matches(16.7, 1)).toBe(true);  // round(16.666, 1) = 16.7
    expect(wl.matches(1235, 0)).toBe(true);  // round(1234.56, 0) = 1235
    expect(wl.matches(18, 0)).toBe(false);
  });

  it("skips null/undefined and rejects when empty", () => {
    const wl = buildWhitelist(null, undefined);
    expect(wl.size()).toBe(0);
    expect(wl.matches(100, 0)).toBe(false);
  });
});

describe("validateNumbersAgainstWhitelist", () => {
  it("passes when every figure traces to the whitelist (incl. rounding)", () => {
    const wl = buildWhitelist(4321.77, 16.666, 45231);
    const out = "Spend: $4,321.77 | Return rate: 16.7% | Impressions: 45,231";
    const result = validateNumbersAgainstWhitelist(out, wl);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.totalTokens).toBe(3);
  });

  it("flags fabricated figures as violations", () => {
    const wl = buildWhitelist(4321.77);
    const result = validateNumbersAgainstWhitelist("Spend: $4,321.77 | Sales: $9,999.99", wl);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].raw).toBe("$9,999.99");
    expect(result.violations[0].value).toBe(9999.99);
  });

  it("does not flag small ints, years, dates, or times", () => {
    const wl = buildWhitelist(); // empty whitelist
    const out = "2026-07-16 TRAP CHECK\n3 campaigns flagged at 7:30 AM. ROAS 4.2:1. 2026 target on track.";
    expect(validateNumbersAgainstWhitelist(out, wl).ok).toBe(true);
  });

  it("flags an unverified percent", () => {
    const wl = buildWhitelist(12);
    const result = validateNumbersAgainstWhitelist("Conversion at 23.5%", wl);
    expect(result.ok).toBe(false);
    expect(result.violations[0].raw).toBe("23.5%");
  });
});

describe("NUMERIC_GROUNDING_CLAUSE", () => {
  it("carries the verbatim anti-hallucination directives", () => {
    expect(NUMERIC_GROUNDING_CLAUSE).toContain("Use ONLY the numbers in the data block below");
    expect(NUMERIC_GROUNDING_CLAUSE).toContain("Never estimate, extrapolate, average, or recall figures");
    expect(NUMERIC_GROUNDING_CLAUSE).toContain("data gap");
  });
});
