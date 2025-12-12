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
  contactId?: string;
  customFields?: Record<string, any>;
  notes?: string;
  existingOpportunityId?: string | null;
}

const SYSTEM_CONTACT_EMAIL = "replit-admin@inventory.internal";
const SYSTEM_CONTACT_NAME = "Replit Admin";

interface GHLOpportunityResult {
  success: boolean;
  opportunityId?: string;
  opportunityUrl?: string;
  contactId?: string;
  error?: string;
  created?: boolean;
  updated?: boolean;
}

export class GHLOpportunitiesService {
  private apiKey: string | null = null;
  private systemContactId: string | null = null;

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

  /**
   * Find or create a system contact for internal notifications (like credential rotation reminders).
   * Returns the contactId for use in opportunity creation.
   */
  async getOrCreateSystemContact(): Promise<string | null> {
    if (this.systemContactId) {
      return this.systemContactId;
    }

    if (!this.apiKey) {
      console.error("[GHL Opps] Cannot get system contact: not configured");
      return null;
    }

    try {
      // First, search for an existing system contact by email
      const searchUrl = `${GHL_CONFIG.baseUrl}/contacts/search/duplicate?locationId=${GHL_CONFIG.locationId}&email=${encodeURIComponent(SYSTEM_CONTACT_EMAIL)}`;
      const searchResponse = await fetch(searchUrl, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.contact?.id) {
          console.log(`[GHL Opps] Found existing system contact: ${searchData.contact.id}`);
          this.systemContactId = searchData.contact.id;
          return this.systemContactId;
        }
      }

      // No existing contact found, create one
      console.log("[GHL Opps] Creating system contact for internal notifications");
      const createResponse = await fetch(`${GHL_CONFIG.baseUrl}/contacts/`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          locationId: GHL_CONFIG.locationId,
          firstName: "Replit",
          lastName: "Admin",
          name: SYSTEM_CONTACT_NAME,
          email: SYSTEM_CONTACT_EMAIL,
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error(`[GHL Opps] Failed to create system contact: ${createResponse.status} - ${errorText}`);
        return null;
      }

      const createData = await createResponse.json();
      this.systemContactId = createData.contact?.id || createData.id;
      console.log(`[GHL Opps] Created system contact: ${this.systemContactId}`);
      return this.systemContactId;
    } catch (error: any) {
      console.error("[GHL Opps] Error getting/creating system contact:", error.message);
      return null;
    }
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

