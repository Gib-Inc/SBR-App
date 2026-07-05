/**
 * Standing FINANCIAL reconciliation guards (Phase 3 of the Jun–Jul 2026 finance overhaul). For
 * each number the app surfaces, compare it to its authoritative QuickBooks / bank source and flag
 * DRIFT — so any future regression self-reports instead of silently going wrong (which is what let
 * "the accountant says everything is wrong" happen in the first place).
 *
 * Read-only. Every value comes from PERSISTED data (the latest QB snapshot, credit_lines,
 * cash_obligations, items, bank_balance_entries) — no live QB call — so it's fast and can run on a
 * schedule / at startup. FLAG-DON'T-FABRICATE: a missing side is 'unavailable', never assumed 0.
 * (Distinct from reconciliation-service.ts, which reconciles marketing-spend snapshots.)
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

export type ReconStatus = "reconciles" | "drift" | "unavailable";
export interface ReconCheck {
  key: string;
  label: string;
  appValue: number | null;
  appSource: string;
  bookValue: number | null;
  bookSource: string;
  diff: number | null;
  diffPct: number | null;
  status: ReconStatus;
  // true = the app INTENTIONALLY uses a different source than this book value (a known/by-design
  // gap we track, not a bug), so it must not count as unexpected drift. false = these SHOULD match
  // and a drift is a real regression to investigate.
  expected: boolean;
  note: string;
}

/**
 * Pure: classify one app-vs-book comparison. DRIFT requires exceeding BOTH a % threshold AND an
 * absolute-dollar floor, so a tiny dollar gap on a small base (or a large % on a trivial base)
 * doesn't false-alarm. Either side null → 'unavailable' (never treat a gap as 0).
 */
export function evalReconciliation(
  app: number | null,
  book: number | null,
  tolerancePct: number,
  toleranceAbs: number,
): { diff: number | null; diffPct: number | null; status: ReconStatus } {
  if (app == null || book == null) return { diff: null, diffPct: null, status: "unavailable" };
  const diff = r2(app - book);
  const diffPct = book !== 0 ? r2((diff / Math.abs(book)) * 100) : diff === 0 ? 0 : null;
  const exceedsAbs = Math.abs(diff) > toleranceAbs;
  const exceedsPct = diffPct == null ? true : Math.abs(diffPct) > tolerancePct;
  return { diff, diffPct, status: exceedsAbs && exceedsPct ? "drift" : "reconciles" };
}

