import { GoHighLevelClient } from "./gohighlevel-client";
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
  private getGHLClient(): GoHighLevelClient | null {
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    
    if (!apiKey || !locationId) {
      return null;
    }
    
    return new GoHighLevelClient(
      "https://services.leadconnectorhq.com",
      apiKey,
      locationId
    );
  }

  private getPOPipelineId(): string | null {
    return process.env.GHL_PO_PIPELINE_ID || null;
  }

  private getPOStageSentId(): string | null {
    return process.env.GHL_PO_STAGE_SENT_ID || null;
  }

  private getPOStagePaidId(): string | null {
    return process.env.GHL_PO_STAGE_PAID_ID || null;
  }

  private getPOStageScannedId(): string | null {
    return process.env.GHL_PO_STAGE_SCANNED_ID || null;
  }

  isConfigured(): boolean {
    return !!(
      this.getGHLClient() &&
      this.getPOPipelineId() &&
      this.getPOStageSentId()
    );
  }

  getConfigurationStatus(): {
    configured: boolean;
    hasApiKey: boolean;
    hasLocationId: boolean;
    hasPipelineId: boolean;
    hasSentStageId: boolean;
  } {
    return {
      configured: this.isConfigured(),
      hasApiKey: !!process.env.GHL_API_KEY,
      hasLocationId: !!process.env.GHL_LOCATION_ID,
      hasPipelineId: !!this.getPOPipelineId(),
      hasSentStageId: !!this.getPOStageSentId(),
    };
  }

  private getStageIdForStatus(status: string): string | null {
    switch (status) {
      case "SENT":
      case "PARTIAL_RECEIVED":
        return this.getPOStageSentId();
      case "RECEIVED":
      case "CLOSED":
        return this.getPOStageScannedId() || this.getPOStageSentId();
      default:
        return this.getPOStageSentId();
    }
  }

  async syncPurchaseOrderToGHL(poId: string): Promise<GHLSyncResult> {
    console.log(`[PO GHL Sync] Starting sync for PO: ${poId}`);

    if (!this.isConfigured()) {
      console.log("[PO GHL Sync] GHL not configured - skipping sync");
      return {
        success: false,
        error: "GHL integration not configured. Set GHL_API_KEY, GHL_LOCATION_ID, GHL_PO_PIPELINE_ID, and GHL_PO_STAGE_SENT_ID.",
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

      const client = this.getGHLClient()!;
      const pipelineId = this.getPOPipelineId()!;
      const stageId = this.getStageIdForStatus(po.status) || this.getPOStageSentId()!;

      const supplierName = supplier?.name || po.supplierName || "Unknown Supplier";
      const opportunityName = `PO ${po.poNumber} – ${supplierName}`;
      const monetaryValue = Number(po.total) || 0;

      const notes = this.buildOpportunityNotes(po, supplier);

      const customFields: Record<string, any> = {
        po_number: po.poNumber,
        po_total: monetaryValue,
        po_status: po.status,
        supplier_name: supplierName,
        last_email_sent_at: po.lastEmailSentAt
          ? new Date(po.lastEmailSentAt).toISOString()
          : null,
      };

      if (po.ghlOpportunityId) {
        console.log(`[PO GHL Sync] Updating existing opportunity: ${po.ghlOpportunityId}`);
        
        const updateResult = await this.updateOpportunity(
          client,
          po.ghlOpportunityId,
          {
            name: opportunityName,
            pipelineStageId: stageId,
            monetaryValue,
            notes,
            customFields,
          }
        );

        if (updateResult.success) {
          console.log(`[PO GHL Sync] Successfully updated opportunity: ${po.ghlOpportunityId}`);
          return {
            success: true,
            opportunityId: po.ghlOpportunityId,
            opportunityUrl: `https://app.gohighlevel.com/v2/location/${process.env.GHL_LOCATION_ID}/opportunities/${po.ghlOpportunityId}`,
            updated: true,
          };
        } else {
          console.error(`[PO GHL Sync] Failed to update opportunity: ${updateResult.error}`);
        }
      }

      console.log(`[PO GHL Sync] Creating new opportunity for PO: ${po.poNumber}`);
      
      const createResult = await client.createOpportunity(
        pipelineId,
        stageId,
        opportunityName,
        monetaryValue,
        notes,
        customFields
      );

      if (!createResult.success) {
        console.error(`[PO GHL Sync] Failed to create opportunity: ${createResult.error}`);
        return {
          success: false,
          error: createResult.error || "Failed to create GHL opportunity",
        };
      }

      console.log(`[PO GHL Sync] Created new opportunity: ${createResult.opportunityId}`);

      await storage.updatePurchaseOrder(poId, {
        ghlOpportunityId: createResult.opportunityId,
      });

      return {
        success: true,
        opportunityId: createResult.opportunityId,
        opportunityUrl: createResult.opportunityUrl,
        created: true,
      };
    } catch (error: any) {
      console.error("[PO GHL Sync] Error syncing PO to GHL:", error);
      return {
        success: false,
        error: error.message || "Failed to sync with GHL",
      };
    }
  }

  private buildOpportunityNotes(po: PurchaseOrder, supplier: Supplier | null): string {
    const lines: string[] = [];
    
    lines.push(`Purchase Order: ${po.poNumber}`);
    lines.push(`Supplier: ${supplier?.name || po.supplierName || "Unknown"}`);
    lines.push(`Status: ${po.status}`);
    lines.push(`Total: $${(Number(po.total) || 0).toFixed(2)} ${po.currency || "USD"}`);
    
    if (po.orderDate) {
      lines.push(`Order Date: ${new Date(po.orderDate).toLocaleDateString()}`);
    }
    
    if (po.expectedDate) {
      lines.push(`Expected Delivery: ${new Date(po.expectedDate).toLocaleDateString()}`);
    }
    
    if (po.lastEmailSentAt) {
      lines.push(`PO Emailed: ${new Date(po.lastEmailSentAt).toLocaleString()}`);
      lines.push(`Sent To: ${po.emailTo || po.supplierEmail || supplier?.email || "N/A"}`);
    }
    
    lines.push("");
    lines.push("---");
    lines.push("Managed via Replit Inventory Management System");
    
    return lines.join("\n");
  }

  private async updateOpportunity(
    client: GoHighLevelClient,
    opportunityId: string,
    data: {
      name: string;
      pipelineStageId: string;
      monetaryValue: number;
      notes: string;
      customFields: Record<string, any>;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(
        `https://services.leadconnectorhq.com/opportunities/${opportunityId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${process.env.GHL_API_KEY}`,
            "Content-Type": "application/json",
            Version: "2021-07-28",
          },
          body: JSON.stringify({
            name: data.name,
            pipelineStageId: data.pipelineStageId,
            monetaryValue: data.monetaryValue,
            notes: data.notes,
            customFields: data.customFields,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `GHL API error: ${response.status} - ${errorText}`,
        };
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to update opportunity",
      };
    }
  }
}

export const poGHLSyncService = new POGHLSyncService();
