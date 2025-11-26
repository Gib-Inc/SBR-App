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
    const currency = order.currency || 'USD';

    return {
      externalOrderId: String(order.id),
      externalCustomerId,
      channel: 'SHOPIFY',
      customerName,
      customerEmail,
      customerPhone,
      status,
      orderDate: new Date(order.created_at),
      totalAmount,
      currency,
      rawPayload: order,
      lineItems,
    };
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
