import { storage } from "./storage";
import type { InsertProductForecastContext } from "@shared/schema";
import { eq, and, sql as drizzleSql, gte } from "drizzle-orm";
import * as schema from "@shared/schema";

/**
 * Comprehensive Product Forecast Context Aggregation Service
 * 
 * This service calculates all signals needed for AI forecasting by combining:
 * - Inventory levels (Pivot, Hildale)
 * - Inbound units from open POs
 * - Sales velocity (7d, 30d) across all channels and per channel
 * - Ad performance (spend, conversions, ROAS) per platform
 * - Days of stock calculations
 */

/**
 * Calculates the comprehensive forecast context for a single finished product.
 * This aggregates data from:
 * - items table (inventory levels)
 * - purchase_orders and purchase_order_lines (inbound units)
 * - sales_snapshots (sales velocity by channel)
 * - ad_performance_snapshots (ad metrics by platform)
 */
export async function calculateProductForecastContext(productId: string): Promise<InsertProductForecastContext> {
  // Get the product
  const product = await storage.getItem(productId);
  if (!product || product.type !== 'finished_product') {
    throw new Error(`Product ${productId} not found or is not a finished product`);
  }

  // Get channel references
  const shopifyChannel = await storage.getChannelByCode('shopify');
  const amazonChannel = await storage.getChannelByCode('amazon');
  const googleAdsChannel = await storage.getChannelByCode('google_ads');
  const metaAdsChannel = await storage.getChannelByCode('meta_ads');
  const tiktokAdsChannel = await storage.getChannelByCode('tiktok_ads');

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  // 1. Inventory Levels
  const onHandPivot = product.pivotQty || 0;
  const onHandHildale = product.hildaleQty || 0;
  const onHandTotal = onHandPivot + onHandHildale;

  // 2. Inbound Units (sum of open PO lines for this product)
  const inboundUnits = await calculateInboundUnits(productId);

  // 3. Sales Velocity - All Channels Combined
  const allSales7d = await storage.getSalesSnapshotsByProduct(productId, sevenDaysAgo, now);
  const allSales30d = await storage.getSalesSnapshotsByProduct(productId, thirtyDaysAgo, now);
  
  const unitsSold7d = allSales7d.reduce((sum, s) => sum + s.unitsSold, 0);
  const unitsSold30d = allSales30d.reduce((sum, s) => sum + s.unitsSold, 0);
  const revenue7d = allSales7d.reduce((sum, s) => sum + s.revenue, 0);
  const revenue30d = allSales30d.reduce((sum, s) => sum + s.revenue, 0);

  // 4. Sales by Channel - Shopify
  let shopifyUnitsSold7d = 0, shopifyUnitsSold30d = 0;
  let shopifyRevenue7d = 0, shopifyRevenue30d = 0;
  
  if (shopifyChannel) {
    const shopifySales7d = allSales7d.filter(s => s.channelId === shopifyChannel.id);
    const shopifySales30d = allSales30d.filter(s => s.channelId === shopifyChannel.id);
    shopifyUnitsSold7d = shopifySales7d.reduce((sum, s) => sum + s.unitsSold, 0);
    shopifyUnitsSold30d = shopifySales30d.reduce((sum, s) => sum + s.unitsSold, 0);
    shopifyRevenue7d = shopifySales7d.reduce((sum, s) => sum + s.revenue, 0);
    shopifyRevenue30d = shopifySales30d.reduce((sum, s) => sum + s.revenue, 0);
  }

  // 5. Sales by Channel - Amazon
  let amazonUnitsSold7d = 0, amazonUnitsSold30d = 0;
  let amazonRevenue7d = 0, amazonRevenue30d = 0;
  
  if (amazonChannel) {
    const amazonSales7d = allSales7d.filter(s => s.channelId === amazonChannel.id);
    const amazonSales30d = allSales30d.filter(s => s.channelId === amazonChannel.id);
    amazonUnitsSold7d = amazonSales7d.reduce((sum, s) => sum + s.unitsSold, 0);
    amazonUnitsSold30d = amazonSales30d.reduce((sum, s) => sum + s.unitsSold, 0);
    amazonRevenue7d = amazonSales7d.reduce((sum, s) => sum + s.revenue, 0);
    amazonRevenue30d = amazonSales30d.reduce((sum, s) => sum + s.revenue, 0);
  }

  // 6. Ad Performance - Google Ads
  let googleAdSpend7d = 0, googleAdSpend30d = 0;
  let googleConversions7d = 0, googleRoas7d = 0;
  
  if (googleAdsChannel) {
    const googleAds7d = await storage.getAdPerformanceSnapshotsByProduct(productId, sevenDaysAgo, now);
    const googleAds30d = await storage.getAdPerformanceSnapshotsByProduct(productId, thirtyDaysAgo, now);
    
    const googleAds7dFiltered = googleAds7d.filter(a => a.channelId === googleAdsChannel.id);
    const googleAds30dFiltered = googleAds30d.filter(a => a.channelId === googleAdsChannel.id);
    
    googleAdSpend7d = googleAds7dFiltered.reduce((sum, a) => sum + a.spend, 0);
    googleAdSpend30d = googleAds30dFiltered.reduce((sum, a) => sum + a.spend, 0);
    googleConversions7d = googleAds7dFiltered.reduce((sum, a) => sum + a.conversions, 0);
    
    const googleRevenue7d = googleAds7dFiltered.reduce((sum, a) => sum + a.revenue, 0);
    googleRoas7d = googleAdSpend7d > 0 ? googleRevenue7d / googleAdSpend7d : 0;
  }

  // 7. Ad Performance - Meta Ads
  let metaAdSpend7d = 0, metaAdSpend30d = 0;
  let metaConversions7d = 0, metaRoas7d = 0;
  
  if (metaAdsChannel) {
    const metaAds7d = await storage.getAdPerformanceSnapshotsByProduct(productId, sevenDaysAgo, now);
    const metaAds30d = await storage.getAdPerformanceSnapshotsByProduct(productId, thirtyDaysAgo, now);
    
    const metaAds7dFiltered = metaAds7d.filter(a => a.channelId === metaAdsChannel.id);
    const metaAds30dFiltered = metaAds30d.filter(a => a.channelId === metaAdsChannel.id);
    
    metaAdSpend7d = metaAds7dFiltered.reduce((sum, a) => sum + a.spend, 0);
    metaAdSpend30d = metaAds30dFiltered.reduce((sum, a) => sum + a.spend, 0);
    metaConversions7d = metaAds7dFiltered.reduce((sum, a) => sum + a.conversions, 0);
    
    const metaRevenue7d = metaAds7dFiltered.reduce((sum, a) => sum + a.revenue, 0);
    metaRoas7d = metaAdSpend7d > 0 ? metaRevenue7d / metaAdSpend7d : 0;
  }

  // 8. Ad Performance - TikTok Ads
  let tiktokAdSpend7d = 0, tiktokAdSpend30d = 0;
  let tiktokConversions7d = 0, tiktokRoas7d = 0;
  
  if (tiktokAdsChannel) {
    const tiktokAds7d = await storage.getAdPerformanceSnapshotsByProduct(productId, sevenDaysAgo, now);
    const tiktokAds30d = await storage.getAdPerformanceSnapshotsByProduct(productId, thirtyDaysAgo, now);
    
    const tiktokAds7dFiltered = tiktokAds7d.filter(a => a.channelId === tiktokAdsChannel.id);
    const tiktokAds30dFiltered = tiktokAds30d.filter(a => a.channelId === tiktokAdsChannel.id);
    
    tiktokAdSpend7d = tiktokAds7dFiltered.reduce((sum, a) => sum + a.spend, 0);
    tiktokAdSpend30d = tiktokAds30dFiltered.reduce((sum, a) => sum + a.spend, 0);
    tiktokConversions7d = tiktokAds7dFiltered.reduce((sum, a) => sum + a.conversions, 0);
    
    const tiktokRevenue7d = tiktokAds7dFiltered.reduce((sum, a) => sum + a.revenue, 0);
    tiktokRoas7d = tiktokAdSpend7d > 0 ? tiktokRevenue7d / tiktokAdSpend7d : 0;
  }

  // 9. Stock Calculations
  const averageDailySales = unitsSold7d / 7; // Use 7-day window for more recent trend
  const daysOfStockLeft = averageDailySales > 0 
    ? (onHandTotal + inboundUnits) / averageDailySales 
    : null;

  // Return the complete context
  const context: InsertProductForecastContext = {
    productId,
    onHandPivot,
    onHandHildale,
    onHandTotal,
    inboundUnits,
    unitsSold7d,
    unitsSold30d,
    revenue7d,
    revenue30d,
    shopifyUnitsSold7d,
    shopifyUnitsSold30d,
    shopifyRevenue7d,
    shopifyRevenue30d,
    amazonUnitsSold7d,
    amazonUnitsSold30d,
    amazonRevenue7d,
    amazonRevenue30d,
    googleAdSpend7d,
    googleAdSpend30d,
    googleConversions7d,
    googleRoas7d,
    metaAdSpend7d,
    metaAdSpend30d,
    metaConversions7d,
    metaRoas7d,
    tiktokAdSpend7d,
    tiktokAdSpend30d,
    tiktokConversions7d,
    tiktokRoas7d,
    daysOfStockLeft,
    averageDailySales,
  };

  return context;
}

