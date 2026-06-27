/**
 * Cash Flow Command — a "what to pay when" decision-support layer.
 *
 * DESIGN BOUNDARY: this service RECOMMENDS and TRACKS. It never moves money.
 * "Approve" records a decision (and an audit row in payment_actions) for a human
 * to execute in the bank / QuickBooks. There is no payment-execution path here.
 *
 * Model aligned to the Weekly Cash Command spec: obligations carry a TIER
 * (mca | tier1 | tier2 | tier3 | tier4 | hold) and the ranked list is tier-first.
 *   - mca   = merchant cash advances / auto-debits (pull whether you like it or not)
 *   - tier1 = tax & payroll (penalties + trust-fund exposure; OpenAccountants-verified cadences)
 *   - tier2 = must-pay (critical vendors, secured/SBA debt)
 *   - tier3 = important, tier4 = flexible, hold = defer
 *
 * Tax cadences come from OpenAccountants accountant-verified skills
 * (us-form-941-940-payroll, us-sales-tax). Working figures — Roger confirms.
 */
import { sql } from "drizzle-orm";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export type Tier = "mca" | "tier1" | "tier2" | "tier3" | "tier4" | "hold";
export type Criticality = "must" | "important" | "flexible";
export type OblCategory = "vendor_bill" | "debt" | "tax" | "payroll" | "recurring";
export type OblStatus = "pending" | "approved" | "deferred" | "paid";

const TIER_RANK: Record<Tier, number> = { mca: 0, tier1: 1, tier2: 2, tier3: 3, tier4: 4, hold: 9 };

export interface Obligation {
  id: string;
  label: string;
  payee: string | null;
  category: OblCategory;
  tier: Tier;
  tierRank: number;
  amount: number;
  amountEstimated: boolean;
  dueDate: string | null;
  daysUntilDue: number | null;
  criticality: Criticality;
  payFrom: string | null;
  method: string | null;
  status: OblStatus;
  source: string;
  rationale: string | null;
  sourceRef: string | null;
  anomalyFlag: boolean;
  anomalyReason: string | null;
  runningCashAfter: number | null;
}

export interface CashPosition {
  asOf: string;
  cashOnHand: number;
  cashAsOf: string | null;
  dailySalesRunRate: number;
  windowDays: number;
  projectedIncome: number;
  totalDue: number;
  tier1Due: number;       // tax + payroll
  projectedLow: number;
}

export interface CashFlowResult {
  position: CashPosition;
  obligations: Obligation[];
  generatedAt: string;
}

// ── date helpers (pure) ─────────────────────────────────────────────────────
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((parseYmd(toYmd).getTime() - parseYmd(fromYmd).getTime()) / 86_400_000);
}
function lastDayOfMonth(year: number, monthIdx0: number): number {
  return new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();
}
/** "Today" as a YYYY-MM-DD in SBR's operating timezone (America/Denver). The
 *  nightly scheduler keys obligations off the Mountain date; the interactive
 *  read must agree, or an evening page-load (after UTC rolls over) generates a
 *  duplicate seed under a next-day external_key and mislabels every due date. */
function todayMountain(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
}

/** Default tier when not explicitly set: tax/payroll → tier1, else by criticality. Pure. */
export function defaultTier(category: OblCategory, criticality: Criticality): Tier {
  if (category === "tax" || category === "payroll") return "tier1";
  return criticality === "must" ? "tier2" : criticality === "important" ? "tier3" : "tier4";
}

/** Tier for a debt facility by its name/type. MCAs/fintech auto-debit → mca. Pure. */
export function debtTier(name: string, type: string): Tier {
  const n = (name || "").toLowerCase();
  if (/shopify capital|fresh funding|paypal|loanbuilder|uncapped|capital on tap|\bfora\b|\bmca\b/.test(n)) return "mca";
  if (type === "loan") return "tier2";       // SBA / bank term loans
  return "tier3";                            // cards / LOCs
}

