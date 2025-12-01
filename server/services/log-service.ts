import { storage } from "../storage";
import type { InsertSystemLog } from "@shared/schema";
import { SystemLogSeverity, SystemLogType, SystemLogEntityType } from "@shared/schema";

interface LogEventParams {
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  severity?: string;
  code?: string | null;
  message: string;
  details?: Record<string, any> | null;
}

class LogService {
  async logSystemEvent(params: LogEventParams): Promise<void> {
    try {
      const logEntry: InsertSystemLog = {
        type: params.type,
        entityType: params.entityType || null,
        entityId: params.entityId || null,
        severity: params.severity || SystemLogSeverity.INFO,
        code: params.code || null,
        message: params.message,
        details: params.details || null,
      };

      await storage.createSystemLog(logEntry);
      
      if (params.severity === SystemLogSeverity.ERROR) {
        console.error(`[SystemLog] ${params.type}: ${params.message}`);
      } else if (params.severity === SystemLogSeverity.WARNING) {
        console.warn(`[SystemLog] ${params.type}: ${params.message}`);
      } else {
        console.log(`[SystemLog] ${params.type}: ${params.message}`);
      }
    } catch (error: any) {
      console.error("[LogService] Failed to log system event:", error.message);
    }
  }

  async logSkuMismatch(params: {
    source: string;
    orderId: string;
    externalSku: string;
    externalUpc?: string;
    lineItemData?: any;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.SKU_MISMATCH,
      entityType: SystemLogEntityType.ORDER,
      entityId: params.orderId,
      severity: SystemLogSeverity.WARNING,
      code: "SKU_NOT_FOUND",
      message: `No internal SKU match for external SKU ${params.externalSku} from ${params.source} order ${params.orderId}.`,
      details: params,
    });
  }

  async logUpcMismatch(params: {
    source: string;
    orderId: string;
    externalUpc: string;
    lineItemData?: any;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.UPC_MISMATCH,
      entityType: SystemLogEntityType.ORDER,
      entityId: params.orderId,
      severity: SystemLogSeverity.WARNING,
      code: "UPC_NOT_FOUND",
      message: `No internal UPC match for ${params.externalUpc} from ${params.source} order ${params.orderId}.`,
      details: params,
    });
  }

  async logPoEmailSent(params: {
    poId: string;
    poNumber: string;
    recipientEmail: string;
    messageId?: string;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.PO_EMAIL_SENT,
      entityType: SystemLogEntityType.PO,
      entityId: params.poId,
      severity: SystemLogSeverity.INFO,
      code: "PO_EMAIL_SENT",
      message: `PO ${params.poNumber} email sent to ${params.recipientEmail}.`,
      details: params,
    });
  }

  async logPoEmailFailed(params: {
    poId: string;
    poNumber: string;
    recipientEmail: string;
    error: string;
    errorDetails?: any;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.PO_EMAIL_FAILED,
      entityType: SystemLogEntityType.PO,
      entityId: params.poId,
      severity: SystemLogSeverity.ERROR,
      code: "PO_EMAIL_FAILED",
      message: `Failed to send PO ${params.poNumber} email to ${params.recipientEmail}: ${params.error}`,
      details: params,
    });
  }

  async logPoAutoSent(params: {
    poId: string;
    poNumber: string;
    skus: string[];
    rescueDays: number;
    rescueQuantities: Record<string, number>;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.PO_AUTO_SENT,
      entityType: SystemLogEntityType.PO,
      entityId: params.poId,
      severity: SystemLogSeverity.INFO,
      code: "PO_AUTO_SENT",
      message: `AI auto-sent PO ${params.poNumber} for critical stock risk.`,
      details: params,
    });
  }

  async logShopifySyncSuccess(params: {
    sku: string;
    productId?: string;
    availableToSell: number;
    variantId: string;
    locationId: string;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.SHOPIFY_SYNC_INFO,
      entityType: SystemLogEntityType.PRODUCT,
      entityId: params.sku || params.productId,
      severity: SystemLogSeverity.INFO,
      code: "SHOPIFY_INVENTORY_UPDATED",
      message: `Updated Shopify availability for SKU ${params.sku} to ${params.availableToSell}.`,
      details: params,
    });
  }

  async logShopifySyncError(params: {
    sku: string;
    productId?: string;
    variantId?: string;
    locationId?: string;
    error: string;
    errorPayload?: any;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.SHOPIFY_SYNC_ERROR,
      entityType: SystemLogEntityType.PRODUCT,
      entityId: params.sku || params.productId,
      severity: SystemLogSeverity.ERROR,
      code: "SHOPIFY_INVENTORY_UPDATE_FAILED",
      message: `Failed to update Shopify availability for SKU ${params.sku}: ${params.error}`,
      details: params,
    });
  }

  async logShopifyVariantNotMapped(params: {
    sku: string;
    productId?: string;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.SKU_MISMATCH,
      entityType: SystemLogEntityType.PRODUCT,
      entityId: params.sku || params.productId,
      severity: SystemLogSeverity.WARNING,
      code: "SHOPIFY_VARIANT_NOT_MAPPED",
      message: `No Shopify variant mapping for SKU ${params.sku}.`,
      details: params,
    });
  }

  async logShopifyWebhookReceived(params: {
    topic: string;
    shopDomain: string;
    externalOrderId: string;
    orderNumber: string;
    action: 'created' | 'updated' | 'cancelled';
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.SHOPIFY_SYNC_INFO,
      entityType: SystemLogEntityType.ORDER,
      entityId: params.externalOrderId,
      severity: SystemLogSeverity.INFO,
      code: `SHOPIFY_ORDER_${params.action.toUpperCase()}`,
      message: `Shopify order ${params.orderNumber} ${params.action} via webhook from ${params.shopDomain}`,
      details: params,
    });
  }

  async logShopifyBackorder(params: {
    orderId: string;
    orderNumber: string;
    itemId: string;
    sku: string;
    qtyOrdered: number;
    qtyAllocated: number;
    qtyBackordered: number;
    availableStock: number;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.SHOPIFY_BACKORDER,
      entityType: SystemLogEntityType.ORDER,
      entityId: params.orderId,
      severity: SystemLogSeverity.WARNING,
      code: "SHOPIFY_BACKORDER_CREATED",
      message: `Order ${params.orderNumber}: Insufficient stock for ${params.sku}. Allocated ${params.qtyAllocated}/${params.qtyOrdered}, backordered ${params.qtyBackordered}`,
      details: params,
    });
  }

  async logShopifyWebhookError(params: {
    topic?: string;
    shopDomain?: string;
    externalOrderId?: string;
    error: string;
    errorDetails?: any;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.SHOPIFY_WEBHOOK_ERROR,
      entityType: SystemLogEntityType.ORDER,
      entityId: params.externalOrderId || null,
      severity: SystemLogSeverity.ERROR,
      code: "SHOPIFY_WEBHOOK_FAILED",
      message: `Shopify webhook error${params.topic ? ` (${params.topic})` : ''}: ${params.error}`,
      details: params,
    });
  }

  async logShopifySkuMapping(params: {
    itemId: string;
    sku: string;
    shopifyProductId: string;
    shopifyVariantId: string;
    shopifyInventoryItemId: string;
    matchType: 'UPC' | 'SKU' | 'MANUAL';
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.SHOPIFY_SYNC_INFO,
      entityType: SystemLogEntityType.PRODUCT,
      entityId: params.itemId,
      severity: SystemLogSeverity.INFO,
      code: "SHOPIFY_SKU_MAPPED",
      message: `Linked ${params.sku} to Shopify variant ${params.shopifyVariantId} via ${params.matchType} match`,
      details: params,
    });
  }

  async logShopifyBulkSync(params: {
    totalItems: number;
    synced: number;
    skipped: number;
    failed: number;
    duration?: number;
  }): Promise<void> {
    const success = params.failed === 0;
    await this.logSystemEvent({
      type: SystemLogType.SHOPIFY_SYNC_INFO,
      severity: success ? SystemLogSeverity.INFO : SystemLogSeverity.WARNING,
      code: success ? "SHOPIFY_BULK_SYNC_COMPLETE" : "SHOPIFY_BULK_SYNC_PARTIAL",
      message: `Shopify bulk sync: ${params.synced}/${params.totalItems} synced, ${params.skipped} skipped, ${params.failed} failed`,
      details: params,
    });
  }

  async logGhlSyncError(params: {
    entityType: string;
    entityId: string;
    error: string;
    errorPayload?: any;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.GHL_SYNC_ERROR,
      entityType: params.entityType,
      entityId: params.entityId,
      severity: SystemLogSeverity.ERROR,
      code: "GHL_SYNC_FAILED",
      message: `GHL sync failed for ${params.entityType} ${params.entityId}: ${params.error}`,
      details: params,
    });
  }

  async logShippoError(params: {
    returnId: string;
    error: string;
    errorPayload?: any;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.SHIPPO_ERROR,
      entityType: SystemLogEntityType.RETURN,
      entityId: params.returnId,
      severity: SystemLogSeverity.ERROR,
      code: "SHIPPO_LABEL_FAILED",
      message: `Shippo error for return ${params.returnId}: ${params.error}`,
      details: params,
    });
  }

  async logReturnScanMismatch(params: {
    returnId: string;
    scannedValue: string;
    scanType: string;
    context?: any;
  }): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.SKU_MISMATCH,
      entityType: SystemLogEntityType.RETURN,
      entityId: params.returnId,
      severity: SystemLogSeverity.WARNING,
      code: "SCAN_SKU_NOT_FOUND",
      message: `Scanned ${params.scanType} "${params.scannedValue}" not found for return ${params.returnId}.`,
      details: params,
    });
  }

  async logInfo(message: string, details?: Record<string, any>): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.INFO,
      severity: SystemLogSeverity.INFO,
      message,
      details: details || null,
    });
  }

  async logWarning(message: string, details?: Record<string, any>): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.WARNING,
      severity: SystemLogSeverity.WARNING,
      message,
      details: details || null,
    });
  }

  async logError(message: string, details?: Record<string, any>): Promise<void> {
    await this.logSystemEvent({
      type: SystemLogType.ERROR,
      severity: SystemLogSeverity.ERROR,
      message,
      details: details || null,
    });
  }
}

export const logService = new LogService();
