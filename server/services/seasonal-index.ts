/**
 * Global seasonal demand index for reorder.
 *
 * The reorder engine measures trailing-91-day velocity — the CURRENT sell-through
 * rate. But SBR is sharply seasonal (a lawn product): demand peaks in spring and
 * fall and troughs in summer/winter. Ordering off flat current velocity gets you
 * caught short heading into the October peak and overstocked heading into winter.
 *
 * This index scales current velocity to the demand expected WHEN the stock will
 * actually be selling (lead time + review + safety ahead), relative to the
 * trailing window the velocity was measured in.
 *
 * Basis (v1): Shopify net_sales over two complete 12-month windows — calendar
 * 2025 and Jul-2024→Jun-2025 — each normalized to its own annual mean (so the
 * strong year-over-year GROWTH is removed and only the seasonal SHAPE remains),
 * then averaged. Annual mean of the index = 1.0. QuickBooks can't provide this
 * (single "Sales" item) and the app's own order history is too short (~4.5mo),
 * so the numbers come from Shopify's retained analytics. Refresh by replacing
 * this array (or, later, sourcing it from a CSV-backfilled sales_order_lines).
 */

// index[0] = January … index[11] = December. Multiplier vs an average month.
export const DEFAULT_SEASONAL_INDEX: number[] = [
  0.37, // Jan
  0.68, // Feb
  1.59, // Mar  ← spring ramp
  0.99, // Apr
  0.77, // May
  0.68, // Jun
  0.74, // Jul
  1.17, // Aug
  1.10, // Sep
  1.88, // Oct  ← fall peak
  1.26, // Nov
  0.76, // Dec
];

/** Safe lookup: 1-based month → index value, defaulting to 1.0 (neutral). */
export function monthIndex(idx: number[], month1to12: number): number {
  if (!idx || idx.length !== 12) return 1;
  const v = idx[(((month1to12 - 1) % 12) + 12) % 12];
  return v && v > 0 ? v : 1;
}

/**
 * Seasonal adjustment for a reorder placed `now`. Scales current velocity to the
 * season at mid-coverage (lead + 2 weeks ahead) versus the trailing-3-month
 * window the velocity reflects. Clamped to [0.5, 2.5] so a noisy index can't
 * produce a wild swing. Returns 1.0 (no-op) if the index is missing/invalid.
 */
export function seasonalAdjustmentFactor(idx: number[], now: Date, leadTimeDays: number): number {
  if (!idx || idx.length !== 12) return 1;
  const coverAheadWeeks = Math.max(0, leadTimeDays || 14) / 7 + 2;
  const target = new Date(now);
  target.setDate(target.getDate() + Math.round(coverAheadWeeks * 7));
  const targetFactor = monthIndex(idx, target.getMonth() + 1);

  // Denominator: trailing-3-month average (matches the 91-day velocity window).
  let sum = 0;
  let n = 0;
  for (let k = 0; k < 3; k++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - k);
    sum += monthIndex(idx, d.getMonth() + 1);
    n++;
  }
  const currentFactor = n ? sum / n : 1;
  if (currentFactor <= 0) return 1;

  const f = targetFactor / currentFactor;
  return Math.max(0.5, Math.min(2.5, f));
}
