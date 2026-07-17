/**
 * Shared deduped-GL reader — THE one way to read revenue off qb_pl_detail.
 *
 * WHY: the bookkeeper double-posted QBO income to a primary tree (Gross Sales /
 * Discounts / Returns and Refunds) AND a mirror tree ('1/2/3 - ... (Match Shopify
 * Total Sales Breakdown)'). Mirrors usually match, but corrections were sometimes
 * posted to ONE side only (5/31 -$63,200.11 tree-only; 6/20 -$42,958.75 tree-only;
 * late-June deposits parent-only after the tree was abandoned for A2X on 6/24).
 * Skipping the whole tree (classifyAccount's 'duplicate' path) drops the one-sided
 * corrections and inflates revenue (May 2026 read $226,674.75 instead of the true
 * $163,474.64). The dedup rule, verified against 13 months of prod GL: map tree
 * names onto their primary account, pair lines per (month, account, txn_date,
 * amount) across the two sides, and count each key greatest(parent_n, tree_n)
 * times — mirrored pairs count once, one-sided lines count in full. The pair key
 * deliberately omits txn_type (a Deposit can mirror as a Journal Entry) and
 * doc_number (NULL on all mirror lines). qb_pl_detail has NO QBO txn id, so this
 * is the tightest honest key.
 *
 * Safety: unknown future '%Match Shopify%' accounts stay unmapped here — they come
 * back under their own name, classifyAccount marks them 'duplicate', and every
 * consumer's rollup skips them. Consumers must keep classifying via classifyAccount.
 * Non-family accounts pass through untouched (count = parent_n = raw sum), so the
 * expense side is bit-identical to a raw read.
 *
 * All windows use the Mountain-time clock — txn_date is the business's local
 * calendar date, so month/day boundaries must be America/Denver, not server UTC.
 */
import { sql, type SQL } from "drizzle-orm";

type DB = any;
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

const MT_NOW = sql`(now() AT TIME ZONE 'America/Denver')`;

/** Mirror-tree account → primary account. Exhaustive over the 13 months of prod GL. */
const TREE_TO_PRIMARY: Record<string, string> = {
  "1 - Gross Sales (Match Shopify Total Sales Breakdown)": "Gross Sales",
  "2 - Discounts (Match Shopify Total Sales Breakdown)": "Discounts",
  "3 - Returns/Refunds (Match Shopify Total Sales Breakdown) + Amazon": "Returns and Refunds",
};

/** True for any account in the mirror tree (mapped or a future unmapped one). */
export function isMirrorTreeAccount(name: string): boolean {
  return /match shopify total sales breakdown/i.test(String(name || ""));
}

/** Primary income account → its mirror-tree alias (for line-grain drill-down dedup). */
export const PRIMARY_TO_TREE: Record<string, string> = Object.fromEntries(
  Object.entries(TREE_TO_PRIMARY).map(([tree, primary]) => [primary, tree]),
);

/**
 * VENDOR-GRAIN POLICY: vendor analytics keep the parent-only behavior (skip the
 * mirror tree entirely — classifyAccount 'duplicate' in JS, or this fragment in
 * SQL) for two reasons verified against prod GL: (a) every vendor surface in the
 * app (top-vendors, spend-leaks, expense movers) is expense-only, and income-family
 * rows never reach them; (b) the two MATERIAL one-sided tree corrections
 * (-63,200.11 and -42,958.75) carry NULL vendor, so skipping the tree loses no
 * vendor attribution. NOTE: mirror vendor strings mostly DO match across sides
 * (e.g. 'Shopify Website' 813 parent / 807 tree), so vendor-keyed pairing would be
 * feasible — it just buys nothing while no surface reads vendor-grain income.
 */
export const mirrorTreeExcludedSql = sql`account_name NOT ILIKE '%match shopify total sales breakdown%'`;

const MAP_ACCOUNT = sql`
  CASE account_name
    WHEN '1 - Gross Sales (Match Shopify Total Sales Breakdown)' THEN 'Gross Sales'
    WHEN '2 - Discounts (Match Shopify Total Sales Breakdown)' THEN 'Discounts'
    WHEN '3 - Returns/Refunds (Match Shopify Total Sales Breakdown) + Amazon' THEN 'Returns and Refunds'
    ELSE account_name
  END`;
const IS_TREE = sql`(account_name ILIKE '%match shopify total sales breakdown%')`;

export interface GlMonthRow { month: string; account: string; amount: number }
export interface GlAccountRow { account: string; amount: number }

export interface DedupedGlOpts {
  /** Lower bound: trailing complete-month-aligned window — txn_date >= date_trunc('month', MT now) − N months. */
  monthsBack?: number;
  /** Lower bound: absolute 'YYYY-MM-DD' (overrides monthsBack). */
  sinceYmd?: string;
  /** Lower bound: rolling window — txn_date >= MT today − N months (NOT month-aligned). */
  rollingMonthsBack?: number;
  /** Upper bound: 'completeMonths' (default) excludes the current partial month;
   *  'toDate' includes it through MT today (excludes future-dated rows); 'none' is unbounded. */
  cutoff?: "completeMonths" | "toDate" | "none";
  /** Month label format. 'Mon YYYY' matches the monthly_financials convention ("May 2026"). */
  monthFormat?: "YYYY-MM" | "Mon YYYY";
}

