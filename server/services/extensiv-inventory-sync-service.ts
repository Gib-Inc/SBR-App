/**
 * Extensiv Inventory Sync Service
 * Handles inventory synchronization FROM Extensiv/Pivot warehouse to this app
 * 
 * System of Record: Extensiv is the source of truth for Pivot warehouse quantities
 * - Extensiv quantities are PULLED into this app (read from Extensiv)
 * - Updates pivotQty and extensivOnHandSnapshot fields
 * - Uses InventoryMovement for centralized inventory tracking
 * 
 * Credentials Source: IntegrationConfig table (with env var fallback)
 */

import { storage } from "../storage";
import { logService } from "./log-service";
import { ExtensivClient, ExtensivItem } from "./extensiv-client";
import { InventoryMovement } from "./inventory-movement";
import type { Item, IntegrationConfig } from "@shared/schema";

export interface ExtensivSyncResult {
  success: boolean;
  itemId?: string;
  sku: string;
  extensivSku?: string;
  previousQty: number;
  newQty: number;
  variance: number;
  error?: string;
}

export interface ExtensivBulkSyncResult {
  totalExtensivItems: number;
  synced: number;
  skipped: number;
  unmatchedSkus: string[];
  failed: number;
  results: ExtensivSyncResult[];
  warehouseId: string;
}

interface ExtensivCredentials {
  apiKey: string;
  baseUrl: string;
  pivotWarehouseId: string;
  pushOrders: boolean;
}

export class ExtensivInventorySyncService {
  private client: ExtensivClient | null = null;
  private credentials: ExtensivCredentials | null = null;
  private userId: string | null = null;

  /**
   * Initialize the service with user-specific credentials from IntegrationConfig
   * Falls back to environment variables if no config is found
   */
  async initialize(userId: string): Promise<boolean> {
    this.userId = userId;
    
    try {
      const config = await storage.getIntegrationConfig(userId, 'EXTENSIV');
      
      if (config?.isEnabled && config.apiKey) {
        const configData = config.config as Record<string, any> || {};
        this.credentials = {
          apiKey: config.apiKey,
          baseUrl: configData.baseUrl || 'https://api.skubana.com/v1',
          pivotWarehouseId: configData.pivotWarehouseId || '1',
          pushOrders: configData.pushOrders === true,
        };
        this.client = new ExtensivClient(
          this.credentials.apiKey, 
          this.credentials.baseUrl,
          this.credentials.pivotWarehouseId
        );
        console.log(`[ExtensivInventorySync] Initialized with IntegrationConfig for user ${userId}`);
        return this.isConfigured();
      }
      
      const envKey = process.env.EXTENSIV_API_KEY;
      
      if (envKey) {
        this.credentials = {
          apiKey: envKey,
          baseUrl: process.env.EXTENSIV_BASE_URL || 'https://api.skubana.com/v1',
          pivotWarehouseId: process.env.EXTENSIV_WAREHOUSE_ID || '1',
          pushOrders: process.env.EXTENSIV_PUSH_ORDERS === 'true',
        };
        this.client = new ExtensivClient(
          this.credentials.apiKey,
          this.credentials.baseUrl,
          this.credentials.pivotWarehouseId
        );
        console.log(`[ExtensivInventorySync] Initialized with environment variables (fallback)`);
        return this.isConfigured();
      }
      
      console.log(`[ExtensivInventorySync] No Extensiv credentials found for user ${userId}`);
      return false;
    } catch (error: any) {
      console.error(`[ExtensivInventorySync] Error initializing:`, error.message);
      return false;
    }
  }

  isConfigured(): boolean {
    return !!(this.credentials?.apiKey && this.client);
  }

  getCredentialsInfo(): { 
    configured: boolean; 
    baseUrl?: string; 
    warehouseId?: string;
    pushOrdersEnabled: boolean;
  } {
    return {
      configured: this.isConfigured(),
      baseUrl: this.credentials?.baseUrl,
      warehouseId: this.credentials?.pivotWarehouseId,
      pushOrdersEnabled: this.credentials?.pushOrders || false,
    };
  }

