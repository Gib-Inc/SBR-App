/**
 * Daily CFO Verdict — unit tests (mocked deps, zero DB).
 *
 * Covers the contract the verdict lives on:
 *   - composition: every section carries {value, source, asOf, status}
 *   - staleness thresholds: cash amber >3d / red >7d; Windsor amber >3d / red >7d
 *   - gap-not-zero: a missing feed/entry renders status "gap" with the reason —
 *     the value stays null, NEVER a fabricated 0
 *   - decisions ranking: truth FAILs > proposed reconciliations > WARNs > PO drafts
 */
import { describe, it, expect } from "vitest";
import {
  classifyCashStaleness,
  composeCashSection,
  composeRunwaySection,
  windsorFreshness,
  classifyMer,
  composeContributionSection,
  unitCostFor,
  onHandFor,
  computeInventoryValueAtWac,
  composeWorkingCapitalSection,
  composeLeaksSection,
  daysLeftFor,
  classifyDaysLeft,
  rankDecisions,
  rollupVerdict,
  getCfoVerdict,
  LEAK_MIN_SPEND,
  LEAK_RED_SPEND,
  type CfoVerdictDeps,
  type DecisionCandidate,
} from "./cfo-verdict-service";
import type { BlendedContribution } from "./contribution-margin-service";

const NOW = new Date("2026-07-17T12:00:00Z");

// ─── staleness thresholds ────────────────────────────────────────────────────

describe("classifyCashStaleness (amber >3d, red >7d)", () => {
  it("fresh ≤3 days is ok", () => {
    expect(classifyCashStaleness(0)).toBe("ok");
    expect(classifyCashStaleness(3)).toBe("ok");
  });
  it("4–7 days is amber", () => {
    expect(classifyCashStaleness(4)).toBe("amber");
    expect(classifyCashStaleness(7)).toBe("amber");
  });
  it(">7 days is red", () => {
    expect(classifyCashStaleness(8)).toBe("red");
  });
  it("no entry at all is a gap, never ok", () => {
    expect(classifyCashStaleness(null)).toBe("gap");
  });
});

describe("composeCashSection", () => {
  it("stamps value/source/asOf/status from the bank override", () => {
    const s = composeCashSection({ cashOnHand: 53185.82, confirmedAt: "2026-07-16T09:00:00Z", stale: false, staleHours: 27 });
    expect(s.value).toBe(53185.82);
    expect(s.asOf).toBe("2026-07-16T09:00:00Z");
    expect(s.status).toBe("ok"); // 27h = 1 day
    expect(s.source).toContain("bank_balance_entries");
    expect(s.updateHref).toBe("/cash-out");
  });
  it("GAP-NOT-ZERO: no fresh entry → value null + status gap + tap-to-update still present", () => {
    const s = composeCashSection(null);
    expect(s.value).toBeNull(); // never 0
    expect(s.status).toBe("gap");
    expect(s.note).toMatch(/bank-confirmed/i);
    expect(s.updateHref).toBe("/cash-out");
  });
  it("an 8-day-old confirmation is red", () => {
    const s = composeCashSection({ cashOnHand: 10000, confirmedAt: "2026-07-09T00:00:00Z", stale: true, staleHours: 8 * 24 });
    expect(s.status).toBe("red");
    expect(s.staleDays).toBe(8);
  });
});

// ─── runway ──────────────────────────────────────────────────────────────────

const RUNWAY_DATA: any = {
  forecast: {
    conservativeDays: 40, realisticDays: 25, aggressiveDays: 15, burnRate: 2100,
    netMarginAverage: 0.44, status: "CRITICAL", dataGaps: [],
    scenarios: {
      conservative: { runwayDays: 40, burnRate: 1800, cashFlowPositive: false, gaps: [] },
      realistic: { runwayDays: 25, burnRate: 2100, cashFlowPositive: false, gaps: [] },
      aggressive: { runwayDays: 15, burnRate: 2500, cashFlowPositive: false, gaps: [] },
    },
  },
  scenarioInputs: {}, seasonal: null, inboundReceivables: 0, snapshotId: "snap1",
  netMargin: 0.44, marginSource: "contribution", biasCorrectionFactor: 1,
  debtService: { dailyDebtService: 1373, monthlyDebtService: 41190, missingPaymentCount: 2, missingPaymentBalance: 120000 },
};

