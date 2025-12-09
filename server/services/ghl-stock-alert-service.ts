/**
 * GHL Stock Alert Service
 * 
 * Creates "Needs Attention" opportunities in GoHighLevel when sales orders
 * result in shortages or backorders. This alerts production to manufacture
 * additional units immediately.
 * 
 * CONFIGURATION:
 * Pipeline and stage IDs can be configured via environment variables:
 * - GHL_NEEDS_ATTENTION_PIPELINE_ID: Pipeline ID for shortage alerts
 * - GHL_NEEDS_ATTENTION_STAGE_ID: Stage ID for "Needs Attention" stage
 * 
 * Or via user settings (future enhancement).
 */

import type { IStorage } from "../storage";
import { GoHighLevelClient } from "./gohighlevel-client";

export interface ShortageAlertParams {
  sku: string;
  itemId: string;
  itemName: string;
  requestedQty: number;
  allocatedQty: number;
  shortageQty: number;
  salesOrderId: string;
  salesOrderNumber?: string;
  channel?: string;
  contactId?: string; // GHL contact ID if available
}

export interface ShortageAlertResult {
  success: boolean;
  opportunityId?: string;
  opportunityUrl?: string;
  error?: string;
  action?: 'created' | 'updated' | 'skipped';
}

export class GHLStockAlertService {
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Create or update a GHL "Needs Attention" opportunity when a shortage/backorder is detected.
   * 
   * @param params - Shortage details including SKU, quantities, and order info
   * @param userId - User ID to look up GHL settings
   */
  async createShortageAlert(
    params: ShortageAlertParams,
    userId: string
  ): Promise<ShortageAlertResult> {
    try {
      // Get user settings for GHL configuration
      const settings = await this.storage.getSettings(userId);
      if (!settings) {
        console.warn('[GHLStockAlert] No settings found for user:', userId);
        return {
          success: false,
          error: 'No settings found for user',
          action: 'skipped',
        };
      }

      // Check if GHL is configured
      if (!settings.gohighlevelApiKey || !settings.gohighlevelLocationId) {
        console.warn('[GHLStockAlert] GHL not configured, skipping alert for SKU:', params.sku);
        return {
          success: false,
          error: 'GoHighLevel not configured',
          action: 'skipped',
        };
      }

      // Get pipeline and stage IDs from environment variables or defaults
      // These should be configured per-deployment
      const pipelineId = process.env.GHL_NEEDS_ATTENTION_PIPELINE_ID;
      const stageId = process.env.GHL_NEEDS_ATTENTION_STAGE_ID;

      if (!pipelineId || !stageId) {
        console.warn('[GHLStockAlert] GHL_NEEDS_ATTENTION_PIPELINE_ID or GHL_NEEDS_ATTENTION_STAGE_ID not configured');
        return {
          success: false,
          error: 'GHL shortage alert pipeline/stage not configured. Set GHL_NEEDS_ATTENTION_PIPELINE_ID and GHL_NEEDS_ATTENTION_STAGE_ID environment variables.',
          action: 'skipped',
        };
      }

      // Initialize GHL client
      // Constructor: (baseUrl, apiKey, locationId)
      const baseUrl = settings.gohighlevelBaseUrl || 'https://services.leadconnectorhq.com';
      const ghlClient = new GoHighLevelClient(
        baseUrl,
        settings.gohighlevelApiKey!,
        settings.gohighlevelLocationId!
      );

      // Build opportunity name - unique per SKU to allow deduplication
      const opportunityName = `SHORTAGE: ${params.sku} - Needs ${params.shortageQty} units`;
      
      // Build detailed notes
      const notes = this.buildShortageNotes(params);

      // Unique identifier for deduplication - one alert per SKU at a time
      const uniqueIdentifier = `shortage-${params.sku}`;

      // If no contactId provided, we need to find or create a system contact
      let contactId = params.contactId;
      if (!contactId) {
        // Try to get a default system contact for inventory alerts
        // For now, we'll log this and skip if no contact is available
        console.warn('[GHLStockAlert] No contactId provided and GHL V2 requires a contact. Skipping alert.');
        return {
          success: false,
          error: 'No contactId available for GHL opportunity (V2 API requires contactId)',
          action: 'skipped',
        };
      }

      // Create or update the opportunity
      const result = await ghlClient.createOrUpdateOpportunity(
        pipelineId,
        stageId,
        opportunityName,
        0, // No monetary value for shortage alerts
        notes,
        {
          sku: params.sku,
          shortageQty: params.shortageQty,
          allocatedQty: params.allocatedQty,
          requestedQty: params.requestedQty,
          salesOrderId: params.salesOrderId,
          channel: params.channel,
          alertType: 'STOCK_SHORTAGE',
        },
        contactId,
        uniqueIdentifier
      );

      if (result.success) {
        console.log(`[GHLStockAlert] Successfully ${result.action} shortage alert for SKU ${params.sku}: ${result.opportunityId}`);
      } else {
        console.error(`[GHLStockAlert] Failed to create shortage alert for SKU ${params.sku}:`, result.error);
      }

      return {
        success: result.success,
        opportunityId: result.opportunityId,
        opportunityUrl: result.opportunityUrl,
        error: result.error,
        action: result.action,
      };
    } catch (error: any) {
      console.error('[GHLStockAlert] Error creating shortage alert:', error);
      return {
        success: false,
        error: error.message || 'Failed to create shortage alert',
      };
    }
  }

