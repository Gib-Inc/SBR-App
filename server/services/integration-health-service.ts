/**
 * Integration Health & Key Rotation Service
 * 
 * Monitors all external integrations with expiring tokens and API keys.
 * Creates alerts when keys are close to expiry or repeatedly failing.
 * Sends prompts via GoHighLevel to rotate API keys.
 * Logs everything to audit trail for compliance.
 * 
 * SECURITY: Never logs or exposes raw access tokens. Only metadata.
 */

import { storage } from '../storage';
import { AuditLogger } from './audit-logger';
import type { 
  AdPlatformConfig, 
  QuickbooksAuth, 
  IntegrationConfig,
  Settings 
} from '@shared/schema';

// Health status classifications
export type HealthStatus = 'OK' | 'WARNING' | 'CRITICAL' | 'EXPIRED' | 'UNKNOWN';

// Provider type for audit logging
export type HealthCheckProvider = 
  | 'QUICKBOOKS' 
  | 'META_ADS' 
  | 'GOOGLE_ADS' 
  | 'EXTENSIV' 
  | 'SHOPIFY' 
  | 'AMAZON' 
  | 'GOHIGHLEVEL' 
  | 'PHANTOMBUSTER';

export interface IntegrationHealthResult {
  provider: HealthCheckProvider;
  accountId?: string;
  accountName?: string;
  status: HealthStatus;
  daysUntilExpiry?: number;
  message: string;
  alertSent: boolean;
  consecutiveFailures?: number;
}

// Thresholds for status classification
const STATUS_THRESHOLDS = {
  OK_MIN_DAYS: 14,        // >= 14 days = OK
  WARNING_MIN_DAYS: 7,    // 7-13 days = WARNING
  CRITICAL_MIN_DAYS: 0,   // 0-6 days = CRITICAL
  MAX_KEY_AGE_DAYS: 90,   // For non-expiring keys, warn after 90 days
  MAX_CONSECUTIVE_FAILURES: 3, // Mark as CRITICAL after 3 failed auth attempts
};

// 24 hour throttle for alerts (in milliseconds)
const ALERT_THROTTLE_MS = 24 * 60 * 60 * 1000;

export class IntegrationHealthService {
  
  /**
   * Run health check for all integrations for a specific user
   */
  async checkAllForUser(userId: string): Promise<IntegrationHealthResult[]> {
    const results: IntegrationHealthResult[] = [];
    
    // Get user settings for alert configuration
    const settings = await storage.getSettings(userId);
    
    // Check QuickBooks
    try {
      const qbResults = await this.checkQuickBooks(userId, settings);
      results.push(...qbResults);
    } catch (error) {
      console.error('[IntegrationHealth] Error checking QuickBooks:', error);
    }
    
    // Check Ad Platforms (Meta, Google)
    try {
      const adResults = await this.checkAdPlatforms(userId, settings);
      results.push(...adResults);
    } catch (error) {
      console.error('[IntegrationHealth] Error checking Ad Platforms:', error);
    }
    
    // Check API Key-based integrations (Extensiv, Shopify, Amazon, GHL, PhantomBuster)
    try {
      const apiKeyResults = await this.checkApiKeyIntegrations(userId, settings);
      results.push(...apiKeyResults);
    } catch (error) {
      console.error('[IntegrationHealth] Error checking API Key integrations:', error);
    }
    
    // Log overall health check run
    await AuditLogger.logEvent({
      source: 'SYSTEM',
      eventType: 'INTEGRATION_HEALTH_CHECK_RUN',
      status: 'INFO',
      description: `Health check completed for ${results.length} integrations`,
      details: {
        userId,
        totalChecked: results.length,
        critical: results.filter(r => r.status === 'CRITICAL' || r.status === 'EXPIRED').length,
        warnings: results.filter(r => r.status === 'WARNING').length,
        ok: results.filter(r => r.status === 'OK').length,
      },
    });
    
    return results;
  }
  
