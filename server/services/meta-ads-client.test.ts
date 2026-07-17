import { describe, expect, it } from "vitest";
import {
  aggregateMetaDirectRows,
  getMetaDirectFeedConfidence,
  isFreshMetaDirectProtectedForPeriod,
  syncMetaDirectSpend,
  type MetaDirectInsightRow,
} from "./meta-ads-client";

function makeStorage(initial: any[] = []) {
  const snapshots = initial.map((s, i) => ({ id: s.id ?? `snap-${i}`, superseded: false, ...s }));
  const settings = new Map<string, string>();
  return {
    snapshots,
    settings,
    logs: [] as any[],
    recon: [] as any[],
    async getAppSetting(key: string) {
      return settings.get(key) ?? null;
    },
    async setAppSetting(key: string, value: string) {
      settings.set(key, value);
    },
    async getActiveMarketingSpendSnapshots() {
      return snapshots.filter((s) => !s.superseded);
    },
    async getMarketingSpendSnapshotsInRange(start: string, end: string) {
      return snapshots.filter((s) => !s.superseded && s.periodStart <= end && s.periodEnd >= start);
    },
    async markMarketingSpendSnapshotsSuperseded(ids: string[], by: string) {
      for (const snap of snapshots) {
        if (ids.includes(snap.id)) {
          snap.superseded = true;
          snap.supersededByCsv = by;
        }
      }
    },
    async createMarketingSpendSnapshot(s: any) {
      const snap = { id: `snap-${snapshots.length}`, superseded: false, ...s };
      snapshots.push(snap);
      return snap;
    },
    async createDataReconciliationLog(entries: any[]) {
      this.recon.push(...entries);
    },
    async createSystemLog(log: any) {
      this.logs.push(log);
      return log;
    },
  };
}

const row = (overrides: Partial<MetaDirectInsightRow>): MetaDirectInsightRow => ({
  date_start: "2026-07-15",
  date_stop: "2026-07-15",
  spend: "0",
  impressions: "0",
  ...overrides,
});

