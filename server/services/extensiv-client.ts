/**
 * Extensiv API Client
 * Handles communication with Extensiv/Skubana warehouse management API
 */

export interface ExtensivWarehouse {
  id: string;
  name: string;
  code?: string;
}

export interface ExtensivItem {
  sku: string;
  name?: string;
  quantity: number;
  warehouseId: string;
  warehouseName?: string;
}

export interface ExtensivSyncResult {
  success: boolean;
  syncedItems: number;
  unmatchedSkus: string[];
  errors: string[];
  message: string;
}

export class ExtensivClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.skubana.com/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Test the API connection by fetching warehouses
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const warehouses = await this.getWarehouses();
      return {
        success: true,
        message: `Connected successfully. Found ${warehouses.length} warehouse(s).`,
      };
    } catch (error: any) {
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

      if (!response.ok) {
        throw new Error(`Extensiv API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Handle different response formats
      const warehouses = Array.isArray(data) ? data : (data.warehouses || data.data || []);
      
      return warehouses.map((w: any) => ({
        id: String(w.id || w.warehouseId || w.warehouse_id),
        name: w.name || w.warehouseName || w.warehouse_name || 'Unknown',
        code: w.code || w.warehouseCode,
      }));
    } catch (error: any) {
      throw new Error(`Failed to fetch warehouses: ${error.message}`);
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

      if (!response.ok) {
        throw new Error(`Extensiv API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Handle different response formats
      const items = Array.isArray(data) ? data : (data.items || data.inventory || data.data || []);
      
      return items.map((item: any) => ({
        sku: item.sku || item.SKU || item.productSku,
        name: item.name || item.productName || item.description,
        quantity: Number(item.quantity || item.onHand || item.available || 0),
        warehouseId: String(item.warehouseId || warehouseId),
        warehouseName: item.warehouseName,
      }));
    } catch (error: any) {
      throw new Error(`Failed to fetch inventory: ${error.message}`);
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
          source: 'return_processing',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.message || `Extensiv API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      return {
        success: true,
        message: `Successfully adjusted inventory for SKU ${sku} by ${quantityChange}`,
      };
    } catch (error: any) {
      console.error(`[Extensiv] Failed to adjust inventory for SKU ${sku}:`, error);
      throw new Error(`Failed to adjust inventory: ${error.message}`);
    }
  }
}
