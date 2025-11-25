import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, boolean, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// USERS & AUTHENTICATION
// ============================================================================

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ============================================================================
// ITEMS (Components & Finished Products)
// ============================================================================

export const items = pgTable("items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  type: text("type").notNull(), // 'component' or 'finished_product'
  unit: text("unit").notNull().default('units'), // 'units', 'kg', etc.
  currentStock: integer("current_stock").notNull().default(0),
  minStock: integer("min_stock").notNull().default(0),
  dailyUsage: real("daily_usage").notNull().default(0),
  barcode: text("barcode"),
  location: text("location"), // Legacy warehouse location (deprecated - use hildaleQty/pivotQty)
  // Finished product location quantities
  hildaleQty: integer("hildale_qty").notNull().default(0), // Quantity at Hildale warehouse
  pivotQty: integer("pivot_qty").notNull().default(0), // Quantity at Pivot/Extensiv warehouse
  // Enhanced barcode and product tracking fields
  productKind: text("product_kind"), // 'FINISHED' or 'RAW'
  barcodeValue: text("barcode_value"),
  barcodeFormat: text("barcode_format"), // Physical symbology: 'CODE128', 'EAN13', 'QR', etc.
  barcodeUsage: text("barcode_usage"), // Business meaning: 'EXTERNAL_GS1' or 'INTERNAL_STOCK'
  barcodeSource: text("barcode_source"), // 'AUTO_GENERATED', 'IMPORTED', 'MANUAL'
  externalSystem: text("external_system"), // 'shopify', 'amazon', 'csv_generic', etc.
  externalId: text("external_id"), // External system's ID/handle/ASIN
  // AI Forecast tracking fields
  forecastDirty: boolean("forecast_dirty").notNull().default(true), // Indicates forecast needs refresh
  lastForecastAt: timestamp("last_forecast_at"), // Last time AI forecast was updated
  forecastData: jsonb("forecast_data"), // Stores last generated forecast (ReorderRecommendation)
});

export const insertItemSchema = createInsertSchema(items).omit({ id: true });
export type InsertItem = z.infer<typeof insertItemSchema>;
export type Item = typeof items.$inferSelect;

// ============================================================================
// BINS (Storage Locations)
// ============================================================================

export const bins = pgTable("bins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  location: text("location"),
  barcode: text("barcode"),
});

export const insertBinSchema = createInsertSchema(bins).omit({ id: true });
export type InsertBin = z.infer<typeof insertBinSchema>;
export type Bin = typeof bins.$inferSelect;

// ============================================================================
// INVENTORY BY BIN
// ============================================================================

export const inventoryByBin = pgTable("inventory_by_bin", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemId: varchar("item_id").notNull().references(() => items.id),
  binId: varchar("bin_id").notNull().references(() => bins.id),
  quantity: integer("quantity").notNull().default(0),
});

export const insertInventoryByBinSchema = createInsertSchema(inventoryByBin).omit({ id: true });
export type InsertInventoryByBin = z.infer<typeof insertInventoryByBinSchema>;
export type InventoryByBin = typeof inventoryByBin.$inferSelect;

// ============================================================================
// BILL OF MATERIALS (BOM)
// ============================================================================

export const billOfMaterials = pgTable("bill_of_materials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  finishedProductId: varchar("finished_product_id").notNull().references(() => items.id),
  componentId: varchar("component_id").notNull().references(() => items.id),
  quantityRequired: integer("quantity_required").notNull(),
}, (table) => ({
  finishedProductIdIdx: index("bill_of_materials_finished_product_id_idx").on(table.finishedProductId),
}));

export const insertBillOfMaterialsSchema = createInsertSchema(billOfMaterials).omit({ id: true });
export type InsertBillOfMaterials = z.infer<typeof insertBillOfMaterialsSchema>;
export type BillOfMaterials = typeof billOfMaterials.$inferSelect;

// ============================================================================
// SUPPLIERS
// ============================================================================

export const suppliers = pgTable("suppliers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  catalogUrl: text("catalog_url"),
  logoUrl: text("logo_url"),
});

