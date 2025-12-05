/**
 * Shopify Webhook Handlers
 * Individual handlers for each webhook topic type
 */

import { ShopifyWebhookPayload, ShopifyWebhookContext } from './webhooks-config';
import { storage } from '../storage';
import { logService } from '../services/log-service';
import { InventoryMovement } from '../services/inventory-movement';

export interface WebhookHandlerResult {
  success: boolean;
  message: string;
  data?: any;
}

// ============= ORDER HANDLERS =============

export async function handleOrderCreated(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const orderId = payload.id;
  const orderName = payload.name || `#${orderId}`;
  
  console.log(`[Shopify Webhook] orders/create - Order ${orderName} (ID: ${orderId})`);
  
  try {
    const { FulfillmentDecisionService } = await import('../services/fulfillment-decision-service');
    const { triggerSalesOrderSync } = await import('../services/ghl-sync-triggers');
    
    let fulfillmentSource: 'HILDALE' | 'PIVOT_EXTENSIV' = 'HILDALE';
    
    const lineItemsWithProducts: Array<{
      sku: string;
      productId: string | null;
      qtyOrdered: number;
      unitPrice: number;
    }> = [];
    
    try {
      const decisionService = new FulfillmentDecisionService();
      
      if (payload.line_items) {
        for (const lineItem of payload.line_items) {
          const sku = lineItem.sku || `SHOPIFY-${lineItem.id}`;
          const item = await storage.getItemBySku(sku);
          
          lineItemsWithProducts.push({
            sku,
            productId: item?.id || null,
            qtyOrdered: lineItem.quantity,
            unitPrice: parseFloat(lineItem.price) || 0,
          });
          
          if (item) {
            const decision = await decisionService.decideSource(item, lineItem.quantity, userId);
            if (decision.source === 'PIVOT_EXTENSIV') {
              fulfillmentSource = 'PIVOT_EXTENSIV';
            }
          }
        }
      }
    } catch (decisionError: any) {
      console.warn(`[Shopify Webhook] Fulfillment decision failed, defaulting to HILDALE:`, decisionError.message);
    }

    const customerName = payload.customer
      ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim() || 'Unknown Customer'
      : 'Unknown Customer';

    const salesOrder = await storage.createSalesOrder({
      externalOrderId: String(orderId),
      channel: 'SHOPIFY',
      customerName,
      customerEmail: payload.customer?.email || payload.email || null,
      customerPhone: payload.customer?.phone || payload.phone || null,
      status: mapShopifyOrderStatus(payload.financial_status, payload.fulfillment_status),
      orderDate: new Date(payload.created_at || Date.now()),
      expectedDeliveryDate: null,
      sourceUrl: `https://${context.shopDomain}/admin/orders/${orderId}`,
      totalAmount: payload.total_price ? parseFloat(payload.total_price) : 0,
      currency: payload.currency || 'USD',
      fulfillmentSource,
      rawPayload: payload,
    });

    console.log(`[Shopify Webhook] Created sales order ${salesOrder.id} for Shopify order ${orderName}`);

    const inventoryMovement = new InventoryMovement(storage);
    
    for (const lineItem of lineItemsWithProducts) {
      if (lineItem.productId) {
        await storage.createSalesOrderLine({
          salesOrderId: salesOrder.id,
          productId: lineItem.productId,
          sku: lineItem.sku,
          qtyOrdered: lineItem.qtyOrdered,
          unitPrice: lineItem.unitPrice,
        });
        
        const item = await storage.getItem(lineItem.productId);
        if (item) {
          const pivotQty = item.pivotQty ?? 0;
          const qtyToAllocate = Math.min(lineItem.qtyOrdered, pivotQty);
          const qtyBackordered = lineItem.qtyOrdered - qtyToAllocate;
          
          if (qtyToAllocate > 0) {
            await inventoryMovement.apply({
              eventType: 'SALE',
              itemId: lineItem.productId,
              quantity: -qtyToAllocate,
              location: 'PIVOT',
              notes: `Shopify order ${orderName}`,
              userId,
              referenceId: salesOrder.id,
              referenceType: 'sales_order',
            });
            
            console.log(`[Shopify Webhook] Allocated ${qtyToAllocate} of ${lineItem.sku} from Pivot for order ${orderName}`);
          }
          
          if (qtyBackordered > 0) {
            console.warn(`[Shopify Webhook] Backorder: ${qtyBackordered} of ${lineItem.sku} for order ${orderName}`);
            
            await logService.logShopifyBackorder({
              orderId: salesOrder.id,
              orderNumber: orderName,
              itemId: lineItem.productId,
              sku: lineItem.sku,
              qtyOrdered: lineItem.qtyOrdered,
              qtyAllocated: qtyToAllocate,
              qtyBackordered,
              availableStock: pivotQty,
            });
          }
        }
      } else {
        console.warn(`[Shopify Webhook] Skipping line item - no product found for SKU: ${lineItem.sku}`);
        
        await logService.logSkuMismatch({
          source: 'SHOPIFY',
          orderId: salesOrder.id,
          externalSku: lineItem.sku,
        });
      }
    }

    triggerSalesOrderSync(userId, salesOrder.id, false)
      .then(() => console.log(`[Shopify Webhook] GHL sync triggered for order ${salesOrder.id}`))
      .catch((err: any) => console.warn(`[Shopify Webhook] GHL sync failed (non-blocking):`, err.message));

    return {
      success: true,
      message: `Order ${orderName} created successfully`,
      data: { salesOrderId: salesOrder.id, fulfillmentSource },
    };
  } catch (error: any) {
    console.error(`[Shopify Webhook] Error creating order ${orderName}:`, error);
    await logService.logShopifyWebhookError({
      topic: context.topic,
      shopDomain: context.shopDomain,
      externalOrderId: String(orderId),
      error: error.message,
      errorDetails: { stack: error.stack },
    });
    return { success: false, message: error.message };
  }
}

