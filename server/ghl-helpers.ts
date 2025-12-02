/**
 * GoHighLevel Helper Functions
 * Internal helpers for creating GHL tasks/tickets from returns, POs, and disputes
 */

import { GoHighLevelClient } from "./services/gohighlevel-client";
import { IStorage } from "./storage";

/**
 * Create a GHL task for a return request
 * Looks up the return and linked sales order, assembles description, and creates task
 */
export async function createGhlTaskForReturn(
  returnId: string,
  storage: IStorage,
  userId: string
): Promise<{ success: boolean; taskId?: string; message: string }> {
  try {
    // Get GHL config
    const config = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
    // V2 API uses a different base URL
    const baseUrl = 'https://services.leadconnectorhq.com';
    // Check environment variable first, then fall back to stored config
    const apiKey = process.env.GOHIGHLEVEL_API_KEY || config?.apiKey;
    const locationId = (config?.config as any)?.locationId;
    
    if (!apiKey || !locationId) {
      console.log('[GHL] GoHighLevel not configured, skipping task creation');
      return {
        success: false,
        message: 'GoHighLevel not configured',
      };
    }

    // Fetch return details
    const returnRequest = await storage.getReturnById(returnId);
    if (!returnRequest) {
      return {
        success: false,
        message: 'Return request not found',
      };
    }

    // Fetch linked sales order
    const salesOrder = returnRequest.salesOrderId
      ? await storage.getSalesOrderById(returnRequest.salesOrderId)
      : null;

    // Fetch return items
    const returnItems = await storage.getReturnItemsByReturnId(returnId);

    // Build description
    const itemsList = returnItems.map(item => 
      `- ${item.sku}: ${item.quantity} units (Reason: ${item.reason})`
    ).join('\n');

    const description = `
Return Request: ${returnRequest.returnNumber || returnId}
Customer: ${salesOrder?.customerName || 'Unknown'}
${salesOrder?.customerEmail ? `Email: ${salesOrder.customerEmail}` : ''}
${salesOrder?.customerPhone ? `Phone: ${salesOrder.customerPhone}` : ''}
Channel: ${salesOrder?.channel || 'Unknown'}
Status: ${returnRequest.status}
Resolution Requested: ${returnRequest.resolutionRequested || 'N/A'}

Items:
${itemsList}

Notes: ${returnRequest.customerNotes || 'None'}
`.trim();

    const title = `Return ${returnRequest.returnNumber || returnId} - ${salesOrder?.customerName || 'Customer'}`;

    // Initialize GHL client
    const client = new GoHighLevelClient(baseUrl, apiKey, locationId);

    // Try to find contact by email or phone
    let contactId: string | undefined;
    if (salesOrder) {
      const contact = await client.getContactByPhoneOrEmail(
        salesOrder.customerPhone || undefined,
        salesOrder.customerEmail || undefined
      );
      contactId = contact?.id;
    }

    // Create task
    const result = await client.createTask(title, description, {
      returnId,
      orderId: salesOrder?.id,
      channel: salesOrder?.channel,
      status: returnRequest.status,
      contactId,
    });

    console.log('[GHL] Task creation result:', result);
    return result;
  } catch (error: any) {
    console.error('[GHL] Error creating task for return:', error);
    return {
      success: false,
      message: error.message || 'Failed to create GHL task',
    };
  }
}

/**
 * Create a GHL task for a purchase order dispute
 */
export async function createGhlTaskForDispute(
  poId: string,
  disputeReason: string,
  storage: IStorage,
  userId: string
): Promise<{ success: boolean; taskId?: string; message: string }> {
  try {
    // Get GHL config
    const config = await storage.getIntegrationConfig(userId, 'GOHIGHLEVEL');
    // V2 API uses a different base URL
    const baseUrl = 'https://services.leadconnectorhq.com';
    // Check environment variable first, then fall back to stored config
    const apiKey = process.env.GOHIGHLEVEL_API_KEY || config?.apiKey;
    const locationId = (config?.config as any)?.locationId;
    
    if (!apiKey || !locationId) {
      console.log('[GHL] GoHighLevel not configured, skipping task creation');
      return {
        success: false,
        message: 'GoHighLevel not configured',
      };
    }

    // Fetch PO details
    const po = await storage.getPurchaseOrderById(poId);
    if (!po) {
      return {
        success: false,
        message: 'Purchase order not found',
      };
    }

    // Fetch supplier
    const supplier = po.supplierId ? await storage.getSupplierById(po.supplierId) : null;

    // Build description
    const description = `
Purchase Order Dispute: ${po.poNumber}
Supplier: ${supplier?.name || 'Unknown'}
Issue: ${disputeReason}
PO Status: ${po.status}
Order Date: ${po.orderDate ? new Date(po.orderDate).toLocaleDateString() : 'N/A'}
Expected Date: ${po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : 'N/A'}

Notes: ${po.notes || 'None'}
`.trim();

    const title = `PO Dispute: ${po.poNumber} - ${supplier?.name || 'Supplier'}`;

    // Initialize GHL client
    const client = new GoHighLevelClient(baseUrl, apiKey, locationId);

    // Create task
    const result = await client.createTask(title, description, {
      poId,
      status: 'DISPUTE',
    });

    console.log('[GHL] Task creation result:', result);
    return result;
  } catch (error: any) {
    console.error('[GHL] Error creating task for dispute:', error);
    return {
      success: false,
      message: error.message || 'Failed to create GHL task',
    };
  }
}
