import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
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
});

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
  price: real("price"),
  availableQuantity: integer("available_quantity"),
  leadTimeDays: integer("lead_time_days"),
  isDesignatedSupplier: boolean("is_designated_supplier").notNull().default(false),
});

export const insertSupplierItemSchema = createInsertSchema(supplierItems).omit({ id: true });
export type InsertSupplierItem = z.infer<typeof insertSupplierItemSchema>;
export type SupplierItem = typeof supplierItems.$inferSelect;

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
  llmCustomEndpoint: text("llm_custom_endpoint"),
  enableLlmOrderRecommendations: boolean("enable_llm_order_recommendations").notNull().default(false),
  enableLlmSupplierRanking: boolean("enable_llm_supplier_ranking").notNull().default(false),
  enableLlmForecasting: boolean("enable_llm_forecasting").notNull().default(false),
});

export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
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
