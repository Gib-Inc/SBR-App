import { describe, it, expect } from "vitest";
import {
  detectDelimiter,
  findHeaderRow,
  gridToObjects,
  normalizeTabular,
  salvageParse,
} from "./universal-doc-parser";

describe("detectDelimiter", () => {
  it("detects commas", () => {
    expect(detectDelimiter("a,b,c\n1,2,3\n4,5,6")).toBe(",");
  });
  it("detects semicolons (European exports)", () => {
    expect(detectDelimiter("a;b;c\n1;2;3\n4;5;6")).toBe(";");
  });
  it("detects tabs", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
  it("defaults to comma when ambiguous", () => {
    expect(detectDelimiter("singlecolumn\nvalue")).toBe(",");
  });
});

describe("findHeaderRow", () => {
  it("returns 0 for a clean header", () => {
    expect(findHeaderRow([["Name", "Spend"], ["x", "1"]])).toBe(0);
  });
  it("skips leading title/blank rows", () => {
    const grid = [
      ["Sticker Burr Roller — Ad Report"],
      [],
      ["Campaign", "Amount Spent", "Impressions"],
      ["Brand", "100", "5000"],
    ];
    expect(findHeaderRow(grid)).toBe(2);
  });
});

describe("gridToObjects", () => {
  it("maps a header row to keyed objects and drops blank rows", () => {
    const grid = [
      ["Title row only"],
      ["Campaign", "Spend"],
      ["Brand", "100"],
      [],
      ["PMax", "250"],
    ];
    const { columns, rows, headerRow } = gridToObjects(grid);
    expect(headerRow).toBe(1);
    expect(columns).toEqual(["Campaign", "Spend"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Campaign: "Brand", Spend: "100" });
  });
  it("de-duplicates and fills blank header names", () => {
    const { columns } = gridToObjects([["A", "", "A"], ["1", "2", "3"]]);
    expect(columns[0]).toBe("A");
    expect(columns[1]).toBe("Column 2");
    expect(columns[2]).toBe("A (1)");
  });
});

describe("normalizeTabular", () => {
  it("reads a semicolon CSV with a BOM and a leading title row", () => {
    const csv = "﻿My Export Title\nCampaign;Amount Spent;Impressions\nBrand;100;5000\nPMax;250;9000";
    const { columns, rows, adjustments } = normalizeTabular(Buffer.from(csv, "utf8"), "report.csv", "text/csv");
    expect(columns).toEqual(["Campaign", "Amount Spent", "Impressions"]);
    expect(rows).toHaveLength(2);
    expect(adjustments.join(" ")).toMatch(/byte-order mark/);
    expect(adjustments.join(" ")).toMatch(/separator/);
  });
});

describe("salvageParse — never rejects", () => {
  it("auto-detects a wrong-typed ad CSV (user picked pl_xlsx)", async () => {
    const csv = "Campaign,Amount Spent,Impressions,Clicks\nBrand,100,5000,40\nPMax,250,9000,80";
    const r = await salvageParse({ buffer: Buffer.from(csv), fileName: "meta.csv", mime: "text/csv", requestedType: "pl_xlsx" });
    expect(r.accepted).toBe(true);
    expect(r.docType).toBe("ad_spend");
    expect(r.reclassified).toBe(true);
  });

  it("generically accepts an unrecognized table instead of rejecting", async () => {
    const csv = "Widget,Qty,Notes\nA,3,hello\nB,7,world";
    const r = await salvageParse({ buffer: Buffer.from(csv), fileName: "random.csv", mime: "text/csv", requestedType: "auto" });
    expect(r.accepted).toBe(true);
    expect(r.docType).toBe("generic");
    expect(r.needsReview).toBe(true);
    expect(r.preview?.columns).toEqual(["Widget", "Qty", "Notes"]);
    expect(r.preview?.totalRows).toBe(2);
  });

  it("accepts a PDF with no LLM key (stored, never rejected)", async () => {
    const r = await salvageParse({ buffer: Buffer.from("%PDF-1.4 ..."), fileName: "balsheet.pdf", mime: "application/pdf", requestedType: "balance_sheet", hasLlmKey: false });
    expect(r.accepted).toBe(true);
    expect(r.docType).toBe("generic");
    expect(r.message).toMatch(/Anthropic API key/);
  });
});
