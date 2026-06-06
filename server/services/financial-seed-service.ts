/**
 * CIPH.R Finances — one-time seeder.
 *
 * Loads the accountant's real financials (parsed from the Jun-2026 export) into
 * the app so the Finances tab is populated immediately on deploy, before
 * QuickBooks is connected. Idempotent: only seeds tables that are empty, so QB
 * live data (and re-runs) never clobber it.
 *
 *  - monthly_financials  ← 53 months of P&L (headline + expense categories)
 *  - qb_financial_snapshots ← one balance-sheet snapshot (cash/AR/AP + latest
 *    month P&L) so the Financial Position / runway views light up with real data
 */
import { storage } from "../storage";
import { FINANCIAL_SEED } from "../data/financial-seed";
import type { InsertMonthlyFinancial, InsertQbFinancialSnapshot } from "@shared/schema";

export async function seedFinancialsIfEmpty(): Promise<void> {
  const s: any = FINANCIAL_SEED;
  try {
    const existing = await storage.countMonthlyFinancials();
    if (existing > 0) {
      console.log(`[Finances Seed] monthly_financials already populated (${existing} rows).`);
    } else {
      const h = s.headline;
      const num = (arr: any[], i: number) => (arr && arr[i] != null ? String(arr[i]) : null);
      let inserted = 0;
      for (let i = 0; i < s.months.length; i++) {
        const cats: Record<string, number> = {};
        for (const name of Object.keys(s.expenseCategories)) {
          const v = s.expenseCategories[name][i];
          if (v != null) cats[name] = v;
        }
        const row: InsertMonthlyFinancial = {
          month: s.months[i],
          totalIncome: num(h.totalIncome, i),
          totalCogs: num(h.totalCOGS, i),
          grossProfit: num(h.grossProfit, i),
          totalExpenses: num(h.totalExpenses, i),
          netOperatingIncome: num(h.netOperatingIncome, i),
          netIncome: num(h.netIncome, i),
          expenseCategories: cats as unknown,
          source: "accountant_seed",
        };
        await storage.createMonthlyFinancial(row);
        inserted++;
      }
      console.log(`[Finances Seed] Seeded ${inserted} months of P&L from accountant export.`);
    }

    // Balance-sheet snapshot — only if none exists yet (don't override a live QB pull)
    const snap = await storage.getLatestQbFinancialSnapshot();
    if (!snap) {
      const bs = s.balanceSheet;
      const li = s.months.length - 1;
      const h = s.headline;
      const at = (arr: any[]) => (arr && arr[li] != null ? String(arr[li]) : null);
      const seedSnap: InsertQbFinancialSnapshot = {
        capturedAt: new Date(),
        cashOnHand: String(bs.cash),
        accountsReceivable: String(bs.accountsReceivable),
        accountsPayable: String(bs.accountsPayable),
        operatingExpenses: at(h.totalExpenses),
        grossProfit: at(h.grossProfit),
        netIncome: at(h.netIncome),
        totalIncome: at(h.totalIncome),
        realmId: "accountant-seed",
        dataGaps: [] as unknown,
        confidence: 100,
        raw: null,
      };
      await storage.createQbFinancialSnapshot(seedSnap);
      console.log("[Finances Seed] Seeded balance-sheet snapshot from accountant export.");
    }
  } catch (e: any) {
    console.error("[Finances Seed] Failed:", e?.message ?? e);
  }
}
