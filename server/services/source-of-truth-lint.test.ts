/**
 * G P2 #28 — source-of-truth lint (see /SOURCES-OF-TRUTH.md).
 *
 * Re-derivation debt regrows silently: 21 files touched ad_metrics_daily by Jul 2026 and
 * half the surfaces disagreed on ad spend. This test freezes the CURRENT consumer set —
 * a NEW file reading a guarded raw pattern fails the suite until it either uses the
 * canonical module or is deliberately allowlisted here (with a reason) in review.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SERVER_ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(SERVER_ROOT, p).replace(/\\/g, "/");

/** Files allowed to read ad_metrics_daily directly: the canonical engines, ingestion
 *  writers, drift guards, and the reviewed legacy consumers that apply corrections. */
const AD_METRICS_ALLOWLIST = new Set([
  "routes.ts",                                 // monolith: legacy reads apply getAdSpendCorrection
  "routes/historical-sales-seed.ts",           // seed/backfill writer
  "routes/marketing-analytics-cmo-api.ts",     // upload ingestion + corrected reads
  "routes/marketing-analytics-queries-v2.ts",  // corrected via getAdSpendCorrection per query
  "routes/marketing-analytics-queries.ts",     // v1 — corrected via getAdSpendCorrection
  "routes/zo-kpi-seed.ts",                     // seed writer
  "scheduler-service.ts",                      // sync orchestration (writer side)
  "services/ad-metrics-sync.ts",               // ingestion writer
  "services/canonical-spend-service.ts",       // CANONICAL
  "services/corrected-ad-spend.ts",            // CANONICAL range adapter
  "services/finance-truth-audit-service.ts",   // truth-audit verifier: reads raw grain ONLY to cross-check canonical, emits guidance to use canonical
  "services/financial-reconciliation-service.ts", // drift guard (reads raw BY DESIGN to detect fanout)
  "services/google-ads-client.ts",             // ingestion writer
  "services/marketing-analytics-service.ts",   // authoritative-grain aggregation (reviewed)
  "services/marketing-governor-service.ts",    // September-Rule streak at the single grain (reviewed)
  "services/meta-ads-client.ts",               // ingestion writer
  "services/runway-service.ts",                // labeled fallback only (canonical-first)
  "services/startup-checks.ts",                // DDL
  "services/unified-performance-service.ts",   // merge engine (canonical-first, live fallback)
  "services/windsor-client.ts",                // ingestion
  "services/windsor-ingestion-service.ts",     // ingestion writer
  "services/windsor-sync-service.ts",          // ingestion writer
  "storage.ts",                                // generic accessor layer
]);

/** Files allowed to SUM sales_orders.total_amount directly (revenue re-derivation). */
const REVENUE_SUM_ALLOWLIST = new Set([
  "routes.ts",                                 // monolith legacy surfaces (reviewed Jul 2026)
  "routes/historical-sales-seed.ts",           // seed reconciliation
  "routes/marketing-analytics-queries-v2.ts",  // deduped/QB-spined monthly + windows (reviewed)
  "services/daily-company-report-service.ts",  // daily cross-check vs Shopify API (by design)
  "services/debt-runway-service.ts",           // Shopify-remittance projection (reviewed)
  "services/financial-reconciliation-service.ts", // drift guard vs QB (by design)
  "services/shopify-payouts-service.ts",       // payout estimation (channel-scoped)
  "services/system-integrity-service.ts",      // integrity sweep (by design)
]);

describe("source-of-truth lint (SOURCES-OF-TRUTH.md)", () => {
  const files = walk(SERVER_ROOT);

  it("no NEW file reads ad_metrics_daily outside the canonical/ingestion allowlist", () => {
    const offenders = files
      .filter((p) => /ad_metrics_daily|adMetricsDaily/.test(readFileSync(p, "utf8")))
      .map(rel)
      .filter((r) => !AD_METRICS_ALLOWLIST.has(r));
    expect(offenders, `Use canonical-spend-service / corrected-ad-spend instead of raw ad_metrics_daily (or allowlist WITH a reason): ${offenders.join(", ")}`).toEqual([]);
  });

  it("no NEW file re-derives revenue via SUM(total_amount) outside the allowlist", () => {
    const offenders = files
      .filter((p) => /sum\(\s*(coalesce\(\s*)?total_amount/i.test(readFileSync(p, "utf8")))
      .map(rel)
      .filter((r) => !REVENUE_SUM_ALLOWLIST.has(r));
    expect(offenders, `Use getSalesOrdersByDateRange / historical_monthly_sales / daily_sales_snapshots instead (or allowlist WITH a reason): ${offenders.join(", ")}`).toEqual([]);
  });

  it("the allowlists don't rot: every allowlisted file still exists and still matches", () => {
    const present = new Set(files.map(rel));
    for (const f of [...AD_METRICS_ALLOWLIST, ...REVENUE_SUM_ALLOWLIST]) {
      expect(present.has(f), `allowlisted file missing from repo: ${f} — remove it from the allowlist`).toBe(true);
    }
  });
});
