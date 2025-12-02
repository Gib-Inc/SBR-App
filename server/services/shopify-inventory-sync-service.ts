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
  pivotLocationId: string | null;
  hildaleLocationId: string | null;
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
        
        // Multi-location support: prefer new pivotLocationId/hildaleLocationId, fallback to legacy locationId
        const legacyLocationId = configData.locationId || null;
        const pivotLocationId = configData.pivotLocationId || legacyLocationId; // Legacy falls back to Pivot
        const hildaleLocationId = configData.hildaleLocationId || null;
        
        this.credentials = {
          shopDomain: (configData.shopDomain || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
          accessToken: config.apiKey,
          apiVersion: configData.apiVersion || '2024-01',
          defaultLocationId: pivotLocationId, // For backward compatibility
          pivotLocationId,
          hildaleLocationId,
        };
        
        // Log which location IDs are configured
        const locationInfo = [];
        if (pivotLocationId) locationInfo.push(`Pivot: ${pivotLocationId}`);
        if (hildaleLocationId) locationInfo.push(`Hildale: ${hildaleLocationId}`);
        if (legacyLocationId && !configData.pivotLocationId) {
          console.log(`[ShopifyInventorySync] Using legacy locationId as Pivot location`);
        }
        
        console.log(`[ShopifyInventorySync] Initialized with IntegrationConfig for user ${userId}. Locations: ${locationInfo.join(', ') || 'none configured'}`);
        return this.isConfigured();
      }
      
      // Fall back to environment variables
      const envDomain = (process.env.SHOPIFY_SHOP_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
      const envToken = process.env.SHOPIFY_ACCESS_TOKEN || '';
      
      if (envDomain && envToken) {
        const envLegacyLocationId = process.env.SHOPIFY_LOCATION_ID || null;
        const envPivotLocationId = process.env.SHOPIFY_PIVOT_LOCATION_ID || envLegacyLocationId;
        const envHildaleLocationId = process.env.SHOPIFY_HILDALE_LOCATION_ID || null;
        
        this.credentials = {
          shopDomain: envDomain,
          accessToken: envToken,
          apiVersion: process.env.SHOPIFY_API_VERSION || '2024-01',
          defaultLocationId: envPivotLocationId,
          pivotLocationId: envPivotLocationId,
          hildaleLocationId: envHildaleLocationId,
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
  getCredentialsInfo(): { 
    configured: boolean; 
    shopDomain?: string; 
    hasLocationId: boolean;
    hasPivotLocationId: boolean;
    hasHildaleLocationId: boolean;
    pivotLocationId?: string;
    hildaleLocationId?: string;
  } {
    return {
      configured: this.isConfigured(),
      shopDomain: this.credentials?.shopDomain,
      hasLocationId: !!this.credentials?.defaultLocationId,
      hasPivotLocationId: !!this.credentials?.pivotLocationId,
      hasHildaleLocationId: !!this.credentials?.hildaleLocationId,
      pivotLocationId: this.credentials?.pivotLocationId || undefined,
      hildaleLocationId: this.credentials?.hildaleLocationId || undefined,
    };
  }

  /**
   * Get Pivot location ID (3PL, customer-facing inventory)
   */
  getPivotLocationId(): string | null {
    return this.credentials?.pivotLocationId || null;
  }

  /**
   * Get Hildale location ID (production warehouse, buffer stock)
   */
  getHildaleLocationId(): string | null {
    return this.credentials?.hildaleLocationId || null;
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

  // ============================================================================
  // MULTI-LOCATION METHODS
  // ============================================================================

  /**
   * Get inventory levels for both Hildale and Pivot locations for a given inventory item
   * Returns { hildaleQty: number | null, pivotQty: number | null }
   */
  async getMultiLocationInventoryLevels(inventoryItemId: string): Promise<{
    hildaleQty: number | null;
    pivotQty: number | null;
    errors: string[];
  }> {
    const result = {
      hildaleQty: null as number | null,
      pivotQty: null as number | null,
      errors: [] as string[],
    };

    if (!this.isConfigured()) {
      result.errors.push('Shopify not configured');
      return result;
    }

    const pivotLocationId = this.getPivotLocationId();
    const hildaleLocationId = this.getHildaleLocationId();

    // Fetch Pivot location inventory
    if (pivotLocationId) {
      try {
        result.pivotQty = await this.getInventoryLevel(inventoryItemId, pivotLocationId);
      } catch (error: any) {
        result.errors.push(`Pivot location error: ${error.message}`);
      }
    } else {
      result.errors.push('Pivot location ID not configured');
    }

    // Fetch Hildale location inventory
    if (hildaleLocationId) {
      try {
        result.hildaleQty = await this.getInventoryLevel(inventoryItemId, hildaleLocationId);
      } catch (error: any) {
        result.errors.push(`Hildale location error: ${error.message}`);
      }
    }
    // Note: Hildale location is optional - don't add an error if missing

    return result;
  }

  /**
   * Pull inventory from Shopify for a single item and update app's hildaleQty/pivotQty
   * This is a PULL operation (Shopify → App)
   * 
   * @param item - The item to sync
   * @returns Updated quantities and any errors
   */
  async pullItemInventoryFromShopify(item: Item): Promise<{
    success: boolean;
    sku: string;
    previousHildaleQty: number;
    previousPivotQty: number;
    newHildaleQty: number | null;
    newPivotQty: number | null;
    errors: string[];
  }> {
    const result = {
      success: false,
      sku: item.sku || 'unknown',
      previousHildaleQty: item.hildaleQty ?? 0,
      previousPivotQty: item.pivotQty ?? 0,
      newHildaleQty: null as number | null,
      newPivotQty: null as number | null,
      errors: [] as string[],
    };

    if (!item.shopifyVariantId) {
      result.errors.push('No Shopify variant ID configured');
      return result;
    }

    // Get or fetch inventory item ID
    let inventoryItemId = item.shopifyInventoryItemId;
    if (!inventoryItemId) {
      inventoryItemId = await this.getInventoryItemId(item.shopifyVariantId);
      if (!inventoryItemId) {
        result.errors.push('Could not get inventory item ID from Shopify');
        return result;
      }
      
      // Cache the inventory item ID for future use
      try {
        await storage.updateItem(item.id, { shopifyInventoryItemId: inventoryItemId });
      } catch (e) {
        // Non-critical, continue
      }
    }

    // Get inventory levels from both locations
    const levels = await this.getMultiLocationInventoryLevels(inventoryItemId);
    result.errors.push(...levels.errors);

    // Update item with new quantities (only if we got valid data)
    const updates: { pivotQty?: number; hildaleQty?: number } = {};
    let hasUpdates = false;

    if (levels.pivotQty !== null) {
      result.newPivotQty = levels.pivotQty;
      updates.pivotQty = levels.pivotQty;
      hasUpdates = true;
    }

    if (levels.hildaleQty !== null) {
      result.newHildaleQty = levels.hildaleQty;
      updates.hildaleQty = levels.hildaleQty;
      hasUpdates = true;
    }

    if (hasUpdates) {
      try {
        await storage.updateItem(item.id, updates as any);
        result.success = true;
        console.log(
          `[ShopifyInventorySync] Pulled inventory for ${item.sku}: ` +
          `Hildale: ${result.previousHildaleQty} → ${result.newHildaleQty ?? 'unchanged'}, ` +
          `Pivot: ${result.previousPivotQty} → ${result.newPivotQty ?? 'unchanged'}`
        );
      } catch (error: any) {
        result.errors.push(`Failed to update item: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Push inventory to a specific Shopify location
   * This is a PUSH operation (App → Shopify)
   * 
   * @param item - The item to sync
   * @param location - 'PIVOT' or 'HILDALE'
   * @param quantity - The quantity to set
   * @param safetyBuffer - Safety buffer to subtract (only applies to Pivot)
   */
  async pushInventoryToLocation(
    item: Item,
    location: 'PIVOT' | 'HILDALE',
    quantity: number,
    safetyBuffer: number = 0
  ): Promise<{
    success: boolean;
    sku: string;
    location: string;
    previousLevel: number | null;
    newLevel: number;
    error?: string;
  }> {
    const result = {
      success: false,
      sku: item.sku || 'unknown',
      location,
      previousLevel: null as number | null,
      newLevel: quantity,
      error: undefined as string | undefined,
    };

    if (!item.shopifyVariantId) {
      result.error = 'No Shopify variant ID configured';
      return result;
    }

    const locationId = location === 'PIVOT' 
      ? this.getPivotLocationId() 
      : this.getHildaleLocationId();

    if (!locationId) {
      result.error = `${location} location ID not configured`;
      return result;
    }

    // Get or fetch inventory item ID
    let inventoryItemId = item.shopifyInventoryItemId;
    if (!inventoryItemId) {
      inventoryItemId = await this.getInventoryItemId(item.shopifyVariantId);
      if (!inventoryItemId) {
        result.error = 'Could not get inventory item ID from Shopify';
        return result;
      }
      
      try {
        await storage.updateItem(item.id, { shopifyInventoryItemId: inventoryItemId });
      } catch (e) {
        // Non-critical
      }
    }

    // Get current level for logging
    result.previousLevel = await this.getInventoryLevel(inventoryItemId, locationId);

    // Apply safety buffer only to Pivot (sellable inventory)
    const adjustedQuantity = location === 'PIVOT' 
      ? Math.max(0, quantity - safetyBuffer)
      : Math.max(0, quantity);
    result.newLevel = adjustedQuantity;

    // Set the inventory level
    const setResult = await this.setInventoryLevel(inventoryItemId, locationId, adjustedQuantity);
    
    if (setResult.success) {
      result.success = true;
      console.log(
        `[ShopifyInventorySync] Pushed to ${location} for ${item.sku}: ` +
        `${result.previousLevel ?? 'unknown'} → ${adjustedQuantity}` +
        (location === 'PIVOT' && safetyBuffer > 0 ? ` (buffer: ${safetyBuffer})` : '')
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
  }

  /**
   * Pull inventory from Shopify for all items with Shopify mapping
   * Updates hildaleQty and pivotQty for each item
   */
  async pullAllInventoryFromShopify(userId: string): Promise<{
    totalItems: number;
    updated: number;
    skipped: number;
    failed: number;
    missingPivotId: boolean;
    missingHildaleId: boolean;
    results: Array<{
      sku: string;
      success: boolean;
      hildaleQty: number | null;
      pivotQty: number | null;
      errors: string[];
    }>;
  }> {
    const result = {
      totalItems: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      missingPivotId: false,
      missingHildaleId: false,
      results: [] as Array<{
        sku: string;
        success: boolean;
        hildaleQty: number | null;
        pivotQty: number | null;
        errors: string[];
      }>,
    };

    // Initialize if needed
    if (!this.isConfigured() || this.userId !== userId) {
      const initialized = await this.initialize(userId);
      if (!initialized) {
        console.log('[ShopifyInventorySync] Not configured, skipping pull');
        return result;
      }
    }

    // Check location IDs
    result.missingPivotId = !this.getPivotLocationId();
    result.missingHildaleId = !this.getHildaleLocationId();

    if (result.missingPivotId) {
      console.log('[ShopifyInventorySync] Warning: Pivot location ID not configured');
    }
    if (result.missingHildaleId) {
      console.log('[ShopifyInventorySync] Warning: Hildale location ID not configured (Hildale sync will be skipped)');
    }

    const items = await storage.getAllItems();
    const shopifyItems = items.filter((item: Item) => item.shopifyVariantId);
    result.totalItems = shopifyItems.length;

    console.log(`[ShopifyInventorySync] Starting multi-location pull for ${shopifyItems.length} items`);

    for (const item of shopifyItems) {
      const pullResult = await this.pullItemInventoryFromShopify(item);
      
      result.results.push({
        sku: pullResult.sku,
        success: pullResult.success,
        hildaleQty: pullResult.newHildaleQty,
        pivotQty: pullResult.newPivotQty,
        errors: pullResult.errors,
      });

      if (pullResult.success) {
        result.updated++;
      } else if (pullResult.errors.some(e => e.includes('No Shopify'))) {
        result.skipped++;
      } else {
        result.failed++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Log summary
    await logService.logSystemEvent({
      type: 'SHOPIFY_SYNC_INFO',
      entityType: 'INTEGRATION',
      severity: 'INFO',
      code: 'MULTI_LOCATION_PULL',
      message: `Shopify sync complete. Updated ${result.updated} products. ` +
        `Missing IDs: ${[result.missingPivotId ? 'Pivot' : '', result.missingHildaleId ? 'Hildale' : ''].filter(Boolean).join(', ') || 'none'}`,
      details: {
        totalItems: result.totalItems,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
      },
    });

    console.log(
      `[ShopifyInventorySync] Multi-location pull complete: ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed`
    );

    return result;
  }

  /**
   * Push inventory changes after PO receipt (increases Hildale location only)
   * Only runs if two-way sync is enabled
   */
  async pushPOReceiptToShopify(
    item: Item, 
    receivedQty: number, 
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Check if two-way sync is enabled
    const settings = await storage.getAiAgentSettingsByUserId(userId);
    if (!settings?.shopifyTwoWaySync) {
      return { success: true }; // Silent skip when disabled
    }

    if (!this.getHildaleLocationId()) {
      console.log(`[ShopifyInventorySync] PO receipt: Hildale location not configured, skipping Shopify push`);
      return { success: true };
    }

    // Initialize if needed
    if (!this.isConfigured() || this.userId !== userId) {
      const initialized = await this.initialize(userId);
      if (!initialized) {
        return { success: false, error: 'Shopify not configured' };
      }
    }

    // Push the new Hildale quantity (no safety buffer for Hildale)
    const newHildaleQty = (item.hildaleQty ?? 0) + receivedQty;
    const result = await this.pushInventoryToLocation(item, 'HILDALE', newHildaleQty, 0);

    if (result.success) {
      await logService.logSystemEvent({
        type: 'SHOPIFY_SYNC_INFO',
        entityType: 'PRODUCT',
        entityId: item.id,
        severity: 'INFO',
        code: 'PO_RECEIPT_PUSH',
        message: `Pushed PO receipt to Shopify Hildale: ${item.sku} +${receivedQty} (new total: ${newHildaleQty})`,
      });
    }

    return { success: result.success, error: result.error };
  }

  /**
   * Push inventory changes after transfer from Hildale to Pivot
   * Decreases Hildale, increases Pivot
   * Only runs if two-way sync is enabled
   */
  async pushTransferToShopify(
    item: Item,
    transferQty: number,
    userId: string
  ): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check if two-way sync is enabled
    const settings = await storage.getAiAgentSettingsByUserId(userId);
    if (!settings?.shopifyTwoWaySync) {
      return { success: true, errors: [] }; // Silent skip when disabled
    }

    const safetyBuffer = settings.shopifySafetyBuffer || 0;

    // Initialize if needed
    if (!this.isConfigured() || this.userId !== userId) {
      const initialized = await this.initialize(userId);
      if (!initialized) {
        return { success: false, errors: ['Shopify not configured'] };
      }
    }

    let hildaleSuccess = true;
    let pivotSuccess = true;

    // Push to Hildale (decrease)
    if (this.getHildaleLocationId()) {
      const newHildaleQty = Math.max(0, (item.hildaleQty ?? 0) - transferQty);
      const hildaleResult = await this.pushInventoryToLocation(item, 'HILDALE', newHildaleQty, 0);
      if (!hildaleResult.success) {
        hildaleSuccess = false;
        errors.push(`Hildale: ${hildaleResult.error}`);
      }
    }

    // Push to Pivot (increase)
    if (this.getPivotLocationId()) {
      const newPivotQty = (item.pivotQty ?? 0) + transferQty;
      const pivotResult = await this.pushInventoryToLocation(item, 'PIVOT', newPivotQty, safetyBuffer);
      if (!pivotResult.success) {
        pivotSuccess = false;
        errors.push(`Pivot: ${pivotResult.error}`);
      }
    } else {
      errors.push('Pivot location ID not configured');
      pivotSuccess = false;
    }

    const success = hildaleSuccess && pivotSuccess;

    if (success) {
      await logService.logSystemEvent({
        type: 'SHOPIFY_SYNC_INFO',
        entityType: 'PRODUCT',
        entityId: item.id,
        severity: 'INFO',
        code: 'TRANSFER_PUSH',
        message: `Pushed transfer to Shopify: ${item.sku} moved ${transferQty} from Hildale to Pivot`,
      });
    }

    return { success, errors };
  }

  /**
   * Push manual inventory adjustment to Shopify
   * Routes to the correct location based on which quantity was changed
   */
  async pushManualAdjustmentToShopify(
    item: Item,
    location: 'PIVOT' | 'HILDALE',
    newQuantity: number,
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Check if two-way sync is enabled
    const settings = await storage.getAiAgentSettingsByUserId(userId);
    if (!settings?.shopifyTwoWaySync) {
      return { success: true }; // Silent skip when disabled
    }

    // Initialize if needed
    if (!this.isConfigured() || this.userId !== userId) {
      const initialized = await this.initialize(userId);
      if (!initialized) {
        return { success: false, error: 'Shopify not configured' };
      }
    }

    // Check if the location is configured
    const locationId = location === 'PIVOT' ? this.getPivotLocationId() : this.getHildaleLocationId();
    if (!locationId) {
      console.log(`[ShopifyInventorySync] Manual adjustment: ${location} location not configured, skipping`);
      return { success: true };
    }

    const safetyBuffer = location === 'PIVOT' ? (settings.shopifySafetyBuffer || 0) : 0;
    const result = await this.pushInventoryToLocation(item, location, newQuantity, safetyBuffer);

    if (result.success) {
      await logService.logSystemEvent({
        type: 'SHOPIFY_SYNC_INFO',
        entityType: 'PRODUCT',
        entityId: item.id,
        severity: 'INFO',
        code: 'MANUAL_ADJUSTMENT_PUSH',
        message: `Pushed manual adjustment to Shopify ${location}: ${item.sku} → ${newQuantity}`,
      });
    }

    return { success: result.success, error: result.error };
  }
}

// Singleton instance - must call initialize() before use
export const shopifyInventorySync = new ShopifyInventorySyncService();
