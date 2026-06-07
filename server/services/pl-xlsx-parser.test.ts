import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parsePLWorkbook } from "./pl-xlsx-parser";

function toBuffer(aoa: any[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parsePLWorkbook", () => {
  it("parses the '% of Total Income' layout (CURRENT columns)", () => {
    const buf = toBuffer([
      ["Inspired Tool Design LLC"],
      ["Profit and Loss % of Total Income"],
      ["Jan 1 - Feb 28, 2026"],
      [null, "Jan 2026", null, "Feb 2026", null],
      [null, "CURRENT", "% of Income", "CURRENT", "% of Income"],
      ["Total for Income", 100000, 100, 200000, 100],
      ["Total for Cost of Goods Sold", 40000, 40, 80000, 40],
      ["Gross Profit", 60000, 60, 120000, 60],
      ["Total for Advertising & Marketing", 30000, 30, 50000, 25],
      ["Total for Expenses", 70000, 70, 130000, 65],
      ["Net Income", -10000, -10, -10000, -5],
    ]);
    const r = parsePLWorkbook(buf);
    expect(r.ok).toBe(true);
    expect(r.months.length).toBe(2);
    expect(r.months[0]).toMatchObject({ month: "Jan 2026", totalIncome: 100000, grossProfit: 60000, netIncome: -10000 });
    expect(r.months[1].totalIncome).toBe(200000);
    expect(r.months[0].expenseCategories["Advertising & Marketing"]).toBe(30000);
  });

  it("parses the standard monthly layout (one column per month)", () => {
    const buf = toBuffer([
      ["Inspired Tool Design LLC"],
      ["Profit and Loss"],
      [null, "Mar 2026", "Apr 2026", "Total"],
      ["Total Income", 300000, 250000, 550000],
      ["Gross Profit", 180000, 150000, 330000],
      ["Total Expenses", 200000, 190000, 390000],
      ["Net Income", -20000, -40000, -60000],
    ]);
    const r = parsePLWorkbook(buf);
    expect(r.ok).toBe(true);
    // the "Total" column has no month label -> dropped
    expect(r.months.map((m) => m.month)).toEqual(["Mar 2026", "Apr 2026"]);
    expect(r.months[0]).toMatchObject({ totalIncome: 300000, netIncome: -20000 });
  });

  it("handles parenthesized negatives and $/comma formatting", () => {
    const buf = toBuffer([
      [null, "Jan 2026", "Feb 2026", "Total"],
      ["Total Income", "$1,000", "$2,000", "$3,000"],
      ["Net Income", "(500)", "(250)", "(750)"],
    ]);
    const r = parsePLWorkbook(buf);
    expect(r.ok).toBe(true);
    expect(r.months[0].totalIncome).toBe(1000);
    expect(r.months[0].netIncome).toBe(-500);
  });

  it("ANTI-HALLUCINATION: rejects an unrecognized layout instead of guessing", () => {
    const buf = toBuffer([
      ["Some random sheet"],
      ["foo", "bar", "baz"],
      ["a", 1, 2],
    ]);
    const r = parsePLWorkbook(buf);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.months).toEqual([]);
  });

  it("rejects an empty-template export (months but no values)", () => {
    const buf = toBuffer([
      [null, "Jan 2026", "Feb 2026"],
      ["Total Income", null, null],
      ["Net Income", null, null],
    ]);
    const r = parsePLWorkbook(buf);
    expect(r.ok).toBe(false);
  });
});
