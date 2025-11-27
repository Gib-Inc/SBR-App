/**
 * Ad Metrics Sync Service
 * 
 * Orchestrates syncing ad metrics from Meta Ads and Google Ads.
 * Aggregates metrics by SKU + date and upserts to ad_metrics_daily table.
 * 
 * V1 Scope:
 * - Daily sync triggered manually or by scheduler
 * - Aggregate by SKU for forecasting (not marketing reporting)
 * - Log all sync activities to audit trail
 */

import { storage } from '../storage';
import { metaAdsClient, MetaInsightsResult } from './meta-ads-client';
import { googleAdsClient, GoogleInsightsResult } from './google-ads-client';
import { AuditLogger } from './audit-logger';
import type { InsertAdMetricsDaily, AdPlatformConfig } from '@shared/schema';

interface SyncResult {
  platform: 'META' | 'GOOGLE';
  accountId: string;
  accountName?: string;
  success: boolean;
  skusProcessed: number;
  metricsUpserted: number;
  daysProcessed: number;
  error?: string;
}

interface AggregatedMetric {
  sku: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
}

export class AdMetricsSyncService {
  private auditLogger = AuditLogger;

  /**
   * Sync all configured ad platforms for a user
   */
  async syncAllForUser(userId: string, daysToSync: number = 7): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    // Get all connected platform configs for the user
    const configs = await storage.getAllAdPlatformConfigs(userId);
    const connectedConfigs = configs.filter((c: AdPlatformConfig) => c.isConnected);

    for (const config of connectedConfigs) {
      try {
        const result = await this.syncPlatform(config, daysToSync);
        results.push(result);
      } catch (error) {
        console.error(`[AdMetricsSyncService] Error syncing ${config.platform}:`, error);
        results.push({
          platform: config.platform as 'META' | 'GOOGLE',
          accountId: config.accountId || 'unknown',
          accountName: config.accountName || undefined,
          success: false,
          skusProcessed: 0,
          metricsUpserted: 0,
          daysProcessed: 0,
          error: String(error),
        });
      }
    }

