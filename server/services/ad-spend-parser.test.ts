import { describe, it, expect } from "vitest";
import {
  classifySpreadsheet,
  detectPlatform,
  parseAdSpendRows,
  toISODate,
} from "./ad-spend-parser";

describe("classifySpreadsheet", () => {
  it("routes a sheet with spend + ad signals to ad_spend", () => {
    expect(classifySpreadsheet(["Day", "Amount spent (USD)", "Impressions", "Link clicks"])).toBe("ad_spend");
    expect(classifySpreadsheet(["Date", "Cost", "Clicks"])).toBe("ad_spend");
  });
  it("routes a P&L by month headers or income labels", () => {
    expect(classifySpreadsheet(["", "Jan 2026", "Feb 2026"], [])).toBe("pl_xlsx");
    expect(classifySpreadsheet(["A", "B"], ["Total Income", "Net Income"])).toBe("pl_xlsx");
  });
  it("routes a balance sheet by liability/equity labels", () => {
    expect(classifySpreadsheet(["A", "B"], ["Total Assets", "Total Liabilities", "Total Equity"])).toBe("balance_sheet");
  });
  it("returns unknown when nothing matches", () => {
    expect(classifySpreadsheet(["foo", "bar"], ["random label"])).toBe("unknown");
  });
});

describe("detectPlatform", () => {
  it("infers from filename", () => {
    expect(detectPlatform([], "Meta Ads Export.csv")).toBe("META");
    expect(detectPlatform([], "google-ads-report.xlsx")).toBe("GOOGLE");
    expect(detectPlatform([], "amazon_sp_report.csv")).toBe("AMAZON");
  });
  it("falls back to OTHER", () => {
    expect(detectPlatform(["Day", "Spend"], "report.csv")).toBe("OTHER");
  });
});

describe("toISODate", () => {
  it("parses common formats", () => {
    expect(toISODate("2026-06-02")).toBe("2026-06-02");
    expect(toISODate("6/2/2026")).toBe("2026-06-02");
    expect(toISODate("Jun 2, 2026")).toBe("2026-06-02");
    expect(toISODate("Jun 2026")).toBe("2026-06-01");
    expect(toISODate("garbage")).toBeNull();
    expect(toISODate("")).toBeNull();
  });
});

describe("parseAdSpendRows", () => {
  it("aggregates a Meta-style daily export with full columns (status OK)", () => {
    const rows = [
      { Day: "2026-06-01", "Amount spent (USD)": "1,000.50", Impressions: "10000", "Link clicks": "200" },
      { Day: "2026-06-02", "Amount spent (USD)": "500.50", Impressions: "5000", "Link clicks": "100" },
    ];
    const r = parseAdSpendRows(rows, "Meta Ads.csv");
    expect(r.ok).toBe(true);
    expect(r.platform).toBe("META");
    expect(r.spend).toBe(1501);
    expect(r.impressions).toBe(15000);
    expect(r.clicks).toBe(300);
    expect(r.periodStart).toBe("2026-06-01");
    expect(r.periodEnd).toBe("2026-06-02");
    expect(r.currency).toBe("USD");
    expect(r.status).toBe("OK");
    expect(r.dataGaps).toHaveLength(0);
  });

  it("flags DATA_GAPPED when impressions/clicks/period are missing — never invents", () => {
    const rows = [
      { Campaign: "Brand", Cost: "300.00" },
      { Campaign: "Retarget", Cost: "200.00" },
    ];
    const r = parseAdSpendRows(rows, "google-ads.csv");
    expect(r.ok).toBe(true);
    expect(r.platform).toBe("GOOGLE");
    expect(r.spend).toBe(500);
    expect(r.impressions).toBeNull();
    expect(r.clicks).toBeNull();
    expect(r.periodStart).toBeNull();
    expect(r.status).toBe("DATA_GAPPED");
    expect(r.dataGaps).toEqual([
      "DATA GAPPED: impressions",
      "DATA GAPPED: clicks",
      "DATA GAPPED: period",
    ]);
  });

  it("rejects a sheet with no spend column rather than zero-filling", () => {
    const r = parseAdSpendRows([{ Day: "2026-06-01", Impressions: "100" }], "x.csv");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/spend/i);
  });

  it("rejects an empty sheet", () => {
    const r = parseAdSpendRows([], "x.csv");
    expect(r.ok).toBe(false);
  });

  it("skips the Meta account-total row so spend isn't double-counted, and reads start→end period", () => {
    // Mirrors the real Meta export: a blank-campaign total row + campaigns that sum to it.
    const rows = [
      { "Reporting starts": "2026-04-27", "Reporting ends": "2026-05-19", "Campaign name": "", "Amount spent (USD)": "11733.16", Impressions: "1058254", "Meta leads": "0" },
      { "Reporting starts": "2026-04-27", "Reporting ends": "2026-05-19", "Campaign name": "Keep Rolling", "Amount spent (USD)": "1031.48", Impressions: "91184" },
      { "Reporting starts": "2026-04-27", "Reporting ends": "2026-05-19", "Campaign name": "Take Back Your Yard", "Amount spent (USD)": "3414.12", Impressions: "439507" },
      { "Reporting starts": "2026-04-27", "Reporting ends": "2026-05-19", "Campaign name": "Reel 7", "Amount spent (USD)": "4102.77", Impressions: "343239" },
      { "Reporting starts": "2026-04-27", "Reporting ends": "2026-05-19", "Campaign name": "Retargeting", "Amount spent (USD)": "820.66", Impressions: "38798" },
      { "Reporting starts": "2026-04-27", "Reporting ends": "2026-05-19", "Campaign name": "BIGFOOT REELS", "Amount spent (USD)": "1530.43", Impressions: "96046" },
      { "Reporting starts": "2026-04-27", "Reporting ends": "2026-05-19", "Campaign name": "Oddly Satisfying", "Amount spent (USD)": "617.84", Impressions: "36701" },
      { "Reporting starts": "2026-04-27", "Reporting ends": "2026-05-19", "Campaign name": "Reel 7", "Amount spent (USD)": "215.86", Impressions: "12779" },
    ];
    const r = parseAdSpendRows(rows, "Sticker-Burr-Roller-Campaigns.csv");
    expect(r.ok).toBe(true);
    expect(r.platform).toBe("META"); // "Meta leads" header triggers detection
    expect(r.spend).toBe(11733.16); // total counted ONCE, not 23466.32
    expect(r.impressions).toBe(1058254);
    expect(r.periodStart).toBe("2026-04-27");
    expect(r.periodEnd).toBe("2026-05-19"); // from Reporting ends, not collapsed to start
    expect(r.rowCount).toBe(7); // 7 campaigns; total row dropped
    expect(r.warnings.some((w) => /summary\/total|double-count/i.test(w))).toBe(true);
  });

  it("drops a labeled 'Total' row when there is no blank name", () => {
    const rows = [
      { Campaign: "Total", Cost: "500", Clicks: "100" },
      { Campaign: "Brand", Cost: "300", Clicks: "60" },
      { Campaign: "Retarget", Cost: "200", Clicks: "40" },
    ];
    const r = parseAdSpendRows(rows, "google-ads.csv");
    expect(r.spend).toBe(500); // 300 + 200, not 1000
    expect(r.rowCount).toBe(2);
  });
});
