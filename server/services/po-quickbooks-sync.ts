/**
 * PO ↔ QuickBooks Sync Orchestrator
 *
 * Fire-and-forget sync between SBR Purchase Orders and QuickBooks Bills.
 * On PO approval → create QB Bill, stamp the PO with the QB Bill ID and notify timestamp.
 * On PO mark-paid → record a BillPayment against the QB Bill.
 *
 * Errors are logged to the audit trail and returned, but should NEVER block the PO
 * lifecycle — callers fire these and continue regardless of outcome.
 */

import { storage } from '../storage';
import { AuditLogger } from './audit-logger';
import { QuickBooksClient, isQuickBooksConfigured } from './quickbooks-client';

export interface SyncResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  billId?: string;
  billNumber?: string;
  error?: string;
}

/**
 * Push an APPROVED purchase order to QuickBooks as a Bill, then stamp the PO
 * with the QB Bill ID and notify-the-accountant timestamp.
 */
export async function syncApprovedPOToQuickBooks(
  purchaseOrderId: string,
  userId: string
): Promise<SyncResult> {
  if (!isQuickBooksConfigured()) {
    return { success: false, skipped: true, reason: 'QuickBooks not configured' };
  }

  try {
    const po = await storage.getPurchaseOrder(purchaseOrderId);
    if (!po) {
      return { success: false, error: 'Purchase order not found' };
    }

    // Idempotent: don't double-create a Bill if we've already synced this PO
    if (po.externalAccountingId) {
      return {
        success: true,
        skipped: true,
        reason: 'PO already linked to QuickBooks Bill',
        billId: po.externalAccountingId,
      };
    }

    const poLines = await storage.getPurchaseOrderLinesByPOId(purchaseOrderId);
    if (!poLines.length) {
      return { success: false, error: 'PO has no line items to bill' };
    }

    const supplier = await storage.getSupplier(po.supplierId);
    if (!supplier) {
      return { success: false, error: 'Supplier not found for PO' };
    }

    const allItems = await storage.getAllItems();
    const itemsMap = new Map<string, typeof allItems[0]>();
    const itemIds = new Set(poLines.map((l) => l.itemId));
    for (const item of allItems) {
      if (itemIds.has(item.id)) itemsMap.set(item.id, item);
    }

    const client = new QuickBooksClient(storage, userId);
    const result = await client.createBillFromPurchaseOrder(po, poLines, supplier, itemsMap);

    if (!result.success || !result.billId) {
      return { success: false, error: result.error || 'QuickBooks Bill creation failed' };
    }

    await storage.updatePurchaseOrder(purchaseOrderId, {
      externalAccountingId: result.billId,
      qbRecordType: 'Bill',
      accountantNotifiedAt: new Date(),
    });

    return {
      success: true,
      billId: result.billId,
      billNumber: result.billNumber,
    };
  } catch (error: any) {
    await AuditLogger.logEvent({
      source: 'QUICKBOOKS',
      eventType: 'PO_BILL_SYNC_ERROR',
      entityType: 'PURCHASE_ORDER',
      entityId: purchaseOrderId,
      status: 'ERROR',
      description: `PO→QuickBooks Bill sync failed: ${error.message || 'Unknown error'}`,
      details: { error: error.message },
    });
    return { success: false, error: error.message || 'Sync failed' };
  }
}

/**
 * Mark the QuickBooks Bill linked to this PO as paid by creating a BillPayment.
 * No-ops gracefully if no QB Bill exists for the PO.
 */
export async function markPOBillAsPaidInQuickBooks(
  purchaseOrderId: string,
  userId: string
): Promise<SyncResult> {
  if (!isQuickBooksConfigured()) {
    return { success: false, skipped: true, reason: 'QuickBooks not configured' };
  }

  try {
    const billRecord = await storage.getQuickbooksBillByPurchaseOrderId(purchaseOrderId);
    if (!billRecord) {
      return {
        success: false,
        skipped: true,
        reason: 'No QuickBooks Bill linked to this PO',
      };
    }

    if (billRecord.status === 'PAID') {
      return {
        success: true,
        skipped: true,
        reason: 'QuickBooks Bill already marked paid',
        billId: billRecord.quickbooksBillId,
      };
    }

    const client = new QuickBooksClient(storage, userId);
    const result = await client.markBillAsPaid(billRecord.quickbooksBillId);

    if (!result.success) {
      return { success: false, error: result.error || 'BillPayment creation failed' };
    }

    await storage.updateQuickbooksBill(billRecord.id, { status: 'PAID' });

    return {
      success: true,
      billId: billRecord.quickbooksBillId,
    };
  } catch (error: any) {
    await AuditLogger.logEvent({
      source: 'QUICKBOOKS',
      eventType: 'PO_BILL_PAID_SYNC_ERROR',
      entityType: 'PURCHASE_ORDER',
      entityId: purchaseOrderId,
      status: 'ERROR',
      description: `PO→QuickBooks Bill paid sync failed: ${error.message || 'Unknown error'}`,
      details: { error: error.message },
    });
    return { success: false, error: error.message || 'Mark paid failed' };
  }
}
