/**
 * TruthMonitorService — the daily read-only "Truth Report".
 * ---------------------------------------------------------
 * Runs the V-suite number-integrity checks + inventory-movement ledger stats +
 * ad-feed confidence in one pass, classifies each check PASS/WARN/FAIL, and
 * persists exactly one report row (truth_reports) per run. The Health page
 * renders the latest report.
 *
 * HARD CONTRACT — this service is READ-ONLY against business tables:
 *   - Every V-suite / ledger query is a constant SELECT (see *_SQL exports;
 *     the test suite asserts they are SELECT-only).
 *   - The ONLY write is the INSERT of its own report row into truth_reports.
 *   - Numbers come from query results ONLY. A check that throws is reported
 *     as status FAIL with the error message — never silently absent, never
 *     fabricated. A query that returns nothing reports its true zero/empty
 *     semantics.
 *
 * Canonical test command:
 *   npx vitest run server/services/truth-monitor-service.test.ts
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

export type TruthCheckStatus = "PASS" | "WARN" | "FAIL";

export interface TruthCheck {
  id: string; // "V1" | "V2b" | "V3" | "V4" | "V5-META" | "V5-GOOGLE" | "V5-AMAZON" | "LEDGER"
  name: string;
  status: TruthCheckStatus;
  summary: string;
  details?: Record<string, unknown>;
  /** Set when the check itself errored (status is FAIL in that case). */
  error?: string;
}

export interface TruthReport {
  id?: string;
  runAt: string;
  overall: TruthCheckStatus;
  checks: TruthCheck[];
}

const SEVERITY: Record<TruthCheckStatus, number> = { PASS: 0, WARN: 1, FAIL: 2 };

/** Overall = FAIL if any FAIL, else WARN if any WARN, else PASS. Pure. */
export function rollupTruth(checks: Array<Pick<TruthCheck, "status">>): TruthCheckStatus {
  let worst: TruthCheckStatus = "PASS";
  for (const c of checks) {
    if (SEVERITY[c.status] > SEVERITY[worst]) worst = c.status;
  }
  return worst;
}

/**
 * V5 freshness classifier: WARN when the latest ACTIVE snapshot is >3 days
 * old, FAIL when >7. A platform with NO active snapshot at all is FAIL —
 * "no data" is the least fresh state there is, never a pass. Pure.
 */
export function classifyFeedAge(daysOld: number | null): { status: TruthCheckStatus; reason: string } {
  if (daysOld === null) {
    return { status: "FAIL", reason: "no ACTIVE spend snapshot exists for this platform" };
  }
  if (daysOld > 7) {
    return { status: "FAIL", reason: `latest ACTIVE snapshot is ${daysOld} days old (>7d)` };
  }
  if (daysOld > 3) {
    return { status: "WARN", reason: `latest ACTIVE snapshot is ${daysOld} days old (>3d)` };
  }
  return { status: "PASS", reason: `latest ACTIVE snapshot is ${daysOld} day(s) old` };
}

// ─── V-suite SQL (constant, parameter-free, SELECT-only) ────────────────────
// Exported so the tests can assert the exact semantics and that every query is
// read-only. `count(*) OVER ()` runs after GROUP BY/HAVING, so it returns the
// TRUE total of offending groups even though samples are LIMITed.

/** V1 — cross-channel order twins: one physical order stored under 2+ channels. */
export const V1_SQL = `
  SELECT external_order_id,
         count(DISTINCT channel)::int AS channels,
         count(*) OVER ()::int AS total_groups
  FROM sales_orders
  WHERE external_order_id IS NOT NULL
    AND status NOT IN ('CANCELLED')
  GROUP BY external_order_id
  HAVING count(DISTINCT channel) > 1
  ORDER BY channels DESC, external_order_id
  LIMIT 10`;

/** V2b — overlapping ACTIVE spend windows per platform (disjoint windows are valid). */
export const V2B_SQL = `
  SELECT a.platform,
         a.id AS snapshot_a, b.id AS snapshot_b,
         a.period_start::text AS a_start, a.period_end::text AS a_end,
         b.period_start::text AS b_start, b.period_end::text AS b_end,
         count(*) OVER ()::int AS total_pairs
  FROM marketing_spend_snapshots a
  JOIN marketing_spend_snapshots b
    ON a.platform = b.platform AND a.id < b.id
  WHERE a.superseded = false AND b.superseded = false
    AND a.period_start IS NOT NULL AND a.period_end IS NOT NULL
    AND b.period_start IS NOT NULL AND b.period_end IS NOT NULL
    AND a.period_start <= b.period_end AND b.period_start <= a.period_end
  ORDER BY a.platform, a.period_start
  LIMIT 10`;

