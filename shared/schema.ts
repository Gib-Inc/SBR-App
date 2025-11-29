import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, boolean, index, jsonb, uniqueIndex, date } from "drizzle-orm/pg-core";
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
  pivotQty: integer("pivot_qty").notNull().default(0), // Quantity at Pivot/Extensiv warehouse (authoritative mirror from Extensiv)
  availableForSaleQty: integer("available_for_sale_qty").notNull().default(0), // Live projected 3PL stock available for sale (pivotQty baseline + local deltas from orders/returns)
  // V1: Extensiv read-only snapshot for reconciliation/variance display
  extensivOnHandSnapshot: integer("extensiv_on_hand_snapshot").notNull().default(0), // Last synced Extensiv quantity (read-only, for variance comparison)
  extensivLastSyncAt: timestamp("extensiv_last_sync_at"), // When this item was last synced from Extensiv
  // Enhanced barcode and product tracking fields
  productKind: text("product_kind"), // 'FINISHED' or 'RAW'
  barcodeValue: text("barcode_value"),
  barcodeFormat: text("barcode_format"), // Physical symbology: 'CODE128', 'EAN13', 'QR', etc.
  barcodeUsage: text("barcode_usage"), // Business meaning: 'EXTERNAL_GS1' or 'INTERNAL_STOCK'
  barcodeSource: text("barcode_source"), // 'AUTO_GENERATED', 'IMPORTED', 'MANUAL'
  externalSystem: text("external_system"), // 'shopify', 'amazon', 'csv_generic', etc.
  externalId: text("external_id"), // External system's ID/handle/ASIN
  // Sales channel and marketplace fields
  salesChannels: text("sales_channels").array(), // Array of channels: 'amazon', 'shopify', 'internal'
  amazonAsin: text("amazon_asin"), // Amazon ASIN for marketplace-linked products
  // Shopify integration fields (for two-way inventory sync)
  shopifyProductId: text("shopify_product_id"), // Shopify product ID
  shopifyVariantId: text("shopify_variant_id"), // Shopify variant ID for inventory updates
  shopifyLocationId: text("shopify_location_id"), // Shopify inventory location ID (defaults to env SHOPIFY_LOCATION_ID)
  updatedAt: timestamp("updated_at").defaultNow(), // Last modification timestamp
  // AI Forecast tracking fields
  forecastDirty: boolean("forecast_dirty").notNull().default(true), // Indicates forecast needs refresh
  lastForecastAt: timestamp("last_forecast_at"), // Last time AI forecast was updated
  forecastData: jsonb("forecast_data"), // Stores last generated forecast (ReorderRecommendation)
  // Purchase cost fields for auto-suggest feature
  defaultPurchaseCost: real("default_purchase_cost"), // Default cost when creating PO lines (can be auto-scraped)
  currency: text("currency").default("USD"), // Currency for defaultPurchaseCost
  supplierProductUrl: text("supplier_product_url"), // URL to supplier's product page for price scraping
  costSource: text("cost_source").default("MANUAL"), // 'MANUAL' | 'AUTO_SCRAPED' | 'API'
  lastCostUpdatedAt: timestamp("last_cost_updated_at"), // When cost was last updated
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
  email: text("email"),
  phone: text("phone"),
  catalogUrl: text("catalog_url"),
  logoUrl: text("logo_url"),
  ghlContactId: text("ghl_contact_id"),
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
// PURCHASE ORDERS (Full PO System - This App is System of Record)
// ============================================================================
// LEGAL NOTICE: Purchase orders created here are official purchasing documents.
// They should be reviewed before sending to suppliers. Supplier terms and email
// content must comply with actual contracts and local laws. Any automated sending
// should include internal approvals (e.g. GHL approvals) before emailing suppliers.

export const purchaseOrders = pgTable("purchase_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poNumber: text("po_number").notNull().unique(), // e.g., PO-2025-0001
  
  // Buyer Information
  buyerCompanyName: text("buyer_company_name"),
  buyerAddress: text("buyer_address"),
  
  // Supplier Information (denormalized for historical record)
  supplierId: varchar("supplier_id").notNull().references(() => suppliers.id),
  supplierName: text("supplier_name"), // Snapshot at PO creation
  supplierEmail: text("supplier_email"), // Snapshot at PO creation
  supplierAddress: text("supplier_address"), // Snapshot at PO creation
  
  // Shipping & Terms
  shipToLocation: text("ship_to_location"), // Where goods should be delivered
  currency: text("currency").notNull().default('USD'),
  paymentTerms: text("payment_terms"), // e.g., "Net 30", "Due on Receipt"
  incoterms: text("incoterms"), // e.g., "FOB", "CIF", "EXW"
  
  // Dates
  orderDate: timestamp("order_date").notNull().default(sql`now()`),
  approvedAt: timestamp("approved_at"),
  sentAt: timestamp("sent_at"),
  expectedDate: timestamp("expected_date"),
  receivedAt: timestamp("received_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  
  // Status (State Machine enforced)
  // Valid transitions: DRAFT → APPROVED → SENT → PARTIALLY_RECEIVED/RECEIVED → CLOSED
  // Any open state → CANCELLED (with cancellationReason)
  status: text("status").notNull().default('DRAFT'),
  cancellationReason: text("cancellation_reason"),
  
  // Financial Summary
  subtotal: real("subtotal").notNull().default(0),
  shippingCost: real("shipping_cost").notNull().default(0),
  otherFees: real("other_fees").notNull().default(0),
  total: real("total").notNull().default(0),
  
  // Issue & Refund Tracking
  hasIssue: boolean("has_issue").notNull().default(false),
  issueStatus: text("issue_status").notNull().default('NONE'), // NONE, OPEN, IN_PROGRESS, RESOLVED
  issueOpenedAt: timestamp("issue_opened_at"),
  issueResolvedAt: timestamp("issue_resolved_at"),
  issueType: text("issue_type"), // late, damaged, short_shipment, quality, invoice_mismatch, other
  issueNotes: text("issue_notes"),
  refundStatus: text("refund_status").notNull().default('NONE'), // NONE, REQUESTED, PARTIAL_REFUND, FULL_REFUND
  refundAmount: real("refund_amount").default(0),
  
  // Notes & Comments
  notes: text("notes"),
  internalNotes: text("internal_notes"), // Not shown on PDF/emails
  
  // Email Sending (SendGrid) - Primary channel for sending POs to suppliers
  // LEGAL NOTICE: POs sent via email are transactional documents. Ensure SPF/DKIM/DMARC
  // are configured for sending domain. Content should be reviewed for compliance.
  emailTo: text("email_to"), // Actual email address used when sending the PO
  emailSubject: text("email_subject"), // Last subject used
  emailBodyText: text("email_body_text"), // Plain-text body (for audit)
  lastEmailStatus: text("last_email_status").notNull().default('NOT_SENT'), // NOT_SENT, SENT, OPENED, FAILED
  lastEmailSentAt: timestamp("last_email_sent_at"),
  lastEmailProviderMessageId: text("last_email_provider_message_id"), // SendGrid message ID
  lastEmailError: text("last_email_error"), // Error message if send failed
  lastEmailEventAt: timestamp("last_email_event_at"), // Timestamp of last email event (open, bounce, etc.)
  lastEmailEventType: text("last_email_event_type"), // Type of last email event (sent, delivered, open, bounce, etc.)
  
  // Supplier Acknowledgement - Tracks whether supplier has confirmed the PO
  acknowledgementStatus: text("acknowledgement_status").notNull().default('NONE'), // NONE, PENDING, SUPPLIER_ACCEPTED, SUPPLIER_DECLINED, INTERNAL_CONFIRMED
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedSource: text("acknowledged_source"), // SUPPLIER_LINK, INTERNAL
  ackToken: text("ack_token"), // Secure token for supplier confirmation link
  ackTokenExpiresAt: timestamp("ack_token_expires_at"),
  
  // Aggregated totals (updated when lines change)
  totalItemsOrdered: integer("total_items_ordered").notNull().default(0),
  
  // GHL Integration (Communication/Approval Layer Only)
  ghlOpportunityId: text("ghl_opportunity_id"), // Link to GHL opportunity in Replit POs pipeline
  ghlRepName: text("ghl_rep_name"), // GoHighLevel rep who issued the PO
  lastSendChannel: text("last_send_channel"), // EMAIL, SMS (legacy, for GHL sends)
  lastSendStatus: text("last_send_status"), // SUCCESS, FAILED (legacy)
  lastSendTimestamp: timestamp("last_send_timestamp"),
  lastSendMessageId: text("last_send_message_id"), // GHL message ID for audit/tracking
  lastSendError: text("last_send_error"), // Error message if send failed
  
  // External Integrations (Reserved for future)
  externalAccountingId: text("external_accounting_id"), // e.g., QuickBooks PO ID
}, (table) => ({
  statusIdx: index("purchase_orders_status_idx").on(table.status),
  supplierIdIdx: index("purchase_orders_supplier_id_idx").on(table.supplierId),
  createdAtIdx: index("purchase_orders_created_at_idx").on(table.createdAt),
}));