export async function handleOrderUpdated(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const orderId = payload.id;
  const orderName = payload.name || `#${orderId}`;
  
  console.log(`[Shopify Webhook] orders/updated - Order ${orderName} (ID: ${orderId})`);
  
  try {
    const existingOrders = await storage.getSalesOrdersByExternalId('SHOPIFY', String(orderId));
    const existingOrder = existingOrders[0];
    
    if (existingOrder) {
      const newStatus = mapShopifyOrderStatus(payload.financial_status, payload.fulfillment_status);
      
      await storage.updateSalesOrder(existingOrder.id, {
        status: newStatus,
        rawPayload: payload,
      });

      console.log(`[Shopify Webhook] Updated order ${existingOrder.id} status to ${newStatus}`);
      
      return {
        success: true,
        message: `Order ${orderName} updated`,
        data: { salesOrderId: existingOrder.id, newStatus },
      };
    } else {
      console.log(`[Shopify Webhook] Order ${orderId} not found locally, creating it`);
      return handleOrderCreated(payload, context, userId);
    }
  } catch (error: any) {
    console.error(`[Shopify Webhook] Error updating order ${orderName}:`, error);
    return { success: false, message: error.message };
  }
}

export async function handleOrderCancelled(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const orderId = payload.id;
  const orderName = payload.name || `#${orderId}`;
  
  console.log(`[Shopify Webhook] orders/cancelled - Order ${orderName} (ID: ${orderId})`);
  
  try {
    const existingOrders = await storage.getSalesOrdersByExternalId('SHOPIFY', String(orderId));
    const existingOrder = existingOrders[0];
    
    if (existingOrder) {
      await storage.updateSalesOrder(existingOrder.id, {
        status: 'CANCELLED',
        rawPayload: payload,
      });
      
      console.log(`[Shopify Webhook] Marked order ${existingOrder.id} as CANCELLED`);
      return { success: true, message: `Order ${orderName} cancelled` };
    }
    
    return { success: true, message: `Order ${orderId} not found locally (already deleted or never imported)` };
  } catch (error: any) {
    console.error(`[Shopify Webhook] Error cancelling order ${orderName}:`, error);
    return { success: false, message: error.message };
  }
}

