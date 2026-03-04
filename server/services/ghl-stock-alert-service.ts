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
      // Get GHL configuration from integration_configs table (where Data Sources UI saves it)
      const ghlConfig = await this.storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
      
      if (!ghlConfig) {
        console.warn('[GHLStockAlert] No GHL integration config found for user:', userId);
        return {
          success: false,
          error: 'GoHighLevel not configured in Data Sources',
          action: 'skipped',
        };
      }

      const ghlApiKey = ghlConfig.apiKey;
      const ghlLocationId = (ghlConfig.config as any)?.locationId;

      // Check if GHL is configured
      if (!ghlApiKey || !ghlLocationId) {
        console.warn('[GHLStockAlert] GHL API key or Location ID missing, skipping alert for SKU:', params.sku);
        return {
          success: false,
          error: 'GoHighLevel API key or Location ID not configured',
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
      const baseUrl = (ghlConfig.config as any)?.baseUrl || 'https://services.leadconnectorhq.com';
      const ghlClient = new GoHighLevelClient(
        baseUrl,
        ghlApiKey,
        ghlLocationId
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
 * Create a GHL "Needs Attention" opportunity when an order requires Hildale fulfillment
 * (Pivot stock is insufficient so order will ship from Hildale warehouse).
 */
export async function triggerHildaleFulfillmentAlert(
  storage: IStorage,
  salesOrderId: string,
  salesOrderNumber: string,
  lineItemSummary: string,
  fulfillmentSource: string,
  userId: string
): Promise<{ success: boolean; opportunityId?: string; error?: string }> {
  try {
    // Import GHL Opportunities Service for system contact support
    const { GHLOpportunitiesService } = await import('./ghl-opportunities-service');
    const { GHL_CONFIG } = await import('../config/ghl-config');
    
    const ghlService = new GHLOpportunitiesService();
    const initialized = await ghlService.initialize(userId);
    
    if (!initialized) {
      console.log('[GHLFulfillmentAlert] GHL not configured, skipping alert');
      return { success: false, error: 'GHL not configured' };
    }
    
    // Get or create system contact
    const systemContactId = await ghlService.getOrCreateSystemContact();
    if (!systemContactId) {
      console.log('[GHLFulfillmentAlert] Could not get system contact, skipping alert');
      return { success: false, error: 'No system contact available' };
    }
    
    // Create opportunity name
    const alertType = fulfillmentSource === 'HILDALE' ? 'HILDALE FULFILLMENT' : 'BACKORDERED';
    const opportunityName = `${alertType}: Order ${salesOrderNumber}`;
    
    // Build notes
    const notes = [
      `⚠️ ${alertType} ALERT`,
      ``,
      `Order: ${salesOrderNumber}`,
      `Items: ${lineItemSummary}`,
      ``,
      fulfillmentSource === 'HILDALE' 
        ? `Pivot warehouse does not have sufficient stock. This order will need to ship from Hildale.`
        : `Neither Pivot nor Hildale has sufficient stock. This order is BACKORDERED.`,
      ``,
      `ACTION REQUIRED:`,
      fulfillmentSource === 'HILDALE'
        ? `Prepare order for shipment from Hildale warehouse.`
        : `Produce additional inventory to fulfill this order.`,
      ``,
      `Generated by Inventory System`,
    ].join('\n');
    
    // Use external key for deduplication - one alert per order
    const externalKey = `fulfillment-alert-${salesOrderId}`;
    
    const result = await ghlService.upsertOpportunity({
      externalKey,
      name: opportunityName,
      pipelineStageId: GHL_CONFIG.stages.NEEDS_ATTENTION,
      status: 'open',
      contactId: systemContactId,
      notes,
      customFields: {
        alertType,
        salesOrderId,
        salesOrderNumber,
        fulfillmentSource,
      },
    });
    
    if (result.success) {
      console.log(`[GHLFulfillmentAlert] Created ${alertType} alert for order ${salesOrderNumber}: ${result.opportunityId}`);
    } else {
      console.error(`[GHLFulfillmentAlert] Failed to create alert for order ${salesOrderNumber}:`, result.error);
    }
    
    return result;
  } catch (error: any) {
    console.error('[GHLFulfillmentAlert] Error creating fulfillment alert:', error);
    return { success: false, error: error.message };
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
