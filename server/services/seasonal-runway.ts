/**
 * "Same as last year" seasonal runway input.
 *
 * Matt asked: "if we sell the same as last year, how long does our money last?"
 * The 3 standard scenarios (conservative/realistic/aggressive) look BACKWARD at
 * recent run-rate. This looks at the SAME CALENDAR PERIOD one year ago — capturing
 * SBR's strong seasonality (summer/fall peak) that a trailing average misses.
 *
 * Basis: historical_monthly_sales (QB monthly P&L, 2022-2025). For the months
 * AHEAD of asOf we take last year's same months' total_income (revenue net of
 * returns) and divide by their calendar days → a seasonal daily net-sales rate.
 * That rate × current net margin = the daily margin contribution fed to the
 * runway engine (current overhead/ad-spend held constant, so only the SALES
 * variable changes — an apples-to-apples "what if sales matched last year").
 *
 * FLAG-DON'T-FABRICATE: if last year's months are missing it uses only the months
 * present and reports the gap; if NONE are present it returns null (the seasonal
 * scenario then gaps rather than inventing a number).
 *
 * Pure seasonalDailyRevenue() is unit-tested in seasonal-runway.test.ts.
 */
import { sql } from "drizzle-orm";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const isNum = (v: unknown): v is number => v != null && typeof v === "number" && !Number.isNaN(v);

export interface MonthlySalesRow {
  year: number;
  month: number;
  totalIncome: number | null;
}
export interface SeasonalRevenue {
  dailyRevenue: number | null; // seasonal daily net-sales rate (null if no last-year data)
  basisMonths: Array<{ year: number; month: number }>; // last-year months actually used
  gaps: Array<{ year: number; month: number }>; // last-year months requested but missing
  monthsAhead: number;
}

/** Days in a 1-indexed calendar month. */
function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Pure: seasonal daily net-sales rate from last year's SAME upcoming months.
 * For asOf month m, looks at the next `monthsAhead` calendar months and pulls the
 * matching month ONE YEAR EARLIER from `historical`. Wraps year boundaries (e.g.
 * Nov asOf → Dec/Jan/Feb, whose "last year" spans two calendar years).
 */
export function seasonalDailyRevenue(
  historical: MonthlySalesRow[],
  asOfYmd: string,
  monthsAhead = 3,
): SeasonalRevenue {
  const [y, m] = asOfYmd.split("-").map(Number); // m is 1-12
  const byKey = new Map<string, MonthlySalesRow>();
  for (const row of historical) byKey.set(`${row.year}-${row.month}`, row);

  const basisMonths: Array<{ year: number; month: number }> = [];
  const gaps: Array<{ year: number; month: number }> = [];
  let totalRev = 0;
  let totalDays = 0;

  for (let i = 1; i <= monthsAhead; i++) {
    const mm = m + i; // 1-indexed, may exceed 12
    const yearOffset = Math.floor((mm - 1) / 12);
    const monthIdx = ((mm - 1) % 12) + 1; // 1-12
    const upcomingYear = y + yearOffset;
    const lastYear = upcomingYear - 1; // "same month last year"
    const row = byKey.get(`${lastYear}-${monthIdx}`);
    if (row && isNum(row.totalIncome)) {
      totalRev += row.totalIncome as number;
      totalDays += daysInMonth(lastYear, monthIdx);
      basisMonths.push({ year: lastYear, month: monthIdx });
    } else {
      gaps.push({ year: lastYear, month: monthIdx });
    }
  }

  return {
    dailyRevenue: totalDays > 0 ? r2(totalRev / totalDays) : null,
    basisMonths,
    gaps,
    monthsAhead,
  };
}

/** DB (read-only): seasonal daily net-sales rate from historical_monthly_sales. */
export async function getSeasonalDailyRevenue(
  db: any,
  asOf: string,
  monthsAhead = 3,
): Promise<SeasonalRevenue> {
  const data = rows(
    await db.execute(sql`
      select year, month, total_income::float8 as total_income
      from historical_monthly_sales`),
  ).map((r: any) => ({
    year: num(r.year),
    month: num(r.month),
    totalIncome: r.total_income == null ? null : num(r.total_income),
  }));
  return seasonalDailyRevenue(data, asOf, monthsAhead);
}
