/**
 * COUNT.M Stock Variance — surfaces where the app's stock numbers disagree with
 * physical reality, the drift inventory-movement.ts deliberately does NOT auto-
 * correct ("surfaced via the variance report rather than auto-corrected here").
 *
 * The main signal: for finished products the app keeps THREE numbers —
 *   hildaleQty           HQ buffer stock (production)
 *   pivotQty             the 3PL physical count, mirrored read-only from Extensiv
 *   availableForSaleQty  the sellable counter — decremented by every sale but NOT
 *                        replenished when Extensiv restocks Pivot
 * so afs drifts BELOW pivot over time (e.g. a top seller reads afs=0 while the 3PL
 * holds 137). The app's on-hand is hildale+afs, but true physical is hildale+pivot.
 * This report flags that gap so a human can true it up (a count → adjustment).
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);

export type VarianceFlag = "OK" | "AFS_STALE" | "AFS_AHEAD" | "NEGATIVE";

export interface StockVarianceRow {
  itemId: string; sku: string; name: string;
  hildale: number; pivot: number; afs: number;
  appOnHand: number;      // what the app reports: hildale + afs
  truePhysical: number;   // hildale + pivot (3PL physical)
  drift: number;          // pivot − afs (positive = afs understates sellable stock)
  flag: VarianceFlag;
}

/** Classify one finished product's stock fields. Threshold avoids flagging rounding noise. */
export function classifyVariance(input: { hildale: number; pivot: number; afs: number }): { drift: number; flag: VarianceFlag } {
  const { hildale, pivot, afs } = input;
  const drift = pivot - afs;
  if (hildale < 0 || pivot < 0 || afs < 0) return { drift, flag: "NEGATIVE" };
  const threshold = Math.max(5, pivot * 0.1); // ignore tiny gaps
  if (drift > threshold) return { drift, flag: "AFS_STALE" };   // sellable counter understated vs 3PL
  if (drift < -threshold) return { drift, flag: "AFS_AHEAD" };  // afs above 3PL (oversell / pending restock)
  return { drift, flag: "OK" };
}

export async function computeStockVariance(db: DB): Promise<{ rows: StockVarianceRow[]; summary: { products: number; afsStale: number; afsAhead: number; negative: number; totalDriftUnits: number } }> {
  const raw = rows(await db.execute(sql`
    SELECT id, sku, name,
           COALESCE(hildale_qty,0)::float8 AS hildale,
           COALESCE(pivot_qty,0)::float8 AS pivot,
           COALESCE(available_for_sale_qty,0)::float8 AS afs
    FROM items
    WHERE type = 'finished_product'
  `));

  const out: StockVarianceRow[] = raw.map((r: any) => {
    const hildale = num(r.hildale), pivot = num(r.pivot), afs = num(r.afs);
    const { drift, flag } = classifyVariance({ hildale, pivot, afs });
    return {
      itemId: r.id, sku: r.sku, name: r.name,
      hildale, pivot, afs,
      appOnHand: hildale + afs,
      truePhysical: hildale + pivot,
      drift, flag,
    };
  });

  // Worst drift first; only items with any stock activity are interesting.
  out.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

  const summary = {
    products: out.length,
    afsStale: out.filter((r) => r.flag === "AFS_STALE").length,
    afsAhead: out.filter((r) => r.flag === "AFS_AHEAD").length,
    negative: out.filter((r) => r.flag === "NEGATIVE").length,
    totalDriftUnits: out.filter((r) => r.drift > 0).reduce((s, r) => s + r.drift, 0),
  };

  return { rows: out, summary };
}
