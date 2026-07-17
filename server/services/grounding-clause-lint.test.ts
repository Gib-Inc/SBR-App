/**
 * P1-4 — numeric-grounding prompt-clause lint.
 *
 * Every numeric-facing LLM prompt site must carry the grounding clause:
 * either an import of NUMERIC_GROUNDING_CLAUSE (numeric-grounding.ts) or the
 * literal "Use ONLY the numbers", or — where the clause was deliberately
 * adapted to the task (price extraction from scraped pages, ZO.BOT task
 * inputs, vendor-email extraction) — that site's reviewed anchor phrases.
 *
 * File-content assertions (same approach as source-of-truth-lint.test.ts): a
 * future prompt edit that drops the clause fails CI instead of silently
 * reopening the fabricated-figures hole.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER_ROOT = join(__dirname, "..");

const read = (relPath: string) => readFileSync(join(SERVER_ROOT, relPath), "utf8");

const IMPORT_RE = /import\s*\{[^}]*NUMERIC_GROUNDING_CLAUSE[^}]*\}\s*from\s*["'][^"']*numeric-grounding["']/;
const LITERAL = "Use ONLY the numbers";

/** The seven prompt sites (llm.ts carries three of them). */
const SITES: Array<{
  file: string;
  site: string;
  /** every anchor must be present in the file */
  anchors: Array<string | RegExp>;
}> = [
  {
    file: "services/llm.ts",
    site: "order_recommendation system prompt",
    anchors: [
      IMPORT_RE,
      // the order_recommendation system template interpolates the clause
      /Analyze inventory data and provide recommendations[^`]*\$\{NUMERIC_GROUNDING_CLAUSE\}/,
    ],
  },
  {
    file: "services/llm.ts",
    site: "price_extraction adapted clause",
    anchors: [
      "Extract prices ONLY from the provided text",
      "never estimate, recall, or invent a price",
      "never substitute a plausible number",
    ],
  },
  {
    file: "services/llm.ts",
    site: "generic request system prompt",
    anchors: [
      /expert inventory management AI assistant[^`]*\$\{NUMERIC_GROUNDING_CLAUSE\}/,
    ],
  },
  {
    file: "services/ai-system-reviewer.ts",
    site: "system reviewer grounding block",
    anchors: [LITERAL],
  },
  {
    file: "routes/marketing-analytics-cmo-api.ts",
    site: "CMO advisor system prompt",
    anchors: [IMPORT_RE, /\$\{NUMERIC_GROUNDING_CLAUSE\}/],
  },
  {
    file: "routes/ghl-agent-api.ts",
    site: "GHL agent prompt",
    anchors: [IMPORT_RE, /\$\{NUMERIC_GROUNDING_CLAUSE\}/],
  },
  {
    file: "services/zobot-pipeline.ts",
    site: "ZO.BOT system base adapted clause",
    anchors: [
      "Use ONLY numbers given in this prompt or in the task input",
      "Never estimate, extrapolate, average, or recall figures",
    ],
  },
  {
    file: "services/vendor-email-po-service.ts",
    site: "vendor-email extraction adapted clause",
    anchors: [
      "NEVER invent, estimate, or infer a value that is not stated in the email",
      "must appear in the email text itself",
    ],
  },
];

describe("numeric-grounding prompt-clause lint (P1-4)", () => {
  for (const { file, site, anchors } of SITES) {
    it(`${file} — ${site} still carries its grounding clause`, () => {
      const source = read(file);
      for (const anchor of anchors) {
        const found = typeof anchor === "string" ? source.includes(anchor) : anchor.test(source);
        expect(
          found,
          `${file} lost the grounding anchor ${String(anchor)} for "${site}" — restore the clause (import NUMERIC_GROUNDING_CLAUSE / "${LITERAL}" / the site's adapted wording) before shipping`,
        ).toBe(true);
      }
    });
  }

  it("the canonical clause itself still says what the sites promise", () => {
    const source = read("services/numeric-grounding.ts");
    expect(source.includes(LITERAL)).toBe(true);
    expect(source.includes("never substitute a plausible number")).toBe(true);
  });
});