function windowSql(o: DedupedGlOpts): SQL {
  const parts: SQL[] = [];
  if (o.sinceYmd) parts.push(sql`txn_date >= ${o.sinceYmd}::date`);
  else if (o.rollingMonthsBack != null) parts.push(sql`txn_date >= (${MT_NOW}::date - (${o.rollingMonthsBack} || ' months')::interval)`);
  else if (o.monthsBack != null) parts.push(sql`txn_date >= (date_trunc('month', ${MT_NOW}) - (${o.monthsBack} || ' months')::interval)`);
  const cutoff = o.cutoff ?? "completeMonths";
  if (cutoff === "completeMonths") parts.push(sql`txn_date < date_trunc('month', ${MT_NOW})`);
  else if (cutoff === "toDate") parts.push(sql`txn_date <= ${MT_NOW}::date`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`true`;
}

/** Deduped GL at (month, account) grain — the input every P&L rollup should read. */
export async function getDedupedMonthlyGl(db: DB, opts: DedupedGlOpts = {}): Promise<GlMonthRow[]> {
  const label = (opts.monthFormat ?? "YYYY-MM") === "Mon YYYY"
    ? sql`trim(to_char(mon, 'Mon YYYY'))`
    : sql`to_char(mon, 'YYYY-MM')`;
  const rs = rows(await db.execute(sql`
    WITH gl AS (
      SELECT realm_id, txn_date, ${MAP_ACCOUNT} AS account, ${IS_TREE} AS is_tree, amount
      FROM qb_pl_detail
      WHERE ${windowSql(opts)}
    ), keyed AS (
      -- realm_id in the pair key: lines can only mirror-cancel within the same QBO
      -- company (one realm today, but a second connection must never cross-pair).
      SELECT date_trunc('month', txn_date) AS mon, account, realm_id, txn_date, amount,
             count(*) FILTER (WHERE NOT is_tree) AS parent_n,
             count(*) FILTER (WHERE is_tree)     AS tree_n
      FROM gl GROUP BY 1, 2, 3, 4, 5
    )
    SELECT ${label} AS month, account,
           round(sum(amount * greatest(parent_n, tree_n))::numeric, 2) AS amount
    FROM keyed GROUP BY 1, 2 ORDER BY 1, 2`));
  return rs.map((r: any) => ({ month: String(r.month), account: String(r.account), amount: num(r.amount) }));
}

/** Deduped GL at account grain over an arbitrary inclusive date range (pace/windowed rollups). */
export async function getDedupedRangeGl(db: DB, startYmd: string, endYmd: string): Promise<GlAccountRow[]> {
  const rs = rows(await db.execute(sql`
    WITH gl AS (
      SELECT realm_id, txn_date, ${MAP_ACCOUNT} AS account, ${IS_TREE} AS is_tree, amount
      FROM qb_pl_detail
      WHERE txn_date >= ${startYmd}::date AND txn_date <= ${endYmd}::date
    ), keyed AS (
      SELECT account, realm_id, txn_date, amount,
             count(*) FILTER (WHERE NOT is_tree) AS parent_n,
             count(*) FILTER (WHERE is_tree)     AS tree_n
      FROM gl GROUP BY 1, 2, 3, 4
    )
    SELECT account, round(sum(amount * greatest(parent_n, tree_n))::numeric, 2) AS amount
    FROM keyed GROUP BY 1 ORDER BY 1`));
  return rs.map((r: any) => ({ account: String(r.account), amount: num(r.amount) }));
}

export interface GlLine { txnDate: string; account: string; amount: number; realmId?: string }

/**
 * Executable spec of the SQL dedup above, for tests and probe cross-checks: same
 * mapping, same pair key, same greatest(parent_n, tree_n) weighting, same per-
 * (month, account) 2dp rounding. The SQL is the production path; keep the two in
 * lockstep. Month label is 'YYYY-MM' (from txnDate).
 */
export function applyMirrorDedup(lines: GlLine[]): GlMonthRow[] {
  const keyed = new Map<string, { month: string; account: string; amount: number; parentN: number; treeN: number }>();
  for (const l of lines) {
    const isTree = isMirrorTreeAccount(l.account);
    const account = TREE_TO_PRIMARY[l.account] ?? l.account;
    const month = String(l.txnDate).slice(0, 7);
    const key = `${month}|${account}|${l.realmId ?? ""}|${l.txnDate}|${l.amount}`;
    const k = keyed.get(key) ?? { month, account, amount: l.amount, parentN: 0, treeN: 0 };
    if (isTree) k.treeN += 1; else k.parentN += 1;
    keyed.set(key, k);
  }
  const out = new Map<string, GlMonthRow>();
  for (const k of keyed.values()) {
    const mk = `${k.month}|${k.account}`;
    const row = out.get(mk) ?? { month: k.month, account: k.account, amount: 0 };
    row.amount += k.amount * Math.max(k.parentN, k.treeN);
    out.set(mk, row);
  }
  return Array.from(out.values())
    .map((r) => ({ ...r, amount: r2(r.amount) }))
    .sort((a, b) => (a.month === b.month ? (a.account < b.account ? -1 : 1) : a.month < b.month ? -1 : 1));
}
