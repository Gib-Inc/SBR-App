import { describe, expect, it } from "vitest";
import {
  buildCashForecastFromInputs,
  lineInHorizon,
  expandCadenceOccurrences,
  dedupPoLinesAgainstBills,
  prorateRunRateAcrossHorizons,
  type CashForecastLine,
} from "./cash-forecast-service";
import { payrollWageSeedDates } from "./cash-flow-service";
import { estimateNetPayout, PAYOUT_CONFIG } from "./expected-payouts-service";

const line = (kind: "inflow" | "outflow", amount: number, dueDate: string | null, status: CashForecastLine["status"] = "ok"): CashForecastLine => ({
  kind,
  label: `${kind}-${amount}`,
  amount,
  dueDate,
  source: "test",
  asOf: "2026-05-08",
  status,
});

describe("buildCashForecastFromInputs", () => {
  it("projects cash by horizon using only lines inside that horizon", () => {
    const result = buildCashForecastFromInputs({
      asOf: "2026-05-08",
      bank: { cashOnHand: 10_000, confirmedAt: "2026-05-08T12:00:00.000Z", stale: false, staleHours: 1 },
      inflows: [
        line("inflow", 2_000, "2026-05-10", "estimate"),
        line("inflow", 4_000, "2026-06-15", "estimate"),
      ],
      outflows: [
        line("outflow", 1_500, "2026-05-09"),
        line("outflow", 8_000, "2026-06-10"),
      ],
    }, [7, 60]);

    expect(result.startingCash).toMatchObject({ amount: 10_000, source: "bank_confirmed", status: "ok" });
    expect(result.horizons[0]).toMatchObject({ horizonDays: 7, projectedCash: 10_500, netFlows: 500, confidence: "medium" });
    expect(result.horizons[1]).toMatchObject({ horizonDays: 60, projectedCash: 6_500, netFlows: -3_500, confidence: "medium" });
  });

  it("hand-reconciles all four default horizons", () => {
    // start 50,000 · inflows: d5 +1,000, d10 +2,000, d25 +3,000, d45 +4,000
    // outflows: d3 -500, d12 -1,500, d28 -2,500, d55 -3,500
    const result = buildCashForecastFromInputs({
      asOf: "2026-05-01",
      bank: { cashOnHand: 50_000, confirmedAt: "2026-05-01T12:00:00.000Z", stale: false, staleHours: 1 },
      inflows: [line("inflow", 1_000, "2026-05-06"), line("inflow", 2_000, "2026-05-11"), line("inflow", 3_000, "2026-05-26"), line("inflow", 4_000, "2026-06-15")],
      outflows: [line("outflow", 500, "2026-05-04"), line("outflow", 1_500, "2026-05-13"), line("outflow", 2_500, "2026-05-29"), line("outflow", 3_500, "2026-06-25")],
    }, [7, 14, 30, 60]);
    expect(result.horizons.map((h) => h.projectedCash)).toEqual([
      50_000 + 1_000 - 500,                       // 7d  = 50,500
      50_000 + 3_000 - 2_000,                     // 14d = 51,000
      50_000 + 6_000 - 4_500,                     // 30d = 51,500
      50_000 + 10_000 - 8_000,                    // 60d = 52,000
    ]);
  });

  it("does not fabricate projected cash when the bank-confirmed balance is missing — netFlows still computed", () => {
    const result = buildCashForecastFromInputs({
      asOf: "2026-05-08",
      bank: null,
      inflows: [line("inflow", 500, "2026-05-09", "estimate")],
      outflows: [line("outflow", 800, "2026-05-09")],
    }, [7]);

    expect(result.startingCash).toMatchObject({ amount: null, source: "missing", status: "unknown" });
    expect(result.horizons[0].projectedCash).toBeNull();
    expect(result.horizons[0].netFlows).toBe(-300);
    expect(result.horizons[0].confidence).toBe("low");
    expect(result.horizons[0].assumptions.some((a) => a.label === "Bank-confirmed cash missing" && a.status === "unknown")).toBe(true);
  });

  it("counts PAST-DUE and UNDATED outflows in EVERY horizon (completeness)", () => {
    const result = buildCashForecastFromInputs({
      asOf: "2026-05-08",
      bank: { cashOnHand: 10_000, confirmedAt: "2026-05-08T12:00:00.000Z", stale: false, staleHours: 1 },
      inflows: [],
      outflows: [
        line("outflow", 1_000, "2026-04-01"), // past due — the delinquent sales tax case
        line("outflow", 250, null),           // undated
        line("outflow", 500, "2026-07-01"),   // future, outside 7d
      ],
    }, [7, 60]);
    expect(result.horizons[0].netFlows).toBe(-1_250);        // past-due + undated, NOT the July bill
    expect(result.horizons[0].projectedCash).toBe(8_750);
    expect(result.horizons[1].netFlows).toBe(-1_750);        // 60d picks up the July bill too
  });
});

