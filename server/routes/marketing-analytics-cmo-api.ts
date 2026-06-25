/**
 * Marketing Analytics CMO API — decision-making endpoints.
 * Revenue target, breakeven, channel matrix, customers, geography,
 * fatigue, wasted spend, and Claude-generated next-best-actions.
 */

import express, { type Request, type Response } from 'express';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import { parse as csvParse } from 'csv-parse/sync';
import * as schema from '@shared/schema';
import { attachPoolErrorHandler } from '../pool-error-handler';
import { storage } from '../storage';
import { requireAuth } from '../middleware/auth';
import {
  queryRevenueTarget, queryBreakevenRoas, queryChannelMatrix,
  queryCustomerSplit, queryGeographic, queryCreativeFatigue, queryWastedSpend,
  queryDailyRevenueSpark, queryProductMixTrend, queryRepeatPurchase, queryTopMetrics,
  queryMonthlySales, queryMonthlyAdSpend, queryMonthlyBlended,
  querySalesVelocity, queryMultiYearComparison, queryLtvCac, queryCustomerCohorts,
  queryBomCompleteness, queryCampaignBreakdown, queryDeviceBreakdown, queryAdGeoPerformance,
} from './marketing-analytics-queries-v2';
import { runWindsorSync, getWindsorApiKey } from '../services/windsor-ingestion-service';
import { getCorrectedAdSummary } from '../services/corrected-ad-spend';
import { WeeklyDigestService } from '../services/weekly-digest-service';
import { seedHistoricalSales, queryFullYearComparison, queryFullCMOHistory } from './historical-sales-seed';
import { seedZoKpiData } from './zo-kpi-seed';
import type { InsertAdMetricsDaily } from '@shared/schema';

const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

const adCsvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ============================================================================
// AD CSV PARSING UTILITIES
// ============================================================================

type PlatformType = 'GOOGLE' | 'META' | 'AMAZON' | 'PINTEREST';

/** Column alias maps — each key is the canonical field, values are possible CSV header names (case-insensitive). */
const COLUMN_ALIASES: Record<PlatformType, Record<string, string[]>> = {
  GOOGLE: {
    campaign: ['campaign', 'campaign name'],
    date: ['day', 'date'],
    spend: ['cost', 'spend'],
    conversions: ['conversions', 'conv.', 'conv'],
    revenue: ['conv. value', 'conversion value', 'total conv. value', 'conv value', 'total conversion value'],
    impressions: ['impressions', 'impr.', 'impr'],
    clicks: ['clicks'],
    device: ['device'],
    country: ['country/territory', 'country', 'country / territory'],
    sku: ['product', 'sku', 'item id', 'product id', 'product item id'],
  },
  META: {
    campaign: ['campaign name', 'campaign'],
    date: ['day', 'date', 'reporting starts', 'reporting start'],
    spend: ['amount spent (usd)', 'amount spent', 'spend'],
    conversions: ['purchases', 'results', 'conversions'],
    revenue: ['purchase roas', 'purchase conversion value', 'conversion value', 'website purchase roas'],
    impressions: ['impressions'],
    clicks: ['link clicks', 'clicks (all)', 'clicks'],
    device: ['platform', 'placement'],
    country: ['country', 'country/region'],
    sku: ['product', 'sku', 'product id', 'product name'],
  },
  AMAZON: {
    campaign: ['campaign name', 'campaign'],
    date: ['date', 'start date'],
    spend: ['spend', 'cost', 'total spend'],
    conversions: ['orders', '14 day total orders', 'total orders', 'purchases'],
    revenue: ['sales', '14 day total sales', 'attributed sales', 'total sales'],
    impressions: ['impressions'],
    clicks: ['clicks'],
    device: ['device'],
    country: ['country'],
    sku: ['sku', 'asin', 'product', 'advertised sku', 'advertised asin'],
  },
  PINTEREST: {
    campaign: ['campaign name', 'campaign'],
    date: ['date'],
    spend: ['spend', 'amount spent', 'total spend'],
    conversions: ['conversions', 'total conversions', 'checkout'],
    revenue: ['conversion value', 'total conversion value'],
    impressions: ['impressions'],
    clicks: ['clicks', 'pin clicks', 'outbound clicks'],
    device: ['device'],
    country: ['country'],
    sku: ['product', 'sku', 'product id', 'pin id'],
  },
};