export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;

// ============================================================================
// SUPPLIER ITEMS (Pricing & Availability)
// ============================================================================

export const supplierItems = pgTable("supplier_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  supplierId: varchar("supplier_id").notNull().references(() => suppliers.id),
  itemId: varchar("item_id").notNull().references(() => items.id),
  supplierSku: text("supplier_sku"),
  price: real("price"),
  minimumOrderQuantity: integer("minimum_order_quantity"),
  availableQuantity: integer("available_quantity"),
  leadTimeDays: integer("lead_time_days"),
  isDesignatedSupplier: boolean("is_designated_supplier").notNull().default(false),
});

export const insertSupplierItemSchema = createInsertSchema(supplierItems).omit({ id: true });
export type InsertSupplierItem = z.infer<typeof insertSupplierItemSchema>;
export type SupplierItem = typeof supplierItems.$inferSelect;

// ============================================================================
// PURCHASE ORDERS (with Issue & Refund Tracking)
// ============================================================================

export const purchaseOrders = pgTable("purchase_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poNumber: text("po_number").notNull().unique(), // e.g., PO-2025-0001
  supplierId: varchar("supplier_id").notNull().references(() => suppliers.id),
  orderDate: timestamp("order_date").notNull().default(sql`now()`),
  approvedAt: timestamp("approved_at"),
  sentAt: timestamp("sent_at"),
  expectedDate: timestamp("expected_date"),
  receivedAt: timestamp("received_at"),
  paidAt: timestamp("paid_at"),
  status: text("status").notNull().default('DRAFT'), // DRAFT, APPROVAL_PENDING, APPROVED, SENT, PARTIAL_RECEIVED, RECEIVED, CLOSED, CANCELLED
  hasIssue: boolean("has_issue").notNull().default(false),
  issueStatus: text("issue_status").notNull().default('NONE'), // NONE, OPEN, IN_PROGRESS, RESOLVED
  issueOpenedAt: timestamp("issue_opened_at"),
  issueResolvedAt: timestamp("issue_resolved_at"),
  issueType: text("issue_type"), // late, damaged, short_shipment, quality, invoice_mismatch, other
  issueNotes: text("issue_notes"),
  refundStatus: text("refund_status").notNull().default('NONE'), // NONE, REQUESTED, PARTIAL_REFUND, FULL_REFUND
  refundAmount: real("refund_amount").default(0),
  notes: text("notes"),
  ghlRepName: text("ghl_rep_name"), // GoHighLevel rep who issued the PO
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true });
export const updatePurchaseOrderSchema = insertPurchaseOrderSchema.partial();
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

// ============================================================================
// PURCHASE ORDER LINES (Line Items for each PO)
// ============================================================================

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  itemId: varchar("item_id").notNull().references(() => items.id),
  qtyOrdered: integer("qty_ordered").notNull(),
  qtyReceived: integer("qty_received").notNull().default(0),
  unitCost: real("unit_cost"),
  // AI Recommendation tracking
  aiRecommendationId: varchar("ai_recommendation_id").references(() => aiRecommendations.id),
  recommendedQtyAtOrderTime: integer("recommended_qty_at_order_time"), // AI suggested quantity when PO was created
  finalOrderedQty: integer("final_ordered_qty"), // What user actually ordered (may differ from recommendedQty)
}, (table) => ({
  purchaseOrderIdIdx: index("purchase_order_lines_purchase_order_id_idx").on(table.purchaseOrderId),
  aiRecommendationIdIdx: index("purchase_order_lines_ai_recommendation_id_idx").on(table.aiRecommendationId),
}));

export const insertPurchaseOrderLineSchema = createInsertSchema(purchaseOrderLines).omit({ id: true });
export type InsertPurchaseOrderLine = z.infer<typeof insertPurchaseOrderLineSchema>;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;

// ============================================================================
// SUPPLIER LEADS (Discovery & Qualification)
// ============================================================================