  /**
   * Check QuickBooks OAuth tokens
   */
  private async checkQuickBooks(
    userId: string, 
    settings: Settings | undefined
  ): Promise<IntegrationHealthResult[]> {
    const results: IntegrationHealthResult[] = [];
    
    // Get QuickBooks auth for user (single record per user)
    const auth = await storage.getQuickbooksAuth(userId);
    
    if (!auth || !auth.isConnected) {
      return results;
    }
    
    const result = await this.evaluateTokenExpiry(
      'QUICKBOOKS',
      auth.realmId,
      auth.companyName || undefined,
      auth.accessTokenExpiresAt,
      auth.lastTokenCheckStatus as HealthStatus | null,
      auth.lastAlertSentAt || null,
      settings
    );
    
    // Update health check status in database
    await storage.updateQuickbooksAuthHealthStatus(auth.id, {
      lastTokenCheckAt: new Date(),
      lastTokenCheckStatus: result.status,
      lastAlertSentAt: result.alertSent ? new Date() : (auth.lastAlertSentAt || null),
    });
    
    // Log individual check
    await this.logHealthCheck('QUICKBOOKS', auth.realmId, auth.companyName || undefined, result);
    
    results.push(result);
    
    return results;
  }
  
  /**
   * Check Ad Platform OAuth tokens (Meta Ads, Google Ads)
   */
  private async checkAdPlatforms(
    userId: string, 
    settings: Settings | undefined
  ): Promise<IntegrationHealthResult[]> {
    const results: IntegrationHealthResult[] = [];
    
    // Get all ad platform configs for user
    const configs = await storage.getAllAdPlatformConfigs(userId);
    
    for (const config of configs) {
      if (!config.isConnected) continue;
      
      const provider = config.platform === 'META' ? 'META_ADS' : 'GOOGLE_ADS';
      
      const result = await this.evaluateTokenExpiry(
        provider,
        config.accountId || undefined,
        config.accountName || undefined,
        config.accessTokenExpiresAt,
        config.lastTokenCheckStatus as HealthStatus | null,
        config.lastAlertSentAt || null,
        settings
      );
      
      // Update health check status in database
      // If health check passes (OK), reset any stale failure state
      const updateData: any = {
        lastTokenCheckAt: new Date(),
        lastTokenCheckStatus: result.status,
        lastAlertSentAt: result.alertSent ? new Date() : config.lastAlertSentAt,
      };
      
      await storage.updateAdPlatformConfig(config.id, updateData);
      
      // Log individual check
      await this.logHealthCheck(provider, config.accountId || undefined, config.accountName || undefined, result);
      
      results.push(result);
    }
    
    return results;
  }
  
  /**
   * Check API key-based integrations (no expiry date, use age + failure count)
   */
  private async checkApiKeyIntegrations(
    userId: string, 
    settings: Settings | undefined
  ): Promise<IntegrationHealthResult[]> {
    const results: IntegrationHealthResult[] = [];
    
    // Get all integration configs for user
    const configs = await storage.getIntegrationConfigsByUserId(userId);
    
    for (const config of configs) {
      if (!config.isEnabled) continue;
      
      const provider = config.provider as HealthCheckProvider;
      
      const result = await this.evaluateApiKeyHealth(
        provider,
        config.accountName || undefined,
        config.keyCreatedAt || null,
        config.consecutiveFailures || 0,
        config.lastSyncStatus,
        config.lastTokenCheckStatus as HealthStatus | null,
        config.lastAlertSentAt || null,
        settings
      );
      
      // Update health check status in database
      // Reset consecutive failures if status is OK (healthy)
      const updateData: {
        lastTokenCheckAt: Date;
        lastTokenCheckStatus: string;
        lastAlertSentAt?: Date | null;
        consecutiveFailures?: number;
      } = {
        lastTokenCheckAt: new Date(),
        lastTokenCheckStatus: result.status,
        lastAlertSentAt: result.alertSent ? new Date() : config.lastAlertSentAt,
      };
      
      // Reset failure counter if now healthy
      if (result.status === 'OK' && (config.consecutiveFailures || 0) > 0) {
        updateData.consecutiveFailures = 0;
      }
      
      await storage.updateIntegrationConfigHealthStatus(config.id, updateData);
      
      // Log individual check
      await this.logHealthCheck(provider, config.id, config.accountName || undefined, result);
      
      results.push(result);
    }
    
    return results;
  }
  