export async function handleOrderFulfilled(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const orderId = payload.id;
  const orderName = payload.name || `#${orderId}`;
  
  console.log(`[Shopify Webhook] orders/fulfilled - Order ${orderName} (ID: ${orderId})`);
  
  try {
    const existingOrders = await storage.getSalesOrdersByExternalId('SHOPIFY', String(orderId));
    const existingOrder = existingOrders[0];
    
    if (existingOrder) {
      await storage.updateSalesOrder(existingOrder.id, {
        status: 'FULFILLED',
        rawPayload: payload,
      });
      
      console.log(`[Shopify Webhook] Marked order ${existingOrder.id} as FULFILLED`);
      return { success: true, message: `Order ${orderName} fulfilled` };
    }
    
    return { success: true, message: `Order ${orderId} not found locally` };
  } catch (error: any) {
    console.error(`[Shopify Webhook] Error fulfilling order ${orderName}:`, error);
    return { success: false, message: error.message };
  }
}

export async function handleOrderPaid(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const orderId = payload.id;
  console.log(`[Shopify Webhook] orders/paid - Order #${orderId}`);
  
  try {
    const existingOrders = await storage.getSalesOrdersByExternalId('SHOPIFY', String(orderId));
    const existingOrder = existingOrders[0];
    
    if (existingOrder && existingOrder.status === 'DRAFT') {
      await storage.updateSalesOrder(existingOrder.id, {
        status: 'OPEN',
        rawPayload: payload,
      });
      console.log(`[Shopify Webhook] Order ${existingOrder.id} marked as OPEN after payment`);
    }
    
    return { success: true, message: `Order ${orderId} payment recorded` };
  } catch (error: any) {
    console.error(`[Shopify Webhook] Error handling order paid:`, error);
    return { success: false, message: error.message };
  }
}

export async function handleOrderPartiallyFulfilled(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const orderId = payload.id;
  console.log(`[Shopify Webhook] orders/partially_fulfilled - Order #${orderId}`);
  
  try {
    const existingOrders = await storage.getSalesOrdersByExternalId('SHOPIFY', String(orderId));
    const existingOrder = existingOrders[0];
    
    if (existingOrder) {
      await storage.updateSalesOrder(existingOrder.id, {
        status: 'PARTIALLY_FULFILLED',
        rawPayload: payload,
      });
      console.log(`[Shopify Webhook] Order ${existingOrder.id} marked as PARTIALLY_FULFILLED`);
    }
    
    return { success: true, message: `Order ${orderId} partially fulfilled` };
  } catch (error: any) {
    console.error(`[Shopify Webhook] Error handling partial fulfillment:`, error);
    return { success: false, message: error.message };
  }
}

export async function handleOrderEdited(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const orderId = payload.id;
  console.log(`[Shopify Webhook] orders/edited - Order #${orderId}`);
  
  return handleOrderUpdated(payload, context, userId);
}

export async function handleOrderDeleted(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const orderId = payload.id;
  console.log(`[Shopify Webhook] orders/delete - Order #${orderId}`);
  
  return { success: true, message: `Order deletion noted (ID: ${orderId})` };
}

// ============= REFUND HANDLERS =============

export async function handleRefundCreated(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const refundId = payload.id;
  const orderId = payload.order_id;
  
  console.log(`[Shopify Webhook] refunds/create - Refund ${refundId} for Order ${orderId}`);
  
  try {
    let existingOrder = null;
    if (orderId) {
      const existingOrders = await storage.getSalesOrdersByExternalId('SHOPIFY', String(orderId));
      existingOrder = existingOrders[0];
    }
    
    if (existingOrder) {
      console.log(`[Shopify Webhook] Refund ${refundId} linked to local order ${existingOrder.id}`);
      
      await logService.logSystemEvent({
        type: 'SHOPIFY_REFUND_RECEIVED',
        entityType: 'SALES_ORDER',
        entityId: existingOrder.id,
        message: `Refund ${refundId} received for Shopify order ${orderId}`,
        details: { refundId, orderId, amount: payload.transactions?.[0]?.amount, userId },
      });
    }
    
    return { 
      success: true, 
      message: `Refund ${refundId} recorded`,
      data: { refundId, orderId, linkedSalesOrderId: existingOrder?.id },
    };
  } catch (error: any) {
    console.error(`[Shopify Webhook] Error handling refund:`, error);
    return { success: false, message: error.message };
  }
}

