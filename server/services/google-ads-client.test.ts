import { describe, expect, it } from "vitest";
import {
  aggregateGoogleDirectRows,
  getGoogleDirectFeedConfidence,
  isFreshGoogleDirectProtectedForPeriod,
  syncGoogleDirectSpend,
  type GoogleDirectRow,
} from "./google-ads-client";

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

const row = (
  metrics: NonNullable<GoogleDirectRow["metrics"]> = {},
  date = "2026-07-15",
): GoogleDirectRow => ({
  campaign: { id: "1", name: "Bigfoot" },
  segments: { date },
  metrics: { costMicros: "0", impressions: "0", clicks: "0", ...metrics },
});

const GOOGLE_DIRECT_ENV: Record<string, string> = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token",
  GOOGLE_ADS_CLIENT_ID: "client-id",
  GOOGLE_ADS_CLIENT_SECRET: "client-secret",
  GOOGLE_ADS_REFRESH_TOKEN: "refresh-token",
  GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "987-654-3210",
};

async function withGoogleEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const names = Object.keys({ ...GOOGLE_DIRECT_ENV, ...overrides });
  const saved = new Map(names.map((n) => [n, process.env[n]] as const));
  try {
    for (const name of names) {
      const value = name in overrides ? overrides[name] : GOOGLE_DIRECT_ENV[name];
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
    await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("Google direct Ads API feed", () => {
  it("maps campaign-level API rows into one daily snapshot, converting cost_micros to dollars", () => {
    const days = aggregateGoogleDirectRows([
      row({ costMicros: "12340000", impressions: "100", clicks: "8", conversions: 2, conversionsValue: 150.5 }),
      row({ costMicros: "7660000", impressions: "50", clicks: "4", conversions: 1, conversionsValue: 49.5 }),
    ], "2026-07-15", "2026-07-15");

    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      date: "2026-07-15",
      spend: 20, // (12,340,000 + 7,660,000) / 1e6
      impressions: 150,
      clicks: 12,
      conversions: 3,
      revenue: 200,
      status: "OK",
    });
    expect(days[0].raw).toMatchObject({ source: "google-direct-api", rowCount: 2, revenueBasis: "conversions_value" });
  });

  it("supersedes overlapping active GOOGLE snapshots before writing direct rows", async () => {
    const storage = makeStorage([
      { id: "manual", platform: "GOOGLE", periodStart: "2026-07-15", periodEnd: "2026-07-15", spend: 99, source: "upload:google-spend.csv" },
    ]);
    const result = await syncGoogleDirectSpend({
      storage: storage as any,
      now: new Date("2026-07-16T12:00:00Z"),
      client: {
        isDirectFeedConfigured: () => true,
        fetchDirectDailyRows: async () => [row({ costMicros: "20000000", impressions: "150" })],
      },
    });

    expect(result.status).toBe("success");
    expect(storage.snapshots.find((s) => s.id === "manual")).toMatchObject({ superseded: true, supersededByCsv: "google-direct-api" });
    const activeGoogle = storage.snapshots.filter((s) => !s.superseded && s.platform === "GOOGLE");
    expect(activeGoogle).toHaveLength(3);
    expect(activeGoogle.find((s) => s.periodStart === "2026-07-15")).toMatchObject({ source: "google-direct-api", spend: 20 });
  });

  it("is idempotent on re-sync: only one active GOOGLE row remains per day", async () => {
    const storage = makeStorage();
    const client = {
      isDirectFeedConfigured: () => true,
      fetchDirectDailyRows: async () => [row({ costMicros: "20000000", impressions: "150" })],
    };

    await syncGoogleDirectSpend({ storage: storage as any, client, now: new Date("2026-07-16T12:00:00Z") });
    await syncGoogleDirectSpend({ storage: storage as any, client, now: new Date("2026-07-16T12:00:00Z") });

    const activeByDay = storage.snapshots
      .filter((s) => !s.superseded && s.platform === "GOOGLE")
      .reduce<Record<string, number>>((acc, s) => {
        acc[s.periodStart] = (acc[s.periodStart] ?? 0) + 1;
        return acc;
      }, {});
    expect(activeByDay).toEqual({ "2026-07-13": 1, "2026-07-14": 1, "2026-07-15": 1 });
  });

  it("marks missing API days DATA_GAPPED rather than pretending they are clean zeros", async () => {
    const storage = makeStorage();
    await syncGoogleDirectSpend({
      storage: storage as any,
      now: new Date("2026-07-16T12:00:00Z"),
      client: {
        isDirectFeedConfigured: () => true,
        fetchDirectDailyRows: async () => [row({ costMicros: "20000000", impressions: "150" }, "2026-07-15")],
      },
    });

    const gapped = storage.snapshots.filter((s) => s.status === "DATA_GAPPED");
    expect(gapped.map((s) => s.periodStart)).toEqual(["2026-07-13", "2026-07-14"]);
    expect(gapped.every((s) => Array.isArray(s.dataGaps) && s.dataGaps[0].includes("not treated as a real zero"))).toBe(true);
  });

  it("does not let a gapped API day supersede an active manual GOOGLE row", async () => {
    const storage = makeStorage([
      { id: "manual", platform: "GOOGLE", periodStart: "2026-07-14", periodEnd: "2026-07-14", spend: 42, source: "upload:google-spend.csv" },
    ]);
    const result = await syncGoogleDirectSpend({
      storage: storage as any,
      now: new Date("2026-07-16T12:00:00Z"),
      client: {
        isDirectFeedConfigured: () => true,
        fetchDirectDailyRows: async () => [
          row({ costMicros: "20000000", impressions: "150" }, "2026-07-15"),
        ],
      },
    });

    expect(result.created).toBe(2);
    expect(storage.snapshots.find((s) => s.id === "manual")).toMatchObject({ superseded: false, spend: 42 });
    const july14 = storage.snapshots.filter((s) => s.platform === "GOOGLE" && s.periodStart === "2026-07-14");
    expect(july14).toHaveLength(1);
    expect(july14[0]).toMatchObject({ id: "manual", source: "upload:google-spend.csv" });
  });

  it("skips dark and quiet while awaiting credentials: no failure counted, no breaker tripped", async () => {
    const storage = makeStorage();
    await withGoogleEnv({ GOOGLE_ADS_LOGIN_CUSTOMER_ID: undefined }, async () => {
      const result = await syncGoogleDirectSpend({ storage: storage as any, now: new Date("2026-07-16T12:00:00Z") });
      expect(result).toMatchObject({ status: "skipped", reason: "awaiting_credentials", created: 0 });

      const confidence = await getGoogleDirectFeedConfidence({ storage: storage as any, now: new Date("2026-07-16T12:00:00Z") });
      expect(confidence.confidence).toBe("awaiting_credentials");
      expect(confidence.reason).toContain("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
    });
    expect(storage.snapshots).toHaveLength(0);
    expect(storage.logs).toHaveLength(0);
    expect(storage.settings.get("google_direct_consecutive_failures")).toBeUndefined();
    expect(storage.settings.get("google_direct_paused")).toBeUndefined();
  });

  it("reports direct feed confidence as actual only when a fresh direct snapshot exists (period_end = yesterday)", async () => {
    const storage = makeStorage([
      { platform: "GOOGLE", periodStart: "2026-07-15", periodEnd: "2026-07-15", spend: 20, source: "google-direct-api" },
    ]);
    await withGoogleEnv({}, async () => {
      const confidence = await getGoogleDirectFeedConfidence({ storage: storage as any, now: new Date("2026-07-16T12:00:00Z") });
      expect(confidence).toMatchObject({ confidence: "actual", latestPeriodEnd: "2026-07-15", daysOld: 1, source: "google-direct-api" });
    });
  });

  it("gapped rows cannot make the feed look fresh: all-gapped recent window → NOT actual and NOT protected", async () => {
    // Three recent direct rows, ALL DATA_GAPPED (the API returned nothing) —
    // there is no usable data, so confidence must not be "actual" and the
    // period must not be protected from a manual upload that could fill it.
    const storage = makeStorage([
      { id: "gap-1", platform: "GOOGLE", periodStart: "2026-07-13", periodEnd: "2026-07-13", spend: 0, source: "google-direct-api", status: "DATA_GAPPED" },
      { id: "gap-2", platform: "GOOGLE", periodStart: "2026-07-14", periodEnd: "2026-07-14", spend: 0, source: "google-direct-api", status: "DATA_GAPPED" },
      { id: "gap-3", platform: "GOOGLE", periodStart: "2026-07-15", periodEnd: "2026-07-15", spend: 0, source: "google-direct-api", status: "DATA_GAPPED" },
    ]);
    await withGoogleEnv({}, async () => {
      const confidence = await getGoogleDirectFeedConfidence({ storage: storage as any, now: new Date("2026-07-16T12:00:00Z") });
      expect(confidence.confidence).not.toBe("actual");
      expect(confidence.confidence).toBe("stale");
      // The reason names the gapped days so the operator sees WHICH days have no data.
      expect(confidence.reason).toContain("DATA_GAPPED");
      expect(confidence.reason).toContain("2026-07-15");
    });

    await expect(isFreshGoogleDirectProtectedForPeriod("2026-07-15", "2026-07-15", {
      storage: storage as any,
      now: new Date("2026-07-16T12:00:00Z"),
    })).resolves.toMatchObject({
      protected: false,
      overlappingDirectIds: [],
    });
  });

  it("mixed OK + gapped rows: verdicts come from the OK rows only", async () => {
    // Latest row by periodEnd is GAPPED (07-15); the freshest REAL data is
    // 07-14. Confidence/protection must be computed from the 07-14 OK row —
    // fresh as of 07-16 (2 days) — and the gapped 07-15 row must not protect
    // its own day.
    const storage = makeStorage([
      { id: "ok-1", platform: "GOOGLE", periodStart: "2026-07-14", periodEnd: "2026-07-14", spend: 25, source: "google-direct-api", status: "OK" },
      { id: "gap-1", platform: "GOOGLE", periodStart: "2026-07-15", periodEnd: "2026-07-15", spend: 0, source: "google-direct-api", status: "DATA_GAPPED" },
    ]);
    await withGoogleEnv({}, async () => {
      const confidence = await getGoogleDirectFeedConfidence({ storage: storage as any, now: new Date("2026-07-16T12:00:00Z") });
      // Judged from the OK row (07-14, 2 days old) → still actual; the gapped
      // 07-15 row is excluded from the freshness computation.
      expect(confidence).toMatchObject({ confidence: "actual", latestPeriodEnd: "2026-07-14" });
    });

    // The OK day stays protected against manual double-counting…
    await expect(isFreshGoogleDirectProtectedForPeriod("2026-07-14", "2026-07-14", {
      storage: storage as any,
      now: new Date("2026-07-16T12:00:00Z"),
    })).resolves.toMatchObject({
      protected: true,
      overlappingDirectIds: ["ok-1"],
      latestPeriodEnd: "2026-07-14",
    });

    // …but the gapped day is NOT protected — only OK rows can overlap-protect.
    await expect(isFreshGoogleDirectProtectedForPeriod("2026-07-15", "2026-07-15", {
      storage: storage as any,
      now: new Date("2026-07-16T12:00:00Z"),
    })).resolves.toMatchObject({
      protected: false,
      overlappingDirectIds: [],
    });
  });

  it("protects fresh direct periods from later manual Google uploads but releases stale periods", async () => {
    const storage = makeStorage([
      { id: "direct", platform: "GOOGLE", periodStart: "2026-07-15", periodEnd: "2026-07-15", spend: 20, source: "google-direct-api" },
    ]);

    await expect(isFreshGoogleDirectProtectedForPeriod("2026-07-15", "2026-07-15", {
      storage: storage as any,
      now: new Date("2026-07-16T12:00:00Z"),
    })).resolves.toMatchObject({
      protected: true,
      overlappingDirectIds: ["direct"],
      latestPeriodEnd: "2026-07-15",
    });

    await expect(isFreshGoogleDirectProtectedForPeriod("2026-07-15", "2026-07-15", {
      storage: storage as any,
      now: new Date("2026-07-20T12:00:00Z"),
    })).resolves.toMatchObject({
      protected: false,
      overlappingDirectIds: ["direct"],
      latestPeriodEnd: "2026-07-15",
    });
  });
});
