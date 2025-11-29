/**
 * GoHighLevel API Client
 * Handles communication with GHL API for CRM integration, contacts, and task/ticket management
 */

export interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  customFields?: Record<string, any>;
}

export interface GHLTask {
  id?: string;
  title: string;
  description?: string;
  contactId?: string;
  status?: string;
  assignedTo?: string;
  dueDate?: string;
  customFields?: Record<string, any>;
}

export interface GHLTaskCreatePayload {
  orderId?: string;
  returnId?: string;
  poId?: string;
  channel?: string;
  status?: string;
  notes?: string;
  [key: string]: any;
}

export class GoHighLevelClient {
  private baseUrl: string;
  private apiKey: string;
  private locationId: string;

  constructor(baseUrl: string, apiKey: string, locationId: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.locationId = locationId;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28', // GHL API version
    };
  }

  /**
   * Test the API connection
   * Returns detailed error codes for specific failure scenarios
   */
  async testConnection(): Promise<{ 
    success: boolean; 
    message: string; 
    errorCode?: 'INVALID_API_KEY' | 'INVALID_LOCATION_ID' | 'NETWORK_ERROR' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'UNKNOWN';
    locationName?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/locations/${this.locationId}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsedError: any = {};
        try {
          parsedError = JSON.parse(errorText);
        } catch { /* ignore parse errors */ }
        
        // Determine specific error code based on HTTP status
        if (response.status === 401) {
          return {
            success: false,
            message: 'Invalid API key. Please check your GoHighLevel API key and try again.',
            errorCode: 'INVALID_API_KEY',
          };
        }
        
        if (response.status === 403) {
          return {
            success: false,
            message: 'Access forbidden. Your API key may not have access to this location.',
            errorCode: 'INVALID_API_KEY',
          };
        }
        
        if (response.status === 404) {
          return {
            success: false,
            message: 'Location not found. Please verify your Location ID is correct.',
            errorCode: 'INVALID_LOCATION_ID',
          };
        }
        
        if (response.status === 429) {
          return {
            success: false,
            message: 'Rate limited. Too many requests. Please try again later.',
            errorCode: 'RATE_LIMITED',
          };
        }
        
        if (response.status >= 500) {
          return {
            success: false,
            message: `GoHighLevel server error (${response.status}). Please try again later.`,
            errorCode: 'SERVER_ERROR',
          };
        }

        return {
          success: false,
          message: parsedError.message || `GHL API error: ${response.status} ${response.statusText}`,
          errorCode: 'UNKNOWN',
        };
      }

      const data = await response.json();
      const locationName = data.location?.name || data.name || 'Unknown Location';
      
      return {
        success: true,
        message: `Connected successfully to ${locationName}`,
        locationName,
      };
    } catch (error: any) {
      // Network-level errors (DNS, timeout, etc.)
      if (error.cause?.code === 'ENOTFOUND' || error.cause?.code === 'ECONNREFUSED') {
        return {
          success: false,
          message: 'Network error. Unable to reach GoHighLevel API. Please check your internet connection.',
          errorCode: 'NETWORK_ERROR',
        };
      }
      
      if (error.name === 'AbortError' || error.cause?.code === 'ETIMEDOUT') {
        return {
          success: false,
          message: 'Connection timed out. GoHighLevel API is not responding.',
          errorCode: 'NETWORK_ERROR',
        };
      }
      
      return {
        success: false,
        message: error.message || 'Failed to connect to GoHighLevel API',
        errorCode: 'UNKNOWN',
      };
    }
  }

  /**
   * Fetch a contact by phone or email
   */
  async getContactByPhoneOrEmail(phone?: string, email?: string): Promise<GHLContact | null> {
    try {
      let searchQuery = '';
      if (email) {
        searchQuery = `email=${encodeURIComponent(email)}`;
      } else if (phone) {
        searchQuery = `phone=${encodeURIComponent(phone)}`;
      } else {
        throw new Error('Either phone or email must be provided');
      }

      const response = await fetch(
        `${this.baseUrl}/contacts?locationId=${this.locationId}&${searchQuery}`,
        {
          headers: this.getHeaders(),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoHighLevelClient] Failed to fetch contact:', errorText);
        return null;
      }

      const data = await response.json();
      const contacts = data.contacts || [];
      
      if (contacts.length === 0) {
        return null;
      }

      // Return first matching contact
      const contact = contacts[0];
      return {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        name: contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
        email: contact.email,
        phone: contact.phone,
        customFields: contact.customFields,
      };
    } catch (error: any) {
      console.error('[GoHighLevelClient] Error fetching contact:', error);
      return null;
    }
  }

  /**
   * Create a task/ticket for a return request
   */
  async createTask(title: string, description: string, payload: GHLTaskCreatePayload): Promise<{ success: boolean; taskId?: string; message: string }> {
    try {
      const taskData: any = {
        title,
        body: description,
        locationId: this.locationId,
        completed: false,
        assignedTo: payload.assignedTo,
      };

      // Add contact if available
      if (payload.contactId) {
        taskData.contactId = payload.contactId;
      }

      // Add custom fields if needed
      if (payload.orderId || payload.returnId || payload.poId) {
        taskData.customFields = {
          orderId: payload.orderId,
          returnId: payload.returnId,
          poId: payload.poId,
          channel: payload.channel,
          status: payload.status,
        };
      }

      const response = await fetch(`${this.baseUrl}/tasks`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(taskData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create task: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const taskId = data.task?.id || data.id;

      return {
        success: true,
        taskId,
        message: 'Task created successfully',
      };
    } catch (error: any) {
      console.error('[GoHighLevelClient] Error creating task:', error);
      return {
        success: false,
        message: error.message || 'Failed to create task',
      };
    }
  }

  /**
   * Send SMS message to a contact
   */
  async sendSMS(contactId: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/conversations/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          type: 'SMS',
          contactId,
          message,
          locationId: this.locationId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoHighLevelClient] Failed to send SMS:', errorText);
        return {
          success: false,
          error: `Failed to send SMS: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        messageId: data.messageId || data.id,
      };
    } catch (error: any) {
      console.error('[GoHighLevelClient] Error sending SMS:', error);
      return {
        success: false,
        error: error.message || 'Failed to send SMS',
      };
    }
  }

  /**
   * Send email to a contact
   */
  async sendEmail(
    contactId: string, 
    subject: string, 
    body: string,
    html?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/conversations/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          type: 'Email',
          contactId,
          subject,
          message: body,
          html: html || body,
          locationId: this.locationId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoHighLevelClient] Failed to send email:', errorText);
        return {
          success: false,
          error: `Failed to send email: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        messageId: data.messageId || data.id,
      };
    } catch (error: any) {
      console.error('[GoHighLevelClient] Error sending email:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email',
      };
    }
  }

  /**
   * Create or find a contact by email/phone
   */
  async createOrFindContact(
    name: string,
    email?: string,
    phone?: string
  ): Promise<{ success: boolean; contactId?: string; error?: string }> {
    try {
      // First try to find existing contact
      const existingContact = await this.getContactByPhoneOrEmail(phone, email);
      if (existingContact) {
        return {
          success: true,
          contactId: existingContact.id,
        };
      }

      // Create new contact
      const nameParts = name.split(' ');
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(' ') || '';

      const response = await fetch(`${this.baseUrl}/contacts`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          phone,
          locationId: this.locationId,
          source: 'Inventory Management System',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoHighLevelClient] Failed to create contact:', errorText);
        return {
          success: false,
          error: `Failed to create contact: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        contactId: data.contact?.id || data.id,
      };
    } catch (error: any) {
      console.error('[GoHighLevelClient] Error creating contact:', error);
      return {
        success: false,
        error: error.message || 'Failed to create contact',
      };
    }
  }

  /**
   * Create or update an opportunity in a pipeline
   * Used for draft PO creation from stock warnings
   */
  async createOpportunity(
    pipelineId: string,
    stageId: string,
    name: string,
    monetaryValue: number,
    notes: string,
    customFields?: Record<string, any>
  ): Promise<{ success: boolean; opportunityId?: string; opportunityUrl?: string; error?: string }> {
    try {
      const opportunityData: any = {
        pipelineId,
        pipelineStageId: stageId,
        name,
        monetaryValue,
        status: 'open',
        locationId: this.locationId,
      };

      // Add notes to the opportunity
      if (notes) {
        opportunityData.notes = notes;
      }

      // Add custom fields if provided
      if (customFields) {
        opportunityData.customFields = customFields;
      }

      const response = await fetch(`${this.baseUrl}/opportunities`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(opportunityData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoHighLevelClient] Failed to create opportunity:', errorText);
        return {
          success: false,
          error: `Failed to create opportunity: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const opportunityId = data.opportunity?.id || data.id;
      
      // Build deep link URL to the opportunity
      // GHL opportunity URL format: https://app.gohighlevel.com/v2/location/{locationId}/opportunities/{opportunityId}
      const opportunityUrl = `https://app.gohighlevel.com/v2/location/${this.locationId}/opportunities/${opportunityId}`;

      return {
        success: true,
        opportunityId,
        opportunityUrl,
      };
    } catch (error: any) {
      console.error('[GoHighLevelClient] Error creating opportunity:', error);
      return {
        success: false,
        error: error.message || 'Failed to create opportunity',
      };
    }
  }

  /**
   * Sync data (placeholder for future implementation)
   */
  async sync(): Promise<{ success: boolean; message: string }> {
    // For now, just test the connection as a sync placeholder
    return await this.testConnection();
  }

  // ============================================================================
  // V2 WEBHOOK PATH (FUTURE IMPLEMENTATION)
  // ============================================================================
  // 
  // V2 will add an alternative sending method via GHL Inbound Webhook:
  //
  // 1. Configuration:
  //    - Add gohighlevelInboundWebhookUrl to Settings (already exists, unused)
  //    - Add sendViaWebhook toggle to PO send options
  //
  // 2. Webhook-Based PO Send:
  //    async sendPOViaWebhook(webhookUrl: string, payload: {
  //      poNumber: string;
  //      supplierName: string;
  //      supplierEmail?: string;
  //      supplierPhone?: string;
  //      items: Array<{ sku: string; name: string; qty: number; unitPrice?: number }>;
  //      subject: string;
  //      emailBody: string;
  //      smsMessage: string;
  //      sendChannel: 'EMAIL' | 'SMS' | 'BOTH';
  //    }): Promise<{ success: boolean; webhookResponseId?: string; error?: string }> {
  //      // POST to webhook URL
  //      // GHL workflow handles contact creation and message sending
  //      // Return webhook response for tracking
  //    }
  //
  // 3. Benefits of V2 Webhook Path:
  //    - GHL workflows can add custom logic (delays, sequences, A/B testing)
  //    - Easier to modify message templates without code changes
  //    - Better integration with GHL's marketing automation
  //
  // 4. Keep Direct API as fallback:
  //    - If webhook fails or times out, fall back to sendEmail/sendSMS
  //    - Direct API remains available for simple, immediate sends
  //
  // ============================================================================
}