// PO Status enum for type safety
// Lifecycle: DRAFT → SENT → ACCEPTED → PARTIAL → RECEIVED → CLOSED
export const PO_STATUS = {
  DRAFT: 'DRAFT',
  APPROVAL_PENDING: 'APPROVAL_PENDING', // Internal approval pending (legacy)
  APPROVED: 'APPROVED', // Legacy - maps to DRAFT in display
  SENT: 'SENT', // Email sent to supplier, awaiting response
  ACCEPTED: 'ACCEPTED', // Supplier accepted (via link or internal mark)
  PARTIAL: 'PARTIAL', // Some items received
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED', // Legacy alias for PARTIAL
  RECEIVED: 'RECEIVED', // All items received
  CLOSED: 'CLOSED', // Financially closed
  CANCELLED: 'CANCELLED',
} as const;
export type POStatus = typeof PO_STATUS[keyof typeof PO_STATUS];

// Helper to derive display status from PO data and line items
export function derivePoDisplayStatus(po: {
  status: string;
  lastEmailStatus?: string | null;
  lastEmailSentAt?: Date | string | null;
  acknowledgementStatus?: string | null;
}, totalQtyOrdered: number, totalQtyReceived: number): POStatus {
  // Priority 1: Check receipt status (highest priority)
  if (totalQtyOrdered > 0 && totalQtyReceived >= totalQtyOrdered) {
    return PO_STATUS.RECEIVED;
  }
  if (totalQtyOrdered > 0 && totalQtyReceived > 0 && totalQtyReceived < totalQtyOrdered) {
    return PO_STATUS.PARTIAL;
  }
  
  // Priority 2: Check if already in a terminal/receipt state
  if (po.status === 'RECEIVED' || po.status === 'CLOSED' || po.status === 'CANCELLED') {
    return po.status as POStatus;
  }
  if (po.status === 'PARTIAL' || po.status === 'PARTIALLY_RECEIVED') {
    return PO_STATUS.PARTIAL;
  }
  
  // Priority 3: Check acceptance status
  const ackStatus = po.acknowledgementStatus || 'NONE';
  if (ackStatus === 'SUPPLIER_ACCEPTED' || ackStatus === 'INTERNAL_CONFIRMED') {
    return PO_STATUS.ACCEPTED;
  }
  
  // Priority 4: Check if email was sent
  const emailSent = po.lastEmailStatus === 'SENT' || po.lastEmailStatus === 'OPENED' || po.lastEmailSentAt;
  if (emailSent) {
    return PO_STATUS.SENT;
  }
  
  // Priority 5: Default to DRAFT for anything else
  if (po.status === 'APPROVED' || po.status === 'APPROVAL_PENDING') {
    return PO_STATUS.DRAFT; // Show as Draft until sent
  }
  
  return PO_STATUS.DRAFT;
}

// PO Email Status enum for type safety
export const PO_EMAIL_STATUS = {
  NOT_SENT: 'NOT_SENT',
  SENT: 'SENT',
  OPENED: 'OPENED',
  FAILED: 'FAILED',
} as const;
export type POEmailStatus = typeof PO_EMAIL_STATUS[keyof typeof PO_EMAIL_STATUS];

// PO Acknowledgement Status enum for type safety
export const PO_ACK_STATUS = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  SUPPLIER_ACCEPTED: 'SUPPLIER_ACCEPTED',
  SUPPLIER_DECLINED: 'SUPPLIER_DECLINED',
  INTERNAL_CONFIRMED: 'INTERNAL_CONFIRMED',
} as const;
export type POAckStatus = typeof PO_ACK_STATUS[keyof typeof PO_ACK_STATUS];

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true, createdAt: true, updatedAt: true });
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
  
  // Item Details (denormalized for historical record)
  sku: text("sku"), // Snapshot at line creation
  itemName: text("item_name"), // Snapshot at line creation
  unitOfMeasure: text("unit_of_measure").notNull().default('EA'), // EA, CS, PK, etc.
  
  // Quantities
  qtyOrdered: integer("qty_ordered").notNull(),
  qtyReceived: integer("qty_received").notNull().default(0),
  
  // Pricing
  unitCost: real("unit_cost").notNull().default(0),
  lineTotal: real("line_total").notNull().default(0), // qtyOrdered * unitCost
  
  // Per-line dates
  expectedArrivalDate: timestamp("expected_arrival_date"),
  
  // AI Recommendation tracking
  aiRecommendationId: varchar("ai_recommendation_id").references(() => aiRecommendations.id),
  recommendedQtyAtOrderTime: integer("recommended_qty_at_order_time"), // AI suggested quantity when PO was created
  finalOrderedQty: integer("final_ordered_qty"), // What user actually ordered (may differ from recommendedQty)
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  purchaseOrderIdIdx: index("purchase_order_lines_purchase_order_id_idx").on(table.purchaseOrderId),
  aiRecommendationIdIdx: index("purchase_order_lines_ai_recommendation_id_idx").on(table.aiRecommendationId),
  itemIdIdx: index("purchase_order_lines_item_id_idx").on(table.itemId),
}));

export const insertPurchaseOrderLineSchema = createInsertSchema(purchaseOrderLines).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseOrderLine = z.infer<typeof insertPurchaseOrderLineSchema>;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;

// ============================================================================
// PURCHASE ORDER RECEIPTS (Receiving Events)
// ============================================================================

export const purchaseOrderReceipts = pgTable("purchase_order_receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  dateReceived: timestamp("date_received").notNull().default(sql`now()`),
  warehouseLocation: text("warehouse_location"), // e.g., "HILDALE", "PIVOT"
  receivedBy: text("received_by"), // User who recorded the receipt
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  purchaseOrderIdIdx: index("purchase_order_receipts_purchase_order_id_idx").on(table.purchaseOrderId),
  dateReceivedIdx: index("purchase_order_receipts_date_received_idx").on(table.dateReceived),
}));

export const insertPurchaseOrderReceiptSchema = createInsertSchema(purchaseOrderReceipts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseOrderReceipt = z.infer<typeof insertPurchaseOrderReceiptSchema>;
export type PurchaseOrderReceipt = typeof purchaseOrderReceipts.$inferSelect;

// ============================================================================
// PURCHASE ORDER RECEIPT LINES (Per-item Receiving Details)
// ============================================================================

export const purchaseOrderReceiptLines = pgTable("purchase_order_receipt_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  receiptId: varchar("receipt_id").notNull().references(() => purchaseOrderReceipts.id, { onDelete: 'cascade' }),
  purchaseOrderLineId: varchar("purchase_order_line_id").notNull().references(() => purchaseOrderLines.id, { onDelete: 'cascade' }),
  sku: text("sku"), // Denormalized for quick reference
  receivedQty: integer("received_qty").notNull(),
  condition: text("condition").notNull().default('GOOD'), // GOOD, DAMAGED, DEFECTIVE
  conditionNotes: text("condition_notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  receiptIdIdx: index("purchase_order_receipt_lines_receipt_id_idx").on(table.receiptId),
  purchaseOrderLineIdIdx: index("purchase_order_receipt_lines_po_line_id_idx").on(table.purchaseOrderLineId),
}));

export const insertPurchaseOrderReceiptLineSchema = createInsertSchema(purchaseOrderReceiptLines).omit({ id: true, createdAt: true });
export type InsertPurchaseOrderReceiptLine = z.infer<typeof insertPurchaseOrderReceiptLineSchema>;
export type PurchaseOrderReceiptLine = typeof purchaseOrderReceiptLines.$inferSelect;

// ============================================================================
// SUPPLIER LEADS (Discovery & Qualification)
// ============================================================================

