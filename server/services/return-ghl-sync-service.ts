import { GHL_CONFIG } from "../config/ghl-config";
import { ghlOpportunitiesService } from "./ghl-opportunities-service";
import { storage } from "../storage";
import { ReturnStatus, ReturnEventType } from "@shared/schema";
import type { ReturnRequest, SalesOrder } from "@shared/schema";

interface GHLSyncResult {
  success: boolean;
  opportunityId?: string;
  opportunityUrl?: string;
  error?: string;
  created?: boolean;
  updated?: boolean;
}

export class ReturnGHLSyncService {
  private userId: string | null = null;

  async initialize(userId: string): Promise<boolean> {
    this.userId = userId;
    return await ghlOpportunitiesService.initialize(userId);
  }

  isConfigured(): boolean {
    return ghlOpportunitiesService.isConfigured();
  }

  async syncReturnRefundToGHL(returnId: string): Promise<GHLSyncResult> {
    console.log(`[ReturnGHLSync] Syncing return ${returnId} to GHL refund pipeline`);

    if (!this.userId) {
      return { success: false, error: "Service not initialized with userId" };
    }

    if (!this.isConfigured()) {
      console.log("[ReturnGHLSync] GHL not configured, skipping sync");
      return { success: false, error: "GoHighLevel not configured" };
    }

    try {
      const returnRequest = await storage.getReturnRequest(returnId);
      if (!returnRequest) {
        return { success: false, error: "Return request not found" };
      }

      const stageId = this.getStageForReturnStatus(returnRequest.status);
      if (!stageId) {
        console.log(`[ReturnGHLSync] No stage configured for status ${returnRequest.status}`);
        return { success: false, error: `No GHL stage for status ${returnRequest.status}` };
      }

      let salesOrder: SalesOrder | null = null;
      if (returnRequest.salesOrderId) {
        salesOrder = (await storage.getSalesOrder(returnRequest.salesOrderId)) || null;
      }

      const oppStatus = this.getOpportunityStatus(returnRequest.status);
      const name = this.buildReturnOpportunityName(returnRequest, salesOrder);
      const monetaryValue = salesOrder?.totalRefundAmount || 0;

      const items = await storage.getReturnItemsByRequestId(returnId);
      const itemsSummary = items.map(i => `${i.qtyRequested}x ${i.sku}`).join(", ");

      const result = await ghlOpportunitiesService.upsertOpportunity({
        externalKey: `return-${returnId}`,
        name,
        pipelineStageId: stageId,
        status: oppStatus,
        amount: monetaryValue,
        contact: {
          name: returnRequest.customerName || salesOrder?.customerName,
          email: returnRequest.customerEmail || salesOrder?.customerEmail || undefined,
          phone: returnRequest.customerPhone || salesOrder?.customerPhone || undefined,
        },
        customFields: {
          return_id: returnId,
          rma_number: returnRequest.rmaNumber,
          order_id: returnRequest.externalOrderId || returnRequest.orderNumber,
          channel: returnRequest.salesChannel || salesOrder?.channel,
          return_status: returnRequest.status,
          reason: returnRequest.reason || returnRequest.reasonCode,
          items: itemsSummary,
          refund_amount: monetaryValue,
        },
        existingOpportunityId: returnRequest.ghlRefundOpportunityId,
      });

      if (result.success && result.opportunityId) {
        if (result.opportunityId !== returnRequest.ghlRefundOpportunityId) {
          await storage.updateReturnRequest(returnId, {
            ghlRefundOpportunityId: result.opportunityId,
            ghlRefundOpportunityUrl: result.opportunityUrl,
          });
          console.log(`[ReturnGHLSync] Updated return with GHL opportunity ID: ${result.opportunityId}`);
        }

        await storage.createReturnEvent({
          returnRequestId: returnId,
          type: ReturnEventType.REFUND_TASK_CREATED,
          actor: "system",
          message: result.created 
            ? `GHL "Issue refund" opportunity created`
            : `GHL opportunity updated to ${returnRequest.status}`,
          payload: { 
            opportunityId: result.opportunityId, 
            stageId,
            created: result.created,
            updated: result.updated,
          },
        });
      }

      return result;
    } catch (error: any) {
      console.error("[ReturnGHLSync] Error syncing to GHL:", error);
      return { success: false, error: error.message };
    }
  }

