/**
 * GoHighLevel client — extracted from monolith gohighlevel-client.ts.
 * Stripped to: sendSMS. Nothing else.
 *
 * Env vars: GHL_API_KEY, GHL_LOCATION_ID
 */

export class GHLClient {
  private baseUrl = 'https://services.leadconnectorhq.com';
  private apiKey: string;
  private locationId: string;

  constructor(apiKey: string, locationId: string) {
    this.apiKey = apiKey;
    this.locationId = locationId;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    };
  }

  async sendSMS(
    contactId: string,
    message: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/conversations/messages`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          type: 'SMS',
          contactId,
          message,
          locationId: this.locationId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `GHL SMS failed: ${response.status} ${errorText}` };
      }

      const data = await response.json();
      return { success: true, messageId: data.messageId || data.id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
