/**
 * Marketing Analytics — API routes
 * Separate from the monolith routes.ts. Analytics-only, read-only.
 */

import express, { type Request, type Response } from 'express';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@shared/schema';
import { attachPoolErrorHandler } from '../pool-error-handler';
import { requireAuth } from '../middleware/auth';
import {
  querySpendPacing,
  queryChannelMix,
  queryProductPerformance,
  queryCreativeIntelligence,
  querySeasonalIntelligence,
  queryKPIs,
} from './marketing-analytics-queries';

let cachedDb: ReturnType<typeof drizzle> | null = null;
const getDb = () => {
  if (!cachedDb) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    attachPoolErrorHandler(pool, "marketing-analytics");
    cachedDb = drizzle(pool, { schema });
  }
  return cachedDb;
};

function parseDays(req: Request): number {
  const d = parseInt(req.query.days as string) || 30;
  return Math.min(Math.max(d, 1), 365);
}

export function registerMarketingAnalyticsRoutes(app: express.Application) {
  app.get('/api/marketing-analytics/kpis', requireAuth, async (_req: Request, res: Response) => {
    try {
      const kpis = await queryKPIs(getDb());
      res.json(kpis);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/marketing-analytics/spend-pacing', requireAuth, async (req: Request, res: Response) => {
    try {
      const days = parseDays(req);
      const daily = await querySpendPacing(getDb(), days);

      const mtdSpend = daily.reduce((s: number, r: any) => s + (r.spend || 0), 0);
      const mtdRevenue = daily.reduce((s: number, r: any) => s + (r.revenue || 0), 0);
      const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
      const dayOfMonth = new Date().getDate();
      const projectedMonthEnd = dayOfMonth > 0 ? (mtdSpend / dayOfMonth) * daysInMonth : 0;

      res.json({
        daily,
        mtdSpend,
        mtdRevenue,
        projectedMonthEnd,
        spendRevenueRatio: mtdRevenue > 0 ? mtdSpend / mtdRevenue : null,
        daysInPeriod: days,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/marketing-analytics/channel-mix', requireAuth, async (req: Request, res: Response) => {
    try {
      const days = parseDays(req);
      const channels = await queryChannelMix(getDb(), days);

      const totalSpend = channels.reduce((s: number, r: any) => s + (r.spend || 0), 0);
      const totalRevenue = channels.reduce((s: number, r: any) => s + (r.revenue || 0), 0);
      const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : null;
      const tacos = totalRevenue > 0 ? totalSpend / totalRevenue : null;

      res.json({ channels, blendedRoas, tacos, totalSpend, totalRevenue });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/marketing-analytics/product-performance', requireAuth, async (req: Request, res: Response) => {
    try {
      const days = parseDays(req);
      const products = await queryProductPerformance(getDb(), days);

      const flagged = (products as any[]).map((p: any) => ({
        ...p,
        conflict: p.days_of_stock !== null && p.days_of_stock < 14 && p.spend > 50
          ? 'LOW_STOCK_HIGH_SPEND'
          : (p.available_qty || 0) > 50 && (p.spend || 0) === 0
            ? 'HIGH_STOCK_NO_ADS'
            : null,
      }));

      res.json({ products: flagged });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/marketing-analytics/creative-intelligence', requireAuth, async (req: Request, res: Response) => {
    try {
      const days = parseDays(req);
      const data = await queryCreativeIntelligence(getDb(), days);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/marketing-analytics/seasonal', requireAuth, async (req: Request, res: Response) => {
    try {
      const currentYear = parseInt(req.query.currentYear as string) || new Date().getFullYear();
      const compareYear = parseInt(req.query.compareYear as string) || currentYear - 1;
      const data = await querySeasonalIntelligence(getDb(), currentYear, compareYear);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
