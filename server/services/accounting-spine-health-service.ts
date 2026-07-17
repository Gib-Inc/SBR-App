/**
 * Accounting Spine Health
 * ----------------------
 * Read-only reconciliation for the operational accounting pipe:
 * Purchase Order -> local quickbooks_bills row -> Purchase Order QBO stamp.
 *
 * This does not call QuickBooks and does not write accounting data. It tells the
 * operator whether the local app state is trustworthy enough to use as the
 * spine for CFO/bookkeeping views.
 */
import { sql } from "drizzle-orm";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export type AccountingSeverity = "pass" | "warn" | "block";
export type AccountingStatus = "healthy" | "drift" | "unavailable";

export interface AccountingSpineCheck {
  id: string;
  label: string;
  severity: AccountingSeverity;
  status: AccountingStatus;
  value: number | null;
  detail: string;
  nextAction: string;
  sample: any[];
}

export interface AccountingSpineHealth {
  success: true;
  generatedAt: string;
  overall: AccountingSeverity;
  accountingPolicy: "books_pipe_healthy" | "review_before_close" | "block_close_until_fixed";
  checks: AccountingSpineCheck[];
}

function overallFrom(checks: AccountingSpineCheck[]): Pick<AccountingSpineHealth, "overall" | "accountingPolicy"> {
  const overall: AccountingSeverity = checks.some((c) => c.severity === "block")
    ? "block"
    : checks.some((c) => c.severity === "warn")
      ? "warn"
      : "pass";
  return {
    overall,
    accountingPolicy: overall === "block"
      ? "block_close_until_fixed"
      : overall === "warn"
        ? "review_before_close"
        : "books_pipe_healthy",
  };
}

function checkFromCount(opts: {
  id: string;
  label: string;
  count: number;
  block?: boolean;
  healthyDetail: string;
  driftDetail: string;
  nextAction: string;
  sample?: any[];
}): AccountingSpineCheck {
  const hasDrift = opts.count > 0;
  return {
    id: opts.id,
    label: opts.label,
    severity: hasDrift ? (opts.block === false ? "warn" : "block") : "pass",
    status: hasDrift ? "drift" : "healthy",
    value: opts.count,
    detail: hasDrift ? opts.driftDetail : opts.healthyDetail,
    nextAction: hasDrift ? opts.nextAction : "No action needed.",
    sample: opts.sample ?? [],
  };
}

function amountMismatchClassification(row: any): string {
  return String(row?.classification ?? row?.amountMismatchClassification ?? "unexplained");
}

