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
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/locations/${this.locationId}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GHL API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const locationName = data.location?.name || data.name || 'Unknown Location';
      
      return {
        success: true,
        message: `Connected successfully to ${locationName}`,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to connect to GoHighLevel API',
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
   * Sync data (placeholder for future implementation)
   */
  async sync(): Promise<{ success: boolean; message: string }> {
    // For now, just test the connection as a sync placeholder
    return await this.testConnection();
  }
}