describe("composeRunwaySection", () => {
  it("labels the number with its basis and maps CRITICAL → red", () => {
    const s = composeRunwaySection({ ok: true, data: RUNWAY_DATA }, NOW.toISOString());
    expect(s.value).toBe(25);
    expect(s.status).toBe("red");
    expect(s.basis).toContain("realistic 30d");
    expect(s.basis).toContain("measured contribution margin");
    expect(s.debtServiceMonthly).toBe(41190);
  });
  it("surfaces the debt-blind balance — terms-less debt reads $0 in the burn, flagged not silent", () => {
    const s = composeRunwaySection({ ok: true, data: RUNWAY_DATA }, NOW.toISOString());
    expect(s.debtBlindBalance).toBe(120000);
    expect(s.note).toMatch(/\$120,000.*NO entered payment terms/);
  });
  it("GAP-NOT-ZERO: a failed compute is a stated gap, not a 0-day runway", () => {
    const s = composeRunwaySection({ ok: false, error: "No financial snapshot yet" }, NOW.toISOString());
    expect(s.value).toBeNull();
    expect(s.status).toBe("gap");
    expect(s.note).toContain("No financial snapshot yet");
  });
});

// ─── MER + feeds ─────────────────────────────────────────────────────────────

describe("classifyMer (vs the 5x gate, honoring the honesty ladder)", () => {
  it("null MER is a gap", () => expect(classifyMer(null, 5, "high")).toBe("gap"));
  it("unreliable confidence withholds the verdict (gap), even above the gate", () => {
    expect(classifyMer(9.9, 5, "unreliable")).toBe("gap");
  });
  it("below the gate is red", () => expect(classifyMer(3.4, 5, "high")).toBe("red"));
  it("above the gate but directional is amber", () => expect(classifyMer(6.2, 5, "directional")).toBe("amber"));
  it("above the gate with high confidence is ok", () => expect(classifyMer(6.2, 5, "high")).toBe("ok"));
});

describe("windsorFreshness", () => {
  const snap = (periodEnd: string, source = "windsor:google_ads", superseded = false) => ({ periodEnd, source, superseded });
  it("fresh windsor snapshot (≤3d) is ok", () => {
    const c = windsorFreshness([snap("2026-07-16")], NOW.getTime(), { keyPresent: true, at: "2026-07-17T06:00:00Z" });
    expect(c.status).toBe("ok");
    expect(c.daysOld).toBe(1);
  });
  it("4–7d is amber, >7d is red", () => {
    expect(windsorFreshness([snap("2026-07-12")], NOW.getTime(), { keyPresent: true, at: null }).status).toBe("amber");
    expect(windsorFreshness([snap("2026-07-01")], NOW.getTime(), { keyPresent: true, at: null }).status).toBe("red");
  });
  it("superseded and non-windsor rows never count as freshness", () => {
    const c = windsorFreshness(
      [snap("2026-07-16", "windsor:google_ads", true), snap("2026-07-16", "upload:meta.csv")],
      NOW.getTime(), { keyPresent: true, at: null },
    );
    expect(c.status).toBe("gap");
    expect(c.detail).toContain("awaiting data");
  });
  it("no key = awaiting credentials, stated as such", () => {
    const c = windsorFreshness([], NOW.getTime(), { keyPresent: false, at: null });
    expect(c.status).toBe("gap");
    expect(c.detail).toContain("awaiting credentials");
  });
});

// ─── contribution ────────────────────────────────────────────────────────────

