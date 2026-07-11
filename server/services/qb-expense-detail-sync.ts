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
 * parseExpenseDetail.
 *
 * SELF-HEALING MIRROR: each successfully-fetched window REPLACES its date range
 * (DELETE + INSERT in one DB transaction), so QBO edits and deletions propagate
 * instead of leaving ghost rows (real case July 10 2026: A2X-connector JEs were
 * deleted in QBO but their qb_pl_detail rows lingered and had to be purged by
 * hand). A window whose QBO fetch FAILED is never deleted — no data loss on API
 * errors. The rollup self-heals too: after the rebuild, `qb_vendor_expense`
 * rows whose (vendor, month) no longer has ANY backing detail are deleted, so a
 * fully-emptied vendor-month can't keep reporting ghost spend.
 *
 * DELETE SAFETY LADDER (a delete only happens when ALL of these hold):
 *  1. the QBO fetch succeeded AND the parser did not throw;
 *  2. either fresh rows exist for the window (replace), or the raw report
 *     payload is VERIFIABLY empty (`isReportPayloadEmpty` — QBO's row array is
 *     absent/empty). A parse that extracts 0 lines from a NON-empty payload is
 *     treated as a parse FAILURE (loud gap note, no writes) — a ColKey rename
 *     or amount-format change must never masquerade as "QBO is empty";
 *  3. for empty-window deletes: the window lies entirely within the trailing
 *     EMPTY_DELETE_TRAILING_DAYS, the run has already inserted at least one
 *     row somewhere (corroboration — a QBO outage returning empty payloads
 *     across the board can't wipe anything), and the rows about to be deleted
 *     number at most EMPTY_DELETE_MAX_ROWS (blast-radius tripwire — counted
 *     BEFORE deleting; over the threshold the sync refuses and records the
 *     would-be count in a gap note).
 * Every refusal is recorded in gaps[] — a data gap blocks loudly, it is never
 * papered over.
 *
 * Re-runs converge and never double-count; qb_vendor_expense is rebuilt (GROUP
 * BY month) from the detail each run, and the rebuild + monthly_financials
 * derivation run even when individual windows fail mid-run (per-window
 * try/catch), so already-replaced windows always get their downstream rollups.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
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
  /** Orphaned qb_vendor_expense rollup rows (no backing detail) removed this run. */
  vendorOrphansDeleted?: number;
  /** Windows whose date range was replaced (delete + insert) this run. */
  replacedWindows?: number;
  /** Stale qb_pl_detail rows deleted by window replacement this run. */
  deletedRows?: number;
  monthlyFinancials?: { updated: number; skipped: number };
  gaps?: string[];
}

/** qb_pl_detail.source_report scope this sync owns — deletes never touch other sources. */
const SOURCE_REPORT = "ProfitAndLossDetail";

/**
 * DELETE-ON-EMPTY BOUNDARY: a verifiably-empty QBO report is a valid signal
 * (everything in that window was deleted in QBO) — but only for windows lying
 * ENTIRELY within the trailing 70 days (window START on/after now − 70d);
 * recent edits/deletions are plausible there. Older empty windows keep the
 * legacy insert-only behavior (no writes) and record a gap note instead.
 */
export const EMPTY_DELETE_TRAILING_DAYS = 70;

/**
 * BLAST-RADIUS TRIPWIRE for delete-on-empty: the maximum number of existing
 * qb_pl_detail rows an EMPTY report may erase for one weekly window. Counted
 * BEFORE any delete; over the threshold the sync refuses, keeps the rows, and
 * records a loud gap note with the would-be count.
 *
 * WHY 50: trailing-70-day prod density is ~130 detail rows per week, and the
 * real-world delete-on-empty case this feature exists for (July 10 2026 A2X
 * JE cleanup) removed a HANDFUL of rows. An "empty" report that would erase
 * 50+ rows — half a busy week vanishing from QBO entirely — far more plausibly
 * indicates a QBO outage or report-shape regression than a genuine mass
 * deletion, so a human must confirm before those rows go.
 */
export const EMPTY_DELETE_MAX_ROWS = 50;

