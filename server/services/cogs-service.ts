/**
 * CIPH.R COGS — real, BOM-based cost of goods.
 *
 * Computes cost of goods sold from deduped sales lines × each item's
 * weighted-average cost (seeded from the bill of materials), and compares it to
 * the accountant's 35%-of-income plug. Also projects a COGS budget at the
 * measured cost rate so COGS can be planned as revenue scales — the number that
 * retires the manual "match 35% of income" journal entry.
 *
 * Coverage matters: only finished products with a costed BOM contribute, so each
 * month carries a coverage % and the rate is computed against covered revenue.
 */
import { sql } from "drizzle-orm";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface MonthlyCogs {
  month: string; // YYYY-MM
  realMaterialsCogs: number;
  lineRevenue: number;
  coveragePct: number; // share of revenue from costed SKUs
  cogsRatePct: number; // real COGS as % of covered revenue
  plugCogs: number | null; // 35%-of-income plug, for comparison
  variance: number | null; // plug − real (positive = the plug overstates COGS/loss)
}

const MONTH_NUM: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

export async function computeMonthlyCogs(db: DB): Promise<MonthlyCogs[]> {
  const cogsRows = rows(await db.execute(sql`
    WITH lines AS (
      SELECT to_char((so.order_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Denver'),'YYYY-MM') AS ym,
             GREATEST(sol.qty_ordered - COALESCE(sol.returned_qty,0),0) AS qty,
             sol.unit_price AS price, it.wac_unit_cost AS wac
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.sales_order_id
      LEFT JOIN items it ON it.id = sol.product_id
      WHERE so.order_date >= '2026-01-01'
        AND COALESCE(so.status,'') NOT IN ('CANCELLED','cancelled','canceled','REFUNDED')
    )
    SELECT ym,
      sum(qty*COALESCE(wac,0))::numeric AS real_cogs,
      sum(qty*price)::numeric AS line_revenue,
      sum(CASE WHEN wac IS NOT NULL THEN qty*price ELSE 0 END)::numeric AS covered_revenue
    FROM lines GROUP BY ym ORDER BY ym
  `));

  // 35%-of-income plug from the accountant P&L (monthly_financials).
  const plugRows = rows(await db.execute(sql`
    SELECT month, total_income::numeric AS income FROM monthly_financials WHERE month LIKE '%2026%'
  `));
  const plugByYm: Record<string, number> = {};
  for (const p of plugRows) {
    const m = String(p.month).match(/([A-Za-z]{3})\s+(\d{4})/);
    if (m && MONTH_NUM[m[1]]) plugByYm[`${m[2]}-${MONTH_NUM[m[1]]}`] = num(p.income) * 0.35;
  }

  return cogsRows.map((rr: any): MonthlyCogs => {
    const lineRev = num(rr.line_revenue);
    const coveredRev = num(rr.covered_revenue);
    const real = num(rr.real_cogs);
    const plug = plugByYm[rr.ym] ?? null;
    return {
      month: rr.ym,
      realMaterialsCogs: r2(real),
      lineRevenue: r2(lineRev),
      coveragePct: lineRev > 0 ? r1((coveredRev / lineRev) * 100) : 0,
      cogsRatePct: coveredRev > 0 ? r1((real / coveredRev) * 100) : 0,
      plugCogs: plug != null ? r2(plug) : null,
      variance: plug != null ? r2(plug - real) : null,
    };
  });
}

/**
 * COGS budget at the measured cost rate. Uses the trailing months with solid
 * coverage (≥50%) to derive the real cost rate, then applies it to a revenue
 * scenario so COGS can be budgeted instead of plugged.
 */
export function projectCogsBudget(
  months: MonthlyCogs[],
  revenueScenario: number,
): { measuredRatePct: number; projectedCogs: number; basisMonths: number } {
  const recent = months.filter((m) => m.coveragePct >= 50).slice(-3);
  let totReal = 0;
  let totCovered = 0;
  for (const m of recent) {
    totReal += m.realMaterialsCogs;
    if (m.cogsRatePct > 0) totCovered += m.realMaterialsCogs / (m.cogsRatePct / 100);
  }
  const rate = totCovered > 0 ? totReal / totCovered : 0;
  return {
    measuredRatePct: r1(rate * 100),
    projectedCogs: r2(rate * (revenueScenario || 0)),
    basisMonths: recent.length,
  };
}
