/**
 * CIPH.R Breakeven Scoreboard — the ONE reconciled marketing number to manage to.
 *
 * The app shows ROAS several ways because each view mixes a different revenue source,
 * spend source, and attribution. This anchors on the P&L truth so there's a single
 * answer to "are we at the 5x breakeven?":
 *
 *   • Revenue   = SETTLED orders (daily_sales_snapshots), never platform-attributed.
 *   • Marketing = QuickBooks "Advertising & Marketing" for CLOSED months (audited,
 *                 includes the Carpe Diem/CDUK agency fee + everything). The current
 *                 open month isn't booked yet, so it's shown with platform-tracked
 *                 media spend + a flag that the true number will be higher.
 *
 * Two ratios, both vs the 5x breakeven:
 *   • MER        = revenue / total marketing (the breakeven truth).
 *   • Media ROAS = revenue / ad-platform spend only (judges the ads; flatters MER
 *                  because it excludes the agency fee).
 *
 * Platform pixel ROAS (Amazon's 30-50x self-attribution etc.) is directional only and
 * is deliberately NOT used here.
 */
import { sql } from "drizzle-orm";
import { collapseOverlappingSnapshots } from "./unified-performance-service";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const MON = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

export const BREAKEVEN_MER = 5;
// SBR "started over" in May 2026: new Meta pixel, rebuilt campaigns, and Kevin
// (~$10K/mo in-house) replaced by the Carpe Diem agency (~$1.8K/mo). Improvement is
// measured from here.
export const RESTART_MONTH = "2026-05";

export interface MerMonth {
  month: string;            // YYYY-MM
  revenue: number;
  marketing: number;        // QB total marketing
  mer: number | null;
  vsBreakeven: number | null; // mer - breakeven
  belowBreakeven: boolean;
  netIncome: number | null;
  isRestart: boolean;       // the month SBR started over
}
export interface Trajectory {
  restartMonth: string;
  preRestartAvgMer: number | null;   // old regime
  postRestartAvgMer: number | null;  // closed months since restart
  trailingMer: number | null;        // current in-progress (provisional)
  gapToBreakeven: number | null;     // breakeven - trailingMer
  improving: boolean | null;         // trailing meaningfully above the old regime
}
export interface BreakevenScoreboard {
  breakeven: number;
  restartMonth: string;
  trajectory: Trajectory;
  // month-by-month MER (audited QB), oldest→newest
  monthly: MerMonth[];
  monthsBelowBreakeven: number;
  // current in-progress window (settled revenue + platform media; QB pending)
  current: {
    windowDays: number;
    revenue: number;            // settled, trailing window
    mediaSpend: number;         // platform-tracked (Google+Meta+Amazon)
    qbRunRate: number | null;   // latest CLOSED month's QB marketing (proxy)
    mediaRoas: number | null;   // revenue / media (ads only)
    merEstimate: number | null; // revenue / qbRunRate (true-cost estimate)
    agencyGap: number | null;   // qbRunRate - mediaSpend (agency + untracked)
    qbPending: boolean;         // true = current month not yet booked in QB
  };
}

/** Pure: breakeven status for a MER value. */
export function merStatus(mer: number | null, breakeven = BREAKEVEN_MER): { vs: number | null; below: boolean } {
  if (mer == null) return { vs: null, below: false };
  return { vs: r2(mer - breakeven), below: mer < breakeven };
}

export async function getBreakevenScoreboard(db: DB, nowMs: number): Promise<BreakevenScoreboard> {
  // 1) Closed-month MER from QuickBooks (the audited truth).
  const qb = rows(await db.execute(sql`
    SELECT year, month, revenue, ad_spend, net_income
    FROM historical_monthly_sales
    ORDER BY year, month`)) as any[];
  const monthly: MerMonth[] = qb.slice(-14).map((m) => {
    const month = `${m.year}-${MON[(num(m.month) || 1) - 1]}`;
    const revenue = r2(num(m.revenue));
    const marketing = r2(num(m.ad_spend));
    const mer = marketing > 0 ? r2(revenue / marketing) : null;
    const st = merStatus(mer);
    return { month, revenue, marketing, mer, vsBreakeven: st.vs, belowBreakeven: st.below, netIncome: m.net_income == null ? null : r2(num(m.net_income)), isRestart: month === RESTART_MONTH };
  });
  const monthsBelowBreakeven = monthly.filter((m) => m.belowBreakeven).length;
  const qbRunRate = monthly.length ? monthly[monthly.length - 1].marketing : null;

  // 2) Current trailing-30d settled revenue (real orders, not platform-attributed).
  const windowDays = 30;
  const revRow = rows(await db.execute(sql`
    SELECT round(sum(total_revenue)::numeric, 0) AS revenue
    FROM daily_sales_snapshots
    WHERE date >= (timezone('America/Denver', to_timestamp(${Math.floor(nowMs / 1000)}))::date - ${windowDays})`))[0];
  const revenue = r2(num(revRow?.revenue));

  // 3) Current platform-tracked media spend (collapse overlapping windows per platform).
  const snaps = rows(await db.execute(sql`
    SELECT platform, to_char(period_start,'YYYY-MM-DD') AS "periodStart", to_char(period_end,'YYYY-MM-DD') AS "periodEnd", spend
    FROM marketing_spend_snapshots
    WHERE COALESCE(superseded,false) = false AND COALESCE(period_end, period_start) IS NOT NULL`)) as any[];
  const byPlatform = new Map<string, any[]>();
  for (const s of snaps) { const a = byPlatform.get(s.platform) ?? []; a.push(s); byPlatform.set(s.platform, a); }
  let mediaSpend = 0;
  for (const [, list] of Array.from(byPlatform.entries())) {
    // latest non-overlapping window(s) for the platform
    for (const s of collapseOverlappingSnapshots(list)) mediaSpend += num(s.spend);
  }
  mediaSpend = r2(mediaSpend);

  const mediaRoas = mediaSpend > 0 ? r2(revenue / mediaSpend) : null;
  const merEstimate = qbRunRate && qbRunRate > 0 ? r2(revenue / qbRunRate) : null;
  const agencyGap = qbRunRate != null ? r2(qbRunRate - mediaSpend) : null;

  // 4) Trajectory vs the May restart — is the new regime improving toward 5x?
  const avg = (xs: number[]) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const preRestartAvgMer = avg(monthly.filter((m) => m.month < RESTART_MONTH && m.mer != null).map((m) => m.mer!));
  const postRestartAvgMer = avg(monthly.filter((m) => m.month >= RESTART_MONTH && m.mer != null).map((m) => m.mer!));
  const trailingMer = merEstimate;
  const gapToBreakeven = trailingMer != null ? r2(BREAKEVEN_MER - trailingMer) : null;
  const improving = trailingMer != null && preRestartAvgMer != null ? trailingMer > preRestartAvgMer + 0.2 : null;

  return {
    breakeven: BREAKEVEN_MER,
    restartMonth: RESTART_MONTH,
    trajectory: { restartMonth: RESTART_MONTH, preRestartAvgMer, postRestartAvgMer, trailingMer, gapToBreakeven, improving },
    monthly,
    monthsBelowBreakeven,
    current: { windowDays, revenue, mediaSpend, qbRunRate, mediaRoas, merEstimate, agencyGap, qbPending: true },
  };
}
