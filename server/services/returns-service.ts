import { storage } from "../storage";
import { shippoReturnsService } from "./shippo-returns-service";
import { returnGHLSyncService } from "./return-ghl-sync-service";
import type { 
  ReturnRequest, 
  ReturnItem, 
  InsertReturnRequest, 
  InsertReturnItem,
  SalesOrder,
} from "@shared/schema";
import { ReturnStatus, ReturnResolution, ReturnEventType, SalesOrderReturnStatus } from "@shared/schema";

interface RequestReturnInput {
  customerId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  channel: string;
  orderId: string;
  externalOrderId?: string;
  items: Array<{
    sku: string;
    productName?: string;
    quantity: number;
    unitPrice?: number;
    orderLineId?: string;
  }>;
  reasonCode?: string;
  reasonText?: string;
  desiredResolution?: string;
  shippingAddress?: any;
  ghlContactId?: string;
  source?: string;
}

interface RequestReturnResult {
  success: boolean;
  returnId?: string;
  rmaNumber?: string;
  status?: string;
  resolution?: string;
  orderId?: string;
  labelUrl?: string;
  trackingNumber?: string;
  error?: string;
  message?: string;
  autoCancelled?: boolean;
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  [ReturnStatus.REQUESTED]: [ReturnStatus.APPROVED, ReturnStatus.REJECTED, ReturnStatus.CANCELLED],
  [ReturnStatus.APPROVED]: [ReturnStatus.LABEL_CREATED, ReturnStatus.CANCELLED],
  [ReturnStatus.LABEL_CREATED]: [ReturnStatus.IN_TRANSIT, ReturnStatus.CANCELLED],
  [ReturnStatus.IN_TRANSIT]: [ReturnStatus.RETURNED],
  [ReturnStatus.RETURNED]: [ReturnStatus.REFUND_ISSUE_PENDING, ReturnStatus.REPLACEMENT_SENT, ReturnStatus.CLOSED],
  [ReturnStatus.REFUND_ISSUE_PENDING]: [ReturnStatus.REFUNDED],
  [ReturnStatus.REFUNDED]: [ReturnStatus.CLOSED],
  [ReturnStatus.REPLACEMENT_SENT]: [ReturnStatus.CLOSED],
  [ReturnStatus.CLOSED]: [],
  [ReturnStatus.REJECTED]: [],
  [ReturnStatus.CANCELLED]: [],
  [ReturnStatus.OPEN]: [ReturnStatus.APPROVED, ReturnStatus.LABEL_CREATED, ReturnStatus.CANCELLED],
  [ReturnStatus.RECEIVED_AT_WAREHOUSE]: [ReturnStatus.REFUND_ISSUE_PENDING, ReturnStatus.CLOSED],
  [ReturnStatus.COMPLETED]: [],
};

export class ReturnsService {

