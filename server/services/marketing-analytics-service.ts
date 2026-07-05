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
/** Blended ROAS above this is almost always under-reported spend, not a real return. */
export const IMPLAUSIBLE_BLENDED_ROAS = 20; // SBR's historical band is ~8-10x
export function isImplausibleBlendedRoas(roas: number): boolean {
  return roas > IMPLAUSIBLE_BLENDED_ROAS;
}

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
  // D5: the ONE spend verdict. Media ROAS (above) judges the ads; the governor's
  // blended MER (all marketing cost incl. credit-line Meta, vs the 5x breakeven)
  // decides whether scaling is AUTHORIZED. FinOps and Green Line render this same
  // object so the two surfaces can never disagree.
  governor?: {
    state: "ALLOW_SCALE" | "HOLD" | "BLOCK";
    blendedMer: number | null;
    breakeven: number;
    merBasis30d: number | null;
    merUnderstated: boolean;
    reasons: string[];
  } | null;
}

/** D5: the governor gate — media ROAS may PROPOSE a scale; only the blended-MER
 *  governor can AUTHORIZE it. A SCALE directive demotes to HOLD whenever the
 *  governor doesn't say ALLOW_SCALE (never touches PAUSE/REDUCE/ESCALATE cuts —
 *  the gate only blocks spending MORE, never blocks defensive action). Pure. */
