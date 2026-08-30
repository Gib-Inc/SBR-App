import { describe, it, expect, vi, beforeEach } from "vitest";

// runTruthReport issues a fixed, ordered list of db.execute() calls:
// 0 V1, 1 V2b, 2 V3, 3 V4, 4 V5 (one query for all platforms), 5 ledger stats,
// 6 OUTLIER (29 zero-filled daily revenue rows),
// 7 INSERT INTO truth_reports (the service's only write — its own table).
// getLatestTruthReport / hasRecentTruthReport are single reads.
const h = vi.hoisted(() => ({
  execMock: vi.fn(),
  metaConfidenceMock: vi.fn(),
}));
vi.mock("../db", () => ({ db: { execute: (...args: any[]) => h.execMock(...args) } }));
vi.mock("./meta-ads-client", () => ({
  getMetaDirectFeedConfidence: (...args: any[]) => h.metaConfidenceMock(...args),
}));

import {
  runTruthReport,
  getLatestTruthReport,
  hasRecentTruthReport,
  rollupTruth,
  classifyFeedAge,
  V1_SQL,
  V2B_SQL,
  V3_SQL,
  V4_SQL,
  V5_SQL,
  LEDGER_STATS_SQL,
  OUTLIER_SQL,
  classifyDailyOutlier,
  type TruthCheck,
} from "./truth-monitor-service";

const CLEAN_META_CONFIDENCE = {
  feed: "meta-direct",
  confidence: "actual",
  latestPeriodEnd: "2026-07-15",
  daysOld: 1,
  source: "meta-direct-api",
  reason: "Meta direct feed is fresh.",
};

function makeResults(over: Partial<Record<number, any>> = {}): any[] {
  const base: any[] = [
    [], // 0 V1 — no cross-channel twins
    [], // 1 V2b — no overlapping active windows
    [], // 2 V3 — no duplicate decrements
    [], // 3 V4 — no shipped lines with qty_shipped=0
    [
      // 4 V5 — per-platform latest ACTIVE snapshot age
      { platform: "META", latest_period_end: "2026-07-15", days_old: 1 },
      { platform: "GOOGLE", latest_period_end: "2026-07-14", days_old: 2 },
      { platform: "AMAZON", latest_period_end: "2026-07-16", days_old: 0 },
    ],
    [{ total_rows: 120, rows_24h: 12, dedup_skips_24h: 3 }], // 5 ledger stats
    // 6 OUTLIER — 28 healthy trailing days + a healthy yesterday
    Array.from({ length: 29 }, (_, i) => ({ d: `2026-07-${String(i + 1).padStart(2, "0")}`, total: 8000 })),
    [{ id: "report-1", run_at: "2026-07-16T14:00:00.000Z" }], // 7 INSERT ... RETURNING
  ];
  for (const [k, v] of Object.entries(over)) base[Number(k)] = v;
  return base;
}

function primeExec(results: any[]) {
  h.execMock.mockReset();
  for (const r of results) {
    if (r instanceof Error) h.execMock.mockRejectedValueOnce(r);
    else h.execMock.mockResolvedValueOnce(r);
  }
}

const byId = (report: { checks: TruthCheck[] }, id: string) => report.checks.find((c) => c.id === id);

beforeEach(() => {
  h.execMock.mockReset();
  h.metaConfidenceMock.mockReset();
  h.metaConfidenceMock.mockResolvedValue(CLEAN_META_CONFIDENCE);
});

// ─── Classifier (pure) ───────────────────────────────────────────────────────

describe("rollupTruth (overall classifier)", () => {
  const mk = (status: TruthCheck["status"]) => ({ status });

  it("is PASS when every check passes", () => {
    expect(rollupTruth([mk("PASS"), mk("PASS"), mk("PASS")])).toBe("PASS");
  });
  it("is WARN when the worst check is WARN", () => {
    expect(rollupTruth([mk("PASS"), mk("WARN"), mk("PASS")])).toBe("WARN");
  });
  it("is FAIL when any check fails, even among WARNs", () => {
    expect(rollupTruth([mk("WARN"), mk("FAIL"), mk("PASS")])).toBe("FAIL");
  });
  it("treats an empty check list as PASS", () => {
    expect(rollupTruth([])).toBe("PASS");
  });
});

