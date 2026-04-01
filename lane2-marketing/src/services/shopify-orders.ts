/**
 * Shopify Orders Service
 *
 * Pulls MTD orders from Shopify, computes summary for the morning briefing.
 */

import { ShopifyClient } from '../clients/shopify';

export interface ShopifySnapshot {
  orderCount: number;
  grossSales: number;
  refundCount: number;
  cancelledCount: number;
  sourceBreakdown: Record<string, { orders: number; revenue: number }>;
  recentOrders: Array<{ name: string; total: number; source: string; status: string }>;
}

export async function pullShopifyMTD(
  shopDomain: string,
  accessToken: string,
): Promise<ShopifySnapshot> {
  const client = new ShopifyClient(shopDomain, accessToken);

  const now = new Date();
  const daysSinceMonthStart = now.getDate();
  const orders = await client.fetchRecentOrders(daysSinceMonthStart);

  // Filter to current month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const mtd = orders.filter(o => o.createdAt >= monthStart);

  // Refunds
  let refundCount = 0;
  try {
    refundCount = await client.fetchRefunds(daysSinceMonthStart);
  } catch {
    // Non-fatal
  }

  // Source breakdown
  const sourceBreakdown: Record<string, { orders: number; revenue: number }> = {};
  let cancelledCount = 0;

  for (const order of mtd) {
    const src = order.sourceName || 'unknown';
    if (!sourceBreakdown[src]) sourceBreakdown[src] = { orders: 0, revenue: 0 };
    sourceBreakdown[src].orders++;
    sourceBreakdown[src].revenue += order.totalPrice;
    if (order.financialStatus === 'voided') cancelledCount++;
  }

  return {
    orderCount: mtd.length,
    grossSales: mtd.reduce((sum, o) => sum + o.totalPrice, 0),
    refundCount,
    cancelledCount,
    sourceBreakdown,
    recentOrders: mtd.slice(-10).map(o => ({
      name: o.name,
      total: o.totalPrice,
      source: o.sourceName,
      status: o.financialStatus,
    })),
  };
}
