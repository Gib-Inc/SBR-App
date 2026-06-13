/**
 * SystemIntegrityService — Pillar 1 cross-stream self-healing loop.
 * ----------------------------------------------------------------
 * Orchestrates the app's previously-siloed integrity checks into one pass that
 * matches independent data streams and surfaces drift to a single ledger:
 *
 *   inventory   app available-for-sale  vs  Extensiv pivot (runDriftReport)
 *   ad-spend    trusted unified spend    vs  plausibility band (under-reporting)
 *   financial   open financial_discrepancies (QB vs app / uploads)
 *
 * Detect + log + flag. It deliberately does NOT auto-roll-back money or
 * inventory state — silent automated reversals of financial records are far
 * more dangerous than a flagged anomaly a human confirms. Safe auto-remediation
 * (e.g. re-sync) can be layered on per-stream later.
 *
 * Pure rollup/classify helpers are unit tested; the orchestrator wraps every
 * check in its own try/catch so one failing stream never breaks the report.
 */

export type StreamStatus = "OK" | "WARN" | "DRIFT";

export interface StreamResult {
  stream: string;
  status: StreamStatus;
  anomalies: number;
  checked: number;
  summary: string;
  worstOffenders?: Array<{ key: string; detail: string }>;
}

export interface IntegrityReport {
  generatedAt: string;
  status: StreamStatus; // worst across all streams
  totalAnomalies: number;
  streams: StreamResult[];
  notes: string[];
}

const SEVERITY: Record<StreamStatus, number> = { OK: 0, WARN: 1, DRIFT: 2 };

/** Classify a stream from its anomaly count. Pure. */
export function classifyStream(
  anomalies: number,
  opts?: { warnAt?: number; driftAt?: number },
): StreamStatus {
  const warnAt = opts?.warnAt ?? 1;
  const driftAt = opts?.driftAt ?? 5;
  if (anomalies >= driftAt) return "DRIFT";
  if (anomalies >= warnAt) return "WARN";
  return "OK";
}

/** Roll stream results up into the overall (worst) status + total anomalies. Pure. */
export function rollupIntegrity(streams: StreamResult[]): {
  status: StreamStatus;
  totalAnomalies: number;
} {
  let worst: StreamStatus = "OK";
  let total = 0;
  for (const s of streams) {
    total += s.anomalies;
    if (SEVERITY[s.status] > SEVERITY[worst]) worst = s.status;
  }
  return { status: worst, totalAnomalies: total };
}

// ─── Orchestrator (I/O) ──────────────────────────────────────────────────────
/**
 * Pure: is a day's revenue implausibly far from the trailing-median day? Catches
 * the 2026-06 10x sales inflation (and any future magnitude drift). Ignores
 * low-volume baselines (floor) so a quiet stretch doesn't false-positive. Tested.
 */
export function salesMagnitudeAnomaly(
  dayRevenue: number,
  medianRevenue: number,
  opts?: { highMult?: number; lowMult?: number; floor?: number },
): { anomalous: boolean; ratio: number } {
  const highMult = opts?.highMult ?? 4;
  const lowMult = opts?.lowMult ?? 0.2;
  const floor = opts?.floor ?? 1500;
  if (medianRevenue < floor || dayRevenue < 0) return { anomalous: false, ratio: 0 };
  const ratio = medianRevenue > 0 ? Math.round((dayRevenue / medianRevenue) * 100) / 100 : 0;
  return { anomalous: ratio >= highMult || (dayRevenue > 0 && ratio <= lowMult), ratio };
}

