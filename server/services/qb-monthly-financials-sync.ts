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
import { getCanonicalMonthlySpendByChannel } from "./canonical-spend-service";
import type { InsertMonthlyFinancial } from "@shared/schema";

const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface DerivedMonth {
  month: string; // "May 2026"
  grossSales: number;   // income group only (before discounts/returns)
  returns: number;      // contra group (discounts/returns), negative in QB
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
      month, grossSales: r2(b.income), returns: r2(b.contra),
      totalIncome, totalCogs: r2(b.cogs), grossProfit,
      totalExpenses: r2(b.expenses), netOperatingIncome: netIncome, netIncome,
      expenseCategories: b.cats,
    };
  });
}

const MONTH_NUM: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** Pure: "Jun 2026" → { year: 2026, month: 6, ym: "2026-06" }; null if unparseable. */
export function monthLabelToYm(label: string): { year: number; month: number; ym: string } | null {
  const m = /^([A-Z][a-z]{2})\s+(\d{4})$/.exec(String(label).trim());
  if (!m || !MONTH_NUM[m[1]]) return null;
  const month = MONTH_NUM[m[1]];
  const year = Number(m[2]);
  return { year, month, ym: `${year}-${String(month).padStart(2, "0")}` };
}

export interface HistoricalRow {
  year: number; month: number;
  revenue: number; returns: number; totalIncome: number; cogs: number; grossProfit: number;
  adSpend: number; totalExpenses: number; netIncome: number; grossMarginPct: number;
}

/** Pure: map a derived month (+ its ad spend) into the historical_monthly_sales row shape.
 *  Ad spend precedence: canonical bookedMarketingTotal (the MER denominator) when the
 *  canonical engine has the month; else the GL advertising/marketing expense categories
 *  (the same booked concept, computed locally). grossMarginPct uses NET income (totalIncome)
 *  as the denominator, matching the startup seed's convention. */
export function buildHistoricalRow(d: DerivedMonth, adSpend: number): HistoricalRow | null {
  const ym = monthLabelToYm(d.month);
  if (!ym) return null;
  return {
    year: ym.year, month: ym.month,
    revenue: d.grossSales, returns: d.returns, totalIncome: d.totalIncome,
    cogs: d.totalCogs, grossProfit: d.grossProfit,
    adSpend: r2(adSpend), totalExpenses: d.totalExpenses, netIncome: d.netIncome,
    grossMarginPct: d.totalIncome > 0 ? r2((d.grossProfit / d.totalIncome) * 100) : 0,
  };
}

/** Pure: GL fallback for a month's ad spend — the advertising/marketing expense categories. */
export function glAdSpend(d: DerivedMonth): number {
  return r2(Object.entries(d.expenseCategories)
    .filter(([k]) => /advertis|marketing/i.test(k))
    .reduce((s, [, v]) => s + v, 0));
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
    // A complete QB month supersedes any partial-period stopgap for the SAME month keyed with a
    // different label (e.g. "Jun 2026 (1-20)" from an accountant email). Without this the partial
    // lingers as a second row and the YTD sums BOTH (it read the June loss ~$49K too negative).
    // Protect a full manual override ('accountant_upload'); only drop partial variants.
    await db.execute(sql`
      DELETE FROM monthly_financials WHERE month LIKE ${d.month + " (%"} AND source <> 'accountant_upload'`);
    updated++;
  }

  // ── historical_monthly_sales: the SAME derived months, live-synced ──
  // This table drives the MER trajectory, YoY, Path-to-Profitability, and seasonal
  // models — but until now its only writers were a static array frozen at May 2026
  // (so June, the first profitable month, didn't exist anywhere forward-looking, and
  // May itself was stale: -$48.8K in the array vs -$8.0K reconciled). Upsert every
  // complete GL month with source='qb_sync' — live GL beats the static seed; the
  // manual re-seed endpoint is guarded to never overwrite qb_sync rows.
  let histUpdated = 0;
  let canonicalAd = new Map<string, number>();
  try {
    const canonical = await getCanonicalMonthlySpendByChannel(db, 18);
    // ad_spend = the MER denominator (booked QB marketing + credit-line-era Meta), the
    // same composition the marketing governor gates on — so the Breakeven Scoreboard's
    // monthly MER and the daily gate can never disagree about what marketing costs.
    // Require BOOKED to be present: a Meta-only month (booked null = QB gap) must fall
    // through to the GL fallback, never land as an unflagged "real" ad_spend.
    canonicalAd = new Map(
      canonical
        .filter((m) => m.bookedMarketingTotal != null)
        .map((m) => [m.month, (m.merDenominator ?? m.bookedMarketingTotal) as number]),
    );
  } catch (e) {
    console.warn(`[QB MonthlyFinancials] canonical spend unavailable for historical ad_spend, using GL advertising categories:`, (e as Error)?.message);
  }
  for (const d of derived) {
    if (d.totalIncome <= 0) continue; // same gapped-pull guard as above
    // Same accountant-override rule as the monthly_financials loop: if the accountant
    // manually uploaded this month, the GL derivation must NOT land in EITHER table —
    // otherwise the Exec Summary (monthly_financials, accountant numbers) and the MER
    // trajectory/YoY (this table, GL numbers) would silently disagree on the same month.
    if (manual.has(d.month)) continue;
    const ym = monthLabelToYm(d.month);
    if (!ym) continue;
    const row = buildHistoricalRow(d, canonicalAd.get(ym.ym) ?? glAdSpend(d));
    if (!row) continue;
    await db.execute(sql`
      INSERT INTO historical_monthly_sales
        (year, month, revenue, returns, total_income, cogs, gross_profit,
         ad_spend, total_expenses, net_income, gross_margin_pct, source)
      VALUES (${row.year}, ${row.month}, ${row.revenue}, ${row.returns}, ${row.totalIncome},
              ${row.cogs}, ${row.grossProfit}, ${row.adSpend}, ${row.totalExpenses},
              ${row.netIncome}, ${row.grossMarginPct}, 'qb_sync')
      ON CONFLICT (year, month) DO UPDATE SET
        revenue = EXCLUDED.revenue, returns = EXCLUDED.returns, total_income = EXCLUDED.total_income,
        cogs = EXCLUDED.cogs, gross_profit = EXCLUDED.gross_profit, ad_spend = EXCLUDED.ad_spend,
        total_expenses = EXCLUDED.total_expenses, net_income = EXCLUDED.net_income,
        gross_margin_pct = EXCLUDED.gross_margin_pct, source = 'qb_sync'`);
    histUpdated++;
  }

  console.log(`[QB MonthlyFinancials] synced from GL: ${updated} months updated, ${skipped} manual-override months kept, ${histUpdated} historical_monthly_sales months live-synced`);
  return { updated, skipped };
}
