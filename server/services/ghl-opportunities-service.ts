import { GHL_CONFIG } from "../config/ghl-config";
import { storage } from "../storage";
import type { PurchaseOrder, SalesOrder, Item } from "@shared/schema";

interface GHLOpportunityParams {
  externalKey: string;
  name: string;
  pipelineStageId: string;
  status: "open" | "won" | "lost";
  amount?: number;
  contact?: { name?: string; email?: string; phone?: string };
  customFields?: Record<string, any>;
  existingOpportunityId?: string | null;
}

interface GHLOpportunityResult {
  success: boolean;
  opportunityId?: string;
  opportunityUrl?: string;
  error?: string;
  created?: boolean;
  updated?: boolean;
}

export class GHLOpportunitiesService {
  private apiKey: string | null = null;

  private getHeaders(): Record<string, string> {
    if (!this.apiKey) {
      throw new Error("GHL API key not configured");
    }
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Version: "2021-07-28",
    };
  }

  async initialize(userId: string): Promise<boolean> {
    try {
      const config = await storage.getIntegrationConfig(userId, "GOHIGHLEVEL");
      if (!config?.apiKey) {
        console.log("[GHL Opps] No API key configured for user");
        return false;
      }
      this.apiKey = config.apiKey;
      return true;
    } catch (error) {
      console.error("[GHL Opps] Error initializing:", error);
      return false;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async upsertOpportunity(params: GHLOpportunityParams): Promise<GHLOpportunityResult> {
    if (!this.apiKey) {
      return { success: false, error: "GHL not configured" };
    }

    console.log(`[GHL Opps] Upserting opportunity: ${params.externalKey}, existing: ${params.existingOpportunityId || "none"}`);

    try {
      if (params.existingOpportunityId) {
        return await this.updateOpportunity(params.existingOpportunityId, params);
      } else {
        return await this.createOpportunity(params);
      }
    } catch (error: any) {
      console.error(`[GHL Opps] Error upserting opportunity ${params.externalKey}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  private async createOpportunity(params: GHLOpportunityParams): Promise<GHLOpportunityResult> {
    const body: Record<string, any> = {
      locationId: GHL_CONFIG.locationId,
      pipelineId: GHL_CONFIG.pipelineId,
      pipelineStageId: params.pipelineStageId,
      name: params.name,
      status: params.status,
    };

    if (params.amount !== undefined) {
      body.monetaryValue = params.amount;
    }

    if (params.contact) {
      if (params.contact.name) body.contactName = params.contact.name;
      if (params.contact.email) body.contactEmail = params.contact.email;
      if (params.contact.phone) body.contactPhone = params.contact.phone;
    }

    if (params.customFields) {
      body.customFields = Object.entries(params.customFields).map(([key, value]) => ({
        key,
        field_value: value,
      }));
    }

    console.log(`[GHL Opps] Creating opportunity: ${params.name}`);

    const response = await fetch(`${GHL_CONFIG.baseUrl}/opportunities/`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GHL Opps] Create failed: ${response.status} - ${errorText}`);
      return { success: false, error: `Create failed: ${response.status}` };
    }

    const data = await response.json();
    const opportunityId = data.opportunity?.id || data.id;
    const opportunityUrl = `https://app.gohighlevel.com/v2/location/${GHL_CONFIG.locationId}/opportunities/${opportunityId}`;

    console.log(`[GHL Opps] Created opportunity: ${opportunityId}`);

    return {
      success: true,
      opportunityId,
      opportunityUrl,
      created: true,
    };
  }

  private async updateOpportunity(opportunityId: string, params: GHLOpportunityParams): Promise<GHLOpportunityResult> {
    const body: Record<string, any> = {
      pipelineId: GHL_CONFIG.pipelineId,
      pipelineStageId: params.pipelineStageId,
      name: params.name,
      status: params.status,
    };

    if (params.amount !== undefined) {
      body.monetaryValue = params.amount;
    }

    if (params.customFields) {
      body.customFields = Object.entries(params.customFields).map(([key, value]) => ({
        key,
        field_value: value,
      }));
    }

    console.log(`[GHL Opps] Updating opportunity: ${opportunityId} to stage ${params.pipelineStageId}`);

    const response = await fetch(`${GHL_CONFIG.baseUrl}/opportunities/${opportunityId}`, {
      method: "PUT",
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GHL Opps] Update failed: ${response.status} - ${errorText}`);
      return { success: false, error: `Update failed: ${response.status}` };
    }

    const opportunityUrl = `https://app.gohighlevel.com/v2/location/${GHL_CONFIG.locationId}/opportunities/${opportunityId}`;

    console.log(`[GHL Opps] Updated opportunity: ${opportunityId}`);

    return {
      success: true,
      opportunityId,
      opportunityUrl,
      updated: true,
    };
  }

  buildSalesOrderName(order: SalesOrder): string {
    const channel = order.channel || "Unknown";
    const orderId = order.externalOrderId || order.id.slice(0, 8);
    return `Sales Order ${orderId} (${channel})`;
  }

  buildPurchaseOrderName(po: PurchaseOrder, supplierName?: string): string {
    const supplier = supplierName || po.supplierName || "Unknown Supplier";
    return `PO ${po.poNumber} – ${supplier}`;
  }

  buildStockRiskName(item: Item, daysLeft: number): string {
    const productName = item.name || item.sku;
    return `Stock risk – ${productName} (${daysLeft} days)`;
  }

  buildRefundName(order: SalesOrder): string {
    const orderId = order.externalOrderId || order.id.slice(0, 8);
    const customerName = order.customerName || "Customer";
    return `Refund – Order ${orderId} – ${customerName}`;
  }

  getStageForStockRisk(daysLeft: number): string | null {
    if (daysLeft <= 0) {
      return GHL_CONFIG.stages.STOCK_ORDER_NOW;
    } else if (daysLeft <= 14) {
      return GHL_CONFIG.stages.STOCK_14_21;
    } else if (daysLeft <= 30) {
      return GHL_CONFIG.stages.STOCK_21_30;
    }
    return null;
  }
}

export const ghlOpportunitiesService = new GHLOpportunitiesService();
