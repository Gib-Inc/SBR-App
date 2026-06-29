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
