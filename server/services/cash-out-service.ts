/**
 * CIPH.R — Cash Out (rolling multi-day disbursement view), the app-native version of
 * Stacy's manual 3-day Cash Out Dashboard. It RECOMMENDS and TRACKS; it NEVER moves
 * money — Stacy authorizes each pay via setObligationStatus (pending → approved →
 * paid). This module assembles the rolling walk from the existing engines:
 *   - opening cash      → getCashPosition (QB live snapshot)
 *   - cash-in per day   → expected-payouts (Shopify/Amazon net, by settlement date)
 *   - pay-now per day   → cash-flow obligations (tiered, ranked), bucketed by due date
 *   - available cash/credit → credit-lines (LOC/reserve room + card room)
 *
 * FLAG-DON'T-FABRICATE: an obligation with an unknown amount (estimated $0 — the
 * MCA/941 tax/debt seeds) contributes $0 to a day's pay-now but is COUNTED in that
 * day's unfundedCount, so the day's ending balance is surfaced as a best-case ceiling,
 * never a clean number. The pure assembler (buildRollingCashOut) is unit-tested.
 */

import type { ExpectedPayouts, ChannelPayout } from "./expected-payouts-service";
import type { Tier } from "./cash-flow-service";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Add `n` days to a YYYY-MM-DD string (UTC, calendar-safe). Pure. */
export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export interface CashOutObligation {
  id: string;
  amount: number;
  amountEstimated: boolean;
}

export interface CashOutDay {
  date: string;
  opening: number;       // = prior day's ending (day 0 = starting cash on hand)
  cashIn: number;        // expected payouts landing this day (net of fees)
  payNow: number;        // sum of KNOWN obligation amounts slated this day
  ending: number;        // opening + cashIn − payNow
  unfundedCount: number; // obligations this day with an unknown (estimated $0) amount
  endingComplete: boolean; // false when unfundedCount > 0 → ending is a best-case ceiling
  obligationIds: string[];
}

/**
 * Pure: thread N calendar days from startDate, carrying each day's ending into the
 * next day's opening. `payoutsByDate` and `oblsByDate` are keyed YYYY-MM-DD; any date
 * with no entry contributes 0. Estimated-unknown obligations add $0 to payNow but bump
 * unfundedCount so the day is flagged incomplete. No DB, no clock.
 */
export function buildRollingCashOut(
  startDate: string,
  days: number,
  openingCash: number,
  payoutsByDate: Record<string, number>,
  oblsByDate: Record<string, CashOutObligation[]>,
): CashOutDay[] {
  const out: CashOutDay[] = [];
  let opening = openingCash;
  for (let i = 0; i < Math.max(0, days); i++) {
    const date = addDaysYmd(startDate, i);
    const cashIn = r2(payoutsByDate[date] ?? 0);
    const obls = oblsByDate[date] ?? [];
    let payNow = 0;
    let unfundedCount = 0;
    const obligationIds: string[] = [];
    for (const o of obls) {
      obligationIds.push(o.id);
      if (o.amountEstimated && o.amount <= 0) unfundedCount += 1;
      else payNow += Number(o.amount) || 0;
    }
    payNow = r2(payNow);
    const ending = r2(opening + cashIn - payNow);
    out.push({
      date, opening: r2(opening), cashIn, payNow, ending,
      unfundedCount, endingComplete: unfundedCount === 0, obligationIds,
    });
    opening = ending;
  }
  return out;
}

/**
 * Pure: bucket obligations onto the days they should be paid. An obligation lands on
 * its due date; anything due on/before startDate (overdue) or with no due date is
 * pulled to day 0 (today) so it can't silently fall outside the window. Obligations
 * due after the window are dropped (the caller sized the window). Returns a map keyed
 * YYYY-MM-DD → obligations.
 */
