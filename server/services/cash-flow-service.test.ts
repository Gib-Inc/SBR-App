import { describe, it, expect } from "vitest";
import { defaultTier, debtTier, rankAndProject, taxObligationSeeds, classifyVendorTier, sodBlocksPaid, setObligationStatus, countUnfunded, resolveCashSource, bankOverrideFromEntry, type Obligation, type AuthoritativeBankBalance } from "./cash-flow-service";

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
  it("does NOT rank a card as MCA even if its name looks fintech (audit #10)", () => {
    // "Capital On Tap 4299" is a charge CARD, not a daily-debit advance — must be tier3.
    expect(debtTier("Capital On Tap 4299", "card")).toBe("tier3");
    // a PayPal-branded card/balance is not an MCA (bare "paypal" no longer forces mca)
    expect(debtTier("PayPal balance", "card")).toBe("tier3");
  });
  it("catches generic MCA providers that were missed (audit #9)", () => {
    expect(debtTier("Kabbage Funding", "loan")).toBe("mca");
    expect(debtTier("Credibly Working Capital", "loan")).toBe("mca");
    expect(debtTier("OnDeck Capital", "loan")).toBe("mca");
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
  it("treats an UNKNOWN (estimated $0) amount as material — no pending->paid bypass for a $0-seeded 941/MCA", () => {
    // amount 0 < threshold would have slipped through; amountEstimated=true forces the gate.
    expect(sodBlocksPaid("paid", "pending", 0, null, "userA", 1000, true)).toBe(true);
    expect(sodBlocksPaid("paid", "approved", 0, "userA", "userA", 1000, true)).toBe(true); // self-pay still blocked
    expect(sodBlocksPaid("paid", "approved", 0, "userA", "userB", 1000, true)).toBe(false); // proper dual-control passes
  });
  it("a KNOWN $0 (not estimated) stays non-material", () => {
    expect(sodBlocksPaid("paid", "pending", 0, null, "userA", 1000, false)).toBe(false);
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

describe("countUnfunded (FLAG-DON'T-FABRICATE: runway can't see estimated-$0 outflows)", () => {
  it("counts active obligations with an unknown (estimated $0) amount, and the must-pay subset", () => {
    const active = [
      { amount: 0, amountEstimated: true, tier: "mca" as const },     // unfunded + must-pay
      { amount: 0, amountEstimated: true, tier: "tier1" as const },    // unfunded + must-pay (tax)
      { amount: 0, amountEstimated: true, tier: "tier4" as const },    // unfunded, deferrable
      { amount: 2500, amountEstimated: true, tier: "tier2" as const }, // estimated but HAS an amount → funded
      { amount: 0, amountEstimated: false, tier: "tier2" as const },   // a real $0 bill → not unfunded
    ];
    const r = countUnfunded(active);
    expect(r.unfundedCount).toBe(3);
    expect(r.unfundedMustPayCount).toBe(2); // mca + tier1 only
  });
  it("is all-clear when every amount is known", () => {
    expect(countUnfunded([{ amount: 100, amountEstimated: false, tier: "mca" as const }]))
      .toEqual({ unfundedCount: 0, unfundedMustPayCount: 0 });
  });
});

describe("rankAndProject", () => {
  it("ranks trust-fund tax FIRST (tier1 ahead of mca), then projects running cash", () => {
    // Invariant guard: collected/withheld tax is the state's/IRS's money (§6672 personal
    // liability) and MUST be recommended first-dollar-out, ahead of MCA auto-debits.
    const obls = [
      obl({ id: "card", tier: "tier3", amount: 100, dueDate: "2026-07-01" }),
      obl({ id: "tax", tier: "tier1", amount: 200, dueDate: "2026-07-15" }),
      obl({ id: "mca", tier: "mca", amount: 50, dueDate: "2026-07-10" }),
    ];
    const r = rankAndProject(obls, 1000, "2026-06-26");
    expect(r.map((o) => o.id)).toEqual(["tax", "mca", "card"]);
    expect(r[0].runningCashAfter).toBe(800); // tax 200 first
    expect(r[1].runningCashAfter).toBe(750); // then mca 50
    expect(r[2].runningCashAfter).toBe(650); // then card 100
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

describe("resolveCashSource (bank-confirmed balance wins over the lagging QB ledger)", () => {
  const NOW = new Date("2026-06-30T20:00:00Z").getTime();
  const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
  const bank = (over: Partial<AuthoritativeBankBalance>): AuthoritativeBankBalance => ({
    availableBalance: 53185.82, asOf: hoursAgo(1), inTransit: [], source: "roger_bank_share", enteredBy: "Roger", ...over,
  });

  it("uses a fresh bank entry over the QB ledger — the actual bug (53,185.82 not 26,900.72)", () => {
    const r = resolveCashSource(bank({}), { cashOnHand: 26900.72, cashAsOf: "2026-06-29" }, NOW);
    expect(r.cashOnHand).toBe(53185.82);
    expect(r.cashSource).toBe("bank_confirmed");
    expect(r.cashStale).toBe(false);
    expect(r.cashConfirmedAt).toBe(hoursAgo(1));
  });

  it("flags a bank entry stale once older than 72h but still uses it (real beats lagging QB)", () => {
    const r = resolveCashSource(bank({ asOf: hoursAgo(100) }), { cashOnHand: 26900.72, cashAsOf: "2026-06-29" }, NOW);
    expect(r.cashSource).toBe("bank_confirmed");
    expect(r.cashOnHand).toBe(53185.82);
    expect(r.cashStale).toBe(true);
    expect(r.cashStaleHours).toBe(100);
  });

  it("falls back to QB when the bank entry is older than 14 days (too old to override)", () => {
    const r = resolveCashSource(bank({ asOf: hoursAgo(15 * 24) }), { cashOnHand: 26900.72, cashAsOf: "2026-06-30" }, NOW);
    expect(r.cashSource).toBe("qbo_ledger");
    expect(r.cashOnHand).toBe(26900.72);
  });

  it("ignores a future-dated bank entry (negative age) and falls back to QB", () => {
    const r = resolveCashSource(bank({ asOf: new Date(NOW + 3_600_000).toISOString() }), { cashOnHand: 26900.72, cashAsOf: "2026-06-30" }, NOW);
    expect(r.cashSource).toBe("qbo_ledger");
  });

  it("with no bank entry, returns the QB value unchanged (fallback is a no-op vs before)", () => {
    const r = resolveCashSource(null, { cashOnHand: 38133.9, cashAsOf: "2026-06-30" }, NOW);
    expect(r.cashOnHand).toBe(38133.9);
    expect(r.cashSource).toBe("qbo_ledger");
    expect(r.inTransit).toEqual([]);
    expect(r.cashStale).toBe(false); // fresh QB snapshot (same day) is not flagged stale
  });

  it("flags the QB fallback stale when the snapshot is older than 2 days", () => {
    const r = resolveCashSource(null, { cashOnHand: 26900.72, cashAsOf: "2026-06-27" }, NOW);
    expect(r.cashSource).toBe("qbo_ledger");
    expect(r.cashStale).toBe(true);
  });

  it("sums valid in-transit items and drops malformed ones", () => {
    const r = resolveCashSource(
      bank({ inTransit: [
        { label: "Amazon disbursement", amount: 1519.5 },
        { label: "Shopify payout (Jul 1)", amount: 1321.15 },
        { label: "bad", amount: NaN as any },
        { amount: 10 } as any, // no label
      ] }),
      { cashOnHand: 26900.72, cashAsOf: "2026-06-29" }, NOW,
    );
    expect(r.inTransit).toHaveLength(2);
    expect(r.inTransitTotal).toBe(2840.65);
  });

  it("falls back to QB when the bank balance is non-finite", () => {
    const r = resolveCashSource(bank({ availableBalance: NaN as any }), { cashOnHand: 26900.72, cashAsOf: "2026-06-30" }, NOW);
    expect(r.cashSource).toBe("qbo_ledger");
    expect(r.cashOnHand).toBe(26900.72);
  });

  it("flags a fat-finger: entered balance >5x the QB ledger sets cashDivergenceFlag", () => {
    const r = resolveCashSource(bank({ availableBalance: 531858.2 }), { cashOnHand: 26900.72, cashAsOf: "2026-06-29" }, NOW);
    expect(r.cashSource).toBe("bank_confirmed");
    expect(r.cashDivergenceFlag).toBe(true); // 531858.2 / 26900.72 ≈ 19.8x
  });

  it("does NOT flag a plausible bank balance ~2x the QB ledger (the real $53,185.82 case)", () => {
    const r = resolveCashSource(bank({ availableBalance: 53185.82 }), { cashOnHand: 26900.72, cashAsOf: "2026-06-29" }, NOW);
    expect(r.cashDivergenceFlag).toBe(false); // ≈1.98x, under the 5x threshold
  });

  it("never flags divergence on the QB fallback path", () => {
    const r = resolveCashSource(null, { cashOnHand: 26900.72, cashAsOf: "2026-06-29" }, NOW);
    expect(r.cashDivergenceFlag).toBe(false);
  });
});

describe("bankOverrideFromEntry (single precedence gate shared by all cash consumers)", () => {
  const NOW = new Date("2026-06-30T20:00:00Z").getTime();
  const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
  const entry = (over: Partial<AuthoritativeBankBalance>): AuthoritativeBankBalance => ({
    availableBalance: 53185.82, asOf: hoursAgo(1), inTransit: [], source: "manual", enteredBy: null, ...over,
  });

  it("returns the bank value for a fresh entry", () => {
    const o = bankOverrideFromEntry(entry({}), NOW);
    expect(o?.cashOnHand).toBe(53185.82);
    expect(o?.stale).toBe(false);
  });
  it("returns the value but flags stale past 72h", () => {
    const o = bankOverrideFromEntry(entry({ asOf: hoursAgo(100) }), NOW);
    expect(o?.cashOnHand).toBe(53185.82);
    expect(o?.stale).toBe(true);
    expect(o?.staleHours).toBe(100);
  });
  it("returns null when older than 14 days (too old to override QB)", () => {
    expect(bankOverrideFromEntry(entry({ asOf: hoursAgo(15 * 24) }), NOW)).toBeNull();
  });
  it("returns null for a future-dated entry", () => {
    expect(bankOverrideFromEntry(entry({ asOf: new Date(NOW + 3_600_000).toISOString() }), NOW)).toBeNull();
  });
  it("returns null for a non-finite balance or no entry", () => {
    expect(bankOverrideFromEntry(entry({ availableBalance: NaN as any }), NOW)).toBeNull();
    expect(bankOverrideFromEntry(null, NOW)).toBeNull();
  });
});
