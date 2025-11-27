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
    *   `pivotProjectionQty`: Live projected 3PL stock that accounts for new Shopify/Amazon orders and returns in real-time, before Extensiv reflects changes. Used for AI risk calculations.
*   **Inventory Movement Rules**:
    *   Sales Order Created (Shopify/Amazon): Decrements `pivotProjectionQty` (can go negative to show shortage)
    *   Sales Order Cancelled: Increments `pivotProjectionQty`
    *   Sales Order Shipped (Hildale): Decrements `hildaleQty`; (Pivot): No change to projection (already decremented at create)
    *   PO Received: Increments both `pivotQty` and `pivotProjectionQty`
    *   Returns: Always go to HILDALE - increments `hildaleQty` AND `pivotProjectionQty`
    *   Extensiv Sync: Sets `pivotQty` from Extensiv and adjusts `pivotProjectionQty` by the delta
*   **InventoryMovement Helper**: Centralized service (`server/services/inventory-movement.ts`) for all order-related inventory changes with audit logging. Used by Sales Orders, Returns, PO receipts, and Extensiv sync.
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

## External Dependencies

*   **UI Libraries**: Radix UI, shadcn/ui, Lucide React, Tailwind CSS.
*   **Data & State Management**: TanStack Query, React Hook Form, Drizzle ORM.
*   **External Service Integrations**: GoHighLevel (CRM), Shopify (e-commerce), Extensiv/Pivot (3PL warehouse management), PhantomBuster (web scraping).
*   **LLM Providers**: OpenAI (ChatGPT), Anthropic (Claude), Grok, Custom Endpoint support.
*   **Database Provider**: Neon (Serverless PostgreSQL).
*   **Hardware Support**: USB/Bluetooth barcode scanners (HID keyboard mode).