/**
 * Calculates inbound units from open purchase orders for a product.
 * Sums up quantities from PO lines where the PO is in states:
 * - APPROVED
 * - SENT
 * - PARTIAL_RECEIVED
 */
async function calculateInboundUnits(productId: string): Promise<number> {
  const allPOLines = await storage.getAllPurchaseOrderLines();
  const productPOLines = allPOLines.filter(line => line.itemId === productId);
  
  let inboundUnits = 0;
  
  for (const line of productPOLines) {
    const po = await storage.getPurchaseOrder(line.purchaseOrderId);
    
    if (po && ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'].includes(po.status)) {
      const quantityOrdered = line.quantity || 0;
      const quantityReceived = line.receivedQuantity || 0;
      const remaining = quantityOrdered - quantityReceived;
      
      if (remaining > 0) {
        inboundUnits += remaining;
      }
    }
  }
  
  return inboundUnits;
}

/**
 * Refreshes the forecast context for a single product.
 */
export async function refreshProductForecastContext(productId: string): Promise<void> {
  console.log(`[Forecast Context] Refreshing context for product ${productId}`);
  
  const context = await calculateProductForecastContext(productId);
  await storage.upsertProductForecastContext(context);
  
  console.log(`[Forecast Context] Context refreshed for product ${productId}`);
}

