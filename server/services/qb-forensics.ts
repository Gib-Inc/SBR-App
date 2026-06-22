/**
 * December 2025 forensics — one-shot.
 *
 * The Dec-2025 books show COGS at 105% of revenue (a ~$103K spike) that turned a
 * mild-loss year into the worst on record. Two competing explanations: (a) the
 * post-rush replenishment got expensed to COGS instead of capitalized to the
 * inventory asset (recoverable paper loss), or (b) a real year-end write-down.
 *
 * This pulls the evidence straight from QuickBooks (read-only) and logs it so we
 * can decide without the accountant:
 *   - Inventory-asset balance at Oct/Nov/Dec/Jan month-ends (the roll-forward).
 *   - The actual December COGS transactions, grouped by transaction TYPE. Bills/
 *     Checks from suppliers => purchases expensed (a). A Journal Entry / Inventory
 *     Qty Adjust => write-down (b).
 */
import { storage } from "../storage";
import { QuickBooksClient, isQuickBooksConfigured } from "./quickbooks-client";
import { parseExpenseDetail, summarizeExpenseDetail } from "./qb-financial-service";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** First amount whose row label contains `needle` in a QB report tree. */
function reportLine(report: any, needle: string): number | null {
  if (!report) return null;
  const nl = needle.toLowerCase();
  const toNum = (raw: any): number | null => {
    if (raw == null || raw === "") return null;
    const n = Number(String(raw).replace(/[$,]/g, ""));
    return Number.isNaN(n) ? null : n;
  };
  let found: number | null = null;
  const walk = (rows: any[]) => {
    for (const row of rows || []) {
      if (found != null) return;
      const cd = row?.ColData || row?.Header?.ColData || row?.Summary?.ColData;
      if (Array.isArray(cd) && cd.length) {
        const label = String(cd[0]?.value || "").toLowerCase();
        if (label.includes(nl)) {
          const v = toNum(cd[cd.length - 1]?.value);
          if (v != null) { found = v; return; }
        }
      }
      if (row?.Rows?.Row) walk(row.Rows.Row);
    }
  };
  walk(report?.Rows?.Row || []);
  return found;
}

const isCogsAccount = (acct: string) => /cost of goods|cogs|inventory|shipping|freight/i.test(acct);

export async function runDecember2025Forensics(force = false): Promise<void> {
  if (!isQuickBooksConfigured()) return;
  try {
    if (!force) {
      const prior = await storage.getAllSystemLogs({ type: "AUDIT" });
      if (prior.some((l: any) => l.code === "DEC_FORENSICS")) return;
    }

    const userId = (await storage.getConnectedQuickbooksUserId()) || "system";
    const client = new QuickBooksClient(storage, userId);
    if (!(await client.initialize())) {
      await storage.createSystemLog({
        type: "AUDIT", severity: "WARN", code: "DEC_FORENSICS",
        message: "QuickBooks not connected for December forensics", details: {} as any,
      }).catch(() => {});
      return;
    }

    // Inventory-asset roll-forward across the four month-ends.
    const [bsOct, bsNov, bsDec, bsJan] = await Promise.all([
      client.fetchBalanceSheetAsOf("2025-10-31"),
      client.fetchBalanceSheetAsOf("2025-11-30"),
      client.fetchBalanceSheetAsOf("2025-12-31"),
      client.fetchBalanceSheetAsOf("2026-01-31"),
    ]);
    const inventoryAsset = {
      oct: reportLine(bsOct, "inventory"),
      nov: reportLine(bsNov, "inventory"),
      dec: reportLine(bsDec, "inventory"),
      jan: reportLine(bsJan, "inventory"),
    };

    // December's actual COGS transactions, by type.
    const ed = await client.fetchExpenseDetailRaw(new Date("2025-12-01"), new Date("2025-12-31"));
    const parsed = ed.report ? parseExpenseDetail(ed.report) : { lines: [], colKeys: [], rowCount: 0 };
    const summary = summarizeExpenseDetail(parsed, { start: "2025-12-01", end: "2025-12-31" });

    const cogsLines = parsed.lines.filter((l) => isCogsAccount(l.account));
    const byTxnType: Record<string, { count: number; total: number }> = {};
    for (const l of cogsLines) {
      const t = l.txnType || "(none)";
      byTxnType[t] = byTxnType[t] || { count: 0, total: 0 };
      byTxnType[t].count++;
      byTxnType[t].total = round2(byTxnType[t].total + l.amount);
    }
    const topCogsTransactions = [...cogsLines]
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 15)
      .map((l) => ({ date: l.date, type: l.txnType, payee: l.payee, account: l.account, amount: l.amount, memo: l.memo }));
    const cogsAccounts = summary.byAccount
      .filter((a) => isCogsAccount(a.account))
      .map((a) => ({ account: a.account, total: a.total, txns: a.txnCount }));

    await storage.createSystemLog({
      type: "AUDIT",
      severity: "INFO",
      code: "DEC_FORENSICS",
      message: `Dec2025 inventory asset oct/nov/dec/jan = ${inventoryAsset.oct}/${inventoryAsset.nov}/${inventoryAsset.dec}/${inventoryAsset.jan}; ${cogsLines.length} COGS lines`,
      details: {
        inventoryAsset,
        decCogsAccounts: cogsAccounts,
        decCogsByTxnType: byTxnType,
        topCogsTransactions,
        decDetailRows: parsed.rowCount,
        colKeys: parsed.colKeys,
        expenseDetailError: ed.error,
      } as any,
    }).catch(() => {});
  } catch (e: any) {
    await storage.createSystemLog({
      type: "AUDIT", severity: "ERROR", code: "DEC_FORENSICS_ERROR",
      message: `December forensics failed: ${e?.message ?? e}`,
      details: { error: String(e?.message ?? e) } as any,
    }).catch(() => {});
  }
}