/**
 * Rank tier-first (mca → tier1 → ...), then most-overdue, then largest, and
 * project the running cash balance if paid in that order. Pure. No DB.
 */
export function rankAndProject(obls: Obligation[], cashAvailable: number, asOf: string): Obligation[] {
  const ranked = obls
    .map((o) => ({ ...o, daysUntilDue: o.dueDate ? daysBetween(asOf, o.dueDate) : null, tierRank: TIER_RANK[o.tier] ?? 3 }))
    .sort((a, b) =>
      a.tierRank - b.tierRank ||
      (a.daysUntilDue ?? 9999) - (b.daysUntilDue ?? 9999) ||
      b.amount - a.amount);
  let running = cashAvailable;
  for (const o of ranked) {
    // hold = defer (per the tier model): parked bills do not draw down the runway.
    if (o.status === "paid" || o.status === "deferred" || o.tier === "hold") { o.runningCashAfter = null; continue; }
    running = r2(running - o.amount);
    o.runningCashAfter = running;
  }
  return ranked;
}

// ── tax & payroll cadences (OpenAccountants-verified) ───────────────────────
export function taxObligationSeeds(asOf: string): Array<{
  label: string; payee: string; category: OblCategory; tier: Tier; dueDate: string;
  cadence: string; criticality: Criticality; externalKey: string; rationale: string; sourceRef: string;
}> {
  const now = parseYmd(asOf);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const out: ReturnType<typeof taxObligationSeeds> = [];

  // Federal payroll deposit — monthly depositor: due the 15th of the following month.
  const depMonth = now.getUTCDate() <= 15 ? m : m + 1;
  const depYear = y + Math.floor(depMonth / 12);
  const depM = ((depMonth % 12) + 12) % 12;
  out.push({
    label: "Federal payroll tax deposit (941)", payee: "IRS / EFTPS", category: "payroll", tier: "tier1",
    dueDate: `${depYear}-${String(depM + 1).padStart(2, "0")}-15`, cadence: "monthly", criticality: "must",
    externalKey: `tax:payroll-deposit:${depYear}-${String(depM + 1).padStart(2, "0")}`,
    rationale: "Monthly depositor: prior month's withholding + FICA due by the 15th. Late = §6656 penalty + personal trust-fund exposure. Confirm semiweekly vs monthly with Roger.",
    sourceRef: "us-form-941-940-payroll",
  });

  // Quarterly 941 / FUTA — Apr 30, Jul 31, Oct 31, Jan 31.
  for (const mm of ["04-30", "07-31", "10-31", "01-31"]) {
    const q = mm === "01-31" ? "Q4" : mm === "04-30" ? "Q1" : mm === "07-31" ? "Q2" : "Q3";
    // Q4's 941/940 is due Jan 31. When asOf is already in January (m===0), that
    // deadline is THIS year (~days away); only Feb-Dec roll it to next year.
    // Hardcoding y+1 dropped the imminent Jan-31 filing out of the 120-day window
    // every January — the highest-consequence tax obligation, silently missing.
    const due = q === "Q4" ? `${m === 0 ? y : y + 1}-${mm}` : `${y}-${mm}`;
    const dlt = daysBetween(asOf, due);
    if (dlt >= 0 && dlt <= 120) {
      out.push({
        label: `Form 941 quarterly (${q})`, payee: "IRS / EFTPS", category: "tax", tier: "tier1", dueDate: due,
        cadence: "quarterly", criticality: "must", externalKey: `tax:941:${due}`,
        rationale: `Quarterly 941 balance due ${due}; FUTA (940) deposit too if accrued > $500.`, sourceRef: "us-form-941-940-payroll",
      });
    }
  }

  // Utah sales/use tax — monthly filer: due the last day of the following month.
  const stMonth = m + 1;
  const stYear = y + Math.floor(stMonth / 12);
  const stM = ((stMonth % 12) + 12) % 12;
  const stDue = `${stYear}-${String(stM + 1).padStart(2, "0")}-${String(lastDayOfMonth(stYear, stM)).padStart(2, "0")}`;
  out.push({
    label: "Utah sales & use tax (TC-62)", payee: "Utah State Tax Commission", category: "tax", tier: "tier1",
    dueDate: stDue, cadence: "monthly", criticality: "must", externalKey: `tax:ut-sales:${stYear}-${String(stM + 1).padStart(2, "0")}`,
    rationale: "Sales/use tax collected is the state's money — remit by month end. Confirm UT filing frequency + add other registered states with Roger.",
    sourceRef: "us-sales-tax",
  });

  return out;
}

