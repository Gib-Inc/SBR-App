import { describe, it, expect } from "vitest";
import { assembleMonth } from "./canonical-spend-service";

describe("assembleMonth — per-channel precedence", () => {
  it("daily-card month: Google=QB, Meta=QB-Facebook (high), Amazon/Pinterest=ad_metrics", () => {
    const m = assembleMonth("2026-04", { qbGoogle: 4059, qbMeta: 57164, amazon: 3849, pinterest: 1065, booked: 106650 });
    expect(m.byChannel.GOOGLE).toMatchObject({ spend: 4059, source: "quickbooks", confidence: "high" });
    expect(m.byChannel.META).toMatchObject({ spend: 57164, source: "quickbooks:facebook", confidence: "high", understated: false });
    expect(m.byChannel.AMAZON.spend).toBe(3849);
    expect(m.byChannel.PINTEREST.spend).toBe(1065);
    expect(m.channelTotal).toBe(66137); // 4059+57164+3849+1065
    expect(m.bookedMarketingTotal).toBe(106650);
    expect(m.otherMarketing).toBe(40513); // 106650 - 66137 (agency/creative/etc.)
  });

  it("credit-line month: Meta comes from the compliant tracker, flagged understated", () => {
    const m = assembleMonth("2026-06", { qbGoogle: 10848, qbMeta: 0, metaSnap: 12903, amazon: 2513, pinterest: null, booked: 90000 });
    expect(m.byChannel.META).toMatchObject({ spend: 12903, source: "tracker:compliant", confidence: "medium", understated: true });
    expect(m.byChannel.META.gapReason).toMatch(/credit line/i);
    expect(m.byChannel.PINTEREST.spend).toBeNull(); // no data → null + gap, NOT 0
    expect(m.byChannel.PINTEREST.gapReason).toBeTruthy();
    expect(m.channelTotal).toBe(26264); // 10848 + 12903 + 2513 (+ Pinterest null=0)
  });

  it("FLAG-DON'T-FABRICATE: a missing channel is null + gapReason, never 0", () => {
    const m = assembleMonth("2026-04", { qbGoogle: null, qbMeta: 50000, amazon: null, pinterest: null, booked: null });
    expect(m.byChannel.GOOGLE.spend).toBeNull();
    expect(m.byChannel.GOOGLE.gapReason).toBeTruthy();
    expect(m.byChannel.AMAZON.spend).toBeNull();
    expect(m.otherMarketing).toBeNull(); // no booked total
    expect(m.channelTotal).toBe(50000); // only Meta present
  });

  it("credit-line month with NO compliant tracker → Meta null + understated gap (never a false 0)", () => {
    const m = assembleMonth("2026-07", { qbGoogle: 5000, qbMeta: 0, metaSnap: null, amazon: 1000, pinterest: null, booked: 40000 });
    expect(m.byChannel.META.spend).toBeNull();
    expect(m.byChannel.META.understated).toBe(true);
    expect(m.byChannel.META.gapReason).toMatch(/credit line/i);
  });
});
