import sgMail from "@sendgrid/mail";
import { storage } from "../storage";
import { AuditLogger } from "./audit-logger";
import { recordSchedulerRun } from "./scheduler-run-recorder";
import type {
  InsertPurchaseOrder,
  InsertPurchaseOrderLine,
  Item,
  ReorderAlert,
  Supplier,
  SupplierItem,
  VendorCommunication,
} from "@shared/schema";

const REORDER_SCHEDULER_ID = "reorder-watcher";
const REORDER_SCHEDULER_NAME = "Auto reorder watcher";
const AUTO_SEND_PAUSE_KEY = "reorder_alerts_auto_send_paused";
const AUTO_SEND_FROM_EMAIL = "clarencerohbock@gmail.com";
const WATCH_INTERVAL_MS = 60 * 60 * 1000;
const THIRTY_DAYS = 30;
const COOLDOWN_DAYS = 7;

let watcherInitialized = false;
let watcherInterval: NodeJS.Timeout | null = null;
let nextRunAt: Date | null = null;
let lastRunAt: Date | null = null;
let lastRunStatus: "success" | "partial" | "failed" | null = null;

type AlertStatus = "pending" | "sent" | "acknowledged" | "dismissed" | "received" | "failed";

interface Candidate {
  item: Item;
  supplier: Supplier;
  supplierItem: SupplierItem;
  stockOnHand: number;
  daysLeft: number;
  reorderThresholdDays: number;
  recommendedQty: number;
}

export interface ReorderWatcherResult {
  checkedCount: number;
  candidateCount: number;
  createdCount: number;
  skippedCooldownCount: number;
  sentCount: number;
  failedSendCount: number;
  paused: boolean;
}

function isComponent(item: Item): boolean {
  return item.type === "component" || item.productKind === "COMPONENT" || item.productKind === "RAW";
}

function getComponentStockOnHand(item: Item): number {
  // Components in this app are received into and consumed from currentStock.
  return item.currentStock ?? 0;
}

function getLeadTimeDays(supplierItem: SupplierItem): number {
  return Math.max(0, supplierItem.leadTimeDays ?? 0);
}

function computeRecommendedQty(dailyUsage: number, minimumOrderQuantity: number | null | undefined): number {
  const baseQty = Math.max(1, Math.ceil(dailyUsage * THIRTY_DAYS));
  const moq = minimumOrderQuantity && minimumOrderQuantity > 0 ? minimumOrderQuantity : null;
  if (!moq) return baseQty;
  return Math.ceil(baseQty / moq) * moq;
}

function getPreferredSupplierItem(itemId: string, allSupplierItems: SupplierItem[]): SupplierItem | null {
  const mine = allSupplierItems.filter((row) => row.itemId === itemId);
  if (mine.length === 0) return null;
  return mine.find((row) => row.isDesignatedSupplier) ?? mine[0];
}

function withinLastDays(value: Date | string | null | undefined, days: number): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

async function ensurePauseSetting(): Promise<boolean> {
  const existing = await storage.getAppSetting(AUTO_SEND_PAUSE_KEY);
  if (existing === null) {
    await storage.setAppSetting(AUTO_SEND_PAUSE_KEY, "true");
    return true;
  }
  return existing === "true";
}

export async function getReorderAutoSendPaused(): Promise<boolean> {
  return ensurePauseSetting();
}

export async function setReorderAutoSendPaused(paused: boolean): Promise<boolean> {
  await storage.setAppSetting(AUTO_SEND_PAUSE_KEY, paused ? "true" : "false");
  return paused;
}

