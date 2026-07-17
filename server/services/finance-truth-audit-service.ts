/**
 * Finance Truth Audit — deterministic anti-hallucination preflight.
 *
 * This is the gate the audit asked for: the model may narrate finance results,
 * but it must not invent or silently smooth missing/stale/broken number inputs.
 * Every check below is DB-derived, read-only, and returns an explicit status.
 */
import { sql } from "drizzle-orm";
import { getCanonicalMonthlySpendByChannel } from "./canonical-spend-service";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export type TruthSeverity = "pass" | "warn" | "block";
export type TruthStatus = "actual" | "estimate" | "plug" | "stale" | "unknown" | "broken";

export interface TruthCheck {
  id: string;
  label: string;
  severity: TruthSeverity;
  status: TruthStatus;
  source: string;
  asOf: string | null;
  value: number | null;
  detail: string;
  nextAction: string;
}

export interface FinanceTruthAudit {
  success: true;
  generatedAt: string;
  overall: TruthSeverity;
  aiNumberPolicy: "allow_narration" | "narrate_with_warnings" | "block_unverified_numbers";
  checks: TruthCheck[];
}

export function summarizeTruthChecks(checks: TruthCheck[]): Pick<FinanceTruthAudit, "overall" | "aiNumberPolicy"> {
  const overall: TruthSeverity = checks.some((c) => c.severity === "block")
    ? "block"
    : checks.some((c) => c.severity === "warn")
      ? "warn"
      : "pass";
  return {
    overall,
    aiNumberPolicy: overall === "block"
      ? "block_unverified_numbers"
      : overall === "warn"
        ? "narrate_with_warnings"
        : "allow_narration",
  };
}