export function bucketObligationsByDay(
  obls: Array<CashOutObligation & { dueDate: string | null }>,
  startDate: string,
  days: number,
): Record<string, CashOutObligation[]> {
  const lastDate = addDaysYmd(startDate, Math.max(0, days - 1));
  const byDate: Record<string, CashOutObligation[]> = {};
  for (const o of obls) {
    const due = o.dueDate;
    const day = !due || due <= startDate ? startDate : due > lastDate ? null : due;
    if (day == null) continue; // beyond the window
    (byDate[day] ??= []).push({ id: o.id, amount: o.amount, amountEstimated: o.amountEstimated });
  }
  return byDate;
}

/**
 * Pure: spread each channel's net payout evenly across its settlement window, starting
 * at startDate. The trailing-window sales already in transit arrive over the next
 * `settlementDays` days (Shopify ~3, Amazon ~14), so day i gets netExpected/settlementDays
 * for each channel still inside its window. Summed over a window this equals
 * inboundWithinDays — same near-cash, just placed on the days it lands. Keyed YYYY-MM-DD.
 */
export function dailyInboundSchedule(p: ExpectedPayouts, startDate: string, days: number): Record<string, number> {
  const sched: Record<string, number> = {};
  const spread = (c: ChannelPayout) => {
    const span = Math.max(1, c.settlementDays);
    const perDay = c.netExpected / span;
    for (let i = 0; i < Math.min(Math.max(0, days), span); i++) {
      const d = addDaysYmd(startDate, i);
      sched[d] = r2((sched[d] ?? 0) + perDay);
    }
  };
  spread(p.amazon);
  spread(p.shopify);
  return sched;
}

export type ScenarioKey = "pay_all" | "conservative" | "preserve_cash";

export interface ScenarioObl {
  id: string;
  label: string;
  amount: number;
  amountEstimated: boolean;
  tier: Tier;
}

export interface Scenario {
  key: ScenarioKey;
  label: string;
  pay: ScenarioObl[];      // recommended to pay now
  defer: ScenarioObl[];    // recommended to hold
  totalPaid: number;       // sum of KNOWN, non-negative amounts in `pay`
  endingCash: number;      // cash + inbound − totalPaid (negative ⇒ would need credit)
  creditDrawn: number;     // amount that taps the funding room (0 if cash covers it)
  feasible: boolean | null; // creditDrawn ≤ funding room; null when funding room is unknown
  unfundedInPay: number;   // recommended-pay items whose amount is unknown (estimated)
  endingCashComplete: boolean; // false when unfundedInPay > 0 — endingCash is a best-case ceiling
  rationale: string;
}

const MUST_PAY: ReadonlySet<Tier> = new Set<Tier>(["mca", "tier1", "tier2"]);
// "known" = a usable, non-negative dollar amount we can subtract. An estimated-$0 seed,
// or any negative/NaN amount, is NOT a known cost (it gets flagged, never silently summed).
const known = (o: ScenarioObl) => !o.amountEstimated && Number.isFinite(o.amount) && o.amount > 0;
const cost = (o: ScenarioObl) => (known(o) ? o.amount : 0);

/**
 * Build one scenario from an ORDERED pay list against a cash+inbound budget. Pure.
 * `fundingRoom` = drawable LOC room + card room (null ⇒ unknown). feasible is null when
 * the room is unknown, so the UI shows "credit unknown" rather than a false "over credit".
 */
function makeScenario(
  key: ScenarioKey, label: string, rationale: string,
  pay: ScenarioObl[], defer: ScenarioObl[], cashPlusInbound: number, fundingRoom: number | null,
): Scenario {
  const totalPaid = r2(pay.reduce((s, o) => s + cost(o), 0));
  const endingCash = r2(cashPlusInbound - totalPaid);
  const creditDrawn = endingCash < 0 ? r2(-endingCash) : 0;
  const unfundedInPay = pay.filter((o) => !known(o)).length;
  return {
    key, label, pay, defer, totalPaid, endingCash, creditDrawn,
    feasible: fundingRoom == null ? null : creditDrawn <= r2(fundingRoom),
    unfundedInPay,
    endingCashComplete: unfundedInPay === 0,
    rationale,
  };
}

