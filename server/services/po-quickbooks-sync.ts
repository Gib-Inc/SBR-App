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
 * "Bill on receipt" gate. Pushes the PO to QuickBooks as a Bill only once the
 * PO is fully RECEIVED. Safe to fire-and-forget from any receive route: it
 * no-ops unless status === 'RECEIVED', and syncApprovedPOToQuickBooks is itself
 * idempotent (won't double-create a Bill if one is already linked).
 */
export async function billPOOnReceipt(
  purchaseOrderId: string,
  userId: string
): Promise<SyncResult> {
  if (!isQuickBooksConfigured()) {
    return { success: false, skipped: true, reason: 'QuickBooks not configured' };
  }

  const po = await storage.getPurchaseOrder(purchaseOrderId);
  if (!po) {
    return { success: false, error: 'Purchase order not found' };
  }
  // Fully received is signalled either by status RECEIVED or a receivedAt stamp.
  // Both are set only on FULL receipt across the receive routes; partial
  // receipts (PARTIAL_RECEIVED, no receivedAt) intentionally do not bill yet.
  const fullyReceived = po.status === 'RECEIVED' || !!po.receivedAt;
  if (!fullyReceived) {
    return { success: false, skipped: true, reason: `PO not fully received (status: ${po.status})` };
  }

  return syncApprovedPOToQuickBooks(purchaseOrderId, userId);
}

/**
 * Fire-and-forget QB Bill push for a PO that just reached SENT. Matt opted into
 * "bill QuickBooks when a PO is sent." Idempotent (syncApprovedPOToQuickBooks
 * skips if a Bill is already linked) and never throws into the caller, so send
 * routes can drop this right after the status update without awaiting it.
 */
export function firePOBillSyncOnSend(purchaseOrderId: string, userId: string): void {
  syncApprovedPOToQuickBooks(purchaseOrderId, userId)
    .then((r) => {
      if (r.success && !r.skipped) {
        console.log(`[PurchaseOrder] QuickBooks Bill created on send for PO ${purchaseOrderId} (bill ${r.billId}).`);
      } else if (!r.success) {
        console.warn(`[PurchaseOrder] QuickBooks Bill push on send did not complete for PO ${purchaseOrderId}: ${r.reason || r.error}`);
      }
    })
    .catch((err) => {
      console.error(`[PurchaseOrder] QuickBooks Bill auto-sync error for PO ${purchaseOrderId}:`, err?.message ?? err);
    });
}

/**
 * One-time backfill: push already-SENT/APPROVED POs that never reached
 * QuickBooks (sent via a path that predated auto-push-on-send). Bounded +
 * idempotent — syncApprovedPOToQuickBooks skips anything already linked, so this
 * naturally no-ops once the queue is drained; a failed push simply retries next
 * boot. Fire-and-forget from startup.
 */
export async function backfillUnsyncedSentPOs(
  maxToPush = 25,
): Promise<{ pushed: number; failed: number; skipped: number }> {
  const out = { pushed: 0, failed: 0, skipped: 0 };
  if (!isQuickBooksConfigured()) return out;
  try {
    const all = await storage.getAllPurchaseOrders();
    const candidates = all
      .filter((p) => (p.status === "SENT" || p.status === "APPROVED") && !p.externalAccountingId)
      .slice(0, maxToPush);
    const detail: any[] = [];
    for (const po of candidates) {
      try {
        const r = await syncApprovedPOToQuickBooks(po.id, "system");
        if (r.success && !r.skipped) out.pushed++;
        else if (r.skipped) out.skipped++;
        else out.failed++;
        detail.push({ po: (po as any).poNumber, success: r.success, skipped: r.skipped, reason: r.reason, error: r.error });
      } catch (e: any) {
        out.failed++;
        detail.push({ po: (po as any).poNumber, threw: String(e?.message ?? e) });
      }
    }
    (out as any).detail = detail;
    if (candidates.length) {
      console.log(
        `[PurchaseOrder] QuickBooks backfill: ${out.pushed} pushed, ${out.skipped} skipped, ${out.failed} failed of ${candidates.length} unsynced sent POs.`,
      );
    }
    // Persist the outcome so a boot-time run is observable (console logs aren't
    // queryable). Always logged — even 0 candidates confirms the job fired.
    await storage.createSystemLog({
      type: "SCHEDULER",
      severity: out.failed > 0 ? "WARN" : "INFO",
      code: "PO_QB_BACKFILL",
      message: `QuickBooks PO backfill: ${out.pushed} pushed, ${out.skipped} skipped, ${out.failed} failed (${candidates.length} candidates)`,
      details: out as any,
    }).catch(() => {});
  } catch (err: any) {
    console.error("[PurchaseOrder] QuickBooks backfill failed:", err?.message ?? err);
    await storage.createSystemLog({
      type: "SCHEDULER",
      severity: "ERROR",
      code: "PO_QB_BACKFILL_ERROR",
      message: `QuickBooks PO backfill threw: ${err?.message ?? err}`,
      details: { error: String(err?.message ?? err) } as any,
    }).catch(() => {});
  }
  return out;
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