// ── DB: cash position ───────────────────────────────────────────────────────
export async function getCashPosition(db: any, windowDays: number, asOf: string): Promise<CashPosition> {
  // Skip NULL-cash snapshots: a QB capture that gapped on bank accounts persists
  // a row with cash_on_hand = NULL, which would coalesce to $0 and fabricate a
  // shortfall. The canonical accessor (getLatestQbLiveSnapshot) filters these too.
  const cashRow = rows(await db.execute(sql`
    select cash_on_hand, captured_at::date as cash_as_of
    from qb_financial_snapshots where cash_on_hand is not null
    order by captured_at desc limit 1`))[0];
  const cashOnHand = num(cashRow?.cash_on_hand);

  // Daily run-rate = trailing-30-day net revenue over a FIXED 30-day denominator.
  // avg() would divide by the count of present rows, so missing snapshot days
  // inflate the rate and make projected income too optimistic (under-warning the
  // shortfall — the wrong direction for a runway tool). net_revenue is NOT NULL.
  const salesRow = rows(await db.execute(sql`
    select coalesce(sum(net_revenue), 0) / 30.0 as daily_net
    from daily_sales_snapshots where date >= (${asOf}::date - 30)`))[0];
  const dailyRunRate = num(salesRow?.daily_net);

  return {
    asOf, cashOnHand, cashAsOf: cashRow?.cash_as_of ?? null,
    dailySalesRunRate: r2(dailyRunRate), windowDays, projectedIncome: r2(dailyRunRate * windowDays),
    totalDue: 0, tier1Due: 0, projectedLow: 0,
  };
}

/** Write a cash_position snapshot row (so the standalone tool can read it too). */
export async function writeCashPosition(db: any, asOf: string): Promise<void> {
  const p = await getCashPosition(db, 30, asOf);
  // One snapshot per day. getCashFlow runs on every page read, so without this
  // guard cash_position would accumulate a duplicate row per read. Refresh the
  // day's row if it already exists, otherwise insert it.
  const existing = rows(await db.execute(sql`
    select id from cash_position where as_of = ${asOf}::date order by updated_at desc limit 1`))[0];
  if (existing?.id) {
    await db.execute(sql`
      update cash_position set cash_on_hand = ${p.cashOnHand}, expected_inflows = ${p.projectedIncome},
        source = 'qbo', updated_at = now() where id = ${existing.id}`);
  } else {
    await db.execute(sql`
      insert into cash_position (as_of, cash_on_hand, expected_inflows, source, updated_at)
      values (${asOf}::date, ${p.cashOnHand}, ${p.projectedIncome}, 'qbo', now())`);
  }
}

