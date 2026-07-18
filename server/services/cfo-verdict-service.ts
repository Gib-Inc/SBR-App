/**
 * Daily CFO Verdict — the provenance-stamped morning picture (Operation CFO, Build 1).
 *
 * One read-only composition over the CANONICAL modules (SOURCES-OF-TRUTH.md).
 * This service does NO math of its own beyond staleness/threshold classification
 * and ranking — every number is consumed from the module that owns it:
 *
 *   CASH          ← cash-flow-service.getBankConfirmedOverride (bank-confirmed, staleness-flagged)
 *   RUNWAY        ← runway-service.computeRunway (debt-aware net burn, realistic 30d window)
 *   MER           ← marketing-truth-service.getMarketingTruth (governor MER + confidence layer)
 *                   + meta-ads-client.getMetaDirectFeedConfidence + Windsor snapshot freshness
 *   CONTRIBUTION  ← contribution-margin-service.getBlendedContributionMargin (COGS-plug caveat carried)
 *   CASH LEAKS    ← latest ACTIVE marketing_spend_snapshots (compliant sources only — never the raw ad-metrics grains)
 *   INVENTORY     ← storage.getSkuSalesVelocity (orderDate-windowed lines) + items buckets per type
 *   DECISIONS     ← truth_reports FAIL/WARN + data_reconciliation_log PROPOSED + pending PO drafts
 *
 * HONESTY CONTRACT: every field carries { value, source, asOf, status }. A missing
 * feed or a failed dependency renders status "gap" with the reason named — NEVER a
 * fabricated 0 and NEVER a silent fallback to a non-canonical table. Read-only:
 * zero writes, zero new write paths; the one action affordance (cash "tap to
 * update") points at the EXISTING bank-balance entry flow on /cash-out.
 *
 * Pure classification/ranking helpers are exported and unit-tested in
 * cfo-verdict-service.test.ts with fully mocked deps (no DB).
 */
import { sql } from "drizzle-orm";
import { storage as defaultStorage } from "../storage";
import { getBankConfirmedOverride, type BankOverride } from "./cash-flow-service";
import { computeRunway, type RunwayComputation } from "./runway-service";
import { getMarketingTruth, type MarketingTruth } from "./marketing-truth-service";
import { getMetaDirectFeedConfidence } from "./meta-ads-client";
import { getWindsorSyncStatus } from "./windsor-sync-service";
import { getBlendedContributionMargin, COGS_PLUG_RATE, type BlendedContribution } from "./contribution-margin-service";
import { getLatestTruthReport, type TruthReport } from "./truth-monitor-service";
import { aliasSkusFor } from "./velocity-service";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── Provenance stamp ────────────────────────────────────────────────────────

/** ok = trust it · amber = usable, degraded · red = act on it · gap = number unavailable (stated, never 0). */
export type VerdictStatus = "ok" | "amber" | "red" | "gap";

export interface Stamp<T = number> {
  value: T | null;
  source: string;   // the canonical module/table the value came from
  asOf: string | null; // ISO timestamp/date the value is true as of (null when the value is a gap)
  status: VerdictStatus;
  note?: string;    // gap reason / caveat — present whenever status is not "ok"
}

const SEVERITY: Record<VerdictStatus, number> = { ok: 0, gap: 1, amber: 2, red: 3 };

/** Overall = the worst section status. A gap outranks ok (one eye closed) but never outranks a live amber/red. Pure. */
export function rollupVerdict(statuses: VerdictStatus[]): VerdictStatus {
  let worst: VerdictStatus = "ok";
  for (const s of statuses) if (SEVERITY[s] > SEVERITY[worst]) worst = s;
  return worst;
}

// ─── 1. CASH ─────────────────────────────────────────────────────────────────

/** Staleness tiers on the bank-confirmed entry age: >3d amber, >7d red, none = gap. Pure. */
export function classifyCashStaleness(staleDays: number | null): VerdictStatus {
  if (staleDays == null) return "gap";
  if (staleDays > 7) return "red";
  if (staleDays > 3) return "amber";
  return "ok";
}

export interface CashSection extends Stamp<number> {
  staleDays: number | null;
  /** EXISTING bank-balance entry flow (cash-out page) — the "tap to update" target. No new write path. */
  updateHref: string;
}

const CASH_SOURCE =
  "bank_balance_entries (operator bank-confirmed) via cash-flow-service.getBankConfirmedOverride";

