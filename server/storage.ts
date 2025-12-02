import {
  type User,
  type InsertUser,
  type Item,
  type InsertItem,
  type Bin,
  type InsertBin,
  type InventoryByBin,
  type InsertInventoryByBin,
  type BillOfMaterials,
  type InsertBillOfMaterials,
  type Supplier,
  type InsertSupplier,
  type SupplierItem,
  type InsertSupplierItem,
  type PurchaseOrder,
  type InsertPurchaseOrder,
  type PurchaseOrderLine,
  type InsertPurchaseOrderLine,
  type PurchaseOrderReceipt,
  type InsertPurchaseOrderReceipt,
  type PurchaseOrderReceiptLine,
  type InsertPurchaseOrderReceiptLine,
  type SupplierLead,
  type InsertSupplierLead,
  type SalesHistory,
  type InsertSalesHistory,
  type FinishedInventorySnapshot,
  type InsertFinishedInventorySnapshot,
  type IntegrationHealth,
  type InsertIntegrationHealth,
  type Settings,
  type InsertSettings,
  type IntegrationConfig,
  type InsertIntegrationConfig,
  type Barcode,
  type InsertBarcode,
  type BarcodeSettings,
  type InsertBarcodeSettings,
  type ImportProfile,
  type InsertImportProfile,
  type ImportJob,
  type InsertImportJob,
  type InventoryTransaction,
  type InsertInventoryTransaction,
  type AIRecommendation,
  type InsertAIRecommendation,
  type ReturnRequest,
  type InsertReturnRequest,
  type ReturnItem,
  type InsertReturnItem,
  type ReturnShipment,
  type InsertReturnShipment,
  type ReturnEvent,
  type InsertReturnEvent,
  type Channel,
  type InsertChannel,
  type ProductChannelMapping,
  type InsertProductChannelMapping,
  type AdPerformanceSnapshot,
  type InsertAdPerformanceSnapshot,
  type SalesSnapshot,
  type InsertSalesSnapshot,
  type ProductForecastContext,
  type InsertProductForecastContext,
  type SalesOrder,
  type InsertSalesOrder,
  type SalesOrderLine,
  type InsertSalesOrderLine,
  type BackorderSnapshot,
  type InsertBackorderSnapshot,
  type AuditLog,
  type InsertAuditLog,
  type QuickbooksAuth,
  type InsertQuickbooksAuth,
  type QuickbooksSalesSnapshot,
  type InsertQuickbooksSalesSnapshot,
  type QuickbooksVendorMapping,
  type InsertQuickbooksVendorMapping,
  type QuickbooksItemMapping,
  type InsertQuickbooksItemMapping,
  type QuickbooksBill,
  type InsertQuickbooksBill,
  type AdPlatformConfig,
  type InsertAdPlatformConfig,
  type AdSkuMapping,
  type InsertAdSkuMapping,
  type AdMetricsDaily,
  type InsertAdMetricsDaily,
  type AiSystemRecommendation,
  type InsertAiSystemRecommendation,
  type LabelFormat,
  type InsertLabelFormat,
  type SystemLog,
  type InsertSystemLog,
  type ShippoLabelLog,
  type InsertShippoLabelLog,
  type AiAgentSettings,
  type InsertAiAgentSettings,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, count, isNull, gt, gte, lte, desc, or, ilike, sql as drizzleSql } from "drizzle-orm";
