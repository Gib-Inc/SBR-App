/**
 * PhantomBuster API Client
 * Handles communication with PhantomBuster API for supplier/product data enrichment
 */

export interface PhantomAgent {
  id: string;
  name: string;
  status: string;
  lastEndStatus?: string;
}

export interface PhantomLaunchPayload {
  argument?: Record<string, any> | string;
  bonusArgument?: Record<string, any>;
  saveArgument?: boolean;
}

export interface PhantomLaunchResult {
  containerId: string;
  queuedAt: string;
}

export interface PhantomResult {
  containerId: string;
  status: string;
  progress?: number;
  output?: any;
  resultObject?: any;
}

export class PhantomBusterClient {
  private apiKey: string;
  private baseUrl: string = 'https://api.phantombuster.com/api/v2';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private getHeaders(): Record<string, string> {
    return {
      'X-Phantombuster-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Test the API connection by fetching user/agent info
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/agents/fetch-all`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`PhantomBuster API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const agentCount = data.length || 0;
      
      return {
        success: true,
        message: `Connected successfully. Found ${agentCount} phantoms.`,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to connect to PhantomBuster API',
      };
    }
  }

  /**
   * Launch a phantom by ID with optional payload
   */
  async launchPhantom(agentId: string, payload?: PhantomLaunchPayload): Promise<PhantomLaunchResult | null> {
    try {
      const requestBody = payload || {};
      
      const response = await fetch(`${this.baseUrl}/agents/launch`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          id: agentId,
          ...requestBody,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PhantomBusterClient] Failed to launch phantom:', errorText);
        return null;
      }

      const data = await response.json();
      return {
        containerId: data.containerId,
        queuedAt: data.queuedAt,
      };
    } catch (error: any) {
      console.error('[PhantomBusterClient] Error launching phantom:', error);
      return null;
    }
  }

  /**
   * Fetch result of a phantom execution
   */
  async fetchOutput(agentId: string, containerId: string): Promise<PhantomResult | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/agents/fetch-output?id=${agentId}&mode=track&withoutResultObject=false`,
        {
          headers: this.getHeaders(),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PhantomBusterClient] Failed to fetch output:', errorText);
        return null;
      }

      const data = await response.json();
      
      // Find the specific container result if multiple exist
      const containerResult = data.containers?.find((c: any) => c.containerId === containerId) || data;

      return {
        containerId: containerResult.containerId || containerId,
        status: containerResult.status || 'unknown',
        progress: containerResult.progress,
        output: containerResult.output,
        resultObject: containerResult.resultObject,
      };
    } catch (error: any) {
      console.error('[PhantomBusterClient] Error fetching output:', error);
      return null;
    }
  }

  /**
   * Poll for phantom completion (with timeout)
   */
  async pollForCompletion(
    agentId: string,
    containerId: string,
    maxAttempts: number = 20,
    intervalMs: number = 3000
  ): Promise<PhantomResult | null> {
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      const result = await this.fetchOutput(agentId, containerId);
      
      if (!result) {
        return null;
      }

      // Check if completed
      if (result.status === 'success' || result.status === 'error') {
        return result;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      attempts++;
    }

    console.log('[PhantomBusterClient] Polling timed out after', maxAttempts, 'attempts');
    return null;
  }

  /**
   * Sync data (placeholder for future implementation)
   */
  async sync(): Promise<{ success: boolean; message: string }> {
    // For now, just test the connection as a sync placeholder
    return await this.testConnection();
  }
}
