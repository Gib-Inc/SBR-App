/**
 * Marketing Truth — the company's TRUE blended marketing efficiency, composed
 * for the front-and-center hero tile (finance audit §3/§5: the "Marketing
 * Truth" panel). This service ADDS NO MATH OF ITS OWN — it reads the three
 * canonical engines and refuses to look confident when any input is shaky:
 *
 *   - Blended MER          ← marketing-governor-service.computeGovernor
 *                            (trailing-30d net revenue ÷ booked QB marketing
 *                             + agency labor + credit-line Meta, fail-closed)
 *   - Contribution margin  ← contribution-margin-service (real COGS + channel
 *                            fees + measured freight; FBA gap disclosed)
 *   - Feed confidence      ← financial-reconciliation-service continuity/drift
 *                            checks (google/meta feeds, revenue-vs-QB)
 *
 * Contribution MER = Blended MER × contribution-margin% — "every $1 of
 * marketing came back as $X of contribution." Its breakeven is 1.0 by
 * construction; the revenue-MER breakeven is the measured 1/margin, shown
 * beside the team's familiar 5× rule.
 *
 * HONESTY RULE (the whole point): a confident green/red verdict renders ONLY
 * when every input is trustworthy. A dead feed, an unexpected drift, a stale
 * ad basis, or an unmeasurable margin downgrades the tile to "directional" or
 * "unreliable" — with the reasons named — instead of quietly lying. A precise
 * ROAS on a broken denominator is exactly the failure this app exists to kill.
 *
 * NOTE (operator decision, NOT flipped here): the scale-authorization governor
 * still gates on the static 5× BREAKEVEN_MER, not the measured breakeven. The
 * payload carries both so the disagreement is visible on the tile.
 */
import { computeGovernor } from "./marketing-governor-service";
import { getBlendedContributionMargin } from "./contribution-margin-service";
import { computeFinancialReconciliation } from "./financial-reconciliation-service";
import { BREAKEVEN_MER } from "./marketing-breakeven-service";

type DB = any;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type ConfidenceLevel = "high" | "directional" | "unreliable";
export type Verdict = "above" | "below" | "unavailable";

export interface MarketingTruth {
  generatedAt: string;
  windowDays: number;
  // Revenue basis
  blendedMer: number | null;
  merBreakevenMeasured: number | null; // 1 / contribution margin
  merBreakevenStatic: number;          // the team's familiar 5x rule (reference line)
  merVerdict: Verdict;                 // vs the MEASURED breakeven
  // Contribution basis
  contributionMer: number | null;      // blendedMer × contributionMarginPct
  contributionMerBreakeven: 1;
  contributionVerdict: Verdict;
  contributionMarginPct: number | null;
  // Plain-English read for the tile
  headline: string | null;
  // Denominator/margin detail (small print)
  netRevenue30d: number;
  marketingSpend30d: number | null;
  freightPct: number | null;
  marginNotes: string[];
  // Honesty layer
  confidence: ConfidenceLevel;
  confidenceReasons: string[];
  // The governor disagreement, surfaced not hidden
  governorGate: { gatesAt: number; measuredBreakeven: number | null; aligned: boolean };
}

/** Pure: verdict vs a breakeven line. Unit-tested. */
export function verdictFor(value: number | null, breakeven: number | null): Verdict {
  if (value == null || breakeven == null) return "unavailable";
  return value >= breakeven ? "above" : "below";
}

/** Pure: contribution MER from revenue MER + margin. A NEGATIVE margin
 *  produces a NEGATIVE contribution MER — "every $1 of marketing DESTROYS
 *  $X of contribution" — which must render as a screaming below-breakeven,
 *  never a blank dash (review edge-gap #2). Unit-tested. */
export function contributionMerOf(blendedMer: number | null, cmPct: number | null): number | null {
  if (blendedMer == null || cmPct == null || cmPct === 0) return null;
  return r2(blendedMer * cmPct);
}

export interface ConfidenceInputs {
  merNull: boolean;            // governor could not produce a MER at all
  merUnderstated: boolean;     // credit-line Meta missing from the basis
  adDataStale: boolean;        // governor's dataFresh === false
  cmNull: boolean;             // no margin measurable this window
  freightUnmeasured: boolean;  // freight rate fell back to excluded
  freightCapped: boolean;      // rate hit the 0.5 sanity cap — margin is distorted (edge-gap #1)
  marginNegative: boolean;     // measured margin < 0 — real below-cost selling OR a data anomaly (edge-gap #2)
  driftingFeeds: string[];     // recon checks in unexpected DRIFT (name the feed)
  unavailableFeeds: string[];  // recon checks that could not evaluate
}

/** Pure: the honesty ladder. UNRELIABLE = don't show a verdict at all;
 *  DIRECTIONAL = show it with a warning; HIGH = clean. Unit-tested. */
