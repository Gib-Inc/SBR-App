import PDFDocument from "pdfkit";
import type { PurchaseOrder, PurchaseOrderLine, Supplier } from "@shared/schema";

interface POPdfData {
  po: PurchaseOrder;
  lines: PurchaseOrderLine[];
  supplier: Supplier | null;
}

export class POPdfService {
  async generatePOPdf(data: POPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: "LETTER", margin: 50 });
        const chunks: Buffer[] = [];

        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        this.renderHeader(doc, data);
        this.renderOrderInfo(doc, data);
        this.renderSupplierInfo(doc, data);
        this.renderLineItems(doc, data);
        this.renderTotals(doc, data);
        this.renderFooter(doc, data);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private renderHeader(doc: PDFKit.PDFDocument, data: POPdfData): void {
    doc
      .fontSize(24)
      .font("Helvetica-Bold")
      .text("PURCHASE ORDER", { align: "center" });

    doc.moveDown(0.5);

    const statusColors: Record<string, string> = {
      DRAFT: "#6B7280",
      APPROVAL_PENDING: "#F59E0B",
      APPROVED: "#10B981",
      SENT: "#3B82F6",
      PARTIAL_RECEIVED: "#8B5CF6",
      RECEIVED: "#059669",
      CLOSED: "#6B7280",
      CANCELLED: "#EF4444",
    };

    const statusLabels: Record<string, string> = {
      DRAFT: "Draft",
      APPROVAL_PENDING: "Pending Approval",
      APPROVED: "Approved",
      SENT: "Sent",
      PARTIAL_RECEIVED: "Partial Received",
      RECEIVED: "Received",
      CLOSED: "Closed",
      CANCELLED: "Cancelled",
    };

    doc
      .fontSize(12)
      .font("Helvetica")
      .fillColor(statusColors[data.po.status] || "#6B7280")
      .text(`Status: ${statusLabels[data.po.status] || data.po.status}`, { align: "center" });

    doc.fillColor("#000000");
    doc.moveDown(1);
  }

  private renderOrderInfo(doc: PDFKit.PDFDocument, data: POPdfData): void {
    const leftCol = 50;
    const rightCol = 350;
    const y = doc.y;

    doc.font("Helvetica-Bold").fontSize(11);
    doc.text("PO Number:", leftCol, y);
    doc.font("Helvetica").text(data.po.poNumber, leftCol + 80, y);

    doc.font("Helvetica-Bold");
    doc.text("Date:", rightCol, y);
    doc.font("Helvetica").text(
      new Date(data.po.orderDate).toLocaleDateString(),
      rightCol + 80,
      y
    );

    const y2 = y + 20;
    if (data.po.expectedDate) {
      doc.font("Helvetica-Bold");
      doc.text("Expected Delivery:", leftCol, y2);
      doc.font("Helvetica").text(
        new Date(data.po.expectedDate).toLocaleDateString(),
        leftCol + 110,
        y2
      );
    }

    if (data.po.paymentTerms) {
      doc.font("Helvetica-Bold");
      doc.text("Payment Terms:", rightCol, y2);
      doc.font("Helvetica").text(data.po.paymentTerms, rightCol + 100, y2);
    }

    doc.moveDown(2);
  }

  private renderSupplierInfo(doc: PDFKit.PDFDocument, data: POPdfData): void {
    const leftCol = 50;
    const rightCol = 350;

    doc.rect(leftCol, doc.y, 220, 100).stroke();
    doc.rect(rightCol, doc.y, 220, 100).stroke();

    const boxY = doc.y + 10;

    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("FROM:", leftCol + 10, boxY);
    doc.font("Helvetica").fontSize(9);
    // StickerBurr company info (hardcoded as system of record)
    doc.text("Sticker Burr Roller", leftCol + 10, boxY + 15);
    doc.text("1020 W Utah Ave", leftCol + 10, boxY + 27);
    doc.text("Hildale, UT 84784", leftCol + 10, boxY + 39);
    doc.text("1-435-383-4377", leftCol + 10, boxY + 51);
    doc.text("stickerburrroller@gmail.com", leftCol + 10, boxY + 63);

    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("TO:", rightCol + 10, boxY);
    doc.font("Helvetica").fontSize(9);
    if (data.supplier) {
      doc.text(data.supplier.name, rightCol + 10, boxY + 15);
      if (data.po.supplierAddress) {
        const addrLines = data.po.supplierAddress.split("\n");
        addrLines.forEach((line, idx) => {
          doc.text(line, rightCol + 10, boxY + 30 + idx * 12);
        });
      }
      if (data.supplier.email) {
        doc.text(data.supplier.email, rightCol + 10, boxY + 70);
      }
    } else {
      doc.text(data.po.supplierName || "N/A", rightCol + 10, boxY + 15);
      if (data.po.supplierAddress) {
        const addrLines = data.po.supplierAddress.split("\n");
        addrLines.forEach((line, idx) => {
          doc.text(line, rightCol + 10, boxY + 30 + idx * 12);
        });
      }
      if (data.po.supplierEmail) {
        doc.text(data.po.supplierEmail, rightCol + 10, boxY + 70);
      }
    }

    doc.y += 110;
    doc.moveDown(1);
  }

  private renderLineItems(doc: PDFKit.PDFDocument, data: POPdfData): void {
    const startY = doc.y;
    const colX = {
      item: 50,
      sku: 180,
      qty: 280,
      unit: 330,
      price: 400,
      total: 480,
    };

    doc.fillColor("#F3F4F6");
    doc.rect(colX.item, startY, 520, 20).fill();
    doc.fillColor("#000000");

    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Item Description", colX.item + 5, startY + 5);
    doc.text("SKU", colX.sku, startY + 5);
    doc.text("Qty", colX.qty, startY + 5);
    doc.text("Unit", colX.unit, startY + 5);
    doc.text("Unit Price", colX.price, startY + 5);
    doc.text("Total", colX.total, startY + 5);

    let y = startY + 25;
    doc.font("Helvetica").fontSize(9);

    data.lines.forEach((line, idx) => {
      if (y > 680) {
        doc.addPage();
        y = 50;
      }

      if (idx % 2 === 0) {
        doc.fillColor("#F9FAFB");
        doc.rect(colX.item, y - 3, 520, 18).fill();
        doc.fillColor("#000000");
      }

      const itemName = line.itemName || `Item #${line.itemId}`;
      doc.text(itemName.substring(0, 25), colX.item + 5, y);
      doc.text(line.sku || "-", colX.sku, y);
      doc.text(line.qtyOrdered.toString(), colX.qty, y);
      doc.text(line.unitOfMeasure || "EA", colX.unit, y);
      doc.text(
        `$${(Number(line.unitCost) || 0).toFixed(2)}`,
        colX.price,
        y
      );
      const lineTotal = Number(line.lineTotal) || Number(line.qtyOrdered) * Number(line.unitCost) || 0;
      doc.text(`$${lineTotal.toFixed(2)}`, colX.total, y);

      y += 18;
    });

    doc.y = y + 10;
  }

  private renderTotals(doc: PDFKit.PDFDocument, data: POPdfData): void {
    const rightCol = 400;
    const valueCol = 480;
    const y = doc.y + 20;

    doc.font("Helvetica").fontSize(10);

    doc.text("Subtotal:", rightCol, y);
    doc.text(
      `$${(Number(data.po.subtotal) || 0).toFixed(2)}`,
      valueCol,
      y,
      { align: "right", width: 80 }
    );

    if (Number(data.po.shippingCost) > 0) {
      doc.text("Shipping:", rightCol, y + 18);
      doc.text(
        `$${(Number(data.po.shippingCost) || 0).toFixed(2)}`,
        valueCol,
        y + 18,
        { align: "right", width: 80 }
      );
    }

    if (Number(data.po.taxes) > 0) {
      doc.text("Taxes:", rightCol, y + 36);
      doc.text(
        `$${(Number(data.po.taxes) || 0).toFixed(2)}`,
        valueCol,
        y + 36,
        { align: "right", width: 80 }
      );
    }

    doc.font("Helvetica-Bold");
    doc.text("Total:", rightCol, y + 54);
    doc.text(
      `$${(Number(data.po.total) || 0).toFixed(2)}`,
      valueCol,
      y + 54,
      { align: "right", width: 80 }
    );

    doc.y = y + 80;
  }

  private renderFooter(doc: PDFKit.PDFDocument, data: POPdfData): void {
    if (data.po.notes) {
      doc.moveDown(1);
      doc.font("Helvetica-Bold").fontSize(10).text("Notes:");
      doc.font("Helvetica").fontSize(9).text(data.po.notes);
    }

    if (data.po.paymentTerms) {
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(10).text("Payment Terms:");
      doc.font("Helvetica").fontSize(9).text(data.po.paymentTerms);
    }

    if (data.po.incoterms) {
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(10).text("Incoterms:");
      doc.font("Helvetica").fontSize(9).text(data.po.incoterms);
    }

    doc
      .fontSize(8)
      .fillColor("#6B7280")
      .text(
        `Generated on ${new Date().toLocaleString()}`,
        50,
        doc.page.height - 30,
        { align: "center" }
      );
  }
}

export const poPdfService = new POPdfService();
