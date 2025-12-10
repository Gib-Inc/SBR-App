/**
 * Daily Sales Scheduler Service
 * 
 * Aggregates daily sales data at 11:59 PM Mountain Time (America/Denver)
 * and stores it in the daily_sales_snapshots table for LLM trend analysis.
 */

import { storage } from "../storage";

const TIMEZONE = "America/Denver";

/**
 * Get the date string (YYYY-MM-DD) for a date in Mountain Time
 */
function getMountainDateString(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: TIMEZONE }); // en-CA gives YYYY-MM-DD format
}

/**
 * Get the start and end timestamps for a Mountain Time date
 * Returns UTC timestamps that represent midnight to 11:59:59 PM in MT
 * 
 * Handles DST transitions by calculating offsets separately for each boundary.
 * On DST transition days, midnight and 23:59 may have different offsets.
 */
function getMountainDayBounds(mtDateStr: string): { startOfDay: Date; endOfDay: Date } {
  // Parse the date components  
  const [year, month, day] = mtDateStr.split('-').map(Number);
  
  // Helper to calculate the UTC timestamp for a specific MT time
  // This handles DST by finding what UTC time corresponds to the given MT time
  const mtTimeToUtc = (hour: number, minute: number, second: number, ms: number): Date => {
    // Start with an approximate UTC time (assuming ~7 hour offset)
    let utcGuess = Date.UTC(year, month - 1, day, hour + 7, minute, second, ms);
    
    // Binary search to find the exact UTC time that maps to the target MT time
    // We'll iterate a few times to converge on the correct offset
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    
    for (let i = 0; i < 3; i++) {
      const parts = formatter.formatToParts(new Date(utcGuess));
      const mtDay = parseInt(parts.find(p => p.type === 'day')?.value || String(day), 10);
      const mtHour = parseInt(parts.find(p => p.type === 'hour')?.value || String(hour), 10);
      const mtMinute = parseInt(parts.find(p => p.type === 'minute')?.value || String(minute), 10);
      
      // Calculate difference and adjust
      let dayDiff = (mtDay - day) * 24 * 60; // Convert day diff to minutes
      let hourDiff = (mtHour - hour) * 60;
      let minuteDiff = mtMinute - minute;
      let totalDiffMs = (dayDiff + hourDiff + minuteDiff) * 60 * 1000;
      
      // Subtract the difference to get closer to target
      utcGuess -= totalDiffMs;
    }
    
    return new Date(utcGuess);
  };
  
  // Calculate UTC times for midnight and 23:59:59.999 MT separately
  // This handles DST transitions correctly since each boundary gets its own offset
  const startOfDayUTC = mtTimeToUtc(0, 0, 0, 0);
  const endOfDayUTC = mtTimeToUtc(23, 59, 59, 999);
  
  return { startOfDay: startOfDayUTC, endOfDay: endOfDayUTC };
}

let schedulerInitialized = false;
let nextScheduledRun: Date | null = null;

/**
 * Convert a local time in Mountain timezone to a Date object
 */
function getMountainTime(hour: number, minute: number = 0): Date {
  const now = new Date();
  const mountainNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  
  const target = new Date(mountainNow);
  target.setHours(hour, minute, 0, 0);
  
  // If target time has passed today, schedule for tomorrow
  if (target <= mountainNow) {
    target.setDate(target.getDate() + 1);
  }
  
  // Convert back to UTC
  const utcOffset = mountainNow.getTime() - now.getTime();
  return new Date(target.getTime() - utcOffset);
}

/**
 * Calculate milliseconds until a target time
 */
function msUntilTime(targetTime: Date): number {
  return Math.max(0, targetTime.getTime() - Date.now());
}

/**
 * Aggregate sales data for a specific date (in Mountain Time)
 */
