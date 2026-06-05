/**
 * Seed Zo's Google Ads KPI spreadsheet data into ad_metrics_daily.
 * 1,455 rows of daily campaign-level data (Apr 2025 – May 2026):
 *   10 Google Ads campaigns × daily spend + conversions + revenue.
 * All rows get platform=GOOGLE, device=_all, country=_all, sku=ACCOUNT.
 *
 * Idempotent via ON CONFLICT on the unique index.
 */

import { sql } from 'drizzle-orm';
import { ZO_KPI_DATA } from './zo-kpi-data';

type DB = any;

export async function seedZoKpiData(db: DB): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const row of ZO_KPI_DATA) {
    try {
      await db.execute(sql`
        INSERT INTO ad_metrics_daily (platform, sku, date, campaign, device, country, impressions, clicks, spend, conversions, revenue, currency)
        VALUES ('GOOGLE', 'ACCOUNT', ${row.date}, ${row.campaign}, '_all', '_all', 0, 0, ${row.spend}, ${Math.round(row.conversions)}, ${row.revenue}, 'USD')
        ON CONFLICT (platform, sku, date, campaign, device, country) DO UPDATE SET
          spend = ${row.spend},
          conversions = ${Math.round(row.conversions)},
          revenue = ${row.revenue},
          updated_at = NOW()
      `);
      inserted++;
    } catch (e) {
      skipped++;
    }
  }

  return { inserted, skipped };
}
