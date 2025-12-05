import { storage } from "../storage";
import type { InsertAuditLog, AuditLog } from "@shared/schema";

export type AuditSource = 'SHOPIFY' | 'AMAZON' | 'EXTENSIV' | 'GHL' | 'QUICKBOOKS' | 'PHANTOMBUSTER' | 'META_ADS' | 'GOOGLE_ADS' | 'SYSTEM' | 'USER';
export type AuditStatus = 'INFO' | 'WARNING' | 'ERROR';
export type AuditEventType = 
  | 'PO_CREATED'
  | 'PO_SENT'
  | 'PO_SEND_FAILED'
  | 'PO_RECEIVED'
  | 'PURCHASE_ORDER_RECEIVED'
  | 'SALE_IMPORTED'
  | 'SALES_ORDER_CREATED'
  | 'SALES_ORDER_FULFILLED'
  | 'SALES_ORDER_CANCELLED'
  | 'RETURN_CREATED'
  | 'RETURN_STATUS_CHANGED'
  | 'RETURN_LABEL_ISSUED'
  | 'RETURN_RECEIVED'
  | 'INVENTORY_UPDATED'
  | 'INVENTORY_TRANSFER'
  | 'INVENTORY_TRANSFERRED'
  | 'INVENTORY_ADJUST'
  | 'INVENTORY_ADJUSTED'
  | 'INVENTORY_RECEIVE'
  | 'INVENTORY_SHIP'
  | 'INVENTORY_PRODUCE'
  | 'PRODUCTION_COMPLETED'
  | 'AI_DECISION'
  | 'AI_RISK_CALCULATED'
  | 'INTEGRATION_SYNC'
  | 'INTEGRATION_ERROR'
  | 'ERROR'
  | 'ITEM_CREATED'
  | 'ITEM_UPDATED'
  | 'ITEM_DELETED'
  | 'BARCODE_GENERATED'
  | 'BARCODE_PRINTED'
  | 'BOM_CREATED'
  | 'BOM_UPDATED'
  | 'BOM_DELETED'
  | 'BOM_COMPONENT_ADDED'
  | 'BOM_COMPONENT_REMOVED'
  | 'SUPPLIER_CREATED'
  | 'SUPPLIER_UPDATED'
  | 'SUPPLIER_DELETED'
  | 'SUPPLIER_ITEM_LINKED'
  | 'SUPPLIER_ITEM_UNLINKED'
  | 'SETTINGS_UPDATED'
  | 'LLM_CONFIG_UPDATED'
  | 'AI_RULES_UPDATED'
  | 'INTEGRATION_CONFIG_UPDATED'
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'USER_REGISTERED'
  | 'ORDER_STATUS_CHANGED'
  | 'BACKORDER_CREATED'
  | 'BACKORDER_FULFILLED'
  | 'BIN_CREATED'
  | 'BIN_UPDATED'
  | 'BIN_DELETED'
  | 'SUPPLIER_DISCOVERY_STARTED'
  | 'SUPPLIER_DISCOVERY_COMPLETED'
  | 'SUPPLIER_DISCOVERY_FAILED'
  | 'SUPPLIER_OUTREACH_GENERATED'
  | 'SUPPLIER_OUTREACH_SENT'
  | 'AD_PLATFORM_CONNECTED'
  | 'AD_PLATFORM_DISCONNECTED'
  | 'AD_SYNC_STARTED'
  | 'AD_SYNC_COMPLETED'
  | 'AD_SYNC_FAILED'
  | 'AD_DEMAND_MULTIPLIER_APPLIED'
  | 'AI_SYSTEM_REVIEW_STARTED'
  | 'AI_SYSTEM_REVIEW_COMPLETED'
  | 'AI_SYSTEM_REVIEW_FAILED'
  | 'AI_RECOMMENDATION_CREATED'
  | 'AI_RECOMMENDATION_ACKNOWLEDGED'
  | 'AI_RECOMMENDATION_DISMISSED';

export type AuditEntityType = 
  | 'PURCHASE_ORDER'
  | 'SALES_ORDER'
  | 'RETURN'
  | 'ITEM'
  | 'SUPPLIER'
  | 'SUPPLIER_LEAD'
  | 'INTEGRATION'
  | 'BARCODE'
  | 'BOM'
  | 'SETTINGS'
  | 'USER'
  | 'BIN'
  | 'BACKORDER'
  | 'AD_PLATFORM'
  | 'AI_RECOMMENDATION';

export interface LogEventParams {
  source: AuditSource;
  eventType: AuditEventType | string;
  entityType?: AuditEntityType | string;
  entityId?: string;
  entityLabel?: string;
  performedByUserId?: string;
  performedByName?: string;
  status?: AuditStatus;
  description: string;
  details?: Record<string, unknown>;
  purchaseOrderId?: string;
  supplierId?: string;
}

