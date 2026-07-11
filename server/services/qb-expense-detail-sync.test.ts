import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Self-healing qb_pl_detail mirror — the mirror must propagate QBO edits and
 * deletions (July 10 2026: deleted A2X JEs lingered as ghost rows) WITHOUT ever
 * losing data on API errors, parse regressions, empty-response outages, or
 * partial-run seams. Pure decision tests + mocked-module integration tests for
 * the DB-touching guards.
 */

// ── module mocks (hoisted before the module under test loads) ────────────────
const h = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  txExecute: vi.fn(),
  dbTransaction: vi.fn(),
  rebuildQbVendorExpense: vi.fn(),
  getQuickbooksAuth: vi.fn(),
  qbPlDetailHasRows: vi.fn(),
  getConnectedQuickbooksUserId: vi.fn(),
  clientInitialize: vi.fn(),
  fetchExpenseDetailRaw: vi.fn(),
  syncQbMonthlyFinancials: vi.fn(),
}));

vi.mock("../db", () => ({
  db: { execute: h.dbExecute, transaction: h.dbTransaction },
}));
vi.mock("../storage", () => ({
  storage: {
    getQuickbooksAuth: h.getQuickbooksAuth,
    rebuildQbVendorExpense: h.rebuildQbVendorExpense,
    qbPlDetailHasRows: h.qbPlDetailHasRows,
    getConnectedQuickbooksUserId: h.getConnectedQuickbooksUserId,
  },
}));
vi.mock("./quickbooks-client", () => ({
  QuickBooksClient: class {
    constructor(_storage: unknown, _userId: string) {}
    initialize() { return h.clientInitialize(); }
    fetchExpenseDetailRaw(s: Date, e: Date) { return h.fetchExpenseDetailRaw(s, e); }
  },
}));
vi.mock("./qb-monthly-financials-sync", () => ({
  syncQbMonthlyFinancials: h.syncQbMonthlyFinancials,
}));

import {
  decideWindowReplacement,
  isReportPayloadEmpty,
  syncQbExpenseDetail,
  EMPTY_DELETE_TRAILING_DAYS,
  EMPTY_DELETE_MAX_ROWS,
} from "./qb-expense-detail-sync";