  /**
   * Evaluate token expiry and classify health status
   */
  private async evaluateTokenExpiry(
    provider: HealthCheckProvider,
    accountId: string | undefined,
    accountName: string | undefined,
    expiresAt: Date | null,
    previousStatus: HealthStatus | null,
    lastAlertSentAt: Date | null,
    settings: Settings | undefined
  ): Promise<IntegrationHealthResult> {
    let status: HealthStatus = 'UNKNOWN';
    let daysUntilExpiry: number | undefined;
    let message: string;
    let alertSent = false;
    
    if (!expiresAt) {
      // No expiry date available - assume OK but log warning
      status = 'OK';
      message = `${provider} token does not have expiry tracking enabled`;
    } else {
      const now = new Date();
      const msUntilExpiry = expiresAt.getTime() - now.getTime();
      daysUntilExpiry = Math.floor(msUntilExpiry / (1000 * 60 * 60 * 24));
      
      if (msUntilExpiry <= 0) {
        status = 'EXPIRED';
        message = `${provider} access token for ${accountName || accountId || 'unknown'} has EXPIRED – immediate rotation required`;
      } else if (daysUntilExpiry < STATUS_THRESHOLDS.WARNING_MIN_DAYS) {
        status = 'CRITICAL';
        message = `${provider} access token for ${accountName || accountId || 'unknown'} expires in ${daysUntilExpiry} days – rotation recommended`;
      } else if (daysUntilExpiry < STATUS_THRESHOLDS.OK_MIN_DAYS) {
        status = 'WARNING';
        message = `${provider} access token for ${accountName || accountId || 'unknown'} expires in ${daysUntilExpiry} days – rotation recommended`;
      } else {
        status = 'OK';
        message = `${provider} token healthy, expires in ${daysUntilExpiry} days`;
      }
    }
    
    // Send alert if WARNING or CRITICAL and not recently alerted
    if ((status === 'WARNING' || status === 'CRITICAL' || status === 'EXPIRED') && settings) {
      alertSent = await this.maybeSendAlert(
        provider,
        accountId,
        accountName,
        status,
        daysUntilExpiry,
        message,
        lastAlertSentAt,
        settings
      );
    }
    
    return {
      provider,
      accountId,
      accountName,
      status,
      daysUntilExpiry,
      message,
      alertSent,
    };
  }
  
