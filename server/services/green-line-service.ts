/**
 * Green Line — cost & debt analytics (read-only, recommend-only):
 *   - opex-creep monitor: operating expense as % of net sales, by month
 *   - spend-leak detector: vendors by share of opex + rising-faster-than-revenue
 *   - debt-avalanche planner: facilities ranked by true cost (tier), payoff order
 *
 * Account classification mirrors the P&L: names starting "1 -/2 -/3 -" are sales,
 * "Cost of Goods Sold" is COGS, everything else is operating expense.
 */
import { sql } from "drizzle-orm";
import { debtTier, type Tier } from "./cash-flow-service";

type DB = any;
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

export type Severity = "HEALTHY" | "WARNING" | "CRITICAL";

// ── opex creep ──────────────────────────────────────────────────────────────
/** Opex as % of net sales: >=90 CRITICAL (opex alone eats the top line), >=75 WARNING. Pure. */
export function opexStatus(pct: number): Severity {
  return pct >= 90 ? "CRITICAL" : pct >= 75 ? "WARNING" : "HEALTHY";
}

export interface OpexMonth { month: string; netSales: number; opex: number; opexPct: number; status: Severity; }

export async function computeOpexCreep(db: DB, sinceYmd = "2026-01-01"): Promise<{
  months: OpexMonth[]; latest: OpexMonth | null; monthsOver90: number;
}> {
  const rs = rows(await db.execute(sql`
    with c as (
      select to_char(date_trunc('month', txn_date),'YYYY-MM') as ym, amount,
        case when account_name ~ '^[123] -' then 'sales'
             when account_name = 'Cost of Goods Sold' then 'cogs' else 'opex' end as cls
      from qb_pl_detail where txn_date >= ${sinceYmd}::date)
    select ym,
      sum(amount) filter (where cls='sales') as net_sales,
      sum(amount) filter (where cls='opex')  as opex
    from c group by ym order by ym`));
  const months: OpexMonth[] = rs.map((rr: any) => {
    const netSales = num(rr.net_sales);
    const opex = num(rr.opex);
    const pct = netSales > 0 ? r1((opex / netSales) * 100) : 0;
    return { month: rr.ym, netSales: r0(netSales), opex: r0(opex), opexPct: pct, status: opexStatus(pct) };
  });
  return {
    months,
    latest: months[months.length - 1] ?? null,
    monthsOver90: months.filter((m) => m.opexPct >= 90).length,
  };
}

// ── spend-leak detector ─────────────────────────────────────────────────────
export interface VendorSpend {
  vendor: string; spend90: number; pctOfOpex: number;
  spend30: number; prior30: number; growthPct: number | null;
  concentrationFlag: boolean; risingFlag: boolean;
}

export async function computeSpendLeaks(db: DB): Promise<{ vendors: VendorSpend[]; totalOpex90: number }> {
  const totalRow = rows(await db.execute(sql`
    select coalesce(sum(amount),0) as total from qb_pl_detail
    where txn_date >= (current_date - 90) and amount > 0
      and account_name !~ '^[123] -' and account_name <> 'Cost of Goods Sold'`))[0];
  const totalOpex90 = num(totalRow?.total);

  const rs = rows(await db.execute(sql`
    with opex as (
      select coalesce(nullif(vendor_or_payee,''),'(unattributed)') as vendor, txn_date, amount
      from qb_pl_detail
      where amount > 0 and account_name !~ '^[123] -' and account_name <> 'Cost of Goods Sold')
    select vendor,
      coalesce(sum(amount) filter (where txn_date >= current_date-90),0) as spend90,
      coalesce(sum(amount) filter (where txn_date >= current_date-30),0) as spend30,
      coalesce(sum(amount) filter (where txn_date >= current_date-60 and txn_date < current_date-30),0) as prior30
    from opex group by 1
    having coalesce(sum(amount) filter (where txn_date >= current_date-90),0) > 0
    order by spend90 desc limit 12`));

  const vendors: VendorSpend[] = rs.map((rr: any) => {
    const spend90 = num(rr.spend90), spend30 = num(rr.spend30), prior30 = num(rr.prior30);
    const pctOfOpex = totalOpex90 > 0 ? r1((spend90 / totalOpex90) * 100) : 0;
    const growthPct = prior30 > 0 ? r1(((spend30 - prior30) / prior30) * 100) : null;
    return {
      vendor: String(rr.vendor), spend90: r0(spend90), pctOfOpex,
      spend30: r0(spend30), prior30: r0(prior30), growthPct,
      concentrationFlag: pctOfOpex > 15,
      risingFlag: growthPct != null && growthPct > 10,
    };
  });
  return { vendors, totalOpex90: r0(totalOpex90) };
}

// ── debt-avalanche planner ──────────────────────────────────────────────────
const TIER_COST_RANK: Record<Tier, number> = { mca: 0, tier1: 1, tier2: 2, tier3: 3, tier4: 4, hold: 9 };
const TIER_BUCKET: Record<string, string> = {
  mca: "MCA / daily-debit (retire first)", tier2: "SBA / bank term", tier3: "Cards & lines of credit",
};

export interface DebtFacility { name: string; type: string; balance: number; tier: Tier; bucket: string; payoffOrder: number; }

export async function computeDebtAvalanche(db: DB): Promise<{
  facilities: DebtFacility[];
  byBucket: Array<{ bucket: string; tier: Tier; total: number; count: number }>;
  totalDebt: number;
  interestTrend: Array<{ month: string; interest: number }>;
}> {
  const rs = rows(await db.execute(sql`
    select name, type, balance from credit_lines where is_active and balance > 0`));
  const ranked = rs
    .map((rr: any) => {
      const tier = debtTier(String(rr.name || ""), String(rr.type || ""));
      return { name: String(rr.name), type: String(rr.type || ""), balance: num(rr.balance), tier };
    })
    .sort((a, b) => (TIER_COST_RANK[a.tier] - TIER_COST_RANK[b.tier]) || (b.balance - a.balance));

  const facilities: DebtFacility[] = ranked.map((f, i) => ({
    ...f, balance: r0(f.balance), bucket: TIER_BUCKET[f.tier] ?? "Other", payoffOrder: i + 1,
  }));

  const bucketMap = new Map<string, { bucket: string; tier: Tier; total: number; count: number }>();
  for (const f of ranked) {
    const key = f.tier;
    const b = bucketMap.get(key) ?? { bucket: TIER_BUCKET[f.tier] ?? "Other", tier: f.tier, total: 0, count: 0 };
    b.total += f.balance; b.count += 1; bucketMap.set(key, b);
  }
  const byBucket = [...bucketMap.values()]
    .map((b) => ({ ...b, total: r0(b.total) }))
    .sort((a, b) => TIER_COST_RANK[a.tier] - TIER_COST_RANK[b.tier]);

  const trendRows = rows(await db.execute(sql`
    select to_char(date_trunc('month', txn_date),'YYYY-MM') as ym, coalesce(sum(amount),0) as interest
    from qb_pl_detail where account_name = 'Interest, Bank Fees & Service Charges'
      and txn_date >= (current_date - interval '6 months')
    group by 1 order by 1`));
  const interestTrend = trendRows.map((rr: any) => ({ month: String(rr.ym), interest: r0(num(rr.interest)) }));

  return {
    facilities,
    byBucket,
    totalDebt: r0(ranked.reduce((s, f) => s + f.balance, 0)),
    interestTrend,
  };
}