export async function aggregateDailySales(date: Date): Promise<{
  success: boolean;
  date: string;
  totalRevenue: number;
  totalOrders: number;
  totalUnits: number;
  totalRefunds: number;
  error?: string;
}> {
  // CRITICAL: Use Mountain Time date, not UTC
  const dateStr = getMountainDateString(date);
  console.log(`[Daily Sales] Aggregating sales for ${dateStr} (Mountain Time)`);
  
  try {
    // Get proper UTC bounds for this Mountain Time day
    const { startOfDay, endOfDay } = getMountainDayBounds(dateStr);
    
    // Fetch all sales orders for this day
    const allSalesOrders = await storage.getAllSalesOrders();
    const ordersForDay = allSalesOrders.filter(order => {
      const orderDate = new Date(order.orderDate);
      return orderDate >= startOfDay && orderDate <= endOfDay;
    });
    
    // Aggregate metrics
    let totalRevenue = 0;
    let totalOrders = ordersForDay.length;
    let totalUnits = 0;
    const channelBreakdown: Record<string, { revenue: number; orders: number; units: number }> = {
      shopify: { revenue: 0, orders: 0, units: 0 },
      amazon: { revenue: 0, orders: 0, units: 0 },
      direct: { revenue: 0, orders: 0, units: 0 },
    };
    
    for (const order of ordersForDay) {
      const orderTotal = order.totalAmount || 0;
      totalRevenue += orderTotal;
      
      // Get line items for this order to count units
      const lines = await storage.getSalesOrderLines(order.id);
      const orderUnits = lines.reduce((sum, line) => sum + (line.qtyOrdered || 0), 0);
      totalUnits += orderUnits;
      
      // Track by channel
      const channel = (order.channel || 'direct').toLowerCase();
      if (channel.includes('shopify')) {
        channelBreakdown.shopify.revenue += orderTotal;
        channelBreakdown.shopify.orders += 1;
        channelBreakdown.shopify.units += orderUnits;
      } else if (channel.includes('amazon')) {
        channelBreakdown.amazon.revenue += orderTotal;
        channelBreakdown.amazon.orders += 1;
        channelBreakdown.amazon.units += orderUnits;
      } else {
        channelBreakdown.direct.revenue += orderTotal;
        channelBreakdown.direct.orders += 1;
        channelBreakdown.direct.units += orderUnits;
      }
    }
    
    // Get refunds for this day from return requests that were refunded
    const allReturns = await storage.getAllReturnRequests();
    const returnsForDay = allReturns.filter(ret => {
      // Count returns that were refunded on this day
      if (!ret.refundedAt) return false;
      const refundedDate = new Date(ret.refundedAt);
      return refundedDate >= startOfDay && refundedDate <= endOfDay;
    });
    
    // Calculate actual refund amounts from return items (unitPrice * qtyReceived/qtyApproved/qtyRequested)
    // This is more accurate than using the full order total
    let totalRefunds = 0;
    for (const ret of returnsForDay) {
      try {
        // Get return items and sum their actual refund values
        const returnItems = await storage.getReturnItems(ret.id);
        for (const item of returnItems) {
          // Priority: qtyReceived (actual), qtyApproved (confirmed), qtyRequested (fallback for pending)
          // If refunded but not yet received, use qtyApproved or qtyRequested as estimate
          const refundQty = item.qtyReceived || item.qtyApproved || item.qtyRequested || 0;
          const unitPrice = item.unitPrice || 0;
          totalRefunds += refundQty * unitPrice;
        }
      } catch (err) {
        // If return items unavailable, skip this return (don't estimate with order total)
        console.warn(`[Daily Sales] Could not get return items for ${ret.id}, skipping refund calculation`);
      }
    }
    
    // Calculate trend metrics (using Mountain Time dates for consistency)
    const yesterdayDate = new Date(date);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = getMountainDateString(yesterdayDate);
    const yesterdaySnapshot = await storage.getDailySalesSnapshot(yesterdayStr);
    
    const lastWeekDate = new Date(date);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const lastWeekStr = getMountainDateString(lastWeekDate);
    const lastWeekSnapshot = await storage.getDailySalesSnapshot(lastWeekStr);
    
    const lastMonthDate = new Date(date);
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastMonthStr = getMountainDateString(lastMonthDate);
    const lastMonthSnapshot = await storage.getDailySalesSnapshot(lastMonthStr);
    
    const lastYearDate = new Date(date);
    lastYearDate.setFullYear(lastYearDate.getFullYear() - 1);
    const lastYearStr = getMountainDateString(lastYearDate);
    const lastYearSnapshot = await storage.getDailySalesSnapshot(lastYearStr);
    
    // Calculate percentage changes
    const calcChange = (current: number, previous: number | null | undefined): number | null => {
      if (!previous || previous === 0) return null;
      return ((current - previous) / previous) * 100;
    };
    
    const dayOverDayChange = calcChange(totalRevenue, yesterdaySnapshot?.totalRevenue);
    const weekOverWeekChange = calcChange(totalRevenue, lastWeekSnapshot?.totalRevenue);
    const monthOverMonthChange = calcChange(totalRevenue, lastMonthSnapshot?.totalRevenue);
    const yearOverYearChange = calcChange(totalRevenue, lastYearSnapshot?.totalRevenue);
    
    // Calculate rolling averages (last 7 and 30 days, using Mountain Time dates)
    const sevenDaysAgo = new Date(date);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(date);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const last7Days = await storage.getDailySalesSnapshotsInRange(
      getMountainDateString(sevenDaysAgo),
      dateStr
    );
    const last30Days = await storage.getDailySalesSnapshotsInRange(
      getMountainDateString(thirtyDaysAgo),
      dateStr
    );
    
    const rolling7DayAvgRevenue = last7Days.length > 0
      ? last7Days.reduce((sum, s) => sum + (s.totalRevenue || 0), 0) / last7Days.length
      : null;
    const rolling30DayAvgRevenue = last30Days.length > 0
      ? last30Days.reduce((sum, s) => sum + (s.totalRevenue || 0), 0) / last30Days.length
      : null;
    
    // Upsert the snapshot
    const netRevenue = totalRevenue - totalRefunds;
    await storage.upsertDailySalesSnapshot({
      date: dateStr,
      totalRevenue,
      totalOrders,
      totalUnits,
      totalRefunds,
      netRevenue,
      channelBreakdown,
      dayOverDayChange,
      weekOverWeekChange,
      monthOverMonthChange,
      yearOverYearChange,
      rolling7DayAvgRevenue,
      rolling30DayAvgRevenue,
      source: 'SALES_ORDERS',
      lastSyncedAt: new Date(),
    });
    
    console.log(`[Daily Sales] Aggregated ${dateStr}: $${totalRevenue.toFixed(2)} revenue, ${totalOrders} orders, ${totalUnits} units`);
    
    return {
      success: true,
      date: dateStr,
      totalRevenue,
      totalOrders,
      totalUnits,
      totalRefunds,
    };
  } catch (error: any) {
    console.error(`[Daily Sales] Error aggregating ${dateStr}:`, error);
    return {
      success: false,
      date: dateStr,
      totalRevenue: 0,
      totalOrders: 0,
      totalUnits: 0,
      totalRefunds: 0,
      error: error.message,
    };
  }
}

