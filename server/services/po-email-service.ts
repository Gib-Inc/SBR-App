import sgMail from "@sendgrid/mail";
import { storage } from "../storage";
import { poPdfService } from "./po-pdf-service";
import type { PurchaseOrder, PurchaseOrderLine, Supplier } from "@shared/schema";

// LEGAL NOTICE: Purchase orders sent via email are transactional (not marketing) documents.
// Ensure the sending domain has proper SPF/DKIM/DMARC configuration for deliverability.
// Email content should be reviewed by legal counsel for compliance with applicable laws.
// This service is for transactional emails only - do not use for marketing purposes.

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  recipientEmail?: string;
  subject?: string;
  bodyText?: string;
}

interface POWithDetails {
  po: PurchaseOrder;
  lines: PurchaseOrderLine[];
  supplier: Supplier | null;
}

export class PurchaseOrderEmailService {
  private isConfigured(): boolean {
    return !!(
      process.env.SENDGRID_API_KEY &&
      process.env.SENDGRID_FROM_EMAIL
    );
  }

  private getFromName(): string {
    return process.env.SENDGRID_FROM_NAME || "Purchasing Department";
  }

  private getFromEmail(): string {
    return process.env.SENDGRID_FROM_EMAIL || "";
  }

  async sendPurchaseOrderEmail(poId: string): Promise<SendEmailResult> {
    console.log(`[PO Email] Starting email send for PO: ${poId}`);

    if (!this.isConfigured()) {
      console.error("[PO Email] SendGrid not configured - missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL");
      return {
        success: false,
        error: "Email service not configured. Please set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL environment variables.",
      };
    }

    try {
      const poData = await this.loadPOWithDetails(poId);
      if (!poData) {
        return { success: false, error: "Purchase order not found" };
      }

      const { po, lines, supplier } = poData;

      const recipientEmail = this.determineRecipientEmail(po, supplier);
      if (!recipientEmail) {
        console.error(`[PO Email] No recipient email available for PO ${po.poNumber}`);
        return {
          success: false,
          error: "No email address available for this supplier. Please add an email address to the supplier or PO.",
        };
      }

      const pdfBuffer = await poPdfService.generatePOPdf({ po, lines, supplier });

      const supplierName = supplier?.name || po.supplierName || "Supplier";
      const subject = `Purchase Order ${po.poNumber} – ${supplierName}`;
      const bodyText = this.buildEmailBody(po, lines, supplierName);

      sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

      const msg = {
        to: recipientEmail,
        from: {
          email: this.getFromEmail(),
          name: this.getFromName(),
        },
        subject,
        text: bodyText,
        attachments: [
          {
            content: pdfBuffer.toString("base64"),
            filename: `PO-${po.poNumber}.pdf`,
            type: "application/pdf",
            disposition: "attachment" as const,
          },
        ],
      };

      console.log(`[PO Email] Sending email to: ${recipientEmail}, subject: ${subject}`);

      const [response] = await sgMail.send(msg);
      
      const messageId = response.headers?.["x-message-id"] || 
                       (response as any).messageId || 
                       `sg-${Date.now()}`;

      console.log(`[PO Email] Email sent successfully. MessageId: ${messageId}, StatusCode: ${response.statusCode}`);

      return {
        success: true,
        messageId: String(messageId),
        recipientEmail,
        subject,
        bodyText,
      };
    } catch (error: any) {
      console.error("[PO Email] Failed to send email:", error);

      let errorMessage = "Failed to send email";
      if (error.response?.body?.errors) {
        errorMessage = error.response.body.errors.map((e: any) => e.message).join(", ");
      } else if (error.message) {
        errorMessage = error.message;
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private async loadPOWithDetails(poId: string): Promise<POWithDetails | null> {
    const po = await storage.getPurchaseOrder(poId);
    if (!po) return null;

    const lines = await storage.getPurchaseOrderLinesByPOId(poId);
    const supplier = po.supplierId ? (await storage.getSupplier(po.supplierId)) || null : null;

    return { po, lines, supplier };
  }

  private determineRecipientEmail(po: PurchaseOrder, supplier: Supplier | null): string | null {
    if (po.emailTo) return po.emailTo;
    if (po.supplierEmail) return po.supplierEmail;
    if (supplier?.email) return supplier.email;
    return null;
  }

  private buildEmailBody(po: PurchaseOrder, lines: PurchaseOrderLine[], supplierName: string): string {
    const orderDate = new Date(po.orderDate).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const linesSummary = lines
      .slice(0, 5)
      .map((line) => {
        const itemName = line.itemName || `Item #${line.itemId}`;
        const lineTotal = Number(line.lineTotal) || Number(line.qtyOrdered) * Number(line.unitCost) || 0;
        return `  - ${line.qtyOrdered}x ${itemName} @ $${Number(line.unitCost || 0).toFixed(2)} = $${lineTotal.toFixed(2)}`;
      })
      .join("\n");

    const moreItemsNote = lines.length > 5 ? `\n  ... and ${lines.length - 5} more item(s)\n` : "";

    const total = Number(po.total) || 0;
    const expectedDelivery = po.expectedDate
      ? `Expected Delivery: ${new Date(po.expectedDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`
      : "";

    const paymentTerms = po.paymentTerms ? `Payment Terms: ${po.paymentTerms}` : "";

    return `Dear ${supplierName},

Please find attached Purchase Order ${po.poNumber} from ${po.buyerCompanyName || "our company"}.

Order Details:
--------------
PO Number: ${po.poNumber}
Order Date: ${orderDate}
${expectedDelivery}
${paymentTerms}

Items Ordered:
${linesSummary}${moreItemsNote}

Order Total: $${total.toFixed(2)} ${po.currency || "USD"}

${po.shipToLocation ? `Ship To:\n${po.shipToLocation}\n` : ""}
The complete purchase order is attached as a PDF for your records.

If you have any questions regarding this order, please reply to this email.

Thank you for your continued partnership.

Best regards,
${po.buyerCompanyName || "Purchasing Department"}
`.trim();
  }

  getConfigurationStatus(): { configured: boolean; fromEmail?: string; fromName?: string } {
    return {
      configured: this.isConfigured(),
      fromEmail: this.isConfigured() ? this.getFromEmail() : undefined,
      fromName: this.isConfigured() ? this.getFromName() : undefined,
    };
  }
}

export const purchaseOrderEmailService = new PurchaseOrderEmailService();
