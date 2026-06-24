/**
 * CIPH.R Forward Budget — a 12-month forward projection off the trailing QuickBooks
 * actuals (qb_pl_detail). Each cost category is projected as either VARIABLE (a % of
 * forecast net sales) or FIXED ($/month). Revenue is forecast from a trailing base with
 * an optional growth rate and per-month manual overrides. Output is net income per month
 * and the month the business turns profitable — the "path to breakeven."
 *
 * Honest classification: two lines that are really owner compensation are pulled out of
 * the accounts they hide in before projecting, so a variable %-of-sales projection never
 * scales Zo's fixed pay with revenue:
 *   - "Lucid Earth LLC" / "Lucid LLC" inside Advertising & Marketing  -> Owner Compensation
 *   - "Gamerzdojo Foundation" inside Charitable Contributions          -> Owner Compensation
 *
 * Assumptions persist in projection_assumptions (per category) and projection_settings
 * (revenue base/growth/overrides); both are created idempotently at startup.
 */
import { sql } from "drizzle-orm";
import { classifyAccount, type AcctGroup } from "./finance-pnl-service";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole > 0 ? r2((part / whole) * 100) : null);

export const OWNER_COMP = "Owner Compensation (Zo)";

/** Vendor-level reclassifications applied before projecting (vendor substring match). */
export const RECLASSIFY: Array<{ vendorLike: string; to: string }> = [
  { vendorLike: "lucid", to: OWNER_COMP },   // Lucid Earth LLC / Lucid LLC (in Advertising & Marketing)
  { vendorLike: "gamerz", to: OWNER_COMP },  // Gamerzdojo Foundation (in Charitable Contributions)
  { vendorLike: "dojo", to: OWNER_COMP },
];

export type Driver = "variable" | "fixed";

