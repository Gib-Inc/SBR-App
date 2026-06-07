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
        const baseUrl = configData.baseUrl || 'https://secure-wms.com';
        
        this.credentials = {
          apiKey: config.apiKey,
          baseUrl,
          pivotWarehouseId: '',
          pushOrders: configData.pushOrders === true,
        };
        
        // Use new OAuth2 credentials format if clientId is present
        // The apiKey field stores the clientSecret for backward compatibility
        const clientId = configData.clientId;
        const clientSecret = config.apiKey;
        const orgKey = configData.orgKey;
        
        if (clientId) {
          // New OAuth2 flow
          this.client = new ExtensivClient(
            { clientId, clientSecret, orgKey },
            baseUrl,
            this.credentials.pivotWarehouseId
          );
          console.log(`[ExtensivInventorySync] Initialized with OAuth2 credentials for user ${userId}`);
        } else {
          // Legacy mode: treat apiKey as bearer token
          this.client = new ExtensivClient(
            config.apiKey, 
            baseUrl,
            this.credentials.pivotWarehouseId
          );
          console.log(`[ExtensivInventorySync] Initialized with legacy API key for user ${userId}`);
        }
        return this.isConfigured();
      }
      
      const envKey = process.env.EXTENSIV_API_KEY;
      
      if (envKey) {
        this.credentials = {
          apiKey: envKey,
          baseUrl: process.env.EXTENSIV_BASE_URL || 'https://secure-wms.com',
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

  /**
   * Auto-detect customer ID from the API if not already resolved
   */
  private async ensureCustomerId(): Promise<string> {
    if (this.credentials?.pivotWarehouseId) {
      return this.credentials.pivotWarehouseId;
    }
    if (!this.client) {
      throw new Error('ExtensivInventorySync client not initialized');
    }
    const warehouses = await this.client.getWarehouses();
    if (!warehouses || warehouses.length === 0) {
      throw new Error('No customers/warehouses found in Extensiv account');
    }
    const customerId = warehouses[0].id;
    console.log(`[ExtensivInventorySync] Auto-detected customer ID: ${customerId} (${warehouses[0].name})`);
    if (this.credentials) {
      this.credentials.pivotWarehouseId = customerId;
    }
    return customerId;
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
      warehouseId: this.credentials?.pivotWarehouseId || 'auto-detect',
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
      const warehouseId = await this.ensureCustomerId();
      const extensivItems = await this.client.getAllInventory(warehouseId);
      
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
          error: `SKU ${skuToMatch} not found in Extensiv customer ${warehouseId}`,
        };
      }

      // pivotQty mirrors Extensiv's SELLABLE quantity (available); the snapshot
      // stores physical OnHand. This matches the standalone cron so both writers
      // agree on what each field means.
      const previousQty = item.pivotQty ?? 0;
      const newQty = extensivItem.available ?? extensivItem.quantity;
      const onHandSnapshot = extensivItem.onHand ?? extensivItem.quantity;
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
        extensivOnHandSnapshot: onHandSnapshot,
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
        warehouseId: 'unknown',
      };
    }

    const warehouseId = await this.ensureCustomerId();
    console.log(`[ExtensivInventorySync] Starting bulk sync from customer ${warehouseId}`);

    try {
      const extensivItems = await this.client.getAllInventory(warehouseId);
      console.log(`[ExtensivInventorySync] Fetched ${extensivItems.length} items from Extensiv`);

      // ── Sync-reconciliation guard (Phase 1): refuse a degenerate/empty/partial
      // payload that would silently zero sellable stock. ──
      try {
        const { assessExtensivPayload } = await import("./sync-guard");
        const allItems = await storage.getAllItems();
        const inStockItemCount = allItems.filter((i: any) => (i.pivotQty ?? 0) > 0).length;
        const lastGoodItemCount = allItems.filter((i: any) => i.extensivSku).length || allItems.length;
        const assessment = assessExtensivPayload(
          extensivItems.map((e: any) => ({ available: e.available ?? e.quantity })),
          { inStockItemCount, lastGoodItemCount },
        );
        if (!assessment.safe) {
          console.error(`[ExtensivInventorySync] 🛑 SYNC GUARD: ${assessment.reason}`);
          try {
            await storage.createDataReconciliationLog([{
              dataType: "sync:extensiv", entityKey: "Extensiv bulk inventory sync", action: "DISREGARDED",
              field: null, oldValue: null, newValue: null, reason: assessment.reason || "degraded payload", source: "extensiv-inventory-sync-service",
            }]);
            await storage.createSystemLog({
              type: "SYNC", severity: "ERROR", code: "EXTENSIV_GUARD_SKIP",
              message: assessment.reason || "Extensiv payload looked degraded — sync skipped to protect stock.",
              details: assessment as unknown as any,
            } as any);
          } catch (logErr) {
            console.warn("[ExtensivInventorySync] guard logging failed:", logErr);
          }
          return { totalExtensivItems: extensivItems.length, synced: 0, skipped: extensivItems.length, unmatchedSkus: [], failed: 0, results: [], warehouseId, guardSkipped: true, guardReason: assessment.reason } as any;
        }
      } catch (guardErr) {
        console.warn("[ExtensivInventorySync] guard check failed (continuing):", guardErr);
      }

      const results: ExtensivSyncResult[] = [];
      const unmatchedSkus: string[] = [];
      let synced = 0;
      let skipped = 0;
      let failed = 0;

      const inventoryMovement = new InventoryMovement(storage);
      const user = await storage.getUser(this.userId);

      for (const extensivItem of extensivItems) {
        try {
          // Match by the explicit extensivSku mapping first, then fall back to
          // house SKU — consistent with syncItem(), the cron script, and the
          // documented matching rule. (Avoids an Extensiv SKU colliding with a
          // different item's house SKU.)
          let item = await storage.findProductByExtensivSku(extensivItem.sku);

          if (item) {
            console.log(`[ExtensivInventorySync] Matched SKU ${extensivItem.sku} to product ${item.sku} via extensivSku mapping`);
          } else {
            item = await storage.getItemBySku(extensivItem.sku);
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

          // pivotQty mirrors Extensiv's SELLABLE quantity (available); the
          // snapshot stores physical OnHand — matching the standalone cron.
          const previousQty = item.pivotQty ?? 0;
          const newQty = extensivItem.available ?? extensivItem.quantity;
          const onHandSnapshot = extensivItem.onHand ?? extensivItem.quantity;
          const variance = newQty - previousQty;

          if (variance === 0) {
            await storage.updateItem(item.id, {
              extensivLastSyncAt: new Date(),
            });
            skipped++;
            continue;
          }

          await storage.updateItem(item.id, {
            extensivOnHandSnapshot: onHandSnapshot,
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
