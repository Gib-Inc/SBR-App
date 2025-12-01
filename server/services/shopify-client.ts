/**
 * Shopify API Client
 * Handles communication with Shopify Admin API for order syncing
 */

export interface ShopifyOrder {
  id: string | number;
  name: string; // Order number like "#1001"
  email?: string;
  phone?: string;
  financial_status: string; // paid, pending, refunded, etc.
  fulfillment_status: string | null; // fulfilled, partial, null
  created_at: string;
  updated_at: string;
  total_price?: string;
  currency?: string;
  customer?: {
    id?: string | number;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  line_items: Array<{
    id: string | number;
    sku?: string;
    name: string;
    quantity: number;
    price: string;
  }>;
}

export interface ShopifyNormalizedOrder {
  externalOrderId: string;
  externalCustomerId?: string;
  channel: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  status: string;
  orderDate: Date;
  expectedDeliveryDate?: Date;
  sourceUrl?: string;
  totalAmount?: number;
  currency?: string;
  rawPayload: any;
  lineItems: Array<{
    sku: string;
    qtyOrdered: number;
    unitPrice: number;
  }>;
}

export class ShopifyClient {
  private shopDomain: string;
  private accessToken: string;
  private apiVersion: string;

  constructor(shopDomain: string, accessToken: string, apiVersion: string = '2024-01') {
    this.shopDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
  }

  private getHeaders(): Record<string, string> {
    return {
      'X-Shopify-Access-Token': this.accessToken,
      'Content-Type': 'application/json',
    };
  }

  private getBaseUrl(): string {
    return `https://${this.shopDomain}/admin/api/${this.apiVersion}`;
  }

  /**
   * Test the API connection by fetching shop info
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/shop.json`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const shopName = data.shop?.name || 'Unknown Shop';
      
      return {
        success: true,
        message: `Connected successfully to ${shopName}`,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to connect to Shopify API',
      };
    }
  }

  /**
   * Map Shopify order status to our internal status
   */
  private mapStatus(financial_status: string, fulfillment_status: string | null): string {
    // If cancelled or refunded, mark as CANCELLED
    if (financial_status === 'refunded' || financial_status === 'voided') {
      return 'CANCELLED';
    }

    // If fully fulfilled, mark as FULFILLED
    if (fulfillment_status === 'fulfilled') {
      return 'FULFILLED';
    }

    // If partially fulfilled
    if (fulfillment_status === 'partial') {
      return 'PARTIALLY_FULFILLED';
    }

    // If pending payment, mark as DRAFT
    if (financial_status === 'pending' || financial_status === 'authorized') {
      return 'DRAFT';
    }

    // If paid but not fulfilled, mark as OPEN
    if (financial_status === 'paid') {
      return 'OPEN';
    }

    // Default to OPEN for all other cases
    return 'OPEN';
  }

  /**
   * Normalize Shopify order to our SalesOrder schema
   */
  private normalizeOrder(order: ShopifyOrder): ShopifyNormalizedOrder {
    const customerName = order.customer
      ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() || 'Unknown Customer'
      : 'Unknown Customer';

    const customerEmail = order.customer?.email || order.email;
    const customerPhone = order.customer?.phone || order.phone;
    const externalCustomerId = order.customer?.id ? String(order.customer.id) : undefined;

    const status = this.mapStatus(order.financial_status, order.fulfillment_status);

    const lineItems = order.line_items.map(item => ({
      sku: item.sku || `SHOPIFY-${item.id}`,
      qtyOrdered: item.quantity,
      unitPrice: parseFloat(item.price),
    }));

    const totalAmount = order.total_price ? parseFloat(order.total_price) : undefined;
    const currency = order.currency || 'USD'; // Default to USD if not provided

    // Generate source URL for Shopify admin
    const sourceUrl = `https://${this.shopDomain}/admin/orders/${order.id}`;

    // Calculate expected delivery date (order date + 7 days as default estimate)
    const orderDate = new Date(order.created_at);
    const expectedDeliveryDate = new Date(orderDate);
    expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + 7);

    return {
      externalOrderId: String(order.id),
      externalCustomerId,
      channel: 'SHOPIFY',
      customerName,
      customerEmail,
      customerPhone,
      status,
      orderDate,
      expectedDeliveryDate,
      sourceUrl,
      totalAmount,
      currency,
      rawPayload: order,
      lineItems,
    };
  }

