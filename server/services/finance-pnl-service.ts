/**
 * CIPH.R Budget & P&L — real categorized financials from QuickBooks line items
 * (qb_pl_detail), not the single conflated monthly summary. Powers budget-vs-actual:
 * each category's actual % of net sales vs a target %, the $ over/under, and the gap
 * to breakeven — so the cuts that get SBR profitable are explicit.
 *
 * Targets live in budget_targets (% of net sales, editable). Budget basis is the
 * trailing 3 complete months (smooths the month-to-month % swings); a 6-month P&L
 * trend is returned alongside for context.
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole > 0 ? r2((part / whole) * 100) : null);

export type AcctGroup = "income" | "contra" | "cogs" | "expense";

/** Pure: classify a QuickBooks P&L account into a P&L group. */
export function classifyAccount(name: string): AcctGroup {
  const n = String(name || "").toLowerCase();
  if (/cost of goods|cogs/.test(n)) return "cogs";
  if (/discount|return|refund/.test(n)) return "contra";
  if (/gross sales|net sales|\bincome\b|\brevenue\b/.test(n)) return "income";
  return "expense";
}

export interface PnlMonth {
  month: string; netSales: number; cogs: number; grossProfit: number; grossMarginPct: number | null;
  totalExpenses: number; netIncome: number; netMarginPct: number | null;
}
export interface BudgetCategory {
  account: string; group: AcctGroup; actual: number; monthlyAvg: number; actualPct: number | null;
  targetPct: number | null; targetDollars: number | null; variance: number | null; over: boolean;
}
export interface BudgetScorecard {
  monthly: PnlMonth[];
  basis: { label: string; months: number; netSales: number };
  categories: BudgetCategory[];
  summary: {
    netSales: number; cogs: number; grossProfit: number; grossMarginPct: number | null;
    totalExpenses: number; netIncome: number; netMarginPct: number | null;
    overBudgetTotal: number; toBreakeven: number;
  };
}

/** Roll a set of {account, amount} into P&L aggregates. */
function rollup(items: Array<{ account: string; amount: number }>) {
  let income = 0, contra = 0, cogs = 0, expenses = 0;
  for (const it of items) {
    const g = classifyAccount(it.account);
    if (g === "income") income += it.amount;
    else if (g === "contra") contra += it.amount;     // already negative in QB
    else if (g === "cogs") cogs += it.amount;
    else expenses += it.amount;
  }
  const netSales = r2(income + contra);
  const grossProfit = r2(netSales - cogs);
  const netIncome = r2(grossProfit - expenses);
  return { netSales, cogs: r2(cogs), grossProfit, totalExpenses: r2(expenses), netIncome };
}

