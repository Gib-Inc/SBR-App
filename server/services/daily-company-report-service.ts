/**
 * DailyCompanyReportService — the "company brain" daily routine.
 * ------------------------------------------------------------------
 * Runs each morning (6 AM MT). In one pass it:
 *   1. REFRESHES the live feeds (Windsor ad spend, Shopify reconciliation,
 *      supplier intel) so the cross-checks run on fresh data.
 *   2. CROSS-CHECKS the app's recorded sales for yesterday against an
 *      INDEPENDENT re-pull from the Shopify API (+ a QuickBooks revenue
 *      reference). This is the anti-drift catch — it is exactly what would have
 *      caught the 2026-06 10x (the app said ~$200k while Shopify said ~$10k).
 *   3. Runs the full integrity sweep (inventory / ad-spend / financial / sales).
 *   4. Snapshots financials (cash, runway, true ad spend, blended ROAS) and
 *      inventory (asset value, critical stockouts).
 *   5. Checks sync FRESHNESS (last successful run per integration).
 * Writes ONE consolidated report to app_settings (surfaced on FinOps) and logs
 * anomalies to data_reconciliation_log. Every section is isolated so one failure
 * never sinks the report.
 */
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";

const TZ = "America/Denver";
const mtDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function safe<T>(fn: () => Promise<T>): Promise<{ ok: boolean; value?: T; error?: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export type ReportStatus = "OK" | "WARN" | "DRIFT";

export interface DailyCompanyReport {
  generatedAt: string;
  forDate: string; // the MT business day analyzed (yesterday)
  status: ReportStatus;
  headline: string;
  anomalies: string[];
  refresh: Record<string, { ok: boolean; detail?: string }>;
  sales: any;
  integrity: any;
  financials: any;
  inventory: any;
  freshness: any;
}

/** Independent Shopify re-pull: yesterday's orders straight from the Shopify
 *  Admin API (NOT the app's stored copy), for cross-check. Returns null when
 *  Shopify isn't configured or the pull fails. */
async function independentShopifyTotals(forDate: string): Promise<{ orders: number; revenue: number } | null> {
  const configs = await storage.getEnabledIntegrationConfigsByProvider("SHOPIFY").catch(() => []);
  const config = (configs || [])[0];
  if (!config) return null;
  const shopDomain = (config.config as any)?.shopDomain;
  const accessToken = (config as any).apiKey;
  const apiVersion = (config.config as any)?.apiVersion || "2024-01";
  if (!shopDomain || !accessToken) return null;
  const { ShopifyClient } = await import("./shopify-client");
  const client = new ShopifyClient(shopDomain, accessToken, apiVersion);
  const orders = await client.syncRecentOrders(2, 250); // last 2 days, then filter to forDate (MT)
  let count = 0;
  let revenue = 0;
  for (const o of orders as any[]) {
    if (!o.orderDate) continue;
    if (mtDate(new Date(o.orderDate)) !== forDate) continue;
    const status = String(o.status || "").toUpperCase();
    if (status === "CANCELLED" || status === "REFUNDED") continue;
    count++;
    revenue += Number(o.totalAmount) || 0;
  }
  return { orders: count, revenue: r2(revenue) };
}

export async function runDailyCompanyReport(opts?: { skipRefresh?: boolean }): Promise<DailyCompanyReport> {
  const now = new Date();
  const forDate = mtDate(new Date(now.getTime() - 86_400_000)); // yesterday, MT
  const anomalies: string[] = [];
  const report: DailyCompanyReport = {
    generatedAt: now.toISOString(), forDate, status: "OK", headline: "", anomalies,
    refresh: {}, sales: {}, integrity: {}, financials: {}, inventory: {}, freshness: {},
  };

  // 1. REFRESH live feeds (best-effort, isolated).
  if (!opts?.skipRefresh) {
    const w = await safe(() => import("./windsor-sync-service").then((m) => m.runWindsorSync()));
    report.refresh.windsorAdSpend = { ok: w.ok, detail: w.ok ? `ran=${(w.value as any)?.ran}` : w.error };
    const rec = await safe(() => import("./shopify-reconciliation-scheduler").then((m) => m.triggerManualReconciliation()));
    report.refresh.shopifyReconciliation = { ok: rec.ok, detail: rec.ok ? `processed=${(rec.value as any)?.ordersProcessed ?? "?"}` : rec.error };
    const si = await safe(() => import("./supplier-intel-service").then((m) => m.refreshSupplierIntelSnapshot("DAILY_REPORT")));
    report.refresh.supplierIntel = { ok: si.ok, detail: si.ok ? "refreshed" : si.error };
    // C5 self-heal: re-join order lines whose item didn't exist at write time.
    // Idempotent, product_id-only (no stock effects) — keeps COGS coverage from decaying.
    const olr = await safe(() => import("./order-line-resolution-service").then((m) => m.resolveUnmappedOrderLines(db)));
    report.refresh.orderLineResolution = { ok: olr.ok, detail: olr.ok ? `resolved=${(olr.value as any)?.resolved} remaining=${(olr.value as any)?.remaining}` : olr.error };
  }

  // 2. SALES CROSS-CHECK — app recorded vs independent Shopify API vs QuickBooks.
  try {
    const rows: any = await db.execute(sql`
      SELECT channel, count(*)::int AS orders, round(sum(coalesce(total_amount,0))::numeric,2)::float8 AS revenue
      FROM sales_orders
      WHERE (order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver')::date = ${forDate}::date
        AND upper(coalesce(status,'')) NOT IN ('CANCELLED','REFUNDED')
      GROUP BY channel`);
    const byChannel: Record<string, { orders: number; revenue: number }> = {};
    let appTotal = 0;
    for (const r of (rows.rows ?? rows ?? [])) {
      byChannel[String(r.channel)] = { orders: Number(r.orders), revenue: Number(r.revenue) };
      appTotal += Number(r.revenue) || 0;
    }
    const appShopify = byChannel["SHOPIFY"]?.revenue ?? 0;

    const shopifyApi = await independentShopifyTotals(forDate).catch(() => null);
    const qb = await storage.getLatestQbLiveSnapshot().catch(() => null);

    let salesStatus: ReportStatus = "OK";
    let crossCheck = "Shopify API cross-check unavailable.";
    if (shopifyApi) {
      const ratio = shopifyApi.revenue > 0 ? r2(appShopify / shopifyApi.revenue) : appShopify > 0 ? 99 : 1;
      const off = Math.abs(ratio - 1) > 0.15; // >15% divergence
      if (off) {
        salesStatus = "DRIFT";
        anomalies.push(`SALES MISMATCH ${forDate}: app Shopify $${Math.round(appShopify).toLocaleString()} vs Shopify API $${Math.round(shopifyApi.revenue).toLocaleString()} (${ratio}x) — investigate before trusting today's numbers.`);
      }
      crossCheck = `App Shopify $${Math.round(appShopify).toLocaleString()} vs Shopify API $${Math.round(shopifyApi.revenue).toLocaleString()} = ${ratio}x ${off ? "⚠ DRIFT" : "✓ match"}.`;
    }
    report.sales = {
      forDate, byChannel, appTotalRevenue: r2(appTotal), shopifyApi,
      quickbooksRef: qb ? { cashOnHand: (qb as any).cashOnHand, totalIncome: (qb as any).totalIncome } : null,
      crossCheck, status: salesStatus,
    };
  } catch (e: any) {
    anomalies.push(`sales cross-check failed: ${e?.message ?? e}`);
    report.sales = { status: "WARN", error: e?.message ?? String(e) };
  }

  // 3. INTEGRITY sweep (the 4-stream self-healing check).
  try {
    const integ: any = await import("./system-integrity-service").then((m) => m.runSystemIntegrityCheck());
    report.integrity = {
      status: integ.status, totalAnomalies: integ.totalAnomalies,
      streams: (integ.streams ?? []).map((s: any) => ({ stream: s.stream, status: s.status, anomalies: s.anomalies, summary: s.summary })),
    };
    if (integ.status === "DRIFT") {
      const d = (integ.streams ?? []).filter((s: any) => s.status === "DRIFT").map((s: any) => s.stream).join(", ");
      anomalies.push(`INTEGRITY DRIFT: ${integ.totalAnomalies} anomalies (${d}).`);
    }
  } catch (e: any) {
    anomalies.push(`integrity sweep failed: ${e?.message ?? e}`);
  }

  // 4. FINANCIALS — cash/runway + collapsed ad spend. Report BOTH the media ROAS (ads
  // only, flatters) and the blended MER (net sales / QB marketing — the breakeven truth).
  // The guardrail must judge MER, not media ROAS: they straddle the 5x line opposite ways.
  try {
    const runway: any = await import("./runway-service").then((m) => m.computeRunway());
    const perf: any = await import("./unified-performance-service").then((m) => m.getUnifiedPerformance(30, now.getTime()));
    const scoreboard: any = await import("./marketing-breakeven-service").then((m) => m.getBreakevenScoreboard(db, now.getTime())).catch(() => null);
    const mer = scoreboard?.current?.merEstimate ?? null;
    const breakeven = scoreboard?.breakeven ?? 5;
    report.financials = {
      cashOnHand: runway?.data?.scenarioInputs?.realistic?.cashOnHand ?? null,
      runwayDaysRealistic: runway?.data?.forecast?.realisticDays ?? null,
      runwayStatus: runway?.data?.forecast?.status ?? runway?.error ?? null,
      adSpend30d: perf?.totalAdSpend ?? null,
      revenue30d: perf?.totalRevenue ?? null,
      blendedRoas: perf?.blendedRoas ?? null,   // media ROAS (ads only) — kept for back-compat
      mediaRoas: perf?.blendedRoas ?? null,
      blendedMer: mer,                          // the breakeven number (net sales / QB marketing)
      breakeven,
      dataGaps: (perf?.dataGaps ?? []).length,
    };
    // Judge the BREAKEVEN MER, not the media ROAS. Media ROAS (~7x) sits above 5x while
    // the true blended MER (~4x) is below it — the old check stayed silent on a real loss.
    if (mer != null && perf?.totalAdSpend > 1000 && mer < breakeven) {
      anomalies.push(`Blended MER ${Number(mer).toFixed(1)}x is below the ${breakeven}x breakeven — marketing is under the P&L break-even line; route to budget review.`);
    }
    // TRIPWIRE: >50% of the debt balance has no payment terms → DSCR/runway/safe-to-pay
    // are materially understating outflows. The app finds Matt; it doesn't wait to be opened.
    try {
      const cl: any = await import("./credit-lines-service").then((m) => m.computeCreditLines());
      report.financials.debtServiceBlind = cl?.totals?.debtServiceBlind ?? null;
      report.financials.monthlyDebtService = cl?.totals?.monthlyDebtService ?? null;
      if (cl?.totals?.debtServiceBlind) {
        anomalies.push(
          `DEBT SERVICE BLIND: $${Math.round(cl.totals.missingPaymentBalance).toLocaleString()} of $${Math.round(cl.totals.totalBalance).toLocaleString()} debt balance has NO payment terms — DSCR, runway and safe-to-pay are understating outflows. Enter facility terms in the debt schedule.`,
        );
      }
    } catch { /* credit lines unavailable — runway/DSCR gaps already surface elsewhere */ }
    // G #15 TRIPWIRE: a breached covenant is a standing solvency alarm, not a footnote —
    // the Fresh Funding anti-stacking breach (~$175K accelerable) went unmonitored for weeks.
    try {
      const cov: any = await db.execute(sql`
        SELECT facility_name, covenant_type, coalesce(amount_at_risk, 0)::float8 AS at_risk, description
        FROM debt_covenants WHERE status = 'breached' ORDER BY at_risk DESC`);
      const breached = (cov.rows ?? cov ?? []) as any[];
      report.financials.covenantBreaches = breached.length;
      for (const b of breached) {
        anomalies.push(
          `COVENANT BREACH: ${b.facility_name} ${b.covenant_type} — $${Math.round(Number(b.at_risk)).toLocaleString()} accelerable. ${b.description ?? ""}`.trim(),
        );
      }
    } catch { /* covenants table not yet migrated — nothing to alarm on */ }
  } catch (e: any) {
    anomalies.push(`financials snapshot failed: ${e?.message ?? e}`);
  }

  // 5. INVENTORY — asset value at WAC + critical stockouts.
  try {
    const val: any = await db.execute(sql`
      SELECT round(sum(CASE WHEN type='finished_product' THEN coalesce(hildale_qty,0)+coalesce(pivot_qty,0)
                            ELSE coalesce(current_stock,0) END * coalesce(wac_unit_cost, default_purchase_cost, 0))::numeric,2)::float8 AS asset_value,
             count(*) FILTER (WHERE coalesce(wac_unit_cost, default_purchase_cost) IS NULL
                              AND (CASE WHEN type='finished_product' THEN coalesce(hildale_qty,0)+coalesce(pivot_qty,0) ELSE coalesce(current_stock,0) END) > 0)::int AS uncosted
      FROM items`);
    const v = (val.rows ?? val ?? [])[0] ?? {};
    const si: any = await import("./supplier-intel-service").then((m) => m.getLatestSupplierIntelSnapshot()).catch(() => null);
    const crit = (si?.payload?.products ?? si?.products ?? []).filter((p: any) => p.status === "CRITICAL");
    report.inventory = {
      assetValueAtWac: Number(v.asset_value ?? 0),
      uncostedStockedItems: Number(v.uncosted ?? 0),
      criticalStockouts: crit.map((p: any) => p.liveSku ?? p.sku ?? p.name).slice(0, 10),
    };
    if (crit.length) anomalies.push(`${crit.length} component(s) at CRITICAL stockout — see Supplier Intel.`);
  } catch (e: any) {
    anomalies.push(`inventory snapshot failed: ${e?.message ?? e}`);
  }

  // 6. FRESHNESS — last successful run per integration.
  try {
    const fr: any = await db.execute(sql`
      SELECT integration_name, last_status, last_success_at,
             round(extract(epoch FROM (now() - last_success_at))/3600, 1) AS hours_since_success
      FROM integration_health ORDER BY last_success_at ASC NULLS FIRST`);
    const integrations = (fr.rows ?? fr ?? []).map((r: any) => ({
      name: r.integration_name, lastStatus: r.last_status,
      hoursSinceSuccess: r.hours_since_success != null ? Number(r.hours_since_success) : null,
    }));
    const stale = integrations.filter((i: any) => i.hoursSinceSuccess == null || i.hoursSinceSuccess > 26);
    report.freshness = { integrations, staleCount: stale.length };
    if (stale.length) anomalies.push(`${stale.length} integration(s) have not succeeded in >26h: ${stale.map((i: any) => i.name).join(", ")}.`);
  } catch (e: any) {
    anomalies.push(`freshness check failed: ${e?.message ?? e}`);
  }

  // Overall status + headline.
  report.status =
    report.sales?.status === "DRIFT" || report.integrity?.status === "DRIFT" ? "DRIFT"
    : anomalies.length ? "WARN" : "OK";
  report.headline =
    report.status === "DRIFT" ? `DRIFT — ${anomalies.length} issue(s) need attention before trusting today's numbers.`
    : report.status === "WARN" ? `${anomalies.length} item(s) to watch; core numbers reconcile.`
    : `All clear — sales reconcile, no drift, feeds fresh.`;

  // Persist + ledger.
  await storage.setAppSetting("daily_company_report_latest", JSON.stringify(report)).catch(() => {});
  if (anomalies.length) {
    await db.execute(sql`
      INSERT INTO data_reconciliation_log (data_type, entity_key, action, reason, source, created_at)
      VALUES ('daily_company_report', ${forDate}, ${report.status},
              ${anomalies.slice(0, 6).join(" | ")}, 'daily-company-report', now())`).catch(() => {});
  }
  console.log(`[Daily Company Report] ${forDate}: ${report.status} (${anomalies.length} anomalies)`);
  return report;
}

export async function getLatestDailyCompanyReport(): Promise<DailyCompanyReport | null> {
  try {
    const v = await storage.getAppSetting("daily_company_report_latest");
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