describe("classifyDailyOutlier (graded revenue bounds)", () => {
  const healthy = Array.from({ length: 28 }, () => 8000);

  it("passes a normal day against a healthy trailing median", () => {
    const r = classifyDailyOutlier(7500, healthy);
    expect(r.status).toBe("PASS");
    expect(r.median).toBe(8000);
  });
  it("FAILS a zero/collapsed day (the ingestion-outage detector)", () => {
    expect(classifyDailyOutlier(0, healthy).status).toBe("FAIL");
    expect(classifyDailyOutlier(1500, healthy).status).toBe("FAIL"); // <0.2x
  });
  it("WARNs a soft day between 0.2x and 0.5x median", () => {
    expect(classifyDailyOutlier(3000, healthy).status).toBe("WARN");
  });
  it("WARNs a 2.5-4x spike and FAILS beyond 4x", () => {
    expect(classifyDailyOutlier(24000, healthy).status).toBe("WARN");
    expect(classifyDailyOutlier(40000, healthy).status).toBe("FAIL");
  });
  it("never grades on thin history (<14 trailing days) — WARN, not PASS", () => {
    const r = classifyDailyOutlier(8000, Array.from({ length: 10 }, () => 8000));
    expect(r.status).toBe("WARN");
    expect(r.reason).toContain("insufficient history");
  });
  it("suspends grading when the trailing window itself is degraded (median < $500)", () => {
    const r = classifyDailyOutlier(0, Array.from({ length: 28 }, () => 0));
    expect(r.status).toBe("WARN");
    expect(r.reason).toContain("grading suspended");
  });
});

describe("classifyFeedAge (V5 freshness thresholds)", () => {
  it("passes at 0–3 days old", () => {
    expect(classifyFeedAge(0).status).toBe("PASS");
    expect(classifyFeedAge(3).status).toBe("PASS");
  });
  it("warns above 3 days, up to 7", () => {
    expect(classifyFeedAge(4).status).toBe("WARN");
    expect(classifyFeedAge(7).status).toBe("WARN");
  });
  it("fails above 7 days", () => {
    expect(classifyFeedAge(8).status).toBe("FAIL");
    expect(classifyFeedAge(30).status).toBe("FAIL");
  });
  it("fails when the platform has no active snapshot at all (never fabricates freshness)", () => {
    const r = classifyFeedAge(null);
    expect(r.status).toBe("FAIL");
    expect(r.reason).toContain("no ACTIVE spend snapshot");
  });
});

// ─── SQL shape (read-only + exact semantics) ────────────────────────────────