// ============= PRODUCT HANDLERS =============

export async function handleProductCreated(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const productId = payload.id;
  const productTitle = payload.title || 'Unknown Product';
  const variants = payload.variants || [];
  
  console.log(`[Shopify Webhook] products/create - Product "${productTitle}" (ID: ${productId}) with ${variants.length} variants`);
  
  for (const variant of variants) {
    if (variant.sku) {
      console.log(`  - Variant SKU: ${variant.sku}, Barcode: ${variant.barcode || 'none'}`);
    }
  }
  
  return { 
    success: true, 
    message: `Product "${productTitle}" created with ${variants.length} variants`,
    data: { productId, title: productTitle, variantCount: variants.length },
  };
}

export async function handleProductUpdated(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const productId = payload.id;
  const productTitle = payload.title || 'Unknown Product';
  
  console.log(`[Shopify Webhook] products/update - Product "${productTitle}" (ID: ${productId})`);
  
  return { 
    success: true, 
    message: `Product "${productTitle}" updated`,
    data: { productId, title: productTitle },
  };
}

export async function handleProductDeleted(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const productId = payload.id;
  
  console.log(`[Shopify Webhook] products/delete - Product ${productId} deleted`);
  
  return { 
    success: true, 
    message: `Product ${productId} deletion noted`,
    data: { productId },
  };
}

// ============= INVENTORY HANDLERS =============

export async function handleInventoryLevelUpdate(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const inventoryItemId = payload.inventory_item_id;
  const locationId = payload.location_id;
  const available = payload.available;
  
  console.log(`[Shopify Webhook] inventory_levels/update - Item ${inventoryItemId} at location ${locationId}: ${available} available`);
  
  return { 
    success: true, 
    message: `Inventory level update received`,
    data: { inventoryItemId, locationId, available },
  };
}

export async function handleInventoryLevelConnect(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const inventoryItemId = payload.inventory_item_id;
  const locationId = payload.location_id;
  
  console.log(`[Shopify Webhook] inventory_levels/connect - Item ${inventoryItemId} connected to location ${locationId}`);
  
  return { success: true, message: `Inventory connection noted` };
}

export async function handleInventoryLevelDisconnect(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const inventoryItemId = payload.inventory_item_id;
  const locationId = payload.location_id;
  
  console.log(`[Shopify Webhook] inventory_levels/disconnect - Item ${inventoryItemId} disconnected from location ${locationId}`);
  
  return { success: true, message: `Inventory disconnection noted` };
}

// ============= FULFILLMENT HANDLERS =============

export async function handleFulfillmentCreated(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const fulfillmentId = payload.id;
  const orderId = payload.order_id;
  const trackingNumber = payload.tracking_number;
  const trackingCompany = payload.tracking_company;
  
  console.log(`[Shopify Webhook] fulfillments/create - Fulfillment ${fulfillmentId} for order ${orderId}`);
  if (trackingNumber) {
    console.log(`  - Tracking: ${trackingCompany || 'Unknown'} ${trackingNumber}`);
  }
  
  try {
    let existingOrder = null;
    if (orderId) {
      const existingOrders = await storage.getSalesOrdersByExternalId('SHOPIFY', String(orderId));
      existingOrder = existingOrders[0];
    }
    
    if (existingOrder) {
      const isFullyFulfilled = payload.line_items?.every((item: any) => item.fulfillable_quantity === 0);
      
      await storage.updateSalesOrder(existingOrder.id, {
        status: isFullyFulfilled ? 'FULFILLED' : 'PARTIALLY_FULFILLED',
        rawPayload: { ...((existingOrder.rawPayload as any) || {}), lastFulfillment: payload },
      });
    }
    
    return { 
      success: true, 
      message: `Fulfillment ${fulfillmentId} created`,
      data: { fulfillmentId, orderId, trackingNumber },
    };
  } catch (error: any) {
    console.error(`[Shopify Webhook] Error handling fulfillment:`, error);
    return { success: false, message: error.message };
  }
}

