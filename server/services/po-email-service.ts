import sgMail from "@sendgrid/mail";
import crypto from "crypto";
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

  private generateAckToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private getAppBaseUrl(): string {
    if (process.env.APP_BASE_URL) {
      return process.env.APP_BASE_URL;
    }
    return 'http://localhost:5000';
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
      let poData = await this.loadPOWithDetails(poId);
      if (!poData) {
        return { success: false, error: "Purchase order not found" };
      }

      let { po, lines, supplier } = poData;

      const recipientEmail = this.determineRecipientEmail(po, supplier);
      if (!recipientEmail) {
        console.error(`[PO Email] No recipient email available for PO ${po.poNumber}`);
        return {
          success: false,
          error: "No email address available for this supplier. Please add an email address to the supplier or PO.",
        };
      }

      // Generate ack token if not present
      let ackToken = po.ackToken;
      if (!ackToken) {
        ackToken = this.generateAckToken();
        const ackTokenExpiresAt = new Date();
        ackTokenExpiresAt.setDate(ackTokenExpiresAt.getDate() + 30); // Token valid for 30 days
        
        await storage.updatePurchaseOrder(poId, {
          ackToken,
          ackTokenExpiresAt,
          acknowledgementStatus: po.acknowledgementStatus === 'NONE' ? 'PENDING' : po.acknowledgementStatus,
        });
        
        // Reload PO with updated token
        const updatedPO = await storage.getPurchaseOrder(poId);
        if (updatedPO) {
          po = updatedPO;
        }
      } else if (po.acknowledgementStatus === 'NONE') {
        // Update status to PENDING if sending again
        await storage.updatePurchaseOrder(poId, {
          acknowledgementStatus: 'PENDING',
        });
      }

      const pdfBuffer = await poPdfService.generatePOPdf({ po, lines, supplier });

      const supplierName = supplier?.name || po.supplierName || "Supplier";
      // Use contact name from supplier if available, otherwise fall back to supplier name
      const contactName = supplier?.contactName || supplierName;
      const subject = `Purchase Order ${po.poNumber} – ${supplierName}`;
      const poViewUrl = `${this.getAppBaseUrl()}/po/acknowledge/${ackToken}`;
      const { html, text } = this.buildEmailBody(po, lines, supplierName, contactName, poViewUrl);

      sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

      const msg = {
        to: recipientEmail,
        from: {
          email: this.getFromEmail(),
          name: this.getFromName(),
        },
        subject,
        text,
        html,
        attachments: [
          {
            content: pdfBuffer.toString("base64"),
            filename: `PO-${po.poNumber}.pdf`,
            type: "application/pdf",
            disposition: "attachment" as const,
          },
        ],
        customArgs: {
          po_id: poId,
          po_number: po.poNumber,
        },
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
        bodyText: text,
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

  private getItemNamesList(lines: PurchaseOrderLine[]): string {
    const names = lines.map(line => line.itemName || `Item #${line.itemId}`);
    if (names.length === 0) return "No items";
    if (names.length === 1) return names[0];
    if (names.length === 2) return names.join(" and ");
    return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
  }

  private buildEmailBody(
    po: PurchaseOrder, 
    lines: PurchaseOrderLine[], 
    supplierName: string, 
    contactName: string,
    poViewUrl: string
  ): { html: string; text: string } {
    const orderDate = new Date(po.orderDate).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const itemNames = this.getItemNamesList(lines);
    const deliveryAddress = "1020 W Utah Ave, Hildale UT 84784";

    // Plain text version
    const text = `Hello ${contactName},

We're needing some more parts. Please take a look at your purchase order at your earliest convenience.

Here are the order details:

PO #: ${po.poNumber}
Order Date: ${orderDate}
Items Ordered: ${itemNames}
Delivery Address: ${deliveryAddress}

View PO: ${poViewUrl}

Below is a PDF copy of this purchase order for your convenience.

If you have any questions about this order, please email us at stickerburrroller@gmail.com.

Best regards,
StickerBurr Team`;

    // HTML version
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#333333;background-color:#f5f5f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding:30px 40px 20px 40px;border-bottom:1px solid #eeeeee;">
              <h1 style="margin:0;font-size:24px;color:#1a1a1a;">Purchase Order</h1>
              <p style="margin:8px 0 0 0;font-size:14px;color:#666666;">${po.poNumber}</p>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding:30px 40px;">
              <p style="margin:0 0 20px 0;">Hello ${contactName},</p>
              
              <p style="margin:0 0 25px 0;">We're needing some more parts. Please take a look at your purchase order at your earliest convenience.</p>
              
              <h2 style="margin:0 0 15px 0;font-size:16px;color:#1a1a1a;font-weight:600;">Here are the order details:</h2>
              
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:25px;">
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #eeeeee;">
                    <span style="color:#666666;">PO #:</span>
                  </td>
                  <td style="padding:8px 0;border-bottom:1px solid #eeeeee;text-align:right;font-weight:600;">
                    ${po.poNumber}
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #eeeeee;">
                    <span style="color:#666666;">Order Date:</span>
                  </td>
                  <td style="padding:8px 0;border-bottom:1px solid #eeeeee;text-align:right;">
                    ${orderDate}
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #eeeeee;vertical-align:top;">
                    <span style="color:#666666;">Items Ordered:</span>
                  </td>
                  <td style="padding:8px 0;border-bottom:1px solid #eeeeee;text-align:right;">
                    ${itemNames}
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;">
                    <span style="color:#666666;">Delivery Address:</span>
                  </td>
                  <td style="padding:8px 0;text-align:right;">
                    ${deliveryAddress}
                  </td>
                </tr>
              </table>
              
              <!-- View PO Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:25px;">
                <tr>
                  <td align="center">
                    <a href="${poViewUrl}" style="display:inline-block;padding:14px 32px;background-color:#1a73e8;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:16px;">
                      View PO
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin:0 0 20px 0;color:#666666;font-size:14px;">Below is a PDF copy of this purchase order for your convenience.</p>
              
              <p style="margin:0 0 25px 0;">If you have any questions about this order, please email us at <a href="mailto:stickerburrroller@gmail.com" style="color:#1a73e8;text-decoration:none;">stickerburrroller@gmail.com</a>.</p>
              
              <p style="margin:0;">Best regards,<br><strong>StickerBurr Team</strong></p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;background-color:#f9f9f9;border-top:1px solid #eeeeee;border-radius:0 0 8px 8px;">
              <p style="margin:0;font-size:12px;color:#999999;text-align:center;">
                This is an automated message from StickerBurr Roller.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    return { html, text };
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
