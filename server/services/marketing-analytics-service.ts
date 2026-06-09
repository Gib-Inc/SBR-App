/**
 * MarketingAnalyticsService — the ad Intelligence & Recommendation engine.
 * ----------------------------------------------------------------------
 * Pillar 3 of the FinOps engine: do not just display ad data, ANALYZE it.
 *
 * Pure, strictly-typed compute. Given per-platform daily series (spend,
 * attributed revenue, new customers), it derives the unit economics
 * (ROAS, CAC, contribution margin, LTV:CAC), compares today against the
 * 7-day and 30-day moving averages, and emits a concrete daily directive
 * ("Scale GOOGLE +15%", "Pause META") using SBR's own guardrails:
 *
 *   ROAS  8x = blended target   (scale above)
 *         5x = escalate line     (below → flag to Christopher)
 *         3x = pause floor       (below → pause)
 *   September Rule = block budget increases when ROAS < 8x for 5 straight days.
 *
 * No I/O here — data loading, persistence (marketing_recommendations) and
 * scheduling are wired separately so this core stays deterministic and unit
 * testable to the dollar.
 */

// ─── SBR guardrails (non-negotiables) ────────────────────────────────────────
export const ROAS_TARGET = 8; // blended target — scale above this
export const ROAS_ESCALATE = 5; // below → escalate / budget review
export const ROAS_PAUSE = 3; // below → pause
export const SEPTEMBER_RULE_DAYS = 5; // consecutive days < target that block scale-ups

// ─── Types ───────────────────────────────────────────────────────────────────
export interface PlatformDay {
  platform: string; // GOOGLE | META | AMAZON | TIKTOK | ...
  date: string; // YYYY-MM-DD
  spend: number;
  revenue: number; // platform-attributed revenue (0 when attribution missing)
  newCustomers?: number; // first-time buyers attributed (for CAC)
  clicks?: number;
  conversions?: number;
}

export interface MetricInputs {
  spend: number;
  revenue: number;
  newCustomers?: number | null;
  grossMarginPct?: number; // 0..1 — share of revenue that is gross profit (default 0.6)
  ltvPerCustomer?: number | null; // for LTV:CAC
}

export interface AdMetrics {
  spend: number;
  revenue: number;
  roas: number; // revenue / spend (0 when no spend)
  cac: number | null; // spend / newCustomers
  grossProfit: number; // revenue * grossMarginPct
  contributionMargin: number; // grossProfit - spend
  ltvToCac: number | null; // ltvPerCustomer / cac
}

export type DirectiveAction = "SCALE" | "HOLD" | "REDUCE" | "ESCALATE" | "PAUSE";

export interface Directive {
  platform: string;
  action: DirectiveAction;
  magnitudePct: number; // suggested budget change, signed (+15 = scale up 15%, -30 = cut 30%)
  severity: "info" | "warn" | "critical";
  headline: string; // one-line directive for the UI / briefing
  reason: string;
  metrics: {
    roas: number;
    roas7d: number;
    roas30d: number;
    cac: number | null;
    contributionMargin: number;
  };
  blockedBySeptemberRule: boolean;
}

// ─── Pure math ───────────────────────────────────────────────────────────────

/** Round to cents to keep money math exact and assertion-friendly. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Trailing moving average of the last `window` values. Uses however many values
 * are available when the series is shorter than the window (never NaN). Empty
 * series → 0.
 */
export function movingAverage(values: number[], window: number): number {
  if (!values.length || window <= 0) return 0;
  const slice = values.slice(-window);
  const sum = slice.reduce((a, b) => a + b, 0);
  return round2(sum / slice.length);
}

/** Derive unit economics for one period. Deterministic, no I/O. */
export function computeAdMetrics(input: MetricInputs): AdMetrics {
  const spend = Math.max(0, input.spend || 0);
  const revenue = Math.max(0, input.revenue || 0);
  const marginPct = input.grossMarginPct ?? 0.6;
  const newCustomers = input.newCustomers ?? null;

  const roas = spend > 0 ? round2(revenue / spend) : 0;
  const cac = newCustomers && newCustomers > 0 ? round2(spend / newCustomers) : null;
  const grossProfit = round2(revenue * marginPct);
  const contributionMargin = round2(grossProfit - spend);
  const ltvToCac =
    input.ltvPerCustomer != null && cac != null && cac > 0
      ? round2(input.ltvPerCustomer / cac)
      : null;

  return { spend, revenue, roas, cac, grossProfit, contributionMargin, ltvToCac };
}