export async function getBudgetScorecard(db: DB, monthsBack = 6, basisMonths = 3): Promise<BudgetScorecard> {
  // Per-month, per-account totals for the last `monthsBack` complete months.
  const data = rows(await db.execute(sql`
    SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS month,
           account_name AS account,
           round(sum(amount)::numeric, 2) AS amount
    FROM qb_pl_detail
    WHERE txn_date >= (date_trunc('month', now()) - (${monthsBack} || ' months')::interval)
      AND txn_date <  date_trunc('month', now())
    GROUP BY 1, 2
    ORDER BY 1`)) as Array<{ month: string; account: string; amount: any }>;

  // group by month
  const byMonth = new Map<string, Array<{ account: string; amount: number }>>();
  for (const d of data) {
    const arr = byMonth.get(d.month) ?? [];
    arr.push({ account: d.account, amount: num(d.amount) });
    byMonth.set(d.month, arr);
  }
  const months = Array.from(byMonth.keys()).sort();
  const monthly: PnlMonth[] = months.map((m) => {
    const r = rollup(byMonth.get(m)!);
    return {
      month: m, netSales: r.netSales, cogs: r.cogs, grossProfit: r.grossProfit,
      grossMarginPct: pct(r.grossProfit, r.netSales), totalExpenses: r.totalExpenses,
      netIncome: r.netIncome, netMarginPct: pct(r.netIncome, r.netSales),
    };
  });

  // Budget basis = last `basisMonths` complete months combined.
  const basisMonthKeys = months.slice(-basisMonths);
  const basisItems: Array<{ account: string; amount: number }> = [];
  for (const m of basisMonthKeys) basisItems.push(...byMonth.get(m)!);
  const agg = rollup(basisItems);

  // per-category trailing totals (cogs + expense groups carry budgets)
  const catMap = new Map<string, { amount: number; group: AcctGroup }>();
  for (const it of basisItems) {
    const g = classifyAccount(it.account);
    if (g !== "cogs" && g !== "expense") continue;
    const cur = catMap.get(it.account) ?? { amount: 0, group: g };
    cur.amount += it.amount;
    catMap.set(it.account, cur);
  }

  const targets = rows(await db.execute(sql`SELECT account_name, target_pct, sort_order FROM budget_targets`)) as Array<{ account_name: string; target_pct: any; sort_order: any }>;
  const targetMap = new Map(targets.map((t) => [t.account_name, { pct: num(t.target_pct), sort: num(t.sort_order) }]));

  const n = basisMonthKeys.length || 1;
  const categories: BudgetCategory[] = Array.from(catMap.entries()).map(([account, v]) => {
    const t = targetMap.get(account);
    const targetPct = t ? t.pct : null;
    const targetDollars = targetPct != null ? r2((targetPct / 100) * agg.netSales) : null;
    const variance = targetDollars != null ? r2(v.amount - targetDollars) : null;
    return {
      account, group: v.group, actual: r2(v.amount), monthlyAvg: r2(v.amount / n),
      actualPct: pct(v.amount, agg.netSales), targetPct, targetDollars,
      variance, over: variance != null && variance > 0,
    };
  }).sort((a, b) => {
    const sa = targetMap.get(a.account)?.sort ?? 999;
    const sb = targetMap.get(b.account)?.sort ?? 999;
    return sa - sb || b.actual - a.actual;
  });

  const overBudgetTotal = r2(categories.filter((c) => c.over).reduce((s, c) => s + (c.variance ?? 0), 0));
  const toBreakeven = agg.netIncome < 0 ? r2(-agg.netIncome) : 0;

  return {
    monthly,
    basis: { label: basisMonthKeys.length ? `${basisMonthKeys[0]} – ${basisMonthKeys[basisMonthKeys.length - 1]}` : "—", months: basisMonthKeys.length, netSales: agg.netSales },
    categories,
    summary: {
      netSales: agg.netSales, cogs: agg.cogs, grossProfit: agg.grossProfit, grossMarginPct: pct(agg.grossProfit, agg.netSales),
      totalExpenses: agg.totalExpenses, netIncome: agg.netIncome, netMarginPct: pct(agg.netIncome, agg.netSales),
      overBudgetTotal, toBreakeven,
    },
  };
}

/** Drill-down: vendors behind one account over the trailing basis window. */
export async function getCategoryVendors(db: DB, account: string, monthsBack = 3): Promise<Array<{ vendor: string; amount: number; lines: number }>> {
  const r = rows(await db.execute(sql`
    SELECT COALESCE(vendor_or_payee, '(unlabeled)') AS vendor,
           round(sum(amount)::numeric, 2) AS amount, count(*) AS lines
    FROM qb_pl_detail
    WHERE account_name = ${account}
      AND txn_date >= (date_trunc('month', now()) - (${monthsBack} || ' months')::interval)
      AND txn_date <  date_trunc('month', now())
    GROUP BY 1 ORDER BY abs(sum(amount)) DESC`)) as any[];
  return r.map((x: any) => ({ vendor: x.vendor, amount: r2(num(x.amount)), lines: num(x.lines) }));
}

/** Update a category's target % of net sales (in-app editing). */
export async function setBudgetTarget(db: DB, account: string, targetPct: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO budget_targets (account_name, target_pct, updated_at)
    VALUES (${account}, ${targetPct}, now())
    ON CONFLICT (account_name) DO UPDATE SET target_pct = ${targetPct}, updated_at = now()`);
}
