/**
 * Amazon SP-API Client
 * Handles communication with Amazon Seller Central SP-API for order syncing
 * 
 * Note: This is a simplified implementation. Full SP-API integration requires:
 * - OAuth 2.0 token refresh flow
 * - AWS Signature Version 4 signing
 * - Rate limiting and throttling
 * 
 * For production, consider using the official amazon-sp-api npm package
 */

export interface AmazonOrder {
  AmazonOrderId: string;
  PurchaseDate: string;
  LastUpdateDate: string;
  OrderStatus: string;
  FulfillmentChannel?: string;
  SalesChannel?: string;
  OrderTotal?: {
    CurrencyCode: string;
    Amount: string;
  };
  BuyerEmail?: string;
  BuyerName?: string;
  ShippingAddress?: {
    Name?: string;
    Phone?: string;
  };
  OrderItems?: Array<{
    ASIN: string;
    SellerSKU: string;
    Title: string;
    QuantityOrdered: number;
    QuantityShipped: number;
    ItemPrice?: {
      CurrencyCode: string;
      Amount: string;
    };
  }>;
}

export interface AmazonNormalizedOrder {
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

export class AmazonClient {
  private sellerId: string;
  private marketplaceId: string;
  private refreshToken: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken?: string;
  private tokenExpiresAt?: number;

  constructor(
    sellerId: string,
    marketplaceId: string,
    refreshToken: string,
    clientId: string,
    clientSecret: string
  ) {
    this.sellerId = sellerId;
    this.marketplaceId = marketplaceId;
    this.refreshToken = refreshToken;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Get or refresh access token
   * Note: This is a simplified implementation. Production should use proper AWS signing
   */
  private async getAccessToken(): Promise<string> {
    // If token is still valid, return it
    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    try {
      const response = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Amazon token refresh failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in * 1000) - 60000; // Expire 1 min early

      return this.accessToken!;
    } catch (error: any) {
      throw new Error(`Failed to refresh Amazon access token: ${error.message}`);
    }
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      // Try to get an access token
      await this.getAccessToken();
      
      return {
        success: true,
        message: 'Connected successfully to Amazon SP-API (token refresh successful)',
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to connect to Amazon SP-API',
      };
    }
  }

  /**
   * Map Amazon order status to our internal status
   */
  private mapStatus(orderStatus: string, quantityOrdered: number, quantityShipped: number): string {
    const status = orderStatus.toUpperCase();

    if (status === 'CANCELED' || status === 'CANCELLED') {
      return 'CANCELLED';
    }

    if (status === 'SHIPPED' || quantityShipped === quantityOrdered) {
      return 'FULFILLED';
    }

    if (quantityShipped > 0 && quantityShipped < quantityOrdered) {
      return 'PARTIALLY_FULFILLED';
    }

    if (status === 'PENDING' || status === 'UNSHIPPED') {
      return 'OPEN';
    }

    // Default to OPEN
    return 'OPEN';
  }

  /**
   * Normalize Amazon order to our SalesOrder schema
   */
  private normalizeOrder(order: AmazonOrder): AmazonNormalizedOrder {
    const customerName = order.BuyerName || order.ShippingAddress?.Name || 'Amazon Customer';
    const customerEmail = order.BuyerEmail;
    const customerPhone = order.ShippingAddress?.Phone;

    // Calculate status based on line items
    let totalOrdered = 0;
    let totalShipped = 0;
    if (order.OrderItems) {
      totalOrdered = order.OrderItems.reduce((sum, item) => sum + item.QuantityOrdered, 0);
      totalShipped = order.OrderItems.reduce((sum, item) => sum + item.QuantityShipped, 0);
    }

    const status = this.mapStatus(order.OrderStatus, totalOrdered, totalShipped);

    const lineItems = (order.OrderItems || []).map(item => {
      // Guard against division by zero/undefined to prevent NaN
      const unitPrice = (item.ItemPrice && item.QuantityOrdered > 0)
        ? parseFloat(item.ItemPrice.Amount) / item.QuantityOrdered 
        : 0;

      return {
        sku: item.SellerSKU,
        qtyOrdered: item.QuantityOrdered,
        unitPrice,
      };
    });

    const totalAmount = order.OrderTotal ? parseFloat(order.OrderTotal.Amount) : undefined;
    const currency = order.OrderTotal?.CurrencyCode || 'USD'; // Default to USD if not provided

    return {
      externalOrderId: order.AmazonOrderId,
      externalCustomerId: undefined, // Amazon doesn't expose buyer IDs via SP-API
      channel: 'AMAZON',
      customerName,
      customerEmail,
      customerPhone,
      status,
      orderDate: new Date(order.PurchaseDate),
      totalAmount,
      currency,
      rawPayload: order,
      lineItems,
    };
  }

  /**
   * Fetch recent orders from Amazon SP-API
   * @param daysBack - Number of days to look back (default: 7)
   */
  async syncRecentOrders(daysBack: number = 7): Promise<AmazonNormalizedOrder[]> {
    try {
      const accessToken = await this.getAccessToken();

      const createdAfter = new Date();
      createdAfter.setDate(createdAfter.getDate() - daysBack);
      const createdAfterISO = createdAfter.toISOString();

      // SP-API endpoint for orders
      const baseUrl = 'https://sellingpartnerapi-na.amazon.com'; // US marketplace
      const url = `${baseUrl}/orders/v0/orders?MarketplaceIds=${this.marketplaceId}&CreatedAfter=${createdAfterISO}`;

      console.log(`[Amazon] Fetching orders since ${createdAfterISO}...`);

      const response = await fetch(url, {
        headers: {
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Amazon SP-API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const orders: AmazonOrder[] = data.payload?.Orders || [];

      console.log(`[Amazon] Fetched ${orders.length} orders`);

      // Note: In production, you'd also need to fetch order items for each order
      // This is a simplified implementation
      const normalizedOrders: AmazonNormalizedOrder[] = [];

      for (const order of orders) {
        // Fetch order items
        try {
          const itemsUrl = `${baseUrl}/orders/v0/orders/${order.AmazonOrderId}/orderItems`;
          const itemsResponse = await fetch(itemsUrl, {
            headers: {
              'x-amz-access-token': accessToken,
              'Content-Type': 'application/json',
            },
          });

          if (itemsResponse.ok) {
            const itemsData = await itemsResponse.json();
            order.OrderItems = itemsData.payload?.OrderItems || [];
          }
        } catch (error) {
          console.warn(`[Amazon] Failed to fetch items for order ${order.AmazonOrderId}:`, error);
          order.OrderItems = [];
        }

        normalizedOrders.push(this.normalizeOrder(order));
      }

      return normalizedOrders;
    } catch (error: any) {
      throw new Error(`Failed to fetch Amazon orders: ${error.message}`);
    }
  }
}