/** Pure: compose the cash section from the canonical bank override (or its absence). */
export function composeCashSection(ov: BankOverride | null): CashSection {
  if (!ov) {
    return {
      value: null,
      source: CASH_SOURCE,
      asOf: null,
      status: "gap",
      note: "No bank-confirmed balance within 14 days — enter the live bank number. (Not silently falling back to the lagging QB ledger.)",
      staleDays: null,
      updateHref: "/cash-out",
    };
  }
  const staleDays = Math.floor(ov.staleHours / 24);
  const status = classifyCashStaleness(staleDays);
  return {
    value: ov.cashOnHand,
    source: CASH_SOURCE,
    asOf: ov.confirmedAt,
    status,
    note: status === "ok" ? undefined : `Bank confirmation is ${staleDays} day(s) old — tap to update from the bank.`,
    staleDays,
    updateHref: "/cash-out",
  };
}

// ─── 2. RUNWAY ───────────────────────────────────────────────────────────────

export interface RunwaySection extends Stamp<number> {
  basis: string; // what the number means — never a bare day count
  burnRatePerDay: number | null;
  cashFlowPositive: boolean;
  debtServiceMonthly: number | null;
  debtBlindBalance: number | null; // facility balance with NO entered terms (reads $0 in the burn)
}

/** Pure: compose the runway section from the debt-aware runway computation. */
export function composeRunwaySection(
  res: { ok: boolean; data?: RunwayComputation; error?: string },
  nowIso: string,
): RunwaySection {
  const source = "runway-service.computeRunway (debt-aware net burn; canonical margin + corrected ad spend + entered facility terms)";
  if (!res.ok || !res.data) {
    return {
      value: null, source, asOf: null, status: "gap",
      note: res.error || "runway unavailable",
      basis: "unavailable", burnRatePerDay: null, cashFlowPositive: false,
      debtServiceMonthly: null, debtBlindBalance: null,
    };
  }
  const f = res.data.forecast;
  const realistic = f.scenarios.realistic;
  const marginLabel =
    res.data.marginSource === "contribution" ? "measured contribution margin"
    : res.data.marginSource === "qb-gross-legacy" ? "LEGACY QB gross ratio (contribution engine unavailable)"
    : "margin unavailable";
  const debt = res.data.debtService;
  const basis =
    `realistic 30d scenario: bank-confirmed cash + windowed inbound payouts − daily (overhead + unbooked ad spend + debt service − sales × ${marginLabel})`;
  const status: VerdictStatus =
    f.status === "CRITICAL" ? "red"
    : f.status === "WARNING" ? "amber"
    : f.status === "CALCULATION_GAPPED" ? "gap"
    : f.status === "MISMATCH" ? "amber"
    : "ok";
  const notes: string[] = [];
  if (f.status === "CALCULATION_GAPPED") notes.push(`inputs missing: ${f.dataGaps.join("; ")}`);
  if (realistic.cashFlowPositive) notes.push("net burn ≤ 0 this window — cash-flow positive, no finite runway");
  if (debt && debt.missingPaymentBalance > 0) {
    notes.push(`$${Math.round(debt.missingPaymentBalance).toLocaleString()} of facility balance has NO entered payment terms — that debt reads $0 in the burn, so the runway is optimistic by exactly that omission`);
  }
  if (!debt) notes.push("debt-service compute failed — runway ran WITHOUT debt in the burn (optimistic)");
  return {
    value: f.realisticDays,
    source,
    asOf: nowIso,
    status,
    note: notes.length ? notes.join(". ") : undefined,
    basis,
    burnRatePerDay: f.burnRate,
    cashFlowPositive: realistic.cashFlowPositive,
    debtServiceMonthly: debt ? debt.monthlyDebtService : null,
    debtBlindBalance: debt ? debt.missingPaymentBalance : null,
  };
}

// ─── 3. MER ──────────────────────────────────────────────────────────────────

export interface FeedChip {
  feed: string;
  status: VerdictStatus;
  detail: string;
  latestPeriodEnd: string | null;
  daysOld: number | null;
}