export function summarizeAccountingSpine(input: {
  eligibleMissingBill: any[];
  draftLeakedToQbo: any[];
  duplicateBillLinks: any[];
  amountMismatches: any[];
  errorBills: any[];
  orphanBills: any[];
  latestBill: any | null;
  quickbooksHealth: any | null;
}): AccountingSpineHealth {
  const checks: AccountingSpineCheck[] = [];
  const unexplainedAmountMismatches = input.amountMismatches.filter((row) => amountMismatchClassification(row) === "unexplained");
  const explainedAmountAdjustments = input.amountMismatches.filter((row) => amountMismatchClassification(row) !== "unexplained");

  checks.push(checkFromCount({
    id: "eligible_po_missing_qbo_bill",
    label: "Eligible POs missing QuickBooks Bill",
    count: input.eligibleMissingBill.length,
    healthyDetail: "Every approved/sent/received PO is linked to a local QuickBooks Bill record.",
    driftDetail: `${input.eligibleMissingBill.length} eligible PO(s) are missing a QuickBooks Bill link.`,
    nextAction: "Use the PO QuickBooks push/backfill path for these POs, then re-run this check.",
    sample: input.eligibleMissingBill.slice(0, 10),
  }));

  checks.push(checkFromCount({
    id: "draft_po_leaked_to_qbo",
    label: "Draft/unapproved POs linked to QuickBooks",
    count: input.draftLeakedToQbo.length,
    healthyDetail: "No draft/unapproved POs are linked to QuickBooks Bills.",
    driftDetail: `${input.draftLeakedToQbo.length} draft/unapproved PO(s) have a QuickBooks Bill link.`,
    nextAction: "Review these POs with Roger before month close; draft spend should not hit QBO.",
    sample: input.draftLeakedToQbo.slice(0, 10),
  }));

  checks.push(checkFromCount({
    id: "duplicate_qbo_bill_links",
    label: "Duplicate QuickBooks Bill links",
    count: input.duplicateBillLinks.length,
    healthyDetail: "No QuickBooks Bill ID is linked to multiple POs.",
    driftDetail: `${input.duplicateBillLinks.length} QuickBooks Bill ID(s) are linked to multiple POs.`,
    nextAction: "Resolve duplicate bill IDs before trusting A/P or COGS rollups.",
    sample: input.duplicateBillLinks.slice(0, 10),
  }));

  checks.push(checkFromCount({
    id: "po_bill_unexplained_amount_mismatch",
    label: "Unexplained PO vs QuickBooks Bill amount mismatch",
    count: unexplainedAmountMismatches.length,
    block: false,
    healthyDetail: "Linked PO totals match local QuickBooks Bill totals within $1.",
    driftDetail: `${unexplainedAmountMismatches.length} linked PO(s) differ from their QuickBooks Bill total by more than $1 without a local shipping/tax/invoice explanation.`,
    nextAction: "Compare PO lines against the vendor invoice/QBO Bill and classify the adjustment or repair the local record.",
    sample: unexplainedAmountMismatches.slice(0, 10),
  }));

  checks.push({
    id: "po_bill_known_amount_adjustments",
    label: "Known PO→QBO amount adjustments",
    severity: "pass",
    status: "healthy",
    value: explainedAmountAdjustments.length,
    detail: explainedAmountAdjustments.length > 0
      ? `${explainedAmountAdjustments.length} linked PO(s) differ from QBO by a locally explained header or invoice adjustment.`
      : "No known PO→QBO header/invoice adjustments are currently present.",
    nextAction: explainedAmountAdjustments.length > 0
      ? "No close blocker. Review only if Roger says the freight/tax/invoice handling is wrong."
      : "No action needed.",
    sample: explainedAmountAdjustments.slice(0, 10),
  });

  checks.push(checkFromCount({
    id: "quickbooks_bill_error_rows",
    label: "QuickBooks Bill rows in ERROR",
    count: input.errorBills.length,
    healthyDetail: "No local QuickBooks Bill rows are marked ERROR.",
    driftDetail: `${input.errorBills.length} QuickBooks Bill row(s) are marked ERROR.`,
    nextAction: "Open each error row and re-run/repair the failed QBO sync.",
    sample: input.errorBills.slice(0, 10),
  }));

  checks.push(checkFromCount({
    id: "orphan_quickbooks_bill_rows",
    label: "QuickBooks Bill rows without matching PO stamp",
    count: input.orphanBills.length,
    block: false,
    healthyDetail: "Every local QuickBooks Bill row has a matching PO accounting stamp.",
    driftDetail: `${input.orphanBills.length} local QuickBooks Bill row(s) do not match the PO accounting stamp.`,
    nextAction: "Repair the PO external_accounting_id/qb_record_type stamp or investigate stale local bill rows.",
    sample: input.orphanBills.slice(0, 10),
  }));

  const latestBillDate = input.latestBill?.created_at ?? input.latestBill?.createdAt ?? null;
  checks.push({
    id: "latest_qbo_bill_activity",
    label: "Latest PO→QBO Bill activity",
    severity: latestBillDate ? "pass" : "warn",
    status: latestBillDate ? "healthy" : "unavailable",
    value: input.latestBill?.quickbooks_bill_id ? Number(input.latestBill.quickbooks_bill_id) || null : null,
    detail: latestBillDate
      ? `Latest local QuickBooks Bill link is ${input.latestBill.quickbooks_bill_id} for ${input.latestBill.po_number ?? input.latestBill.purchase_order_id} at ${latestBillDate}.`
      : "No local QuickBooks Bill rows found.",
    nextAction: latestBillDate ? "No action needed." : "Create or sync the first eligible PO Bill before relying on PO→QBO accounting.",
    sample: input.latestBill ? [input.latestBill] : [],
  });

  const qbStatus = String(input.quickbooksHealth?.last_status ?? "").toLowerCase();
  checks.push({
    id: "quickbooks_token_health",
    label: "QuickBooks token scheduler health",
    severity: qbStatus === "success" ? "pass" : "warn",
    status: qbStatus === "success" ? "healthy" : "unavailable",
    value: null,
    detail: qbStatus === "success"
      ? `QuickBooks token refresh last succeeded at ${input.quickbooksHealth?.last_success_at ?? "unknown"}.`
      : "QuickBooks token refresh health row is missing or not successful.",
    nextAction: qbStatus === "success" ? "No action needed." : "Check QuickBooks OAuth connection before relying on live QBO sync.",
    sample: input.quickbooksHealth ? [input.quickbooksHealth] : [],
  });

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    ...overallFrom(checks),
    checks,
  };
}