describe("lineInHorizon", () => {
  it("includes past-due in the shortest horizon and future lines only within window", () => {
    expect(lineInHorizon(line("outflow", 1, "2026-05-01"), "2026-05-08", 7)).toBe(true);   // past due
    expect(lineInHorizon(line("outflow", 1, null), "2026-05-08", 7)).toBe(true);           // undated
    expect(lineInHorizon(line("outflow", 1, "2026-05-15"), "2026-05-08", 7)).toBe(true);   // day 7
    expect(lineInHorizon(line("outflow", 1, "2026-05-16"), "2026-05-08", 7)).toBe(false);  // day 8
  });
});

describe("expandCadenceOccurrences (MCA cutoff fix)", () => {
  it("daily cadence lands on business days only", () => {
    // 2026-05-08 is a Friday → next 7 days contain 5 weekdays (Mon-Fri 11th-15th)
    const days = expandCadenceOccurrences("2026-05-08", 7, "daily");
    expect(days).toEqual(["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15"]);
  });
  it("weekly and biweekly step correctly and monthly expands to nothing", () => {
    expect(expandCadenceOccurrences("2026-05-08", 30, "weekly")).toHaveLength(4);
    expect(expandCadenceOccurrences("2026-05-08", 30, "biweekly")).toHaveLength(2);
    expect(expandCadenceOccurrences("2026-05-08", 30, "monthly")).toHaveLength(0);
  });
  it("a daily MCA debit now hits the 7-day horizon instead of a mid-month lump", () => {
    const debits = expandCadenceOccurrences("2026-05-08", 7, "daily").map((d) => line("outflow", 984, d, "estimate"));
    const result = buildCashForecastFromInputs({
      asOf: "2026-05-08",
      bank: { cashOnHand: 20_000, confirmedAt: "2026-05-08T12:00:00.000Z", stale: false, staleHours: 1 },
      inflows: [],
      outflows: debits,
    }, [7]);
    expect(result.horizons[0].netFlows).toBe(-4_920); // 5 business days × $984
  });
});

describe("prorateRunRateAcrossHorizons (ad spend per horizon)", () => {
  it("every horizon carries its incremental share — day-7 slice exists", () => {
    const lines = prorateRunRateAcrossHorizons(100, "2026-05-08", [7, 14, 30, 60], {
      kind: "outflow", source: "test", asOf: "2026-05", status: "estimate",
    }, "Marketing");
    expect(lines.map((l) => l.amount)).toEqual([700, 700, 1_600, 3_000]);
    expect(lines.map((l) => l.dueDate)).toEqual(["2026-05-15", "2026-05-22", "2026-06-07", "2026-07-07"]);
    // the 7-day horizon actually contains ad spend now
    const result = buildCashForecastFromInputs({
      asOf: "2026-05-08",
      bank: { cashOnHand: 10_000, confirmedAt: "2026-05-08T12:00:00.000Z", stale: false, staleHours: 1 },
      inflows: [], outflows: lines,
    }, [7, 60]);
    expect(result.horizons[0].netFlows).toBe(-700);
    expect(result.horizons[1].netFlows).toBe(-6_000);
  });
});

describe("dedupPoLinesAgainstBills (one event, one entry)", () => {
  it("drops a PO already covered by a QBO bill and keeps the rest", () => {
    const poLines = [
      { ...line("outflow", 5_000, "2026-05-20", "estimate"), label: "PO-2026-0011 · FX Industries" },
      { ...line("outflow", 2_000, "2026-05-22", "estimate"), label: "PO-2026-0012 · Pednar" },
    ];
    const { kept, droppedCount, droppedTotal } = dedupPoLinesAgainstBills(poLines, ["Bill for PO-2026-0011", "misc"]);
    expect(droppedCount).toBe(1);
    expect(droppedTotal).toBe(5_000);
    expect(kept).toHaveLength(1);
    expect(kept[0].label).toContain("PO-2026-0012");
  });
});

describe("payrollWageSeedDates (payroll visibility)", () => {
  it("returns the next two semimonthly paydates strictly after asOf", () => {
    expect(payrollWageSeedDates("2026-07-10")).toEqual(["2026-07-15", "2026-07-31"]);
    expect(payrollWageSeedDates("2026-07-20")).toEqual(["2026-07-31", "2026-08-15"]);
    expect(payrollWageSeedDates("2026-07-31")).toEqual(["2026-08-15", "2026-08-31"]);
  });
});

describe("estimateNetPayout (gross vs net — Shopify Capital skim)", () => {
  it("nets both the marketplace fee and the payout skim", () => {
    expect(estimateNetPayout(10_000, 0.029, 0.17)).toBe(8_010); // 10,000 × (1 − 0.029 − 0.17)
    expect(estimateNetPayout(10_000, 0.15, 0)).toBe(8_500);
    expect(estimateNetPayout(0, 0.029, 0.17)).toBe(0);
  });
  it("config carries the Shopify skim so consumers can exclude the facility from debt outflows", () => {
    expect(PAYOUT_CONFIG.shopify.skimPct).toBeGreaterThan(0);
    expect(PAYOUT_CONFIG.amazon.skimPct).toBe(0);
  });
});
