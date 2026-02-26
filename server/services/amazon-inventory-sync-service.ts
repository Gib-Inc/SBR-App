/**
 * Amazon Inventory Sync Service
 * Handles two-way inventory synchronization with Amazon Seller Central
 * Respects amazonTwoWaySync toggle in AI Agent settings
 */

import { storage } from "../storage";
import { AmazonClient } from "./amazon-client";
import { logService } from "./log-service";
import type { Item } from "@shared/schema";

export class AmazonInventorySyncService {
  private client: AmazonClient | null = null;
  private userId: string | null = null;
  private initialized: boolean = false;

  /**
   * Initialize the service with user credentials
   */
  async initialize(userId: string): Promise<boolean> {
    this.userId = userId;
    
    try {
      const config = await storage.getIntegrationConfig(userId, 'AMAZON');
      
      if (!config || !config.apiKey) {
        console.log(`[AmazonInventorySync] No Amazon config found for user ${userId}`);
        return false;
      }

      const sellerId = config.config?.sellerId;
      const marketplaceId = config.config?.marketplaceIds?.[0];
      const clientId = config.config?.clientId || process.env.AMAZON_CLIENT_ID;
      const clientSecret = config.config?.clientSecret || process.env.AMAZON_CLIENT_SECRET;
      const refreshToken = config.apiKey;
      const region = config.config?.region || 'NA';

      if (!sellerId || !marketplaceId || !clientId || !refreshToken) {
        console.log(`[AmazonInventorySync] Incomplete Amazon config for user ${userId}`);
        return false;
      }

      this.client = new AmazonClient(
        sellerId,
        marketplaceId,
        refreshToken,
        clientId,
        clientSecret || '',
        region
      );

      this.initialized = true;
      console.log(`[AmazonInventorySync] Initialized for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`[AmazonInventorySync] Failed to initialize:`, error);
      return false;
    }
  }

  /**
   * Check if two-way sync is enabled in AI Agent settings
   */
  private async isTwoWaySyncEnabled(): Promise<boolean> {
    if (!this.userId) return false;
    
    const settings = await storage.getAiAgentSettingsByUserId(this.userId);
    return settings?.amazonTwoWaySync ?? false;
  }

  /**
   * Check if push inventory is enabled in integration config
   */
  private async isPushInventoryEnabled(): Promise<boolean> {
    if (!this.userId) return false;
    
    const config = await storage.getIntegrationConfig(this.userId, 'AMAZON');
    return config?.config?.pushInventory ?? false;
  }

  /**
   * Get the safety buffer from AI Agent settings
   */
  private async getSafetyBuffer(): Promise<number> {
    if (!this.userId) return 0;
    
    const settings = await storage.getAiAgentSettingsByUserId(this.userId);
    return settings?.amazonSafetyBuffer ?? 0;
  }

  /**
   * Sync inventory for a single item to Amazon
   * Returns true if sync was attempted, false if skipped
   */
  async syncItemInventory(item: Item): Promise<{
    synced: boolean;
    dryRun: boolean;
    message: string;
  }> {
    if (!this.initialized || !this.client || !this.userId) {
      return { synced: false, dryRun: false, message: 'Service not initialized' };
    }

    if (!item.amazonSku) {
      return { synced: false, dryRun: false, message: 'Item not mapped to Amazon' };
    }

    const twoWayEnabled = await this.isTwoWaySyncEnabled();
    const pushEnabled = await this.isPushInventoryEnabled();
    const safetyBuffer = await this.getSafetyBuffer();

    const availableQty = Math.max(0, (item.availableForSaleQty || 0) - safetyBuffer);

    if (!twoWayEnabled) {
      await logService.logSystemEvent({
        type: 'AMAZON_INVENTORY_PUSH',
        entityType: 'PRODUCT',
        entityId: item.id,
        severity: 'INFO',
        code: 'DRY_RUN',
        message: `[DRY RUN] Would set Amazon qty for ${item.amazonSku} to ${availableQty} (Two-Way Sync OFF)`,
        details: {
          itemId: item.id,
          sku: item.sku,
          amazonSku: item.amazonSku,
          targetQuantity: availableQty,
          safetyBuffer,
        },
      });

      return { 
        synced: false, 
        dryRun: true, 
        message: `Dry run: would set ${item.amazonSku} to ${availableQty}` 
      };
    }

    if (!pushEnabled) {
      return { 
        synced: false, 
        dryRun: false, 
        message: 'Push inventory disabled in integration settings' 
      };
    }

    try {
      const result = await this.client.updateInventory(item.amazonSku, availableQty);

      if (result.success) {
        await logService.logSystemEvent({
          type: 'AMAZON_SYNC_INFO',
          entityType: 'PRODUCT',
          entityId: item.id,
          severity: 'INFO',
          code: 'INVENTORY_PUSHED',
          message: `Pushed inventory to Amazon: ${item.amazonSku} = ${availableQty}`,
          details: {
            itemId: item.id,
            sku: item.sku,
            amazonSku: item.amazonSku,
            quantity: availableQty,
            safetyBuffer,
          },
        });

        return { synced: true, dryRun: false, message: result.message };
      } else {
        await logService.logSystemEvent({
          type: 'AMAZON_SYNC_ERROR',
          entityType: 'PRODUCT',
          entityId: item.id,
          severity: 'ERROR',
          code: 'PUSH_FAILED',
          message: `Failed to push inventory to Amazon: ${result.message}`,
          details: {
            itemId: item.id,
            sku: item.sku,
            amazonSku: item.amazonSku,
            targetQuantity: availableQty,
            error: result.message,
          },
        });

        return { synced: false, dryRun: false, message: result.message };
      }
    } catch (error: any) {
      await logService.logSystemEvent({
        type: 'AMAZON_SYNC_ERROR',
        entityType: 'PRODUCT',
        entityId: item.id,
        severity: 'ERROR',
        code: 'PUSH_EXCEPTION',
        message: `Exception pushing inventory to Amazon: ${error.message}`,
        details: {
          itemId: item.id,
          sku: item.sku,
          amazonSku: item.amazonSku,
          error: error.message,
        },
      });

      return { synced: false, dryRun: false, message: error.message };
    }
  }

  /**
   * Sync all mapped items to Amazon
   */
  async syncAllInventory(): Promise<{
    total: number;
    synced: number;
    dryRun: number;
    skipped: number;
    failed: number;
    twoWayEnabled: boolean;
    pushEnabled: boolean;
    errors: Array<{ sku: string; error: string }>;
  }> {
    if (!this.initialized || !this.client || !this.userId) {
      return {
        total: 0,
        synced: 0,
        dryRun: 0,
        skipped: 0,
        failed: 0,
        twoWayEnabled: false,
        pushEnabled: false,
        errors: [],
      };
    }

    const twoWayEnabled = await this.isTwoWaySyncEnabled();
    const pushEnabled = await this.isPushInventoryEnabled();

    const items = await storage.getItems();
    const amazonMappedItems = items.filter(item => 
      item.type === 'finished_product' && item.amazonSku
    );

    let synced = 0;
    let dryRun = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ sku: string; error: string }> = [];

    for (const item of amazonMappedItems) {
      const result = await this.syncItemInventory(item);
      
      if (result.synced) {
        synced++;
      } else if (result.dryRun) {
        dryRun++;
      } else if (result.message.includes('disabled') || result.message.includes('not mapped')) {
        skipped++;
      } else {
        failed++;
        errors.push({ sku: item.amazonSku || item.sku, error: result.message });
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return {
      total: amazonMappedItems.length,
      synced,
      dryRun,
      skipped,
      failed,
      twoWayEnabled,
      pushEnabled,
      errors,
    };
  }

  /**
   * Fetch listings for SKU mapping
   */
  async fetchListingsForMapping() {
    if (!this.initialized || !this.client) {
      throw new Error('Amazon service not initialized');
    }
    return this.client.fetchListingsForMapping();
  }

  /**
   * Test connection
   */
  async testConnection() {
    if (!this.initialized || !this.client) {
      return { success: false, message: 'Service not initialized' };
    }
    return this.client.testConnection();
  }
}

export const amazonInventorySyncService = new AmazonInventorySyncService();
