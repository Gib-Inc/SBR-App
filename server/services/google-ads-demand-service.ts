/**
 * Google Ads Demand Service
 * 
 * Calculates ORDER/DONT_ORDER/NEUTRAL decisions based on Google Ads performance data.
 * This is a READ-ONLY demand signal - no changes are made to Google Ads.
 */

import { storage } from '../storage';
import { googleAdsClient, GoogleInsightsResult } from './google-ads-client';
import { SourceDecision, RecommendationDetail, DataSourceType, SourceDecisionStatus } from '@shared/schema';
import { AuditLogger } from './audit-logger';

interface AdPerformanceMetrics {
  sku: string;
  avgConvPerDay: number;
  avgRevenuePerDay: number;
  avgSpendPerDay: number;
  totalConversions: number;
  totalRevenue: number;
  totalSpend: number;
  daysCovered: number;
  roas: number;
}

interface DemandSignalResult {
  sku: string;
  itemId: string;
  sourceDecision: SourceDecision;
  metrics: AdPerformanceMetrics | null;
}

export class GoogleAdsDemandService {
  private userId: string | null = null;
  private customerId: string | null = null;
  private lookbackDays: number = 14;

  async initialize(userId: string): Promise<boolean> {
    this.userId = userId;
    
    const config = await storage.getIntegrationConfig(userId, 'GOOGLE_ADS');
    if (!config?.isEnabled) {
      return false;
    }

    const configData = config.config as Record<string, any> || {};
    const accessToken = configData.accessToken;
    const refreshToken = configData.refreshToken;
    this.customerId = configData.customerId;

    if (!accessToken || !this.customerId) {
      return false;
    }

    googleAdsClient.setAccessToken(accessToken);
    if (refreshToken) {
      googleAdsClient.setRefreshToken(refreshToken);
    }

    return true;
  }

  /**
   * Fetch Google Ads performance data for the last N days
   */
  async fetchPerformanceData(): Promise<GoogleInsightsResult[]> {
    if (!this.customerId) {
      throw new Error('Google Ads not initialized');
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - this.lookbackDays);

    try {
      const results = await googleAdsClient.fetchShoppingPerformance(
        this.customerId,
        startDate,
        endDate
      );

      console.log(`[GoogleAdsDemand] Fetched ${results.length} performance rows for last ${this.lookbackDays} days`);
      return results;
    } catch (error: any) {
      console.error('[GoogleAdsDemand] Failed to fetch performance data:', error);
      
      if (error.message?.includes('token')) {
        try {
          await googleAdsClient.refreshAccessToken();
          return await googleAdsClient.fetchShoppingPerformance(
            this.customerId,
            startDate,
            endDate
          );
        } catch (refreshError) {
          throw new Error('Token refresh failed: ' + String(refreshError));
        }
      }
      
      throw error;
    }
  }

  /**
   * Aggregate performance data by SKU
   */
  aggregateBySku(data: GoogleInsightsResult[]): Map<string, AdPerformanceMetrics> {
    const skuMetrics = new Map<string, AdPerformanceMetrics>();

    for (const row of data) {
      const existing = skuMetrics.get(row.sku);
      
      if (existing) {
        existing.totalConversions += row.conversions;
        existing.totalRevenue += row.revenue;
        existing.totalSpend += row.spend;
      } else {
        skuMetrics.set(row.sku, {
          sku: row.sku,
          avgConvPerDay: 0,
          avgRevenuePerDay: 0,
          avgSpendPerDay: 0,
          totalConversions: row.conversions,
          totalRevenue: row.revenue,
          totalSpend: row.spend,
          daysCovered: this.lookbackDays,
          roas: 0,
        });
      }
    }

    const entries = Array.from(skuMetrics.entries());
    for (const [_sku, metrics] of entries) {
      metrics.avgConvPerDay = metrics.totalConversions / metrics.daysCovered;
      metrics.avgRevenuePerDay = metrics.totalRevenue / metrics.daysCovered;
      metrics.avgSpendPerDay = metrics.totalSpend / metrics.daysCovered;
      metrics.roas = metrics.totalSpend > 0 
        ? metrics.totalRevenue / metrics.totalSpend 
        : 0;
    }

    return skuMetrics;
  }

