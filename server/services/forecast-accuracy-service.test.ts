import { describe, it, expect } from "vitest";
import {
  percentageError,
  meanAbsolutePercentageError,
  forecastBias,
  biasCorrectionFactor,
  tunedForecast,
  accuracyGrade,
  gradeForecasts,
  type ForecastPair,
} from "./forecast-accuracy-service";

describe("percentageError", () => {
  it("is signed: positive when actual exceeds predicted (under-forecast)", () => {
    expect(percentageError(100, 110)).toBeCloseTo(0.0909, 4);
  });
  it("is negative when predicted exceeds actual (over-forecast)", () => {
    expect(percentageError(200, 180)).toBeCloseTo(-0.1111, 4);
  });
  it("returns null when there is no actual to divide by", () => {
    expect(percentageError(50, 0)).toBeNull();
  });
});

describe("meanAbsolutePercentageError", () => {
  it("averages absolute percentage errors", () => {
    const pairs: ForecastPair[] = [
      { predicted: 100, actual: 110 }, // 9.09%
      { predicted: 200, actual: 180 }, // 11.11%
    ];
    expect(meanAbsolutePercentageError(pairs)).toBe(10.1);
  });
  it("ignores pairs with a zero actual and returns 0 when none are usable", () => {
    expect(meanAbsolutePercentageError([{ predicted: 5, actual: 0 }])).toBe(0);
  });
});

describe("forecastBias", () => {
  it("is positive when the model under-predicts on average", () => {
    expect(forecastBias([{ predicted: 100, actual: 120 }])).toBeCloseTo(0.1667, 4);
  });
  it("is negative when the model over-predicts", () => {
    expect(forecastBias([{ predicted: 200, actual: 100 }])).toBe(-1);
  });
});

describe("biasCorrectionFactor (self-tuning)", () => {
  it("nudges forecasts UP when the model under-predicts (dampened)", () => {
    // bias 0.1667, dampening 0.5 -> 1 + 0.0833 = 1.0833
    expect(biasCorrectionFactor([{ predicted: 100, actual: 120 }])).toBeCloseTo(1.0833, 3);
  });
  it("clamps an extreme over-prediction to the floor (no whipsaw)", () => {
    // bias -1, raw factor 0.5, clamped to 1 - 0.3 = 0.7
    expect(biasCorrectionFactor([{ predicted: 200, actual: 100 }])).toBe(0.7);
  });
  it("is ~1 when the model is unbiased", () => {
    expect(biasCorrectionFactor([{ predicted: 100, actual: 100 }])).toBe(1);
  });
});

describe("tunedForecast", () => {
  it("applies the correction factor", () => {
    expect(tunedForecast(1000, 1.0833)).toBe(1083.3);
  });
});

describe("accuracyGrade", () => {
  it("bands MAPE into grades", () => {
    expect(accuracyGrade(4)).toBe("EXCELLENT");
    expect(accuracyGrade(8)).toBe("GOOD");
    expect(accuracyGrade(15)).toBe("FAIR");
    expect(accuracyGrade(30)).toBe("POOR");
  });
});

describe("gradeForecasts", () => {
  it("returns a full report", () => {
    const r = gradeForecasts([
      { predicted: 100, actual: 110 },
      { predicted: 200, actual: 180 },
    ]);
    expect(r.samples).toBe(2);
    expect(r.mape).toBe(10.1);
    expect(r.grade).toBe("FAIR"); // 10.1 is just over the GOOD ceiling of 10
    expect(typeof r.correctionFactor).toBe("number");
  });
});