export async function runSystemIntegrityCheck(): Promise<IntegrityReport> {
  const streams: StreamResult[] = [];
  const notes: string[] = [];

  // 1. INVENTORY — app available-for-sale vs Extensiv pivot.
  try {
    const { runDriftReport } = await import("./inventory-drift-service");
    const d: any = await runDriftReport();
    const anomalies = (d.overThresholdCount ?? 0) + (d.staleCount ?? 0);
    streams.push({
      stream: "inventory",
      status: classifyStream(anomalies, { warnAt: 1, driftAt: 5 }),
      anomalies,
      checked: d.analyzed ?? 0,
      summary: `${d.overThresholdCount ?? 0} SKUs drift beyond ±${d.driftThreshold} and ${d.staleCount ?? 0} are stale (>${d.staleHours}h) vs Extensiv.`,
      worstOffenders: (d.flaggedItems ?? [])
        .slice(0, 5)
        .map((r: any) => ({ key: r.sku, detail: `drift ${r.drift} (afs ${r.afs} vs pivot ${r.pivot})` })),
    });
  } catch (e: any) {
    notes.push(`inventory check failed: ${e?.message ?? e}`);
  }

  // 2. AD-SPEND — trusted unified spend gaps + implausibly-high blended ROAS
  //    (the under-reported-spend signal that corrupts every downstream ROAS).
  try {
    const { getUnifiedPerformance } = await import("./unified-performance-service");
    const { isImplausibleBlendedRoas } = await import("./marketing-analytics-service");
    const v = await getUnifiedPerformance(30, Date.now());
    const blendedRoas = v.totalAdSpend && v.totalAdSpend > 0 ? (v.totalRevenue ?? 0) / v.totalAdSpend : 0;
    const implausible = isImplausibleBlendedRoas(blendedRoas);
    const anomalies = (v.dataGaps?.length ?? 0) + (implausible ? 1 : 0);
    streams.push({
      stream: "ad-spend",
      status: classifyStream(anomalies, { warnAt: 1, driftAt: 3 }),
      anomalies,
      checked: v.platforms?.length ?? 0,
      summary: implausible
        ? `Blended ROAS ${blendedRoas.toFixed(1)}x is implausibly high — ad spend is under-reported. ${v.dataGaps?.length ?? 0} feed gap(s).`
        : `${v.dataGaps?.length ?? 0} ad-spend feed gap(s); blended ROAS ${blendedRoas.toFixed(1)}x.`,
      worstOffenders: (v.dataGaps ?? []).slice(0, 5).map((g: string) => ({ key: "ad-spend", detail: g })),
    });
  } catch (e: any) {
    notes.push(`ad-spend check failed: ${e?.message ?? e}`);
  }

  // 3. FINANCIAL — open discrepancies (QB vs app / uploaded financials).
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const r: any = await db.execute(sql`
      SELECT count(*)::int AS n FROM financial_discrepancies
      WHERE lower(coalesce(status,'open')) NOT IN ('resolved','closed','dismissed','ok')`);
    const anomalies = Number((r.rows ?? r ?? [])[0]?.n ?? 0);
    streams.push({
      stream: "financial",
      status: classifyStream(anomalies, { warnAt: 1, driftAt: 3 }),
      anomalies,
      checked: anomalies,
      summary: `${anomalies} open financial discrepancy${anomalies === 1 ? "" : "ies"} awaiting reconciliation.`,
    });
  } catch (e: any) {
    notes.push(`financial check failed: ${e?.message ?? e}`);
  }

  // 4. SALES — duplicate orders (the 2026-06 10x inflation signal) + daily
  //    revenue magnitude vs the trailing-30d median (catches non-dup inflation).
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    // Duplicate detection is CHANNEL-AGNOSTIC on external_order_id (the canonical
    // physical identity). A channel-scoped check let the 2026-06 cross-channel
    // twins ($27k, same Shopify order stored as SHOPIFY + a relabeled AMAZON
    // row) slip through. Two arms: (1) any external id appearing >1× regardless
    // of channel; (2) Shopify orders sharing an order_name with NULL external id
    // (they escape the unique index).
    const dupRes: any = await db.execute(sql`
      SELECT count(*)::int AS dup_groups, coalesce(sum(c - 1),0)::int AS extra_rows
      FROM (
        SELECT count(*) AS c FROM sales_orders
        WHERE external_order_id IS NOT NULL AND order_date >= CURRENT_DATE - 7
        GROUP BY external_order_id HAVING count(*) > 1
        UNION ALL
        SELECT count(*) AS c FROM sales_orders
        WHERE external_order_id IS NULL AND order_name IS NOT NULL AND channel = 'SHOPIFY'
          AND order_date >= CURRENT_DATE - 7
        GROUP BY order_name HAVING count(*) > 1
      ) t`);
    const dupGroups = Number((dupRes.rows ?? dupRes ?? [])[0]?.dup_groups ?? 0);
    const extraRows = Number((dupRes.rows ?? dupRes ?? [])[0]?.extra_rows ?? 0);

    const magRes: any = await db.execute(sql`
      WITH daily AS (
        SELECT date(order_date) d, sum(coalesce(total_amount,0)) rev
        FROM sales_orders
        WHERE order_date >= CURRENT_DATE - 31 AND order_date < CURRENT_DATE
          AND upper(coalesce(status,'')) NOT IN ('CANCELLED','REFUNDED')
        GROUP BY 1)
      SELECT (SELECT rev FROM daily WHERE d = CURRENT_DATE - 1) AS yesterday,
             (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY rev) FROM daily) AS median`);
    const mrow = (magRes.rows ?? magRes ?? [])[0] ?? {};
    const yesterday = Number(mrow.yesterday ?? 0);
    const median = Number(mrow.median ?? 0);
    const mag = salesMagnitudeAnomaly(yesterday, median);

    const anomalies = dupGroups + (mag.anomalous ? 1 : 0);
    const offenders: Array<{ key: string; detail: string }> = [];
    if (dupGroups > 0)
      offenders.push({ key: "duplicate-orders", detail: `${dupGroups} order(s) duplicated (${extraRows} extra rows) in the last 7 days` });
    if (mag.anomalous)
      offenders.push({ key: "revenue-magnitude", detail: `Yesterday $${Math.round(yesterday).toLocaleString()} is ${mag.ratio}x the 30-day median $${Math.round(median).toLocaleString()}` });

    streams.push({
      stream: "sales",
      // ANY duplicate corrupts revenue reporting → hard DRIFT immediately.
      status: dupGroups > 0 ? "DRIFT" : classifyStream(anomalies, { warnAt: 1, driftAt: 2 }),
      anomalies,
      checked: 7,
      summary:
        dupGroups > 0
          ? `${dupGroups} duplicated order(s) detected (${extraRows} extra rows) — sales inflated. Run POST /api/system-integrity/resolve-sales.`
          : mag.anomalous
            ? `Yesterday's revenue is ${mag.ratio}x the 30-day median — investigate before trusting sales reports.`
            : `No duplicate orders; daily revenue within normal range of the 30-day median.`,
      worstOffenders: offenders,
    });
  } catch (e: any) {
    notes.push(`sales check failed: ${e?.message ?? e}`);
  }

  const { status, totalAnomalies } = rollupIntegrity(streams);
  const report: IntegrityReport = {
    generatedAt: new Date().toISOString(),
    status,
    totalAnomalies,
    streams,
    notes,
  };

  // Persist: latest report (app_settings) + an anomaly row per drifting stream
  // into the reconciliation ledger. Best-effort; never throws the caller.
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('system_integrity_latest', ${JSON.stringify(report)}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
    for (const s of streams.filter((x) => x.status !== "OK")) {
      await db.execute(sql`
        INSERT INTO data_reconciliation_log (data_type, entity_key, action, reason, source, created_at)
        VALUES ('system_integrity', ${s.stream}, ${s.status === "DRIFT" ? "DRIFT_DETECTED" : "WARN"},
                ${s.summary}, 'system-integrity-service', now())`);
    }
  } catch (e: any) {
    console.warn("[SystemIntegrity] persist failed:", e?.message ?? e);
  }

  return report;
}