  /**
   * Calculate Google Ads source decision for a single item
   */
  calculateGoogleAdsDecision(
    sku: string,
    available: number,
    daysLeftHorizon: number,
    metrics: AdPerformanceMetrics | null
  ): SourceDecision {
    if (!metrics || metrics.totalConversions === 0) {
      return {
        source: DataSourceType.GOOGLE_ADS,
        status: SourceDecisionStatus.NO_DATA,
        rationale: "No recent Google Ads data available for this SKU.",
        metrics: {
          timeWindow: `last_${this.lookbackDays}_days`,
        },
      };
    }

    const projectedOrdersHorizon = metrics.avgConvPerDay * daysLeftHorizon;
    
    let status: "ORDER" | "DONT_ORDER" | "NEUTRAL";
    let rationale: string;

    if (projectedOrdersHorizon > available * 0.7) {
      status = SourceDecisionStatus.ORDER;
      rationale = `High ad-driven demand: ~${projectedOrdersHorizon.toFixed(1)} orders expected over ${daysLeftHorizon} days vs ${available} units available.`;
    } else if (projectedOrdersHorizon < available * 0.3) {
      status = SourceDecisionStatus.DONT_ORDER;
      rationale = `Ad-driven demand appears low: ~${projectedOrdersHorizon.toFixed(1)} orders expected vs ${available} units available.`;
    } else {
      status = SourceDecisionStatus.NEUTRAL;
      rationale = `Moderate ad-driven demand: ~${projectedOrdersHorizon.toFixed(1)} orders expected vs ${available} units available.`;
    }

    return {
      source: DataSourceType.GOOGLE_ADS,
      status,
      rationale,
      metrics: {
        avgConvPerDay: parseFloat(metrics.avgConvPerDay.toFixed(2)),
        projectedOrdersHorizon: parseFloat(projectedOrdersHorizon.toFixed(1)),
        available,
        daysLeftHorizon,
        totalRevenue: parseFloat(metrics.totalRevenue.toFixed(2)),
        roas: parseFloat(metrics.roas.toFixed(2)),
        timeWindow: `last_${this.lookbackDays}_days`,
      },
    };
  }

  /**
   * Generate stub decisions for sources not yet implemented
   */
  generateStubDecisions(existingShopifyData: boolean = false, existingExtensivData: boolean = false, existingQuickBooksData: boolean = false): SourceDecision[] {
    const stubs: SourceDecision[] = [];

    stubs.push({
      source: DataSourceType.META_ADS,
      status: SourceDecisionStatus.NO_DATA,
      rationale: "Meta Ads integration not yet configured.",
      metrics: {},
    });

    if (!existingShopifyData) {
      stubs.push({
        source: DataSourceType.SHOPIFY,
        status: SourceDecisionStatus.NO_DATA,
        rationale: "Shopify demand signal not computed for this SKU.",
        metrics: {},
      });
    }

    if (!existingExtensivData) {
      stubs.push({
        source: DataSourceType.EXTENSIV,
        status: SourceDecisionStatus.NO_DATA,
        rationale: "Extensiv warehouse signal not computed for this SKU.",
        metrics: {},
      });
    }

    if (!existingQuickBooksData) {
      stubs.push({
        source: DataSourceType.QUICKBOOKS,
        status: SourceDecisionStatus.NO_DATA,
        rationale: "QuickBooks demand history not computed for this SKU.",
        metrics: {},
      });
    }

    return stubs;
  }