/**
 * V3 — duplicate SALES_ORDER_CREATED decrements in the last 7 days (the
 * standing proof that the inventory-movement ledger dedup holds at 0 forever).
 *
 * Grain note (verified against live audit_logs on 2026-07-17): these audit
 * events are written PER ORDER LINE, so grouping by orderId alone counts every
 * multi-line order as a "duplicate" (4 false positives in the trailing week).
 * A real duplicate decrement is the same order decrementing the same item more
 * than once, so the group is (orderId, itemId) — which reads a true 0 on prod.
 */
export const V3_SQL = `
  SELECT details->>'orderId' AS order_id,
         details->>'itemId' AS item_id,
         count(*)::int AS decrements,
         count(*) OVER ()::int AS total_groups
  FROM audit_logs
  WHERE event_type = 'SALES_ORDER_CREATED'
    AND timestamp >= now() - interval '7 days'
    AND details->>'orderId' IS NOT NULL
  GROUP BY details->>'orderId', details->>'itemId'
  HAVING count(*) > 1
  ORDER BY decrements DESC
  LIMIT 10`;

/** V4 — shipped/delivered order lines whose qty_shipped never left 0. */
export const V4_SQL = `
  SELECT l.sku,
         count(*)::int AS lines,
         sum(count(*)) OVER ()::int AS total_lines
  FROM sales_order_lines l
  JOIN sales_orders o ON o.id = l.sales_order_id
  WHERE o.status IN ('SHIPPED','DELIVERED')
    AND coalesce(l.qty_shipped, 0) = 0
  GROUP BY l.sku
  ORDER BY lines DESC
  LIMIT 5`;

/** V5 — latest ACTIVE spend-snapshot age per platform. */
export const V5_SQL = `
  SELECT upper(platform) AS platform,
         max(period_end)::text AS latest_period_end,
         (CURRENT_DATE - max(period_end))::int AS days_old
  FROM marketing_spend_snapshots
  WHERE superseded = false AND period_end IS NOT NULL
  GROUP BY upper(platform)`;

/** Ledger stats — inventory_movement_ledger volume + DEDUP_SKIP audit rows (24h). */
export const LEDGER_STATS_SQL = `
  SELECT
    (SELECT count(*)::int FROM inventory_movement_ledger) AS total_rows,
    (SELECT count(*)::int FROM inventory_movement_ledger
       WHERE created_at >= now() - interval '24 hours') AS rows_24h,
    (SELECT count(*)::int FROM audit_logs
       WHERE details->>'dedupAction' = 'DEDUP_SKIP'
         AND timestamp >= now() - interval '24 hours') AS dedup_skips_24h`;

/** OUTLIER — 29 calendar days (Denver) of Shopify-channel daily revenue, zero-filled
 * in SQL via generate_series so absent days read as $0 (an ingestion outage IS a zero
 * day, exactly what the grade must see). Last row = yesterday; prior 28 = trailing. */
export const OUTLIER_SQL = `
  SELECT gs::date AS d,
         COALESCE(round(sum(so.total_amount)::numeric, 2), 0) AS total
  FROM generate_series((now() AT TIME ZONE 'America/Denver')::date - 29,
                       (now() AT TIME ZONE 'America/Denver')::date - 1,
                       interval '1 day') gs
  LEFT JOIN sales_orders so
    ON (so.order_date AT TIME ZONE 'America/Denver')::date = gs::date
   AND upper(so.channel) LIKE '%SHOPIFY%'
   AND COALESCE(so.is_historical, false) = false
   AND so.cancelled_at IS NULL
  GROUP BY 1
  ORDER BY 1`;

/**
 * Graded outlier bounds for yesterday's Shopify revenue vs its trailing 28-day
 * median (CFO Phase 1.5). Bands: <0.2x or >4x median = FAIL; <0.5x or >2.5x = WARN;
 * else PASS. Two honesty guards never let thin data grade as healthy: fewer than 14
 * trailing days = WARN (insufficient history), trailing median under $500 = WARN
 * (window itself degraded — e.g. mid-backfill after an outage). Pure.
 */