const CM: BlendedContribution = {
  windowDays: 30, revenue: 150000, cogs: 52000, cogsCosted: 48000, cogsPlug: 4000,
  channelFees: 9000, channelFeesAmazon: 7000, channelFeesShopify: 2000,
  freightEstimate: 17700, freightPct: 0.118, contributionMargin: 71300,
  contributionMarginPct: 0.4753, grossMarginPct: 0.6533, costedRevenueShare: 0.958,
  impliedBreakevenMer: 2.1, runwayMarginRate: 0.5153,
  dataGaps: ["Amazon FBA pick-pack fees not measured (essentially unbooked in QB; needs Seller Central ingestion W2-4) — margin slightly overstated on Amazon orders (~1% blended)"],
};

describe("composeContributionSection", () => {
  it("carries the blended figure WITH the COGS-plug caveat the engine reports", () => {
    const s = composeContributionSection(CM, NOW.toISOString());
    expect(s.value).toBe(0.4753);
    expect(s.marginPctDisplay).toBe("47.5%");
    expect(s.status).toBe("ok");
    expect(s.caveats[0]).toContain("35% QB-validated COGS plug");
    expect(s.caveats.some((c) => c.includes("FBA pick-pack"))).toBe(true);
    expect(s.cogsPlugShare).toBeCloseTo(0.04, 2);
  });
  it("negative margin is red; sub-30% is amber; null is a gap", () => {
    expect(composeContributionSection({ ...CM, contributionMarginPct: -0.05 }, NOW.toISOString()).status).toBe("red");
    expect(composeContributionSection({ ...CM, contributionMarginPct: 0.22 }, NOW.toISOString()).status).toBe("amber");
    const gap = composeContributionSection({ ...CM, contributionMarginPct: null }, NOW.toISOString());
    expect(gap.status).toBe("gap");
    expect(gap.value).toBeNull();
  });
});

// ─── working capital (inventory value → days-on-hand → turns) ────────────────

describe("unitCostFor / onHandFor / computeInventoryValueAtWac", () => {
  it("finished goods value the hildale+afs buckets (pivot/currentStock ignored); components use current_stock", () => {
    const r = computeInventoryValueAtWac([
      { type: "finished_product", hildaleQty: 5, availableForSaleQty: 12, pivotQty: 85, currentStock: 999, wacUnitCost: 20 },
      { type: "component", currentStock: 40, hildaleQty: 7, availableForSaleQty: 9, defaultPurchaseCost: 2.5 },
    ]);
    expect(r.value).toBe(17 * 20 + 40 * 2.5); // 340 + 100 = 440
    expect(r.itemsCosted).toBe(2);
    expect(r.itemsUncosted).toBe(0);
  });
  it("cost ladder: WAC first, purchase-cost fallback; non-positive/absent = NO cost (never $0)", () => {
    expect(unitCostFor({ wacUnitCost: 12, defaultPurchaseCost: 99 })).toBe(12);
    expect(unitCostFor({ wacUnitCost: 0, defaultPurchaseCost: 5 })).toBe(5);
    expect(unitCostFor({ wacUnitCost: null, defaultPurchaseCost: null })).toBeNull();
    expect(unitCostFor({})).toBeNull();
  });
  it("bucket helper per type", () => {
    expect(onHandFor({ type: "finished_product", hildaleQty: 3, availableForSaleQty: 4, currentStock: 50 })).toBe(7);
    expect(onHandFor({ type: "component", currentStock: 50, hildaleQty: 3, availableForSaleQty: 4 })).toBe(50);
  });
  it("GAP-NOT-ZERO: stocked items with no cost are EXCLUDED and reported, never valued at $0", () => {
    const r = computeInventoryValueAtWac([
      { type: "component", currentStock: 10, wacUnitCost: 4 },
      { type: "component", currentStock: 50 },              // stocked, uncosted → coverage gap
      { type: "component", currentStock: 0 },               // zero stock, uncosted → irrelevant
    ]);
    expect(r.value).toBe(40);
    expect(r.itemsCosted).toBe(1);
    expect(r.itemsUncosted).toBe(1);
    expect(r.unitsUncosted).toBe(50);
  });
});