/**
 * Self-heal: remove duplicate (channel, external_order_id) orders, keeping the
 * most-recently-updated canonical row. The partial unique index normally
 * prevents these, so this is a one-shot cleanup tool / safety net.
 */
export async function resolveSalesDuplicates(): Promise<{ rowsRemoved: number; linesRemoved: number }> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  // Two arms, matching the sweep's detection so nothing is detected-but-unfixable:
  //  (1) channel-agnostic external_order_id dups — keep the SHOPIFY row first
  //      (the canonical original; the relabeled twin is dropped), then the one
  //      with an order_name, then most-recent;
  //  (2) Shopify rows with NULL external id sharing an order_name.
  const dupSelect = sql`
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY external_order_id
        ORDER BY (channel = 'SHOPIFY') DESC, (order_name IS NOT NULL) DESC,
                 updated_at DESC NULLS LAST, id ASC) rn
      FROM sales_orders WHERE external_order_id IS NOT NULL
      UNION ALL
      SELECT id, row_number() OVER (PARTITION BY order_name
        ORDER BY updated_at DESC NULLS LAST, id ASC) rn
      FROM sales_orders
      WHERE external_order_id IS NULL AND order_name IS NOT NULL AND channel = 'SHOPIFY'
    ) t WHERE rn > 1`;
  const delLines: any = await db.execute(sql`DELETE FROM sales_order_lines WHERE sales_order_id IN (${dupSelect}) RETURNING id`);
  const delOrders: any = await db.execute(sql`DELETE FROM sales_orders WHERE id IN (${dupSelect}) RETURNING id`);
  const linesRemoved = (delLines.rows ?? delLines ?? []).length;
  const rowsRemoved = (delOrders.rows ?? delOrders ?? []).length;
  if (rowsRemoved > 0) {
    await db.execute(sql`
      INSERT INTO data_reconciliation_log (data_type, entity_key, action, reason, source, created_at)
      VALUES ('sales_dedup', 'sales_orders', 'CORRECTED',
              ${`Removed ${rowsRemoved} duplicate order row(s) + ${linesRemoved} line(s); kept canonical per (channel, external_order_id).`},
              'system-integrity-service', now())`).catch(() => {});
  }
  return { rowsRemoved, linesRemoved };
}

export async function getLatestIntegrityReport(): Promise<IntegrityReport | null> {
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const r: any = await db.execute(sql`SELECT value FROM app_settings WHERE key = 'system_integrity_latest'`);
    const rows = r.rows ?? r ?? [];
    if (!rows.length) return null;
    const v = rows[0].value;
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return null;
  }
}
