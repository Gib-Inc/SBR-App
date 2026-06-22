/**
 * COUNT.M Weekly Reorder Digest — the CEO's "tell each vendor what we need."
 *
 * Once a week it computes reorder needs, groups them by vendor, and writes a
 * digest (system_logs REORDER_DIGEST) so Matt gets a Monday "here's what each
 * vendor needs" list to approve. Draft-for-approval by design: it notifies Matt,
 * who then sends the per-vendor POs (the existing create/send flow) — it does NOT
 * auto-email vendors. Idempotent per ISO week.
 */
import { storage } from "../storage";
import { db } from "../db";
import { computeReorderNeeds, groupNeedsByVendor } from "./reorder-service";

/** "Now" as Mountain-Time wall clock, so day-of-week + the week key are local. */
function nowMountain(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Denver" }));
}

/** The date (YYYY-MM-DD) of this week's Monday in MT — the idempotency key. */
function weekKeyOf(mt: Date): string {
  const day = mt.getDay(); // 0 Sun .. 6 Sat
  const monday = new Date(mt);
  monday.setDate(mt.getDate() + (day === 0 ? -6 : 1 - day));
  return monday.toISOString().slice(0, 10);
}

export interface DigestResult {
  ran: boolean; skipped?: string; weekKey: string;
  vendors?: number; toOrder?: number; stockout?: number; estCost?: number;
}

export async function runWeeklyReorderDigest(
  opts: { force?: boolean; mondayOnly?: boolean } = {},
): Promise<DigestResult> {
  const mt = nowMountain();
  const weekKey = weekKeyOf(mt);
  try {
    if (opts.mondayOnly && mt.getDay() !== 1) return { ran: false, skipped: "not Monday", weekKey };
    if (!opts.force) {
      const prior = await storage.getAllSystemLogs({ type: "REORDER" });
      if (prior.some((l: any) => l.code === "REORDER_DIGEST" && (l.details as any)?.weekKey === weekKey)) {
        return { ran: false, skipped: "already generated this week", weekKey };
      }
    }

    const needs = await computeReorderNeeds(db);
    const byVendor = groupNeedsByVendor(needs);
    const toOrder = needs.filter((n) => n.needed > 0).length;
    const stockout = needs.filter((n) => n.urgency === "STOCKOUT").length;
    const estCost = Math.round(byVendor.reduce((s, v) => s + v.estCost, 0) * 100) / 100;

    await storage.createSystemLog({
      type: "REORDER",
      severity: stockout > 0 ? "WARN" : "INFO",
      code: "REORDER_DIGEST",
      message: `Weekly reorder digest: ${byVendor.length} vendors, ${toOrder} SKUs to order, ${stockout} stockouts, ~$${estCost.toLocaleString()}`,
      details: {
        weekKey,
        generatedAt: mt.toISOString(),
        summary: { vendors: byVendor.length, toOrder, stockout, estCost },
        // Compact per-vendor list for the digest UI / email draft.
        byVendor: byVendor.map((v) => ({
          vendorId: v.vendorId, vendorName: v.vendorName, topUrgency: v.topUrgency,
          lineCount: v.lineCount, estCost: v.estCost,
          lines: v.lines.map((l) => ({ sku: l.sku, name: l.name, suggestedOrderQty: l.suggestedOrderQty, urgency: l.urgency, weeksCover: l.weeksCover, seasonalFactor: l.seasonalFactor })),
        })),
      } as any,
    }).catch(() => {});

    return { ran: true, weekKey, vendors: byVendor.length, toOrder, stockout, estCost };
  } catch (e: any) {
    await storage.createSystemLog({
      type: "REORDER", severity: "ERROR", code: "REORDER_DIGEST_ERROR",
      message: `Weekly reorder digest failed: ${e?.message ?? e}`, details: { weekKey } as any,
    }).catch(() => {});
    return { ran: false, skipped: `error: ${e?.message ?? e}`, weekKey };
  }
}

/** Latest stored digest (for the GET endpoint / dashboard). */
export async function getLatestReorderDigest(): Promise<any | null> {
  const logs = await storage.getAllSystemLogs({ type: "REORDER" });
  const digests = logs
    .filter((l: any) => l.code === "REORDER_DIGEST")
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return digests[0] ?? null;
}

let digestArmed = false;
/**
 * Arm the weekly digest. Checks ~every 6h; the Monday + ISO-week guards mean it
 * fires once, Monday, regardless of boot time. Fire-and-forget, never throws.
 */
export function startReorderDigestScheduler(): void {
  if (digestArmed) return;
  digestArmed = true;
  const tick = async () => {
    try {
      const r = await runWeeklyReorderDigest({ mondayOnly: true });
      if (r.ran) console.log(`[Reorder] Weekly digest: ${r.vendors} vendors, ${r.toOrder} to order, ${r.stockout} stockouts.`);
    } catch (err: any) {
      console.error("[Reorder] Digest tick failed:", err?.message ?? err);
    }
  };
  setTimeout(() => void tick(), 90_000); // shortly after boot (self-guards)
  const t = setInterval(() => void tick(), 6 * 60 * 60 * 1000);
  if (typeof (t as any)?.unref === "function") (t as any).unref();
}
