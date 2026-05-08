// Best-effort SendGrid email to Roger Christensen whenever a PO is created.
// Roger handles accounting follow-up and needs the line items, totals, and
// who placed the order. Failures are non-fatal — if SendGrid isn't
// configured or the send blows up, we just log and let the PO creation
// succeed so we never block a real workflow on email infrastructure.

import { storage } from "../storage";
import { ROGER_EMAIL, emailForSender } from "./sender-emails";
import type { PurchaseOrder } from "@shared/schema";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export interface NotifyRogerOptions {
  poId: string;
  /** Display name from the sender dropdown (Clarence / Sammie / Matt / Stacy). */
  orderedBy?: string | null;
  /** Optional source tag for logs ('quick-log' | 'manual' | etc). */
  source?: string;
}

export async function notifyRogerOfNewPO(opts: NotifyRogerOptions): Promise<{ sent: boolean; reason?: string }> {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    console.warn(
      `[Roger Notify] Skipped — SendGrid not configured. PO ${opts.poId} (${opts.source ?? "unknown"})`,
    );
    return { sent: false, reason: "sendgrid not configured" };
  }

  try {
    const po = await storage.getPurchaseOrder(opts.poId);
    if (!po) {
      console.warn(`[Roger Notify] PO ${opts.poId} not found`);
      return { sent: false, reason: "po not found" };
    }
    const lines = await storage.getPurchaseOrderLinesByPOId(po.id);
    const supplier = po.supplierId ? await storage.getSupplier(po.supplierId) : null;

    const supplierName = supplier?.name ?? po.supplierName ?? "Unknown supplier";
    const total = po.total ?? 0;
    const orderedBy = opts.orderedBy?.trim() || "Unknown";

    const itemSummary = lines.length === 1
      ? `${lines[0].itemName ?? lines[0].sku ?? "item"} ×${lines[0].qtyOrdered}`
      : `${lines.length} line items, ${lines.reduce((s, l) => s + (l.qtyOrdered ?? 0), 0)} total units`;

    const subject = `New PO — ${supplierName} — ${itemSummary} — ${usd.format(total)}`;

    const lineRows = lines
      .map(
        (l) =>
          `  • ${l.itemName ?? l.sku ?? "item"} (${l.sku ?? ""}) × ${l.qtyOrdered} @ ${usd.format(l.unitCost ?? 0)} = ${usd.format(l.lineTotal ?? 0)}`,
      )
      .join("\n");

    const expected = po.expectedDate
      ? new Date(po.expectedDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "not set";

    const text = [
      `PO Number: ${po.poNumber}`,
      `Supplier:  ${supplierName}`,
      `Ordered by: ${orderedBy}${emailForSender(orderedBy) ? ` (${emailForSender(orderedBy)})` : ""}`,
      `Total:     ${usd.format(total)}`,
      `Expected delivery: ${expected}`,
      ``,
      `Line items:`,
      lineRows || "  (none)",
      ``,
      po.notes ? `Notes: ${po.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const sgMail = (await import("@sendgrid/mail")).default;
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const replyTo = emailForSender(orderedBy);

    await sgMail.send({
      to: ROGER_EMAIL,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL,
        name: process.env.SENDGRID_FROM_NAME || "Sticker Burr Roller — Purchasing",
      },
      replyTo: replyTo ?? undefined,
      subject,
      text,
    });

    console.log(`[Roger Notify] Sent PO ${po.poNumber} → ${ROGER_EMAIL} (${opts.source ?? "manual"})`);
    return { sent: true };
  } catch (error: any) {
    console.error("[Roger Notify] Failed to send:", error?.message ?? error);
    return { sent: false, reason: error?.message ?? "send failed" };
  }
}
