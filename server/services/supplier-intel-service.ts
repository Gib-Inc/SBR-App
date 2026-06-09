/**
 * Supplier Intel Service
 * ----------------------
 * Computes the "SBR Operations / Inventory Intelligence" snapshot that powers
 * the Supplier Intel page. Replaces the page's previously-hardcoded data
 * (frozen TODAY + static INVENTORY array) with a live computation:
 *
 *   available  = items.hildale_qty + items.pivot_qty (finished on-hand)
 *   velocity   = trailing 90-day units sold (getSkuSalesVelocity), per week
 *   runs-out   = today + (available / weeklyVelocity) weeks
 *   reorder pt = ceil(dailyVelocity * supplierLeadTime + weeklyVelocity)
 *   90d need   = ceil(dailyVelocity * 90)
 *   gap        = max(0, need - available)
 *   PO value   = gap * curated supplier unit cost
 *
 * The supplier reference (who makes what, unit cost, lead time, MOQ) is curated
 * reference data ported from the original page — accurate and team-maintained.
 * The snapshot is stored as a single latest row and refreshed daily at 6 AM MT
 * (and on demand). The page renders whatever the snapshot holds.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { recordSchedulerRun } from "./scheduler-run-recorder";

const COVERAGE_DAYS = 90;

export interface SupplierRef {
  id: string;
  name: string;
  type: string;
  leadTimeDays: number;
  color: string;
  items: { sku: string; desc: string; unitCost: number; moq: number }[];
  notes: string;
}

export interface IntelProduct {
  sku: string;
  name: string;
  available: number;
  projVelocity: number; // units per WEEK (live, trailing 90d)
  status: "CRITICAL" | "REORDER" | "ORDER_SOON" | "OK";
  q2Need: number; // units needed for the coverage window
  gap: number;
  supplierCost: number;
  supplierId: string;
  amazonPct: number;
  shopifyPct: number;
  runsOutISO: string | null;
  reorderPoint: number;
  poValue: number;
  velocityKnown: boolean; // false when no sales matched (data gap)
}

export interface SupplierIntelSnapshot {
  computedAt: string; // ISO
  today: string; // ISO (date the projections are anchored to)
  coverageDays: number;
  suppliers: SupplierRef[];
  inventory: IntelProduct[];
  totals: {
    estimatedPOValue: number;
    itemsNeedingOrder: number;
    criticalCount: number;
    firstStockoutISO: string | null;
    firstStockoutName: string | null;
  };
  notes: string[];
  trigger: string;
}

// ─── Curated supplier reference (lead times / costs / MOQs) ──────────────────
const SUPPLIERS: SupplierRef[] = [
  {
    id: "fx-industries", name: "FX Industries", type: "Metal Fabrication", leadTimeDays: 21, color: "#e85d04",
    items: [
      { sku: "SBRClassic1.0", desc: '12" Push Frame', unitCost: 44.0, moq: 200 },
      { sku: "SBRExtrawide2.0", desc: '18" Push Frame', unitCost: 59.0, moq: 200 },
      { sku: "SBR-PBIndustrial", desc: '12" Pull-Behind Frame', unitCost: 475.0, moq: 10 },
    ],
    notes: "Longest lead time of all vendors. If you're reading a critical alert for a Push unit, the PO is already overdue.",
  },
  {
    id: "silver-fox", name: "Silver Fox LLC", type: "Screens & Sleeves", leadTimeDays: 7, color: "#2dc653",
    items: [
      { sku: "302-REP-M1", desc: 'Screen 12.5"', unitCost: 2.0, moq: 100 },
      { sku: "304-REP-M2", desc: 'Screen 18.5"', unitCost: 3.5, moq: 100 },
      { sku: "1202-REP-M2", desc: "Screen Bigfoot", unitCost: 3.5, moq: 100 },
      { sku: "301-REP-M1", desc: 'Sleeve 12"', unitCost: 3.0, moq: 100 },
      { sku: "305-REP-M2", desc: 'Sleeve 18"', unitCost: 4.0, moq: 100 },
      { sku: "1203-REP-M2", desc: "Sleeve Bigfoot", unitCost: 4.0, moq: 100 },
    ],
    notes: "Fastest and most reliable. Can turn around weekly orders during peak season. No excuses for stockouts here.",
  },
  {
    id: "pednar", name: "Pednar", type: "Foam Rollers", leadTimeDays: 14, color: "#4cc9f0",
    items: [
      { sku: "301-REP-M1-FOAM", desc: '6"x36" Foam (Push 1.0)', unitCost: 8.65, moq: 480 },
      { sku: "305-REP-M2-FOAM", desc: '10"x12" Foam (Push 2.0)', unitCost: 9.95, moq: 480 },
      { sku: "1203-REP-M2-FOAM", desc: '10"x17.5" Foam (Bigfoot)', unitCost: 9.95, moq: 500 },
    ],
    notes: "Order in batches of 480-540. Bigfoot foam price has ranged $9.95-$15.32 - lock in low price when possible.",
  },
  {
    id: "acu-form", name: "Acu-Form Plastics", type: "Proprietary Trays", leadTimeDays: 18, color: "#f72585",
    items: [
      { sku: "SB1-TRAY", desc: "Small Tray", unitCost: 13.91, moq: 100 },
      { sku: "SB2-TRAY", desc: "Large Tray", unitCost: 15.97, moq: 100 },
      { sku: "SB3-TRAY", desc: "Long Tray", unitCost: 41.73, moq: 30 },
    ],
    notes: "Sole source - proprietary molds. No backup supplier exists. Run a higher safety stock buffer here than anywhere else.",
  },
  {
    id: "liston", name: "Liston Metalworks", type: "Goat Head Blades", leadTimeDays: 21, color: "#9d4edd",
    items: [
      { sku: "BLADE-GOAT", desc: "Goat Head Blade (assembled)", unitCost: 23.21, moq: 50 },
      { sku: "PULLBEHIND-BRACKET", desc: "Pull-Behind Bracket Set", unitCost: 6.0, moq: 18 },
    ],
    notes: "Material + hardware + cutting + assembly all bundled. 3-week lead - plan ahead for any Pull-Behind production run.",
  },
  {
    id: "uline", name: "Uline", type: "Packaging", leadTimeDays: 5, color: "#ffd60a",
    items: [
      { sku: "S-4804-BOX", desc: '26x15x12" Box (Push)', unitCost: 3.94, moq: 100 },
      { sku: "S-18368-BOX", desc: '26x16x16" Box (Bigfoot)', unitCost: 4.43, moq: 100 },
    ],
    notes: "Fast turnaround. Keep a floor of packaging so a finished-goods build is never blocked on a box.",
  },
];

// ─── Curated product → live-SKU + supplier + cost mapping ────────────────────
// liveSku is the actual items.sku in the database (with the right prefix).
const PRODUCTS: {
  liveSku: string; name: string; supplierId: string; unitCost: number;
}[] = [
  { liveSku: "SBR-PUSH-1.0", name: "Push 1.0 Classic", supplierId: "fx-industries", unitCost: 44.0 },
  { liveSku: "SBR-Extrawide2.0", name: "Push 2.0 Extra Wide", supplierId: "fx-industries", unitCost: 59.0 },
  { liveSku: "#702-CMB-2", name: "Combo 2.0", supplierId: "fx-industries", unitCost: 103.0 },
  { liveSku: "#704-CMB-4", name: "Combo PBB", supplierId: "fx-industries", unitCost: 529.0 },
  { liveSku: "#1003-REP-M1", name: "Connecting Bar", supplierId: "liston", unitCost: 6.0 },
  { liveSku: "#701-CMB-1", name: "Combo 1.0", supplierId: "fx-industries", unitCost: 103.0 },
  { liveSku: "#703-CMB-3", name: "Combo PBO", supplierId: "fx-industries", unitCost: 475.0 },
  { liveSku: "#304-REP-M2", name: 'Screen 18" (Push 2.0)', supplierId: "silver-fox", unitCost: 3.5 },
  { liveSku: "#302-REP-M1", name: 'Screen 12" (Push 1.0)', supplierId: "silver-fox", unitCost: 2.0 },
  { liveSku: "SBR-PB-ORIG", name: "Pull Behind Original", supplierId: "fx-industries", unitCost: 475.0 },
  { liveSku: "SBR-PB-BIGFOOT", name: "Pull Behind Bigfoot", supplierId: "fx-industries", unitCost: 525.0 },
];

const norm = (s: string | null | undefined): string =>
  (s ?? "").replace(/^SKU:\s*/i, "").replace(/[^a-z0-9]/gi, "").toUpperCase();