  /**
   * Sync a single item from Extensiv by internal SKU or extensivSku mapping
   */
  async syncItem(item: Item): Promise<ExtensivSyncResult> {
    if (!this.client || !this.credentials || !this.userId) {
      return {
        success: false,
        sku: item.sku,
        previousQty: item.pivotQty ?? 0,
        newQty: item.pivotQty ?? 0,
        variance: 0,
        error: 'Service not initialized',
      };
    }

    try {
      const extensivItems = await this.client.getAllInventory(this.credentials.pivotWarehouseId);
      
      const skuToMatch = item.extensivSku || item.sku;
      const extensivItem = extensivItems.find(e => e.sku === skuToMatch);
      
      if (!extensivItem) {
        return {
          success: false,
          sku: item.sku,
          extensivSku: item.extensivSku || undefined,
          previousQty: item.pivotQty ?? 0,
          newQty: item.pivotQty ?? 0,
          variance: 0,
          error: `SKU ${skuToMatch} not found in Extensiv warehouse ${this.credentials.pivotWarehouseId}`,
        };
      }

      const previousQty = item.pivotQty ?? 0;
      const newQty = extensivItem.quantity;
      const variance = newQty - previousQty;

      if (variance === 0) {
        return {
          success: true,
          itemId: item.id,
          sku: item.sku,
          extensivSku: extensivItem.sku,
          previousQty,
          newQty,
          variance: 0,
        };
      }

      const inventoryMovement = new InventoryMovement(storage);
      const user = await storage.getUser(this.userId);
      
      await storage.updateItem(item.id, {
        extensivOnHandSnapshot: newQty,
        extensivLastSyncAt: new Date(),
      });
      
      const result = await inventoryMovement.apply({
        eventType: "EXTENSIV_SYNC",
        itemId: item.id,
        quantity: newQty,
        location: "PIVOT",
        source: "SYSTEM",
        userId: this.userId,
        userName: user?.email,
        notes: `Extensiv sync: ${previousQty} → ${newQty} (variance: ${variance > 0 ? '+' : ''}${variance})`,
      });

      if (!result.success) {
        return {
          success: false,
          itemId: item.id,
          sku: item.sku,
          extensivSku: extensivItem.sku,
          previousQty,
          newQty,
          variance,
          error: result.error,
        };
      }

      return {
        success: true,
        itemId: item.id,
        sku: item.sku,
        extensivSku: extensivItem.sku,
        previousQty,
        newQty,
        variance,
      };
    } catch (error: any) {
      return {
        success: false,
        sku: item.sku,
        previousQty: item.pivotQty ?? 0,
        newQty: item.pivotQty ?? 0,
        variance: 0,
        error: error.message,
      };
    }
  }

