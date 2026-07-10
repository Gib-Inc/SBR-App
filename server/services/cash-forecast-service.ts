/**
 * CFO Cash Forecast — read-only truth layer.
 *
 * This service composes existing cash inputs into short-horizon forecasts. It
 * recommends and labels assumptions; it never moves money, pays bills, or
 * transfers funds.
 */
import { sql } from "drizzle-orm";
import { getBankConfirmedOverride, syncGeneratedObligations, type BankOverride } from "./cash-flow-service";
import { computeExpectedPayouts, inboundWithinDays } from "./expected-payouts-service";
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
  projectedCash: number;
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

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function withinHorizon(line: CashForecastLine, asOf: string, horizonDays: number): boolean {
  if (!line.dueDate) return true;
  return line.dueDate >= asOf && line.dueDate <= addDays(asOf, horizonDays);
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
      detail: "Forecast is shown from $0 until Stacy/Matt enters a fresh bank balance; QuickBooks cash is not used as a cash truth anchor.",
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
      const inflows = inputs.inflows.filter((line) => withinHorizon(line, inputs.asOf, horizonDays));
      const outflows = inputs.outflows.filter((line) => withinHorizon(line, inputs.asOf, horizonDays));
      const totalIn = inflows.reduce((sum, line) => sum + line.amount, 0);
      const totalOut = outflows.reduce((sum, line) => sum + line.amount, 0);
      const projectedCash = r2((startingAmount ?? 0) + totalIn - totalOut);
      return {
        horizonDays,
        projectedCash,
        inflows,
        outflows,
        assumptions: baseAssumptions,
        confidence: confidenceFor(startingCashStatus, [...inflows, ...outflows], baseAssumptions),
      };
    }),
  };
}

async function getCashObligationOutflows(db: any, asOf: string, maxDays: number): Promise<CashForecastLine[]> {
  const end = addDays(asOf, maxDays);
  const out = rows(await db.execute(sql`
    select label, payee, category, amount::float8 as amount, amount_estimated,
           due_date::text as due_date, source, source_ref, updated_at::text as updated_at
    from cash_obligations
    where is_active
      and status not in ('paid', 'deferred', 'covered_by_plan')
      and due_date is not null
      and due_date >= ${asOf}::date
      and due_date <= ${end}::date`));

  return out.map((o: any) => ({
    kind: "outflow",
    label: o.payee ? `${o.label} (${o.payee})` : String(o.label ?? "Cash obligation"),
    amount: r2(num(o.amount)),
    dueDate: o.due_date,
    source: o.source === "qb_bill" ? "cash_obligations:qb_bill" : `cash_obligations:${o.source ?? "manual"}`,
    asOf: o.updated_at ?? null,
    status: o.amount_estimated ? "estimate" : "ok",
    note: o.amount_estimated ? "Amount is operator/system estimate." : undefined,
  }));
}

async function getOpenPurchaseOrderOutflows(db: any, asOf: string, maxDays: number): Promise<CashForecastLine[]> {
  const end = addDays(asOf, maxDays);
  const out = rows(await db.execute(sql`
    select po_number, supplier_name, total::float8 as total,
           coalesce(expected_delivery::text, expected_date::date::text, order_date::date::text) as due_date,
           updated_at::text as updated_at, status
    from purchase_orders
    where coalesce(is_historical, false) = false
      and upper(coalesce(status, '')) not in ('CANCELLED', 'CLOSED', 'RECEIVED', 'PAID')
      and coalesce(total, 0) > 0
      and coalesce(expected_delivery, expected_date::date, order_date::date) >= ${asOf}::date
      and coalesce(expected_delivery, expected_date::date, order_date::date) <= ${end}::date`));

  return out.map((po: any) => ({
    kind: "outflow",
    label: `${po.po_number}${po.supplier_name ? ` · ${po.supplier_name}` : ""}`,
    amount: r2(num(po.total)),
    dueDate: po.due_date,
    source: "purchase_orders:open_total",
    asOf: po.updated_at ?? null,
    status: "estimate",
    note: "Open PO cash timing is estimated from expected delivery/order date; invoice/payment timing may differ.",
  }));
}

async function getExpectedPayoutInflows(db: any, asOf: string, horizons: number[]): Promise<CashForecastLine[]> {
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
      note: "Sales-derived net payout estimate until real Shopify/Amazon settlement feeds are connected.",
    });
  }
  return lines;
}

async function getCanonicalAdSpendOutflow(db: any, asOf: string, maxDays: number): Promise<{
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
  const amount = r2(daily * maxDays);
  return {
    lines: amount > 0 ? [{
      kind: "outflow",
      label: `Marketing spend run-rate (${maxDays}d)`,
      amount,
      dueDate: addDays(asOf, maxDays),
      source: "canonical-spend-service:mer_denominator",
      asOf: last.month,
      status: last.merUnderstated ? "stale" : "estimate",
      note: last.merUnderstated
        ? "Canonical marketing spend says the MER denominator may be understated."
        : "Run-rate estimate from canonical monthly marketing spend.",
    }] : [],
    assumption: {
      label: "Marketing spend run-rate",
      source: "canonical-spend-service:mer_denominator",
      asOf: last.month,
      status: last.merUnderstated ? "stale" : "estimate",
      detail: `${daily.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}/day from the latest canonical monthly MER denominator.`,
    },
  };
}

export async function getCashForecast(db: any, opts: { asOf?: string; horizons?: number[] } = {}): Promise<CashForecastResult> {
  const asOf = opts.asOf ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  const horizons = opts.horizons?.length ? opts.horizons : [7, 14, 30, 60];
  const maxDays = Math.max(...horizons);

  await syncGeneratedObligations(db, asOf).catch((err: any) => {
    console.warn("[CashForecast] obligation sync failed:", err?.message ?? err);
  });

  const bank = await getBankConfirmedOverride(db).catch(() => null);
  const [obligationOutflows, poOutflows, payoutInflows, adSpend] = await Promise.all([
    getCashObligationOutflows(db, asOf, maxDays),
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
    getCanonicalAdSpendOutflow(db, asOf, maxDays).catch((err: any) => ({
      lines: [],
      assumption: {
        label: "Ad spend run-rate unavailable",
        source: "canonical-spend-service",
        asOf: null,
        status: "unknown" as const,
        detail: err?.message ?? "Canonical spend calculation failed.",
      },
    })),
  ]);

  return buildCashForecastFromInputs({
    asOf,
    bank,
    inflows: payoutInflows,
    outflows: [...obligationOutflows, ...poOutflows, ...adSpend.lines],
    assumptions: [
      adSpend.assumption,
      {
        label: "No payment execution",
        source: "SBR policy",
        asOf,
        status: "ok",
        detail: "Forecast recommends and records only. Stacy Stubbs remains the sole bank signatory.",
      },
    ],
  }, horizons);
}