  /**
   * Evaluate API key health based on age and failure count
   */
  private async evaluateApiKeyHealth(
    provider: HealthCheckProvider,
    accountName: string | undefined,
    keyCreatedAt: Date | null,
    consecutiveFailures: number,
    lastSyncStatus: string | null,
    previousStatus: HealthStatus | null,
    lastAlertSentAt: Date | null,
    settings: Settings | undefined
  ): Promise<IntegrationHealthResult> {
    let status: HealthStatus = 'OK';
    let message: string;
    let alertSent = false;
    
    // Check for repeated auth failures
    if (consecutiveFailures >= STATUS_THRESHOLDS.MAX_CONSECUTIVE_FAILURES) {
      status = 'CRITICAL';
      message = `${provider} API key has ${consecutiveFailures} consecutive failures – possible key invalidation, rotation recommended`;
    } else if (lastSyncStatus === 'FAILED' && consecutiveFailures > 0) {
      status = 'WARNING';
      message = `${provider} API key has ${consecutiveFailures} recent failures – monitor closely`;
    } else if (keyCreatedAt) {
      // Check key age
      const now = new Date();
      const keyAgeDays = Math.floor((now.getTime() - keyCreatedAt.getTime()) / (1000 * 60 * 60 * 24));
      
      if (keyAgeDays > STATUS_THRESHOLDS.MAX_KEY_AGE_DAYS) {
        status = 'WARNING';
        message = `${provider} API key is ${keyAgeDays} days old – consider rotating for security`;
      } else {
        message = `${provider} API key healthy, ${keyAgeDays} days old`;
      }
    } else {
      message = `${provider} API key healthy, no issues detected`;
    }
    
    // Send alert if WARNING or CRITICAL and not recently alerted
    if ((status === 'WARNING' || status === 'CRITICAL') && settings) {
      alertSent = await this.maybeSendAlert(
        provider,
        undefined,
        accountName,
        status,
        undefined,
        message,
        lastAlertSentAt,
        settings
      );
    }
    
    return {
      provider,
      accountName,
      status,
      message,
      alertSent,
      consecutiveFailures,
    };
  }
  
  /**
   * Send alert via GoHighLevel if not recently alerted (24h throttle)
   */
  private async maybeSendAlert(
    provider: HealthCheckProvider,
    accountId: string | undefined,
    accountName: string | undefined,
    status: HealthStatus,
    daysUntilExpiry: number | undefined,
    message: string,
    lastAlertSentAt: Date | null,
    settings: Settings
  ): Promise<boolean> {
    // Check throttle - don't send if already alerted within 24 hours
    if (lastAlertSentAt) {
      const timeSinceLastAlert = Date.now() - lastAlertSentAt.getTime();
      if (timeSinceLastAlert < ALERT_THROTTLE_MS) {
        console.log(`[IntegrationHealth] Skipping alert for ${provider} - already sent ${Math.round(timeSinceLastAlert / 3600000)}h ago`);
        return false;
      }
    }
    
    // Check if we have alert recipient configured
    if (!settings.alertAdminEmail && !settings.alertAdminPhone) {
      console.log(`[IntegrationHealth] No alert recipient configured, skipping alert for ${provider}`);
      return false;
    }
    
    try {
      const { GoHighLevelClient } = await import('./gohighlevel-client');
      
      // Validate GHL is fully configured (need API key and location ID at minimum)
      const ghlApiKey = settings.gohighlevelApiKey;
      const ghlLocationId = settings.gohighlevelLocationId;
      const ghlBaseUrl = settings.gohighlevelBaseUrl || 'https://services.leadconnectorhq.com';
      
      if (!ghlApiKey || !ghlLocationId) {
        console.log(`[IntegrationHealth] GoHighLevel not fully configured (missing ${!ghlApiKey ? 'API key' : 'location ID'}), skipping alert for ${provider}`);
        return false;
      }
      
      const ghlClient = new GoHighLevelClient(ghlBaseUrl, ghlApiKey, ghlLocationId);
      
      const subject = `ROTATE API KEYS – ${provider}`;
      const expiryText = daysUntilExpiry !== undefined 
        ? `Token expires in ${daysUntilExpiry} days.` 
        : '';
      const body = `
INTEGRATION KEY ROTATION ALERT

Provider: ${provider}
Account: ${accountName || accountId || 'N/A'}
Status: ${status}
${expiryText}

${message}

Please rotate your API keys/tokens for this integration to ensure continued service.

---
This is an automated alert from your Inventory Management System.
`.trim();
      
      let alertSent = false;
      
      // Try to send email if configured
      if (settings.alertAdminEmail) {
        try {
          // First create/get a contact for the admin
          const contactResult = await ghlClient.createOrFindContact(
            'System Admin',
            settings.alertAdminEmail,
            settings.alertAdminPhone || undefined
          );
          
          if (contactResult.contactId) {
            await ghlClient.sendEmail(
              contactResult.contactId,
              subject,
              body,
              settings.alertAdminEmail
            );
            alertSent = true;
          }
        } catch (emailError) {
          console.error(`[IntegrationHealth] Failed to send email:`, emailError);
        }
      }
      
      // Try to send SMS if configured
      if (settings.alertAdminPhone) {
        try {
          const contactResult = await ghlClient.createOrFindContact(
            'System Admin',
            settings.alertAdminEmail || undefined,
            settings.alertAdminPhone
          );
          
          if (contactResult.contactId) {
            const smsBody = `ROTATE API KEYS: ${provider} ${status}. ${expiryText} Check your Inventory app.`;
            await ghlClient.sendSMS(contactResult.contactId, smsBody);
            alertSent = true;
          }
        } catch (smsError) {
          console.error(`[IntegrationHealth] Failed to send SMS:`, smsError);
        }
      }
      
      // Log the alert
      if (alertSent) {
        await AuditLogger.logEvent({
          source: 'GHL',
          eventType: 'INTEGRATION_ROTATION_ALERT',
          status: 'WARNING',
          description: `Rotation alert sent for ${provider}: ${message}`,
          details: {
            provider,
            accountId: accountId ? '***' + accountId.slice(-4) : undefined, // Redact
            accountName,
            healthStatus: status,
            daysUntilExpiry,
            alertRecipientEmail: settings.alertAdminEmail ? '***' : undefined, // Redact
            alertRecipientPhone: settings.alertAdminPhone ? '***' : undefined, // Redact
          },
        });
      }
      
      return alertSent;
    } catch (error) {
      console.error(`[IntegrationHealth] Error sending alert:`, error);
      return false;
    }
  }
  