/**
 * Count trailing consecutive days whose ROAS is below `threshold`. Drives the
 * September Rule (block scale-ups when ROAS < 8x for 5 straight days). The
 * series is oldest→newest; we count back from the most recent.
 */
export function consecutiveDaysBelow(roasSeries: number[], threshold: number): number {
  let n = 0;
  for (let i = roasSeries.length - 1; i >= 0; i--) {
    if (roasSeries[i] < threshold) n++;
    else break;
  }
  return n;
}

/** Suggested scale-up magnitude (%) for a healthy platform, by how far above target. */
function scaleMagnitude(roas: number): number {
  if (roas >= ROAS_TARGET * 2) return 25;
  if (roas >= ROAS_TARGET * 1.25) return 15;
  return 10;
}

export interface DirectiveContext {
  platform: string;
  /** Daily ROAS series oldest→newest, INCLUDING today as the last element. */
  roasSeries: number[];
  today: AdMetrics;
  /** Optional CAC ceiling; when today's CAC exceeds it, the directive de-escalates. */
  cacTarget?: number | null;
}

/**
 * Turn a platform's recent performance into one concrete directive using SBR's
 * ROAS guardrails + the September Rule. Pure function of its inputs.
 */
export function generateDirective(ctx: DirectiveContext): Directive {
  const { platform, roasSeries, today } = ctx;
  const roas = today.roas;
  const roas7d = movingAverage(roasSeries, 7);
  const roas30d = movingAverage(roasSeries, 30);
  // The September Rule guards against scaling up after a sustained sub-target
  // run, so a single recovery day today must NOT release it. Count the streak
  // both including today and ending yesterday, and take the longer.
  const belowTargetStreak = Math.max(
    consecutiveDaysBelow(roasSeries, ROAS_TARGET),
    consecutiveDaysBelow(roasSeries.slice(0, -1), ROAS_TARGET),
  );
  const blockedBySeptemberRule = belowTargetStreak >= SEPTEMBER_RULE_DAYS;

  const cacBreached =
    ctx.cacTarget != null && today.cac != null && today.cac > ctx.cacTarget * 1.25;

  const baseMetrics = {
    roas,
    roas7d,
    roas30d,
    cac: today.cac,
    contributionMargin: today.contributionMargin,
  };

  // Floor breach — pause regardless of anything else.
  if (roas < ROAS_PAUSE) {
    return {
      platform,
      action: "PAUSE",
      magnitudePct: -100,
      severity: "critical",
      headline: `Pause ${platform} — ROAS ${roas.toFixed(1)}x is below the ${ROAS_PAUSE}x floor.`,
      reason: `ROAS ${roas.toFixed(1)}x fell under the ${ROAS_PAUSE}x pause floor (7d ${roas7d.toFixed(1)}x, 30d ${roas30d.toFixed(1)}x). Burning margin — stop spend and rebuild the campaign.`,
      metrics: baseMetrics,
      blockedBySeptemberRule,
    };
  }

  // Below escalate line — cut and route for review.
  if (roas < ROAS_ESCALATE || cacBreached) {
    const cacNote = cacBreached
      ? ` CAC $${today.cac!.toFixed(0)} exceeded the $${ctx.cacTarget!.toFixed(0)} target by more than 25%.`
      : "";
    return {
      platform,
      action: roas < ROAS_ESCALATE ? "ESCALATE" : "REDUCE",
      magnitudePct: -30,
      severity: "warn",
      headline: `Cut ${platform} ~30% — ROAS ${roas.toFixed(1)}x below the ${ROAS_ESCALATE}x escalate line.`,
      reason: `ROAS ${roas.toFixed(1)}x is under the ${ROAS_ESCALATE}x escalate line (7d ${roas7d.toFixed(1)}x).${cacNote} Trim budget 30% and route to Christopher for a budget review.`,
      metrics: baseMetrics,
      blockedBySeptemberRule,
    };
  }

  // Between escalate and target — hold and optimize.
  if (roas < ROAS_TARGET) {
    return {
      platform,
      action: "HOLD",
      magnitudePct: 0,
      severity: "info",
      headline: `Hold ${platform} — ROAS ${roas.toFixed(1)}x below the ${ROAS_TARGET}x target.`,
      reason: `ROAS ${roas.toFixed(1)}x sits between the ${ROAS_ESCALATE}x and ${ROAS_TARGET}x lines (7d ${roas7d.toFixed(1)}x). Hold budget and optimize creative/targeting before scaling.`,
      metrics: baseMetrics,
      blockedBySeptemberRule,
    };
  }

  // At/above target — scale, unless the September Rule blocks it.
  if (blockedBySeptemberRule) {
    return {
      platform,
      action: "HOLD",
      magnitudePct: 0,
      severity: "warn",
      headline: `Hold ${platform} — September Rule (ROAS < ${ROAS_TARGET}x for ${belowTargetStreak} straight days).`,
      reason: `ROAS recovered to ${roas.toFixed(1)}x today, but it has been below the ${ROAS_TARGET}x target for ${belowTargetStreak} consecutive days. The September Rule blocks budget increases until it holds ${ROAS_TARGET}x. Hold for now.`,
      metrics: baseMetrics,
      blockedBySeptemberRule,
    };
  }

  const pct = scaleMagnitude(roas);
  return {
    platform,
    action: "SCALE",
    magnitudePct: pct,
    severity: "info",
    headline: `Scale ${platform} +${pct}% — ROAS ${roas.toFixed(1)}x above the ${ROAS_TARGET}x target.`,
    reason: `ROAS ${roas.toFixed(1)}x clears the ${ROAS_TARGET}x target (7d ${roas7d.toFixed(1)}x, 30d ${roas30d.toFixed(1)}x). Headroom to scale budget +${pct}% while it holds.`,
    metrics: baseMetrics,
    blockedBySeptemberRule,
  };
}