export async function handleFulfillmentUpdated(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const fulfillmentId = payload.id;
  const status = payload.status;
  
  console.log(`[Shopify Webhook] fulfillments/update - Fulfillment ${fulfillmentId} status: ${status}`);
  
  return { 
    success: true, 
    message: `Fulfillment ${fulfillmentId} updated to ${status}`,
  };
}

export async function handleFulfillmentOrderEvent(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const fulfillmentOrderId = payload.id;
  const orderId = payload.order_id;
  const status = payload.status;
  
  console.log(`[Shopify Webhook] ${context.topic} - Fulfillment Order ${fulfillmentOrderId} (Order: ${orderId}, Status: ${status})`);
  
  return { 
    success: true, 
    message: `Fulfillment order event: ${context.topic}`,
    data: { fulfillmentOrderId, orderId, status },
  };
}

// ============= CART HANDLERS =============

export async function handleCartCreated(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const cartId = payload.id || payload.token;
  
  console.log(`[Shopify Webhook] carts/create - Cart ${cartId}`);
  
  return { success: true, message: `Cart ${cartId} created` };
}

export async function handleCartUpdated(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const cartId = payload.id || payload.token;
  
  console.log(`[Shopify Webhook] carts/update - Cart ${cartId}`);
  
  return { success: true, message: `Cart ${cartId} updated` };
}

// ============= HELPER FUNCTIONS =============

function mapShopifyOrderStatus(financialStatus: string | null, fulfillmentStatus: string | null): string {
  if (financialStatus === 'refunded' || financialStatus === 'voided') {
    return 'CANCELLED';
  }
  if (fulfillmentStatus === 'fulfilled') {
    return 'FULFILLED';
  }
  if (fulfillmentStatus === 'partial') {
    return 'PARTIALLY_FULFILLED';
  }
  if (financialStatus === 'pending' || financialStatus === 'authorized') {
    return 'DRAFT';
  }
  if (financialStatus === 'paid') {
    return 'OPEN';
  }
  return 'OPEN';
}

// ============= TOPIC ROUTER =============

export async function routeWebhookToHandler(
  topic: string,
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  switch (topic) {
    case 'orders/create':
      return handleOrderCreated(payload, context, userId);
    case 'orders/updated':
      return handleOrderUpdated(payload, context, userId);
    case 'orders/cancelled':
      return handleOrderCancelled(payload, context, userId);
    case 'orders/fulfilled':
      return handleOrderFulfilled(payload, context, userId);
    case 'orders/paid':
      return handleOrderPaid(payload, context, userId);
    case 'orders/partially_fulfilled':
      return handleOrderPartiallyFulfilled(payload, context, userId);
    case 'orders/edited':
      return handleOrderEdited(payload, context, userId);
    case 'orders/delete':
      return handleOrderDeleted(payload, context, userId);
      
    case 'refunds/create':
      return handleRefundCreated(payload, context, userId);
      
    case 'products/create':
      return handleProductCreated(payload, context, userId);
    case 'products/update':
      return handleProductUpdated(payload, context, userId);
    case 'products/delete':
      return handleProductDeleted(payload, context, userId);
      
    case 'inventory_levels/update':
      return handleInventoryLevelUpdate(payload, context, userId);
    case 'inventory_levels/connect':
      return handleInventoryLevelConnect(payload, context, userId);
    case 'inventory_levels/disconnect':
      return handleInventoryLevelDisconnect(payload, context, userId);
      
    case 'fulfillments/create':
      return handleFulfillmentCreated(payload, context, userId);
    case 'fulfillments/update':
      return handleFulfillmentUpdated(payload, context, userId);
      
    case 'carts/create':
      return handleCartCreated(payload, context, userId);
    case 'carts/update':
      return handleCartUpdated(payload, context, userId);
      
    default:
      if (topic.startsWith('fulfillment_orders/')) {
        return handleFulfillmentOrderEvent(payload, context, userId);
      }
      
      console.log(`[Shopify Webhook] Unhandled topic: ${topic}`);
      return { success: true, message: `Topic ${topic} received but no handler defined` };
  }
}