export const supplierLeads = pgTable("supplier_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  companyName: text("company_name"),
  websiteUrl: text("website_url"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  location: text("location"),
  source: text("source").notNull().default('MANUAL'), // PHANTOMBUSTER_LINKEDIN, PHANTOMBUSTER_GOOGLE, MANUAL, IMPORT, etc.
  category: text("category"),
  tags: text("tags").array(), // For search keywords, materials, etc.
  notes: text("notes"),
  status: text("status").notNull().default('NEW'), // NEW, RESEARCHING, CONTACTED, QUALIFIED, REJECTED, CONVERTED
  // PhantomBuster tracking
  phantomRunId: text("phantom_run_id"),
  rawData: jsonb("raw_data"), // Original PhantomBuster response for debugging
  // LLM-generated outreach
  outreachEmailSubject: text("outreach_email_subject"),
  outreachEmailBody: text("outreach_email_body"),
  outreachSmsBody: text("outreach_sms_body"),
  outreachGeneratedAt: timestamp("outreach_generated_at"),
  outreachSentAt: timestamp("outreach_sent_at"),
  outreachSentVia: text("outreach_sent_via"), // EMAIL, SMS
  ghlContactId: text("ghl_contact_id"),
  lastContactedAt: timestamp("last_contacted_at"),
  aiOutreachDraft: text("ai_outreach_draft"), // Legacy field
  convertedSupplierId: varchar("converted_supplier_id").references(() => suppliers.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  statusIdx: index("supplier_leads_status_idx").on(table.status),
  sourceIdx: index("supplier_leads_source_idx").on(table.source),
  phantomRunIdx: index("supplier_leads_phantom_run_idx").on(table.phantomRunId),
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
  gohighlevelLocationId: text("gohighlevel_location_id"), // GHL Location/Sub-Account ID
  gohighlevelBaseUrl: text("gohighlevel_base_url"), // GHL API base URL (defaults to leadconnectorhq)
  gohighlevelReturnsPipelineId: text("gohighlevel_returns_pipeline_id"), // GHL pipeline for returns
  gohighlevelReturnsStageIssueRefundId: text("gohighlevel_returns_stage_issue_refund_id"), // Stage for "Issue refund" task
  gohighlevelReturnsStageRefundedId: text("gohighlevel_returns_stage_refunded_id"), // Stage for completed refunds
  shopifyApiKey: text("shopify_api_key"),
  extensivApiKey: text("extensiv_api_key"),
  phantombusterApiKey: text("phantombuster_api_key"),
  llmProvider: text("llm_provider"), // 'chatgpt', 'claude', 'grok', 'custom'
  llmApiKey: text("llm_api_key"),
  llmModel: text("llm_model"), // 'gpt-4', 'gpt-4-turbo', 'claude-3-opus', etc.
  llmTemperature: real("llm_temperature").notNull().default(0.7), // 0.0-2.0, controls randomness
  llmMaxTokens: integer("llm_max_tokens").notNull().default(2048), // Max tokens for response
  llmCustomEndpoint: text("llm_custom_endpoint"),
  llmPromptTemplate: text("llm_prompt_template"),
  enableLlmOrderRecommendations: boolean("enable_llm_order_recommendations").notNull().default(false),
  enableLlmSupplierRanking: boolean("enable_llm_supplier_ranking").notNull().default(false),
  enableLlmForecasting: boolean("enable_llm_forecasting").notNull().default(false),
  enableVisionCapture: boolean("enable_vision_capture").notNull().default(false),
  visionProvider: text("vision_provider"), // 'gpt-4-vision', 'claude-vision'
  visionModel: text("vision_model"), // 'gpt-4o', 'gpt-4o-mini', 'claude-3-opus', 'claude-3-sonnet'
  // AI Decision Engine Rules Configuration
  aiVelocityLookbackDays: integer("ai_velocity_lookback_days").notNull().default(14), // 7, 14, or 30
  aiSafetyStockDays: integer("ai_safety_stock_days").notNull().default(7), // Buffer stock in days
  aiRiskThresholdHighDays: integer("ai_risk_threshold_high_days").notNull().default(0), // HIGH if daysUntilStockout < leadTime + this
  aiRiskThresholdMediumDays: integer("ai_risk_threshold_medium_days").notNull().default(7), // MEDIUM if < leadTime + this
  aiReturnRateImpact: real("ai_return_rate_impact").notNull().default(0.5), // 0-1, how much high returns reduce reorderQty
  aiAdDemandImpact: real("ai_ad_demand_impact").notNull().default(0.2), // 0-1, weight for ad-driven demand (future)
  aiSupplierDisputePenaltyDays: integer("ai_supplier_dispute_penalty_days").notNull().default(3), // Extra lead time days per dispute
  aiDefaultLeadTimeDays: integer("ai_default_lead_time_days").notNull().default(7), // Default supplier lead time
  aiMinOrderQuantity: integer("ai_min_order_quantity").notNull().default(1), // Default MOQ if not set on item
  // Integration Health & Key Rotation Alerts
  alertAdminEmail: text("alert_admin_email"), // Email for rotation alerts via GHL
  alertAdminPhone: text("alert_admin_phone"), // Phone for rotation alerts via GHL SMS
  // Token rotation interval (default 90 days)
  aiTokenRotationDays: integer("ai_token_rotation_days").notNull().default(90), // Days until next rotation reminder
});

export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export const patchSettingsSchema = insertSettingsSchema.partial().omit({ userId: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type PatchSettings = z.infer<typeof patchSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

// ============================================================================
// INTEGRATION CONFIGS (External System Connections)
// ============================================================================

export const integrationConfigs = pgTable("integration_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(), // 'EXTENSIV', 'SHOPIFY', 'AMAZON', etc.
  accountName: text("account_name"), // Descriptive name
  apiKey: text("api_key"), // Stored securely (can also use env var)
  isEnabled: boolean("is_enabled").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: text("last_sync_status"), // 'SUCCESS', 'FAILED', 'PENDING'
  lastSyncMessage: text("last_sync_message"), // Error details or summary
  config: jsonb("config"), // Provider-specific configuration (warehouse IDs, etc.)
  // Integration Health Check fields
  keyCreatedAt: timestamp("key_created_at"), // When the API key was created/rotated
  lastTokenCheckAt: timestamp("last_token_check_at"),
  lastTokenCheckStatus: text("last_token_check_status"), // OK, WARNING, CRITICAL
  lastAlertSentAt: timestamp("last_alert_sent_at"), // For spam prevention (24h throttle)
  consecutiveFailures: integer("consecutive_failures").default(0), // Track repeated auth errors
  // Token Rotation Tracking (V1 UI-driven rotation reminders)
  tokenLastRotatedAt: timestamp("token_last_rotated_at"), // When user last rotated credentials
  tokenNextRotationAt: timestamp("token_next_rotation_at"), // When next rotation is due
}, (table) => ({
  userProviderIdx: index("integration_configs_user_provider_idx").on(table.userId, table.provider),
}));

export const insertIntegrationConfigSchema = createInsertSchema(integrationConfigs).omit({ id: true, lastTokenCheckAt: true, lastTokenCheckStatus: true, lastAlertSentAt: true, consecutiveFailures: true });
export type InsertIntegrationConfig = z.infer<typeof insertIntegrationConfigSchema>;
export type IntegrationConfig = typeof integrationConfigs.$inferSelect;

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
// AI RECOMMENDATIONS (Decision Engine Inventory Recommendations)
// ============================================================================

export const aiRecommendations = pgTable("ai_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Required columns (NOT NULL in DB)
  type: text("type").notNull().default("INVENTORY"), // 'INVENTORY', 'PRODUCTION', etc.
  itemId: varchar("item_id").notNull().references(() => items.id),
  recommendedQty: integer("recommended_qty").notNull().default(0),
  recommendedAction: text("recommended_action").notNull().default("MONITOR"), // 'ORDER', 'MONITOR', 'OK', 'HOLD'
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  // Optional columns (nullable in DB)
  sku: text("sku"),
  productName: text("product_name"),
  recommendationType: text("recommendation_type"), // 'REORDER', 'HOLD', 'CHECK_VARIANCE', 'INVESTIGATE_ADS', 'MONITOR'
  riskLevel: text("risk_level"), // 'HIGH', 'MEDIUM', 'LOW'
  daysUntilStockout: integer("days_until_stockout"),
  availableForSale: integer("available_for_sale").default(0),
  stockGapPercent: real("stock_gap_percent"), // Percent difference from target coverage
  qtyOnPo: integer("qty_on_po").default(0), // Total open PO qty for this SKU
  status: text("status").default("NEW"), // 'NEW', 'ACCEPTED', 'DISMISSED'
  reasonSummary: text("reason_summary"), // Short explanation
  sourceSignals: jsonb("source_signals"), // {velocity, ads, quickbooks, extensiv, shopify, amazon, returns}
  adMultiplier: real("ad_multiplier").default(1.0), // Ad demand multiplier
  baseVelocity: real("base_velocity"), // Raw sales velocity before ad adjustment
  adjustedVelocity: real("adjusted_velocity"), // Velocity after ad multiplier
  updatedAt: timestamp("updated_at").default(sql`now()`),
  // Additional LLM-related columns (from DB)
  location: text("location"), // Physical location or context
  horizonDays: integer("horizon_days"), // Forecast horizon
  contextSnapshot: jsonb("context_snapshot"), // Snapshot of context data
  llmResponseTimeMs: integer("llm_response_time_ms"), // LLM response time for metrics
  outcomeStatus: text("outcome_status"), // Tracking outcome of recommendation
  outcomeDetails: jsonb("outcome_details"), // Details about outcome
}, (table) => ({
  itemIdIdx: index("ai_recommendations_item_id_idx").on(table.itemId),
  createdAtIdx: index("ai_recommendations_created_at_idx").on(table.createdAt),
  statusIdx: index("ai_recommendations_status_idx").on(table.status),
  skuIdx: index("ai_recommendations_sku_idx").on(table.sku),
}));

export const insertAIRecommendationSchema = createInsertSchema(aiRecommendations).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true 
});
export type InsertAIRecommendation = z.infer<typeof insertAIRecommendationSchema>;
export type AIRecommendation = typeof aiRecommendations.$inferSelect;