export function applyGovernorGate(
  d: Directive,
  gov: { state: string; blendedMer: number | null; breakeven: number; reasons: string[] } | null,
): Directive {
  if (d.action !== "SCALE") return d;
  if (gov && gov.state === "ALLOW_SCALE") return d;
  // The headline must state the governor's ACTUAL reason — it can be HOLDing on the
  // cash floor, the September Rule, or an incomplete basis while MER is fine.
  // Hardcoding a MER clause here would assert a false fact on those paths.
  const why = gov?.reasons?.[0] ?? "the MER governor is unavailable";
  return {
    ...d,
    action: "HOLD",
    magnitudePct: 0,
    severity: "warn",
    headline: gov
      ? `Hold — media ROAS clears the target, but the governor does not authorize scaling: ${why}`
      : "Hold — the MER governor is unavailable; scaling is never authorized without the breakeven gate.",
    reason: `${d.reason} GOVERNOR OVERRIDE: media ROAS judges the ads in isolation; the blended MER (ALL marketing cost, including credit-line Meta the ledger doesn't book) and the cash floor decide whether scaling is affordable.${gov ? ` ${gov.reasons.join(" ")}` : ""}`,
  };
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
  // getUnifiedPerformance defaults nowMs to epoch 0 (deterministic for tests) —
  // callers MUST pass the real clock or the window lands in 1970.
  const nowMs = Date.now();
  const v7 = await getUnifiedPerformance(7, nowMs);
  const v30 = await getUnifiedPerformance(30, nowMs);

  const adSpend7d = v7.totalAdSpend ?? 0;
  const adSpend30d = v30.totalAdSpend ?? 0;
  const revenue7d = v7.totalRevenue ?? 0;
  const revenue30d = v30.totalRevenue ?? 0;
  const avgDailySpend = adSpend30d > 0 ? adSpend30d / 30 : 0;

  // C6: the REAL blended contribution margin (order-ledger COGS + channel fees)
  // replaces the hardcoded 0.6 as the default margin feed. Failure → legacy
  // default with an explicit dataGap, never a silent guess.
  let contributionMarginPct: number | null = null;
  try {
    const { getBlendedContributionMargin } = await import("./contribution-margin-service");
    const { db } = await import("../db");
    contributionMarginPct = (await getBlendedContributionMargin(db, 30)).contributionMarginPct;
  } catch { /* feed unavailable → legacy default + dataGap below */ }

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
    // Explicit operator override > real measured contribution > legacy 0.6 default.
    grossMarginPct: opts?.grossMarginPct ?? contributionMarginPct ?? undefined,
  });
  const series = dailyRoas.length ? [...dailyRoas, today.roas] : [today.roas];

  let directive = generateDirective({ platform: "BLENDED", roasSeries: series, today });
  const blendedRoas30d = adSpend30d > 0 ? round2(revenue30d / adSpend30d) : 0;
  const dataGaps = Array.from(new Set([...(v7.dataGaps || []), ...(v30.dataGaps || [])]));
  if (contributionMarginPct == null && opts?.grossMarginPct == null) {
    dataGaps.push("contribution-margin feed unavailable — margin defaulted to the legacy 60% assumption");
  }
  // A blended ROAS far above SBR's historical ~8-10x band almost always means
  // ad spend is under-reported (a missing platform/feed), not a real return —
  // treat it as a data gap so we never tell Matt to scale on phantom returns.
  if (isImplausibleBlendedRoas(blendedRoas30d)) {
    dataGaps.push(
      `Blended ROAS ${blendedRoas30d.toFixed(1)}x exceeds the ${IMPLAUSIBLE_BLENDED_ROAS}x plausibility ceiling — ad spend is likely under-reported`,
    );
  }
  const gapped =
    v30.status === "DATA_GAPPED" ||
    v7.status === "DATA_GAPPED" ||
    adSpend30d <= 0 ||
    isImplausibleBlendedRoas(blendedRoas30d);
  directive = applyDataQualityGate(directive, dataGaps, gapped);

  // D5: the governor gate. The 6:30 AM directive Matt reads every morning ran on
  // media-ROAS alone (8x band) — it could say SCALE at 8.97x media ROAS while true
  // blended MER sat at ~3x vs the 5x breakeven. Governor failure fails CLOSED for
  // scaling (applyGovernorGate(_, null) demotes SCALE → HOLD).
  let governor: BlendedAnalysis["governor"] = null;
  try {
    const { computeGovernor } = await import("./marketing-governor-service");
    const { db } = await import("../db");
    const g = await computeGovernor(db);
    governor = {
      state: g.state, blendedMer: g.blendedMer, breakeven: g.breakeven,
      merBasis30d: g.merBasis30d, merUnderstated: g.merUnderstated, reasons: g.reasons,
    };
  } catch (e: any) {
    console.warn("[MarketingAnalytics] governor unavailable — SCALE fails closed:", e?.message ?? e);
  }
  directive = applyGovernorGate(directive, governor);

  const result: BlendedAnalysis = {
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    blendedRoas7d: round2(today.roas),
    blendedRoas30d,
    adSpend7d,
    adSpend30d,
    revenue7d,
    revenue30d,
    directive,
    dataConfident: !gapped && dataGaps.length === 0,
    dataGaps,
    governor,
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

// ─── Per-campaign daily breakdown (UI reporting layer) ───────────────────────
export interface CampaignPerformanceRow {
  platform: string;
  campaign: string;
  spend: number;
  revenue: number;
  roas: number;
  cac: number | null; // spend / conversions (conversion-proxy for new customers)
  contributionMargin: number;
  conversions: number;
  clicks: number;
  days: number;
  directive: Directive;
  gaps: string[]; // per-campaign reasons a Scale/Kill call is limited
}

/**
 * Campaign-level economics over a window, from the live ad_metrics_daily feed
 * (paid platforms only — traffic-source pollution filtered out via
 * normalizeAdPlatform). Each campaign gets its own guardrail directive, and
 * any metric that can't be trusted carries an explicit gap reason so the UI
 * can state exactly what's blocking a confident Scale/Kill call.
 */
export async function getCampaignPerformance(days = 30): Promise<{
  windowDays: number;
  campaigns: CampaignPerformanceRow[];
  notes: string[];
}> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const { normalizeAdPlatform } = await import("./unified-performance-service");
  const notes: string[] = [];

  // Pass an explicit ISO date — a parameterized integer in `CURRENT_DATE - $1`
  // reaches Postgres as `date >= integer` and errors. '_all' rows are platform
  // aggregates (they duplicate the per-campaign rows) — excluded.
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const r: any = await db.execute(sql`
    SELECT platform, coalesce(campaign, '(no campaign)') AS campaign, date,
           bool_or(sku IN ('_windsor', '_manual')) AS is_authoritative,
           sum(coalesce(spend,0)) AS spend, sum(coalesce(revenue,0)) AS revenue,
           sum(coalesce(clicks,0)) AS clicks, sum(coalesce(conversions,0)) AS conversions
    FROM ad_metrics_daily
    WHERE date >= ${since}::date AND coalesce(campaign,'') <> '_all'
    GROUP BY platform, coalesce(campaign, '(no campaign)'), date, (sku IN ('_windsor', '_manual'))`);
  let rows: any[] = r.rows ?? r ?? [];

  // SOURCE PREFERENCE: '_windsor' rows carry each platform's real attributed
  // conversion value (validated against the analyst tracker to the cent), and
  // '_manual' rows are the hand-posted Meta tracker (Meta blocked the Windsor
  // OAuth). Per canonical platform, when authoritative rows exist in the
  // window they win — the polluted live feed is dropped so spend is never
  // double-counted.
  const authoritativePlatforms = new Set(
    rows.filter((x) => x.is_authoritative).map((x) => normalizeAdPlatform(String(x.platform ?? ""))).filter(Boolean) as string[],
  );
  rows = rows.filter((x) => {
    const canonical = normalizeAdPlatform(String(x.platform ?? ""));
    if (!canonical || !authoritativePlatforms.has(canonical)) return true;
    return Boolean(x.is_authoritative);
  });

  type Agg = { spend: number; revenue: number; clicks: number; conversions: number; daily: Map<string, { spend: number; revenue: number }> };
  const byCampaign = new Map<string, Agg>();
  for (const row of rows) {
    const canonical = normalizeAdPlatform(String(row.platform ?? ""));
    if (!canonical) continue; // traffic source, not a paid platform
    const key = `${canonical}::${row.campaign}`;
    const agg = byCampaign.get(key) ?? { spend: 0, revenue: 0, clicks: 0, conversions: 0, daily: new Map() };
    agg.spend += Number(row.spend) || 0;
    agg.revenue += Number(row.revenue) || 0;
    agg.clicks += Number(row.clicks) || 0;
    agg.conversions += Number(row.conversions) || 0;
    const d = String(row.date);
    const day = agg.daily.get(d) ?? { spend: 0, revenue: 0 };
    day.spend += Number(row.spend) || 0;
    day.revenue += Number(row.revenue) || 0;
    agg.daily.set(d, day);
    byCampaign.set(key, agg);
  }

  const campaigns: CampaignPerformanceRow[] = [];
  for (const [key, agg] of Array.from(byCampaign.entries())) {
    if (agg.spend <= 0) continue;
    const [platform, campaign] = key.split("::");
    const metrics = computeAdMetrics({
      spend: agg.spend,
      revenue: agg.revenue,
      newCustomers: agg.conversions > 0 ? agg.conversions : null,
    });
    const roasSeries = Array.from(agg.daily.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => (v.spend > 0 ? round2(v.revenue / v.spend) : 0));
    const directive = generateDirective({ platform: `${platform} · ${campaign}`, roasSeries, today: metrics });

    const gaps: string[] = [];
    if (agg.revenue <= 0) gaps.push("No attributed revenue in this feed — ROAS reads 0; verify attribution before a Kill call.");
    if (agg.conversions <= 0) gaps.push("No conversions recorded — CAC unknown.");
    campaigns.push({
      platform, campaign,
      spend: round2(agg.spend), revenue: round2(agg.revenue),
      roas: metrics.roas, cac: metrics.cac, contributionMargin: metrics.contributionMargin,
      conversions: agg.conversions, clicks: agg.clicks, days: agg.daily.size,
      directive: gaps.length ? applyDataQualityGate(directive, gaps, true) : directive,
      gaps,
    });
  }
  campaigns.sort((a, b) => b.spend - a.spend);
  if (!campaigns.length) notes.push("No paid-platform campaign rows in ad_metrics_daily for this window.");

  // Attribution sanity guard: when the platform's own conversion tracking
  // attributes almost no revenue against real spend (e.g. Google reporting
  // ~0x while blended reality is ~9x), per-campaign Pause/Kill calls would be
  // actively harmful. Gate every campaign until tracking is fixed.
  const totSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totRev = campaigns.reduce((s, c) => s + c.revenue, 0);
  if (isAttributionBroken(totSpend, totRev)) {
    const g = `Platform conversion tracking is under-reporting: attributed ROAS ${(totRev / Math.max(1, totSpend)).toFixed(2)}x overall vs ~8-10x blended reality. Fix conversion tracking before acting on per-campaign calls.`;
    notes.push(g);
    for (const c of campaigns) {
      if (!c.gaps.includes(g)) c.gaps.push(g);
      c.directive = applyDataQualityGate(c.directive, c.gaps, true);
    }
  }
  return { windowDays: days, campaigns, notes };
}

/**
 * Pure: platform-attributed revenue is implausibly low against spend —
 * conversion tracking is broken, not the campaigns. Threshold 0.5x with a
 * $100 spend floor so tiny windows don't trip it.
 */
export function isAttributionBroken(totalSpend: number, totalAttributedRevenue: number): boolean {
  return totalSpend > 100 && totalAttributedRevenue / totalSpend < 0.5;
}