/**
 * Run the nightly aggregation job
 */
async function runNightlyAggregation(): Promise<void> {
  console.log(`[Daily Sales] Running nightly aggregation`);
  
  // Aggregate today's sales
  const today = new Date();
  const result = await aggregateDailySales(today);
  
  if (result.success) {
    console.log(`[Daily Sales] Nightly aggregation completed: ${result.date}`);
  } else {
    console.error(`[Daily Sales] Nightly aggregation failed: ${result.error}`);
  }
  
  // Schedule the next run
  scheduleNextRun();
}

/**
 * Schedule the next nightly aggregation
 */
function scheduleNextRun(): void {
  // Schedule for 11:59 PM MT
  nextScheduledRun = getMountainTime(23, 59);
  const msUntil = msUntilTime(nextScheduledRun);
  
  console.log(`[Daily Sales] Next run scheduled: 11:59 PM MT at ${nextScheduledRun.toISOString()} (in ${Math.round(msUntil / 60000)} minutes)`);
  
  setTimeout(() => {
    runNightlyAggregation();
  }, msUntil);
}

/**
 * Initialize the scheduler
 */
export function initializeDailySalesScheduler(): void {
  if (schedulerInitialized) {
    console.log("[Daily Sales] Scheduler already initialized");
    return;
  }
  
  schedulerInitialized = true;
  console.log("[Daily Sales] Initializing scheduler for Mountain Time (America/Denver)");
  console.log("[Daily Sales] Schedule: Daily at 11:59 PM MT");
  
  // Schedule the first run
  scheduleNextRun();
  
  console.log("[Daily Sales] Scheduler initialized");
}

/**
 * Get next scheduled run time
 */
export function getNextScheduledRun(): Date | null {
  return nextScheduledRun;
}

/**
 * Manually trigger aggregation for a specific date
 */
export async function triggerAggregation(date?: Date): Promise<{
  success: boolean;
  date: string;
  totalRevenue: number;
  totalOrders: number;
  totalUnits: number;
  totalRefunds: number;
  error?: string;
}> {
  const targetDate = date || new Date();
  return await aggregateDailySales(targetDate);
}

/**
 * Backfill historical daily snapshots
 */
export async function backfillDailySales(daysBack: number = 30): Promise<{
  success: boolean;
  processed: number;
  errors: number;
}> {
  console.log(`[Daily Sales] Backfilling ${daysBack} days of sales data`);
  
  let processed = 0;
  let errors = 0;
  
  for (let i = daysBack; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    
    const result = await aggregateDailySales(date);
    if (result.success) {
      processed++;
    } else {
      errors++;
    }
    
    // Small delay to avoid overwhelming the database
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`[Daily Sales] Backfill completed: ${processed} processed, ${errors} errors`);
  
  return { success: errors === 0, processed, errors };
}
