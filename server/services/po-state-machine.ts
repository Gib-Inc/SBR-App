import type { PurchaseOrder, InsertPurchaseOrder } from "@shared/schema";
import { storage } from "../storage";

export type POStatus =
  | "DRAFT"
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "SENT"
  | "PARTIAL_RECEIVED"
  | "RECEIVED"
  | "CLOSED"
  | "CANCELLED";

const VALID_TRANSITIONS: Record<POStatus, POStatus[]> = {
  DRAFT: ["APPROVAL_PENDING", "CANCELLED"],
  APPROVAL_PENDING: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["SENT", "DRAFT", "CANCELLED"],
  SENT: ["PARTIAL_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIAL_RECEIVED: ["PARTIAL_RECEIVED", "RECEIVED", "CANCELLED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

const STATUS_LABELS: Record<POStatus, string> = {
  DRAFT: "Draft",
  APPROVAL_PENDING: "Pending Approval",
  APPROVED: "Approved",
  SENT: "Sent to Supplier",
  PARTIAL_RECEIVED: "Partially Received",
  RECEIVED: "Fully Received",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

const STATUS_COLORS: Record<POStatus, { bg: string; text: string }> = {
  DRAFT: { bg: "bg-gray-100", text: "text-gray-700" },
  APPROVAL_PENDING: { bg: "bg-yellow-100", text: "text-yellow-800" },
  APPROVED: { bg: "bg-blue-100", text: "text-blue-800" },
  SENT: { bg: "bg-indigo-100", text: "text-indigo-800" },
  PARTIAL_RECEIVED: { bg: "bg-orange-100", text: "text-orange-800" },
  RECEIVED: { bg: "bg-green-100", text: "text-green-800" },
  CLOSED: { bg: "bg-slate-100", text: "text-slate-700" },
  CANCELLED: { bg: "bg-red-100", text: "text-red-800" },
};

export interface TransitionResult {
  success: boolean;
  purchaseOrder?: PurchaseOrder;
  error?: string;
  previousStatus?: POStatus;
  newStatus?: POStatus;
}

export interface POStateInfo {
  status: POStatus;
  label: string;
  colors: { bg: string; text: string };
  allowedTransitions: POStatus[];
  isEditable: boolean;
  canReceive: boolean;
  canCancel: boolean;
}

export class POStateMachine {
  static isValidStatus(status: string): status is POStatus {
    return Object.keys(VALID_TRANSITIONS).includes(status as POStatus);
  }

  static canTransition(from: POStatus, to: POStatus): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  static getValidTransitions(status: POStatus): POStatus[] {
    return VALID_TRANSITIONS[status] || [];
  }

  static getStatusLabel(status: POStatus): string {
    return STATUS_LABELS[status] || status;
  }

  static getStatusColors(status: POStatus): { bg: string; text: string } {
    return STATUS_COLORS[status] || { bg: "bg-gray-100", text: "text-gray-700" };
  }

  static getStateInfo(status: POStatus): POStateInfo {
    return {
      status,
      label: this.getStatusLabel(status),
      colors: this.getStatusColors(status),
      allowedTransitions: this.getValidTransitions(status),
      isEditable: ["DRAFT", "APPROVAL_PENDING"].includes(status),
      canReceive: ["SENT", "PARTIAL_RECEIVED"].includes(status),
      canCancel: !["CLOSED", "CANCELLED"].includes(status),
    };
  }

  static async transitionTo(
    purchaseOrderId: string,
    newStatus: POStatus,
    metadata?: {
      cancellationReason?: string;
    }
  ): Promise<TransitionResult> {
    const po = await storage.getPurchaseOrder(purchaseOrderId);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    const currentStatus = po.status as POStatus;
    if (!this.isValidStatus(currentStatus)) {
      return { success: false, error: `Invalid current status: ${currentStatus}` };
    }

    if (!this.canTransition(currentStatus, newStatus)) {
      return {
        success: false,
        error: `Cannot transition from ${currentStatus} to ${newStatus}. Allowed: ${this.getValidTransitions(currentStatus).join(", ") || "none"}`,
      };
    }

    const updates: Partial<InsertPurchaseOrder> = {
      status: newStatus,
    };

    switch (newStatus) {
      case "APPROVAL_PENDING":
        break;
      case "APPROVED":
        updates.approvedAt = new Date();
        break;
      case "SENT":
        updates.sentAt = new Date();
        break;
      case "RECEIVED":
        updates.receivedAt = new Date();
        break;
      case "CANCELLED":
        if (metadata?.cancellationReason) {
          updates.cancellationReason = metadata.cancellationReason;
        }
        break;
    }

    const updated = await storage.updatePurchaseOrder(purchaseOrderId, updates);
    if (!updated) {
      return { success: false, error: "Failed to update purchase order" };
    }

    return {
      success: true,
      purchaseOrder: updated,
      previousStatus: currentStatus,
      newStatus,
    };
  }

  static async recalculateReceivedStatus(purchaseOrderId: string): Promise<TransitionResult> {
    const po = await storage.getPurchaseOrder(purchaseOrderId);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    const currentStatus = po.status as POStatus;
    if (!["SENT", "PARTIAL_RECEIVED"].includes(currentStatus)) {
      return {
        success: false,
        error: `Cannot recalculate received status from ${currentStatus}`,
      };
    }

    const lines = await storage.getPurchaseOrderLinesByPOId(purchaseOrderId);
    if (lines.length === 0) {
      return { success: false, error: "No lines found for purchase order" };
    }

    let totalOrdered = 0;
    let totalReceived = 0;

    for (const line of lines) {
      totalOrdered += line.qtyOrdered;
      totalReceived += line.qtyReceived || 0;
    }

    let newStatus: POStatus;
    if (totalReceived === 0) {
      return { success: true, purchaseOrder: po, previousStatus: currentStatus, newStatus: currentStatus };
    } else if (totalReceived >= totalOrdered) {
      newStatus = "RECEIVED";
    } else {
      newStatus = "PARTIAL_RECEIVED";
    }

    if (newStatus === currentStatus) {
      return { success: true, purchaseOrder: po, previousStatus: currentStatus, newStatus: currentStatus };
    }

    return this.transitionTo(purchaseOrderId, newStatus);
  }

  static async createDraftPO(
    supplierId: string,
    options?: {
      buyerCompanyName?: string;
      buyerAddress?: string;
      shipToLocation?: string;
      notes?: string;
    }
  ): Promise<PurchaseOrder> {
    const poNumber = await (storage as any).getNextPONumber();
    
    const supplier = await storage.getSupplier(supplierId);
    
    const po = await storage.createPurchaseOrder({
      supplierId,
      poNumber,
      status: "DRAFT",
      orderDate: new Date(),
      buyerCompanyName: options?.buyerCompanyName,
      buyerAddress: options?.buyerAddress,
      supplierName: supplier?.name,
      supplierEmail: supplier?.email,
      supplierAddress: null,
      shipToLocation: options?.shipToLocation,
      notes: options?.notes,
    });

    return po;
  }

  static async addLineItem(
    purchaseOrderId: string,
    itemId: string,
    qtyOrdered: number,
    unitCost: number,
    options?: {
      unitOfMeasure?: string;
      sku?: string;
      itemName?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    const po = await storage.getPurchaseOrder(purchaseOrderId);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    const stateInfo = this.getStateInfo(po.status as POStatus);
    if (!stateInfo.isEditable) {
      return { success: false, error: `Cannot add items to PO in status: ${stateInfo.label}` };
    }

    const lineTotal = qtyOrdered * unitCost;

    await storage.createPurchaseOrderLine({
      purchaseOrderId,
      itemId,
      qtyOrdered,
      unitCost,
      lineTotal,
      unitOfMeasure: options?.unitOfMeasure || "EA",
      sku: options?.sku,
      itemName: options?.itemName,
    });

    await (storage as any).recalculatePOTotals(purchaseOrderId);

    return { success: true };
  }

  static async receiveItems(
    purchaseOrderId: string,
    receiptData: {
      receivedBy?: string;
      notes?: string;
      warehouseLocation?: string;
      lines: Array<{
        purchaseOrderLineId: string;
        receivedQty: number;
        condition?: string;
        conditionNotes?: string;
      }>;
    }
  ): Promise<TransitionResult> {
    const po = await storage.getPurchaseOrder(purchaseOrderId);
    if (!po) {
      return { success: false, error: "Purchase order not found" };
    }

    const stateInfo = this.getStateInfo(po.status as POStatus);
    if (!stateInfo.canReceive) {
      return { success: false, error: `Cannot receive items for PO in status: ${stateInfo.label}` };
    }

    const receipt = await (storage as any).createPurchaseOrderReceipt({
      purchaseOrderId,
      receiptNumber: `RCV-${Date.now()}`,
      receivedAt: new Date(),
      receivedBy: receiptData.receivedBy,
      warehouseLocation: receiptData.warehouseLocation,
      notes: receiptData.notes,
    });

    for (const lineData of receiptData.lines) {
      if (lineData.receivedQty <= 0) continue;

      await (storage as any).createPurchaseOrderReceiptLine({
        receiptId: receipt.id,
        purchaseOrderLineId: lineData.purchaseOrderLineId,
        receivedQty: lineData.receivedQty,
        condition: lineData.condition || "GOOD",
        conditionNotes: lineData.conditionNotes,
      });

      await (storage as any).updatePOLineReceivedQty(lineData.purchaseOrderLineId);
    }

    return this.recalculateReceivedStatus(purchaseOrderId);
  }
}

export const poStateMachine = new POStateMachine();
