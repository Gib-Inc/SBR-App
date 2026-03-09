/**
 * Shopify Webhook Handlers
 * Individual handlers for each webhook topic type
 */

import { ShopifyWebhookPayload, ShopifyWebhookContext } from './webhooks-config';
import { storage } from '../storage';
import { logService } from '../services/log-service';
import { InventoryMovement } from '../services/inventory-movement';
import { triggerShortageAlertsForOrder, triggerHildaleFulfillmentAlert } from '../services/ghl-stock-alert-service';
import { ShopifyInventorySyncService } from '../services/shopify-inventory-sync-service';

export interface WebhookHandlerResult {
  success: boolean;
  message: string;
  data?: any;
}

/**
 * Sync Shopify inventory levels to availableForSaleQty for order line items
 * This is a temporary solution until Extensiv is connected.
 * Checks sunset date - skips sync if today >= sunset date.
 */
async function syncShopifyInventoryAfterOrder(
  lineItemsWithProducts: Array<{ sku: string; productId: string | null }>,
  userId: string,
  orderName: string
): Promise<void> {
  try {
    const settings = await storage.getAiAgentSettingsByUserId(userId);
    
    if (settings?.shopifyInventorySunsetDate) {
      const sunsetDate = new Date(settings.shopifyInventorySunsetDate);
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const sunsetStr = sunsetDate.toISOString().split('T')[0];
      
      if (todayStr >= sunsetStr) {
        console.log(`[Shopify Webhook] Skipping inventory sync - sunset date reached (today: ${todayStr}, sunset: ${sunsetStr})`);
        return;
      }
    }
    
    const syncService = new ShopifyInventorySyncService();
    const initialized = await syncService.initialize(userId);
    
    if (!initialized) {
      console.log(`[Shopify Webhook] Shopify sync service not configured, skipping inventory sync`);
      return;
    }
    
    const pivotLocationId = syncService.getPivotLocationId();
    if (!pivotLocationId) {
      console.log(`[Shopify Webhook] No Pivot location ID configured, skipping inventory sync`);
      return;
    }
    
    let syncedCount = 0;
    
    for (const lineItem of lineItemsWithProducts) {
      if (!lineItem.productId) continue;
      
      const item = await storage.getItem(lineItem.productId);
      if (!item || !item.shopifyInventoryItemId) continue;
      
      const shopifyLevel = await syncService.getInventoryLevel(item.shopifyInventoryItemId, pivotLocationId);
      
      if (shopifyLevel !== null && shopifyLevel !== item.availableForSaleQty) {
        await storage.updateItem(item.id, { availableForSaleQty: shopifyLevel });
        console.log(`[Shopify Webhook] Synced ${item.sku} availableForSaleQty: ${item.availableForSaleQty} -> ${shopifyLevel}`);
        syncedCount++;
      }
    }
    
    if (syncedCount > 0) {
      console.log(`[Shopify Webhook] Inventory sync complete for order ${orderName}: ${syncedCount} items updated`);
    }
  } catch (error: any) {
    console.warn(`[Shopify Webhook] Inventory sync failed (non-blocking):`, error.message);
  }
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
    
    // Start optimistically with PIVOT_EXTENSIV - will downgrade to HILDALE if ANY item needs it
    let fulfillmentSource: 'HILDALE' | 'PIVOT_EXTENSIV' = 'PIVOT_EXTENSIV';
    
    const lineItemsWithProducts: Array<{
      sku: string;
      productId: string | null;
      productName: string;
      qtyOrdered: number;
      unitPrice: number;
    }> = [];
    
    try {
      const decisionService = new FulfillmentDecisionService();
      
      if (payload.line_items) {
        for (const lineItem of payload.line_items) {
          const sku = lineItem.sku || `SHOPIFY-${lineItem.id}`;
          const item = await storage.getItemBySku(sku);
          const productName = lineItem.title || lineItem.name || sku;
          
          lineItemsWithProducts.push({
            sku,
            productId: item?.id || null,
            productName,
            qtyOrdered: lineItem.quantity,
            unitPrice: parseFloat(lineItem.price) || 0,
          });
          
          if (item) {
            const decision = await decisionService.decideSource(item, lineItem.quantity, userId);
            // If ANY item needs Hildale, the whole order is marked HILDALE (conservative approach)
            if (decision.source === 'HILDALE') {
              fulfillmentSource = 'HILDALE';
            }
          } else {
            // Unknown SKU - default to Hildale for safety
            fulfillmentSource = 'HILDALE';
          }
        }
      }
    } catch (decisionError: any) {
      console.warn(`[Shopify Webhook] Fulfillment decision failed, defaulting to HILDALE:`, decisionError.message);
      fulfillmentSource = 'HILDALE';
    }

    const customerName = payload.customer
      ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim() || 'Unknown Customer'
      : 'Unknown Customer';

    // Extract shipping address from payload
    const shippingAddr = payload.shipping_address || {};
    
    // Use shipment_status-aware status mapping for accurate delivery tracking
    const orderStatus = mapShopifyOrderStatusWithTracking(
      payload.financial_status, 
      payload.fulfillment_status,
      payload.fulfillments
    );
    
    // Extract deliveredAt from fulfillments if delivered
    let deliveredAt: Date | null = null;
    if (orderStatus === 'DELIVERED' && payload.fulfillments) {
      for (const f of payload.fulfillments) {
        if (f.shipment_status === 'delivered' && f.updated_at) {
          deliveredAt = new Date(f.updated_at);
          break;
        }
      }
    }
    
    let isExistingOrder = false;
    const salesOrder = await (async () => {
      try {
        return await storage.createSalesOrder({
          externalOrderId: String(orderId),
          channel: 'SHOPIFY',
          customerName,
          customerEmail: payload.customer?.email || payload.email || null,
          customerPhone: payload.customer?.phone || payload.phone || null,
          status: orderStatus,
          orderDate: new Date(payload.created_at || Date.now()),
          expectedDeliveryDate: null,
          deliveredAt,
          sourceUrl: `https://${context.shopDomain}/admin/orders/${orderId}`,
          totalAmount: payload.total_price ? parseFloat(payload.total_price) : 0,
          currency: payload.currency || 'USD',
          fulfillmentSource,
          rawPayload: payload,
          shipToStreet: shippingAddr.address1 || null,
          shipToCity: shippingAddr.city || null,
          shipToState: shippingAddr.province_code || shippingAddr.province || null,
          shipToZip: shippingAddr.zip || null,
          shipToCountry: shippingAddr.country_code || shippingAddr.country || null,
        });
      } catch (err: any) {
        // Race condition: orders/updated and orders/create can arrive simultaneously.
        // If another webhook already created this order, just use the existing one.
        if (err.code === '23505' || err.message?.includes('duplicate key')) {
          console.log(`[Shopify Webhook] Order ${orderName} already exists (race condition), using existing record`);
          const existing = await storage.getSalesOrdersByExternalId('SHOPIFY', String(orderId));
          if (existing[0]) {
            isExistingOrder = true;
            return existing[0];
          }
        }
        throw err;
      }
    })();

    // If we hit a race condition and found an existing order, skip all line item creation,
    // inventory movements, and GHL syncs — the first webhook already handled all of that.
    if (isExistingOrder) {
      return {
        success: true,
        message: `Order ${orderName} already processed (race condition resolved)`,
        data: { salesOrderId: salesOrder.id, raceCondition: true },
      };
    }

    console.log(`[Shopify Webhook] Created sales order ${salesOrder.id} for Shopify order ${orderName}`);

    const inventoryMovement = new InventoryMovement(storage);
    
    // Track line items for GHL shortage alerts
    const lineItemsForAlerts: Array<{
      itemId: string;
      sku: string;
      itemName: string;
      requestedQty: number;
      allocatedQty: number;
      backorderQty: number;
      contactId?: string;
    }> = [];
    
    for (const lineItem of lineItemsWithProducts) {
      // Get product info if it exists
      const item = lineItem.productId ? await storage.getItem(lineItem.productId) : null;
      
      // Calculate allocation based on available stock (only if product exists)
      const availableStock = item?.availableForSaleQty ?? 0;
      const qtyToAllocate = lineItem.productId ? Math.min(lineItem.qtyOrdered, availableStock) : 0;
      const qtyBackordered = lineItem.qtyOrdered - qtyToAllocate;
      
      // ALWAYS create sales order line (even for unmapped SKUs)
      await storage.createSalesOrderLine({
        salesOrderId: salesOrder.id,
        productId: lineItem.productId || null,
        sku: lineItem.sku,
        productName: lineItem.productName,
        qtyOrdered: lineItem.qtyOrdered,
        qtyAllocated: qtyToAllocate,
        backorderQty: qtyBackordered,
        unitPrice: lineItem.unitPrice,
      });
      
      if (lineItem.productId && item && item.type === 'finished_product') {
        // Apply inventory movement for the allocated quantity
        // INVARIANT: Sales only decrement availableForSaleQty, NOT pivotQty
        if (qtyToAllocate > 0) {
          await inventoryMovement.apply({
            eventType: 'SALES_ORDER_CREATED',
            itemId: lineItem.productId,
            quantity: qtyToAllocate, // Positive quantity - the service handles the decrement
            location: 'PIVOT',
            source: 'SHOPIFY',
            orderId: salesOrder.id,
            notes: `Shopify order ${orderName}`,
            userId,
          });
          
          console.log(`[Shopify Webhook] Allocated ${qtyToAllocate} of ${lineItem.sku} (availableForSaleQty decremented) for order ${orderName}`);
        }
        
        if (qtyBackordered > 0) {
          console.warn(`[Shopify Webhook] BACKORDER: ${qtyBackordered} of ${lineItem.sku} for order ${orderName}`);
          
          await logService.logShopifyBackorder({
            orderId: salesOrder.id,
            orderNumber: orderName,
            itemId: lineItem.productId,
            sku: lineItem.sku,
            qtyOrdered: lineItem.qtyOrdered,
            qtyAllocated: qtyToAllocate,
            qtyBackordered,
            availableStock,
          });
          
          // Track for GHL shortage alert
          lineItemsForAlerts.push({
            itemId: lineItem.productId,
            sku: lineItem.sku,
            itemName: item.name,
            requestedQty: lineItem.qtyOrdered,
            allocatedQty: qtyToAllocate,
            backorderQty: qtyBackordered,
          });
        }
      } else if (!lineItem.productId) {
        // Log SKU mismatch for unmapped products (but still create the line)
        console.warn(`[Shopify Webhook] Unmapped SKU: ${lineItem.sku} - line item created without inventory allocation`);
        
        await logService.logSkuMismatch({
          source: 'SHOPIFY',
          orderId: salesOrder.id,
          externalSku: lineItem.sku,
        });
      }
    }
    
    // Trigger GHL "Needs Attention" alerts for any backorders
    if (lineItemsForAlerts.length > 0) {
      triggerShortageAlertsForOrder(
        storage,
        salesOrder.id,
        orderName,
        lineItemsForAlerts,
        'SHOPIFY',
        userId
      )
        .then(results => {
          const successful = results.filter(r => r.success).length;
          console.log(`[Shopify Webhook] GHL shortage alerts: ${successful}/${results.length} created for order ${orderName}`);
        })
        .catch(err => console.warn(`[Shopify Webhook] GHL shortage alert failed (non-blocking):`, err.message));
    }
    
    // Trigger GHL "Needs Attention" alert if fulfillment source is HILDALE (Pivot has no stock)
    if (fulfillmentSource === 'HILDALE') {
      const lineItemSummary = lineItemsWithProducts.map(li => `${li.sku} x${li.qtyOrdered}`).join(', ');
      triggerHildaleFulfillmentAlert(
        storage,
        salesOrder.id,
        orderName,
        lineItemSummary,
        'HILDALE',
        userId
      )
        .then(result => {
          if (result.success) {
            console.log(`[Shopify Webhook] GHL Hildale fulfillment alert created for order ${orderName}: ${result.opportunityId}`);
          }
        })
        .catch(err => console.warn(`[Shopify Webhook] GHL Hildale alert failed (non-blocking):`, err.message));
    }

    triggerSalesOrderSync(userId, salesOrder.id, false)
      .then(() => console.log(`[Shopify Webhook] GHL sync triggered for order ${salesOrder.id}`))
      .catch((err: any) => console.warn(`[Shopify Webhook] GHL sync failed (non-blocking):`, err.message));

    syncShopifyInventoryAfterOrder(lineItemsWithProducts, userId, orderName)
      .then(() => {})
      .catch((err: any) => console.warn(`[Shopify Webhook] Shopify inventory sync failed (non-blocking):`, err.message));

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
      // Use shipment_status-aware status mapping
      const newStatus = mapShopifyOrderStatusWithTracking(
        payload.financial_status, 
        payload.fulfillment_status,
        payload.fulfillments
      );
      const previousStatus = existingOrder.status;
      
      // Status progression hierarchy (higher = more advanced)
      const statusOrder: Record<string, number> = {
        'DRAFT': 0,
        'ORDERED': 1,
        'SHIPPED': 2,
        'DELIVERED': 3,
        'CANCELLED': 4,  // Special case - can override anything
        'REFUNDED': 5,   // Special case - can override anything
      };
      
      // Guard against status downgrades (don't go backwards unless cancelled/refunded)
      const previousRank = statusOrder[previousStatus] ?? 1;
      const newRank = statusOrder[newStatus] ?? 1;
      const shouldUpdate = newRank >= previousRank || newStatus === 'CANCELLED' || newStatus === 'REFUNDED';
      
      if (shouldUpdate) {
        // Extract deliveredAt from fulfillments if becoming delivered
        let deliveredAt: Date | undefined;
        if (newStatus === 'DELIVERED' && previousStatus !== 'DELIVERED' && payload.fulfillments) {
          for (const f of payload.fulfillments) {
            if (f.shipment_status === 'delivered' && f.updated_at) {
              deliveredAt = new Date(f.updated_at);
              break;
            }
          }
        }
        
        await storage.updateSalesOrder(existingOrder.id, {
          status: newStatus,
          ...(deliveredAt && { deliveredAt }),
          rawPayload: payload,
        });

        console.log(`[Shopify Webhook] Updated order ${existingOrder.id} status: ${previousStatus} -> ${newStatus}`);
      } else {
        console.log(`[Shopify Webhook] Skipped status downgrade for order ${existingOrder.id}: ${previousStatus} -> ${newStatus}`);
      }
      
      return {
        success: true,
        message: `Order ${orderName} updated`,
        data: { salesOrderId: existingOrder.id, newStatus, previousStatus },
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

/**
 * Extract the highest priority shipment_status from order fulfillments
 * Returns the most advanced tracking status across all fulfillments
 */
function extractBestShipmentStatus(fulfillments: any[] | undefined): string | null {
  if (!fulfillments || !Array.isArray(fulfillments)) return null;
  
  const statusPriority: Record<string, number> = {
    'delivered': 5,
    'out_for_delivery': 4,
    'in_transit': 3,
    'confirmed': 2,
    'attempted_delivery': 1,
    'label_printed': 0,
    'label_purchased': 0,
  };
  
  let bestStatus: string | null = null;
  let highestPriority = -1;
  
  for (const fulfillment of fulfillments) {
    const status = fulfillment.shipment_status;
    const priority = statusPriority[status] ?? -1;
    if (priority > highestPriority) {
      highestPriority = priority;
      bestStatus = status;
    }
  }
  
  return bestStatus;
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
      // Check actual shipment_status from fulfillments to determine status
      // "Fulfilled" doesn't mean delivered - it means all items have been shipped
      const shipmentStatus = extractBestShipmentStatus(payload.fulfillments);
      const newStatus = mapShipmentStatusToOrderStatus(shipmentStatus);
      
      // Extract delivery date from fulfillment if delivered
      let deliveredAt: Date | undefined;
      if (shipmentStatus === 'delivered' && payload.fulfillments) {
        for (const f of payload.fulfillments) {
          if (f.shipment_status === 'delivered' && f.updated_at) {
            deliveredAt = new Date(f.updated_at);
            break;
          }
        }
      }
      
      await storage.updateSalesOrder(existingOrder.id, {
        status: newStatus,
        ...(deliveredAt && { deliveredAt }),
        rawPayload: payload,
      });
      
      console.log(`[Shopify Webhook] Order ${existingOrder.id} status: ${newStatus} (shipment: ${shipmentStatus || 'not tracked'})`);

      // ─── BOM SUBTRACTION: Subtract raw materials for each fulfilled line item ───
      // When a finished product ships, look up its Bill of Materials and subtract
      // the required components from raw material inventory automatically.
      // NOTE: If Clarence also logs production via the Production Screen, components
      // are subtracted there too. Use ONE path operationally — not both.
      try {
        const lineItems = payload.line_items || [];
        const inventoryMovement = new InventoryMovement(storage);
        let bomSubtractionsApplied = 0;
        let bomWarnings: string[] = [];

        for (const lineItem of lineItems) {
          const sku = lineItem.sku;
          const qtyFulfilled = lineItem.quantity || 1;

          if (!sku) {
            bomWarnings.push(`Line item "${lineItem.title || lineItem.name || 'unknown'}" has no SKU — skipped BOM subtraction`);
            continue;
          }

          // Find the product by SKU — try shopifySku first, then house sku
          let product = await storage.findProductByShopifySku(sku);
          if (!product) {
            product = await storage.getItemBySku(sku);
          }

          if (!product) {
            bomWarnings.push(`SKU ${sku} not found in database — skipped BOM subtraction`);
            continue;
          }

          if (product.type !== 'finished_product') {
            continue; // Only finished products have BOMs
          }

          // Look up the BOM for this finished product
          const bom = await storage.getBillOfMaterialsByProductId(product.id);
          if (!bom || bom.length === 0) {
            bomWarnings.push(`No BOM defined for ${sku} (${product.name}) — raw materials NOT subtracted`);
            continue;
          }

          // Subtract each component based on BOM × quantity fulfilled
          for (const bomEntry of bom) {
            const requiredQty = bomEntry.quantityRequired * qtyFulfilled;

            const result = await inventoryMovement.apply({
              eventType: "BOM_CONSUMPTION",
              itemId: bomEntry.componentId,
              quantity: requiredQty,
              location: "N/A",
              source: "SHOPIFY",
              orderId: String(orderId),
              channel: "shopify",
              userId,
              notes: `BOM consumption: ${requiredQty} units consumed for ${qtyFulfilled}x ${sku} (Order ${orderName})`,
            });

            if (result.success) {
              bomSubtractionsApplied++;
            } else {
              bomWarnings.push(`Failed to subtract component ${result.sku} for ${sku}: ${result.error}`);
            }
          }
        }

        if (bomSubtractionsApplied > 0) {
          console.log(`[Shopify Webhook] BOM subtraction: ${bomSubtractionsApplied} component(s) subtracted for order ${orderName}`);
        }
        if (bomWarnings.length > 0) {
          console.warn(`[Shopify Webhook] BOM warnings for order ${orderName}:`, bomWarnings);
        }
      } catch (bomError: any) {
        // BOM subtraction failure should NOT block order fulfillment processing
        console.error(`[Shopify Webhook] BOM subtraction error for order ${orderName}:`, bomError);
      }
      // ─── END BOM SUBTRACTION ───

      return { success: true, message: `Order ${orderName} fulfilled, status: ${newStatus}` };
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
        status: 'ORDERED',
        rawPayload: payload,
      });
      console.log(`[Shopify Webhook] Order ${existingOrder.id} marked as ORDERED after payment`);
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
      // Check actual shipment_status from fulfillments
      const shipmentStatus = extractBestShipmentStatus(payload.fulfillments);
      const newStatus = mapShipmentStatusToOrderStatus(shipmentStatus);
      
      // Extract delivery date if any fulfillment is delivered
      let deliveredAt: Date | undefined;
      if (shipmentStatus === 'delivered' && payload.fulfillments) {
        for (const f of payload.fulfillments) {
          if (f.shipment_status === 'delivered' && f.updated_at) {
            deliveredAt = new Date(f.updated_at);
            break;
          }
        }
      }
      
      await storage.updateSalesOrder(existingOrder.id, {
        status: newStatus,
        ...(deliveredAt && { deliveredAt }),
        rawPayload: payload,
      });
      console.log(`[Shopify Webhook] Order ${existingOrder.id} status: ${newStatus} (shipment: ${shipmentStatus || 'not tracked'})`);
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
    // Check if we already have a return for this refund (idempotency)
    const existingReturns = await storage.getReturnRequestByExternalOrderId(`SHOPIFY-REFUND-${refundId}`);
    if (existingReturns.length > 0) {
      console.log(`[Shopify Webhook] Refund ${refundId} already processed as return ${existingReturns[0].id}`);
      return {
        success: true,
        message: `Refund ${refundId} already processed`,
        data: { refundId, returnRequestId: existingReturns[0].id },
      };
    }
    
    let existingOrder = null;
    if (orderId) {
      const existingOrders = await storage.getSalesOrdersByExternalId('SHOPIFY', String(orderId));
      existingOrder = existingOrders[0];
    }
    
    // Check if order ever shipped - if not, this is a cancellation, not a return
    // Only create returns for orders that have shipped (SHIPPED or DELIVERED status)
    const shippedStatuses = ['SHIPPED', 'DELIVERED'];
    const terminalStatuses = ['CANCELLED', 'REFUNDED'];
    
    // If no existing order found locally, skip creating return - we can't verify shipment
    if (!existingOrder) {
      console.log(`[Shopify Webhook] Order ${orderId} not found locally - skipping return creation (cannot verify shipment)`);
      return {
        success: true,
        message: `Order ${orderId} not found locally - skipped (cannot verify shipment)`,
        data: { refundId, orderId, action: 'skipped_no_order' },
      };
    }
    
    if (!shippedStatuses.includes(existingOrder.status)) {
      // Order never shipped - mark as CANCELLED instead of creating a return
      // But don't overwrite if already in a terminal status
      if (!terminalStatuses.includes(existingOrder.status)) {
        console.log(`[Shopify Webhook] Order ${orderId} status is ${existingOrder.status} (never shipped) - marking as CANCELLED`);
        
        await storage.updateSalesOrder(existingOrder.id, { 
          status: 'CANCELLED',
        });
        
        // Log the cancellation
        await logService.logSystemEvent({
          type: 'SHOPIFY_ORDER_CANCELLED',
          entityType: 'SALES_ORDER',
          entityId: existingOrder.id,
          message: `Order ${existingOrder.externalOrderId} cancelled via Shopify refund (never shipped)`,
          details: { refundId, orderId, originalStatus: existingOrder.status },
        });
      } else {
        console.log(`[Shopify Webhook] Order ${orderId} already in terminal status ${existingOrder.status} - skipping status update`);
      }
      
      return {
        success: true,
        message: `Order ${orderId} marked as CANCELLED (never shipped)`,
        data: { refundId, orderId, action: 'cancelled' },
      };
    }
    
    // Extract customer info from the original order or payload
    const customerName = existingOrder?.customerName || 
      (payload.customer ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim() : 'Shopify Customer') ||
      'Unknown Customer';
    const customerEmail = existingOrder?.customerEmail || payload.customer?.email || null;
    const customerPhone = existingOrder?.customerPhone || payload.customer?.phone || null;
    
    // Calculate total refund amount from transactions
    const totalRefundAmount = (payload.transactions || [])
      .filter((t: any) => t.kind === 'refund' && t.status === 'success')
      .reduce((sum: number, t: any) => sum + parseFloat(t.amount || 0), 0);
    
    // Extract shipping refund amount if present
    const shippingRefundAmount = (payload.order_adjustments || [])
      .filter((a: any) => a.kind === 'shipping_refund')
      .reduce((sum: number, a: any) => sum + Math.abs(parseFloat(a.amount || 0)), 0);
    
    // Generate RMA number
    const rmaNumber = await storage.getNextRMANumber();
    
    // Create the return request - since this comes from Shopify, the refund is already processed
    // Status is REFUNDED (terminal) because Shopify has already completed the refund
    const returnRequest = await storage.createReturnRequest({
      rmaNumber,
      salesOrderId: existingOrder?.id || null,
      orderNumber: existingOrder?.externalOrderId || String(orderId),
      externalOrderId: `SHOPIFY-REFUND-${refundId}`, // Use refund ID to ensure uniqueness
      salesChannel: 'SHOPIFY',
      source: 'SHOPIFY_WEBHOOK',
      customerName,
      customerEmail,
      customerPhone,
      status: 'REFUNDED', // Terminal status - refund already happened in Shopify
      resolutionRequested: 'REFUND',
      resolutionFinal: 'REFUND',
      resolutionNotes: `Refund processed via Shopify. Amount: $${totalRefundAmount.toFixed(2)}${shippingRefundAmount > 0 ? ` (incl. shipping: $${shippingRefundAmount.toFixed(2)})` : ''}`,
      reason: payload.note || 'Refund from Shopify',
      requestedAt: new Date(payload.created_at || Date.now()),
      refundedAt: new Date(payload.processed_at || payload.created_at || Date.now()),
      isHistorical: true, // Already complete, goes to history
      archivedAt: new Date(),
      // Financial data from Shopify - always set numeric values to avoid nulls
      finalRefundAmount: totalRefundAmount,
      shippingCost: shippingRefundAmount,
      baseRefundAmount: Math.max(0, totalRefundAmount - shippingRefundAmount),
    });
    
    console.log(`[Shopify Webhook] Created return request ${returnRequest.id} (RMA: ${rmaNumber}) for refund ${refundId}`);
    
    // Create return items from refund_line_items
    const refundLineItems = payload.refund_line_items || [];
    let itemsCreated = 0;
    
    for (const refundLineItem of refundLineItems) {
      const lineItem = refundLineItem.line_item || {};
      const sku = lineItem.sku || `SHOPIFY-LINE-${refundLineItem.line_item_id}`;
      const quantity = refundLineItem.quantity || 1;
      const unitPrice = parseFloat(lineItem.price) || 0;
      const productName = lineItem.title || lineItem.name || 'Unknown Product';
      
      // Try to find the matching inventory item
      const item = await storage.getItemBySku(sku);
      
      // Create the return item
      await storage.createReturnItem({
        returnRequestId: returnRequest.id,
        inventoryItemId: item?.id || null,
        sku,
        productName,
        unitPrice,
        qtyOrdered: lineItem.quantity || quantity,
        qtyRequested: quantity,
        qtyApproved: quantity, // Already approved since refund happened
        qtyReceived: refundLineItem.restock_type === 'return' ? quantity : 0, // Only mark received if returned
        condition: refundLineItem.restock_type === 'return' ? 'GOOD' : null,
        disposition: refundLineItem.restock_type === 'return' ? 'RETURN_TO_STOCK' : null,
        itemReason: `Shopify refund (${refundLineItem.restock_type || 'no_restock'})`,
      });
      
      itemsCreated++;
      console.log(`[Shopify Webhook] Created return item for SKU ${sku} (qty: ${quantity})`);
    }
    
    // Log the refund event
    await logService.logSystemEvent({
      type: 'SHOPIFY_REFUND_RECEIVED',
      entityType: 'RETURN_REQUEST',
      entityId: returnRequest.id,
      message: `Shopify refund ${refundId} created as return ${rmaNumber}`,
      details: { 
        refundId, 
        orderId, 
        amount: totalRefundAmount,
        itemsCount: itemsCreated,
        rmaNumber,
        linkedSalesOrderId: existingOrder?.id,
        userId,
      },
    });
    
    return { 
      success: true, 
      message: `Refund ${refundId} created as return ${rmaNumber} with ${itemsCreated} items`,
      data: { 
        refundId, 
        orderId, 
        returnRequestId: returnRequest.id,
        rmaNumber,
        itemsCreated,
        linkedSalesOrderId: existingOrder?.id,
      },
    };
  } catch (error: any) {
    console.error(`[Shopify Webhook] Error handling refund:`, error);
    await logService.logShopifyWebhookError({
      topic: context.topic,
      shopDomain: context.shopDomain,
      externalOrderId: String(refundId),
      error: error.message,
      errorDetails: { stack: error.stack, orderId },
    });
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

/**
 * Map Shopify shipment_status to internal order status
 * Shopify values: label_printed, label_purchased, confirmed, in_transit, out_for_delivery, delivered, attempted_delivery, failure
 */
function mapShipmentStatusToOrderStatus(shipmentStatus: string | null | undefined): string {
  if (shipmentStatus === 'delivered') {
    return 'DELIVERED';
  }
  if (shipmentStatus === 'in_transit' || shipmentStatus === 'out_for_delivery' || 
      shipmentStatus === 'confirmed' || shipmentStatus === 'attempted_delivery') {
    return 'SHIPPED';
  }
  // For label_printed, label_purchased, or null - still SHIPPED (fulfillment exists)
  return 'SHIPPED';
}

export async function handleFulfillmentCreated(
  payload: ShopifyWebhookPayload,
  context: ShopifyWebhookContext,
  userId: string
): Promise<WebhookHandlerResult> {
  const fulfillmentId = payload.id;
  const orderId = payload.order_id;
  const trackingNumber = payload.tracking_number;
  const trackingCompany = payload.tracking_company;
  const shipmentStatus = payload.shipment_status;
  
  console.log(`[Shopify Webhook] fulfillments/create - Fulfillment ${fulfillmentId} for order ${orderId}`);
  console.log(`  - Shipment status: ${shipmentStatus || 'not yet tracked'}`);
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
      // Map shipment_status to our order status (SHIPPED or DELIVERED)
      const newStatus = mapShipmentStatusToOrderStatus(shipmentStatus);
      
      // Extract delivery date from fulfillment timestamp if status is delivered
      const deliveredAt = shipmentStatus === 'delivered' && payload.updated_at 
        ? new Date(payload.updated_at) 
        : undefined;
      
      await storage.updateSalesOrder(existingOrder.id, {
        status: newStatus,
        ...(deliveredAt && { deliveredAt }),
        rawPayload: { ...((existingOrder.rawPayload as any) || {}), lastFulfillment: payload },
      });
      
      console.log(`  - Updated order ${existingOrder.id} status to ${newStatus}`);
    }
    
    return { 
      success: true, 
      message: `Fulfillment ${fulfillmentId} created, status: ${shipmentStatus || 'pending'}`,
      data: { fulfillmentId, orderId, trackingNumber, shipmentStatus },
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
  const orderId = payload.order_id;
  const status = payload.status;
  const shipmentStatus = payload.shipment_status;
  
  console.log(`[Shopify Webhook] fulfillments/update - Fulfillment ${fulfillmentId}`);
  console.log(`  - Fulfillment status: ${status}, Shipment status: ${shipmentStatus || 'not tracked'}`);
  
  try {
    // Find the order and update its status based on shipment_status
    if (orderId) {
      const existingOrders = await storage.getSalesOrdersByExternalId('SHOPIFY', String(orderId));
      const existingOrder = existingOrders[0];
      
      if (existingOrder) {
        const newStatus = mapShipmentStatusToOrderStatus(shipmentStatus);
        const previousStatus = existingOrder.status;
        
        // Only update if status is changing or becoming more advanced
        // Don't downgrade from DELIVERED to SHIPPED
        if (previousStatus !== 'DELIVERED' || newStatus === 'DELIVERED') {
          // Extract delivery date from fulfillment timestamp if status is delivered
          const deliveredAt = shipmentStatus === 'delivered' && payload.updated_at 
            ? new Date(payload.updated_at) 
            : undefined;
          
          await storage.updateSalesOrder(existingOrder.id, {
            status: newStatus,
            ...(deliveredAt && { deliveredAt }),
            rawPayload: { ...((existingOrder.rawPayload as any) || {}), lastFulfillment: payload },
          });
          
          console.log(`  - Updated order ${existingOrder.id} status: ${previousStatus} -> ${newStatus}`);
          
          // Trigger GHL sync if delivered (for review request workflows)
          if (newStatus === 'DELIVERED' && previousStatus !== 'DELIVERED') {
            try {
              const { triggerSalesOrderSync } = await import('../services/ghl-sync-triggers');
              await triggerSalesOrderSync(userId, existingOrder.id, false);
              console.log(`  - Triggered GHL sync for delivery notification`);
            } catch (syncErr: any) {
              console.warn(`  - GHL sync failed (non-blocking):`, syncErr.message);
            }
          }
        }
      }
    }
    
    return { 
      success: true, 
      message: `Fulfillment ${fulfillmentId} updated, shipment: ${shipmentStatus || 'pending'}`,
      data: { fulfillmentId, orderId, shipmentStatus },
    };
  } catch (error: any) {
    console.error(`[Shopify Webhook] Error handling fulfillment update:`, error);
    return { success: false, message: error.message };
  }
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

/**
 * Map Shopify order status to internal status using shipment_status for delivery tracking
 * This is the unified status mapper that respects Shopify's actual tracking status
 */
function mapShopifyOrderStatusWithTracking(
  financialStatus: string | null, 
  fulfillmentStatus: string | null,
  fulfillments: any[] | undefined
): string {
  // Cancelled/refunded takes priority
  if (financialStatus === 'refunded' || financialStatus === 'voided') {
    return 'CANCELLED';
  }
  
  // Check actual shipment tracking status from fulfillments
  const shipmentStatus = extractBestShipmentStatus(fulfillments);
  
  // Use shipment_status for accurate delivery tracking
  if (shipmentStatus === 'delivered') {
    return 'DELIVERED';
  }
  if (shipmentStatus === 'in_transit' || shipmentStatus === 'out_for_delivery' || 
      shipmentStatus === 'confirmed' || shipmentStatus === 'attempted_delivery') {
    return 'SHIPPED';
  }
  
  // If fulfilled/partial but no shipment_status yet, it's shipped (label created)
  if (fulfillmentStatus === 'fulfilled' || fulfillmentStatus === 'partial') {
    return 'SHIPPED';
  }
  
  // Pending payment
  if (financialStatus === 'pending' || financialStatus === 'authorized') {
    return 'DRAFT';
  }
  
  // Paid but not fulfilled
  if (financialStatus === 'paid') {
    return 'ORDERED';
  }
  
  return 'ORDERED';
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
