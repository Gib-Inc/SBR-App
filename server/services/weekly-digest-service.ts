/**
 * Weekly CMO Digest
 *
 * Pushes the Command Center headline numbers — revenue vs target, blended
 * ROAS, ad spend, LTV:CAC, repeat rate — to Zo via the same GHL SMS path the
 * Morning Trap uses. Runs weekly (Monday 7 AM MT) from the scheduler, and can
 * be triggered on demand from the API.
 *
 * Deterministic formatting (no LLM call) so it's free and never fails on a
 * model hiccup. Reads the existing CMO query layer.
 */

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@shared/schema';
import { attachPoolErrorHandler } from '../pool-error-handler';
import { storage } from '../storage';
import { GoHighLevelClient } from './gohighlevel-client';
import {
  queryRevenueTarget, queryChannelMatrix, queryLtvCac,
  queryCustomerCohorts, queryMonthlyBlended,
} from '../routes/marketing-analytics-queries-v2';

let cachedDb: ReturnType<typeof drizzle> | null = null;
function getDb() {
  if (!cachedDb) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    attachPoolErrorHandler(pool, "weekly-digest");
    cachedDb = drizzle(pool, { schema });
  }
  return cachedDb;
}

const money = (n: number | null | undefined) =>
  n == null ? 'n/a' : `$${Math.round(n).toLocaleString('en-US')}`;
const moneyK = (n: number | null | undefined) =>
  n == null ? 'n/a' : `$${(n / 1000).toFixed(0)}k`;

export interface WeeklyDigestResult {
  success: boolean;
  digest: string;
  smsSent: boolean;
  error?: string;
}

export class WeeklyDigestService {
  /**
   * Build + (optionally) send the weekly digest for a user.
   */
  static async run(userId: string, options?: { sendSms?: boolean }): Promise<WeeklyDigestResult> {
    const sendSms = options?.sendSms ?? true;
    const db = getDb();
    const days = 30;

    const [revenue, channels, ltv, cohorts, monthly] = await Promise.all([
      queryRevenueTarget(db).catch(() => null),
      queryChannelMatrix(db, days).catch(() => [] as any[]),
      queryLtvCac(db).catch(() => null),
      queryCustomerCohorts(db).catch(() => null),
      queryMonthlyBlended(db, 2).catch(() => [] as any[]),
    ]);

    const digest = this.format({ revenue, channels, ltv, cohorts, monthly });

    if (!sendSms) {
      return { success: true, digest, smsSent: false };
    }

    const sent = await this.sendSms(userId, digest);
    return { success: sent.success, digest, smsSent: sent.success, error: sent.error };
  }

  private static format(d: {
    revenue: any; channels: any[]; ltv: any; cohorts: any; monthly: any[];
  }): string {
    const lines: string[] = [];
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    lines.push(`SBR WEEKLY CMO DIGEST — ${today}`);
    lines.push('');

    // Revenue vs target (MTD)
    if (d.revenue) {
      const mtd = d.revenue.mtdRevenue ?? null;
      const target = d.revenue.monthlyTarget ?? null;
      const pace = d.revenue.projectedMonthEnd ?? null;
      const pacePct = d.revenue.pacePercent ?? null;
      lines.push(`REVENUE (MTD): ${money(mtd)}${target ? ` of ${moneyK(target)} target` : ''}`);
      if (pace) lines.push(`  Projected month-end: ${money(pace)}${pacePct != null ? ` (${pacePct.toFixed(0)}% of pace)` : ''}`);
    }

    // Ad spend + blended ROAS (last 30d across channels)
    const totalSpend = (d.channels || []).reduce((s, c) => s + (c.spend || 0), 0);
    const totalAdRev = (d.channels || []).reduce((s, c) => s + (c.revenue || 0), 0);
    if (totalSpend > 0) {
      const roas = totalSpend > 0 ? totalAdRev / totalSpend : null;
      lines.push('');
      lines.push(`AD SPEND (30d): ${money(totalSpend)}`);
      lines.push(`  Pixel ROAS: ${roas != null ? roas.toFixed(1) + 'x' : 'n/a'}`);
      // Top + bottom channel by spend
      const sorted = [...d.channels].sort((a, b) => (b.spend || 0) - (a.spend || 0));
      const top = sorted[0];
      if (top) lines.push(`  Top: ${top.platform} ${money(top.spend)} @ ${top.roas != null ? top.roas.toFixed(1) + 'x' : 'n/a'}`);
    }

    // Unit economics
    if (d.ltv?.summary) {
      const s = d.ltv.summary;
      lines.push('');
      lines.push(`LTV:CAC: ${s.blendedRatio != null ? s.blendedRatio.toFixed(1) + 'x' : 'n/a'}${s.healthy === false ? ' (below 3x)' : s.healthy ? ' (healthy)' : ''}`);
      lines.push(`  CAC: ${money(s.blendedCac)} / LTV: ${money(s.blendedLtv)}`);
    }

    // Retention
    if (d.cohorts) {
      lines.push('');
      lines.push(`REPEAT RATE: ${d.cohorts.repeatRate != null ? d.cohorts.repeatRate.toFixed(0) + '%' : 'n/a'}`);
      if (d.cohorts.top10PctShare != null) {
        lines.push(`  Top 10% of customers = ${d.cohorts.top10PctShare.toFixed(0)}% of revenue`);
      }
    }

    // One-line MoM read
    if (d.monthly && d.monthly.length >= 2) {
      const prev = d.monthly[d.monthly.length - 2];
      const curr = d.monthly[d.monthly.length - 1];
      if (prev?.totalRevenue > 0) {
        const mom = ((curr.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 100;
        lines.push('');
        lines.push(`MoM revenue: ${mom >= 0 ? '+' : ''}${mom.toFixed(0)}%`);
      }
    }

    lines.push('');
    lines.push('Full dashboard: /marketing-analytics');
    return lines.join('\n');
  }

  /**
   * Send via GHL SMS — same credential resolution as the Morning Trap.
   */
  private static async sendSms(userId: string, message: string): Promise<{ success: boolean; error?: string }> {
    try {
      const config = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
      const settingsRow = await storage.getSettings(userId);

      const apiKey = config?.apiKey || (settingsRow as any)?.gohighlevelApiKey;
      const locationId = (config?.config as any)?.locationId || (settingsRow as any)?.gohighlevelLocationId;
      if (!apiKey || !locationId) {
        return { success: false, error: 'GHL not configured. Add API key and Location ID in Settings.' };
      }

      const zoContactId = (config?.config as any)?.zoContactId || (settingsRow as any)?.zoGhlContactId;
      if (!zoContactId) {
        return { success: false, error: 'Zo GHL contact ID not configured.' };
      }

      const ghlClient = new GoHighLevelClient('https://services.leadconnectorhq.com', apiKey, locationId);
      let sms = message;
      if (sms.length > 1500) sms = sms.substring(0, 1450) + '\n\n[Truncated. Full version in app.]';
      const result = await ghlClient.sendSMS(zoContactId, sms);
      return { success: result.success, error: result.error };
    } catch (error: any) {
      return { success: false, error: `SMS send failed: ${error.message}` };
    }
  }
}
