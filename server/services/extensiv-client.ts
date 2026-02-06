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
    baseUrl: string = 'https://secure-wms.com', 
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
        'User Login (GUID) is required for Extensiv API authentication. Please add it in Settings.',
        undefined
      );
    }

    // Request token from 3PL Warehouse Manager API at secure-wms.com
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    
    const maskedClientId = this.clientId ? `${this.clientId.substring(0, 8)}...${this.clientId.slice(-4)}` : 'MISSING';
    const maskedSecret = this.clientSecret ? `${this.clientSecret.substring(0, 4)}...(${this.clientSecret.length} chars)` : 'MISSING';
    console.log(`[Extensiv Auth] Client ID: ${maskedClientId}, Secret: ${maskedSecret}, GUID: ${this.orgKey}`);
    
    const authUrl = 'https://secure-wms.com/AuthServer/api/Token';
    
    try {
      const response = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          user_login: this.orgKey,
        }),
      });

      console.log(`[Extensiv Auth] Response: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let errorData: any = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { rawResponse: errorText };
        }
        console.log(`[Extensiv Auth] Error:`, JSON.stringify(errorData, null, 2));
        throw new ExtensivApiError(
          ExtensivErrorCode.AUTHENTICATION_FAILED,
          errorData?.Message || errorData?.message || errorData?.error || `Token exchange failed: ${response.status} ${response.statusText}`,
          response.status,
          errorData
        );
      }

      const data = await response.json();
      const accessToken = data.access_token;
      
      if (!accessToken || typeof accessToken !== 'string') {
        throw new ExtensivApiError(
          ExtensivErrorCode.AUTHENTICATION_FAILED,
          'Token response did not contain a valid access_token',
          response.status,
          data
        );
      }
      
      // Cache token for 25 minutes (tokens typically expire at 30-60 minutes per Extensiv docs)
      const expiresAt = Date.now() + (25 * 60 * 1000);
      tokenCache.set(this.clientId, { accessToken, expiresAt });
      
      console.log(`[Extensiv] Obtained access token, cached for 25 minutes`);
      return accessToken;
    } catch (error) {
      if (error instanceof ExtensivApiError) throw error;
      throw new ExtensivApiError(
        ExtensivErrorCode.CONNECTION_FAILED,
        `Failed to connect to Extensiv auth server: ${(error as Error).message}`,
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
   * Fetch all customers (warehouses) from Extensiv 3PL WMS
   * In 3PL WMS, "customers" represent the warehouse accounts
   */
  async getWarehouses(): Promise<ExtensivWarehouse[]> {
    return this.executeWithRetry(async () => {
      try {
        const response = await fetch(`${this.baseUrl}/customers`, {
          headers: await this.getHeaders(),
        });

        const data = await this.handleResponse(response, 'getWarehouses');
        
        // 3PL WMS returns an array of customer objects or a ResourceList wrapper
        const customers = Array.isArray(data) 
          ? data 
          : (data.ResourceList || data.customers || data.data || []);
        
        console.log(`[Extensiv] Fetched ${customers.length} customer(s) from 3PL WMS`);
        
        return customers.map((c: any) => ({
          id: String(c.customerID || c.customerId || c.customer_id || c.id),
          name: c.companyName || c.name || c.customerName || 'Unknown',
          code: c.externalId || c.code,
        }));
      } catch (error: any) {
        if (error instanceof ExtensivApiError) throw error;
        throw new ExtensivApiError(
          ExtensivErrorCode.CONNECTION_FAILED,
          `Failed to fetch customers/warehouses: ${error.message}`
        );
      }
    }, 'getWarehouses');
  }

  /**
   * Fetch inventory for a specific customer (warehouse) using stock summaries
   * @param warehouseId - The customer ID in 3PL WMS
   * @param page - Page number for pagination (default: 1)
   * @param limit - Number of items per page (default: 100)
   */
  async getInventory(warehouseId: string, page: number = 1, limit: number = 100): Promise<ExtensivItem[]> {
    return this.executeWithRetry(async () => {
      try {
        // Use stock-summaries endpoint for aggregated inventory by customer
        const params = new URLSearchParams({
          customerid: warehouseId,
          pgsiz: String(limit),
          pgnum: String(page),
        });
        const url = `${this.baseUrl}/inventory?${params.toString()}`;
        console.log(`[Extensiv] Fetching inventory: ${url}`);
        const response = await fetch(url, {
          headers: await this.getHeaders(),
        });

        const data = await this.handleResponse(response, 'getInventory');
        
        // Handle ResourceList wrapper or direct array
        const items = Array.isArray(data) 
          ? data 
          : (data.ResourceList || data.items || data.inventory || data.data || []);
        
        console.log(`[Extensiv] Got ${items.length} inventory items (page ${page})`);
        
        return items.map((item: any) => ({
          sku: item.itemIdentifier?.sku || item.sku || item.SKU || item.itemCode || '',
          name: item.itemIdentifier?.description || item.description || item.name || item.productName || '',
          description: item.itemIdentifier?.description || item.description || '',
          quantity: Number(item.onHandQty || item.onHand || item.availableQty || item.quantity || item.available || 0),
          warehouseId: String(item.facilityId || item.warehouseId || warehouseId),
          warehouseName: item.facilityName || item.warehouseName || '',
          upc: item.itemIdentifier?.upc || item.upc || item.UPC || '',
          barcode: item.itemIdentifier?.upc || item.barcode || item.upc || '',
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
   * Fetch all inventory for a customer with pagination
   */
  async getAllInventory(warehouseId: string): Promise<ExtensivItem[]> {
    const allItems: ExtensivItem[] = [];
    let page = 1;
    const limit = 100;
    
    while (true) {
      const items = await this.getInventory(warehouseId, page, limit);
      allItems.push(...items);
      
      if (items.length < limit) {
        break;
      }
      
      page++;
      
      if (page > 100) {
        console.warn('[Extensiv] Reached page limit (100 pages), stopping pagination');
        break;
      }
    }
    
    console.log(`[Extensiv] Total inventory items fetched: ${allItems.length}`);
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