export const updateAIRecommendationSchema = insertAIRecommendationSchema.partial();
export type UpdateAIRecommendation = z.infer<typeof updateAIRecommendationSchema>;

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

// Return Status Lifecycle:
// REQUESTED → APPROVED → LABEL_CREATED → IN_TRANSIT → RETURNED → REFUND_ISSUE_PENDING → REFUNDED → CLOSED
// Alternative paths: REJECTED, CANCELLED, REPLACEMENT_SENT
export const ReturnStatus = {
  REQUESTED: "REQUESTED",
  APPROVED: "APPROVED", 
  LABEL_CREATED: "LABEL_CREATED",
  IN_TRANSIT: "IN_TRANSIT",
  RETURNED: "RETURNED", // Physically received at warehouse
  REFUND_ISSUE_PENDING: "REFUND_ISSUE_PENDING", // Waiting for team to move money in Amazon/Shopify
  REFUNDED: "REFUNDED",
  REPLACEMENT_SENT: "REPLACEMENT_SENT",
  CLOSED: "CLOSED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  // Legacy statuses for backwards compatibility
  OPEN: "OPEN",
  RECEIVED_AT_WAREHOUSE: "RECEIVED_AT_WAREHOUSE",
  COMPLETED: "COMPLETED",
} as const;
export type ReturnStatus = typeof ReturnStatus[keyof typeof ReturnStatus];

export const ReturnResolution = {
  REFUND: "REFUND",
  REPLACEMENT: "REPLACEMENT",
  STORE_CREDIT: "STORE_CREDIT",
  NONE: "NONE",
  TROUBLESHOOT: "TROUBLESHOOT",
} as const;
export type ReturnResolution = typeof ReturnResolution[keyof typeof ReturnResolution];

export const returnRequests = pgTable("return_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rmaNumber: text("rma_number").unique(), // Unique RMA number e.g. RMA-2025-000123
  salesOrderId: varchar("sales_order_id").references(() => salesOrders.id), // Link to SalesOrder
  orderNumber: text("order_number"), // Denormalized from SalesOrder for quick lookup
  externalOrderId: text("external_order_id").notNull(), // Upstream order ID from Shopify/Amazon/etc.
  salesChannel: text("sales_channel").notNull(), // 'SHOPIFY', 'AMAZON', 'DIRECT', 'OTHER'
  source: text("source").notNull().default('Manual'), // 'GHL' | 'Manual' | 'System'
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  shippingAddress: jsonb("shipping_address"), // JSON object with address details
  ghlContactId: text("ghl_contact_id"), // Link back to GHL contact for workflows
  status: text("status").notNull().default('REQUESTED'), // See ReturnStatus enum
  resolutionRequested: text("resolution_requested").notNull(), // See ReturnResolution enum
  resolutionFinal: text("resolution_final"), // What actually happened (nullable)
  resolutionNotes: text("resolution_notes"), // Additional notes about resolution outcome
  labelProvider: text("label_provider"), // 'SHIPPO', 'EASYPOST', 'STUB', etc.
  initiatedVia: text("initiated_via").notNull().default('MANUAL_UI'), // 'GHL_BOT' or 'MANUAL_UI' (deprecated, use 'source' instead)
  warehouseLocationCode: text("warehouse_location_code"), // Extensiv location or similar
  reason: text("reason"), // High-level reason from GHL bot
  reasonCode: text("reason_code"), // Structured reason code (DEFECTIVE, WRONG_ITEM, etc.)
  // Shippo shipping label fields
  shippoShipmentId: text("shippo_shipment_id"), // Shippo shipment object ID
  shippoTransactionId: text("shippo_transaction_id"), // Shippo transaction/label ID
  carrier: text("carrier"), // 'USPS', 'UPS', 'FEDEX', etc.
  trackingNumber: text("tracking_number"),
  labelUrl: text("label_url"), // URL to label PDF
  labelCost: real("label_cost"), // Cost of the label
  labelCurrency: text("label_currency").default('USD'),
  // GHL refund opportunity integration
  ghlRefundOpportunityId: text("ghl_refund_opportunity_id"), // GHL opportunity for "Issue refund" task
  ghlRefundOpportunityUrl: text("ghl_refund_opportunity_url"), // Deep link to GHL opportunity
  // Lifecycle timestamps
  requestedAt: timestamp("requested_at").default(sql`now()`),
  approvedAt: timestamp("approved_at"),
  labelCreatedAt: timestamp("label_created_at"),
  inTransitAt: timestamp("in_transit_at"),
  receivedAt: timestamp("received_at"), // When warehouse received the return
  refundIssuedAt: timestamp("refund_issued_at"), // When team was tasked to issue refund
  refundedAt: timestamp("refunded_at"), // When refund was actually completed
  replacementSentAt: timestamp("replacement_sent_at"),
  closedAt: timestamp("closed_at"),
  rejectedAt: timestamp("rejected_at"),
  cancelledAt: timestamp("cancelled_at"),
  // Legacy fields (kept for backwards compatibility)
  receiptPrintedAt: timestamp("receipt_printed_at"), // First successful print timestamp
  receiptPrintCount: integer("receipt_print_count").notNull().default(0), // Total number of prints
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  salesOrderIdIdx: index("return_requests_sales_order_id_idx").on(table.salesOrderId),
  externalOrderIdIdx: index("return_requests_external_order_id_idx").on(table.externalOrderId),
  statusIdx: index("return_requests_status_idx").on(table.status),
  createdAtIdx: index("return_requests_created_at_idx").on(table.createdAt),
  rmaNumberIdx: index("return_requests_rma_number_idx").on(table.rmaNumber),
  ghlRefundOpportunityIdIdx: index("return_requests_ghl_refund_opportunity_id_idx").on(table.ghlRefundOpportunityId),
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
  returnRequestId: varchar("return_request_id").notNull().references(() => returnRequests.id, { onDelete: 'cascade' }),
  salesOrderLineId: varchar("sales_order_line_id"), // Link to SalesOrderLine if available
  inventoryItemId: varchar("inventory_item_id").references(() => items.id), // Nullable for flexibility
  sku: text("sku").notNull(), // Denormalized for quick viewing
  productName: text("product_name"), // Denormalized product name
  unitPrice: real("unit_price"), // Unit price at time of return
  qtyOrdered: integer("qty_ordered").notNull(), // Original qty from order
  qtyRequested: integer("qty_requested").notNull(), // What customer wants to return
  qtyApproved: integer("qty_approved").notNull().default(0), // What we allow to be returned
  qtyReceived: integer("qty_received").notNull().default(0), // What actually came back
  condition: text("condition"), // 'GOOD' | 'DAMAGED' | 'UNKNOWN' (null until received)
  disposition: text("disposition"), // 'RETURN_TO_STOCK', 'SCRAP', 'REPLACE_ONLY', 'INSPECT' (null until received)
  itemReason: text("item_reason"), // Specific reason for this item
  notes: text("notes"),
}, (table) => ({
  returnRequestIdIdx: index("return_items_return_request_id_idx").on(table.returnRequestId),
  inventoryItemIdIdx: index("return_items_inventory_item_id_idx").on(table.inventoryItemId),
  salesOrderLineIdIdx: index("return_items_sales_order_line_id_idx").on(table.salesOrderLineId),
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
  // Shippo integration fields
  shippoShipmentId: text("shippo_shipment_id"), // Shippo shipment object ID
  shippoTransactionId: text("shippo_transaction_id"), // Shippo transaction/label ID
  shippoRateId: text("shippo_rate_id"), // Selected rate ID
  labelCost: real("label_cost"), // Cost of the label
  labelCurrency: text("label_currency").default('USD'),
  estimatedDeliveryDate: timestamp("estimated_delivery_date"),
  lastTrackingUpdate: timestamp("last_tracking_update"),
  trackingHistory: jsonb("tracking_history"), // Array of tracking events from Shippo
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  returnRequestIdIdx: index("return_shipments_return_request_id_idx").on(table.returnRequestId),
  trackingNumberIdx: index("return_shipments_tracking_number_idx").on(table.trackingNumber),
  shippoShipmentIdIdx: index("return_shipments_shippo_shipment_id_idx").on(table.shippoShipmentId),
}));

