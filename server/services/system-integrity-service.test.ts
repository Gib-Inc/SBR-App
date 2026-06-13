import { describe, it, expect } from "vitest";
import {
  classifyStream,
  rollupIntegrity,
  type StreamResult,
} from "./system-integrity-service";

describe("classifyStream", () => {
  it("is OK below the warn threshold", () => {
    expect(classifyStream(0)).toBe("OK");
  });
  it("is WARN at/above warnAt but below driftAt", () => {
    expect(classifyStream(1)).toBe("WARN");
    expect(classifyStream(4)).toBe("WARN");
  });
  it("is DRIFT at/above driftAt", () => {
    expect(classifyStream(5)).toBe("DRIFT");
    expect(classifyStream(50)).toBe("DRIFT");
  });
  it("respects custom thresholds", () => {
    expect(classifyStream(2, { warnAt: 1, driftAt: 3 })).toBe("WARN");
    expect(classifyStream(3, { warnAt: 1, driftAt: 3 })).toBe("DRIFT");
  });
});

describe("rollupIntegrity", () => {
  const mk = (stream: string, status: StreamResult["status"], anomalies: number): StreamResult => ({
    stream,
    status,
    anomalies,
    checked: 100,
    summary: "",
  });

  it("reports OK and zero anomalies when all streams are clean", () => {
    const out = rollupIntegrity([mk("inventory", "OK", 0), mk("ad-spend", "OK", 0)]);
    expect(out.status).toBe("OK");
    expect(out.totalAnomalies).toBe(0);
  });

  it("escalates to the worst stream status", () => {
    const out = rollupIntegrity([
      mk("inventory", "OK", 0),
      mk("ad-spend", "WARN", 2),
      mk("financial", "DRIFT", 6),
    ]);
    expect(out.status).toBe("DRIFT");
    expect(out.totalAnomalies).toBe(8);
  });

  it("is WARN (not DRIFT) when the worst stream is only WARN", () => {
    const out = rollupIntegrity([mk("inventory", "OK", 0), mk("ad-spend", "WARN", 3)]);
    expect(out.status).toBe("WARN");
    expect(out.totalAnomalies).toBe(3);
  });

  it("handles an empty stream list as clean", () => {
    const out = rollupIntegrity([]);
    expect(out.status).toBe("OK");
    expect(out.totalAnomalies).toBe(0);
  });
});

import { salesMagnitudeAnomaly } from "./system-integrity-service";

describe("salesMagnitudeAnomaly (catches the 10x sales inflation)", () => {
  it("flags a day running far above the median (the incident)", () => {
    const r = salesMagnitudeAnomaly(110000, 11000); // ~10x
    expect(r.anomalous).toBe(true);
    expect(r.ratio).toBe(10);
  });
  it("accepts a normal day near the median", () => {
    expect(salesMagnitudeAnomaly(12500, 11000).anomalous).toBe(false);
  });
  it("flags a near-total collapse vs the median", () => {
    expect(salesMagnitudeAnomaly(500, 11000).anomalous).toBe(true); // ~0.05x
  });
  it("ignores low-volume baselines (no false positive in a quiet stretch)", () => {
    expect(salesMagnitudeAnomaly(6000, 800).anomalous).toBe(false); // median below floor
  });
  it("does not flag a zero-revenue day as a low-ratio anomaly", () => {
    expect(salesMagnitudeAnomaly(0, 11000).anomalous).toBe(false);
  });
});