  async requestReturn(input: RequestReturnInput): Promise<RequestReturnResult> {
    console.log(`[ReturnsService] Processing return request for order ${input.orderId}`);

    try {
      let salesOrder: SalesOrder | undefined;
      if (input.orderId) {
        salesOrder = await storage.getSalesOrder(input.orderId);
        if (!salesOrder && input.externalOrderId) {
          const orders = await storage.getSalesOrdersByExternalId(input.channel, input.externalOrderId);
          salesOrder = orders[0];
        }
      }

      // Check if order has shipped - if not, auto-cancel instead of creating a return
      // Orders that never shipped are cancellations, not returns
      // Check actual shipment by looking at line items qtyShipped/qtyFulfilled
      if (salesOrder) {
        const orderLines = await storage.getSalesOrderLines(salesOrder.id);
        const totalShipped = orderLines.reduce((sum, line) => sum + (line.qtyShipped || 0) + (line.qtyFulfilled || 0), 0);
        const hasShipped = totalShipped > 0 || ['SHIPPED', 'DELIVERED'].includes(salesOrder.status);
        
        if (!hasShipped) {
          console.log(`[ReturnsService] Order ${salesOrder.id} has not shipped (qtyShipped: ${totalShipped}, status: ${salesOrder.status}), auto-cancelling instead of creating return`);
          
          // Cancel the sales order instead of creating a return
          await storage.updateSalesOrder(salesOrder.id, { status: 'CANCELLED' });
          
          return {
            success: true,
            status: 'AUTO_CANCELLED',
            orderId: salesOrder.id,
            message: `Order cancelled (item never shipped). Cancellation processed on Sales Orders page.`,
            autoCancelled: true,
          };
        }
      }

      const rmaNumber = await storage.getNextRMANumber();

      const resolution = (input.desiredResolution as any) || ReturnResolution.REFUND;

      const returnRequest: InsertReturnRequest = {
        rmaNumber,
        salesOrderId: salesOrder?.id || null,
        orderNumber: salesOrder?.externalOrderId || input.orderId,
        externalOrderId: input.externalOrderId || input.orderId,
        salesChannel: input.channel.toUpperCase(),
        source: input.source || (input.ghlContactId ? 'GHL' : 'Manual'),
        customerName: input.customerName,
        customerEmail: input.customerEmail || null,
        customerPhone: input.customerPhone || null,
        shippingAddress: input.shippingAddress || null,
        ghlContactId: input.ghlContactId || null,
        status: ReturnStatus.REQUESTED,
        resolutionRequested: resolution,
        reason: input.reasonText || null,
        reasonCode: input.reasonCode || null,
        requestedAt: new Date(),
        labelProvider: 'SHIPPO',
        initiatedVia: input.ghlContactId ? 'GHL_BOT' : 'MANUAL_UI',
        totalReceived: salesOrder?.totalAmount || null,
      };

      const createdReturn = await storage.createReturnRequest(returnRequest);

      for (const item of input.items) {
        const returnItem: InsertReturnItem = {
          returnRequestId: createdReturn.id,
          sku: item.sku,
          productName: item.productName || null,
          unitPrice: item.unitPrice || null,
          qtyOrdered: item.quantity,
          qtyRequested: item.quantity,
          qtyApproved: item.quantity,
          salesOrderLineId: item.orderLineId || null,
          inventoryItemId: null,
        };
        await storage.createReturnItem(returnItem);
      }

      await storage.createReturnEvent({
        returnRequestId: createdReturn.id,
        type: input.ghlContactId ? ReturnEventType.GHL_REQUEST : ReturnEventType.MANUAL_REQUEST,
        toStatus: ReturnStatus.REQUESTED,
        actor: input.ghlContactId ? `ghl:${input.ghlContactId}` : 'system',
        message: `Return request created for order ${input.orderId}`,
        payload: { input },
      });

      const approved = await this.approveReturn(createdReturn.id);
      
      let labelResult: { labelUrl?: string; trackingNumber?: string } = {};
      if (approved && (resolution === ReturnResolution.REFUND || resolution === ReturnResolution.REPLACEMENT)) {
        const labelData = await this.createReturnLabel(createdReturn.id);
        if (labelData.success) {
          labelResult = {
            labelUrl: labelData.labelUrl,
            trackingNumber: labelData.trackingNumber,
          };
        }
      }

      if (salesOrder) {
        const totalReturnQty = input.items.reduce((sum, item) => sum + item.quantity, 0);
        await storage.updateSalesOrder(salesOrder.id, {
          returnStatus: SalesOrderReturnStatus.IN_PROGRESS,
          totalReturnQty: (salesOrder.totalReturnQty || 0) + totalReturnQty,
        });
      }

      const finalReturn = await storage.getReturnRequest(createdReturn.id);

      return {
        success: true,
        returnId: createdReturn.id,
        rmaNumber,
        status: finalReturn?.status || ReturnStatus.APPROVED,
        resolution,
        orderId: input.orderId,
        labelUrl: labelResult.labelUrl,
        trackingNumber: labelResult.trackingNumber,
      };

    } catch (error: any) {
      console.error("[ReturnsService] Error processing return request:", error);
      return {
        success: false,
        error: error.message || "Failed to process return request",
      };
    }
  }

  async approveReturn(returnId: string): Promise<boolean> {
    const returnRequest = await storage.getReturnRequest(returnId);
    if (!returnRequest) {
      throw new Error("Return request not found");
    }

    if (returnRequest.status !== ReturnStatus.REQUESTED && returnRequest.status !== ReturnStatus.OPEN) {
      console.log(`[ReturnsService] Return ${returnId} not in REQUESTED status, skipping approval`);
      return returnRequest.status === ReturnStatus.APPROVED;
    }

    await storage.updateReturnRequest(returnId, {
      status: ReturnStatus.APPROVED,
      approvedAt: new Date(),
    });

    await storage.createReturnEvent({
      returnRequestId: returnId,
      type: ReturnEventType.STATUS_CHANGE,
      fromStatus: returnRequest.status,
      toStatus: ReturnStatus.APPROVED,
      actor: 'system',
      message: 'Return automatically approved',
    });

    return true;
  }