/** Every amount whose row label contains `needle` in a QB report (label + value). */
function allReportLines(report: any, needle: string): Array<{ label: string; amount: number | null }> {
  const out: Array<{ label: string; amount: number | null }> = [];
  if (!report) return out;
  const nl = needle.toLowerCase();
  const toNum = (raw: any): number | null => {
    if (raw == null || raw === "") return null;
    const n = Number(String(raw).replace(/[$,]/g, ""));
    return Number.isNaN(n) ? null : n;
  };
  const walk = (rows: any[]) => {
    for (const row of rows || []) {
      const cd = row?.ColData || row?.Header?.ColData || row?.Summary?.ColData;
      if (Array.isArray(cd) && cd.length) {
        const label = String(cd[0]?.value || "");
        if (label.toLowerCase().includes(nl)) out.push({ label, amount: toNum(cd[cd.length - 1]?.value) });
      }
      if (row?.Rows?.Row) walk(row.Rows.Row);
    }
  };
  walk(report?.Rows?.Row || []);
  return out;
}

/**
 * Cutoff + in-transit test. The Dec-2025 write-down was DATED 12-31-25 but built
 * from a Jan-7-26 count. This pulls (1) the inventory-asset balance at precise
 * dates across that window, (2) Jan 1-7 sales/COGS (activity charged to Dec via
 * the late count), and (3) the inventory-account General Ledger Nov-Jan so we can
 * see replenishment receipts vs the write-down vs sales reductions, with dates.
 */
export async function runCutoffForensics(force = false): Promise<void> {
  if (!isQuickBooksConfigured()) return;
  try {
    if (!force) {
      const prior = await storage.getAllSystemLogs({ type: "AUDIT" });
      if (prior.some((l: any) => l.code === "CUTOFF_FORENSICS")) return;
    }
    const userId = (await storage.getConnectedQuickbooksUserId()) || "system";
    const client = new QuickBooksClient(storage, userId);
    if (!(await client.initialize())) return;

    const dates = ["2025-12-24", "2025-12-31", "2026-01-07", "2026-01-15", "2026-01-31", "2026-06-20"];
    const balancesByDate: Record<string, any> = {};
    for (const d of dates) {
      const bs = await client.fetchBalanceSheetAsOf(d);
      balancesByDate[d] = {
        inventoryLines: allReportLines(bs, "inventory"),
        totalAssets: allReportLines(bs, "total assets").slice(-1)[0]?.amount ?? null,
      };
    }

    const jan = await client.fetchExpenseDetailRaw(new Date("2026-01-01"), new Date("2026-01-07"));
    const janParsed = jan.report ? parseExpenseDetail(jan.report) : { lines: [], colKeys: [], rowCount: 0 };
    const janSummary = summarizeExpenseDetail(janParsed, { start: "2026-01-01", end: "2026-01-07" });
    const jan1to7Accounts = janSummary.byAccount.map((a) => ({ account: a.account, total: a.total, txns: a.txnCount }));

    const invAccts = await client.fetchInventoryAccountIds();
    const gl = invAccts.length ? await client.fetchGeneralLedger("2025-11-01", "2026-01-31", invAccts.map((a) => a.id)) : null;
    const glParsed = gl ? parseExpenseDetail(gl) : { lines: [], colKeys: [], rowCount: 0 };
    const glByType: Record<string, { count: number; total: number }> = {};
    for (const l of glParsed.lines) {
      const t = l.txnType || "(none)";
      glByType[t] = glByType[t] || { count: 0, total: 0 };
      glByType[t].count++;
      glByType[t].total = Math.round((glByType[t].total + l.amount) * 100) / 100;
    }
    const glCutoffWindow = glParsed.lines
      .filter((l) => l.date && l.date >= "2025-12-28" && l.date <= "2026-01-07")
      .map((l) => ({ date: l.date, type: l.txnType, payee: l.payee, amount: l.amount, memo: l.memo }));
    const glTop = [...glParsed.lines]
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 20)
      .map((l) => ({ date: l.date, type: l.txnType, payee: l.payee, amount: l.amount, memo: l.memo }));

    await storage.createSystemLog({
      type: "AUDIT",
      severity: "INFO",
      code: "CUTOFF_FORENSICS",
      message: `Cutoff forensics: ${invAccts.length} inventory accts; GL rows ${glParsed.rowCount}; Jan1-7 accts ${jan1to7Accounts.length}`,
      details: {
        inventoryAccounts: invAccts,
        balancesByDate,
        jan1to7Accounts,
        jan1to7Error: jan.error,
        inventoryGlByType: glByType,
        inventoryGlCutoffWindow: glCutoffWindow,
        inventoryGlTop: glTop,
        glStatus: gl ? "ok" : "no GL (no inventory account id or call failed)",
      } as any,
    }).catch(() => {});
  } catch (e: any) {
    await storage.createSystemLog({
      type: "AUDIT", severity: "ERROR", code: "CUTOFF_FORENSICS_ERROR",
      message: `Cutoff forensics failed: ${e?.message ?? e}`,
      details: { error: String(e?.message ?? e) } as any,
    }).catch(() => {});
  }
}