// ── DB: keep generated (tax/debt) obligations fresh ─────────────────────────
export async function syncGeneratedObligations(db: any, asOf: string): Promise<{ tax: number; debt: number }> {
  let tax = 0;
  for (const s of taxObligationSeeds(asOf)) {
    await db.execute(sql`
      insert into cash_obligations (label, payee, category, tier, amount, amount_estimated, due_date, cadence, criticality, status, source, external_key, rationale, source_ref)
      values (${s.label}, ${s.payee}, ${s.category}, ${s.tier}, 0, true, ${s.dueDate}::date, ${s.cadence}, ${s.criticality}, 'pending', 'tax', ${s.externalKey}, ${s.rationale}, ${s.sourceRef})
      on conflict (external_key) where external_key is not null do update set
        due_date = excluded.due_date, label = excluded.label, rationale = excluded.rationale,
        tier = excluded.tier, updated_at = now()
      where cash_obligations.status = 'pending'`);
    tax++;
  }

  let debt = 0;
  // Generate a monthly obligation for EVERY active facility with a balance. The
  // due_day filter used to require a non-null due_day, but credit_lines.due_day is
  // NULL on every facility, so the entire ~$1.16M debt stack never appeared in the
  // pay order. Default a NULL due day to the 15th (mid-month, avoids bunching every
  // facility on the 1st) and flag it as an estimate until the operator sets it.
  const lines = rows(await db.execute(sql`
    select name, type, due_day from credit_lines where is_active and balance > 0`));
  const now = parseYmd(asOf);
  for (const ln of lines) {
    const dueKnown = ln.due_day != null;
    const dd = Math.max(1, Math.min(28, num(ln.due_day) || 15));
    let yy = now.getUTCFullYear(), mm = now.getUTCMonth();
    if (now.getUTCDate() > dd) { mm += 1; yy += Math.floor(mm / 12); mm = ((mm % 12) + 12) % 12; }
    const due = `${yy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const key = `debt:${ln.name}:${yy}-${String(mm + 1).padStart(2, "0")}`;
    const tier = debtTier(ln.name, ln.type);
    const rationale = `Scheduled ${ln.type || "debt"} payment.${dueKnown ? "" : " Due day is an estimate (15th) until set in the debt schedule."} Enter the monthly amount in the debt schedule.`;
    await db.execute(sql`
      insert into cash_obligations (label, payee, category, tier, amount, amount_estimated, due_date, cadence, criticality, status, source, external_key, rationale)
      values (${ln.name + " payment"}, ${ln.name}, 'debt', ${tier}, 0, true, ${due}::date, 'monthly', ${tier === "tier2" ? "must" : "important"}, 'pending', 'debt', ${key}, ${rationale})
      on conflict (external_key) where external_key is not null do update set due_date = excluded.due_date, tier = excluded.tier, rationale = excluded.rationale, updated_at = now()
      where cash_obligations.status = 'pending'`);
    debt++;
  }
  await writeCashPosition(db, asOf).catch(() => {});
  return { tax, debt };
}

/** Vendors whose bills are tax obligations → tier1 (rank above ordinary AP). */
function isTaxVendor(vendor: string): boolean {
  return /tax commission|department of revenue|dept of revenue|franchise tax|\birs\b|eftps|state tax|internal revenue/i.test(vendor || "");
}

/**
 * Tier a (non-tax) vendor bill by operational criticality so the pay-order ranks
 * what the business actually needs to keep running above what can wait. Pure.
 *  - tier2 (must): fulfillment, materials, molds, freight, rent/facility — can't ship without them
 *  - tier4 (flexible): marketing / agencies / ad platforms — deferrable in a cash crunch
 *  - tier3 (important): everything else (legal, software, misc)
 */
export function classifyVendorTier(vendor: string): { tier: Tier; criticality: Criticality } {
  const v = (vendor || "").toLowerCase();
  // Marketing / ad-platform / agency first (a name can match both lists; defer wins
  // only for genuine marketing spend, so keep this list specific).
  if (/meta platforms|facebook|google ads|while you'?re in town|carpe diem|jezza|giant horizons|lucid earth|vertical ascension|gamerzdojo|tiktok|pinterest|\bmarketing\b/.test(v)) {
    return { tier: "tier4", criticality: "flexible" };
  }
  // Operationally critical: fulfillment, materials, molds, freight, rent/facility.
  if (/pyvott|accu-?form|mcmaster|uline|basic american|plastics|fulfillment|freight|postage|warehouse|\brent\b|property|utah ave|supply|materials|packaging|shippo|extensiv/.test(v)) {
    return { tier: "tier2", criticality: "must" };
  }
  return { tier: "tier3", criticality: "important" };
}

// ── DB: mirror open QuickBooks bills into the pay-order ─────────────────────
/** Upsert every open QB bill as a real (non-estimated) obligation, then mark any
 *  previously-synced qb_bill that is no longer open as paid so it drops off. The
 *  caller must only pass bills when QB actually returned them (never on a gap). */
export async function syncQbBillsToObligations(
  db: any,
  bills: Array<{ id: string | null; vendor: string; amount: number; dueDate: string | null; docNumber: string | null }>,
): Promise<{ upserted: number; closed: number }> {
  // DB-clock boundary: every still-open bill below gets updated_at = now() (> dbStart),
  // so anything left with updated_at < dbStart is no longer open in QB. Using the DB's
  // own clock keeps the sweep immune to app/DB clock skew.
  const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  const dbStart = rows(await db.execute(sql`select now() as t`))[0]?.t;
  // Vendor payment plans (e.g. "pay While You're In Town $1,000/week"): a matching
  // vendor's bills roll into ONE committed installment obligation instead of being
  // listed whole and treated as deferrable.
  const plans = rows(await db.execute(sql`
    select id, vendor_match, display_name, amount::float8 as amount, cadence, tier, note
    from vendor_payment_plans where is_active`));
  const planAgg = new Map<string, { plan: any; total: number; count: number; vendor: string }>();

  let upserted = 0;
  for (const b of bills) {
    const plan = plans.find((p: any) =>
      b.vendor.toLowerCase().includes(String(p.vendor_match || "").toLowerCase()));
    if (plan) {
      const agg = planAgg.get(plan.id) ?? { plan, total: 0, count: 0, vendor: b.vendor };
      agg.total += num(b.amount); agg.count += 1; planAgg.set(plan.id, agg);
      continue; // rolled into the plan obligation below, not listed individually
    }
    const key = `qbbill:${b.id ?? `${b.vendor}:${b.docNumber ?? b.dueDate ?? b.amount}`}`;
    const tax = isTaxVendor(b.vendor);
    const c = tax ? { tier: "tier1" as Tier, criticality: "must" as Criticality } : classifyVendorTier(b.vendor);
    const label = `${b.vendor}${b.docNumber ? ` #${b.docNumber}` : ""}`;
    const rationale = tax
      ? "Tax bill booked in QuickBooks A/P. Confirm with Roger."
      : c.tier === "tier2"
        ? "Open vendor bill — operationally critical supplier (must-pay)."
        : c.tier === "tier4"
          ? "Open vendor bill — marketing/agency; deferrable in a cash crunch."
          : "Open vendor bill from QuickBooks accounts payable.";
    await db.execute(sql`
      insert into cash_obligations (label, payee, category, tier, amount, amount_estimated, due_date, cadence, criticality, status, source, external_key, rationale)
      values (${label}, ${b.vendor}, ${tax ? "tax" : "vendor_bill"}, ${c.tier}, ${num(b.amount)}, false, ${b.dueDate}::date, 'one_time', ${c.criticality}, 'pending', 'qb_bill', ${key}, ${rationale})
      on conflict (external_key) where external_key is not null do update set
        amount = excluded.amount, due_date = excluded.due_date, payee = excluded.payee,
        label = excluded.label, tier = excluded.tier, updated_at = now()
      where cash_obligations.status <> 'paid'`);
    upserted++;
  }

  // One obligation per active plan with open bills: the agreed installment (not the
  // whole balance), tiered as a committed payment. Shows the cadence + balance.
  for (const { plan, total, count, vendor } of Array.from(planAgg.values())) {
    const tier = (plan.tier || "tier2") as Tier;
    const crit: Criticality = tier === "tier4" ? "flexible" : tier === "tier3" ? "important" : "must";
    const per = plan.cadence === "monthly" ? "month" : "week";
    const name = plan.display_name || vendor;
    const label = `${name} — ${usd(num(plan.amount))}/${per} plan`;
    const rationale = `Agreed ${plan.cadence} payment plan${plan.note ? `: ${plan.note}` : ""}. ${usd(total)} balance across ${count} open bill${count === 1 ? "" : "s"}.`;
    await db.execute(sql`
      insert into cash_obligations (label, payee, category, tier, amount, amount_estimated, due_date, cadence, criticality, status, source, external_key, rationale)
      values (${label}, ${name}, 'vendor_bill', ${tier}, ${num(plan.amount)}, false, current_date, ${plan.cadence}, ${crit}, 'pending', 'qb_bill', ${`plan:${plan.id}`}, ${rationale})
      on conflict (external_key) where external_key is not null do update set
        amount = excluded.amount, label = excluded.label, rationale = excluded.rationale,
        tier = excluded.tier, due_date = excluded.due_date, updated_at = now()
      where cash_obligations.status <> 'paid'`);
    upserted++;
  }

  // Anything source='qb_bill' not touched this run (paid in QB, or a plan now paid
  // off) drops off the pay-order.
  const res = await db.execute(sql`
    update cash_obligations set status = 'paid', updated_at = now()
    where source = 'qb_bill' and is_active and status <> 'paid' and updated_at < ${dbStart}`);
  return { upserted, closed: num((res as any)?.rowCount ?? 0) };
}

// ── DB: the assembled, ranked cash-flow view ────────────────────────────────
export async function getCashFlow(db: any, opts: { windowDays?: number; asOf?: string } = {}): Promise<CashFlowResult> {
  const windowDays = opts.windowDays ?? 30;
  const asOf = opts.asOf ?? todayMountain();

  await syncGeneratedObligations(db, asOf).catch(() => {});
  const position = await getCashPosition(db, windowDays, asOf);

  const raw = rows(await db.execute(sql`
    select id, label, payee, category, tier, criticality, amount::float8 as amount, amount_estimated,
           due_date::text as due_date, pay_from, method, status, source, rationale, source_ref,
           anomaly_flag, anomaly_reason
    from cash_obligations
    where is_active and status <> 'paid'
      and (due_date is null or due_date <= (${asOf}::date + ${windowDays}::int))`));

  const obls: Obligation[] = raw.map((o: any) => {
    const criticality = (o.criticality || "important") as Criticality;
    const category = (o.category || "vendor_bill") as OblCategory;
    const tier = (o.tier || defaultTier(category, criticality)) as Tier;
    return {
      id: o.id, label: o.label, payee: o.payee, category, tier, tierRank: TIER_RANK[tier] ?? 3,
      amount: num(o.amount), amountEstimated: o.amount_estimated === true, dueDate: o.due_date, daysUntilDue: null,
      criticality, payFrom: o.pay_from, method: o.method, status: (o.status || "pending") as OblStatus,
      source: o.source, rationale: o.rationale, sourceRef: o.source_ref,
      anomalyFlag: o.anomaly_flag === true, anomalyReason: o.anomaly_reason, runningCashAfter: null,
    };
  });

  const ranked = rankAndProject(obls, position.cashOnHand, asOf);
  // "Due in window" / projected low excludes deferred AND hold-tier (hold = defer).
  const active = ranked.filter((o) => o.status !== "deferred" && o.tier !== "hold");
  const totalDue = r2(active.reduce((s, o) => s + o.amount, 0));
  const tier1Due = r2(active.filter((o) => o.tier === "tier1").reduce((s, o) => s + o.amount, 0));

  return {
    position: { ...position, totalDue, tier1Due, projectedLow: r2(position.cashOnHand + position.projectedIncome - totalDue) },
    obligations: ranked,
    generatedAt: new Date().toISOString(),
  };
}

// ── DB: mutations (with audit trail) ────────────────────────────────────────
export async function upsertObligation(db: any, p: {
  id?: string; label: string; payee?: string; category?: OblCategory; tier?: Tier; amount?: number;
  amountEstimated?: boolean; dueDate?: string | null; cadence?: string; criticality?: Criticality;
  payFrom?: string | null; method?: string | null; rationale?: string | null;
}): Promise<void> {
  const criticality = p.criticality ?? "important";
  const category = p.category ?? "vendor_bill";
  const tier = p.tier ?? defaultTier(category, criticality);
  if (p.id) {
    await db.execute(sql`
      update cash_obligations set
        label = ${p.label}, payee = ${p.payee ?? null}, category = ${category}, tier = ${tier},
        amount = ${p.amount ?? 0}, amount_estimated = ${p.amountEstimated ?? false},
        due_date = ${p.dueDate ?? null}::date, cadence = ${p.cadence ?? "one_time"},
        criticality = ${criticality}, pay_from = ${p.payFrom ?? null}, method = ${p.method ?? "ach"},
        rationale = ${p.rationale ?? null}, updated_at = now()
      where id = ${p.id}`);
  } else {
    await db.execute(sql`
      insert into cash_obligations (label, payee, category, tier, amount, amount_estimated, due_date, cadence, criticality, pay_from, method, rationale, source)
      values (${p.label}, ${p.payee ?? null}, ${category}, ${tier}, ${p.amount ?? 0}, ${p.amountEstimated ?? false},
              ${p.dueDate ?? null}::date, ${p.cadence ?? "one_time"}, ${criticality}, ${p.payFrom ?? null}, ${p.method ?? "ach"}, ${p.rationale ?? null}, 'manual')`);
  }
}

const ACTION_FOR: Record<OblStatus, string> = { approved: "approved", deferred: "deferred", paid: "marked_paid", pending: "reopened" };

/** Dual-control threshold: marking a paid obligation at/above this requires a
 *  different person than the approver. Configurable via env (default $1,000). */
const DUAL_CONTROL_THRESHOLD = Number(process.env.FINANCE_DUAL_CONTROL_THRESHOLD || 1000);

/** Segregation of duties: a material obligation cannot be marked paid by the same
 *  person who approved it. Pure + unit-tested. */
export function sodBlocksPaid(status: OblStatus, amount: number, approvedBy: string | null, actor: string, threshold = DUAL_CONTROL_THRESHOLD): boolean {
  return status === "paid" && amount >= threshold && !!approvedBy && approvedBy === actor;
}

export type StatusResult = { ok: boolean; reason?: "not_found" | "no_actor" | "sod_block" };

export async function setObligationStatus(db: any, id: string, status: OblStatus, by?: string, byName?: string): Promise<StatusResult> {
  const o = rows(await db.execute(sql`select amount::float8 as amount, approved_by from cash_obligations where id = ${id}`))[0];
  // Unknown/stale/deleted/forged id: refuse so we never write an orphan audit row.
  if (!o) return { ok: false, reason: "not_found" };
  // Every action must attribute to a real authenticated person — never a placeholder
  // like "team" (which destroys the audit trail's evidentiary value).
  if (!by) return { ok: false, reason: "no_actor" };
  // Segregation of duties: the payer must differ from the approver on material items.
  if (sodBlocksPaid(status, num(o.amount), o.approved_by ?? null, by)) {
    return { ok: false, reason: "sod_block" };
  }
  await db.execute(sql`
    update cash_obligations set
      status = ${status},
      approved_by = ${status === "approved" ? by : sql`approved_by`},
      approved_at = ${status === "approved" ? sql`now()` : sql`approved_at`},
      paid_at = ${status === "paid" ? sql`now()` : sql`paid_at`},
      updated_at = now()
    where id = ${id}`);
  // Append-only audit trail (DB trigger blocks UPDATE/DELETE) — critical given the
  // ACH fraud history. Best-effort insert; never block the recorded decision.
  await db.execute(sql`
    insert into payment_actions (obligation_id, action, acted_by, acted_by_name, amount)
    values (${id}, ${ACTION_FOR[status] ?? status}, ${by}, ${byName ?? null}, ${num(o.amount)})`).catch(() => {});
  return { ok: true };
}