function leadTimeFor(supplierId: string): number {
  return SUPPLIERS.find((s) => s.id === supplierId)?.leadTimeDays ?? 14;
}

/** Build the live snapshot object (does not persist). */
export async function computeSupplierIntelSnapshot(trigger: string): Promise<SupplierIntelSnapshot> {
  const now = new Date();
  const notes: string[] = [];

  // 1. Live finished-goods on-hand + channel SKUs
  const itemsRes: any = await db.execute(sql`
    SELECT sku, name, COALESCE(hildale_qty,0) AS hildale, COALESCE(pivot_qty,0) AS pivot,
           shopify_sku, amazon_sku
    FROM items WHERE type = 'finished_product'
  `);
  const itemRows: any[] = itemsRes.rows ?? itemsRes ?? [];
  const itemByNorm = new Map<string, any>();
  for (const r of itemRows) {
    for (const k of [r.sku, r.shopify_sku, r.amazon_sku]) {
      const n = norm(k);
      if (n) itemByNorm.set(n, r);
    }
  }

  // 2. Live trailing-90d sales velocity, indexed by normalized SKU
  let velocityRows: { sku: string; unitsSold: number }[] = [];
  try {
    velocityRows = await storage.getSkuSalesVelocity(COVERAGE_DAYS);
  } catch (e: any) {
    notes.push(`Sales velocity unavailable: ${e?.message ?? e}`);
  }
  const velByNorm = new Map<string, number>();
  for (const v of velocityRows) {
    const n = norm(v.sku);
    if (n) velByNorm.set(n, (velByNorm.get(n) ?? 0) + (v.unitsSold ?? 0));
  }

  // 3. Compute each curated product from live inputs
  const inventory: IntelProduct[] = PRODUCTS.map((p) => {
    const item = itemByNorm.get(norm(p.liveSku));
    const available = item ? Number(item.hildale) + Number(item.pivot) : 0;
    if (!item) notes.push(`No live item found for ${p.liveSku} (${p.name}) — shown as 0 on-hand.`);

    // Velocity: sum across the item's own sku + channel skus
    const skuKeys = new Set<string>([norm(p.liveSku)]);
    if (item) [item.sku, item.shopify_sku, item.amazon_sku].forEach((k: string) => { const n = norm(k); if (n) skuKeys.add(n); });
    let unitsSold90 = 0;
    for (const k of Array.from(skuKeys)) unitsSold90 += velByNorm.get(k) ?? 0;
    const velocityKnown = unitsSold90 > 0;

    const dailyVel = unitsSold90 / COVERAGE_DAYS;
    const weeklyVel = dailyVel * 7;
    const leadTime = leadTimeFor(p.supplierId);
    const reorderPoint = Math.ceil(dailyVel * leadTime + weeklyVel);
    const need = Math.ceil(dailyVel * COVERAGE_DAYS);
    const gap = Math.max(0, need - available);
    const poValue = gap > 0 ? gap * p.unitCost : 0;

    let runsOutISO: string | null = null;
    let daysToStockout = Infinity;
    if (dailyVel > 0) {
      daysToStockout = available / dailyVel;
      runsOutISO = new Date(now.getTime() + daysToStockout * 86400000).toISOString();
    }

    let status: IntelProduct["status"] = "OK";
    if (dailyVel > 0) {
      if (daysToStockout <= leadTime + 3) status = "CRITICAL";
      else if (available <= reorderPoint) status = "REORDER";
      else if (daysToStockout <= 75) status = "ORDER_SOON";
    }

    return {
      sku: p.liveSku, name: p.name, available,
      projVelocity: Math.round(weeklyVel), status, q2Need: need, gap,
      supplierCost: p.unitCost, supplierId: p.supplierId,
      amazonPct: 0, shopifyPct: 0,
      runsOutISO, reorderPoint, poValue, velocityKnown,
    };
  });

  // 4. Totals
  const ordering = inventory.filter((i) => i.gap > 0 && i.status !== "OK");
  const estimatedPOValue = ordering.reduce((s, i) => s + i.poValue, 0);
  const dated = inventory
    .filter((i) => i.runsOutISO && i.status !== "OK")
    .sort((a, b) => new Date(a.runsOutISO!).getTime() - new Date(b.runsOutISO!).getTime());
  const first = dated[0] ?? null;

  return {
    computedAt: now.toISOString(),
    today: now.toISOString(),
    coverageDays: COVERAGE_DAYS,
    suppliers: SUPPLIERS,
    inventory,
    totals: {
      estimatedPOValue: Math.round(estimatedPOValue),
      itemsNeedingOrder: ordering.length,
      criticalCount: inventory.filter((i) => i.status === "CRITICAL").length,
      firstStockoutISO: first?.runsOutISO ?? null,
      firstStockoutName: first?.name ?? null,
    },
    notes,
    trigger,
  };
}

