/**
 * Amazon SP-API Client
 * Handles communication with Amazon Seller Central SP-API for order syncing and inventory management
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
    AddressLine1?: string;
    AddressLine2?: string;
    City?: string;
    StateOrRegion?: string;
    PostalCode?: string;
    CountryCode?: string;
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
  externalOrderNumber: string;
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
  shippingAddress?: {
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  rawPayload: any;
  lineItems: Array<{
    sku: string;
    asin: string;
    title: string;
    qtyOrdered: number;
    qtyShipped: number;
    unitPrice: number;
  }>;
}

export interface AmazonListing {
  sellerSku: string;
  asin: string;
  title: string;
  gtin?: string;
  fnSku?: string;
  fulfillmentChannel: 'FBM' | 'FBA';
  status: 'Active' | 'Inactive' | 'Incomplete';
  price?: number;
  quantity?: number;
}

const REGION_ENDPOINTS: Record<string, string> = {
  'NA': 'https://sellingpartnerapi-na.amazon.com',
  'EU': 'https://sellingpartnerapi-eu.amazon.com',
  'FE': 'https://sellingpartnerapi-fe.amazon.com',
};

export class AmazonClient {
  private sellerId: string;
  private marketplaceId: string;
  private region: string;
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
    clientSecret: string,
    region: string = 'NA'
  ) {
    this.sellerId = sellerId;
    this.marketplaceId = marketplaceId;
    this.refreshToken = refreshToken;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.region = region;
  }

  private getBaseUrl(): string {
    return REGION_ENDPOINTS[this.region] || REGION_ENDPOINTS['NA'];
  }

  /**
   * Get or refresh access token
   */
  private async getAccessToken(): Promise<string> {
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
      this.tokenExpiresAt = Date.now() + (data.expires_in * 1000) - 60000;

      return this.accessToken!;
    } catch (error: any) {
      throw new Error(`Failed to refresh Amazon access token: ${error.message}`);
    }
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; message: string; errorCode?: string }> {
    try {
      await this.getAccessToken();
      
      return {
        success: true,
        message: 'Connected successfully to Amazon SP-API (token refresh successful)',
      };
    } catch (error: any) {
      let errorCode = 'UNKNOWN';
      const message = error.message || 'Failed to connect to Amazon SP-API';
      
      if (message.includes('invalid_client') || message.includes('client_id')) {
        errorCode = 'INVALID_CLIENT_ID';
      } else if (message.includes('invalid_grant') || message.includes('refresh_token')) {
        errorCode = 'INVALID_REFRESH_TOKEN';
      } else if (message.includes('network') || message.includes('ENOTFOUND')) {
        errorCode = 'NETWORK_ERROR';
      }
      
      return {
        success: false,
        message,
        errorCode,
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

    return 'OPEN';
  }

  /**
   * Normalize Amazon order to our SalesOrder schema
   */
  private normalizeOrder(order: AmazonOrder): AmazonNormalizedOrder {
    const customerName = order.BuyerName || order.ShippingAddress?.Name || 'Amazon Customer';
    const customerEmail = order.BuyerEmail;
    const customerPhone = order.ShippingAddress?.Phone;

    let totalOrdered = 0;
    let totalShipped = 0;
    if (order.OrderItems) {
      totalOrdered = order.OrderItems.reduce((sum, item) => sum + item.QuantityOrdered, 0);
      totalShipped = order.OrderItems.reduce((sum, item) => sum + item.QuantityShipped, 0);
    }

    const status = this.mapStatus(order.OrderStatus, totalOrdered, totalShipped);

    const lineItems = (order.OrderItems || []).map(item => {
      const unitPrice = (item.ItemPrice && item.QuantityOrdered > 0)
        ? parseFloat(item.ItemPrice.Amount) / item.QuantityOrdered 
        : 0;

      return {
        sku: item.SellerSKU,
        asin: item.ASIN,
        title: item.Title,
        qtyOrdered: item.QuantityOrdered,
        qtyShipped: item.QuantityShipped,
        unitPrice,
      };
    });

    const totalAmount = order.OrderTotal ? parseFloat(order.OrderTotal.Amount) : undefined;
    const currency = order.OrderTotal?.CurrencyCode || 'USD';
    const sourceUrl = `https://sellercentral.amazon.com/orders-v3/order/${order.AmazonOrderId}`;
    const orderDate = new Date(order.PurchaseDate);
    const expectedDeliveryDate = new Date(orderDate);
    expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + 5);

    const shippingAddress = order.ShippingAddress ? {
      street1: order.ShippingAddress.AddressLine1,
      street2: order.ShippingAddress.AddressLine2,
      city: order.ShippingAddress.City,
      state: order.ShippingAddress.StateOrRegion,
      postalCode: order.ShippingAddress.PostalCode,
      country: order.ShippingAddress.CountryCode,
    } : undefined;

    return {
      externalOrderId: order.AmazonOrderId,
      externalOrderNumber: order.AmazonOrderId,
      externalCustomerId: undefined,
      channel: 'AMAZON',
      customerName,
      customerEmail,
      customerPhone,
      status,
      orderDate,
      expectedDeliveryDate,
      sourceUrl,
      totalAmount,
      currency,
      shippingAddress,
      rawPayload: order,
      lineItems,
    };
  }

  /**
   * Fetch recent orders from Amazon SP-API
   */
  async syncRecentOrders(daysBack: number = 7): Promise<AmazonNormalizedOrder[]> {
    try {
      const accessToken = await this.getAccessToken();
      const baseUrl = this.getBaseUrl();

      const createdAfter = new Date();
      createdAfter.setDate(createdAfter.getDate() - daysBack);
      const createdAfterISO = createdAfter.toISOString();

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

      const normalizedOrders: AmazonNormalizedOrder[] = [];

      for (const order of orders) {
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

  /**
   * Fetch catalog item by ASIN to get UPC/GTIN
   */
  async getCatalogItem(asin: string): Promise<{ asin: string; gtin?: string; title?: string } | null> {
    try {
      const accessToken = await this.getAccessToken();
      const baseUrl = this.getBaseUrl();

      const url = `${baseUrl}/catalog/2022-04-01/items/${asin}?marketplaceIds=${this.marketplaceId}&includedData=identifiers,summaries`;

      const response = await fetch(url, {
        headers: {
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const identifiers = data.identifiers || [];
      const summaries = data.summaries || [];
      
      let gtin: string | undefined;
      for (const idGroup of identifiers) {
        for (const id of idGroup.identifiers || []) {
          if (id.identifierType === 'UPC' || id.identifierType === 'EAN' || id.identifierType === 'GTIN') {
            gtin = id.identifier;
            break;
          }
        }
        if (gtin) break;
      }

      const title = summaries[0]?.itemName;

      return { asin, gtin, title };
    } catch (error) {
      console.warn(`[Amazon] Failed to fetch catalog item ${asin}:`, error);
      return null;
    }
  }

  /**
   * Fetch listings from FBA/FBM inventory for SKU mapping
   */
  async fetchListingsForMapping(): Promise<AmazonListing[]> {
    try {
      const accessToken = await this.getAccessToken();
      const baseUrl = this.getBaseUrl();

      console.log(`[Amazon] Fetching listings for mapping...`);

      const url = `${baseUrl}/listings/2021-08-01/items/${this.sellerId}?marketplaceIds=${this.marketplaceId}&includedData=summaries,attributes,identifiers,fulfillmentAvailability`;

      const response = await fetch(url, {
        headers: {
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[Amazon] Listings API failed: ${response.status} - ${errorText}`);
        return await this.fetchInventorySummaries();
      }

      const data = await response.json();
      const items = data.items || [];
      
      console.log(`[Amazon] Fetched ${items.length} listings`);

      return items.map((item: any) => ({
        sellerSku: item.sku,
        asin: item.summaries?.[0]?.asin || '',
        title: item.summaries?.[0]?.itemName || item.attributes?.item_name?.[0]?.value || '',
        gtin: item.identifiers?.[0]?.identifiers?.find((id: any) => 
          id.identifierType === 'UPC' || id.identifierType === 'EAN' || id.identifierType === 'GTIN'
        )?.identifier,
        fnSku: item.fulfillmentAvailability?.[0]?.fnSku,
        fulfillmentChannel: item.fulfillmentAvailability?.[0]?.fulfillmentChannelCode === 'AMAZON_NA' ? 'FBA' : 'FBM',
        status: item.summaries?.[0]?.status || 'Active',
        quantity: item.fulfillmentAvailability?.[0]?.quantity,
      }));
    } catch (error: any) {
      console.error(`[Amazon] Failed to fetch listings:`, error);
      return await this.fetchInventorySummaries();
    }
  }

  /**
   * Fallback: Fetch from inventory summaries API
   */
  private async fetchInventorySummaries(): Promise<AmazonListing[]> {
    try {
      const accessToken = await this.getAccessToken();
      const baseUrl = this.getBaseUrl();

      console.log(`[Amazon] Fetching inventory summaries as fallback...`);

      const url = `${baseUrl}/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=${this.marketplaceId}&marketplaceIds=${this.marketplaceId}`;

      const response = await fetch(url, {
        headers: {
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.warn(`[Amazon] Inventory summaries API also failed`);
        return [];
      }

      const data = await response.json();
      const summaries = data.payload?.inventorySummaries || [];

      console.log(`[Amazon] Fetched ${summaries.length} inventory summaries`);

      return summaries.map((item: any) => ({
        sellerSku: item.sellerSku,
        asin: item.asin || '',
        title: item.productName || '',
        fnSku: item.fnSku,
        fulfillmentChannel: item.fnSku ? 'FBA' : 'FBM',
        status: 'Active',
        quantity: item.totalQuantity,
      }));
    } catch (error) {
      console.error(`[Amazon] Failed to fetch inventory summaries:`, error);
      return [];
    }
  }

  /**
   * Update inventory quantity for a SKU (FBM only)
   * This respects the Two-Way Sync setting at a higher level
   */
  async updateInventory(sellerSku: string, quantity: number): Promise<{ success: boolean; message: string }> {
    try {
      const accessToken = await this.getAccessToken();
      const baseUrl = this.getBaseUrl();

      console.log(`[Amazon] Updating inventory for ${sellerSku} to ${quantity}...`);

      const url = `${baseUrl}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(sellerSku)}`;

      const patchBody = {
        productType: 'PRODUCT',
        patches: [
          {
            op: 'replace',
            path: '/attributes/fulfillment_availability',
            value: [
              {
                fulfillment_channel_code: 'DEFAULT',
                quantity: quantity,
                marketplace_id: this.marketplaceId,
              }
            ]
          }
        ]
      };

      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patchBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update inventory: ${response.status} - ${errorText}`);
      }

      return {
        success: true,
        message: `Updated ${sellerSku} quantity to ${quantity}`,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to update Amazon inventory',
      };
    }
  }

  /**
   * Batch update inventory for multiple SKUs
   */
  async batchUpdateInventory(updates: Array<{ sellerSku: string; quantity: number }>): Promise<{
    successful: number;
    failed: number;
    errors: Array<{ sellerSku: string; error: string }>;
  }> {
    let successful = 0;
    let failed = 0;
    const errors: Array<{ sellerSku: string; error: string }> = [];

    for (const update of updates) {
      const result = await this.updateInventory(update.sellerSku, update.quantity);
      if (result.success) {
        successful++;
      } else {
        failed++;
        errors.push({ sellerSku: update.sellerSku, error: result.message });
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return { successful, failed, errors };
  }

  get getSellerId(): string {
    return this.sellerId;
  }

  get getMarketplaceId(): string {
    return this.marketplaceId;
  }

  get getRegion(): string {
    return this.region;
  }
}
