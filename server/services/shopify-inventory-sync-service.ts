/**
 * Shopify Inventory Sync Service
 * Handles two-way inventory synchronization with Shopify
 * 
 * System of Record: This app is the source of truth for inventory quantities.
 * - Shopify quantities are PUSHED from this app (write-only to Shopify)
 * - Shopify orders are READ from Shopify (orders sync is handled by ShopifyClient)
 * - Safety buffer can be applied to reserve some stock from Shopify
 * 
 * Credentials Source: IntegrationConfig table (with env var fallback)
 */

import { storage } from "../storage";
import { logService } from "./log-service";
import type { Item, IntegrationConfig } from "@shared/schema";

export interface ShopifyInventoryLevel {
  inventoryItemId: string;
  locationId: string;
  available: number;
}

export interface ShopifySyncResult {
  success: boolean;
  itemId: string;
  sku: string;
  shopifyVariantId: string;
  previousLevel?: number;
  newLevel: number;
  error?: string;
}

export interface ShopifyBulkSyncResult {
  totalItems: number;
  synced: number;
  skipped: number;
  failed: number;
  results: ShopifySyncResult[];
}

interface ShopifyCredentials {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  defaultLocationId: string | null;
}

export class ShopifyInventorySyncService {
  private credentials: ShopifyCredentials | null = null;
  private userId: string | null = null;

