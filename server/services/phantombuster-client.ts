/**
 * PhantomBuster API Client
 * Handles communication with PhantomBuster API for supplier discovery
 */

import { AuditLogger } from "./audit-logger";

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

export interface SupplierDiscoveryParams {
  keywords: string;
  location?: string;
  tags?: string[];
  notes?: string;
}

export interface NormalizedSupplierLead {
  name: string;
  companyName?: string;
  websiteUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  location?: string;
  source: string;
  tags?: string[];
  notes?: string;
  rawData: any;
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

  /**
   * Launch a supplier discovery job using a configured phantom
   * Returns containerId for tracking the job
   */
  async launchDiscoveryJob(
    agentId: string,
    params: SupplierDiscoveryParams
  ): Promise<{ success: boolean; containerId?: string; message: string }> {
    try {
      // Log discovery start
      await AuditLogger.logEvent({
        source: 'PHANTOMBUSTER',
        eventType: 'SUPPLIER_DISCOVERY_STARTED',
        entityType: 'SUPPLIER_LEAD',
        status: 'INFO',
        description: `Starting supplier discovery for: ${params.keywords}`,
        details: {
          agentId,
          keywords: params.keywords,
          location: params.location,
          tags: params.tags,
        },
      });

      // Prepare the search arguments for the phantom
      // This format works with most PhantomBuster search phantoms (LinkedIn, Google, etc.)
      const argument = {
        search: params.keywords,
        numberOfResultsPerSearch: 20, // Limit results
        ...(params.location && { location: params.location }),
      };

      const result = await this.launchPhantom(agentId, {
        argument: JSON.stringify(argument),
        saveArgument: false,
      });

      if (!result) {
        await AuditLogger.logEvent({
          source: 'PHANTOMBUSTER',
          eventType: 'SUPPLIER_DISCOVERY_FAILED',
          entityType: 'SUPPLIER_LEAD',
          status: 'ERROR',
          description: 'Failed to launch PhantomBuster discovery job',
          details: { agentId, error: 'No result from launchPhantom' },
        });
        return {
          success: false,
          message: 'Failed to launch PhantomBuster discovery job',
        };
      }

      return {
        success: true,
        containerId: result.containerId,
        message: `Discovery job launched. Container ID: ${result.containerId}`,
      };
    } catch (error: any) {
      console.error('[PhantomBusterClient] Error launching discovery job:', error);
      await AuditLogger.logEvent({
        source: 'PHANTOMBUSTER',
        eventType: 'SUPPLIER_DISCOVERY_FAILED',
        entityType: 'SUPPLIER_LEAD',
        status: 'ERROR',
        description: 'Error launching discovery job',
        details: { agentId, error: error.message },
      });
      return {
        success: false,
        message: error.message || 'Failed to launch discovery job',
      };
    }
  }

  /**
   * Poll for discovery results and normalize them into supplier leads
   */
  async pollDiscoveryResults(
    agentId: string,
    containerId: string,
    params: SupplierDiscoveryParams
  ): Promise<{ success: boolean; leads: NormalizedSupplierLead[]; message: string }> {
    try {
      // Poll for completion (max 60 seconds, checking every 3 seconds)
      const result = await this.pollForCompletion(agentId, containerId, 20, 3000);

      if (!result) {
        return {
          success: false,
          leads: [],
          message: 'Discovery job timed out or failed',
        };
      }

      if (result.status === 'error') {
        await AuditLogger.logEvent({
          source: 'PHANTOMBUSTER',
          eventType: 'SUPPLIER_DISCOVERY_FAILED',
          entityType: 'SUPPLIER_LEAD',
          status: 'ERROR',
          description: 'PhantomBuster discovery job failed',
          details: { agentId, containerId, error: result.output },
        });
        return {
          success: false,
          leads: [],
          message: 'Discovery job failed: ' + (result.output || 'Unknown error'),
        };
      }

      // Parse and normalize the results
      const leads = this.parseDiscoveryResults(result, params);

      await AuditLogger.logEvent({
        source: 'PHANTOMBUSTER',
        eventType: 'SUPPLIER_DISCOVERY_COMPLETED',
        entityType: 'SUPPLIER_LEAD',
        status: 'INFO',
        description: `Supplier discovery completed. Found ${leads.length} leads.`,
        details: {
          agentId,
          containerId,
          leadCount: leads.length,
          keywords: params.keywords,
        },
      });

      return {
        success: true,
        leads,
        message: `Found ${leads.length} supplier leads`,
      };
    } catch (error: any) {
      console.error('[PhantomBusterClient] Error polling discovery results:', error);
      return {
        success: false,
        leads: [],
        message: error.message || 'Failed to poll discovery results',
      };
    }
  }

