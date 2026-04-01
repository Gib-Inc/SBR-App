/**
 * Shopify client — extracted from monolith shopify-client.ts.
 * Stripped to: fetch recent orders, fetch refunds. Nothing else.
 *
 * Env vars: SHOPIFY_SHOP_DOMAIN, SHOPIFY_ACCESS_TOKEN
 */

export interface ShopifyOrder {
  id: string;
  name: string;
  totalPrice: number;
  financialStatus: string;
  fulfillmentStatus: string | null;
  createdAt: Date;
  sourceName: string;
  lineItems: Array<{ sku: string; quantity: number; price: number }>;
}

export class ShopifyClient {
  private shopDomain: string;
  private accessToken: string;
  private apiVersion: string;

  constructor(shopDomain: string, accessToken: string, apiVersion = '2024-01') {
    this.shopDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
  }

  private headers(): Record<string, string> {
    return { 'X-Shopify-Access-Token': this.accessToken, 'Content-Type': 'application/json' };
  }

  private baseUrl(): string {
    return `https://${this.shopDomain}/admin/api/${this.apiVersion}`;
  }

  async fetchRecentOrders(daysBack: number, maxOrders = 1000): Promise<ShopifyOrder[]> {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    const allOrders: ShopifyOrder[] = [];
    let url: string | null =
      `${this.baseUrl()}/orders.json?status=any&created_at_min=${since.toISOString()}&limit=250`;

    while (url && allOrders.length < maxOrders) {
      const response = await fetch(url, { headers: this.headers() });
      if (!response.ok) throw new Error(`Shopify API error: ${response.status}`);

      const data = await response.json();
      for (const o of data.orders || []) {
        if (allOrders.length >= maxOrders) break;
        allOrders.push({
          id: String(o.id),
          name: o.name,
          totalPrice: parseFloat(o.total_price || '0'),
          financialStatus: o.financial_status,
          fulfillmentStatus: o.fulfillment_status,
          createdAt: new Date(o.created_at),
          sourceName: o.source_name || 'web',
          lineItems: (o.line_items || []).map((li: any) => ({
            sku: li.sku || '',
            quantity: li.quantity,
            price: parseFloat(li.price || '0'),
          })),
        });
      }

      // Pagination
      const link = response.headers.get('Link');
      const next = link?.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }

    return allOrders;
  }

  async fetchRefunds(daysBack = 30): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    const url = `${this.baseUrl()}/orders.json?status=any&created_at_min=${since.toISOString()}&financial_status=refunded&limit=250`;
    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) return 0;

    const data = await response.json();
    return (data.orders || []).length;
  }
}
