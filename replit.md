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
*   **Key Pages**: Dashboard (KPIs, forecasting), Products (catalog, BOM builder), Barcodes (management, generation), Settings (authentication, API keys, LLM config).

### Backend Architecture

*   **Framework**: Node.js with Express and TypeScript.
*   **Database ORM**: Drizzle ORM.
*   **Authentication**: Session-based with `connect-pg-simple`, `bcrypt` for password hashing.
*   **API**: RESTful endpoints under `/api/*`.
*   **Core Services**: 
    *   LLMService (pluggable AI for forecasting, PO message generation)
    *   BarcodeService (generation)
    *   ShopifyClient (order sync via Admin API)
    *   AmazonClient (order sync via SP-API with OAuth)
    *   ExtensivClient (inventory sync via API)
    *   GoHighLevelClient (CRM integration, SMS/email to suppliers)
    *   QuickBooksClient (OAuth 2.0 sales history sync, PO-to-Bill creation)
    *   PhantomBusterClient (supplier discovery via web scraping phantoms)
    *   Storage Layer (abstracted data access)
*   **Production**: Static assets served via Express.

### Data Architecture

*   **Database**: PostgreSQL (via Neon serverless driver) with Drizzle Kit for migrations.
*   **Core Entities**: Users, Items (components, finished products), Bins, InventoryByBin, BillOfMaterials, Suppliers, SupplierItems, SalesHistory, SalesOrders (multi-channel with Shopify/Amazon/GHL/Direct), BackorderSnapshots, FinishedInventorySnapshot, IntegrationHealth, IntegrationConfigs, Settings, Barcodes.
*   **Relationships**: Products to BOM to Components, Items to InventoryByBin to Bins, Items to SupplierItems to Suppliers, SalesOrders to Items via line items with SKU mapping.
*   **Integration Data**: SalesOrders include rawPayload JSONB field storing original external API responses for debugging and audit purposes.

### Forecasting & Analytics

*   **Constraint-based Planning**: Calculates "days until stockout" and identifies bottleneck components.
*   **Production Capacity**: Determines maximum producible finished products based on BOM and component constraints.
*   **LLM-Powered Forecasting**: Utilizes AI for multi-period analysis, generating reorder recommendations based on historical data, current stock, and usage rates.

### System Design Choices

*   **Inventory Location Fields for Finished Products**:
    *   `hildaleQty`: Physical inventory at Hildale warehouse (receives returns, production output)
    *   `pivotQty`: Authoritative mirror of Extensiv/3PL inventory (only updated by Extensiv sync)
    *   `availableForSaleQty`: Live projected 3PL stock available for sale (pivotQty baseline + local deltas from orders/returns). Used for AI risk calculations.
*   **Inventory Movement Rules**:
    *   Sales Order Created (Shopify/Amazon): Decrements `availableForSaleQty` (can go negative to show shortage)
    *   Sales Order Cancelled: Increments `availableForSaleQty`
    *   Sales Order Shipped (Hildale): Decrements `hildaleQty`; (Pivot): No change to projection (already decremented at create)
    *   PO Received: Increments both `pivotQty` and `availableForSaleQty`
    *   Returns: Always go to HILDALE ONLY - increments `hildaleQty` only (NOT `availableForSaleQty`). Returned items are buffer stock until transferred to Pivot.
    *   Extensiv Sync: READ-ONLY - sets `pivotQty` from Extensiv and adjusts `availableForSaleQty` by the delta. NO write-back to Extensiv.
*   **InventoryMovement Helper**: Centralized service (`server/services/inventory-movement.ts`) for all order-related inventory changes with audit logging. Used by Sales Orders, Returns, PO receipts, and Extensiv sync.
*   **availableForSaleQty Ownership**: Only the following events modify availableForSaleQty (all via InventoryMovement.apply()):
    *   `EXTENSIV_SYNC`: Sets baseline by adjusting availableForSaleQty by (newPivotQty - oldPivotQty)
    *   `SALES_ORDER_CREATED`: Decrements for Pivot-fulfilled orders (Shopify/Amazon)
    *   `SALES_ORDER_CANCELLED`: Increments for Pivot-fulfilled orders (restores stock)
    *   `RETURN_RECEIVED`: NO CHANGE - returns go to Hildale only (NOT availableForSale until transferred)
    *   `PURCHASE_ORDER_RECEIVED`: Increments (new stock from PO)
    *   `SALES_ORDER_SHIPPED`: NO CHANGE for Pivot orders (already decremented at create), only affects hildaleQty for Hildale orders