/**
 * Pure: three ranked disbursement scenarios over the already-tier-ranked obligations.
 * DETERMINISTIC (no LLM) so every number is auditable and nothing is hallucinated —
 * the controller mandate. Recommendations only; Stacy authorizes each pay.
 *   - pay_all       — clear everything in rank order (may tap credit)
 *   - conservative  — only the unavoidable (mca + tax/payroll + must-pay/secured)
 *   - preserve_cash — pay top-down but STOP before drawing any credit
 */
export function buildScenarios(
  rankedObls: ScenarioObl[],
  cashOnHand: number,
  inbound: number,
  availableCredit: number | null,
  availableCash: number | null = null,
): Scenario[] {
  const budget = r2(cashOnHand + inbound);
  // Funding room a plan can draw on = drawable LOC room + card room. Unknown card room
  // ⇒ room unknown (null). Unknown LOC room ⇒ counted as 0 (don't assume room we can't see).
  const fundingRoom = availableCredit == null ? null : r2(availableCredit + (availableCash ?? 0));
  // Obligations are already tier-ranked by the caller (rankAndProject).
  const all = rankedObls;

  // 1. pay_all — clear the board; defer nothing.
  const payAll = makeScenario(
    "pay_all", "Clear everything",
    "Pays every obligation in priority order. Ending cash below zero means this draws on available cash/credit.",
    all, [], budget, fundingRoom,
  );

  // 2. conservative — only the unavoidable tiers; defer the rest.
  const mustPay = all.filter((o) => MUST_PAY.has(o.tier));
  const conservative = makeScenario(
    "conservative", "Unavoidable only",
    "Pays only what cannot be deferred — MCAs/auto-debits, tax & payroll, and secured/critical vendors. Everything else holds.",
    mustPay, all.filter((o) => !MUST_PAY.has(o.tier)), budget, fundingRoom,
  );

  // 3. preserve_cash — pay top-down and STOP at the first item that doesn't fit, so the
  // pay set is a true priority PREFIX (never skip a higher-rank bill to fund a cheaper
  // lower-rank one). Never draws credit. Unknown-amount items (cost 0) pass through but
  // are flagged via unfundedInPay/endingCashComplete.
  const pay: ScenarioObl[] = [];
  const defer: ScenarioObl[] = [];
  let remaining = budget;
  let stopped = false;
  for (const o of all) {
    const c = cost(o);
    if (!stopped && c <= remaining) { pay.push(o); remaining = r2(remaining - c); }
    else { stopped = true; defer.push(o); }
  }
  const preserveCash = makeScenario(
    "preserve_cash", "Cash only, no new credit",
    "Pays top-priority items in order only as far as cash on hand plus expected payouts reach — stops at the first bill that doesn't fit and holds it and everything below it. Never taps a line of credit.",
    pay, defer, budget, fundingRoom,
  );

  return [payAll, conservative, preserveCash];
}

export interface CashOut {
  asOf: string;
  days: number;
  rolling: CashOutDay[];
  cashOnHand: number;
  availableCash: number | null;    // drawable LOC/line room (type 'loc')
  availableCredit: number | null;  // card room (type 'card')
  totalLiquidity: number | null;   // cashOnHand + availableCash + availableCredit
  obligations: any[];              // the ranked pay-now list (from getCashFlow)
  scenarios: Scenario[];           // deterministic what-to-pay options (recommendations)
  unfundedMustPayCount: number;    // high-priority obligations with unknown amounts
  basis: "sales-estimate";
  generatedAt: string;
}