describe("composeWorkingCapitalSection", () => {
  it("days-on-hand = value ÷ (30d COGS ÷ 30); turns = 365 ÷ days-on-hand; plug share carried as a caveat", () => {
    const s = composeWorkingCapitalSection(
      [{ type: "component", currentStock: 100, wacUnitCost: 26 }], // $2,600
      CM, // cogs 52000 over 30d → $1,733.33/day
      NOW.toISOString(),
    );
    expect(s.value).toBe(2600);
    expect(s.status).toBe("ok");
    expect(s.daysOnHand.value).toBe(1.5);
    expect(s.turns.value).toBeCloseTo(243.33, 2);
    expect(s.daysOnHand.note).toContain("8% of the 30d COGS proxy"); // 4000/52000 of the plug
    expect(s.daysOnHand.source).toContain("contribution-margin-service");
    expect(s.turns.source).toContain("365");
  });
  it("a COGS proxy that is ENTIRELY the 35% plug carries the caveat in the field's status (amber)", () => {
    const s = composeWorkingCapitalSection(
      [{ type: "component", currentStock: 100, wacUnitCost: 26 }],
      { ...CM, cogsCosted: 0, cogsPlug: 52000 },
      NOW.toISOString(),
    );
    expect(s.daysOnHand.status).toBe("amber");
    expect(s.daysOnHand.note).toMatch(/ENTIRELY the 35% QB plug/);
    expect(s.turns.status).toBe("amber");
    expect(s.status).toBe("amber"); // section rolls the caveat up
    expect(s.daysOnHand.value).toBe(1.5); // still used — with the caveat, not withheld
  });
  it("coverage gap: uncosted stocked items are excluded, reported, and turn the value amber (understated, not $0-filled)", () => {
    const s = composeWorkingCapitalSection(
      [
        { type: "component", currentStock: 10, wacUnitCost: 4 },
        { type: "component", currentStock: 50 },
      ],
      CM,
      NOW.toISOString(),
    );
    expect(s.value).toBe(40);
    expect(s.itemsUncosted).toBe(1);
    expect(s.unitsUncosted).toBe(50);
    expect(s.note).toMatch(/EXCLUDED from the value/);
    expect(s.status).toBe("amber");
  });
  it("GAP-NOT-ZERO: no costed items at all → value null + gap; days-on-hand and turns gap with it", () => {
    const s = composeWorkingCapitalSection(
      [{ type: "component", currentStock: 50 }],
      CM,
      NOW.toISOString(),
    );
    expect(s.value).toBeNull(); // never a fabricated 0
    expect(s.status).toBe("gap");
    expect(s.note).toMatch(/coverage gap, not \$0/);
    expect(s.daysOnHand.value).toBeNull();
    expect(s.daysOnHand.status).toBe("gap");
    expect(s.turns.value).toBeNull();
  });
  it("dead contribution engine or an empty COGS window is a stated gap for days-on-hand (value still stands)", () => {
    const dead = composeWorkingCapitalSection(
      [{ type: "component", currentStock: 100, wacUnitCost: 26 }], null, NOW.toISOString(),
    );
    expect(dead.value).toBe(2600);
    expect(dead.daysOnHand.status).toBe("gap");
    expect(dead.daysOnHand.note).toContain("contribution engine unavailable");
    const empty = composeWorkingCapitalSection(
      [{ type: "component", currentStock: 100, wacUnitCost: 26 }], { ...CM, cogs: 0 }, NOW.toISOString(),
    );
    expect(empty.daysOnHand.status).toBe("gap");
    expect(empty.daysOnHand.note).toContain("not infinite");
  });
});

// ─── cash leaks ──────────────────────────────────────────────────────────────