  async createReturnLabel(returnId: string): Promise<{
    success: boolean;
    labelUrl?: string;
    trackingNumber?: string;
    carrier?: string;
    error?: string;
  }> {
    const returnRequest = await storage.getReturnRequest(returnId);
    if (!returnRequest) {
      return { success: false, error: "Return request not found" };
    }

    if (returnRequest.status !== ReturnStatus.APPROVED) {
      return { success: false, error: `Cannot create label for return in ${returnRequest.status} status` };
    }

    const labelResult = await shippoReturnsService.createReturnLabel(returnRequest);

    if (!labelResult.success) {
      await storage.createReturnEvent({
        returnRequestId: returnId,
        type: ReturnEventType.ERROR,
        actor: 'system',
        message: `Failed to create return label: ${labelResult.error}`,
        payload: labelResult,
      });
      return { success: false, error: labelResult.error };
    }

    await storage.updateReturnRequest(returnId, {
      status: ReturnStatus.LABEL_CREATED,
      shippoShipmentId: labelResult.shipmentId,
      shippoTransactionId: labelResult.transactionId,
      carrier: labelResult.carrier,
      trackingNumber: labelResult.trackingNumber,
      labelUrl: labelResult.labelUrl,
      labelCost: labelResult.labelCost,
      labelCurrency: labelResult.labelCurrency,
      labelCreatedAt: new Date(),
    });

    await storage.createReturnShipment({
      returnRequestId: returnId,
      carrier: labelResult.carrier || 'USPS',
      trackingNumber: labelResult.trackingNumber || '',
      labelUrl: labelResult.labelUrl || '',
      status: 'LABEL_CREATED',
      shippoShipmentId: labelResult.shipmentId,
      shippoTransactionId: labelResult.transactionId,
      labelCost: labelResult.labelCost,
      labelCurrency: labelResult.labelCurrency,
      estimatedDeliveryDate: labelResult.estimatedDeliveryDate,
    });

    await storage.createReturnEvent({
      returnRequestId: returnId,
      type: ReturnEventType.LABEL_CREATED,
      fromStatus: ReturnStatus.APPROVED,
      toStatus: ReturnStatus.LABEL_CREATED,
      actor: 'system',
      message: `Return label created: ${labelResult.trackingNumber}`,
      payload: labelResult,
    });

    return {
      success: true,
      labelUrl: labelResult.labelUrl,
      trackingNumber: labelResult.trackingNumber,
      carrier: labelResult.carrier,
    };
  }

  async updateStatusFromTracking(returnId: string, shippoStatus: string, payload?: any): Promise<boolean> {
    const returnRequest = await storage.getReturnRequest(returnId);
    if (!returnRequest) {
      return false;
    }

    const newStatus = shippoReturnsService.mapShippoStatusToReturnStatus(shippoStatus);
    if (!newStatus) {
      return false;
    }

    const allowedNextStatuses = ALLOWED_TRANSITIONS[returnRequest.status] || [];
    if (!allowedNextStatuses.includes(newStatus)) {
      console.log(`[ReturnsService] Transition from ${returnRequest.status} to ${newStatus} not allowed`);
      return false;
    }

    const updates: Partial<InsertReturnRequest> = {
      status: newStatus,
    };

    if (newStatus === ReturnStatus.IN_TRANSIT) {
      updates.inTransitAt = new Date();
    } else if (newStatus === ReturnStatus.RETURNED) {
      updates.receivedAt = new Date();
    }

    await storage.updateReturnRequest(returnId, updates);

    await storage.createReturnEvent({
      returnRequestId: returnId,
      type: ReturnEventType.SHIPPO_WEBHOOK,
      fromStatus: returnRequest.status,
      toStatus: newStatus,
      actor: 'shippo:webhook',
      message: `Tracking update: ${shippoStatus}`,
      payload,
    });

    return true;
  }

