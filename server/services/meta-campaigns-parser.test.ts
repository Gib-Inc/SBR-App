import { describe, it, expect } from "vitest";
import { parseMetaCampaignsCsv } from "./meta-campaigns-parser";

const CSV = [
  '"Reporting starts","Reporting ends","Campaign name","Amount spent (USD)",Impressions,Purchases,"Purchase ROAS (return on ad spend)"',
  '2026-05-24,2026-06-22,,11545.14,871347,,',                                  // account-total row (blank name) → skip
  '2026-05-24,2026-06-22,"Reel 7 - High Performer",8107.71,594222,77,3.536999',
  '2026-05-24,2026-06-22,"CD | Sales | 6/5/26",2962.03,219108,26,4.249201',
  '2026-05-24,2026-06-22,"Dead campaign",0,0,,',                              // zero spend → skip
].join("\n");

describe("parseMetaCampaignsCsv", () => {
  it("extracts spending campaigns, skips the account total and zero-spend rows", () => {
    const p = parseMetaCampaignsCsv(Buffer.from(CSV), "campaigns.csv", "text/csv");
    expect(p.ok).toBe(true);
    expect(p.platform).toBe("META");
    expect(p.periodStart).toBe("2026-05-24");
    expect(p.periodEnd).toBe("2026-06-22");
    expect(p.month).toBe("2026-06");
    expect(p.campaigns.map((c) => c.campaign)).toEqual(["Reel 7 - High Performer", "CD | Sales | 6/5/26"]);
  });

  it("computes revenue from spend × ROAS and carries purchases", () => {
    const p = parseMetaCampaignsCsv(Buffer.from(CSV), "campaigns.csv", "text/csv");
    const reel = p.campaigns.find((c) => c.campaign.startsWith("Reel 7"))!;
    expect(reel.spend).toBe(8107.71);
    expect(reel.revenue).toBeCloseTo(28676.96, 0);
    expect(reel.purchases).toBe(77);
    expect(p.totalSpend).toBeCloseTo(11069.74, 1); // two real campaigns, account total excluded
  });

  it("rejects a non-Meta file gracefully", () => {
    const p = parseMetaCampaignsCsv(Buffer.from("foo,bar\n1,2"), "x.csv", "text/csv");
    expect(p.ok).toBe(false);
    expect(p.error).toBeTruthy();
  });
});