/** Pure: add k calendar months to a "YYYY-MM" string (no Date, deterministic). */
export function addMonths(ym: string, k: number): string {
  const [y, m] = String(ym).split("-").map(Number);
  const idx = y * 12 + (m - 1) + k;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

/** Pure: default cost driver for an account. COGS and the demand-linked spend scale with
 *  sales; everything else (payroll, rent, owner comp, insurance, subscriptions) is fixed. */
export function defaultDriver(account: string, group: AcctGroup): Driver {
  if (group === "cogs") return "variable";
  const n = String(account || "").toLowerCase();
  if (/advertis|marketing|shipping|freight|delivery|merchant|royalt|transaction|processing fee/.test(n)) return "variable";
  return "fixed";
}

export interface ForecastMonth { month: string; netSales: number; overridden: boolean; }

/** Pure: forecast net sales forward `months` months from a base, compounding `growthPct`
 *  per month, with optional explicit per-month overrides. */
export function buildRevenueForecast(opts: {
  base: number; startMonth: string; months: number; growthPct: number; overrides?: Record<string, number>;
}): ForecastMonth[] {
  const g = (opts.growthPct || 0) / 100;
  const out: ForecastMonth[] = [];
  for (let k = 0; k < opts.months; k++) {
    const month = addMonths(opts.startMonth, k);
    const ov = opts.overrides ? opts.overrides[month] : undefined;
    out.push({
      month,
      netSales: ov != null ? r2(ov) : r2(opts.base * Math.pow(1 + g, k)),
      overridden: ov != null,
    });
  }
  return out;
}

export interface ProjCategory {
  account: string; group: Exclude<AcctGroup, "income" | "contra">;
  driver: Driver; ratePct: number | null; fixedAmount: number | null;
  source: "default" | "override";
  trailingTotal: number; trailingMonthlyAvg: number; trailingPctOfSales: number | null;
  monthly: number[]; annualTotal: number;
}
export interface ProjMonth {
  month: string; netSales: number; cogs: number; expenses: number; netIncome: number; cumulativeNetIncome: number;
}
export interface ProjectionResult {
  startMonth: string; months: number; baseMethod: string; growthPct: number; revenueBase: number;
  forecast: ProjMonth[];
  categories: ProjCategory[];
  reclassification: Array<{ to: string; vendorLike: string; trailingAmount: number }>;
  summary: {
    annualRevenue: number; annualCogs: number; annualExpenses: number; annualNetIncome: number;
    avgMonthlyNetIncome: number; netMarginPct: number | null;
    firstProfitableMonth: string | null; cumulativeBreakevenMonth: string | null;
    startingMonthlyNetIncome: number; endingMonthlyNetIncome: number;
  };
}

export interface ResolvedCategory {
  account: string; group: Exclude<AcctGroup, "income" | "contra">;
  driver: Driver; ratePct: number | null; fixedAmount: number | null; source: "default" | "override";
  trailingTotal: number; trailingMonthlyAvg: number; trailingPctOfSales: number | null;
}

/** Pure core: given the revenue forecast and the resolved category assumptions, project
 *  every category forward and roll up net income + the breakeven path. */
export function assembleProjection(opts: {
  startMonth: string; months: number; baseMethod: string; growthPct: number; revenueBase: number;
  forecast: ForecastMonth[];
  categories: ResolvedCategory[];
  reclassification: Array<{ to: string; vendorLike: string; trailingAmount: number }>;
}): ProjectionResult {
  const cats: ProjCategory[] = opts.categories.map((c) => {
    const monthly = opts.forecast.map((f) =>
      c.driver === "variable" ? r2(((c.ratePct ?? 0) / 100) * f.netSales) : r2(c.fixedAmount ?? 0)
    );
    return { ...c, monthly, annualTotal: r2(monthly.reduce((s, x) => s + x, 0)) };
  });

  const forecast: ProjMonth[] = [];
  let cum = 0;
  opts.forecast.forEach((f, i) => {
    const cogs = r2(cats.filter((c) => c.group === "cogs").reduce((s, c) => s + c.monthly[i], 0));
    const expenses = r2(cats.filter((c) => c.group === "expense").reduce((s, c) => s + c.monthly[i], 0));
    const netIncome = r2(f.netSales - cogs - expenses);
    cum = r2(cum + netIncome);
    forecast.push({ month: f.month, netSales: f.netSales, cogs, expenses, netIncome, cumulativeNetIncome: cum });
  });

  const annualRevenue = r2(forecast.reduce((s, m) => s + m.netSales, 0));
  const annualCogs = r2(forecast.reduce((s, m) => s + m.cogs, 0));
  const annualExpenses = r2(forecast.reduce((s, m) => s + m.expenses, 0));
  const annualNetIncome = r2(annualRevenue - annualCogs - annualExpenses);
  const months = forecast.length || 1;

  return {
    startMonth: opts.startMonth, months: opts.months, baseMethod: opts.baseMethod,
    growthPct: opts.growthPct, revenueBase: r2(opts.revenueBase),
    forecast, categories: cats, reclassification: opts.reclassification,
    summary: {
      annualRevenue, annualCogs, annualExpenses, annualNetIncome,
      avgMonthlyNetIncome: r2(annualNetIncome / months),
      netMarginPct: pct(annualNetIncome, annualRevenue),
      firstProfitableMonth: forecast.find((m) => m.netIncome >= 0)?.month ?? null,
      cumulativeBreakevenMonth: forecast.find((m) => m.cumulativeNetIncome >= 0)?.month ?? null,
      startingMonthlyNetIncome: forecast[0]?.netIncome ?? 0,
      endingMonthlyNetIncome: forecast[forecast.length - 1]?.netIncome ?? 0,
    },
  };
}

/** Build the forward projection from QuickBooks actuals + saved assumptions. */
export async function getProjection(db: DB, opts: {
  months?: number; monthsBack?: number; growthPct?: number; baseMethod?: string;
} = {}): Promise<ProjectionResult> {
  const months = opts.months ?? 12;
  const monthsBack = opts.monthsBack ?? 12;

  // 1) trailing monthly net sales
  const nsRows = rows(await db.execute(sql`
    SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS month,
           round(sum(amount)::numeric, 2) AS net_sales
    FROM qb_pl_detail
    WHERE txn_date >= (date_trunc('month', now()) - (${monthsBack} || ' months')::interval)
      AND txn_date <  date_trunc('month', now())
      AND (account_name ILIKE '%gross sales%' OR account_name ILIKE '%discount%'
        OR account_name ILIKE '%return%' OR account_name ILIKE '%refund%')
    GROUP BY 1 ORDER BY 1`)) as Array<{ month: string; net_sales: any }>;
  const nsByMonth = new Map(nsRows.map((r) => [r.month, num(r.net_sales)]));
  const salesMonths = nsRows.map((r) => r.month).sort();
  const trailingNetSales = r2(nsRows.reduce((s, r) => s + num(r.net_sales), 0));

  // 2) trailing per-account cost totals (cogs + expense)
  const acctRows = rows(await db.execute(sql`
    SELECT account_name AS account, round(sum(amount)::numeric, 2) AS amount
    FROM qb_pl_detail
    WHERE txn_date >= (date_trunc('month', now()) - (${monthsBack} || ' months')::interval)
      AND txn_date <  date_trunc('month', now())
      AND account_name NOT ILIKE '%gross sales%' AND account_name NOT ILIKE '%discount%'
      AND account_name NOT ILIKE '%return%' AND account_name NOT ILIKE '%refund%'
    GROUP BY 1`)) as Array<{ account: string; amount: any }>;

  // 3) reclassify vendor totals to pull out (subtract from source, add to synthetic comp)
  const recRows = rows(await db.execute(sql`
    SELECT account_name AS account, COALESCE(vendor_or_payee,'') AS vendor,
           round(sum(amount)::numeric, 2) AS amount
    FROM qb_pl_detail
    WHERE txn_date >= (date_trunc('month', now()) - (${monthsBack} || ' months')::interval)
      AND txn_date <  date_trunc('month', now())
      AND (vendor_or_payee ILIKE '%lucid%' OR vendor_or_payee ILIKE '%gamerz%' OR vendor_or_payee ILIKE '%dojo%')
    GROUP BY 1, 2`)) as Array<{ account: string; vendor: string; amount: any }>;

  // category totals keyed by display account, classified cogs/expense
  const catTotal = new Map<string, { amount: number; group: Exclude<AcctGroup, "income" | "contra"> }>();
  const add = (account: string, amount: number, group: Exclude<AcctGroup, "income" | "contra">) => {
    const cur = catTotal.get(account) ?? { amount: 0, group };
    cur.amount = r2(cur.amount + amount);
    catTotal.set(account, cur);
  };
  for (const a of acctRows) {
    const g = classifyAccount(a.account);
    if (g === "income" || g === "contra") continue;
    add(a.account, num(a.amount), g);
  }
  // pull reclassified vendor dollars out of their source account into Owner Compensation
  const reclassification = new Map<string, number>();
  for (const rec of recRows) {
    const v = String(rec.vendor || "").toLowerCase();
    const rule = RECLASSIFY.find((x) => v.includes(x.vendorLike));
    if (!rule) continue;
    const amt = num(rec.amount);
    add(rec.account, -amt, classifyAccount(rec.account) as Exclude<AcctGroup, "income" | "contra">);
    add(rule.to, amt, "expense");
    reclassification.set(rule.vendorLike, r2((reclassification.get(rule.vendorLike) ?? 0) + amt));
  }
  // drop any category that netted to ~0 after reclassification
  for (const [k, v] of Array.from(catTotal.entries())) if (Math.abs(v.amount) < 0.5) catTotal.delete(k);

  // 4) saved assumptions + settings
  const asmRows = rows(await db.execute(sql`SELECT account_name, driver, rate_pct, fixed_amount FROM projection_assumptions`)) as Array<{ account_name: string; driver: any; rate_pct: any; fixed_amount: any }>;
  const asmMap = new Map(asmRows.map((a) => [a.account_name, a]));
  const setRow = rows(await db.execute(sql`SELECT base_method, growth_pct, overrides FROM projection_settings WHERE id = 1`))[0] as { base_method?: string; growth_pct?: any; overrides?: any } | undefined;

  const baseMethod = opts.baseMethod ?? setRow?.base_method ?? "trailing3";
  const growthPct = opts.growthPct ?? num(setRow?.growth_pct);
  let overrides: Record<string, number> = {};
  if (setRow?.overrides) {
    try { overrides = typeof setRow.overrides === "string" ? JSON.parse(setRow.overrides) : setRow.overrides; } catch { overrides = {}; }
  }

  // revenue base per method (default trailing-3-month average)
  const lastN = (n: number) => salesMonths.slice(-n).map((m) => nsByMonth.get(m) ?? 0);
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const revenueBase =
    baseMethod === "lastMonth" ? (lastN(1)[0] ?? 0)
    : baseMethod === "trailing6" ? avg(lastN(6))
    : avg(lastN(3));

  const latestActual = salesMonths[salesMonths.length - 1];
  const startMonth = latestActual ? addMonths(latestActual, 1) : "1970-01";
  const forecast = buildRevenueForecast({ base: revenueBase, startMonth, months, growthPct, overrides });
  const monthsCount = salesMonths.length || 1;

  // 5) resolve each category's driver + rate/fixed (default from history, overridden by saved assumptions)
  const resolved: ResolvedCategory[] = Array.from(catTotal.entries()).map(([account, v]): ResolvedCategory => {
    const trailingTotal = r2(v.amount);
    const trailingMonthlyAvg = r2(trailingTotal / monthsCount);
    const trailingPctOfSales = pct(trailingTotal, trailingNetSales);
    const saved = asmMap.get(account);
    const driver: Driver = saved?.driver === "variable" || saved?.driver === "fixed" ? saved.driver : defaultDriver(account, v.group);
    const ratePct = saved?.rate_pct != null ? num(saved.rate_pct) : (trailingPctOfSales ?? 0);
    const fixedAmount = saved?.fixed_amount != null ? num(saved.fixed_amount) : trailingMonthlyAvg;
    return {
      account, group: v.group, driver,
      ratePct: driver === "variable" ? r2(ratePct) : null,
      fixedAmount: driver === "fixed" ? r2(fixedAmount) : null,
      source: saved ? "override" : "default",
      trailingTotal, trailingMonthlyAvg, trailingPctOfSales,
    };
  }).sort((a, b) => b.trailingTotal - a.trailingTotal);

  return assembleProjection({
    startMonth, months, baseMethod, growthPct, revenueBase,
    forecast,
    categories: resolved,
    reclassification: RECLASSIFY
      .filter((x) => reclassification.has(x.vendorLike))
      .map((x) => ({ to: x.to, vendorLike: x.vendorLike, trailingAmount: r2(reclassification.get(x.vendorLike) ?? 0) })),
  });
}

/** Save a per-category assumption override (driver + rate or fixed amount). */
export async function setProjectionAssumption(db: DB, account: string, a: { driver: Driver; ratePct?: number | null; fixedAmount?: number | null }): Promise<void> {
  await db.execute(sql`
    INSERT INTO projection_assumptions (account_name, driver, rate_pct, fixed_amount, updated_at)
    VALUES (${account}, ${a.driver}, ${a.ratePct ?? null}, ${a.fixedAmount ?? null}, now())
    ON CONFLICT (account_name) DO UPDATE SET
      driver = ${a.driver}, rate_pct = ${a.ratePct ?? null}, fixed_amount = ${a.fixedAmount ?? null}, updated_at = now()`);
}

/** Save the revenue forecast settings (base method, monthly growth %, per-month overrides). */
export async function setProjectionSettings(db: DB, s: { baseMethod?: string; growthPct?: number; overrides?: Record<string, number> }): Promise<void> {
  await db.execute(sql`
    INSERT INTO projection_settings (id, base_method, growth_pct, overrides, updated_at)
    VALUES (1, ${s.baseMethod ?? "trailing3"}, ${s.growthPct ?? 0}, ${JSON.stringify(s.overrides ?? {})}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET
      base_method = COALESCE(${s.baseMethod ?? null}, projection_settings.base_method),
      growth_pct  = COALESCE(${s.growthPct ?? null}, projection_settings.growth_pct),
      overrides   = COALESCE(${s.overrides ? JSON.stringify(s.overrides) : null}::jsonb, projection_settings.overrides),
      updated_at  = now()`);
}