describe("V-suite SQL shape", () => {
  const ALL = { V1_SQL, V2B_SQL, V3_SQL, V4_SQL, V5_SQL, LEDGER_STATS_SQL, OUTLIER_SQL };

  it("every check query is a read-only SELECT (zero writes to business tables)", () => {
    for (const [name, query] of Object.entries(ALL)) {
      expect(query.trim().toUpperCase().startsWith("SELECT"), `${name} must start with SELECT`).toBe(true);
      expect(query, `${name} must not write`).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
    }
  });

  it("V1 detects external order ids spanning multiple channels, excluding cancelled orders", () => {
    expect(V1_SQL).toContain("FROM sales_orders");
    expect(V1_SQL).toContain("external_order_id IS NOT NULL");
    expect(V1_SQL).toContain("status NOT IN ('CANCELLED')");
    expect(V1_SQL).toContain("HAVING count(DISTINCT channel) > 1");
  });

  it("V2b only pairs ACTIVE (superseded=false) snapshots on the same platform with overlapping windows", () => {
    expect(V2B_SQL).toContain("FROM marketing_spend_snapshots a");
    expect(V2B_SQL).toContain("a.platform = b.platform");
    expect(V2B_SQL).toContain("a.superseded = false AND b.superseded = false");
    // The standard interval-overlap predicate — disjoint windows do NOT match.
    expect(V2B_SQL).toContain("a.period_start <= b.period_end AND b.period_start <= a.period_end");
    // a.id < b.id prevents self-pairs and double-counted (A,B)/(B,A) pairs.
    expect(V2B_SQL).toContain("a.id < b.id");
  });

  it("V3 scopes to SALES_ORDER_CREATED in the last 7 days at (orderId, itemId) grain", () => {
    expect(V3_SQL).toContain("FROM audit_logs");
    expect(V3_SQL).toContain("event_type = 'SALES_ORDER_CREATED'");
    expect(V3_SQL).toContain("interval '7 days'");
    expect(V3_SQL).toContain("HAVING count(*) > 1");
    // Grain: orderId alone flags every multi-line order (verified on prod);
    // a duplicate DECREMENT is the same order hitting the same item twice.
    expect(V3_SQL).toContain("GROUP BY details->>'orderId', details->>'itemId'");
  });

  it("V4 joins lines to SHIPPED/DELIVERED orders where qty_shipped is 0 (null-safe)", () => {
    expect(V4_SQL).toContain("FROM sales_order_lines l");
    expect(V4_SQL).toContain("o.status IN ('SHIPPED','DELIVERED')");
    expect(V4_SQL).toContain("coalesce(l.qty_shipped, 0) = 0");
  });

  it("V5 reads latest ACTIVE period_end per platform", () => {
    expect(V5_SQL).toContain("superseded = false");
    expect(V5_SQL).toContain("max(period_end)");
    expect(V5_SQL).toContain("GROUP BY upper(platform)");
  });

  it("ledger stats read the movement ledger and DEDUP_SKIP audit rows over 24h", () => {
    expect(LEDGER_STATS_SQL).toContain("FROM inventory_movement_ledger");
    expect(LEDGER_STATS_SQL).toContain("details->>'dedupAction' = 'DEDUP_SKIP'");
    expect(LEDGER_STATS_SQL).toContain("interval '24 hours'");
  });
});

// ─── Orchestrator ────────────────────────────────────────────────────────────

