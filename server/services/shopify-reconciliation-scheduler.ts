/**
 * Shopify Reconciliation Scheduler Service
 * 
 * Schedules automated Shopify order reconciliation syncs to catch any orders
 * that may have been missed by webhooks (server downtime, network issues, etc.)
 * 
 * Runs twice per business week:
 * - Tuesday at 9:00 AM Mountain Time
 * - Thursday at 9:00 AM Mountain Time
 */

import { storage } from "../storage";
import { ShopifyClient } from "./shopify-client";
import { logService } from "./log-service";
import { triggerSalesOrderSync } from "./ghl-sync-triggers";
import { SystemLogType, SystemLogSeverity, SystemLogEntityType, type User } from "@shared/schema";

const TIMEZONE = "America/Denver";
const RECONCILIATION_DAYS_BACK = 7;
const MAX_ORDERS_PER_SYNC = 500;

let schedulerInitialized = false;
let nextScheduledRun: { time: Date; day: string } | null = null;
let isRunning = false;

interface ReconciliationResult {
  success: boolean;
  ordersProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  ordersSkipped: number;
  ghlSynced: number;
  errors: string[];
  duration: number;
  scheduledDay?: string;
}

/**
 * Convert a local time in Mountain timezone to a Date object
 */
function getMountainTime(hour: number, minute: number = 0): Date {
  const now = new Date();
  const mountainNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const target = new Date(mountainNow);
  target.setHours(hour, minute, 0, 0);
  
  if (target <= mountainNow) {
    target.setDate(target.getDate() + 1);
  }
  
  const utcOffset = mountainNow.getTime() - now.getTime();
  return new Date(target.getTime() - utcOffset);
}

/**
 * Get the current day of week in Mountain Time (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 */
function getMountainDayOfWeek(): number {
  const now = new Date();
  const mountainNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  return mountainNow.getDay();
}

/**
 * Get days until next target day (Tuesday = 2, Thursday = 4)
 */
function daysUntilNextTarget(targetDay: number): number {
  const currentDay = getMountainDayOfWeek();
  let daysUntil = targetDay - currentDay;
  if (daysUntil <= 0) {
    daysUntil += 7;
  }
  return daysUntil;
}

/**
 * Get the next scheduled run time (Tuesday or Thursday at 9 AM MT)
 */
function getNextScheduledRun(): { time: Date; day: string } {
  const now = new Date();
  const mountainNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const currentDay = mountainNow.getDay();
  const currentHour = mountainNow.getHours();
  
  const TUESDAY = 2;
  const THURSDAY = 4;
  const RUN_HOUR = 9;
  
  let targetDay: number;
  let daysToAdd: number;
  
  if (currentDay === TUESDAY && currentHour < RUN_HOUR) {
    targetDay = TUESDAY;
    daysToAdd = 0;
  } else if (currentDay === THURSDAY && currentHour < RUN_HOUR) {
    targetDay = THURSDAY;
    daysToAdd = 0;
  } else {
    const daysToTuesday = daysUntilNextTarget(TUESDAY);
    const daysToThursday = daysUntilNextTarget(THURSDAY);
    
    if (daysToTuesday < daysToThursday) {
      targetDay = TUESDAY;
      daysToAdd = daysToTuesday;
    } else {
      targetDay = THURSDAY;
      daysToAdd = daysToThursday;
    }
  }
  
  const target = new Date(mountainNow);
  target.setDate(target.getDate() + daysToAdd);
  target.setHours(RUN_HOUR, 0, 0, 0);
  
  const utcOffset = mountainNow.getTime() - now.getTime();
  const utcTarget = new Date(target.getTime() - utcOffset);
  
  const dayName = targetDay === TUESDAY ? "Tuesday" : "Thursday";
  
  return { time: utcTarget, day: dayName };
}

/**
 * Calculate milliseconds until target time
 */
function msUntilTarget(targetTime: Date): number {
  return Math.max(0, targetTime.getTime() - Date.now());
}

/**
 * Run the Shopify reconciliation sync
 */
