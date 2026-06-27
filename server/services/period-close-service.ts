/**
 * Month-end close + period lock. An accountant signs off on CLOSED books, so this
 * gives each month a defined close checklist and a lock. The app only tracks
 * checklist/lock state and surfaces what it can auto-derive — Roger performs the
 * actual bank reconciliation and books entries in QuickBooks (the book of record);
 * the app never closes the period in QB or posts entries.
 */
import { sql } from "drizzle-orm";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** The standard close checklist. `auto` items are derived from app signals; the
 *  rest are Roger's manual confirmations stored per period. */
export const CLOSE_CHECKLIST: Array<{ key: string; label: string; auto: boolean }> = [
  { key: "qb_snapshot", label: "QuickBooks financial snapshot captured for the period", auto: true },
  { key: "bank_reconciled", label: "QuickBooks bank/credit-card accounts reconciled to statements", auto: false },
  { key: "inventory_tie", label: "Inventory WAC reconciled to the QB inventory asset (variance booked)", auto: false },
  { key: "cogs_booked", label: "Measured COGS true-up booked (35% plug retired)", auto: false },
  { key: "sales_tax", label: "Sales/use tax liability tied to TC-62 and accrued", auto: false },
  { key: "payroll", label: "Payroll deposits (941) cleared and accrued", auto: false },
  { key: "ar_ap", label: "AR/AP aged and tied to the GL", auto: false },
];

export interface PeriodCloseItem { key: string; label: string; auto: boolean; done: boolean; by: string | null; at: string | null; }
export interface PeriodClose {
  period: string;
  status: string;
  lockedBy: string | null;
  lockedAt: string | null;
  items: PeriodCloseItem[];
  doneCount: number;
  totalCount: number;
}

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Auto-derived done-state for the `auto` checklist items. */
async function autoSignals(db: any, period: string): Promise<Record<string, boolean>> {
  const snap = rows(await db.execute(sql`
    select 1 from qb_financial_snapshots where to_char(captured_at, 'YYYY-MM') = ${period} limit 1`));
  return { qb_snapshot: snap.length > 0 };
}

export async function getPeriodClose(db: any, period: string): Promise<PeriodClose> {
  const row = rows(await db.execute(sql`
    select period, status, checklist, locked_by, locked_at::text as locked_at
    from financial_periods where period = ${period}`))[0];
  const stored = (row?.checklist as Record<string, { done?: boolean; by?: string; at?: string }>) || {};
  const auto = await autoSignals(db, period);
  const items: PeriodCloseItem[] = CLOSE_CHECKLIST.map((c) => {
    const s = stored[c.key] || {};
    const done = c.auto ? !!auto[c.key] : s.done === true;
    return { key: c.key, label: c.label, auto: c.auto, done, by: s.by ?? null, at: s.at ?? null };
  });
  return {
    period,
    status: row?.status ?? "open",
    lockedBy: row?.locked_by ?? null,
    lockedAt: row?.locked_at ?? null,
    items,
    doneCount: items.filter((i) => i.done).length,
    totalCount: items.length,
  };
}

/** The last N months' close state (most recent first). */
export async function getCloseStatus(db: any, months = 4): Promise<PeriodClose[]> {
  const now = new Date();
  const periods: string[] = [];
  for (let i = 0; i < months; i++) {
    periods.push(ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  const out: PeriodClose[] = [];
  for (const p of periods) out.push(await getPeriodClose(db, p));
  return out;
}

/** Set one manual checklist item (records who + when). No-op on a locked period. */
export async function setChecklistItem(db: any, period: string, key: string, done: boolean, by: string): Promise<boolean> {
  if (!CLOSE_CHECKLIST.some((c) => c.key === key && !c.auto)) return false; // unknown or auto-only key
  const entry = sql`jsonb_build_object(${key}::text, jsonb_build_object('done', ${done}, 'by', ${by}, 'at', now()::text))`;
  await db.execute(sql`
    insert into financial_periods (period, checklist, updated_at) values (${period}, ${entry}, now())
    on conflict (period) do update set checklist = financial_periods.checklist || ${entry}, updated_at = now()
    where financial_periods.status <> 'locked'`);
  return true;
}

/** Lock or unlock a period. Locking is gated by the finance PIN at the route. */
export async function setPeriodLock(db: any, period: string, locked: boolean, by: string): Promise<void> {
  if (locked) {
    await db.execute(sql`
      insert into financial_periods (period, status, locked_by, locked_at, updated_at)
      values (${period}, 'locked', ${by}, now(), now())
      on conflict (period) do update set status = 'locked', locked_by = ${by}, locked_at = now(), updated_at = now()`);
  } else {
    await db.execute(sql`
      update financial_periods set status = 'open', locked_by = null, locked_at = null, updated_at = now()
      where period = ${period}`);
  }
}

/** Is the given period locked? Write-paths to that month's figures should check this. */
export async function isPeriodLocked(db: any, period: string): Promise<boolean> {
  const r = rows(await db.execute(sql`select status from financial_periods where period = ${period}`))[0];
  return r?.status === "locked";
}

export const _internal = { ym, num };
