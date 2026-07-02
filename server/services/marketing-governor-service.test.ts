import { describe, it, expect } from "vitest";
import { governorVerdict, windowOverlapSpend } from "./marketing-governor-service";
import { merDenominator, assembleMonth } from "./canonical-spend-service";

const base = { breakeven: 5, cashFloor: 60000, septemberThreshold: 5, dataFresh: true };

describe("governorVerdict", () => {
  it("BLOCK (hard) when the September Rule is firing, even with great MER + cash", () => {
    expect(governorVerdict({ ...base, blendedMer: 9, cashOnHand: 100000, septemberStreak: 8 }).state).toBe("BLOCK");
  });
  it("BLOCK when ad/sales data is stale", () => {
    expect(governorVerdict({ ...base, dataFresh: false, blendedMer: 9, cashOnHand: 100000, septemberStreak: 0 }).state).toBe("BLOCK");
  });
  it("HOLD when MER is below breakeven (SBR today: 3.8x)", () => {
    expect(governorVerdict({ ...base, blendedMer: 3.8, cashOnHand: 40386, septemberStreak: 0 }).state).toBe("HOLD");
  });
  it("HOLD when cash is below the floor", () => {
    expect(governorVerdict({ ...base, blendedMer: 9, cashOnHand: 40000, septemberStreak: 0 }).state).toBe("HOLD");
  });
  it("ALLOW_SCALE only when MER>breakeven, cash>floor, fresh, no September Rule", () => {
    expect(governorVerdict({ ...base, blendedMer: 9, cashOnHand: 100000, septemberStreak: 0 }).state).toBe("ALLOW_SCALE");
  });

  it("an UNDERSTATED MER basis can never authorize scaling — HOLD even at 9x", () => {
    // The steady-state failure: compliant Meta uploads go stale, the basis reverts to
    // booked-only fiction that looks great precisely BECAUSE it's missing spend.
    const v = governorVerdict({ ...base, blendedMer: 9, cashOnHand: 100000, septemberStreak: 0, merUnderstated: true });
    expect(v.state).toBe("HOLD");
    expect(v.reasons.join(" ")).toMatch(/basis incomplete/i);
  });
  it("understated does NOT mask harder stops (September Rule still BLOCKs)", () => {
    expect(governorVerdict({ ...base, blendedMer: 9, cashOnHand: 100000, septemberStreak: 8, merUnderstated: true }).state).toBe("BLOCK");
  });
  it("understated is only a scaling gate — a below-breakeven HOLD stays a HOLD", () => {
    expect(governorVerdict({ ...base, blendedMer: 3.8, cashOnHand: 100000, septemberStreak: 0, merUnderstated: true }).state).toBe("HOLD");
  });
});

describe("windowOverlapSpend — snapshot spend pro-rated onto the trailing window", () => {
  it("snapshot fully inside the window contributes 100%", () => {
    expect(windowOverlapSpend([{ periodStart: "2026-06-10", periodEnd: "2026-06-19", spend: 1000 }], "2026-06-01", "2026-06-30")).toBe(1000);
  });
  it("snapshot half outside the window is pro-rated by day", () => {
    // 10-day period, 5 days inside → 50%
    expect(windowOverlapSpend([{ periodStart: "2026-05-27", periodEnd: "2026-06-05", spend: 1000 }], "2026-06-01", "2026-06-30")).toBe(500);
  });
  it("notBefore clips the countable overlap (pre-credit-line era excluded — already in booked QB)", () => {
    // period 2026-04-21..2026-05-10 (20 days), window covers it all, but notBefore=05-01 → 10/20
    expect(windowOverlapSpend([{ periodStart: "2026-04-21", periodEnd: "2026-05-10", spend: 2000 }], "2026-04-01", "2026-06-30", "2026-05-01")).toBe(1000);
  });
  it("ignores garbage rows and returns 0 with nothing overlapping", () => {
    expect(windowOverlapSpend([
      { periodStart: "", periodEnd: "2026-06-05", spend: 500 },
      { periodStart: "2026-01-01", periodEnd: "2026-01-10", spend: 500 },
      { periodStart: "2026-06-01", periodEnd: "2026-06-10", spend: 0 },
    ], "2026-06-01", "2026-06-30")).toBe(0);
  });
});

describe("governor MER basis === canonical monthly basis (one composition, two grains)", () => {
  it("a full-month window through windowOverlapSpend + merDenominator equals assembleMonth.merDenominator", () => {
    // Scoreboard side: canonical June with booked 20,000 + credit-line Meta 15,000
    const month = assembleMonth("2026-06", { qbGoogle: 8000, qbMeta: 0, metaSnap: 15000, amazon: 1000, booked: 20000 });
    // Governor side: same Meta snapshot windowed over exactly that month
    const meta30 = windowOverlapSpend(
      [{ periodStart: "2026-06-01", periodEnd: "2026-06-30", spend: 15000 }],
      "2026-06-01", "2026-06-30", "2026-05-01",
    );
    const gov = merDenominator({ booked: 20000, creditLineMeta: meta30 > 0 ? meta30 : null, creditLineEra: true });
    expect(gov.value).toBe(month.merDenominator); // 35,000 both ways
    expect(gov.value).toBe(35000);
  });

  it("REGRESSION: booked-only MER said SCALE while true MER (with credit-line Meta) says HOLD", () => {
    const netRev30 = 400000;
    const booked30 = 45000;      // QB books only Google/agency post-cutoff
    const metaCredit30 = 55000;  // Meta running on the credit line, invisible to QB
    const bookedOnlyMer = netRev30 / booked30;                    // 8.9x — the OLD gate's view
    const basis = merDenominator({ booked: booked30, creditLineMeta: metaCredit30, creditLineEra: true });
    const trueMer = +(netRev30 / (basis.value as number)).toFixed(2); // 4.0x — reality
    expect(bookedOnlyMer).toBeGreaterThan(5);
    expect(trueMer).toBeLessThan(5);
    const verdict = governorVerdict({ blendedMer: trueMer, breakeven: 5, cashOnHand: 100000, cashFloor: 60000, septemberStreak: 0, septemberThreshold: 5, dataFresh: true });
    expect(verdict.state).toBe("HOLD"); // the gate no longer authorizes scaling on fiction
  });
});
