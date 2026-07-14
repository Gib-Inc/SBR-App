/**
 * CFO Cash Forecast — read-only truth layer.
 *
 * This service composes existing cash inputs into short-horizon forecasts. It
 * recommends and labels assumptions; it never moves money, pays bills, or
 * transfers funds.
 *
 * Accounting rules encoded here (Slice-1 fixes):
 *  - COMPLETENESS: past-due and undated unpaid obligations are DUE NOW — they
 *    appear in every horizon (the prior version silently dropped them).
 *  - CUTOFF: daily/weekly/biweekly debt facilities are expanded into
 *    per-occurrence outflows across the window instead of one monthly lump on
 *    the 15th (an MCA that debits every business day is not a mid-month event).
 *  - GROSS vs NET: Shopify payout estimates arrive net of the Shopify Capital
 *    remittance skim (expected-payouts-service PAYOUT_CONFIG.skimPct), so the
 *    Shopify Capital facility is EXCLUDED from debt outflows here — one
 *    economic event, one entry.
 *  - ONE EVENT, ONE ENTRY: open POs already covered by a QBO bill obligation
 *    are dropped in favor of the bill; ad-charged card obligations are tagged
 *    as possibly overlapping the marketing run-rate (kept — conservative).
 *  - HONESTY: when the bank-confirmed balance is missing, projectedCash is
 *    null (never a fabricated number); netFlows is exposed separately.
 */
import { sql } from "drizzle-orm";
import { getBankConfirmedOverride, syncGeneratedObligations, type BankOverride } from "./cash-flow-service";
import { computeExpectedPayouts, inboundWithinDays, PAYOUT_CONFIG } from "./expected-payouts-service";
import { getCanonicalMonthlySpendByChannel } from "./canonical-spend-service";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export type ForecastConfidence = "high" | "medium" | "low";
export type ForecastLineStatus = "ok" | "estimate" | "stale" | "unknown" | "plug";
export type ForecastLineKind = "inflow" | "outflow";

export interface CashForecastLine {
  kind: ForecastLineKind;
  label: string;
  amount: number;
  dueDate: string | null;
  source: string;
  asOf: string | null;
  status: ForecastLineStatus;
  note?: string;
}

export interface CashForecastAssumption {
  label: string;
  source: string;
  asOf: string | null;
  status: ForecastLineStatus;
  detail: string;
}

export interface CashForecastHorizon {
  horizonDays: number;
  /** null when no bank-confirmed starting balance exists — never fabricated. */
  projectedCash: number | null;
  /** inflows − outflows inside this horizon; always computable. */
  netFlows: number;
  inflows: CashForecastLine[];
  outflows: CashForecastLine[];
  assumptions: CashForecastAssumption[];
  confidence: ForecastConfidence;
}

export interface CashForecastResult {
  success: true;
  generatedAt: string;
  asOf: string;
  startingCash: {
    amount: number | null;
    source: "bank_confirmed" | "missing";
    asOf: string | null;
    status: ForecastLineStatus;
    staleHours: number | null;
  };
  horizons: CashForecastHorizon[];
}

