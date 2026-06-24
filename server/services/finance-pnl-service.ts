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
export type BudgetStatus = "open" | "in_progress" | "structural" | "fixed";
export interface BudgetCategory {
  account: string; group: AcctGroup; actual: number; monthlyAvg: number; actualPct: number | null;
  targetPct: number | null; targetDollars: number | null; variance: number | null; over: boolean;
  status: BudgetStatus; note: string | null;
}
export interface SavingsOpportunity {
  category: string; currentPct: number | null; targetPct: number | null;
  monthlyOver: number; annualOver: number; status: BudgetStatus; note: string | null;
}
export interface BudgetScorecard {
  monthly: PnlMonth[];
  basis: { label: string; months: number; netSales: number };
  categories: BudgetCategory[];
  opportunities: SavingsOpportunity[];
  summary: {
    netSales: number; cogs: number; grossProfit: number; grossMarginPct: number | null;
    totalExpenses: number; netIncome: number; netMarginPct: number | null;
    overBudgetTotal: number; toBreakeven: number;
    annualizedNetIncome: number; potentialAnnualSavings: number; pctOfLossClosed: number | null;
    actionableAnnualSavings: number; inProgressAnnualSavings: number;
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

  // Reclassify owner compensation out of the accounts it hides in (consistent with the forward
  // projection): "Lucid Earth LLC" (Advertising & Marketing) + "Gamerzdojo Foundation"
  // (Charitable Contributions) are the marketing manager's pay, not marketing/charity. Move them
  // to an Owner Compensation line so the budget-vs-actual on those lines is honest.
  const OWNER_COMP = "Owner Compensation (Zo)";
  const reclass = rows(await db.execute(sql`
    SELECT account_name AS account, round(sum(amount)::numeric, 2) AS amount
    FROM qb_pl_detail
    WHERE txn_date >= (date_trunc('month', now()) - (${basisMonths} || ' months')::interval)
      AND txn_date <  date_trunc('month', now())
      AND (vendor_or_payee ILIKE '%lucid%' OR vendor_or_payee ILIKE '%gamerz%' OR vendor_or_payee ILIKE '%dojo%')
    GROUP BY 1`)) as Array<{ account: string; amount: any }>;
  let ownerComp = 0;
  for (const rc of reclass) {
    const amt = num(rc.amount);
    if (amt === 0) continue;
    const cur = catMap.get(rc.account);
    if (cur) cur.amount = r2(cur.amount - amt);   // pull comp out of A&M / Charitable
    ownerComp += amt;
  }
  if (ownerComp > 0.5) catMap.set(OWNER_COMP, { amount: r2(ownerComp), group: "expense" });
  for (const [k, v] of Array.from(catMap.entries())) if (Math.abs(v.amount) < 0.5) catMap.delete(k);

  const targets = rows(await db.execute(sql`SELECT account_name, target_pct, sort_order, COALESCE(status,'open') AS status, note FROM budget_targets`)) as Array<{ account_name: string; target_pct: any; sort_order: any; status: any; note: any }>;
  const targetMap = new Map(targets.map((t) => [t.account_name, { pct: num(t.target_pct), sort: num(t.sort_order), status: (t.status || "open") as BudgetStatus, note: t.note ?? null }]));

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
      status: t?.status ?? "open", note: t?.note ?? null,
    };
  }).sort((a, b) => {
    const sa = targetMap.get(a.account)?.sort ?? 999;
    const sb = targetMap.get(b.account)?.sort ?? 999;
    return sa - sb || b.actual - a.actual;
  });

  const overBudgetTotal = r2(categories.filter((c) => c.over).reduce((s, c) => s + (c.variance ?? 0), 0));
  const toBreakeven = agg.netIncome < 0 ? r2(-agg.netIncome) : 0;

  // Ranked savings opportunities: every over-budget category, annualized — the
  // "where to cut to save the company" list, sorted by $ impact.
  const annualize = 12 / (basisMonthKeys.length || 1);
  const opportunities: SavingsOpportunity[] = categories
    .filter((c) => c.over && c.variance != null)
    .map((c) => ({ category: c.account, currentPct: c.actualPct, targetPct: c.targetPct, monthlyOver: r2((c.variance ?? 0) / n), annualOver: r2((c.variance ?? 0) * annualize), status: c.status, note: c.note }))
    .sort((a, b) => b.annualOver - a.annualOver);
  const potentialAnnualSavings = r2(opportunities.reduce((s, o) => s + o.annualOver, 0));
  // "Actionable now" = open lines only (exclude fixed/structural/in-progress already being worked).
  const actionableAnnualSavings = r2(opportunities.filter((o) => o.status === "open").reduce((s, o) => s + o.annualOver, 0));
  const inProgressAnnualSavings = r2(opportunities.filter((o) => o.status === "in_progress").reduce((s, o) => s + o.annualOver, 0));
  const annualizedNetIncome = r2(agg.netIncome * annualize);
  const pctOfLossClosed = annualizedNetIncome < 0 ? r2((potentialAnnualSavings / -annualizedNetIncome) * 100) : null;

  return {
    monthly,
    basis: { label: basisMonthKeys.length ? `${basisMonthKeys[0]} – ${basisMonthKeys[basisMonthKeys.length - 1]}` : "—", months: basisMonthKeys.length, netSales: agg.netSales },
    categories,
    opportunities,
    summary: {
      netSales: agg.netSales, cogs: agg.cogs, grossProfit: agg.grossProfit, grossMarginPct: pct(agg.grossProfit, agg.netSales),
      totalExpenses: agg.totalExpenses, netIncome: agg.netIncome, netMarginPct: pct(agg.netIncome, agg.netSales),
      overBudgetTotal, toBreakeven, annualizedNetIncome, potentialAnnualSavings, pctOfLossClosed,
      actionableAnnualSavings, inProgressAnnualSavings,
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

export interface TopVendor { vendor: string; amount: number; monthlyAvg: number; pctOfNetSales: number | null; topAccount: string | null; lines: number; }
export interface VendorView {
  basis: { months: number };
  netSales: number;
  vendors: TopVendor[];
  fulfillment: { vendor: string; amount: number; monthlyAvg: number; orders: number; costPerOrder: number | null; pctOfNetSales: number | null } | null;
}

/** Top spend vendors over the trailing window + a Pyvott fulfillment spotlight (cost/order). */
export async function getTopVendors(db: DB, monthsBack = 3, limit = 15): Promise<VendorView> {
  const since = sql`(date_trunc('month', now()) - (${monthsBack} || ' months')::interval)`;
  const until = sql`date_trunc('month', now())`;
  const notIncome = sql`account_name NOT ILIKE '%gross sales%' AND account_name NOT ILIKE '%discount%' AND account_name NOT ILIKE '%return%' AND account_name NOT ILIKE '%refund%'`;

  const vrows = rows(await db.execute(sql`
    SELECT COALESCE(vendor_or_payee, '(unlabeled)') AS vendor,
           round(sum(amount)::numeric, 2) AS amount, count(*) AS lines,
           (array_agg(account_name ORDER BY abs(amount) DESC))[1] AS top_account
    FROM qb_pl_detail
    WHERE txn_date >= ${since} AND txn_date < ${until} AND ${notIncome}
    GROUP BY 1 HAVING sum(amount) > 0
    ORDER BY sum(amount) DESC LIMIT ${limit}`)) as any[];

  const nsRow = rows(await db.execute(sql`
    SELECT round(sum(amount)::numeric, 2) AS net_sales FROM qb_pl_detail
    WHERE txn_date >= ${since} AND txn_date < ${until}
      AND (account_name ILIKE '%gross sales%' OR account_name ILIKE '%discount%' OR account_name ILIKE '%return%' OR account_name ILIKE '%refund%')`))[0];
  const netSales = r2(num(nsRow?.net_sales));

  const vendors: TopVendor[] = vrows.map((v: any) => ({
    vendor: v.vendor, amount: r2(num(v.amount)), monthlyAvg: r2(num(v.amount) / (monthsBack || 1)),
    pctOfNetSales: pct(num(v.amount), netSales), topAccount: v.top_account ?? null, lines: num(v.lines),
  }));

  // Pyvott fulfillment spotlight — cost per order over the same window.
  const pyvRow = rows(await db.execute(sql`
    SELECT round(sum(amount)::numeric, 2) AS amount FROM qb_pl_detail
    WHERE txn_date >= ${since} AND txn_date < ${until} AND vendor_or_payee ILIKE '%pyvott%'`))[0];
  const pyvAmount = r2(num(pyvRow?.amount));
  let fulfillment: VendorView["fulfillment"] = null;
  if (pyvAmount > 0) {
    const ordRow = rows(await db.execute(sql`
      SELECT count(*)::int AS orders FROM sales_orders
      WHERE COALESCE(status,'') NOT ILIKE 'cancel%'
        AND order_date >= ${since} AND order_date < ${until}`))[0];
    const orders = num(ordRow?.orders);
    fulfillment = {
      vendor: "Pyvott", amount: pyvAmount, monthlyAvg: r2(pyvAmount / (monthsBack || 1)),
      orders, costPerOrder: orders > 0 ? r2(pyvAmount / orders) : null, pctOfNetSales: pct(pyvAmount, netSales),
    };
  }

  return { basis: { months: monthsBack }, netSales, vendors, fulfillment };
}

/** Update a category's target % of net sales (in-app editing). */
export async function setBudgetTarget(db: DB, account: string, targetPct: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO budget_targets (account_name, target_pct, updated_at)
    VALUES (${account}, ${targetPct}, now())
    ON CONFLICT (account_name) DO UPDATE SET target_pct = ${targetPct}, updated_at = now()`);
}
