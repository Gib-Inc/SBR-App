/**
 * Report Context Builder Service
 * 
 * Extracts and aggregates report data from various sources for LLM context.
 * Used by the AI batch recommendation system to provide business context for decisions.
 */

import { storage } from "../storage";

export interface SalesReportPeriod {
  orders: number;
  revenue: number;
  units: number;
  refunds: number;
  netRevenue: number;
}

export interface SalesReport {
  today: SalesReportPeriod;
  week: SalesReportPeriod;
  month: SalesReportPeriod;
}

export interface POStatusCounts {
  [status: string]: number;
}

export interface PendingPO {
  poNumber: string;
  supplier: string;
  status: string;
  totalQty: number;
  expectedDate?: string;
}

export interface SkuPOBreakdown {
  sku: string;
  totalQtyPending: number;
  poCount: number;
  hasPendingPo: boolean;
}

export interface POReport {
  byStatus: POStatusCounts;
  totalInbound: number;
  pendingPOs: PendingPO[];
  totalPOs: number;
  skusWithNoPo: number;
}

export interface QuickBooksMonthData {
  month: number;
  monthName: string;
  totalQty: number;
  totalRevenue: number;
}

export interface QuickBooksReport {
  year: number;
  totalSkus: number;
  byMonth: QuickBooksMonthData[];
  yearTotals: {
    qty: number;
    revenue: number;
  };
}

export interface InventorySummary {
  totalComponents: number;
  totalFinishedProducts: number;
  lowStockCount: number;
  criticalStockCount: number;
  averageDaysOfCover: number;
}

export interface ReportContext {
  asOfDate: Date;
  sales: SalesReport;
  purchaseOrders: POReport;
  quickbooks: QuickBooksReport;
  inventory: InventorySummary;
}

/**
 * Build comprehensive report context for LLM decision-making
 * Aggregates data from sales snapshots, POs, QuickBooks history, and current inventory
 */
export async function buildReportContext(asOfDate: Date = new Date()): Promise<ReportContext> {
  const [salesReport, poReport, qbReport, inventorySummary] = await Promise.all([
    buildSalesReport(asOfDate),
    buildPOReport(),
    buildQuickBooksReport(asOfDate),
    buildInventorySummary(),
  ]);

  return {
    asOfDate,
    sales: salesReport,
    purchaseOrders: poReport,
    quickbooks: qbReport,
    inventory: inventorySummary,
  };
}

/**
 * Build sales report from daily_sales_snapshots
 * Aggregates today, last 7 days, and last 30 days
 */
async function buildSalesReport(asOfDate: Date): Promise<SalesReport> {
  const today = new Date(asOfDate);
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const weekAgoStr = weekAgo.toISOString().split('T')[0];
  
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 29);
  const monthAgoStr = monthAgo.toISOString().split('T')[0];
  
  const [todaySnapshot, weekSnapshots, monthSnapshots] = await Promise.all([
    storage.getDailySalesSnapshot(todayStr),
    storage.getDailySalesSnapshotsInRange(weekAgoStr, tomorrowStr),
    storage.getDailySalesSnapshotsInRange(monthAgoStr, tomorrowStr),
  ]);
  
  const aggregateSalesSnapshots = (snapshots: any[]): SalesReportPeriod => {
    if (!snapshots || snapshots.length === 0) {
      return { orders: 0, revenue: 0, units: 0, refunds: 0, netRevenue: 0 };
    }
    return {
      orders: snapshots.reduce((sum, s) => sum + (s?.totalOrders || 0), 0),
      revenue: snapshots.reduce((sum, s) => sum + parseFloat(s?.totalRevenue || '0'), 0),
      units: snapshots.reduce((sum, s) => sum + (s?.totalUnits || 0), 0),
      refunds: snapshots.reduce((sum, s) => sum + parseFloat(s?.totalRefunds || '0'), 0),
      netRevenue: snapshots.reduce((sum, s) => sum + parseFloat(s?.netRevenue || '0'), 0),
    };
  };
  
  return {
    today: todaySnapshot ? {
      orders: todaySnapshot.totalOrders || 0,
      revenue: parseFloat(todaySnapshot.totalRevenue as any) || 0,
      units: todaySnapshot.totalUnits || 0,
      refunds: parseFloat(todaySnapshot.totalRefunds as any) || 0,
      netRevenue: parseFloat(todaySnapshot.netRevenue as any) || 0,
    } : { orders: 0, revenue: 0, units: 0, refunds: 0, netRevenue: 0 },
    week: aggregateSalesSnapshots(weekSnapshots || []),
    month: aggregateSalesSnapshots(monthSnapshots || []),
  };
}