export const insertReturnShipmentSchema = createInsertSchema(returnShipments).omit({ 
  id: true,
  createdAt: true,
  updatedAt: true 
});
export type InsertReturnShipment = z.infer<typeof insertReturnShipmentSchema>;
export type ReturnShipment = typeof returnShipments.$inferSelect;

// ============================================================================
// RETURN EVENTS (Audit Log)
// ============================================================================
// Audit trail for all return-related events and status changes.
// Used for debugging, compliance, and customer service.

export const ReturnEventType = {
  GHL_REQUEST: "GHL_REQUEST", // Return initiated via GHL agent
  MANUAL_REQUEST: "MANUAL_REQUEST", // Return initiated via UI
  STATUS_CHANGE: "STATUS_CHANGE", // Status transitioned
  LABEL_CREATED: "LABEL_CREATED", // Shipping label generated
  SHIPPO_WEBHOOK: "SHIPPO_WEBHOOK", // Tracking update from Shippo
  WAREHOUSE_SCAN: "WAREHOUSE_SCAN", // Package scanned at warehouse
  REFUND_TASK_CREATED: "REFUND_TASK_CREATED", // GHL opportunity created
  REFUND_COMPLETED: "REFUND_COMPLETED", // Refund marked as done
  REPLACEMENT_SHIPPED: "REPLACEMENT_SHIPPED", // Replacement sent
  ITEM_RECEIVED: "ITEM_RECEIVED", // Individual item received
  ITEM_INSPECTED: "ITEM_INSPECTED", // Item condition assessed
  NOTE_ADDED: "NOTE_ADDED", // Note/comment added
  ERROR: "ERROR", // Something went wrong
} as const;
export type ReturnEventType = typeof ReturnEventType[keyof typeof ReturnEventType];

export const returnEvents = pgTable("return_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  returnRequestId: varchar("return_request_id").notNull().references(() => returnRequests.id, { onDelete: 'cascade' }),
  type: text("type").notNull(), // See ReturnEventType enum
  fromStatus: text("from_status"), // Previous status (for STATUS_CHANGE events)
  toStatus: text("to_status"), // New status (for STATUS_CHANGE events)
  actor: text("actor"), // Who/what triggered: 'system', 'user:UUID', 'ghl:agent_id', 'shippo:webhook'
  message: text("message"), // Human-readable description
  payload: jsonb("payload"), // Additional data (varies by event type)
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  returnRequestIdIdx: index("return_events_return_request_id_idx").on(table.returnRequestId),
  typeIdx: index("return_events_type_idx").on(table.type),
  createdAtIdx: index("return_events_created_at_idx").on(table.createdAt),
}));

export const insertReturnEventSchema = createInsertSchema(returnEvents).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertReturnEvent = z.infer<typeof insertReturnEventSchema>;
export type ReturnEvent = typeof returnEvents.$inferSelect;

// ============================================================================
// SHIPPO LABEL LOG
// ============================================================================
// Centralized log of all Shippo shipping labels created by the system.
// Used for tracking, analytics, and enabling warehouse scan workflows.
// Currently supports return labels; can be extended for outbound shipments.

export const ShippoLabelType = {
  RETURN: "RETURN",
  // Future: OUTBOUND, RESHIP, etc.
} as const;
export type ShippoLabelType = typeof ShippoLabelType[keyof typeof ShippoLabelType];

export const ShippoLabelStatus = {
  CREATED: "CREATED", // Label generated, not yet scanned
  IN_TRANSIT: "IN_TRANSIT", // Carrier picked up/in transit (from webhook)
  SCANNED_RECEIVED: "SCANNED_RECEIVED", // Scanned at warehouse
  DELIVERED: "DELIVERED", // Delivered (from webhook)
  CANCELLED: "CANCELLED", // Label voided
  LOST: "LOST", // Package lost in transit
} as const;
export type ShippoLabelStatus = typeof ShippoLabelStatus[keyof typeof ShippoLabelStatus];

export const shippoLabelLogs = pgTable("shippo_label_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull().default('RETURN'), // See ShippoLabelType enum
  
  // Shippo identifiers
  shippoShipmentId: text("shippo_shipment_id"), // Shippo shipment object ID
  shippoTransactionId: text("shippo_transaction_id"), // Shippo transaction/label ID
  
  // Label details
  labelUrl: text("label_url"), // URL to label PDF
  trackingNumber: text("tracking_number"), // Carrier tracking number
  carrier: text("carrier"), // 'USPS', 'UPS', 'FEDEX', etc.
  serviceLevel: text("service_level"), // 'priority', 'express', 'ground', etc.
  labelCost: real("label_cost"), // Cost of the label
  labelCurrency: text("label_currency").default('USD'),
  
  // Scan workflow
  status: text("status").notNull().default('CREATED'), // See ShippoLabelStatus enum
  scanCode: text("scan_code"), // Value that scanner reads (usually trackingNumber or barcode value)
  scannedAt: timestamp("scanned_at"), // When label was scanned at warehouse
  scannedBy: text("scanned_by"), // User ID who scanned
  
  // Related entities
  barcodeId: varchar("barcode_id").references(() => barcodes.id), // FK to ProductBarcode if applicable
  sku: text("sku"), // SKU(s) for this shipment; for multi-SKU, comma-separated or JSON
  salesOrderId: varchar("sales_order_id").references(() => salesOrders.id),
  returnRequestId: varchar("return_request_id").references(() => returnRequests.id),
  
  // Order context (denormalized for quick lookup)
  channel: text("channel"), // 'SHOPIFY', 'AMAZON', 'DIRECT', etc.
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  orderDate: timestamp("order_date"), // Date of original order
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  scanCodeIdx: index("shippo_label_logs_scan_code_idx").on(table.scanCode),
  trackingNumberIdx: index("shippo_label_logs_tracking_number_idx").on(table.trackingNumber),
  returnRequestIdIdx: index("shippo_label_logs_return_request_id_idx").on(table.returnRequestId),
  salesOrderIdIdx: index("shippo_label_logs_sales_order_id_idx").on(table.salesOrderId),
  statusIdx: index("shippo_label_logs_status_idx").on(table.status),
  createdAtIdx: index("shippo_label_logs_created_at_idx").on(table.createdAt),
  typeIdx: index("shippo_label_logs_type_idx").on(table.type),
}));

export const insertShippoLabelLogSchema = createInsertSchema(shippoLabelLogs).omit({ 
  id: true,
  createdAt: true,
  updatedAt: true 
});
export type InsertShippoLabelLog = z.infer<typeof insertShippoLabelLogSchema>;
export type ShippoLabelLog = typeof shippoLabelLogs.$inferSelect;

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
  // Backorder Information
  totalBackorderedQty: integer("total_backordered_qty").notNull().default(0), // Total units backordered across all open sales orders
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

// ============================================================================
// SALES ORDERS & BACKORDERS
// ============================================================================

// Sales Order Return Status
export const SalesOrderReturnStatus = {
  NONE: "NONE",
  REQUESTED: "REQUESTED",
  IN_PROGRESS: "IN_PROGRESS",
  PARTIAL_REFUNDED: "PARTIAL_REFUNDED",
  REFUNDED: "REFUNDED",
} as const;
export type SalesOrderReturnStatus = typeof SalesOrderReturnStatus[keyof typeof SalesOrderReturnStatus];