class AuditLoggerService {
  async logEvent(params: LogEventParams): Promise<AuditLog> {
    const log: InsertAuditLog = {
      source: params.source,
      eventType: params.eventType,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      entityLabel: params.entityLabel ?? null,
      performedByUserId: params.performedByUserId ?? null,
      performedByName: params.performedByName ?? (params.performedByUserId ? undefined : 'System/AI'),
      status: params.status ?? 'INFO',
      description: params.description,
      details: params.details ?? null,
      purchaseOrderId: params.purchaseOrderId ?? null,
      supplierId: params.supplierId ?? null,
      actorType: params.performedByUserId ? 'USER' : 'SYSTEM',
      actorId: params.performedByUserId ?? null,
      success: params.status !== 'ERROR',
      errorMessage: params.status === 'ERROR' ? params.description : null,
    };

    return await storage.createAuditLog(log);
  }

  async logPOCreated(params: {
    poId: string;
    poNumber: string;
    supplierId: string;
    supplierName: string;
    userId?: string;
    userName?: string;
    itemCount: number;
    totalValue?: number;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'USER',
      eventType: 'PO_CREATED',
      entityType: 'PURCHASE_ORDER',
      entityId: params.poId,
      entityLabel: params.poNumber,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `PO ${params.poNumber} created for ${params.supplierName} with ${params.itemCount} items`,
      purchaseOrderId: params.poId,
      supplierId: params.supplierId,
      details: {
        poNumber: params.poNumber,
        supplierName: params.supplierName,
        itemCount: params.itemCount,
        totalValue: params.totalValue,
      },
    });
  }

  async logPOSent(params: {
    poId: string;
    poNumber: string;
    supplierId: string;
    supplierName: string;
    channel: 'EMAIL' | 'SMS';
    userId?: string;
    userName?: string;
    messageId?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'GHL',
      eventType: 'PO_SENT',
      entityType: 'PURCHASE_ORDER',
      entityId: params.poId,
      entityLabel: params.poNumber,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `PO ${params.poNumber} sent via ${params.channel} to ${params.supplierName}`,
      purchaseOrderId: params.poId,
      supplierId: params.supplierId,
      details: {
        poNumber: params.poNumber,
        supplierName: params.supplierName,
        channel: params.channel,
        messageId: params.messageId,
      },
    });
  }

  async logPOSendFailed(params: {
    poId: string;
    poNumber: string;
    supplierId: string;
    supplierName: string;
    channel: 'EMAIL' | 'SMS';
    error: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'GHL',
      eventType: 'PO_SEND_FAILED',
      entityType: 'PURCHASE_ORDER',
      entityId: params.poId,
      entityLabel: params.poNumber,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'ERROR',
      description: `Failed to send PO ${params.poNumber} via ${params.channel}: ${params.error}`,
      purchaseOrderId: params.poId,
      supplierId: params.supplierId,
      details: {
        poNumber: params.poNumber,
        supplierName: params.supplierName,
        channel: params.channel,
        error: params.error,
      },
    });
  }

  async logSaleImported(params: {
    orderId: string;
    orderNumber: string;
    source: 'SHOPIFY' | 'AMAZON';
    customerName?: string;
    totalAmount?: number;
    itemCount: number;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.source,
      eventType: 'SALE_IMPORTED',
      entityType: 'SALES_ORDER',
      entityId: params.orderId,
      entityLabel: params.orderNumber,
      status: 'INFO',
      description: `Order ${params.orderNumber} imported from ${params.source} with ${params.itemCount} items`,
      details: {
        orderNumber: params.orderNumber,
        source: params.source,
        customerName: params.customerName,
        totalAmount: params.totalAmount,
        itemCount: params.itemCount,
      },
    });
  }

  async logReturnCreated(params: {
    returnId: string;
    returnNumber: string;
    orderId: string;
    orderNumber: string;
    reason?: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'RETURN_CREATED',
      entityType: 'RETURN',
      entityId: params.returnId,
      entityLabel: params.returnNumber,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Return ${params.returnNumber} created for order ${params.orderNumber}`,
      details: {
        returnNumber: params.returnNumber,
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        reason: params.reason,
      },
    });
  }

  async logReturnStatusChanged(params: {
    returnId: string;
    returnNumber: string;
    oldStatus: string;
    newStatus: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'RETURN_STATUS_CHANGED',
      entityType: 'RETURN',
      entityId: params.returnId,
      entityLabel: params.returnNumber,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Return ${params.returnNumber} status changed from ${params.oldStatus} to ${params.newStatus}`,
      details: {
        returnNumber: params.returnNumber,
        oldStatus: params.oldStatus,
        newStatus: params.newStatus,
      },
    });
  }

  async logInventoryUpdated(params: {
    itemId: string;
    sku: string;
    productName: string;
    oldQty: number;
    newQty: number;
    reason: string;
    source?: AuditSource;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    const change = params.newQty - params.oldQty;
    const changeText = change >= 0 ? `+${change}` : `${change}`;
    
    return this.logEvent({
      source: params.source ?? 'SYSTEM',
      eventType: 'INVENTORY_UPDATED',
      entityType: 'ITEM',
      entityId: params.itemId,
      entityLabel: params.sku,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `${params.sku} inventory ${changeText} (${params.oldQty} → ${params.newQty}): ${params.reason}`,
      details: {
        sku: params.sku,
        productName: params.productName,
        oldQty: params.oldQty,
        newQty: params.newQty,
        change: change,
        reason: params.reason,
      },
    });
  }

  async logAIDecision(params: {
    itemId?: string;
    sku?: string;
    productName?: string;
    riskLevel?: string;
    recommendation?: string;
    recommendedQty?: number;
    summary: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'SYSTEM',
      eventType: 'AI_DECISION',
      entityType: params.itemId ? 'ITEM' : undefined,
      entityId: params.itemId,
      entityLabel: params.sku,
      status: 'INFO',
      description: params.summary,
      details: {
        sku: params.sku,
        productName: params.productName,
        riskLevel: params.riskLevel,
        recommendation: params.recommendation,
        recommendedQty: params.recommendedQty,
      },
    });
  }

  async logIntegrationSync(params: {
    source: AuditSource;
    integrationName: string;
    recordsProcessed: number;
    recordsCreated?: number;
    recordsUpdated?: number;
    recordsSkipped?: number;
    syncedRecords?: Array<{
      id: string;
      orderNumber?: string;
      customerName?: string;
      status?: string;
      totalAmount?: number;
      currency?: string;
      itemCount?: number;
      syncAction?: 'created' | 'updated' | 'skipped';
      syncReason?: string;
    }>;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.source,
      eventType: 'INTEGRATION_SYNC',
      entityType: 'INTEGRATION',
      entityLabel: params.integrationName,
      status: 'INFO',
      description: `${params.integrationName} sync completed: ${params.recordsProcessed} records processed`,
      details: {
        integrationName: params.integrationName,
        recordsProcessed: params.recordsProcessed,
        recordsCreated: params.recordsCreated,
        recordsUpdated: params.recordsUpdated,
        recordsSkipped: params.recordsSkipped,
        syncedRecords: params.syncedRecords,
      },
    });
  }

  async logIntegrationError(params: {
    source: AuditSource;
    integrationName: string;
    error: string;
    context?: Record<string, unknown>;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.source,
      eventType: 'INTEGRATION_ERROR',
      entityType: 'INTEGRATION',
      entityLabel: params.integrationName,
      status: 'ERROR',
      description: `${params.integrationName} error: ${params.error}`,
      details: {
        integrationName: params.integrationName,
        error: params.error,
        ...params.context,
      },
    });
  }

  // ============================================================================
  // AD PLATFORM EVENTS (Meta Ads, Google Ads)
  // ============================================================================

  async logAdPlatformConnected(params: {
    platform: 'META' | 'GOOGLE';
    accountId: string;
    accountName?: string;
    userId?: string;
  }): Promise<AuditLog> {
    const source: AuditSource = params.platform === 'META' ? 'META_ADS' : 'GOOGLE_ADS';
    const platformName = params.platform === 'META' ? 'Meta Ads' : 'Google Ads';
    return this.logEvent({
      source,
      eventType: 'AD_PLATFORM_CONNECTED',
      entityType: 'AD_PLATFORM',
      entityId: params.accountId,
      entityLabel: params.accountName || params.accountId,
      performedByUserId: params.userId,
      status: 'INFO',
      description: `${platformName} account connected: ${params.accountName || params.accountId}`,
      details: {
        platform: params.platform,
        accountId: params.accountId,
        accountName: params.accountName,
      },
    });
  }

  async logAdPlatformDisconnected(params: {
    platform: 'META' | 'GOOGLE';
    accountId: string;
    accountName?: string;
    userId?: string;
  }): Promise<AuditLog> {
    const source: AuditSource = params.platform === 'META' ? 'META_ADS' : 'GOOGLE_ADS';
    const platformName = params.platform === 'META' ? 'Meta Ads' : 'Google Ads';
    return this.logEvent({
      source,
      eventType: 'AD_PLATFORM_DISCONNECTED',
      entityType: 'AD_PLATFORM',
      entityId: params.accountId,
      entityLabel: params.accountName || params.accountId,
      performedByUserId: params.userId,
      status: 'INFO',
      description: `${platformName} account disconnected: ${params.accountName || params.accountId}`,
      details: {
        platform: params.platform,
        accountId: params.accountId,
        accountName: params.accountName,
      },
    });
  }

  async logAdSyncStarted(params: {
    platform: 'META' | 'GOOGLE';
    accountId: string;
    accountName?: string;
    daysToSync?: number;
  }): Promise<AuditLog> {
    const source: AuditSource = params.platform === 'META' ? 'META_ADS' : 'GOOGLE_ADS';
    const platformName = params.platform === 'META' ? 'Meta Ads' : 'Google Ads';
    return this.logEvent({
      source,
      eventType: 'AD_SYNC_STARTED',
      entityType: 'AD_PLATFORM',
      entityId: params.accountId,
      entityLabel: params.accountName || params.accountId,
      status: 'INFO',
      description: `${platformName} sync started for ${params.accountName || params.accountId}`,
      details: {
        platform: params.platform,
        accountId: params.accountId,
        accountName: params.accountName,
        daysToSync: params.daysToSync,
      },
    });
  }

  async logAdSyncCompleted(params: {
    platform: 'META' | 'GOOGLE';
    accountId: string;
    accountName?: string;
    skusProcessed: number;
    metricsUpserted: number;
    daysProcessed: number;
  }): Promise<AuditLog> {
    const source: AuditSource = params.platform === 'META' ? 'META_ADS' : 'GOOGLE_ADS';
    const platformName = params.platform === 'META' ? 'Meta Ads' : 'Google Ads';
    return this.logEvent({
      source,
      eventType: 'AD_SYNC_COMPLETED',
      entityType: 'AD_PLATFORM',
      entityId: params.accountId,
      entityLabel: params.accountName || params.accountId,
      status: 'INFO',
      description: `${platformName} sync completed: ${params.skusProcessed} SKUs, ${params.metricsUpserted} daily metrics`,
      details: {
        platform: params.platform,
        accountId: params.accountId,
        accountName: params.accountName,
        skusProcessed: params.skusProcessed,
        metricsUpserted: params.metricsUpserted,
        daysProcessed: params.daysProcessed,
      },
    });
  }

  async logAdSyncFailed(params: {
    platform: 'META' | 'GOOGLE';
    accountId: string;
    accountName?: string;
    error: string;
    context?: Record<string, unknown>;
  }): Promise<AuditLog> {
    const source: AuditSource = params.platform === 'META' ? 'META_ADS' : 'GOOGLE_ADS';
    const platformName = params.platform === 'META' ? 'Meta Ads' : 'Google Ads';
    return this.logEvent({
      source,
      eventType: 'AD_SYNC_FAILED',
      entityType: 'AD_PLATFORM',
      entityId: params.accountId,
      entityLabel: params.accountName || params.accountId,
      status: 'ERROR',
      description: `${platformName} sync failed: ${params.error}`,
      details: {
        platform: params.platform,
        accountId: params.accountId,
        accountName: params.accountName,
        error: params.error,
        ...params.context,
      },
    });
  }

  async logAdDemandMultiplierApplied(params: {
    sku: string;
    productName: string;
    baseVelocity: number;
    adMultiplier: number;
    adjustedVelocity: number;
    recentSpend: number;
    priorSpend: number;
    platform?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'SYSTEM',
      eventType: 'AD_DEMAND_MULTIPLIER_APPLIED',
      entityType: 'ITEM',
      entityLabel: params.sku,
      status: 'INFO',
      description: `Ad demand multiplier ${params.adMultiplier.toFixed(2)}x applied to ${params.sku}: velocity ${params.baseVelocity.toFixed(2)} → ${params.adjustedVelocity.toFixed(2)}`,
      details: {
        sku: params.sku,
        productName: params.productName,
        baseVelocity: params.baseVelocity,
        adMultiplier: params.adMultiplier,
        adjustedVelocity: params.adjustedVelocity,
        recentSpend: params.recentSpend,
        priorSpend: params.priorSpend,
        platform: params.platform,
      },
    });
  }

  async logError(params: {
    source: AuditSource;
    error: string;
    entityType?: AuditEntityType | string;
    entityId?: string;
    entityLabel?: string;
    context?: Record<string, unknown>;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.source,
      eventType: 'ERROR',
      entityType: params.entityType,
      entityId: params.entityId,
      entityLabel: params.entityLabel,
      status: 'ERROR',
      description: params.error,
      details: params.context,
    });
  }

  // ============================================================================
  // ITEM/PRODUCT EVENTS
  // ============================================================================

  async logItemCreated(params: {
    itemId: string;
    sku: string;
    name: string;
    type: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'ITEM_CREATED',
      entityType: 'ITEM',
      entityId: params.itemId,
      entityLabel: params.sku,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `${params.type === 'finished_product' ? 'Product' : 'Component'} created: ${params.name} (${params.sku})`,
      details: {
        sku: params.sku,
        name: params.name,
        type: params.type,
      },
    });
  }

  async logItemUpdated(params: {
    itemId: string;
    sku: string;
    name: string;
    changes: Record<string, { from: unknown; to: unknown }>;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    const changedFields = Object.keys(params.changes).join(', ');
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'ITEM_UPDATED',
      entityType: 'ITEM',
      entityId: params.itemId,
      entityLabel: params.sku,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `${params.name} (${params.sku}) updated: ${changedFields}`,
      details: {
        sku: params.sku,
        name: params.name,
        changes: params.changes,
      },
    });
  }

  async logItemDeleted(params: {
    itemId: string;
    sku: string;
    name: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'ITEM_DELETED',
      entityType: 'ITEM',
      entityId: params.itemId,
      entityLabel: params.sku,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'WARNING',
      description: `Item deleted: ${params.name} (${params.sku})`,
      details: {
        sku: params.sku,
        name: params.name,
      },
    });
  }

  // ============================================================================
  // BARCODE EVENTS
  // ============================================================================

  async logBarcodeGenerated(params: {
    barcodeId: string;
    itemId: string;
    sku: string;
    barcodeType: string;
    barcodeValue: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'BARCODE_GENERATED',
      entityType: 'BARCODE',
      entityId: params.barcodeId,
      entityLabel: params.barcodeValue,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Barcode generated for ${params.sku}: ${params.barcodeValue} (${params.barcodeType})`,
      details: {
        itemId: params.itemId,
        sku: params.sku,
        barcodeType: params.barcodeType,
        barcodeValue: params.barcodeValue,
      },
    });
  }

  async logBarcodePrinted(params: {
    barcodeId: string;
    itemId: string;
    sku: string;
    barcodeValue: string;
    copies?: number;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'BARCODE_PRINTED',
      entityType: 'BARCODE',
      entityId: params.barcodeId,
      entityLabel: params.barcodeValue,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Barcode printed for ${params.sku}${params.copies ? ` (${params.copies} copies)` : ''}`,
      details: {
        itemId: params.itemId,
        sku: params.sku,
        barcodeValue: params.barcodeValue,
        copies: params.copies,
      },
    });
  }

  // ============================================================================
  // INVENTORY TRANSACTION EVENTS
  // ============================================================================

  async logInventoryTransaction(params: {
    itemId: string;
    sku: string;
    productName: string;
    transactionType: 'TRANSFER' | 'ADJUST' | 'RECEIVE' | 'SHIP' | 'PRODUCE';
    quantity: number;
    fromLocation?: string;
    toLocation?: string;
    notes?: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    const eventTypeMap: Record<string, AuditEventType> = {
      'TRANSFER': 'INVENTORY_TRANSFER',
      'ADJUST': 'INVENTORY_ADJUST',
      'RECEIVE': 'INVENTORY_RECEIVE',
      'SHIP': 'INVENTORY_SHIP',
      'PRODUCE': 'INVENTORY_PRODUCE',
    };
    
    let description = '';
    switch (params.transactionType) {
      case 'TRANSFER':
        description = `Transferred ${params.quantity} units of ${params.sku} from ${params.fromLocation} to ${params.toLocation}`;
        break;
      case 'ADJUST':
        description = `Adjusted ${params.sku} by ${params.quantity >= 0 ? '+' : ''}${params.quantity} units${params.notes ? `: ${params.notes}` : ''}`;
        break;
      case 'RECEIVE':
        description = `Received ${params.quantity} units of ${params.sku}${params.toLocation ? ` at ${params.toLocation}` : ''}`;
        break;
      case 'SHIP':
        description = `Shipped ${params.quantity} units of ${params.sku}${params.fromLocation ? ` from ${params.fromLocation}` : ''}`;
        break;
      case 'PRODUCE':
        description = `Produced ${params.quantity} units of ${params.sku}`;
        break;
    }

    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: eventTypeMap[params.transactionType] || 'INVENTORY_UPDATED',
      entityType: 'ITEM',
      entityId: params.itemId,
      entityLabel: params.sku,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description,
      details: {
        sku: params.sku,
        productName: params.productName,
        transactionType: params.transactionType,
        quantity: params.quantity,
        fromLocation: params.fromLocation,
        toLocation: params.toLocation,
        notes: params.notes,
      },
    });
  }

  // ============================================================================
  // BOM EVENTS
  // ============================================================================

  async logBOMCreated(params: {
    bomId: string;
    finishedProductId: string;
    finishedProductSku: string;
    finishedProductName: string;
    componentCount: number;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'BOM_CREATED',
      entityType: 'BOM',
      entityId: params.bomId,
      entityLabel: params.finishedProductSku,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Bill of Materials created for ${params.finishedProductName} with ${params.componentCount} components`,
      details: {
        finishedProductId: params.finishedProductId,
        finishedProductSku: params.finishedProductSku,
        finishedProductName: params.finishedProductName,
        componentCount: params.componentCount,
      },
    });
  }

  async logBOMComponentAdded(params: {
    bomId: string;
    finishedProductSku: string;
    componentId: string;
    componentSku: string;
    componentName: string;
    quantity: number;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'BOM_COMPONENT_ADDED',
      entityType: 'BOM',
      entityId: params.bomId,
      entityLabel: params.finishedProductSku,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Added ${params.quantity}x ${params.componentName} (${params.componentSku}) to BOM for ${params.finishedProductSku}`,
      details: {
        finishedProductSku: params.finishedProductSku,
        componentId: params.componentId,
        componentSku: params.componentSku,
        componentName: params.componentName,
        quantity: params.quantity,
      },
    });
  }

  async logBOMComponentRemoved(params: {
    bomId: string;
    finishedProductSku: string;
    componentId: string;
    componentSku: string;
    componentName: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'BOM_COMPONENT_REMOVED',
      entityType: 'BOM',
      entityId: params.bomId,
      entityLabel: params.finishedProductSku,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Removed ${params.componentName} (${params.componentSku}) from BOM for ${params.finishedProductSku}`,
      details: {
        finishedProductSku: params.finishedProductSku,
        componentId: params.componentId,
        componentSku: params.componentSku,
        componentName: params.componentName,
      },
    });
  }

  // ============================================================================
  // SUPPLIER EVENTS
  // ============================================================================

  async logSupplierCreated(params: {
    supplierId: string;
    supplierName: string;
    email?: string;
    phone?: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'SUPPLIER_CREATED',
      entityType: 'SUPPLIER',
      entityId: params.supplierId,
      entityLabel: params.supplierName,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Supplier created: ${params.supplierName}`,
      supplierId: params.supplierId,
      details: {
        supplierName: params.supplierName,
        email: params.email,
        phone: params.phone,
      },
    });
  }

  async logSupplierUpdated(params: {
    supplierId: string;
    supplierName: string;
    changes: Record<string, { from: unknown; to: unknown }>;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    const changedFields = Object.keys(params.changes).join(', ');
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'SUPPLIER_UPDATED',
      entityType: 'SUPPLIER',
      entityId: params.supplierId,
      entityLabel: params.supplierName,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Supplier ${params.supplierName} updated: ${changedFields}`,
      supplierId: params.supplierId,
      details: {
        supplierName: params.supplierName,
        changes: params.changes,
      },
    });
  }

  async logSupplierDeleted(params: {
    supplierId: string;
    supplierName: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'SUPPLIER_DELETED',
      entityType: 'SUPPLIER',
      entityId: params.supplierId,
      entityLabel: params.supplierName,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'WARNING',
      description: `Supplier deleted: ${params.supplierName}`,
      supplierId: params.supplierId,
      details: {
        supplierName: params.supplierName,
      },
    });
  }

  async logSupplierItemLinked(params: {
    supplierId: string;
    supplierName: string;
    itemId: string;
    sku: string;
    itemName: string;
    unitCost?: number;
    leadTimeDays?: number;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'SUPPLIER_ITEM_LINKED',
      entityType: 'SUPPLIER',
      entityId: params.supplierId,
      entityLabel: params.supplierName,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Linked ${params.itemName} (${params.sku}) to supplier ${params.supplierName}`,
      supplierId: params.supplierId,
      details: {
        supplierName: params.supplierName,
        itemId: params.itemId,
        sku: params.sku,
        itemName: params.itemName,
        unitCost: params.unitCost,
        leadTimeDays: params.leadTimeDays,
      },
    });
  }

  async logSupplierItemUnlinked(params: {
    supplierId: string;
    supplierName: string;
    itemId: string;
    sku: string;
    itemName: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'SUPPLIER_ITEM_UNLINKED',
      entityType: 'SUPPLIER',
      entityId: params.supplierId,
      entityLabel: params.supplierName,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Unlinked ${params.itemName} (${params.sku}) from supplier ${params.supplierName}`,
      supplierId: params.supplierId,
      details: {
        supplierName: params.supplierName,
        itemId: params.itemId,
        sku: params.sku,
        itemName: params.itemName,
      },
    });
  }

  // ============================================================================
  // SETTINGS EVENTS
  // ============================================================================

  async logSettingsUpdated(params: {
    settingType: 'LLM_CONFIG' | 'AI_RULES' | 'INTEGRATION' | 'GENERAL';
    settingName: string;
    changes?: Record<string, { from: unknown; to: unknown }>;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    const eventTypeMap: Record<string, AuditEventType> = {
      'LLM_CONFIG': 'LLM_CONFIG_UPDATED',
      'AI_RULES': 'AI_RULES_UPDATED',
      'INTEGRATION': 'INTEGRATION_CONFIG_UPDATED',
      'GENERAL': 'SETTINGS_UPDATED',
    };
    
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: eventTypeMap[params.settingType] || 'SETTINGS_UPDATED',
      entityType: 'SETTINGS',
      entityLabel: params.settingName,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `${params.settingName} settings updated`,
      details: {
        settingType: params.settingType,
        settingName: params.settingName,
        changes: params.changes,
      },
    });
  }

  async logIntegrationConfigUpdated(params: {
    integrationType: string;
    integrationName: string;
    configured: boolean;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'INTEGRATION_CONFIG_UPDATED',
      entityType: 'INTEGRATION',
      entityLabel: params.integrationName,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `${params.integrationName} integration ${params.configured ? 'configured' : 'disconnected'}`,
      details: {
        integrationType: params.integrationType,
        integrationName: params.integrationName,
        configured: params.configured,
      },
    });
  }

  // ============================================================================
  // AUTH EVENTS
  // ============================================================================

  async logUserLogin(params: {
    userId: string;
    email: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'USER',
      eventType: 'USER_LOGIN',
      entityType: 'USER',
      entityId: params.userId,
      entityLabel: params.email,
      performedByUserId: params.userId,
      performedByName: params.email,
      status: 'INFO',
      description: `User logged in: ${params.email}`,
      details: {
        email: params.email,
      },
    });
  }

  async logUserLogout(params: {
    userId: string;
    email: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'USER',
      eventType: 'USER_LOGOUT',
      entityType: 'USER',
      entityId: params.userId,
      entityLabel: params.email,
      performedByUserId: params.userId,
      performedByName: params.email,
      status: 'INFO',
      description: `User logged out: ${params.email}`,
      details: {
        email: params.email,
      },
    });
  }

  async logUserRegistered(params: {
    userId: string;
    email: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'USER',
      eventType: 'USER_REGISTERED',
      entityType: 'USER',
      entityId: params.userId,
      entityLabel: params.email,
      performedByUserId: params.userId,
      performedByName: params.email,
      status: 'INFO',
      description: `New user registered: ${params.email}`,
      details: {
        email: params.email,
      },
    });
  }

  // ============================================================================
  // ORDER EVENTS
  // ============================================================================

  async logOrderStatusChanged(params: {
    orderId: string;
    orderNumber: string;
    oldStatus: string;
    newStatus: string;
    source?: AuditSource;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.source ?? (params.userId ? 'USER' : 'SYSTEM'),
      eventType: 'ORDER_STATUS_CHANGED',
      entityType: 'SALES_ORDER',
      entityId: params.orderId,
      entityLabel: params.orderNumber,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Order ${params.orderNumber} status changed from ${params.oldStatus} to ${params.newStatus}`,
      details: {
        orderNumber: params.orderNumber,
        oldStatus: params.oldStatus,
        newStatus: params.newStatus,
      },
    });
  }

  async logBackorderCreated(params: {
    backorderId: string;
    orderId: string;
    orderNumber: string;
    itemId: string;
    sku: string;
    quantity: number;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'SYSTEM',
      eventType: 'BACKORDER_CREATED',
      entityType: 'BACKORDER',
      entityId: params.backorderId,
      entityLabel: params.orderNumber,
      status: 'WARNING',
      description: `Backorder created for ${params.quantity}x ${params.sku} on order ${params.orderNumber}`,
      details: {
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        itemId: params.itemId,
        sku: params.sku,
        quantity: params.quantity,
      },
    });
  }

  async logBackorderFulfilled(params: {
    backorderId: string;
    orderId: string;
    orderNumber: string;
    itemId: string;
    sku: string;
    quantity: number;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'BACKORDER_FULFILLED',
      entityType: 'BACKORDER',
      entityId: params.backorderId,
      entityLabel: params.orderNumber,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Backorder fulfilled: ${params.quantity}x ${params.sku} for order ${params.orderNumber}`,
      details: {
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        itemId: params.itemId,
        sku: params.sku,
        quantity: params.quantity,
      },
    });
  }

  // ============================================================================
  // BIN EVENTS
  // ============================================================================

  async logBinCreated(params: {
    binId: string;
    binCode: string;
    location?: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'BIN_CREATED',
      entityType: 'BIN',
      entityId: params.binId,
      entityLabel: params.binCode,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Bin created: ${params.binCode}${params.location ? ` at ${params.location}` : ''}`,
      details: {
        binCode: params.binCode,
        location: params.location,
      },
    });
  }

  async logBinUpdated(params: {
    binId: string;
    binCode: string;
    changes: Record<string, { from: unknown; to: unknown }>;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    const changedFields = Object.keys(params.changes).join(', ');
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'BIN_UPDATED',
      entityType: 'BIN',
      entityId: params.binId,
      entityLabel: params.binCode,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `Bin ${params.binCode} updated: ${changedFields}`,
      details: {
        binCode: params.binCode,
        changes: params.changes,
      },
    });
  }

  async logBinDeleted(params: {
    binId: string;
    binCode: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'BIN_DELETED',
      entityType: 'BIN',
      entityId: params.binId,
      entityLabel: params.binCode,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'WARNING',
      description: `Bin deleted: ${params.binCode}`,
      details: {
        binCode: params.binCode,
      },
    });
  }

  // ============================================================================
  // BOM UPDATE EVENT (simplified for bulk saves)
  // ============================================================================

  async logBOMUpdated(params: {
    productId: string;
    productName: string;
    productSku: string;
    componentsCount: number;
    previousComponentsCount: number;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'BOM_UPDATED',
      entityType: 'BOM',
      entityId: params.productId,
      entityLabel: params.productSku,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `BOM updated for ${params.productName} (${params.productSku}): ${params.previousComponentsCount} -> ${params.componentsCount} components`,
      details: {
        productId: params.productId,
        productName: params.productName,
        productSku: params.productSku,
        componentsCount: params.componentsCount,
        previousComponentsCount: params.previousComponentsCount,
      },
    });
  }

  // ============================================================================
  // AI RULES UPDATE EVENT
  // ============================================================================

  async logAIRulesUpdated(params: {
    changes: Record<string, { from: unknown; to: unknown }>;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    const changedFields = Object.keys(params.changes).join(', ');
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'AI_RULES_UPDATED',
      entityType: 'SETTINGS',
      entityLabel: 'AI Decision Rules',
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `AI decision rules updated: ${changedFields}`,
      details: {
        changes: params.changes,
      },
    });
  }

  // ============================================================================
  // AI SYSTEM REVIEW EVENTS (Weekly LLM-powered log analysis)
  // ============================================================================

  async logAISystemReviewStarted(params: {
    periodStart: Date;
    periodEnd: Date;
    logsToAnalyze: number;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'SYSTEM',
      eventType: 'AI_SYSTEM_REVIEW_STARTED',
      entityType: 'AI_RECOMMENDATION',
      status: 'INFO',
      description: `AI System Review started: analyzing ${params.logsToAnalyze} logs from ${params.periodStart.toISOString()} to ${params.periodEnd.toISOString()}`,
      details: {
        periodStart: params.periodStart.toISOString(),
        periodEnd: params.periodEnd.toISOString(),
        logsToAnalyze: params.logsToAnalyze,
      },
    });
  }

  async logAISystemReviewCompleted(params: {
    periodStart: Date;
    periodEnd: Date;
    logsAnalyzed: number;
    recommendationsGenerated: number;
    duration: number;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'SYSTEM',
      eventType: 'AI_SYSTEM_REVIEW_COMPLETED',
      entityType: 'AI_RECOMMENDATION',
      status: 'INFO',
      description: `AI System Review completed: ${params.recommendationsGenerated} recommendations from ${params.logsAnalyzed} logs (${params.duration}ms)`,
      details: {
        periodStart: params.periodStart.toISOString(),
        periodEnd: params.periodEnd.toISOString(),
        logsAnalyzed: params.logsAnalyzed,
        recommendationsGenerated: params.recommendationsGenerated,
        duration: params.duration,
      },
    });
  }

  async logAISystemReviewFailed(params: {
    periodStart: Date;
    periodEnd: Date;
    error: string;
    context?: Record<string, unknown>;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'SYSTEM',
      eventType: 'AI_SYSTEM_REVIEW_FAILED',
      entityType: 'AI_RECOMMENDATION',
      status: 'ERROR',
      description: `AI System Review failed: ${params.error}`,
      details: {
        periodStart: params.periodStart.toISOString(),
        periodEnd: params.periodEnd.toISOString(),
        error: params.error,
        ...params.context,
      },
    });
  }

  async logAIRecommendationCreated(params: {
    recommendationId: string;
    title: string;
    severity: string;
    category: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: 'SYSTEM',
      eventType: 'AI_RECOMMENDATION_CREATED',
      entityType: 'AI_RECOMMENDATION',
      entityId: params.recommendationId,
      entityLabel: params.title,
      status: 'INFO',
      description: `AI recommendation created: [${params.severity}] ${params.title}`,
      details: {
        recommendationId: params.recommendationId,
        title: params.title,
        severity: params.severity,
        category: params.category,
      },
    });
  }

  async logAIRecommendationAcknowledged(params: {
    recommendationId: string;
    title: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'AI_RECOMMENDATION_ACKNOWLEDGED',
      entityType: 'AI_RECOMMENDATION',
      entityId: params.recommendationId,
      entityLabel: params.title,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `AI recommendation acknowledged: ${params.title}`,
      details: {
        recommendationId: params.recommendationId,
        title: params.title,
      },
    });
  }

  async logAIRecommendationDismissed(params: {
    recommendationId: string;
    title: string;
    userId?: string;
    userName?: string;
  }): Promise<AuditLog> {
    return this.logEvent({
      source: params.userId ? 'USER' : 'SYSTEM',
      eventType: 'AI_RECOMMENDATION_DISMISSED',
      entityType: 'AI_RECOMMENDATION',
      entityId: params.recommendationId,
      entityLabel: params.title,
      performedByUserId: params.userId,
      performedByName: params.userName,
      status: 'INFO',
      description: `AI recommendation dismissed: ${params.title}`,
      details: {
        recommendationId: params.recommendationId,
        title: params.title,
      },
    });
  }
}

export const AuditLogger = new AuditLoggerService();