export const supplierLeads = pgTable("supplier_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  websiteUrl: text("website_url"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  source: text("source").notNull().default('MANUAL'), // PHANTOMBUSTER, MANUAL, IMPORT, etc.
  category: text("category"),
  notes: text("notes"),
  status: text("status").notNull().default('NEW'), // NEW, RESEARCHING, CONTACTED, QUALIFIED, REJECTED, CONVERTED
  lastContactedAt: timestamp("last_contacted_at"),
  aiOutreachDraft: text("ai_outreach_draft"),
  convertedSupplierId: varchar("converted_supplier_id").references(() => suppliers.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  statusIdx: index("supplier_leads_status_idx").on(table.status),
  sourceIdx: index("supplier_leads_source_idx").on(table.source),
}));

export const insertSupplierLeadSchema = createInsertSchema(supplierLeads).omit({ id: true, createdAt: true });
export const updateSupplierLeadSchema = insertSupplierLeadSchema.partial();
export type InsertSupplierLead = z.infer<typeof insertSupplierLeadSchema>;
export type SupplierLead = typeof supplierLeads.$inferSelect;

// ============================================================================
// SALES HISTORY (from GoHighLevel)
// ============================================================================

export const salesHistory = pgTable("sales_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemId: varchar("item_id").notNull().references(() => items.id),
  quantitySold: integer("quantity_sold").notNull(),
  saleDate: timestamp("sale_date").notNull(),
  externalOrderId: text("external_order_id"),
});

export const insertSalesHistorySchema = createInsertSchema(salesHistory).omit({ id: true });
export type InsertSalesHistory = z.infer<typeof insertSalesHistorySchema>;
export type SalesHistory = typeof salesHistory.$inferSelect;

// ============================================================================
// FINISHED INVENTORY SNAPSHOT (from Extensiv/Pivot)
// ============================================================================

export const finishedInventorySnapshot = pgTable("finished_inventory_snapshot", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemId: varchar("item_id").notNull().references(() => items.id),
  quantity: integer("quantity").notNull(),
  location: text("location"),
  snapshotDate: timestamp("snapshot_date").notNull().default(sql`now()`),
});

export const insertFinishedInventorySnapshotSchema = createInsertSchema(finishedInventorySnapshot).omit({ id: true });
export type InsertFinishedInventorySnapshot = z.infer<typeof insertFinishedInventorySnapshotSchema>;
export type FinishedInventorySnapshot = typeof finishedInventorySnapshot.$inferSelect;

// ============================================================================
// INTEGRATION HEALTH
// ============================================================================

export const integrationHealth = pgTable("integration_health", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  integrationName: text("integration_name").notNull().unique(), // 'gohighlevel', 'extensiv', 'phantombuster', 'shopify'
  lastSuccessAt: timestamp("last_success_at"),
  lastStatus: text("last_status"), // 'success', 'failed', 'stale'
  lastAlertAt: timestamp("last_alert_at"),
  errorMessage: text("error_message"),
});

export const insertIntegrationHealthSchema = createInsertSchema(integrationHealth).omit({ id: true });
export type InsertIntegrationHealth = z.infer<typeof insertIntegrationHealthSchema>;
export type IntegrationHealth = typeof integrationHealth.$inferSelect;

// ============================================================================
// SETTINGS (API Keys & LLM Configuration)
// ============================================================================

export const settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  gohighlevelApiKey: text("gohighlevel_api_key"),
  shopifyApiKey: text("shopify_api_key"),
  extensivApiKey: text("extensiv_api_key"),
  phantombusterApiKey: text("phantombuster_api_key"),
  llmProvider: text("llm_provider"), // 'chatgpt', 'claude', 'grok', 'custom'
  llmApiKey: text("llm_api_key"),
  llmModel: text("llm_model"), // 'gpt-4', 'gpt-4-turbo', 'claude-3-opus', etc.
  llmCustomEndpoint: text("llm_custom_endpoint"),
  llmPromptTemplate: text("llm_prompt_template"),
  enableLlmOrderRecommendations: boolean("enable_llm_order_recommendations").notNull().default(false),
  enableLlmSupplierRanking: boolean("enable_llm_supplier_ranking").notNull().default(false),
  enableLlmForecasting: boolean("enable_llm_forecasting").notNull().default(false),
  enableVisionCapture: boolean("enable_vision_capture").notNull().default(false),
  visionProvider: text("vision_provider"), // 'gpt-4-vision', 'claude-vision'
  visionModel: text("vision_model"), // 'gpt-4o', 'gpt-4o-mini', 'claude-3-opus', 'claude-3-sonnet'
});

