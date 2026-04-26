// Backorder unblock automation. Fires after a PO is received: walks the
// received items, expands components → finished products via BOM, finds
// open sales orders for those products with unshipped quantity, and either
// emails each customer once (when SendGrid is configured AND
// BACKORDER_AUTO_EMAIL=true) or just logs the would-have-sent payload to
// the audit trail.
//
// Idempotency is enforced by a unique index on (sales_order_id, item_id)
// in backorder_notices, so even multiple PO receipts for the same product
// can't double-notify a customer.
//
// Safe-by-default: without BACKORDER_AUTO_EMAIL=true the service is
// preview-only — Sammie can scan the audit log and review what the system
// WOULD have sent before flipping the flag in production.

import { storage } from "../storage";
import { AuditLogger } from "./audit-logger";

export type ComputedNotice = {
  salesOrderId: string;
  customerName: string;
  customerEmail: string | null;
  itemId: string;
  itemName: string;
  itemSku: string;
  qty: number;
  channel: "EMAIL_SENT" | "EMAIL_FAILED" | "EMAIL_LOG";
  subject: string;
  body: string;
  errorMessage?: string;
};

export type BackorderCommsResult = {
  considered: number;     // candidate (so, item) pairs evaluated
  alreadyNotified: number; // skipped due to idempotency
  built: number;           // payloads built
  sent: number;            // SendGrid succeeded
  logged: number;          // payload logged only (no send)
  failed: number;          // SendGrid attempted and failed
  notices: ComputedNotice[];
};

const SO_TERMINAL = new Set([
  "FULFILLED",
  "CANCELLED",
  "DELIVERED",
  "REFUNDED",
  "PENDING_REFUND",
]);

function buildEmailBody(opts: {
  customerName: string;
  itemName: string;
  qty: number;
  orderName: string;
}): { subject: string; body: string } {
  const subject = `Update: your ${opts.itemName} is back in stock`;
  const body = [
    `Hi ${opts.customerName},`,
    "",
    `Quick update on your order ${opts.orderName} — the ${opts.itemName} you've been waiting on is back in stock and will ship shortly. ${opts.qty} unit${opts.qty === 1 ? "" : "s"} reserved for you.`,
    "",
    "We'll send a tracking number once it leaves our warehouse. Thanks for your patience.",
    "",
    "— The SBR team",
  ].join("\n");
  return { subject, body };
}

/**
 * Find the finished-product item ids whose builds depend on any of the
 * received component ids. Returns the union of:
 *   1. receivedItemIds that ARE finished products (direct backorders)
 *   2. finished products whose BOM references any received component
 */
async function expandToFinishedProducts(receivedItemIds: string[]): Promise<string[]> {
  const allItems = await storage.getAllItems();
  const itemById = new Map(allItems.map((i) => [i.id, i] as const));
  const result = new Set<string>();

  for (const id of receivedItemIds) {
    const item = itemById.get(id);
    if (!item) continue;
    if (item.type === "finished_product") {
      result.add(id);
    }
  }

  // Find finished products whose BOM includes any received component.
  // Cheaper to walk all finished products once than to query per-receipt.
  const finished = allItems.filter((i) => i.type === "finished_product");
  for (const fp of finished) {
    const bom = await storage.getBillOfMaterialsByProductId(fp.id);
    if (bom.some((b) => receivedItemIds.includes(b.componentId))) {
      result.add(fp.id);
    }
  }
  return Array.from(result);
}

