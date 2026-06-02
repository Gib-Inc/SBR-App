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
import * as schema from '@shared/schema';
import { storage } from '../storage';
import { requireAuth } from '../middleware/auth';
import {
  queryRevenueTarget, queryBreakevenRoas, queryChannelMatrix,
  queryCustomerSplit, queryGeographic, queryCreativeFatigue, queryWastedSpend,
  queryDailyRevenueSpark, queryProductMixTrend, queryRepeatPurchase, queryTopMetrics,
  queryMonthlySales, queryMonthlyAdSpend, queryMonthlyBlended,
  querySalesVelocity, queryMultiYearComparison,
} from './marketing-analytics-queries-v2';

const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

let cachedDb: ReturnType<typeof drizzle> | null = null;
const getDb = () => {
  if (!cachedDb) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    cachedDb = drizzle(new pg.Pool({ connectionString: process.env.DATABASE_URL }), { schema });
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
}