export function classifyDailyOutlier(
  yesterday: number,
  trailing: number[],
): { status: TruthCheckStatus; reason: string; median: number; ratio: number | null } {
  const valid = trailing.filter((v) => Number.isFinite(v));
  if (valid.length < 14) {
    return { status: "WARN", reason: `insufficient history: ${valid.length} trailing day(s), need 14 to grade`, median: 0, ratio: null };
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (median < 500) {
    return { status: "WARN", reason: `trailing window degraded (28-day median $${median.toFixed(2)}) — grading suspended until history heals`, median, ratio: null };
  }
  const ratio = yesterday / median;
  if (ratio < 0.2) {
    return { status: "FAIL", reason: `yesterday $${yesterday.toFixed(2)} is ${(ratio * 100).toFixed(0)}% of the 28-day median $${median.toFixed(2)} — revenue collapse or ingestion outage`, median, ratio };
  }
  if (ratio < 0.5) {
    return { status: "WARN", reason: `yesterday $${yesterday.toFixed(2)} is ${(ratio * 100).toFixed(0)}% of the 28-day median $${median.toFixed(2)} — soft day or partial ingestion`, median, ratio };
  }
  if (ratio > 4) {
    return { status: "FAIL", reason: `yesterday $${yesterday.toFixed(2)} is ${ratio.toFixed(1)}x the 28-day median $${median.toFixed(2)} — data error or exceptional day, verify before trusting`, median, ratio };
  }
  if (ratio > 2.5) {
    return { status: "WARN", reason: `yesterday $${yesterday.toFixed(2)} is ${ratio.toFixed(1)}x the 28-day median $${median.toFixed(2)} — spike worth a look`, median, ratio };
  }
  return { status: "PASS", reason: `yesterday $${yesterday.toFixed(2)} within graded bounds of the 28-day median $${median.toFixed(2)}`, median, ratio };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

function rowsOf(r: any): any[] {
  return (r?.rows ?? r ?? []) as any[];
}

function errMsg(e: any): string {
  return e?.message ?? String(e);
}

/** Run one check; a thrown error becomes FAIL with the message — never absent. */
async function runCheck(id: string, name: string, fn: () => Promise<TruthCheck>): Promise<TruthCheck> {
  try {
    return await fn();
  } catch (e: any) {
    return {
      id,
      name,
      status: "FAIL",
      summary: `Check errored: ${errMsg(e)}`,
      error: errMsg(e),
    };
  }
}

async function checkV1(): Promise<TruthCheck> {
  const rows = rowsOf(await db.execute(sql.raw(V1_SQL)));
  const total = rows.length ? Number(rows[0].total_groups ?? rows.length) : 0;
  return {
    id: "V1",
    name: "Cross-channel order twins",
    status: total > 0 ? "FAIL" : "PASS",
    summary:
      total > 0
        ? `${total} external order id(s) exist under more than one channel — revenue is double-counted.`
        : "No canonical order shares its external_order_id across channels.",
    details: {
      offendingGroups: total,
      samples: rows.map((r) => ({ externalOrderId: r.external_order_id, channels: Number(r.channels ?? 0) })),
    },
  };
}

async function checkV2b(): Promise<TruthCheck> {
  const rows = rowsOf(await db.execute(sql.raw(V2B_SQL)));
  const total = rows.length ? Number(rows[0].total_pairs ?? rows.length) : 0;
  return {
    id: "V2b",
    name: "Overlapping ACTIVE spend windows",
    status: total > 0 ? "FAIL" : "PASS",
    summary:
      total > 0
        ? `${total} overlapping ACTIVE snapshot pair(s) on the same platform — ad spend is double-counted.`
        : "No two ACTIVE spend snapshots overlap on the same platform (disjoint windows are valid).",
    details: {
      overlappingPairs: total,
      samples: rows.map((r) => ({
        platform: r.platform,
        snapshotA: r.snapshot_a,
        snapshotB: r.snapshot_b,
        aWindow: [r.a_start, r.a_end],
        bWindow: [r.b_start, r.b_end],
      })),
    },
  };
}

async function checkV3(): Promise<TruthCheck> {
  const rows = rowsOf(await db.execute(sql.raw(V3_SQL)));
  const total = rows.length ? Number(rows[0].total_groups ?? rows.length) : 0;
  return {
    id: "V3",
    name: "Duplicate SALES_ORDER_CREATED decrements (7d)",
    status: total > 0 ? "FAIL" : "PASS",
    summary:
      total > 0
        ? `${total} (order, item) pair(s) decremented more than once in the last 7 days — the ledger dedup is breached.`
        : "No duplicate inventory decrements in the last 7 days — the standing V3 proof holds.",
    details: {
      duplicateGroups: total,
      samples: rows.map((r) => ({ orderId: r.order_id, itemId: r.item_id, decrements: Number(r.decrements ?? 0) })),
      grainNote: "grouped by (orderId, itemId); orderId-alone counts every multi-line order as a false duplicate",
    },
  };
}

async function checkV4(): Promise<TruthCheck> {
  const rows = rowsOf(await db.execute(sql.raw(V4_SQL)));
  const total = rows.length ? Number(rows[0].total_lines ?? 0) : 0;
  return {
    id: "V4",
    name: "Shipped lines with qty_shipped = 0",
    status: total > 0 ? "WARN" : "PASS",
    summary:
      total > 0
        ? `${total} line(s) on SHIPPED/DELIVERED orders still have qty_shipped = 0 — shipment quantities were never recorded.`
        : "Every line on a SHIPPED/DELIVERED order has a recorded shipped quantity.",
    details: {
      lines: total,
      topSkus: rows.map((r) => ({ sku: r.sku, lines: Number(r.lines ?? 0) })),
    },
  };
}

/**
 * V5 — per-platform feed freshness. Emits one check per platform: META and
 * GOOGLE always (their absence is itself a finding), AMAZON only if it has
 * snapshots. META is enriched with the direct-feed confidence verdict; GOOGLE
 * has no direct feed yet, so its true source state is reported instead of a
 * made-up confidence.
 */
async function checkV5(): Promise<TruthCheck[]> {
  const rows = rowsOf(await db.execute(sql.raw(V5_SQL)));
  const byPlatform = new Map<string, { latestPeriodEnd: string | null; daysOld: number | null }>();
  for (const r of rows) {
    byPlatform.set(String(r.platform ?? "").toUpperCase(), {
      latestPeriodEnd: r.latest_period_end ?? null,
      daysOld: r.days_old === null || r.days_old === undefined ? null : Number(r.days_old),
    });
  }

  const platforms = ["META", "GOOGLE", ...(byPlatform.has("AMAZON") ? ["AMAZON"] : [])];
  const checks: TruthCheck[] = [];

  for (const platform of platforms) {
    const snap = byPlatform.get(platform) ?? { latestPeriodEnd: null, daysOld: null };
    const age = classifyFeedAge(snap.daysOld);
    const details: Record<string, unknown> = {
      platform,
      latestPeriodEnd: snap.latestPeriodEnd,
      daysOld: snap.daysOld,
    };
    let summary = `${platform}: ${age.reason}${snap.latestPeriodEnd ? ` (period_end ${snap.latestPeriodEnd})` : ""}.`;

    if (platform === "META") {
      // Supplementary verdict from the direct-feed client. Its failure must be
      // visible but must not mask the age-based freshness classification.
      try {
        const { getMetaDirectFeedConfidence } = await import("./meta-ads-client");
        const confidence = await getMetaDirectFeedConfidence();
        details.metaDirectConfidence = confidence;
        summary += ` Direct feed confidence: ${confidence.confidence} — ${confidence.reason}`;
      } catch (e: any) {
        details.metaDirectConfidenceError = errMsg(e);
        summary += ` Direct feed confidence unavailable: ${errMsg(e)}`;
      }
    }
    if (platform === "GOOGLE") {
      details.feedNote = "no direct feed; manual/QB fallback";
      summary += " No direct Google feed exists yet — manual/QB fallback is the source (no confidence invented).";
    }

    checks.push({
      id: `V5-${platform}`,
      name: `${platform} spend feed freshness`,
      status: age.status,
      summary,
      details,
    });
  }
  return checks;
}

async function checkLedgerStats(): Promise<TruthCheck> {
  const rows = rowsOf(await db.execute(sql.raw(LEDGER_STATS_SQL)));
  const row = rows[0] ?? {};
  const totalRows = Number(row.total_rows ?? 0);
  const rows24h = Number(row.rows_24h ?? 0);
  const dedupSkips24h = Number(row.dedup_skips_24h ?? 0);
  return {
    id: "LEDGER",
    name: "Inventory movement ledger stats",
    status: "PASS", // informational — the numbers themselves are the report
    summary: `${totalRows} ledger row(s) total, ${rows24h} in the last 24h, ${dedupSkips24h} DEDUP_SKIP audit row(s) in the last 24h.`,
    details: { totalRows, rows24h, dedupSkips24h },
  };
}

async function checkOutlierBounds(): Promise<TruthCheck> {
  const rows = rowsOf(await db.execute(sql.raw(OUTLIER_SQL)));
  const totals = rows.map((r: any) => Number(r.total ?? 0));
  const yesterday = totals.length ? totals[totals.length - 1] : 0;
  const trailing = totals.slice(0, -1);
  const graded = classifyDailyOutlier(yesterday, trailing);
  return {
    id: "OUTLIER",
    name: "Daily Shopify revenue outlier bounds",
    status: graded.status,
    summary: graded.reason,
    details: {
      yesterday,
      trailingDays: trailing.length,
      median: graded.median,
      ratio: graded.ratio,
      bands: { failLow: 0.2, warnLow: 0.5, warnHigh: 2.5, failHigh: 4 },
    },
  };
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface RunTruthReportResult {
  report: TruthReport;
  persisted: boolean;
  persistError?: string;
}

export async function runTruthReport(): Promise<RunTruthReportResult> {
  const checks: TruthCheck[] = [];

  // Sequential + per-check try/catch: one failing check never hides another,
  // and the db.execute order stays deterministic for the tests.
  checks.push(await runCheck("V1", "Cross-channel order twins", checkV1));
  checks.push(await runCheck("V2b", "Overlapping ACTIVE spend windows", checkV2b));
  checks.push(await runCheck("V3", "Duplicate SALES_ORDER_CREATED decrements (7d)", checkV3));
  checks.push(await runCheck("V4", "Shipped lines with qty_shipped = 0", checkV4));
  try {
    checks.push(...(await checkV5()));
  } catch (e: any) {
    // The single V5 query failed — every always-on platform check must still
    // appear, each carrying the error (never silently absent).
    for (const platform of ["META", "GOOGLE"]) {
      checks.push({
        id: `V5-${platform}`,
        name: `${platform} spend feed freshness`,
        status: "FAIL",
        summary: `Check errored: ${errMsg(e)}`,
        error: errMsg(e),
      });
    }
  }
  checks.push(await runCheck("LEDGER", "Inventory movement ledger stats", checkLedgerStats));
  checks.push(await runCheck("OUTLIER", "Daily Shopify revenue outlier bounds", checkOutlierBounds));

  const overall = rollupTruth(checks);
  const report: TruthReport = {
    runAt: new Date().toISOString(),
    overall,
    checks,
  };

  // Persist ONE report row. This is the service's only write — its own table.
  try {
    const inserted: any = await db.execute(sql`
      INSERT INTO truth_reports (overall, checks)
      VALUES (${overall}, ${JSON.stringify(checks)}::jsonb)
      RETURNING id::text AS id, run_at::text AS run_at`);
    const row = rowsOf(inserted)[0];
    if (row?.id) report.id = String(row.id);
    if (row?.run_at) report.runAt = new Date(row.run_at).toISOString();
    return { report, persisted: true };
  } catch (e: any) {
    console.warn("[Truth Monitor] Failed to persist truth report:", errMsg(e));
    return { report, persisted: false, persistError: errMsg(e) };
  }
}

export async function getLatestTruthReport(): Promise<TruthReport | null> {
  const r: any = await db.execute(sql.raw(`
    SELECT id::text AS id, run_at::text AS run_at, overall, checks
    FROM truth_reports
    ORDER BY run_at DESC
    LIMIT 1`));
  const row = rowsOf(r)[0];
  if (!row) return null;
  const checks = typeof row.checks === "string" ? JSON.parse(row.checks) : row.checks;
  return {
    id: row.id ? String(row.id) : undefined,
    runAt: row.run_at ? new Date(row.run_at).toISOString() : "",
    overall: row.overall as TruthCheckStatus,
    checks: Array.isArray(checks) ? checks : [],
  };
}

/** True when a truth report ran in the last 24 hours (startup self-heal probe). */
export async function hasRecentTruthReport(): Promise<boolean> {
  const r: any = await db.execute(sql.raw(`
    SELECT count(*)::int AS n
    FROM truth_reports
    WHERE run_at >= now() - interval '24 hours'`));
  return Number(rowsOf(r)[0]?.n ?? 0) > 0;
}
