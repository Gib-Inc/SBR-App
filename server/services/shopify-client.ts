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
  // Channel/source detection fields (for Amazon vs Shopify classification)
  source_name?: string; // "web", "Amazon", etc.
  source_identifier?: string; // External order ID (Amazon format: ###-#######-#######)
  tags?: string; // Comma-separated tags
  app?: {
    name?: string;
  };
  channel_information?: {
    channel_definition?: {
      handle?: string;
      channel_name?: string;
    };
    app?: {
      title?: string;
    };
  };
  customer?: {
    id?: string | number;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  shipping_address?: {
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    province_code?: string;
    zip?: string;
    country?: string;
    country_code?: string;
  };
  line_items: Array<{
    id: string | number;
    sku?: string;
    name: string;
    quantity: number;
    price: string;
  }>;
  // Fulfillment tracking for delivery status
  fulfillments?: Array<{
    id: string | number;
    status: string; // success, cancelled, error, failure
    shipment_status: string | null; // in_transit, out_for_delivery, delivered, etc.
    tracking_number?: string;
    tracking_url?: string;
    updated_at?: string;
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
  deliveredAt?: Date; // Actual delivery date from fulfillment tracking
  sourceUrl?: string;
  totalAmount?: number;
  currency?: string;
  rawPayload: any;
  // Shipping address fields
  shipToStreet?: string;
  shipToCity?: string;
  shipToState?: string;
  shipToZip?: string;
  shipToCountry?: string;
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
   * Flow: ORDERED → SHIPPED → DELIVERED (+ CANCELLED, PENDING_REFUND, REFUNDED)
   * 
   * Status meanings:
   * - ORDERED: Payment confirmed, awaiting shipment
   * - SHIPPED: In transit or out for delivery (carrier has package)
   * - DELIVERED: Carrier confirmed delivery
   * - REFUNDED: Full refund completed
   * - CANCELLED: Order voided/cancelled
   * 
   * Shopify shipment_status values:
   * - label_printed, label_purchased: Label created but not yet scanned
   * - confirmed: Carrier confirmed pickup
   * - in_transit: Package is moving through carrier network
   * - out_for_delivery: Package is on delivery vehicle
   * - delivered: Package delivered to recipient
   * - attempted_delivery, failure: Delivery issues
   */
  private mapStatus(
    financial_status: string, 
    fulfillment_status: string | null, 
    shipment_status: string | null
  ): string {
    // If refunded, mark as REFUNDED (not CANCELLED)
    if (financial_status === 'refunded') {
      return 'REFUNDED';
    }

    // If voided/cancelled, mark as CANCELLED
    if (financial_status === 'voided') {
      return 'CANCELLED';
    }

    // Check shipment_status for delivery tracking (matches Shopify exactly)
    if (shipment_status === 'delivered') {
      return 'DELIVERED';
    }

    // in_transit or out_for_delivery means actively shipping → SHIPPED
    if (shipment_status === 'in_transit' || shipment_status === 'out_for_delivery') {
      return 'SHIPPED';
    }

    // confirmed means carrier has the package → SHIPPED
    if (shipment_status === 'confirmed') {
      return 'SHIPPED';
    }

    // attempted_delivery still means it's in the shipping process
    if (shipment_status === 'attempted_delivery') {
      return 'SHIPPED';
    }

    // If fulfilled but no shipment_status yet (label created but not scanned), still SHIPPED
    // This handles cases where tracking hasn't updated yet
    if (fulfillment_status === 'fulfilled' || fulfillment_status === 'partial') {
      return 'SHIPPED';
    }

    // If pending payment or authorized, mark as DRAFT (awaiting confirmation)
    if (financial_status === 'pending' || financial_status === 'authorized') {
      return 'DRAFT';
    }

    // If paid but not fulfilled, mark as ORDERED
    if (financial_status === 'paid') {
      return 'ORDERED';
    }

    // Default to ORDERED for all other cases
    return 'ORDERED';
  }

  /**
   * Classify order channel (AMAZON vs SHOPIFY) using Commerce Attribution logic
   * Priority:
   * 1. source_name contains "amazon" → AMAZON
   * 2. app.name contains "amazon" or "codisto" → AMAZON
   * 3. channel_information.app.title contains "amazon" or "codisto" → AMAZON
   * 4. channel_definition.handle or channel_name contains "amazon" → AMAZON  
   * 5. source_identifier matches Amazon order ID pattern (###-#######-#######) → AMAZON
   * 6. Tags contain exact "amzn" or "amazon" (if not definitely Shopify) → AMAZON
   * 7. Known Shopify indicators (web, Online Store, etc.) → SHOPIFY
   * 8. Default → SHOPIFY (since orders come from Shopify API)
   */
  private classifyChannel(order: ShopifyOrder): string {
    const sourceName = (order.source_name || '').toLowerCase();
    const appName = (order.app?.name || '').toLowerCase();
    const channelInfo = order.channel_information;
    const channelHandle = (channelInfo?.channel_definition?.handle || '').toLowerCase();
    const channelName = (channelInfo?.channel_definition?.channel_name || '').toLowerCase();
    const channelAppTitle = (channelInfo?.app?.title || '').toLowerCase();
    const sourceIdentifier = order.source_identifier || '';
    const tags = (order.tags || '').toLowerCase().split(',').map(t => t.trim());

    // Known Shopify indicators
    const isDefinitelyShopify = 
      sourceName === 'web' ||
      sourceName === 'shopify_draft_order' ||
      appName === 'online store' ||
      appName === 'draft orders' ||
      appName === 'shopify pos' ||
      appName === 'point of sale' ||
      appName === 'buy button' ||
      appName.includes('buy button') ||
      channelHandle === 'web' ||
      channelName === 'online store' ||
      channelName === 'buy button' ||
      channelAppTitle.includes('buy button');

    // 1. source_name contains "amazon"
    if (sourceName.includes('amazon')) {
      return 'AMAZON';
    }

    // 2. app.name contains "amazon" or "codisto"
    if (appName.includes('amazon') || appName.includes('codisto')) {
      return 'AMAZON';
    }

    // 3. channel_information.app.title contains "amazon" or "codisto"
    if (channelAppTitle.includes('amazon') || channelAppTitle.includes('codisto')) {
      return 'AMAZON';
    }

    // 4. channel handle/name contains "amazon"
    if (channelHandle.includes('amazon') || channelName.includes('amazon')) {
      return 'AMAZON';
    }

    // 5. source_identifier matches Amazon order ID pattern (###-#######-#######)
    const amazonOrderIdPattern = /^\d{3}-\d{7}-\d{7}$/;
    if (sourceIdentifier && amazonOrderIdPattern.test(sourceIdentifier)) {
      return 'AMAZON';
    }

    // 6. Tags contain Amazon indicators (only if not definitely Shopify)
    // Matches Commerce Attribution Service: exact "amzn", "amazon", or "amzn orders" tags
    if (!isDefinitelyShopify) {
      if (tags.some(t => t === 'amzn' || t === 'amazon' || t === 'amzn orders')) {
        return 'AMAZON';
      }
    }

    // Default to SHOPIFY
    return 'SHOPIFY';
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

    // Extract shipment_status and delivery date from fulfillment data
    // Priority: delivered > out_for_delivery > in_transit > confirmed > others
    // This ensures we get the most accurate status across all fulfillments
    let deliveredAt: Date | undefined;
    let shipmentStatus: string | null = null;
    
    if (order.fulfillments && Array.isArray(order.fulfillments)) {
      const statusPriority: Record<string, number> = {
        'delivered': 5,
        'out_for_delivery': 4,
        'in_transit': 3,
        'confirmed': 2,
        'attempted_delivery': 1,
        'label_printed': 0,
        'label_purchased': 0,
      };
      
      let highestPriority = -1;
      
      for (const fulfillment of order.fulfillments) {
        const status = fulfillment.shipment_status;
        const priority = status ? (statusPriority[status] ?? -1) : -1;
        
        // Track highest priority status across all fulfillments
        if (priority > highestPriority) {
          highestPriority = priority;
          shipmentStatus = status;
        }
        
        // Extract delivery date if delivered
        if (status === 'delivered' && fulfillment.updated_at) {
          const fulfillmentDate = new Date(fulfillment.updated_at);
          if (!deliveredAt || fulfillmentDate > deliveredAt) {
            deliveredAt = fulfillmentDate;
          }
        }
      }
    }

    const status = this.mapStatus(order.financial_status, order.fulfillment_status, shipmentStatus);

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

    // Extract shipping address from Shopify order
    const shippingAddress = order.shipping_address;
    const shipToStreet = shippingAddress?.address1 
      ? (shippingAddress.address2 
        ? `${shippingAddress.address1}, ${shippingAddress.address2}` 
        : shippingAddress.address1)
      : undefined;

    // Classify channel using Commerce Attribution logic (Amazon vs Shopify)
    const channel = this.classifyChannel(order);

    return {
      externalOrderId: String(order.id),
      externalCustomerId,
      channel,
      customerName,
      customerEmail,
      customerPhone,
      status,
      orderDate,
      expectedDeliveryDate,
      deliveredAt,
      sourceUrl,
      totalAmount,
      currency,
      rawPayload: order,
      // Shipping address fields
      shipToStreet,
      shipToCity: shippingAddress?.city,
      shipToState: shippingAddress?.province || shippingAddress?.province_code,
      shipToZip: shippingAddress?.zip,
      shipToCountry: shippingAddress?.country || shippingAddress?.country_code,
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
   * Fetch all products with variants including inventory_item_id for SKU mapping
   * Returns products with their variants containing sku, barcode (UPC), and inventory_item_id
   */
  async fetchProductsForMapping(): Promise<Array<{
    productId: string;
    productTitle: string;
    variants: Array<{
      variantId: string;
      variantTitle: string;
      sku: string | null;
      barcode: string | null; // UPC/GTIN
      inventoryItemId: string;
    }>;
  }>> {
    try {
      const results: Array<{
        productId: string;
        productTitle: string;
        variants: Array<{
          variantId: string;
          variantTitle: string;
          sku: string | null;
          barcode: string | null;
          inventoryItemId: string;
        }>;
      }> = [];
      
      let nextPageUrl: string | null = `${this.getBaseUrl()}/products.json?limit=250`;
      let pageCount = 0;
      const maxPages = 100;
      
      while (nextPageUrl && pageCount < maxPages) {
        const response = await fetch(nextPageUrl, {
          headers: this.getHeaders(),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const products = data.products || [];
        
        for (const product of products) {
          const variants = (product.variants || []).map((variant: any) => ({
            variantId: String(variant.id),
            variantTitle: variant.title || 'Default',
            sku: variant.sku || null,
            barcode: variant.barcode || null, // This is typically UPC/GTIN
            inventoryItemId: String(variant.inventory_item_id),
          }));
          
          if (variants.length > 0) {
            results.push({
              productId: String(product.id),
              productTitle: product.title || 'Unknown Product',
              variants,
            });
          }
        }
        
        pageCount++;
        
        const linkHeader = response.headers.get('Link');
        nextPageUrl = this.extractNextLinkUrl(linkHeader);
        
        if (!nextPageUrl || products.length < 250) {
          break;
        }
      }

      console.log(`[Shopify] Fetched ${results.length} products for mapping across ${pageCount} pages`);
      return results;
    } catch (error: any) {
      throw new Error(`Failed to fetch Shopify products: ${error.message}`);
    }
  }

  /**
   * Fetch recent orders from Shopify with pagination support
   * @param daysBack - Number of days to look back (default: 7)
   * @param maxOrders - Maximum number of orders to fetch (default: 250)
   */
  async syncRecentOrders(daysBack: number = 7, maxOrders: number = 250): Promise<ShopifyNormalizedOrder[]> {
    try {
      const createdAtMin = new Date();
      createdAtMin.setDate(createdAtMin.getDate() - daysBack);
      const createdAtMinISO = createdAtMin.toISOString();

      const allOrders: ShopifyOrder[] = [];
      let pageCount = 0;
      const pageSize = Math.min(250, maxOrders); // Shopify max is 250 per page
      
      // First page URL
      let nextPageUrl: string | null = `${this.getBaseUrl()}/orders.json?status=any&created_at_min=${createdAtMinISO}&limit=${pageSize}`;
      
      console.log(`[Shopify] Fetching orders since ${createdAtMinISO} (max: ${maxOrders})...`);
      
      while (nextPageUrl && allOrders.length < maxOrders) {
        const response = await fetch(nextPageUrl, {
          headers: this.getHeaders(),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Shopify API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        const orders: ShopifyOrder[] = data.orders || [];
        
        pageCount++;
        
        // Add orders up to maxOrders limit
        for (const order of orders) {
          if (allOrders.length >= maxOrders) break;
          allOrders.push(order);
        }

        console.log(`[Shopify] Page ${pageCount}: fetched ${orders.length} orders (total: ${allOrders.length}/${maxOrders})`);

        // Check for next page
        const linkHeader = response.headers.get('Link');
        nextPageUrl = this.extractNextLinkUrl(linkHeader);
        
        // Stop if we hit the limit or no more pages
        if (allOrders.length >= maxOrders || orders.length < pageSize) {
          break;
        }
      }

      console.log(`[Shopify] Fetched ${allOrders.length} orders across ${pageCount} page(s)`);

      return allOrders.map(order => this.normalizeOrder(order));
    } catch (error: any) {
      throw new Error(`Failed to fetch Shopify orders: ${error.message}`);
    }
  }

  /**
   * List all registered webhooks for this shop
   */
  async listWebhooks(): Promise<Array<{ id: number; topic: string; address: string; format: string; created_at: string }>> {
    try {
      const url = `${this.getBaseUrl()}/webhooks.json`;
      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return data.webhooks || [];
    } catch (error: any) {
      throw new Error(`Failed to list Shopify webhooks: ${error.message}`);
    }
  }

  /**
   * Register a new webhook for the shop
   * @param topic - The webhook topic (e.g., 'orders/create', 'orders/updated')
   * @param address - The webhook callback URL
   */
  async registerWebhook(topic: string, address: string): Promise<{ id: number; topic: string; address: string }> {
    try {
      const url = `${this.getBaseUrl()}/webhooks.json`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhook: {
            topic,
            address,
            format: 'json',
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return data.webhook;
    } catch (error: any) {
      throw new Error(`Failed to register Shopify webhook: ${error.message}`);
    }
  }

  /**
   * Delete a webhook by ID
   * @param webhookId - The webhook ID to delete
   */
  async deleteWebhook(webhookId: number): Promise<void> {
    try {
      const url = `${this.getBaseUrl()}/webhooks/${webhookId}.json`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
    } catch (error: any) {
      throw new Error(`Failed to delete Shopify webhook: ${error.message}`);
    }
  }

  /**
   * Get a specific webhook by ID to verify it exists
   * @param webhookId - The webhook ID to fetch
   */
  async getWebhook(webhookId: number): Promise<{ id: number; topic: string; address: string; format: string; created_at: string } | null> {
    try {
      const url = `${this.getBaseUrl()}/webhooks/${webhookId}.json`;
      const response = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return data.webhook || null;
    } catch (error: any) {
      throw new Error(`Failed to get Shopify webhook: ${error.message}`);
    }
  }

  /**
   * Fetch refunds from Shopify orders within a date range
   * @param daysBack - Number of days to look back for orders with refunds
   * @param limit - Maximum number of orders to check (default 250)
   * @returns Array of refund objects with order context
   */
  async fetchRefunds(daysBack: number = 30, limit: number = 250): Promise<ShopifyRefund[]> {
    try {
      const refunds: ShopifyRefund[] = [];
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      
      // Use the same approach as syncRecentOrders but request any status to catch refunded orders
      const params = new URLSearchParams({
        limit: String(Math.min(limit, 250)),
        status: 'any',
        created_at_min: since.toISOString(),
        order: 'created_at desc',
      });
      
      let nextPageUrl: string | null = `${this.getBaseUrl()}/orders.json?${params.toString()}`;
      let pageCount = 0;
      const maxPages = Math.ceil(limit / 250);
      let totalOrdersFetched = 0;
      
      while (nextPageUrl && pageCount < maxPages && totalOrdersFetched < limit) {
        const response = await fetch(nextPageUrl, {
          headers: this.getHeaders(),
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        const orders = data.orders || [];
        totalOrdersFetched += orders.length;
        pageCount++;
        
        // For each order, fetch its refunds if any
        for (const order of orders) {
          if (order.refunds && order.refunds.length > 0) {
            // Refunds are already included in the order response
            for (const refund of order.refunds) {
              refunds.push({
                id: refund.id,
                order_id: order.id,
                order_name: order.name,
                created_at: refund.created_at,
                processed_at: refund.processed_at,
                note: refund.note,
                user_id: refund.user_id,
                refund_line_items: refund.refund_line_items || [],
                transactions: refund.transactions || [],
                order_adjustments: refund.order_adjustments || [],
                customer: order.customer,
              });
            }
          }
        }
        
        // Check for next page
        const linkHeader = response.headers.get('Link');
        nextPageUrl = this.extractNextLinkUrl(linkHeader);
        
        if (!nextPageUrl || orders.length < 250) {
          break;
        }
      }
      
      console.log(`[Shopify] Found ${refunds.length} refunds from ${totalOrdersFetched} orders (last ${daysBack} days)`);
      return refunds;
    } catch (error: any) {
      console.error('[Shopify] Error fetching refunds:', error.message);
      throw error;
    }
  }
}

export interface ShopifyRefund {
  id: number | string;
  order_id: number | string;
  order_name: string;
  created_at: string;
  processed_at?: string;
  note?: string;
  user_id?: number | string;
  refund_line_items: Array<{
    id: number | string;
    line_item_id: number | string;
    location_id?: number | string;
    quantity: number;
    restock_type: string; // 'no_restock' | 'cancel' | 'return' | 'legacy_restock'
    subtotal: number;
    total_tax: number;
    line_item?: {
      id: number | string;
      variant_id?: number | string;
      title: string;
      quantity: number;
      price: string;
      sku?: string;
      variant_title?: string;
      product_id?: number | string;
      name: string;
    };
  }>;
  transactions: Array<{
    id: number | string;
    order_id: number | string;
    amount: string;
    kind: string;
    gateway: string;
    status: string;
    created_at: string;
  }>;
  order_adjustments?: Array<{
    id: number | string;
    order_id: number | string;
    amount: string;
    tax_amount: string;
    kind: string;
    reason: string;
  }>;
  customer?: {
    id?: string | number;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
}