export async function notifyBackorderUnblock(
  receivedItemIds: string[],
  poId: string | null,
  poNumber: string | null,
): Promise<BackorderCommsResult> {
  const out: BackorderCommsResult = {
    considered: 0,
    alreadyNotified: 0,
    built: 0,
    sent: 0,
    logged: 0,
    failed: 0,
    notices: [],
  };
  if (receivedItemIds.length === 0) return out;

  const finishedIds = await expandToFinishedProducts(receivedItemIds);
  if (finishedIds.length === 0) return out;

  const allItems = await storage.getAllItems();
  const itemById = new Map(allItems.map((i) => [i.id, i] as const));
  const allSOs = await storage.getAllSalesOrders();

  const sendEnabled = process.env.BACKORDER_AUTO_EMAIL === "true";
  const sendGridConfigured = !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);

  for (const fpId of finishedIds) {
    const finished = itemById.get(fpId);
    if (!finished) continue;

    for (const so of allSOs) {
      if (SO_TERMINAL.has(so.status)) continue;
      const lines = await storage.getSalesOrderLines(so.id);
      const line = lines.find((l) => l.sku === finished.sku && (l.qtyOrdered ?? 0) - (l.qtyShipped ?? 0) > 0);
      if (!line) continue;
      const open = (line.qtyOrdered ?? 0) - (line.qtyShipped ?? 0);
      out.considered++;

      // Idempotency: have we ever notified this customer about this product?
      const existing = await storage.getBackorderNotice(so.id, fpId);
      if (existing) {
        out.alreadyNotified++;
        continue;
      }

      const { subject, body } = buildEmailBody({
        customerName: so.customerName ?? "there",
        itemName: finished.name,
        qty: open,
        orderName: (so as any).orderName ?? (so as any).externalOrderId ?? so.id.slice(0, 8),
      });

      let channel: ComputedNotice["channel"] = "EMAIL_LOG";
      let errorMessage: string | undefined;

      // Try SendGrid only if both env flags are right AND we have an email.
      if (sendEnabled && sendGridConfigured && so.customerEmail) {
        try {
          const sgMail = await import("@sendgrid/mail");
          sgMail.default.setApiKey(process.env.SENDGRID_API_KEY!);
          await sgMail.default.send({
            to: so.customerEmail,
            from: {
              email: process.env.SENDGRID_FROM_EMAIL!,
              name: process.env.SENDGRID_FROM_NAME ?? "SBR Inventory",
            },
            subject,
            text: body,
          });
          channel = "EMAIL_SENT";
          out.sent++;
        } catch (err: any) {
          channel = "EMAIL_FAILED";
          errorMessage = err?.message ?? "send failed";
          out.failed++;
        }
      } else {
        channel = "EMAIL_LOG";
        out.logged++;
      }

      const notice: ComputedNotice = {
        salesOrderId: so.id,
        customerName: so.customerName ?? "(unknown)",
        customerEmail: so.customerEmail ?? null,
        itemId: fpId,
        itemName: finished.name,
        itemSku: finished.sku,
        qty: open,
        channel,
        subject,
        body,
        errorMessage,
      };
      out.notices.push(notice);
      out.built++;

      try {
        await storage.createBackorderNotice({
          salesOrderId: so.id,
          itemId: fpId,
          poId: poId ?? null,
          channel,
          payloadJson: notice as unknown as Record<string, unknown>,
        });
      } catch (err: any) {
        // The unique index can race when two concurrent receipts hit at once.
        // The first writer wins; we treat the dup as "already notified".
        if (/unique/i.test(err?.message ?? "")) {
          out.alreadyNotified++;
        } else {
          console.error("[Backorder Comms] notice persist failed:", err?.message ?? err);
        }
      }

      // Audit trail — always written, regardless of send mode, so a recall
      // / review can see what the system did.
      try {
        await AuditLogger.logEvent({
          source: "SYSTEM",
          eventType: "BACKORDER_NOTICE_GENERATED",
          entityType: "SALES_ORDER",
          entityId: so.id,
          entityLabel: (so as any).orderName ?? (so as any).externalOrderId ?? so.id,
          status: channel === "EMAIL_FAILED" ? "ERROR" : channel === "EMAIL_SENT" ? "INFO" : "WARNING",
          description: channel === "EMAIL_SENT"
            ? `Backorder unblock email sent to ${so.customerEmail} for ${finished.name}`
            : channel === "EMAIL_FAILED"
              ? `Backorder unblock email FAILED for ${finished.name}: ${errorMessage}`
              : `Backorder unblock notice generated for ${finished.name} (preview-only — set BACKORDER_AUTO_EMAIL=true and configure SendGrid to actually send)`,
          details: {
            poId,
            poNumber,
            itemSku: finished.sku,
            qty: open,
            customerEmail: so.customerEmail,
            subject,
            body,
            sendEnabled,
            sendGridConfigured,
          },
        });
      } catch (err) {
        console.warn("[Backorder Comms] audit log failed:", err);
      }
    }
  }

  return out;
}
