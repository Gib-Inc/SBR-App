/**
 * Auto-derive monthly_financials from QuickBooks — so the operator never has to
 * upload P&L sheets once QB is connected.
 *
 * After each qb_pl_detail refresh, this rolls the GL up per COMPLETE calendar month
 * and upserts a monthly_financials row (source 'quickbooks'). It:
 *   - covers only the months QB actually has (recent ~15 mo) — the pre-QB accountant
 *     seed (2022-2024) is left untouched;
 *   - NEVER overwrites a month the accountant manually uploaded (source
 *     'accountant_upload') — manual stays an override;
 *   - writes the current (incomplete) month NOT at all (only closed months).
 *
 * QuickBooks is the book of record; this reads and mirrors, it never posts to QB.
 * Same rollup/classifyAccount the Budget Scorecard uses, so every P&L surface agrees.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { classifyAccount } from "./finance-pnl-service";
import type { InsertMonthlyFinancial } from "@shared/schema";

const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface DerivedMonth {
  month: string; // "May 2026"
  totalIncome: number; totalCogs: number; grossProfit: number;
  totalExpenses: number; netOperatingIncome: number; netIncome: number;
  expenseCategories: Record<string, number>;
}

/** Pure: roll GL rows (month label + account + amount) into a monthly_financials shape. */
export function aggregateMonthlyFinancials(
  rows: Array<{ month: string; account: string; amount: number }>,
): DerivedMonth[] {
  const byMonth = new Map<string, { income: number; contra: number; cogs: number; expenses: number; cats: Record<string, number> }>();
  for (const r of rows) {
    const b = byMonth.get(r.month) ?? { income: 0, contra: 0, cogs: 0, expenses: 0, cats: {} };
    const g = classifyAccount(r.account);
    if (g === "income") b.income += r.amount;
    else if (g === "contra") b.contra += r.amount; // discounts/returns, already negative in QB
    else if (g === "cogs") b.cogs += r.amount;
    else if (g === "expense") { b.expenses += r.amount; b.cats[r.account] = r2((b.cats[r.account] ?? 0) + r.amount); }
    // g === "duplicate" → skip (Match-Shopify reconciliation tree double-counts revenue)
    byMonth.set(r.month, b);
  }
  return Array.from(byMonth.entries()).map(([month, b]) => {
    const totalIncome = r2(b.income + b.contra); // net sales (after discounts/returns)
    const grossProfit = r2(totalIncome - b.cogs);
    const netIncome = r2(grossProfit - b.expenses);
    return {
      month, totalIncome, totalCogs: r2(b.cogs), grossProfit,
      totalExpenses: r2(b.expenses), netOperatingIncome: netIncome, netIncome,
      expenseCategories: b.cats,
    };
  });
}

/** Roll up qb_pl_detail (complete months only, Mountain time) into monthly_financials,
 *  skipping any month the accountant manually uploaded. Idempotent. */
export async function syncQbMonthlyFinancials(): Promise<{ updated: number; skipped: number }> {
  // Complete calendar months only — exclude the current (partial) month. Month label
  // 'Mon YYYY' matches the existing monthly_financials convention (e.g. "May 2026").
  const rows = (((await db.execute(sql`
    SELECT trim(to_char(date_trunc('month', txn_date), 'Mon YYYY')) AS month,
           account_name AS account, round(sum(amount)::numeric, 2) AS amount
    FROM qb_pl_detail
    WHERE txn_date < date_trunc('month', (now() AT TIME ZONE 'America/Denver'))
    GROUP BY 1, 2`)).rows ?? []) as Array<{ month: string; account: string; amount: any }>)
    .map((r) => ({ month: String(r.month), account: String(r.account), amount: num(r.amount) }));
  if (!rows.length) return { updated: 0, skipped: 0 };

  // Never clobber a month the accountant manually uploaded — that stays the override.
  const existing = await storage.getMonthlyFinancials();
  const manual = new Set(
    (existing as any[]).filter((m) => String(m.source) === "accountant_upload").map((m) => String(m.month)),
  );

  const derived = aggregateMonthlyFinancials(rows);
  let updated = 0, skipped = 0;
  for (const d of derived) {
    if (manual.has(d.month)) { skipped++; continue; }
    // Don't overwrite a known-good month with a broken/empty derivation — a complete
    // month with no income means a gapped QB pull, not reality (SBR always has sales).
    // The next refresh re-pulls and corrects it.
    if (d.totalIncome <= 0) { skipped++; continue; }
    const row: InsertMonthlyFinancial = {
      month: d.month,
      totalIncome: String(d.totalIncome), totalCogs: String(d.totalCogs), grossProfit: String(d.grossProfit),
      totalExpenses: String(d.totalExpenses), netOperatingIncome: String(d.netOperatingIncome), netIncome: String(d.netIncome),
      expenseCategories: d.expenseCategories as unknown,
      source: "quickbooks",
    };
    await storage.upsertMonthlyFinancial(row);
    updated++;
  }
  console.log(`[QB MonthlyFinancials] synced from GL: ${updated} months updated, ${skipped} manual-override months kept`);
  return { updated, skipped };
}
