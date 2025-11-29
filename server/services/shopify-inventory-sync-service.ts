/**
 * Shopify Inventory Sync Service
 * Handles two-way inventory synchronization with Shopify
 * 
 * System of Record: This app is the source of truth for inventory quantities.
 * - Shopify quantities are PUSHED from this app (write-only to Shopify)
 * - Shopify orders are READ from Shopify (orders sync is handled by ShopifyClient)
 * - Safety buffer can be applied to reserve some stock from Shopify
 */

import { storage } from "../storage";
import { logService } from "./log-service";
import type { Item } from "@shared/schema";

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

export class ShopifyInventorySyncService {
  private shopDomain: string;
  private accessToken: string;
  private apiVersion: string;
  private defaultLocationId: string | null;

  constructor() {
    this.shopDomain = (process.env.SHOPIFY_SHOP_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN || '';
    this.apiVersion = process.env.SHOPIFY_API_VERSION || '2024-01';
    this.defaultLocationId = process.env.SHOPIFY_LOCATION_ID || null;
  }

  private getHeaders(): Record<string, string> {
    return {
      'X-Shopify-Access-Token': this.accessToken,
      'Content-Type': 'application/json',
    };
  }

  private getBaseUrl(): string {
    return `https://${this.shopDomain}/admin/api/${this.apiVersion}`;
  }

  isConfigured(): boolean {
    return !!(this.shopDomain && this.accessToken);
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

    const locationId = item.shopifyLocationId || this.defaultLocationId;
    if (!locationId) {
      result.error = 'No Shopify location ID configured';
      return result;
    }

    try {
      const inventoryItemId = await this.getInventoryItemId(item.shopifyVariantId);
      if (!inventoryItemId) {
        result.error = 'Could not get inventory item ID from Shopify';
        return result;
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
   */
  async syncAllInventory(userId?: string): Promise<ShopifyBulkSyncResult> {
    const result: ShopifyBulkSyncResult = {
      totalItems: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      results: [],
    };

    if (!this.isConfigured()) {
      console.log('[ShopifyInventorySync] Not configured, skipping bulk sync');
      return result;
    }

    let safetyBuffer = 0;
    if (userId) {
      const settings = await storage.getAiAgentSettingsByUserId(userId);
      if (settings?.shopifyTwoWaySync === false) {
        console.log('[ShopifyInventorySync] Two-way sync disabled for user, skipping');
        return result;
      }
      safetyBuffer = settings?.shopifySafetyBuffer || 0;
    }

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
   * Requires userId to check user's Shopify sync settings
   */
  async syncItemById(itemId: string, userId: string): Promise<ShopifySyncResult | null> {
    if (!this.isConfigured()) {
      return null;
    }

    if (!userId) {
      console.log('[ShopifyInventorySync] No userId provided, skipping sync');
      return null;
    }

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


export const shopifyInventorySync = new ShopifyInventorySyncService();