/**
 * Build PO report with status breakdown and inbound quantities
 */
async function buildPOReport(): Promise<POReport> {
  const purchaseOrders = await storage.getAllPurchaseOrders();
  const poStatusCounts: POStatusCounts = {};
  let totalInbound = 0;
  const pendingPOs: PendingPO[] = [];
  
  const inboundStatuses = ['SENT', 'APPROVED', 'PARTIAL_RECEIVED', 'CONFIRMED', 'ACCEPTED', 'PARTIAL'];
  const inboundPOs = purchaseOrders.filter(po => 
    !po.isHistorical && inboundStatuses.includes(po.status || '')
  );
  
  for (const po of purchaseOrders) {
    if (po.isHistorical) continue;
    const status = po.status || 'UNKNOWN';
    poStatusCounts[status] = (poStatusCounts[status] || 0) + 1;
  }
  
  const supplierIds = Array.from(new Set(inboundPOs.map(po => po.supplierId).filter(Boolean))) as string[];
  const allSuppliers = await Promise.all(supplierIds.map(id => storage.getSupplier(id)));
  const poLinesArrays = await Promise.all(inboundPOs.map(po => storage.getPurchaseOrderLinesByPOId(po.id)));
  
  const supplierMap = new Map(allSuppliers.filter(Boolean).map(s => [s!.id, s!.name]));
  let skusWithNoPo = 0;
  
  inboundPOs.forEach((po, index) => {
    const poLines = poLinesArrays[index] || [];
    const lineTotal = poLines.reduce((sum: number, line) => {
      const ordered = line.qtyOrdered || 0;
      const received = line.qtyReceived || 0;
      return sum + (ordered - received);
    }, 0);
    totalInbound += lineTotal;
    
    if (lineTotal > 0) {
      pendingPOs.push({
        poNumber: po.poNumber || po.id,
        supplier: po.supplierId ? (supplierMap.get(po.supplierId) || 'Unknown') : 'Unknown',
        status: po.status || 'UNKNOWN',
        totalQty: lineTotal,
        expectedDate: po.expectedDate?.toString(),
      });
    }
  });
  
  return {
    byStatus: poStatusCounts,
    totalInbound,
    pendingPOs: pendingPOs.slice(0, 10),
    totalPOs: purchaseOrders.filter(po => !po.isHistorical).length,
    skusWithNoPo,
  };
}

/**
 * Build QuickBooks historical sales report (last full year)
 */
async function buildQuickBooksReport(asOfDate: Date): Promise<QuickBooksReport> {
  const lastYear = asOfDate.getFullYear() - 1;
  
  const qbHistory = await storage.getQuickbooksDemandHistory({
    year: lastYear,
    page: 1,
    pageSize: 1000,
  });
  
  const monthlyTotals: Record<number, { qty: number; revenue: number }> = {};
  for (let m = 1; m <= 12; m++) {
    monthlyTotals[m] = { qty: 0, revenue: 0 };
  }
  
  for (const item of qbHistory.items || []) {
    const month = item.month;
    if (monthlyTotals[month]) {
      monthlyTotals[month].qty += item.totalQty || 0;
      monthlyTotals[month].revenue += item.totalRevenue || 0;
    }
  }
  
  return {
    year: lastYear,
    totalSkus: qbHistory.total || 0,
    byMonth: Object.entries(monthlyTotals).map(([month, data]) => ({
      month: parseInt(month),
      monthName: new Date(2024, parseInt(month) - 1, 1).toLocaleString('default', { month: 'short' }),
      totalQty: data.qty,
      totalRevenue: Math.round(data.revenue * 100) / 100,
    })),
    yearTotals: {
      qty: Object.values(monthlyTotals).reduce((sum, m) => sum + m.qty, 0),
      revenue: Math.round(Object.values(monthlyTotals).reduce((sum, m) => sum + m.revenue, 0) * 100) / 100,
    },
  };
}