import * as schema from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;

  // Items
  getAllItems(): Promise<Item[]>;
  getItemsWithBOMCounts(): Promise<Array<Item & { componentsCount?: number; forecastQty?: number; totalOwned?: number }>>;
  getItem(id: string): Promise<Item | undefined>;
  getItemBySku(sku: string): Promise<Item | undefined>;
  createItem(item: InsertItem): Promise<Item>;
  updateItem(id: string, item: Partial<InsertItem>): Promise<Item | undefined>;
  deleteItem(id: string): Promise<boolean>;
  // Channel SKU lookups (for integration mapping)
  findProductByShopifySku(shopifySku: string): Promise<Item | undefined>;
  findProductByAmazonSku(amazonSku: string): Promise<Item | undefined>;
  findProductByExtensivSku(extensivSku: string): Promise<Item | undefined>;

  // Bins
  getAllBins(): Promise<Bin[]>;
  getBin(id: string): Promise<Bin | undefined>;
  createBin(bin: InsertBin): Promise<Bin>;
  updateBin(id: string, bin: Partial<InsertBin>): Promise<Bin | undefined>;
  deleteBin(id: string): Promise<boolean>;

  // Inventory By Bin
  getAllInventoryByBin(): Promise<InventoryByBin[]>;
  getInventoryByBin(id: string): Promise<InventoryByBin | undefined>;
  getInventoryByItemId(itemId: string): Promise<InventoryByBin[]>;
  createInventoryByBin(inventory: InsertInventoryByBin): Promise<InventoryByBin>;
  updateInventoryByBin(id: string, inventory: Partial<InsertInventoryByBin>): Promise<InventoryByBin | undefined>;
  deleteInventoryByBin(id: string): Promise<boolean>;

  // Bill of Materials
  getAllBillOfMaterials(): Promise<BillOfMaterials[]>;
  getBillOfMaterialsByProductId(finishedProductId: string): Promise<BillOfMaterials[]>;
  createBillOfMaterials(bom: InsertBillOfMaterials): Promise<BillOfMaterials>;
  deleteBillOfMaterials(id: string): Promise<boolean>;

  // Suppliers
  getAllSuppliers(): Promise<Supplier[]>;
  getSupplier(id: string): Promise<Supplier | undefined>;
  createSupplier(supplier: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: string, supplier: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  deleteSupplier(id: string): Promise<boolean>;

  // Supplier Items
  getAllSupplierItems(): Promise<SupplierItem[]>;
  getSupplierItemsByItemId(itemId: string): Promise<SupplierItem[]>;
  createSupplierItem(supplierItem: InsertSupplierItem): Promise<SupplierItem>;
  updateSupplierItem(id: string, supplierItem: Partial<InsertSupplierItem>): Promise<SupplierItem | undefined>;
  deleteSupplierItem(id: string): Promise<boolean>;

  // Sales History
  getAllSalesHistory(): Promise<SalesHistory[]>;
  getSalesHistoryByItemId(itemId: string): Promise<SalesHistory[]>;
  createSalesHistory(sale: InsertSalesHistory): Promise<SalesHistory>;

  // Finished Inventory Snapshot
  getAllFinishedInventorySnapshots(): Promise<FinishedInventorySnapshot[]>;
  createFinishedInventorySnapshot(snapshot: InsertFinishedInventorySnapshot): Promise<FinishedInventorySnapshot>;

  // Integration Health
  getAllIntegrationHealth(): Promise<IntegrationHealth[]>;
  getIntegrationHealth(integrationName: string): Promise<IntegrationHealth | undefined>;
  createOrUpdateIntegrationHealth(health: InsertIntegrationHealth): Promise<IntegrationHealth>;

  // Settings
  getSettings(userId: string): Promise<Settings | undefined>;
  createOrUpdateSettings(settings: InsertSettings): Promise<Settings>;
  updateSettings(userId: string, updates: Partial<Omit<InsertSettings, 'userId'>>): Promise<Settings | undefined>;

  // Integration Configs
  getAllIntegrationConfigs(userId: string): Promise<IntegrationConfig[]>;
  getIntegrationConfig(userId: string, provider: string): Promise<IntegrationConfig | undefined>;
  getIntegrationConfigById(id: string): Promise<IntegrationConfig | undefined>;
  createIntegrationConfig(config: InsertIntegrationConfig): Promise<IntegrationConfig>;
  updateIntegrationConfig(id: string, config: Partial<InsertIntegrationConfig>): Promise<IntegrationConfig | undefined>;
  deleteIntegrationConfig(id: string): Promise<boolean>;

  // Barcodes
  getAllBarcodes(): Promise<Barcode[]>;
  getBarcode(id: string): Promise<Barcode | undefined>;
  getBarcodeByValue(value: string): Promise<Barcode | undefined>;
  createBarcode(barcode: InsertBarcode): Promise<Barcode>;
  updateBarcode(id: string, barcode: Partial<InsertBarcode>): Promise<Barcode | undefined>;
  deleteBarcode(id: string): Promise<boolean>;

  // Barcode Settings
  getBarcodeSettings(): Promise<BarcodeSettings | undefined>;
  createOrUpdateBarcodeSettings(settings: Partial<InsertBarcodeSettings>): Promise<BarcodeSettings>;
  incrementItemRef(): Promise<number>;
  incrementInternalCode(): Promise<number>;

  // Import Profiles
  getAllImportProfiles(): Promise<ImportProfile[]>;
  getImportProfile(id: string): Promise<ImportProfile | undefined>;
  createImportProfile(profile: InsertImportProfile): Promise<ImportProfile>;
  updateImportProfile(id: string, profile: Partial<InsertImportProfile>): Promise<ImportProfile | undefined>;
  deleteImportProfile(id: string): Promise<boolean>;

  // Import Jobs
  getAllImportJobs(): Promise<ImportJob[]>;
  getImportJob(id: string): Promise<ImportJob | undefined>;
  createImportJob(job: InsertImportJob): Promise<ImportJob>;
  updateImportJob(id: string, job: Partial<InsertImportJob>): Promise<ImportJob | undefined>;
  deleteImportJob(id: string): Promise<boolean>;

  // Inventory Transactions
  getAllInventoryTransactions(): Promise<InventoryTransaction[]>;
  getInventoryTransactionsByItem(itemId: string): Promise<InventoryTransaction[]>;
  createInventoryTransaction(transaction: InsertInventoryTransaction): Promise<InventoryTransaction>;

  // AI Recommendations
  getAllAIRecommendations(): Promise<AIRecommendation[]>;
  getAIRecommendation(id: string): Promise<AIRecommendation | undefined>;
  getAIRecommendationsByItem(itemId: string): Promise<AIRecommendation[]>;
  getAIRecommendationsByStatus(status: string): Promise<AIRecommendation[]>;
  getActiveAIRecommendations(): Promise<AIRecommendation[]>; // Get NEW/ACCEPTED only
  upsertAIRecommendation(recommendation: InsertAIRecommendation): Promise<AIRecommendation>;
  updateAIRecommendationStatus(id: string, status: string): Promise<AIRecommendation | undefined>;
  clearStaleRecommendations(itemId: string): Promise<void>; // Clear old NEW recommendations for an item
  createAIRecommendation(recommendation: InsertAIRecommendation): Promise<AIRecommendation>;
  updateAIRecommendation(id: string, recommendation: Partial<InsertAIRecommendation>): Promise<AIRecommendation | undefined>;

  // Purchase Orders
  getAllPurchaseOrders(): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined>;
  getPurchaseOrdersBySupplierId(supplierId: string): Promise<PurchaseOrder[]>;
  createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: string, po: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined>;
  deletePurchaseOrder(id: string): Promise<boolean>;

  // Purchase Order Lines
  getAllPurchaseOrderLines(): Promise<PurchaseOrderLine[]>;
  getPurchaseOrderLinesByPOId(purchaseOrderId: string): Promise<PurchaseOrderLine[]>;
  getPurchaseOrderLine(id: string): Promise<PurchaseOrderLine | undefined>;
  createPurchaseOrderLine(line: InsertPurchaseOrderLine): Promise<PurchaseOrderLine>;
  updatePurchaseOrderLine(id: string, line: Partial<InsertPurchaseOrderLine>): Promise<PurchaseOrderLine | undefined>;
  deletePurchaseOrderLine(id: string): Promise<boolean>;
  deletePurchaseOrderLinesByPOId(purchaseOrderId: string): Promise<boolean>;

  // Purchase Order Receipts
  getAllPurchaseOrderReceipts(): Promise<PurchaseOrderReceipt[]>;
  getPurchaseOrderReceiptsByPOId(purchaseOrderId: string): Promise<PurchaseOrderReceipt[]>;
  getPurchaseOrderReceipt(id: string): Promise<PurchaseOrderReceipt | undefined>;
  createPurchaseOrderReceipt(receipt: InsertPurchaseOrderReceipt): Promise<PurchaseOrderReceipt>;
  updatePurchaseOrderReceipt(id: string, receipt: Partial<InsertPurchaseOrderReceipt>): Promise<PurchaseOrderReceipt | undefined>;
  deletePurchaseOrderReceipt(id: string): Promise<boolean>;

  // Purchase Order Receipt Lines
  getPurchaseOrderReceiptLinesByReceiptId(receiptId: string): Promise<PurchaseOrderReceiptLine[]>;
  getPurchaseOrderReceiptLinesByPOLineId(purchaseOrderLineId: string): Promise<PurchaseOrderReceiptLine[]>;
  createPurchaseOrderReceiptLine(line: InsertPurchaseOrderReceiptLine): Promise<PurchaseOrderReceiptLine>;
  updatePurchaseOrderReceiptLine(id: string, line: Partial<InsertPurchaseOrderReceiptLine>): Promise<PurchaseOrderReceiptLine | undefined>;
  deletePurchaseOrderReceiptLine(id: string): Promise<boolean>;

  // PO Helper Methods
  getNextPONumber(): Promise<string>;
  recalculatePOTotals(purchaseOrderId: string): Promise<PurchaseOrder | undefined>;
  updatePOLineReceivedQty(purchaseOrderLineId: string): Promise<PurchaseOrderLine | undefined>;

  // Supplier Leads
  getAllSupplierLeads(): Promise<SupplierLead[]>;
  getSupplierLead(id: string): Promise<SupplierLead | undefined>;
  getSupplierLeadsByStatus(status: string): Promise<SupplierLead[]>;
  getSupplierLeadsByPhantomRunId(phantomRunId: string): Promise<SupplierLead[]>;
  createSupplierLead(lead: InsertSupplierLead): Promise<SupplierLead>;
  upsertSupplierLead(lead: InsertSupplierLead): Promise<SupplierLead>;
  updateSupplierLead(id: string, lead: Partial<InsertSupplierLead>): Promise<SupplierLead | undefined>;
  deleteSupplierLead(id: string): Promise<boolean>;

  // Return Requests
  getAllReturnRequests(): Promise<ReturnRequest[]>;
  getReturnRequest(id: string): Promise<ReturnRequest | undefined>;
  getReturnRequestsBySalesOrderId(salesOrderId: string): Promise<ReturnRequest[]>;
  createReturnRequest(request: InsertReturnRequest): Promise<ReturnRequest>;
  updateReturnRequest(id: string, request: Partial<InsertReturnRequest>): Promise<ReturnRequest | undefined>;
  receiveReturn(returnId: string, itemUpdates: { itemId: string; qtyReceived: number }[]): Promise<ReturnRequest>;

  // Return Items
  getReturnItemsByRequestId(returnRequestId: string): Promise<ReturnItem[]>;
  createReturnItem(item: InsertReturnItem): Promise<ReturnItem>;
  updateReturnItem(id: string, item: Partial<InsertReturnItem>): Promise<ReturnItem | undefined>;

  // Return Shipments
  getReturnShipmentsByRequestId(returnRequestId: string): Promise<ReturnShipment[]>;
  createReturnShipment(shipment: InsertReturnShipment): Promise<ReturnShipment>;
  updateReturnShipment(id: string, shipment: Partial<InsertReturnShipment>): Promise<ReturnShipment | undefined>;

  // Return Events
  getReturnEventsByRequestId(returnRequestId: string): Promise<ReturnEvent[]>;
  createReturnEvent(event: InsertReturnEvent): Promise<ReturnEvent>;

  // Shippo Label Logs
  getAllShippoLabelLogs(): Promise<ShippoLabelLog[]>;
  getShippoLabelLog(id: string): Promise<ShippoLabelLog | undefined>;
  getShippoLabelLogByScanCode(scanCode: string): Promise<ShippoLabelLog | undefined>;
  getShippoLabelLogByTrackingNumber(trackingNumber: string): Promise<ShippoLabelLog | undefined>;
  getShippoLabelLogsByReturnId(returnRequestId: string): Promise<ShippoLabelLog[]>;
  getShippoLabelLogsBySalesOrderId(salesOrderId: string): Promise<ShippoLabelLog[]>;
  createShippoLabelLog(log: InsertShippoLabelLog): Promise<ShippoLabelLog>;
  updateShippoLabelLog(id: string, log: Partial<InsertShippoLabelLog>): Promise<ShippoLabelLog | undefined>;
  searchShippoLabelLogs(params: { search?: string; page?: number; pageSize?: number }): Promise<{ logs: ShippoLabelLog[]; total: number }>;

  // Return Helper Methods
  getNextRMANumber(): Promise<string>;
  getReturnRequestByRMANumber(rmaNumber: string): Promise<ReturnRequest | undefined>;
  getReturnRequestByExternalOrderId(externalOrderId: string): Promise<ReturnRequest[]>;

  // Channels
  getAllChannels(): Promise<Channel[]>;
  getChannel(id: string): Promise<Channel | undefined>;
  getChannelByCode(code: string): Promise<Channel | undefined>;
  createChannel(channel: InsertChannel): Promise<Channel>;
  updateChannel(id: string, channel: Partial<InsertChannel>): Promise<Channel | undefined>;

  // Product Channel Mappings
  getAllProductChannelMappings(): Promise<ProductChannelMapping[]>;
  getProductChannelMappingsByProduct(productId: string): Promise<ProductChannelMapping[]>;
  getProductChannelMappingsByChannel(channelId: string): Promise<ProductChannelMapping[]>;
  getProductChannelMapping(productId: string, channelId: string): Promise<ProductChannelMapping | undefined>;
  createProductChannelMapping(mapping: InsertProductChannelMapping): Promise<ProductChannelMapping>;
  updateProductChannelMapping(id: string, mapping: Partial<InsertProductChannelMapping>): Promise<ProductChannelMapping | undefined>;
  deleteProductChannelMapping(id: string): Promise<boolean>;

  // Ad Performance Snapshots
  getAllAdPerformanceSnapshots(): Promise<AdPerformanceSnapshot[]>;
  getAdPerformanceSnapshotsByProduct(productId: string, startDate?: Date, endDate?: Date): Promise<AdPerformanceSnapshot[]>;
  getAdPerformanceSnapshotsByChannel(channelId: string, startDate?: Date, endDate?: Date): Promise<AdPerformanceSnapshot[]>;
  upsertAdPerformanceSnapshot(snapshot: InsertAdPerformanceSnapshot): Promise<AdPerformanceSnapshot>;

  // Sales Snapshots
  getAllSalesSnapshots(): Promise<SalesSnapshot[]>;
  getSalesSnapshotsByProduct(productId: string, startDate?: Date, endDate?: Date): Promise<SalesSnapshot[]>;
  getSalesSnapshotsByChannel(channelId: string, startDate?: Date, endDate?: Date): Promise<SalesSnapshot[]>;
  upsertSalesSnapshot(snapshot: InsertSalesSnapshot): Promise<SalesSnapshot>;

  // Product Forecast Context
  getAllProductForecastContexts(): Promise<ProductForecastContext[]>;
  getProductForecastContext(productId: string): Promise<ProductForecastContext | undefined>;
  upsertProductForecastContext(context: InsertProductForecastContext): Promise<ProductForecastContext>;
  refreshProductForecastContext(productId: string): Promise<ProductForecastContext>;
  refreshAllProductForecastContexts(): Promise<void>;

  // Sales Orders
  getAllSalesOrders(): Promise<SalesOrder[]>;
  getSalesOrder(id: string): Promise<SalesOrder | undefined>;
  getSalesOrdersByExternalId(channel: string, externalOrderId: string): Promise<SalesOrder[]>;
  getSalesOrderWithLines(id: string): Promise<(SalesOrder & { lines: SalesOrderLine[] }) | undefined>;
  createSalesOrder(order: InsertSalesOrder): Promise<SalesOrder>;
  updateSalesOrder(id: string, order: Partial<InsertSalesOrder>): Promise<SalesOrder | undefined>;
  deleteSalesOrder(id: string): Promise<boolean>;

  // Sales Order Lines
  getSalesOrderLines(salesOrderId: string): Promise<SalesOrderLine[]>;
  getSalesOrderLine(id: string): Promise<SalesOrderLine | undefined>;
  createSalesOrderLine(line: InsertSalesOrderLine): Promise<SalesOrderLine>;
  updateSalesOrderLine(id: string, line: Partial<InsertSalesOrderLine>): Promise<SalesOrderLine | undefined>;
  deleteSalesOrderLine(id: string): Promise<boolean>;
  getOpenBackorderLinesByProduct(productId: string): Promise<SalesOrderLine[]>;

  // Backorder Snapshots
  getAllBackorderSnapshots(): Promise<BackorderSnapshot[]>;
  getBackorderSnapshot(productId: string): Promise<BackorderSnapshot | undefined>;
  upsertBackorderSnapshot(snapshot: InsertBackorderSnapshot): Promise<BackorderSnapshot>;
  refreshBackorderSnapshot(productId: string): Promise<BackorderSnapshot>;
  refreshAllBackorderSnapshots(): Promise<void>;

  // Audit Logs
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(options?: { 
    limit?: number; 
    offset?: number; 
    source?: string;
    eventType?: string; 
    entityType?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
    search?: string;
  }): Promise<{ logs: AuditLog[]; total: number }>;
  getAuditLogsByPurchaseOrder(purchaseOrderId: string): Promise<AuditLog[]>;
  countAuditLogs(options?: { 
    source?: string;
    eventType?: string; 
    entityType?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
    search?: string;
  }): Promise<number>;

  // AI System Recommendations (Weekly LLM-generated improvement suggestions)
  createAiSystemRecommendation(recommendation: InsertAiSystemRecommendation): Promise<AiSystemRecommendation>;
  getAiSystemRecommendations(options?: {
    limit?: number;
    offset?: number;
    status?: string;
    severity?: string;
    category?: string;
  }): Promise<{ recommendations: AiSystemRecommendation[]; total: number }>;
  getAiSystemRecommendation(id: string): Promise<AiSystemRecommendation | undefined>;
  updateAiSystemRecommendation(id: string, data: Partial<{
    status: string;
    acknowledgedAt: Date;
    acknowledgedByUserId: string;
    dismissedAt: Date;
    dismissedByUserId: string;
  }>): Promise<AiSystemRecommendation | undefined>;
  countAiSystemRecommendationsByStatus(status: string): Promise<number>;

  // QuickBooks Auth
  getQuickbooksAuth(userId: string): Promise<QuickbooksAuth | null>;
  getQuickbooksAuthsByUserId(userId: string): Promise<QuickbooksAuth[]>;
  createQuickbooksAuth(auth: InsertQuickbooksAuth): Promise<QuickbooksAuth>;
  updateQuickbooksAuth(id: string, auth: Partial<InsertQuickbooksAuth>): Promise<QuickbooksAuth | null>;
  updateQuickbooksAuthHealthStatus(id: string, status: { lastTokenCheckAt?: Date; lastTokenCheckStatus?: string; lastAlertSentAt?: Date | null }): Promise<void>;
  
  // Integration Configs health check support (supplements existing methods)
  getIntegrationConfigsByUserId(userId: string): Promise<IntegrationConfig[]>;
  updateIntegrationConfigHealthStatus(id: string, status: { lastTokenCheckAt?: Date; lastTokenCheckStatus?: string; lastAlertSentAt?: Date | null; consecutiveFailures?: number; lastSyncStatus?: string }): Promise<void>;

  // QuickBooks Sales Snapshots
  getQuickbooksSalesSnapshotsBySku(sku: string): Promise<QuickbooksSalesSnapshot[]>;
  getAllQuickbooksSalesSnapshots(): Promise<QuickbooksSalesSnapshot[]>;
  getQuickbooksDemandHistory(params: {
    search?: string;
    year?: number;
    month?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: QuickbooksSalesSnapshot[]; total: number; years: number[] }>;
  upsertQuickbooksSalesSnapshot(snapshot: Omit<InsertQuickbooksSalesSnapshot, 'id'>): Promise<{ snapshot: QuickbooksSalesSnapshot; isNew: boolean }>;

  // QuickBooks Vendor Mappings
  getQuickbooksVendorMapping(supplierId: string): Promise<QuickbooksVendorMapping | null>;
  createQuickbooksVendorMapping(mapping: InsertQuickbooksVendorMapping): Promise<QuickbooksVendorMapping>;

  // QuickBooks Item Mappings
  getQuickbooksItemMapping(itemId: string): Promise<QuickbooksItemMapping | null>;
  createQuickbooksItemMapping(mapping: InsertQuickbooksItemMapping): Promise<QuickbooksItemMapping>;

  // QuickBooks Bills
  getQuickbooksBillByPurchaseOrderId(purchaseOrderId: string): Promise<QuickbooksBill | null>;
  createQuickbooksBill(bill: InsertQuickbooksBill): Promise<QuickbooksBill>;
  updateQuickbooksBill(id: string, bill: Partial<InsertQuickbooksBill>): Promise<QuickbooksBill | null>;

  // Ad Platform Configs (Meta, Google Ads)
  getAdPlatformConfig(userId: string, platform: string): Promise<AdPlatformConfig | undefined>;
  getAllAdPlatformConfigs(userId: string): Promise<AdPlatformConfig[]>;
  createAdPlatformConfig(config: InsertAdPlatformConfig): Promise<AdPlatformConfig>;
  updateAdPlatformConfig(id: string, config: Partial<InsertAdPlatformConfig>): Promise<AdPlatformConfig | undefined>;
  deleteAdPlatformConfig(id: string): Promise<boolean>;

  // Ad SKU Mappings
  getAllAdSkuMappings(): Promise<AdSkuMapping[]>;
  getAdSkuMappingsBySku(sku: string): Promise<AdSkuMapping[]>;
  getAdSkuMappingsByPlatform(platform: string): Promise<AdSkuMapping[]>;
  createAdSkuMapping(mapping: InsertAdSkuMapping): Promise<AdSkuMapping>;
  updateAdSkuMapping(id: string, mapping: Partial<InsertAdSkuMapping>): Promise<AdSkuMapping | undefined>;
  deleteAdSkuMapping(id: string): Promise<boolean>;

  // Ad Metrics Daily
  getAdMetricsBySkuDays(sku: string, days: number): Promise<AdMetricsDaily[]>;
  getAdMetricsByPlatformDateRange(platform: string, startDate: Date, endDate: Date): Promise<AdMetricsDaily[]>;
  getAdMetricsBySkuAndDateRange(sku: string, startDate: string, endDate: string): Promise<AdMetricsDaily[]>;
  upsertAdMetricsDaily(metrics: InsertAdMetricsDaily): Promise<AdMetricsDaily>;

  // Label Formats (Custom label sizes)
  getLabelFormatsByUserId(userId: string): Promise<LabelFormat[]>;
  getLabelFormat(id: string): Promise<LabelFormat | undefined>;
  createLabelFormat(format: InsertLabelFormat): Promise<LabelFormat>;
  updateLabelFormat(id: string, format: Partial<InsertLabelFormat>): Promise<LabelFormat | undefined>;
  deleteLabelFormat(id: string): Promise<boolean>;
  setDefaultLabelFormat(userId: string, formatId: string): Promise<void>;

  // System Logs (Unified logging for mismatches and external events)
  getAllSystemLogs(filters?: { type?: string; severity?: string; entityType?: string; startDate?: Date; endDate?: Date }): Promise<SystemLog[]>;
  getSystemLog(id: string): Promise<SystemLog | undefined>;
  createSystemLog(log: InsertSystemLog): Promise<SystemLog>;

  // AI Agent Settings
  getAiAgentSettingsByUserId(userId: string): Promise<AiAgentSettings | undefined>;
  createAiAgentSettings(settings: InsertAiAgentSettings): Promise<AiAgentSettings>;
  updateAiAgentSettings(userId: string, settings: Partial<InsertAiAgentSettings>): Promise<AiAgentSettings | undefined>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private items: Map<string, Item>;
  private bins: Map<string, Bin>;
  private inventoryByBin: Map<string, InventoryByBin>;
  private billOfMaterials: Map<string, BillOfMaterials>;
  private suppliers: Map<string, Supplier>;
  private supplierItems: Map<string, SupplierItem>;
  private salesHistory: Map<string, SalesHistory>;
  private finishedInventorySnapshots: Map<string, FinishedInventorySnapshot>;
  private integrationHealth: Map<string, IntegrationHealth>;
  private settings: Map<string, Settings>;
  private integrationConfigs: Map<string, IntegrationConfig>;
  private barcodes: Map<string, Barcode>;
  private barcodeSettings: BarcodeSettings | null;
  private importProfiles: Map<string, ImportProfile>;
  private importJobs: Map<string, ImportJob>;
  private inventoryTransactions: Map<string, InventoryTransaction>;
  private aiRecommendations: Map<string, AIRecommendation>;
  private purchaseOrders: Map<string, PurchaseOrder>;
  private purchaseOrderLines: Map<string, PurchaseOrderLine>;
  private supplierLeads: Map<string, SupplierLead>;
  private returnRequests: Map<string, ReturnRequest>;
  private returnItems: Map<string, ReturnItem>;
  private returnShipments: Map<string, ReturnShipment>;
  private returnEvents: Map<string, ReturnEvent>;
  private salesOrders: Map<string, SalesOrder>;
  private salesOrderLines: Map<string, SalesOrderLine>;
  private backorderSnapshots: Map<string, BackorderSnapshot>;
  private auditLogs: Map<string, AuditLog>;
  private adPlatformConfigs: Map<string, AdPlatformConfig>;
  private adSkuMappings: Map<string, AdSkuMapping>;
  private adMetricsDaily: Map<string, AdMetricsDaily>;
  private labelFormats: Map<string, LabelFormat>;

  constructor() {
    this.users = new Map();
    this.items = new Map();
    this.bins = new Map();
    this.inventoryByBin = new Map();
    this.billOfMaterials = new Map();
    this.suppliers = new Map();
    this.supplierItems = new Map();
    this.salesHistory = new Map();
    this.finishedInventorySnapshots = new Map();
    this.integrationHealth = new Map();
    this.settings = new Map();
    this.integrationConfigs = new Map();
    this.barcodes = new Map();
    this.barcodeSettings = null;
    this.importProfiles = new Map();
    this.importJobs = new Map();
    this.inventoryTransactions = new Map();
    this.aiRecommendations = new Map();
    this.purchaseOrders = new Map();
    this.purchaseOrderLines = new Map();
    this.supplierLeads = new Map();
    this.returnRequests = new Map();
    this.returnItems = new Map();
    this.returnShipments = new Map();
    this.returnEvents = new Map();
    this.salesOrders = new Map();
    this.salesOrderLines = new Map();
    this.backorderSnapshots = new Map();
    this.auditLogs = new Map();
    this.adPlatformConfigs = new Map();
    this.adSkuMappings = new Map();
    this.adMetricsDaily = new Map();
    this.labelFormats = new Map();
    this.seedData();
  }

  private seedData() {
    // Seed some initial data for demo purposes
    const demoUserId = randomUUID();
    this.users.set(demoUserId, {
      id: demoUserId,
      email: "demo@inventory.com",
      password: "$2b$10$K7L1OJ45/4Y2nIvhRVpCe.FSmhDdWoXehVzJptJ/op0lSsvqNu/1u", // "password"
    });

    // Demo items (components)
    const nutId = randomUUID();
    const boltId = randomUUID();
    const springId = randomUUID();
    const barId = randomUUID();

    this.items.set(nutId, {
      id: nutId,
      name: "M6 Hex Nut",
      sku: "NUT-M6-001",
      type: "component",
      unit: "units",
      currentStock: 150,
      minStock: 50,
      dailyUsage: 12,
      barcode: "COMP-NUT-001",
      location: null,
      hildaleQty: 0,
      pivotQty: 0,
      availableForSaleQty: 0,
      extensivOnHandSnapshot: 0,
      extensivLastSyncAt: null,
      productKind: "RAW",
      barcodeValue: "COMP-NUT-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
      salesChannels: null,
      amazonAsin: null,
      shopifyProductId: null,
      shopifyVariantId: null,
      shopifyLocationId: null,
      updatedAt: new Date(),
      forecastDirty: true,
      lastForecastAt: null,
      forecastData: null,
    });

    this.items.set(boltId, {
      id: boltId,
      name: "M6x20 Bolt",
      sku: "BOLT-M6-20",
      type: "component",
      unit: "units",
      currentStock: 200,
      minStock: 75,
      dailyUsage: 15,
      barcode: "COMP-BOLT-001",
      location: null,
      hildaleQty: 0,
      pivotQty: 0,
      availableForSaleQty: 0,
      extensivOnHandSnapshot: 0,
      extensivLastSyncAt: null,
      productKind: "RAW",
      barcodeValue: "COMP-BOLT-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
      salesChannels: null,
      amazonAsin: null,
      shopifyProductId: null,
      shopifyVariantId: null,
      shopifyLocationId: null,
      updatedAt: new Date(),
      forecastDirty: true,
      lastForecastAt: null,
      forecastData: null,
    });

    this.items.set(springId, {
      id: springId,
      name: "Compression Spring",
      sku: "SPR-COMP-001",
      type: "component",
      unit: "units",
      currentStock: 80,
      minStock: 40,
      dailyUsage: 8,
      barcode: "COMP-SPR-001",
      location: null,
      hildaleQty: 0,
      pivotQty: 0,
      availableForSaleQty: 0,
      extensivOnHandSnapshot: 0,
      extensivLastSyncAt: null,
      productKind: "RAW",
      barcodeValue: "COMP-SPR-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
      salesChannels: null,
      amazonAsin: null,
      shopifyProductId: null,
      shopifyVariantId: null,
      shopifyLocationId: null,
      updatedAt: new Date(),
      forecastDirty: true,
      lastForecastAt: null,
      forecastData: null,
    });

    this.items.set(barId, {
      id: barId,
      name: "Steel Bar 10mm",
      sku: "BAR-STL-10",
      type: "component",
      unit: "units",
      currentStock: 60,
      minStock: 30,
      dailyUsage: 6,
      barcode: "COMP-BAR-001",
      location: null,
      hildaleQty: 0,
      pivotQty: 0,
      availableForSaleQty: 0,
      extensivOnHandSnapshot: 0,
      extensivLastSyncAt: null,
      productKind: "RAW",
      barcodeValue: "COMP-BAR-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "INTERNAL_STOCK",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
      salesChannels: null,
      amazonAsin: null,
      shopifyProductId: null,
      shopifyVariantId: null,
      shopifyLocationId: null,
      updatedAt: new Date(),
      forecastDirty: true,
      lastForecastAt: null,
      forecastData: null,
    });

    // Demo finished product
    const rollerId = randomUUID();
    this.items.set(rollerId, {
      id: rollerId,
      name: "Sticker Bur Roller",
      sku: "SBR-001",
      type: "finished_product",
      unit: "units",
      currentStock: 25,
      minStock: 10,
      dailyUsage: 3,
      barcode: "PROD-SBR-001",
      location: "Spanish Fork",
      hildaleQty: 0,
      pivotQty: 25,
      availableForSaleQty: 25,
      extensivOnHandSnapshot: 25,
      extensivLastSyncAt: new Date(),
      productKind: "FINISHED",
      barcodeValue: "PROD-SBR-001",
      barcodeFormat: "CODE128",
      barcodeUsage: "EXTERNAL_GS1",
      barcodeSource: "AUTO_GENERATED",
      externalSystem: null,
      externalId: null,
      salesChannels: null,
      amazonAsin: null,
      shopifyProductId: null,
      shopifyVariantId: null,
      shopifyLocationId: null,
      updatedAt: new Date(),
      forecastDirty: false,
      lastForecastAt: new Date(),
      forecastData: { shouldReorder: false, urgency: "low", daysOfCover: 90, recommendedOrderQuantity: 0, reasoning: "Demo seed data" },
    });

    // BOM for Sticker Bur Roller
    this.billOfMaterials.set(randomUUID(), {
      id: randomUUID(),
      finishedProductId: rollerId,
      componentId: nutId,
      quantityRequired: 4,
    });
    this.billOfMaterials.set(randomUUID(), {
      id: randomUUID(),
      finishedProductId: rollerId,
      componentId: boltId,
      quantityRequired: 4,
    });
    this.billOfMaterials.set(randomUUID(), {
      id: randomUUID(),
      finishedProductId: rollerId,
      componentId: springId,
      quantityRequired: 2,
    });
    this.billOfMaterials.set(randomUUID(), {
      id: randomUUID(),
      finishedProductId: rollerId,
      componentId: barId,
      quantityRequired: 3,
    });

    // Demo suppliers
    const supplier1Id = randomUUID();
    const supplier2Id = randomUUID();

    this.suppliers.set(supplier1Id, {
      id: supplier1Id,
      name: "FastenPro Supplies",
      email: "orders@fastenpro.example.com",
      phone: "555-123-4567",
      catalogUrl: "https://fastenpro.example.com",
      logoUrl: null,
      ghlContactId: null,
    });

    this.suppliers.set(supplier2Id, {
      id: supplier2Id,
      name: "Metal Works Co",
      email: "sales@metalworks.example.com",
      phone: "555-987-6543",
      catalogUrl: "https://metalworks.example.com",
      logoUrl: null,
      ghlContactId: null,
    });

    // Integration health
    this.integrationHealth.set("gohighlevel", {
      id: randomUUID(),
      integrationName: "gohighlevel",
      lastSuccessAt: new Date(Date.now() - 3600000),
      lastStatus: "success",
      lastAlertAt: null,
      errorMessage: null,
    });

    this.integrationHealth.set("extensiv", {
      id: randomUUID(),
      integrationName: "extensiv",
      lastSuccessAt: new Date(Date.now() - 7200000),
      lastStatus: "success",
      lastAlertAt: null,
      errorMessage: null,
    });

    // Barcode Settings
    this.barcodeSettings = {
      id: randomUUID(),
      gs1Prefix: null, // To be configured by user
      itemRefDigits: 6,
      nextItemRef: 1,
      nextInternalCode: 1000,
    };
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((user) => user.email === email);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: string, updateData: Partial<InsertUser>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated = { ...user, ...updateData };
    this.users.set(id, updated);
    return updated;
  }

  // Items
  async getAllItems(): Promise<Item[]> {
    return Array.from(this.items.values());
  }

  private calculateProductionForecast(finishedProductId: string): number {
    // Get BOM entries for this finished product
    const bomEntries = Array.from(this.billOfMaterials.values()).filter(
      (bom) => bom.finishedProductId === finishedProductId
    );

    // If no BOM components, forecast is 0
    if (bomEntries.length === 0) {
      return 0;
    }

    // Calculate capacity for each component
    let minCapacity = Infinity;
    
    for (const bomEntry of bomEntries) {
      const component = this.items.get(bomEntry.componentId);
      
      if (!component || bomEntry.quantityRequired <= 0) {
        // Missing component or invalid quantity = can't produce any
        return 0;
      }

      const componentStock = component.currentStock ?? 0;
      const requiredPerUnit = bomEntry.quantityRequired;
      
      // Calculate how many units this component allows
      const capacityForComponent = Math.floor(componentStock / requiredPerUnit);
      
      minCapacity = Math.min(minCapacity, capacityForComponent);
    }

    return minCapacity === Infinity ? 0 : minCapacity;
  }

  async getItemsWithBOMCounts(): Promise<Array<Item & { componentsCount?: number; forecastQty?: number; totalOwned?: number }>> {
    const items = Array.from(this.items.values());
    const itemsWithCounts = items.map((item) => {
      if (item.type === "finished_product") {
        const bomEntries = Array.from(this.billOfMaterials.values()).filter(
          (bom) => bom.finishedProductId === item.id
        );
        const forecast = this.calculateProductionForecast(item.id);
        const totalOwned = (item.pivotQty ?? 0) + (item.hildaleQty ?? 0);
        return { ...item, componentsCount: bomEntries.length, forecastQty: forecast, totalOwned };
      }
      // For components, explicitly return undefined to match PostgresStorage behavior
      return { ...item, componentsCount: undefined, forecastQty: undefined, totalOwned: undefined };
    });
    return itemsWithCounts;
  }

  async getItem(id: string): Promise<Item | undefined> {
    return this.items.get(id);
  }

  async getItemBySku(sku: string): Promise<Item | undefined> {
    return Array.from(this.items.values()).find((item) => item.sku === sku);
  }

  async findProductByShopifySku(shopifySku: string): Promise<Item | undefined> {
    return Array.from(this.items.values()).find((item) => item.shopifySku === shopifySku);
  }

  async findProductByAmazonSku(amazonSku: string): Promise<Item | undefined> {
    return Array.from(this.items.values()).find((item) => item.amazonSku === amazonSku);
  }

  async findProductByExtensivSku(extensivSku: string): Promise<Item | undefined> {
    return Array.from(this.items.values()).find((item) => item.extensivSku === extensivSku);
  }

  async createItem(insertItem: InsertItem): Promise<Item> {
    const id = randomUUID();
    
    // Storage-level guard: Force currentStock to 0 for finished products
    // Finished products MUST use only pivotQty and hildaleQty as sources of truth
    
    // Normalize type/productKind to keep them in sync during creation
    let normalizedType = insertItem.type;
    let normalizedProductKind = insertItem.productKind ?? null;
    
    // Step 1: Fill in missing partner field
    if (insertItem.type === 'finished_product' && !insertItem.productKind) {
      normalizedProductKind = 'FINISHED';
    } else if (insertItem.type === 'component' && !insertItem.productKind) {
      normalizedProductKind = 'RAW';
    } else if (insertItem.productKind === 'FINISHED' && !insertItem.type) {
      normalizedType = 'finished_product';
    } else if (insertItem.productKind === 'RAW' && !insertItem.type) {
      normalizedType = 'component';
    }
    
    // Step 2: Fix mismatches by ALWAYS favoring finished_product classification
    // This ensures NO bypass: any signal of finished product → enforce finished product rules
    if (normalizedType === 'finished_product' || normalizedProductKind === 'FINISHED') {
      // ALWAYS favor finished_product: force both fields to finished state
      normalizedType = 'finished_product';
      normalizedProductKind = 'FINISHED';
    } else if (normalizedType === 'component' || normalizedProductKind === 'RAW') {
      // Both indicate component: normalize to component/RAW
      normalizedType = 'component';
      normalizedProductKind = 'RAW';
    }
    
    const isFinishedProduct = normalizedType === 'finished_product' || normalizedProductKind === 'FINISHED';
    const currentStock = isFinishedProduct ? 0 : (insertItem.currentStock ?? 0);
    
    const item: Item = {
      id,
      name: insertItem.name,
      sku: insertItem.sku,
      type: normalizedType,
      unit: insertItem.unit || 'units',
      currentStock,
      minStock: insertItem.minStock ?? 0,
      dailyUsage: insertItem.dailyUsage ?? 0,
      barcode: insertItem.barcode ?? null,
      location: insertItem.location ?? null,
      hildaleQty: insertItem.hildaleQty ?? 0,
      pivotQty: insertItem.pivotQty ?? 0,
      availableForSaleQty: insertItem.availableForSaleQty ?? insertItem.pivotQty ?? 0,
      extensivOnHandSnapshot: insertItem.extensivOnHandSnapshot ?? 0,
      extensivLastSyncAt: insertItem.extensivLastSyncAt ?? null,
      productKind: normalizedProductKind,
      barcodeValue: insertItem.barcodeValue ?? null,
      barcodeFormat: insertItem.barcodeFormat ?? null,
      barcodeUsage: insertItem.barcodeUsage ?? null,
      barcodeSource: insertItem.barcodeSource ?? null,
      externalSystem: insertItem.externalSystem ?? null,
      externalId: insertItem.externalId ?? null,
      salesChannels: insertItem.salesChannels ?? null,
      amazonAsin: insertItem.amazonAsin ?? null,
      shopifyProductId: insertItem.shopifyProductId ?? null,
      shopifyVariantId: insertItem.shopifyVariantId ?? null,
      shopifyLocationId: insertItem.shopifyLocationId ?? null,
      updatedAt: new Date(),
      forecastDirty: insertItem.forecastDirty ?? true,
      lastForecastAt: insertItem.lastForecastAt ?? null,
      forecastData: insertItem.forecastData ?? null,
    };
    this.items.set(id, item);
    return item;
  }

  async updateItem(id: string, updateData: Partial<InsertItem>): Promise<Item | undefined> {
    const item = this.items.get(id);
    if (!item) return undefined;
    
    // Storage-level guard: Force currentStock to 0 for finished products
    // Finished products MUST use only pivotQty and hildaleQty as sources of truth
    
    // Normalize type/productKind in update data to keep them in sync
    let normalizedUpdateData = { ...updateData };
    if (updateData.type === 'finished_product' && !updateData.productKind) {
      normalizedUpdateData.productKind = 'FINISHED';
    } else if (updateData.type === 'component' && !updateData.productKind) {
      normalizedUpdateData.productKind = 'RAW';
    } else if (updateData.productKind === 'FINISHED' && !updateData.type) {
      normalizedUpdateData.type = 'finished_product';
    } else if (updateData.productKind === 'RAW' && !updateData.type) {
      normalizedUpdateData.type = 'component';
    }
    
    // Merge to get preliminary final state
    let mergedItem = { ...item, ...normalizedUpdateData };
    
    // Normalize FINAL merged state by ALWAYS favoring finished_product classification
    // This fixes pre-existing inconsistencies and ensures NO bypass
    if (mergedItem.type === 'finished_product' || mergedItem.productKind === 'FINISHED') {
      // ALWAYS favor finished_product: force both fields to finished state
      mergedItem.type = 'finished_product';
      mergedItem.productKind = 'FINISHED';
    } else if (mergedItem.type === 'component' || mergedItem.productKind === 'RAW') {
      // Both indicate component: normalize to component/RAW
      mergedItem.type = 'component';
      mergedItem.productKind = 'RAW';
    }
    
    // Determine if final state is finished product
    const willBeFinished = mergedItem.type === 'finished_product' || mergedItem.productKind === 'FINISHED';
    
    if (willBeFinished) {
      // Force currentStock to 0 and ensure type/productKind are fully synced
      mergedItem.currentStock = 0;
      mergedItem.type = 'finished_product';
      mergedItem.productKind = 'FINISHED';
    }
    
    this.items.set(id, mergedItem);
    return mergedItem;
  }

  async deleteItem(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  // Bins
  async getAllBins(): Promise<Bin[]> {
    return Array.from(this.bins.values());
  }

  async getBin(id: string): Promise<Bin | undefined> {
    return this.bins.get(id);
  }

  async createBin(insertBin: InsertBin): Promise<Bin> {
    const id = randomUUID();
    const bin: Bin = {
      id,
      code: insertBin.code,
      name: insertBin.name,
      location: insertBin.location ?? null,
      barcode: insertBin.barcode ?? null,
    };
    this.bins.set(id, bin);
    return bin;
  }

  async updateBin(id: string, updateData: Partial<InsertBin>): Promise<Bin | undefined> {
    const bin = this.bins.get(id);
    if (!bin) return undefined;
    const updated = { ...bin, ...updateData };
    this.bins.set(id, updated);
    return updated;
  }

  async deleteBin(id: string): Promise<boolean> {
    return this.bins.delete(id);
  }

  // Inventory By Bin
  async getAllInventoryByBin(): Promise<InventoryByBin[]> {
    return Array.from(this.inventoryByBin.values());
  }

  async getInventoryByBin(id: string): Promise<InventoryByBin | undefined> {
    return this.inventoryByBin.get(id);
  }

  async getInventoryByItemId(itemId: string): Promise<InventoryByBin[]> {
    return Array.from(this.inventoryByBin.values()).filter((inv) => inv.itemId === itemId);
  }

  async createInventoryByBin(insertInventory: InsertInventoryByBin): Promise<InventoryByBin> {
    const id = randomUUID();
    const inventory: InventoryByBin = {
      id,
      itemId: insertInventory.itemId,
      binId: insertInventory.binId,
      quantity: insertInventory.quantity ?? 0,
    };
    this.inventoryByBin.set(id, inventory);
    return inventory;
  }

  async updateInventoryByBin(id: string, updateData: Partial<InsertInventoryByBin>): Promise<InventoryByBin | undefined> {
    const inventory = this.inventoryByBin.get(id);
    if (!inventory) return undefined;
    const updated = { ...inventory, ...updateData };
    this.inventoryByBin.set(id, updated);
    return updated;
  }

  async deleteInventoryByBin(id: string): Promise<boolean> {
    return this.inventoryByBin.delete(id);
  }

  // Bill of Materials
  async getAllBillOfMaterials(): Promise<BillOfMaterials[]> {
    return Array.from(this.billOfMaterials.values());
  }

  async getBillOfMaterialsByProductId(finishedProductId: string): Promise<BillOfMaterials[]> {
    return Array.from(this.billOfMaterials.values()).filter(
      (bom) => bom.finishedProductId === finishedProductId
    );
  }

  async createBillOfMaterials(insertBom: InsertBillOfMaterials): Promise<BillOfMaterials> {
    const id = randomUUID();
    const bom: BillOfMaterials = {
      id,
      finishedProductId: insertBom.finishedProductId,
      componentId: insertBom.componentId,
      quantityRequired: insertBom.quantityRequired,
    };
    this.billOfMaterials.set(id, bom);
    return bom;
  }

  async deleteBillOfMaterials(id: string): Promise<boolean> {
    return this.billOfMaterials.delete(id);
  }

  // Suppliers
  async getAllSuppliers(): Promise<Supplier[]> {
    return Array.from(this.suppliers.values());
  }

  async getSupplier(id: string): Promise<Supplier | undefined> {
    return this.suppliers.get(id);
  }

  async createSupplier(insertSupplier: InsertSupplier): Promise<Supplier> {
    const id = randomUUID();
    const supplier: Supplier = {
      id,
      name: insertSupplier.name,
      email: insertSupplier.email ?? null,
      phone: insertSupplier.phone ?? null,
      catalogUrl: insertSupplier.catalogUrl ?? null,
      logoUrl: insertSupplier.logoUrl ?? null,
      ghlContactId: insertSupplier.ghlContactId ?? null,
    };
    this.suppliers.set(id, supplier);
    return supplier;
  }

  async updateSupplier(id: string, updateData: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const supplier = this.suppliers.get(id);
    if (!supplier) return undefined;
    const updated = { ...supplier, ...updateData };
    this.suppliers.set(id, updated);
    return updated;
  }

  async deleteSupplier(id: string): Promise<boolean> {
    return this.suppliers.delete(id);
  }

  // Supplier Items
  async getAllSupplierItems(): Promise<SupplierItem[]> {
    return Array.from(this.supplierItems.values());
  }

  async getSupplierItemsByItemId(itemId: string): Promise<SupplierItem[]> {
    return Array.from(this.supplierItems.values()).filter((si) => si.itemId === itemId);
  }

  async createSupplierItem(insertSupplierItem: InsertSupplierItem): Promise<SupplierItem> {
    const id = randomUUID();
    const supplierItem: SupplierItem = {
      id,
      supplierId: insertSupplierItem.supplierId,
      itemId: insertSupplierItem.itemId,
      supplierSku: insertSupplierItem.supplierSku ?? null,
      price: insertSupplierItem.price ?? null,
      minimumOrderQuantity: insertSupplierItem.minimumOrderQuantity ?? null,
      availableQuantity: insertSupplierItem.availableQuantity ?? null,
      leadTimeDays: insertSupplierItem.leadTimeDays ?? null,
      isDesignatedSupplier: insertSupplierItem.isDesignatedSupplier ?? false,
    };
    this.supplierItems.set(id, supplierItem);
    return supplierItem;
  }

  async updateSupplierItem(id: string, updateData: Partial<InsertSupplierItem>): Promise<SupplierItem | undefined> {
    const supplierItem = this.supplierItems.get(id);
    if (!supplierItem) return undefined;
    const updated = { ...supplierItem, ...updateData };
    this.supplierItems.set(id, updated);
    return updated;
  }

  async deleteSupplierItem(id: string): Promise<boolean> {
    return this.supplierItems.delete(id);
  }

  // Sales History
  async getAllSalesHistory(): Promise<SalesHistory[]> {
    return Array.from(this.salesHistory.values());
  }

  async getSalesHistoryByItemId(itemId: string): Promise<SalesHistory[]> {
    return Array.from(this.salesHistory.values()).filter(s => s.itemId === itemId);
  }

  async createSalesHistory(insertSale: InsertSalesHistory): Promise<SalesHistory> {
    const id = randomUUID();
    const sale: SalesHistory = {
      id,
      itemId: insertSale.itemId,
      quantitySold: insertSale.quantitySold,
      saleDate: insertSale.saleDate,
      externalOrderId: insertSale.externalOrderId ?? null,
    };
    this.salesHistory.set(id, sale);
    return sale;
  }

  // Finished Inventory Snapshot
  async getAllFinishedInventorySnapshots(): Promise<FinishedInventorySnapshot[]> {
    return Array.from(this.finishedInventorySnapshots.values());
  }

  async createFinishedInventorySnapshot(insertSnapshot: InsertFinishedInventorySnapshot): Promise<FinishedInventorySnapshot> {
    const id = randomUUID();
    const snapshot: FinishedInventorySnapshot = {
      id,
      itemId: insertSnapshot.itemId,
      quantity: insertSnapshot.quantity,
      location: insertSnapshot.location ?? null,
      snapshotDate: insertSnapshot.snapshotDate ?? new Date(),
    };
    this.finishedInventorySnapshots.set(id, snapshot);
    return snapshot;
  }

  // Integration Health
  async getAllIntegrationHealth(): Promise<IntegrationHealth[]> {
    return Array.from(this.integrationHealth.values());
  }

  async getIntegrationHealth(integrationName: string): Promise<IntegrationHealth | undefined> {
    return this.integrationHealth.get(integrationName);
  }

  async createOrUpdateIntegrationHealth(health: InsertIntegrationHealth): Promise<IntegrationHealth> {
    const existing = this.integrationHealth.get(health.integrationName);
    if (existing) {
      const updated: IntegrationHealth = {
        ...existing,
        integrationName: health.integrationName,
        lastSuccessAt: health.lastSuccessAt ?? existing.lastSuccessAt,
        lastStatus: health.lastStatus ?? existing.lastStatus,
        lastAlertAt: health.lastAlertAt ?? existing.lastAlertAt,
        errorMessage: health.errorMessage ?? existing.errorMessage,
      };
      this.integrationHealth.set(health.integrationName, updated);
      return updated;
    }
    const id = randomUUID();
    const newHealth: IntegrationHealth = {
      id,
      integrationName: health.integrationName,
      lastSuccessAt: health.lastSuccessAt ?? null,
      lastStatus: health.lastStatus ?? null,
      lastAlertAt: health.lastAlertAt ?? null,
      errorMessage: health.errorMessage ?? null,
    };
    this.integrationHealth.set(health.integrationName, newHealth);
    return newHealth;
  }

  // Settings
  async getSettings(userId: string): Promise<Settings | undefined> {
    return Array.from(this.settings.values()).find((s) => s.userId === userId);
  }

  async createOrUpdateSettings(insertSettings: InsertSettings): Promise<Settings> {
    const existing = await this.getSettings(insertSettings.userId);
    if (existing) {
      const updated: Settings = { ...existing, ...insertSettings };
      this.settings.set(existing.id, updated);
      return updated;
    }
    const id = randomUUID();
    const settings: Settings = {
      id,
      userId: insertSettings.userId,
      gohighlevelApiKey: insertSettings.gohighlevelApiKey ?? null,
      gohighlevelLocationId: insertSettings.gohighlevelLocationId ?? null,
      gohighlevelBaseUrl: insertSettings.gohighlevelBaseUrl ?? null,
      gohighlevelReturnsPipelineId: insertSettings.gohighlevelReturnsPipelineId ?? null,
      gohighlevelReturnsStageIssueRefundId: insertSettings.gohighlevelReturnsStageIssueRefundId ?? null,
      gohighlevelReturnsStageRefundedId: insertSettings.gohighlevelReturnsStageRefundedId ?? null,
      shopifyApiKey: insertSettings.shopifyApiKey ?? null,
      extensivApiKey: insertSettings.extensivApiKey ?? null,
      phantombusterApiKey: insertSettings.phantombusterApiKey ?? null,
      llmProvider: insertSettings.llmProvider ?? null,
      llmApiKey: insertSettings.llmApiKey ?? null,
      llmModel: insertSettings.llmModel ?? null,
      llmTemperature: insertSettings.llmTemperature ?? 0.7,
      llmMaxTokens: insertSettings.llmMaxTokens ?? 2048,
      llmCustomEndpoint: insertSettings.llmCustomEndpoint ?? null,
      llmPromptTemplate: insertSettings.llmPromptTemplate ?? null,
      enableLlmOrderRecommendations: insertSettings.enableLlmOrderRecommendations ?? false,
      enableLlmSupplierRanking: insertSettings.enableLlmSupplierRanking ?? false,
      enableLlmForecasting: insertSettings.enableLlmForecasting ?? false,
      enableVisionCapture: insertSettings.enableVisionCapture ?? false,
      visionProvider: insertSettings.visionProvider ?? null,
      visionModel: insertSettings.visionModel ?? null,
      aiVelocityLookbackDays: insertSettings.aiVelocityLookbackDays ?? 14,
      aiSafetyStockDays: insertSettings.aiSafetyStockDays ?? 7,
      aiRiskThresholdHighDays: insertSettings.aiRiskThresholdHighDays ?? 0,
      aiRiskThresholdMediumDays: insertSettings.aiRiskThresholdMediumDays ?? 7,
      aiReturnRateImpact: insertSettings.aiReturnRateImpact ?? 0.5,
      aiAdDemandImpact: insertSettings.aiAdDemandImpact ?? 0.2,
      aiSupplierDisputePenaltyDays: insertSettings.aiSupplierDisputePenaltyDays ?? 3,
      aiDefaultLeadTimeDays: insertSettings.aiDefaultLeadTimeDays ?? 7,
      aiMinOrderQuantity: insertSettings.aiMinOrderQuantity ?? 1,
      alertAdminEmail: insertSettings.alertAdminEmail ?? null,
      alertAdminPhone: insertSettings.alertAdminPhone ?? null,
      aiTokenRotationDays: insertSettings.aiTokenRotationDays ?? 90,
    };
    this.settings.set(id, settings);
    return settings;
  }

  async updateSettings(userId: string, updates: Partial<Omit<InsertSettings, 'userId'>>): Promise<Settings | undefined> {
    const existing = await this.getSettings(userId);
    if (!existing) return undefined;
    
    // Normalize empty strings to null
    const normalized = Object.fromEntries(
      Object.entries(updates).map(([key, value]) => [
        key,
        typeof value === 'string' && value.trim() === '' ? null : value
      ])
    ) as Partial<Omit<InsertSettings, 'userId'>>;
    
    const updated: Settings = { ...existing, ...normalized };
    this.settings.set(existing.id, updated);
    return updated;
  }

  // Integration Configs
  async getAllIntegrationConfigs(userId: string): Promise<IntegrationConfig[]> {
    return Array.from(this.integrationConfigs.values()).filter((c) => c.userId === userId);
  }

  async getIntegrationConfig(userId: string, provider: string): Promise<IntegrationConfig | undefined> {
    const normalizedProvider = provider.toUpperCase();
    return Array.from(this.integrationConfigs.values()).find((c) => c.userId === userId && c.provider === normalizedProvider);
  }

  async getIntegrationConfigById(id: string): Promise<IntegrationConfig | undefined> {
    return this.integrationConfigs.get(id);
  }

  async createIntegrationConfig(insertConfig: InsertIntegrationConfig): Promise<IntegrationConfig> {
    const id = randomUUID();
    const config: IntegrationConfig = {
      id,
      userId: insertConfig.userId,
      provider: insertConfig.provider,
      accountName: insertConfig.accountName ?? null,
      apiKey: insertConfig.apiKey ?? null,
      isEnabled: insertConfig.isEnabled ?? true,
      lastSyncAt: insertConfig.lastSyncAt ?? null,
      lastSyncStatus: insertConfig.lastSyncStatus ?? null,
      lastSyncMessage: insertConfig.lastSyncMessage ?? null,
      config: insertConfig.config ?? null,
      keyCreatedAt: insertConfig.keyCreatedAt ?? null,
      lastTokenCheckAt: insertConfig.lastTokenCheckAt ?? null,
      lastTokenCheckStatus: insertConfig.lastTokenCheckStatus ?? null,
      lastAlertSentAt: insertConfig.lastAlertSentAt ?? null,
      consecutiveFailures: insertConfig.consecutiveFailures ?? 0,
      tokenLastRotatedAt: insertConfig.tokenLastRotatedAt ?? null,
      tokenNextRotationAt: insertConfig.tokenNextRotationAt ?? null,
    };
    this.integrationConfigs.set(id, config);
    return config;
  }

  async updateIntegrationConfig(id: string, updates: Partial<InsertIntegrationConfig>): Promise<IntegrationConfig | undefined> {
    const existing = this.integrationConfigs.get(id);
    if (!existing) return undefined;
    const updated: IntegrationConfig = { ...existing, ...updates };
    this.integrationConfigs.set(id, updated);
    return updated;
  }

  async deleteIntegrationConfig(id: string): Promise<boolean> {
    return this.integrationConfigs.delete(id);
  }

  // Barcodes
  async getAllBarcodes(): Promise<Barcode[]> {
    return Array.from(this.barcodes.values());
  }

  async getBarcode(id: string): Promise<Barcode | undefined> {
    return this.barcodes.get(id);
  }

  async getBarcodeByValue(value: string): Promise<Barcode | undefined> {
    return Array.from(this.barcodes.values()).find((b) => b.value === value);
  }

  async createBarcode(insertBarcode: InsertBarcode): Promise<Barcode> {
    const id = randomUUID();
    const barcode: Barcode = {
      id,
      value: insertBarcode.value,
      name: insertBarcode.name,
      sku: insertBarcode.sku ?? null,
      purpose: insertBarcode.purpose,
      referenceId: insertBarcode.referenceId ?? null,
    };
    this.barcodes.set(id, barcode);
    return barcode;
  }

  async updateBarcode(id: string, updateData: Partial<InsertBarcode>): Promise<Barcode | undefined> {
    const barcode = this.barcodes.get(id);
    if (!barcode) return undefined;
    const updated = { ...barcode, ...updateData };
    this.barcodes.set(id, updated);
    return updated;
  }

  async deleteBarcode(id: string): Promise<boolean> {
    return this.barcodes.delete(id);
  }

  // Barcode Settings
  async getBarcodeSettings(): Promise<BarcodeSettings | undefined> {
    return this.barcodeSettings || undefined;
  }

  async createOrUpdateBarcodeSettings(settings: Partial<InsertBarcodeSettings>): Promise<BarcodeSettings> {
    if (!this.barcodeSettings) {
      this.barcodeSettings = {
        id: randomUUID(),
        gs1Prefix: settings.gs1Prefix ?? null,
        itemRefDigits: settings.itemRefDigits ?? 6,
        nextItemRef: settings.nextItemRef ?? 1,
        nextInternalCode: settings.nextInternalCode ?? 1000,
      };
    } else {
      this.barcodeSettings = {
        ...this.barcodeSettings,
        ...settings,
      };
    }
    return this.barcodeSettings;
  }

  async incrementItemRef(): Promise<number> {
    if (!this.barcodeSettings) {
      this.barcodeSettings = {
        id: randomUUID(),
        gs1Prefix: null,
        itemRefDigits: 6,
        nextItemRef: 1,
        nextInternalCode: 1000,
      };
    }
    const current = this.barcodeSettings.nextItemRef;
    this.barcodeSettings.nextItemRef = current + 1;
    return current;
  }

  async incrementInternalCode(): Promise<number> {
    if (!this.barcodeSettings) {
      this.barcodeSettings = {
        id: randomUUID(),
        gs1Prefix: null,
        itemRefDigits: 6,
        nextItemRef: 1,
        nextInternalCode: 1000,
      };
    }
    const current = this.barcodeSettings.nextInternalCode;
    this.barcodeSettings.nextInternalCode = current + 1;
    return current;
  }

  // Import Profiles
  async getAllImportProfiles(): Promise<ImportProfile[]> {
    return Array.from(this.importProfiles.values());
  }

  async getImportProfile(id: string): Promise<ImportProfile | undefined> {
    return this.importProfiles.get(id);
  }

  async createImportProfile(insertProfile: InsertImportProfile): Promise<ImportProfile> {
    const id = randomUUID();
    const profile: ImportProfile = {
      id,
      name: insertProfile.name,
      description: insertProfile.description ?? null,
      columnMappings: insertProfile.columnMappings,
      createdAt: new Date(),
    };
    this.importProfiles.set(id, profile);
    return profile;
  }

  async updateImportProfile(id: string, updateData: Partial<InsertImportProfile>): Promise<ImportProfile | undefined> {
    const profile = this.importProfiles.get(id);
    if (!profile) return undefined;
    const updated = { ...profile, ...updateData };
    this.importProfiles.set(id, updated);
    return updated;
  }

  async deleteImportProfile(id: string): Promise<boolean> {
    return this.importProfiles.delete(id);
  }

  // Import Jobs
  async getAllImportJobs(): Promise<ImportJob[]> {
    return Array.from(this.importJobs.values());
  }

  async getImportJob(id: string): Promise<ImportJob | undefined> {
    return this.importJobs.get(id);
  }

  async createImportJob(insertJob: InsertImportJob): Promise<ImportJob> {
    const id = randomUUID();
    const job: ImportJob = {
      id,
      profileId: insertJob.profileId ?? null,
      fileName: insertJob.fileName,
      status: insertJob.status ?? 'pending',
      startedAt: new Date(),
      finishedAt: insertJob.finishedAt ?? null,
      summary: insertJob.summary ?? null,
      errors: insertJob.errors ?? null,
    };
    this.importJobs.set(id, job);
    return job;
  }

  async updateImportJob(id: string, updateData: Partial<InsertImportJob>): Promise<ImportJob | undefined> {
    const job = this.importJobs.get(id);
    if (!job) return undefined;
    const updated = { ...job, ...updateData };
    this.importJobs.set(id, updated);
    return updated;
  }

  async deleteImportJob(id: string): Promise<boolean> {
    return this.importJobs.delete(id);
  }

  async getAllInventoryTransactions(): Promise<InventoryTransaction[]> {
    return Array.from(this.inventoryTransactions.values());
  }

  async getInventoryTransactionsByItem(itemId: string): Promise<InventoryTransaction[]> {
    return Array.from(this.inventoryTransactions.values())
      .filter(t => t.itemId === itemId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createInventoryTransaction(insertTransaction: InsertInventoryTransaction): Promise<InventoryTransaction> {
    const id = randomUUID();
    const transaction: InventoryTransaction = {
      id,
      itemId: insertTransaction.itemId,
      itemType: insertTransaction.itemType,
      type: insertTransaction.type,
      location: insertTransaction.location,
      quantity: insertTransaction.quantity,
      createdAt: new Date(),
      createdBy: insertTransaction.createdBy ?? null,
      notes: insertTransaction.notes ?? null,
    };
    this.inventoryTransactions.set(id, transaction);
    return transaction;
  }

  // AI Recommendations
  async getAllAIRecommendations(): Promise<AIRecommendation[]> {
    return Array.from(this.aiRecommendations.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getAIRecommendation(id: string): Promise<AIRecommendation | undefined> {
    return this.aiRecommendations.get(id);
  }

  async getAIRecommendationsByItem(itemId: string): Promise<AIRecommendation[]> {
    return Array.from(this.aiRecommendations.values())
      .filter(r => r.itemId === itemId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getAIRecommendationsByStatus(status: string): Promise<AIRecommendation[]> {
    return Array.from(this.aiRecommendations.values())
      .filter(r => r.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getActiveAIRecommendations(): Promise<AIRecommendation[]> {
    return Array.from(this.aiRecommendations.values())
      .filter(r => r.status === 'NEW' || r.status === 'ACCEPTED')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async upsertAIRecommendation(insertRecommendation: InsertAIRecommendation): Promise<AIRecommendation> {
    // Find existing recommendation for same item and type
    const existing = Array.from(this.aiRecommendations.values())
      .find(r => r.itemId === insertRecommendation.itemId && 
                 r.recommendationType === insertRecommendation.recommendationType &&
                 r.status === 'NEW');
    
    if (existing) {
      const updated: AIRecommendation = {
        ...existing,
        ...insertRecommendation,
        updatedAt: new Date(),
      };
      this.aiRecommendations.set(existing.id, updated);
      return updated;
    }
    
    return this.createAIRecommendation(insertRecommendation);
  }

  async updateAIRecommendationStatus(id: string, status: string): Promise<AIRecommendation | undefined> {
    const existing = this.aiRecommendations.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, status, updatedAt: new Date() };
    this.aiRecommendations.set(id, updated);
    return updated;
  }

  async clearStaleRecommendations(itemId: string): Promise<void> {
    const toDelete = Array.from(this.aiRecommendations.entries())
      .filter(([_, r]) => r.itemId === itemId && r.status === 'NEW');
    for (const [id] of toDelete) {
      this.aiRecommendations.delete(id);
    }
  }

  async createAIRecommendation(insertRecommendation: InsertAIRecommendation): Promise<AIRecommendation> {
    const id = randomUUID();
    const now = new Date();
    const recommendation: AIRecommendation = {
      id,
      sku: insertRecommendation.sku,
      itemId: insertRecommendation.itemId,
      productName: insertRecommendation.productName,
      recommendationType: insertRecommendation.recommendationType,
      riskLevel: insertRecommendation.riskLevel,
      daysUntilStockout: insertRecommendation.daysUntilStockout ?? null,
      availableForSale: insertRecommendation.availableForSale ?? 0,
      recommendedQty: insertRecommendation.recommendedQty ?? 0,
      stockGapPercent: insertRecommendation.stockGapPercent ?? null,
      qtyOnPo: insertRecommendation.qtyOnPo ?? 0,
      status: insertRecommendation.status ?? 'NEW',
      reasonSummary: insertRecommendation.reasonSummary ?? null,
      sourceSignals: insertRecommendation.sourceSignals ?? null,
      adMultiplier: insertRecommendation.adMultiplier ?? 1.0,
      baseVelocity: insertRecommendation.baseVelocity ?? null,
      adjustedVelocity: insertRecommendation.adjustedVelocity ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.aiRecommendations.set(id, recommendation);
    return recommendation;
  }

  async updateAIRecommendation(id: string, update: Partial<InsertAIRecommendation>): Promise<AIRecommendation | undefined> {
    const existing = this.aiRecommendations.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...update, updatedAt: new Date() };
    this.aiRecommendations.set(id, updated);
    return updated;
  }

  // Purchase Orders
  async getAllPurchaseOrders(): Promise<PurchaseOrder[]> {
    return Array.from(this.purchaseOrders.values());
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined> {
    return this.purchaseOrders.get(id);
  }

  async getPurchaseOrdersBySupplierId(supplierId: string): Promise<PurchaseOrder[]> {
    return Array.from(this.purchaseOrders.values())
      .filter(po => po.supplierId === supplierId);
  }

  async createPurchaseOrder(insertPO: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const id = randomUUID();
    const po: PurchaseOrder = {
      id,
      ...insertPO,
      orderDate: insertPO.orderDate ?? new Date(),
      approvedAt: insertPO.approvedAt ?? null,
      sentAt: insertPO.sentAt ?? null,
      expectedDate: insertPO.expectedDate ?? null,
      receivedAt: insertPO.receivedAt ?? null,
      paidAt: insertPO.paidAt ?? null,
      status: insertPO.status ?? 'DRAFT',
      hasIssue: insertPO.hasIssue ?? false,
      issueStatus: insertPO.issueStatus ?? 'NONE',
      issueOpenedAt: insertPO.issueOpenedAt ?? null,
      issueResolvedAt: insertPO.issueResolvedAt ?? null,
      issueType: insertPO.issueType ?? null,
      issueNotes: insertPO.issueNotes ?? null,
      refundStatus: insertPO.refundStatus ?? 'NONE',
      refundAmount: insertPO.refundAmount ?? 0,
      notes: insertPO.notes ?? null,
      ghlRepName: insertPO.ghlRepName ?? null,
    };
    this.purchaseOrders.set(id, po);
    return po;
  }

  async updatePurchaseOrder(id: string, updates: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const po = this.purchaseOrders.get(id);
    if (!po) return undefined;
    const updated = { ...po, ...updates };
    this.purchaseOrders.set(id, updated);
    return updated;
  }

  async deletePurchaseOrder(id: string): Promise<boolean> {
    return this.purchaseOrders.delete(id);
  }

  // Purchase Order Lines
  async getAllPurchaseOrderLines(): Promise<PurchaseOrderLine[]> {
    return Array.from(this.purchaseOrderLines.values());
  }

  async getPurchaseOrderLinesByPOId(purchaseOrderId: string): Promise<PurchaseOrderLine[]> {
    return Array.from(this.purchaseOrderLines.values())
      .filter(line => line.purchaseOrderId === purchaseOrderId);
  }

  async createPurchaseOrderLine(insertLine: InsertPurchaseOrderLine): Promise<PurchaseOrderLine> {
    const id = randomUUID();
    const line: PurchaseOrderLine = {
      id,
      ...insertLine,
      qtyReceived: insertLine.qtyReceived ?? 0,
      unitCost: insertLine.unitCost ?? null,
      aiRecommendationId: insertLine.aiRecommendationId ?? null,
      recommendedQtyAtOrderTime: insertLine.recommendedQtyAtOrderTime ?? null,
      finalOrderedQty: insertLine.finalOrderedQty ?? null,
    };
    this.purchaseOrderLines.set(id, line);
    return line;
  }

  async updatePurchaseOrderLine(id: string, updates: Partial<InsertPurchaseOrderLine>): Promise<PurchaseOrderLine | undefined> {
    const line = this.purchaseOrderLines.get(id);
    if (!line) return undefined;
    const updated = { ...line, ...updates };
    this.purchaseOrderLines.set(id, updated);
    return updated;
  }

  async deletePurchaseOrderLine(id: string): Promise<boolean> {
    return this.purchaseOrderLines.delete(id);
  }

  async getPurchaseOrderLine(id: string): Promise<PurchaseOrderLine | undefined> {
    return this.purchaseOrderLines.get(id);
  }

  async deletePurchaseOrderLinesByPOId(purchaseOrderId: string): Promise<boolean> {
    const linesToDelete = Array.from(this.purchaseOrderLines.entries())
      .filter(([, line]) => line.purchaseOrderId === purchaseOrderId);
    linesToDelete.forEach(([id]) => this.purchaseOrderLines.delete(id));
    return linesToDelete.length > 0;
  }

  // Purchase Order Receipts (stub implementations - MemStorage not used in production)
  async getAllPurchaseOrderReceipts(): Promise<PurchaseOrderReceipt[]> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  async getPurchaseOrderReceiptsByPOId(_purchaseOrderId: string): Promise<PurchaseOrderReceipt[]> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  async getPurchaseOrderReceipt(_id: string): Promise<PurchaseOrderReceipt | undefined> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  async createPurchaseOrderReceipt(_receipt: InsertPurchaseOrderReceipt): Promise<PurchaseOrderReceipt> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  async updatePurchaseOrderReceipt(_id: string, _updates: Partial<InsertPurchaseOrderReceipt>): Promise<PurchaseOrderReceipt | undefined> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  async deletePurchaseOrderReceipt(_id: string): Promise<boolean> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  // Purchase Order Receipt Lines (stub implementations)
  async getPurchaseOrderReceiptLinesByReceiptId(_receiptId: string): Promise<PurchaseOrderReceiptLine[]> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  async getPurchaseOrderReceiptLinesByPOLineId(_purchaseOrderLineId: string): Promise<PurchaseOrderReceiptLine[]> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  async createPurchaseOrderReceiptLine(_line: InsertPurchaseOrderReceiptLine): Promise<PurchaseOrderReceiptLine> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  async updatePurchaseOrderReceiptLine(_id: string, _updates: Partial<InsertPurchaseOrderReceiptLine>): Promise<PurchaseOrderReceiptLine | undefined> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  async deletePurchaseOrderReceiptLine(_id: string): Promise<boolean> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  // PO Helper Methods (stub implementations)
  async getNextPONumber(): Promise<string> {
    const year = new Date().getFullYear();
    return `PO-${year}-0001`;
  }

  async recalculatePOTotals(_purchaseOrderId: string): Promise<PurchaseOrder | undefined> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  async updatePOLineReceivedQty(_purchaseOrderLineId: string): Promise<PurchaseOrderLine | undefined> {
    throw new Error("Not implemented in MemStorage - use DatabaseStorage");
  }

  // Supplier Leads
  async getAllSupplierLeads(): Promise<SupplierLead[]> {
    return Array.from(this.supplierLeads.values());
  }

  async getSupplierLead(id: string): Promise<SupplierLead | undefined> {
    return this.supplierLeads.get(id);
  }

  async getSupplierLeadsByStatus(status: string): Promise<SupplierLead[]> {
    return Array.from(this.supplierLeads.values())
      .filter(lead => lead.status === status);
  }

  async getSupplierLeadsByPhantomRunId(phantomRunId: string): Promise<SupplierLead[]> {
    return Array.from(this.supplierLeads.values())
      .filter(lead => lead.phantomRunId === phantomRunId);
  }

  async createSupplierLead(insertLead: InsertSupplierLead): Promise<SupplierLead> {
    const id = randomUUID();
    const lead: SupplierLead = {
      id,
      ...insertLead,
      source: insertLead.source ?? 'MANUAL',
      status: insertLead.status ?? 'NEW',
      websiteUrl: insertLead.websiteUrl ?? null,
      contactEmail: insertLead.contactEmail ?? null,
      contactPhone: insertLead.contactPhone ?? null,
      category: insertLead.category ?? null,
      notes: insertLead.notes ?? null,
      lastContactedAt: insertLead.lastContactedAt ?? null,
      aiOutreachDraft: insertLead.aiOutreachDraft ?? null,
      convertedSupplierId: insertLead.convertedSupplierId ?? null,
      createdAt: new Date(),
    };
    this.supplierLeads.set(id, lead);
    return lead;
  }

  async upsertSupplierLead(insertLead: InsertSupplierLead): Promise<SupplierLead> {
    // Find existing lead by email or website URL for deduplication
    const existing = Array.from(this.supplierLeads.values()).find(lead => {
      if (insertLead.contactEmail && lead.contactEmail === insertLead.contactEmail) return true;
      if (insertLead.websiteUrl && lead.websiteUrl === insertLead.websiteUrl) return true;
      return false;
    });

    if (existing) {
      // Update existing lead with new data
      const updated = {
        ...existing,
        ...insertLead,
        id: existing.id, // Preserve original ID
        createdAt: existing.createdAt, // Preserve creation date
      };
      this.supplierLeads.set(existing.id, updated);
      return updated;
    }

    // Create new lead if no duplicate found
    return this.createSupplierLead(insertLead);
  }

  async updateSupplierLead(id: string, updates: Partial<InsertSupplierLead>): Promise<SupplierLead | undefined> {
    const lead = this.supplierLeads.get(id);
    if (!lead) return undefined;
    const updated = { ...lead, ...updates };
    this.supplierLeads.set(id, updated);
    return updated;
  }

  async deleteSupplierLead(id: string): Promise<boolean> {
    return this.supplierLeads.delete(id);
  }

  // Return Requests
  async getAllReturnRequests(): Promise<ReturnRequest[]> {
    return Array.from(this.returnRequests.values());
  }

  async getReturnRequest(id: string): Promise<ReturnRequest | undefined> {
    return this.returnRequests.get(id);
  }

  async createReturnRequest(insertRequest: InsertReturnRequest): Promise<ReturnRequest> {
    const id = randomUUID();
    const now = new Date();
    const request: ReturnRequest = {
      id,
      ...insertRequest,
      source: insertRequest.source ?? 'WEB',
      orderNumber: insertRequest.orderNumber ?? null,
      shippingAddress: insertRequest.shippingAddress ?? null,
      warehouseLocationCode: insertRequest.warehouseLocationCode ?? null,
      salesOrderId: insertRequest.salesOrderId ?? null,
      status: insertRequest.status ?? 'OPEN',
      resolutionFinal: insertRequest.resolutionFinal ?? null,
      reason: insertRequest.reason ?? null,
      customerEmail: insertRequest.customerEmail ?? null,
      customerPhone: insertRequest.customerPhone ?? null,
      ghlContactId: insertRequest.ghlContactId ?? null,
      labelProvider: insertRequest.labelProvider ?? null,
      initiatedVia: insertRequest.initiatedVia ?? 'MANUAL_UI',
      createdAt: now,
      updatedAt: now,
    };
    this.returnRequests.set(id, request);
    return request;
  }

  async updateReturnRequest(id: string, updates: Partial<InsertReturnRequest>): Promise<ReturnRequest | undefined> {
    const request = this.returnRequests.get(id);
    if (!request) return undefined;
    const updated = { ...request, ...updates, updatedAt: new Date() };
    this.returnRequests.set(id, updated);
    return updated;
  }

  async getReturnRequestsBySalesOrderId(salesOrderId: string): Promise<ReturnRequest[]> {
    return Array.from(this.returnRequests.values())
      .filter(request => request.salesOrderId === salesOrderId);
  }

  async receiveReturn(returnId: string, itemUpdates: { itemId: string; qtyReceived: number }[]): Promise<ReturnRequest> {
    const returnRequest = this.returnRequests.get(returnId);
    if (!returnRequest) {
      throw new Error(`Return request ${returnId} not found`);
    }

    const returnItems = await this.getReturnItemsByRequestId(returnId);

    for (const update of itemUpdates) {
      const returnItem = returnItems.find(item => item.inventoryItemId === update.itemId);
      if (!returnItem) {
        throw new Error(`Return item for inventory item ${update.itemId} not found in return request ${returnId}`);
      }

      await this.updateReturnItem(returnItem.id, {
        qtyReceived: update.qtyReceived,
      });

      if (returnItem.disposition === 'RETURN_TO_STOCK' && update.qtyReceived > 0) {
        const item = await this.getItem(update.itemId);
        if (!item) {
          throw new Error(`Item ${update.itemId} not found`);
        }

        const updatedStock = (item.currentStock ?? 0) + update.qtyReceived;
        await this.updateItem(update.itemId, {
          currentStock: updatedStock,
        });

        await this.createInventoryTransaction({
          itemId: update.itemId,
          type: 'RECEIVE',
          quantity: update.qtyReceived,
          itemType: item.type === 'finished_product' ? 'FINISHED' : 'RAW',
          location: 'HILDALE',
          notes: `Return received: ${returnRequest.externalOrderId}`,
          createdBy: 'SYSTEM',
        });
      }
    }

    const updatedReturnItems = await this.getReturnItemsByRequestId(returnId);
    const allItemsReceived = updatedReturnItems.every(item => item.qtyReceived >= item.qtyApproved);
    const anyItemsReceived = updatedReturnItems.some(item => item.qtyReceived > 0);
    
    // Status progression:
    // - All items received + final resolution → COMPLETED
    // - Any items received (partial or full, no resolution) → RECEIVED_AT_WAREHOUSE
    // - No items received yet → Keep current status (OPEN, LABEL_CREATED, IN_TRANSIT)
    let newStatus: string = returnRequest.status; // Default to current status
    
    if (allItemsReceived && returnRequest.resolutionFinal) {
      newStatus = 'COMPLETED';
    } else if (anyItemsReceived) {
      newStatus = 'RECEIVED_AT_WAREHOUSE';
    }
    // else: no items received yet - keep existing status

    const updated = { ...returnRequest, status: newStatus, updatedAt: new Date() };
    this.returnRequests.set(returnId, updated);
    return updated;
  }

  // Return Items
  async getReturnItemsByRequestId(returnRequestId: string): Promise<ReturnItem[]> {
    return Array.from(this.returnItems.values())
      .filter(item => item.returnRequestId === returnRequestId);
  }

  async createReturnItem(insertItem: InsertReturnItem): Promise<ReturnItem> {
    const id = randomUUID();
    const item: ReturnItem = {
      id,
      ...insertItem,
      salesOrderLineId: insertItem.salesOrderLineId ?? null,
      itemReason: insertItem.itemReason ?? null,
      condition: insertItem.condition ?? null,
      qtyApproved: insertItem.qtyApproved ?? 0,
      qtyReceived: insertItem.qtyReceived ?? 0,
      disposition: insertItem.disposition ?? null,
      notes: insertItem.notes ?? null,
    };
    this.returnItems.set(id, item);
    return item;
  }

  async updateReturnItem(id: string, updates: Partial<InsertReturnItem>): Promise<ReturnItem | undefined> {
    const item = this.returnItems.get(id);
    if (!item) return undefined;
    const updated = { ...item, ...updates };
    this.returnItems.set(id, updated);
    return updated;
  }

  // Return Shipments
  async getReturnShipmentsByRequestId(returnRequestId: string): Promise<ReturnShipment[]> {
    return Array.from(this.returnShipments.values())
      .filter(shipment => shipment.returnRequestId === returnRequestId);
  }

  async createReturnShipment(insertShipment: InsertReturnShipment): Promise<ReturnShipment> {
    const id = randomUUID();
    const now = new Date();
    const shipment: ReturnShipment = {
      id,
      ...insertShipment,
      status: insertShipment.status ?? 'LABEL_CREATED',
      createdAt: now,
      updatedAt: now,
    };
    this.returnShipments.set(id, shipment);
    return shipment;
  }

  async updateReturnShipment(id: string, updates: Partial<InsertReturnShipment>): Promise<ReturnShipment | undefined> {
    const shipment = this.returnShipments.get(id);
    if (!shipment) return undefined;
    const updated = { ...shipment, ...updates, updatedAt: new Date() };
    this.returnShipments.set(id, updated);
    return updated;
  }

  // Return Events
  async getReturnEventsByRequestId(returnRequestId: string): Promise<ReturnEvent[]> {
    return Array.from(this.returnEvents.values())
      .filter(e => e.returnRequestId === returnRequestId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createReturnEvent(insertEvent: InsertReturnEvent): Promise<ReturnEvent> {
    const id = randomUUID();
    const event: ReturnEvent = {
      ...insertEvent,
      id,
      createdAt: new Date(),
    };
    this.returnEvents.set(id, event);
    return event;
  }

  // Shippo Label Logs (Stubs - MemStorage not used in production)
  private shippoLabelLogs: Map<string, ShippoLabelLog> = new Map();

  async getAllShippoLabelLogs(): Promise<ShippoLabelLog[]> {
    return Array.from(this.shippoLabelLogs.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getShippoLabelLog(id: string): Promise<ShippoLabelLog | undefined> {
    return this.shippoLabelLogs.get(id);
  }

  async getShippoLabelLogByScanCode(scanCode: string): Promise<ShippoLabelLog | undefined> {
    return Array.from(this.shippoLabelLogs.values()).find(log => log.scanCode === scanCode);
  }

  async getShippoLabelLogByTrackingNumber(trackingNumber: string): Promise<ShippoLabelLog | undefined> {
    return Array.from(this.shippoLabelLogs.values()).find(log => log.trackingNumber === trackingNumber);
  }

  async getShippoLabelLogsByReturnId(returnRequestId: string): Promise<ShippoLabelLog[]> {
    return Array.from(this.shippoLabelLogs.values())
      .filter(log => log.returnRequestId === returnRequestId);
  }

  async getShippoLabelLogsBySalesOrderId(salesOrderId: string): Promise<ShippoLabelLog[]> {
    return Array.from(this.shippoLabelLogs.values())
      .filter(log => log.salesOrderId === salesOrderId);
  }

  async createShippoLabelLog(insertLog: InsertShippoLabelLog): Promise<ShippoLabelLog> {
    const id = randomUUID();
    const now = new Date();
    const log: ShippoLabelLog = {
      id,
      type: insertLog.type ?? 'RETURN',
      shippoShipmentId: insertLog.shippoShipmentId ?? null,
      shippoTransactionId: insertLog.shippoTransactionId ?? null,
      labelUrl: insertLog.labelUrl ?? null,
      trackingNumber: insertLog.trackingNumber ?? null,
      carrier: insertLog.carrier ?? null,
      serviceLevel: insertLog.serviceLevel ?? null,
      labelCost: insertLog.labelCost ?? null,
      labelCurrency: insertLog.labelCurrency ?? 'USD',
      status: insertLog.status ?? 'CREATED',
      scanCode: insertLog.scanCode ?? null,
      scannedAt: insertLog.scannedAt ?? null,
      scannedBy: insertLog.scannedBy ?? null,
      barcodeId: insertLog.barcodeId ?? null,
      sku: insertLog.sku ?? null,
      salesOrderId: insertLog.salesOrderId ?? null,
      returnRequestId: insertLog.returnRequestId ?? null,
      channel: insertLog.channel ?? null,
      customerName: insertLog.customerName ?? null,
      customerEmail: insertLog.customerEmail ?? null,
      orderDate: insertLog.orderDate ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.shippoLabelLogs.set(id, log);
    return log;
  }

  async updateShippoLabelLog(id: string, updates: Partial<InsertShippoLabelLog>): Promise<ShippoLabelLog | undefined> {
    const log = this.shippoLabelLogs.get(id);
    if (!log) return undefined;
    const updated = { ...log, ...updates, updatedAt: new Date() };
    this.shippoLabelLogs.set(id, updated);
    return updated;
  }

  async searchShippoLabelLogs(params: { search?: string; page?: number; pageSize?: number }): Promise<{ logs: ShippoLabelLog[]; total: number }> {
    let logs = Array.from(this.shippoLabelLogs.values());
    if (params.search) {
      const s = params.search.toLowerCase();
      logs = logs.filter(l =>
        l.trackingNumber?.toLowerCase().includes(s) ||
        l.sku?.toLowerCase().includes(s) ||
        l.customerName?.toLowerCase().includes(s) ||
        l.salesOrderId?.toLowerCase().includes(s) ||
        l.returnRequestId?.toLowerCase().includes(s)
      );
    }
    const total = logs.length;
    logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 50;
    const start = (page - 1) * pageSize;
    return { logs: logs.slice(start, start + pageSize), total };
  }

  // Return Helper Methods
  async getNextRMANumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `RMA-${year}-`;
    const allReturns = Array.from(this.returnRequests.values());
    const yearReturns = allReturns.filter(r => r.rmaNumber?.startsWith(prefix));
    let maxNum = 0;
    for (const r of yearReturns) {
      const match = r.rmaNumber?.match(/RMA-\d{4}-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    return `${prefix}${String(maxNum + 1).padStart(6, '0')}`;
  }

  async getReturnRequestByRMANumber(rmaNumber: string): Promise<ReturnRequest | undefined> {
    return Array.from(this.returnRequests.values()).find(r => r.rmaNumber === rmaNumber);
  }

  async getReturnRequestByExternalOrderId(externalOrderId: string): Promise<ReturnRequest[]> {
    return Array.from(this.returnRequests.values()).filter(r => r.externalOrderId === externalOrderId);
  }

  // Channels (Stubs - MemStorage not used in production)
  async getAllChannels(): Promise<Channel[]> {
    throw new Error("Channels not supported in MemStorage");
  }

  async getChannel(id: string): Promise<Channel | undefined> {
    throw new Error("Channels not supported in MemStorage");
  }

  async getChannelByCode(code: string): Promise<Channel | undefined> {
    throw new Error("Channels not supported in MemStorage");
  }

  async createChannel(channel: InsertChannel): Promise<Channel> {
    throw new Error("Channels not supported in MemStorage");
  }

  async updateChannel(id: string, channel: Partial<InsertChannel>): Promise<Channel | undefined> {
    throw new Error("Channels not supported in MemStorage");
  }

  // Product Channel Mappings (Stubs)
  async getAllProductChannelMappings(): Promise<ProductChannelMapping[]> {
    throw new Error("Product channel mappings not supported in MemStorage");
  }

  async getProductChannelMappingsByProduct(productId: string): Promise<ProductChannelMapping[]> {
    throw new Error("Product channel mappings not supported in MemStorage");
  }

  async getProductChannelMappingsByChannel(channelId: string): Promise<ProductChannelMapping[]> {
    throw new Error("Product channel mappings not supported in MemStorage");
  }

  async getProductChannelMapping(productId: string, channelId: string): Promise<ProductChannelMapping | undefined> {
    throw new Error("Product channel mappings not supported in MemStorage");
  }

  async createProductChannelMapping(mapping: InsertProductChannelMapping): Promise<ProductChannelMapping> {
    throw new Error("Product channel mappings not supported in MemStorage");
  }

  async updateProductChannelMapping(id: string, mapping: Partial<InsertProductChannelMapping>): Promise<ProductChannelMapping | undefined> {
    throw new Error("Product channel mappings not supported in MemStorage");
  }

  async deleteProductChannelMapping(id: string): Promise<boolean> {
    throw new Error("Product channel mappings not supported in MemStorage");
  }

  // Ad Performance Snapshots (Stubs)
  async getAllAdPerformanceSnapshots(): Promise<AdPerformanceSnapshot[]> {
    throw new Error("Ad performance snapshots not supported in MemStorage");
  }

  async getAdPerformanceSnapshotsByProduct(productId: string, startDate?: Date, endDate?: Date): Promise<AdPerformanceSnapshot[]> {
    throw new Error("Ad performance snapshots not supported in MemStorage");
  }

  async getAdPerformanceSnapshotsByChannel(channelId: string, startDate?: Date, endDate?: Date): Promise<AdPerformanceSnapshot[]> {
    throw new Error("Ad performance snapshots not supported in MemStorage");
  }

  async upsertAdPerformanceSnapshot(snapshot: InsertAdPerformanceSnapshot): Promise<AdPerformanceSnapshot> {
    throw new Error("Ad performance snapshots not supported in MemStorage");
  }

  // Sales Snapshots (Stubs)
  async getAllSalesSnapshots(): Promise<SalesSnapshot[]> {
    throw new Error("Sales snapshots not supported in MemStorage");
  }

  async getSalesSnapshotsByProduct(productId: string, startDate?: Date, endDate?: Date): Promise<SalesSnapshot[]> {
    throw new Error("Sales snapshots not supported in MemStorage");
  }

  async getSalesSnapshotsByChannel(channelId: string, startDate?: Date, endDate?: Date): Promise<SalesSnapshot[]> {
    throw new Error("Sales snapshots not supported in MemStorage");
  }

  async upsertSalesSnapshot(snapshot: InsertSalesSnapshot): Promise<SalesSnapshot> {
    throw new Error("Sales snapshots not supported in MemStorage");
  }

  // Product Forecast Context (Stubs)
  async getAllProductForecastContexts(): Promise<ProductForecastContext[]> {
    throw new Error("Product forecast context not supported in MemStorage");
  }

  async getProductForecastContext(productId: string): Promise<ProductForecastContext | undefined> {
    throw new Error("Product forecast context not supported in MemStorage");
  }

  async upsertProductForecastContext(context: InsertProductForecastContext): Promise<ProductForecastContext> {
    throw new Error("Product forecast context not supported in MemStorage");
  }

  async refreshProductForecastContext(productId: string): Promise<ProductForecastContext> {
    throw new Error("Product forecast context not supported in MemStorage");
  }

  async refreshAllProductForecastContexts(): Promise<void> {
    throw new Error("Product forecast context not supported in MemStorage");
  }

  // Sales Orders
  async getAllSalesOrders(): Promise<SalesOrder[]> {
    return Array.from(this.salesOrders.values());
  }

  async getSalesOrder(id: string): Promise<SalesOrder | undefined> {
    return this.salesOrders.get(id);
  }

  async getSalesOrdersByExternalId(channel: string, externalOrderId: string): Promise<SalesOrder[]> {
    return Array.from(this.salesOrders.values()).filter(
      order => order.channel === channel && order.externalOrderId === externalOrderId
    );
  }

  async getSalesOrderWithLines(id: string): Promise<(SalesOrder & { lines: SalesOrderLine[] }) | undefined> {
    const order = this.salesOrders.get(id);
    if (!order) return undefined;
    
    const lines = Array.from(this.salesOrderLines.values())
      .filter(line => line.salesOrderId === id);
    
    return { ...order, lines };
  }

  async createSalesOrder(insertOrder: InsertSalesOrder): Promise<SalesOrder> {
    const id = randomUUID();
    const now = new Date();
    const order: SalesOrder = {
      id,
      ...insertOrder,
      externalOrderId: insertOrder.externalOrderId ?? null,
      externalCustomerId: insertOrder.externalCustomerId ?? null,
      status: insertOrder.status ?? 'DRAFT',
      orderDate: insertOrder.orderDate ?? now,
      customerEmail: insertOrder.customerEmail ?? null,
      customerPhone: insertOrder.customerPhone ?? null,
      ghlContactId: insertOrder.ghlContactId ?? null,
      requiredByDate: insertOrder.requiredByDate ?? null,
      totalAmount: insertOrder.totalAmount ?? 0,
      currency: insertOrder.currency ?? 'USD',
      notes: insertOrder.notes ?? null,
      rawPayload: insertOrder.rawPayload ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.salesOrders.set(id, order);
    return order;
  }

  async updateSalesOrder(id: string, updates: Partial<InsertSalesOrder>): Promise<SalesOrder | undefined> {
    const order = this.salesOrders.get(id);
    if (!order) return undefined;
    const updated = { ...order, ...updates, updatedAt: new Date() };
    this.salesOrders.set(id, updated);
    return updated;
  }

  async deleteSalesOrder(id: string): Promise<boolean> {
    return this.salesOrders.delete(id);
  }

  // Sales Order Lines
  async getSalesOrderLines(salesOrderId: string): Promise<SalesOrderLine[]> {
    return Array.from(this.salesOrderLines.values())
      .filter(line => line.salesOrderId === salesOrderId);
  }

  async getSalesOrderLine(id: string): Promise<SalesOrderLine | undefined> {
    return this.salesOrderLines.get(id);
  }

  async createSalesOrderLine(insertLine: InsertSalesOrderLine): Promise<SalesOrderLine> {
    const id = randomUUID();
    const line: SalesOrderLine = {
      id,
      ...insertLine,
      qtyAllocated: insertLine.qtyAllocated ?? 0,
      qtyShipped: insertLine.qtyShipped ?? 0,
      backorderQty: insertLine.backorderQty ?? 0,
      unitPrice: insertLine.unitPrice ?? null,
      notes: insertLine.notes ?? null,
    };
    this.salesOrderLines.set(id, line);
    return line;
  }

  async updateSalesOrderLine(id: string, updates: Partial<InsertSalesOrderLine>): Promise<SalesOrderLine | undefined> {
    const line = this.salesOrderLines.get(id);
    if (!line) return undefined;
    const updated = { ...line, ...updates };
    this.salesOrderLines.set(id, updated);
    return updated;
  }

  async deleteSalesOrderLine(id: string): Promise<boolean> {
    return this.salesOrderLines.delete(id);
  }

  async getOpenBackorderLinesByProduct(productId: string): Promise<SalesOrderLine[]> {
    const allLines = Array.from(this.salesOrderLines.values())
      .filter(line => line.productId === productId && (line.backorderQty ?? 0) > 0);
    
    const openLines: SalesOrderLine[] = [];
    for (const line of allLines) {
      const order = await this.getSalesOrder(line.salesOrderId);
      if (order && order.status !== 'CANCELLED' && order.status !== 'FULFILLED') {
        openLines.push(line);
      }
    }
    return openLines.sort((a, b) => {
      const orderA = this.salesOrders.get(a.salesOrderId);
      const orderB = this.salesOrders.get(b.salesOrderId);
      return (orderA?.orderDate?.getTime() ?? 0) - (orderB?.orderDate?.getTime() ?? 0);
    });
  }

  // Backorder Snapshots
  async getAllBackorderSnapshots(): Promise<BackorderSnapshot[]> {
    return Array.from(this.backorderSnapshots.values());
  }

  async getBackorderSnapshot(productId: string): Promise<BackorderSnapshot | undefined> {
    return Array.from(this.backorderSnapshots.values())
      .find(snapshot => snapshot.productId === productId);
  }

  async upsertBackorderSnapshot(insertSnapshot: InsertBackorderSnapshot): Promise<BackorderSnapshot> {
    const existing = await this.getBackorderSnapshot(insertSnapshot.productId);
    
    if (existing) {
      const updated: BackorderSnapshot = {
        ...existing,
        totalBackorderedQty: insertSnapshot.totalBackorderedQty ?? 0,
        lastUpdatedAt: new Date(),
      };
      this.backorderSnapshots.set(existing.id, updated);
      return updated;
    }
    
    const id = randomUUID();
    const snapshot: BackorderSnapshot = {
      id,
      productId: insertSnapshot.productId,
      totalBackorderedQty: insertSnapshot.totalBackorderedQty ?? 0,
      lastUpdatedAt: new Date(),
    };
    this.backorderSnapshots.set(id, snapshot);
    return snapshot;
  }

  async refreshBackorderSnapshot(productId: string): Promise<BackorderSnapshot> {
    const lines = Array.from(this.salesOrderLines.values())
      .filter(line => line.productId === productId);
    
    const nonCancelledLines = await Promise.all(
      lines.map(async (line) => {
        const order = await this.getSalesOrder(line.salesOrderId);
        return order && order.status !== 'CANCELLED' ? line : null;
      })
    );
    
    const totalBackorderedQty = nonCancelledLines
      .filter((line): line is SalesOrderLine => line !== null)
      .reduce((sum, line) => sum + (line.backorderQty || 0), 0);
    
    return await this.upsertBackorderSnapshot({
      productId,
      totalBackorderedQty,
    });
  }

  async refreshAllBackorderSnapshots(): Promise<void> {
    const allProducts = Array.from(this.items.values())
      .filter(item => item.type === 'finished_product');
    
    for (const product of allProducts) {
      await this.refreshBackorderSnapshot(product.id);
    }
  }

  // Audit Logs
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const id = randomUUID();
    const auditLog: AuditLog = {
      id,
      timestamp: new Date(),
      actorType: log.actorType,
      actorId: log.actorId ?? null,
      eventType: log.eventType,
      entityType: log.entityType ?? null,
      entityId: log.entityId ?? null,
      purchaseOrderId: log.purchaseOrderId ?? null,
      supplierId: log.supplierId ?? null,
      success: log.success ?? true,
      errorMessage: log.errorMessage ?? null,
      details: log.details ?? null,
    };
    this.auditLogs.set(id, auditLog);
    return auditLog;
  }

  async getAuditLogs(options?: { 
    limit?: number; 
    offset?: number; 
    source?: string;
    eventType?: string; 
    entityType?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
    search?: string;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    let logs = Array.from(this.auditLogs.values());
    
    if (options?.source) {
      logs = logs.filter(log => log.source === options.source);
    }
    if (options?.eventType) {
      logs = logs.filter(log => log.eventType === options.eventType);
    }
    if (options?.entityType) {
      logs = logs.filter(log => log.entityType === options.entityType);
    }
    if (options?.status) {
      logs = logs.filter(log => log.status === options.status);
    }
    if (options?.dateFrom) {
      logs = logs.filter(log => log.timestamp && log.timestamp >= options.dateFrom!);
    }
    if (options?.dateTo) {
      logs = logs.filter(log => log.timestamp && log.timestamp <= options.dateTo!);
    }
    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      logs = logs.filter(log => 
        (log.description?.toLowerCase().includes(searchLower)) ||
        (log.entityId?.toLowerCase().includes(searchLower)) ||
        (log.entityLabel?.toLowerCase().includes(searchLower))
      );
    }
    
    const total = logs.length;
    logs.sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0));
    
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    return { logs: logs.slice(offset, offset + limit), total };
  }

  async getAuditLogsByPurchaseOrder(purchaseOrderId: string): Promise<AuditLog[]> {
    return Array.from(this.auditLogs.values())
      .filter(log => log.purchaseOrderId === purchaseOrderId)
      .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0));
  }

  async countAuditLogs(options?: { 
    source?: string;
    eventType?: string; 
    entityType?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
    search?: string;
  }): Promise<number> {
    let logs = Array.from(this.auditLogs.values());
    
    if (options?.source) {
      logs = logs.filter(log => log.source === options.source);
    }
    if (options?.eventType) {
      logs = logs.filter(log => log.eventType === options.eventType);
    }
    if (options?.entityType) {
      logs = logs.filter(log => log.entityType === options.entityType);
    }
    if (options?.status) {
      logs = logs.filter(log => log.status === options.status);
    }
    if (options?.dateFrom) {
      logs = logs.filter(log => log.timestamp && log.timestamp >= options.dateFrom!);
    }
    if (options?.dateTo) {
      logs = logs.filter(log => log.timestamp && log.timestamp <= options.dateTo!);
    }
    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      logs = logs.filter(log => 
        (log.description?.toLowerCase().includes(searchLower)) ||
        (log.entityId?.toLowerCase().includes(searchLower)) ||
        (log.entityLabel?.toLowerCase().includes(searchLower))
      );
    }
    
    return logs.length;
  }

  // AI System Recommendations (in-memory storage)
  private aiSystemRecommendations: Map<string, AiSystemRecommendation> = new Map();

  async createAiSystemRecommendation(recommendation: InsertAiSystemRecommendation): Promise<AiSystemRecommendation> {
    const id = randomUUID();
    const now = new Date();
    const rec: AiSystemRecommendation = {
      id,
      createdAt: now,
      severity: recommendation.severity ?? 'MEDIUM',
      category: recommendation.category ?? 'OTHER',
      title: recommendation.title,
      description: recommendation.description,
      suggestedChange: recommendation.suggestedChange ?? null,
      status: recommendation.status ?? 'NEW',
      relatedLogIds: recommendation.relatedLogIds ?? null,
      reviewPeriodStart: recommendation.reviewPeriodStart ?? null,
      reviewPeriodEnd: recommendation.reviewPeriodEnd ?? null,
      acknowledgedAt: null,
      acknowledgedByUserId: null,
      dismissedAt: null,
      dismissedByUserId: null,
      updatedAt: now,
    };
    this.aiSystemRecommendations.set(id, rec);
    return rec;
  }

  async getAiSystemRecommendations(options?: {
    limit?: number;
    offset?: number;
    status?: string;
    severity?: string;
    category?: string;
  }): Promise<{ recommendations: AiSystemRecommendation[]; total: number }> {
    let recommendations = Array.from(this.aiSystemRecommendations.values());
    
    if (options?.status) {
      recommendations = recommendations.filter(r => r.status === options.status);
    }
    if (options?.severity) {
      recommendations = recommendations.filter(r => r.severity === options.severity);
    }
    if (options?.category) {
      recommendations = recommendations.filter(r => r.category === options.category);
    }
    
    const total = recommendations.length;
    recommendations.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    return { recommendations: recommendations.slice(offset, offset + limit), total };
  }

  async getAiSystemRecommendation(id: string): Promise<AiSystemRecommendation | undefined> {
    return this.aiSystemRecommendations.get(id);
  }

  async updateAiSystemRecommendation(id: string, data: Partial<{
    status: string;
    acknowledgedAt: Date;
    acknowledgedByUserId: string;
    dismissedAt: Date;
    dismissedByUserId: string;
  }>): Promise<AiSystemRecommendation | undefined> {
    const existing = this.aiSystemRecommendations.get(id);
    if (!existing) return undefined;
    
    const updated: AiSystemRecommendation = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.aiSystemRecommendations.set(id, updated);
    return updated;
  }

  async countAiSystemRecommendationsByStatus(status: string): Promise<number> {
    return Array.from(this.aiSystemRecommendations.values())
      .filter(r => r.status === status)
      .length;
  }

  // QuickBooks Auth (not supported in MemStorage - returns null/throws)
  async getQuickbooksAuth(_userId: string): Promise<QuickbooksAuth | null> {
    return null;
  }

  async getQuickbooksAuthsByUserId(_userId: string): Promise<QuickbooksAuth[]> {
    return [];
  }

  async createQuickbooksAuth(_auth: InsertQuickbooksAuth): Promise<QuickbooksAuth> {
    throw new Error('QuickBooks not supported in MemStorage');
  }

  async updateQuickbooksAuth(_id: string, _auth: Partial<InsertQuickbooksAuth>): Promise<QuickbooksAuth | null> {
    return null;
  }

  async updateQuickbooksAuthHealthStatus(_id: string, _status: { lastTokenCheckAt?: Date; lastTokenCheckStatus?: string; lastAlertSentAt?: Date | null }): Promise<void> {
    // Not supported in MemStorage
  }

  // Integration Config health check methods - use getIntegrationConfigById from line 1367 instead

  async getIntegrationConfigsByUserId(userId: string): Promise<IntegrationConfig[]> {
    return Array.from(this.integrationConfigs.values()).filter(c => c.userId === userId);
  }

  async updateIntegrationConfigHealthStatus(id: string, status: { lastTokenCheckAt?: Date; lastTokenCheckStatus?: string; lastAlertSentAt?: Date | null; consecutiveFailures?: number; lastSyncStatus?: string }): Promise<void> {
    const config = this.integrationConfigs.get(id);
    if (config) {
      this.integrationConfigs.set(id, { ...config, ...status } as IntegrationConfig);
    }
  }

  // QuickBooks Sales Snapshots (not supported in MemStorage)
  async getQuickbooksSalesSnapshotsBySku(_sku: string): Promise<QuickbooksSalesSnapshot[]> {
    return [];
  }

  async getAllQuickbooksSalesSnapshots(): Promise<QuickbooksSalesSnapshot[]> {
    return [];
  }

  async getQuickbooksDemandHistory(_params: {
    search?: string;
    year?: number;
    month?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: QuickbooksSalesSnapshot[]; total: number; years: number[] }> {
    return { items: [], total: 0, years: [] };
  }

  async upsertQuickbooksSalesSnapshot(_snapshot: Omit<InsertQuickbooksSalesSnapshot, 'id'>): Promise<{ snapshot: QuickbooksSalesSnapshot; isNew: boolean }> {
    throw new Error('QuickBooks not supported in MemStorage');
  }

  // QuickBooks Vendor Mappings (not supported in MemStorage)
  async getQuickbooksVendorMapping(_supplierId: string): Promise<QuickbooksVendorMapping | null> {
    return null;
  }

  async createQuickbooksVendorMapping(_mapping: InsertQuickbooksVendorMapping): Promise<QuickbooksVendorMapping> {
    throw new Error('QuickBooks not supported in MemStorage');
  }

  // QuickBooks Item Mappings (not supported in MemStorage)
  async getQuickbooksItemMapping(_itemId: string): Promise<QuickbooksItemMapping | null> {
    return null;
  }

  async createQuickbooksItemMapping(_mapping: InsertQuickbooksItemMapping): Promise<QuickbooksItemMapping> {
    throw new Error('QuickBooks not supported in MemStorage');
  }

  // QuickBooks Bills (not supported in MemStorage)
  async getQuickbooksBillByPurchaseOrderId(_purchaseOrderId: string): Promise<QuickbooksBill | null> {
    return null;
  }

  async createQuickbooksBill(_bill: InsertQuickbooksBill): Promise<QuickbooksBill> {
    throw new Error('QuickBooks not supported in MemStorage');
  }

  async updateQuickbooksBill(_id: string, _bill: Partial<InsertQuickbooksBill>): Promise<QuickbooksBill | null> {
    return null;
  }

  // Ad Platform Configs
  async getAdPlatformConfig(userId: string, platform: string): Promise<AdPlatformConfig | undefined> {
    return Array.from(this.adPlatformConfigs.values())
      .find(c => c.userId === userId && c.platform === platform);
  }

  async getAllAdPlatformConfigs(userId: string): Promise<AdPlatformConfig[]> {
    return Array.from(this.adPlatformConfigs.values())
      .filter(c => c.userId === userId);
  }

  async createAdPlatformConfig(config: InsertAdPlatformConfig): Promise<AdPlatformConfig> {
    const id = randomUUID();
    const now = new Date();
    const newConfig: AdPlatformConfig = {
      id,
      ...config,
      accountId: config.accountId ?? null,
      accountName: config.accountName ?? null,
      accessToken: config.accessToken ?? null,
      refreshToken: config.refreshToken ?? null,
      accessTokenExpiresAt: config.accessTokenExpiresAt ?? null,
      isConnected: config.isConnected ?? false,
      lastSyncAt: config.lastSyncAt ?? null,
      lastSyncStatus: config.lastSyncStatus ?? null,
      lastSyncMessage: config.lastSyncMessage ?? null,
      config: config.config ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.adPlatformConfigs.set(id, newConfig);
    return newConfig;
  }

  async updateAdPlatformConfig(id: string, updates: Partial<InsertAdPlatformConfig>): Promise<AdPlatformConfig | undefined> {
    const existing = this.adPlatformConfigs.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.adPlatformConfigs.set(id, updated);
    return updated;
  }

  async deleteAdPlatformConfig(id: string): Promise<boolean> {
    return this.adPlatformConfigs.delete(id);
  }

  // Ad SKU Mappings
  async getAllAdSkuMappings(): Promise<AdSkuMapping[]> {
    return Array.from(this.adSkuMappings.values());
  }

  async getAdSkuMappingsBySku(sku: string): Promise<AdSkuMapping[]> {
    return Array.from(this.adSkuMappings.values())
      .filter(m => m.sku === sku);
  }

  async getAdSkuMappingsByPlatform(platform: string): Promise<AdSkuMapping[]> {
    return Array.from(this.adSkuMappings.values())
      .filter(m => m.platform === platform);
  }

  async createAdSkuMapping(mapping: InsertAdSkuMapping): Promise<AdSkuMapping> {
    const id = randomUUID();
    const newMapping: AdSkuMapping = {
      id,
      ...mapping,
      adEntityName: mapping.adEntityName ?? null,
      itemId: mapping.itemId ?? null,
      isActive: mapping.isActive ?? true,
      createdAt: new Date(),
    };
    this.adSkuMappings.set(id, newMapping);
    return newMapping;
  }

  async updateAdSkuMapping(id: string, updates: Partial<InsertAdSkuMapping>): Promise<AdSkuMapping | undefined> {
    const existing = this.adSkuMappings.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.adSkuMappings.set(id, updated);
    return updated;
  }

  async deleteAdSkuMapping(id: string): Promise<boolean> {
    return this.adSkuMappings.delete(id);
  }

  // Ad Metrics Daily
  async getAdMetricsBySkuDays(sku: string, days: number): Promise<AdMetricsDaily[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    
    return Array.from(this.adMetricsDaily.values())
      .filter(m => m.sku === sku && m.date >= cutoffStr)
      .sort((a, b) => b.date.localeCompare(a.date)); // Most recent first
  }

  async getAdMetricsByPlatformDateRange(platform: string, startDate: Date, endDate: Date): Promise<AdMetricsDaily[]> {
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    
    return Array.from(this.adMetricsDaily.values())
      .filter(m => m.platform === platform && m.date >= startStr && m.date <= endStr)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async getAdMetricsBySkuAndDateRange(sku: string, startDate: string, endDate: string): Promise<AdMetricsDaily[]> {
    return Array.from(this.adMetricsDaily.values())
      .filter(m => m.sku === sku && m.date >= startDate && m.date <= endDate)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async upsertAdMetricsDaily(metrics: InsertAdMetricsDaily): Promise<AdMetricsDaily> {
    // Find existing by platform + sku + date
    const existing = Array.from(this.adMetricsDaily.values())
      .find(m => m.platform === metrics.platform && m.sku === metrics.sku && m.date === metrics.date);
    
    if (existing) {
      const updated: AdMetricsDaily = {
        ...existing,
        impressions: metrics.impressions ?? existing.impressions,
        clicks: metrics.clicks ?? existing.clicks,
        spend: metrics.spend ?? existing.spend,
        conversions: metrics.conversions ?? existing.conversions,
        revenue: metrics.revenue ?? existing.revenue,
        currency: metrics.currency ?? existing.currency,
        updatedAt: new Date(),
      };
      this.adMetricsDaily.set(existing.id, updated);
      return updated;
    }

    const id = randomUUID();
    const now = new Date();
    const newMetrics: AdMetricsDaily = {
      id,
      platform: metrics.platform,
      sku: metrics.sku,
      date: metrics.date,
      impressions: metrics.impressions ?? 0,
      clicks: metrics.clicks ?? 0,
      spend: metrics.spend ?? 0,
      conversions: metrics.conversions ?? null,
      revenue: metrics.revenue ?? null,
      currency: metrics.currency ?? 'USD',
      createdAt: now,
      updatedAt: now,
    };
    this.adMetricsDaily.set(id, newMetrics);
    return newMetrics;
  }

  // Label Formats
  async getLabelFormatsByUserId(userId: string): Promise<LabelFormat[]> {
    return Array.from(this.labelFormats.values()).filter(f => f.userId === userId);
  }

  async getLabelFormat(id: string): Promise<LabelFormat | undefined> {
    return this.labelFormats.get(id);
  }

  async createLabelFormat(format: InsertLabelFormat): Promise<LabelFormat> {
    const id = randomUUID();
    const now = new Date();
    const newFormat: LabelFormat = {
      id,
      ...format,
      pageWidth: format.pageWidth ?? 8.5,
      pageHeight: format.pageHeight ?? 11,
      columns: format.columns ?? 1,
      rows: format.rows ?? 1,
      marginTop: format.marginTop ?? 0,
      marginLeft: format.marginLeft ?? 0,
      gapX: format.gapX ?? 0,
      gapY: format.gapY ?? 0,
      isDefault: format.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.labelFormats.set(id, newFormat);
    return newFormat;
  }

  async updateLabelFormat(id: string, updates: Partial<InsertLabelFormat>): Promise<LabelFormat | undefined> {
    const existing = this.labelFormats.get(id);
    if (!existing) return undefined;
    const updated: LabelFormat = { ...existing, ...updates, updatedAt: new Date() };
    this.labelFormats.set(id, updated);
    return updated;
  }

  async deleteLabelFormat(id: string): Promise<boolean> {
    return this.labelFormats.delete(id);
  }

  async setDefaultLabelFormat(userId: string, formatId: string): Promise<void> {
    for (const [id, format] of this.labelFormats) {
      if (format.userId === userId) {
        this.labelFormats.set(id, { ...format, isDefault: id === formatId });
      }
    }
  }

  // System Logs
  private systemLogs: Map<string, SystemLog> = new Map();

  async getAllSystemLogs(filters?: { type?: string; severity?: string; entityType?: string; startDate?: Date; endDate?: Date }): Promise<SystemLog[]> {
    let logs = Array.from(this.systemLogs.values());
    if (filters?.type) logs = logs.filter(l => l.type === filters.type);
    if (filters?.severity) logs = logs.filter(l => l.severity === filters.severity);
    if (filters?.entityType) logs = logs.filter(l => l.entityType === filters.entityType);
    if (filters?.startDate) logs = logs.filter(l => new Date(l.createdAt) >= filters.startDate!);
    if (filters?.endDate) logs = logs.filter(l => new Date(l.createdAt) <= filters.endDate!);
    return logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getSystemLog(id: string): Promise<SystemLog | undefined> {
    return this.systemLogs.get(id);
  }

  async createSystemLog(log: InsertSystemLog): Promise<SystemLog> {
    const id = randomUUID();
    const newLog: SystemLog = {
      ...log,
      id,
      createdAt: new Date(),
    };
    this.systemLogs.set(id, newLog);
    return newLog;
  }

  // AI Agent Settings
  private aiAgentSettings: Map<string, AiAgentSettings> = new Map();

  async getAiAgentSettingsByUserId(userId: string): Promise<AiAgentSettings | undefined> {
    return Array.from(this.aiAgentSettings.values()).find(s => s.userId === userId);
  }

  async createAiAgentSettings(settings: InsertAiAgentSettings): Promise<AiAgentSettings> {
    const id = randomUUID();
    const now = new Date();
    const newSettings: AiAgentSettings = {
      ...settings,
      id,
      autoSendCriticalPos: settings.autoSendCriticalPos ?? false,
      criticalRescueDays: settings.criticalRescueDays ?? 7,
      criticalThresholdDays: settings.criticalThresholdDays ?? 3,
      highThresholdDays: settings.highThresholdDays ?? 7,
      mediumThresholdDays: settings.mediumThresholdDays ?? 14,
      shopifyTwoWaySync: settings.shopifyTwoWaySync ?? false,
      shopifySafetyBuffer: settings.shopifySafetyBuffer ?? 0,
      amazonTwoWaySync: settings.amazonTwoWaySync ?? false,
      amazonSafetyBuffer: settings.amazonSafetyBuffer ?? 0,
      extensivTwoWaySync: settings.extensivTwoWaySync ?? false,
      pivotLowDaysThreshold: settings.pivotLowDaysThreshold ?? 5,
      hildaleHighDaysThreshold: settings.hildaleHighDaysThreshold ?? 20,
      createdAt: now,
      updatedAt: now,
    };
    this.aiAgentSettings.set(id, newSettings);
    return newSettings;
  }

  async updateAiAgentSettings(userId: string, settings: Partial<InsertAiAgentSettings>): Promise<AiAgentSettings | undefined> {
    const existing = await this.getAiAgentSettingsByUserId(userId);
    if (!existing) return undefined;
    const updated = { ...existing, ...settings, updatedAt: new Date() };
    this.aiAgentSettings.set(existing.id, updated);
    return updated;
  }
}

export class PostgresStorage implements IStorage {
  private db;

  constructor(connectionString: string) {
    const sql = neon(connectionString);
    this.db = drizzle(sql, { schema });
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    const results = await this.db.select().from(schema.users).where(eq(schema.users.id, id));
    return results[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const results = await this.db.select().from(schema.users).where(eq(schema.users.email, email));
    return results[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const results = await this.db.insert(schema.users).values(insertUser).returning();
    return results[0];
  }

  async updateUser(id: string, updateData: Partial<InsertUser>): Promise<User | undefined> {
    const results = await this.db.update(schema.users).set(updateData).where(eq(schema.users.id, id)).returning();
    return results[0];
  }

  // Items
  async getAllItems(): Promise<Item[]> {
    return await this.db.select().from(schema.items);
  }

  private async calculateProductionForecast(finishedProductId: string): Promise<number> {
    // Get BOM entries for this finished product with component stock info
    // Use LEFT JOIN to detect missing components
    const bomWithStock = await this.db
      .select({
        componentId: schema.billOfMaterials.componentId,
        quantityRequired: schema.billOfMaterials.quantityRequired,
        currentStock: schema.items.currentStock,
      })
      .from(schema.billOfMaterials)
      .leftJoin(schema.items, eq(schema.billOfMaterials.componentId, schema.items.id))
      .where(eq(schema.billOfMaterials.finishedProductId, finishedProductId));

    // If no BOM components, forecast is 0
    if (bomWithStock.length === 0) {
      return 0;
    }

    // Calculate capacity for each component
    let minCapacity = Infinity;
    
    for (const bomEntry of bomWithStock) {
      // Check for missing component (LEFT JOIN returned null)
      if (bomEntry.currentStock === null) {
        // Missing component = can't produce any
        return 0;
      }

      if (bomEntry.quantityRequired <= 0) {
        // Invalid quantity = can't produce any
        return 0;
      }

      const componentStock = bomEntry.currentStock ?? 0;
      const requiredPerUnit = bomEntry.quantityRequired;
      
      // Calculate how many units this component allows
      const capacityForComponent = Math.floor(componentStock / requiredPerUnit);
      
      minCapacity = Math.min(minCapacity, capacityForComponent);
    }

    return minCapacity === Infinity ? 0 : minCapacity;
  }

  async getItemsWithBOMCounts(): Promise<Array<Item & { componentsCount?: number; forecastQty?: number; totalOwned?: number; primarySupplier?: any }>> {
    // Use LEFT JOIN + COUNT to efficiently get BOM counts and supplier info in a single query
    // Cast COUNT to integer explicitly to ensure consistent numeric type
    const results = await this.db
      .select({
        items: schema.items,
        componentsCount: drizzleSql<number>`CAST(COUNT(DISTINCT ${schema.billOfMaterials.id}) AS INTEGER)`,
        supplierItem: schema.supplierItems,
        supplier: schema.suppliers,
      })
      .from(schema.items)
      .leftJoin(
        schema.billOfMaterials,
        eq(schema.items.id, schema.billOfMaterials.finishedProductId)
      )
      .leftJoin(
        schema.supplierItems,
        and(
          eq(schema.items.id, schema.supplierItems.itemId),
          eq(schema.supplierItems.isDesignatedSupplier, true)
        )
      )
      .leftJoin(
        schema.suppliers,
        eq(schema.supplierItems.supplierId, schema.suppliers.id)
      )
      .groupBy(schema.items.id, schema.supplierItems.id, schema.suppliers.id);
    
    // Calculate forecast and totalOwned for each finished product
    const itemsWithForecast = await Promise.all(
      results.map(async (row) => {
        const primarySupplier = row.supplierItem && row.supplier ? {
          supplierName: row.supplier.name,
          supplierSku: row.supplierItem.supplierSku,
          unitCost: row.supplierItem.price,
          minimumOrderQuantity: row.supplierItem.minimumOrderQuantity,
          leadTimeDays: row.supplierItem.leadTimeDays,
        } : null;
        
        if (row.items.type === "finished_product") {
          const forecast = await this.calculateProductionForecast(row.items.id);
          const totalOwned = (row.items.pivotQty ?? 0) + (row.items.hildaleQty ?? 0);
          return {
            ...row.items,
            componentsCount: row.componentsCount,
            forecastQty: forecast,
            totalOwned,
            primarySupplier,
          };
        }
        // For components (non-finished products), return undefined instead of 0
        return {
          ...row.items,
          componentsCount: undefined,
          forecastQty: undefined,
          totalOwned: undefined,
          primarySupplier,
        };
      })
    );

    return itemsWithForecast;
  }

  async getItem(id: string): Promise<Item | undefined> {
    const results = await this.db.select().from(schema.items).where(eq(schema.items.id, id));
    return results[0];
  }

  async getItemBySku(sku: string): Promise<Item | undefined> {
    const results = await this.db.select().from(schema.items).where(eq(schema.items.sku, sku));
    return results[0];
  }

  async findProductByShopifySku(shopifySku: string): Promise<Item | undefined> {
    const results = await this.db.select().from(schema.items).where(eq(schema.items.shopifySku, shopifySku));
    return results[0];
  }

  async findProductByAmazonSku(amazonSku: string): Promise<Item | undefined> {
    const results = await this.db.select().from(schema.items).where(eq(schema.items.amazonSku, amazonSku));
    return results[0];
  }

  async findProductByExtensivSku(extensivSku: string): Promise<Item | undefined> {
    const results = await this.db.select().from(schema.items).where(eq(schema.items.extensivSku, extensivSku));
    return results[0];
  }

  async createItem(insertItem: InsertItem): Promise<Item> {
    // Storage-level guard: Force currentStock to 0 for finished products
    // Finished products MUST use only pivotQty and hildaleQty as sources of truth
    
    // Normalize type/productKind to keep them in sync during creation
    let normalizedInsert = { ...insertItem };
    
    // Step 1: Fill in missing partner field
    if (insertItem.type === 'finished_product' && !insertItem.productKind) {
      normalizedInsert.productKind = 'FINISHED';
    } else if (insertItem.type === 'component' && !insertItem.productKind) {
      normalizedInsert.productKind = 'RAW';
    } else if (insertItem.productKind === 'FINISHED' && !insertItem.type) {
      normalizedInsert.type = 'finished_product';
    } else if (insertItem.productKind === 'RAW' && !insertItem.type) {
      normalizedInsert.type = 'component';
    }
    
    // Step 2: Fix mismatches by ALWAYS favoring finished_product classification
    // This ensures NO bypass: any signal of finished product → enforce finished product rules
    if (normalizedInsert.type === 'finished_product' || normalizedInsert.productKind === 'FINISHED') {
      // ALWAYS favor finished_product: force both fields to finished state
      normalizedInsert.type = 'finished_product';
      normalizedInsert.productKind = 'FINISHED';
    } else if (normalizedInsert.type === 'component' || normalizedInsert.productKind === 'RAW') {
      // Both indicate component: normalize to component/RAW
      normalizedInsert.type = 'component';
      normalizedInsert.productKind = 'RAW';
    }
    
    const isFinishedProduct = normalizedInsert.type === 'finished_product' || normalizedInsert.productKind === 'FINISHED';
    if (isFinishedProduct) {
      normalizedInsert.currentStock = 0;
      normalizedInsert.type = 'finished_product';
      normalizedInsert.productKind = 'FINISHED';
      if (normalizedInsert.availableForSaleQty === undefined || normalizedInsert.availableForSaleQty === null) {
        normalizedInsert.availableForSaleQty = normalizedInsert.pivotQty ?? 0;
      }
    }
    
    const results = await this.db.insert(schema.items).values(normalizedInsert).returning();
    return results[0];
  }

  async updateItem(id: string, updateData: Partial<InsertItem>): Promise<Item | undefined> {
    // Storage-level guard: Force currentStock to 0 for finished products
    // Finished products MUST use only pivotQty and hildaleQty as sources of truth
    // Get the existing item to check its type
    const existingItem = await this.getItem(id);
    if (!existingItem) return undefined;
    
    // Normalize type/productKind in update data to keep them in sync
    let normalizedUpdateData = { ...updateData };
    if (updateData.type === 'finished_product' && !updateData.productKind) {
      normalizedUpdateData.productKind = 'FINISHED';
    } else if (updateData.type === 'component' && !updateData.productKind) {
      normalizedUpdateData.productKind = 'RAW';
    } else if (updateData.productKind === 'FINISHED' && !updateData.type) {
      normalizedUpdateData.type = 'finished_product';
    } else if (updateData.productKind === 'RAW' && !updateData.type) {
      normalizedUpdateData.type = 'component';
    }
    
    // Merge to get preliminary final state
    let mergedItem = { ...existingItem, ...normalizedUpdateData };
    
    // Normalize FINAL merged state by ALWAYS favoring finished_product classification
    // This fixes pre-existing inconsistencies and ensures NO bypass
    if (mergedItem.type === 'finished_product' || mergedItem.productKind === 'FINISHED') {
      // ALWAYS favor finished_product: force both fields to finished state
      mergedItem.type = 'finished_product';
      mergedItem.productKind = 'FINISHED';
    } else if (mergedItem.type === 'component' || mergedItem.productKind === 'RAW') {
      // Both indicate component: normalize to component/RAW
      mergedItem.type = 'component';
      mergedItem.productKind = 'RAW';
    }
    
    // Determine if final state is finished product
    const willBeFinished = mergedItem.type === 'finished_product' || mergedItem.productKind === 'FINISHED';
    
    if (willBeFinished) {
      // Force currentStock to 0 and ensure type/productKind are fully synced
      mergedItem.currentStock = 0;
      mergedItem.type = 'finished_product';
      mergedItem.productKind = 'FINISHED';
    }
    
    // Prepare final update data with all normalized fields
    const finalUpdateData = {
      ...normalizedUpdateData,
      type: mergedItem.type,
      productKind: mergedItem.productKind,
      currentStock: mergedItem.currentStock,
    };
    
    const results = await this.db.update(schema.items).set(finalUpdateData).where(eq(schema.items.id, id)).returning();
    return results[0];
  }

  async deleteItem(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.items).where(eq(schema.items.id, id)).returning();
    return results.length > 0;
  }

  // Bins
  async getAllBins(): Promise<Bin[]> {
    return await this.db.select().from(schema.bins);
  }

  async getBin(id: string): Promise<Bin | undefined> {
    const results = await this.db.select().from(schema.bins).where(eq(schema.bins.id, id));
    return results[0];
  }

  async createBin(insertBin: InsertBin): Promise<Bin> {
    const results = await this.db.insert(schema.bins).values(insertBin).returning();
    return results[0];
  }

  async updateBin(id: string, updateData: Partial<InsertBin>): Promise<Bin | undefined> {
    const results = await this.db.update(schema.bins).set(updateData).where(eq(schema.bins.id, id)).returning();
    return results[0];
  }

  async deleteBin(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.bins).where(eq(schema.bins.id, id)).returning();
    return results.length > 0;
  }

  // Inventory By Bin
  async getAllInventoryByBin(): Promise<InventoryByBin[]> {
    return await this.db.select().from(schema.inventoryByBin);
  }

  async getInventoryByBin(id: string): Promise<InventoryByBin | undefined> {
    const results = await this.db.select().from(schema.inventoryByBin).where(eq(schema.inventoryByBin.id, id));
    return results[0];
  }

  async getInventoryByItemId(itemId: string): Promise<InventoryByBin[]> {
    return await this.db.select().from(schema.inventoryByBin).where(eq(schema.inventoryByBin.itemId, itemId));
  }

  async createInventoryByBin(insertInventory: InsertInventoryByBin): Promise<InventoryByBin> {
    const results = await this.db.insert(schema.inventoryByBin).values(insertInventory).returning();
    return results[0];
  }

  async updateInventoryByBin(id: string, updateData: Partial<InsertInventoryByBin>): Promise<InventoryByBin | undefined> {
    const results = await this.db.update(schema.inventoryByBin).set(updateData).where(eq(schema.inventoryByBin.id, id)).returning();
    return results[0];
  }

  async deleteInventoryByBin(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.inventoryByBin).where(eq(schema.inventoryByBin.id, id)).returning();
    return results.length > 0;
  }

  // Bill of Materials
  async getAllBillOfMaterials(): Promise<BillOfMaterials[]> {
    return await this.db.select().from(schema.billOfMaterials);
  }

  async getBillOfMaterialsByProductId(finishedProductId: string): Promise<BillOfMaterials[]> {
    return await this.db.select().from(schema.billOfMaterials).where(eq(schema.billOfMaterials.finishedProductId, finishedProductId));
  }

  async createBillOfMaterials(insertBom: InsertBillOfMaterials): Promise<BillOfMaterials> {
    const results = await this.db.insert(schema.billOfMaterials).values(insertBom).returning();
    return results[0];
  }

  async deleteBillOfMaterials(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.billOfMaterials).where(eq(schema.billOfMaterials.id, id)).returning();
    return results.length > 0;
  }

  // Suppliers
  async getAllSuppliers(): Promise<Supplier[]> {
    return await this.db.select().from(schema.suppliers);
  }

  async getSupplier(id: string): Promise<Supplier | undefined> {
    const results = await this.db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id));
    return results[0];
  }

  async createSupplier(insertSupplier: InsertSupplier): Promise<Supplier> {
    const results = await this.db.insert(schema.suppliers).values(insertSupplier).returning();
    return results[0];
  }

  async updateSupplier(id: string, updateData: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const results = await this.db.update(schema.suppliers).set(updateData).where(eq(schema.suppliers.id, id)).returning();
    return results[0];
  }

  async deleteSupplier(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.suppliers).where(eq(schema.suppliers.id, id)).returning();
    return results.length > 0;
  }

  // Supplier Items
  async getAllSupplierItems(): Promise<SupplierItem[]> {
    return await this.db.select().from(schema.supplierItems);
  }

  async getSupplierItemsByItemId(itemId: string): Promise<SupplierItem[]> {
    return await this.db.select().from(schema.supplierItems).where(eq(schema.supplierItems.itemId, itemId));
  }

  async createSupplierItem(insertSupplierItem: InsertSupplierItem): Promise<SupplierItem> {
    const results = await this.db.insert(schema.supplierItems).values(insertSupplierItem).returning();
    return results[0];
  }

  async updateSupplierItem(id: string, updateData: Partial<InsertSupplierItem>): Promise<SupplierItem | undefined> {
    const results = await this.db.update(schema.supplierItems).set(updateData).where(eq(schema.supplierItems.id, id)).returning();
    return results[0];
  }

  async deleteSupplierItem(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.supplierItems).where(eq(schema.supplierItems.id, id)).returning();
    return results.length > 0;
  }

  // Sales History
  async getAllSalesHistory(): Promise<SalesHistory[]> {
    return await this.db.select().from(schema.salesHistory);
  }

  async getSalesHistoryByItemId(itemId: string): Promise<SalesHistory[]> {
    return await this.db.select().from(schema.salesHistory).where(eq(schema.salesHistory.itemId, itemId));
  }

  async createSalesHistory(insertSale: InsertSalesHistory): Promise<SalesHistory> {
    const results = await this.db.insert(schema.salesHistory).values(insertSale).returning();
    return results[0];
  }

  // Finished Inventory Snapshot
  async getAllFinishedInventorySnapshots(): Promise<FinishedInventorySnapshot[]> {
    return await this.db.select().from(schema.finishedInventorySnapshot);
  }

  async createFinishedInventorySnapshot(insertSnapshot: InsertFinishedInventorySnapshot): Promise<FinishedInventorySnapshot> {
    const results = await this.db.insert(schema.finishedInventorySnapshot).values(insertSnapshot).returning();
    return results[0];
  }

  // Integration Health
  async getAllIntegrationHealth(): Promise<IntegrationHealth[]> {
    return await this.db.select().from(schema.integrationHealth);
  }

  async getIntegrationHealth(integrationName: string): Promise<IntegrationHealth | undefined> {
    const results = await this.db.select().from(schema.integrationHealth).where(eq(schema.integrationHealth.integrationName, integrationName));
    return results[0];
  }

  async createOrUpdateIntegrationHealth(health: InsertIntegrationHealth): Promise<IntegrationHealth> {
    const existing = await this.getIntegrationHealth(health.integrationName);
    if (existing) {
      const results = await this.db.update(schema.integrationHealth).set(health).where(eq(schema.integrationHealth.integrationName, health.integrationName)).returning();
      return results[0];
    }
    const results = await this.db.insert(schema.integrationHealth).values(health).returning();
    return results[0];
  }

  // Settings
  async getSettings(userId: string): Promise<Settings | undefined> {
    const results = await this.db.select().from(schema.settings).where(eq(schema.settings.userId, userId));
    return results[0];
  }

  async createOrUpdateSettings(insertSettings: InsertSettings): Promise<Settings> {
    const existing = await this.getSettings(insertSettings.userId);
    if (existing) {
      const results = await this.db.update(schema.settings).set(insertSettings).where(eq(schema.settings.userId, insertSettings.userId)).returning();
      return results[0];
    }
    const results = await this.db.insert(schema.settings).values(insertSettings).returning();
    return results[0];
  }

  async updateSettings(userId: string, updates: Partial<Omit<InsertSettings, 'userId'>>): Promise<Settings | undefined> {
    // Normalize empty strings to null
    const normalized = Object.fromEntries(
      Object.entries(updates).map(([key, value]) => [
        key,
        typeof value === 'string' && value.trim() === '' ? null : value
      ])
    ) as Partial<Omit<InsertSettings, 'userId'>>;
    
    // Check if settings exist
    const existing = await this.getSettings(userId);
    if (!existing) {
      // Create new settings row with the updates
      const insertData: InsertSettings = {
        userId,
        ...normalized
      };
      const results = await this.db.insert(schema.settings).values(insertData).returning();
      return results[0];
    }
    
    // Apply only the validated updates (Drizzle only updates provided columns)
    const results = await this.db.update(schema.settings).set(normalized).where(eq(schema.settings.userId, userId)).returning();
    return results[0];
  }

  // Integration Configs
  async getAllIntegrationConfigs(userId: string): Promise<IntegrationConfig[]> {
    return await this.db.select().from(schema.integrationConfigs).where(eq(schema.integrationConfigs.userId, userId));
  }

  async getIntegrationConfig(userId: string, provider: string): Promise<IntegrationConfig | undefined> {
    const normalizedProvider = provider.toUpperCase();
    console.log(`[Storage] getIntegrationConfig - userId: ${userId}, provider: ${normalizedProvider}`);
    const results = await this.db.select().from(schema.integrationConfigs)
      .where(and(eq(schema.integrationConfigs.userId, userId), eq(schema.integrationConfigs.provider, normalizedProvider)));
    console.log(`[Storage] getIntegrationConfig - found ${results.length} results`);
    return results[0];
  }

  async getIntegrationConfigById(id: string): Promise<IntegrationConfig | undefined> {
    const results = await this.db.select().from(schema.integrationConfigs)
      .where(eq(schema.integrationConfigs.id, id));
    return results[0];
  }

  async createIntegrationConfig(insertConfig: InsertIntegrationConfig): Promise<IntegrationConfig> {
    const results = await this.db.insert(schema.integrationConfigs).values(insertConfig).returning();
    return results[0];
  }

  async updateIntegrationConfig(id: string, updates: Partial<InsertIntegrationConfig>): Promise<IntegrationConfig | undefined> {
    const results = await this.db.update(schema.integrationConfigs).set(updates).where(eq(schema.integrationConfigs.id, id)).returning();
    return results[0];
  }

  async deleteIntegrationConfig(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.integrationConfigs).where(eq(schema.integrationConfigs.id, id)).returning();
    return results.length > 0;
  }

  // Barcodes
  async getAllBarcodes(): Promise<Barcode[]> {
    return await this.db.select().from(schema.barcodes);
  }

  async getBarcode(id: string): Promise<Barcode | undefined> {
    const results = await this.db.select().from(schema.barcodes).where(eq(schema.barcodes.id, id));
    return results[0];
  }

  async getBarcodeByValue(value: string): Promise<Barcode | undefined> {
    const results = await this.db.select().from(schema.barcodes).where(eq(schema.barcodes.value, value));
    return results[0];
  }

  async createBarcode(insertBarcode: InsertBarcode): Promise<Barcode> {
    const results = await this.db.insert(schema.barcodes).values(insertBarcode).returning();
    return results[0];
  }

  async updateBarcode(id: string, updateData: Partial<InsertBarcode>): Promise<Barcode | undefined> {
    const results = await this.db.update(schema.barcodes).set(updateData).where(eq(schema.barcodes.id, id)).returning();
    return results[0];
  }

  async deleteBarcode(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.barcodes).where(eq(schema.barcodes.id, id)).returning();
    return results.length > 0;
  }

  // Barcode Settings
  async getBarcodeSettings(): Promise<BarcodeSettings | undefined> {
    const results = await this.db.select().from(schema.barcodeSettings).limit(1);
    return results[0];
  }

  async createOrUpdateBarcodeSettings(settings: Partial<InsertBarcodeSettings>): Promise<BarcodeSettings> {
    const existing = await this.getBarcodeSettings();
    if (existing) {
      const updated = await this.db
        .update(schema.barcodeSettings)
        .set(settings)
        .where(eq(schema.barcodeSettings.id, existing.id))
        .returning();
      return updated[0];
    } else {
      const created = await this.db.insert(schema.barcodeSettings).values({
        gs1Prefix: settings.gs1Prefix ?? null,
        itemRefDigits: settings.itemRefDigits ?? 6,
        nextItemRef: settings.nextItemRef ?? 1,
        nextInternalCode: settings.nextInternalCode ?? 1000,
      }).returning();
      return created[0];
    }
  }

  async incrementItemRef(): Promise<number> {
    const existing = await this.getBarcodeSettings();
    if (!existing) {
      await this.createOrUpdateBarcodeSettings({});
      return 1;
    }
    const current = existing.nextItemRef;
    await this.db
      .update(schema.barcodeSettings)
      .set({ nextItemRef: current + 1 })
      .where(eq(schema.barcodeSettings.id, existing.id));
    return current;
  }

  async incrementInternalCode(): Promise<number> {
    const existing = await this.getBarcodeSettings();
    if (!existing) {
      await this.createOrUpdateBarcodeSettings({});
      return 1000;
    }
    const current = existing.nextInternalCode;
    await this.db
      .update(schema.barcodeSettings)
      .set({ nextInternalCode: current + 1 })
      .where(eq(schema.barcodeSettings.id, existing.id));
    return current;
  }

  // Import Profiles
  async getAllImportProfiles(): Promise<ImportProfile[]> {
    return await this.db.select().from(schema.importProfiles);
  }

  async getImportProfile(id: string): Promise<ImportProfile | undefined> {
    const results = await this.db.select().from(schema.importProfiles).where(eq(schema.importProfiles.id, id));
    return results[0];
  }

  async createImportProfile(profile: InsertImportProfile): Promise<ImportProfile> {
    const results = await this.db.insert(schema.importProfiles).values(profile).returning();
    return results[0];
  }

  async updateImportProfile(id: string, updates: Partial<InsertImportProfile>): Promise<ImportProfile | undefined> {
    const results = await this.db
      .update(schema.importProfiles)
      .set(updates)
      .where(eq(schema.importProfiles.id, id))
      .returning();
    return results[0];
  }

  async deleteImportProfile(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.importProfiles).where(eq(schema.importProfiles.id, id)).returning();
    return results.length > 0;
  }

  // Import Jobs
  async getAllImportJobs(): Promise<ImportJob[]> {
    return await this.db.select().from(schema.importJobs);
  }

  async getImportJob(id: string): Promise<ImportJob | undefined> {
    const results = await this.db.select().from(schema.importJobs).where(eq(schema.importJobs.id, id));
    return results[0];
  }

  async createImportJob(job: InsertImportJob): Promise<ImportJob> {
    const results = await this.db.insert(schema.importJobs).values(job).returning();
    return results[0];
  }

  async updateImportJob(id: string, updates: Partial<InsertImportJob>): Promise<ImportJob | undefined> {
    const results = await this.db
      .update(schema.importJobs)
      .set(updates)
      .where(eq(schema.importJobs.id, id))
      .returning();
    return results[0];
  }

  async deleteImportJob(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.importJobs).where(eq(schema.importJobs.id, id)).returning();
    return results.length > 0;
  }

  async getAllInventoryTransactions(): Promise<InventoryTransaction[]> {
    return await this.db.select().from(schema.inventoryTransactions);
  }

  async getInventoryTransactionsByItem(itemId: string): Promise<InventoryTransaction[]> {
    const results = await this.db
      .select()
      .from(schema.inventoryTransactions)
      .where(eq(schema.inventoryTransactions.itemId, itemId))
      .orderBy(drizzleSql`${schema.inventoryTransactions.createdAt} DESC`);
    return results;
  }

  async createInventoryTransaction(insertTransaction: InsertInventoryTransaction): Promise<InventoryTransaction> {
    const results = await this.db.insert(schema.inventoryTransactions).values(insertTransaction).returning();
    return results[0];
  }

  // AI Recommendations
  async getAllAIRecommendations(): Promise<AIRecommendation[]> {
    const results = await this.db
      .select()
      .from(schema.aiRecommendations)
      .orderBy(drizzleSql`${schema.aiRecommendations.createdAt} DESC`);
    return results;
  }

  async getAIRecommendation(id: string): Promise<AIRecommendation | undefined> {
    const results = await this.db
      .select()
      .from(schema.aiRecommendations)
      .where(eq(schema.aiRecommendations.id, id))
      .limit(1);
    return results[0];
  }

  async getAIRecommendationsByItem(itemId: string): Promise<AIRecommendation[]> {
    const results = await this.db
      .select()
      .from(schema.aiRecommendations)
      .where(eq(schema.aiRecommendations.itemId, itemId))
      .orderBy(drizzleSql`${schema.aiRecommendations.createdAt} DESC`);
    return results;
  }

  async getAIRecommendationsByStatus(status: string): Promise<AIRecommendation[]> {
    const results = await this.db
      .select()
      .from(schema.aiRecommendations)
      .where(eq(schema.aiRecommendations.status, status))
      .orderBy(drizzleSql`${schema.aiRecommendations.createdAt} DESC`);
    return results;
  }

  async getActiveAIRecommendations(): Promise<AIRecommendation[]> {
    const results = await this.db
      .select()
      .from(schema.aiRecommendations)
      .where(
        drizzleSql`${schema.aiRecommendations.status} IN ('NEW', 'ACCEPTED')`
      )
      .orderBy(drizzleSql`${schema.aiRecommendations.createdAt} DESC`);
    return results;
  }

  async upsertAIRecommendation(recommendation: InsertAIRecommendation): Promise<AIRecommendation> {
    // First try to find an existing NEW recommendation for this item and type
    const existing = await this.db
      .select()
      .from(schema.aiRecommendations)
      .where(
        and(
          eq(schema.aiRecommendations.itemId, recommendation.itemId),
          eq(schema.aiRecommendations.recommendationType, recommendation.recommendationType),
          eq(schema.aiRecommendations.status, 'NEW')
        )
      )
      .limit(1);
    
    if (existing[0]) {
      // Update the existing recommendation
      const results = await this.db
        .update(schema.aiRecommendations)
        .set({ ...recommendation, updatedAt: new Date() })
        .where(eq(schema.aiRecommendations.id, existing[0].id))
        .returning();
      return results[0];
    }
    
    // Create a new recommendation
    return this.createAIRecommendation(recommendation);
  }

  async updateAIRecommendationStatus(id: string, status: string): Promise<AIRecommendation | undefined> {
    const results = await this.db
      .update(schema.aiRecommendations)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.aiRecommendations.id, id))
      .returning();
    return results[0];
  }

  async clearStaleRecommendations(itemId: string): Promise<void> {
    await this.db
      .delete(schema.aiRecommendations)
      .where(
        and(
          eq(schema.aiRecommendations.itemId, itemId),
          eq(schema.aiRecommendations.status, 'NEW')
        )
      );
  }

  async createAIRecommendation(recommendation: InsertAIRecommendation): Promise<AIRecommendation> {
    const results = await this.db.insert(schema.aiRecommendations).values({
      ...recommendation,
      status: recommendation.status ?? 'NEW',
      availableForSale: recommendation.availableForSale ?? 0,
      recommendedQty: recommendation.recommendedQty ?? 0,
      qtyOnPo: recommendation.qtyOnPo ?? 0,
      adMultiplier: recommendation.adMultiplier ?? 1.0,
    }).returning();
    return results[0];
  }

  async updateAIRecommendation(id: string, update: Partial<InsertAIRecommendation>): Promise<AIRecommendation | undefined> {
    const results = await this.db
      .update(schema.aiRecommendations)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(schema.aiRecommendations.id, id))
      .returning();
    return results[0];
  }

  // Purchase Orders
  async getAllPurchaseOrders(): Promise<PurchaseOrder[]> {
    return await this.db.select().from(schema.purchaseOrders);
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined> {
    const results = await this.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
    return results[0];
  }

  async getPurchaseOrdersBySupplierId(supplierId: string): Promise<PurchaseOrder[]> {
    return await this.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.supplierId, supplierId));
  }

  async createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const results = await this.db.insert(schema.purchaseOrders).values(po).returning();
    return results[0];
  }

  async updatePurchaseOrder(id: string, updates: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const results = await this.db.update(schema.purchaseOrders).set(updates).where(eq(schema.purchaseOrders.id, id)).returning();
    return results[0];
  }

  async deletePurchaseOrder(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id)).returning();
    return results.length > 0;
  }

  // Purchase Order Lines
  async getAllPurchaseOrderLines(): Promise<PurchaseOrderLine[]> {
    return await this.db.select().from(schema.purchaseOrderLines);
  }

  async getPurchaseOrderLinesByPOId(purchaseOrderId: string): Promise<PurchaseOrderLine[]> {
    return await this.db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, purchaseOrderId));
  }

  async createPurchaseOrderLine(line: InsertPurchaseOrderLine): Promise<PurchaseOrderLine> {
    const results = await this.db.insert(schema.purchaseOrderLines).values(line).returning();
    return results[0];
  }

  async updatePurchaseOrderLine(id: string, updates: Partial<InsertPurchaseOrderLine>): Promise<PurchaseOrderLine | undefined> {
    const results = await this.db.update(schema.purchaseOrderLines).set(updates).where(eq(schema.purchaseOrderLines.id, id)).returning();
    return results[0];
  }

  async deletePurchaseOrderLine(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.id, id)).returning();
    return results.length > 0;
  }

  async getPurchaseOrderLine(id: string): Promise<PurchaseOrderLine | undefined> {
    const results = await this.db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.id, id));
    return results[0];
  }

  async deletePurchaseOrderLinesByPOId(purchaseOrderId: string): Promise<boolean> {
    const results = await this.db.delete(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, purchaseOrderId)).returning();
    return results.length > 0;
  }

  // Purchase Order Receipts
  async getAllPurchaseOrderReceipts(): Promise<PurchaseOrderReceipt[]> {
    return await this.db.select().from(schema.purchaseOrderReceipts);
  }

  async getPurchaseOrderReceiptsByPOId(purchaseOrderId: string): Promise<PurchaseOrderReceipt[]> {
    return await this.db.select().from(schema.purchaseOrderReceipts).where(eq(schema.purchaseOrderReceipts.purchaseOrderId, purchaseOrderId));
  }

  async getPurchaseOrderReceipt(id: string): Promise<PurchaseOrderReceipt | undefined> {
    const results = await this.db.select().from(schema.purchaseOrderReceipts).where(eq(schema.purchaseOrderReceipts.id, id));
    return results[0];
  }

  async createPurchaseOrderReceipt(receipt: InsertPurchaseOrderReceipt): Promise<PurchaseOrderReceipt> {
    const results = await this.db.insert(schema.purchaseOrderReceipts).values(receipt).returning();
    return results[0];
  }

  async updatePurchaseOrderReceipt(id: string, updates: Partial<InsertPurchaseOrderReceipt>): Promise<PurchaseOrderReceipt | undefined> {
    const results = await this.db.update(schema.purchaseOrderReceipts)
      .set({ ...updates, updatedAt: drizzleSql`now()` })
      .where(eq(schema.purchaseOrderReceipts.id, id))
      .returning();
    return results[0];
  }

  async deletePurchaseOrderReceipt(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.purchaseOrderReceipts).where(eq(schema.purchaseOrderReceipts.id, id)).returning();
    return results.length > 0;
  }

  // Purchase Order Receipt Lines
  async getPurchaseOrderReceiptLinesByReceiptId(receiptId: string): Promise<PurchaseOrderReceiptLine[]> {
    return await this.db.select().from(schema.purchaseOrderReceiptLines).where(eq(schema.purchaseOrderReceiptLines.receiptId, receiptId));
  }

  async getPurchaseOrderReceiptLinesByPOLineId(purchaseOrderLineId: string): Promise<PurchaseOrderReceiptLine[]> {
    return await this.db.select().from(schema.purchaseOrderReceiptLines).where(eq(schema.purchaseOrderReceiptLines.purchaseOrderLineId, purchaseOrderLineId));
  }

  async createPurchaseOrderReceiptLine(line: InsertPurchaseOrderReceiptLine): Promise<PurchaseOrderReceiptLine> {
    const results = await this.db.insert(schema.purchaseOrderReceiptLines).values(line).returning();
    return results[0];
  }

  async updatePurchaseOrderReceiptLine(id: string, updates: Partial<InsertPurchaseOrderReceiptLine>): Promise<PurchaseOrderReceiptLine | undefined> {
    const results = await this.db.update(schema.purchaseOrderReceiptLines)
      .set(updates)
      .where(eq(schema.purchaseOrderReceiptLines.id, id))
      .returning();
    return results[0];
  }

  async deletePurchaseOrderReceiptLine(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.purchaseOrderReceiptLines).where(eq(schema.purchaseOrderReceiptLines.id, id)).returning();
    return results.length > 0;
  }

  // PO Helper Methods
  async getNextPONumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `PO-${year}-`;
    
    // Get the highest existing PO number for this year
    const results = await this.db.select({ poNumber: schema.purchaseOrders.poNumber })
      .from(schema.purchaseOrders)
      .where(drizzleSql`${schema.purchaseOrders.poNumber} LIKE ${prefix + '%'}`)
      .orderBy(drizzleSql`${schema.purchaseOrders.poNumber} DESC`)
      .limit(1);
    
    let nextNum = 1;
    if (results.length > 0 && results[0].poNumber) {
      const lastNum = parseInt(results[0].poNumber.replace(prefix, ''), 10);
      if (!isNaN(lastNum)) {
        nextNum = lastNum + 1;
      }
    }
    
    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  async recalculatePOTotals(purchaseOrderId: string): Promise<PurchaseOrder | undefined> {
    const lines = await this.getPurchaseOrderLinesByPOId(purchaseOrderId);
    
    let subtotal = 0;
    let totalItemsOrdered = 0;
    for (const line of lines) {
      const lineTotal = Math.round((line.qtyOrdered || 0) * (line.unitCost || 0) * 100) / 100;
      if (lineTotal !== line.lineTotal) {
        await this.updatePurchaseOrderLine(line.id, { lineTotal, updatedAt: new Date() });
      }
      subtotal += lineTotal;
      totalItemsOrdered += line.qtyOrdered || 0;
    }
    subtotal = Math.round(subtotal * 100) / 100;
    
    const po = await this.getPurchaseOrder(purchaseOrderId);
    if (!po) return undefined;
    
    const shippingCost = po.shippingCost || 0;
    const otherFees = po.otherFees || 0;
    const total = Math.round((subtotal + shippingCost + otherFees) * 100) / 100;
    
    return this.updatePurchaseOrder(purchaseOrderId, {
      subtotal,
      total,
      totalItemsOrdered,
      updatedAt: new Date(),
    });
  }

  async updatePOLineReceivedQty(purchaseOrderLineId: string): Promise<PurchaseOrderLine | undefined> {
    // Sum all receipt lines for this PO line
    const receiptLines = await this.getPurchaseOrderReceiptLinesByPOLineId(purchaseOrderLineId);
    const totalReceived = receiptLines.reduce((sum, rl) => sum + rl.receivedQty, 0);
    
    // Get the line to check against qtyOrdered
    const line = await this.getPurchaseOrderLine(purchaseOrderLineId);
    if (!line) return undefined;
    
    // Cap at qtyOrdered
    const qtyReceived = Math.min(totalReceived, line.qtyOrdered);
    
    return this.updatePurchaseOrderLine(purchaseOrderLineId, {
      qtyReceived,
      updatedAt: new Date(),
    });
  }

  // Supplier Leads
  async getAllSupplierLeads(): Promise<SupplierLead[]> {
    return await this.db.select().from(schema.supplierLeads);
  }

  async getSupplierLead(id: string): Promise<SupplierLead | undefined> {
    const results = await this.db.select().from(schema.supplierLeads).where(eq(schema.supplierLeads.id, id));
    return results[0];
  }

  async getSupplierLeadsByStatus(status: string): Promise<SupplierLead[]> {
    return await this.db.select().from(schema.supplierLeads).where(eq(schema.supplierLeads.status, status));
  }

  async getSupplierLeadsByPhantomRunId(phantomRunId: string): Promise<SupplierLead[]> {
    return await this.db.select().from(schema.supplierLeads).where(eq(schema.supplierLeads.phantomRunId, phantomRunId));
  }

  async createSupplierLead(lead: InsertSupplierLead): Promise<SupplierLead> {
    const results = await this.db.insert(schema.supplierLeads).values(lead).returning();
    return results[0];
  }

  async upsertSupplierLead(lead: InsertSupplierLead): Promise<SupplierLead> {
    // Find existing lead by email or website URL for deduplication
    let existing: SupplierLead | undefined = undefined;

    if (lead.contactEmail) {
      const results = await this.db.select().from(schema.supplierLeads)
        .where(eq(schema.supplierLeads.contactEmail, lead.contactEmail));
      existing = results[0];
    }

    if (!existing && lead.websiteUrl) {
      const results = await this.db.select().from(schema.supplierLeads)
        .where(eq(schema.supplierLeads.websiteUrl, lead.websiteUrl));
      existing = results[0];
    }

    if (existing) {
      // Update existing lead with new data
      const updated = await this.db.update(schema.supplierLeads)
        .set(lead)
        .where(eq(schema.supplierLeads.id, existing.id))
        .returning();
      return updated[0];
    }

    // Create new lead if no duplicate found
    return this.createSupplierLead(lead);
  }

  async updateSupplierLead(id: string, updates: Partial<InsertSupplierLead>): Promise<SupplierLead | undefined> {
    const results = await this.db.update(schema.supplierLeads).set(updates).where(eq(schema.supplierLeads.id, id)).returning();
    return results[0];
  }

  async deleteSupplierLead(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.supplierLeads).where(eq(schema.supplierLeads.id, id)).returning();
    return results.length > 0;
  }

  // Return Requests
  async getAllReturnRequests(): Promise<ReturnRequest[]> {
    return await this.db.select().from(schema.returnRequests);
  }

  async getReturnRequest(id: string): Promise<ReturnRequest | undefined> {
    const results = await this.db.select().from(schema.returnRequests).where(eq(schema.returnRequests.id, id));
    return results[0];
  }

  async createReturnRequest(request: InsertReturnRequest): Promise<ReturnRequest> {
    const results = await this.db.insert(schema.returnRequests).values(request).returning();
    return results[0];
  }

  async updateReturnRequest(id: string, updates: Partial<InsertReturnRequest>): Promise<ReturnRequest | undefined> {
    const results = await this.db.update(schema.returnRequests)
      .set({ ...updates, updatedAt: drizzleSql`now()` })
      .where(eq(schema.returnRequests.id, id))
      .returning();
    return results[0];
  }

  async getReturnRequestsBySalesOrderId(salesOrderId: string): Promise<ReturnRequest[]> {
    return await this.db.select()
      .from(schema.returnRequests)
      .where(eq(schema.returnRequests.salesOrderId, salesOrderId));
  }

  async receiveReturn(returnId: string, itemUpdates: { itemId: string; qtyReceived: number }[]): Promise<ReturnRequest> {
    const returnRequest = await this.getReturnRequest(returnId);
    if (!returnRequest) {
      throw new Error(`Return request ${returnId} not found`);
    }

    const returnItems = await this.getReturnItemsByRequestId(returnId);

    for (const update of itemUpdates) {
      const returnItem = returnItems.find(item => item.inventoryItemId === update.itemId);
      if (!returnItem) {
        throw new Error(`Return item for inventory item ${update.itemId} not found in return request ${returnId}`);
      }

      await this.updateReturnItem(returnItem.id, {
        qtyReceived: update.qtyReceived,
      });

      if (returnItem.disposition === 'RETURN_TO_STOCK' && update.qtyReceived > 0) {
        const item = await this.getItem(update.itemId);
        if (!item) {
          throw new Error(`Item ${update.itemId} not found`);
        }

        await this.db.update(schema.items)
          .set({ 
            currentStock: drizzleSql`${schema.items.currentStock} + ${update.qtyReceived}` 
          })
          .where(eq(schema.items.id, update.itemId));

        await this.createInventoryTransaction({
          itemId: update.itemId,
          type: 'RECEIVE',
          quantity: update.qtyReceived,
          itemType: item.type === 'finished_product' ? 'FINISHED' : 'RAW',
          location: 'HILDALE',
          notes: `Return received: ${returnRequest.externalOrderId}`,
          createdBy: 'SYSTEM',
        });
      }
    }

    const updatedReturnItems = await this.getReturnItemsByRequestId(returnId);
    const allItemsReceived = updatedReturnItems.every(item => item.qtyReceived >= item.qtyApproved);
    const newStatus = allItemsReceived ? 'CLOSED' : 'RECEIVED';

    const results = await this.db.update(schema.returnRequests)
      .set({ status: newStatus, updatedAt: drizzleSql`now()` })
      .where(eq(schema.returnRequests.id, returnId))
      .returning();
    
    return results[0];
  }

  // Return Items
  async getReturnItemsByRequestId(returnRequestId: string): Promise<ReturnItem[]> {
    return await this.db.select().from(schema.returnItems).where(eq(schema.returnItems.returnRequestId, returnRequestId));
  }

  async createReturnItem(item: InsertReturnItem): Promise<ReturnItem> {
    const results = await this.db.insert(schema.returnItems).values(item).returning();
    return results[0];
  }

  async updateReturnItem(id: string, updates: Partial<InsertReturnItem>): Promise<ReturnItem | undefined> {
    const results = await this.db.update(schema.returnItems).set(updates).where(eq(schema.returnItems.id, id)).returning();
    return results[0];
  }

  // Return Shipments
  async getReturnShipmentsByRequestId(returnRequestId: string): Promise<ReturnShipment[]> {
    return await this.db.select().from(schema.returnShipments).where(eq(schema.returnShipments.returnRequestId, returnRequestId));
  }

  async createReturnShipment(shipment: InsertReturnShipment): Promise<ReturnShipment> {
    const results = await this.db.insert(schema.returnShipments).values(shipment).returning();
    return results[0];
  }

  async updateReturnShipment(id: string, updates: Partial<InsertReturnShipment>): Promise<ReturnShipment | undefined> {
    const results = await this.db.update(schema.returnShipments)
      .set({ ...updates, updatedAt: drizzleSql`now()` })
      .where(eq(schema.returnShipments.id, id))
      .returning();
    return results[0];
  }

  // Return Events
  async getReturnEventsByRequestId(returnRequestId: string): Promise<ReturnEvent[]> {
    return await this.db.select()
      .from(schema.returnEvents)
      .where(eq(schema.returnEvents.returnRequestId, returnRequestId))
      .orderBy(drizzleSql`created_at DESC`);
  }

  async createReturnEvent(event: InsertReturnEvent): Promise<ReturnEvent> {
    const results = await this.db.insert(schema.returnEvents).values(event).returning();
    return results[0];
  }

  // Shippo Label Logs
  async getAllShippoLabelLogs(): Promise<ShippoLabelLog[]> {
    return await this.db.select()
      .from(schema.shippoLabelLogs)
      .orderBy(drizzleSql`created_at DESC`);
  }

  async getShippoLabelLog(id: string): Promise<ShippoLabelLog | undefined> {
    const results = await this.db.select()
      .from(schema.shippoLabelLogs)
      .where(eq(schema.shippoLabelLogs.id, id));
    return results[0];
  }

  async getShippoLabelLogByScanCode(scanCode: string): Promise<ShippoLabelLog | undefined> {
    const results = await this.db.select()
      .from(schema.shippoLabelLogs)
      .where(eq(schema.shippoLabelLogs.scanCode, scanCode));
    return results[0];
  }

  async getShippoLabelLogByTrackingNumber(trackingNumber: string): Promise<ShippoLabelLog | undefined> {
    const results = await this.db.select()
      .from(schema.shippoLabelLogs)
      .where(eq(schema.shippoLabelLogs.trackingNumber, trackingNumber));
    return results[0];
  }

  async getShippoLabelLogsByReturnId(returnRequestId: string): Promise<ShippoLabelLog[]> {
    return await this.db.select()
      .from(schema.shippoLabelLogs)
      .where(eq(schema.shippoLabelLogs.returnRequestId, returnRequestId));
  }

  async getShippoLabelLogsBySalesOrderId(salesOrderId: string): Promise<ShippoLabelLog[]> {
    return await this.db.select()
      .from(schema.shippoLabelLogs)
      .where(eq(schema.shippoLabelLogs.salesOrderId, salesOrderId));
  }

  async createShippoLabelLog(log: InsertShippoLabelLog): Promise<ShippoLabelLog> {
    const results = await this.db.insert(schema.shippoLabelLogs).values(log).returning();
    return results[0];
  }

  async updateShippoLabelLog(id: string, updates: Partial<InsertShippoLabelLog>): Promise<ShippoLabelLog | undefined> {
    const results = await this.db.update(schema.shippoLabelLogs)
      .set({ ...updates, updatedAt: drizzleSql`now()` })
      .where(eq(schema.shippoLabelLogs.id, id))
      .returning();
    return results[0];
  }

  async searchShippoLabelLogs(params: { search?: string; page?: number; pageSize?: number }): Promise<{ logs: ShippoLabelLog[]; total: number }> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 50;
    const offset = (page - 1) * pageSize;

    let query = this.db.select().from(schema.shippoLabelLogs);
    let countQuery = this.db.select({ count: drizzleSql<number>`count(*)` }).from(schema.shippoLabelLogs);

    if (params.search) {
      const searchTerm = `%${params.search}%`;
      const searchCondition = or(
        drizzleSql`tracking_number ILIKE ${searchTerm}`,
        drizzleSql`sku ILIKE ${searchTerm}`,
        drizzleSql`customer_name ILIKE ${searchTerm}`,
        drizzleSql`sales_order_id ILIKE ${searchTerm}`,
        drizzleSql`return_request_id ILIKE ${searchTerm}`,
        drizzleSql`channel ILIKE ${searchTerm}`
      );
      query = query.where(searchCondition) as typeof query;
      countQuery = countQuery.where(searchCondition) as typeof countQuery;
    }

    const [logs, countResult] = await Promise.all([
      query.orderBy(drizzleSql`created_at DESC`).limit(pageSize).offset(offset),
      countQuery
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    return { logs, total };
  }

  // Return Helper Methods
  async getNextRMANumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `RMA-${year}-`;
    
    const results = await this.db.select({ rmaNumber: schema.returnRequests.rmaNumber })
      .from(schema.returnRequests)
      .where(drizzleSql`rma_number LIKE ${prefix + '%'}`)
      .orderBy(drizzleSql`rma_number DESC`)
      .limit(1);
    
    let nextNum = 1;
    if (results.length > 0 && results[0].rmaNumber) {
      const match = results[0].rmaNumber.match(/RMA-\d{4}-(\d+)/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }
    
    return `${prefix}${String(nextNum).padStart(6, '0')}`;
  }

  async getReturnRequestByRMANumber(rmaNumber: string): Promise<ReturnRequest | undefined> {
    const results = await this.db.select()
      .from(schema.returnRequests)
      .where(eq(schema.returnRequests.rmaNumber, rmaNumber));
    return results[0];
  }

  async getReturnRequestByExternalOrderId(externalOrderId: string): Promise<ReturnRequest[]> {
    return await this.db.select()
      .from(schema.returnRequests)
      .where(eq(schema.returnRequests.externalOrderId, externalOrderId));
  }

  // Channels
  async getAllChannels(): Promise<Channel[]> {
    return await this.db.select().from(schema.channels);
  }

  async getChannel(id: string): Promise<Channel | undefined> {
    const results = await this.db.select().from(schema.channels).where(eq(schema.channels.id, id));
    return results[0];
  }

  async getChannelByCode(code: string): Promise<Channel | undefined> {
    const results = await this.db.select().from(schema.channels).where(eq(schema.channels.code, code));
    return results[0];
  }

  async createChannel(channel: InsertChannel): Promise<Channel> {
    const results = await this.db.insert(schema.channels).values(channel).returning();
    return results[0];
  }

  async updateChannel(id: string, updates: Partial<InsertChannel>): Promise<Channel | undefined> {
    const results = await this.db.update(schema.channels).set(updates).where(eq(schema.channels.id, id)).returning();
    return results[0];
  }

  // Product Channel Mappings
  async getAllProductChannelMappings(): Promise<ProductChannelMapping[]> {
    return await this.db.select().from(schema.productChannelMappings);
  }

  async getProductChannelMappingsByProduct(productId: string): Promise<ProductChannelMapping[]> {
    return await this.db.select().from(schema.productChannelMappings).where(eq(schema.productChannelMappings.productId, productId));
  }

  async getProductChannelMappingsByChannel(channelId: string): Promise<ProductChannelMapping[]> {
    return await this.db.select().from(schema.productChannelMappings).where(eq(schema.productChannelMappings.channelId, channelId));
  }

  async getProductChannelMapping(productId: string, channelId: string): Promise<ProductChannelMapping | undefined> {
    const results = await this.db.select().from(schema.productChannelMappings)
      .where(and(
        eq(schema.productChannelMappings.productId, productId),
        eq(schema.productChannelMappings.channelId, channelId)
      ));
    return results[0];
  }

  async createProductChannelMapping(mapping: InsertProductChannelMapping): Promise<ProductChannelMapping> {
    const results = await this.db.insert(schema.productChannelMappings).values(mapping).returning();
    return results[0];
  }

  async updateProductChannelMapping(id: string, updates: Partial<InsertProductChannelMapping>): Promise<ProductChannelMapping | undefined> {
    const results = await this.db.update(schema.productChannelMappings)
      .set({ ...updates, updatedAt: drizzleSql`now()` })
      .where(eq(schema.productChannelMappings.id, id))
      .returning();
    return results[0];
  }

  async deleteProductChannelMapping(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.productChannelMappings).where(eq(schema.productChannelMappings.id, id)).returning();
    return results.length > 0;
  }

  // Ad Performance Snapshots
  async getAllAdPerformanceSnapshots(): Promise<AdPerformanceSnapshot[]> {
    return await this.db.select().from(schema.adPerformanceSnapshots);
  }

  async getAdPerformanceSnapshotsByProduct(productId: string, startDate?: Date, endDate?: Date): Promise<AdPerformanceSnapshot[]> {
    if (startDate && endDate) {
      return await this.db.select().from(schema.adPerformanceSnapshots)
        .where(and(
          eq(schema.adPerformanceSnapshots.productId, productId),
          drizzleSql`${schema.adPerformanceSnapshots.date} >= ${startDate}`,
          drizzleSql`${schema.adPerformanceSnapshots.date} <= ${endDate}`
        ));
    }
    
    return await this.db.select().from(schema.adPerformanceSnapshots)
      .where(eq(schema.adPerformanceSnapshots.productId, productId));
  }

  async getAdPerformanceSnapshotsByChannel(channelId: string, startDate?: Date, endDate?: Date): Promise<AdPerformanceSnapshot[]> {
    if (startDate && endDate) {
      return await this.db.select().from(schema.adPerformanceSnapshots)
        .where(and(
          eq(schema.adPerformanceSnapshots.channelId, channelId),
          drizzleSql`${schema.adPerformanceSnapshots.date} >= ${startDate}`,
          drizzleSql`${schema.adPerformanceSnapshots.date} <= ${endDate}`
        ));
    }
    
    return await this.db.select().from(schema.adPerformanceSnapshots)
      .where(eq(schema.adPerformanceSnapshots.channelId, channelId));
  }

  async upsertAdPerformanceSnapshot(snapshot: InsertAdPerformanceSnapshot): Promise<AdPerformanceSnapshot> {
    const results = await this.db.insert(schema.adPerformanceSnapshots)
      .values(snapshot)
      .onConflictDoUpdate({
        target: [schema.adPerformanceSnapshots.productId, schema.adPerformanceSnapshots.channelId, schema.adPerformanceSnapshots.date],
        set: {
          impressions: snapshot.impressions,
          clicks: snapshot.clicks,
          conversions: snapshot.conversions,
          revenue: snapshot.revenue,
          spend: snapshot.spend,
          updatedAt: drizzleSql`now()`
        }
      })
      .returning();
    return results[0];
  }

  // Sales Snapshots
  async getAllSalesSnapshots(): Promise<SalesSnapshot[]> {
    return await this.db.select().from(schema.salesSnapshots);
  }

  async getSalesSnapshotsByProduct(productId: string, startDate?: Date, endDate?: Date): Promise<SalesSnapshot[]> {
    if (startDate && endDate) {
      return await this.db.select().from(schema.salesSnapshots)
        .where(and(
          eq(schema.salesSnapshots.productId, productId),
          drizzleSql`${schema.salesSnapshots.date} >= ${startDate}`,
          drizzleSql`${schema.salesSnapshots.date} <= ${endDate}`
        ));
    }
    
    return await this.db.select().from(schema.salesSnapshots)
      .where(eq(schema.salesSnapshots.productId, productId));
  }

  async getSalesSnapshotsByChannel(channelId: string, startDate?: Date, endDate?: Date): Promise<SalesSnapshot[]> {
    if (startDate && endDate) {
      return await this.db.select().from(schema.salesSnapshots)
        .where(and(
          eq(schema.salesSnapshots.channelId, channelId),
          drizzleSql`${schema.salesSnapshots.date} >= ${startDate}`,
          drizzleSql`${schema.salesSnapshots.date} <= ${endDate}`
        ));
    }
    
    return await this.db.select().from(schema.salesSnapshots)
      .where(eq(schema.salesSnapshots.channelId, channelId));
  }

  async upsertSalesSnapshot(snapshot: InsertSalesSnapshot): Promise<SalesSnapshot> {
    const results = await this.db.insert(schema.salesSnapshots)
      .values(snapshot)
      .onConflictDoUpdate({
        target: [schema.salesSnapshots.productId, schema.salesSnapshots.channelId, schema.salesSnapshots.date],
        set: {
          unitsSold: snapshot.unitsSold,
          revenue: snapshot.revenue,
          updatedAt: drizzleSql`now()`
        }
      })
      .returning();
    return results[0];
  }

  // Product Forecast Context
  async getAllProductForecastContexts(): Promise<ProductForecastContext[]> {
    return await this.db.select().from(schema.productForecastContext);
  }

  async getProductForecastContext(productId: string): Promise<ProductForecastContext | undefined> {
    const results = await this.db.select().from(schema.productForecastContext)
      .where(eq(schema.productForecastContext.productId, productId));
    return results[0];
  }

  async upsertProductForecastContext(context: InsertProductForecastContext): Promise<ProductForecastContext> {
    const results = await this.db.insert(schema.productForecastContext)
      .values(context)
      .onConflictDoUpdate({
        target: schema.productForecastContext.productId,
        set: {
          ...context,
          lastUpdatedAt: drizzleSql`now()`
        }
      })
      .returning();
    return results[0];
  }

  async refreshProductForecastContext(productId: string): Promise<ProductForecastContext> {
    // TODO: Implement comprehensive aggregation logic
    // For now, create a stub entry
    const product = await this.getItem(productId);
    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    // Fetch backorder snapshot for this product
    const backorderSnapshot = await this.getBackorderSnapshot(productId);
    const totalBackorderedQty = backorderSnapshot?.totalBackorderedQty || 0;

    const context: InsertProductForecastContext = {
      productId,
      onHandPivot: product.pivotQty || 0,
      onHandHildale: product.hildaleQty || 0,
      onHandTotal: (product.pivotQty || 0) + (product.hildaleQty || 0),
      inboundUnits: 0, // TODO: Calculate from open POs
      unitsSold7d: 0,
      unitsSold30d: 0,
      revenue7d: 0,
      revenue30d: 0,
      shopifyUnitsSold7d: 0,
      shopifyUnitsSold30d: 0,
      shopifyRevenue7d: 0,
      shopifyRevenue30d: 0,
      amazonUnitsSold7d: 0,
      amazonUnitsSold30d: 0,
      amazonRevenue7d: 0,
      amazonRevenue30d: 0,
      googleAdSpend7d: 0,
      googleAdSpend30d: 0,
      googleConversions7d: 0,
      googleRoas7d: 0,
      metaAdSpend7d: 0,
      metaAdSpend30d: 0,
      metaConversions7d: 0,
      metaRoas7d: 0,
      tiktokAdSpend7d: 0,
      tiktokAdSpend30d: 0,
      tiktokConversions7d: 0,
      tiktokRoas7d: 0,
      daysOfStockLeft: null,
      averageDailySales: 0,
      totalBackorderedQty,
    };

    return await this.upsertProductForecastContext(context);
  }

  async refreshAllProductForecastContexts(): Promise<void> {
    const products = await this.db.select().from(schema.items).where(eq(schema.items.type, 'finished_product'));
    
    for (const product of products) {
      await this.refreshProductForecastContext(product.id);
    }
  }

  // Sales Orders
  async getAllSalesOrders(): Promise<SalesOrder[]> {
    return await this.db.select().from(schema.salesOrders);
  }

  async getSalesOrder(id: string): Promise<SalesOrder | undefined> {
    const results = await this.db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, id));
    return results[0];
  }

  async getSalesOrdersByExternalId(channel: string, externalOrderId: string): Promise<SalesOrder[]> {
    return await this.db.select().from(schema.salesOrders)
      .where(and(
        eq(schema.salesOrders.channel, channel),
        eq(schema.salesOrders.externalOrderId, externalOrderId)
      ))
      .orderBy(schema.salesOrders.createdAt)
      .limit(1);
  }

  async getSalesOrderWithLines(id: string): Promise<(SalesOrder & { lines: SalesOrderLine[] }) | undefined> {
    const order = await this.getSalesOrder(id);
    if (!order) return undefined;
    
    const lines = await this.getSalesOrderLines(id);
    return { ...order, lines };
  }

  async createSalesOrder(insertOrder: InsertSalesOrder): Promise<SalesOrder> {
    const results = await this.db.insert(schema.salesOrders).values(insertOrder).returning();
    return results[0];
  }

  async updateSalesOrder(id: string, updates: Partial<InsertSalesOrder>): Promise<SalesOrder | undefined> {
    const results = await this.db.update(schema.salesOrders)
      .set({ ...updates, updatedAt: drizzleSql`now()` })
      .where(eq(schema.salesOrders.id, id))
      .returning();
    return results[0];
  }

  async deleteSalesOrder(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.salesOrders).where(eq(schema.salesOrders.id, id)).returning();
    return results.length > 0;
  }

  // Sales Order Lines
  async getSalesOrderLines(salesOrderId: string): Promise<SalesOrderLine[]> {
    return await this.db.select().from(schema.salesOrderLines).where(eq(schema.salesOrderLines.salesOrderId, salesOrderId));
  }

  async getSalesOrderLine(id: string): Promise<SalesOrderLine | undefined> {
    const results = await this.db.select().from(schema.salesOrderLines).where(eq(schema.salesOrderLines.id, id));
    return results[0];
  }

  async createSalesOrderLine(insertLine: InsertSalesOrderLine): Promise<SalesOrderLine> {
    const results = await this.db.insert(schema.salesOrderLines).values(insertLine).returning();
    return results[0];
  }

  async updateSalesOrderLine(id: string, updates: Partial<InsertSalesOrderLine>): Promise<SalesOrderLine | undefined> {
    const results = await this.db.update(schema.salesOrderLines)
      .set(updates)
      .where(eq(schema.salesOrderLines.id, id))
      .returning();
    return results[0];
  }

  async deleteSalesOrderLine(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.salesOrderLines).where(eq(schema.salesOrderLines.id, id)).returning();
    return results.length > 0;
  }

  async getOpenBackorderLinesByProduct(productId: string): Promise<SalesOrderLine[]> {
    return await this.db.select({
      id: schema.salesOrderLines.id,
      salesOrderId: schema.salesOrderLines.salesOrderId,
      productId: schema.salesOrderLines.productId,
      sku: schema.salesOrderLines.sku,
      qtyOrdered: schema.salesOrderLines.qtyOrdered,
      qtyAllocated: schema.salesOrderLines.qtyAllocated,
      qtyShipped: schema.salesOrderLines.qtyShipped,
      qtyFulfilled: schema.salesOrderLines.qtyFulfilled,
      returnedQty: schema.salesOrderLines.returnedQty,
      backorderQty: schema.salesOrderLines.backorderQty,
      unitPrice: schema.salesOrderLines.unitPrice,
      notes: schema.salesOrderLines.notes,
    })
      .from(schema.salesOrderLines)
      .leftJoin(schema.salesOrders, eq(schema.salesOrderLines.salesOrderId, schema.salesOrders.id))
      .where(
        and(
          eq(schema.salesOrderLines.productId, productId),
          gt(schema.salesOrderLines.backorderQty, 0),
          drizzleSql`${schema.salesOrders.status} NOT IN ('CANCELLED', 'FULFILLED')`
        )
      )
      .orderBy(schema.salesOrders.orderDate);
  }

  // Backorder Snapshots
  async getAllBackorderSnapshots(): Promise<BackorderSnapshot[]> {
    return await this.db.select().from(schema.backorderSnapshots);
  }

  async getBackorderSnapshot(productId: string): Promise<BackorderSnapshot | undefined> {
    const results = await this.db.select().from(schema.backorderSnapshots)
      .where(eq(schema.backorderSnapshots.productId, productId));
    return results[0];
  }

  async upsertBackorderSnapshot(insertSnapshot: InsertBackorderSnapshot): Promise<BackorderSnapshot> {
    const results = await this.db.insert(schema.backorderSnapshots)
      .values(insertSnapshot)
      .onConflictDoUpdate({
        target: [schema.backorderSnapshots.productId],
        set: {
          totalBackorderedQty: insertSnapshot.totalBackorderedQty,
          lastUpdatedAt: drizzleSql`now()`
        }
      })
      .returning();
    return results[0];
  }

  async refreshBackorderSnapshot(productId: string): Promise<BackorderSnapshot> {
    const result = await this.db
      .select({
        totalBackorderedQty: drizzleSql<number>`CAST(COALESCE(SUM(${schema.salesOrderLines.backorderQty}), 0) AS INTEGER)`,
      })
      .from(schema.salesOrderLines)
      .leftJoin(schema.salesOrders, eq(schema.salesOrderLines.salesOrderId, schema.salesOrders.id))
      .where(
        and(
          eq(schema.salesOrderLines.productId, productId),
          drizzleSql`${schema.salesOrders.status} != 'CANCELLED'`
        )
      );
    
    const totalBackorderedQty = result[0]?.totalBackorderedQty ?? 0;
    
    return await this.upsertBackorderSnapshot({
      productId,
      totalBackorderedQty,
    });
  }

  async refreshAllBackorderSnapshots(): Promise<void> {
    const products = await this.db.select().from(schema.items).where(eq(schema.items.type, 'finished_product'));
    
    for (const product of products) {
      await this.refreshBackorderSnapshot(product.id);
    }
  }

  // Audit Logs
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const results = await this.db.insert(schema.auditLogs).values(log).returning();
    return results[0];
  }

  async getAuditLogs(options?: { 
    limit?: number; 
    offset?: number; 
    source?: string;
    eventType?: string; 
    entityType?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
    search?: string;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    const conditions = [];
    
    if (options?.source) {
      conditions.push(eq(schema.auditLogs.source, options.source));
    }
    if (options?.eventType) {
      conditions.push(eq(schema.auditLogs.eventType, options.eventType));
    }
    if (options?.entityType) {
      conditions.push(eq(schema.auditLogs.entityType, options.entityType));
    }
    if (options?.status) {
      conditions.push(eq(schema.auditLogs.status, options.status));
    }
    if (options?.dateFrom) {
      conditions.push(drizzleSql`${schema.auditLogs.timestamp} >= ${options.dateFrom}`);
    }
    if (options?.dateTo) {
      conditions.push(drizzleSql`${schema.auditLogs.timestamp} <= ${options.dateTo}`);
    }
    if (options?.search) {
      const searchPattern = `%${options.search}%`;
      conditions.push(drizzleSql`(
        ${schema.auditLogs.description} ILIKE ${searchPattern} OR 
        ${schema.auditLogs.entityId} ILIKE ${searchPattern} OR 
        ${schema.auditLogs.entityLabel} ILIKE ${searchPattern}
      )`);
    }
    
    let countQuery = this.db.select({ count: drizzleSql<number>`count(*)` }).from(schema.auditLogs);
    let query = this.db.select().from(schema.auditLogs);
    
    if (conditions.length > 0) {
      const whereClause = and(...conditions);
      countQuery = countQuery.where(whereClause) as typeof countQuery;
      query = query.where(whereClause) as typeof query;
    }
    
    const [countResult, logs] = await Promise.all([
      countQuery,
      query
        .orderBy(drizzleSql`${schema.auditLogs.timestamp} DESC`)
        .limit(options?.limit ?? 50)
        .offset(options?.offset ?? 0)
    ]);
    
    return { logs, total: Number(countResult[0]?.count ?? 0) };
  }

  async getAuditLogsByPurchaseOrder(purchaseOrderId: string): Promise<AuditLog[]> {
    return await this.db.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.purchaseOrderId, purchaseOrderId))
      .orderBy(drizzleSql`${schema.auditLogs.timestamp} DESC`);
  }

  async countAuditLogs(options?: { 
    source?: string;
    eventType?: string; 
    entityType?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
    search?: string;
  }): Promise<number> {
    const conditions = [];
    
    if (options?.source) {
      conditions.push(eq(schema.auditLogs.source, options.source));
    }
    if (options?.eventType) {
      conditions.push(eq(schema.auditLogs.eventType, options.eventType));
    }
    if (options?.entityType) {
      conditions.push(eq(schema.auditLogs.entityType, options.entityType));
    }
    if (options?.status) {
      conditions.push(eq(schema.auditLogs.status, options.status));
    }
    if (options?.dateFrom) {
      conditions.push(drizzleSql`${schema.auditLogs.timestamp} >= ${options.dateFrom}`);
    }
    if (options?.dateTo) {
      conditions.push(drizzleSql`${schema.auditLogs.timestamp} <= ${options.dateTo}`);
    }
    if (options?.search) {
      const searchPattern = `%${options.search}%`;
      conditions.push(drizzleSql`(
        ${schema.auditLogs.description} ILIKE ${searchPattern} OR 
        ${schema.auditLogs.entityId} ILIKE ${searchPattern} OR 
        ${schema.auditLogs.entityLabel} ILIKE ${searchPattern}
      )`);
    }
    
    let query = this.db.select({ count: drizzleSql<number>`count(*)` }).from(schema.auditLogs);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    
    const result = await query;
    return Number(result[0]?.count ?? 0);
  }

  // AI System Recommendations
  async createAiSystemRecommendation(recommendation: InsertAiSystemRecommendation): Promise<AiSystemRecommendation> {
    const id = randomUUID();
    const now = new Date();
    const result = await this.db.insert(schema.aiSystemRecommendations).values({
      ...recommendation,
      id,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return result[0];
  }

  async getAiSystemRecommendations(options?: {
    limit?: number;
    offset?: number;
    status?: string;
    severity?: string;
    category?: string;
  }): Promise<{ recommendations: AiSystemRecommendation[]; total: number }> {
    const conditions = [];
    
    if (options?.status) {
      conditions.push(eq(schema.aiSystemRecommendations.status, options.status));
    }
    if (options?.severity) {
      conditions.push(eq(schema.aiSystemRecommendations.severity, options.severity));
    }
    if (options?.category) {
      conditions.push(eq(schema.aiSystemRecommendations.category, options.category));
    }
    
    let countQuery = this.db.select({ count: drizzleSql<number>`count(*)` }).from(schema.aiSystemRecommendations);
    let query = this.db.select().from(schema.aiSystemRecommendations);
    
    if (conditions.length > 0) {
      const whereClause = and(...conditions);
      countQuery = countQuery.where(whereClause) as typeof countQuery;
      query = query.where(whereClause) as typeof query;
    }
    
    const [countResult, recommendations] = await Promise.all([
      countQuery,
      query
        .orderBy(drizzleSql`${schema.aiSystemRecommendations.createdAt} DESC`)
        .limit(options?.limit ?? 50)
        .offset(options?.offset ?? 0)
    ]);
    
    return { recommendations, total: Number(countResult[0]?.count ?? 0) };
  }

  async getAiSystemRecommendation(id: string): Promise<AiSystemRecommendation | undefined> {
    const results = await this.db.select().from(schema.aiSystemRecommendations)
      .where(eq(schema.aiSystemRecommendations.id, id));
    return results[0];
  }

  async updateAiSystemRecommendation(id: string, data: Partial<{
    status: string;
    acknowledgedAt: Date;
    acknowledgedByUserId: string;
    dismissedAt: Date;
    dismissedByUserId: string;
  }>): Promise<AiSystemRecommendation | undefined> {
    const result = await this.db.update(schema.aiSystemRecommendations)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.aiSystemRecommendations.id, id))
      .returning();
    return result[0];
  }

  async countAiSystemRecommendationsByStatus(status: string): Promise<number> {
    const result = await this.db.select({ count: drizzleSql<number>`count(*)` })
      .from(schema.aiSystemRecommendations)
      .where(eq(schema.aiSystemRecommendations.status, status));
    return Number(result[0]?.count ?? 0);
  }

  // QuickBooks Auth
  async getQuickbooksAuth(userId: string): Promise<QuickbooksAuth | null> {
    const results = await this.db.select().from(schema.quickbooksAuth)
      .where(eq(schema.quickbooksAuth.userId, userId));
    return results[0] || null;
  }

  async getQuickbooksAuthsByUserId(userId: string): Promise<QuickbooksAuth[]> {
    return await this.db.select().from(schema.quickbooksAuth)
      .where(eq(schema.quickbooksAuth.userId, userId));
  }

  async createQuickbooksAuth(auth: InsertQuickbooksAuth): Promise<QuickbooksAuth> {
    const id = randomUUID();
    const now = new Date();
    const result = await this.db.insert(schema.quickbooksAuth).values({
      ...auth,
      id,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return result[0];
  }

  async updateQuickbooksAuth(id: string, auth: Partial<InsertQuickbooksAuth>): Promise<QuickbooksAuth | null> {
    const result = await this.db.update(schema.quickbooksAuth)
      .set({ ...auth, updatedAt: new Date() })
      .where(eq(schema.quickbooksAuth.id, id))
      .returning();
    return result[0] || null;
  }

  async updateQuickbooksAuthHealthStatus(id: string, status: { lastTokenCheckAt?: Date; lastTokenCheckStatus?: string; lastAlertSentAt?: Date | null }): Promise<void> {
    await this.db.update(schema.quickbooksAuth)
      .set({ ...status, updatedAt: new Date() })
      .where(eq(schema.quickbooksAuth.id, id));
  }

  // Integration Config health check methods - use getIntegrationConfigById from line 3554 instead

  async getIntegrationConfigsByUserId(userId: string): Promise<IntegrationConfig[]> {
    return await this.db.select().from(schema.integrationConfigs)
      .where(eq(schema.integrationConfigs.userId, userId));
  }

  async updateIntegrationConfigHealthStatus(id: string, status: { lastTokenCheckAt?: Date; lastTokenCheckStatus?: string; lastAlertSentAt?: Date | null; consecutiveFailures?: number; lastSyncStatus?: string }): Promise<void> {
    await this.db.update(schema.integrationConfigs)
      .set(status)
      .where(eq(schema.integrationConfigs.id, id));
  }

  // QuickBooks Sales Snapshots
  async getQuickbooksSalesSnapshotsBySku(sku: string): Promise<QuickbooksSalesSnapshot[]> {
    return await this.db.select().from(schema.quickbooksSalesSnapshots)
      .where(eq(schema.quickbooksSalesSnapshots.sku, sku));
  }

  async getAllQuickbooksSalesSnapshots(): Promise<QuickbooksSalesSnapshot[]> {
    return await this.db.select().from(schema.quickbooksSalesSnapshots);
  }

  async getQuickbooksDemandHistory(params: {
    search?: string;
    year?: number;
    month?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: QuickbooksSalesSnapshot[]; total: number; years: number[] }> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    const conditions: any[] = [];
    
    if (params.search) {
      const searchPattern = `%${params.search}%`;
      conditions.push(or(
        ilike(schema.quickbooksSalesSnapshots.sku, searchPattern),
        ilike(schema.quickbooksSalesSnapshots.productName, searchPattern)
      ));
    }
    
    if (params.year) {
      conditions.push(eq(schema.quickbooksSalesSnapshots.year, params.year));
    }
    
    if (params.month) {
      conditions.push(eq(schema.quickbooksSalesSnapshots.month, params.month));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, countResult, yearsResult] = await Promise.all([
      this.db.select()
        .from(schema.quickbooksSalesSnapshots)
        .where(whereClause)
        .orderBy(desc(schema.quickbooksSalesSnapshots.year), desc(schema.quickbooksSalesSnapshots.month))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)::int` })
        .from(schema.quickbooksSalesSnapshots)
        .where(whereClause),
      this.db.selectDistinct({ year: schema.quickbooksSalesSnapshots.year })
        .from(schema.quickbooksSalesSnapshots)
        .orderBy(desc(schema.quickbooksSalesSnapshots.year))
    ]);

    const total = countResult[0]?.count ?? 0;
    const years = yearsResult.map(r => r.year);

    return { items, total, years };
  }

  async upsertQuickbooksSalesSnapshot(snapshot: Omit<InsertQuickbooksSalesSnapshot, 'id'>): Promise<{ snapshot: QuickbooksSalesSnapshot; isNew: boolean }> {
    const existing = await this.db.select().from(schema.quickbooksSalesSnapshots)
      .where(and(
        eq(schema.quickbooksSalesSnapshots.sku, snapshot.sku),
        eq(schema.quickbooksSalesSnapshots.year, snapshot.year),
        eq(schema.quickbooksSalesSnapshots.month, snapshot.month)
      ));

    if (existing[0]) {
      const updated = await this.db.update(schema.quickbooksSalesSnapshots)
        .set({
          ...snapshot,
          updatedAt: new Date(),
        })
        .where(eq(schema.quickbooksSalesSnapshots.id, existing[0].id))
        .returning();
      return { snapshot: updated[0], isNew: false };
    } else {
      const id = randomUUID();
      const now = new Date();
      const inserted = await this.db.insert(schema.quickbooksSalesSnapshots).values({
        ...snapshot,
        id,
        createdAt: now,
        updatedAt: now,
      }).returning();
      return { snapshot: inserted[0], isNew: true };
    }
  }

  // QuickBooks Vendor Mappings
  async getQuickbooksVendorMapping(supplierId: string): Promise<QuickbooksVendorMapping | null> {
    const results = await this.db.select().from(schema.quickbooksVendorMappings)
      .where(eq(schema.quickbooksVendorMappings.supplierId, supplierId));
    return results[0] || null;
  }

  async createQuickbooksVendorMapping(mapping: InsertQuickbooksVendorMapping): Promise<QuickbooksVendorMapping> {
    const id = randomUUID();
    const result = await this.db.insert(schema.quickbooksVendorMappings).values({
      ...mapping,
      id,
      createdAt: new Date(),
    }).returning();
    return result[0];
  }

  // QuickBooks Item Mappings
  async getQuickbooksItemMapping(itemId: string): Promise<QuickbooksItemMapping | null> {
    const results = await this.db.select().from(schema.quickbooksItemMappings)
      .where(eq(schema.quickbooksItemMappings.itemId, itemId));
    return results[0] || null;
  }

  async createQuickbooksItemMapping(mapping: InsertQuickbooksItemMapping): Promise<QuickbooksItemMapping> {
    const id = randomUUID();
    const result = await this.db.insert(schema.quickbooksItemMappings).values({
      ...mapping,
      id,
      createdAt: new Date(),
    }).returning();
    return result[0];
  }

  // QuickBooks Bills
  async getQuickbooksBillByPurchaseOrderId(purchaseOrderId: string): Promise<QuickbooksBill | null> {
    const results = await this.db.select().from(schema.quickbooksBills)
      .where(eq(schema.quickbooksBills.purchaseOrderId, purchaseOrderId));
    return results[0] || null;
  }

  async createQuickbooksBill(bill: InsertQuickbooksBill): Promise<QuickbooksBill> {
    const id = randomUUID();
    const now = new Date();
    const result = await this.db.insert(schema.quickbooksBills).values({
      ...bill,
      id,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return result[0];
  }

  async updateQuickbooksBill(id: string, bill: Partial<InsertQuickbooksBill>): Promise<QuickbooksBill | null> {
    const result = await this.db.update(schema.quickbooksBills)
      .set({ ...bill, updatedAt: new Date() })
      .where(eq(schema.quickbooksBills.id, id))
      .returning();
    return result[0] || null;
  }

  // Ad Platform Configs
  async getAdPlatformConfig(userId: string, platform: string): Promise<AdPlatformConfig | undefined> {
    const results = await this.db.select().from(schema.adPlatformConfigs)
      .where(and(
        eq(schema.adPlatformConfigs.userId, userId),
        eq(schema.adPlatformConfigs.platform, platform)
      ));
    return results[0];
  }

  async getAllAdPlatformConfigs(userId: string): Promise<AdPlatformConfig[]> {
    return await this.db.select().from(schema.adPlatformConfigs)
      .where(eq(schema.adPlatformConfigs.userId, userId));
  }

  async createAdPlatformConfig(config: InsertAdPlatformConfig): Promise<AdPlatformConfig> {
    const id = randomUUID();
    const now = new Date();
    const result = await this.db.insert(schema.adPlatformConfigs).values({
      ...config,
      id,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return result[0];
  }

  async updateAdPlatformConfig(id: string, updates: Partial<InsertAdPlatformConfig>): Promise<AdPlatformConfig | undefined> {
    const results = await this.db.update(schema.adPlatformConfigs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(schema.adPlatformConfigs.id, id))
      .returning();
    return results[0];
  }

  async deleteAdPlatformConfig(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.adPlatformConfigs)
      .where(eq(schema.adPlatformConfigs.id, id))
      .returning();
    return results.length > 0;
  }

  // Ad SKU Mappings
  async getAllAdSkuMappings(): Promise<AdSkuMapping[]> {
    return await this.db.select().from(schema.adSkuMappings);
  }

  async getAdSkuMappingsBySku(sku: string): Promise<AdSkuMapping[]> {
    return await this.db.select().from(schema.adSkuMappings)
      .where(eq(schema.adSkuMappings.sku, sku));
  }

  async getAdSkuMappingsByPlatform(platform: string): Promise<AdSkuMapping[]> {
    return await this.db.select().from(schema.adSkuMappings)
      .where(eq(schema.adSkuMappings.platform, platform));
  }

  async createAdSkuMapping(mapping: InsertAdSkuMapping): Promise<AdSkuMapping> {
    const id = randomUUID();
    const result = await this.db.insert(schema.adSkuMappings).values({
      ...mapping,
      id,
      createdAt: new Date(),
    }).returning();
    return result[0];
  }

  async updateAdSkuMapping(id: string, updates: Partial<InsertAdSkuMapping>): Promise<AdSkuMapping | undefined> {
    const results = await this.db.update(schema.adSkuMappings)
      .set(updates)
      .where(eq(schema.adSkuMappings.id, id))
      .returning();
    return results[0];
  }

  async deleteAdSkuMapping(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.adSkuMappings)
      .where(eq(schema.adSkuMappings.id, id))
      .returning();
    return results.length > 0;
  }

  // Ad Metrics Daily
  async getAdMetricsBySkuDays(sku: string, days: number): Promise<AdMetricsDaily[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    
    return await this.db.select().from(schema.adMetricsDaily)
      .where(and(
        eq(schema.adMetricsDaily.sku, sku),
        gt(schema.adMetricsDaily.date, cutoffStr)
      ));
  }

  async getAdMetricsByPlatformDateRange(platform: string, startDate: Date, endDate: Date): Promise<AdMetricsDaily[]> {
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    
    return await this.db.select().from(schema.adMetricsDaily)
      .where(and(
        eq(schema.adMetricsDaily.platform, platform),
        gt(schema.adMetricsDaily.date, startStr)
      ));
  }

  async getAdMetricsBySkuAndDateRange(sku: string, startDate: string, endDate: string): Promise<AdMetricsDaily[]> {
    return await this.db.select().from(schema.adMetricsDaily)
      .where(and(
        eq(schema.adMetricsDaily.sku, sku),
        gte(schema.adMetricsDaily.date, startDate),
        lte(schema.adMetricsDaily.date, endDate)
      ));
  }

  async upsertAdMetricsDaily(metrics: InsertAdMetricsDaily): Promise<AdMetricsDaily> {
    const id = randomUUID();
    const now = new Date();
    
    // Try to find existing
    const existing = await this.db.select().from(schema.adMetricsDaily)
      .where(and(
        eq(schema.adMetricsDaily.platform, metrics.platform),
        eq(schema.adMetricsDaily.sku, metrics.sku),
        eq(schema.adMetricsDaily.date, metrics.date)
      ));
    
    if (existing.length > 0) {
      const result = await this.db.update(schema.adMetricsDaily)
        .set({
          impressions: metrics.impressions ?? existing[0].impressions,
          clicks: metrics.clicks ?? existing[0].clicks,
          spend: metrics.spend ?? existing[0].spend,
          conversions: metrics.conversions ?? existing[0].conversions,
          revenue: metrics.revenue ?? existing[0].revenue,
          currency: metrics.currency ?? existing[0].currency,
          updatedAt: now,
        })
        .where(eq(schema.adMetricsDaily.id, existing[0].id))
        .returning();
      return result[0];
    }
    
    const result = await this.db.insert(schema.adMetricsDaily).values({
      ...metrics,
      id,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return result[0];
  }

  // Label Formats
  async getLabelFormatsByUserId(userId: string): Promise<LabelFormat[]> {
    return await this.db.select().from(schema.labelFormats)
      .where(eq(schema.labelFormats.userId, userId));
  }

  async getLabelFormat(id: string): Promise<LabelFormat | undefined> {
    const results = await this.db.select().from(schema.labelFormats)
      .where(eq(schema.labelFormats.id, id));
    return results[0];
  }

  async createLabelFormat(format: InsertLabelFormat): Promise<LabelFormat> {
    const id = randomUUID();
    const now = new Date();
    const result = await this.db.insert(schema.labelFormats).values({
      ...format,
      id,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return result[0];
  }

  async updateLabelFormat(id: string, updates: Partial<InsertLabelFormat>): Promise<LabelFormat | undefined> {
    const now = new Date();
    const results = await this.db.update(schema.labelFormats)
      .set({ ...updates, updatedAt: now })
      .where(eq(schema.labelFormats.id, id))
      .returning();
    return results[0];
  }

  async deleteLabelFormat(id: string): Promise<boolean> {
    const results = await this.db.delete(schema.labelFormats)
      .where(eq(schema.labelFormats.id, id))
      .returning();
    return results.length > 0;
  }

  async setDefaultLabelFormat(userId: string, formatId: string): Promise<void> {
    // First, unset any existing defaults for this user
    await this.db.update(schema.labelFormats)
      .set({ isDefault: false })
      .where(eq(schema.labelFormats.userId, userId));
    
    // Then set the new default
    await this.db.update(schema.labelFormats)
      .set({ isDefault: true })
      .where(and(
        eq(schema.labelFormats.id, formatId),
        eq(schema.labelFormats.userId, userId)
      ));
  }

  // System Logs
  async getAllSystemLogs(filters?: { type?: string; severity?: string; entityType?: string; startDate?: Date; endDate?: Date }): Promise<SystemLog[]> {
    let query = this.db.select().from(schema.systemLogs);
    
    const conditions = [];
    if (filters?.type) {
      conditions.push(eq(schema.systemLogs.type, filters.type));
    }
    if (filters?.severity) {
      conditions.push(eq(schema.systemLogs.severity, filters.severity));
    }
    if (filters?.entityType) {
      conditions.push(eq(schema.systemLogs.entityType, filters.entityType));
    }
    if (filters?.startDate) {
      conditions.push(gte(schema.systemLogs.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(schema.systemLogs.createdAt, filters.endDate));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    const results = await query.orderBy(drizzleSql`${schema.systemLogs.createdAt} DESC`);
    return results;
  }

  async getSystemLog(id: string): Promise<SystemLog | undefined> {
    const results = await this.db.select().from(schema.systemLogs)
      .where(eq(schema.systemLogs.id, id));
    return results[0];
  }

  async createSystemLog(log: InsertSystemLog): Promise<SystemLog> {
    const id = randomUUID();
    const result = await this.db.insert(schema.systemLogs).values({
      ...log,
      id,
    }).returning();
    return result[0];
  }

  // AI Agent Settings
  async getAiAgentSettingsByUserId(userId: string): Promise<AiAgentSettings | undefined> {
    const results = await this.db.select().from(schema.aiAgentSettings)
      .where(eq(schema.aiAgentSettings.userId, userId));
    return results[0];
  }

  async createAiAgentSettings(settings: InsertAiAgentSettings): Promise<AiAgentSettings> {
    const id = randomUUID();
    const now = new Date();
    const result = await this.db.insert(schema.aiAgentSettings).values({
      ...settings,
      id,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return result[0];
  }

  async updateAiAgentSettings(userId: string, settings: Partial<InsertAiAgentSettings>): Promise<AiAgentSettings | undefined> {
    const now = new Date();
    const result = await this.db.update(schema.aiAgentSettings)
      .set({ ...settings, updatedAt: now })
      .where(eq(schema.aiAgentSettings.userId, userId))
      .returning();
    return result[0];
  }
}

// Use PostgreSQL storage with DATABASE_URL from environment
export const storage = process.env.DATABASE_URL 
  ? new PostgresStorage(process.env.DATABASE_URL)
  : new MemStorage();