/**
 * Build directives for every platform from a flat daily series. Groups by
 * platform, orders each by date, computes today's metrics from the latest day,
 * and runs the guardrail engine. `grossMarginPct` / `ltvPerCustomer` /
 * `cacTargetByPlatform` are optional tuning knobs.
 */
export function analyzePlatforms(
  series: PlatformDay[],
  opts?: {
    grossMarginPct?: number;
    ltvPerCustomer?: number | null;
    cacTargetByPlatform?: Record<string, number>;
  },
): Directive[] {
  const byPlatform = new Map<string, PlatformDay[]>();
  for (const d of series) {
    const list = byPlatform.get(d.platform) ?? [];
    list.push(d);
    byPlatform.set(d.platform, list);
  }

  const directives: Directive[] = [];
  for (const [platform, daysRaw] of Array.from(byPlatform.entries())) {
    const days = [...daysRaw].sort((a, b) => a.date.localeCompare(b.date));
    if (!days.length) continue;
    const last = days[days.length - 1];
    const today = computeAdMetrics({
      spend: last.spend,
      revenue: last.revenue,
      newCustomers: last.newCustomers,
      grossMarginPct: opts?.grossMarginPct,
      ltvPerCustomer: opts?.ltvPerCustomer,
    });
    const roasSeries = days.map((d) =>
      d.spend > 0 ? round2(d.revenue / d.spend) : 0,
    );
    directives.push(
      generateDirective({
        platform,
        roasSeries,
        today,
        cacTarget: opts?.cacTargetByPlatform?.[platform] ?? null,
      }),
    );
  }

  // Most urgent first: critical → warn → info, then lowest ROAS.
  const sev = { critical: 0, warn: 1, info: 2 } as const;
  return directives.sort(
    (a, b) => sev[a.severity] - sev[b.severity] || a.metrics.roas - b.metrics.roas,
  );
}

// ─── Data-quality gate (Pillar 3 ⇄ Pillar 1) ─────────────────────────────────
/**
 * Never tell Matt to move budget on numbers we don't trust. When the ad-spend
 * feed is gapped, downgrade a confident SCALE/CUT directive to a "reconcile
 * first" HOLD, preserving what the raw call would have been for transparency.
 * Pure — unit tested.
 */