/**
 * Build current inventory summary
 */
async function buildInventorySummary(): Promise<InventorySummary> {
  const items = await storage.getAllItems();
  const components = items.filter(i => i.type === 'component');
  const finishedProducts = items.filter(i => i.type === 'finished_product');
  
  let lowStockCount = 0;
  let criticalStockCount = 0;
  let totalDaysOfCover = 0;
  let itemsWithVelocity = 0;
  
  for (const item of items) {
    const stock = item.type === 'finished_product' 
      ? (item.availableForSaleQty ?? item.pivotQty ?? 0)
      : item.currentStock;
    const velocity = item.dailyUsage || 0;
    
    if (velocity > 0) {
      const daysOfCover = stock / velocity;
      totalDaysOfCover += daysOfCover;
      itemsWithVelocity++;
      
      if (daysOfCover < 7) criticalStockCount++;
      else if (daysOfCover < 14) lowStockCount++;
    }
    
    if (stock <= item.minStock && item.minStock > 0) {
      lowStockCount++;
    }
  }
  
  return {
    totalComponents: components.length,
    totalFinishedProducts: finishedProducts.length,
    lowStockCount,
    criticalStockCount,
    averageDaysOfCover: itemsWithVelocity > 0 
      ? Math.round(totalDaysOfCover / itemsWithVelocity) 
      : 0,
  };
}

/**
 * Format report context as a concise string for LLM prompt
 */
export function formatReportContextForPrompt(context: ReportContext): string {
  const { sales, purchaseOrders, quickbooks, inventory } = context;
  const dateStr = context.asOfDate.toISOString().split('T')[0];
  
  return `
=== BUSINESS CONTEXT (as of ${dateStr}) ===

SALES PERFORMANCE:
- Today: ${sales.today.orders} orders, $${sales.today.netRevenue.toFixed(2)} net revenue, ${sales.today.units} units
- Last 7 days: ${sales.week.orders} orders, $${sales.week.netRevenue.toFixed(2)} net revenue, ${sales.week.units} units
- Last 30 days: ${sales.month.orders} orders, $${sales.month.netRevenue.toFixed(2)} net revenue, ${sales.month.units} units

PURCHASE ORDERS:
- Total active POs: ${purchaseOrders.totalPOs}
- Status breakdown: ${Object.entries(purchaseOrders.byStatus).map(([s, c]) => `${s}: ${c}`).join(', ') || 'None'}
- Inbound inventory: ${purchaseOrders.totalInbound} units pending receipt
${purchaseOrders.pendingPOs.length > 0 ? `- Top pending POs: ${purchaseOrders.pendingPOs.slice(0, 5).map(p => `${p.poNumber} (${p.totalQty} units from ${p.supplier})`).join('; ')}` : '- No pending POs'}

HISTORICAL DEMAND (${quickbooks.year}):
- Total units sold: ${quickbooks.yearTotals.qty.toLocaleString()}
- Total revenue: $${quickbooks.yearTotals.revenue.toLocaleString()}
- Monthly trend: ${quickbooks.byMonth.filter(m => m.totalQty > 0).map(m => `${m.monthName}: ${m.totalQty}`).join(', ') || 'No data'}

INVENTORY STATUS:
- Components tracked: ${inventory.totalComponents}
- Finished products: ${inventory.totalFinishedProducts}
- Critical stock (<7 days): ${inventory.criticalStockCount} items
- Low stock (<14 days): ${inventory.lowStockCount} items
- Avg days of cover: ${inventory.averageDaysOfCover} days
`;
}
