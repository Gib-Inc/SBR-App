import { describe, it, expect } from "vitest";
import { assembleMonth, merDenominator, resolveQbChannelSum } from "./canonical-spend-service";

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

  it("Amazon is ALWAYS flagged understated — ad_metrics knowably undercounts vs Giant Horizons", () => {
    const m = assembleMonth("2026-06", { qbGoogle: 5000, metaSnap: 10000, amazon: 3000, booked: 40000 });
    expect(m.byChannel.AMAZON).toMatchObject({ spend: 3000, understated: true });
    expect(m.byChannel.AMAZON.gapReason).toMatch(/giant horizons/i);
  });
});

describe("resolveQbChannelSum — a NULL FILTERed sum is only a real $0 in a CLOSED month", () => {
  it("CURRENT month with no channel rows → null (QB hasn't booked yet), never 0", () => {
    expect(resolveQbChannelSum(null, "2026-07", "2026-07")).toBeNull();
    expect(resolveQbChannelSum(undefined, "2026-07", "2026-07")).toBeNull();
  });
  it("CLOSED month with no channel rows keeps the $0 behavior ($0 is plausibly real there)", () => {
    expect(resolveQbChannelSum(null, "2026-05", "2026-07")).toBe(0);
  });
  it("a real sum passes through numerically (pg returns numeric as string)", () => {
    expect(resolveQbChannelSum("11000.00", "2026-06", "2026-07")).toBe(11000);
    expect(resolveQbChannelSum(348.25, "2026-07", "2026-07")).toBe(348.25);
  });
});

describe("assembleMonth — current-month Google gap is never a confident $0", () => {
  it("in-progress month, QB absent → null + low confidence + understated + gapReason", () => {
    const m = assembleMonth("2026-07", { qbGoogle: null, isCurrentMonth: true, metaSnap: 7286.43, amazon: 1000, booked: 20000 });
    expect(m.byChannel.GOOGLE.spend).toBeNull();
    expect(m.byChannel.GOOGLE.source).toBe("none");
    expect(m.byChannel.GOOGLE.confidence).toBe("low");
    expect(m.byChannel.GOOGLE.understated).toBe(true);
    expect(m.byChannel.GOOGLE.gapReason).toMatch(/in-progress/i);
  });
  it("a genuinely booked $0 stays source quickbooks / confidence high", () => {
    const m = assembleMonth("2026-03", { qbGoogle: 0, qbMeta: 50000, booked: 60000 });
    expect(m.byChannel.GOOGLE).toMatchObject({ spend: 0, source: "quickbooks", confidence: "high" });
  });
  it("a PAST month's gap keeps the old shape (null, not understated)", () => {
    const m = assembleMonth("2026-04", { qbGoogle: null, qbMeta: 50000, booked: 60000 });
    expect(m.byChannel.GOOGLE.spend).toBeNull();
    expect(m.byChannel.GOOGLE.understated).toBe(false);
    expect(m.byChannel.GOOGLE.gapReason).toMatch(/no QB Google/i);
  });
});

describe("merDenominator — THE one MER-denominator composition (booked + credit-line Meta)", () => {
  it("card era: booked alone is complete (Meta already inside booked)", () => {
    expect(merDenominator({ booked: 106650, creditLineMeta: null, creditLineEra: false }))
      .toEqual({ value: 106650, understated: false });
  });
  it("credit-line era with tracker Meta: booked + Meta", () => {
    expect(merDenominator({ booked: 90000, creditLineMeta: 12903, creditLineEra: true }))
      .toEqual({ value: 102903, understated: false });
  });
  it("credit-line era with NO tracker Meta: booked alone, flagged understated (never pretend it's complete)", () => {
    expect(merDenominator({ booked: 40000, creditLineMeta: null, creditLineEra: true }))
      .toEqual({ value: 40000, understated: true });
  });
  it("nothing available → null, understated (never a false 0)", () => {
    expect(merDenominator({ booked: null, creditLineMeta: null, creditLineEra: true }))
      .toEqual({ value: null, understated: true });
  });
  it("off-account marketing labor ADDS to the denominator (VA/Contract Labor + Gamerzdojo/Charitable)", () => {
    // Verified Jul 2026: ~$8.7K/mo VA + ~$4.9K/mo Gamerzdojo booked outside Advertising.
    expect(merDenominator({ booked: 53140, creditLineMeta: 12903, creditLineEra: true, marketingLabor: 13561 }))
      .toEqual({ value: 79604, understated: false });
  });
  it("labor genuinely $0 in a month is NOT an understatement signal", () => {
    expect(merDenominator({ booked: 50000, creditLineMeta: 12000, creditLineEra: true, marketingLabor: null }))
      .toEqual({ value: 62000, understated: false });
  });

  it("assembleMonth carries the composition: credit month = booked+Meta; card month = booked; missing Meta = understated", () => {
    const credit = assembleMonth("2026-06", { qbGoogle: 10848, qbMeta: 0, metaSnap: 12903, amazon: 2513, booked: 90000 });
    expect(credit.merDenominator).toBe(102903);
    expect(credit.merUnderstated).toBe(false);
    const card = assembleMonth("2026-04", { qbGoogle: 4059, qbMeta: 57164, amazon: 3849, pinterest: 1065, booked: 106650 });
    expect(card.merDenominator).toBe(106650); // Meta already inside booked — no double count
    expect(card.merUnderstated).toBe(false);
    const gap = assembleMonth("2026-07", { qbGoogle: 5000, qbMeta: 0, metaSnap: null, amazon: 1000, booked: 40000 });
    expect(gap.merDenominator).toBe(40000);
    expect(gap.merUnderstated).toBe(true);
  });
});
