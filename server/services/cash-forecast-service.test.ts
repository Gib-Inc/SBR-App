import { describe, expect, it } from "vitest";
import { buildCashForecastFromInputs, type CashForecastLine } from "./cash-forecast-service";

const line = (kind: "inflow" | "outflow", amount: number, dueDate: string, status: CashForecastLine["status"] = "ok"): CashForecastLine => ({
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
    expect(result.horizons[0]).toMatchObject({ horizonDays: 7, projectedCash: 10_500, confidence: "medium" });
    expect(result.horizons[1]).toMatchObject({ horizonDays: 60, projectedCash: 6_500, confidence: "medium" });
  });

  it("does not fabricate starting cash when the bank-confirmed balance is missing", () => {
    const result = buildCashForecastFromInputs({
      asOf: "2026-05-08",
      bank: null,
      inflows: [line("inflow", 500, "2026-05-09", "estimate")],
      outflows: [line("outflow", 800, "2026-05-09")],
    }, [7]);

    expect(result.startingCash).toMatchObject({ amount: null, source: "missing", status: "unknown" });
    expect(result.horizons[0].projectedCash).toBe(-300);
    expect(result.horizons[0].confidence).toBe("low");
    expect(result.horizons[0].assumptions.some((a) => a.label === "Bank-confirmed cash missing" && a.status === "unknown")).toBe(true);
  });
});
