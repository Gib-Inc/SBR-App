/**
 * CIPH.R Debt Runway — when does the Shopify Capital 17% skim end?
 *
 * The Capital advance auto-repays at 17% of Shopify-channel sales. This projects
 * the balance to $0 from the LIVE Shopify sales pace (trailing 91 days,
 * deseasonalized and re-seasonalized month by month), so the payoff date updates
 * itself as sales come in. The Shopify Credit line is revolving (no auto-payoff)
 * and is reported separately — it only pays down from surplus.
 */
import { sql } from "drizzle-orm";
import { DEFAULT_SEASONAL_INDEX, monthIndex } from "./seasonal-index";

type DB = any;
const rows = (r: any) => r.rows || r;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
const r0 = (n: number) => Math.round(n);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RATE = 0.17;

export interface RunwayMonth { month: number; year: number; label: string; projShopifySales: number; remittance: number; balanceAfter: number }
export interface DebtRunway {
  rate: number;
  totalCapital: number;
  capitalLines: { name: string; balance: number }[];
  totalCredit: number;
  creditLines: { name: string; balance: number }[];
  monthlyShopify: number;          // current implied Shopify monthly run-rate
  monthlyRemittanceNow: number;    // ~17% of this month's projected Shopify sales
  payoff: { label: string; year: number; monthsAway: number } | null;
  schedule: RunwayMonth[];
}

export async function computeDebtRunway(db: DB): Promise<DebtRunway> {
  const capitalLines = rows(await db.execute(sql`
    SELECT name, balance FROM credit_lines
    WHERE name ~* 'shopify capital' AND balance > 0 ORDER BY balance DESC`))
    .map((r: any) => ({ name: r.name, balance: r0(num(r.balance)) }));
  const creditLines = rows(await db.execute(sql`
    SELECT name, balance FROM credit_lines
    WHERE name ~* 'shopify credit' AND balance > 0 ORDER BY balance DESC`))
    .map((r: any) => ({ name: r.name, balance: r0(num(r.balance)) }));
  const totalCapital = capitalLines.reduce((s: number, l: any) => s + l.balance, 0);
  const totalCredit = creditLines.reduce((s: number, l: any) => s + l.balance, 0);

  // Live Shopify-channel monthly run-rate (trailing 91 days), deseasonalized.
  const s = rows(await db.execute(sql`
    SELECT COALESCE(sum(total_amount),0)::float8 AS gross
    FROM sales_orders
    WHERE channel = 'SHOPIFY'
      AND COALESCE(status,'') NOT IN ('CANCELLED','cancelled','canceled','REFUNDED')
      AND order_date >= current_date - interval '91 days'`))[0] || {};
  const monthlyShopify = (num(s.gross) / 13) * 4.333;

  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Denver" }));
  const curMonth0 = now.getMonth();
  let cf = 0;
  for (let k = 0; k < 3; k++) cf += monthIndex(DEFAULT_SEASONAL_INDEX, (((curMonth0 - k) % 12) + 12) % 12 + 1);
  const currentFactor = cf > 0 ? cf / 3 : 1;
  const deseason = monthlyShopify / currentFactor;

  // Project the balance down month by month from next month forward.
  let bal = totalCapital;
  const schedule: RunwayMonth[] = [];
  let payoff: DebtRunway["payoff"] = null;
  for (let m = 1; m <= 30 && bal > 0; m++) {
    const idx0 = (curMonth0 + m) % 12;
    const year = now.getFullYear() + Math.floor((curMonth0 + m) / 12);
    const factor = monthIndex(DEFAULT_SEASONAL_INDEX, idx0 + 1);
    const projSales = deseason * factor;
    const remit = Math.min(bal, projSales * RATE);
    bal = Math.max(0, Math.round((bal - remit) * 100) / 100);
    schedule.push({ month: idx0 + 1, year, label: MONTHS[idx0], projShopifySales: r0(projSales), remittance: r0(remit), balanceAfter: r0(bal) });
    if (bal <= 0 && !payoff) { payoff = { label: MONTHS[idx0], year, monthsAway: m }; break; }
  }

  const monthlyRemittanceNow = r0(deseason * monthIndex(DEFAULT_SEASONAL_INDEX, curMonth0 + 1) * RATE);

  return {
    rate: RATE, totalCapital, capitalLines, totalCredit, creditLines,
    monthlyShopify: r0(monthlyShopify), monthlyRemittanceNow, payoff, schedule,
  };
}
