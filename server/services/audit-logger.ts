import { storage } from "../storage";
import type { InsertAuditLog, AuditLog } from "@shared/schema";

export type AuditSource = 'SHOPIFY' | 'AMAZON' | 'EXTENSIV' | 'GHL' | 'SYSTEM' | 'USER';
export type AuditStatus = 'INFO' | 'WARNING' | 'ERROR';
export type AuditEventType = 
  | 'PO_CREATED'
  | 'PO_SENT'
  | 'PO_SEND_FAILED'
  | 'SALE_IMPORTED'
  | 'RETURN_CREATED'
  | 'RETURN_STATUS_CHANGED'
  | 'RETURN_LABEL_ISSUED'
  | 'INVENTORY_UPDATED'
  | 'AI_DECISION'
  | 'AI_RISK_CALCULATED'
  | 'INTEGRATION_SYNC'
  | 'INTEGRATION_ERROR'
  | 'ERROR';

export type AuditEntityType = 
  | 'PURCHASE_ORDER'
  | 'SALES_ORDER'
  | 'RETURN'
  | 'ITEM'
  | 'SUPPLIER'
  | 'INTEGRATION';

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
}

export const AuditLogger = new AuditLoggerService();
