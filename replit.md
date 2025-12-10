# Manufacturing Inventory Management System

## Overview

This project is a full-stack inventory management web application designed for manufacturing companies. It provides comprehensive tracking of component and finished product inventory, integrates with various external services for order management, and includes features like barcode scanning, Bill of Materials (BOM) management, and LLM-powered forecasting. The system aims to streamline inventory operations, predict stockouts, monitor production capacity, and automate ordering processes with AI-assisted recommendations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

*   **Frameworks**: React with TypeScript, Wouter, TanStack Query.
*   **UI/UX**: Radix UI primitives, shadcn/ui, Tailwind CSS, inspired by Carbon Design System.
*   **Design**: IBM Plex Sans typography, light/dark mode, responsive layouts.
*   **Key Pages**: Dashboard, Products (catalog, BOM builder), Barcodes, Settings (authentication, LLM config).

### Backend

*   **Framework**: Node.js with Express and TypeScript.
*   **Database ORM**: Drizzle ORM.
*   **Authentication**: Session-based with `connect-pg-simple`, `bcrypt`.
*   **API**: RESTful endpoints.
*   **Core Services**: LLMService, BarcodeService, ShopifyClient, AmazonClient, ExtensivClient, GoHighLevelClient, QuickBooksClient, PhantomBusterClient, Storage Layer.

### Data Architecture

*   **Database**: PostgreSQL (Neon serverless driver), Drizzle Kit for migrations.
*   **Core Entities**: Users, Items, Bins, Inventory, BOMs, Suppliers, Sales & Purchase Orders, Integration configurations, System Logs, Returns.
*   **Key Relationships**: Products to BOM, Items to Inventory, Orders to Items.

### Features & Design Decisions

*   **Inventory Tracking**: Dual-warehouse model with strict inventory rules:
    *   `hildaleQty`: Buffer stock at Hildale production warehouse (NOT sellable)
    *   `pivotQty`: Sellable stock at Pivot 3PL (canonical for marketplace sync)
    *   `availableForSaleQty`: Derived cache from pivotQty minus allocations
    *   **ABSOLUTE RULE**: Sales orders ONLY impact `pivotQty`, NEVER `hildaleQty`
    *   `hildaleQty` changes only from: PO receipts, production builds, Hildale→Pivot transfers, returns, manual adjustments
    *   `TRANSFER` event type moves stock from Hildale → Pivot (makes it sellable)
    *   Robust `InventoryMovement` system tracking all changes via `InventoryTransaction`
*   **Forecasting & Planning**: Constraint-based planning for stockout prediction and production capacity, LLM-powered multi-period forecasting for reorder recommendations.
*   **AI Batch Recommendation System**: Centralized batch processing for all LLM-powered inventory recommendations:
    *   Scheduled batch runs at 10:00 AM and 3:00 PM Mountain time (America/Denver)
    *   Critical trigger detection with 15-minute debounce for SKUs crossing into critical state
    *   Order timing decision: `ORDER_TODAY` (daysUntilStockout - leadTime <= 3 days) vs `SAFE_UNTIL_TOMORROW`
    *   Batch logs tracked in `ai_batch_logs` table with status, metrics, and LLM response times
    *   Deterministic fallback when LLM is unavailable
    *   Mutex to prevent overlapping batch runs
    *   Manual batch trigger via `/api/ai-batch/run` endpoint
*   **Order Management**: Multi-channel order synchronization (Shopify, Amazon) with duplicate prevention and SKU mapping.
*   **Purchase Order (PO) System**:
    *   LLM-powered PO creation wizard with GoHighLevel integration.
    *   State machine for PO lifecycle management (DRAFT, APPROVAL_PENDING, APPROVED, SENT, PARTIAL_RECEIVED, RECEIVED, CLOSED).
    *   Detailed PO receipt tracking and PDF export.
    *   Supplier acknowledgement system with public links and email status tracking via SendGrid webhooks.
    *   Auto-suggestion of purchase costs from supplier pages using regex and LLMs.
*   **Returns Management**:
    *   Comprehensive return lifecycle with RMA generation and state machine.
    *   Shippo integration for return label generation.
    *   GoHighLevel integration for refund opportunity sync.
    *   QuickBooks Credit Memo creation for accounting via `/api/returns/:id/post-to-quickbooks`.
