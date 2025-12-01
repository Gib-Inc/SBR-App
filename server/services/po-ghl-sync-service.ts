import { GHL_CONFIG } from "../config/ghl-config";
import { ghlOpportunitiesService } from "./ghl-opportunities-service";
import { storage } from "../storage";
import type { PurchaseOrder, Supplier } from "@shared/schema";

interface GHLSyncResult {
  success: boolean;
  opportunityId?: string;
  opportunityUrl?: string;
  error?: string;
  created?: boolean;
  updated?: boolean;
}

export class POGHLSyncService {
  private userId: string | null = null;

  async initialize(userId: string): Promise<boolean> {
    this.userId = userId;
    return await ghlOpportunitiesService.initialize(userId);
  }

  isConfigured(): boolean {
    return ghlOpportunitiesService.isConfigured();
  }

  getConfigurationStatus(): {
    configured: boolean;
    pipelineId: string;
    stages: typeof GHL_CONFIG.stages;
  } {
    return {
      configured: this.isConfigured(),
      pipelineId: GHL_CONFIG.pipelineId,
      stages: GHL_CONFIG.stages,
    };
  }

  private getStageIdForStatus(status: string): string {
    switch (status) {
      case "SENT":
      case "PARTIAL_RECEIVED":
        return GHL_CONFIG.stages.PO_SENT;
      case "PAID":
        return GHL_CONFIG.stages.PO_PAID;
      case "RECEIVED":
      case "CLOSED":
        return GHL_CONFIG.stages.PO_DELIVERED;
      default:
        return GHL_CONFIG.stages.PO_SENT;
    }
  }

  private getOpportunityStatus(poStatus: string): "open" | "won" | "lost" {
    switch (poStatus) {
      case "CANCELLED":
        return "lost";
      case "RECEIVED":
      case "CLOSED":
        return "won";
      default:
        return "open";
    }
  }

  async syncPurchaseOrderToGHL(poId: string): Promise<GHLSyncResult> {
    console.log(`[PO GHL Sync] Starting sync for PO: ${poId}`);

    if (!this.userId) {
      return { success: false, error: "Service not initialized with userId" };
    }

    if (!this.isConfigured()) {
      console.log("[PO GHL Sync] GHL not configured - skipping sync");
      return {
        success: false,
        error: "GHL integration not configured",
      };
    }

    try {
      const po = await storage.getPurchaseOrder(poId);
      if (!po) {
        return { success: false, error: "Purchase order not found" };
      }

      const supplier = po.supplierId
        ? (await storage.getSupplier(po.supplierId)) || null
        : null;

      const supplierName = supplier?.name || po.supplierName || "Unknown Supplier";
      const stageId = this.getStageIdForStatus(po.status);
      const oppStatus = this.getOpportunityStatus(po.status);
      const name = ghlOpportunitiesService.buildPurchaseOrderName(po, supplierName);
      const monetaryValue = Number(po.total) || 0;

      const result = await ghlOpportunitiesService.upsertOpportunity({
        externalKey: `po-${poId}`,
        name,
        pipelineStageId: stageId,
        status: oppStatus,
        amount: monetaryValue,
        contact: {
          name: supplierName,
          email: po.supplierEmail || supplier?.email || undefined,
          phone: supplier?.phone || undefined,
        },
        customFields: {
          po_number: po.poNumber,
          po_total: monetaryValue,
          po_status: po.status,
          supplier_name: supplierName,
          order_date: po.orderDate?.toISOString() || null,
          expected_date: po.expectedDate?.toISOString() || null,
          last_email_sent_at: po.lastEmailSentAt?.toISOString() || null,
        },
        existingOpportunityId: po.ghlOpportunityId,
      });

      if (result.success && result.opportunityId && result.opportunityId !== po.ghlOpportunityId) {
        await storage.updatePurchaseOrder(poId, {
          ghlOpportunityId: result.opportunityId,
        });
        console.log(`[PO GHL Sync] Updated PO with GHL opportunity ID: ${result.opportunityId}`);
      }

      return result;
    } catch (error: any) {
      console.error("[PO GHL Sync] Error syncing PO to GHL:", error);
      return {
        success: false,
        error: error.message || "Failed to sync with GHL",
      };
    }
  }

  async syncPOStatusChange(poId: string, newStatus: string): Promise<GHLSyncResult> {
    console.log(`[PO GHL Sync] Status change for PO ${poId}: ${newStatus}`);
    return await this.syncPurchaseOrderToGHL(poId);
  }

  async syncPOPaid(poId: string): Promise<GHLSyncResult> {
    console.log(`[PO GHL Sync] Marking PO ${poId} as paid`);

    if (!this.userId) {
      return { success: false, error: "Service not initialized with userId" };
    }

    if (!this.isConfigured()) {
      return { success: false, error: "GHL integration not configured" };
    }

    try {
      const po = await storage.getPurchaseOrder(poId);
      if (!po) {
        return { success: false, error: "Purchase order not found" };
      }

      if (!po.ghlOpportunityId) {
        console.log("[PO GHL Sync] No existing GHL opportunity - creating new one");
        return await this.syncPurchaseOrderToGHL(poId);
      }

      const supplier = po.supplierId
        ? (await storage.getSupplier(po.supplierId)) || null
        : null;

      const supplierName = supplier?.name || po.supplierName || "Unknown Supplier";
      const name = ghlOpportunitiesService.buildPurchaseOrderName(po, supplierName);

      const result = await ghlOpportunitiesService.upsertOpportunity({
        externalKey: `po-${poId}`,
        name,
        pipelineStageId: GHL_CONFIG.stages.PO_PAID,
        status: "open",
        amount: Number(po.total) || 0,
        customFields: {
          po_number: po.poNumber,
          po_status: "PAID",
          paid_at: new Date().toISOString(),
        },
        existingOpportunityId: po.ghlOpportunityId,
      });

      return result;
    } catch (error: any) {
      console.error("[PO GHL Sync] Error marking PO as paid:", error);
      return { success: false, error: error.message };
    }
  }

  async syncPODelivered(poId: string): Promise<GHLSyncResult> {
    console.log(`[PO GHL Sync] Marking PO ${poId} as delivered`);

    if (!this.userId) {
      return { success: false, error: "Service not initialized with userId" };
    }

    if (!this.isConfigured()) {
      return { success: false, error: "GHL integration not configured" };
    }

    try {
      const po = await storage.getPurchaseOrder(poId);
      if (!po) {
        return { success: false, error: "Purchase order not found" };
      }

      if (!po.ghlOpportunityId) {
        console.log("[PO GHL Sync] No existing GHL opportunity - creating new one");
        return await this.syncPurchaseOrderToGHL(poId);
      }

      const supplier = po.supplierId
        ? (await storage.getSupplier(po.supplierId)) || null
        : null;

      const supplierName = supplier?.name || po.supplierName || "Unknown Supplier";
      const name = ghlOpportunitiesService.buildPurchaseOrderName(po, supplierName);

      const result = await ghlOpportunitiesService.upsertOpportunity({
        externalKey: `po-${poId}`,
        name,
        pipelineStageId: GHL_CONFIG.stages.PO_DELIVERED,
        status: "won",
        amount: Number(po.total) || 0,
        customFields: {
          po_number: po.poNumber,
          po_status: "RECEIVED",
          delivered_at: new Date().toISOString(),
        },
        existingOpportunityId: po.ghlOpportunityId,
      });

      return result;
    } catch (error: any) {
      console.error("[PO GHL Sync] Error marking PO as delivered:", error);
      return { success: false, error: error.message };
    }
  }
}

export const poGHLSyncService = new POGHLSyncService();