describe("composeLeaksSection", () => {
  const base = { superseded: false, status: "OK" };
  it("flags zero-purchase spend concentrations from compliant snapshots", () => {
    const s = composeLeaksSection([
      { ...base, platform: "META", spend: 400, conversions: 0, periodEnd: "2026-07-15" },
      { ...base, platform: "META", spend: 300, conversions: 0, periodEnd: "2026-07-16" },
      { ...base, platform: "GOOGLE", spend: 900, conversions: 12, periodEnd: "2026-07-15" },
    ], NOW.getTime());
    expect(s.status).toBe("red"); // 700 ≥ LEAK_RED_SPEND
    expect(s.value).toBe(700);
    expect(s.leaks).toEqual([{ platform: "META", spendNoPurchase: 700, windows: 2, latestPeriodEnd: "2026-07-16" }]);
    expect(LEAK_RED_SPEND).toBe(500);
  });
  it("GAP-NOT-ZERO: rows without purchase granularity render awaiting, never a clean $0", () => {
    const s = composeLeaksSection([
      { ...base, platform: "META", spend: 500, conversions: null, periodEnd: "2026-07-16" },
    ], NOW.getTime());
    expect(s.status).toBe("gap");
    expect(s.value).toBeNull();
    expect(s.note).toContain("awaiting fresh ad feed");
    expect(s.awaiting).toEqual(["META"]);
  });
  it("no snapshots at all is a stated gap", () => {
    const s = composeLeaksSection([], NOW.getTime());
    expect(s.status).toBe("gap");
    expect(s.note).toContain("awaiting fresh ad feed");
  });
  it("ignores superseded rows, stale windows, and sub-threshold noise", () => {
    const s = composeLeaksSection([
      { platform: "META", spend: 5000, conversions: 0, periodEnd: "2026-07-15", superseded: true, status: "OK" },
      { ...base, platform: "META", spend: 5000, conversions: 0, periodEnd: "2026-06-01" }, // outside 14d
      { ...base, platform: "META", spend: LEAK_MIN_SPEND - 1, conversions: 0, periodEnd: "2026-07-16" },
      { ...base, platform: "META", spend: 900, conversions: 4, periodEnd: "2026-07-16" },
    ], NOW.getTime());
    expect(s.status).toBe("ok");
    expect(s.leaks).toEqual([]);
  });
});

// ─── inventory ───────────────────────────────────────────────────────────────

describe("daysLeftFor / classifyDaysLeft", () => {
  it("computes days from window velocity", () => {
    expect(daysLeftFor(85, 60, 30)).toBe(42.5); // 2/day
  });
  it("GAP-NOT-ZERO: zero velocity is null (unknowable), never Infinity or 0", () => {
    expect(daysLeftFor(85, 0, 30)).toBeNull();
    expect(classifyDaysLeft(null)).toBe("gap");
  });
  it("thresholds: <30 red, <60 amber, else ok", () => {
    expect(classifyDaysLeft(29)).toBe("red");
    expect(classifyDaysLeft(45)).toBe("amber");
    expect(classifyDaysLeft(90)).toBe("ok");
  });
});

// ─── decisions ranking ───────────────────────────────────────────────────────

describe("rankDecisions", () => {
  const c = (kind: DecisionCandidate["kind"], title: string, asOf = "2026-07-17T00:00:00Z"): DecisionCandidate =>
    ({ kind, title, why: "w", source: "s", asOf });
  it("truth FAILs outrank proposed reconciliations outrank WARNs outrank PO drafts", () => {
    const ranked = rankDecisions([
      c("po_draft", "draft"),
      c("truth_warn", "warn"),
      c("recon_proposed", "recon"),
      c("truth_fail", "fail"),
    ]);
    expect(ranked.map((r) => r.title)).toEqual(["fail", "recon", "warn"]);
  });
  it("caps at top 3 and breaks ties by recency", () => {
    const ranked = rankDecisions([
      c("truth_fail", "older-fail", "2026-07-15T00:00:00Z"),
      c("truth_fail", "newer-fail", "2026-07-17T00:00:00Z"),
      c("recon_proposed", "recon"),
      c("truth_warn", "warn"),
      c("po_draft", "draft"),
    ]);
    expect(ranked).toHaveLength(3);
    expect(ranked.map((r) => r.title)).toEqual(["newer-fail", "older-fail", "recon"]);
  });
});

