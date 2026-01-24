/**
 * Extensiv API Client
 * Handles communication with Extensiv/Skubana warehouse management API
 * Supports inventory reads, order push (two-way sync), and activity tracking
 */

export interface ExtensivWarehouse {
  id: string;
  name: string;
  code?: string;
}

export interface ExtensivItem {
  sku: string;
  name?: string;
  description?: string;
  quantity: number;
  warehouseId: string;
  warehouseName?: string;
  upc?: string;
  barcode?: string;
}

export interface ExtensivSyncResult {
  success: boolean;
  syncedItems: number;
  unmatchedSkus: string[];
  errors: string[];
  message: string;
}

// Order line item for creating fulfillment orders
export interface ExtensivOrderLineItem {
  sku: string;
  quantity: number;
  unitPrice?: number;
  description?: string;
}

// Shipping address for orders
export interface ExtensivShippingAddress {
  name: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
  email?: string;
}

// Request to create an outbound fulfillment order
export interface CreateExtensivOrderRequest {
  externalOrderId: string; // Our sales order ID
  channel: string; // SHOPIFY, AMAZON, DIRECT, etc.
  warehouseId: string;
  shippingAddress: ExtensivShippingAddress;
  lineItems: ExtensivOrderLineItem[];
  shippingMethod?: string;
  notes?: string;
}

// Response from creating an order
export interface ExtensivOrderResponse {
  orderId: string;
  status: string; // PENDING, PROCESSING, SHIPPED, CANCELLED
  createdAt?: string;
  trackingNumber?: string;
  carrier?: string;
}

// Activity/shipment record from Extensiv
export interface ExtensivActivity {
  orderId: string;
  externalOrderId?: string;
  type: 'SHIPMENT' | 'RECEIPT' | 'ADJUSTMENT' | 'RETURN';
  status: string;
  sku?: string;
  quantity?: number;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: string;
  createdAt: string;
}

