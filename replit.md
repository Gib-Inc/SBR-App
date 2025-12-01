# Manufacturing Inventory Management System

## Overview

This is a production-ready full-stack inventory management web application for manufacturing companies. It tracks component and finished product inventory, integrates with external services for order management, and features barcode scanning, Bill of Materials (BOM) management, and LLM-powered forecasting. The system aims to help manufacturing operations manage inventory, predict stockouts, track production capacity, and automate ordering with AI-assisted recommendations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

*   **Frameworks**: React with TypeScript, Wouter for routing, TanStack Query for state management.
*   **UI/UX**: Radix UI primitives with shadcn/ui customization, Tailwind CSS for styling, inspired by Carbon Design System.
*   **Design**: IBM Plex Sans typography, light/dark mode support, responsive layouts for desktop and tablets.
*   **Key Pages**: Dashboard (KPIs, forecasting), Products (catalog, BOM builder), Barcodes (management, generation), Settings (authentication, LLM config with model/temperature/tokens).

### Backend Architecture

*   **Framework**: Node.js with Express and TypeScript.
*   **Database ORM**: Drizzle ORM.
*   **Authentication**: Session-based with `connect-pg-simple`, `bcrypt` for password hashing.
*   **API**: RESTful endpoints under `/api/*`.
*   **Core Services**: LLMService, BarcodeService, ShopifyClient, AmazonClient, ExtensivClient, GoHighLevelClient, QuickBooksClient, PhantomBusterClient, Storage Layer.

### Data Architecture

*   **Database**: PostgreSQL (via Neon serverless driver) with Drizzle Kit for migrations.
*   **Core Entities**: Users, Items, Bins, InventoryByBin, BillOfMaterials, Suppliers, SupplierItems, SalesHistory, SalesOrders, BackorderSnapshots, FinishedInventorySnapshot, IntegrationHealth, IntegrationConfigs, Settings, Barcodes, LabelFormats, PurchaseOrders, PurchaseOrderLines, PurchaseOrderReceipts, PurchaseOrderReceiptLines.
*   **Relationships**: Products to BOM to Components, Items to InventoryByBin to Bins, Items to SupplierItems to Suppliers, SalesOrders to Items via line items with SKU mapping, PurchaseOrders to Suppliers, PurchaseOrderLines to Items, Receipts to POs.
*   **Integration Data**: SalesOrders include rawPayload JSONB field.

### Forecasting & Analytics

*   **Constraint-based Planning**: Calculates "days until stockout" and identifies bottleneck components.
*   **Production Capacity**: Determines maximum producible finished products.
*   **LLM-Powered Forecasting**: Utilizes AI for multi-period analysis, generating reorder recommendations.

### System Design Choices