export interface WindowDecision {
  /** Delete this window's existing qb_pl_detail rows (inside the same tx as the insert). */
  delete: boolean;
  /** Insert the freshly-fetched rows for this window. */
  insert: boolean;
  /** Gap note to record when a window is deliberately left untouched. */
  gapNote?: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Is the raw QBO report VERIFIABLY empty — i.e. did QBO itself say "nothing in
 * this window"? True only when the report's row array is absent or an empty
 * array (QBO returns `"Rows": {}` for an empty ProfitAndLossDetail). Anything
 * else — rows present, or a malformed non-array `Row` — is NOT verifiably
 * empty, so a parse that extracts nothing from it is treated as a parse
 * failure upstream, never as emptiness. If QBO's empty shape ever grows
 * scaffold rows (e.g. a GRAND TOTAL section), the failure mode here is a loud
 * gap note and preserved rows — never a wipe; loosen this signal only after
 * inspecting a captured raw payload.
 */
export function isReportPayloadEmpty(report: any): boolean {
  const rows = report?.Rows?.Row;
  if (rows == null) return true;
  return Array.isArray(rows) && rows.length === 0;
}

/**
 * Pure decision: what a fetched window is allowed to do to the mirror.
 *  - fetch FAILED (or parser threw)  → no delete, no insert (gap recorded by the loop)
 *  - fresh parsed rows               → replace: delete + insert the same window, any age
 *  - 0 parsed rows, NON-empty payload → PARSE FAILURE: no writes + loud gap note
 *    (report shape changed under the parser — "extracted nothing" ≠ "QBO is empty")
 *  - verifiably-empty payload, window entirely within trailing
 *    EMPTY_DELETE_TRAILING_DAYS, and the run has inserted rows elsewhere
 *                                    → delete (QBO really has nothing there anymore)
 *  - verifiably-empty payload but the run has inserted NOTHING yet
 *                                    → no delete + gap note (an outage serving empty
 *    200s across the board must not wipe the trailing window uncorroborated)
 *  - verifiably-empty payload, older window → no delete (insert-only legacy) + gap note
 */
export function decideWindowReplacement(args: {
  fetchOk: boolean;
  /** Lines the parser actually extracted (what would be inserted). */
  parsedLineCount: number;
  /** Raw `type: "Data"` rows the parser SAW in the report tree (diagnostic). */
  rawDataRowCount: number;
  /** True when the raw report's row array is absent/empty — see isReportPayloadEmpty. */
  reportPayloadEmpty: boolean;
  /** True once this run has successfully inserted rows for ANY window (corroboration). */
  runHasInsertedRows: boolean;
  windowStart: Date;
  windowEnd: Date;
  now?: Date;
}): WindowDecision {
  const {
    fetchOk, parsedLineCount, rawDataRowCount, reportPayloadEmpty, runHasInsertedRows,
    windowStart, windowEnd,
  } = args;
  const range = `${isoDay(windowStart)}..${isoDay(windowEnd)}`;
  if (!fetchOk) return { delete: false, insert: false };
  if (parsedLineCount > 0) return { delete: true, insert: true };

  // 0 extracted lines. Distinguish "QBO verifiably returned an empty report"
  // from "the parser got nothing out of a NON-empty payload" (ColKey rename,
  // amount column/format change, Data-row shape change). The latter is a parse
  // FAILURE — deleting on it would wipe the trailing weeks every night until a
  // human fixed the parser.
  if (!reportPayloadEmpty) {
    return {
      delete: false,
      insert: false,
      gapNote:
        `PARSE FAILURE (no delete): QBO report for ${range} is NON-empty ` +
        `(${rawDataRowCount} raw data row(s) seen) but the parser extracted 0 lines — ` +
        `treated as a failed fetch; existing rows preserved. Investigate report shape/ColKeys ` +
        `before trusting this window.`,
    };
  }

  // Verifiably-empty payload: only trust it enough to delete when the WHOLE
  // window is recent…
  const now = args.now ?? new Date();
  const boundary = now.getTime() - EMPTY_DELETE_TRAILING_DAYS * 86_400_000;
  if (windowStart.getTime() < boundary) {
    return {
      delete: false,
      insert: false,
      gapNote:
        `empty window kept (no delete): ${range} returned 0 rows ` +
        `but starts outside the trailing ${EMPTY_DELETE_TRAILING_DAYS}d delete-on-empty boundary — ` +
        `existing rows preserved; verify manually if QBO edits are expected that far back`,
    };
  }
  // …and the run has corroborated that QBO is actually serving data. A run in
  // which EVERY window came back empty (plausible only as a QBO outage or an
  // account/report regression) must not delete anything.
  if (!runHasInsertedRows) {
    return {
      delete: false,
      insert: false,
      gapNote:
        `empty window kept (no delete): ${range} is verifiably empty in QBO, but this run has ` +
        `inserted 0 rows so far — refusing an uncorroborated delete (guards against a QBO ` +
        `empty-response outage wiping the trailing ${EMPTY_DELETE_TRAILING_DAYS}d); ` +
        `self-heals on the next run that returns data`,
    };
  }
  return { delete: true, insert: false };
}

/**
 * Replace one window's rows atomically: DELETE the window's existing
 * ProfitAndLossDetail rows, then INSERT the fresh ones — one transaction, so an
 * insert failure rolls the delete back (never a wiped window with no
 * replacement). Delete is scoped to this realm + source_report.
 *
 * NULL-txn_date rows (rare parse artifacts) can't be ranged on txn_date, so
 * they match by their stored fetch period overlapping the window — but ONLY
 * when that whole stored period is contained in THIS RUN's overall range
 * [runRange.startIso, runRange.endIso]. The row's true transaction date lies
 * somewhere inside its stored fetch period (QBO reports only contain the
 * period's transactions), so run-containment guarantees one of this run's
 * windows re-fetches it. Without it, a partial run (e.g. manual ?months=1)
 * whose first window merely OVERLAPS an old row's period could delete a
 * transaction dated before the run started and never re-fetch it.
 *
 * BLAST-RADIUS TRIPWIRE: when there is nothing to insert (delete-on-empty),
 * the rows about to be deleted are COUNTED first; if the count exceeds
 * EMPTY_DELETE_MAX_ROWS the delete is refused and the count returned in
 * `refusedEmptyDelete` (caller records the gap note). A post-delete recheck
 * inside the transaction backstops races by rolling back.
 *
 * Runs via db.execute here (not storage) per the mirror-owns-its-window design.
 */
async function replaceWindowRows(
  realmId: string,
  windowStart: Date,
  windowEnd: Date,
  rows: QbPlDetailRow[],
  runRange: { startIso: string; endIso: string },
): Promise<{ deleted: number; refusedEmptyDelete?: number }> {
  const ws = isoDay(windowStart);
  const we = isoDay(windowEnd);
  const windowWhere = sql`
      realm_id = ${realmId}
        AND source_report = ${SOURCE_REPORT}
        AND (
          (txn_date >= ${ws}::date AND txn_date <= ${we}::date)
          OR (
            txn_date IS NULL
            AND period_start <= ${we}::date AND period_end >= ${ws}::date
            AND period_start >= ${runRange.startIso}::date AND period_end <= ${runRange.endIso}::date
          )
        )`;

  if (rows.length === 0) {
    // Delete-on-empty: count BEFORE deleting. An unreadable count blocks (no
    // guessing — financial rule), and a count over the tripwire refuses.
    const cnt = await db.execute(sql`SELECT COUNT(*)::int AS n FROM qb_pl_detail WHERE ${windowWhere}`);
    const n = Number((cnt as any).rows?.[0]?.n);
    if (!Number.isFinite(n)) {
      throw new Error(`blast-radius pre-count unreadable for ${ws}..${we} — refusing to delete`);
    }
    if (n > EMPTY_DELETE_MAX_ROWS) return { deleted: 0, refusedEmptyDelete: n };
  }

  let deleted = 0;
  await db.transaction(async (tx) => {
    const del = await tx.execute(sql`DELETE FROM qb_pl_detail WHERE ${windowWhere}`);
    deleted = ((del as any).rowCount as number) ?? 0;
    if (rows.length === 0 && deleted > EMPTY_DELETE_MAX_ROWS) {
      // Race backstop (rows written between pre-count and delete): abort the
      // transaction so the delete rolls back and nothing is lost.
      throw new Error(
        `BLAST-RADIUS TRIPWIRE (post-delete recheck): empty report for ${ws}..${we} deleted ${deleted} rows ` +
        `(> ${EMPTY_DELETE_MAX_ROWS}); rolled back`,
      );
    }
    // Same VALUES shape + ON CONFLICT DO NOTHING as storage.bulkInsertQbPlDetail —
    // the dedupe key (realm_id, txn_date, account_name, amount, doc_number NULLS
    // NOT DISTINCT) can collide within one report batch.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const values = chunk.map(
        (r) =>
          sql`(${r.realmId}, ${r.txnDate}, ${r.txnType}, ${r.docNumber}, ${r.vendorOrPayee}, ${r.accountName}, ${r.memo}, ${r.amount}, ${r.periodStart}, ${r.periodEnd}, ${SOURCE_REPORT})`,
      );
      await tx.execute(sql`
        INSERT INTO qb_pl_detail
          (realm_id, txn_date, txn_type, doc_number, vendor_or_payee, account_name, memo, amount, period_start, period_end, source_report)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT DO NOTHING
      `);
    }
  });
  return { deleted };
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

