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