*   **Inventory Location Fields**: `hildaleQty`, `pivotQty`, `availableForSaleQty` for tracking different inventory states.
*   **Inventory Movement Rules**: Defined logic for how sales orders, cancellations, shipments, PO receipts, returns, and Extensiv sync affect inventory quantities. All changes are tracked via an `InventoryTransaction` table and centralized `InventoryMovement` helper.
*   **Batch Forecasting**: LLM forecasts are generated in batches for efficiency.
*   **Multi-Channel Order Sync**: Shopify and Amazon orders sync with duplicate prevention and SKU mapping.
*   **Integration Management**: All external integrations managed through the AI Agent → Data Sources tab.
*   **Demo Data Seeding**: Development database can be populated with realistic demo data.
*   **UI/UX**: Responsive layouts, sticky table elements, and standardized table presentation.
*   **LLM-Powered PO Creation**: 3-step wizard for Purchase Order creation with LLM-generated messages and GoHighLevel integration for sending.
*   **Purchase Order State Machine**: Full lifecycle management with status transitions: DRAFT → APPROVAL_PENDING → APPROVED → SENT → PARTIAL_RECEIVED/RECEIVED → CLOSED. Cancellation only allowed from open states (DRAFT, APPROVAL_PENDING, APPROVED, SENT).
*   **PO Receipt Tracking**: PurchaseOrderReceipts and PurchaseOrderReceiptLines track partial and full receipts against POs, with automatic status transitions.
*   **PO PDF Export**: Professional PDF generation using pdfkit with company branding, line items table, and financial totals. Available via `/api/purchase-orders/:id/pdf`.
*   **Fix-in-GHL Integration**: Stock Warning Banner creates real Purchase Orders in system first, then optionally links to GoHighLevel opportunities via ghlOpportunityId field for supplier communication.
*   **Integration Health & Key Rotation**: Automated monitoring of OAuth tokens and API keys, health status classification (OK, WARNING, CRITICAL, EXPIRED), and alerts.
*   **System of Record Principles**: Inventory App is the system of record for quantities; Shopify/Amazon are order sources only; Extensiv/Pivot are read-only; QuickBooks is financial-only; GoHighLevel is messaging-only; PhantomBuster is discovery-only.
*   **Idempotency Guarantees**: Unique constraints prevent duplicate order imports.
*   **Extensiv Variance Tracking**: `extensivOnHandSnapshot` and `extensivLastSyncAt` track variance with Extensiv.
*   **Customizable Label Printing**: Print Labels dialog supports custom label dimensions (width × height in inches), thermal/sheet layout toggle, saved format presets, and advanced sheet options (columns, rows, margins, gaps). Formats are saved per-user in the `label_formats` table.
*   **Returns System**: Complete return lifecycle management with state machine (REQUESTED → APPROVED → LABEL_CREATED → IN_TRANSIT → RETURNED → REFUND_ISSUE_PENDING → REFUNDED → CLOSED), RMA number generation (format: RMA-YYYY-000001), Shippo integration for return label generation, and GHL refund opportunity sync. Supports both manual UI returns and GHL bot-initiated returns.
*   **Returns Service Architecture**: ReturnsService (server/services/returns-service.ts) manages return lifecycle, ShippoReturnsService (server/services/shippo-returns-service.ts) handles label generation via Shippo API, ReturnGHLSyncService (server/services/return-ghl-sync-service.ts) syncs refund tasks to GoHighLevel pipeline. Return events are tracked in return_events table for full audit trail.
*   **Returns Environment Variables**: SHIPPO_API_KEY (for Shippo return labels), SHIPPO_WAREHOUSE_* (warehouse address), and GHL returns pipeline IDs in settings (gohighlevelReturnsPipelineId, gohighlevelReturnsStageIssueRefundId, gohighlevelReturnsStageRefundedId).
*   **System Logs**: Unified logging system for integration events and mismatches. Stored in `system_logs` table with types: SKU_MISMATCH, UPC_MISMATCH, PO_EMAIL_SENT, PO_EMAIL_FAILED, PO_AUTO_SENT, SHOPIFY_SYNC_ERROR, AMAZON_SYNC_ERROR, EXTENSIV_SYNC_ERROR, SHIPPO_ERROR, GHL_SYNC_ERROR, RETURN_EVENT. Accessed via `/api/system-logs` endpoint. LogService (server/services/log-service.ts) provides helper methods for logging.
*   **AI Agent Settings**: Per-user automation settings stored in `ai_agent_settings` table. Includes: autoSendCriticalPos (auto-send POs for critical stock), criticalRescueDays (stockout threshold for auto-send), shopifyTwoWaySync (push inventory to Shopify), shopifySafetyBuffer (stock reserve for Shopify sync). Managed via `/api/ai-agent-settings` endpoint and configured in AI Agent → Rules tab.
*   **Shopify Inventory Mapping**: Items table includes shopifyProductId, shopifyVariantId, shopifyLocationId fields for two-way inventory sync with Shopify.
*   **Shopify Two-Way Sync Service**: ShopifyInventorySyncService (server/services/shopify-inventory-sync-service.ts) pushes inventory levels to Shopify when shopifyTwoWaySync is enabled. Applies shopifySafetyBuffer to reserve stock. API endpoints: POST /api/shopify/sync-inventory (bulk sync), POST /api/shopify/sync-inventory/:itemId (single item), GET /api/shopify/sync-status. Requires SHOPIFY_SHOP_DOMAIN, SHOPIFY_ACCESS_TOKEN, and optionally SHOPIFY_LOCATION_ID environment variables.
*   **Read-Only Integrations**: Amazon and Extensiv are strictly read-only for inventory. EXTENSIV_SYNC updates pivotQty from Extensiv snapshots but never writes back. Returns go to HILDALE only (not Extensiv). Shopify/Amazon orders are imported but inventory is owned by this app.
*   **PO Status Recalculation**: POST /api/purchase-orders/:id/recalculate-status endpoint fixes POs stuck in PARTIAL_RECEIVED when all items are fully received. UI shows "Update Status to Received" button when this condition is detected.
*   **Supplier Acknowledgement Tracking**: Complete PO acknowledgement system with cryptographically secure tokens (32-byte hex), 30-day expiration, and three confirmation sources (SUPPLIER via public link, INTERNAL via admin override, PHONE for verbal confirmations). Public supplier-facing page at /po-ack/:token allows suppliers to view PO details and confirm receipt without authentication. API endpoints: GET /api/po-ack/:token/view, POST /api/po-ack/:token/confirm, POST /api/purchase-orders/:id/mark-accepted-internal.
*   **Email Status Tracking**: PO emails track delivery status (SENT, OPENED, BOUNCED, FAILED) via SendGrid webhooks at /api/webhooks/sendgrid. Email status shown in PO list and detail modal with EmailStatusBadge component. SendGrid webhook validates event types (open, bounce, delivered, dropped) and updates PO email status automatically.
*   **PO Email Environment Variables**: SENDGRID_API_KEY (for email sending), APP_BASE_URL (for acknowledgement link generation, falls back to REPLIT_DEV_DOMAIN).
*   **Auto-Suggest Purchase Cost**: Items can have defaultPurchaseCost, supplierProductUrl, costSource (MANUAL/AUTO_SCRAPED/API), and lastCostUpdatedAt fields. AutoSuggestCostService (server/services/auto-suggest-cost-service.ts) fetches supplier product pages and extracts prices via regex patterns and LLM fallback. Cost settings accessible via $ button in Stock Inventory actions. API endpoint: POST /api/items/:id/auto-suggest-cost. When creating PO lines, defaultPurchaseCost takes priority over supplier item costs. Safety toggle: AUTO_SCRAPE_SUPPLIER_PRICES_ENABLED env var.
*   **GoHighLevel Integration Simplified**: GHL configuration requires only API Key and Location ID (no Base URL field). Fixed base URL: `https://rest.gohighlevel.com/v1`. Status endpoint: GET /api/integrations/gohighlevel/status. Test connection endpoint: POST /api/integrations/gohighlevel/test with specific error codes (INVALID_API_KEY, INVALID_LOCATION_ID, NETWORK_ERROR, RATE_LIMITED, SERVER_ERROR, UNKNOWN). Storage layer normalizes provider names to uppercase to prevent case-sensitivity issues. Unique constraint on (user_id, provider) prevents duplicate integration configs.
*   **UPC/GTIN Product Identification**: Items table includes `upc` field (nullable unique) for GS1/UPC/GTIN barcode identification. Primarily used for finished products for marketplace identification and cross-channel product matching. UPC column visible in Finished Products table with toggle in "Columns" popover. UPC input available in Add Product form for finished products.
*   **Enhanced SKU Mapping Wizard**: Products → SKU Mapping Wizard button opens multi-channel mapping interface. Shopify tab fetches products via `/api/integrations/shopify/products` endpoint and provides auto-matching by UPC (highest priority) or SKU. Auto-suggested matches show with one-click confirmation. Manual variant selection available via searchable dropdown. Successful links save shopifyProductId, shopifyVariantId, shopifyInventoryItemId, and shopifySku to the item. Uses precomputed Maps for O(1) lookup performance on large catalogs.

## External Dependencies

*   **UI Libraries**: Radix UI, shadcn/ui, Lucide React, Tailwind CSS.
*   **Data & State Management**: TanStack Query, React Hook Form, Drizzle ORM.
*   **External Service Integrations**: GoHighLevel (CRM), Shopify (e-commerce), Extensiv/Pivot (3PL warehouse management), PhantomBuster (web scraping).
*   **LLM Providers**: OpenAI (ChatGPT), Anthropic (Claude), Grok, Custom Endpoint support.
*   **Database Provider**: Neon (Serverless PostgreSQL).
*   **Hardware Support**: USB/Bluetooth barcode scanners.