/** Detect which CSV column maps to which canonical field. */
function autoMapColumns(headers: string[], platform: PlatformType): Record<string, string> {
  const aliases = COLUMN_ALIASES[platform];
  const mapping: Record<string, string> = {}; // canonical → csv header
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  for (const [canonical, alts] of Object.entries(aliases)) {
    for (const alt of alts) {
      const idx = lowerHeaders.indexOf(alt.toLowerCase());
      if (idx !== -1) {
        mapping[canonical] = headers[idx];
        break;
      }
    }
  }
  return mapping;
}

/** Strip currency symbols, commas, whitespace from a numeric string. */
function cleanNumber(val: string | undefined | null): number {
  if (val == null || val === '' || val === '--' || val === 'N/A') return 0;
  const cleaned = String(val).replace(/[$€£¥,\s]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Parse dates in multiple formats → YYYY-MM-DD or null. */
function parseDate(val: string | undefined | null): string | null {
  if (!val || val.trim() === '') return null;
  const s = val.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY
  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YYYY (try if day > 12)
  const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const [, first, second, y] = dmyMatch;
    if (parseInt(first) > 12) {
      return `${y}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`;
    }
  }

  // "Jan 1, 2026" or "January 1, 2026"
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const namedMatch = s.match(/^(\w+)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (namedMatch) {
    const [, mon, d, y] = namedMatch;
    const mm = months[mon.toLowerCase().slice(0, 3)];
    if (mm) return `${y}-${mm}-${d.padStart(2, '0')}`;
  }

  // YYYY/MM/DD
  const ymdSlash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymdSlash) {
    const [, y, m, d] = ymdSlash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Fallback: try Date.parse
  const ts = Date.parse(s);
  if (!isNaN(ts)) {
    const dt = new Date(ts);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  return null;
}

interface CsvUploadResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  totalRows: number;
}

/** Parse a platform CSV buffer and upsert rows into ad_metrics_daily. */
async function parseAndUpsertAdCsv(buffer: Buffer, platform: PlatformType): Promise<CsvUploadResult> {
  // Strip BOM
  let raw = buffer.toString('utf-8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

  // Parse CSV with csv-parse (handles quoted fields, commas inside quotes, etc.)
  let rows: Record<string, string>[];
  try {
    rows = csvParse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
    });
  } catch (e: any) {
    return { inserted: 0, updated: 0, skipped: 0, errors: [`CSV parse error: ${e.message}`], totalRows: 0 };
  }

  if (rows.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, errors: ['CSV file contains no data rows'], totalRows: 0 };
  }

  const headers = Object.keys(rows[0]);
  const colMap = autoMapColumns(headers, platform);

  // Require at minimum: date and campaign (or at least date)
  if (!colMap.date) {
    return { inserted: 0, updated: 0, skipped: 0, errors: [`Could not find a date column. Headers found: ${headers.join(', ')}`], totalRows: rows.length };
  }
  if (!colMap.campaign) {
    return { inserted: 0, updated: 0, skipped: 0, errors: [`Could not find a campaign column. Headers found: ${headers.join(', ')}`], totalRows: rows.length };
  }

  const result: CsvUploadResult = { inserted: 0, updated: 0, skipped: 0, errors: [], totalRows: rows.length };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +2 because row 1 is header, data starts at 2

    try {
      const dateStr = parseDate(row[colMap.date]);
      if (!dateStr) {
        result.errors.push(`Row ${rowNum}: invalid date "${row[colMap.date]}"`);
        result.skipped++;
        continue;
      }

      const campaign = (row[colMap.campaign] || '').trim();
      if (!campaign) {
        result.errors.push(`Row ${rowNum}: empty campaign name`);
        result.skipped++;
        continue;
      }

      const spend = cleanNumber(row[colMap.spend]);
      const revenue = cleanNumber(row[colMap.revenue]);
      const impressions = Math.round(cleanNumber(row[colMap.impressions]));
      const clicks = Math.round(cleanNumber(row[colMap.clicks]));
      const conversions = Math.round(cleanNumber(row[colMap.conversions]));

      // Skip rows where both spend and revenue are 0
      if (spend === 0 && revenue === 0) {
        result.skipped++;
        continue;
      }

      const device = colMap.device ? (row[colMap.device] || '').trim().toLowerCase() || '_all' : '_all';
      const country = colMap.country ? (row[colMap.country] || '').trim() || '_all' : '_all';

      const sku = colMap.sku ? (row[colMap.sku] || '').trim() || 'ACCOUNT' : 'ACCOUNT';

      const metrics: InsertAdMetricsDaily = {
        platform,
        sku,
        date: dateStr,
        campaign,
        device,
        country,
        impressions,
        clicks,
        spend,
        conversions,
        revenue,
        currency: 'USD',
      };

      const existing = await storage.upsertAdMetricsDaily(metrics);
      // upsertAdMetricsDaily returns the row — if its createdAt equals updatedAt it was freshly inserted
      if (existing.createdAt && existing.updatedAt && existing.createdAt.getTime() === existing.updatedAt.getTime()) {
        result.inserted++;
      } else {
        result.updated++;
      }
    } catch (e: any) {
      result.errors.push(`Row ${rowNum}: ${e.message}`);
      result.skipped++;
    }
  }

  // Cap errors array to prevent massive responses
  if (result.errors.length > 50) {
    const total = result.errors.length;
    result.errors = result.errors.slice(0, 50);
    result.errors.push(`... and ${total - 50} more errors`);
  }

  return result;
}