  /**
   * Log individual health check result
   */
  private async logHealthCheck(
    provider: HealthCheckProvider,
    accountId: string | undefined,
    accountName: string | undefined,
    result: IntegrationHealthResult
  ): Promise<void> {
    const logStatus = result.status === 'OK' ? 'INFO' 
      : result.status === 'WARNING' ? 'WARNING' 
      : 'ERROR';
    
    await AuditLogger.logEvent({
      source: provider as any,
      eventType: 'INTEGRATION_HEALTH_CHECK',
      status: logStatus,
      description: result.message,
      details: {
        accountId: accountId ? '***' + accountId.slice(-4) : undefined, // Redact most of ID
        accountName,
        healthStatus: result.status,
        daysUntilExpiry: result.daysUntilExpiry,
        alertSent: result.alertSent,
        consecutiveFailures: result.consecutiveFailures,
        // NEVER log access tokens or API keys
      },
    });
  }
  
  /**
   * Record a sync failure for an integration (increments consecutive failures)
   */
  async recordSyncFailure(provider: string, configId: string): Promise<void> {
    // Get current failure count
    const config = await storage.getIntegrationConfigById(configId);
    if (config) {
      const newFailureCount = (config.consecutiveFailures || 0) + 1;
      await storage.updateIntegrationConfigHealthStatus(configId, {
        consecutiveFailures: newFailureCount,
        lastSyncStatus: 'FAILED',
      });
    }
  }
  
  /**
   * Record a sync success for an integration (resets consecutive failures)
   */
  async recordSyncSuccess(provider: string, configId: string): Promise<void> {
    await storage.updateIntegrationConfigHealthStatus(configId, {
      consecutiveFailures: 0,
      lastSyncStatus: 'SUCCESS',
    });
  }
  
