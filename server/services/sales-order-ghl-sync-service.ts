import { GHL_CONFIG } from "../config/ghl-config";
import { ghlOpportunitiesService } from "./ghl-opportunities-service";
import { storage } from "../storage";
import type { SalesOrder } from "@shared/schema";

interface GHLSyncResult {
  success: boolean;
  opportunityId?: string;
  opportunityUrl?: string;
  error?: string;
  created?: boolean;
  updated?: boolean;
}

export class SalesOrderGHLSyncService {
  private userId: string | null = null;

  async initialize(userId: string): Promise<boolean> {
    this.userId = userId;
    return await ghlOpportunitiesService.initialize(userId);
  }

  async syncSalesOrderToGHL(salesOrderId: string): Promise<GHLSyncResult> {
    console.log(`[SalesOrder GHL] Starting sync for order: ${salesOrderId}`);

    if (!this.userId) {
      return { success: false, error: "Service not initialized with userId" };
    }

    if (!ghlOpportunitiesService.isConfigured()) {
      console.log("[SalesOrder GHL] GHL not configured - skipping sync");
      return { success: false, error: "GHL integration not configured" };
    }

    try {
      const order = await storage.getSalesOrder(salesOrderId);
      if (!order) {
        return { success: false, error: "Sales order not found" };
      }

      const stageId = this.getStageForOrder(order);
      const oppStatus = this.getOpportunityStatus(order);
      const name = ghlOpportunitiesService.buildSalesOrderName(order);

      const result = await ghlOpportunitiesService.upsertOpportunity({
        externalKey: `sales-order-${salesOrderId}`,
        name,
        pipelineStageId: stageId,
        status: oppStatus,
        amount: order.totalAmount || 0,
        contact: {
          name: order.customerName,
          email: order.customerEmail || undefined,
          phone: order.customerPhone || undefined,
        },
        customFields: {
          order_id: order.externalOrderId || order.id,
          channel: order.channel,
          order_status: order.status,
          production_status: order.productionStatus,
          order_date: order.orderDate?.toISOString() || null,
        },
        existingOpportunityId: order.ghlProductionOpportunityId,
      });

      if (result.success && result.opportunityId) {
        const updates: Record<string, any> = {};
        
        if (result.opportunityId !== order.ghlProductionOpportunityId) {
          updates.ghlProductionOpportunityId = result.opportunityId;
        }
        
        // Store the contactId if we got one from the sync
        if (result.contactId && result.contactId !== order.ghlContactId) {
          updates.ghlContactId = result.contactId;
        }
        
        if (Object.keys(updates).length > 0) {
          await storage.updateSalesOrder(salesOrderId, updates);
          console.log(`[SalesOrder GHL] Updated order with GHL: opportunityId=${result.opportunityId}, contactId=${result.contactId || 'unchanged'}`);
        }
      }

      return result;
    } catch (error: any) {
      console.error(`[SalesOrder GHL] Error syncing order ${salesOrderId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async syncRefundToGHL(salesOrderId: string): Promise<GHLSyncResult> {
    console.log(`[SalesOrder GHL] Syncing refund for order: ${salesOrderId}`);

    if (!this.userId) {
      return { success: false, error: "Service not initialized with userId" };
    }

    if (!ghlOpportunitiesService.isConfigured()) {
      console.log("[SalesOrder GHL] GHL not configured - skipping sync");
      return { success: false, error: "GHL integration not configured" };
    }

    try {
      const order = await storage.getSalesOrder(salesOrderId);
      if (!order) {
        return { success: false, error: "Sales order not found" };
      }

      const stageId = this.getRefundStage(order);
      if (!stageId) {
        console.log("[SalesOrder GHL] No refund stage for this order status");
        return { success: false, error: "No refund stage for this status" };
      }

      const oppStatus = order.returnStatus === "REFUNDED" ? "won" : "open";
      const name = ghlOpportunitiesService.buildRefundName(order);

      const result = await ghlOpportunitiesService.upsertOpportunity({
        externalKey: `refund-${salesOrderId}`,
        name,
        pipelineStageId: stageId,
        status: oppStatus,
        amount: order.totalRefundAmount || 0,
        contact: {
          name: order.customerName,
          email: order.customerEmail || undefined,
          phone: order.customerPhone || undefined,
        },
        customFields: {
          order_id: order.externalOrderId || order.id,
          channel: order.channel,
          return_status: order.returnStatus,
          refund_amount: order.totalRefundAmount,
        },
        existingOpportunityId: order.ghlProductionOpportunityId,
      });

      if (result.success && result.opportunityId && result.opportunityId !== order.ghlProductionOpportunityId) {
        await storage.updateSalesOrder(salesOrderId, {
          ghlProductionOpportunityId: result.opportunityId,
        });
      }

      return result;
    } catch (error: any) {
      console.error(`[SalesOrder GHL] Error syncing refund ${salesOrderId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  private getStageForOrder(order: SalesOrder): string {
    if (order.returnStatus === "PARTIAL_REFUND" || order.returnStatus === "FULL_REFUND") {
      return order.returnStatus === "FULL_REFUND" 
        ? GHL_CONFIG.stages.REFUNDED 
        : GHL_CONFIG.stages.REFUND_PROCESSING;
    }
    return GHL_CONFIG.stages.SALES_ORDERS;
  }

  private getRefundStage(order: SalesOrder): string | null {
    switch (order.returnStatus) {
      case "PARTIAL_RETURN_REQUESTED":
      case "FULL_RETURN_REQUESTED":
      case "PARTIAL_REFUND":
        return GHL_CONFIG.stages.REFUND_PROCESSING;
      case "FULL_REFUND":
        return GHL_CONFIG.stages.REFUNDED;
      default:
        return null;
    }
  }

  private getOpportunityStatus(order: SalesOrder): "open" | "won" | "lost" {
    if (order.status === "CANCELLED") {
      return "lost";
    }
    if (order.status === "FULFILLED" && order.returnStatus === "NONE") {
      return "won";
    }
    return "open";
  }
}

export const salesOrderGHLSyncService = new SalesOrderGHLSyncService();