*   **Audit Trail**: All inventory quantity changes are tracked via an `InventoryTransaction` table with types like TRANSFER, ADJUST, PRODUCE, RECEIVE, SHIP.
*   **Transaction Service**: Centralized logic for production/transfer movements. Note: Uses legacy direct updates; future work to migrate to InventoryMovement helper.
*   **Batch Forecasting**: LLM forecasts are generated in batches for efficiency, triggered by inventory transactions, rather than real-time per-transaction calls.
*   **Multi-Channel Order Sync**: Shopify and Amazon orders sync with duplicate prevention using externalOrderId + channel combination, SKU-to-product mapping with graceful handling, and automatic backorder/forecast context refresh.
*   **Integration Management**: All external integrations (Extensiv, Shopify, Amazon) managed through AI Agent → Data Sources tab with unified IntegrationSettings component, removing need for separate Integrations page.
*   **Demo Data Seeding**: Development database can be populated with realistic demo data via `npx tsx server/seed.ts`. Includes 6 multi-channel sales orders (3 Shopify, 3 Amazon) with various statuses, and 2 linked return requests demonstrating the full order-to-return workflow.
*   **Responsive Layout**: Implemented `min-w-0` on flex containers and explicit width constraints to ensure proper adaptation and prevent horizontal scrolling issues.
*   **Sticky Elements**: Actions columns in wide tables are sticky for improved usability during horizontal scrolling.
*   **Table Standardization**: All data tables across the application use `whitespace-nowrap` on headers and cells to enforce single-line row heights, preventing text wrapping and maintaining consistent, scannable layouts.
*   **LLM-Powered PO Creation**: Create PO flow via Suppliers page with 3-step wizard (select supplier → choose items sorted by criticality → review & send). LLM generates professional PO messages (email subject/body and SMS) with fallback templates. GoHighLevel integration sends PO via SMS or email to suppliers with automatic contact creation.
*   **Integration Health & Key Rotation**: Automated monitoring of OAuth tokens and API keys across all integrations (QuickBooks, Meta Ads, Google Ads, Extensiv, Shopify, Amazon, GoHighLevel, PhantomBuster). Features include:
    *   Health status classification: OK (>=14 days), WARNING (7-13 days), CRITICAL (<7 days), EXPIRED
    *   API key age tracking for non-expiring keys (warns after 90 days)
    *   Consecutive auth failure detection (CRITICAL after 3 failures)
    *   GoHighLevel SMS/email alerts when tokens approach expiry (24h throttle to prevent spam)
    *   UI component on AI Agent → Data Sources tab showing all integration health status
    *   Audit trail logging for all health checks and rotation alerts
    *   Manual "Run Check" button for on-demand health verification

### V1 Integration Architecture Rules

**System of Record Principles:**
1.  **Inventory App is System of Record for Quantities**: currentStock (raw materials), hildaleQty, pivotQty, availableForSaleQty are managed locally. All changes MUST go through InventoryMovement helper for audit trail.
2.  **Shopify + Amazon are Order Sources Only**: We import orders → SalesOrders table + InventoryMovement(SALES_ORDER_CREATED). We do NOT push inventory quantities back to channels (stay compliant, no fake stock levels).
3.  **Extensiv/Pivot is Read-Only**: We pull inventory snapshots for 3PL reconciliation. Store Extensiv quantities in `extensivOnHandSnapshot` for variance display. EXTENSIV_SYNC updates pivotQty and adjusts availableForSaleQty by delta.
4.  **QuickBooks is Financial-Only (V1 Implemented)**: Read-only sales history sync + PO-to-Bill creation. QuickBooks serves as source of truth for historical revenue data. We do NOT create/modify QuickBooks sales documents (Invoices, SalesReceipts, Payments) and do NOT create SalesOrders from QuickBooks to prevent double-counting orders from Shopify/Amazon. Monthly sales snapshots supplement AI velocity calculations when local data is sparse.
5.  **GoHighLevel is Messaging-Only**: Used for PO contact creation + email/SMS sending. Does NOT drive inventory quantities.
6.  **PhantomBuster is Discovery-Only (V1 Implemented)**: Manual-trigger supplier discovery via web scraping phantoms. Discovered leads stored in SupplierLeads table with source tracking (PHANTOMBUSTER_LINKEDIN, PHANTOMBUSTER_GOOGLE, etc.). Leads can be converted to Suppliers. No scheduled automation in V1 - all discovery runs are user-initiated via Suppliers → Discovery tab.

**Idempotency Guarantees:**
*   Unique constraint on (channel, externalOrderId) prevents duplicate order imports
*   Shopify/Amazon syncs use getSalesOrdersByExternalId lookup before creating new orders

**Extensiv Variance Tracking:**
*   `extensivOnHandSnapshot`: Last synced Extensiv quantity (read-only, for variance comparison)
*   `extensivLastSyncAt`: Timestamp of last Extensiv sync for this item
*   UI displays variance (Extensiv OnHand vs availableForSaleQty) in Products table with color coding

## External Dependencies

*   **UI Libraries**: Radix UI, shadcn/ui, Lucide React, Tailwind CSS.
*   **Data & State Management**: TanStack Query, React Hook Form, Drizzle ORM.
*   **External Service Integrations**: GoHighLevel (CRM), Shopify (e-commerce), Extensiv/Pivot (3PL warehouse management), PhantomBuster (web scraping).
*   **LLM Providers**: OpenAI (ChatGPT), Anthropic (Claude), Grok, Custom Endpoint support.
*   **Database Provider**: Neon (Serverless PostgreSQL).
*   **Hardware Support**: USB/Bluetooth barcode scanners (HID keyboard mode).