  /**
   * Initialize the service with user-specific credentials from IntegrationConfig
   * Falls back to environment variables if no config is found
   */
  async initialize(userId: string): Promise<boolean> {
    this.userId = userId;
    
    try {
      // Try to get credentials from IntegrationConfig
      const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
      
      if (config?.isEnabled && config.apiKey) {
        const configData = config.config as Record<string, any> || {};
        this.credentials = {
          shopDomain: (configData.shopDomain || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
          accessToken: config.apiKey,
          apiVersion: configData.apiVersion || '2024-01',
          defaultLocationId: configData.locationId || null,
        };
        console.log(`[ShopifyInventorySync] Initialized with IntegrationConfig for user ${userId}`);
        return this.isConfigured();
      }
      
      // Fall back to environment variables
      const envDomain = (process.env.SHOPIFY_SHOP_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
      const envToken = process.env.SHOPIFY_ACCESS_TOKEN || '';
      
      if (envDomain && envToken) {
        this.credentials = {
          shopDomain: envDomain,
          accessToken: envToken,
          apiVersion: process.env.SHOPIFY_API_VERSION || '2024-01',
          defaultLocationId: process.env.SHOPIFY_LOCATION_ID || null,
        };
        console.log(`[ShopifyInventorySync] Initialized with environment variables (fallback)`);
        return this.isConfigured();
      }
      
      console.log(`[ShopifyInventorySync] No Shopify credentials found for user ${userId}`);
      return false;
    } catch (error: any) {
      console.error(`[ShopifyInventorySync] Error initializing:`, error.message);
      return false;
    }
  }

  private getHeaders(): Record<string, string> {
    if (!this.credentials) {
      throw new Error('ShopifyInventorySyncService not initialized');
    }
    return {
      'X-Shopify-Access-Token': this.credentials.accessToken,
      'Content-Type': 'application/json',
    };
  }

  private getBaseUrl(): string {
    if (!this.credentials) {
      throw new Error('ShopifyInventorySyncService not initialized');
    }
    return `https://${this.credentials.shopDomain}/admin/api/${this.credentials.apiVersion}`;
  }

  isConfigured(): boolean {
    return !!(this.credentials?.shopDomain && this.credentials?.accessToken);
  }

  /**
   * Get the current credentials info (for status display)
   */
  getCredentialsInfo(): { configured: boolean; shopDomain?: string; hasLocationId: boolean } {
    return {
      configured: this.isConfigured(),
      shopDomain: this.credentials?.shopDomain,
      hasLocationId: !!this.credentials?.defaultLocationId,
    };
  }

  /**
   * Get inventory item ID for a Shopify variant
   * Shopify variants have an inventory_item_id that's needed for inventory updates
   */
  async getInventoryItemId(variantId: string): Promise<string | null> {
    if (!this.isConfigured()) {
      console.log('[ShopifyInventorySync] Not configured, skipping getInventoryItemId');
      return null;
    }

    try {
      const response = await fetch(
        `${this.getBaseUrl()}/variants/${variantId}.json`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ShopifyInventorySync] Failed to get variant ${variantId}: ${response.status} - ${errorText}`);
        return null;
      }

      const data = await response.json();
      return data.variant?.inventory_item_id ? String(data.variant.inventory_item_id) : null;
    } catch (error: any) {
      console.error(`[ShopifyInventorySync] Error getting inventory item ID: ${error.message}`);
      return null;
    }
  }

  /**
   * Get current inventory level for an item at a specific location
   */
  async getInventoryLevel(inventoryItemId: string, locationId: string): Promise<number | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const response = await fetch(
        `${this.getBaseUrl()}/inventory_levels.json?inventory_item_ids=${inventoryItemId}&location_ids=${locationId}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const level = data.inventory_levels?.[0];
      return level ? level.available : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Set inventory level for an item at a specific location
   * Uses the inventory_levels/set endpoint which sets the absolute available quantity
   */
  async setInventoryLevel(
    inventoryItemId: string,
    locationId: string,
    available: number
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Shopify not configured' };
    }

    try {
      const response = await fetch(
        `${this.getBaseUrl()}/inventory_levels/set.json`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            location_id: locationId,
            inventory_item_id: inventoryItemId,
            available: Math.max(0, Math.floor(available)),
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return { 
          success: false, 
          error: `Shopify API error: ${response.status} - ${errorText}` 
        };
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Sync a single item's inventory to Shopify
   * Applies safety buffer from AI agent settings
   */
  async syncItemInventory(
    item: Item,
    safetyBuffer: number = 0
  ): Promise<ShopifySyncResult> {
    const result: ShopifySyncResult = {
      success: false,
      itemId: item.id,
      sku: item.sku || 'unknown',
      shopifyVariantId: item.shopifyVariantId || '',
      newLevel: 0,
    };

    if (!item.shopifyVariantId) {
      result.error = 'No Shopify variant ID configured';
      return result;
    }

    // Use item-level location or default from credentials
    const locationId = item.shopifyLocationId || this.credentials?.defaultLocationId;
    if (!locationId) {
      result.error = 'No Shopify location ID configured';
      return result;
    }

    try {
      // Use shopifyInventoryItemId if available, otherwise fetch it
      let inventoryItemId = item.shopifyInventoryItemId;
      if (!inventoryItemId) {
        inventoryItemId = await this.getInventoryItemId(item.shopifyVariantId);
        if (!inventoryItemId) {
          result.error = 'Could not get inventory item ID from Shopify';
          return result;
        }
        
        // Optionally update the item with the fetched inventory item ID
        try {
          await storage.updateItem(item.id, { shopifyInventoryItemId: inventoryItemId });
        } catch (e) {
          // Non-critical, continue
        }
      }

      result.previousLevel = await this.getInventoryLevel(inventoryItemId, locationId) ?? undefined;

      const availableQty = item.availableForSaleQty || 0;
      const adjustedQty = Math.max(0, availableQty - safetyBuffer);
      result.newLevel = adjustedQty;

      const setResult = await this.setInventoryLevel(inventoryItemId, locationId, adjustedQty);
      
      if (setResult.success) {
        result.success = true;
        console.log(
          `[ShopifyInventorySync] Synced ${item.sku}: ${result.previousLevel ?? 'unknown'} -> ${adjustedQty} (buffer: ${safetyBuffer})`
        );
      } else {
        result.error = setResult.error;
        await logService.logShopifySyncError({
          sku: item.sku || 'unknown',
          productId: item.id,
          variantId: item.shopifyVariantId || undefined,
          locationId: locationId,
          error: setResult.error || 'Unknown error',
        });
      }

      return result;
    } catch (error: any) {
      result.error = error.message;
      await logService.logShopifySyncError({
        sku: item.sku || 'unknown',
        productId: item.id,
        error: error.message,
      });
      return result;
    }
  }

  /**
   * Sync all items that have Shopify mapping configured
   * Only syncs items where shopifyVariantId is set
   * 
   * @param userId - Required user ID for settings lookup
   */
  async syncAllInventory(userId: string): Promise<ShopifyBulkSyncResult> {
    const result: ShopifyBulkSyncResult = {
      totalItems: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      results: [],
    };

    // Initialize if not already
    if (!this.isConfigured() || this.userId !== userId) {
      const initialized = await this.initialize(userId);
      if (!initialized) {
        console.log('[ShopifyInventorySync] Not configured, skipping bulk sync');
        return result;
      }
    }

    // Check if two-way sync is enabled
    const settings = await storage.getAiAgentSettingsByUserId(userId);
    if (settings?.shopifyTwoWaySync === false) {
      console.log('[ShopifyInventorySync] Two-way sync disabled for user, skipping');
      return result;
    }
    const safetyBuffer = settings?.shopifySafetyBuffer || 0;

    const items = await storage.getAllItems();
    const shopifyItems = items.filter((item: Item) => item.shopifyVariantId);
    result.totalItems = shopifyItems.length;

    console.log(`[ShopifyInventorySync] Starting bulk sync for ${shopifyItems.length} items with Shopify mapping`);

    for (const item of shopifyItems) {
      const syncResult = await this.syncItemInventory(item, safetyBuffer);
      result.results.push(syncResult);

      if (syncResult.success) {
        result.synced++;
      } else if (syncResult.error?.includes('No Shopify')) {
        result.skipped++;
      } else {
        result.failed++;
      }

      // Rate limiting - Shopify has API limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(
      `[ShopifyInventorySync] Bulk sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.failed} failed`
    );

    return result;
  }

  /**
   * Sync inventory for a specific item by ID
   * Called after inventory movements (PO receipts, sales, returns, etc.)
   * 
   * @param itemId - The item ID to sync
   * @param userId - Required user ID for settings and credentials lookup
   */
  async syncItemById(itemId: string, userId: string): Promise<ShopifySyncResult | null> {
    // Initialize if not already
    if (!this.isConfigured() || this.userId !== userId) {
      const initialized = await this.initialize(userId);
      if (!initialized) {
        return null;
      }
    }

    // Check if two-way sync is enabled
    const settings = await storage.getAiAgentSettingsByUserId(userId);
    if (!settings?.shopifyTwoWaySync) {
      return null;
    }

    const item = await storage.getItem(itemId);
    if (!item || !item.shopifyVariantId) {
      return null;
    }

    const safetyBuffer = settings.shopifySafetyBuffer || 0;
    return this.syncItemInventory(item, safetyBuffer);
  }
}

// Singleton instance - must call initialize() before use
export const shopifyInventorySync = new ShopifyInventorySyncService();
