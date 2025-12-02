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

export class ExtensivClient {
  private apiKey: string;
  private baseUrl: string;
  private defaultWarehouseId?: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.skubana.com/v1', defaultWarehouseId?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.defaultWarehouseId = defaultWarehouseId;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
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
    try {
      const response = await fetch(`${this.baseUrl}/warehouses`, {
        headers: this.getHeaders(),
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
  }

  /**
   * Fetch inventory for a specific warehouse
   * @param warehouseId - The warehouse ID to fetch inventory for
   * @param page - Page number for pagination (default: 1)
   * @param limit - Number of items per page (default: 100)
   */
  async getInventory(warehouseId: string, page: number = 1, limit: number = 100): Promise<ExtensivItem[]> {
    try {
      const url = `${this.baseUrl}/inventory?warehouseId=${warehouseId}&page=${page}&limit=${limit}`;
      const response = await fetch(url, {
        headers: this.getHeaders(),
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
   * This pushes a sales order to the 3PL for fulfillment
   * @param request - Order details including shipping address and line items
   */
  async createOrder(request: CreateExtensivOrderRequest): Promise<ExtensivOrderResponse> {
    try {
      const payload = {
        externalOrderId: request.externalOrderId,
        orderSource: request.channel,
        warehouseId: request.warehouseId,
        shipTo: {
          name: request.shippingAddress.name,
          company: request.shippingAddress.company,
          address1: request.shippingAddress.street1,
          address2: request.shippingAddress.street2,
          city: request.shippingAddress.city,
          state: request.shippingAddress.state,
          postalCode: request.shippingAddress.postalCode,
          country: request.shippingAddress.country,
          phone: request.shippingAddress.phone,
          email: request.shippingAddress.email,
        },
        items: request.lineItems.map(item => ({
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          description: item.description,
        })),
        shippingMethod: request.shippingMethod,
        notes: request.notes,
      };

      const response = await fetch(`${this.baseUrl}/orders`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      const data = await this.handleResponse(response, 'createOrder');
      
      return {
        orderId: String(data.orderId || data.id || data.order?.id),
        status: data.status || data.orderStatus || 'PENDING',
        createdAt: data.createdAt || data.created_at,
        trackingNumber: data.trackingNumber,
        carrier: data.carrier,
      };
    } catch (error: any) {
      if (error instanceof ExtensivApiError) throw error;
      throw new ExtensivApiError(
        ExtensivErrorCode.ORDER_CREATION_FAILED,
        `Failed to create order: ${error.message}`
      );
    }
  }

  /**
   * Get order status from Extensiv
   * @param orderId - Extensiv order ID
   */
  async getOrderStatus(orderId: string): Promise<ExtensivOrderResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/orders/${orderId}`, {
        headers: this.getHeaders(),
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
        headers: this.getHeaders(),
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
    try {
      const response = await fetch(`${this.baseUrl}/inventory/adjust`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          warehouseId,
          sku,
          quantityChange,
          reason,
          source: 'inventory_app',
        }),
      });

      await this.handleResponse(response, 'adjustInventory');
      
      return {
        success: true,
        message: `Successfully adjusted inventory for SKU ${sku} by ${quantityChange}`,
      };
    } catch (error: any) {
      if (error instanceof ExtensivApiError) {
        return {
          success: false,
          message: `Failed to adjust inventory: ${error.message} (${error.code})`,
        };
      }
      return {
        success: false,
        message: `Failed to adjust inventory: ${error.message}`,
      };
    }
  }

  /**
   * Cancel an order in Extensiv
   * @param orderId - Extensiv order ID to cancel
   * @param reason - Reason for cancellation
   */
  async cancelOrder(orderId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ reason }),
      });

      await this.handleResponse(response, 'cancelOrder');
      
      return {
        success: true,
        message: `Successfully cancelled order ${orderId}`,
      };
    } catch (error: any) {
      if (error instanceof ExtensivApiError) {
        return {
          success: false,
          message: `Failed to cancel order: ${error.message} (${error.code})`,
        };
      }
      return {
        success: false,
        message: `Failed to cancel order: ${error.message}`,
      };
    }
  }
}