    return results;
  }

  /**
   * Sync a specific platform
   */
  async syncPlatform(config: AdPlatformConfig, daysToSync: number = 7): Promise<SyncResult> {
    const platform = config.platform as 'META' | 'GOOGLE';
    const accountId = config.accountId || '';
    const accountName = config.accountName || undefined;

    // Log sync start
    await this.auditLogger.logAdSyncStarted({
      platform,
      accountId,
      accountName,
      daysToSync,
    });

    try {
      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysToSync);

      // Get SKU mappings for this platform
      const mappings = await storage.getAdSkuMappingsByPlatform(platform);
      const skuMap = new Map<string, string>();
      for (const m of mappings) {
        skuMap.set(m.adEntityId, m.sku);
      }

      let rawMetrics: Array<MetaInsightsResult | GoogleInsightsResult> = [];

      if (platform === 'META') {
        rawMetrics = await this.fetchMetaMetrics(config, startDate, endDate, skuMap);
      } else if (platform === 'GOOGLE') {
        rawMetrics = await this.fetchGoogleMetrics(config, startDate, endDate);
      }

      // Aggregate metrics by SKU + date
      const aggregated = this.aggregateMetrics(rawMetrics);

      // Get unique SKUs processed
      const skusProcessed = new Set(aggregated.map(m => m.sku)).size;

      // Calculate unique days
      const daysSet = new Set(aggregated.map(m => m.date));
      const daysProcessed = daysSet.size;

      // Upsert to database
      let metricsUpserted = 0;
      for (const metric of aggregated) {
        await storage.upsertAdMetricsDaily({
          platform,
          sku: metric.sku,
          date: metric.date,
          impressions: Math.round(metric.impressions),
          clicks: Math.round(metric.clicks),
          spend: metric.spend,
          conversions: Math.round(metric.conversions),
          revenue: metric.revenue,
        });
        metricsUpserted++;
      }

      // Update last sync time
      await storage.updateAdPlatformConfig(config.id, {
        lastSyncAt: new Date(),
      });

      // Log sync completion
      await this.auditLogger.logAdSyncCompleted({
        platform,
        accountId,
        accountName,
        skusProcessed,
        metricsUpserted,
        daysProcessed,
      });

      return {
        platform,
        accountId,
        accountName,
        success: true,
        skusProcessed,
        metricsUpserted,
        daysProcessed,
      };
    } catch (error) {
      // Log sync failure
      await this.auditLogger.logAdSyncFailed({
        platform,
        accountId,
        accountName,
        error: String(error),
      });

      return {
        platform,
        accountId,
        accountName,
        success: false,
        skusProcessed: 0,
        metricsUpserted: 0,
        daysProcessed: 0,
        error: String(error),
      };
    }
  }

  /**
   * Fetch metrics from Meta Ads
   */
  private async fetchMetaMetrics(
    config: AdPlatformConfig,
    startDate: Date,
    endDate: Date,
    skuMappings: Map<string, string>
  ): Promise<MetaInsightsResult[]> {
    if (!config.accessToken) {
      throw new Error('Meta Ads access token not configured');
    }

    metaAdsClient.setAccessToken(config.accessToken);
    
    const accountId = config.accountId;
    if (!accountId) {
      throw new Error('Meta Ads account ID not configured');
    }

    return metaAdsClient.fetchAccountInsights(accountId, startDate, endDate, skuMappings);
  }

  /**
   * Fetch metrics from Google Ads
   */
  private async fetchGoogleMetrics(
    config: AdPlatformConfig,
    startDate: Date,
    endDate: Date
  ): Promise<GoogleInsightsResult[]> {
    if (!config.accessToken) {
      throw new Error('Google Ads access token not configured');
    }

    googleAdsClient.setAccessToken(config.accessToken);
    if (config.refreshToken) {
      googleAdsClient.setRefreshToken(config.refreshToken);
    }
    
    const customerId = config.accountId;
    if (!customerId) {
      throw new Error('Google Ads customer ID not configured');
    }

    // Google Shopping campaigns have native SKU-level data via product_item_id
    return googleAdsClient.fetchShoppingPerformance(customerId, startDate, endDate);
  }

  /**
   * Aggregate metrics by SKU + date
   * Combines metrics from multiple campaigns/adsets targeting the same SKU
   */
  private aggregateMetrics(
    rawMetrics: Array<MetaInsightsResult | GoogleInsightsResult>
  ): AggregatedMetric[] {
    const aggregateMap = new Map<string, AggregatedMetric>();

    for (const metric of rawMetrics) {
      const key = `${metric.sku}|${metric.date}`;
      
      if (aggregateMap.has(key)) {
        const existing = aggregateMap.get(key)!;
        existing.impressions += metric.impressions;
        existing.clicks += metric.clicks;
        existing.spend += metric.spend;
        existing.conversions += metric.conversions;
        existing.revenue += metric.revenue;
      } else {
        aggregateMap.set(key, {
          sku: metric.sku,
          date: metric.date,
          impressions: metric.impressions,
          clicks: metric.clicks,
          spend: metric.spend,
          conversions: metric.conversions,
          revenue: metric.revenue,
        });
      }
    }

    return Array.from(aggregateMap.values());
  }

  /**
   * Get sync status for a user's platforms
   */
  async getSyncStatus(userId: string): Promise<{
    metaConfigured: boolean;
    googleConfigured: boolean;
    metaLastSync?: Date | null;
    googleLastSync?: Date | null;
    metaAccountName?: string;
    googleAccountName?: string;
  }> {
    const configs = await storage.getAllAdPlatformConfigs(userId);
    
    const metaConfig = configs.find((c: AdPlatformConfig) => c.platform === 'META' && c.isConnected);
    const googleConfig = configs.find((c: AdPlatformConfig) => c.platform === 'GOOGLE' && c.isConnected);

    return {
      metaConfigured: !!metaConfig,
      googleConfigured: !!googleConfig,
      metaLastSync: metaConfig?.lastSyncAt,
      googleLastSync: googleConfig?.lastSyncAt,
      metaAccountName: metaConfig?.accountName || undefined,
      googleAccountName: googleConfig?.accountName || undefined,
    };
  }
}

export const adMetricsSyncService = new AdMetricsSyncService();