async function runReconciliation(reason: string = "SCHEDULED"): Promise<ReconciliationResult> {
  const startTime = Date.now();
  const result: ReconciliationResult = {
    success: false,
    ordersProcessed: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
    ordersSkipped: 0,
    ghlSynced: 0,
    errors: [],
    duration: 0,
    scheduledDay: reason,
  };
  
  if (isRunning) {
    console.log("[Shopify Reconciliation] Already running, skipping...");
    result.errors.push("Reconciliation already in progress");
    result.duration = Date.now() - startTime;
    return result;
  }
  
  isRunning = true;
  console.log(`[Shopify Reconciliation] Starting ${reason} reconciliation...`);
  
  try {
    const shopifyConfigs = await storage.getEnabledIntegrationConfigsByProvider("SHOPIFY");
    console.log(`[Shopify Reconciliation] Found ${shopifyConfigs.length} enabled Shopify configs`);
    
    for (const config of shopifyConfigs) {
      try {
        const shopDomain = (config.config as any)?.shopDomain;
        const accessToken = config.apiKey;
        const apiVersion = (config.config as any)?.apiVersion || "2024-01";
        
        if (!shopDomain || !accessToken) {
          continue;
        }
        
        console.log(`[Shopify Reconciliation] Processing config ${config.id} (${shopDomain})...`);
        
        const client = new ShopifyClient(shopDomain, accessToken, apiVersion);
        const orders = await client.syncRecentOrders(RECONCILIATION_DAYS_BACK, MAX_ORDERS_PER_SYNC);
        
        result.ordersProcessed += orders.length;
        
        for (const orderData of orders) {
          try {
            // Use external ID only lookup to find orders regardless of channel
            // This allows updating channel when detection improves (SHOPIFY -> AMAZON)
            const existingOrder = await storage.getSalesOrderByExternalIdOnly(orderData.externalOrderId);
            
            if (existingOrder) {
              // Check if channel actually changed for logging
              if (existingOrder.channel !== orderData.channel) {
                console.log(`[Shopify Reconciliation] Updating channel for order ${orderData.externalOrderId}: ${existingOrder.channel} -> ${orderData.channel}`);
              }
              
              await storage.updateSalesOrder(existingOrder.id, {
                channel: orderData.channel, // Update channel to correct classification (Amazon vs Shopify)
                status: orderData.status,
                customerName: orderData.customerName,
                customerEmail: orderData.customerEmail,
                customerPhone: orderData.customerPhone,
                externalOrderId: orderData.externalOrderId, // Backfill if previously null
                externalCustomerId: orderData.externalCustomerId,
                expectedDeliveryDate: orderData.expectedDeliveryDate,
                sourceUrl: orderData.sourceUrl,
                totalAmount: orderData.totalAmount,
                currency: orderData.currency,
                rawPayload: orderData.rawPayload,
                // Shipping address fields
                shipToStreet: orderData.shipToStreet,
                shipToCity: orderData.shipToCity,
                shipToState: orderData.shipToState,
                shipToZip: orderData.shipToZip,
                shipToCountry: orderData.shipToCountry,
              });
              result.ordersUpdated++;
            } else {
              const salesOrder = await storage.createSalesOrder({
                channel: orderData.channel, // Use detected channel (AMAZON or SHOPIFY)
                externalOrderId: orderData.externalOrderId,
                externalCustomerId: orderData.externalCustomerId,
                customerName: orderData.customerName,
                customerEmail: orderData.customerEmail,
                customerPhone: orderData.customerPhone,
                status: orderData.status,
                orderDate: orderData.orderDate,
                expectedDeliveryDate: orderData.expectedDeliveryDate,
                sourceUrl: orderData.sourceUrl,
                totalAmount: orderData.totalAmount,
                currency: orderData.currency,
                notes: `Imported via ${reason} reconciliation`,
                rawPayload: orderData.rawPayload,
                // Shipping address fields
                shipToStreet: orderData.shipToStreet,
                shipToCity: orderData.shipToCity,
                shipToState: orderData.shipToState,
                shipToZip: orderData.shipToZip,
                shipToCountry: orderData.shipToCountry,
              });
              
              for (const lineItem of orderData.lineItems) {
                let product = await storage.getItemBySku(lineItem.sku);
                if (!product) {
                  product = await storage.findProductByShopifySku(lineItem.sku);
                }
                
                if (product) {
                  await storage.createSalesOrderLine({
                    salesOrderId: salesOrder.id,
                    productId: product.id,
                    sku: product.sku,
                    qtyOrdered: lineItem.qtyOrdered,
                    qtyAllocated: 0,
                    qtyShipped: 0,
                    unitPrice: lineItem.unitPrice,
                  });
                }
              }
              
              result.ordersCreated++;
              
              // Automatically sync to GHL (same as webhook behavior)
              try {
                const adminUsers = await storage.getAllUsers();
                const adminUser = adminUsers.find((u: User) => u.role === 'admin') || adminUsers[0];
                if (adminUser) {
                  await triggerSalesOrderSync(adminUser.id, salesOrder.id, false);
                  result.ghlSynced++;
                  console.log(`[Shopify Reconciliation] Synced order ${orderData.externalOrderId} to GHL`);
                }
              } catch (ghlError: any) {
                console.warn(`[Shopify Reconciliation] GHL sync skipped for ${orderData.externalOrderId}:`, ghlError.message);
              }
            }
          } catch (orderError: any) {
            result.errors.push(`Order ${orderData.externalOrderId}: ${orderError.message}`);
          }
        }
        
        console.log(`[Shopify Reconciliation] Config ${config.id}: ${orders.length} orders processed`);
        
      } catch (configError: any) {
        console.error(`[Shopify Reconciliation] Error for config ${config.id}:`, configError.message);
        result.errors.push(`Config ${config.id}: ${configError.message}`);
      }
    }
    
    result.success = result.errors.length === 0;
    result.duration = Date.now() - startTime;
    
    await logService.logSystemEvent({
      type: SystemLogType.SHOPIFY_RECONCILIATION,
      entityType: SystemLogEntityType.INTEGRATION,
      severity: result.success ? SystemLogSeverity.INFO : SystemLogSeverity.WARNING,
      code: result.success ? "RECONCILIATION_SUCCESS" : "RECONCILIATION_PARTIAL",
      message: `Shopify ${reason} reconciliation completed: ${result.ordersCreated} new, ${result.ordersUpdated} updated, ${result.ghlSynced} synced to GHL, ${result.errors.length} errors`,
      details: {
        reason,
        ordersProcessed: result.ordersProcessed,
        ordersCreated: result.ordersCreated,
        ordersUpdated: result.ordersUpdated,
        ordersSkipped: result.ordersSkipped,
        ghlSynced: result.ghlSynced,
        errorCount: result.errors.length,
        errors: result.errors.slice(0, 10),
        durationMs: result.duration,
      },
    });
    
    console.log(`[Shopify Reconciliation] Completed: ${result.ordersCreated} created, ${result.ordersUpdated} updated, ${result.ghlSynced} GHL synced, ${result.errors.length} errors (${result.duration}ms)`);
    
  } catch (error: any) {
    console.error("[Shopify Reconciliation] Fatal error:", error);
    result.errors.push(`Fatal: ${error.message}`);
    result.duration = Date.now() - startTime;
    
    await logService.logSystemEvent({
      type: SystemLogType.SHOPIFY_RECONCILIATION,
      entityType: SystemLogEntityType.INTEGRATION,
      severity: SystemLogSeverity.ERROR,
      code: "RECONCILIATION_FAILED",
      message: `Shopify ${reason} reconciliation failed: ${error.message}`,
      details: {
        reason,
        error: error.message,
        durationMs: result.duration,
      },
    });
  } finally {
    isRunning = false;
  }
  
  return result;
}

