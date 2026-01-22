import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@shared/schema";
import { items, salesOrders, salesOrderLines, purchaseOrders, purchaseOrderLines, suppliers, returnItems, type Item, type SalesOrder, type SalesOrderLine, type Supplier } from "@shared/schema";
import { eq, ilike, and, or, lt, desc } from "drizzle-orm";
import { GoHighLevelClient } from "../services/gohighlevel-client";
import { storage } from "../storage";
import { returnsService } from "../services/returns-service";
import bcrypt from "bcrypt";

const GHL_AGENT_API_KEY_ENV = "GHL_AGENT_API_KEY";

let cachedDb: ReturnType<typeof drizzle> | null = null;
const getDb = () => {
  if (!cachedDb) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    const sqlClient = neon(process.env.DATABASE_URL);
    cachedDb = drizzle(sqlClient, { schema });
  }
  return cachedDb;
};

async function requireGhlAgentAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      status: "error",
      message: "Missing or invalid Authorization header. Use: Bearer YOUR_API_KEY",
      error_code: "UNAUTHORIZED"
    });
  }
  
  const token = authHeader.substring(7);
  
  const envKey = process.env[GHL_AGENT_API_KEY_ENV];
  if (envKey && token === envKey) {
    return next();
  }
  
  try {
    const dbKey = await storage.getApiKeyByName('GHL_AGENT_API_KEY');
    if (dbKey?.isActive) {
      const isValid = await bcrypt.compare(token, dbKey.keyHash);
      if (isValid) {
        storage.updateApiKeyLastUsed(dbKey.id).catch(console.error);
        return next();
      }
    }
  } catch (error) {
    console.error("[GHL Agent API] DB key check error:", error);
  }
  
  if (!envKey) {
    const dbKey = await storage.getApiKeyByName('GHL_AGENT_API_KEY');
    if (!dbKey?.isActive) {
      console.error("[GHL Agent API] No API key configured");
      return res.status(500).json({
        status: "error",
        message: "API not configured. Generate an API key in Settings.",
        error_code: "NOT_CONFIGURED"
      });
    }
  }
  
  return res.status(403).json({
    status: "error",
    message: "Invalid API key",
    error_code: "FORBIDDEN"
  });
}

function handleError(res: Response, error: unknown, errorCode: string = "INTERNAL_ERROR") {
  console.error(`[GHL Agent API] Error:`, error);
  const message = error instanceof Error ? error.message : "An unexpected error occurred";
  return res.status(500).json({
    status: "error",
    message,
    error_code: errorCode
  });
}

