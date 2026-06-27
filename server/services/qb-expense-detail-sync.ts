/**
 * CIPH.R — QuickBooks expense-detail sync.
 *
 * Pulls QuickBooks ProfitAndLossDetail in small WEEKLY windows into
 * `qb_pl_detail` (one row per transaction line), then rebuilds per-vendor
 * monthly rollups in `qb_vendor_expense` directly from that detail. So spend is
 * queryable by vendor (e.g. "Pyvott Fulfillment") and by account (e.g. "Vehicle
 * Gas & Fuel") over time.
 *
 * WHY WEEKLY: a monthly ProfitAndLossDetail pull silently truncates on the
 * highest-volume months (QBO cuts the report after the income/journal rows and
 * drops the expense tail), losing Pyvott/shipping/vehicle lines for those
 * months. Week-sized windows keep every report small enough to return complete.
 *
 * READ-ONLY against QuickBooks — reuses QuickBooksClient.fetchExpenseDetailRaw +
 * parseExpenseDetail. Idempotent: qb_pl_detail upserts ON CONFLICT DO NOTHING on
 * its natural key; qb_vendor_expense is rebuilt (GROUP BY month) from the detail
 * each run, so re-runs converge and never double-count.
 */
import { storage } from "../storage";
import { QuickBooksClient } from "./quickbooks-client";
import { parseExpenseDetail } from "./qb-financial-service";

export interface QbPlDetailRow {
  realmId: string;
  txnDate: string | null;
  txnType: string | null;
  docNumber: string | null;
  vendorOrPayee: string | null;
  accountName: string | null;
  memo: string | null;
  amount: number;
  periodStart: string;
  periodEnd: string;
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  windows?: number;
  plRows?: number;
  vendorRows?: number;
  gaps?: string[];
}

/** Consecutive UTC windows of `days` length covering [start, end] inclusive. */
function dayWindows(start: Date, end: Date, days: number): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  let s = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (s.getTime() <= last.getTime()) {
    const e = new Date(s);
    e.setUTCDate(e.getUTCDate() + days - 1);
    if (e.getTime() > last.getTime()) e.setTime(last.getTime());
    out.push({ start: new Date(s), end: new Date(e) });
    s = new Date(e);
    s.setUTCDate(s.getUTCDate() + 1);
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Pull + persist transaction-level expense detail for [startDate, endDate]
 * (default: trailing 13 months) in weekly windows. Never throws to the caller.
 */
export async function syncQbExpenseDetail(
  userId: string,
  opts?: { startDate?: Date; endDate?: Date },
): Promise<SyncResult> {
  const client = new QuickBooksClient(storage, userId);
  if (!(await client.initialize())) return { ok: false, error: "QuickBooks not connected" };

  const auth = await storage.getQuickbooksAuth(userId);
  const realmId = auth?.realmId ?? "unknown";

  const end = opts?.endDate ?? new Date();
  const start =
    opts?.startDate ?? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 12, 1));
  const windows = dayWindows(start, end, 7);

  const plRows: QbPlDetailRow[] = [];
  const gaps: string[] = [];

  for (const w of windows) {
    let report: any = null;
    let periodStart = "";
    let periodEnd = "";
    // Retry transient failures (429/5xx surface here as error); small reports
    // so this is cheap.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await client.fetchExpenseDetailRaw(w.start, w.end);
      periodStart = res.periodStart;
      periodEnd = res.periodEnd;
      if (res.report && !res.error) { report = res.report; break; }
      if (attempt < 3) await sleep(500 * attempt);
      else gaps.push(res.error || `no report ${periodStart}..${periodEnd}`);
    }
    if (report) {
      const parsed = parseExpenseDetail(report);
      for (const ln of parsed.lines) {
        plRows.push({
          realmId,
          txnDate: ln.date,
          txnType: ln.txnType,
          docNumber: ln.docNumber,
          vendorOrPayee: ln.payee && ln.payee !== "(no payee)" ? ln.payee : null,
          accountName: ln.account,
          memo: ln.memo,
          amount: ln.amount,
          periodStart,
          periodEnd,
        });
      }
    }
    await sleep(150); // be gentle on the QBO report API
  }

  const plInserted = await storage.bulkInsertQbPlDetail(plRows);
  const vendorRows = await storage.rebuildQbVendorExpense(realmId);

  console.log(
    `[QB ExpenseDetail] synced ${windows.length} weekly windows: ${plInserted} P&L lines, ${vendorRows} vendor rollups, ${gaps.length} gap(s)`,
  );
  return { ok: true, windows: windows.length, plRows: plInserted, vendorRows, gaps };
}

let backfillArmed = false;
/**
 * Arm: (1) a one-time backfill ~45s after boot that pulls the trailing ~15
 * months IF qb_pl_detail is empty and a QuickBooks user is connected, and (2) a
 * monthly refresh of the trailing 13 months thereafter. Self-guards via the
 * `armed` flag + the empty-table check, so restarts never refire the backfill.
 * Fire-and-forget — never blocks listen(). Deliberately NOT wired to any
 * request/page-load path (unlike the older snapshot capture).
 */
export function startQbExpenseDetailBackfill(): void {
  if (backfillArmed) return;
  backfillArmed = true;

  const refresh = async (monthsBack: number, onlyIfEmpty: boolean) => {
    try {
      if (onlyIfEmpty && (await storage.qbPlDetailHasRows())) {
        console.log("[QB ExpenseDetail] backfill skipped — qb_pl_detail already populated");
        return;
      }
      const userId = await storage.getConnectedQuickbooksUserId();
      if (!userId) {
        console.log("[QB ExpenseDetail] skipped — no QuickBooks-connected user");
        return;
      }
      const end = new Date();
      const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - monthsBack, 1));
      const r = await syncQbExpenseDetail(userId, { startDate: start, endDate: end });
      console.log(`[QB ExpenseDetail] ${onlyIfEmpty ? "backfill" : "monthly refresh"} ${r.ok ? "complete" : "failed"}: ${JSON.stringify(r)}`);
    } catch (err: any) {
      console.error("[QB ExpenseDetail] sync error:", err?.message ?? err);
    }
  };

  setTimeout(() => { void refresh(14, true); }, 45_000); // initial backfill after boot settles
  // Refresh DAILY at ~5am MT (idempotent: ON CONFLICT DO NOTHING). The old weekly
  // setInterval was boot-relative and reset on every redeploy, leaving expense
  // detail days stale. A fixed daily slot (via self-rescheduling setTimeout, which
  // also sidesteps the TIMEOUT_MAX > 24.8d clamp that caused the prior OOM) keeps
  // "who is behind each spend category" current without overlapping pulls.
  const msUntil5amMT = () => {
    const now = new Date();
    const mt = new Date(now.toLocaleString("en-US", { timeZone: "America/Denver" }));
    const offset = mt.getTime() - now.getTime();
    const target = new Date(mt); target.setHours(5, 0, 0, 0);
    if (target <= mt) target.setDate(target.getDate() + 1);
    return Math.max(60_000, (target.getTime() - offset) - now.getTime());
  };
  const scheduleNext = () => {
    const t = setTimeout(() => { void refresh(12, false).finally(scheduleNext); }, msUntil5amMT());
    if (typeof (t as any)?.unref === "function") (t as any).unref();
  };
  scheduleNext();
}