describe("runTruthReport", () => {
  it("reports overall PASS with every check present when all queries are clean", async () => {
    primeExec(makeResults());
    const { report, persisted } = await runTruthReport();

    expect(report.overall).toBe("PASS");
    expect(persisted).toBe(true);
    expect(report.id).toBe("report-1");
    expect(report.checks.map((c) => c.id)).toEqual([
      "V1", "V2b", "V3", "V4", "V5-META", "V5-GOOGLE", "V5-AMAZON", "LEDGER", "OUTLIER",
    ]);
    for (const check of report.checks) expect(check.status).toBe("PASS");
    // 7 check reads + 1 report insert.
    expect(h.execMock).toHaveBeenCalledTimes(8);
  });

  it("includes the Meta direct-feed confidence verdict on the META check", async () => {
    primeExec(makeResults());
    const { report } = await runTruthReport();
    const meta = byId(report, "V5-META")!;
    expect(meta.details?.metaDirectConfidence).toEqual(CLEAN_META_CONFIDENCE);
    expect(meta.summary).toContain("actual");
  });

  it("reports GOOGLE's honest state (no direct feed; manual/QB fallback) without inventing a confidence", async () => {
    primeExec(makeResults());
    const { report } = await runTruthReport();
    const google = byId(report, "V5-GOOGLE")!;
    expect(google.details?.feedNote).toBe("no direct feed; manual/QB fallback");
    expect(google.summary).toContain("manual/QB fallback");
    expect(google.details).not.toHaveProperty("metaDirectConfidence");
    expect(h.metaConfidenceMock).toHaveBeenCalledTimes(1); // META only
  });

  it("omits V5-AMAZON when Amazon has no snapshots, but always emits META and GOOGLE", async () => {
    primeExec(makeResults({
      4: [{ platform: "META", latest_period_end: "2026-07-15", days_old: 1 }],
    }));
    const { report } = await runTruthReport();
    expect(byId(report, "V5-AMAZON")).toBeUndefined();
    expect(byId(report, "V5-META")).toBeTruthy();
    const google = byId(report, "V5-GOOGLE")!;
    // GOOGLE with no snapshot at all is a FAIL — its truth is "no data".
    expect(google.status).toBe("FAIL");
    expect(google.details?.daysOld).toBeNull();
  });

  it("fails V1 (and the report) on cross-channel order twins", async () => {
    primeExec(makeResults({
      0: [{ external_order_id: "SHOP-1001", channels: 2, total_groups: 3 }],
    }));
    const { report } = await runTruthReport();
    const v1 = byId(report, "V1")!;
    expect(v1.status).toBe("FAIL");
    expect(v1.summary).toContain("3");
    expect(report.overall).toBe("FAIL");
  });

  it("fails V2b on overlapping ACTIVE spend windows", async () => {
    primeExec(makeResults({
      1: [{
        platform: "META", snapshot_a: "a", snapshot_b: "b",
        a_start: "2026-07-01", a_end: "2026-07-10",
        b_start: "2026-07-05", b_end: "2026-07-12",
        total_pairs: 1,
      }],
    }));
    const { report } = await runTruthReport();
    expect(byId(report, "V2b")!.status).toBe("FAIL");
    expect(report.overall).toBe("FAIL");
  });

  it("fails V3 when the ledger dedup proof is breached", async () => {
    primeExec(makeResults({
      2: [{ order_id: "o-1", item_id: "i-1", decrements: 2, total_groups: 1 }],
    }));
    const { report } = await runTruthReport();
    const v3 = byId(report, "V3")!;
    expect(v3.status).toBe("FAIL");
    expect((v3.details?.samples as any[])[0]).toEqual({ orderId: "o-1", itemId: "i-1", decrements: 2 });
  });

  it("warns (not fails) on V4 with the true line count and top SKUs", async () => {
    primeExec(makeResults({
      3: [
        { sku: "#301-REP-M1", lines: 5, total_lines: 8 },
        { sku: "#302-REP-M1", lines: 3, total_lines: 8 },
      ],
    }));
    const { report } = await runTruthReport();
    const v4 = byId(report, "V4")!;
    expect(v4.status).toBe("WARN");
    expect(v4.summary).toContain("8");
    expect(v4.details?.topSkus).toEqual([
      { sku: "#301-REP-M1", lines: 5 },
      { sku: "#302-REP-M1", lines: 3 },
    ]);
    expect(report.overall).toBe("WARN"); // WARN does not escalate to FAIL
  });

  it("classifies stale feeds per platform by age", async () => {
    primeExec(makeResults({
      4: [
        { platform: "META", latest_period_end: "2026-07-08", days_old: 8 },
        { platform: "GOOGLE", latest_period_end: "2026-07-11", days_old: 5 },
        { platform: "AMAZON", latest_period_end: "2026-07-15", days_old: 1 },
      ],
    }));
    const { report } = await runTruthReport();
    expect(byId(report, "V5-META")!.status).toBe("FAIL"); // >7d
    expect(byId(report, "V5-GOOGLE")!.status).toBe("WARN"); // >3d
    expect(byId(report, "V5-AMAZON")!.status).toBe("PASS");
    expect(report.overall).toBe("FAIL");
  });

  it("reports ledger stats as informational PASS with numbers straight from the query", async () => {
    primeExec(makeResults());
    const { report } = await runTruthReport();
    const ledger = byId(report, "LEDGER")!;
    expect(ledger.status).toBe("PASS");
    expect(ledger.details).toEqual({ totalRows: 120, rows24h: 12, dedupSkips24h: 3 });
    expect(ledger.summary).toContain("120");
  });

  it("a check that ERRORS reports FAIL with the error message — never silently absent", async () => {
    primeExec(makeResults({ 2: new Error("relation audit_logs does not exist") }));
    const { report, persisted } = await runTruthReport();

    const v3 = byId(report, "V3")!;
    expect(v3.status).toBe("FAIL");
    expect(v3.error).toBe("relation audit_logs does not exist");
    expect(v3.summary).toContain("relation audit_logs does not exist");
    // Every other check still ran and is present.
    expect(report.checks.map((c) => c.id)).toEqual([
      "V1", "V2b", "V3", "V4", "V5-META", "V5-GOOGLE", "V5-AMAZON", "LEDGER", "OUTLIER",
    ]);
    expect(report.overall).toBe("FAIL");
    expect(persisted).toBe(true);
  });

  it("still emits FAILed META and GOOGLE checks when the V5 query itself errors", async () => {
    primeExec(makeResults({ 4: new Error("timeout acquiring connection") }));
    const { report } = await runTruthReport();
    const meta = byId(report, "V5-META")!;
    const google = byId(report, "V5-GOOGLE")!;
    expect(meta.status).toBe("FAIL");
    expect(meta.error).toBe("timeout acquiring connection");
    expect(google.status).toBe("FAIL");
    expect(report.overall).toBe("FAIL");
  });

  it("keeps the META age classification honest when only the confidence lookup fails", async () => {
    h.metaConfidenceMock.mockRejectedValueOnce(new Error("meta client exploded"));
    primeExec(makeResults());
    const { report } = await runTruthReport();
    const meta = byId(report, "V5-META")!;
    expect(meta.status).toBe("PASS"); // age said fresh; confidence is supplementary
    expect(meta.details?.metaDirectConfidenceError).toBe("meta client exploded");
    expect(meta.summary).toContain("meta client exploded");
  });

  it("returns the report un-persisted (persisted=false) when the INSERT fails, without throwing", async () => {
    primeExec(makeResults({ 7: new Error("permission denied for table truth_reports") }));
    const { report, persisted, persistError } = await runTruthReport();
    expect(persisted).toBe(false);
    expect(persistError).toContain("permission denied");
    expect(report.overall).toBe("PASS");
    expect(report.id).toBeUndefined();
  });

  it("unwraps node-postgres style { rows } results the same as bare arrays", async () => {
    const wrapped = makeResults().map((r) => (r instanceof Error ? r : { rows: r }));
    primeExec(wrapped);
    const { report, persisted } = await runTruthReport();
    expect(report.overall).toBe("PASS");
    expect(persisted).toBe(true);
    expect(report.id).toBe("report-1");
  });
});