function buildEmailMessage(candidate: Candidate): {
  to: string;
  subject: string;
  bodyText: string;
} {
  const recipient = candidate.supplier.email?.trim();
  if (!recipient) {
    throw new Error(`Supplier ${candidate.supplier.name} does not have an email address`);
  }

  const supplierGreeting = candidate.supplier.contactName?.trim() || "team";
  const supplierSku = candidate.supplierItem.supplierSku?.trim();
  const subject = `SBR Reorder Request - ${candidate.item.name} - Qty ${candidate.recommendedQty}`;
  const bodyText = [
    `Hi ${supplierGreeting},`,
    ``,
    `Sticker Burr Roller would like to place a reorder for the following:`,
    ``,
    `Item: ${candidate.item.name}`,
    `Our SKU: ${candidate.item.sku}`,
    supplierSku ? `Your SKU: ${supplierSku}` : null,
    `Recommended Qty: ${candidate.recommendedQty} units`,
    `Current Stock: ${candidate.stockOnHand}`,
    `Days remaining at current burn: ${candidate.daysLeft.toFixed(1)}`,
    ``,
    `Please confirm availability and expected ship date.`,
    ``,
    `Thanks,`,
    `Clarence Rohbock`,
    `Production / Inspired Tool Design LLC`,
    `clarencerohbock@gmail.com`,
  ].filter(Boolean).join("\n");

  return { to: recipient, subject, bodyText };
}