function ageHours(asOf: string | null): number | null {
  if (!asOf) return null;
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function freshnessCheck(opts: {
  id: string;
  label: string;
  source: string;
  asOf: string | null;
  staleHours: number;
  missingAction: string;
}): TruthCheck {
  const age = ageHours(opts.asOf);
  if (age == null) {
    return {
      id: opts.id,
      label: opts.label,
      severity: "block",
      status: "unknown",
      source: opts.source,
      asOf: null,
      value: null,
      detail: "No usable freshness timestamp was found. Treat every number from this feed as unavailable, not zero.",
      nextAction: opts.missingAction,
    };
  }
  const stale = age > opts.staleHours;
  return {
    id: opts.id,
    label: opts.label,
    severity: stale ? "block" : "pass",
    status: stale ? "stale" : "actual",
    source: opts.source,
    asOf: opts.asOf,
    value: r2(age),
    detail: stale
      ? `Latest source data is ${r2(age)} hours old, beyond the ${opts.staleHours}h freshness limit.`
      : `Latest source data is ${r2(age)} hours old.`,
    nextAction: stale ? opts.missingAction : "No action needed.",
  };
}

async function tableExists(db: any, tableName: string): Promise<boolean> {
  const r = rows(await db.execute(sql`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = ${tableName}
    ) as exists`))[0];
  return r?.exists === true || r?.exists === "true";
}

export async function computeFinanceTruthAudit(db: any): Promise<FinanceTruthAudit> {
  const checks: TruthCheck[] = [];

  const bank = rows(await db.execute(sql`
    select as_of::text as as_of from bank_balance_entries
    order by as_of desc, created_at desc limit 1`))[0];
  checks.push(freshnessCheck({
    id: "bank_cash_freshness",
    label: "Bank-confirmed cash freshness",
    source: "bank_balance_entries",
    asOf: bank?.as_of ?? null,
    staleHours: 72,
    missingAction: "Enter the current bank-confirmed available balance. Do not anchor CFO cash on QuickBooks ledger cash.",
  }));

  const cogs = rows(await db.execute(sql`
    with lines as (
      select
        greatest(sol.qty_ordered - coalesce(sol.returned_qty, 0), 0) * coalesce(sol.unit_price, 0) as revenue,
        coalesce(i.wac_unit_cost, i.default_purchase_cost) as unit_cost
      from sales_order_lines sol
      join sales_orders so on so.id = sol.sales_order_id
      left join items i on i.id = sol.product_id
      where so.order_date >= current_date - 30
        and upper(coalesce(so.status, '')) not in ('CANCELLED', 'REFUNDED')
    )
    select
      count(*) filter (where revenue > 0 and (unit_cost is null or unit_cost <= 0))::int as missing_lines,
      coalesce(sum(revenue) filter (where revenue > 0 and (unit_cost is null or unit_cost <= 0)), 0)::float8 as missing_revenue,
      count(*) filter (where revenue > 0)::int as revenue_lines
    from lines`))[0] ?? {};
  const missingLines = num(cogs.missing_lines);
  checks.push({
    id: "cogs_preflight",
    label: "COGS preflight",
    severity: missingLines > 0 ? "block" : "pass",
    status: missingLines > 0 ? "broken" : "actual",
    source: "sales_order_lines + items.wac_unit_cost/default_purchase_cost",
    asOf: new Date().toISOString(),
    value: missingLines,
    detail: missingLines > 0
      ? `${missingLines} revenue line(s), representing $${Math.round(num(cogs.missing_revenue)).toLocaleString()}, have missing/zero item cost. Margin and Net ROAS must not be presented as real.`
      : `${num(cogs.revenue_lines)} revenue line(s) checked; no missing/zero costs found.`,
    nextAction: missingLines > 0
      ? "Fill item WAC/default purchase cost or exclude those rows and label COGS as plug."
      : "No action needed.",
  });

  const metaPerfExists = await tableExists(db, "meta_ads_performance");
  if (metaPerfExists) {
    const meta = rows(await db.execute(sql`
      select max(date)::text as latest_date, max(updated_at)::text as latest_update,
             coalesce(sum(spend) filter (where date >= current_date - 30), 0)::float8 as spend_30d
      from meta_ads_performance`))[0] ?? {};
    checks.push(freshnessCheck({
      id: "meta_api_freshness",
      label: "Meta API feed freshness",
      source: "meta_ads_performance",
      asOf: meta.latest_update ?? meta.latest_date ?? null,
      staleHours: 48,
      missingAction: "Wire/fix Meta Marketing API sync. Until then, Meta spend must come from labeled manual snapshots only.",
    }));
    checks.push({
      id: "meta_api_spend_30d",
      label: "Meta API 30-day spend coverage",
      severity: num(meta.spend_30d) > 0 ? "pass" : "warn",
      status: num(meta.spend_30d) > 0 ? "actual" : "unknown",
      source: "meta_ads_performance",
      asOf: meta.latest_update ?? meta.latest_date ?? null,
      value: r2(num(meta.spend_30d)),
      detail: num(meta.spend_30d) > 0
        ? `Meta API has $${r2(num(meta.spend_30d)).toLocaleString()} spend in the trailing 30 days.`
        : "Meta API has no trailing-30-day spend. This may be true only if ads are fully off; otherwise it is a feed gap.",
      nextAction: num(meta.spend_30d) > 0 ? "No action needed." : "Verify Meta sync before trusting ROAS/MER.",
    });
  }

  const snap = rows(await db.execute(sql`
    select
      max(captured_at)::text as latest_capture,
      count(*) filter (where coalesce(superseded, false) = false and status = 'DATA_GAPPED')::int as active_gapped,
      count(*) filter (where coalesce(superseded, false) = false)::int as active_count
    from marketing_spend_snapshots`))[0] ?? {};
  checks.push({
    id: "manual_marketing_snapshots",
    label: "Manual marketing snapshot health",
    severity: num(snap.active_gapped) > 0 ? "warn" : "pass",
    status: num(snap.active_gapped) > 0 ? "estimate" : "actual",
    source: "marketing_spend_snapshots",
    asOf: snap.latest_capture ?? null,
    value: num(snap.active_gapped),
    detail: `${num(snap.active_count)} active snapshot(s); ${num(snap.active_gapped)} are data-gapped.`,
    nextAction: num(snap.active_gapped) > 0
      ? "Re-upload complete source files or replace this feed with the platform API."
      : "No action needed.",
  });

  const duplicate = rows(await db.execute(sql`
    select count(*)::int as duplicate_hash_groups
    from (
      select source_hash
      from marketing_spend_snapshots
      where source_hash is not null
      group by source_hash
      having count(*) > 1
    ) d`))[0] ?? {};
  checks.push({
    id: "duplicate_marketing_uploads",
    label: "Duplicate marketing uploads",
    severity: num(duplicate.duplicate_hash_groups) > 0 ? "warn" : "pass",
    status: num(duplicate.duplicate_hash_groups) > 0 ? "broken" : "actual",
    source: "marketing_spend_snapshots.source_hash",
    asOf: snap.latest_capture ?? null,
    value: num(duplicate.duplicate_hash_groups),
    detail: num(duplicate.duplicate_hash_groups) > 0
      ? `${num(duplicate.duplicate_hash_groups)} duplicate source-hash group(s) exist. Dedup should disregard repeats before aggregation.`
      : "No duplicate source-hash groups found.",
    nextAction: num(duplicate.duplicate_hash_groups) > 0
      ? "Inspect reconciliation log and ensure duplicate uploads are marked DISREGARDED/superseded."
      : "No action needed.",
  });

  const canonicalSpend = await getCanonicalMonthlySpendByChannel(db, 2);
  const googleCanonicalSpend = r2(canonicalSpend.reduce((sum, month) => {
    return sum + (month.byChannel.GOOGLE?.spend ?? 0);
  }, 0));
  const googleMonthsWithGaps = canonicalSpend.filter((month) => {
    return month.byChannel.GOOGLE?.spend == null || month.byChannel.GOOGLE?.understated;
  });
  checks.push({
    id: "google_canonical_spend_coverage",
    label: "Google canonical spend coverage",
    severity: googleMonthsWithGaps.length > 0 ? "block" : "pass",
    status: googleMonthsWithGaps.length > 0 ? "unknown" : "actual",
    source: "canonical-spend-service",
    asOf: new Date().toISOString(),
    value: googleCanonicalSpend,
    detail: googleMonthsWithGaps.length > 0
      ? `Canonical Google spend is missing or understated for ${googleMonthsWithGaps.map((m) => m.month).join(", ")}.`
      : `Canonical Google spend is available for the current/previous month window ($${Math.round(googleCanonicalSpend).toLocaleString()}).`,
    nextAction: googleMonthsWithGaps.length > 0
      ? "Fix the canonical Google spend source before presenting Google ROAS/MER as actual."
      : "No action needed.",
  });

  for (const table of ["amazon_orders_daily", "amazon_inventory", "amazon_ads_daily"]) {
    const exists = await tableExists(db, table);
    checks.push({
      id: `${table}_presence`,
      label: `${table} source table`,
      severity: exists ? "pass" : "warn",
      status: exists ? "actual" : "unknown",
      source: "information_schema.tables",
      asOf: new Date().toISOString(),
      value: exists ? 1 : 0,
      detail: exists
        ? `${table} exists. Freshness should be checked by its sync job.`
        : `${table} does not exist. Amazon spreadsheet/tracker data is not a reliable CFO source.`,
      nextAction: exists
        ? "Add freshness checks once the Amazon sync writes synced_at."
        : "Wire Amazon SP-API / Amazon Ads API before presenting Amazon sales, inventory, or ad Net ROAS as actual.",
    });
  }

  const summary = summarizeTruthChecks(checks);
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    ...summary,
    checks,
  };
}