const NOW = new Date("2026-07-11T12:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Baseline decision args: recent window, healthy corroborated run. */
const base = {
  fetchOk: true,
  parsedLineCount: 0,
  rawDataRowCount: 0,
  reportPayloadEmpty: true,
  runHasInsertedRows: true,
  windowStart: day("2026-07-05"),
  windowEnd: day("2026-07-11"),
  now: NOW,
};

describe("decideWindowReplacement", () => {
  it("fetch FAILED → no delete, no insert (API errors never cause data loss)", () => {
    const d = decideWindowReplacement({ ...base, fetchOk: false });
    expect(d.delete).toBe(false);
    expect(d.insert).toBe(false);
    expect(d.gapNote).toBeUndefined(); // the fetch loop records its own gap
  });

  it("fetch FAILED → no delete even if the failed fetch somehow carried rows", () => {
    const d = decideWindowReplacement({ ...base, fetchOk: false, parsedLineCount: 42, rawDataRowCount: 42, reportPayloadEmpty: false });
    expect(d).toEqual({ delete: false, insert: false });
  });

  it("fresh rows in a recent window → delete + insert the same window", () => {
    const d = decideWindowReplacement({ ...base, parsedLineCount: 17, rawDataRowCount: 17, reportPayloadEmpty: false });
    expect(d.delete).toBe(true);
    expect(d.insert).toBe(true);
    expect(d.gapNote).toBeUndefined();
  });

  it("fresh rows in an OLD window → still replace (edits propagate at any age)", () => {
    const d = decideWindowReplacement({
      ...base,
      parsedLineCount: 3,
      rawDataRowCount: 3,
      reportPayloadEmpty: false,
      windowStart: day("2025-08-01"),
      windowEnd: day("2025-08-07"),
    });
    expect(d.delete).toBe(true);
    expect(d.insert).toBe(true);
  });

  it("0 parsed lines from a NON-empty payload → PARSE FAILURE: no delete + loud gap note", () => {
    // The regression the guard exists for: ColKey rename / amount-format change
    // makes the parser extract nothing while QBO clearly returned data. Deleting
    // here would wipe the trailing weeks every night until a human fixed it.
    const d = decideWindowReplacement({ ...base, reportPayloadEmpty: false, rawDataRowCount: 129 });
    expect(d.delete).toBe(false);
    expect(d.insert).toBe(false);
    expect(d.gapNote).toContain("PARSE FAILURE");
    expect(d.gapNote).toContain("129");
    expect(d.gapNote).toContain("2026-07-05..2026-07-11");
  });

  it("verifiably-empty payload within the trailing 70d on a corroborated run → delete", () => {
    const d = decideWindowReplacement({ ...base, windowStart: day("2026-07-01"), windowEnd: day("2026-07-07") });
    expect(d.delete).toBe(true);
    expect(d.insert).toBe(false);
    expect(d.gapNote).toBeUndefined();
  });

  it("verifiably-empty payload but the run has inserted NOTHING yet → no delete + gap note (outage guard)", () => {
    // A QBO outage serving empty 200s across the board looks exactly like this:
    // every window empty, zero rows written. Nothing may be deleted.
    const d = decideWindowReplacement({ ...base, runHasInsertedRows: false });
    expect(d.delete).toBe(false);
    expect(d.insert).toBe(false);
    expect(d.gapNote).toContain("inserted 0 rows");
  });

  it("empty success OLDER than 70d → no delete + gap note (guards against wiping history)", () => {
    const d = decideWindowReplacement({
      ...base,
      windowStart: day("2025-08-01"),
      windowEnd: day("2025-08-07"),
    });
    expect(d.delete).toBe(false);
    expect(d.insert).toBe(false);
    expect(d.gapNote).toContain("2025-08-01..2025-08-07");
    expect(d.gapNote).toContain(String(EMPTY_DELETE_TRAILING_DAYS));
  });

  it("empty success STRADDLING the 70d boundary → no delete (whole window must be recent)", () => {
    // Boundary = NOW − 70d = 2026-05-02T12:00Z. Window starts before it, ends after.
    const d = decideWindowReplacement({
      ...base,
      windowStart: day("2026-04-30"),
      windowEnd: day("2026-05-06"),
    });
    expect(d.delete).toBe(false);
    expect(d.insert).toBe(false);
    expect(d.gapNote).toBeTruthy();
  });

  it("empty success with window start exactly ON the boundary → delete (inclusive)", () => {
    const boundaryStart = new Date(NOW.getTime() - EMPTY_DELETE_TRAILING_DAYS * 86_400_000);
    const d = decideWindowReplacement({
      ...base,
      windowStart: boundaryStart,
      windowEnd: new Date(boundaryStart.getTime() + 6 * 86_400_000),
    });
    expect(d.delete).toBe(true);
    expect(d.insert).toBe(false);
  });
});

describe("isReportPayloadEmpty", () => {
  it("no Rows key / empty Rows object / empty Row array → verifiably empty", () => {
    expect(isReportPayloadEmpty({})).toBe(true);
    expect(isReportPayloadEmpty({ Rows: {} })).toBe(true); // QBO's actual empty-report shape
    expect(isReportPayloadEmpty({ Rows: { Row: [] } })).toBe(true);
  });

  it("any row present → NOT empty", () => {
    expect(isReportPayloadEmpty({ Rows: { Row: [{ type: "Section" }] } })).toBe(false);
  });

  it("malformed non-array Row → NOT verifiably empty (must be treated as parse failure, never emptiness)", () => {
    expect(isReportPayloadEmpty({ Rows: { Row: { boom: true } } })).toBe(false);
  });
});

// ── integration (mocked db/storage/client): guards on the real write path ────

/** Minimal QBO ProfitAndLossDetail with real ColKey metadata + one section. */
const qboReport = (lines: Array<{ date: string; amount: string; payee?: string }>) => ({
  Columns: {
    Column: [
      { MetaData: [{ Name: "ColKey", Value: "tx_date" }] },
      { MetaData: [{ Name: "ColKey", Value: "txn_type" }] },
      { MetaData: [{ Name: "ColKey", Value: "doc_num" }] },
      { MetaData: [{ Name: "ColKey", Value: "name" }] },
      { MetaData: [{ Name: "ColKey", Value: "memo" }] },
      { MetaData: [{ Name: "ColKey", Value: "account_name" }] },
      { MetaData: [{ Name: "ColKey", Value: "subt_nat_amount" }] },
    ],
  },
  Rows: {
    Row: [
      {
        type: "Section",
        Header: { ColData: [{ value: "Shipping" }] },
        Rows: {
          Row: lines.map((l) => ({
            type: "Data",
            ColData: [
              { value: l.date }, { value: "Expense" }, { value: "INV-A" },
              { value: l.payee ?? "Pyvott" }, { value: "" }, { value: "Shipping" },
              { value: l.amount },
            ],
          })),
        },
      },
    ],
  },
});
/** QBO's empty-report shape: Rows is an empty object. */
const emptyReport = () => ({ Columns: { Column: [] }, Rows: {} });
/** Non-empty payload whose rows carry NO parseable amounts → parser extracts 0 lines. */
const parseZeroReport = () => qboReport([{ date: "2026-07-06", amount: "N/A" }]);
/** Rows.Row is a non-iterable object → parseExpenseDetail throws mid-walk. */
const throwingReport = () => ({ Columns: { Column: [] }, Rows: { Row: { boom: true } } });

const sqlText = (q: unknown) => JSON.stringify(q);

/** Two consecutive weekly windows ending today (both inside the trailing 70d). */
const runRangeDates = () => {
  const end = new Date();
  const start = new Date(end.getTime() - 10 * 86_400_000);
  return { start, end };
};

const setReports = (byWindowStart: Record<string, any>) => {
  h.fetchExpenseDetailRaw.mockImplementation(async (s: Date, e: Date) => ({
    report: byWindowStart[iso(s)] ?? emptyReport(),
    periodStart: iso(s),
    periodEnd: iso(e),
    error: null,
  }));
};

beforeEach(() => {
  vi.clearAllMocks();
  h.clientInitialize.mockResolvedValue(true);
  h.getQuickbooksAuth.mockResolvedValue({ realmId: "realm-1" });
  h.rebuildQbVendorExpense.mockResolvedValue(7);
  h.syncQbMonthlyFinancials.mockResolvedValue({ updated: 2, skipped: 1 });
  h.dbTransaction.mockImplementation(async (cb: (tx: any) => Promise<void>) => cb({ execute: h.txExecute }));
  h.txExecute.mockResolvedValue({ rowCount: 0, rows: [] });
  h.dbExecute.mockImplementation(async (q: unknown) => {
    const s = sqlText(q);
    if (s.includes("SELECT COUNT")) return { rows: [{ n: 0 }], rowCount: 1 };
    return { rowCount: 0, rows: [] };
  });
});

describe("syncQbExpenseDetail (mocked write path)", () => {
  it("BLAST-RADIUS TRIPWIRE: an empty window about to erase > EMPTY_DELETE_MAX_ROWS rows is refused, rows kept", async () => {
    const { start, end } = runRangeDates();
    const windowStarts = [iso(start)]; // first window has data → corroborates the run
    setReports({ [windowStarts[0]]: qboReport([
      { date: iso(start), amount: "100.00" },
      { date: iso(start), amount: "50.00" },
      { date: iso(start), amount: "25.00" },
    ]) }); // every other window → emptyReport()
    h.dbExecute.mockImplementation(async (q: unknown) => {
      const s = sqlText(q);
      if (s.includes("SELECT COUNT")) return { rows: [{ n: 120 }], rowCount: 1 }; // way over threshold
      return { rowCount: 0, rows: [] };
    });

    const r = await syncQbExpenseDetail("u1", { startDate: start, endDate: end });

    expect(r.ok).toBe(true);
    const tripwire = (r.gaps ?? []).filter((g) => g.includes("BLAST-RADIUS TRIPWIRE"));
    expect(tripwire.length).toBeGreaterThan(0);
    expect(tripwire[0]).toContain("120");
    expect(tripwire[0]).toContain(String(EMPTY_DELETE_MAX_ROWS));
    // Only the data window ran a transaction — the refused empty window never deleted.
    expect(h.dbTransaction).toHaveBeenCalledTimes(1);
    expect(r.replacedWindows).toBe(1);
    expect(r.deletedRows).toBe(0);
  });

  it("empty window under the tripwire threshold on a corroborated run → delete proceeds", async () => {
    const { start, end } = runRangeDates();
    setReports({ [iso(start)]: qboReport([{ date: iso(start), amount: "100.00" }]) });
    h.dbExecute.mockImplementation(async (q: unknown) => {
      const s = sqlText(q);
      if (s.includes("SELECT COUNT")) return { rows: [{ n: 4 }], rowCount: 1 };
      return { rowCount: 0, rows: [] };
    });
    h.txExecute.mockImplementation(async (q: unknown) => {
      const s = sqlText(q);
      if (s.includes("DELETE FROM qb_pl_detail")) return { rowCount: 4, rows: [] };
      return { rowCount: 0, rows: [] };
    });

    const r = await syncQbExpenseDetail("u1", { startDate: start, endDate: end });

    expect(r.ok).toBe(true);
    expect((r.gaps ?? []).join("\n")).not.toContain("BLAST-RADIUS");
    expect(r.replacedWindows).toBe(2); // data window + empty window both replaced
    expect(r.deletedRows).toBeGreaterThanOrEqual(4);
  });

  it("uncorroborated all-empty run (QBO empty-response outage) deletes NOTHING", async () => {
    const { start, end } = runRangeDates();
    setReports({}); // every window returns a verifiably-empty report
    const r = await syncQbExpenseDetail("u1", { startDate: start, endDate: end });

    expect(r.ok).toBe(true);
    expect(h.dbTransaction).not.toHaveBeenCalled(); // no deletes at all
    expect(r.deletedRows).toBe(0);
    expect((r.gaps ?? []).some((g) => g.includes("inserted 0 rows"))).toBe(true);
    // Downstream chain still ran.
    expect(h.rebuildQbVendorExpense).toHaveBeenCalledWith("realm-1");
    expect(h.syncQbMonthlyFinancials).toHaveBeenCalledTimes(1);
  });

  it("parse-zero from a NON-empty payload → gap note, no transaction, rollups still run", async () => {
    const { start, end } = runRangeDates();
    setReports({ [iso(start)]: parseZeroReport() });
    // Make the OTHER windows parse-zero too so no delete path can corroborate.
    h.fetchExpenseDetailRaw.mockImplementation(async (s: Date, e: Date) => ({
      report: parseZeroReport(), periodStart: iso(s), periodEnd: iso(e), error: null,
    }));

    const r = await syncQbExpenseDetail("u1", { startDate: start, endDate: end });

    expect(r.ok).toBe(true);
    expect(h.dbTransaction).not.toHaveBeenCalled();
    expect((r.gaps ?? []).some((g) => g.includes("PARSE FAILURE"))).toBe(true);
    expect(h.rebuildQbVendorExpense).toHaveBeenCalledTimes(1);
    expect(h.syncQbMonthlyFinancials).toHaveBeenCalledTimes(1);
  });

  it("a window whose report makes the parser THROW becomes a gap note; later windows + rollup chain still run", async () => {
    const { start, end } = runRangeDates();
    const w1 = iso(start);
    setReports({ [w1]: throwingReport() }); // window 1 throws; window 2 = empty (no corroboration → no delete)

    const r = await syncQbExpenseDetail("u1", { startDate: start, endDate: end });

    expect(r.ok).toBe(true);
    expect((r.gaps ?? []).some((g) => g.includes("PARSE THREW"))).toBe(true);
    // The chain after the loop ran despite the mid-run throw.
    expect(h.rebuildQbVendorExpense).toHaveBeenCalledTimes(1);
    expect(h.syncQbMonthlyFinancials).toHaveBeenCalledTimes(1);
  });

  it("qb_vendor_expense self-heals: orphaned vendor-month rollups are deleted AFTER the rebuild", async () => {
    const { start, end } = runRangeDates();
    setReports({ [iso(start)]: qboReport([{ date: iso(start), amount: "10.00" }]) });
    let orphanDeleteOrder = -1;
    h.dbExecute.mockImplementation(async (q: unknown) => {
      const s = sqlText(q);
      if (s.includes("SELECT COUNT")) return { rows: [{ n: 0 }], rowCount: 1 };
      if (s.includes("DELETE FROM qb_vendor_expense")) {
        expect(s).toContain("NOT EXISTS"); // only rows with no backing detail
        expect(s).toContain("realm-1"); // realm-scoped
        orphanDeleteOrder = h.rebuildQbVendorExpense.mock.calls.length; // rebuild already happened
        return { rowCount: 3, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const r = await syncQbExpenseDetail("u1", { startDate: start, endDate: end });

    expect(r.ok).toBe(true);
    expect(orphanDeleteOrder).toBe(1); // orphan delete ran after rebuildQbVendorExpense
    expect(r.vendorOrphansDeleted).toBe(3);
    expect(r.vendorRows).toBe(7);
  });

  it("NULL-txn_date deletes require the row's stored period to be contained in THIS run's range (seam guard)", async () => {
    const { start, end } = runRangeDates();
    setReports({ [iso(start)]: qboReport([{ date: iso(start), amount: "10.00" }]) });
    const deleteSqls: string[] = [];
    h.txExecute.mockImplementation(async (q: unknown) => {
      const s = sqlText(q);
      if (s.includes("DELETE FROM qb_pl_detail")) deleteSqls.push(s);
      return { rowCount: 0, rows: [] };
    });

    await syncQbExpenseDetail("u1", { startDate: start, endDate: end });

    expect(deleteSqls.length).toBeGreaterThan(0);
    for (const s of deleteSqls) {
      expect(s).toContain("txn_date IS NULL");
      // Overlap alone is not enough — the run range bounds both period columns.
      expect(s).toContain("period_start >=");
      expect(s).toContain("period_end <=");
      // The run's actual boundary dates are bound as parameters.
      expect(s).toContain(iso(start));
      expect(s).toContain(iso(end));
    }
  });

  it("rollup rebuild failure → gap note, vendorRows unset (not a fabricated 0), monthly_financials STILL derived", async () => {
    const { start, end } = runRangeDates();
    setReports({ [iso(start)]: qboReport([{ date: iso(start), amount: "10.00" }]) });
    h.rebuildQbVendorExpense.mockRejectedValue(new Error("rollup exploded"));

    const r = await syncQbExpenseDetail("u1", { startDate: start, endDate: end });

    expect(r.ok).toBe(true);
    expect(r.vendorRows).toBeUndefined();
    expect(r.vendorOrphansDeleted).toBeUndefined();
    expect((r.gaps ?? []).some((g) => g.includes("vendor rollup rebuild/self-heal failed"))).toBe(true);
    expect(h.syncQbMonthlyFinancials).toHaveBeenCalledTimes(1);
  });

  it("unreadable blast-radius pre-count BLOCKS the delete (gap note, no wipe) — a gap never passes silently", async () => {
    const { start, end } = runRangeDates();
    setReports({ [iso(start)]: qboReport([{ date: iso(start), amount: "10.00" }]) });
    h.dbExecute.mockImplementation(async (q: unknown) => {
      const s = sqlText(q);
      if (s.includes("SELECT COUNT")) return { rows: [], rowCount: 0 }; // count query returns nothing readable
      return { rowCount: 0, rows: [] };
    });

    const r = await syncQbExpenseDetail("u1", { startDate: start, endDate: end });

    expect(r.ok).toBe(true);
    expect((r.gaps ?? []).some((g) => g.includes("pre-count unreadable"))).toBe(true);
    expect(h.dbTransaction).toHaveBeenCalledTimes(1); // only the data window; the empty window refused
  });

  it("in-flight guard: a second concurrent sync returns ok:false without touching data", async () => {
    const { start, end } = runRangeDates();
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    h.fetchExpenseDetailRaw.mockImplementation(async (s: Date, e: Date) => {
      await gate;
      return { report: emptyReport(), periodStart: iso(s), periodEnd: iso(e), error: null };
    });

    const first = syncQbExpenseDetail("u1", { startDate: start, endDate: end });
    const second = await syncQbExpenseDetail("u1", { startDate: start, endDate: end });
    expect(second.ok).toBe(false);
    expect(second.error).toContain("already in progress");

    release();
    const r1 = await first;
    expect(r1.ok).toBe(true);

    // After the first run finishes, the guard is released.
    const third = await syncQbExpenseDetail("u1", { startDate: start, endDate: end });
    expect(third.ok).toBe(true);
  });
});