export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export const patchSettingsSchema = insertSettingsSchema.partial().omit({ userId: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type PatchSettings = z.infer<typeof patchSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

// ============================================================================
// BARCODES
// ============================================================================

export const barcodes = pgTable("barcodes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  value: text("value").notNull().unique(),
  name: text("name").notNull(),
  sku: text("sku"),
  purpose: text("purpose").notNull(), // 'component', 'finished_product', 'bin'
  referenceId: varchar("reference_id"), // itemId or binId
});

export const insertBarcodeSchema = createInsertSchema(barcodes).omit({ id: true });
export type InsertBarcode = z.infer<typeof insertBarcodeSchema>;
export type Barcode = typeof barcodes.$inferSelect;

// ============================================================================
// BARCODE SETTINGS (GS1 Configuration)
// ============================================================================

export const barcodeSettings = pgTable("barcode_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gs1Prefix: text("gs1_prefix"), // GS1 company prefix (nullable until registered)
  itemRefDigits: integer("item_ref_digits").notNull().default(6),
  nextItemRef: integer("next_item_ref").notNull().default(1),
  nextInternalCode: integer("next_internal_code").notNull().default(1000),
});

export const insertBarcodeSettingsSchema = createInsertSchema(barcodeSettings).omit({ id: true });
export const updateBarcodeSettingsSchema = insertBarcodeSettingsSchema.partial();
export type InsertBarcodeSettings = z.infer<typeof insertBarcodeSettingsSchema>;
export type BarcodeSettings = typeof barcodeSettings.$inferSelect;

// ============================================================================
// IMPORT PROFILES (Column Mapping Templates)
// ============================================================================

export const importProfiles = pgTable("import_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // e.g. "Generic CSV", "Shopify CSV", "Amazon Export"
  description: text("description"),
  columnMappings: text("column_mappings").notNull(), // JSON string with field mappings
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertImportProfileSchema = createInsertSchema(importProfiles).omit({ id: true, createdAt: true });
export const updateImportProfileSchema = insertImportProfileSchema.partial();
export type InsertImportProfile = z.infer<typeof insertImportProfileSchema>;
export type ImportProfile = typeof importProfiles.$inferSelect;

// ============================================================================
// IMPORT JOBS (Import History & Status Tracking)
// ============================================================================

export const importJobs = pgTable("import_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: varchar("profile_id").references(() => importProfiles.id),
  fileName: text("file_name").notNull(),
  status: text("status").notNull().default('pending'), // 'pending', 'processing', 'completed', 'failed'
  startedAt: timestamp("started_at").default(sql`now()`),
  finishedAt: timestamp("finished_at"),
  summary: text("summary"), // JSON with {inserted, updated, ignored, failed}
  errors: text("errors"), // JSON array of error messages with row numbers
});

export const insertImportJobSchema = createInsertSchema(importJobs).omit({ id: true, startedAt: true });
export const updateImportJobSchema = insertImportJobSchema.partial();
export type InsertImportJob = z.infer<typeof insertImportJobSchema>;
export type ImportJob = typeof importJobs.$inferSelect;

// ============================================================================
// INVENTORY TRANSACTIONS (Movement Audit Trail)
// ============================================================================

