import { describe, it, expect } from "vitest";
import { parseMetaTracker, inferYear, hashRawText } from "./meta-tracker-parser";

// Real paste shape from the team's tracker (tab-separated, abbreviated).
const JUNE = [
  "Summary\t\t\t\t\tReel 7 - High Performer – NEW PIXEL",
  "\tAd Spend\tPurchase\tCoversion Value\tROAS\tCost Per Result\tAd Spend\tPurchases\tCoversion Value\tROAS\tCost Per Result",
  "Total\t$2,651.74\t37\t$11,968.92\t4.51\t$71.67\t$2,651.74\t37\t$11,968.92\t4.51\t$71.67",
  "Monday, June 1\t$305.98\t4\t$986.05\t3.22\t$76.50\t$305.98\t4\t$986.05\t3.22\t$76.50",
  "Tuesday, June 2\t$313.47\t6\t$3,296.36\t10.52\t$52.25\t$313.47\t6\t$3,296.36\t10.52\t$52.25",
  "Wednesday, June 3\t$290.72\t6\t$370.94\t1.28\t$48.45\t$290.72\t6\t$370.94\t1.28\t$48.45",
  "Thursday, June 4\t$264.47\t3\t$731.35\t2.77\t$88.16\t$264.47\t3\t$731.35\t2.77\t$88.16",
  "Friday, June 5\t$298.94\t4\t$2,833.69\t9.48\t$74.74\t$298.94\t4\t$2,833.69\t9.48\t$74.74",
  "Saturday, June 6\t$257.85\t4\t$846.89\t3.28\t$64.46\t$257.85\t4\t$846.89\t3.28\t$64.46",
  "Sunday, June 7\t$342.24\t2\t$708.31\t2.07\t$171.12\t$342.24\t2\t$708.31\t2.07\t$171.12",
  "Weekly Report\t$2,073.67\t29\t$9,773.59\t4.71\t$71.51\t$2,073.67\t29\t$9,773.59\t4.71\t$71.51",
  "Monday, June 8\t$303.48\t4\t$1,428.08\t4.71\t$75.87\t$303.48\t4\t$1,428.08\t4.71\t$75.87",
  "Tuesday, June 9\t$274.59\t4\t$767.25\t2.79\t$68.65\t$274.59\t4\t$767.25\t2.79\t$68.65",
  "Wednesday, June 10\t$0.00\t0\t$0.00\t0.00\t$0.00\t$0.00\t0\t$0.00\t0.00\t$0.00",
  "Thursday, June 11\t$0.00\t0\t$0.00\t0.00\t$0.00\t$0.00\t0\t$0.00\t0.00\t$0.00",
  "Weekly Report\t$578.07\t8\t$2,195.33\t3.80\t$72.26\t$578.07\t8\t$2,195.33\t3.80\t$72.26",
].join("\n");

const NOW = new Date("2026-06-10T12:00:00Z");

describe("parseMetaTracker", () => {
  const p = parseMetaTracker(JUNE, NOW);

  it("parses exactly the 9 spend days (skips $0 placeholders, Total, Weekly Report)", () => {
    expect(p.ok).toBe(true);
    expect(p.days).toHaveLength(9);
    expect(p.periodStart).toBe("2026-06-01");
    expect(p.periodEnd).toBe("2026-06-09");
  });

  it("matches the sheet's own totals to the cent", () => {
    expect(p.totalSpend).toBe(2651.74);
    expect(p.totalPurchases).toBe(37);
    expect(p.totalConversionValue).toBe(11968.92);
    expect(p.roas).toBe(4.51);
  });

  it("reads individual days correctly", () => {
    const jun2 = p.days.find((d) => d.date === "2026-06-02")!;
    expect(jun2.spend).toBe(313.47);
    expect(jun2.purchases).toBe(6);
    expect(jun2.conversionValue).toBe(3296.36);
  });

  it("detects the campaign name from the header", () => {
    expect(p.campaign).toContain("Reel 7");
  });

  it("returns ok:false with a warning for an empty/garbage paste", () => {
    const bad = parseMetaTracker("hello world\nnothing here", NOW);
    expect(bad.ok).toBe(false);
    expect(bad.warnings.length).toBeGreaterThan(0);
  });
});

describe("inferYear", () => {
  const now = new Date("2026-01-05T12:00:00Z");
  it("uses the current year for nearby dates", () => {
    expect(inferYear(1, 3, now)).toBe(2026);
  });
  it("rolls back a year for far-future dates (December sheet pasted in January)", () => {
    expect(inferYear(12, 15, now)).toBe(2025);
  });
});

