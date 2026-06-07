import { describe, it, expect } from "vitest";
import { hashMarketingSnapshot, reconcileMarketingSnapshot, reconcileFields } from "./reconciliation-service";

describe("hashMarketingSnapshot", () => {
  it("is stable for identical content and differs when spend changes", () => {
    const a = { platform: "META", periodStart: "2026-04-27", periodEnd: "2026-05-19", spend: 11733.16, impressions: 1058254, clicks: null };
    expect(hashMarketingSnapshot(a)).toBe(hashMarketingSnapshot({ ...a }));
    expect(hashMarketingSnapshot({ ...a, spend: 11733.17 })).not.toBe(hashMarketingSnapshot(a));
  });
});

describe("reconcileMarketingSnapshot", () => {
  const incoming = { platform: "META", periodStart: "2026-04-27", periodEnd: "2026-05-19", spend: 11733.16, sourceHash: "abc" };

  it("ADDs a brand-new platform+period", () => {
    const r = reconcileMarketingSnapshot([], incoming);
    expect(r.action).toBe("ADDED");
    expect(r.supersedeIds).toEqual([]);
  });

  it("DISREGARDs an identical re-upload (same sourceHash) — no double-count", () => {
    const active = [{ id: "s1", platform: "META", periodStart: "2026-04-27", periodEnd: "2026-05-19", spend: 11733.16, sourceHash: "abc" }];
    const r = reconcileMarketingSnapshot(active, incoming);
    expect(r.action).toBe("DISREGARDED");
    expect(r.supersedeIds).toEqual([]);
    expect(r.decision.reason).toMatch(/duplicate|already ingested/i);
  });

  it("SUPERSEDEs a corrected re-upload of the same period (different numbers)", () => {
    const active = [{ id: "s1", platform: "META", periodStart: "2026-04-27", periodEnd: "2026-05-19", spend: 9000, sourceHash: "old" }];
    const r = reconcileMarketingSnapshot(active, incoming);
    expect(r.action).toBe("SUPERSEDED");
    expect(r.supersedeIds).toEqual(["s1"]);
    expect(r.decision.oldValue).toBe("$9,000");
    expect(r.decision.newValue).toBe("$11,733");
  });

  it("treats a different period as a new ADD (both kept)", () => {
    const active = [{ id: "s1", platform: "META", periodStart: "2026-03-01", periodEnd: "2026-03-31", spend: 5000, sourceHash: "x" }];
    expect(reconcileMarketingSnapshot(active, incoming).action).toBe("ADDED");
  });
});

describe("reconcileFields — never null-overwrite", () => {
  it("keeps an existing real value when the incoming field is null", () => {
    const { merged, decisions } = reconcileFields(
      { month: "May 2026", totalIncome: "148845", netIncome: "-48805" },
      { month: "May 2026", totalIncome: null, netIncome: "-49000" },
      { fields: ["totalIncome", "netIncome"], incomingNewer: true, labelKey: "month" },
    );
    expect(merged.totalIncome).toBe("148845"); // null did NOT wipe it
    expect(merged.netIncome).toBe("-49000"); // real new value updated
    expect(decisions.find((d) => d.field === "totalIncome")?.action).toBe("KEPT");
    expect(decisions.find((d) => d.field === "netIncome")?.action).toBe("UPDATED");
  });

  it("adds a field that was previously empty", () => {
    const { merged, decisions } = reconcileFields(
      { month: "May 2026", totalCogs: null },
      { totalCogs: "74422" },
      { fields: ["totalCogs"] },
    );
    expect(merged.totalCogs).toBe("74422");
    expect(decisions[0].action).toBe("ADDED");
  });

  it("keeps existing when incomingNewer is false (existing more relevant)", () => {
    const { merged, decisions } = reconcileFields(
      { cash: 56526 }, { cash: 50000 },
      { fields: ["cash"], incomingNewer: false },
    );
    expect(merged.cash).toBe(56526);
    expect(decisions[0].action).toBe("KEPT");
  });
});
