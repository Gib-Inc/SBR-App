import { describe, it, expect } from "vitest";
import { defaultTier, debtTier, rankAndProject, taxObligationSeeds, classifyVendorTier, sodBlocksPaid, setObligationStatus, type Obligation } from "./cash-flow-service";

// Minimal db.execute mock: returns queued results in call order (rows() reads `.rows`).
function mockDb(responses: any[]) {
  let i = 0;
  return { execute: async () => responses[i++] ?? { rows: [] } };
}

function obl(p: Partial<Obligation>): Obligation {
  return {
    id: p.id ?? "x", label: p.label ?? "x", payee: null, category: p.category ?? "vendor_bill",
    tier: p.tier ?? "tier3", tierRank: 0, amount: p.amount ?? 0, amountEstimated: false,
    dueDate: p.dueDate ?? null, daysUntilDue: null, criticality: p.criticality ?? "important", payFrom: null,
    method: null, status: p.status ?? "pending", source: "manual", rationale: null, sourceRef: null,
    anomalyFlag: false, anomalyReason: null, runningCashAfter: null,
  };
}

describe("defaultTier", () => {
  it("puts tax and payroll in tier1", () => {
    expect(defaultTier("tax", "flexible")).toBe("tier1");
    expect(defaultTier("payroll", "flexible")).toBe("tier1");
  });
  it("maps criticality otherwise", () => {
    expect(defaultTier("vendor_bill", "must")).toBe("tier2");
    expect(defaultTier("vendor_bill", "important")).toBe("tier3");
    expect(defaultTier("vendor_bill", "flexible")).toBe("tier4");
  });
});

describe("debtTier", () => {
  it("flags MCAs / fintech as mca", () => {
    expect(debtTier("Shopify Capital/WebBank - 12-15-25", "loan")).toBe("mca");
    expect(debtTier("Fresh Funding Solutions Inc", "loan")).toBe("mca");
    expect(debtTier("PayPal LoanBuilder/WebBank", "loan")).toBe("mca");
    expect(debtTier("Uncapped", "loan")).toBe("mca");
  });
  it("SBA/bank loans tier2, cards tier3", () => {
    expect(debtTier("Shoreham Bank-SBA 6-2-25", "loan")).toBe("tier2");
    expect(debtTier("American Express 43003", "card")).toBe("tier3");
  });
  it("does not let generic substrings match the short mca/fora tokens", () => {
    // "Comcast" contains "mca", "Metafora" contains "fora" — must NOT be tagged mca
    expect(debtTier("Comcast Business", "card")).not.toBe("mca");
    expect(debtTier("Metafora Leasing", "loan")).not.toBe("mca");
    // real facilities still match
    expect(debtTier("Fora Financial", "loan")).toBe("mca");
    expect(debtTier("BlueVine MCA", "loan")).toBe("mca");
  });
});

describe("sodBlocksPaid (segregation of duties — state machine)", () => {
  // signature: (targetStatus, currentStatus, amount, approvedBy, actor, threshold)
  it("blocks the approver from marking their own approved item paid (self-pay)", () => {
    expect(sodBlocksPaid("paid", "approved", 5000, "userA", "userA", 1000)).toBe(true);
  });
  it("allows a different person to mark an approved item paid", () => {
    expect(sodBlocksPaid("paid", "approved", 5000, "userA", "userB", 1000)).toBe(false);
  });
  it("allows self-pay below the dual-control threshold", () => {
    expect(sodBlocksPaid("paid", "approved", 200, "userA", "userA", 1000)).toBe(false);
  });
  it("only gates the paid action (approve/defer are unaffected)", () => {
    expect(sodBlocksPaid("approved", "pending", 5000, null, "userA", 1000)).toBe(false);
  });
  it("BLOCKS pending -> paid in one step (the prior bypass: no approval ever happened)", () => {
    expect(sodBlocksPaid("paid", "pending", 5000, null, "userA", 1000)).toBe(true);
    // even a different person cannot pay an unapproved material item
    expect(sodBlocksPaid("paid", "pending", 5000, null, "userB", 1000)).toBe(true);
  });
  it("blocks paying a material item that is still in a non-approved state", () => {
    expect(sodBlocksPaid("paid", "deferred", 5000, "userA", "userB", 1000)).toBe(true);
  });
});

describe("classifyVendorTier", () => {
  it("ranks operationally critical suppliers as must-pay (tier2)", () => {
    for (const v of ["Pyvott Fulfillment", "Accu-Form Plastics Inc", "McMaster-Carr", "Uline", "Basic American Supply Inc - 658", "1020 W Utah Ave LLC"]) {
      expect(classifyVendorTier(v)).toEqual({ tier: "tier2", criticality: "must" });
    }
  });
  it("drops marketing/agency bills to flexible (tier4)", () => {
    for (const v of ["Meta Platforms Inc", "While You're In Town LLC", "Carpe Diem", "Vertical Ascension"]) {
      expect(classifyVendorTier(v)).toEqual({ tier: "tier4", criticality: "flexible" });
    }
  });
  it("leaves everything else important (tier3)", () => {
    expect(classifyVendorTier("Gurr & Brande PLLC")).toEqual({ tier: "tier3", criticality: "important" });
    expect(classifyVendorTier("Some Random Vendor")).toEqual({ tier: "tier3", criticality: "important" });
  });
});