describe("rollupVerdict", () => {
  it("red > amber > gap > ok", () => {
    expect(rollupVerdict(["ok", "gap", "amber", "red"])).toBe("red");
    expect(rollupVerdict(["ok", "gap", "amber"])).toBe("amber");
    expect(rollupVerdict(["ok", "gap"])).toBe("gap");
    expect(rollupVerdict(["ok", "ok"])).toBe("ok");
  });
});

// ─── full composition (mocked deps — zero DB) ────────────────────────────────

const ITEMS = [
  {
    id: "push1", sku: "SBR-PUSH-1.0", name: "Push 1.0 Classic", type: "finished_product",
    pivotQty: 85, hildaleQty: 5, availableForSaleQty: 12, currentStock: 0, skuAliases: [],
    shopifySku: "SBR-Classic1.0", amazonSku: null, extensivSku: null, wacUnitCost: 30,
  },
  {
    id: "wide2", sku: "SBR-Extrawide2.0", name: "Extrawide 2.0", type: "finished_product",
    pivotQty: 400, hildaleQty: 100, availableForSaleQty: 380, currentStock: 0, skuAliases: [],
    shopifySku: null, amazonSku: null, extensivSku: null, wacUnitCost: 25,
  },
  {
    id: "frame-push", sku: "CMP-FRAME-PUSH", name: "Push Frame", type: "component",
    category: "Frames", currentStock: 3, pivotQty: 0, hildaleQty: 0, availableForSaleQty: 0, skuAliases: [],
    wacUnitCost: 10,
  },
];

function makeDeps(over: Partial<CfoVerdictDeps> = {}): CfoVerdictDeps {
  const storage: any = {
    getActiveMarketingSpendSnapshots: async () => [
      { platform: "META", spend: 650, conversions: 0, periodEnd: "2026-07-16", superseded: false, status: "OK", source: "meta-direct-api" },
      { platform: "GOOGLE", spend: 2000, conversions: 30, periodEnd: "2026-07-15", superseded: false, status: "OK", source: "windsor:google_ads" },
    ],
    getAllItems: async () => ITEMS,
    getSkuSalesVelocity: async () => [
      { sku: "SBR-PUSH-1.0", unitsSold: 90 },   // 3/day → 30d left on 90 owned
      { sku: "SBR-Extrawide2.0", unitsSold: 60 },
    ],
    getAllPurchaseOrders: async () => [
      { id: "po1", poNumber: "PO-2026-0101", supplierName: "FX Industries", status: "DRAFT", total: 12500, updatedAt: new Date("2026-07-16T00:00:00Z") },
      { id: "po2", poNumber: "PO-2026-0090", supplierName: "FX Industries", status: "SENT", total: 30000, updatedAt: new Date("2026-07-10T00:00:00Z") },
    ],
    getAllPurchaseOrderLines: async () => [
      // the SENT PO has no frame lines → frames on order = 0 (the carried signal)
      { purchaseOrderId: "po2", itemId: "wide2", qtyOrdered: 100, qtyReceived: 0 },
      // frame qty on the DRAFT PO must NOT count as "on order"
      { purchaseOrderId: "po1", itemId: "frame-push", qtyOrdered: 500, qtyReceived: 0 },
    ],
    getBillOfMaterialsByProductId: async (id: string) =>
      id === "push1" ? [{ finishedProductId: "push1", componentId: "frame-push", quantityRequired: 1, wastagePercent: 0 }] : [],
    getItemBySku: async (sku: string) => ITEMS.find((i) => i.sku === sku),
  };
  return {
    getBankConfirmedOverride: async () => ({ cashOnHand: 53185.82, confirmedAt: "2026-07-16T09:00:00Z", stale: false, staleHours: 27 }),
    computeRunway: async () => ({ ok: true, data: RUNWAY_DATA }),
    getMarketingTruth: async () => ({
      generatedAt: NOW.toISOString(), windowDays: 30,
      blendedMer: 3.56, merBreakevenMeasured: 2.1, merBreakevenStatic: 5, merVerdict: "above",
      contributionMer: 1.69, contributionMerBreakeven: 1, contributionVerdict: "above",
      contributionMarginPct: 0.4753, headline: "every $1 of marketing → $3.56 revenue / $1.69 contribution",
      netRevenue30d: 150000, marketingSpend30d: 42000, freightPct: 0.118, marginNotes: [],
      confidence: "high", confidenceReasons: [],
      governorGate: { gatesAt: 5, measuredBreakeven: 2.1, aligned: false },
    }) as any,
    getMetaDirectFeedConfidence: async () => ({
      feed: "meta-direct", confidence: "actual", latestPeriodEnd: "2026-07-16", daysOld: 1,
      source: "meta-direct-api", reason: "Meta direct feed is fresh.",
    }) as any,
    getWindsorSyncStatus: () => ({ at: "2026-07-17T06:00:00Z", ran: true, keyPresent: true, results: [] }) as any,
    getBlendedContributionMargin: async () => CM,
    getLatestTruthReport: async () => ({
      runAt: "2026-07-17T05:00:00Z", overall: "FAIL",
      checks: [
        { id: "V1", name: "Cross-channel order twins", status: "PASS", summary: "clean" },
        { id: "V2b", name: "Overlapping ACTIVE spend windows", status: "FAIL", summary: "2 overlapping pairs — ad spend double-counted." },
        { id: "V4", name: "Shipped lines with qty_shipped = 0", status: "WARN", summary: "12 lines missing shipped qty." },
      ],
    }) as any,
    storage,
    now: () => NOW,
    ...over,
  };
}

