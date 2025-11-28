import { storage } from "../storage";
import { goHighLevelClient } from "./gohighlevel-client";
import type { ReturnRequest, Settings } from "@shared/schema";
import { ReturnStatus, ReturnEventType } from "@shared/schema";

interface GHLSyncResult {
  success: boolean;
  opportunityId?: string;
  opportunityUrl?: string;
  error?: string;
}

export class ReturnGHLSyncService {
  
  async syncReturnRefundTaskToGHL(returnId: string): Promise<GHLSyncResult> {
    console.log(`[ReturnGHLSync] Syncing return ${returnId} to GHL refund pipeline`);

    try {
      const returnRequest = await storage.getReturnRequest(returnId);
      if (!returnRequest) {
        return { success: false, error: "Return request not found" };
      }

      const settings = await this.getSettings();
      if (!settings) {
        return { success: false, error: "No settings configured" };
      }

      if (!settings.gohighlevelApiKey || !settings.gohighlevelLocationId) {
        console.log("[ReturnGHLSync] GHL not configured, skipping sync");
        return { success: false, error: "GoHighLevel not configured" };
      }

      const pipelineId = settings.gohighlevelReturnsPipelineId;
      const issueRefundStageId = settings.gohighlevelReturnsStageIssueRefundId;
      const refundedStageId = settings.gohighlevelReturnsStageRefundedId;

      if (!pipelineId) {
        console.log("[ReturnGHLSync] Returns pipeline not configured, skipping sync");
        return { success: false, error: "Returns pipeline not configured in settings" };
      }

      let salesOrder = null;
      if (returnRequest.salesOrderId) {
        salesOrder = await storage.getSalesOrder(returnRequest.salesOrderId);
      }

      let stageId: string | undefined;
      if (returnRequest.status === ReturnStatus.REFUND_ISSUE_PENDING) {
        stageId = issueRefundStageId || undefined;
      } else if (returnRequest.status === ReturnStatus.REFUNDED) {
        stageId = refundedStageId || undefined;
      }

      if (!stageId) {
        console.log(`[ReturnGHLSync] No stage configured for status ${returnRequest.status}`);
        return { success: false, error: `No GHL stage configured for ${returnRequest.status}` };
      }

      const opportunityName = `Issue refund – Order ${returnRequest.externalOrderId || returnRequest.orderNumber} – ${returnRequest.customerName}`;

      const items = await storage.getReturnItemsByRequestId(returnId);
      const itemsSummary = items.map(i => `${i.qtyRequested}x ${i.sku}`).join(", ");

      if (returnRequest.ghlRefundOpportunityId) {
        const updateResult = await this.updateOpportunity(
          returnRequest.ghlRefundOpportunityId,
          stageId,
          settings
        );
        
        if (updateResult.success) {
          await storage.createReturnEvent({
            returnRequestId: returnId,
            type: ReturnEventType.REFUND_TASK_CREATED,
            actor: 'system',
            message: `GHL opportunity updated to stage ${returnRequest.status}`,
            payload: { opportunityId: returnRequest.ghlRefundOpportunityId, stageId },
          });
        }

        return updateResult;
      }

      const createResult = await this.createOpportunity({
        name: opportunityName,
        pipelineId,
        stageId,
        contactId: returnRequest.ghlContactId || undefined,
        settings,
        metadata: {
          order_id: returnRequest.externalOrderId || returnRequest.orderNumber,
          rma_number: returnRequest.rmaNumber,
          channel: returnRequest.salesChannel,
          customer_name: returnRequest.customerName,
          customer_email: returnRequest.customerEmail,
          items: itemsSummary,
          reason: returnRequest.reason || returnRequest.reasonCode,
          return_id: returnId,
        },
      });

      if (createResult.success && createResult.opportunityId) {
        await storage.updateReturnRequest(returnId, {
          ghlRefundOpportunityId: createResult.opportunityId,
          ghlRefundOpportunityUrl: createResult.opportunityUrl,
        });

        await storage.createReturnEvent({
          returnRequestId: returnId,
          type: ReturnEventType.REFUND_TASK_CREATED,
          actor: 'system',
          message: `GHL "Issue refund" opportunity created`,
          payload: createResult,
        });
      }

      return createResult;

    } catch (error: any) {
      console.error("[ReturnGHLSync] Error syncing to GHL:", error);
      return { success: false, error: error.message };
    }
  }

  private async getSettings(): Promise<Settings | null> {
    const allSettings = await storage.getAllSettings();
    return allSettings[0] || null;
  }

  private async createOpportunity(params: {
    name: string;
    pipelineId: string;
    stageId: string;
    contactId?: string;
    settings: Settings;
    metadata: Record<string, any>;
  }): Promise<GHLSyncResult> {
    const { name, pipelineId, stageId, contactId, settings, metadata } = params;

    try {
      const payload: any = {
        name,
        pipelineId,
        pipelineStageId: stageId,
        status: "open",
      };

      if (contactId) {
        payload.contactId = contactId;
      }

      const baseUrl = settings.gohighlevelBaseUrl || "https://rest.gohighlevel.com";
      const response = await fetch(`${baseUrl}/v1/pipelines/${pipelineId}/opportunities`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${settings.gohighlevelApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("[ReturnGHLSync] Failed to create opportunity:", errorData);
        return { 
          success: false, 
          error: `GHL API error: ${response.status} ${JSON.stringify(errorData)}` 
        };
      }

      const result = await response.json();
      const opportunityId = result.opportunity?.id || result.id;
      
      const opportunityUrl = `https://app.gohighlevel.com/v2/location/${settings.gohighlevelLocationId}/opportunities/${opportunityId}`;

      console.log(`[ReturnGHLSync] Created GHL opportunity: ${opportunityId}`);

      return {
        success: true,
        opportunityId,
        opportunityUrl,
      };

    } catch (error: any) {
      console.error("[ReturnGHLSync] Error creating opportunity:", error);
      return { success: false, error: error.message };
    }
  }

  private async updateOpportunity(
    opportunityId: string,
    stageId: string,
    settings: Settings
  ): Promise<GHLSyncResult> {
    try {
      const baseUrl = settings.gohighlevelBaseUrl || "https://rest.gohighlevel.com";
      const response = await fetch(`${baseUrl}/v1/opportunities/${opportunityId}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${settings.gohighlevelApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pipelineStageId: stageId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("[ReturnGHLSync] Failed to update opportunity:", errorData);
        return { 
          success: false, 
          error: `GHL API error: ${response.status}` 
        };
      }

      console.log(`[ReturnGHLSync] Updated GHL opportunity ${opportunityId} to stage ${stageId}`);

      return {
        success: true,
        opportunityId,
        opportunityUrl: `https://app.gohighlevel.com/v2/location/${settings.gohighlevelLocationId}/opportunities/${opportunityId}`,
      };

    } catch (error: any) {
      console.error("[ReturnGHLSync] Error updating opportunity:", error);
      return { success: false, error: error.message };
    }
  }
}

export const returnGHLSyncService = new ReturnGHLSyncService();
