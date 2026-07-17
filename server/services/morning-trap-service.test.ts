import { describe, it, expect, vi } from "vitest";

// The service module imports the audit logger and websocket-free integrations
// at module scope; mock the audit logger so no real storage/DB is touched if a
// test ever exercises the reporting hook.
vi.mock("./audit-logger", () => ({
  AuditLogger: {
    logEvent: vi.fn().mockResolvedValue(undefined),
    logIntegrationSync: vi.fn().mockResolvedValue(undefined),
  },
}));

import { MorningTrapService, isGoogleAttributionGapped } from "./morning-trap-service";
import { NumericWhitelist } from "./numeric-grounding";

// ── Shared Google attribution-gap gate (payload builder + n8n webhook) ─────
describe("isGoogleAttributionGapped", () => {
  it("spend > 0 with revenue <= 0 → gapped (missing attribution field, not zero sales)", () => {
    expect(isGoogleAttributionGapped({ totalSpend: 123.45, totalRevenue: 0 })).toBe(true);
  });

  it("spend > 0 with revenue > 0 → not gapped", () => {
    expect(isGoogleAttributionGapped({ totalSpend: 123.45, totalRevenue: 456.78 })).toBe(false);
  });

  it("spend 0 → not gapped (nothing spent, nothing to attribute)", () => {
    expect(isGoogleAttributionGapped({ totalSpend: 0, totalRevenue: 0 })).toBe(false);
  });

  it("null/undefined data → not gapped", () => {
    expect(isGoogleAttributionGapped(null)).toBe(false);
    expect(isGoogleAttributionGapped(undefined)).toBe(false);
  });
});

// ── Validator escalation: reject → regenerate once → deterministic fallback ─
describe("composeVerifiedBriefing (numeric-grounding escalation)", () => {
  // Whitelist knows $500 and 40; "$9,876.54" is a fabricated figure.
  const whitelist = new NumericWhitelist().add(500, 40);
  const CLEAN = "Gross sales: $500.00 across 40 orders. Go win your ground war.";
  const FABRICATED = "Gross sales: $9,876.54 across 40 orders. Looking strong!";
  const FALLBACK = "[deterministic briefing — LLM draft failed numeric verification twice]\nGross sales: $500.00";

  it("clean first draft is sent as-is (no retry, no fallback)", async () => {
    const generate = vi.fn().mockResolvedValue(CLEAN);
    const res = await MorningTrapService.composeVerifiedBriefing({
      generate,
      whitelist,
      deterministicFallback: () => FALLBACK,
    });
    expect(res.verification).toBe("clean");
    expect(res.briefing).toBe(CLEAN);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith();
  });

  it("fabricated figure once → ONE retry with the flagged figures in the system note; clean retry is used", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce(FABRICATED)
      .mockResolvedValueOnce(CLEAN);
    const violations: Array<{ attempt: number; flagged: string[] }> = [];
    const res = await MorningTrapService.composeVerifiedBriefing({
      generate,
      whitelist,
      deterministicFallback: () => FALLBACK,
      onViolation: (attempt, flagged) => { violations.push({ attempt, flagged }); },
    });
    expect(res.verification).toBe("retry");
    expect(res.briefing).toBe(CLEAN);
    expect(generate).toHaveBeenCalledTimes(2);
    // The retry call names the fabricated figure and demands data-block numbers only.
    const retryNote = generate.mock.calls[1][0] as string;
    expect(retryNote).toContain("Your previous draft contained figures not present in the data block");
    expect(retryNote).toContain("$9,876.54");
    expect(retryNote).toContain("Re-compose using ONLY data-block numbers");
    expect(violations).toEqual([{ attempt: 1, flagged: ["$9,876.54"] }]);
  });

  it("fabricated figure TWICE → LLM prose is never sent; deterministic fallback is used", async () => {
    const generate = vi.fn().mockResolvedValue(FABRICATED);
    const violations: number[] = [];
    const res = await MorningTrapService.composeVerifiedBriefing({
      generate,
      whitelist,
      deterministicFallback: () => FALLBACK,
      onViolation: (attempt) => { violations.push(attempt); },
    });
    expect(res.verification).toBe("deterministic-fallback");
    expect(res.briefing).toBe(FALLBACK);
    expect(res.briefing).not.toContain("$9,876.54");
    expect(generate).toHaveBeenCalledTimes(2); // draft + exactly one retry
    expect(violations).toEqual([1, 2]);
  });

  it("retry call crashing does not resurrect the rejected draft — fallback is used", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce(FABRICATED)
      .mockRejectedValueOnce(new Error("api down"));
    const res = await MorningTrapService.composeVerifiedBriefing({
      generate,
      whitelist,
      deterministicFallback: () => FALLBACK,
    });
    expect(res.verification).toBe("deterministic-fallback");
    expect(res.briefing).toBe(FALLBACK);
  });
});

// ── Deterministic fallback content ──────────────────────────────────────────
describe("buildDeterministicBriefing", () => {
  it("composes purely from the data payload: header, raw figures, NO DATA lines, attribution gap", () => {
    const briefing = MorningTrapService.buildDeterministicBriefing(
      "2026-07-17",
      {
        orderCount: 40,
        grossSales: 500,
        refundedOrders: 2,
        cancelledOrders: 1,
        sourceBreakdown: { web: { orders: 30, revenue: 400 }, amazon: { orders: 10, revenue: 100 } },
        recentOrders: [],
      },
      undefined,
      { totalSpend: 123.45, totalRevenue: 0, totalConversions: 5, totalClicks: 60, totalImpressions: 900, roas: 0, campaigns: [] },
      undefined,
    );
    expect(briefing).toContain("[deterministic briefing — LLM draft failed numeric verification twice]");
    expect(briefing).toContain("2026-07-17 TRAP CHECK");
    expect(briefing).toContain("Spend: $123.45");
    // Attribution-gapped Google: no $0 sales / ROAS 0:1 fiction.
    expect(briefing).toContain("data gap");
    expect(briefing).not.toContain("ROAS: 0.0:1");
    expect(briefing).toContain("Gross sales: $500.00 | Orders: 40");
    expect(briefing).toContain("web: 30 orders, $400.00");
    expect(briefing).toContain("Go win your ground war.");
  });

  it("reports NO DATA lines with the source error when a pull failed", () => {
    const briefing = MorningTrapService.buildDeterministicBriefing(
      "2026-07-17",
      null,
      "Shopify not configured",
      null,
      "Google Ads token refresh failed",
    );
    expect(briefing).toContain("GOOGLE ADS: NO DATA — Google Ads token refresh failed. Route to Matt.");
    expect(briefing).toContain("SHOPIFY: NO DATA — Shopify not configured. Route to Matt.");
  });
});
