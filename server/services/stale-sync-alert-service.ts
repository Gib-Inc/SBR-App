/**
 * Stale Sync Alert Service
 * 
 * Monitors data source syncs and creates GHL opportunities when syncs become stale.
 * Stale is defined as no successful sync within the threshold period (default 24h).
 */

import { storage } from '../storage';
import { GHLOpportunitiesService } from './ghl-opportunities-service';
import { AuditLogger } from './audit-logger';
import { GHL_CONFIG } from '../config/ghl-config';
import type { IntegrationConfig } from '@shared/schema';

const STALE_THRESHOLD_HOURS = 24;
const ALERT_COOLDOWN_HOURS = 24;

interface StaleSyncAlert {
  source: string;
  sourceName: string;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  hoursSinceSync: number;
  ghlOpportunityCreated: boolean;
  ghlOpportunityId?: string;
}

const DATA_SOURCE_LABELS: Record<string, string> = {
  SHOPIFY: 'Shopify Orders',
  AMAZON: 'Amazon Orders',
  EXTENSIV: 'Extensiv Warehouse',
  GOHIGHLEVEL: 'GoHighLevel CRM',
  QUICKBOOKS: 'QuickBooks Finance',
};

export class StaleSyncAlertService {
  private ghlService: GHLOpportunitiesService;
  
  constructor() {
    this.ghlService = new GHLOpportunitiesService();
  }
  
  async checkAndAlertStaleSync(userId: string): Promise<StaleSyncAlert[]> {
    const alerts: StaleSyncAlert[] = [];
    const now = new Date();
    
    const sources = ['SHOPIFY', 'AMAZON', 'EXTENSIV', 'GOHIGHLEVEL', 'QUICKBOOKS'];
    
    for (const source of sources) {
      try {
        const config = await storage.getIntegrationConfig(userId, source);
        
        if (!config || !config.isEnabled) {
          continue;
        }
        
        const hoursSinceSync = config.lastSyncAt 
          ? (now.getTime() - new Date(config.lastSyncAt).getTime()) / (1000 * 60 * 60)
          : Infinity;
        
        const isStale = hoursSinceSync > STALE_THRESHOLD_HOURS || 
                        config.lastSyncStatus === 'FAILED';
        
        if (isStale) {
          const shouldCreateAlert = await this.shouldCreateAlert(config, userId);
          
          let ghlResult: { opportunityId?: string } = {};
          if (shouldCreateAlert) {
            ghlResult = await this.createGHLStaleSyncOpportunity(userId, source, config, hoursSinceSync);
            
            if (config.id) {
              await storage.updateIntegrationConfigHealthStatus(config.id, {
                lastAlertSentAt: new Date(),
              });
            }
          }
          
          alerts.push({
            source,
            sourceName: DATA_SOURCE_LABELS[source] || source,
            lastSyncAt: config.lastSyncAt,
            lastSyncStatus: config.lastSyncStatus,
            hoursSinceSync: Math.round(hoursSinceSync),
            ghlOpportunityCreated: !!ghlResult.opportunityId,
            ghlOpportunityId: ghlResult.opportunityId,
          });
        }
      } catch (error: any) {
        console.error(`[StaleSyncAlert] Error checking ${source}:`, error.message);
      }
    }
    
    if (alerts.length > 0) {
      await AuditLogger.logEvent({
        source: 'SYSTEM',
        eventType: 'STALE_SYNC_CHECK',
        status: 'WARNING',
        description: `Found ${alerts.length} stale data source(s)`,
        details: {
          userId,
          alerts: alerts.map(a => ({
            source: a.source,
            hoursSinceSync: a.hoursSinceSync,
            lastStatus: a.lastSyncStatus,
          })),
        },
      });
    }
    
    return alerts;
  }
  
  private async shouldCreateAlert(config: IntegrationConfig, userId: string): Promise<boolean> {
    if (!config.lastAlertSentAt) {
      return true;
    }
    
    const hoursSinceLastAlert = (Date.now() - new Date(config.lastAlertSentAt).getTime()) / (1000 * 60 * 60);
    return hoursSinceLastAlert >= ALERT_COOLDOWN_HOURS;
  }
  
  private async createGHLStaleSyncOpportunity(
    userId: string, 
    source: string, 
    config: IntegrationConfig,
    hoursSinceSync: number
  ): Promise<{ opportunityId?: string }> {
    try {
      const initialized = await this.ghlService.initialize(userId);
      if (!initialized) {
        console.log('[StaleSyncAlert] GHL not configured, skipping opportunity creation');
        return {};
      }
      
      const systemContactId = await this.ghlService.getOrCreateSystemContact();
      if (!systemContactId) {
        console.error('[StaleSyncAlert] Failed to get/create system contact');
        return {};
      }
      
      const sourceName = DATA_SOURCE_LABELS[source] || source;
      const lastSyncTime = config.lastSyncAt 
        ? new Date(config.lastSyncAt).toLocaleString()
        : 'Never';
      
      const appUrl = process.env.APP_BASE_URL || 'https://localhost:5000';
      
      const aiAgentsLink = `${appUrl}/ai-agents?tab=data-sources`;
      
      const result = await this.ghlService.upsertOpportunity({
        externalKey: `stale-sync-${source}-${userId}`,
        name: `Stale Sync Alert: ${sourceName}`,
        pipelineStageId: GHL_CONFIG.stages.STALE_SYNC_ALERT,
        status: 'open',
        contactId: systemContactId,
        customFields: {
          'data_source': sourceName,
          'hours_since_sync': Math.round(hoursSinceSync),
          'last_sync_status': config.lastSyncStatus || 'Unknown',
          'last_sync_at': lastSyncTime,
          'ai_agents_link': aiAgentsLink,
        },
        notes: `The ${sourceName} data source has not synced in ${Math.round(hoursSinceSync)} hours.\n\nLast sync: ${lastSyncTime}\nLast status: ${config.lastSyncStatus || 'Unknown'}\n\nClick here to check the data source settings:\n${aiAgentsLink}`,
      });
      
      if (result.success && result.opportunityId) {
        console.log(`[StaleSyncAlert] Created GHL opportunity for stale ${source}: ${result.opportunityId}`);
        
        await AuditLogger.logEvent({
          source: 'GHL',
          eventType: 'STALE_SYNC_OPPORTUNITY_CREATED',
          entityType: 'INTEGRATION',
          entityId: source,
          entityLabel: sourceName,
          status: 'INFO',
          description: `Created stale sync alert opportunity in GHL for ${sourceName}`,
          details: {
            opportunityId: result.opportunityId,
            opportunityUrl: result.opportunityUrl,
            hoursSinceSync: Math.round(hoursSinceSync),
            aiAgentsLink,
          },
        });
        
        return { opportunityId: result.opportunityId };
      }
      
      return {};
    } catch (error: any) {
      console.error(`[StaleSyncAlert] Error creating GHL opportunity for ${source}:`, error.message);
      return {};
    }
  }
  
  async runScheduledCheck(): Promise<void> {
    console.log('[StaleSyncAlert] Running scheduled stale sync check');
    
    try {
      const users = await storage.getAllUsers();
      
      for (const user of users) {
        try {
          await this.checkAndAlertStaleSync(user.id);
        } catch (error: any) {
          console.error(`[StaleSyncAlert] Error checking user ${user.id}:`, error.message);
        }
      }
    } catch (error: any) {
      console.error('[StaleSyncAlert] Error in scheduled check:', error.message);
    }
  }
}

export const staleSyncAlertService = new StaleSyncAlertService();