  /**
   * Parse PhantomBuster results into normalized supplier leads
   * This handles various output formats from different phantoms
   */
  private parseDiscoveryResults(
    result: PhantomResult,
    params: SupplierDiscoveryParams
  ): NormalizedSupplierLead[] {
    const leads: NormalizedSupplierLead[] = [];

    try {
      // Results could be in resultObject, output, or as a JSON string
      let rawResults: any[] = [];

      if (result.resultObject) {
        rawResults = Array.isArray(result.resultObject) 
          ? result.resultObject 
          : [result.resultObject];
      } else if (result.output) {
        // Try to parse output as JSON if it's a string
        if (typeof result.output === 'string') {
          try {
            const parsed = JSON.parse(result.output);
            rawResults = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            // If parsing fails, treat as single result
            rawResults = [{ name: result.output }];
          }
        } else if (Array.isArray(result.output)) {
          rawResults = result.output;
        }
      }

      // Normalize each result into a supplier lead
      for (const raw of rawResults) {
        if (!raw) continue;

        // Extract common fields from various phantom output formats
        const lead: NormalizedSupplierLead = {
          name: this.extractField(raw, ['name', 'fullName', 'companyName', 'title', 'displayName']) || 'Unknown',
          companyName: this.extractField(raw, ['companyName', 'company', 'organization', 'businessName']),
          websiteUrl: this.extractField(raw, ['websiteUrl', 'website', 'url', 'link', 'companyUrl']),
          contactEmail: this.extractField(raw, ['email', 'contactEmail', 'emailAddress', 'mail']),
          contactPhone: this.extractField(raw, ['phone', 'contactPhone', 'phoneNumber', 'telephone']),
          location: this.extractField(raw, ['location', 'city', 'address', 'country', 'region']) || params.location,
          source: this.determineSource(raw),
          tags: params.tags || [],
          notes: params.notes,
          rawData: raw,
        };

        // Skip entries without meaningful data
        if (lead.name !== 'Unknown' || lead.companyName || lead.websiteUrl || lead.contactEmail) {
          leads.push(lead);
        }
      }
    } catch (error: any) {
      console.error('[PhantomBusterClient] Error parsing discovery results:', error);
    }

    return leads;
  }

  /**
   * Extract a field value from an object using multiple possible field names
   */
  private extractField(obj: any, fieldNames: string[]): string | undefined {
    for (const field of fieldNames) {
      if (obj[field]) {
        return String(obj[field]).trim();
      }
    }
    return undefined;
  }

  /**
   * Determine the source type based on the raw data
   */
  private determineSource(raw: any): string {
    const url = raw.profileUrl || raw.url || raw.link || '';
    const urlLower = url.toLowerCase();

    if (urlLower.includes('linkedin')) {
      return 'PHANTOMBUSTER_LINKEDIN';
    } else if (urlLower.includes('google') || raw.searchEngine === 'google') {
      return 'PHANTOMBUSTER_GOOGLE';
    } else if (urlLower.includes('facebook')) {
      return 'PHANTOMBUSTER_FACEBOOK';
    } else if (urlLower.includes('twitter') || urlLower.includes('x.com')) {
      return 'PHANTOMBUSTER_TWITTER';
    }

    return 'PHANTOMBUSTER';
  }

  /**
   * Get list of available phantoms/agents
   */
  async getAgents(): Promise<{ success: boolean; agents: PhantomAgent[]; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/agents/fetch-all`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`PhantomBuster API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const agents: PhantomAgent[] = (data || []).map((agent: any) => ({
        id: agent.id,
        name: agent.name || 'Unnamed Agent',
        status: agent.status || 'unknown',
        lastEndStatus: agent.lastEndStatus,
      }));

      return {
        success: true,
        agents,
        message: `Found ${agents.length} agents`,
      };
    } catch (error: any) {
      console.error('[PhantomBusterClient] Error fetching agents:', error);
      return {
        success: false,
        agents: [],
        message: error.message || 'Failed to fetch agents',
      };
    }
  }
}

/**
 * Check if PhantomBuster is configured
 */
export function isPhantomBusterConfigured(): boolean {
  return !!process.env.PHANTOMBUSTER_API_KEY;
}

/**
 * Get configured PhantomBuster client
 */
export function getPhantomBusterClient(): PhantomBusterClient | null {
  const apiKey = process.env.PHANTOMBUSTER_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new PhantomBusterClient(apiKey);
}
