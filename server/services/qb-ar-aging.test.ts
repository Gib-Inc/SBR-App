import { describe, it, expect } from "vitest";
import { parseArAgingTotal } from "./qb-financial-service";

// Representative raw Intuit "AgedReceivables" summary report (matches SBR's real
// data: Amazon $102,519.94 in 1-30; Shopify nets to $0; grand total $102,519.94).
const sbrReport = {
  Columns: { Column: [
    { ColTitle: "", ColType: "Customer" },
    { ColTitle: "Current" }, { ColTitle: "1 - 30" }, { ColTitle: "31 - 60" },
    { ColTitle: "61 - 90" }, { ColTitle: "91 and over" }, { ColTitle: "Total" },
  ] },
  Rows: { Row: [
    { ColData: [ { value: "Amazon - Customer" }, { value: "" }, { value: "102519.94" }, { value: "" }, { value: "" }, { value: "0.00" }, { value: "102519.94" } ] },
    { ColData: [ { value: "Shopify Website" }, { value: "" }, { value: "-15050.95" }, { value: "-12490.80" }, { value: "-5590.20" }, { value: "33131.95" }, { value: "0.00" } ] },
    { group: "GrandTotal", Summary: { ColData: [ { value: "TOTAL" }, { value: "0.00" }, { value: "87468.99" }, { value: "-12490.80" }, { value: "-5590.20" }, { value: "33131.95" }, { value: "102519.94" } ] } },
  ] },
};

describe("parseArAgingTotal", () => {
  it("returns the GrandTotal of the Total column (SBR: the Amazon receivable)", () => {
    expect(parseArAgingTotal(sbrReport)).toBe(102519.94);
  });

  it("falls back to summing leaf-row Totals when there is no GrandTotal row", () => {
    const noGrand = { Columns: sbrReport.Columns, Rows: { Row: sbrReport.Rows.Row.filter((r: any) => !r.group) } };
    expect(parseArAgingTotal(noGrand)).toBe(102519.94); // 102519.94 + 0.00
  });

  it("strips currency formatting", () => {
    const r = {
      Columns: { Column: [{ ColTitle: "" }, { ColTitle: "Total" }] },
      Rows: { Row: [{ group: "GrandTotal", Summary: { ColData: [{ value: "TOTAL" }, { value: "$1,234.56" }] } }] },
    };
    expect(parseArAgingTotal(r)).toBe(1234.56);
  });

  it("returns null (never a fabricated number) on unparseable input", () => {
    expect(parseArAgingTotal(null)).toBeNull();
    expect(parseArAgingTotal({})).toBeNull();
    expect(parseArAgingTotal({ Columns: { Column: [] }, Rows: { Row: [] } })).toBeNull();
    expect(parseArAgingTotal({ foo: "bar" })).toBeNull();
  });

  it("uses the last column as Total when no column is titled 'Total'", () => {
    const r = {
      Columns: { Column: [{ ColTitle: "Customer" }, { ColTitle: "Current" }, { ColTitle: "Amount" }] },
      Rows: { Row: [{ ColData: [{ value: "Acme" }, { value: "0" }, { value: "500" }] }] },
    };
    expect(parseArAgingTotal(r)).toBe(500);
  });
});
