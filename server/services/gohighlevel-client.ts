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
      'Version': '2021-07-28', // GHL API v2 version header
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
   * Fetch a contact by phone or email using V2 API
   * V2 uses the `query` parameter for general search, not direct email/phone params
   */
  async getContactByPhoneOrEmail(phone?: string, email?: string): Promise<GHLContact | null> {
    try {
      // V2 API uses 'query' parameter for searching, not direct email/phone params
      const searchValue = email || phone;
      if (!searchValue) {
        console.log('[GoHighLevelClient] No email or phone provided for contact search');
        return null;
      }

      // Use the query parameter for V2 API contact search
      const response = await fetch(
        `${this.baseUrl}/contacts/?locationId=${this.locationId}&query=${encodeURIComponent(searchValue)}&limit=1`,
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
        console.log(`[GoHighLevelClient] No contact found for query: ${searchValue}`);
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
      console.log(`[GoHighLevelClient] createOrFindContact: name=${name}, email=${email}, phone=${phone}`);
      
      // First try to find existing contact
      const existingContact = await this.getContactByPhoneOrEmail(phone, email);
      if (existingContact) {
        console.log(`[GoHighLevelClient] Found existing contact: ${existingContact.id}`);
        return {
          success: true,
          contactId: existingContact.id,
        };
      }

      // Create new contact
      const nameParts = name.split(' ');
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(' ') || '';

      console.log(`[GoHighLevelClient] Creating new contact: ${firstName} ${lastName}`);
      
      const contactData: any = {
        firstName,
        lastName,
        locationId: this.locationId,
        source: 'Inventory Management System',
      };
      
      // Only add email/phone if valid (avoid .local domains)
      if (email && !email.endsWith('.local')) {
        contactData.email = email;
      }
      if (phone) {
        contactData.phone = phone;
      }

      // V2 API: POST to /contacts/ (with trailing slash)
      const response = await fetch(`${this.baseUrl}/contacts/`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(contactData),
      });

      const responseText = await response.text();
      console.log(`[GoHighLevelClient] Create contact response: ${response.status} - ${responseText.substring(0, 200)}`);

      if (!response.ok) {
        console.error('[GoHighLevelClient] Failed to create contact:', responseText);
        return {
          success: false,
          error: `Failed to create contact: ${response.status} - ${responseText.substring(0, 100)}`,
        };
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.error('[GoHighLevelClient] Failed to parse contact response:', responseText);
        return {
          success: false,
          error: 'Invalid response from GHL API',
        };
      }
      
      const contactId = data.contact?.id || data.id;
      console.log(`[GoHighLevelClient] Created contact with ID: ${contactId}`);
      
      return {
        success: true,
        contactId,
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
   * V2 API format - contactId is REQUIRED, customFields must be array of {key, value} objects
   */
  async createOpportunity(
    pipelineId: string,
    stageId: string,
    name: string,
    monetaryValue: number,
    notes: string,
    customFields?: Record<string, any>,
    contactId?: string
  ): Promise<{ success: boolean; opportunityId?: string; opportunityUrl?: string; error?: string }> {
    try {
      // V2 API requires contactId for opportunities
      if (!contactId) {
        console.error('[GoHighLevelClient] contactId is required for V2 opportunities');
        return {
          success: false,
          error: 'contactId is required to create an opportunity in GHL V2',
        };
      }

      const opportunityData: any = {
        pipelineId,
        pipelineStageId: stageId,
        name,
        monetaryValue,
        status: 'open',
        locationId: this.locationId,
        contactId, // Required for V2 API
      };

      // V2 API doesn't support notes directly - put them in the name if needed
      // Or we can skip notes for now as they're not a standard V2 field
      console.log(`[GoHighLevelClient] Creating opportunity: ${name} for contact ${contactId}`);

      // V2 API: customFields must be an array of {key, value} objects
      // Only add if we have meaningful custom fields to pass
      if (customFields && Object.keys(customFields).length > 0) {
        // Filter out undefined/null values and convert to V2 format
        const customFieldsArray = Object.entries(customFields)
          .filter(([_, value]) => value !== undefined && value !== null)
          .map(([key, value]) => ({
            key,
            field_value: String(value),
          }));
        
        if (customFieldsArray.length > 0) {
          opportunityData.customFields = customFieldsArray;
        }
      }

      const response = await fetch(`${this.baseUrl}/opportunities/`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(opportunityData),
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        console.error('[GoHighLevelClient] Failed to create opportunity:', responseText);
        let errorMessage = `${response.status} ${response.statusText}`;
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.message || errorData.error || errorMessage;
          if (Array.isArray(errorData.message)) {
            errorMessage = errorData.message.join(', ');
          }
        } catch { /* use default error message */ }
        return {
          success: false,
          error: `Failed to create opportunity: ${errorMessage}`,
        };
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.error('[GoHighLevelClient] Failed to parse opportunity response:', responseText);
        return {
          success: false,
          error: 'Invalid response from GHL API',
        };
      }
      
      const opportunityId = data.opportunity?.id || data.id;
      
      if (!opportunityId) {
        console.error('[GoHighLevelClient] No opportunity ID in response:', data);
        return {
          success: false,
          error: 'No opportunity ID returned from GHL API',
        };
      }
      
      // Build deep link URL to the opportunity
      // GHL opportunity URL format: https://app.gohighlevel.com/v2/location/{locationId}/opportunities/{opportunityId}
      const opportunityUrl = `https://app.gohighlevel.com/v2/location/${this.locationId}/opportunities/${opportunityId}`;

      console.log(`[GoHighLevelClient] Created opportunity: ${opportunityId}`);
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
   * Search for opportunities by name or custom field
   * V2 API: GET /opportunities/search
   */
  async searchOpportunities(
    pipelineId: string,
    searchTerm: string
  ): Promise<{ success: boolean; opportunities?: any[]; error?: string }> {
    try {
      // V2 API search endpoint with query parameter
      const params = new URLSearchParams({
        location_id: this.locationId,
        pipeline_id: pipelineId,
        q: searchTerm,
        limit: '100',
      });

      const response = await fetch(`${this.baseUrl}/opportunities/search?${params}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoHighLevelClient] Search opportunities failed:', errorText);
        return {
          success: false,
          error: `Search failed: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        opportunities: data.opportunities || [],
      };
    } catch (error: any) {
      console.error('[GoHighLevelClient] Error searching opportunities:', error);
      return {
        success: false,
        error: error.message || 'Failed to search opportunities',
      };
    }
  }

  /**
   * Update an existing opportunity
   * V2 API: PUT /opportunities/:id
   */
  async updateOpportunity(
    opportunityId: string,
    updates: {
      name?: string;
      monetaryValue?: number;
      pipelineStageId?: string;
      status?: string;
      customFields?: Record<string, any>;
    }
  ): Promise<{ success: boolean; opportunityId?: string; error?: string }> {
    try {
      const updateData: any = {};
      
      if (updates.name) updateData.name = updates.name;
      if (updates.monetaryValue !== undefined) updateData.monetaryValue = updates.monetaryValue;
      if (updates.pipelineStageId) updateData.pipelineStageId = updates.pipelineStageId;
      if (updates.status) updateData.status = updates.status;
      
      // V2 API: customFields must be an array of {key, field_value} objects
      if (updates.customFields && Object.keys(updates.customFields).length > 0) {
        const customFieldsArray = Object.entries(updates.customFields)
          .filter(([_, value]) => value !== undefined && value !== null)
          .map(([key, value]) => ({
            key,
            field_value: String(value),
          }));
        
        if (customFieldsArray.length > 0) {
          updateData.customFields = customFieldsArray;
        }
      }

      const response = await fetch(`${this.baseUrl}/opportunities/${opportunityId}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoHighLevelClient] Update opportunity failed:', errorText);
        return {
          success: false,
          error: `Update failed: ${response.status}`,
        };
      }

      console.log(`[GoHighLevelClient] Updated opportunity: ${opportunityId}`);
      return {
        success: true,
        opportunityId,
      };
    } catch (error: any) {
      console.error('[GoHighLevelClient] Error updating opportunity:', error);
      return {
        success: false,
        error: error.message || 'Failed to update opportunity',
      };
    }
  }

  /**
   * Delete an opportunity by ID
   */
  async deleteOpportunity(
    opportunityId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/opportunities/${opportunityId}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoHighLevelClient] Delete opportunity failed:', errorText);
        return {
          success: false,
          error: `Delete failed: ${response.status}`,
        };
      }

      console.log(`[GoHighLevelClient] Deleted opportunity: ${opportunityId}`);
      return { success: true };
    } catch (error: any) {
      console.error('[GoHighLevelClient] Error deleting opportunity:', error);
      return {
        success: false,
        error: error.message || 'Failed to delete opportunity',
      };
    }
  }

  /**
   * Get all opportunities in a pipeline (for cleanup)
   */
  async getAllOpportunitiesInPipeline(
    pipelineId: string
  ): Promise<{ success: boolean; opportunities?: any[]; error?: string }> {
    try {
      const allOpportunities: any[] = [];
      let hasMore = true;
      let startAfter: string | undefined;
      
      while (hasMore) {
        const params = new URLSearchParams({
          location_id: this.locationId,
          pipeline_id: pipelineId,
          limit: '100',
        });
        if (startAfter) {
          params.append('startAfter', startAfter);
        }

        const response = await fetch(`${this.baseUrl}/opportunities/search?${params}`, {
          method: 'GET',
          headers: this.getHeaders(),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[GoHighLevelClient] Get all opportunities failed:', errorText);
          return {
            success: false,
            error: `Failed to fetch opportunities: ${response.status}`,
          };
        }

        const data = await response.json();
        const opportunities = data.opportunities || [];
        allOpportunities.push(...opportunities);
        
        // Check if there are more results
        if (opportunities.length < 100) {
          hasMore = false;
        } else {
          startAfter = opportunities[opportunities.length - 1]?.id;
          if (!startAfter) hasMore = false;
        }
      }

      return {
        success: true,
        opportunities: allOpportunities,
      };
    } catch (error: any) {
      console.error('[GoHighLevelClient] Error getting all opportunities:', error);
      return {
        success: false,
        error: error.message || 'Failed to get opportunities',
      };
    }
  }

  /**
   * Create or update an opportunity - idempotent sync
   * Searches for existing opportunity by name, updates if found, creates if not
   */
  async createOrUpdateOpportunity(
    pipelineId: string,
    stageId: string,
    name: string,
    monetaryValue: number,
    notes: string,
    customFields?: Record<string, any>,
    contactId?: string,
    uniqueIdentifier?: string // Used for searching existing opportunities
  ): Promise<{ success: boolean; opportunityId?: string; opportunityUrl?: string; error?: string; action?: 'created' | 'updated' | 'skipped' }> {
    try {
      // V2 API requires contactId for opportunities
      if (!contactId) {
        console.error('[GoHighLevelClient] contactId is required for V2 opportunities');
        return {
          success: false,
          error: 'contactId is required to create an opportunity in GHL V2',
        };
      }

      // Search for existing opportunity by unique identifier or name
      const searchTerm = uniqueIdentifier || name;
      const searchResult = await this.searchOpportunities(pipelineId, searchTerm);
      
      if (searchResult.success && searchResult.opportunities && searchResult.opportunities.length > 0) {
        // Find exact match by name
        const existingOpp = searchResult.opportunities.find(
          (opp: any) => opp.name === name || opp.name?.includes(uniqueIdentifier || '')
        );
        
        if (existingOpp) {
          // Update existing opportunity
          console.log(`[GoHighLevelClient] Found existing opportunity: ${existingOpp.id}, updating...`);
          const updateResult = await this.updateOpportunity(existingOpp.id, {
            name,
            monetaryValue,
            pipelineStageId: stageId,
            customFields,
          });
          
          if (updateResult.success) {
            const opportunityUrl = `https://app.gohighlevel.com/v2/location/${this.locationId}/opportunities/${existingOpp.id}`;
            return {
              success: true,
              opportunityId: existingOpp.id,
              opportunityUrl,
              action: 'updated',
            };
          }
          // If update fails, continue to try creating
          console.warn('[GoHighLevelClient] Update failed, will try creating new:', updateResult.error);
        }
      }

      // Create new opportunity
      const result = await this.createOpportunity(
        pipelineId,
        stageId,
        name,
        monetaryValue,
        notes,
        customFields,
        contactId
      );

      return {
        ...result,
        action: result.success ? 'created' : undefined,
      };
    } catch (error: any) {
      console.error('[GoHighLevelClient] Error in createOrUpdate:', error);
      return {
        success: false,
        error: error.message || 'Failed to create or update opportunity',
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