  /**
   * Bulk sync all inventory from Extensiv
   * Updates pivotQty for all items that have extensivSku mappings or matching internal SKUs
   */
  async bulkSync(): Promise<ExtensivBulkSyncResult> {
    if (!this.client || !this.credentials || !this.userId) {
      return {
        totalExtensivItems: 0,
        synced: 0,
        skipped: 0,
        unmatchedSkus: [],
        failed: 0,
        results: [],
        warehouseId: this.credentials?.pivotWarehouseId || '1',
      };
    }

    const warehouseId = this.credentials.pivotWarehouseId;
    console.log(`[ExtensivInventorySync] Starting bulk sync from warehouse ${warehouseId}`);

    try {
      const extensivItems = await this.client.getAllInventory(warehouseId);
      console.log(`[ExtensivInventorySync] Fetched ${extensivItems.length} items from Extensiv`);

      const results: ExtensivSyncResult[] = [];
      const unmatchedSkus: string[] = [];
      let synced = 0;
      let skipped = 0;
      let failed = 0;

      const inventoryMovement = new InventoryMovement(storage);
      const user = await storage.getUser(this.userId);

      for (const extensivItem of extensivItems) {
        try {
          let item = await storage.getItemBySku(extensivItem.sku);
          
          if (!item) {
            item = await storage.findProductByExtensivSku(extensivItem.sku);
            
            if (item) {
              console.log(`[ExtensivInventorySync] Matched SKU ${extensivItem.sku} to product ${item.sku} via extensivSku mapping`);
            }
          }
          
          if (!item) {
            unmatchedSkus.push(extensivItem.sku);
            
            try {
              await logService.logSkuMismatch({
                source: 'EXTENSIV',
                externalSku: extensivItem.sku,
                orderId: 'INVENTORY_SYNC',
                lineItemData: { 
                  sku: extensivItem.sku, 
                  quantity: extensivItem.quantity,
                  tip: 'Configure via Products > SKU Mapping Wizard'
                }
              });
            } catch (logErr) {
              console.warn('[ExtensivInventorySync] Failed to log SKU mismatch:', logErr);
            }
            
            continue;
          }

          const previousQty = item.pivotQty ?? 0;
          const newQty = extensivItem.quantity;
          const variance = newQty - previousQty;

          if (variance === 0) {
            skipped++;
            continue;
          }

          await storage.updateItem(item.id, {
            extensivOnHandSnapshot: newQty,
            extensivLastSyncAt: new Date(),
          });
          
          const result = await inventoryMovement.apply({
            eventType: "EXTENSIV_SYNC",
            itemId: item.id,
            quantity: newQty,
            location: "PIVOT",
            source: "SYSTEM",
            userId: this.userId,
            userName: user?.email,
            notes: `Extensiv sync: ${previousQty} → ${newQty}`,
          });

          if (result.success) {
            synced++;
            results.push({
              success: true,
              itemId: item.id,
              sku: item.sku,
              extensivSku: extensivItem.sku,
              previousQty,
              newQty,
              variance,
            });
          } else {
            failed++;
            results.push({
              success: false,
              itemId: item.id,
              sku: item.sku,
              extensivSku: extensivItem.sku,
              previousQty,
              newQty,
              variance,
              error: result.error,
            });
          }
        } catch (error: any) {
          failed++;
          results.push({
            success: false,
            sku: extensivItem.sku,
            previousQty: 0,
            newQty: extensivItem.quantity,
            variance: extensivItem.quantity,
            error: error.message,
          });
          console.error(`[ExtensivInventorySync] Failed to sync ${extensivItem.sku}:`, error);
        }
      }

      console.log(`[ExtensivInventorySync] Bulk sync complete: ${synced} synced, ${skipped} skipped, ${unmatchedSkus.length} unmatched, ${failed} failed`);

      return {
        totalExtensivItems: extensivItems.length,
        synced,
        skipped,
        unmatchedSkus,
        failed,
        results,
        warehouseId,
      };
    } catch (error: any) {
      console.error(`[ExtensivInventorySync] Bulk sync failed:`, error);
      throw error;
    }
  }

  /**
   * Update integration config status after sync
   */
  async updateSyncStatus(success: boolean, message: string): Promise<void> {
    if (!this.userId) return;
    
    try {
      const config = await storage.getIntegrationConfig(this.userId, 'EXTENSIV');
      if (config) {
        await storage.updateIntegrationConfig(config.id, {
          lastSyncAt: new Date(),
          lastSyncStatus: success ? 'SUCCESS' : 'FAILED',
          lastSyncMessage: message,
        });
      }
    } catch (error: any) {
      console.error('[ExtensivInventorySync] Failed to update sync status:', error);
    }
  }

  /**
   * Get variance report between local pivotQty and Extensiv on-hand
   */
  async getVarianceReport(): Promise<{
    items: Array<{
      id: string;
      sku: string;
      name: string;
      localQty: number;
      extensivQty: number | null;
      variance: number | null;
      lastSyncAt: Date | null;
    }>;
    totalItems: number;
    itemsWithVariance: number;
  }> {
    const allItems = await storage.getAllItems();
    const itemsWithExtensiv = allItems.filter(item => 
      item.extensivOnHandSnapshot !== null || item.extensivSku
    );

    const reportItems = itemsWithExtensiv.map(item => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      localQty: item.pivotQty ?? 0,
      extensivQty: item.extensivOnHandSnapshot,
      variance: item.extensivOnHandSnapshot !== null 
        ? (item.pivotQty ?? 0) - item.extensivOnHandSnapshot 
        : null,
      lastSyncAt: item.extensivLastSyncAt,
    }));

    return {
      items: reportItems,
      totalItems: reportItems.length,
      itemsWithVariance: reportItems.filter(r => r.variance !== null && r.variance !== 0).length,
    };
  }
}

export const extensivInventorySyncService = new ExtensivInventorySyncService();