export const inventoryTransactions = pgTable("inventory_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemId: varchar("item_id").notNull().references(() => items.id),
  itemType: text("item_type").notNull(), // 'FINISHED' or 'RAW'
  type: text("type").notNull(), // 'RECEIVE', 'SHIP', 'TRANSFER_IN', 'TRANSFER_OUT', 'PRODUCE', 'ADJUST'
  location: text("location").notNull(), // 'HILDALE', 'PIVOT', or 'N/A' for raw items
  quantity: integer("quantity").notNull(), // Positive number (direction determined by type)
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  createdBy: text("created_by"), // User ID or system identifier
  notes: text("notes"), // Optional reason/description
}, (table) => ({
  itemIdIdx: index("inventory_transactions_item_id_idx").on(table.itemId),
  createdAtIdx: index("inventory_transactions_created_at_idx").on(table.createdAt),
}));

export const insertInventoryTransactionSchema = createInsertSchema(inventoryTransactions).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertInventoryTransaction = z.infer<typeof insertInventoryTransactionSchema>;
export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;

// ============================================================================
// AI RECOMMENDATIONS (LLM-Generated Reorder Suggestions)
// ============================================================================

export const aiRecommendations = pgTable("ai_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // 'FORECAST_REORDER', 'PO_SUGGESTION'
  itemId: varchar("item_id").notNull().references(() => items.id),
  location: text("location"), // 'PIVOT', 'HILDALE', null for global
  recommendedQty: integer("recommended_qty").notNull(),
  recommendedAction: text("recommended_action").notNull(), // 'ORDER', 'MONITOR', 'HOLD'
  horizonDays: integer("horizon_days"), // Forecast horizon in days
  contextSnapshot: jsonb("context_snapshot"), // Current stock, open POs, forecast, etc.
  llmResponseTimeMs: integer("llm_response_time_ms"), // LLM API response time
  outcomeStatus: text("outcome_status"), // 'ACCURATE', 'UNDER_ORDERED', 'OVER_ORDERED', null if not evaluated
  outcomeDetails: jsonb("outcome_details"), // {orderedQty, receivedQty, recommendedQty, daysCoveredAfterReceipt}
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  itemIdIdx: index("ai_recommendations_item_id_idx").on(table.itemId),
  createdAtIdx: index("ai_recommendations_created_at_idx").on(table.createdAt),
  typeIdx: index("ai_recommendations_type_idx").on(table.type),
}));

export const insertAIRecommendationSchema = createInsertSchema(aiRecommendations).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertAIRecommendation = z.infer<typeof insertAIRecommendationSchema>;
export type AIRecommendation = typeof aiRecommendations.$inferSelect;

// ============================================================================
// UPDATE SCHEMAS (Partial validation for PATCH endpoints)
// ============================================================================

export const updateItemSchema = insertItemSchema.partial();
export const updateBinSchema = insertBinSchema.partial();
export const updateSupplierSchema = insertSupplierSchema.partial();
export const updateSupplierItemSchema = insertSupplierItemSchema.partial();
export const updateBarcodeSchema = insertBarcodeSchema.partial();

// ============================================================================
// FINISHED PRODUCT HELPERS
// ============================================================================
// For finished products, we use pivotQty and hildaleQty as the source of truth
// instead of currentStock. These helper functions compute derived values.

export function getAvailableToShip(item: Item): number {
  if (item.type !== 'finished_product') {
    throw new Error('getAvailableToShip() can only be called on finished products');
  }
  return item.pivotQty ?? 0;
}

export function getBufferStock(item: Item): number {
  if (item.type !== 'finished_product') {
    throw new Error('getBufferStock() can only be called on finished products');
  }
  return item.hildaleQty ?? 0;
}

export function getTotalOwned(item: Item): number {
  if (item.type !== 'finished_product') {
    throw new Error('getTotalOwned() can only be called on finished products');
  }
  return (item.pivotQty ?? 0) + (item.hildaleQty ?? 0);
}

// Type for items with computed finished product quantities
export type ItemWithComputedQuantities = Item & {
  totalOwned?: number;
  availableToShip?: number;
  bufferStock?: number;
};

// ============================================================================
// RETURNS MODULE
// ============================================================================
// Returns are customer-initiated requests for refund/replacement.
// GHL's support bot handles customer communication and approval decisions.
// This app tracks return status, generates shipping labels (via pluggable service),
// and updates inventory when returns are received.

