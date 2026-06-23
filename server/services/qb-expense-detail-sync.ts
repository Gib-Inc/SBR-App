/**
 * CIPH.R — QuickBooks expense-detail sync.
 *
 * Pulls QuickBooks ProfitAndLossDetail month-by-month into `qb_pl_detail` (one
 * row per transaction line) and per-vendor monthly rollups into
 * `qb_vendor_expense`, so spend is queryable by vendor (e.g. "Pyvott
 * Fulfillment") and by account (e.g. "Vehicle Gas & Fuel") over time.
 *
 * READ-ONLY against QuickBooks — reuses the existing
 * QuickBooksClient.fetchExpenseDetailRaw + parseExpenseDetail. Idempotent:
 * qb_pl_detail upserts via ON CONFLICT DO NOTHING on its natural key, and the
 * per-vendor rollups are recomputed from the freshly-parsed lines each run and
 * upserted per (realm, vendor, period), so re-runs never double-count.
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

export interface QbVendorExpenseRow {
  realmId: string;
  vendor: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  months?: number;
  plRows?: number;
  vendorRows?: number;
  gaps?: string[];
}

/** Inclusive list of UTC month windows spanning [start, end]. */
function monthWindows(start: Date, end: Date): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 0)) });
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

/**
 * Pull + persist transaction-level expense detail for [startDate, endDate]
 * (default: trailing 13 months). Returns counts; never throws to the caller.
 */
export async function syncQbExpenseDetail(
  userId: string,
  opts?: { startDate?: Date; endDate?: Date },
): Promise<SyncResult> {
  const client = new QuickBooksClient(storage, userId);
  if (!(await client.initialize())) return { ok: false, error: "QuickBooks not connected" };

  // Decrypted realm for the NOT NULL realm_id column.
  const auth = await storage.getQuickbooksAuth(userId);
  const realmId = auth?.realmId ?? "unknown";

  const end = opts?.endDate ?? new Date();
  const start =
    opts?.startDate ?? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 12, 1));
  const windows = monthWindows(start, end);

  const plRows: QbPlDetailRow[] = [];
  const vendorAgg = new Map<string, QbVendorExpenseRow>();
  const gaps: string[] = [];

  for (const w of windows) {
    const { report, periodStart, periodEnd, error } = await client.fetchExpenseDetailRaw(w.start, w.end);
    if (error || !report) {
      gaps.push(error || `no report ${periodStart}..${periodEnd}`);
      continue;
    }
    const parsed = parseExpenseDetail(report);
    for (const ln of parsed.lines) {
      const vendor = ln.payee && ln.payee !== "(no payee)" ? ln.payee : null;
      plRows.push({
        realmId,
        txnDate: ln.date,
        txnType: ln.txnType,
        docNumber: ln.docNumber,
        vendorOrPayee: vendor,
        accountName: ln.account,
        memo: ln.memo,
        amount: ln.amount,
        periodStart,
        periodEnd,
      });
      if (vendor) {
        const key = `${vendor}|${periodStart}`;
        const agg = vendorAgg.get(key) ?? { realmId, vendor, periodStart, periodEnd, totalAmount: 0 };
        agg.totalAmount = Math.round((agg.totalAmount + ln.amount) * 100) / 100;
        vendorAgg.set(key, agg);
      }
    }
  }

  const plInserted = await storage.bulkInsertQbPlDetail(plRows);
  const vendorRows = Array.from(vendorAgg.values());
  const vendorUpserted = await storage.upsertQbVendorExpense(vendorRows);

  console.log(
    `[QB ExpenseDetail] synced ${windows.length} months: ${plInserted} P&L lines, ${vendorUpserted} vendor rollups, ${gaps.length} gap(s)`,
  );
  return { ok: true, months: windows.length, plRows: plInserted, vendorRows: vendorUpserted, gaps };
}

let backfillArmed = false;
/**
 * Arm: (1) a one-time backfill ~45s after boot that pulls the trailing ~15
 * months IF qb_pl_detail is empty and a QuickBooks user is connected, and (2) a
 * monthly refresh of the trailing 13 months thereafter. Self-guards via the
 * `armed` flag + the empty-table check, so restarts never refire the backfill.
 * Fire-and-forget — never blocks listen(). NOTE: deliberately NOT wired to any
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
  const t = setInterval(() => { void refresh(12, false); }, 30 * 24 * 60 * 60 * 1000); // monthly
  if (typeof (t as any)?.unref === "function") (t as any).unref();
}