export async function computeFinancialReconciliation(db: DB): Promise<{ checks: ReconCheck[]; driftCount: number; generatedAt: string }> {
  const checks: ReconCheck[] = [];
  const add = (
    key: string, label: string, appValue: number | null, appSource: string,
    bookValue: number | null, bookSource: string, tolPct: number, tolAbs: number, expected: boolean, note: string,
  ) => {
    const e = evalReconciliation(appValue, bookValue, tolPct, tolAbs);
    checks.push({ key, label, appValue, appSource, bookValue, bookSource, diff: e.diff, diffPct: e.diffPct, status: e.status, expected, note });
  };

  // Latest QuickBooks snapshot — the authoritative book values.
  // qb_financial_snapshots has two raw shapes: the live QB capture uses raw.qbBalanceSheet; an
  // accountant upload uses raw.balanceSheet and doesn't set qb_inventory. Coalesce both so the
  // debt + inventory guards stay LIT (not 'unavailable') when the freshest snapshot is an upload.
  const snap = rows(await db.execute(sql`
    select accounts_payable::float8 as ap, cash_on_hand::float8 as cash,
           coalesce(qb_inventory::float8,
                    (raw->'qbBalanceSheet'->>'inventory')::float8,
                    (raw->'balanceSheet'->>'inventory')::float8) as inv,
           coalesce((raw->'qbBalanceSheet'->>'totalLiabilities')::float8,
                    (raw->'balanceSheet'->>'totalLiabilities')::float8) as bs_liab
    from qb_financial_snapshots where captured_at is not null order by captured_at desc limit 1`))[0] || {};

  // 1. CASH — bank-confirmed vs the QB ledger (the ledger lags the live bank, so a gap here is
  //    EXPECTED until the bank balance is re-entered; the guard makes that lag visible, not silent).
  const bank = rows(await db.execute(sql`select available_balance::float8 as v from bank_balance_entries order by as_of desc, created_at desc limit 1`))[0];
  add("cash", "Cash on hand", num(bank?.v), "bank_balance_entries (bank-confirmed)", num(snap.cash), "QuickBooks ledger cash", 8, 3000, true,
    "Bank-confirmed balance vs the QuickBooks ledger. EXPECTED to differ — the QB ledger lags the live bank (that's why the app prefers the bank-confirmed number). Watch it grow: a large/growing gap means the bank balance needs re-entering.");

  // 2. A/P — the app's open pay-order obligations vs the QuickBooks A/P control account.
  const ap = rows(await db.execute(sql`
    select coalesce(sum(amount),0)::float8 as v from cash_obligations
    where source='qb_bill' and is_active and status not in ('paid','covered_by_plan')`))[0];
  add("ap", "Accounts payable", num(ap?.v), "cash_obligations (open qb_bill)", num(snap.ap), "QuickBooks A/P control account", 6, 1500, false,
    "App pay-order payables SHOULD match the QuickBooks A/P control. Drift = a sync gap or bills booked outside A/P.");

  // 3. INVENTORY — the app WAC estimate vs the QuickBooks booked Inventory Asset (QB is the source
  //    of truth; app-WAC over-values by double-counting BOM component cost into finished goods).
  const wac = rows(await db.execute(sql`
    select round(sum((case when type='finished_product' then coalesce(hildale_qty,0)+coalesce(pivot_qty,0)
                           else coalesce(current_stock,0) end)
                     * coalesce(wac_unit_cost, default_purchase_cost, 0))::numeric, 2)::float8 as v
    from items`))[0];
  add("inventory", "Inventory value", num(wac?.v), "app WAC (finished + component)", num(snap.inv), "QuickBooks Inventory Asset", 12, 5000, true,
    "EXPECTED to differ — the app WAC over-values (double-counts BOM component cost into finished goods), which is why the app DISPLAYS the QuickBooks figure. Tracks the known WAC gap; closing it needs the per-source WAC rework.");

  // 4. FINANCING DEBT — active credit_lines vs QB liabilities NET of A/P (approximate: QB liabilities
  //    also include sales tax / payroll / deferred revenue, which credit_lines intentionally excludes).
  const cl = rows(await db.execute(sql`select coalesce(sum(balance),0)::float8 as v from credit_lines where is_active and balance > 0`))[0];
  const liab = num(snap.bs_liab);
  const apBook = num(snap.ap);
  const bookDebt = liab != null && apBook != null ? r2(liab - apBook) : null;
  add("debt", "Financing debt", num(cl?.v), "credit_lines (active balances)", bookDebt, "QB liabilities − A/P (approx)", 10, 40000, false,
    "App financing debt vs QuickBooks liabilities net of A/P. Approximate (QB liabilities also carry taxes/deferred), so a modest gap is normal; a large drift flags stale facility balances.");

  // 5. GOOGLE AD-SPEND CONTINUITY (P2 #24) — trailing 30d vs the prior 30d at the SINGLE
  //    authoritative grain (_windsor when present, else ACCOUNT — never both; the grain-fanout
  //    double-count is exactly what this guards against re-emerging). A dead Windsor feed or a
  //    re-introduced multi-grain sum shows up as a collapse/spike vs the prior window.
  const gWin = rows(await db.execute(sql`
    with grain as (
      select case when exists (select 1 from ad_metrics_daily
                               where platform ilike '%google%' and sku='_windsor'
                                 and date >= current_date - 60)
                  then '_windsor' else 'ACCOUNT' end as g)
    select
      coalesce(sum(spend) filter (where date >= current_date - 30), 0)::float8 as cur,
      coalesce(sum(spend) filter (where date >= current_date - 60 and date < current_date - 30), 0)::float8 as prior
    from ad_metrics_daily, grain
    where platform ilike '%google%' and sku = grain.g`))[0];
  add("google_spend_feed", "Google ad-spend continuity (30d vs prior 30d)",
    num(gWin?.cur), "ad_metrics_daily single-grain, trailing 30d",
    num(gWin?.prior), "same source, prior 30d window", 60, 3000, false,
    "The Google feed's own recent history is the reference. A collapse means the Windsor sync died (the Meta failure mode); a spike means the grain-fanout double-count is back or spend genuinely jumped — either way, look before trusting ROAS/MER.");

  // 6. META AD-SPEND CONTINUITY (P2 #24) — same guard for the compliant tracker snapshots
  //    (Meta's ONLY canonical source post-May-2026; its API sync already died once, silently,
  //    on Jun 9). Overlap-weighted so multi-week snapshots allocate to the window correctly.
  const mWin = rows(await db.execute(sql`
    select
      coalesce(sum(spend * greatest(0, least(period_end, current_date) - greatest(period_start, current_date - 30) + 1)::float8
                          / nullif(period_end - period_start + 1, 0)), 0)::float8 as cur,
      coalesce(sum(spend * greatest(0, least(period_end, current_date - 31) - greatest(period_start, current_date - 60) + 1)::float8
                          / nullif(period_end - period_start + 1, 0)), 0)::float8 as prior
    from marketing_spend_snapshots
    where platform ilike '%meta%' and coalesce(superseded, false) = false
      and period_start is not null and period_end is not null`))[0];
  add("meta_spend_feed", "Meta ad-spend continuity (30d vs prior 30d)",
    num(mWin?.cur), "marketing_spend_snapshots (compliant tracker), trailing 30d",
    num(mWin?.prior), "same source, prior 30d window", 60, 3000, false,
    "Meta's canonical source is the manually-uploaded compliant tracker — if uploads stop, canonical Meta silently reads 0 and MER inflates. A collapse here = upload the current Meta report before trusting the Governor.");

  // 7. MONTHLY REVENUE vs QUICKBOOKS (P2 #24) — the prior CLOSED month's order-ledger revenue vs
  //    the QB-recognized figure. The Feb/Mar backfill read ~1.9x QB and nothing flagged it; this
  //    makes any re-backfill (or a dead order sync) self-report within a month.
  const rev = rows(await db.execute(sql`
    select
      (select coalesce(sum(total_amount), 0) from sales_orders
        where order_date >= date_trunc('month', current_date - interval '1 month')
          and order_date < date_trunc('month', current_date)
          and upper(coalesce(status,'')) not in ('CANCELLED','REFUNDED'))::float8 as app_rev,
      (select revenue from historical_monthly_sales
        where year = extract(year from current_date - interval '1 month')::int
          and month = extract(month from current_date - interval '1 month')::int)::float8 as qb_rev`))[0];
  add("monthly_revenue", "Prior-month revenue (orders vs QuickBooks)",
    num(rev?.app_rev), "sales_orders (orderDate month sum)",
    num(rev?.qb_rev), "historical_monthly_sales (QB recognized)", 20, 30000, true,
    "Order-ledger gross (tax-inclusive) vs QB recognized revenue — EXPECTED to differ ~10-15% (tax + timing). What this catches: a backfill re-run (order side ~2x QB, the Feb/Mar failure) or a dead order sync (order side far UNDER QB).");

  // Only UNEXPECTED drift counts as a health problem — the expected/by-design gaps (cash lag,
  // WAC over-valuation) are tracked but shouldn't read as a regression.
  const driftCount = checks.filter((c) => c.status === "drift" && !c.expected).length;
  return { checks, driftCount, generatedAt: new Date().toISOString() };
}
