import { describe, it, expect } from "vitest";
import {
  applyMirrorDedup, isMirrorTreeAccount, getDedupedMonthlyGl, getDedupedRangeGl,
} from "./gl-reader";
import { classifyAccount, rollup } from "./finance-pnl-service";

const TREE_GS = "1 - Gross Sales (Match Shopify Total Sales Breakdown)";
const TREE_DISC = "2 - Discounts (Match Shopify Total Sales Breakdown)";
const TREE_RET = "3 - Returns/Refunds (Match Shopify Total Sales Breakdown) + Amazon";

describe("applyMirrorDedup — executable spec of the SQL dedup", () => {
  it("counts a mirrored parent/tree pair ONCE (same date + amount)", () => {
    const out = applyMirrorDedup([
      { txnDate: "2026-05-03", account: "Gross Sales", amount: 1200.5 },
      { txnDate: "2026-05-03", account: TREE_GS, amount: 1200.5 },
    ]);
    expect(out).toEqual([{ month: "2026-05", account: "Gross Sales", amount: 1200.5 }]);
  });

  it("counts a tree-only correction IN FULL (the 5/31 -63,200.11 class)", () => {
    const out = applyMirrorDedup([
      { txnDate: "2026-05-03", account: "Gross Sales", amount: 1000 },
      { txnDate: "2026-05-03", account: TREE_GS, amount: 1000 },
      { txnDate: "2026-05-31", account: TREE_GS, amount: -63200.11 }, // no parent side
    ]);
    expect(out).toEqual([{ month: "2026-05", account: "Gross Sales", amount: -62200.11 }]);
  });

  it("counts parent-only lines in full (late-June deposits after the tree was abandoned)", () => {
    const out = applyMirrorDedup([
      { txnDate: "2026-06-26", account: "Gross Sales", amount: 5000 },
      { txnDate: "2026-06-27", account: "Gross Sales", amount: 7000 },
    ]);
    expect(out).toEqual([{ month: "2026-06", account: "Gross Sales", amount: 12000 }]);
  });

  it("maps Discounts and Returns tree names onto their primary contra accounts", () => {
    const out = applyMirrorDedup([
      { txnDate: "2026-05-10", account: "Discounts", amount: -50 },
      { txnDate: "2026-05-10", account: TREE_DISC, amount: -50 },
      { txnDate: "2026-05-12", account: TREE_RET, amount: -80 }, // tree-only return
    ]);
    expect(out).toEqual([
      { month: "2026-05", account: "Discounts", amount: -50 },
      { month: "2026-05", account: "Returns and Refunds", amount: -80 },
    ]);
  });

  it("passes non-family accounts through untouched — two identical expense lines both count", () => {
    const out = applyMirrorDedup([
      { txnDate: "2026-05-05", account: "Advertising & Marketing", amount: 100 },
      { txnDate: "2026-05-05", account: "Advertising & Marketing", amount: 100 }, // real 2nd line, same key
      { txnDate: "2026-05-06", account: "Wages", amount: 2500 },
    ]);
    expect(out).toEqual([
      { month: "2026-05", account: "Advertising & Marketing", amount: 200 },
      { month: "2026-05", account: "Wages", amount: 2500 },
    ]);
  });

  it("counts N:M mirror imbalances greatest(parent_n, tree_n) times", () => {
    // Two identical parent lines mirrored by only one tree line → the pair key has
    // parent_n=2, tree_n=1 → counts twice (the extra parent line is real).
    const out = applyMirrorDedup([
      { txnDate: "2026-05-08", account: "Gross Sales", amount: 300 },
      { txnDate: "2026-05-08", account: "Gross Sales", amount: 300 },
      { txnDate: "2026-05-08", account: TREE_GS, amount: 300 },
    ]);
    expect(out).toEqual([{ month: "2026-05", account: "Gross Sales", amount: 600 }]);
  });

  it("leaves an UNKNOWN future '%Match Shopify%' account unmapped so classifyAccount still skips it", () => {
    const weird = "4 - Shipping (Match Shopify Total Sales Breakdown)";
    const out = applyMirrorDedup([{ txnDate: "2026-07-01", account: weird, amount: 999 }]);
    expect(out).toEqual([{ month: "2026-07", account: weird, amount: 999 }]);
    expect(classifyAccount(weird)).toBe("duplicate"); // consumers' rollups drop it
    expect(rollup(out)).toMatchObject({ netSales: 0 });
  });
});

describe("vendor-grain skip behavior", () => {
  it("flags every mirror-tree account (mapped or future-unmapped) for the parent-only skip", () => {
    expect(isMirrorTreeAccount(TREE_GS)).toBe(true);
    expect(isMirrorTreeAccount(TREE_DISC)).toBe(true);
    expect(isMirrorTreeAccount(TREE_RET)).toBe(true);
    expect(isMirrorTreeAccount("5 - Whatever (Match Shopify Total Sales Breakdown)")).toBe(true);
    expect(isMirrorTreeAccount("Gross Sales")).toBe(false);
    expect(isMirrorTreeAccount("Advertising & Marketing")).toBe(false);
  });
  it("classifyAccount keeps the vendor-side skip: every tree account is 'duplicate'", () => {
    // Vendor analytics can't pair mirrors (vendor strings differ across sides), so they
    // skip the tree entirely — one-sided corrections carry NULL vendor, nothing is lost.
    for (const a of [TREE_GS, TREE_DISC, TREE_RET]) expect(classifyAccount(a)).toBe("duplicate");
  });
});

describe("reader row mapping (db stub)", () => {
  const mockDb = (rows: any[]) => ({ execute: async () => ({ rows }) }) as any;

  it("getDedupedMonthlyGl maps and coerces db rows to {month, account, amount}", async () => {
    const out = await getDedupedMonthlyGl(mockDb([
      { month: "2026-05", account: "Gross Sales", amount: "163474.64" },
      { month: "2026-05", account: "Wages", amount: 104512 },
    ]));
    expect(out).toEqual([
      { month: "2026-05", account: "Gross Sales", amount: 163474.64 },
      { month: "2026-05", account: "Wages", amount: 104512 },
    ]);
  });

  it("getDedupedRangeGl maps to {account, amount} for windowed rollups", async () => {
    const out = await getDedupedRangeGl(mockDb([
      { account: "Gross Sales", amount: "42958.75" },
    ]), "2026-06-01", "2026-06-20");
    expect(out).toEqual([{ account: "Gross Sales", amount: 42958.75 }]);
  });
});