export const returnRequests = pgTable("return_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  externalOrderId: text("external_order_id").notNull(), // Upstream order ID from Shopify/Amazon/etc.
  salesChannel: text("sales_channel").notNull(), // 'SHOPIFY', 'AMAZON', 'DIRECT', 'OTHER'
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  ghlContactId: text("ghl_contact_id"), // Link back to GHL contact for workflows
  status: text("status").notNull().default('OPEN'), // 'OPEN', 'LABEL_ISSUED', 'IN_TRANSIT', 'RECEIVED', 'REFUNDED', 'REPLACED', 'CANCELLED'
  resolutionRequested: text("resolution_requested").notNull(), // 'REFUND', 'REPLACEMENT', 'STORE_CREDIT'
  resolutionFinal: text("resolution_final"), // What actually happened (nullable)
  reason: text("reason"), // High-level reason from GHL bot
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  externalOrderIdIdx: index("return_requests_external_order_id_idx").on(table.externalOrderId),
  statusIdx: index("return_requests_status_idx").on(table.status),
  createdAtIdx: index("return_requests_created_at_idx").on(table.createdAt),
}));

export const insertReturnRequestSchema = createInsertSchema(returnRequests).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true 
});
export type InsertReturnRequest = z.infer<typeof insertReturnRequestSchema>;
export type ReturnRequest = typeof returnRequests.$inferSelect;

export const returnItems = pgTable("return_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  returnRequestId: varchar("return_request_id").notNull().references(() => returnRequests.id),
  inventoryItemId: varchar("inventory_item_id").notNull().references(() => items.id),
  sku: text("sku").notNull(), // Denormalized for quick viewing
  qtyRequested: integer("qty_requested").notNull(),
  qtyApproved: integer("qty_approved").notNull().default(0), // What we allow to be returned
  qtyReceived: integer("qty_received").notNull().default(0), // What actually came back
  disposition: text("disposition"), // 'RESTOCK', 'SCRAP', 'INSPECT' (null until received)
  notes: text("notes"),
}, (table) => ({
  returnRequestIdIdx: index("return_items_return_request_id_idx").on(table.returnRequestId),
  inventoryItemIdIdx: index("return_items_inventory_item_id_idx").on(table.inventoryItemId),
}));

export const insertReturnItemSchema = createInsertSchema(returnItems).omit({ id: true });
export type InsertReturnItem = z.infer<typeof insertReturnItemSchema>;
export type ReturnItem = typeof returnItems.$inferSelect;

export const returnShipments = pgTable("return_shipments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  returnRequestId: varchar("return_request_id").notNull().references(() => returnRequests.id),
  carrier: text("carrier").notNull(), // 'UPS', 'USPS', 'FEDEX', etc.
  trackingNumber: text("tracking_number").notNull(),
  labelUrl: text("label_url").notNull(), // URL to PDF/label image
  status: text("status").notNull().default('LABEL_CREATED'), // 'LABEL_CREATED', 'IN_TRANSIT', 'DELIVERED', 'LOST', 'CANCELLED'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  returnRequestIdIdx: index("return_shipments_return_request_id_idx").on(table.returnRequestId),
  trackingNumberIdx: index("return_shipments_tracking_number_idx").on(table.trackingNumber),
}));

export const insertReturnShipmentSchema = createInsertSchema(returnShipments).omit({ 
  id: true,
  createdAt: true,
  updatedAt: true 
});
export type InsertReturnShipment = z.infer<typeof insertReturnShipmentSchema>;
export type ReturnShipment = typeof returnShipments.$inferSelect;

// ============================================================================
// CHANNELS (Marketing & Sales Channels)
// ============================================================================
// Defines canonical channels for ad platforms and sales channels.
// Used for mapping products to external identifiers and tracking performance.