export const salesOrders = pgTable("sales_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  externalOrderId: text("external_order_id"), // Shopify/Amazon/etc order ID
  externalCustomerId: text("external_customer_id"), // Customer ID from external system
  channel: text("channel").notNull(), // 'SHOPIFY' | 'AMAZON' | 'GHL' | 'DIRECT' | 'OTHER'
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  ghlContactId: text("ghl_contact_id"), // GoHighLevel contact ID
  status: text("status").notNull().default('DRAFT'), // 'DRAFT' | 'OPEN' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED'
  orderDate: timestamp("order_date").notNull().default(sql`now()`),
  requiredByDate: timestamp("required_by_date"),
  expectedDeliveryDate: timestamp("expected_delivery_date"), // Promised delivery date from Amazon/Shopify or computed
  totalAmount: real("total_amount").notNull().default(0), // Total order amount
  currency: text("currency").notNull().default('USD'), // Order currency
  componentsUsed: integer("components_used").notNull().default(0), // Total BOM components consumed for fulfilled quantity
  productionStatus: text("production_status").notNull().default('ready'), // 'ready' | 'alerted' | 'pending' | 'in_transit' | 'fulfilled'
  sourceUrl: text("source_url"), // Deep link to Amazon/Shopify order page
  ghlProductionOpportunityId: text("ghl_production_opportunity_id"), // Linked GHL production opportunity
  ghlConversationUrl: text("ghl_conversation_url"), // Deep link to GHL conversations for this contact
  notes: text("notes"),
  rawPayload: jsonb("raw_payload"), // Store original external order data for debugging
  // Return tracking fields
  returnStatus: text("return_status").notNull().default('NONE'), // See SalesOrderReturnStatus
  totalReturnQty: integer("total_return_qty").notNull().default(0), // Sum of all return item quantities
  totalRefundAmount: real("total_refund_amount").notNull().default(0), // Sum of refunded amounts
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  channelIdx: index("sales_orders_channel_idx").on(table.channel),
  statusIdx: index("sales_orders_status_idx").on(table.status),
  orderDateIdx: index("sales_orders_order_date_idx").on(table.orderDate),
  externalOrderIdIdx: index("sales_orders_external_order_id_idx").on(table.externalOrderId),
  productionStatusIdx: index("sales_orders_production_status_idx").on(table.productionStatus),
  returnStatusIdx: index("sales_orders_return_status_idx").on(table.returnStatus),
  // V1: Unique constraint for idempotent order imports - prevents duplicate Shopify/Amazon orders
  channelExternalOrderUniqueIdx: uniqueIndex("sales_orders_channel_external_order_unique_idx")
    .on(table.channel, table.externalOrderId)
    .where(sql`external_order_id IS NOT NULL`), // Only enforce uniqueness when externalOrderId exists
}));

export const insertSalesOrderSchema = createInsertSchema(salesOrders).omit({ 
  id: true,
  createdAt: true,
  updatedAt: true 
});
export const updateSalesOrderSchema = insertSalesOrderSchema.partial();
export type InsertSalesOrder = z.infer<typeof insertSalesOrderSchema>;
export type SalesOrder = typeof salesOrders.$inferSelect;

export const salesOrderLines = pgTable("sales_order_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  salesOrderId: varchar("sales_order_id").notNull().references(() => salesOrders.id, { onDelete: 'cascade' }),
  productId: varchar("product_id").notNull().references(() => items.id), // Finished product
  sku: text("sku").notNull(), // Denormalized for quick reference
  qtyOrdered: integer("qty_ordered").notNull(),
  qtyAllocated: integer("qty_allocated").notNull().default(0), // Reserved from available stock
  qtyShipped: integer("qty_shipped").notNull().default(0),
  qtyFulfilled: integer("qty_fulfilled").notNull().default(0), // Fulfilled (shipped OR marked fulfilled)
  returnedQty: integer("returned_qty").notNull().default(0), // Total quantity returned
  backorderQty: integer("backorder_qty").notNull().default(0), // qtyOrdered - qtyAllocated
  unitPrice: real("unit_price"), // Optional: price per unit
  notes: text("notes"),
}, (table) => ({
  salesOrderIdIdx: index("sales_order_lines_sales_order_id_idx").on(table.salesOrderId),
  productIdIdx: index("sales_order_lines_product_id_idx").on(table.productId),
}));

export const insertSalesOrderLineSchema = createInsertSchema(salesOrderLines).omit({ id: true });
export const updateSalesOrderLineSchema = insertSalesOrderLineSchema.partial();
export type InsertSalesOrderLine = z.infer<typeof insertSalesOrderLineSchema>;
export type SalesOrderLine = typeof salesOrderLines.$inferSelect;

export const backorderSnapshots = pgTable("backorder_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => items.id).unique(),
  totalBackorderedQty: integer("total_backordered_qty").notNull().default(0),
  lastUpdatedAt: timestamp("last_updated_at").notNull().default(sql`now()`),
}, (table) => ({
  productIdIdx: index("backorder_snapshots_product_id_idx").on(table.productId),
}));

export const insertBackorderSnapshotSchema = createInsertSchema(backorderSnapshots).omit({ 
  id: true,
  lastUpdatedAt: true 
});
export type InsertBackorderSnapshot = z.infer<typeof insertBackorderSnapshotSchema>;
export type BackorderSnapshot = typeof backorderSnapshots.$inferSelect;

// ============================================================================
// AUDIT LOGS (System Event Tracking for AI Agent Logs Tab)
// ============================================================================

// Source enum values: SHOPIFY, AMAZON, EXTENSIV, GHL, SYSTEM, USER
// Event types: PO_CREATED, PO_SENT, SALE_IMPORTED, RETURN_CREATED, RETURN_STATUS_CHANGED, 
//              INVENTORY_UPDATED, AI_DECISION, ERROR, etc.
// Status levels: INFO, WARNING, ERROR

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").notNull().default(sql`now()`),
  source: text("source").notNull().default('SYSTEM'), // SHOPIFY, AMAZON, EXTENSIV, GHL, SYSTEM, USER
  eventType: text("event_type").notNull(), // PO_SENT, RETURN_CREATED, SALE_IMPORTED, INVENTORY_UPDATED, AI_DECISION, ERROR, etc.
  entityType: text("entity_type"), // PURCHASE_ORDER, SALES_ORDER, RETURN, ITEM, SUPPLIER, etc.
  entityId: varchar("entity_id"), // ID of the related entity
  entityLabel: varchar("entity_label"), // Human-readable label (e.g., SKU, PO#, Order#)
  performedByUserId: varchar("performed_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  performedByName: varchar("performed_by_name"), // Cached name for display (user name or "System/AI")
  status: text("status").notNull().default('INFO'), // INFO, WARNING, ERROR
  description: text("description"), // Short human-readable summary
  details: jsonb("details"), // Additional context as JSON (quantities, old/new values, raw payloads)
  // Legacy fields for backward compatibility (can be removed in future cleanup)
  actorType: text("actor_type"), // Deprecated: use source instead
  actorId: varchar("actor_id"), // Deprecated: use performedByUserId instead
  purchaseOrderId: varchar("purchase_order_id").references(() => purchaseOrders.id, { onDelete: 'set null' }),
  supplierId: varchar("supplier_id").references(() => suppliers.id, { onDelete: 'set null' }),
  success: boolean("success").default(true), // Deprecated: use status instead
  errorMessage: text("error_message"), // Deprecated: use description instead
}, (table) => ({
  timestampIdx: index("audit_logs_timestamp_idx").on(table.timestamp),
  sourceIdx: index("audit_logs_source_idx").on(table.source),
  eventTypeIdx: index("audit_logs_event_type_idx").on(table.eventType),
  entityTypeIdx: index("audit_logs_entity_type_idx").on(table.entityType),
  statusIdx: index("audit_logs_status_idx").on(table.status),
  purchaseOrderIdIdx: index("audit_logs_purchase_order_id_idx").on(table.purchaseOrderId),
  performedByUserIdIdx: index("audit_logs_performed_by_user_id_idx").on(table.performedByUserId),
}));

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ 
  id: true,
  timestamp: true 
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// ============================================================================
// QUICKBOOKS ONLINE INTEGRATION (V1: Read-Only Sales + PO→Bill)
// ============================================================================

// QuickBooks OAuth tokens and connection state
export const quickbooksAuth = pgTable("quickbooks_auth", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  realmId: text("realm_id").notNull(), // QuickBooks company ID
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at").notNull(),
  companyName: text("company_name"), // Cached company name for display
  isConnected: boolean("is_connected").notNull().default(true),
  lastSalesSyncAt: timestamp("last_sales_sync_at"),
  lastSalesSyncStatus: text("last_sales_sync_status"), // SUCCESS, FAILED
  // Integration Health Check fields
  lastTokenCheckAt: timestamp("last_token_check_at"),
  lastTokenCheckStatus: text("last_token_check_status"), // OK, WARNING, CRITICAL, EXPIRED
  lastAlertSentAt: timestamp("last_alert_sent_at"), // For spam prevention (24h throttle)
  // Token Rotation Tracking (V1 UI-driven rotation reminders)
  tokenLastRotatedAt: timestamp("token_last_rotated_at"), // When user last rotated credentials
  tokenNextRotationAt: timestamp("token_next_rotation_at"), // When next rotation is due
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  userIdIdx: index("quickbooks_auth_user_id_idx").on(table.userId),
  realmIdIdx: uniqueIndex("quickbooks_auth_realm_id_idx").on(table.realmId),
}));

export const insertQuickbooksAuthSchema = createInsertSchema(quickbooksAuth).omit({ id: true, createdAt: true, updatedAt: true, lastTokenCheckAt: true, lastTokenCheckStatus: true, lastAlertSentAt: true });
export type InsertQuickbooksAuth = z.infer<typeof insertQuickbooksAuthSchema>;
export type QuickbooksAuth = typeof quickbooksAuth.$inferSelect;