    // GHL API requires contactId - look up or create contact from contact info
    if (params.contactId) {
      body.contactId = params.contactId;
    } else if (params.contact && (params.contact.email || params.contact.phone || params.contact.name)) {
      // Try to find or create a contact using the provided contact info
      const resolvedContactId = await this.findOrCreateContact(
        params.contact.name,
        params.contact.email,
        params.contact.phone
      );
      if (resolvedContactId) {
        body.contactId = resolvedContactId;
      } else {
        // Fall back to system contact if contact lookup/creation failed
        console.warn(`[GHL Opps] Could not find/create contact for ${params.contact.email || params.contact.phone}, using system contact`);
        const systemContactId = await this.getOrCreateSystemContact();
        if (systemContactId) {
          body.contactId = systemContactId;
        } else {
          return { success: false, error: "No contactId available" };
        }
      }
    } else {
      // Fall back to system contact if no contact info provided
      const systemContactId = await this.getOrCreateSystemContact();
      if (systemContactId) {
        body.contactId = systemContactId;
      } else {
        console.warn(`[GHL Opps] No contactId provided and unable to get system contact`);
        return { success: false, error: "No contactId available" };
      }
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

    console.log(`[GHL Opps] Created opportunity: ${opportunityId} with contact: ${body.contactId}`);

    return {
      success: true,
      opportunityId,
      opportunityUrl,
      contactId: body.contactId,
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

  /**
   * Normalize phone number to E.164 format for consistent matching
   * GHL expects +1XXXXXXXXXX for US numbers
   */
  private normalizePhone(phone?: string): string | null {
    if (!phone) return null;
    
    // Remove all non-numeric characters
    const digits = phone.replace(/\D/g, '');
    
    if (digits.length === 0) return null;
    
    // If it starts with 1 and is 11 digits, it's a US number with country code
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    
    // If it's 10 digits, assume US and add +1
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    
    // Otherwise, return with + prefix if not already
    return digits.length > 6 ? `+${digits}` : null;
  }

  /**
   * Find or create a contact by name, email, and/or phone
   * Returns the contactId if found/created, null otherwise
   */
  async findOrCreateContact(
    name?: string,
    email?: string,
    phone?: string
  ): Promise<string | null> {
    if (!this.apiKey) {
      return null;
    }

    // Normalize inputs
    const normalizedEmail = email?.toLowerCase().trim();
    const normalizedPhone = this.normalizePhone(phone);
    const normalizedName = name?.trim();

    try {
      // Search by email first, then phone, then name
      const searchQueries = [normalizedEmail, normalizedPhone, normalizedName].filter(Boolean);
      
      for (const query of searchQueries) {
        if (!query) continue;
        
        const searchUrl = `${GHL_CONFIG.baseUrl}/contacts/?locationId=${GHL_CONFIG.locationId}&query=${encodeURIComponent(query)}&limit=1`;
        const searchResponse = await fetch(searchUrl, {
          method: "GET",
          headers: this.getHeaders(),
        });

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          const contacts = searchData.contacts || [];
          if (contacts.length > 0) {
            const contactId = contacts[0].id;
            console.log(`[GHL Opps] Found existing contact ${contactId} for query: ${query}`);
            return contactId;
          }
        }
      }

      // No existing contact found - create a new one
      if (!normalizedName) {
        console.warn("[GHL Opps] Cannot create contact without name");
        return null;
      }

      const nameParts = normalizedName.split(' ');
      const firstName = nameParts[0] || normalizedName;
      const lastName = nameParts.slice(1).join(' ') || '';

      const contactData: Record<string, any> = {
        firstName,
        lastName,
        locationId: GHL_CONFIG.locationId,
        source: 'Inventory Management System',
      };

      // Only add email/phone if valid (use normalized versions)
      if (normalizedEmail && !normalizedEmail.endsWith('.local')) {
        contactData.email = normalizedEmail;
      }
      if (normalizedPhone) {
        contactData.phone = normalizedPhone;
      }

      console.log(`[GHL Opps] Creating new contact: ${firstName} ${lastName}`);

      const createResponse = await fetch(`${GHL_CONFIG.baseUrl}/contacts/`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(contactData),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error(`[GHL Opps] Failed to create contact: ${createResponse.status} - ${errorText}`);
        return null;
      }

      const createData = await createResponse.json();
      const contactId = createData.contact?.id || createData.id;
      console.log(`[GHL Opps] Created new contact: ${contactId}`);
      return contactId;
    } catch (error: any) {
      console.error("[GHL Opps] Error finding/creating contact:", error.message);
      return null;
    }
  }

  /**
   * Add a note to an opportunity via the GHL Notes API
   */
  async addNoteToOpportunity(contactId: string, opportunityId: string, noteBody: string): Promise<boolean> {
    if (!this.apiKey) {
      console.error("[GHL Opps] Cannot add note: not configured");
      return false;
    }

    try {
      console.log(`[GHL Opps] Adding note to opportunity ${opportunityId}`);
      
      const response = await fetch(`${GHL_CONFIG.baseUrl}/contacts/${contactId}/notes`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          body: noteBody,
          // Associate note with the opportunity
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[GHL Opps] Failed to add note: ${response.status} - ${errorText}`);
        return false;
      }

      console.log(`[GHL Opps] Added note to opportunity ${opportunityId}`);
      return true;
    } catch (error: any) {
      console.error("[GHL Opps] Error adding note:", error.message);
      return false;
    }
  }
}

export const ghlOpportunitiesService = new GHLOpportunitiesService();