  /**
   * Create shortage alerts for multiple SKUs in a single order.
   * 
   * @param shortages - Array of shortage params
   * @param userId - User ID for settings lookup
   */
  async createMultipleShortageAlerts(
    shortages: ShortageAlertParams[],
    userId: string
  ): Promise<ShortageAlertResult[]> {
    const results: ShortageAlertResult[] = [];
    
    for (const shortage of shortages) {
      const result = await this.createShortageAlert(shortage, userId);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Build detailed notes for the shortage opportunity.
   */
  private buildShortageNotes(params: ShortageAlertParams): string {
    const lines = [
      `🚨 STOCK SHORTAGE ALERT`,
      ``,
      `SKU: ${params.sku}`,
      `Product: ${params.itemName}`,
      ``,
      `Order Details:`,
      `- Customer ordered: ${params.requestedQty} units`,
      `- We could only allocate: ${params.allocatedQty} units`,
      `- SHORT BY: ${params.shortageQty} units`,
      ``,
      `ACTION REQUIRED:`,
      `Produce at least ${params.shortageQty} units of ${params.sku} immediately.`,
      `This order has ${params.shortageQty} unit(s) on BACKORDER.`,
      ``,
      `Source Order: ${params.salesOrderNumber || params.salesOrderId}`,
      params.channel ? `Channel: ${params.channel}` : '',
      ``,
      `Generated by Inventory System`,
    ];

    return lines.filter(Boolean).join('\n');
  }
}

/**
 * Helper function to detect shortages and trigger alerts from sales order processing.
 * Call this after allocating inventory when creating a sales order.
 */
export async function triggerShortageAlertsForOrder(
  storage: IStorage,
  salesOrderId: string,
  salesOrderNumber: string | undefined,
  lineItems: Array<{
    itemId: string;
    sku: string;
    itemName: string;
    requestedQty: number;
    allocatedQty: number;
    backorderQty: number;
    contactId?: string;
  }>,
  channel: string | undefined,
  userId: string
): Promise<ShortageAlertResult[]> {
  const alertService = new GHLStockAlertService(storage);
  
  // Filter to only lines with shortages (backorderQty > 0)
  const shortages = lineItems
    .filter(line => line.backorderQty > 0)
    .map(line => ({
      sku: line.sku,
      itemId: line.itemId,
      itemName: line.itemName,
      requestedQty: line.requestedQty,
      allocatedQty: line.allocatedQty,
      shortageQty: line.backorderQty,
      salesOrderId,
      salesOrderNumber,
      channel,
      contactId: line.contactId,
    }));

  if (shortages.length === 0) {
    return [];
  }

  console.log(`[GHLStockAlert] Detected ${shortages.length} SKU(s) with shortages for order ${salesOrderNumber || salesOrderId}`);
  
  return alertService.createMultipleShortageAlerts(shortages, userId);
}