// Aggregated sales snapshots from QuickBooks (for AI trend forecasting)
// V1: Read-only historical data - we do NOT modify QuickBooks sales
export const quickbooksSalesSnapshots = pgTable("quickbooks_sales_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sku: text("sku").notNull(),
  productName: text("product_name"),
  year: integer("year").notNull(),
  month: integer("month").notNull(), // 1-12
  totalQty: integer("total_qty").notNull().default(0),
  totalRevenue: real("total_revenue").notNull().default(0),
  source: text("source").notNull().default('quickbooks'), // Always 'quickbooks' for V1
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  skuYearMonthIdx: uniqueIndex("qb_sales_snapshots_sku_year_month_idx").on(table.sku, table.year, table.month),
  yearMonthIdx: index("qb_sales_snapshots_year_month_idx").on(table.year, table.month),
}));

export const insertQuickbooksSalesSnapshotSchema = createInsertSchema(quickbooksSalesSnapshots).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuickbooksSalesSnapshot = z.infer<typeof insertQuickbooksSalesSnapshotSchema>;
export type QuickbooksSalesSnapshot = typeof quickbooksSalesSnapshots.$inferSelect;

// Supplier ↔ QuickBooks Vendor mapping
export const quickbooksVendorMappings = pgTable("quickbooks_vendor_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  supplierId: varchar("supplier_id").notNull().references(() => suppliers.id),
  quickbooksVendorId: text("quickbooks_vendor_id").notNull(),
  quickbooksVendorName: text("quickbooks_vendor_name"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  supplierIdIdx: uniqueIndex("qb_vendor_mappings_supplier_id_idx").on(table.supplierId),
  qbVendorIdIdx: index("qb_vendor_mappings_qb_vendor_id_idx").on(table.quickbooksVendorId),
}));

export const insertQuickbooksVendorMappingSchema = createInsertSchema(quickbooksVendorMappings).omit({ id: true, createdAt: true });
export type InsertQuickbooksVendorMapping = z.infer<typeof insertQuickbooksVendorMappingSchema>;
export type QuickbooksVendorMapping = typeof quickbooksVendorMappings.$inferSelect;

// SKU ↔ QuickBooks Item mapping
export const quickbooksItemMappings = pgTable("quickbooks_item_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemId: varchar("item_id").notNull().references(() => items.id),
  sku: text("sku").notNull(),
  quickbooksItemId: text("quickbooks_item_id").notNull(),
  quickbooksItemName: text("quickbooks_item_name"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  itemIdIdx: uniqueIndex("qb_item_mappings_item_id_idx").on(table.itemId),
  skuIdx: index("qb_item_mappings_sku_idx").on(table.sku),
  qbItemIdIdx: index("qb_item_mappings_qb_item_id_idx").on(table.quickbooksItemId),
}));

export const insertQuickbooksItemMappingSchema = createInsertSchema(quickbooksItemMappings).omit({ id: true, createdAt: true });
export type InsertQuickbooksItemMapping = z.infer<typeof insertQuickbooksItemMappingSchema>;
export type QuickbooksItemMapping = typeof quickbooksItemMappings.$inferSelect;

// QuickBooks Bills created from our Purchase Orders
export const quickbooksBills = pgTable("quickbooks_bills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar("purchase_order_id").notNull().references(() => purchaseOrders.id),
  quickbooksBillId: text("quickbooks_bill_id").notNull(),
  quickbooksBillNumber: text("quickbooks_bill_number"),
  status: text("status").notNull().default('CREATED'), // CREATED, SYNCED, PAID, ERROR
  totalAmount: real("total_amount"),
  dueDate: timestamp("due_date"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  purchaseOrderIdIdx: uniqueIndex("qb_bills_purchase_order_id_idx").on(table.purchaseOrderId),
  qbBillIdIdx: index("qb_bills_qb_bill_id_idx").on(table.quickbooksBillId),
}));

export const insertQuickbooksBillSchema = createInsertSchema(quickbooksBills).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuickbooksBill = z.infer<typeof insertQuickbooksBillSchema>;
export type QuickbooksBill = typeof quickbooksBills.$inferSelect;

// ============================================================================
// AD PLATFORM INTEGRATIONS (Meta Ads, Google Ads)
// ============================================================================

// OAuth tokens and connection state for ad platforms
export const adPlatformConfigs = pgTable("ad_platform_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  platform: text("platform").notNull(), // 'META', 'GOOGLE'
  accountId: text("account_id"), // Meta Ad Account ID or Google Ads Customer ID
  accountName: text("account_name"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  isConnected: boolean("is_connected").notNull().default(false),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: text("last_sync_status"), // SUCCESS, FAILED
  lastSyncMessage: text("last_sync_message"),
  config: jsonb("config"), // Platform-specific (e.g., selected campaigns to track)
  // Integration Health Check fields
  lastTokenCheckAt: timestamp("last_token_check_at"),
  lastTokenCheckStatus: text("last_token_check_status"), // OK, WARNING, CRITICAL, EXPIRED
  lastAlertSentAt: timestamp("last_alert_sent_at"), // For spam prevention (24h throttle)
  // Token Rotation Tracking (V1 UI-driven rotation reminders)
  tokenLastRotatedAt: timestamp("token_last_rotated_at"), // When user last rotated credentials
  tokenNextRotationAt: timestamp("token_next_rotation_at"), // When next rotation is due
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  userPlatformIdx: uniqueIndex("ad_platform_user_platform_idx").on(table.userId, table.platform),
}));

export const insertAdPlatformConfigSchema = createInsertSchema(adPlatformConfigs).omit({ id: true, createdAt: true, updatedAt: true, lastTokenCheckAt: true, lastTokenCheckStatus: true, lastAlertSentAt: true });
export type InsertAdPlatformConfig = z.infer<typeof insertAdPlatformConfigSchema>;
export type AdPlatformConfig = typeof adPlatformConfigs.$inferSelect;

// Maps ad entities (campaigns/ad sets/ad groups) to SKUs
export const adSkuMappings = pgTable("ad_sku_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  platform: text("platform").notNull(), // 'META', 'GOOGLE'
  adEntityType: text("ad_entity_type").notNull(), // 'CAMPAIGN', 'ADSET', 'ADGROUP', 'AD'
  adEntityId: text("ad_entity_id").notNull(), // External ID from ad platform
  adEntityName: text("ad_entity_name"),
  sku: text("sku").notNull(), // Maps to items.sku
  itemId: varchar("item_id").references(() => items.id), // Optional direct reference
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  platformEntityIdx: uniqueIndex("ad_sku_platform_entity_idx").on(table.platform, table.adEntityId, table.sku),
  skuIdx: index("ad_sku_sku_idx").on(table.sku),
}));

export const insertAdSkuMappingSchema = createInsertSchema(adSkuMappings).omit({ id: true, createdAt: true });
export type InsertAdSkuMapping = z.infer<typeof insertAdSkuMappingSchema>;
export type AdSkuMapping = typeof adSkuMappings.$inferSelect;

// Daily aggregated ad metrics per SKU (for inventory demand forecasting)
export const adMetricsDaily = pgTable("ad_metrics_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  platform: text("platform").notNull(), // 'META', 'GOOGLE'
  sku: text("sku").notNull(),
  date: date("date").notNull(), // YYYY-MM-DD
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  spend: real("spend").notNull().default(0), // In account currency
  conversions: integer("conversions").default(0), // Purchase events if available
  revenue: real("revenue").default(0), // Attributed revenue if available
  currency: text("currency").default('USD'),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  platformSkuDateIdx: uniqueIndex("ad_metrics_platform_sku_date_idx").on(table.platform, table.sku, table.date),
  dateIdx: index("ad_metrics_date_idx").on(table.date),
  skuIdx: index("ad_metrics_sku_idx").on(table.sku),
}));

export const insertAdMetricsDailySchema = createInsertSchema(adMetricsDaily).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAdMetricsDaily = z.infer<typeof insertAdMetricsDailySchema>;
export type AdMetricsDaily = typeof adMetricsDaily.$inferSelect;

// ============================================================================
// AI SYSTEM RECOMMENDATIONS (Weekly LLM-Generated System Improvement Suggestions)
// ============================================================================