export const channels = pgTable("channels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(), // 'google_ads', 'meta_ads', 'tiktok_ads', 'shopify', 'amazon'
  name: text("name").notNull(), // Display name
  type: text("type").notNull(), // 'AD_PLATFORM' or 'SALES_CHANNEL'
  isActive: boolean("is_active").notNull().default(true),
  syncIntervalHours: integer("sync_interval_hours").notNull().default(24), // Hours between syncs (default: daily)
});

export const insertChannelSchema = createInsertSchema(channels).omit({ id: true });
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Channel = typeof channels.$inferSelect;

// ============================================================================
// PRODUCT CHANNEL MAPPING
// ============================================================================
// Links internal finished products to external identifiers per channel.
// Enables tracking of ad performance and sales across platforms.

export const productChannelMappings = pgTable("product_channel_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => items.id),
  channelId: varchar("channel_id").notNull().references(() => channels.id),
  externalId: text("external_id").notNull(), // Shopify variant ID, Amazon SKU/ASIN, Ad platform product ID
  externalName: text("external_name"), // External product/variant name for reference
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  productIdIdx: index("product_channel_mappings_product_id_idx").on(table.productId),
  channelIdIdx: index("product_channel_mappings_channel_id_idx").on(table.channelId),
  externalIdIdx: index("product_channel_mappings_external_id_idx").on(table.externalId),
}));

export const insertProductChannelMappingSchema = createInsertSchema(productChannelMappings).omit({ 
  id: true,
  createdAt: true,
  updatedAt: true 
});
export type InsertProductChannelMapping = z.infer<typeof insertProductChannelMappingSchema>;
export type ProductChannelMapping = typeof productChannelMappings.$inferSelect;

// ============================================================================
// AD PERFORMANCE SNAPSHOT
// ============================================================================
// Daily grain fact table for ad performance metrics from Google Ads, Meta, TikTok.

export const adPerformanceSnapshots = pgTable("ad_performance_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => items.id),
  channelId: varchar("channel_id").notNull().references(() => channels.id),
  date: timestamp("date").notNull(), // Daily grain
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  conversions: real("conversions").notNull().default(0), // Can be fractional (conversion tracking)
  revenue: real("revenue").notNull().default(0), // Revenue attributed to ads (if available)
  spend: real("spend").notNull().default(0), // Ad spend for the day
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  productIdIdx: index("ad_performance_snapshots_product_id_idx").on(table.productId),
  channelIdIdx: index("ad_performance_snapshots_channel_id_idx").on(table.channelId),
  dateIdx: index("ad_performance_snapshots_date_idx").on(table.date),
  productChannelDateIdx: index("ad_performance_snapshots_product_channel_date_idx").on(table.productId, table.channelId, table.date),
}));

export const insertAdPerformanceSnapshotSchema = createInsertSchema(adPerformanceSnapshots).omit({ 
  id: true,
  createdAt: true,
  updatedAt: true 
});
export type InsertAdPerformanceSnapshot = z.infer<typeof insertAdPerformanceSnapshotSchema>;
export type AdPerformanceSnapshot = typeof adPerformanceSnapshots.$inferSelect;

// ============================================================================
// SALES SNAPSHOT
// ============================================================================
// Daily grain fact table for sales metrics from Shopify, Amazon, and other sales channels.

export const salesSnapshots = pgTable("sales_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => items.id),
  channelId: varchar("channel_id").notNull().references(() => channels.id),
  date: timestamp("date").notNull(), // Daily grain
  unitsSold: integer("units_sold").notNull().default(0),
  revenue: real("revenue").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  productIdIdx: index("sales_snapshots_product_id_idx").on(table.productId),
  channelIdIdx: index("sales_snapshots_channel_id_idx").on(table.channelId),
  dateIdx: index("sales_snapshots_date_idx").on(table.date),
  productChannelDateIdx: index("sales_snapshots_product_channel_date_idx").on(table.productId, table.channelId, table.date),
}));

export const insertSalesSnapshotSchema = createInsertSchema(salesSnapshots).omit({ 
  id: true,
  createdAt: true,
  updatedAt: true 
});
export type InsertSalesSnapshot = z.infer<typeof insertSalesSnapshotSchema>;
export type SalesSnapshot = typeof salesSnapshots.$inferSelect;

