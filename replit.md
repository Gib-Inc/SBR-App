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

## External Dependencies

*   **UI Libraries**: Radix UI, shadcn/ui, Lucide React, Tailwind CSS.
*   **Data & State Management**: TanStack Query, React Hook Form, Drizzle ORM.
*   **External Service Integrations**: GoHighLevel (CRM), Shopify (e-commerce), Extensiv/Pivot (3PL warehouse management), PhantomBuster (web scraping).
*   **LLM Providers**: OpenAI (ChatGPT), Anthropic (Claude), Grok, Custom Endpoint support.
*   **Database Provider**: Neon (Serverless PostgreSQL).
*   **Hardware Support**: USB/Bluetooth barcode scanners.