/** In-flight guard: overlapping runs (5am refresh + boot backfill + manual
 *  double-submit) would double QBO API load and interleave window replaces.
 *  They converge, but there's no reason to allow it — the second caller gets
 *  ok:false (the manual route surfaces that as a 409). */
let syncInFlight = false;

/**
 * Pull + persist transaction-level expense detail for [startDate, endDate]
 * (default: trailing 13 months) in weekly windows. Each successful window
 * replaces its own date range (see decideWindowReplacement); failed windows are
 * left untouched and reported in gaps[]. Never throws to the caller.
 */
export async function syncQbExpenseDetail(
  userId: string,
  opts?: { startDate?: Date; endDate?: Date },
): Promise<SyncResult> {
  if (syncInFlight) {
    return { ok: false, error: "expense-detail sync already in progress — re-run after it finishes" };
  }
  syncInFlight = true;
  try {
    return await runSync(userId, opts);
  } finally {
    syncInFlight = false;
  }
}

async function runSync(
  userId: string,
  opts?: { startDate?: Date; endDate?: Date },
): Promise<SyncResult> {
  const client = new QuickBooksClient(storage, userId);
  if (!(await client.initialize())) return { ok: false, error: "QuickBooks not connected" };

  const auth = await storage.getQuickbooksAuth(userId);
  const realmId = auth?.realmId ?? "unknown";

  const now = new Date();
  const end = opts?.endDate ?? now;
  const start =
    opts?.startDate ?? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 12, 1));
  const windows = dayWindows(start, end, 7);

  const gaps: string[] = [];
  let plRowsWritten = 0;
  let replacedWindows = 0;
  let deletedRows = 0;

  // Overall run range — NULL-txn_date deletes are only allowed for rows whose
  // whole stored fetch period this run will re-fetch (see replaceWindowRows).
  const runRange = windows.length
    ? { startIso: isoDay(windows[0].start), endIso: isoDay(windows[windows.length - 1].end) }
    : { startIso: isoDay(now), endIso: isoDay(now) };

  // Every window is individually try/caught so one bad window (malformed
  // report, unexpected throw) becomes a gap note instead of aborting the run —
  // windows already replaced MUST still get their downstream rollups
  // (rebuildQbVendorExpense + syncQbMonthlyFinancials below).
  for (const w of windows) {
    try {
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

      const rows: QbPlDetailRow[] = [];
      let rawDataRowCount = 0;
      let parseFailed = false;
      if (report) {
        try {
          const parsed = parseExpenseDetail(report);
          rawDataRowCount = parsed.rowCount;
          for (const ln of parsed.lines) {
            rows.push({
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
        } catch (e: any) {
          parseFailed = true;
          gaps.push(
            `PARSE THREW for ${isoDay(w.start)}..${isoDay(w.end)}: ${e?.message ?? e} — ` +
            `window treated as a failed fetch; existing rows preserved`,
          );
        }
      }

      const decision = decideWindowReplacement({
        fetchOk: report != null && !parseFailed,
        parsedLineCount: rows.length,
        rawDataRowCount,
        reportPayloadEmpty: report != null ? isReportPayloadEmpty(report) : false,
        runHasInsertedRows: plRowsWritten > 0,
        windowStart: w.start,
        windowEnd: w.end,
        now,
      });
      if (decision.gapNote) gaps.push(decision.gapNote);
      if (decision.delete) {
        try {
          const res = await replaceWindowRows(
            realmId, w.start, w.end, decision.insert ? rows : [], runRange,
          );
          if (res.refusedEmptyDelete != null) {
            gaps.push(
              `BLAST-RADIUS TRIPWIRE: empty QBO report for ${isoDay(w.start)}..${isoDay(w.end)} would delete ` +
              `${res.refusedEmptyDelete} existing rows (> ${EMPTY_DELETE_MAX_ROWS} threshold); refused — rows kept. ` +
              `Verify the window in QBO and purge manually if the deletion is real.`,
            );
          } else {
            replacedWindows += 1;
            deletedRows += res.deleted;
            if (decision.insert) plRowsWritten += rows.length;
          }
        } catch (e: any) {
          // Transaction rolled back — the window's prior rows are intact.
          gaps.push(`window replace failed ${isoDay(w.start)}..${isoDay(w.end)}: ${e?.message ?? e}`);
        }
      }
    } catch (e: any) {
      // Unexpected per-window failure: no committed writes for this window
      // (replaceWindowRows catches its own errors above); record and continue
      // so the rollup chain below still runs for windows already replaced.
      gaps.push(`window failed ${isoDay(w.start)}..${isoDay(w.end)}: ${e?.message ?? e} — existing rows preserved`);
    }
    await sleep(150); // be gentle on the QBO report API
  }

  // Rebuild the per-vendor monthly rollup from the post-replacement detail,
  // then SELF-HEAL it: the rebuild is an upsert (INSERT … GROUP BY … ON
  // CONFLICT DO UPDATE), so a (vendor, month) whose LAST detail row was just
  // deleted emits no group and its stale rollup row would otherwise report
  // ghost spend forever (the July 10 A2X case, one table downstream). Delete
  // realm-scoped rollup rows with no backing detail — the WHERE mirrors the
  // rebuild's source exactly (qb_pl_detail, vendor + txn_date NOT NULL,
  // month = date_trunc(txn_date)). Scoped delete lives HERE (the sync owns its
  // mirror), not in storage.ts.
  let vendorRows: number | undefined;
  let vendorOrphansDeleted: number | undefined;
  try {
    vendorRows = await storage.rebuildQbVendorExpense(realmId);
    const orphan = await db.execute(sql`
      DELETE FROM qb_vendor_expense v
      WHERE v.realm_id = ${realmId}
        AND NOT EXISTS (
          SELECT 1
          FROM qb_pl_detail d
          WHERE d.realm_id = v.realm_id
            AND d.vendor_or_payee = v.vendor
            AND d.txn_date IS NOT NULL
            AND date_trunc('month', d.txn_date)::date = v.period_start
        )
    `);
    vendorOrphansDeleted = ((orphan as any).rowCount as number) ?? 0;
  } catch (e: any) {
    gaps.push(
      `vendor rollup rebuild/self-heal failed — qb_vendor_expense may be stale until the next run: ${e?.message ?? e}`,
    );
  }

  // Derive monthly_financials from the freshly-synced GL so the Executive Summary and
  // COGS baseline stay current without manual P&L uploads (QB is the book of record).
  // Runs even when the rollup rebuild failed — it reads qb_pl_detail directly.
  let monthlyFin = { updated: 0, skipped: 0 };
  try {
    const { syncQbMonthlyFinancials } = await import("./qb-monthly-financials-sync");
    monthlyFin = await syncQbMonthlyFinancials();
  } catch (e: any) {
    console.error("[QB ExpenseDetail] monthly_financials derive failed:", e?.message ?? e);
  }

  console.log(
    `[QB ExpenseDetail] synced ${windows.length} weekly windows: ${plRowsWritten} P&L lines, ${replacedWindows} windows replaced (${deletedRows} stale rows deleted), ${vendorRows ?? "FAILED"} vendor rollups (${vendorOrphansDeleted ?? "?"} orphans removed), ${monthlyFin.updated} months, ${gaps.length} gap(s)`,
  );
  return {
    ok: true,
    windows: windows.length,
    plRows: plRowsWritten,
    vendorRows,
    vendorOrphansDeleted,
    replacedWindows,
    deletedRows,
    monthlyFinancials: monthlyFin,
    gaps,
  };
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
  // Refresh DAILY at ~5am MT (idempotent: successful windows replace their own
  // date range; failed windows are untouched). The old weekly setInterval was
  // boot-relative and reset on every redeploy, leaving expense detail days
  // stale. A fixed daily slot (via self-rescheduling setTimeout, which also
  // sidesteps the TIMEOUT_MAX > 24.8d clamp that caused the prior OOM) keeps
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