// ============================================================================
// PRODUCT FORECAST CONTEXT
// ============================================================================
// Aggregated view of all signals needed for AI forecasting per finished product.
// Combines inventory, PO, sales velocity, ad performance, and stock calculations.

export const productForecastContext = pgTable("product_forecast_context", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => items.id).unique(),
  // Inventory Levels
  onHandPivot: integer("on_hand_pivot").notNull().default(0),
  onHandHildale: integer("on_hand_hildale").notNull().default(0),
  onHandTotal: integer("on_hand_total").notNull().default(0),
  inboundUnits: integer("inbound_units").notNull().default(0), // Sum of open POs not yet received
  // Sales Velocity (all channels combined)
  unitsSold7d: integer("units_sold_7d").notNull().default(0),
  unitsSold30d: integer("units_sold_30d").notNull().default(0),
  revenue7d: real("revenue_7d").notNull().default(0),
  revenue30d: real("revenue_30d").notNull().default(0),
  // Sales by Channel (Shopify)
  shopifyUnitsSold7d: integer("shopify_units_sold_7d").notNull().default(0),
  shopifyUnitsSold30d: integer("shopify_units_sold_30d").notNull().default(0),
  shopifyRevenue7d: real("shopify_revenue_7d").notNull().default(0),
  shopifyRevenue30d: real("shopify_revenue_30d").notNull().default(0),
  // Sales by Channel (Amazon)
  amazonUnitsSold7d: integer("amazon_units_sold_7d").notNull().default(0),
  amazonUnitsSold30d: integer("amazon_units_sold_30d").notNull().default(0),
  amazonRevenue7d: real("amazon_revenue_7d").notNull().default(0),
  amazonRevenue30d: real("amazon_revenue_30d").notNull().default(0),
  // Ad Performance (Google Ads)
  googleAdSpend7d: real("google_ad_spend_7d").notNull().default(0),
  googleAdSpend30d: real("google_ad_spend_30d").notNull().default(0),
  googleConversions7d: real("google_conversions_7d").notNull().default(0),
  googleRoas7d: real("google_roas_7d").notNull().default(0), // Return on Ad Spend
  // Ad Performance (Meta Ads)
  metaAdSpend7d: real("meta_ad_spend_7d").notNull().default(0),
  metaAdSpend30d: real("meta_ad_spend_30d").notNull().default(0),
  metaConversions7d: real("meta_conversions_7d").notNull().default(0),
  metaRoas7d: real("meta_roas_7d").notNull().default(0),
  // Ad Performance (TikTok Ads)
  tiktokAdSpend7d: real("tiktok_ad_spend_7d").notNull().default(0),
  tiktokAdSpend30d: real("tiktok_ad_spend_30d").notNull().default(0),
  tiktokConversions7d: real("tiktok_conversions_7d").notNull().default(0),
  tiktokRoas7d: real("tiktok_roas_7d").notNull().default(0),
  // Stock Calculations
  daysOfStockLeft: real("days_of_stock_left"), // Based on recent sales velocity
  averageDailySales: real("average_daily_sales").notNull().default(0), // Rolling average
  // Metadata
  lastUpdatedAt: timestamp("last_updated_at").notNull().default(sql`now()`),
}, (table) => ({
  productIdIdx: index("product_forecast_context_product_id_idx").on(table.productId),
  daysOfStockLeftIdx: index("product_forecast_context_days_of_stock_left_idx").on(table.daysOfStockLeft),
  lastUpdatedAtIdx: index("product_forecast_context_last_updated_at_idx").on(table.lastUpdatedAt),
}));

export const insertProductForecastContextSchema = createInsertSchema(productForecastContext).omit({ 
  id: true,
  lastUpdatedAt: true 
});
export type InsertProductForecastContext = z.infer<typeof insertProductForecastContextSchema>;
export type ProductForecastContext = typeof productForecastContext.$inferSelect;
