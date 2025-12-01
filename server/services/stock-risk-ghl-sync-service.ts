import { GHL_CONFIG } from "../config/ghl-config";
import { ghlOpportunitiesService } from "./ghl-opportunities-service";
import { storage } from "../storage";
import type { Item } from "@shared/schema";

interface GHLSyncResult {
  success: boolean;
  opportunityId?: string;
  opportunityUrl?: string;
  error?: string;
  created?: boolean;
  updated?: boolean;
}

interface StockRiskData {
  itemId: string;
  sku: string;
  name: string;
  daysUntilStockout: number;
  currentStock: number;
  dailyVelocity: number;
  riskLevel: "ORDER_NOW" | "CRITICAL" | "WARNING" | "OK";
}

export class StockRiskGHLSyncService {
  private userId: string | null = null;

  async initialize(userId: string): Promise<boolean> {
    this.userId = userId;
    return await ghlOpportunitiesService.initialize(userId);
  }

  async syncStockRiskToGHL(riskData: StockRiskData): Promise<GHLSyncResult> {
    console.log(`[Stock Risk GHL] Starting sync for item: ${riskData.sku} (${riskData.daysUntilStockout} days)`);

    if (!this.userId) {
      return { success: false, error: "Service not initialized with userId" };
    }

    if (!ghlOpportunitiesService.isConfigured()) {
      console.log("[Stock Risk GHL] GHL not configured - skipping sync");
      return { success: false, error: "GHL integration not configured" };
    }

    try {
      const item = await storage.getItem(riskData.itemId);
      if (!item) {
        return { success: false, error: "Item not found" };
      }

      const stageId = ghlOpportunitiesService.getStageForStockRisk(riskData.daysUntilStockout);
      if (!stageId) {
        console.log(`[Stock Risk GHL] Days until stockout (${riskData.daysUntilStockout}) not in risk range - skipping`);
        return { success: false, error: "Stock not in risk range" };
      }

      const name = ghlOpportunitiesService.buildStockRiskName(item, Math.floor(riskData.daysUntilStockout));
      const oppStatus = riskData.daysUntilStockout <= 0 ? "open" : "open";

      const result = await ghlOpportunitiesService.upsertOpportunity({
        externalKey: `stock-risk-${riskData.itemId}`,
        name,
        pipelineStageId: stageId,
        status: oppStatus,
        amount: 0,
        customFields: {
          item_id: item.id,
          sku: item.sku,
          product_name: item.name,
          days_until_stockout: Math.floor(riskData.daysUntilStockout),
          current_stock: riskData.currentStock,
          daily_velocity: riskData.dailyVelocity.toFixed(2),
          risk_level: riskData.riskLevel,
        },
        existingOpportunityId: item.ghlStockRiskOpportunityId,
      });

      if (result.success && result.opportunityId && result.opportunityId !== item.ghlStockRiskOpportunityId) {
        await storage.updateItem(riskData.itemId, {
          ghlStockRiskOpportunityId: result.opportunityId,
          ghlStockRiskLastSyncAt: new Date(),
        });
        console.log(`[Stock Risk GHL] Updated item with GHL opportunity ID: ${result.opportunityId}`);
      } else if (result.success) {
        await storage.updateItem(riskData.itemId, {
          ghlStockRiskLastSyncAt: new Date(),
        });
      }

      return result;
    } catch (error: any) {
      console.error(`[Stock Risk GHL] Error syncing stock risk ${riskData.sku}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async syncBatchStockRisks(riskItems: StockRiskData[]): Promise<{ synced: number; failed: number; errors: string[] }> {
    console.log(`[Stock Risk GHL] Starting batch sync for ${riskItems.length} items`);

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const item of riskItems) {
      const result = await this.syncStockRiskToGHL(item);
      if (result.success) {
        synced++;
      } else {
        failed++;
        if (result.error) {
          errors.push(`${item.sku}: ${result.error}`);
        }
      }
    }

    console.log(`[Stock Risk GHL] Batch sync complete: ${synced} synced, ${failed} failed`);
    return { synced, failed, errors };
  }

  async closeStockRiskOpportunity(itemId: string): Promise<GHLSyncResult> {
    console.log(`[Stock Risk GHL] Closing stock risk opportunity for item: ${itemId}`);

    if (!this.userId) {
      return { success: false, error: "Service not initialized with userId" };
    }

    if (!ghlOpportunitiesService.isConfigured()) {
      return { success: false, error: "GHL integration not configured" };
    }

    try {
      const item = await storage.getItem(itemId);
      if (!item || !item.ghlStockRiskOpportunityId) {
        return { success: false, error: "Item not found or no GHL opportunity linked" };
      }

      const result = await ghlOpportunitiesService.upsertOpportunity({
        externalKey: `stock-risk-${itemId}`,
        name: `Stock risk resolved – ${item.name || item.sku}`,
        pipelineStageId: GHL_CONFIG.stages.STOCK_ORDER_NOW,
        status: "won",
        existingOpportunityId: item.ghlStockRiskOpportunityId,
      });

      return result;
    } catch (error: any) {
      console.error(`[Stock Risk GHL] Error closing opportunity:`, error.message);
      return { success: false, error: error.message };
    }
  }

  getRiskLevelFromDays(daysUntilStockout: number): StockRiskData["riskLevel"] {
    if (daysUntilStockout <= 0) return "ORDER_NOW";
    if (daysUntilStockout <= 14) return "CRITICAL";
    if (daysUntilStockout <= 30) return "WARNING";
    return "OK";
  }
}

export const stockRiskGHLSyncService = new StockRiskGHLSyncService();