  /**
   * Calculate final decision based on all source decisions
   */
  calculateFinalDecision(
    sources: SourceDecision[],
    existingRecommendationType?: string
  ): { finalDecision: "ORDER" | "DONT_ORDER" | "MONITOR"; finalRationale: string } {
    const orderSources = sources.filter(s => s.status === SourceDecisionStatus.ORDER);
    const dontOrderSources = sources.filter(s => s.status === SourceDecisionStatus.DONT_ORDER);
    const neutralSources = sources.filter(s => s.status === SourceDecisionStatus.NEUTRAL);
    const hasData = sources.some(s => s.status !== SourceDecisionStatus.NO_DATA);

    let finalDecision: "ORDER" | "DONT_ORDER" | "MONITOR";
    let finalRationale: string;

    if (existingRecommendationType === 'REORDER' || existingRecommendationType === 'OK') {
      finalDecision = existingRecommendationType === 'REORDER' ? 'ORDER' : 'DONT_ORDER';
    } else if (orderSources.length > 0 && dontOrderSources.length === 0) {
      finalDecision = 'ORDER';
    } else if (dontOrderSources.length > 0 && orderSources.length === 0) {
      finalDecision = 'DONT_ORDER';
    } else if (orderSources.length > 0 && dontOrderSources.length > 0) {
      finalDecision = 'MONITOR';
    } else {
      finalDecision = 'MONITOR';
    }

    if (orderSources.length > 0) {
      const orderSourceNames = orderSources.map(s => s.source.replace('_', ' ')).join(', ');
      finalRationale = `${orderSourceNames} indicate${orderSources.length === 1 ? 's' : ''} strong demand. `;
    } else {
      finalRationale = '';
    }

    if (dontOrderSources.length > 0) {
      const dontOrderSourceNames = dontOrderSources.map(s => s.source.replace('_', ' ')).join(', ');
      finalRationale += `${dontOrderSourceNames} suggest${dontOrderSources.length === 1 ? 's' : ''} adequate stock. `;
    }

    if (!hasData) {
      finalRationale = 'Limited data available. Recommend manual review based on inventory levels.';
    }

    if (finalRationale.trim() === '') {
      finalRationale = 'Neutral signals from available data sources.';
    }

    return { finalDecision, finalRationale: finalRationale.trim() };
  }

  /**
   * Build complete RecommendationDetail for an item
   */
  async buildRecommendationDetail(
    sku: string,
    available: number,
    daysLeftHorizon: number,
    googleAdsMetrics: AdPerformanceMetrics | null,
    existingRecommendationType?: string
  ): Promise<RecommendationDetail> {
    const sources: SourceDecision[] = [];

    const googleAdsDecision = this.calculateGoogleAdsDecision(
      sku,
      available,
      daysLeftHorizon,
      googleAdsMetrics
    );
    sources.push(googleAdsDecision);

    const stubs = this.generateStubDecisions();
    sources.push(...stubs);

    const { finalDecision, finalRationale } = this.calculateFinalDecision(sources, existingRecommendationType);

    return {
      finalDecision,
      finalRationale,
      sourceDecisions: sources,
    };
  }

  /**
   * Sync Google Ads demand signals for all items with recommendations
   */
  async syncDemandSignals(): Promise<{
    success: boolean;
    itemsProcessed: number;
    itemsWithData: number;
    errors: string[];
  }> {
    if (!this.userId) {
      return { success: false, itemsProcessed: 0, itemsWithData: 0, errors: ['Service not initialized'] };
    }

    const errors: string[] = [];
    let itemsProcessed = 0;
    let itemsWithData = 0;

    try {
      const performanceData = await this.fetchPerformanceData();
      const skuMetrics = this.aggregateBySku(performanceData);
      
      console.log(`[GoogleAdsDemand] Aggregated metrics for ${skuMetrics.size} SKUs`);

      const recommendations = await storage.getAllAIRecommendations();
      
      for (const rec of recommendations) {
        if (!rec.sku) continue;

        try {
          const metrics = skuMetrics.get(rec.sku) || null;
          const available = rec.availableForSale ?? 0;
          const daysLeftHorizon = rec.daysUntilStockout ?? rec.horizonDays ?? 28;

          const detail = await this.buildRecommendationDetail(
            rec.sku,
            available,
            daysLeftHorizon,
            metrics,
            rec.recommendationType ?? undefined
          );

          await storage.updateAIRecommendation(rec.id, {
            sourceDecisionsJson: detail as any,
          });

          itemsProcessed++;
          if (metrics) {
            itemsWithData++;
          }
        } catch (error: any) {
          errors.push(`Failed to process ${rec.sku}: ${error.message}`);
        }
      }

      await AuditLogger.logIntegrationSync({
        source: 'GOOGLE_ADS',
        integrationName: 'Google Ads Demand Signal',
        recordsProcessed: itemsProcessed,
        recordsUpdated: itemsWithData,
      });

      return { success: true, itemsProcessed, itemsWithData, errors };
    } catch (error: any) {
      await AuditLogger.logIntegrationError({
        source: 'GOOGLE_ADS',
        integrationName: 'Google Ads Demand Signal',
        error: error.message,
        context: { itemsProcessed, itemsWithData },
      });

      return { 
        success: false, 
        itemsProcessed, 
        itemsWithData, 
        errors: [error.message, ...errors] 
      };
    }
  }
}

export const googleAdsDemandService = new GoogleAdsDemandService();