  /**
   * Get health summary for display in UI
   */
  async getHealthSummary(userId: string): Promise<{
    quickbooks?: { status: HealthStatus; daysUntilExpiry?: number; message: string };
    metaAds?: { status: HealthStatus; daysUntilExpiry?: number; message: string };
    googleAds?: { status: HealthStatus; daysUntilExpiry?: number; message: string };
    integrations: Record<string, { status: HealthStatus; message: string }>;
  }> {
    const summary: {
      quickbooks?: { status: HealthStatus; daysUntilExpiry?: number; message: string };
      metaAds?: { status: HealthStatus; daysUntilExpiry?: number; message: string };
      googleAds?: { status: HealthStatus; daysUntilExpiry?: number; message: string };
      integrations: Record<string, { status: HealthStatus; message: string }>;
    } = { integrations: {} };
    
    // Get QuickBooks status
    const qbAuth = await storage.getQuickbooksAuth(userId);
    if (qbAuth && qbAuth.isConnected) {
      let status: HealthStatus = 'UNKNOWN';
      let daysUntilExpiry: number | undefined;
      let message = 'No recent health check';
      
      if (qbAuth.lastTokenCheckStatus) {
        status = qbAuth.lastTokenCheckStatus as HealthStatus;
      }
      if (qbAuth.accessTokenExpiresAt) {
        const msUntil = qbAuth.accessTokenExpiresAt.getTime() - Date.now();
        daysUntilExpiry = Math.max(0, Math.floor(msUntil / (1000 * 60 * 60 * 24)));
        if (daysUntilExpiry <= 0) {
          status = 'EXPIRED';
          message = 'Token expired - rotation required';
        } else if (daysUntilExpiry < 7) {
          status = 'CRITICAL';
          message = `Token expires in ${daysUntilExpiry} days`;
        } else if (daysUntilExpiry < 14) {
          status = 'WARNING';
          message = `Token expires in ${daysUntilExpiry} days`;
        } else {
          status = 'OK';
          message = `Token expires in ${daysUntilExpiry} days`;
        }
      }
      
      summary.quickbooks = { status, daysUntilExpiry, message };
    }
    
    // Get Ad Platform statuses
    const adConfigs = await storage.getAllAdPlatformConfigs(userId);
    for (const config of adConfigs) {
      if (!config.isConnected) continue;
      
      let status: HealthStatus = config.lastTokenCheckStatus as HealthStatus || 'UNKNOWN';
      let daysUntilExpiry: number | undefined;
      let message = 'No recent health check';
      
      if (config.accessTokenExpiresAt) {
        const msUntil = config.accessTokenExpiresAt.getTime() - Date.now();
        daysUntilExpiry = Math.max(0, Math.floor(msUntil / (1000 * 60 * 60 * 24)));
        if (daysUntilExpiry <= 0) {
          status = 'EXPIRED';
          message = 'Token expired - rotation required';
        } else if (daysUntilExpiry < 7) {
          status = 'CRITICAL';
          message = `Token expires in ${daysUntilExpiry} days`;
        } else if (daysUntilExpiry < 14) {
          status = 'WARNING';
          message = `Token expires in ${daysUntilExpiry} days`;
        } else {
          status = 'OK';
          message = `Token expires in ${daysUntilExpiry} days`;
        }
      }
      
      if (config.platform === 'META') {
        summary.metaAds = { status, daysUntilExpiry, message };
      } else if (config.platform === 'GOOGLE') {
        summary.googleAds = { status, daysUntilExpiry, message };
      }
    }
    
    // Get Integration Config statuses
    const integrationConfigs = await storage.getIntegrationConfigsByUserId(userId);
    for (const config of integrationConfigs) {
      if (!config.isEnabled) continue;
      
      const status: HealthStatus = config.lastTokenCheckStatus as HealthStatus || 'OK';
      let message = 'Healthy';
      
      if (config.consecutiveFailures && config.consecutiveFailures >= 3) {
        message = `${config.consecutiveFailures} consecutive failures`;
      } else if (config.lastTokenCheckStatus === 'WARNING') {
        message = 'Key rotation recommended';
      }
      
      summary.integrations[config.provider] = { status, message };
    }
    
    return summary;
  }
}

export const integrationHealthService = new IntegrationHealthService();