// Severity levels for system recommendations
export const SystemRecommendationSeverity = {
  LOW: "LOW",
  MEDIUM: "MEDIUM", 
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type SystemRecommendationSeverity = typeof SystemRecommendationSeverity[keyof typeof SystemRecommendationSeverity];

// Categories for system recommendations (matches ai-system-reviewer.ts RecommendationCategory)
export const SystemRecommendationCategory = {
  INTEGRATION_ISSUE: "INTEGRATION_ISSUE",    // API failures, sync problems, auth issues
  INVENTORY_PATTERN: "INVENTORY_PATTERN",    // Stockout patterns, unusual consumption
  PROCESS_IMPROVEMENT: "PROCESS_IMPROVEMENT", // Workflow inefficiencies
  SECURITY_CONCERN: "SECURITY_CONCERN",      // Auth failures, access patterns
  PERFORMANCE: "PERFORMANCE",                 // Slow operations, timeouts
  DATA_QUALITY: "DATA_QUALITY",              // Inconsistencies, missing data
  OTHER: "OTHER",
} as const;
export type SystemRecommendationCategory = typeof SystemRecommendationCategory[keyof typeof SystemRecommendationCategory];

// Status for system recommendations
export const SystemRecommendationStatus = {
  NEW: "NEW",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  DISMISSED: "DISMISSED",
} as const;
export type SystemRecommendationStatus = typeof SystemRecommendationStatus[keyof typeof SystemRecommendationStatus];

export const aiSystemRecommendations = pgTable("ai_system_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  severity: text("severity").notNull().default("MEDIUM"), // CRITICAL, HIGH, MEDIUM, LOW
  category: text("category").notNull().default("OTHER"), // INTEGRATION_ISSUE, INVENTORY_PATTERN, PROCESS_IMPROVEMENT, SECURITY_CONCERN, PERFORMANCE, DATA_QUALITY, OTHER
  title: text("title").notNull(), // Short summary line
  description: text("description").notNull(), // 1-3 sentence explanation
  suggestedChange: text("suggested_change"), // Specific action to take
  status: text("status").notNull().default("NEW"), // NEW, ACKNOWLEDGED, DISMISSED
  relatedLogIds: text("related_log_ids").array(), // Array of audit log IDs for reference
  reviewPeriodStart: timestamp("review_period_start"), // Start of the analyzed period
  reviewPeriodEnd: timestamp("review_period_end"), // End of the analyzed period
  acknowledgedAt: timestamp("acknowledged_at"), // When status changed to ACKNOWLEDGED
  acknowledgedByUserId: varchar("acknowledged_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  dismissedAt: timestamp("dismissed_at"), // When status changed to DISMISSED
  dismissedByUserId: varchar("dismissed_by_user_id").references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  statusIdx: index("ai_system_recommendations_status_idx").on(table.status),
  createdAtIdx: index("ai_system_recommendations_created_at_idx").on(table.createdAt),
  severityIdx: index("ai_system_recommendations_severity_idx").on(table.severity),
  categoryIdx: index("ai_system_recommendations_category_idx").on(table.category),
}));

export const insertAiSystemRecommendationSchema = createInsertSchema(aiSystemRecommendations).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  acknowledgedAt: true,
  acknowledgedByUserId: true,
  dismissedAt: true,
  dismissedByUserId: true,
});
export type InsertAiSystemRecommendation = z.infer<typeof insertAiSystemRecommendationSchema>;
export type AiSystemRecommendation = typeof aiSystemRecommendations.$inferSelect;

// ============================================================================
// CUSTOM LABEL FORMATS
// ============================================================================

export const labelFormats = pgTable("label_formats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text("name").notNull(), // User-friendly name like "Small Product Tags"
  layoutType: text("layout_type").notNull().default("thermal"), // 'thermal' (single label) or 'sheet' (multiple per page)
  // Label dimensions (stored in inches)
  labelWidth: real("label_width").notNull(), // Width of single label in inches
  labelHeight: real("label_height").notNull(), // Height of single label in inches
  // Page dimensions (for sheet layouts)
  pageWidth: real("page_width").default(8.5), // Page width in inches
  pageHeight: real("page_height").default(11), // Page height in inches
  // Grid layout (for sheet layouts)
  columns: integer("columns").default(1), // Number of columns
  rows: integer("rows").default(1), // Number of rows
  // Margins and gaps (for sheet layouts, in inches)
  marginTop: real("margin_top").default(0),
  marginLeft: real("margin_left").default(0),
  gapX: real("gap_x").default(0), // Horizontal gap between labels
  gapY: real("gap_y").default(0), // Vertical gap between labels
  // Metadata
  isDefault: boolean("is_default").default(false), // User's preferred format
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  userIdIdx: index("label_formats_user_id_idx").on(table.userId),
}));

export const insertLabelFormatSchema = createInsertSchema(labelFormats).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertLabelFormat = z.infer<typeof insertLabelFormatSchema>;
export type LabelFormat = typeof labelFormats.$inferSelect;

// ============================================================================
// SYSTEM LOGS (Unified logging for mismatches and external events)
// ============================================================================

export const SystemLogType = {
  SKU_MISMATCH: "SKU_MISMATCH",
  UPC_MISMATCH: "UPC_MISMATCH",
  PO_EMAIL_SENT: "PO_EMAIL_SENT",
  PO_EMAIL_FAILED: "PO_EMAIL_FAILED",
  PO_AUTO_SENT: "PO_AUTO_SENT",
  SHOPIFY_SYNC_ERROR: "SHOPIFY_SYNC_ERROR",
  SHOPIFY_SYNC_INFO: "SHOPIFY_SYNC_INFO",
  AMAZON_SYNC_ERROR: "AMAZON_SYNC_ERROR",
  EXTENSIV_SYNC_ERROR: "EXTENSIV_SYNC_ERROR",
  SHIPPO_ERROR: "SHIPPO_ERROR",
  GHL_SYNC_ERROR: "GHL_SYNC_ERROR",
  GHL_SYNC_INFO: "GHL_SYNC_INFO",
  RETURN_EVENT: "RETURN_EVENT",
  INVENTORY_ADJUSTMENT: "INVENTORY_ADJUSTMENT",
  INFO: "INFO",
  WARNING: "WARNING",
  ERROR: "ERROR",
} as const;
export type SystemLogType = typeof SystemLogType[keyof typeof SystemLogType];

export const SystemLogSeverity = {
  INFO: "INFO",
  WARNING: "WARNING",
  ERROR: "ERROR",
} as const;
export type SystemLogSeverity = typeof SystemLogSeverity[keyof typeof SystemLogSeverity];

export const SystemLogEntityType = {
  PO: "PO",
  RETURN: "RETURN",
  ORDER: "ORDER",
  PRODUCT: "PRODUCT",
  SUPPLIER: "SUPPLIER",
  INTEGRATION: "INTEGRATION",
} as const;
export type SystemLogEntityType = typeof SystemLogEntityType[keyof typeof SystemLogEntityType];

export const systemLogs = pgTable("system_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // SystemLogType
  entityType: text("entity_type"), // SystemLogEntityType
  entityId: text("entity_id"), // Reference to PO ID, return ID, SKU, order ID, etc.
  severity: text("severity").notNull().default("INFO"), // INFO, WARNING, ERROR
  code: text("code"), // Short machine-readable code, e.g. "SKU_NOT_FOUND"
  message: text("message").notNull(), // Human-readable summary
  details: jsonb("details"), // Structured payload with additional context
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  typeIdx: index("system_logs_type_idx").on(table.type),
  severityIdx: index("system_logs_severity_idx").on(table.severity),
  entityTypeIdx: index("system_logs_entity_type_idx").on(table.entityType),
  createdAtIdx: index("system_logs_created_at_idx").on(table.createdAt),
}));

export const insertSystemLogSchema = createInsertSchema(systemLogs).omit({ 
  id: true, 
  createdAt: true,
});
export type InsertSystemLog = z.infer<typeof insertSystemLogSchema>;
export type SystemLog = typeof systemLogs.$inferSelect;

// ============================================================================
// AI AGENT SETTINGS (Rules for auto-send POs and inventory management)
// ============================================================================

export const aiAgentSettings = pgTable("ai_agent_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  // Auto-send PO settings
  autoSendCriticalPos: boolean("auto_send_critical_pos").notNull().default(false),
  criticalRescueDays: integer("critical_rescue_days").notNull().default(7),
  // Priority thresholds (days until stockout)
  criticalThresholdDays: integer("critical_threshold_days").notNull().default(3),
  highThresholdDays: integer("high_threshold_days").notNull().default(7),
  mediumThresholdDays: integer("medium_threshold_days").notNull().default(14),
  // Shopify sync settings
  shopifyTwoWaySync: boolean("shopify_two_way_sync").notNull().default(false),
  shopifySafetyBuffer: integer("shopify_safety_buffer").notNull().default(0), // Safety buffer for availability calculation
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  userIdIdx: uniqueIndex("ai_agent_settings_user_id_idx").on(table.userId),
}));

export const insertAiAgentSettingsSchema = createInsertSchema(aiAgentSettings).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
});
export type InsertAiAgentSettings = z.infer<typeof insertAiAgentSettingsSchema>;
export type AiAgentSettings = typeof aiAgentSettings.$inferSelect;