/**
 * Refreshes the forecast context for all finished products.
 * This should be called after:
 * - Ad performance data is refreshed
 * - Sales data is refreshed
 * - Inventory transactions occur
 * - POs are updated
 */
export async function refreshAllProductForecastContexts(): Promise<void> {
  console.log(`[Forecast Context] Refreshing contexts for all finished products`);
  
  const products = await storage.getAllItems();
  const finishedProducts = products.filter(p => p.type === 'finished_product');
  
  for (const product of finishedProducts) {
    try {
      await refreshProductForecastContext(product.id);
    } catch (error) {
      console.error(`[Forecast Context] Error refreshing context for product ${product.id}:`, error);
    }
  }
  
  console.log(`[Forecast Context] All forecast contexts refreshed`);
}

/**
 * Gets the forecast context for all products, formatted for AI consumption.
 * Returns a simplified array of objects with all metrics.
 */
export async function getProductForecastContextsForAI(): Promise<Array<{
  productId: string;
  productName: string;
  productSku: string;
  onHandPivot: number;
  onHandHildale: number;
  onHandTotal: number;
  inboundUnits: number;
  unitsSold7d: number;
  unitsSold30d: number;
  revenue7d: number;
  revenue30d: number;
  shopifyUnitsSold7d: number;
  amazonUnitsSold7d: number;
  googleAdSpend7d: number;
  metaAdSpend7d: number;
  tiktokAdSpend7d: number;
  googleRoas7d: number;
  metaRoas7d: number;
  tiktokRoas7d: number;
  daysOfStockLeft: number | null;
  averageDailySales: number;
}>> {
  const contexts = await storage.getAllProductForecastContexts();
  const products = await storage.getAllItems();
  
  const result = [];
  
  for (const context of contexts) {
    const product = products.find(p => p.id === context.productId);
    if (!product) continue;
    
    result.push({
      productId: context.productId,
      productName: product.name,
      productSku: product.sku,
      onHandPivot: context.onHandPivot,
      onHandHildale: context.onHandHildale,
      onHandTotal: context.onHandTotal,
      inboundUnits: context.inboundUnits,
      unitsSold7d: context.unitsSold7d,
      unitsSold30d: context.unitsSold30d,
      revenue7d: context.revenue7d,
      revenue30d: context.revenue30d,
      shopifyUnitsSold7d: context.shopifyUnitsSold7d,
      amazonUnitsSold7d: context.amazonUnitsSold7d,
      googleAdSpend7d: context.googleAdSpend7d,
      metaAdSpend7d: context.metaAdSpend7d,
      tiktokAdSpend7d: context.tiktokAdSpend7d,
      googleRoas7d: context.googleRoas7d,
      metaRoas7d: context.metaRoas7d,
      tiktokRoas7d: context.tiktokRoas7d,
      daysOfStockLeft: context.daysOfStockLeft,
      averageDailySales: context.averageDailySales,
    });
  }
  
  return result;
}
