/**
 * Intuit OAuth2 Discovery Document Service
 * 
 * Fetches and caches OAuth2 endpoints from Intuit's OpenID Connect Discovery Document
 * per Intuit compliance requirements (Question 5).
 * 
 * Instead of hardcoding OAuth endpoints, we dynamically fetch them from:
 * https://developer.api.intuit.com/.well-known/openid_configuration
 * 
 * This ensures compliance and allows Intuit to update endpoints without breaking integrations.
 */

export interface IntuitDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  revocation_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  scopes_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  claims_supported: string[];
}

interface CachedDiscovery {
  document: IntuitDiscoveryDocument;
  fetchedAt: number;
  expiresAt: number;
}

const DISCOVERY_URL = 'https://developer.api.intuit.com/.well-known/openid_configuration';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Cache for 24 hours
const FETCH_TIMEOUT_MS = 10000; // 10 second timeout
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

let cachedDiscovery: CachedDiscovery | null = null;

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch the Intuit Discovery Document with retry logic
 */
async function fetchDiscoveryDocument(): Promise<IntuitDiscoveryDocument> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      
      const response = await fetch(DISCOVERY_URL, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`Discovery document fetch failed: ${response.status} ${response.statusText}`);
      }
      
      const document = await response.json() as IntuitDiscoveryDocument;
      
      // Validate required fields
      if (!document.authorization_endpoint || !document.token_endpoint) {
        throw new Error('Discovery document missing required endpoints');
      }
      
      console.log('[Intuit Discovery] Successfully fetched OAuth2 endpoints from discovery document');
      return document;
    } catch (error: any) {
      lastError = error;
      console.warn(`[Intuit Discovery] Attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);
      
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
        await sleep(delay);
      }
    }
  }
  
  throw new Error(`Failed to fetch Intuit discovery document after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

/**
 * Get the Intuit Discovery Document (cached)
 * 
 * Fetches from cache if available and not expired, otherwise fetches fresh.
 * This should be called before any OAuth2 operations to get dynamic endpoints.
 */
export async function getIntuitDiscoveryDocument(): Promise<IntuitDiscoveryDocument> {
  const now = Date.now();
  
  // Return cached document if still valid
  if (cachedDiscovery && cachedDiscovery.expiresAt > now) {
    return cachedDiscovery.document;
  }
  
  // Fetch fresh document
  const document = await fetchDiscoveryDocument();
  
  // Cache the document
  cachedDiscovery = {
    document,
    fetchedAt: now,
    expiresAt: now + CACHE_TTL_MS,
  };
  
  return document;
}

/**
 * Get the authorization endpoint URL
 */
export async function getAuthorizationEndpoint(): Promise<string> {
  const doc = await getIntuitDiscoveryDocument();
  return doc.authorization_endpoint;
}

/**
 * Get the token endpoint URL
 */
export async function getTokenEndpoint(): Promise<string> {
  const doc = await getIntuitDiscoveryDocument();
  return doc.token_endpoint;
}

/**
 * Get the userinfo endpoint URL
 */
export async function getUserInfoEndpoint(): Promise<string> {
  const doc = await getIntuitDiscoveryDocument();
  return doc.userinfo_endpoint;
}

/**
 * Get the revocation endpoint URL
 */
export async function getRevocationEndpoint(): Promise<string> {
  const doc = await getIntuitDiscoveryDocument();
  return doc.revocation_endpoint;
}

/**
 * Clear the cached discovery document (for testing or forced refresh)
 */
export function clearDiscoveryCache(): void {
  cachedDiscovery = null;
  console.log('[Intuit Discovery] Cache cleared');
}

/**
 * Check if discovery document is cached and valid
 */
export function isDiscoveryCached(): boolean {
  return !!(cachedDiscovery && cachedDiscovery.expiresAt > Date.now());
}

/**
 * Get cache status for debugging/monitoring
 */
export function getDiscoveryCacheStatus(): {
  cached: boolean;
  fetchedAt: Date | null;
  expiresAt: Date | null;
  endpoints?: {
    authorization: string;
    token: string;
    userinfo: string;
    revocation: string;
  };
} {
  if (!cachedDiscovery) {
    return { cached: false, fetchedAt: null, expiresAt: null };
  }
  
  return {
    cached: true,
    fetchedAt: new Date(cachedDiscovery.fetchedAt),
    expiresAt: new Date(cachedDiscovery.expiresAt),
    endpoints: {
      authorization: cachedDiscovery.document.authorization_endpoint,
      token: cachedDiscovery.document.token_endpoint,
      userinfo: cachedDiscovery.document.userinfo_endpoint,
      revocation: cachedDiscovery.document.revocation_endpoint,
    },
  };
}