const FAKE_DB = {
  execute: async () => ({
    rows: [
      { data_type: "inventory:afs", entity_key: "SBR-PUSH-1.0", reason: "Residual 14 beyond auto-cap 5; flagged for human review.", created_at: "2026-07-16T22:00:00" },
    ],
  }),
};

describe("getCfoVerdict — full composition", () => {
  it("every section carries value/source/asOf/status (the provenance contract)", async () => {
    const v = await getCfoVerdict(FAKE_DB, makeDeps());
    for (const key of ["cash", "runway", "mer", "contribution", "workingCapital", "cashLeaks", "inventory", "decisions"] as const) {
      const s: any = v[key];
      expect(s, key).toBeDefined();
      expect(typeof s.source, `${key}.source`).toBe("string");
      expect(s.source.length, `${key}.source`).toBeGreaterThan(0);
      expect(s, key).toHaveProperty("value");
      expect(s, key).toHaveProperty("asOf");
      expect(["ok", "amber", "red", "gap"], `${key}.status`).toContain(s.status);
    }
    expect(v.generatedAt).toBe(NOW.toISOString());
  });

  it("composes the sections from the canonical deps", async () => {
    const v = await getCfoVerdict(FAKE_DB, makeDeps());
    expect(v.cash.value).toBe(53185.82);
    expect(v.runway.value).toBe(25);
    expect(v.mer.value).toBe(3.56);
    expect(v.mer.status).toBe("red"); // 3.56 below the 5x gate
    expect(v.mer.feeds.map((f) => f.feed).sort()).toEqual(["meta-direct", "windsor"]);
    expect(v.contribution.value).toBe(0.4753);
    expect(v.cashLeaks.value).toBe(650); // META zero-purchase concentration
    expect(v.overall.status).toBe("red");
  });

  it("carries the SBR-PUSH-1.0 signal: pivot 85, afs low, ZERO frames on order (drafts don't count) → red", async () => {
    const v = await getCfoVerdict(FAKE_DB, makeDeps());
    const push = v.inventory.pushSignal!;
    expect(push.sku).toBe("SBR-PUSH-1.0");
    expect(push.buckets?.pivotQty).toBe(85);
    expect(push.buckets?.availableForSaleQty).toBe(12);
    expect(push.framesOnOrder).toBe(0); // the 500 frames on the DRAFT PO are NOT on order
    expect(push.status).toBe("red");
    expect(push.note).toMatch(/ZERO frames on order/);
    expect(push.daysLeft).toBe(30); // (85+5) owned ÷ 3/day
  });

  it("working capital: buckets valued at WAC beside runway, days-on-hand + turns off the SAME contribution COGS basis", async () => {
    const v = await getCfoVerdict(FAKE_DB, makeDeps());
    const wc = v.workingCapital;
    // finished = hildale+afs: push1 17×$30 + wide2 480×$25; component = current_stock: frame 3×$10
    expect(wc.value).toBe(510 + 12000 + 30);
    expect(wc.itemsCosted).toBe(3);
    expect(wc.itemsUncosted).toBe(0);
    expect(wc.daysOnHand.value).toBe(7.2);          // 12,540 ÷ (52,000/30d)
    expect(wc.turns.value).toBeCloseTo(50.45, 2);   // 365 ÷ days-on-hand
    expect(wc.daysOnHand.status).toBe("ok");
    expect(wc.daysOnHand.note).toContain("QB plug"); // plug share of the proxy carried, not hidden
    // provenance on every new number
    for (const stamp of [wc, wc.daysOnHand, wc.turns]) {
      expect(stamp.source.length).toBeGreaterThan(0);
      expect(stamp.asOf).toBe(NOW.toISOString());
      expect(stamp.status).toBe("ok");
    }
  });

  it("working capital degrades to a stated gap when the items feed dies — the rest of the picture survives", async () => {
    const deps = makeDeps();
    (deps.storage as any).getAllItems = async () => { throw new Error("items table down"); };
    const v = await getCfoVerdict(FAKE_DB, deps);
    expect(v.workingCapital.value).toBeNull();
    expect(v.workingCapital.status).toBe("gap");
    expect(v.workingCapital.note).toContain("items table down");
    expect(v.workingCapital.daysOnHand.status).toBe("gap");
    expect(v.cash.value).toBe(53185.82); // untouched
  });

  it("ranks decisions: truth FAIL first, then the PROPOSED reconciliation, then the WARN (draft PO falls off top-3)", async () => {
    const v = await getCfoVerdict(FAKE_DB, makeDeps());
    expect(v.decisions.items).toHaveLength(3);
    expect(v.decisions.items[0].kind).toBe("truth_fail");
    expect(v.decisions.items[0].why).toContain("double-counted");
    expect(v.decisions.items[1].kind).toBe("recon_proposed");
    expect(v.decisions.items[1].title).toContain("SBR-PUSH-1.0");
    expect(v.decisions.items[2].kind).toBe("truth_warn");
    expect(v.decisions.value).toBe(4); // total candidates incl. the PO draft
  });

  it("GAP-NOT-ZERO through the orchestrator: a dead cash feed gaps ONLY that section", async () => {
    const deps = makeDeps({ getBankConfirmedOverride: async () => null });
    const v = await getCfoVerdict(FAKE_DB, deps);
    expect(v.cash.value).toBeNull();
    expect(v.cash.status).toBe("gap");
    expect(v.runway.value).toBe(25); // untouched
    expect(v.mer.value).toBe(3.56);  // untouched
  });

  it("a THROWING dep degrades to a stated gap with the error named, never a crash or a 0", async () => {
    const deps = makeDeps({
      getMarketingTruth: async () => { throw new Error("governor exploded"); },
    });
    const v = await getCfoVerdict(FAKE_DB, deps);
    expect(v.mer.value).toBeNull();
    expect(v.mer.status).toBe("gap");
    expect(v.mer.note).toContain("governor exploded");
    expect(v.cash.value).toBe(53185.82); // the rest of the picture survives
  });

  it("leak granularity missing → 'awaiting fresh ad feed', not a clean scan", async () => {
    const deps = makeDeps();
    (deps.storage as any).getActiveMarketingSpendSnapshots = async () => [
      { platform: "META", spend: 650, conversions: null, periodEnd: "2026-07-16", superseded: false, status: "OK" },
    ];
    const v = await getCfoVerdict(FAKE_DB, deps);
    expect(v.cashLeaks.status).toBe("gap");
    expect(v.cashLeaks.note).toContain("awaiting fresh ad feed");
  });
});
