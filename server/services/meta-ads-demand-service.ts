/**
 * Meta Ads Demand Service
 * 
 * Calculates ORDER/DONT_ORDER/NEUTRAL decisions based on Meta Ads performance data.
 * This is a READ-ONLY demand signal - no changes are made to Meta Ads.
 * 
 * Mirrors the behavior of GoogleAdsDemandService for consistency.
 */

import { storage } from '../storage';
import { metaAdsClient, MetaInsightsResult } from './meta-ads-client';
import { SourceDecision, DataSourceType, SourceDecisionStatus, InsertMetaAdsPerformance } from '@shared/schema';
import { AuditLogger } from './audit-logger';

interface MetaPerformanceMetrics {
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
  metrics: MetaPerformanceMetrics | null;
}

export class MetaAdsDemandService {
  private userId: string | null = null;
  private accountId: string | null = null;
  private configId: string | null = null;
  private lookbackDays: number = 14;

  async initialize(userId: string): Promise<boolean> {
    this.userId = userId;
    
    const config = await storage.getAdPlatformConfig(userId, 'META');
    if (!config?.isConnected) {
      return false;
    }

    this.configId = config.id;
    const accessToken = config.accessToken;
    this.accountId = config.accountId;

    if (!accessToken || !this.accountId) {
      return false;
    }

    metaAdsClient.setAccessToken(accessToken);
    return true;
  }

  /**
   * Update the ad platform config with sync status
   */
  private async updateSyncStatus(status: 'SUCCESS' | 'FAILED', message: string): Promise<void> {
    if (!this.configId) return;
    
    await storage.updateAdPlatformConfig(this.configId, {
      lastSyncAt: new Date(),
      lastSyncStatus: status,
      lastSyncMessage: message,
    });
  }

  /**
   * Fetch Meta Ads performance data for the last N days
   * Returns raw insights mapped to SKUs where possible
   */
  async fetchPerformanceData(): Promise<MetaInsightsResult[]> {
    if (!this.accountId) {
      throw new Error('Meta Ads not initialized');
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - this.lookbackDays);

    try {
      const adAccountId = this.accountId.startsWith('act_') 
        ? this.accountId 
        : `act_${this.accountId}`;

      const skuMappings = await this.getSkuMappings();
      
      const results = await metaAdsClient.fetchAccountInsights(
        adAccountId,
        startDate,
        endDate,
        skuMappings
      );

      console.log(`[MetaAdsDemand] Fetched ${results.length} performance rows for last ${this.lookbackDays} days`);
      return results;
    } catch (error: any) {
      console.error('[MetaAdsDemand] Failed to fetch performance data:', error);
      throw error;
    }
  }

  /**
   * Get SKU mappings from adSkuMappings table
   * Maps ad entity IDs to house SKUs
   */
  private async getSkuMappings(): Promise<Map<string, string>> {
    const mappings = await storage.getAdSkuMappingsByPlatform('META');
    const result = new Map<string, string>();
    
    for (const mapping of mappings) {
      if (mapping.isActive && mapping.adEntityId && mapping.sku) {
        result.set(mapping.adEntityId, mapping.sku);
      }
    }
    
    return result;
  }

  /**
   * Store performance data in MetaAdsPerformance table
   */
  async storePerformanceData(data: MetaInsightsResult[]): Promise<number> {
    if (!this.accountId) return 0;
    
    let stored = 0;
    
    for (const row of data) {
      const item = await storage.getItemBySku(row.sku);
      
      const perf: InsertMetaAdsPerformance = {
        productId: item?.id ?? null,
        sku: row.sku,
        date: row.date,
        source: 'META_ADS',
        accountId: this.accountId,
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        conversions: row.conversions,
        conversionValue: row.revenue,
        currency: row.currency,
      };
      
      await storage.upsertMetaAdsPerformance(perf);
      stored++;
    }
    
    return stored;
  }