function ensureSendGridConfigured(): void {
  if (!process.env.SENDGRID_API_KEY) {
    throw new Error("SENDGRID_API_KEY is not configured");
  }

  const configuredFrom = (process.env.SENDGRID_FROM_EMAIL || "").trim().toLowerCase();
  if (configuredFrom !== AUTO_SEND_FROM_EMAIL) {
    throw new Error(`SENDGRID_FROM_EMAIL must be ${AUTO_SEND_FROM_EMAIL} for reorder emails`);
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

async function sendAlertEmail(alert: ReorderAlert, candidate: Candidate): Promise<{ messageId: string | null }> {
  ensureSendGridConfigured();
  const { to, subject, bodyText } = buildEmailMessage(candidate);
  const [response] = await sgMail.send({
    to,
    from: {
      email: AUTO_SEND_FROM_EMAIL,
      name: "Clarence Rohbock",
    },
    subject,
    text: bodyText,
  });

  const messageId = response.headers?.["x-message-id"] || (response as any).messageId || null;
  await storage.updateReorderAlert(alert.id, {
    alertStatus: "sent",
    emailSentAt: new Date(),
    status: "open",
  });
  await storage.createVendorCommunication({
    supplierId: candidate.supplier.id,
    itemId: candidate.item.id,
    reorderAlertId: alert.id,
    purchaseOrderId: alert.purchaseOrderId ?? null,
    communicationType: "REORDER_REQUEST",
    channel: "EMAIL",
    direction: "OUTBOUND",
    recipientEmail: to,
    subject,
    bodyText,
    status: "sent",
    providerMessageId: messageId ? String(messageId) : null,
    metadata: {
      sku: candidate.item.sku,
      itemName: candidate.item.name,
      daysLeft: Number(candidate.daysLeft.toFixed(2)),
      recommendedQty: candidate.recommendedQty,
      stockOnHand: candidate.stockOnHand,
      supplierSku: candidate.supplierItem.supplierSku ?? null,
    },
    sentAt: new Date(),
  });

  await AuditLogger.logEvent({
    source: "SYSTEM",
    eventType: "REORDER_ALERT_SENT",
    entityType: "ITEM",
    entityId: candidate.item.id,
    entityLabel: candidate.item.sku,
    status: "INFO",
    description: `Reorder alert sent for ${candidate.item.name}`,
    supplierId: candidate.supplier.id,
    details: {
      reorderAlertId: alert.id,
      recommendedQty: candidate.recommendedQty,
      supplierEmail: to,
      messageId,
    },
  });

  return { messageId: messageId ? String(messageId) : null };
}

async function getCandidateForAlert(alert: ReorderAlert): Promise<Candidate> {
  const [item, supplier, supplierItems] = await Promise.all([
    storage.getItem(alert.itemId),
    storage.getSupplier(alert.supplierId),
    storage.getSupplierItemsByItemId(alert.itemId),
  ]);
  if (!item) throw new Error("Item not found for alert");
  if (!supplier) throw new Error("Supplier not found for alert");
  const supplierItem = supplierItems.find((row) => row.supplierId === alert.supplierId) ?? getPreferredSupplierItem(alert.itemId, supplierItems);
  if (!supplierItem) throw new Error("Supplier item not found for alert");

  const dailyUsage = item.dailyUsage ?? 0;
  const stockOnHand = getComponentStockOnHand(item);
  const daysLeft = dailyUsage > 0 ? stockOnHand / dailyUsage : 0;
  const reorderThresholdDays = getLeadTimeDays(supplierItem) * 1.5;

  return {
    item,
    supplier,
    supplierItem,
    stockOnHand,
    daysLeft,
    reorderThresholdDays,
    recommendedQty: alert.recommendedQty,
  };
}

export async function sendReorderAlertNow(alertId: string): Promise<{ alert: ReorderAlert; messageId: string | null }> {
  const alert = await storage.getReorderAlert(alertId);
  if (!alert) throw new Error("Reorder alert not found");
  if (alert.alertStatus === "sent") {
    return { alert, messageId: null };
  }
  if (alert.alertStatus === "dismissed" || alert.alertStatus === "received") {
    throw new Error(`Cannot send alert in ${alert.alertStatus} state`);
  }

  const candidate = await getCandidateForAlert(alert);
  const result = await sendAlertEmail(alert, candidate);
  const updated = await storage.getReorderAlert(alertId);
  if (!updated) throw new Error("Alert disappeared after send");
  return { alert: updated, messageId: result.messageId };
}

function choosePOStatusAlertDate(alert: ReorderAlert): Date {
  return alert.emailSentAt ?? alert.createdAt ?? new Date();
}

async function createPurchaseOrderLogForAlert(alert: ReorderAlert): Promise<string> {
  if (alert.purchaseOrderId) return alert.purchaseOrderId;

  const [item, supplier, supplierItems] = await Promise.all([
    storage.getItem(alert.itemId),
    storage.getSupplier(alert.supplierId),
    storage.getSupplierItemsByItemId(alert.itemId),
  ]);
  if (!item) throw new Error("Item not found for alert");
  if (!supplier) throw new Error("Supplier not found for alert");
  const supplierItem = supplierItems.find((row) => row.supplierId === supplier.id) ?? getPreferredSupplierItem(item.id, supplierItems);

  const allPOs = await storage.getAllPurchaseOrders();
  const year = new Date().getFullYear();
  const nextSequence = allPOs.filter((po) => po.poNumber?.startsWith(`PO-${year}-`)).length + 1;
  const poNumber = `PO-${year}-${String(nextSequence).padStart(4, "0")}`;
  const poDate = choosePOStatusAlertDate(alert);

  const poPayload: InsertPurchaseOrder = {
    poNumber,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierEmail: supplier.email ?? null,
    supplierAddress: supplier.streetAddress ?? null,
    shipToLocation: "HILDALE",
    currency: "USD",
    orderDate: poDate,
    sentAt: alert.emailSentAt ?? poDate,
    receivedAt: new Date(),
    status: "RECEIVED",
    notes: `Auto-created from reorder alert ${alert.id}`,
    emailTo: supplier.email ?? null,
    emailSubject: null,
    emailBodyText: null,
    lastEmailStatus: alert.emailSentAt ? "SENT" : "NOT_SENT",
    lastEmailSentAt: alert.emailSentAt ?? null,
    subtotal: 0,
    shippingCost: 0,
    taxes: 0,
    total: 0,
  };

  const po = await storage.createPurchaseOrder(poPayload);
  const unitCost = supplierItem?.price ?? item.defaultPurchaseCost ?? 0;
  const qty = Math.max(1, alert.recommendedQty);
  const linePayload: InsertPurchaseOrderLine = {
    purchaseOrderId: po.id,
    itemId: item.id,
    itemName: item.name,
    sku: item.sku,
    qtyOrdered: qty,
    qtyReceived: qty,
    unitCost,
    lineTotal: Math.round(qty * unitCost * 100) / 100,
    taxAmount: 0,
  };
  await storage.createPurchaseOrderLine(linePayload);
  await storage.recalculatePOTotals(po.id);

  await storage.updateReorderAlert(alert.id, {
    purchaseOrderId: po.id,
  });

  return po.id;
}

async function updateAlertAndCommunicationsStatus(alertId: string, status: AlertStatus): Promise<ReorderAlert> {
  const legacyStatus = status === "acknowledged" ? "acknowledged" : status === "received" ? "ordered" : status === "dismissed" ? "ordered" : "open";
  const updated = await storage.updateReorderAlert(alertId, {
    alertStatus: status,
    status: legacyStatus,
    acknowledgedAt: status === "acknowledged" ? new Date() : undefined,
  });
  if (!updated) throw new Error("Reorder alert not found");

  const communications = await storage.getVendorCommunications();
  const related = communications.filter((comm) => comm.reorderAlertId === alertId);
  await Promise.all(related.map((comm) => storage.updateVendorCommunication(comm.id, {
    status,
    sentAt: status === "sent" ? new Date() : comm.sentAt,
  })));

  return updated;
}

export async function acknowledgeReorderAlert(alertId: string): Promise<ReorderAlert> {
  return updateAlertAndCommunicationsStatus(alertId, "acknowledged");
}

export async function dismissReorderAlert(alertId: string): Promise<ReorderAlert> {
  return updateAlertAndCommunicationsStatus(alertId, "dismissed");
}

export async function markReorderAlertReceived(alertId: string): Promise<ReorderAlert> {
  const alert = await storage.getReorderAlert(alertId);
  if (!alert) throw new Error("Reorder alert not found");
  const poId = await createPurchaseOrderLogForAlert(alert);
  const updated = await storage.updateReorderAlert(alertId, {
    alertStatus: "received",
    purchaseOrderId: poId,
    status: "ordered",
  });
  if (!updated) throw new Error("Failed to update reorder alert");

  const communications = await storage.getVendorCommunications();
  const related = communications.filter((comm) => comm.reorderAlertId === alertId);
  await Promise.all(related.map((comm) => storage.updateVendorCommunication(comm.id, {
    status: "received",
  })));

  await AuditLogger.logEvent({
    source: "USER",
    eventType: "REORDER_ALERT_RECEIVED",
    entityType: "ITEM",
    entityId: updated.itemId,
    status: "INFO",
    description: `Reorder alert marked received`,
    supplierId: updated.supplierId,
    purchaseOrderId: poId,
    details: {
      reorderAlertId: updated.id,
      purchaseOrderId: poId,
    },
  });

  return updated;
}

async function buildCandidates(): Promise<Candidate[]> {
  const [items, suppliers, supplierItems] = await Promise.all([
    storage.getAllItems(),
    storage.getAllSuppliers(),
    storage.getAllSupplierItems(),
  ]);
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const candidates: Candidate[] = [];

  for (const item of items) {
    if (!isComponent(item)) continue;
    const dailyUsage = item.dailyUsage ?? 0;
    if (dailyUsage <= 0) continue;

    const supplierItem = getPreferredSupplierItem(item.id, supplierItems);
    if (!supplierItem) continue;
    const supplier = supplierById.get(supplierItem.supplierId);
    if (!supplier) continue;

    const stockOnHand = getComponentStockOnHand(item);
    const daysLeft = stockOnHand / dailyUsage;
    const reorderThresholdDays = getLeadTimeDays(supplierItem) * 1.5;
    if (daysLeft > reorderThresholdDays) continue;

    candidates.push({
      item,
      supplier,
      supplierItem,
      stockOnHand,
      daysLeft,
      reorderThresholdDays,
      recommendedQty: computeRecommendedQty(dailyUsage, supplierItem.minimumOrderQuantity),
    });
  }

  return candidates;
}

function hasRecentCooldown(candidate: Candidate, alerts: ReorderAlert[], communications: VendorCommunication[]): boolean {
  const recentAlert = alerts.find((alert) =>
    alert.itemId === candidate.item.id &&
    alert.supplierId === candidate.supplier.id &&
    (alert.alertStatus === "pending" || alert.alertStatus === "sent" || alert.alertStatus === "acknowledged") &&
    withinLastDays(alert.createdAt, COOLDOWN_DAYS),
  );
  if (recentAlert) return true;

  return communications.some((comm) =>
    comm.itemId === candidate.item.id &&
    comm.supplierId === candidate.supplier.id &&
    (comm.status === "pending" || comm.status === "sent") &&
    withinLastDays(comm.sentAt ?? comm.createdAt, COOLDOWN_DAYS),
  );
}

export async function runReorderWatcher(): Promise<ReorderWatcherResult> {
  const startedAt = new Date();
  let status: "success" | "partial" | "failed" = "success";

  try {
    const paused = await getReorderAutoSendPaused();
    const [existingAlerts, communications, candidates] = await Promise.all([
      storage.getReorderAlerts(),
      storage.getVendorCommunications(),
      buildCandidates(),
    ]);

    let createdCount = 0;
    let skippedCooldownCount = 0;
    let sentCount = 0;
    let failedSendCount = 0;

    for (const candidate of candidates) {
      if (hasRecentCooldown(candidate, existingAlerts, communications)) {
        skippedCooldownCount++;
        continue;
      }

      const alert = await storage.createReorderAlert({
        sku: candidate.item.sku,
        itemId: candidate.item.id,
        currentStock: candidate.stockOnHand,
        reorderPoint: Math.ceil(candidate.reorderThresholdDays * (candidate.item.dailyUsage ?? 0)),
        suggestedOrderQty: candidate.recommendedQty,
        supplierName: candidate.supplier.name,
        status: "open",
        triggeredAt: new Date(),
        acknowledgedAt: null,
        supplierId: candidate.supplier.id,
        purchaseOrderId: null,
        daysLeftAtAlert: candidate.daysLeft.toFixed(2),
        recommendedQty: candidate.recommendedQty,
        alertStatus: "pending",
        emailSentAt: null,
      });
      existingAlerts.unshift(alert);
      createdCount++;
    }

    if (!paused) {
      const alertsToSend = existingAlerts.filter((alert) => alert.alertStatus === "pending");
      for (const alert of alertsToSend) {
        try {
          const candidate = await getCandidateForAlert(alert);
          await sendAlertEmail(alert, candidate);
          sentCount++;
        } catch (error: any) {
          failedSendCount++;
          status = "partial";
          console.error("[ReorderWatcher] Failed to send reorder alert:", error.message);
          await AuditLogger.logEvent({
            source: "SYSTEM",
            eventType: "REORDER_ALERT_SEND_FAILED",
            entityType: "ITEM",
            entityId: alert.itemId,
            status: "ERROR",
            description: `Failed to send reorder alert`,
            supplierId: alert.supplierId,
            details: {
              reorderAlertId: alert.id,
              error: error.message,
            },
          });
        }
      }
    }

    const result: ReorderWatcherResult = {
      checkedCount: candidates.length,
      candidateCount: candidates.length,
      createdCount,
      skippedCooldownCount,
      sentCount,
      failedSendCount,
      paused,
    };

    await recordSchedulerRun({
      schedulerId: REORDER_SCHEDULER_ID,
      schedulerName: REORDER_SCHEDULER_NAME,
      status,
      startedAt,
      details: result,
    });

    lastRunAt = new Date();
    lastRunStatus = status;
    return result;
  } catch (error: any) {
    lastRunAt = new Date();
    lastRunStatus = "failed";
    await recordSchedulerRun({
      schedulerId: REORDER_SCHEDULER_ID,
      schedulerName: REORDER_SCHEDULER_NAME,
      status: "failed",
      startedAt,
      errorMessage: error.message,
    });
    throw error;
  }
}

function scheduleNextRun(): void {
  nextRunAt = new Date(Date.now() + WATCH_INTERVAL_MS);
}

export function getReorderWatcherStatus(): {
  initialized: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
} {
  return {
    initialized: watcherInitialized,
    nextRunAt,
    lastRunAt,
    lastRunStatus,
  };
}

export function initializeReorderWatcher(): void {
  if (watcherInitialized) return;
  watcherInitialized = true;
  scheduleNextRun();
  console.log("[ReorderWatcher] Initializing hourly reorder watcher");

  runReorderWatcher().catch((error) => {
    console.error("[ReorderWatcher] Initial run failed:", error);
  });

  watcherInterval = setInterval(() => {
    scheduleNextRun();
    runReorderWatcher().catch((error) => {
      console.error("[ReorderWatcher] Scheduled run failed:", error);
    });
  }, WATCH_INTERVAL_MS);
}

export function stopReorderWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
  watcherInitialized = false;
  nextRunAt = null;
}