export interface CashForecastInputs {
  asOf: string;
  bank: BankOverride | null;
  inflows: CashForecastLine[];
  outflows: CashForecastLine[];
  assumptions?: CashForecastAssumption[];
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isWeekday = (ymd: string): boolean => {
  const dow = new Date(`${ymd}T00:00:00.000Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
};

/**
 * Pure: does a line belong in a horizon? Undated → yes (payable, timing
 * unknown). PAST DUE (dueDate < asOf) → yes in EVERY horizon: an unpaid bill
 * due yesterday is the most certain outflow there is. Future-dated → only
 * inside the horizon window.
 */
export function lineInHorizon(line: CashForecastLine, asOf: string, horizonDays: number): boolean {
  if (!line.dueDate) return true;
  if (line.dueDate < asOf) return true;
  return line.dueDate <= addDays(asOf, horizonDays);
}

function confidenceFor(
  startingStatus: ForecastLineStatus,
  lines: CashForecastLine[],
  assumptions: CashForecastAssumption[],
): ForecastConfidence {
  const statuses = [startingStatus, ...lines.map((l) => l.status), ...assumptions.map((a) => a.status)];
  if (statuses.includes("unknown") || statuses.includes("plug")) return "low";
  if (statuses.includes("stale") || statuses.includes("estimate")) return "medium";
  return "high";
}

export function buildCashForecastFromInputs(
  inputs: CashForecastInputs,
  horizons = [7, 14, 30, 60],
): CashForecastResult {
  const startingCashStatus: ForecastLineStatus = inputs.bank ? (inputs.bank.stale ? "stale" : "ok") : "unknown";
  const startingAmount = inputs.bank?.cashOnHand ?? null;
  const baseAssumptions: CashForecastAssumption[] = [...(inputs.assumptions ?? [])];

  if (!inputs.bank) {
    baseAssumptions.push({
      label: "Bank-confirmed cash missing",
      source: "bank_balance_entries",
      asOf: null,
      status: "unknown",
      detail: "No projected cash is shown until Stacy/Matt enters a fresh bank balance; QuickBooks cash is not used as a cash truth anchor. Net flows are still computed.",
    });
  } else if (inputs.bank.stale) {
    baseAssumptions.push({
      label: "Bank-confirmed cash is stale",
      source: "bank_balance_entries",
      asOf: inputs.bank.confirmedAt,
      status: "stale",
      detail: `Last bank balance is about ${inputs.bank.staleHours} hours old.`,
    });
  }

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    asOf: inputs.asOf,
    startingCash: {
      amount: startingAmount,
      source: inputs.bank ? "bank_confirmed" : "missing",
      asOf: inputs.bank?.confirmedAt ?? null,
      status: startingCashStatus,
      staleHours: inputs.bank?.staleHours ?? null,
    },
    horizons: horizons.map((horizonDays) => {
      const inflows = inputs.inflows.filter((line) => lineInHorizon(line, inputs.asOf, horizonDays));
      const outflows = inputs.outflows.filter((line) => lineInHorizon(line, inputs.asOf, horizonDays));
      const totalIn = inflows.reduce((sum, line) => sum + line.amount, 0);
      const totalOut = outflows.reduce((sum, line) => sum + line.amount, 0);
      const netFlows = r2(totalIn - totalOut);
      return {
        horizonDays,
        projectedCash: startingAmount == null ? null : r2(startingAmount + netFlows),
        netFlows,
        inflows,
        outflows,
        assumptions: baseAssumptions,
        confidence: confidenceFor(startingCashStatus, [...inflows, ...outflows], baseAssumptions),
      };
    }),
  };
}

/** Facilities whose remittance is withheld from marketplace payouts BEFORE cash
 *  lands (already netted in expected-payouts): never also count them as debt
 *  outflows. */
const PAYOUT_SKIMMED_FACILITY = /shopify\s*capital/i;

/** Cards that carry the ad spend (marketing run-rate may overlap their payments). */
const AD_CARD = /capital\s*one|amex|american\s*express|capital\s*on\s*tap/i;

export async function getCashObligationOutflows(
  db: any,
  asOf: string,
  maxDays: number,
  excludeDebtPayees: Set<string> = new Set(),
): Promise<{ lines: CashForecastLine[]; billRefs: string[] }> {
  const end = addDays(asOf, maxDays);
  // COMPLETENESS: mirrors the ranked pay-order query (cash-flow-service) —
  // undated and PAST-DUE unpaid obligations are included, not just future-dated
  // ones. 'deferred' stays excluded (an explicit operator decision to not pay).
  const out = rows(await db.execute(sql`
    select label, payee, category, amount::float8 as amount, amount_estimated,
           due_date::text as due_date, source, source_ref, external_key, updated_at::text as updated_at
    from cash_obligations
    where is_active
      and status not in ('paid', 'deferred', 'covered_by_plan')
      and (due_date is null or due_date <= ${end}::date)`));

  const excluded = new Set(Array.from(excludeDebtPayees, (p) => p.toLowerCase()));
  const billRefs: string[] = [];
  const lines: CashForecastLine[] = [];
  for (const o of out) {
    const payee = String(o.payee ?? "");
    // GROSS vs NET / ONE ENTRY: skip facilities whose cash exit is already
    // represented elsewhere (payout skim netting or cadence expansion).
    if (o.source === "debt" && (PAYOUT_SKIMMED_FACILITY.test(payee) || excluded.has(payee.toLowerCase()))) continue;
    if (o.source === "qb_bill") {
      if (o.source_ref) billRefs.push(String(o.source_ref));
      billRefs.push(String(o.label ?? ""));
    }
    const pastDue = o.due_date != null && o.due_date < asOf;
    const undated = o.due_date == null;
    const adCardOverlap = o.source === "debt" && AD_CARD.test(payee);
    lines.push({
      kind: "outflow",
      label: payee ? `${o.label} (${payee})` : String(o.label ?? "Cash obligation"),
      amount: r2(num(o.amount)),
      dueDate: o.due_date,
      source: o.source === "qb_bill" ? "cash_obligations:qb_bill" : `cash_obligations:${o.source ?? "manual"}`,
      asOf: o.updated_at ?? null,
      status: o.amount_estimated ? "estimate" : "ok",
      note: [
        pastDue ? "PAST DUE — payable immediately; counted in every horizon." : null,
        undated ? "Undated obligation — counted in every horizon until a due date is set." : null,
        o.amount_estimated ? "Amount is operator/system estimate." : null,
        adCardOverlap ? "Ad spend is charged to this card — may overlap the marketing run-rate line (kept; overstating outflows is the conservative error)." : null,
      ].filter(Boolean).join(" ") || undefined,
    });
  }
  return { lines, billRefs };
}

/** Pure: expand a facility's cadence into per-occurrence due dates inside the
 *  window. daily → business days; weekly → every 7 days; biweekly → every 14. */
export function expandCadenceOccurrences(
  asOf: string,
  maxDays: number,
  frequency: string,
): string[] {
  const f = frequency.toLowerCase();
  const out: string[] = [];
  if (f === "daily") {
    for (let i = 1; i <= maxDays; i++) {
      const d = addDays(asOf, i);
      if (isWeekday(d)) out.push(d);
    }
  } else if (f === "weekly" || f === "biweekly") {
    const step = f === "weekly" ? 7 : 14;
    for (let i = step; i <= maxDays; i += step) out.push(addDays(asOf, i));
  }
  return out;
}

/**
 * CUTOFF fix: daily/weekly/biweekly facilities (the MCAs) debit continuously —
 * a monthly lump on the 15th misstates every short horizon. Expand them into
 * per-occurrence outflow lines; their monthly-lump cash_obligations rows are
 * excluded via the returned facility-name set. Payout-skimmed facilities
 * (Shopify Capital) are excluded entirely — their cash exit is already netted
 * out of the payout inflows.
 */
export async function getExpandedDebtOutflows(db: any, asOf: string, maxDays: number): Promise<{
  lines: CashForecastLine[];
  expandedPayees: Set<string>;
}> {
  const facilities = rows(await db.execute(sql`
    select name, payment_amount::float8 as payment_amount, payment_frequency
    from credit_lines
    where is_active and balance > 0
      and payment_amount is not null and payment_amount > 0
      and lower(coalesce(payment_frequency, 'monthly')) in ('daily', 'weekly', 'biweekly')`));

  const lines: CashForecastLine[] = [];
  const expandedPayees = new Set<string>();
  for (const f of facilities) {
    const name = String(f.name ?? "");
    if (PAYOUT_SKIMMED_FACILITY.test(name)) { expandedPayees.add(name); continue; }
    const freq = String(f.payment_frequency ?? "").toLowerCase();
    const occurrences = expandCadenceOccurrences(asOf, maxDays, freq);
    if (!occurrences.length) continue;
    expandedPayees.add(name);
    for (const due of occurrences) {
      lines.push({
        kind: "outflow",
        label: `${name} (${freq} auto-debit)`,
        amount: r2(num(f.payment_amount)),
        dueDate: due,
        source: "credit_lines:cadence_expansion",
        asOf,
        status: "estimate",
        note: `Per-occurrence ${freq} debit expanded from the debt schedule (replaces the monthly-lump obligation for this facility).`,
      });
    }
  }
  return { lines, expandedPayees };
}

export async function getOpenPurchaseOrderOutflows(db: any, asOf: string, maxDays: number): Promise<CashForecastLine[]> {
  const end = addDays(asOf, maxDays);
  const out = rows(await db.execute(sql`
    select po_number, supplier_name, total::float8 as total,
           coalesce(expected_delivery::text, expected_date::date::text, order_date::date::text) as due_date,
           updated_at::text as updated_at, status
    from purchase_orders
    where coalesce(is_historical, false) = false
      and upper(coalesce(status, '')) not in ('CANCELLED', 'CLOSED', 'RECEIVED', 'PAID', 'DRAFT')
      and coalesce(total, 0) > 0
      and coalesce(expected_delivery, expected_date::date, order_date::date) >= ${asOf}::date
      and coalesce(expected_delivery, expected_date::date, order_date::date) <= ${end}::date`));

  return out.map((po: any) => ({
    kind: "outflow" as const,
    label: `${po.po_number}${po.supplier_name ? ` · ${po.supplier_name}` : ""}`,
    amount: r2(num(po.total)),
    dueDate: po.due_date,
    source: "purchase_orders:open_total",
    asOf: po.updated_at ?? null,
    status: "estimate" as const,
    note: "Open PO cash timing is estimated from expected delivery/order date; invoice/payment timing may differ.",
  }));
}

/** Pure (ONE EVENT, ONE ENTRY): drop PO lines already represented by a QBO
 *  bill obligation — match the PO number inside the bill's source_ref/label. */
export function dedupPoLinesAgainstBills(
  poLines: CashForecastLine[],
  billRefs: string[],
): { kept: CashForecastLine[]; droppedCount: number; droppedTotal: number } {
  const haystack = billRefs.join("\n").toLowerCase();
  const kept: CashForecastLine[] = [];
  let droppedCount = 0;
  let droppedTotal = 0;
  for (const line of poLines) {
    const poNumber = line.label.split("·")[0]?.trim().toLowerCase();
    if (poNumber && poNumber.length >= 4 && haystack.includes(poNumber)) {
      droppedCount++;
      droppedTotal = r2(droppedTotal + line.amount);
      continue; // covered by the QBO bill obligation — count once
    }
    kept.push(line);
  }
  return { kept, droppedCount, droppedTotal };
}

export async function getExpectedPayoutInflows(db: any, asOf: string, horizons: number[]): Promise<CashForecastLine[]> {
  const ep = await computeExpectedPayouts(db, asOf);
  const sorted = Array.from(new Set(horizons)).sort((a, b) => a - b);
  let prior = 0;
  const lines: CashForecastLine[] = [];
  for (const days of sorted) {
    const cumulative = inboundWithinDays(ep, days);
    const amount = r2(cumulative - prior);
    prior = cumulative;
    if (amount <= 0) continue;
    lines.push({
      kind: "inflow",
      label: `Expected marketplace payouts through day ${days}`,
      amount,
      dueDate: addDays(asOf, days),
      source: "expected-payouts-service:sales-estimate",
      asOf: ep.asOf,
      status: "estimate",
      note: "Sales-derived payout estimate, net of marketplace fees AND the Shopify Capital remittance skim, until real settlement feeds are connected.",
    });
  }
  return lines;
}

/** Pure: prorate a daily run-rate into per-horizon incremental lines (day-7
 *  slice, day-14 increment, ...), so EVERY horizon carries its share — the
 *  prior single line dated at day-60 left ad spend out of the 7/14/30-day
 *  forecasts entirely. */
export function prorateRunRateAcrossHorizons(
  daily: number,
  asOf: string,
  horizons: number[],
  base: Omit<CashForecastLine, "amount" | "dueDate" | "label">,
  labelPrefix: string,
): CashForecastLine[] {
  const sorted = Array.from(new Set(horizons)).sort((a, b) => a - b);
  let prior = 0;
  const lines: CashForecastLine[] = [];
  for (const days of sorted) {
    const amount = r2(daily * (days - prior));
    prior = days;
    if (amount <= 0) continue;
    lines.push({ ...base, label: `${labelPrefix} through day ${days}`, amount, dueDate: addDays(asOf, days) });
  }
  return lines;
}

export async function getCanonicalAdSpendOutflow(db: any, asOf: string, horizons: number[]): Promise<{
  lines: CashForecastLine[];
  assumption: CashForecastAssumption;
}> {
  const months = await getCanonicalMonthlySpendByChannel(db, 3);
  const usable = months.filter((m) => m.merDenominator != null && Number.isFinite(m.merDenominator));
  const last = usable[usable.length - 1];
  if (!last) {
    return {
      lines: [],
      assumption: {
        label: "Ad spend run-rate unavailable",
        source: "canonical-spend-service",
        asOf: null,
        status: "unknown",
        detail: "No canonical MER denominator month is available, so ad spend is excluded from this forecast.",
      },
    };
  }

  const daily = r2(num(last.merDenominator) / 30);
  const status: ForecastLineStatus = last.merUnderstated ? "stale" : "estimate";
  const lines = prorateRunRateAcrossHorizons(daily, asOf, horizons, {
    kind: "outflow",
    source: "canonical-spend-service:mer_denominator",
    asOf: last.month,
    status,
    note: last.merUnderstated
      ? "Canonical marketing spend says the MER denominator may be understated."
      : "Run-rate estimate from canonical monthly marketing spend.",
  }, "Marketing spend run-rate");
  return {
    lines,
    assumption: {
      label: "Marketing spend run-rate",
      source: "canonical-spend-service:mer_denominator",
      asOf: last.month,
      status,
      detail: `${daily.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}/day from the latest canonical monthly MER denominator, prorated into every horizon. Ad-charged card payments are tagged as possible overlap (kept — conservative).`,
    },
  };
}

async function persistForecastSnapshot(db: any, result: CashForecastResult): Promise<void> {
  // Friday variance discipline: every morning's forecast is kept so it can be
  // compared against what actually happened. Raw JSON — no consumers yet.
  await db.execute(sql`
    insert into forecast_snapshots (as_of, forecast_type, payload, generated_at)
    values (${result.asOf}::date, 'cash_forecast', ${JSON.stringify(result)}::jsonb, now())
    on conflict (as_of, forecast_type) do update set
      payload = excluded.payload,
      generated_at = excluded.generated_at,
      updated_at = now()`);
}

export async function getCashForecast(db: any, opts: { asOf?: string; horizons?: number[] } = {}): Promise<CashForecastResult> {
  const asOf = opts.asOf ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  const horizons = opts.horizons?.length ? opts.horizons : [7, 14, 30, 60];
  const maxDays = Math.max(...horizons);

  await syncGeneratedObligations(db, asOf).catch((err: any) => {
    console.warn("[CashForecast] obligation sync failed:", err?.message ?? err);
  });

  const bank = await getBankConfirmedOverride(db).catch(() => null);
  const expanded = await getExpandedDebtOutflows(db, asOf, maxDays).catch((err: any) => {
    console.warn("[CashForecast] cadence expansion failed:", err?.message ?? err);
    return { lines: [] as CashForecastLine[], expandedPayees: new Set<string>() };
  });

  const [obligations, poOutflows, payoutInflows, adSpend] = await Promise.all([
    getCashObligationOutflows(db, asOf, maxDays, expanded.expandedPayees),
    getOpenPurchaseOrderOutflows(db, asOf, maxDays),
    getExpectedPayoutInflows(db, asOf, horizons).catch((err: any) => [{
      kind: "inflow" as const,
      label: "Expected marketplace payouts unavailable",
      amount: 0,
      dueDate: null,
      source: "expected-payouts-service",
      asOf: null,
      status: "unknown" as const,
      note: err?.message ?? "Expected payout calculation failed.",
    }]),
    getCanonicalAdSpendOutflow(db, asOf, horizons).catch((err: any) => ({
      lines: [] as CashForecastLine[],
      assumption: {
        label: "Ad spend run-rate unavailable",
        source: "canonical-spend-service",
        asOf: null,
        status: "unknown" as const,
        detail: err?.message ?? "Canonical spend calculation failed.",
      },
    })),
  ]);

  const { kept: dedupedPoLines, droppedCount, droppedTotal } = dedupPoLinesAgainstBills(poOutflows, obligations.billRefs);

  const skim = PAYOUT_CONFIG.shopify.skimPct;
  const result = buildCashForecastFromInputs({
    asOf,
    bank,
    inflows: payoutInflows,
    outflows: [...obligations.lines, ...expanded.lines, ...dedupedPoLines, ...adSpend.lines],
    assumptions: [
      adSpend.assumption,
      {
        label: "Shopify Capital remittance netted from payouts",
        source: "expected-payouts-service:skimPct",
        asOf,
        status: "estimate",
        detail: `${Math.round(skim * 100)}% of Shopify gross is withheld by Shopify Capital before deposits land; payout inflows are net of it and the Shopify Capital facility is excluded from debt outflows (one event, one entry).`,
      },
      {
        label: "B2B/AR invoice collections excluded",
        source: "qbo:accounts_receivable",
        asOf: null,
        status: "unknown",
        detail: "No AR feed is wired, so wholesale/institutional invoice collections are not counted as inflows. Conservative — real cash may arrive that this forecast does not show.",
      },
      ...(droppedCount > 0 ? [{
        label: "Open POs covered by QBO bills",
        source: "cash-forecast:dedup",
        asOf,
        status: "ok" as const,
        detail: `${droppedCount} open PO(s) totaling $${droppedTotal.toLocaleString()} matched an existing QBO bill obligation and were counted once (as the bill).`,
      }] : []),
      {
        label: "No payment execution",
        source: "SBR policy",
        asOf,
        status: "ok",
        detail: "Forecast recommends and records only. Stacy Stubbs remains the sole bank signatory.",
      },
    ],
  }, horizons);

  await persistForecastSnapshot(db, result).catch((err: any) => {
    console.warn("[CashForecast] snapshot persist failed:", err?.message ?? err);
  });

  return result;
}