describe("rankAndProject", () => {
  it("ranks tier-first and projects the running cash balance", () => {
    const obls = [
      obl({ id: "card", tier: "tier3", amount: 100, dueDate: "2026-07-01" }),
      obl({ id: "tax", tier: "tier1", amount: 200, dueDate: "2026-07-15" }),
      obl({ id: "mca", tier: "mca", amount: 50, dueDate: "2026-07-10" }),
    ];
    const r = rankAndProject(obls, 1000, "2026-06-26");
    expect(r.map((o) => o.id)).toEqual(["mca", "tax", "card"]);
    expect(r[0].runningCashAfter).toBe(950);
    expect(r[1].runningCashAfter).toBe(750);
    expect(r[2].runningCashAfter).toBe(650);
  });
  it("does not draw cash for deferred items", () => {
    const obls = [
      obl({ id: "a", tier: "tier1", amount: 100, status: "deferred" }),
      obl({ id: "b", tier: "tier2", amount: 200 }),
    ];
    const r = rankAndProject(obls, 500, "2026-06-26");
    expect(r.find((o) => o.id === "a")!.runningCashAfter).toBeNull();
    expect(r.find((o) => o.id === "b")!.runningCashAfter).toBe(300);
  });
  it("treats hold tier as defer (no runway draw)", () => {
    const obls = [
      obl({ id: "h", tier: "hold", amount: 500 }),
      obl({ id: "p", tier: "tier2", amount: 200 }),
    ];
    const r = rankAndProject(obls, 1000, "2026-06-26");
    expect(r.find((o) => o.id === "h")!.runningCashAfter).toBeNull();
    expect(r.find((o) => o.id === "p")!.runningCashAfter).toBe(800);
  });
});

describe("taxObligationSeeds", () => {
  it("generates tier1 payroll + Utah sales tax with correct due dates", () => {
    const seeds = taxObligationSeeds("2026-06-26");
    const payroll = seeds.find((s) => s.category === "payroll");
    const utSales = seeds.find((s) => s.externalKey.startsWith("tax:ut-sales"));
    expect(payroll?.tier).toBe("tier1");
    expect(payroll?.dueDate).toBe("2026-07-15"); // past the 15th → next month's deposit
    expect(utSales?.dueDate).toBe("2026-07-31"); // June sales/use tax due end of July
    seeds.forEach((s) => expect(s.tier).toBe("tier1"));
    expect(seeds.length).toBeGreaterThanOrEqual(2);
  });
  it("anchors the Q4 941 to the current year when asOf is in January", () => {
    // The imminent Jan-31 deadline must be present, not pushed a full year to 2027
    const seeds = taxObligationSeeds("2026-01-20");
    const q4 = seeds.find((s) => s.externalKey === "tax:941:2026-01-31");
    expect(q4).toBeTruthy();
    expect(q4?.dueDate).toBe("2026-01-31");
  });
});

describe("setObligationStatus — SoD enforcement + single-operator handling", () => {
  it("blocks self-pay of an approved material item when 2+ admins exist", async () => {
    const db = mockDb([
      { rows: [{ amount: 5000, approved_by: "userA", status: "approved" }] }, // load obligation
      { rows: [{ c: 2 }] }, // eligible approver count
    ]);
    const r = await setObligationStatus(db, "obl1", "paid" as any, "userA", "User A");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("sod_block");
  });

  it("allows self-pay when only one admin exists (dual control is impossible — don't deadlock)", async () => {
    const db = mockDb([
      { rows: [{ amount: 5000, approved_by: "userA", status: "approved" }] },
      { rows: [{ c: 1 }] }, // solo operator
      {}, // update
      {}, // audit insert
    ]);
    const r = await setObligationStatus(db, "obl1", "paid" as any, "userA", "User A");
    expect(r.ok).toBe(true);
  });

  it("allows a DIFFERENT admin to mark an approved item paid (the normal dual-control path)", async () => {
    const db = mockDb([
      { rows: [{ amount: 5000, approved_by: "userA", status: "approved" }] },
      {}, // update (no count query — not SoD-blocked)
      {}, // audit insert
    ]);
    const r = await setObligationStatus(db, "obl1", "paid" as any, "userB", "User B");
    expect(r.ok).toBe(true);
  });

  it("treats an idempotent re-mark (paid -> paid) as a no-op success, not a 409", async () => {
    const db = mockDb([{ rows: [{ amount: 5000, approved_by: "userA", status: "paid" }] }]);
    const r = await setObligationStatus(db, "obl1", "paid" as any, "userA", "User A");
    expect(r.ok).toBe(true);
  });

  it("refuses an unknown obligation id", async () => {
    const db = mockDb([{ rows: [] }]);
    const r = await setObligationStatus(db, "missing", "paid" as any, "userA");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_found");
  });

  it("refuses when there is no authenticated actor", async () => {
    const db = mockDb([{ rows: [{ amount: 5000, approved_by: "userA", status: "approved" }] }]);
    const r = await setObligationStatus(db, "obl1", "paid" as any, undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_actor");
  });
});