// Error codes for structured error handling
export const ExtensivErrorCode = {
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  WAREHOUSE_NOT_FOUND: 'WAREHOUSE_NOT_FOUND',
  SKU_NOT_FOUND: 'SKU_NOT_FOUND',
  INSUFFICIENT_INVENTORY: 'INSUFFICIENT_INVENTORY',
  ORDER_CREATION_FAILED: 'ORDER_CREATION_FAILED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ExtensivErrorCode = typeof ExtensivErrorCode[keyof typeof ExtensivErrorCode];

export class ExtensivApiError extends Error {
  code: ExtensivErrorCode;
  statusCode?: number;
  details?: any;

  constructor(code: ExtensivErrorCode, message: string, statusCode?: number, details?: any) {
    super(message);
    this.name = 'ExtensivApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export interface ExtensivCredentials {
  clientId: string;
  clientSecret: string;
  orgKey?: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

// In-memory token cache (keyed by clientId)
const tokenCache: Map<string, TokenCache> = new Map();

export class ExtensivClient {
  private clientId: string;
  private clientSecret: string;
  private orgKey?: string;
  private baseUrl: string;
  private defaultWarehouseId?: string;

  constructor(
    credentials: ExtensivCredentials | string, 
    baseUrl: string = 'https://api-hub.extensiv.com', 
    defaultWarehouseId?: string
  ) {
    // Support legacy string API key for backward compatibility
    if (typeof credentials === 'string') {
      // Legacy mode: treat as pre-obtained bearer token
      this.clientId = '';
      this.clientSecret = credentials;
      this.orgKey = undefined;
    } else {
      this.clientId = credentials.clientId;
      this.clientSecret = credentials.clientSecret;
      this.orgKey = credentials.orgKey;
    }
    this.baseUrl = baseUrl;
    this.defaultWarehouseId = defaultWarehouseId;
  }

  /**
   * Clear the cached token (call on auth failures)
   */
  public clearCachedToken(): void {
    if (this.clientId) {
      tokenCache.delete(this.clientId);
      console.log(`[Extensiv] Cleared cached token for client ${this.clientId.substring(0, 4)}...`);
    }
  }

  /**
   * Get OAuth2 access token using client credentials
   * Tokens are cached for 7 hours (expire at 8 hours)
   */
  private async getAccessToken(): Promise<string> {
    // If using legacy mode (direct token), return it
    if (!this.clientId && this.clientSecret) {
      return this.clientSecret;
    }

    // Check cache first
    const cached = tokenCache.get(this.clientId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.accessToken;
    }

    // Validate required credentials
    if (!this.orgKey) {
      throw new ExtensivApiError(
        ExtensivErrorCode.AUTHENTICATION_FAILED,
        'Organization Key (orgkey) is required for Extensiv OAuth2 authentication. Please add it in Settings.',
        undefined
      );
    }

    // Request new token from Extensiv Hub API
    const authUrl = `${this.baseUrl}/auth/token/token`;
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    
    // Build query params - orgKey is required
    const params = new URLSearchParams();
    params.set('orgkey', this.orgKey);
    
    const fullUrl = `${authUrl}?${params.toString()}`;
    
    try {
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ExtensivApiError(
          ExtensivErrorCode.AUTHENTICATION_FAILED,
          errorData?.message || `Token exchange failed: ${response.status} ${response.statusText}`,
          response.status,
          errorData
        );
      }

      const data = await response.json();
      const accessToken = data.access_token || data.token || data;
      
      if (!accessToken || typeof accessToken !== 'string') {
        throw new ExtensivApiError(
          ExtensivErrorCode.AUTHENTICATION_FAILED,
          'Token response did not contain a valid access token',
          response.status,
          data
        );
      }

      // Cache token for 7 hours (tokens expire at 8 hours)
      const expiresAt = Date.now() + (7 * 60 * 60 * 1000);
      tokenCache.set(this.clientId, { accessToken, expiresAt });
      
      console.log(`[Extensiv] Obtained new access token, expires in 7 hours`);
      return accessToken;
    } catch (error) {
      if (error instanceof ExtensivApiError) throw error;
      throw new ExtensivApiError(
        ExtensivErrorCode.CONNECTION_FAILED,
        `Failed to connect to Extensiv auth endpoint: ${(error as Error).message}`,
        undefined,
        error
      );
    }
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const accessToken = await this.getAccessToken();
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private mapStatusCode(statusCode: number): ExtensivErrorCode {
    switch (statusCode) {
      case 401:
      case 403:
        return ExtensivErrorCode.AUTHENTICATION_FAILED;
      case 429:
        return ExtensivErrorCode.RATE_LIMITED;
      case 404:
        return ExtensivErrorCode.WAREHOUSE_NOT_FOUND;
      case 400:
        return ExtensivErrorCode.INVALID_REQUEST;
      default:
        return ExtensivErrorCode.UNKNOWN_ERROR;
    }
  }

  private async handleResponse(response: Response, operation: string): Promise<any> {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const code = this.mapStatusCode(response.status);
      
      // Clear cached token on auth failures so retry will get a new token
      if (response.status === 401 || response.status === 403) {
        this.clearCachedToken();
      }
      
      throw new ExtensivApiError(
        code,
        errorData?.message || `Extensiv API error during ${operation}: ${response.status} ${response.statusText}`,
        response.status,
        errorData
      );
    }
    return response.json();
  }

  /**
   * Execute an API request with automatic retry on auth failures
   * Clears token cache and retries once if we get a 401/403
   */
  private async executeWithRetry<T>(
    requestFn: () => Promise<T>,
    operation: string
  ): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      if (error instanceof ExtensivApiError && 
          (error.statusCode === 401 || error.statusCode === 403)) {
        // Token was already cleared in handleResponse, retry once with fresh token
        console.log(`[Extensiv] Auth failure during ${operation}, retrying with fresh token...`);
        try {
          return await requestFn();
        } catch (retryError) {
          console.error(`[Extensiv] Retry failed for ${operation}`);
          throw retryError;
        }
      }
      throw error;
    }
  }

  /**
   * Test the API connection by fetching warehouses
   */
  async testConnection(): Promise<{ success: boolean; message: string; warehouses?: ExtensivWarehouse[] }> {
    try {
      const warehouses = await this.getWarehouses();
      return {
        success: true,
        message: `Connected successfully. Found ${warehouses.length} warehouse(s).`,
        warehouses,
      };
    } catch (error: any) {
      if (error instanceof ExtensivApiError) {
        return {
          success: false,
          message: `Connection failed: ${error.message} (${error.code})`,
        };
      }
      return {
        success: false,
        message: error.message || 'Failed to connect to Extensiv API',
      };
    }
  }

  /**
   * Fetch all warehouses from Extensiv
   */
  async getWarehouses(): Promise<ExtensivWarehouse[]> {
    return this.executeWithRetry(async () => {
      try {
        const response = await fetch(`${this.baseUrl}/warehouses`, {
          headers: await this.getHeaders(),
        });

        const data = await this.handleResponse(response, 'getWarehouses');
        
        // Handle different response formats
        const warehouses = Array.isArray(data) ? data : (data.warehouses || data.data || []);
        
        return warehouses.map((w: any) => ({
          id: String(w.id || w.warehouseId || w.warehouse_id),
          name: w.name || w.warehouseName || w.warehouse_name || 'Unknown',
          code: w.code || w.warehouseCode,
        }));
      } catch (error: any) {
        if (error instanceof ExtensivApiError) throw error;
        throw new ExtensivApiError(
          ExtensivErrorCode.CONNECTION_FAILED,
          `Failed to fetch warehouses: ${error.message}`
        );
      }
    }, 'getWarehouses');
  }

  /**
   * Fetch inventory for a specific warehouse
   * @param warehouseId - The warehouse ID to fetch inventory for
   * @param page - Page number for pagination (default: 1)
   * @param limit - Number of items per page (default: 100)
   */
  async getInventory(warehouseId: string, page: number = 1, limit: number = 100): Promise<ExtensivItem[]> {
    return this.executeWithRetry(async () => {
      try {
        const url = `${this.baseUrl}/inventory?warehouseId=${warehouseId}&page=${page}&limit=${limit}`;
        const response = await fetch(url, {
          headers: await this.getHeaders(),
        });

        const data = await this.handleResponse(response, 'getInventory');
        
        // Handle different response formats
        const items = Array.isArray(data) ? data : (data.items || data.inventory || data.data || []);
        
        return items.map((item: any) => ({
          sku: item.sku || item.SKU || item.productSku || item.itemCode,
          name: item.name || item.productName,
          description: item.description,
          quantity: Number(item.quantity || item.onHand || item.available || item.availableQuantity || 0),
          warehouseId: String(item.warehouseId || warehouseId),
          warehouseName: item.warehouseName,
          upc: item.upc || item.UPC || item.barcode,
          barcode: item.barcode || item.upc,
        }));
      } catch (error: any) {
        if (error instanceof ExtensivApiError) throw error;
        throw new ExtensivApiError(
          ExtensivErrorCode.CONNECTION_FAILED,
          `Failed to fetch inventory: ${error.message}`
        );
      }
    }, 'getInventory');
  }

  /**
   * Fetch all inventory for a warehouse with pagination
   */
  async getAllInventory(warehouseId: string): Promise<ExtensivItem[]> {
    const allItems: ExtensivItem[] = [];
    let page = 1;
    const limit = 100;
    
    while (true) {
      const items = await this.getInventory(warehouseId, page, limit);
      allItems.push(...items);
      
      // If we got fewer items than the limit, we've reached the end
      if (items.length < limit) {
        break;
      }
      
      page++;
      
      // Safety limit to prevent infinite loops
      if (page > 100) {
        console.warn('[Extensiv] Reached page limit (100 pages), stopping pagination');
        break;
      }
    }
    
    return allItems;
  }

  /**
   * Fetch item master (all products) from Extensiv for SKU mapping
   * Returns detailed product information including UPC for auto-matching
   */
  async getItemMaster(warehouseId?: string): Promise<ExtensivItem[]> {
    const wid = warehouseId || this.defaultWarehouseId;
    if (!wid) {
      throw new ExtensivApiError(
        ExtensivErrorCode.WAREHOUSE_NOT_FOUND,
        'No warehouse ID provided for item master fetch'
      );
    }
    return this.getAllInventory(wid);
  }

  /**
   * Verify multiple SKUs exist in Extensiv inventory
   * Returns an object with found and missing SKUs
   */
  async verifySkus(skus: string[]): Promise<{ found: string[]; missing: string[]; error?: string }> {
    try {
      // First get warehouses
      const warehouses = await this.getWarehouses();
      if (warehouses.length === 0) {
        return { 
          found: [], 
          missing: skus, 
          error: 'No warehouses found in Extensiv' 
        };
      }

      // Collect all SKUs across all warehouses
      const extensivSkus = new Set<string>();
      for (const warehouse of warehouses) {
        const items = await this.getAllInventory(warehouse.id);
        for (const item of items) {
          if (item.sku) {
            extensivSkus.add(item.sku);
          }
        }
      }
      
      // Categorize input SKUs
      const found: string[] = [];
      const missing: string[] = [];
      
      for (const sku of skus) {
        if (extensivSkus.has(sku)) {
          found.push(sku);
        } else {
          missing.push(sku);
        }
      }
      
      return { found, missing };
    } catch (error: any) {
      return { 
        found: [], 
        missing: skus, 
        error: error.message || 'Failed to verify SKUs in Extensiv' 
      };
    }
  }

  /**
   * Create an outbound fulfillment order in Extensiv
   * 
   * V1 MODE: DISABLED - Extensiv is READ-ONLY
   * This method is disabled for V1 to enforce read-only integration with Extensiv.
   * Orders should be pushed to Extensiv through their native integrations (Shopify, etc.)
   * 
   * @param request - Order details including shipping address and line items
   */
  async createOrder(request: CreateExtensivOrderRequest): Promise<ExtensivOrderResponse> {
    // V1: Extensiv is READ-ONLY - do not push orders
    console.warn(`[Extensiv] createOrder DISABLED for V1 read-only mode. Order ${request.externalOrderId} not pushed to Extensiv.`);
    
    // Return a mock response indicating the operation was skipped
    return {
      orderId: `LOCAL-${request.externalOrderId}`,
      status: 'SKIPPED_V1_READONLY',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Get order status from Extensiv
   * @param orderId - Extensiv order ID
   */
  async getOrderStatus(orderId: string): Promise<ExtensivOrderResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/orders/${orderId}`, {
        headers: await this.getHeaders(),
      });

      const data = await this.handleResponse(response, 'getOrderStatus');
      
      return {
        orderId: String(data.orderId || data.id),
        status: data.status || data.orderStatus,
        createdAt: data.createdAt,
        trackingNumber: data.trackingNumber || data.tracking?.number,
        carrier: data.carrier || data.tracking?.carrier,
      };
    } catch (error: any) {
      if (error instanceof ExtensivApiError) throw error;
      throw new ExtensivApiError(
        ExtensivErrorCode.UNKNOWN_ERROR,
        `Failed to get order status: ${error.message}`
      );
    }
  }

  /**
   * Fetch recent activity (shipments, adjustments) from Extensiv
   * Used for syncing order statuses and inventory changes
   * @param warehouseId - Optional warehouse ID to filter by
   * @param since - Optional date to fetch activity since
   * @param limit - Number of records to fetch (default: 100)
   */
  async getActivity(
    warehouseId?: string,
    since?: Date,
    limit: number = 100
  ): Promise<ExtensivActivity[]> {
    try {
      let url = `${this.baseUrl}/activity?limit=${limit}`;
      if (warehouseId) {
        url += `&warehouseId=${warehouseId}`;
      }
      if (since) {
        url += `&since=${since.toISOString()}`;
      }

      const response = await fetch(url, {
        headers: await this.getHeaders(),
      });

      const data = await this.handleResponse(response, 'getActivity');
      
      // Handle different response formats
      const activities = Array.isArray(data) ? data : (data.activities || data.activity || data.data || []);
      
      return activities.map((a: any) => ({
        orderId: String(a.orderId || a.order_id || a.id),
        externalOrderId: a.externalOrderId || a.external_order_id || a.referenceNumber,
        type: this.mapActivityType(a.type || a.activityType),
        status: a.status || a.orderStatus || 'UNKNOWN',
        sku: a.sku,
        quantity: a.quantity ? Number(a.quantity) : undefined,
        trackingNumber: a.trackingNumber || a.tracking_number,
        carrier: a.carrier,
        shippedAt: a.shippedAt || a.shipped_at,
        createdAt: a.createdAt || a.created_at || new Date().toISOString(),
      }));
    } catch (error: any) {
      if (error instanceof ExtensivApiError) throw error;
      throw new ExtensivApiError(
        ExtensivErrorCode.CONNECTION_FAILED,
        `Failed to fetch activity: ${error.message}`
      );
    }
  }

  private mapActivityType(type: string): ExtensivActivity['type'] {
    const typeMap: Record<string, ExtensivActivity['type']> = {
      'shipment': 'SHIPMENT',
      'ship': 'SHIPMENT',
      'shipped': 'SHIPMENT',
      'receipt': 'RECEIPT',
      'receive': 'RECEIPT',
      'received': 'RECEIPT',
      'adjustment': 'ADJUSTMENT',
      'adjust': 'ADJUSTMENT',
      'return': 'RETURN',
      'rma': 'RETURN',
    };
    return typeMap[type?.toLowerCase()] || 'ADJUSTMENT';
  }

  /**
   * Get shipments for specific order IDs
   * Used to update sales order statuses after fulfillment
   * @param orderIds - Array of Extensiv order IDs to check
   */
  async getShipmentsForOrders(orderIds: string[]): Promise<Map<string, ExtensivActivity>> {
    const shipments = new Map<string, ExtensivActivity>();
    
    try {
      // Fetch recent activity and filter for shipments
      const activity = await this.getActivity(undefined, undefined, 500);
      
      for (const act of activity) {
        if (act.type === 'SHIPMENT' && orderIds.includes(act.orderId)) {
          shipments.set(act.orderId, act);
        }
      }
    } catch (error) {
      console.error('[Extensiv] Error fetching shipments for orders:', error);
    }
    
    return shipments;
  }

  /**
   * Adjust inventory quantity for a SKU at a warehouse (for returns, corrections, etc.)
   * 
   * V1 MODE: DISABLED - Extensiv is READ-ONLY
   * This method is disabled for V1 to enforce read-only integration with Extensiv.
   * Inventory adjustments should be made directly in Extensiv's interface.
   * 
   * @param warehouseId - The warehouse ID or location code
   * @param sku - The SKU to adjust
   * @param quantityChange - The quantity to add (positive) or subtract (negative)
   * @param reason - Reason for adjustment (e.g., "Return received", "Damaged goods")
   */
  async adjustInventory(
    warehouseId: string,
    sku: string,
    quantityChange: number,
    reason: string = 'Inventory adjustment'
  ): Promise<{ success: boolean; message: string }> {
    // V1: Extensiv is READ-ONLY - do not push adjustments
    console.warn(`[Extensiv] adjustInventory DISABLED for V1 read-only mode. SKU ${sku} adjustment of ${quantityChange} not pushed to Extensiv.`);
    
    return {
      success: false,
      message: `V1 READ-ONLY: Inventory adjustments to Extensiv are disabled. Adjust directly in Extensiv. (SKU: ${sku}, qty: ${quantityChange})`,
    };
  }

  /**
   * Cancel an order in Extensiv
   * 
   * V1 MODE: DISABLED - Extensiv is READ-ONLY
   * This method is disabled for V1 to enforce read-only integration with Extensiv.
   * Order cancellations should be made directly in Extensiv's interface.
   * 
   * @param orderId - Extensiv order ID to cancel
   * @param reason - Reason for cancellation
   */
  async cancelOrder(orderId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    // V1: Extensiv is READ-ONLY - do not push cancellations
    console.warn(`[Extensiv] cancelOrder DISABLED for V1 read-only mode. Order ${orderId} cancellation not pushed to Extensiv.`);
    
    return {
      success: false,
      message: `V1 READ-ONLY: Order cancellations to Extensiv are disabled. Cancel directly in Extensiv. (Order: ${orderId})`,
    };
  }
}