/**
 * Run scheduled reconciliation and schedule the next one
 */
async function runScheduledReconciliation(day: string): Promise<void> {
  console.log(`[Shopify Reconciliation] Running scheduled ${day} reconciliation`);
  
  try {
    await runReconciliation(`SCHEDULED_${day.toUpperCase()}`);
  } catch (error: any) {
    console.error(`[Shopify Reconciliation] Scheduled run failed:`, error);
  }
  
  scheduleNextRun();
}

/**
 * Schedule the next reconciliation run
 */
function scheduleNextRun(): void {
  nextScheduledRun = getNextScheduledRun();
  const msUntil = msUntilTarget(nextScheduledRun.time);
  
  console.log(`[Shopify Reconciliation] Next run scheduled: ${nextScheduledRun.day} at ${nextScheduledRun.time.toISOString()} (in ${Math.round(msUntil / 60000)} minutes)`);
  
  setTimeout(() => {
    runScheduledReconciliation(nextScheduledRun!.day);
  }, msUntil);
}

/**
 * Initialize the Shopify reconciliation scheduler
 */
export function initializeShopifyReconciliationScheduler(): void {
  if (schedulerInitialized) {
    console.log("[Shopify Reconciliation] Scheduler already initialized");
    return;
  }
  
  schedulerInitialized = true;
  console.log("[Shopify Reconciliation] Initializing scheduler for Mountain Time (America/Denver)");
  console.log("[Shopify Reconciliation] Schedule: Tuesday & Thursday at 9:00 AM MT");
  
  scheduleNextRun();
  
  console.log("[Shopify Reconciliation] Scheduler initialized");
}

/**
 * Trigger a manual reconciliation run
 */
export async function triggerManualReconciliation(): Promise<ReconciliationResult> {
  console.log("[Shopify Reconciliation] Manual trigger requested");
  return await runReconciliation("MANUAL");
}

/**
 * Get the scheduler status
 */
export function getReconciliationSchedulerStatus(): {
  initialized: boolean;
  isRunning: boolean;
  nextRun: { time: string; day: string } | null;
} {
  return {
    initialized: schedulerInitialized,
    isRunning,
    nextRun: nextScheduledRun ? {
      time: nextScheduledRun.time.toISOString(),
      day: nextScheduledRun.day,
    } : null,
  };
}