export function applyDataQualityGate(d: Directive, dataGaps: string[], gapped: boolean): Directive {
  if (!gapped && dataGaps.length === 0) return d;
  return {
    ...d,
    action: "HOLD",
    magnitudePct: 0,
    severity: "warn",
    headline: `Hold ${d.platform} — ad-spend data is incomplete; reconcile before moving budget.`,
    reason: `Computed ROAS ${d.metrics.roas.toFixed(1)}x, but the ad-spend feed is gapped (${dataGaps.slice(0, 3).join("; ") || "missing/low platform spend"}). The raw call would have been "${d.action}". Reconcile ad spend (Windsor/uploads) before acting.`,
  };
}

// ─── Live wiring (I/O; pure core above stays import-free + testable) ──────────
export interface BlendedAnalysis {
  generatedAt: string;
  windowDays: number;
  blendedRoas7d: number;
  blendedRoas30d: number;
  adSpend7d: number;
  adSpend30d: number;
  revenue7d: number;
  revenue30d: number;
  directive: Directive;
  dataConfident: boolean;
  dataGaps: string[];
}

/**
 * Compute the blended daily directive from the TRUSTED unified ad-spend
 * aggregator (windsor > uploaded > live, no double-count) + real daily revenue,
 * gate it on data quality, and persist to marketing_recommendations.
 */
export async function runMarketingAnalysis(opts?: {
  grossMarginPct?: number;
  createdBy?: string;
}): Promise<BlendedAnalysis> {
  const { getUnifiedPerformance } = await import("./unified-performance-service");
  const v7 = await getUnifiedPerformance(7);
  const v30 = await getUnifiedPerformance(30);

  const adSpend7d = v7.totalAdSpend ?? 0;
  const adSpend30d = v30.totalAdSpend ?? 0;
  const revenue7d = v7.totalRevenue ?? 0;
  const revenue30d = v30.totalRevenue ?? 0;
  const avgDailySpend = adSpend30d > 0 ? adSpend30d / 30 : 0;

  // Real daily revenue → daily blended-ROAS series (spend smoothed to the
  // 30-day average because trusted spend is period-aggregate, not daily). This
  // gives the moving averages + September-Rule streak honest day-to-day variation.
  let dailyRoas: number[] = [];
  try {
    const { storage } = await import("../storage");
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const sales = await storage.getDailySalesSnapshotsInRange(iso(start), iso(end));
    dailyRoas = (sales || [])
      .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)))
      .map((s: any) => (avgDailySpend > 0 ? round2((s.totalRevenue ?? 0) / avgDailySpend) : 0));
  } catch {
    /* aggregate-only fallback below */
  }

  const today = computeAdMetrics({
    spend: adSpend7d,
    revenue: revenue7d,
    grossMarginPct: opts?.grossMarginPct,
  });
  const series = dailyRoas.length ? [...dailyRoas, today.roas] : [today.roas];

  let directive = generateDirective({ platform: "BLENDED", roasSeries: series, today });
  const dataGaps = Array.from(new Set([...(v7.dataGaps || []), ...(v30.dataGaps || [])]));
  const gapped = v30.status === "DATA_GAPPED" || v7.status === "DATA_GAPPED" || adSpend30d <= 0;
  directive = applyDataQualityGate(directive, dataGaps, gapped);

  const result: BlendedAnalysis = {
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    blendedRoas7d: round2(today.roas),
    blendedRoas30d: adSpend30d > 0 ? round2(revenue30d / adSpend30d) : 0,
    adSpend7d,
    adSpend30d,
    revenue7d,
    revenue30d,
    directive,
    dataConfident: !gapped && dataGaps.length === 0,
    dataGaps,
  };

  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO marketing_recommendations (generated_at, recommendations, input_snapshot, model, created_by)
      VALUES (now(), ${JSON.stringify([directive])}::jsonb, ${JSON.stringify(result)}::jsonb,
              'finops-marketing-analytics-v1', ${opts?.createdBy ?? "system"})
    `);
  } catch (e: any) {
    console.warn("[MarketingAnalytics] persist failed:", e?.message ?? e);
  }

  return result;
}
