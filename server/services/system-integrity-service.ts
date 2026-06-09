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
