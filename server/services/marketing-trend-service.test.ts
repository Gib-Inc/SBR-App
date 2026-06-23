import { describe, it, expect } from "vitest";
import { withDeltas, getMarketingTrend, type MonthPoint } from "./marketing-trend-service";

const pt = (month: string, spend: number, roas: number | null): MonthPoint => ({
  month, spend, revenue: roas == null ? null : spend * roas, purchases: null,
  roas, cac: null,
});

describe("withDeltas", () => {
  it("computes ROAS direction vs the prior month with a ROAS", () => {
    const out = withDeltas([pt("2026-04", 1000, 3.0), pt("2026-05", 1200, 3.6), pt("2026-06", 800, 3.4)]);
    expect(out[0].roasDelta).toBeNull(); // no prior
    expect(out[0].dir).toBe("flat");
    expect(out[1].roasDelta).toBe(0.6);
    expect(out[1].dir).toBe("up");
    expect(out[1].spendDelta).toBe(200);
    expect(out[2].roasDelta).toBeCloseTo(-0.2, 5);
    expect(out[2].dir).toBe("down");
    expect(out[2].spendDelta).toBe(-400);
  });

  it("skips ROAS deltas across spend-only months (no revenue) but still tracks spend", () => {
    const out = withDeltas([pt("2026-04", 65000, null), pt("2026-06", 11500, 3.57)]);
    expect(out[0].roas).toBeNull();
    expect(out[1].roasDelta).toBeNull(); // prior month had no roas to compare
    expect(out[1].spendDelta).toBe(-53500); // big Meta pullback still visible
    expect(out[1].dir).toBe("flat");
  });

  it("treats a tiny ROAS wobble as flat", () => {
    const out = withDeltas([pt("2026-05", 100, 4.0), pt("2026-06", 100, 4.03)]);
    expect(out[1].dir).toBe("flat");
  });
});

describe("getMarketingTrend", () => {
  function mockDb(channelRows: any[], campaignRows: any[]) {
    let call = 0;
    return { execute: async () => ({ rows: call++ === 0 ? channelRows : campaignRows }) } as any;
  }

  it("groups channels + campaigns and sorts months", async () => {
    const ch = [
      { platform: "META", month: "2026-04", spend: 65000, revenue: null, purchases: null },
      { platform: "META", month: "2026-06", spend: 11545, revenue: 41263, purchases: 104 },
    ];
    const cp = [
      { platform: "META", campaign: "Reel 7", month: "2026-04", spend: 14641, revenue: null, purchases: null },
      { platform: "META", campaign: "CD | Sales", month: "2026-06", spend: 2962, revenue: 12586, purchases: 26 },
    ];
    const t = await getMarketingTrend(mockDb(ch, cp));
    expect(t.target).toBe(8);
    expect(t.months).toEqual(["2026-04", "2026-06"]);
    const meta = t.channels.find((c) => c.platform === "META")!;
    expect(meta.points.at(-1)!.roas).toBe(3.57);
    expect(meta.points.at(-1)!.cac).toBeCloseTo(111.01, 1);
    const cd = t.campaigns.find((c) => c.campaign === "CD | Sales")!;
    expect(cd.latestRoas).toBe(4.25);
  });
});