let cachedDb: ReturnType<typeof drizzle> | null = null;
const getDb = () => {
  if (!cachedDb) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    attachPoolErrorHandler(pool, "cmo-analytics");
    cachedDb = drizzle(pool, { schema });
  }
  return cachedDb;
};

const parseDays = (req: Request) => Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);

async function getAnthropicKey(userId: string): Promise<string | null> {
  const settings = await storage.getSettings(userId);
  return settings?.llmApiKey || process.env.ANTHROPIC_API_KEY || null;
}

export function registerMarketingAnalyticsCmoRoutes(app: express.Application) {
  const handle = (fn: (req: Request) => Promise<any>) => async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  app.get('/api/marketing-analytics/cmo/revenue-target', requireAuth, handle(() => queryRevenueTarget(getDb())));
  app.get('/api/marketing-analytics/cmo/breakeven-roas', requireAuth, handle((req) => queryBreakevenRoas(getDb(), parseDays(req)).then(products => ({ products }))));
  app.get('/api/marketing-analytics/cmo/channel-matrix', requireAuth, handle((req) => queryChannelMatrix(getDb(), parseDays(req)).then(channels => ({ channels }))));
  // Corrected ad-spend summary (single source of truth — identical to the Finances
  // "Ad Spend by Channel"): per-platform spend with source badges, total spend,
  // window sales revenue, and sales-based blended ROAS. Backs the Ad Spend card.
  app.get('/api/marketing-analytics/cmo/ad-spend-summary', requireAuth, handle((req) => getCorrectedAdSummary(parseDays(req))));
  app.get('/api/marketing-analytics/cmo/customer-split', requireAuth, handle((req) => queryCustomerSplit(getDb(), parseDays(req))));
  app.get('/api/marketing-analytics/cmo/geographic', requireAuth, handle((req) => queryGeographic(getDb(), parseDays(req)).then(states => ({ states }))));
  app.get('/api/marketing-analytics/cmo/creative-fatigue', requireAuth, handle((req) => queryCreativeFatigue(getDb(), parseDays(req) > 90 ? parseDays(req) : 90).then(creatives => ({ creatives }))));
  app.get('/api/marketing-analytics/cmo/wasted-spend', requireAuth, handle((req) => queryWastedSpend(getDb(), parseDays(req))));
  app.get('/api/marketing-analytics/cmo/daily-revenue', requireAuth, handle((req) => queryDailyRevenueSpark(getDb(), parseDays(req)).then(days => ({ days }))));
  app.get('/api/marketing-analytics/cmo/product-mix', requireAuth, handle((req) => queryProductMixTrend(getDb(), parseDays(req)).then(products => ({ products }))));
  app.get('/api/marketing-analytics/cmo/repeat-purchase', requireAuth, handle((req) => queryRepeatPurchase(getDb(), parseDays(req)).then(cohorts => ({ cohorts }))));
  app.get('/api/marketing-analytics/cmo/top-metrics', requireAuth, handle(() => queryTopMetrics(getDb())));
  app.get('/api/marketing-analytics/cmo/monthly-sales', requireAuth, handle(() => queryMonthlySales(getDb())));
  app.get('/api/marketing-analytics/cmo/monthly-ad-spend', requireAuth, handle(() => queryMonthlyAdSpend(getDb())));
  app.get('/api/marketing-analytics/cmo/monthly-blended', requireAuth, handle(() => queryMonthlyBlended(getDb())));
  app.get('/api/marketing-analytics/cmo/sales-velocity', requireAuth, handle((req) => querySalesVelocity(getDb(), parseDays(req))));
  app.get('/api/marketing-analytics/cmo/multi-year', requireAuth, handle(() => queryMultiYearComparison(getDb())));
  app.get('/api/marketing-analytics/cmo/ltv-cac', requireAuth, handle((req) => queryLtvCac(getDb(), Math.min(Math.max(parseInt(req.query.months as string) || 18, 1), 60))));
  app.get('/api/marketing-analytics/cmo/customer-cohorts', requireAuth, handle(() => queryCustomerCohorts(getDb())));
  app.get('/api/marketing-analytics/cmo/bom-completeness', requireAuth, handle((req) => queryBomCompleteness(getDb(), parseDays(req))));
  app.get('/api/marketing-analytics/cmo/campaign-breakdown', requireAuth, handle((req) => queryCampaignBreakdown(getDb(), parseDays(req), req.query.platform as string | undefined)));
  app.get('/api/marketing-analytics/cmo/device-breakdown', requireAuth, handle((req) => queryDeviceBreakdown(getDb(), parseDays(req))));
  app.get('/api/marketing-analytics/cmo/ad-geo', requireAuth, handle((req) => queryAdGeoPerformance(getDb(), parseDays(req))));

  // Weekly CMO digest — preview (no SMS) and send-now.
  app.get('/api/marketing-analytics/cmo/weekly-digest/preview', requireAuth, async (req: Request, res: Response) => {
    try {
      const r = await WeeklyDigestService.run(req.session.userId!, { sendSms: false });
      res.json(r);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post('/api/marketing-analytics/cmo/weekly-digest/send', requireAuth, async (req: Request, res: Response) => {
    try {
      const r = await WeeklyDigestService.run(req.session.userId!, { sendSms: true });
      res.status(r.success ? 200 : 400).json(r);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Windsor.ai unified ad-spend ingestion — populates ad_metrics_daily for
  // Google + Meta + Amazon + TikTok from one connector, before native OAuth.
  app.get('/api/marketing-analytics/cmo/windsor/status', requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const hasKey = !!(await getWindsorApiKey(userId));
      res.json({ connected: hasKey });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post('/api/marketing-analytics/cmo/windsor/sync', requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const days = Math.min(Math.max(parseInt(req.body?.days) || 30, 1), 365);
      const result = await runWindsorSync(userId, days);
      res.status(result.success || result.rowsUpserted > 0 ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get('/api/marketing-analytics/cmo/full-year', requireAuth, handle(() => queryFullYearComparison(getDb())));
  app.post('/api/marketing-analytics/cmo/seed-historical', requireAuth, handle(() => seedHistoricalSales(getDb())));
  app.post('/api/marketing-analytics/cmo/seed-zo-kpi', requireAuth, handle(() => seedZoKpiData(getDb())));
  app.get('/api/marketing-analytics/cmo/cmo-history', requireAuth, handle(() => queryFullCMOHistory(getDb())));

  // Next Best Action — cached latest recommendation
  app.get('/api/marketing-analytics/cmo/next-best-action', requireAuth, async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const result = await db.execute(sql`SELECT * FROM marketing_recommendations ORDER BY generated_at DESC LIMIT 1`);
      const latest = (result.rows || result)[0];
      res.json(latest || { recommendations: null, generatedAt: null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Next Best Action — regenerate via Claude (weekly guard unless force=true)
  app.post('/api/marketing-analytics/cmo/next-best-action/refresh', requireAuth, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const userId = req.session.userId!;
      const force = req.body?.force === true;

      if (!force) {
        const last = await db.execute(sql`SELECT generated_at FROM marketing_recommendations ORDER BY generated_at DESC LIMIT 1`);
        const lastRow = (last.rows || last)[0];
        if (lastRow?.generated_at) {
          const ageMs = Date.now() - new Date(lastRow.generated_at).getTime();
          if (ageMs < 7 * 24 * 60 * 60 * 1000) {
            return res.json({ skipped: true, reason: 'Generated less than 7 days ago. Use force to override.' });
          }
        }
      }

      const apiKey = await getAnthropicKey(userId);
      if (!apiKey) {
        return res.status(400).json({ error: 'No Anthropic API key. Add it in Settings > LLM Configuration.' });
      }

      const days = 30;
      const [revenue, breakeven, channels, customers, geo, wasted] = await Promise.all([
        queryRevenueTarget(db),
        queryBreakevenRoas(db, days),
        queryChannelMatrix(db, days),
        queryCustomerSplit(db, days),
        queryGeographic(db, days),
        queryWastedSpend(db, days),
      ]);

      const snapshot = { revenue, channels, customers, geo, wasted, topProducts: breakeven.slice(0, 10) };

      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: `You are the CMO advisor for Sticker Burr Roller (SBR), a $10M outdoor tool company targeting $4.5M revenue this year. Voice: direct, contractions, no hype, no em dashes. Analyze the marketing data and produce ranked next-best-actions. Each must be specific, quantified, and assigned to an owner (Zo=creative/Google, Kevin=Meta, Christopher=budget, Mark=B2B). Respond ONLY with valid JSON: an array of objects with fields: rank (number), title (string, under 12 words), rationale (string, one sentence), expectedImpact (string, quantified), action (string, the specific move), owner (string). Max 6 recommendations. No markdown.`,
        messages: [{ role: 'user', content: `Marketing data (last 30 days):\n${JSON.stringify(snapshot, null, 2)}\n\nProduce the ranked next-best-actions as JSON.` }],
      });

      const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
      let recommendations: any;
      try {
        recommendations = JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      } catch {
        const match = text.match(/\[[\s\S]*\]/);
        recommendations = match ? JSON.parse(match[0]) : [];
      }

      await db.execute(sql`
        INSERT INTO marketing_recommendations (recommendations, input_snapshot, model, created_by)
        VALUES (${JSON.stringify(recommendations)}::jsonb, ${JSON.stringify(snapshot)}::jsonb, ${CLAUDE_MODEL}, ${userId})
      `);

      res.json({ recommendations, generatedAt: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================================
  // AD CSV UPLOAD — lets VAs upload platform export CSVs
  // ============================================================================

  app.post('/api/marketing-analytics/cmo/upload-ad-csv', requireAuth, adCsvUpload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const platform = (req.body?.platform || '').toUpperCase() as PlatformType;
      if (!['GOOGLE', 'META', 'AMAZON', 'PINTEREST'].includes(platform)) {
        return res.status(400).json({ error: `Invalid platform "${req.body?.platform}". Must be GOOGLE, META, AMAZON, or PINTEREST.` });
      }

      console.log(`[Ad CSV Upload] Processing ${req.file.originalname} for platform ${platform} (${req.file.size} bytes)`);

      const result = await parseAndUpsertAdCsv(req.file.buffer, platform);

      console.log(`[Ad CSV Upload] Done: inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}, errors=${result.errors.length}`);

      res.json(result);
    } catch (err: any) {
      console.error('[Ad CSV Upload] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // KPI Spreadsheet upload — same as ad CSV but defaults to GOOGLE since
  // Zo's KPI data is Google Ads data.
  app.post('/api/marketing-analytics/cmo/upload-kpi-spreadsheet', requireAuth, adCsvUpload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Default to GOOGLE since Zo's KPI data is Google Ads
      const platform = ((req.body?.platform || 'GOOGLE').toUpperCase()) as PlatformType;
      if (!['GOOGLE', 'META', 'AMAZON', 'PINTEREST'].includes(platform)) {
        return res.status(400).json({ error: `Invalid platform "${req.body?.platform}".` });
      }

      console.log(`[KPI Upload] Processing ${req.file.originalname} for platform ${platform} (${req.file.size} bytes)`);

      const result = await parseAndUpsertAdCsv(req.file.buffer, platform);

      console.log(`[KPI Upload] Done: inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}, errors=${result.errors.length}`);

      res.json(result);
    } catch (err: any) {
      console.error('[KPI Upload] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });
}