/**
 * DB (read-only): assemble the rolling Cash Out view from the existing engines. Reports
 * and reconciles only — it NEVER disburses (Stacy authorizes each pay via
 * setObligationStatus). Composes getCashFlow (position + ranked obligations),
 * expected-payouts (per-day cash-in), and credit-lines (available cash/credit).
 */
export async function getCashOut(db: any, asOf: string, days = 3): Promise<CashOut> {
  const [{ getCashFlow }, { computeExpectedPayouts }, { computeCreditLines }] = await Promise.all([
    import("./cash-flow-service"),
    import("./expected-payouts-service"),
    import("./credit-lines-service"),
  ]);
  const cf = await getCashFlow(db, { windowDays: days, asOf });
  const ep = await computeExpectedPayouts(db, asOf);

  // PAYABLE = the obligations the rolling window + scenarios should act on: the
  // cash-flow engine's own `active` rule (drop status 'deferred' + tier 'hold' — bills
  // Stacy parked) AND inside the rolling horizon (getCashFlow's SQL admits due ≤
  // asOf+days, one day past the asOf..asOf+days-1 walk; clip it so the day-by-day view,
  // the scenarios, and the pay list all reconcile to the SAME set). Overdue/undated
  // stay (bucketObligationsByDay pulls them to day 0).
  const lastDate = addDaysYmd(asOf, Math.max(0, days - 1));
  const payable = (cf.obligations as any[]).filter(
    (o) => o.status !== "deferred" && o.tier !== "hold" && (!o.dueDate || o.dueDate <= lastDate),
  );

  const payoutsByDate = dailyInboundSchedule(ep, asOf, days);
  const oblsByDate = bucketObligationsByDay(
    payable.map((o: any) => ({ id: o.id, amount: o.amount, amountEstimated: o.amountEstimated, dueDate: o.dueDate })),
    asOf, days,
  );
  const rolling = buildRollingCashOut(asOf, days, cf.position.cashOnHand, payoutsByDate, oblsByDate);

  // Available cash = drawable LOC/line room; available credit = card room. Failure
  // leaves nulls (FLAG-DON'T-FABRICATE — never a fabricated 0 liquidity figure).
  let availableCash: number | null = null;
  let availableCredit: number | null = null;
  try {
    const { lines } = await computeCreditLines();
    const sumAvail = (t: string) => {
      const ls = lines.filter((l: any) => l.type === t && l.available != null);
      return ls.length ? r2(ls.reduce((s: number, l: any) => s + (l.available || 0), 0)) : null;
    };
    availableCash = sumAvail("loc");
    availableCredit = sumAvail("card");
  } catch { /* leave nulls */ }

  const cashOnHand = r2(cf.position.cashOnHand);
  // FLAG-DON'T-FABRICATE: total liquidity is only known when every component is. If
  // available cash or credit couldn't be computed, leave it null so the tile shows "—"
  // rather than a confident figure that silently omits the unknown line.
  const totalLiquidity =
    availableCash == null || availableCredit == null ? null : r2(cashOnHand + availableCash + availableCredit);

  // Deterministic what-to-pay scenarios over the PAYABLE, in-window obligations (same
  // set the rolling walk uses, so the day-by-day endings and the scenarios reconcile).
  // Inbound = payouts landing inside the window. Feasibility counts BOTH drawable LOC
  // room and card room; null credit ⇒ feasibility unknown (not "infeasible").
  const scenarios = buildScenarios(
    payable.map((o: any) => ({ id: o.id, label: o.label, amount: o.amount, amountEstimated: o.amountEstimated, tier: o.tier })),
    cashOnHand, r2(cf.position.inboundWindow), availableCredit, availableCash,
  );

  return {
    asOf, days, rolling, cashOnHand,
    availableCash, availableCredit, totalLiquidity,
    obligations: payable, scenarios,
    unfundedMustPayCount: cf.position.unfundedMustPayCount,
    basis: "sales-estimate",
    generatedAt: new Date().toISOString(),
  };
}