  /**
   * Look up product variants by SKU
   * Returns the variant if found, null if not
   */
  async findVariantBySku(sku: string): Promise<{ found: boolean; productId?: string; variantId?: string } | null> {
    try {
      // Shopify Admin API doesn't have direct SKU search, so we use the inventory_item lookup
      // or search products and filter by variant SKU
      const url = `${this.getBaseUrl()}/products.json?fields=id,variants&limit=250`;
      
      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.status}`);
      }

      const data = await response.json();
      const products = data.products || [];
      
      for (const product of products) {
        for (const variant of product.variants || []) {
          if (variant.sku === sku) {
            return {
              found: true,
              productId: String(product.id),
              variantId: String(variant.id),
            };
          }
        }
      }
      
      return { found: false };
    } catch (error: any) {
      console.error(`[Shopify] Error looking up SKU ${sku}:`, error.message);
      return null; // Return null to indicate API error
    }
  }

  /**
   * Verify multiple SKUs in batch with full pagination
   * Uses Shopify's cursor-based pagination via Link header
   * Returns an object with found and missing SKUs
   * 
   * Note: Per Shopify docs, when using page_info cursor, you can ONLY include
   * page_info and limit params. The cursor encodes the original query context.
   */
  async verifySkus(skus: string[]): Promise<{ found: string[]; missing: string[]; error?: string }> {
    try {
      // Build a set of all SKUs in Shopify using cursor-based pagination
      const shopifySkus = new Set<string>();
      let nextPageUrl: string | null = `${this.getBaseUrl()}/products.json?limit=250`;
      let pageCount = 0;
      const maxPages = 100; // Safety limit (25,000 products max)
      
      while (nextPageUrl && pageCount < maxPages) {
        const response = await fetch(nextPageUrl, {
          headers: this.getHeaders(),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Shopify] API error on page ${pageCount + 1}: ${response.status} - ${errorText}`);
          // Return error instead of defaulting to missing
          return { 
            found: [], 
            missing: [], 
            error: `Shopify API error (page ${pageCount + 1}): ${response.status} - ${errorText}` 
          };
        }

        const data = await response.json();
        const products = data.products || [];
        
        // Add all SKUs from this page - full product objects include variants with SKUs
        for (const product of products) {
          for (const variant of product.variants || []) {
            if (variant.sku) {
              shopifySkus.add(variant.sku);
            }
          }
        }
        
        pageCount++;
        
        // Check for next page using Link header (Shopify cursor-based pagination)
        // The Link header contains the full URL including page_info cursor
        const linkHeader = response.headers.get('Link');
        nextPageUrl = this.extractNextLinkUrl(linkHeader);
        
        // If no next link or we got fewer than 250 products, we're done
        if (!nextPageUrl || products.length < 250) {
          break;
        }
      }

      console.log(`[Shopify] Scanned ${pageCount} page(s), found ${shopifySkus.size} unique SKUs`);
      
      // Categorize input SKUs
      const found: string[] = [];
      const missing: string[] = [];
      
      for (const sku of skus) {
        if (shopifySkus.has(sku)) {
          found.push(sku);
        } else {
          missing.push(sku);
        }
      }
      
      return { found, missing };
    } catch (error: any) {
      console.error(`[Shopify] verifySkus error:`, error);
      return { 
        found: [], 
        missing: [], 
        error: error.message || 'Failed to verify SKUs' 
      };
    }
  }

  /**
   * Extract the next page URL from Shopify Link header
   * Shopify returns the full URL with page_info cursor, so we use it directly
   * Format: <https://store.myshopify.com/admin/api/.../products.json?page_info=xyz&limit=250>; rel="next"
   */
  private extractNextLinkUrl(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    
    // Parse Link header - may contain multiple links separated by commas
    // Each link format: <url>; rel="type"
    const links = linkHeader.split(',');
    
    for (const link of links) {
      const trimmed = link.trim();
      // Look specifically for rel="next" (not "previous" or other rels)
      if (trimmed.includes('rel="next"') || trimmed.includes("rel='next'")) {
        // Extract the URL between < and >
        const urlMatch = trimmed.match(/<([^>]+)>/);
        if (urlMatch && urlMatch[1]) {
          return urlMatch[1];
        }
      }
    }
    return null;
  }

  /**
   * Fetch recent orders from Shopify
   * @param daysBack - Number of days to look back (default: 7)
   */
  async syncRecentOrders(daysBack: number = 7): Promise<ShopifyNormalizedOrder[]> {
    try {
      const createdAtMin = new Date();
      createdAtMin.setDate(createdAtMin.getDate() - daysBack);
      const createdAtMinISO = createdAtMin.toISOString();

      const url = `${this.getBaseUrl()}/orders.json?status=any&created_at_min=${createdAtMinISO}&limit=250`;
      
      console.log(`[Shopify] Fetching orders since ${createdAtMinISO}...`);
      
      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const orders: ShopifyOrder[] = data.orders || [];

      console.log(`[Shopify] Fetched ${orders.length} orders`);

      return orders.map(order => this.normalizeOrder(order));
    } catch (error: any) {
      throw new Error(`Failed to fetch Shopify orders: ${error.message}`);
    }
  }
}