describe("Meta direct Marketing API feed", () => {
  it("maps ad-level API rows into one daily snapshot with summed spend", () => {
    const days = aggregateMetaDirectRows([
      row({ spend: "12.34", impressions: "100", reach: "80", actions: [{ action_type: "purchase", value: "2" }], purchase_roas: [{ value: "3" }] }),
      row({ spend: "7.66", impressions: "50", reach: "40", actions: [{ action_type: "omni_purchase", value: "1" }], purchase_roas: [{ value: "2" }] }),
    ], "2026-07-15", "2026-07-15");

    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      date: "2026-07-15",
      spend: 20,
      impressions: 150,
      conversions: 3,
      revenue: 50,
      status: "OK",
    });
  });

  it("supersedes overlapping active Meta snapshots before writing direct rows", async () => {
    const storage = makeStorage([
      { id: "manual", platform: "META", periodStart: "2026-07-15", periodEnd: "2026-07-15", spend: 99, source: "manual:meta-tracker" },
    ]);
    const result = await syncMetaDirectSpend({
      storage: storage as any,
      now: new Date("2026-07-16T12:00:00Z"),
      client: {
        isDirectFeedConfigured: () => true,
        fetchDirectDailyInsights: async () => [row({ spend: "20", impressions: "150" })],
      },
    });

    expect(result.status).toBe("success");
    expect(storage.snapshots.find((s) => s.id === "manual")).toMatchObject({ superseded: true, supersededByCsv: "meta-direct-api" });
    const activeMeta = storage.snapshots.filter((s) => !s.superseded && s.platform === "META");
    expect(activeMeta).toHaveLength(3);
    expect(activeMeta.find((s) => s.periodStart === "2026-07-15")).toMatchObject({ source: "meta-direct-api", spend: 20 });
  });

  it("is idempotent on re-sync: only one active Meta row remains per day", async () => {
    const storage = makeStorage();
    const client = {
      isDirectFeedConfigured: () => true,
      fetchDirectDailyInsights: async () => [row({ spend: "20", impressions: "150" })],
    };

    await syncMetaDirectSpend({ storage: storage as any, client, now: new Date("2026-07-16T12:00:00Z") });
    await syncMetaDirectSpend({ storage: storage as any, client, now: new Date("2026-07-16T12:00:00Z") });

    const activeByDay = storage.snapshots
      .filter((s) => !s.superseded && s.platform === "META")
      .reduce<Record<string, number>>((acc, s) => {
        acc[s.periodStart] = (acc[s.periodStart] ?? 0) + 1;
        return acc;
      }, {});
    expect(activeByDay).toEqual({ "2026-07-13": 1, "2026-07-14": 1, "2026-07-15": 1 });
  });

  it("marks missing API days DATA_GAPPED rather than pretending they are clean zeros", async () => {
    const storage = makeStorage();
    await syncMetaDirectSpend({
      storage: storage as any,
      now: new Date("2026-07-16T12:00:00Z"),
      client: {
        isDirectFeedConfigured: () => true,
        fetchDirectDailyInsights: async () => [row({ date_start: "2026-07-15", date_stop: "2026-07-15", spend: "20", impressions: "150" })],
      },
    });

    const gapped = storage.snapshots.filter((s) => s.status === "DATA_GAPPED");
    expect(gapped.map((s) => s.periodStart)).toEqual(["2026-07-13", "2026-07-14"]);
    expect(gapped.every((s) => Array.isArray(s.dataGaps) && s.dataGaps[0].includes("not treated as a real zero"))).toBe(true);
  });

  it("does not let a gapped API day supersede an active manual Meta row", async () => {
    const storage = makeStorage([
      { id: "manual", platform: "META", periodStart: "2026-07-14", periodEnd: "2026-07-14", spend: 42, source: "manual:meta-tracker" },
    ]);
    const result = await syncMetaDirectSpend({
      storage: storage as any,
      now: new Date("2026-07-16T12:00:00Z"),
      client: {
        isDirectFeedConfigured: () => true,
        fetchDirectDailyInsights: async () => [
          row({ date_start: "2026-07-15", date_stop: "2026-07-15", spend: "20", impressions: "150" }),
        ],
      },
    });

    expect(result.created).toBe(2);
    expect(storage.snapshots.find((s) => s.id === "manual")).toMatchObject({ superseded: false, spend: 42 });
    const july14 = storage.snapshots.filter((s) => s.platform === "META" && s.periodStart === "2026-07-14");
    expect(july14).toHaveLength(1);
    expect(july14[0]).toMatchObject({ id: "manual", source: "manual:meta-tracker" });
  });

  it("reports direct feed confidence as actual only when a fresh direct snapshot exists", async () => {
    const storage = makeStorage([
      { platform: "META", periodStart: "2026-07-15", periodEnd: "2026-07-15", spend: 20, source: "meta-direct-api" },
    ]);
    const oldToken = process.env.META_ACCESS_TOKEN;
    const oldAccount = process.env.META_AD_ACCOUNT_ID;
    process.env.META_ACCESS_TOKEN = "token";
    process.env.META_AD_ACCOUNT_ID = "act_1";
    try {
      const confidence = await getMetaDirectFeedConfidence({ storage: storage as any, now: new Date("2026-07-16T12:00:00Z") });
      expect(confidence).toMatchObject({ confidence: "actual", latestPeriodEnd: "2026-07-15", source: "meta-direct-api" });
    } finally {
      if (oldToken == null) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = oldToken;
      if (oldAccount == null) delete process.env.META_AD_ACCOUNT_ID;
      else process.env.META_AD_ACCOUNT_ID = oldAccount;
    }
  });

  it("protects fresh direct periods from later manual Meta uploads but releases stale periods", async () => {
    const storage = makeStorage([
      { id: "direct", platform: "META", periodStart: "2026-07-15", periodEnd: "2026-07-15", spend: 20, source: "meta-direct-api" },
    ]);

    await expect(isFreshMetaDirectProtectedForPeriod("2026-07-15", "2026-07-15", {
      storage: storage as any,
      now: new Date("2026-07-16T12:00:00Z"),
    })).resolves.toMatchObject({
      protected: true,
      overlappingDirectIds: ["direct"],
      latestPeriodEnd: "2026-07-15",
    });

    await expect(isFreshMetaDirectProtectedForPeriod("2026-07-15", "2026-07-15", {
      storage: storage as any,
      now: new Date("2026-07-20T12:00:00Z"),
    })).resolves.toMatchObject({
      protected: false,
      overlappingDirectIds: ["direct"],
      latestPeriodEnd: "2026-07-15",
    });
  });
});