  /**
   * Aggregate performance data by SKU
   */
  aggregateBySku(data: MetaInsightsResult[]): Map<string, MetaPerformanceMetrics> {
    const skuMetrics = new Map<string, MetaPerformanceMetrics>();

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
   * Calculate Meta Ads source decision for a single item
   * 
   * Decision thresholds (consistent with Google Ads):
   * - ORDER: projectedOrders > available * 0.7 (high demand relative to stock)
   * - DONT_ORDER: projectedOrders < available * 0.3 (low demand relative to stock)
   * - NEUTRAL: otherwise
   */
  calculateMetaAdsDecision(
    sku: string,
    available: number,
    daysLeftHorizon: number,
    metrics: MetaPerformanceMetrics | null
  ): SourceDecision {
    if (!metrics || metrics.totalConversions === 0) {
      return {
        source: DataSourceType.META_ADS,
        status: SourceDecisionStatus.NO_DATA,
        rationale: "No recent Meta Ads data mapped to this SKU.",
        metrics: {
          lookbackDays: this.lookbackDays,
        },
      };
    }

    const projectedOrdersFromMeta = metrics.avgConvPerDay * daysLeftHorizon;
    
    let status: "ORDER" | "DONT_ORDER" | "NEUTRAL";
    let rationale: string;

    if (projectedOrdersFromMeta > available * 0.7) {
      status = SourceDecisionStatus.ORDER;
      rationale = `Meta Ads are generating strong demand (~${projectedOrdersFromMeta.toFixed(1)} orders expected over ${daysLeftHorizon} days vs ${available} units available).`;
    } else if (projectedOrdersFromMeta < available * 0.3) {
      status = SourceDecisionStatus.DONT_ORDER;
      rationale = `Meta Ads demand is low relative to current stock (~${projectedOrdersFromMeta.toFixed(1)} expected orders vs ${available} units available).`;
    } else {
      status = SourceDecisionStatus.NEUTRAL;
      rationale = `Meta Ads demand is moderate and does not strongly impact reorder needs (~${projectedOrdersFromMeta.toFixed(1)} orders expected vs ${available} units).`;
    }

    return {
      source: DataSourceType.META_ADS,
      status,
      rationale,
      metrics: {
        avgConvPerDay: parseFloat(metrics.avgConvPerDay.toFixed(2)),
        projectedOrdersFromMeta: parseFloat(projectedOrdersFromMeta.toFixed(1)),
        available,
        horizonDays: daysLeftHorizon,
        lookbackDays: this.lookbackDays,
        totalSpend: parseFloat(metrics.totalSpend.toFixed(2)),
        roas: parseFloat(metrics.roas.toFixed(2)),
      },
    };
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
   * Sync Meta Ads demand signals for all items with recommendations
   * This updates the sourceDecisionsJson field with Meta Ads SourceDecision
   */
  async syncDemandSignals(): Promise<{
    success: boolean;
    itemsProcessed: number;
    itemsWithData: number;
    rowsStored: number;
    errors: string[];
  }> {
    if (!this.userId) {
      return { success: false, itemsProcessed: 0, itemsWithData: 0, rowsStored: 0, errors: ['Service not initialized'] };
    }

    const errors: string[] = [];
    let itemsProcessed = 0;
    let itemsWithData = 0;
    let rowsStored = 0;

    try {
      const performanceData = await this.fetchPerformanceData();
      
      rowsStored = await this.storePerformanceData(performanceData);
      console.log(`[MetaAdsDemand] Stored ${rowsStored} performance rows`);
      
      const skuMetrics = this.aggregateBySku(performanceData);
      console.log(`[MetaAdsDemand] Aggregated metrics for ${skuMetrics.size} SKUs`);

      const recommendations = await storage.getAllAIRecommendations();
      
      for (const rec of recommendations) {
        if (!rec.sku) continue;

        try {
          const metrics = skuMetrics.get(rec.sku) || null;
          const available = rec.availableForSale ?? 0;
          const daysLeftHorizon = rec.daysUntilStockout ?? rec.horizonDays ?? 28;

          const metaAdsDecision = this.calculateMetaAdsDecision(
            rec.sku,
            available,
            daysLeftHorizon,
            metrics
          );

          const existingSourceDecisions = rec.sourceDecisionsJson as any;
          let sources: SourceDecision[] = [];
          
          if (existingSourceDecisions?.sources && Array.isArray(existingSourceDecisions.sources)) {
            sources = existingSourceDecisions.sources.filter(
              (s: SourceDecision) => s.source !== DataSourceType.META_ADS
            );
          }
          
          sources.push(metaAdsDecision);

          const { finalDecision, finalRationale } = this.calculateFinalDecision(
            sources,
            rec.recommendationType ?? undefined
          );

          const updatedDetail = {
            finalDecision,
            finalRationale,
            sources,
          };

          await storage.updateAIRecommendation(rec.id, {
            sourceDecisionsJson: updatedDetail as any,
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
        source: 'META_ADS',
        integrationName: 'Meta Ads Demand Signal',
        recordsProcessed: itemsProcessed,
        recordsUpdated: itemsWithData,
      });

      await this.updateSyncStatus('SUCCESS', 
        `Processed ${itemsProcessed} recommendations, ${itemsWithData} with Meta Ads data, ${rowsStored} rows stored`
      );

      return { success: true, itemsProcessed, itemsWithData, rowsStored, errors };
    } catch (error: any) {
      await AuditLogger.logIntegrationError({
        source: 'META_ADS',
        integrationName: 'Meta Ads Demand Signal',
        error: error.message,
        context: { itemsProcessed, itemsWithData },
      });

      await this.updateSyncStatus('FAILED', error.message);

      return { 
        success: false, 
        itemsProcessed, 
        itemsWithData, 
        rowsStored,
        errors: [error.message, ...errors] 
      };
    }
  }

  /**
   * Sync performance data only (without updating AI recommendations)
   * Useful for the "Sync" button on the Data Sources card
   */
  async syncPerformanceData(): Promise<{
    success: boolean;
    rowsStored: number;
    rowsMapped: number;
    rowsUnmapped: number;
    errors: string[];
  }> {
    if (!this.userId) {
      return { success: false, rowsStored: 0, rowsMapped: 0, rowsUnmapped: 0, errors: ['Service not initialized'] };
    }

    try {
      const performanceData = await this.fetchPerformanceData();
      const rowsStored = await this.storePerformanceData(performanceData);
      
      const rowsMapped = performanceData.filter(p => p.sku).length;
      const rowsUnmapped = performanceData.length - rowsMapped;

      await AuditLogger.logIntegrationSync({
        source: 'META_ADS',
        integrationName: 'Meta Ads Performance Sync',
        recordsProcessed: performanceData.length,
        recordsUpdated: rowsMapped,
      });

      await this.updateSyncStatus('SUCCESS', 
        `Synced ${rowsStored} rows (${rowsMapped} mapped, ${rowsUnmapped} unmapped)`
      );

      return { success: true, rowsStored, rowsMapped, rowsUnmapped, errors: [] };
    } catch (error: any) {
      await AuditLogger.logIntegrationError({
        source: 'META_ADS',
        integrationName: 'Meta Ads Performance Sync',
        error: error.message,
      });

      await this.updateSyncStatus('FAILED', error.message);

      return { 
        success: false, 
        rowsStored: 0, 
        rowsMapped: 0, 
        rowsUnmapped: 0,
        errors: [error.message] 
      };
    }
  }
}

export const metaAdsDemandService = new MetaAdsDemandService();