export function assessConfidence(i: ConfidenceInputs): { level: ConfidenceLevel; reasons: string[] } {
  const reasons: string[] = [];
  let level: ConfidenceLevel = "high";
  const downgrade = (to: ConfidenceLevel) => {
    if (to === "unreliable" || level === "unreliable") level = "unreliable";
    else level = "directional";
  };
  if (i.merNull) { reasons.push("blended MER unavailable — marketing spend basis could not be computed"); downgrade("unreliable"); }
  if (i.cmNull) { reasons.push("contribution margin unavailable — no costed order revenue in the window"); downgrade("unreliable"); }
  if (i.freightCapped) { reasons.push("measured freight rate hit its 50% sanity cap — a QB re-class or order-sync anomaly is distorting margin; investigate before trusting"); downgrade("unreliable"); }
  for (const f of i.driftingFeeds) { reasons.push(`${f} is drifting — check the feed before trusting this number`); downgrade("unreliable"); }
  if (i.marginNegative) { reasons.push("contribution margin is NEGATIVE — either selling below cost or a COGS/fee anomaly; verify the inputs before acting on the verdict"); downgrade("directional"); }
  if (i.adDataStale) { reasons.push("ad-spend data is stale (no fresh rows) — denominator may be missing recent spend"); downgrade("directional"); }
  if (i.merUnderstated) { reasons.push("credit-line Meta missing from the spend basis — upload the Meta tracker; true MER is LOWER than shown"); downgrade("directional"); }
  if (i.freightUnmeasured) { reasons.push("freight rate unmeasurable this window — margin excludes outbound shipping"); downgrade("directional"); }
  for (const f of i.unavailableFeeds) { reasons.push(`${f} could not be evaluated — one eye closed`); downgrade("directional"); }
  return { level, reasons };
}

/** Pure: the one-line English read. Unit-tested. */
export function composeHeadline(blendedMer: number | null, contributionMer: number | null): string | null {
  if (blendedMer == null) return null;
  const rev = `every $1 of marketing → $${blendedMer.toFixed(2)} revenue`;
  return contributionMer == null ? rev : `${rev} / $${contributionMer.toFixed(2)} contribution`;
}

// Recon check keys that guard THIS tile's inputs, and the names the operator sees.
const FEED_CHECKS: Record<string, string> = {
  google_spend_feed: "the Google ad-spend feed",
  meta_spend_feed: "the Meta ad-spend feed",
  monthly_revenue: "order revenue vs QuickBooks",
};

export async function getMarketingTruth(db: DB): Promise<MarketingTruth> {
  const [gov, cm] = await Promise.all([
    computeGovernor(db),
    getBlendedContributionMargin(db, 30),
  ]);

  // Feed health — recon failure itself is a confidence event, never a crash.
  const driftingFeeds: string[] = [];
  const unavailableFeeds: string[] = [];
  try {
    const recon = await computeFinancialReconciliation(db);
    for (const c of recon.checks) {
      const label = FEED_CHECKS[c.key];
      if (!label) continue;
      if (c.status === "drift" && !c.expected) driftingFeeds.push(label);
      else if (c.status === "unavailable") unavailableFeeds.push(label);
    }
  } catch {
    unavailableFeeds.push("the reconciliation guard (errored)");
  }

  const cmPct = cm.contributionMarginPct;
  const contributionMer = contributionMerOf(gov.blendedMer, cmPct);
  const { level, reasons } = assessConfidence({
    merNull: gov.blendedMer == null,
    merUnderstated: gov.merUnderstated,
    adDataStale: gov.dataFresh === false,
    cmNull: cmPct == null,
    freightUnmeasured: cm.freightPct == null,
    freightCapped: cm.freightPct != null && cm.freightPct >= 0.5,
    marginNegative: cmPct != null && cmPct < 0,
    driftingFeeds,
    unavailableFeeds,
  });

  const marginNotes = [
    ...(cm.freightPct != null
      ? [`freight loaded at the measured ${(cm.freightPct * 100).toFixed(1)}% of revenue (QB, trailing 90d)`]
      : []),
    "excl. Amazon FBA pick-pack (unbooked in QB — Seller Central ingestion pending; ~1% blended)",
  ];

  return {
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    blendedMer: gov.blendedMer,
    merBreakevenMeasured: cm.impliedBreakevenMer,
    merBreakevenStatic: BREAKEVEN_MER,
    merVerdict: level === "unreliable" ? "unavailable" : verdictFor(gov.blendedMer, cm.impliedBreakevenMer),
    contributionMer,
    contributionMerBreakeven: 1,
    contributionVerdict: level === "unreliable" ? "unavailable" : verdictFor(contributionMer, 1),
    contributionMarginPct: cmPct,
    headline: level === "unreliable" ? null : composeHeadline(gov.blendedMer, contributionMer),
    netRevenue30d: gov.netRevenue30d,
    marketingSpend30d: gov.merBasis30d,
    freightPct: cm.freightPct,
    marginNotes,
    confidence: level,
    confidenceReasons: reasons,
    governorGate: {
      gatesAt: gov.breakeven,
      measuredBreakeven: cm.impliedBreakevenMer,
      aligned: cm.impliedBreakevenMer != null && gov.breakeven === cm.impliedBreakevenMer,
    },
  };
}