// ─── Readers ─────────────────────────────────────────────────────────────────

describe("getLatestTruthReport / hasRecentTruthReport", () => {
  it("maps the latest persisted row into a TruthReport", async () => {
    primeExec([[{
      id: "report-9",
      run_at: "2026-07-16T14:00:00.000Z",
      overall: "WARN",
      checks: [{ id: "V4", name: "Shipped lines with qty_shipped = 0", status: "WARN", summary: "289 line(s)…" }],
    }]]);
    const report = await getLatestTruthReport();
    expect(report).toMatchObject({ id: "report-9", overall: "WARN" });
    expect(report!.checks).toHaveLength(1);
    expect(report!.runAt).toBe("2026-07-16T14:00:00.000Z");
  });

  it("parses checks stored as a JSON string", async () => {
    primeExec([[{
      id: "report-9",
      run_at: "2026-07-16T14:00:00.000Z",
      overall: "PASS",
      checks: JSON.stringify([{ id: "V1", name: "Cross-channel order twins", status: "PASS", summary: "clean" }]),
    }]]);
    const report = await getLatestTruthReport();
    expect(report!.checks[0].id).toBe("V1");
  });

  it("returns null when no report has ever been persisted", async () => {
    primeExec([[]]);
    expect(await getLatestTruthReport()).toBeNull();
  });

  it("hasRecentTruthReport reflects the 24h count", async () => {
    primeExec([[{ n: 1 }]]);
    expect(await hasRecentTruthReport()).toBe(true);
    primeExec([[{ n: 0 }]]);
    expect(await hasRecentTruthReport()).toBe(false);
  });
});