/** Persist the latest snapshot (single row, id=1). */
async function persistSnapshot(snap: SupplierIntelSnapshot): Promise<void> {
  await db.execute(sql`
    INSERT INTO supplier_intel_snapshot (id, computed_at, trigger, payload)
    VALUES (1, ${snap.computedAt}, ${snap.trigger}, ${JSON.stringify(snap)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      computed_at = EXCLUDED.computed_at,
      trigger = EXCLUDED.trigger,
      payload = EXCLUDED.payload
  `);
}

/** Read the latest stored snapshot (null if never computed). */
export async function getLatestSupplierIntelSnapshot(): Promise<SupplierIntelSnapshot | null> {
  const res: any = await db.execute(sql`SELECT payload FROM supplier_intel_snapshot WHERE id = 1`);
  const rows: any[] = res.rows ?? res ?? [];
  if (!rows.length) return null;
  const payload = rows[0].payload;
  return typeof payload === "string" ? JSON.parse(payload) : payload;
}

/** Compute + persist + record to the Health monitor. Returns the snapshot. */
export async function refreshSupplierIntelSnapshot(trigger: string): Promise<SupplierIntelSnapshot> {
  const startedAt = new Date();
  try {
    const snap = await computeSupplierIntelSnapshot(trigger);
    await persistSnapshot(snap);
    await recordSchedulerRun({
      schedulerId: "supplier-intel",
      schedulerName: "Supplier intel snapshot",
      status: "success",
      startedAt,
      errorMessage: null,
      details: {
        trigger,
        itemsNeedingOrder: snap.totals.itemsNeedingOrder,
        estimatedPOValue: snap.totals.estimatedPOValue,
        criticalCount: snap.totals.criticalCount,
        dataGaps: snap.notes.length,
      },
    }).catch((e) => console.warn("[Supplier Intel] Failed to record scheduler run:", e));
    console.log(`[Supplier Intel] Snapshot refreshed (${trigger}): ${snap.totals.itemsNeedingOrder} items, $${snap.totals.estimatedPOValue} POs needed`);
    return snap;
  } catch (error: any) {
    await recordSchedulerRun({
      schedulerId: "supplier-intel",
      schedulerName: "Supplier intel snapshot",
      status: "failed",
      startedAt,
      errorMessage: error?.message ?? String(error),
      details: { trigger },
    }).catch((e) => console.warn("[Supplier Intel] Failed to record scheduler run:", e));
    throw error;
  }
}
