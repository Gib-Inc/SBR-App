/**
 * Shopify Webhook Configuration
 * Central configuration for all Shopify webhook topics and settings
 */

export const SHOPIFY_WEBHOOK_TOPICS = [
  "carts/create",
  "carts/update",
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "orders/delete",
  "orders/edited",
  "orders/fulfilled",
  "orders/paid",
  "orders/partially_fulfilled",
  "refunds/create",
  "products/create",
  "products/update",
  "products/delete",
  "inventory_levels/update",
  "inventory_levels/connect",
  "inventory_levels/disconnect",
  "fulfillments/create",
  "fulfillments/update",
  "fulfillment_orders/cancellation_request_submitted",
  "fulfillment_orders/cancelled",
  "fulfillment_orders/fulfillment_request_submitted",
  "fulfillment_orders/hold",
  "fulfillment_orders/line_items_prepared_for_local_delivery",
  "fulfillment_orders/merged",
  "fulfillment_orders/moved",
  "fulfillment_orders/order_routing_complete",
  "fulfillment_orders/placed_on_hold",
  "fulfillment_orders/released_from_hold",
  "fulfillment_orders/rescheduled",
  "fulfillment_orders/scheduled_fulfillment_order_ready",
  "fulfillment_orders/split",
] as const;

export type ShopifyWebhookTopic = typeof SHOPIFY_WEBHOOK_TOPICS[number];

export const WEBHOOK_TOPICS = {
  CARTS_CREATE: "carts/create" as ShopifyWebhookTopic,
  CARTS_UPDATE: "carts/update" as ShopifyWebhookTopic,
  ORDERS_CREATE: "orders/create" as ShopifyWebhookTopic,
  ORDERS_UPDATED: "orders/updated" as ShopifyWebhookTopic,
  ORDERS_CANCELLED: "orders/cancelled" as ShopifyWebhookTopic,
  ORDERS_DELETE: "orders/delete" as ShopifyWebhookTopic,
  ORDERS_EDITED: "orders/edited" as ShopifyWebhookTopic,
  ORDERS_FULFILLED: "orders/fulfilled" as ShopifyWebhookTopic,
  ORDERS_PAID: "orders/paid" as ShopifyWebhookTopic,
  ORDERS_PARTIALLY_FULFILLED: "orders/partially_fulfilled" as ShopifyWebhookTopic,
  REFUNDS_CREATE: "refunds/create" as ShopifyWebhookTopic,
  PRODUCTS_CREATE: "products/create" as ShopifyWebhookTopic,
  PRODUCTS_UPDATE: "products/update" as ShopifyWebhookTopic,
  PRODUCTS_DELETE: "products/delete" as ShopifyWebhookTopic,
  INVENTORY_LEVELS_UPDATE: "inventory_levels/update" as ShopifyWebhookTopic,
  INVENTORY_LEVELS_CONNECT: "inventory_levels/connect" as ShopifyWebhookTopic,
  INVENTORY_LEVELS_DISCONNECT: "inventory_levels/disconnect" as ShopifyWebhookTopic,
  FULFILLMENTS_CREATE: "fulfillments/create" as ShopifyWebhookTopic,
  FULFILLMENTS_UPDATE: "fulfillments/update" as ShopifyWebhookTopic,
} as const;

export interface ShopifyWebhookPayload {
  id?: string | number;
  admin_graphql_api_id?: string;
  [key: string]: any;
}

export interface ShopifyWebhookContext {
  topic: string;
  shopDomain: string;
  webhookId?: string;
  apiVersion?: string;
}

/**
 * Get the public webhook URL for Shopify callbacks
 * Uses SHOPIFY_WEBHOOK_URL env var, or constructs from REPLIT_DEV_DOMAIN if available
 */
export function getShopifyWebhookUrl(): string {
  if (process.env.SHOPIFY_WEBHOOK_URL) {
    return process.env.SHOPIFY_WEBHOOK_URL;
  }

  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/webhooks/shopify`;
  }

  console.warn('[Shopify Webhooks] No SHOPIFY_WEBHOOK_URL or REPLIT_DEV_DOMAIN set');
  return '';
}

/**
 * Group topics by category for easier management
 */
export const WEBHOOK_CATEGORIES = {
  orders: [
    "orders/create",
    "orders/updated", 
    "orders/cancelled",
    "orders/delete",
    "orders/edited",
    "orders/fulfilled",
    "orders/paid",
    "orders/partially_fulfilled",
  ],
  carts: [
    "carts/create",
    "carts/update",
  ],
  refunds: [
    "refunds/create",
  ],
  products: [
    "products/create",
    "products/update",
    "products/delete",
  ],
  inventory: [
    "inventory_levels/update",
    "inventory_levels/connect",
    "inventory_levels/disconnect",
  ],
  fulfillments: [
    "fulfillments/create",
    "fulfillments/update",
    "fulfillment_orders/cancellation_request_submitted",
    "fulfillment_orders/cancelled",
    "fulfillment_orders/fulfillment_request_submitted",
    "fulfillment_orders/hold",
    "fulfillment_orders/line_items_prepared_for_local_delivery",
    "fulfillment_orders/merged",
    "fulfillment_orders/moved",
    "fulfillment_orders/order_routing_complete",
    "fulfillment_orders/placed_on_hold",
    "fulfillment_orders/released_from_hold",
    "fulfillment_orders/rescheduled",
    "fulfillment_orders/scheduled_fulfillment_order_ready",
    "fulfillment_orders/split",
  ],
} as const;

export function isValidTopic(topic: string): topic is ShopifyWebhookTopic {
  return SHOPIFY_WEBHOOK_TOPICS.includes(topic as ShopifyWebhookTopic);
}