  async syncReturnStatusChange(returnId: string): Promise<GHLSyncResult> {
    console.log(`[ReturnGHLSync] Status change for return: ${returnId}`);
    return await this.syncReturnRefundToGHL(returnId);
  }

  async markReturnRefunded(returnId: string): Promise<GHLSyncResult> {
    console.log(`[ReturnGHLSync] Marking return ${returnId} as refunded`);

    if (!this.userId) {
      return { success: false, error: "Service not initialized with userId" };
    }

    if (!this.isConfigured()) {
      return { success: false, error: "GHL not configured" };
    }

    try {
      const returnRequest = await storage.getReturnRequest(returnId);
      if (!returnRequest) {
        return { success: false, error: "Return request not found" };
      }

      if (!returnRequest.ghlRefundOpportunityId) {
        console.log("[ReturnGHLSync] No existing GHL opportunity - creating new one");
        return await this.syncReturnRefundToGHL(returnId);
      }

      let salesOrder: SalesOrder | null = null;
      if (returnRequest.salesOrderId) {
        salesOrder = (await storage.getSalesOrder(returnRequest.salesOrderId)) || null;
      }

      const name = this.buildReturnOpportunityName(returnRequest, salesOrder);

      const result = await ghlOpportunitiesService.upsertOpportunity({
        externalKey: `return-${returnId}`,
        name,
        pipelineStageId: GHL_CONFIG.stages.REFUNDED,
        status: "won",
        amount: 0,
        customFields: {
          return_id: returnId,
          rma_number: returnRequest.rmaNumber,
          return_status: "REFUNDED",
          refunded_at: new Date().toISOString(),
        },
        existingOpportunityId: returnRequest.ghlRefundOpportunityId,
      });

      if (result.success) {
        await storage.createReturnEvent({
          returnRequestId: returnId,
          type: ReturnEventType.REFUND_COMPLETED,
          actor: "system",
          message: `GHL opportunity marked as refunded`,
          payload: { opportunityId: result.opportunityId },
        });
      }

      return result;
    } catch (error: any) {
      console.error("[ReturnGHLSync] Error marking as refunded:", error);
      return { success: false, error: error.message };
    }
  }

  private getStageForReturnStatus(status: string): string | null {
    switch (status) {
      case ReturnStatus.REFUND_ISSUE_PENDING:
      case ReturnStatus.APPROVED:
      case ReturnStatus.RETURNED:
        return GHL_CONFIG.stages.REFUND_PROCESSING;
      case ReturnStatus.REFUNDED:
      case ReturnStatus.CLOSED:
        return GHL_CONFIG.stages.REFUNDED;
      default:
        return null;
    }
  }

  private getOpportunityStatus(returnStatus: string): "open" | "won" | "lost" {
    switch (returnStatus) {
      case ReturnStatus.REFUNDED:
      case ReturnStatus.CLOSED:
        return "won";
      case ReturnStatus.REJECTED:
        return "lost";
      default:
        return "open";
    }
  }

  private buildReturnOpportunityName(
    returnRequest: ReturnRequest, 
    salesOrder: SalesOrder | null
  ): string {
    const orderId = returnRequest.externalOrderId || returnRequest.orderNumber || "Unknown";
    const customerName = returnRequest.customerName || salesOrder?.customerName || "Customer";
    return `Refund – Order ${orderId} – ${customerName}`;
  }
}

export const returnGHLSyncService = new ReturnGHLSyncService();