*   **Daily Sales Snapshots** (for LLM trend analysis):
    *   Aggregated daily totals stored in `daily_sales_snapshots` table.
    *   Metrics: totalRevenue, totalOrders, totalUnits, totalRefunds, netRevenue.
    *   Channel breakdown (Shopify, Amazon, direct) stored as JSONB.
    *   Trend metrics: day-over-day, week-over-week, month-over-month, year-over-year percentage changes.
    *   Rolling averages: 7-day and 30-day moving averages.
    *   API endpoints: `/api/daily-sales-snapshots`, `/api/daily-sales-snapshots/years`, `/api/daily-sales-snapshots/:date`.
*   **Integrations**:
    *   **AI Agent Rules**: Per-user settings for automation (e.g., auto-send critical POs, two-way inventory sync with Shopify/Amazon, safety buffers).
    *   **Sync Mode Confirmation Modals**: All four data sources (GHL, Amazon, Extensiv, QuickBooks) have confirmation modals with safe vs. align modes:
        *   **GHL**: "Update" (safe, import/update only) vs "Align" (archives orphaned GHL opportunities)
        *   **Amazon**: "Import" (safe, import/update only) vs "Align" (archives removed orders + pushes inventory if 2-way enabled)
        *   **Extensiv**: "Compare" (read-only discrepancy logging) vs "Align" (applies adjustments to Pivot Qty)
        *   **QuickBooks**: "Append" (add new/update existing) vs "Rebuild" (clears and repopulates date range)
    *   **Shopify Two-Way Sync**: Pushes inventory levels to Shopify, respecting safety buffers.
    *   **Amazon Two-Way Sync**: Pushes inventory levels to Amazon, with region selection and sync mode display.
    *   **Extensiv Two-Way Integration**: Pulls inventory, pushes orders, and informs fulfillment routing decisions based on inventory thresholds (Hildale vs. Pivot Extensiv).
    *   **GoHighLevel**: Simplified configuration for CRM and messaging.
    *   **Webhooks**: Shopify webhooks for real-time order processing; SendGrid webhooks for email status.
    *   **Shopify Reconciliation**: Periodic sync runs Tuesday & Thursday at 9:00 AM MT to catch missed webhook orders:
        *   Syncs last 7 days of orders (max 500 per run)
        *   Prevents concurrent runs with mutex
        *   Logs to AI Agent Logs via SHOPIFY_RECONCILIATION log type
        *   Manual trigger available via `/api/shopify/reconciliation/trigger`
        *   Status check via `/api/shopify/reconciliation/status`
    *   **Automatic GHL Sync**: Sales orders from Shopify are automatically synced to GoHighLevel as opportunities:
        *   Triggered immediately after order creation (both webhook and reconciliation paths)
        *   Uses idempotent upsert with `sales-order-{id}` external key
        *   Non-blocking: GHL sync errors don't prevent order creation
        *   Tracks `ghlSynced` count in reconciliation logs
*   **Product Identification**: Supports UPC/GTIN for finished products, enhancing marketplace identification and cross-channel matching.
*   **SKU Mapping Wizard**: Centralized interface for mapping internal SKUs to external platform SKUs (e.g., Shopify, Extensiv) with auto-matching capabilities.
*   **Label Printing**: Customizable label printing with support for various dimensions, layouts, and saved format presets.
*   **System Logs**: Unified logging for integration events and mismatches (e.g., SKU_MISMATCH, API_ERRORS).
*   **Integration Health**: Automated monitoring of API keys and tokens with status classification (OK, WARNING, CRITICAL).
*   **System of Record**: This application is the system of record for inventory quantities, while other platforms serve specific functions (e.g., Shopify/Amazon for orders, QuickBooks for finance).

## External Dependencies

*   **UI Libraries**: Radix UI, shadcn/ui, Lucide React, Tailwind CSS.
*   **Data & State Management**: TanStack Query, React Hook Form, Drizzle ORM.
*   **External Service Integrations**: GoHighLevel (CRM), Shopify (e-commerce), Amazon (e-commerce), Extensiv/Pivot (3PL warehouse management), PhantomBuster (web scraping), Shippo (shipping labels), SendGrid (email).
*   **LLM Providers**: OpenAI (ChatGPT), Anthropic (Claude), Grok, Custom Endpoint support.
*   **Database Provider**: Neon (Serverless PostgreSQL).
*   **Hardware Support**: USB/Bluetooth barcode scanners.