// ── Broken-cell guard (the source workbook carries hundreds of #REF!/#DIV/0!
// cells — they must be NAMED, never silently eaten or plugged) ──
describe("broken-cell guard", () => {
  it("rejects the paste when a SUMMARY/total cell is broken, naming every broken cell", () => {
    const paste = [
      "Summary\t\t\t\t\tReel 7 - High Performer",
      "\tAd Spend\tPurchase\tCoversion Value\tROAS\tCost Per Result",
      "Total\t#REF!\t37\t$11,968.92\t#DIV/0!\t$71.67",
      "Monday, June 1\t$305.98\t4\t$986.05\t3.22\t$76.50",
      "Tuesday, June 2\t$313.47\t6\t$3,296.36\t10.52\t$52.25",
    ].join("\n");
    const p = parseMetaTracker(paste, NOW);
    expect(p.ok).toBe(false);
    expect(p.error).toBe("broken formula cells");
    expect(p.days).toHaveLength(0); // NO numbers survive a rejected paste
    expect(p.brokenCells).toHaveLength(2);
    expect(p.brokenCells.map((b) => b.token).sort()).toEqual(["#DIV/0!", "#REF!"]);
    expect(p.brokenCells.every((b) => b.row === 3)).toBe(true);
    expect(p.warnings.join(" ")).toMatch(/SUMMARY\/total/i);
  });

  it("rejects when more than 5% of data rows are broken", () => {
    // 9 spend days + 2 placeholders = 11 data rows; 1 broken = 9% > 5% → reject.
    const broken = JUNE.replace("Tuesday, June 2\t$313.47\t6\t$3,296.36", "Tuesday, June 2\t$313.47\t6\t#VALUE!");
    const p = parseMetaTracker(broken, NOW);
    expect(p.ok).toBe(false);
    expect(p.error).toBe("broken formula cells");
    expect(p.brokenCells).toEqual([expect.objectContaining({ column: "conversionValue", token: "#VALUE!" })]);
  });

  it("below the threshold: skips the broken row, warns, and still names the cell", () => {
    // 21 data rows, 1 broken = 4.8% ≤ 5% → parse the rest, hard-flag the row.
    const rows = ["Summary\tCampaign Z", "\tAd Spend\tPurchase\tCoversion Value\tROAS\tCost Per Result"];
    for (let d = 1; d <= 21; d++) {
      rows.push(d === 11
        ? `Monday, June ${d}\t#N/A\t2\t$400.00\t4.00\t$50.00`
        : `Monday, June ${d}\t$100.00\t2\t$400.00\t4.00\t$50.00`);
    }
    const p = parseMetaTracker(rows.join("\n"), new Date("2026-06-25T12:00:00Z"));
    expect(p.ok).toBe(true);
    expect(p.days).toHaveLength(20); // June 11 skipped, not zero-filled
    expect(p.days.find((d) => d.date === "2026-06-11")).toBeUndefined();
    expect(p.totalSpend).toBe(2000);
    expect(p.brokenCells).toEqual([{ row: 13, column: "spend", token: "#N/A" }]);
    expect(p.warnings.join(" ")).toMatch(/broken formula/i);
  });
});

// ── COGS guard (only when the paste carries a COGS/margin column) ──
describe("COGS guard", () => {
  const COGS_PASTE = [
    "Summary\t\t\t\t\t\tCampaign X",
    "\tAd Spend\tPurchase\tCoversion Value\tROAS\tCost Per Result\tCOGS",
    "Monday, June 1\t$100.00\t2\t$400.00\t4.00\t$50.00\t$140.00",
    "Tuesday, June 2\t$50.00\t1\t$200.00\t4.00\t$50.00\t$0.00",
    "Wednesday, June 3\t$80.00\t1\t$150.00\t1.88\t$80.00\t",
  ].join("\n");

  it("excludes COGS-0/null rows from margin/ROAS aggregates and names the gap", () => {
    const p = parseMetaTracker(COGS_PASTE, NOW);
    expect(p.ok).toBe(true);
    expect(p.hasCogsColumn).toBe(true);
    expect(p.dataGaps).toEqual(["COGS missing for 2 rows — margin/ROAS on those rows not computed"]);
    // Aggregates over the ONE row with COGS only — never plugged with zeros.
    expect(p.totalCogs).toBe(140);
    expect(p.totalMargin).toBe(260); // 400 − 140
    expect(p.marginRoas).toBe(2.6); // 260 / 100
    // Spend/purchase/value totals still include every real row.
    expect(p.totalSpend).toBe(230);
    expect(p.days.find((d) => d.date === "2026-06-02")?.cogs).toBeNull();
    expect(p.days.find((d) => d.date === "2026-06-01")?.cogs).toBe(140);
  });

  it("is a no-op for the typical Meta paste with no COGS column", () => {
    const p = parseMetaTracker(JUNE, NOW);
    expect(p.hasCogsColumn).toBe(false);
    expect(p.dataGaps).toEqual([]);
    expect(p.totalCogs).toBeNull();
    expect(p.totalMargin).toBeNull();
    expect(p.marginRoas).toBeNull();
  });
});

// ── Raw-paste hash (byte-identical re-paste dedup for /ingest) ──
describe("hashRawText", () => {
  it("is sha256 of the exact raw text", () => {
    expect(hashRawText("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("identical pastes hash identically; any byte change differs", () => {
    expect(hashRawText(JUNE)).toBe(hashRawText(JUNE));
    expect(hashRawText(JUNE + " ")).not.toBe(hashRawText(JUNE));
  });
});