export async function getAccountingSpineHealth(db: any): Promise<AccountingSpineHealth> {
  const eligibleMissingBill = rows(await db.execute(sql`
    select po.id, po.po_number, po.status, po.total, po.created_at, po.updated_at
    from purchase_orders po
    left join quickbooks_bills qb on qb.purchase_order_id = po.id
    where upper(coalesce(po.status, '')) in ('APPROVED','SENT','PARTIALLY_RECEIVED','RECEIVED','CLOSED')
      and coalesce(po.is_historical, false) = false
      and po.external_accounting_id is null
      and qb.id is null
    order by coalesce(po.updated_at, po.created_at) desc
    limit 50`));

  const draftLeakedToQbo = rows(await db.execute(sql`
    select po.id, po.po_number, po.status, po.external_accounting_id, qb.quickbooks_bill_id, po.created_at
    from purchase_orders po
    left join quickbooks_bills qb on qb.purchase_order_id = po.id
    where upper(coalesce(po.status, '')) not in ('APPROVED','SENT','PARTIALLY_RECEIVED','RECEIVED','CLOSED')
      and coalesce(po.is_historical, false) = false
      and (po.external_accounting_id is not null or qb.id is not null)
    order by coalesce(po.updated_at, po.created_at) desc
    limit 50`));

  const duplicateBillLinks = rows(await db.execute(sql`
    select quickbooks_bill_id, count(*)::int as linked_pos, array_agg(purchase_order_id) as purchase_order_ids
    from quickbooks_bills
    group by quickbooks_bill_id
    having count(*) > 1
    order by count(*) desc
    limit 50`));

  const amountMismatches = rows(await db.execute(sql`
    with line_totals as (
      select purchase_order_id,
             round(sum(coalesce(line_total, qty_ordered * unit_cost, 0))::numeric, 2)::float8 as po_line_total
      from purchase_order_lines
      group by purchase_order_id
    )
    select po.id,
           po.po_number,
           coalesce(lt.po_line_total, 0)::float8 as po_line_total,
           coalesce(po.shipping_cost, 0)::float8 as shipping_cost,
           coalesce(po.taxes, 0)::float8 as taxes,
           po.invoice_total as invoice_total,
           po.total as po_total,
           qb.total_amount as qb_total,
           round((coalesce(po.total,0) - coalesce(qb.total_amount,0))::numeric, 2)::float8 as diff,
           round((coalesce(lt.po_line_total,0) - coalesce(qb.total_amount,0))::numeric, 2)::float8 as line_diff,
           round((coalesce(po.shipping_cost,0) + coalesce(po.taxes,0))::numeric, 2)::float8 as header_adjustment,
           case
             when abs(coalesce(lt.po_line_total,0) - coalesce(qb.total_amount,0)) <= 1
              and abs((coalesce(po.total,0) - coalesce(qb.total_amount,0)) - (coalesce(po.shipping_cost,0) + coalesce(po.taxes,0))) <= 1
               then 'known_header_adjustment'
             when po.invoice_total is not null and abs(coalesce(po.invoice_total,0) - coalesce(qb.total_amount,0)) <= 1
               then 'invoice_total_matches_qbo'
             else 'unexplained'
           end as classification
    from purchase_orders po
    join quickbooks_bills qb on qb.purchase_order_id = po.id
    left join line_totals lt on lt.purchase_order_id = po.id
    where abs(coalesce(po.total,0) - coalesce(qb.total_amount,0)) > 1
    order by abs(coalesce(po.total,0) - coalesce(qb.total_amount,0)) desc
    limit 50`));

  const errorBills = rows(await db.execute(sql`
    select qb.id, qb.purchase_order_id, po.po_number, qb.quickbooks_bill_id, qb.status, qb.error_message, qb.updated_at
    from quickbooks_bills qb
    left join purchase_orders po on po.id = qb.purchase_order_id
    where upper(coalesce(qb.status, '')) = 'ERROR' or qb.error_message is not null
    order by coalesce(qb.updated_at, qb.created_at) desc
    limit 50`));

  const orphanBills = rows(await db.execute(sql`
    select qb.id, qb.purchase_order_id, po.po_number, po.external_accounting_id, po.qb_record_type,
           qb.quickbooks_bill_id, qb.status
    from quickbooks_bills qb
    left join purchase_orders po on po.id = qb.purchase_order_id
    where po.id is null
       or po.external_accounting_id is distinct from qb.quickbooks_bill_id
       or coalesce(po.qb_record_type, '') <> 'Bill'
    order by coalesce(qb.updated_at, qb.created_at) desc
    limit 50`));

  const latestBill = rows(await db.execute(sql`
    select qb.purchase_order_id, po.po_number, qb.quickbooks_bill_id, qb.quickbooks_bill_number,
           qb.status, qb.total_amount, qb.created_at
    from quickbooks_bills qb
    left join purchase_orders po on po.id = qb.purchase_order_id
    order by qb.created_at desc
    limit 1`))[0] ?? null;

  const quickbooksHealth = rows(await db.execute(sql`
    select integration_name, last_status, last_success_at, error_message
    from integration_health
    where integration_name = 'scheduler:quickbooks-token-refresh'
    limit 1`))[0] ?? null;

  const result = summarizeAccountingSpine({
    eligibleMissingBill,
    draftLeakedToQbo,
    duplicateBillLinks,
    amountMismatches,
    errorBills,
    orphanBills,
    latestBill,
    quickbooksHealth,
  });

  // Attach rounded numeric diffs for samples that carry money.
  for (const check of result.checks) {
    check.sample = check.sample.map((row) => {
      const moneyFields = ["diff", "po_line_total", "shipping_cost", "taxes", "invoice_total", "po_total", "qb_total", "line_diff", "header_adjustment"];
      const next = { ...row };
      for (const field of moneyFields) {
        if (next?.[field] != null) next[field] = r2(num(next[field]) ?? 0);
      }
      return next;
    });
  }

  return result;
}