/** Pure: Windsor freshness from ACTIVE windsor-sourced snapshots (+ in-process sync status). */
export function windsorFreshness(
  activeSnapshots: Array<{ source?: string | null; superseded?: boolean | null; periodEnd?: string | null }>,
  nowMs: number,
  sync: { keyPresent: boolean; at: string | null },
): FeedChip {
  const windsorEnds = activeSnapshots
    .filter((s) => !s.superseded && String(s.source || "").startsWith("windsor:") && s.periodEnd)
    .map((s) => String(s.periodEnd))
    .sort();
  const latest = windsorEnds[windsorEnds.length - 1] ?? null;
  if (!latest) {
    return {
      feed: "windsor",
      status: "gap",
      detail: sync.keyPresent
        ? "no ACTIVE windsor-sourced snapshot yet — awaiting data"
        : "awaiting credentials (WINDSOR_API_KEY not set)",
      latestPeriodEnd: null,
      daysOld: null,
    };
  }
  const daysOld = Math.floor((nowMs - Date.parse(`${latest}T00:00:00Z`)) / 86_400_000);
  const status: VerdictStatus = daysOld > 7 ? "red" : daysOld > 3 ? "amber" : "ok";
  return {
    feed: "windsor",
    status,
    detail: `latest windsor snapshot period_end ${latest} (${daysOld}d old)${sync.at ? `; last sync attempt ${sync.at}` : ""}`,
    latestPeriodEnd: latest,
    daysOld,
  };
}

/** Pure: MER status vs the 5x gate, honoring the marketing-truth honesty ladder —
 *  an "unreliable" composition withholds the verdict (gap), never renders confident. */
export function classifyMer(
  blendedMer: number | null,
  gate: number,
  confidence: "high" | "directional" | "unreliable",
): VerdictStatus {
  if (blendedMer == null) return "gap";
  if (confidence === "unreliable") return "gap";
  if (blendedMer < gate) return "red";
  if (confidence === "directional") return "amber";
  return "ok";
}

export interface MerSection extends Stamp<number> {
  gate: number;                 // the team's 5x rule the governor gates on
  measuredBreakeven: number | null;
  contributionMer: number | null;
  confidence: "high" | "directional" | "unreliable";
  confidenceReasons: string[];
  feeds: FeedChip[];            // meta-direct + windsor freshness chips
}

// ─── 4. CONTRIBUTION ─────────────────────────────────────────────────────────

export interface ContributionSection extends Stamp<number> {
  marginPctDisplay: string | null;
  cogsPlugShare: number | null; // share of window revenue costed at the plug (0..1)
  caveats: string[];            // includes the COGS-plug caveat the engine carries
}

/** Pure: compose contribution from the canonical blended-contribution figure. */
export function composeContributionSection(cm: BlendedContribution, nowIso: string): ContributionSection {
  const pct = cm.contributionMarginPct;
  const plugShare = cm.costedRevenueShare != null ? r2(1 - cm.costedRevenueShare) : null;
  const caveats = [
    `uncosted revenue uses the ${COGS_PLUG_RATE * 100}% QB-validated COGS plug (${plugShare != null ? `${Math.round(plugShare * 100)}% of window revenue` : "share unknown"})`,
    ...cm.dataGaps,
  ];
  return {
    value: pct,
    source: `contribution-margin-service.getBlendedContributionMargin (${cm.windowDays}d order ledger: real COGS + channel fees + measured freight)`,
    asOf: nowIso,
    status: pct == null ? "gap" : pct < 0 ? "red" : pct < 0.3 ? "amber" : "ok",
    note: pct == null ? "no costed order revenue in the window — margin unavailable" : caveats[0],
    marginPctDisplay: pct != null ? `${(pct * 100).toFixed(1)}%` : null,
    cogsPlugShare: plugShare,
    caveats,
  };
}

// ─── 5. CASH LEAKS ───────────────────────────────────────────────────────────

/** Spend below this in a zero-purchase window is noise, not a "leak". */
export const LEAK_MIN_SPEND = 100;
export const LEAK_RED_SPEND = 500;
export const LEAK_WINDOW_DAYS = 14;

export interface LeakLine {
  platform: string;
  spendNoPurchase: number; // spend across windows with an EXPLICIT zero tracked purchases
  windows: number;
  latestPeriodEnd: string | null;
}
export interface CashLeaksSection extends Stamp<number> {
  leaks: LeakLine[];
  awaiting: string[]; // platforms with spend rows but NO purchase granularity (stated, not zeroed)
}

