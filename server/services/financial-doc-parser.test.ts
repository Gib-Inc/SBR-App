import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  normalizeBalanceSheet,
  normalizeBankStatement,
  parseBalanceSheetXlsx,
  numOrNull,
} from "./financial-doc-parser";

describe("numOrNull", () => {
  it("parses plain and formatted numbers", () => {
    expect(numOrNull(1234.5)).toBe(1234.5);
    expect(numOrNull("$1,234.50")).toBe(1234.5);
    expect(numOrNull("(2,000.00)")).toBe(-2000); // accounting negative
    expect(numOrNull("")).toBeNull();
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull("-")).toBeNull();
    expect(numOrNull("n/a")).toBeNull();
  });
});

describe("normalizeBalanceSheet", () => {
  it("extracts a full balance sheet at 100% confidence with loans", () => {
    const { fields, dataGaps, confidence } = normalizeBalanceSheet({
      asOf: "2026-06-06",
      basis: "Accrual",
      cash: 56526.46,
      accountsReceivable: 13743.86,
      inventory: 131550.16,
      accountsPayable: 49853.64,
      creditCards: 193701.11,
      shortTermNotes: 732919.3,
      totalLiabilities: 1267916.57,
      totalEquity: -907465.34,
      loans: [
        { name: "Shopify Capital", balance: 214250, term: "short" },
        { name: "Jeff Johnson Bridge Loan", balance: 50000, term: "short" },
        { balance: 1 }, // no name → dropped
      ],
    });
    expect(confidence).toBe(100);
    expect(dataGaps).toHaveLength(0);
    expect(fields.cash).toBe(56526.46);
    expect(fields.totalEquity).toBe(-907465.34);
    // loans without a name are dropped; named ones survive
    expect(fields.loans.map((l) => l.name)).toEqual(["Shopify Capital", "Jeff Johnson Bridge Loan"]);
    expect(fields.loans[1].balance).toBe(50000);
  });

  it("records DATA GAPPED for missing core fields and lowers confidence", () => {
    const { fields, dataGaps, confidence } = normalizeBalanceSheet({
      cash: 1000,
      accountsReceivable: 500,
      accountsPayable: 200,
      inventory: 300,
      // creditCards, shortTermNotes, totalLiabilities, totalEquity missing
    });
    expect(confidence).toBe(50); // 4 of 8 core present
    expect(dataGaps).toContain("DATA GAPPED: creditCards");
    expect(dataGaps).toContain("DATA GAPPED: totalEquity");
    expect(fields.loans).toEqual([]);
  });

  it("returns all-gapped at 0% for an empty object (never invents)", () => {
    const { dataGaps, confidence } = normalizeBalanceSheet({});
    expect(confidence).toBe(0);
    expect(dataGaps).toHaveLength(8);
  });
});

describe("normalizeBankStatement", () => {
  it("extracts a statement and flags missing fields", () => {
    const { fields, dataGaps, confidence } = normalizeBankStatement({
      bankName: "AFCU",
      statementPeriodEnd: "2026-05-31",
      openingBalance: "10,000.00",
      closingBalance: "$12,345.67",
      totalDeposits: 50000,
      // totalWithdrawals missing
    });
    expect(fields.closingBalance).toBe(12345.67);
    expect(fields.openingBalance).toBe(10000);
    expect(confidence).toBe(75); // 3 of 4 core
    expect(dataGaps).toEqual(["DATA GAPPED: totalWithdrawals"]);
  });
});

describe("parseBalanceSheetXlsx", () => {
  const toBuf = (rows: any[][]): Buffer => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  };

  it("reads labeled rows and takes the rightmost numeric", () => {
    const buf = toBuf([
      ["Balance Sheet", null],
      ["Total Bank Accounts", 56526.46],
      ["Total Accounts Receivable", 13743.86],
      ["Inventory", 131550.16],
      ["Total Accounts Payable", 49853.64],
      ["Total Credit Cards", 193701.11],
      ["Total Notes Payable", 732919.3],
      ["Total Liabilities", 1267916.57],
      ["Total Equity", -907465.34],
    ]);
    const r = parseBalanceSheetXlsx(buf);
    expect(r.ok).toBe(true);
    expect(r.confidence).toBe(100);
    expect(r.fields.cash).toBe(56526.46);
    expect(r.fields.shortTermNotes).toBe(732919.3);
    expect(r.fields.totalEquity).toBe(-907465.34);
  });

  it("rejects an empty template rather than inventing values", () => {
    const buf = toBuf([
      ["Balance Sheet", null],
      ["Total Bank Accounts", null],
      ["Total Liabilities", null],
    ]);
    const r = parseBalanceSheetXlsx(buf);
    expect(r.ok).toBe(false);
    expect(r.confidence).toBe(0);
    expect(r.error).toMatch(/empty template|Couldn't find/i);
  });
});