export function registerGhlAgentApiRoutes(app: express.Application) {
  const router = express.Router();
  
  router.use(requireGhlAgentAuth);
  
  router.post("/inventory/reorder-status", async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const allItems = await db
        .select()
        .from(items)
        .where(
          and(
            eq(items.type, "finished_product"),
            lt(items.availableForSaleQty, items.minStock)
          )
        );
      
      const itemsNeedOrdering = allItems.map((item: Item) => ({
        product_name: item.name,
        sku: item.sku,
        current_quantity: item.availableForSaleQty,
        reorder_threshold: item.minStock,
        suggested_order_quantity: Math.max(item.minStock * 2 - item.availableForSaleQty, item.minStock)
      }));
      
      return res.json({
        status: "success",
        items_need_ordering: itemsNeedOrdering,
        total_items_low: itemsNeedOrdering.length
      });
    } catch (error) {
      return handleError(res, error);
    }
  });
  
  const orderLookupSchema = z.object({
    order_number: z.string().min(1)
  });
  
  router.post("/orders/lookup", async (req: Request, res: Response) => {
    try {
      const parsed = orderLookupSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          status: "error",
          message: "order_number is required",
          error_code: "INVALID_REQUEST"
        });
      }
      
      const { order_number } = parsed.data;
      const db = getDb();
      
      const orders = await db
        .select()
        .from(salesOrders)
        .where(
          or(
            eq(salesOrders.externalOrderId, order_number),
            eq(salesOrders.id, order_number)
          )
        )
        .limit(1);
      
      if (orders.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Order not found",
          error_code: "NOT_FOUND"
        });
      }
      
      const order = orders[0];
      
      const lines = await db
        .select()
        .from(salesOrderLines)
        .where(eq(salesOrderLines.salesOrderId, order.id));
      
      const isDelivered = order.status === "DELIVERED" && order.deliveredAt;
      const daysSinceDelivery = isDelivered && order.deliveredAt
        ? Math.floor((Date.now() - new Date(order.deliveredAt).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const isRefundable = isDelivered && daysSinceDelivery !== null && daysSinceDelivery <= 30;
      
      return res.json({
        status: "success",
        order: {
          order_number: order.externalOrderId || order.id,
          customer_name: order.customerName,
          customer_email: order.customerEmail,
          order_date: order.orderDate ? new Date(order.orderDate).toISOString().split("T")[0] : null,
          items: lines.map((line: SalesOrderLine) => ({
            product_name: line.productName || line.sku,
            sku: line.sku,
            quantity: line.qtyOrdered,
            price: line.unitPrice || 0
          })),
          order_total: order.totalAmount,
          shipping_status: order.status?.toLowerCase() || "unknown",
          tracking_number: null,
          delivery_date: order.deliveredAt ? new Date(order.deliveredAt).toISOString().split("T")[0] : null,
          is_refundable: isRefundable,
          days_since_delivery: daysSinceDelivery
        }
      });
    } catch (error) {
      return handleError(res, error);
    }
  });
  
  const orderSearchSchema = z.object({
    name: z.string().min(1)
  });
  
  router.post("/orders/search", async (req: Request, res: Response) => {
    try {
      const parsed = orderSearchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          status: "error",
          message: "name is required for search",
          error_code: "INVALID_REQUEST"
        });
      }
      
      const { name } = parsed.data;
      const db = getDb();
      
      const orders = await db
        .select()
        .from(salesOrders)
        .where(ilike(salesOrders.customerName, `%${name}%`))
        .orderBy(desc(salesOrders.orderDate))
        .limit(50);
      
      if (orders.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "No orders found for that name",
          error_code: "NOT_FOUND"
        });
      }
      
      const matches = await Promise.all(orders.map(async (order: SalesOrder) => {
        const lines = await db
          .select()
          .from(salesOrderLines)
          .where(eq(salesOrderLines.salesOrderId, order.id));
        
        const itemsSummary = lines
          .map((line: SalesOrderLine) => `${line.qtyOrdered}x ${line.productName || line.sku}`)
          .join(", ");
        
        return {
          order_number: order.externalOrderId || order.id,
          customer_name: order.customerName,
          order_date: order.orderDate ? new Date(order.orderDate).toISOString().split("T")[0] : null,
          items_summary: itemsSummary || "No items",
          order_total: order.totalAmount,
          status: order.status?.toLowerCase() || "unknown"
        };
      }));
      
      return res.json({
        status: "success",
        matches,
        total_matches: matches.length
      });
    } catch (error) {
      return handleError(res, error);
    }
  });
  
  const refundCalculateSchema = z.object({
    order_number: z.string().min(1)
  });
  
  router.post("/refunds/calculate", async (req: Request, res: Response) => {
    try {
      const parsed = refundCalculateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          status: "error",
          message: "order_number is required",
          error_code: "INVALID_REQUEST"
        });
      }
      
      const { order_number } = parsed.data;
      const db = getDb();
      
      const orders = await db
        .select()
        .from(salesOrders)
        .where(
          or(
            eq(salesOrders.externalOrderId, order_number),
            eq(salesOrders.id, order_number)
          )
        )
        .limit(1);
      
      if (orders.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Order not found",
          error_code: "NOT_FOUND"
        });
      }
      
      const order = orders[0];
      
      const isDelivered = order.status === "DELIVERED" && order.deliveredAt;
      const daysSinceDelivery = isDelivered && order.deliveredAt
        ? Math.floor((Date.now() - new Date(order.deliveredAt).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      
      if (!isDelivered) {
        return res.json({
          status: "success",
          refundable: false,
          reason: `Order status is ${order.status}, not delivered`,
          refund_amount: 0
        });
      }
      
      if (daysSinceDelivery !== null && daysSinceDelivery > 30) {
        return res.json({
          status: "success",
          refundable: false,
          reason: `Order is ${daysSinceDelivery} days old, outside 30-day refund window`,
          refund_amount: 0
        });
      }
      
      const lines = await db
        .select()
        .from(salesOrderLines)
        .where(eq(salesOrderLines.salesOrderId, order.id));
      
      const originalTotal = order.totalAmount || 0;
      const shippingCost = 15.50;
      const labelCost = 1.00;
      
      const damagedItems = order.isDamaged ? lines.map((line: SalesOrderLine) => ({
        item: line.productName || line.sku,
        damage_fee: ((line.unitPrice || 0) * line.qtyOrdered) * 0.10
      })) : [];
      
      const totalDamagedFees = damagedItems.reduce((sum: number, item: { item: string; damage_fee: number }) => sum + item.damage_fee, 0);
      const refundAmount = Math.max(0, originalTotal - shippingCost - labelCost - totalDamagedFees);
      
      return res.json({
        status: "success",
        order_number,
        original_total: originalTotal,
        amount_received: originalTotal,
        shipping_cost: shippingCost,
        label_cost: labelCost,
        damaged_items: damagedItems,
        total_damaged_fees: Math.round(totalDamagedFees * 100) / 100,
        refund_amount: Math.round(refundAmount * 100) / 100,
        calculation: `${originalTotal} - ${shippingCost} - ${labelCost}${totalDamagedFees > 0 ? ` - ${totalDamagedFees.toFixed(2)}` : ""} = ${refundAmount.toFixed(2)}`,
        refundable: true,
        reason: "Within 30 day policy"
      });
    } catch (error) {
      return handleError(res, error);
    }
  });
  
  const refundProcessSchema = z.object({
    order_number: z.string().min(1),
    confirmed: z.boolean()
  });
  
  router.post("/refunds/process", async (req: Request, res: Response) => {
    try {
      const parsed = refundProcessSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          status: "error",
          message: "order_number and confirmed are required",
          error_code: "INVALID_REQUEST"
        });
      }
      
      const { order_number, confirmed } = parsed.data;
      
      if (!confirmed) {
        return res.status(400).json({
          status: "error",
          message: "Refund not confirmed by customer",
          error_code: "NOT_CONFIRMED"
        });
      }
      
      const db = getDb();
      
      const orders = await db
        .select()
        .from(salesOrders)
        .where(
          or(
            eq(salesOrders.externalOrderId, order_number),
            eq(salesOrders.id, order_number)
          )
        )
        .limit(1);
      
      if (orders.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Order not found",
          error_code: "NOT_FOUND"
        });
      }
      
      const order = orders[0];
      
      const isDelivered = order.status === "DELIVERED" && order.deliveredAt;
      const daysSinceDelivery = isDelivered && order.deliveredAt
        ? Math.floor((Date.now() - new Date(order.deliveredAt).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      
      if (!isDelivered || (daysSinceDelivery !== null && daysSinceDelivery > 30)) {
        return res.status(400).json({
          status: "error",
          message: "Order is not eligible for refund",
          error_code: "NOT_ELIGIBLE"
        });
      }
      
      const lines = await db
        .select()
        .from(salesOrderLines)
        .where(eq(salesOrderLines.salesOrderId, order.id));
      
      const originalTotal = order.totalAmount || 0;
      const shippingCost = 15.50;
      const labelCost = 1.00;
      const totalDamagedFees = order.isDamaged
        ? lines.reduce((sum: number, line: SalesOrderLine) => sum + ((line.unitPrice || 0) * line.qtyOrdered * 0.10), 0)
        : 0;
      const refundAmount = Math.max(0, originalTotal - shippingCost - labelCost - totalDamagedFees);
      
      await db
        .update(salesOrders)
        .set({
          status: "PENDING_REFUND",
          totalRefundAmount: refundAmount,
          updatedAt: new Date()
        })
        .where(eq(salesOrders.id, order.id));
      
      const refundId = `REF-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      
      return res.json({
        status: "success",
        order_number,
        refund_amount: Math.round(refundAmount * 100) / 100,
        refund_id: refundId,
        message: "Refund processed successfully",
        customer_email: order.customerEmail,
        expected_return_days: "3-5 business days"
      });
    } catch (error) {
      return handleError(res, error);
    }
  });
  
  const poCreateSchema = z.object({
    supplier_name: z.string().min(1),
    items: z.array(z.object({
      product_name: z.string().optional(),
      sku: z.string().optional(),
      quantity: z.number().int().positive()
    })).optional(),
    auto_generate: z.boolean().optional()
  });
  
  router.post("/po/create", async (req: Request, res: Response) => {
    try {
      const parsed = poCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          status: "error",
          message: "supplier_name is required",
          error_code: "INVALID_REQUEST"
        });
      }
      
      const { supplier_name, items: requestedItems, auto_generate } = parsed.data;
      const db = getDb();
      
      const supplierResults = await db
        .select()
        .from(suppliers)
        .where(ilike(suppliers.name, `%${supplier_name}%`))
        .limit(1);
      
      if (supplierResults.length === 0) {
        return res.status(404).json({
          status: "error",
          message: `Supplier "${supplier_name}" not found`,
          error_code: "SUPPLIER_NOT_FOUND"
        });
      }
      
      const supplier = supplierResults[0];
      
      let itemsToOrder: { sku: string; productName: string; quantity: number; unitCost: number }[] = [];
      
      if (auto_generate) {
        const lowStockItems = await db
          .select()
          .from(items)
          .where(
            and(
              eq(items.type, "finished_product"),
              lt(items.availableForSaleQty, items.minStock)
            )
          );
        
        itemsToOrder = lowStockItems.map((item: Item) => ({
          sku: item.sku,
          productName: item.name,
          quantity: Math.max(item.minStock * 2 - item.availableForSaleQty, item.minStock),
          unitCost: item.defaultPurchaseCost || 0
        }));
      } else if (requestedItems && requestedItems.length > 0) {
        for (const reqItem of requestedItems) {
          const searchTerm = reqItem.sku || reqItem.product_name;
          if (!searchTerm) continue;
          
          const foundItems = await db
            .select()
            .from(items)
            .where(
              or(
                eq(items.sku, searchTerm),
                ilike(items.name, `%${searchTerm}%`)
              )
            )
            .limit(1);
          
          if (foundItems.length > 0) {
            const item = foundItems[0];
            itemsToOrder.push({
              sku: item.sku,
              productName: item.name,
              quantity: reqItem.quantity,
              unitCost: item.defaultPurchaseCost || 0
            });
          }
        }
      }
      
      if (itemsToOrder.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "No items to order. Provide items array or use auto_generate: true",
          error_code: "NO_ITEMS"
        });
      }
      
      const poTotal = itemsToOrder.reduce((sum: number, item) => sum + (item.unitCost * item.quantity), 0);
      const poNumber = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
      
      const [newPO] = await db
        .insert(purchaseOrders)
        .values({
          supplierId: supplier.id,
          poNumber,
          status: "DRAFT",
          currency: "USD",
          total: poTotal,
          subtotal: poTotal
        })
        .returning();
      
      for (const item of itemsToOrder) {
        const foundItem = await db
          .select()
          .from(items)
          .where(eq(items.sku, item.sku))
          .limit(1);
        
        if (foundItem.length > 0) {
          await db
            .insert(purchaseOrderLines)
            .values({
              purchaseOrderId: newPO.id,
              itemId: foundItem[0].id,
              sku: item.sku,
              itemName: item.productName,
              qtyOrdered: item.quantity,
              unitCost: item.unitCost,
              qtyReceived: 0,
              lineTotal: item.unitCost * item.quantity
            });
        }
      }
      
      return res.json({
        status: "success",
        po_number: poNumber,
        po_id: newPO.id,
        supplier_name: supplier.name,
        supplier_email: supplier.email,
        items: itemsToOrder.map((item) => ({
          product_name: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unit_cost: item.unitCost,
          line_total: item.unitCost * item.quantity
        })),
        po_total: Math.round(poTotal * 100) / 100,
        email_sent: false,
        created_date: new Date().toISOString().split("T")[0]
      });
    } catch (error) {
      return handleError(res, error);
    }
  });
  
  const taskCreateSchema = z.object({
    assigned_to: z.string().min(1),
    task_description: z.string().min(1),
    due_date: z.string().optional(),
    priority: z.enum(["low", "medium", "high"]).optional().default("medium")
  });
  
  router.post("/tasks/create", async (req: Request, res: Response) => {
    try {
      const parsed = taskCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          status: "error",
          message: "assigned_to and task_description are required",
          error_code: "INVALID_REQUEST"
        });
      }
      
      const { assigned_to, task_description, due_date, priority } = parsed.data;
      
      const ghlApiKey = process.env.GOHIGHLEVEL_API_KEY;
      if (!ghlApiKey) {
        return res.status(500).json({
          status: "error",
          message: "GoHighLevel integration not configured",
          error_code: "GHL_NOT_CONFIGURED"
        });
      }
      
      const ghlConfig = await storage.getIntegrationConfig(
        (await storage.getAllUsers())[0]?.id || "",
        "GOHIGHLEVEL"
      );
      
      const configData = ghlConfig?.config as { apiBaseUrl?: string; locationId?: string } | null;
      const baseUrl = configData?.apiBaseUrl || "https://services.leadconnectorhq.com";
      const locationId = configData?.locationId || "";
      
      const ghlClient = new GoHighLevelClient(baseUrl, ghlApiKey, locationId);
      
      const result = await ghlClient.createTask(
        `Task for ${assigned_to}`,
        task_description,
        {
          title: task_description,
          dueDate: due_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          assignedTo: assigned_to,
          status: "pending"
        }
      );
      
      if (!result.success) {
        return res.status(500).json({
          status: "error",
          message: result.message || "Failed to create task in GHL",
          error_code: "GHL_ERROR"
        });
      }
      
      return res.json({
        status: "success",
        task_id: result.taskId || `TASK-${Date.now()}`,
        assigned_to,
        task_description,
        due_date: due_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        priority,
        created_in_ghl: true
      });
    } catch (error) {
      return handleError(res, error);
    }
  });
  
  const initiateReturnSchema = z.object({
    order_number: z.string().min(1, "Order number is required"),
  });

  router.post("/returns/initiate", async (req: Request, res: Response) => {
    try {
      const parseResult = initiateReturnSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          status: "error",
          message: parseResult.error.errors.map(e => e.message).join(", "),
          error_code: "VALIDATION_ERROR"
        });
      }
      
      const { order_number } = parseResult.data;
      const db = getDb();
      
      const matchingOrders = await db
        .select()
        .from(salesOrders)
        .where(
          or(
            eq(salesOrders.externalOrderId, order_number),
            ilike(salesOrders.externalOrderId, `%${order_number}%`)
          )
        )
        .limit(1);
      
      if (matchingOrders.length === 0) {
        return res.status(404).json({
          status: "error",
          message: `Order ${order_number} not found`,
          error_code: "ORDER_NOT_FOUND"
        });
      }
      
      const order = matchingOrders[0];
      
      const orderLines = await db
        .select()
        .from(salesOrderLines)
        .where(eq(salesOrderLines.salesOrderId, order.id));
      
      const itemsForReturn = orderLines.map((line: SalesOrderLine) => ({
        sku: line.sku,
        productName: line.productName || line.sku,
        quantity: line.qtyOrdered,
        unitPrice: line.unitPrice || undefined,
        orderLineId: line.id,
      }));
      
      if (itemsForReturn.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "Order has no line items to return",
          error_code: "NO_ITEMS"
        });
      }
      
      const hasAddress = order.shipToStreet || order.shipToCity;
      const customerAddress = hasAddress ? {
        street1: order.shipToStreet || '',
        city: order.shipToCity || '',
        state: order.shipToState || '',
        zip: order.shipToZip || '',
        country: order.shipToCountry || 'US',
      } : null;
      const addressString = hasAddress 
        ? `${order.shipToStreet || ''}, ${order.shipToCity || ''} ${order.shipToState || ''} ${order.shipToZip || ''}`
        : 'Address not available';
      
      const result = await returnsService.requestReturn({
        orderId: order.id,
        externalOrderId: order.externalOrderId || order_number,
        channel: order.channel || 'Shopify',
        customerName: order.customerName || 'Customer',
        customerEmail: order.customerEmail || undefined,
        customerPhone: order.customerPhone || undefined,
        items: itemsForReturn,
        desiredResolution: 'REFUND',
        shippingAddress: customerAddress,
        source: 'GHL_AGENT_API',
      });
      
      if (!result.success) {
        return res.status(500).json({
          status: "error",
          message: result.error || "Failed to initiate return",
          error_code: "RETURN_FAILED"
        });
      }
      
      const returnAddress = process.env.SHIPPO_DEFAULT_FROM_ADDRESS || 
                            process.env.RETURN_TO_ADDRESS || 
                            "1020 W Utah Ave, Hildale UT 84784";
      
      const estimatedArrival = new Date();
      estimatedArrival.setDate(estimatedArrival.getDate() + 7);
      const estimatedArrivalStr = estimatedArrival.toISOString().split('T')[0];
      
      return res.json({
        status: "success",
        return_id: result.rmaNumber || result.returnId,
        order_number: order.externalOrderId || order_number,
        customer_name: order.customerName || 'Customer',
        customer_email: order.customerEmail || null,
        customer_phone: order.customerPhone || null,
        customer_address: addressString,
        return_address: returnAddress,
        order_source: order.channel || 'Shopify',
        return_tracking: result.trackingNumber || null,
        return_label_url: result.labelUrl || null,
        items: itemsForReturn.map(item => ({
          product_name: item.productName,
          quantity: item.quantity,
          sku: item.sku
        })),
        estimated_arrival: estimatedArrivalStr,
        message: result.labelUrl 
          ? "Return initiated successfully. Label ready to send."
          : "Return initiated successfully. Label generation pending."
      });
      
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get("/status", async (req: Request, res: Response) => {
    return res.json({
      status: "success",
      message: "GHL Agent API is operational",
      version: "1.0.0",
      endpoints: [
        "POST /inventory/reorder-status",
        "POST /orders/lookup",
        "POST /orders/search",
        "POST /refunds/calculate",
        "POST /refunds/process",
        "POST /returns/initiate",
        "POST /po/create",
        "POST /tasks/create"
      ]
    });
  });
  
  app.use("/api/ghl-agent", router);
  
  console.log("[GHL Agent API] Routes registered at /api/ghl-agent/*");
}