/** Pure: zero-purchase spend concentrations from ACTIVE compliant snapshots.
 *  conversions === 0 is a REAL tracked zero; conversions == null is missing
 *  granularity and must surface as "awaiting", never as a detected/cleared leak. */
export function composeLeaksSection(
  snapshots: Array<{
    platform?: string | null; superseded?: boolean | null; status?: string | null;
    spend?: number | null; conversions?: number | null; periodEnd?: string | null; source?: string | null;
  }>,
  nowMs: number,
): CashLeaksSection {
  const cutoff = new Date(nowMs - LEAK_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const recent = snapshots.filter(
    (s) => !s.superseded && s.periodEnd && String(s.periodEnd) >= cutoff && num(s.spend) > 0,
  );
  const byPlatform = new Map<string, typeof recent>();
  for (const s of recent) {
    const p = String(s.platform || "OTHER").toUpperCase();
    if (!byPlatform.has(p)) byPlatform.set(p, []);
    byPlatform.get(p)!.push(s);
  }

  const leaks: LeakLine[] = [];
  const awaiting: string[] = [];
  for (const [platform, rows] of Array.from(byPlatform.entries())) {
    const measurable = rows.filter((s) => s.conversions != null && String(s.status || "OK") !== "DATA_GAPPED");
    if (!measurable.length) {
      awaiting.push(platform);
      continue;
    }
    const zero = measurable.filter((s) => num(s.conversions) === 0);
    const spendNoPurchase = r2(zero.reduce((t, s) => t + num(s.spend), 0));
    if (spendNoPurchase >= LEAK_MIN_SPEND) {
      leaks.push({
        platform,
        spendNoPurchase,
        windows: zero.length,
        latestPeriodEnd: zero.map((s) => String(s.periodEnd)).sort().pop() ?? null,
      });
    }
  }
  leaks.sort((a, b) => b.spendNoPurchase - a.spendNoPurchase);

  const total = r2(leaks.reduce((t, l) => t + l.spendNoPurchase, 0));
  const source = `marketing_spend_snapshots (ACTIVE, compliant, trailing ${LEAK_WINDOW_DAYS}d) — purchase counts as tracked by each feed`;
  if (!byPlatform.size || (!leaks.length && awaiting.length === byPlatform.size)) {
    return {
      value: null, source, asOf: null, status: "gap",
      note: "leak detection awaiting fresh ad feed — no compliant purchase-level rows in the window (not scanning dead tables)",
      leaks: [], awaiting,
    };
  }
  return {
    value: total,
    source,
    asOf: new Date(nowMs).toISOString(),
    status: total >= LEAK_RED_SPEND ? "red" : leaks.length ? "amber" : "ok",
    note: leaks.length
      ? `$${total.toLocaleString()} spent in windows with zero tracked purchases${awaiting.length ? `; ${awaiting.join(", ")} awaiting purchase granularity` : ""}`
      : awaiting.length ? `${awaiting.join(", ")} awaiting purchase granularity` : undefined,
    leaks,
    awaiting,
  };
}

// ─── 6. INVENTORY RISKS ──────────────────────────────────────────────────────

export const INVENTORY_VELOCITY_WINDOW_DAYS = 30;
export const TOP_MOVER_COUNT = 5;

/** Pure: days of stock left. Zero/absent velocity is a stated unknown — NEVER infinite and NEVER 0. */
export function daysLeftFor(position: number, unitsSoldInWindow: number, windowDays: number): number | null {
  if (!(unitsSoldInWindow > 0) || !(windowDays > 0)) return null;
  return r1(position / (unitsSoldInWindow / windowDays));
}

export function classifyDaysLeft(days: number | null): VerdictStatus {
  if (days == null) return "gap";
  if (days < 30) return "red";
  if (days < 60) return "amber";
  return "ok";
}

export interface InventoryRiskLine {
  sku: string;
  name: string;
  unitsSoldWindow: number;
  dailyVelocity: number;
  position: number; // finished_product: pivot + hildale (owned); component: current_stock
  buckets: { pivotQty: number; hildaleQty: number; availableForSaleQty: number } | null;
  daysLeft: number | null;
  status: VerdictStatus;
  note?: string;
}

export interface PushSignalLine extends InventoryRiskLine {
  frame: { sku: string; name: string; stock: number; onOrder: number } | null;
  framesOnOrder: number | null; // null = frame component unresolvable (gap), never a fabricated 0
}

export interface InventorySection extends Stamp<number> {
  topMovers: InventoryRiskLine[];
  pushSignal: PushSignalLine | null;
}

/** PO statuses that mean units are genuinely inbound (drafts are NOT on order). */
export const PO_ON_ORDER_STATUSES = new Set(["SENT", "ACCEPTED", "PARTIAL", "PARTIALLY_RECEIVED"]);
/** PO statuses that are a pending draft awaiting a decision. */
export const PO_DRAFT_STATUSES = new Set(["DRAFT", "APPROVAL_PENDING", "APPROVED"]);

// ─── 7. DECISIONS ────────────────────────────────────────────────────────────

export type DecisionKind = "truth_fail" | "recon_proposed" | "truth_warn" | "po_draft";

export interface DecisionCandidate {
  kind: DecisionKind;
  title: string;
  why: string;      // the one-line why
  source: string;
  asOf: string | null;
}

const DECISION_WEIGHT: Record<DecisionKind, number> = {
  truth_fail: 100,     // a failing integrity check means a number somewhere is lying
  recon_proposed: 80,  // a computed correction is waiting on a human
  truth_warn: 60,
  po_draft: 40,
};

/** Pure: top-3 decisions — FAILs first, then proposed reconciliations, warns, PO drafts; newest wins ties. */
export function rankDecisions(candidates: DecisionCandidate[], top = 3): DecisionCandidate[] {
  return [...candidates]
    .sort((a, b) =>
      DECISION_WEIGHT[b.kind] - DECISION_WEIGHT[a.kind] ||
      String(b.asOf ?? "").localeCompare(String(a.asOf ?? "")),
    )
    .slice(0, top);
}

export interface DecisionsSection extends Stamp<number> {
  items: DecisionCandidate[];
}

// ─── Verdict payload ─────────────────────────────────────────────────────────

export interface CfoVerdict {
  generatedAt: string;
  overall: { status: VerdictStatus; headline: string };
  cash: CashSection;
  runway: RunwaySection;
  mer: MerSection;
  contribution: ContributionSection;
  cashLeaks: CashLeaksSection;
  inventory: InventorySection;
  decisions: DecisionsSection;
}

// ─── Orchestrator (DB reads only; every section degrades to a stated gap) ────

export interface CfoVerdictDeps {
  getBankConfirmedOverride: typeof getBankConfirmedOverride;
  computeRunway: typeof computeRunway;
  getMarketingTruth: typeof getMarketingTruth;
  getMetaDirectFeedConfidence: typeof getMetaDirectFeedConfidence;
  getWindsorSyncStatus: typeof getWindsorSyncStatus;
  getBlendedContributionMargin: typeof getBlendedContributionMargin;
  getLatestTruthReport: typeof getLatestTruthReport;
  storage: Pick<typeof defaultStorage,
    "getActiveMarketingSpendSnapshots" | "getAllItems" | "getSkuSalesVelocity" |
    "getAllPurchaseOrders" | "getAllPurchaseOrderLines" | "getBillOfMaterialsByProductId" | "getItemBySku">;
  now: () => Date;
}

const defaultDeps: CfoVerdictDeps = {
  getBankConfirmedOverride,
  computeRunway,
  getMarketingTruth,
  getMetaDirectFeedConfidence,
  getWindsorSyncStatus,
  getBlendedContributionMargin,
  getLatestTruthReport,
  storage: defaultStorage,
  now: () => new Date(),
};

function gapStamp<T>(source: string, err: unknown): Stamp<T> {
  return { value: null, source, asOf: null, status: "gap", note: `unavailable: ${(err as any)?.message ?? String(err)}` };
}

async function gatherInventory(deps: CfoVerdictDeps, nowIso: string): Promise<InventorySection> {
  const source =
    `storage.getSkuSalesVelocity (${INVENTORY_VELOCITY_WINDOW_DAYS}d orderDate-windowed sales_order_lines) + items buckets (finished: pivot+hildale owned / afs; component: current_stock) + open PO lines`;
  const [velocityRows, items] = await Promise.all([
    deps.storage.getSkuSalesVelocity(INVENTORY_VELOCITY_WINDOW_DAYS),
    deps.storage.getAllItems(),
  ]);
  const velocityBySku = new Map(velocityRows.map((v) => [v.sku, v.unitsSold]));
  const unitsFor = (item: any): number =>
    aliasSkusFor(item).reduce((t, sku) => t + (velocityBySku.get(sku) ?? 0), 0);

  const lineFor = (item: any): InventoryRiskLine => {
    const finished = item.type === "finished_product";
    const position = finished
      ? (item.pivotQty ?? 0) + (item.hildaleQty ?? 0)
      : (item.currentStock ?? 0);
    const units = unitsFor(item);
    const days = daysLeftFor(position, units, INVENTORY_VELOCITY_WINDOW_DAYS);
    return {
      sku: item.sku,
      name: item.name,
      unitsSoldWindow: units,
      dailyVelocity: r2(units / INVENTORY_VELOCITY_WINDOW_DAYS),
      position,
      buckets: finished
        ? { pivotQty: item.pivotQty ?? 0, hildaleQty: item.hildaleQty ?? 0, availableForSaleQty: item.availableForSaleQty ?? 0 }
        : null,
      daysLeft: days,
      status: classifyDaysLeft(days),
      note: days == null ? "no recorded sales in the window — days-left unknowable (not infinite)" : undefined,
    };
  };

  const finishedItems = items.filter((i: any) => i.type === "finished_product");
  const topMovers = finishedItems
    .map((i: any) => ({ item: i, units: unitsFor(i) }))
    .sort((a, b) => b.units - a.units)
    .slice(0, TOP_MOVER_COUNT)
    .map(({ item }) => lineFor(item));

  // The carried reorder-urgency signal: SBR-PUSH-1.0 — pivot position, low afs,
  // and whether its frame component is actually inbound (drafts don't count).
  let pushSignal: PushSignalLine | null = null;
  try {
    const push: any = await deps.storage.getItemBySku("SBR-PUSH-1.0");
    if (push) {
      const base = lineFor(push);
      let frame: PushSignalLine["frame"] = null;
      let framesOnOrder: number | null = null;
      const bom = await deps.storage.getBillOfMaterialsByProductId(push.id);
      const byId = new Map(items.map((i: any) => [i.id, i]));
      const frameComponent = bom
        .map((b: any) => byId.get(b.componentId))
        .find((c: any) => c && /frame/i.test(`${c.category ?? ""} ${c.name ?? ""} ${c.sku ?? ""}`));
      if (frameComponent) {
        const [pos, lines] = await Promise.all([
          deps.storage.getAllPurchaseOrders(),
          deps.storage.getAllPurchaseOrderLines(),
        ]);
        const openPoIds = new Set(pos.filter((p: any) => PO_ON_ORDER_STATUSES.has(String(p.status))).map((p: any) => p.id));
        framesOnOrder = lines
          .filter((l: any) => openPoIds.has(l.purchaseOrderId) && l.itemId === (frameComponent as any).id)
          .reduce((t: number, l: any) => t + Math.max(0, (l.qtyOrdered ?? 0) - (l.qtyReceived ?? 0)), 0);
        frame = {
          sku: (frameComponent as any).sku,
          name: (frameComponent as any).name,
          stock: (frameComponent as any).currentStock ?? 0,
          onOrder: framesOnOrder,
        };
      }
      const zeroFrames = framesOnOrder === 0;
      pushSignal = {
        ...base,
        frame,
        framesOnOrder,
        status: zeroFrames ? "red" : base.status,
        note: frame == null
          ? "frame component not identifiable from the BOM — frames-on-order is a data gap (not 0)"
          : zeroFrames
            ? `ZERO frames on order (${frame.sku} stock ${frame.stock}) — reorder urgency: pivot ${base.buckets?.pivotQty ?? 0}, afs ${base.buckets?.availableForSaleQty ?? 0}`
            : base.note,
      };
    }
  } catch {
    pushSignal = null; // named line degrades silently to absent only on hard failure; the section note covers it
  }

  const statuses = [...topMovers.map((m) => m.status), ...(pushSignal ? [pushSignal.status] : [])];
  const worstDays = topMovers.reduce<number | null>(
    (min, m) => (m.daysLeft != null && (min == null || m.daysLeft < min) ? m.daysLeft : min),
    null,
  );
  return {
    value: worstDays,
    source,
    asOf: nowIso,
    status: statuses.length ? rollupVerdict(statuses) : "gap",
    note: pushSignal == null ? "SBR-PUSH-1.0 signal unavailable (item or PO data unreadable)" : undefined,
    topMovers,
    pushSignal,
  };
}

async function gatherDecisions(db: any, deps: CfoVerdictDeps, nowIso: string): Promise<DecisionsSection> {
  const source = "truth_reports (latest) + data_reconciliation_log (PROPOSED, 7d) + purchase_orders (pending drafts)";
  const candidates: DecisionCandidate[] = [];
  const problems: string[] = [];

  let report: TruthReport | null = null;
  try {
    report = await deps.getLatestTruthReport();
  } catch (e: any) {
    problems.push(`truth_reports unreadable: ${e?.message ?? e}`);
  }
  if (report) {
    for (const c of report.checks) {
      if (c.status === "FAIL" || c.status === "WARN") {
        candidates.push({
          kind: c.status === "FAIL" ? "truth_fail" : "truth_warn",
          title: `Truth check ${c.id} ${c.status}: ${c.name}`,
          why: c.summary,
          source: "truth_reports (truth-monitor-service)",
          asOf: report.runAt || null,
        });
      }
    }
  }

  try {
    const recon = rowsOf(await db.execute(sql`
      SELECT data_type, entity_key, reason, created_at::text AS created_at
      FROM data_reconciliation_log
      WHERE action = 'PROPOSED' AND created_at >= now() - interval '7 days'
      ORDER BY created_at DESC
      LIMIT 10`));
    for (const r of recon) {
      candidates.push({
        kind: "recon_proposed",
        title: `Proposed correction awaiting review: ${r.data_type} ${r.entity_key}`,
        why: String(r.reason ?? "computed correction exceeds the auto-apply cap — needs a human decision"),
        source: "data_reconciliation_log",
        asOf: r.created_at ?? null,
      });
    }
  } catch (e: any) {
    problems.push(`data_reconciliation_log unreadable: ${e?.message ?? e}`);
  }

  try {
    const pos = await deps.storage.getAllPurchaseOrders();
    for (const p of pos.filter((x: any) => PO_DRAFT_STATUSES.has(String(x.status)))) {
      candidates.push({
        kind: "po_draft",
        title: `PO draft pending: ${(p as any).poNumber ?? p.id}${(p as any).supplierName ? ` — ${(p as any).supplierName}` : ""}`,
        why: `$${Math.round((p as any).total ?? 0).toLocaleString()} draft has not been sent — approve & send it or kill it (existing PO approval flow; nothing auto-sends)`,
        source: "purchase_orders (status DRAFT/APPROVAL_PENDING/APPROVED)",
        asOf: (p as any).updatedAt ? new Date((p as any).updatedAt).toISOString() : null,
      });
    }
  } catch (e: any) {
    problems.push(`purchase_orders unreadable: ${e?.message ?? e}`);
  }

  const items = rankDecisions(candidates);
  const hasFail = items.some((i) => i.kind === "truth_fail");
  return {
    value: candidates.length,
    source,
    asOf: nowIso,
    status: problems.length && !candidates.length ? "gap" : hasFail ? "red" : items.length ? "amber" : "ok",
    note: problems.length ? problems.join("; ") : items.length ? undefined : "no open integrity failures, proposed corrections, or pending PO drafts",
    items,
  };
}

/** THE morning picture. Read-only; every section carries provenance; every miss is a stated gap. */
export async function getCfoVerdict(db: any, deps: CfoVerdictDeps = defaultDeps): Promise<CfoVerdict> {
  const now = deps.now();
  const nowIso = now.toISOString();

  // 1. CASH
  let cash: CashSection;
  try {
    cash = composeCashSection(await deps.getBankConfirmedOverride(db));
  } catch (e) {
    cash = { ...gapStamp<number>(CASH_SOURCE, e), staleDays: null, updateHref: "/cash-out" };
  }

  // 2. RUNWAY
  let runway: RunwaySection;
  try {
    runway = composeRunwaySection(await deps.computeRunway(), nowIso);
  } catch (e) {
    runway = {
      ...gapStamp<number>("runway-service.computeRunway", e),
      basis: "unavailable", burnRatePerDay: null, cashFlowPositive: false,
      debtServiceMonthly: null, debtBlindBalance: null,
    };
  }

  // 3. MER + feed confidence
  let mer: MerSection;
  try {
    const truth = await deps.getMarketingTruth(db);
    const feeds: FeedChip[] = [];
    try {
      const mc = await deps.getMetaDirectFeedConfidence();
      feeds.push({
        feed: "meta-direct",
        status: mc.confidence === "actual" ? "ok" : mc.confidence === "stale" ? "amber" : "gap",
        detail: mc.reason,
        latestPeriodEnd: mc.latestPeriodEnd,
        daysOld: mc.daysOld,
      });
    } catch (e: any) {
      feeds.push({ feed: "meta-direct", status: "gap", detail: `confidence unavailable: ${e?.message ?? e}`, latestPeriodEnd: null, daysOld: null });
    }
    try {
      const snaps = (await deps.storage.getActiveMarketingSpendSnapshots()) as any[];
      feeds.push(windsorFreshness(snaps, now.getTime(), deps.getWindsorSyncStatus()));
    } catch (e: any) {
      feeds.push({ feed: "windsor", status: "gap", detail: `freshness unavailable: ${e?.message ?? e}`, latestPeriodEnd: null, daysOld: null });
    }
    const status = classifyMer(truth.blendedMer, truth.merBreakevenStatic, truth.confidence);
    mer = {
      value: truth.blendedMer,
      source: "marketing-truth-service.getMarketingTruth (governor blended MER on the canonical merDenominator; no math of its own)",
      asOf: truth.generatedAt,
      status,
      note: status === "ok" ? undefined : truth.confidenceReasons[0] ??
        (truth.blendedMer != null && truth.blendedMer < truth.merBreakevenStatic
          ? `below the ${truth.merBreakevenStatic}x gate`
          : undefined),
      gate: truth.merBreakevenStatic,
      measuredBreakeven: truth.merBreakevenMeasured,
      contributionMer: truth.contributionMer,
      confidence: truth.confidence,
      confidenceReasons: truth.confidenceReasons,
      feeds,
    };
  } catch (e) {
    mer = {
      ...gapStamp<number>("marketing-truth-service.getMarketingTruth", e),
      gate: 5, measuredBreakeven: null, contributionMer: null,
      confidence: "unreliable", confidenceReasons: [], feeds: [],
    };
  }

  // 4. CONTRIBUTION
  let contribution: ContributionSection;
  try {
    contribution = composeContributionSection(await deps.getBlendedContributionMargin(db, 30), nowIso);
  } catch (e) {
    contribution = {
      ...gapStamp<number>("contribution-margin-service.getBlendedContributionMargin", e),
      marginPctDisplay: null, cogsPlugShare: null, caveats: [],
    };
  }

  // 5. CASH LEAKS
  let cashLeaks: CashLeaksSection;
  try {
    const snaps = (await deps.storage.getActiveMarketingSpendSnapshots()) as any[];
    cashLeaks = composeLeaksSection(snaps, now.getTime());
  } catch (e) {
    cashLeaks = { ...gapStamp<number>("marketing_spend_snapshots (ACTIVE)", e), leaks: [], awaiting: [] };
  }

  // 6. INVENTORY
  let inventory: InventorySection;
  try {
    inventory = await gatherInventory(deps, nowIso);
  } catch (e) {
    inventory = {
      ...gapStamp<number>("storage.getSkuSalesVelocity + items buckets", e),
      topMovers: [], pushSignal: null,
    };
  }

  // 7. DECISIONS
  let decisions: DecisionsSection;
  try {
    decisions = await gatherDecisions(db, deps, nowIso);
  } catch (e) {
    decisions = { ...gapStamp<number>("truth_reports + data_reconciliation_log + purchase_orders", e), items: [] };
  }

  const overall = rollupVerdict([
    cash.status, runway.status, mer.status, contribution.status,
    cashLeaks.status, inventory.status, decisions.status,
  ]);
  const gapCount = [cash, runway, mer, contribution, cashLeaks, inventory, decisions]
    .filter((s) => s.status === "gap").length;
  const headline =
    overall === "red" ? "Act today — at least one section is critical."
    : overall === "amber" ? "Degraded — watch the amber sections before deciding."
    : overall === "gap" ? `Partial picture — ${gapCount} section(s) awaiting data.`
    : "All sections clean.";

  return {
    generatedAt: nowIso,
    overall: { status: overall, headline },
    cash, runway, mer, contribution, cashLeaks, inventory, decisions,
  };
}