  async markRefundIssuePending(returnId: string): Promise<boolean> {
    const returnRequest = await storage.getReturnRequest(returnId);
    if (!returnRequest) {
      return false;
    }

    const validFromStatuses = [ReturnStatus.RETURNED, ReturnStatus.RECEIVED_AT_WAREHOUSE, ReturnStatus.LABEL_CREATED];
    if (!validFromStatuses.includes(returnRequest.status as any)) {
      console.log(`[ReturnsService] Cannot mark refund pending from ${returnRequest.status}`);
      return false;
    }

    await storage.updateReturnRequest(returnId, {
      status: ReturnStatus.REFUND_ISSUE_PENDING,
      refundIssuedAt: new Date(),
    });

    await storage.createReturnEvent({
      returnRequestId: returnId,
      type: ReturnEventType.STATUS_CHANGE,
      fromStatus: returnRequest.status,
      toStatus: ReturnStatus.REFUND_ISSUE_PENDING,
      actor: 'system',
      message: 'Return marked as pending refund',
    });

    try {
      await returnGHLSyncService.syncReturnRefundToGHL(returnId);
    } catch (error: any) {
      console.error(`[ReturnsService] Failed to sync refund task to GHL:`, error.message);
    }

    return true;
  }

  async markRefundCompleted(returnId: string, refundAmount?: number): Promise<boolean> {
    const returnRequest = await storage.getReturnRequest(returnId);
    if (!returnRequest) {
      return false;
    }

    if (returnRequest.status !== ReturnStatus.REFUND_ISSUE_PENDING) {
      console.log(`[ReturnsService] Cannot mark refund completed from ${returnRequest.status}`);
      return false;
    }

    await storage.updateReturnRequest(returnId, {
      status: ReturnStatus.REFUNDED,
      refundedAt: new Date(),
      resolutionFinal: ReturnResolution.REFUND,
    });

    await storage.createReturnEvent({
      returnRequestId: returnId,
      type: ReturnEventType.REFUND_COMPLETED,
      fromStatus: ReturnStatus.REFUND_ISSUE_PENDING,
      toStatus: ReturnStatus.REFUNDED,
      actor: 'user',
      message: 'Refund marked as completed',
      payload: { refundAmount },
    });

    if (returnRequest.salesOrderId) {
      const salesOrder = await storage.getSalesOrder(returnRequest.salesOrderId);
      if (salesOrder) {
        const allReturns = await storage.getReturnRequestsBySalesOrderId(returnRequest.salesOrderId);
        const allRefunded = allReturns.every(r => 
          r.status === ReturnStatus.REFUNDED || 
          r.status === ReturnStatus.CLOSED ||
          r.id === returnId
        );

        await storage.updateSalesOrder(salesOrder.id, {
          returnStatus: allRefunded ? SalesOrderReturnStatus.REFUNDED : SalesOrderReturnStatus.PARTIAL_REFUNDED,
          totalRefundAmount: (salesOrder.totalRefundAmount || 0) + (refundAmount || 0),
        });
      }
    }

    try {
      await returnGHLSyncService.syncReturnRefundToGHL(returnId);
    } catch (error: any) {
      console.error(`[ReturnsService] Failed to update GHL refund status:`, error.message);
    }

    return true;
  }

  async closeReturn(returnId: string): Promise<boolean> {
    const returnRequest = await storage.getReturnRequest(returnId);
    if (!returnRequest) {
      return false;
    }

    const validFromStatuses = [
      ReturnStatus.REFUNDED, 
      ReturnStatus.REPLACEMENT_SENT, 
      ReturnStatus.RETURNED,
      ReturnStatus.RECEIVED_AT_WAREHOUSE,
      ReturnStatus.COMPLETED,
    ];
    
    if (!validFromStatuses.includes(returnRequest.status as any)) {
      console.log(`[ReturnsService] Cannot close return from ${returnRequest.status}`);
      return false;
    }

    await storage.updateReturnRequest(returnId, {
      status: ReturnStatus.CLOSED,
      closedAt: new Date(),
    });

    await storage.createReturnEvent({
      returnRequestId: returnId,
      type: ReturnEventType.STATUS_CHANGE,
      fromStatus: returnRequest.status,
      toStatus: ReturnStatus.CLOSED,
      actor: 'user',
      message: 'Return closed',
    });

    return true;
  }

  async getReturnWithDetails(returnId: string): Promise<{
    return: ReturnRequest;
    items: ReturnItem[];
    events: any[];
    shipments: any[];
  } | null> {
    const returnRequest = await storage.getReturnRequest(returnId);
    if (!returnRequest) {
      return null;
    }

    const [items, events, shipments] = await Promise.all([
      storage.getReturnItemsByRequestId(returnId),
      storage.getReturnEventsByRequestId(returnId),
      storage.getReturnShipmentsByRequestId(returnId),
    ]);

    return {
      return: returnRequest,
      items,
      events,
      shipments,
    };
  }
}

export const returnsService = new ReturnsService();
