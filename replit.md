# Manufacturing Inventory Management System

## Overview

This is a production-ready full-stack inventory management web application designed for manufacturing companies. The system tracks component inventory (nuts, bolts, springs, bars), finished products, and integrates with external services for order management and fulfillment. It features barcode scanning capabilities, bill of materials (BOM) management, LLM-powered forecasting, and real-time inventory tracking.

**Core Purpose**: Enable manufacturing operations to manage inventory levels, predict stockouts, track production capacity, and automate ordering processes with AI-assisted recommendations.

## Recent Changes

**November 24, 2025 - Purchase Order Table UI Improvements**:
- ✅ **Proper Table Containerization**: Restructured PO table in Suppliers page for optimal data viewing
  - Filters (search + status/supplier dropdowns) separated and fixed at top with visual border
  - Independent dual-scroll: vertical (max-h-[600px]) and horizontal (min-w-[1100px] table)
  - Sticky headers (sticky top-0 bg-card z-10) remain visible during vertical scrolling
  - Empty state renders as row inside tbody, maintaining table structure
  - Loading state properly positioned outside scroll container
- ✅ **Seed Data Fix**: Corrected supplier variable references (acmeSupplier → acmeCorp, globalSupplier → globalSupply)
  - 4 sample POs created: Draft, Sent, Partial Received, and Received statuses

**November 23, 2025 - AI Batch Forecasting & Transaction System Improvements**:
- ✅ **Batch Forecast Infrastructure**: Added forecastDirty, lastForecastAt, and forecastData fields to items schema
  - forecastDirty (boolean): Marks items needing forecast refresh
  - lastForecastAt (timestamp): Tracks last forecast generation time
  - forecastData (JSONB): Stores last generated forecast (ReorderRecommendation)
- ✅ **Production-Ready Batch Forecast Endpoint** (POST /api/llm/batch-forecast):
  - Processes only items marked forecastDirty=true (efficient filtering)
  - Calls LLM once for all dirty items (batch processing)
  - Stores forecasts and marks items clean ONLY on success (proper retry semantics)
  - Items stay dirty on LLM failure or missing recommendations
  - Returns detailed results: totalDirty, successCount, noDataCount, failureCount, failures[]
- ✅ **TransactionService Integration**: All finished product transactions mark forecastDirty=true
  - Triggers batch forecast recalculation instead of real-time LLM calls
  - Cost-efficient: Forecasts regenerated in scheduled batches, not per transaction
- ✅ **Create Item with Transactions**: POST /api/items now uses RECEIVE transactions for initial stock
  - Creates audit trail from day one
  - Frontend helper text explains "Initial stock at manufacturing site/warehouse"
- ✅ **Inline Editing via Transactions**: PATCH /api/items/:id routes hildaleQty/pivotQty changes through ADJUST transactions
  - Calculates delta between old and new quantities
  - Frontend parses numeric values correctly (no more string bugs)
  - Complete audit trail for all manual adjustments
- ✅ **LLMService Enhancement**: generateLLMReorderRecommendations accepts optional itemsToProcess parameter
  - Batch forecast job passes only dirty items (prevents processing entire catalog)
  - Maintains backward compatibility (defaults to all items if not specified)

**November 23, 2025 - Inventory Movement & Transaction Tracking System**:
- ✅ **Complete Audit Trail**: All inventory quantity changes now tracked via InventoryTransaction table
  - Transaction types: TRANSFER, ADJUST, PRODUCE, RECEIVE, SHIP (TRANSFER splits into TRANSFER_IN/TRANSFER_OUT)
  - Captures: itemId, itemType, type, location, quantity, notes, createdAt, createdBy
- ✅ **TransactionService**: Centralized transaction logic with validation and automatic quantity updates
  - Enforces finished products use ONLY hildaleQty/pivotQty (never currentStock)
  - Components use currentStock as single source of truth
  - ItemType normalization handles both "finished_product"/"component" and "FINISHED"/"RAW" formats
- ✅ **Transaction API Endpoints**: RESTful endpoints for all movement operations
  - POST /api/transactions - Create generic transaction
  - GET /api/transactions/:itemId - Retrieve transaction history
  - POST /api/transactions/transfer - Transfer between Hildale and Pivot locations
  - POST /api/transactions/produce - Consume raw materials, produce finished products at Hildale
- ✅ **Transaction UI Components**: Three dialog components for inventory operations
  - TransferDialog: Move finished products between Hildale ↔ Pivot with validation
  - ProductionDialog: Shows BOM requirements, validates stock availability, consumes components
  - TransactionHistoryDialog: Complete audit trail with icons, colors, and date formatting
- ✅ **Products Page Integration**: Action buttons for Transfer, Produce, and History on finished products
- ✅ **Barcodes Page Refactoring**: Scan adjustments now use transaction system (type: ADJUST) instead of direct PATCH
- ✅ **Critical Bug Fix**: ItemType normalization in TransactionService prevents finished products from incorrectly updating currentStock

**November 22, 2025 - Production-Ready LLM Reorder Recommendations**:
- ✅ **LLM Reasoning Implementation**: Replaced formula-based reorder recommendations with actual LLM reasoning
  - Multi-period analysis: 30-day, 90-day, and historical sales data with seasonal context
  - Comprehensive prompts include current date, stock levels, usage rates, supplier info, and 4-week projections
  - Structured JSON responses with robust error handling and fallback to heuristics
- ✅ **All Provider Stubs Functional**: ChatGPT, Claude, Grok, and Custom endpoint stubs return structured recommendations
- ✅ **Custom Provider Support**: Custom LLM providers work without API keys when custom endpoint is configured
- ✅ **Empty String Normalization**: Storage-layer normalization converts empty strings to null, preventing stale "" values
  - Implemented in both MemStorage and PostgresStorage `updateSettings()` methods
  - Defense-in-depth: Also normalized in PATCH /api/settings route handler
- ✅ **Updated Urgency Thresholds**: Critical <14 days (was <7), High 14-21 days (was 7-14), Medium 21-45 days (was 14-30)
- ✅ **Zero-Quantity Validation**: Fixed handling of items with zero currentStock to prevent division by zero

**November 21, 2025 - End-to-End Testing & Fixes**:
- ✅ **Settings API Fixed**: GET/PATCH /api/settings now use req.session.userId instead of hardcoded ID
- ✅ **Settings Upsert**: updateSettings() now creates settings row on first save (prevents foreign key errors)
- ✅ **Dashboard LLM Integration**: Generate Forecast button wired to /api/llm/ask endpoint with validation
- ✅ **Integration Sync**: All 3 sync endpoints (GoHighLevel, Extensiv, PhantomBuster) tested and working
- ✅ **Integration Health**: Dashboard displays real-time status, lastSync, and errors for all integrations
- ✅ **Cross-Page Integration**: Settings saved on Settings page correctly appear on Dashboard
- ✅ **End-to-End Testing**: All features tested via curl with real database and authenticated sessions

**Previous Changes (November 21, 2025)**:
- ✅ Implemented session-based authentication with PostgreSQL session store (connect-pg-simple)
- ✅ Protected 35 business API routes with requireAuth middleware (90% coverage)
- ✅ Created Zod partial validation schemas for all PATCH endpoints
- ✅ Made database seeding fully idempotent with existence checks
- ✅ Fixed LSP errors in storage layer (finishedInventorySnapshot table reference)

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **State Management**: TanStack Query (React Query) for server state
- **UI Components**: Radix UI primitives with shadcn/ui customization
- **Styling**: Tailwind CSS with Carbon Design System influence
- **Build Tool**: Vite

**Design System**:
- IBM Plex Sans for typography (loaded via Google Fonts)
- Carbon Design System patterns for data-intensive interfaces
- Custom theme supporting light/dark modes
- Responsive layouts optimized for desktop and tablets with barcode scanner support

**Key Pages**:
1. **Dashboard** (`/`) - Operational overview with KPIs, forecasting, at-risk items, production capacity, and integration health
2. **Products** (`/products`) - Product catalog and BOM builder for defining component relationships
3. **Barcodes** (`/barcodes`) - Barcode management for items and bins with generation and printing capabilities
4. **Settings** (`/settings`) - User authentication, API key management, and LLM configuration

### Backend Architecture

**Framework**: Node.js with Express
- **Language**: TypeScript with ES modules
- **Database ORM**: Drizzle ORM
- **Session Management**: connect-pg-simple (PostgreSQL session store)
- **Authentication**: bcrypt for password hashing
- **API Design**: RESTful endpoints under `/api/*`

**Development vs Production**:
- **Dev Mode**: Vite middleware for HMR and development server
- **Production**: Pre-built static assets served via Express

**Core Services**:
1. **LLMService** - Pluggable AI integration supporting ChatGPT, Claude, Grok, and custom endpoints for forecasting, supplier ranking, and order recommendations
2. **BarcodeService** - Barcode generation (stubbed for bwip-js integration)
3. **Storage Layer** - Abstracted data access interface for all database operations

### Data Architecture

**Database**: PostgreSQL (via Neon serverless driver)
- **Migration Tool**: Drizzle Kit
- **Schema Location**: `shared/schema.ts`

**Core Entities**:
1. **Users** - Authentication with email/password
2. **Items** - Components and finished products with SKU, stock levels, and usage tracking
3. **Bins** - Storage location management with barcode support
4. **InventoryByBin** - Junction table tracking item quantities per bin
5. **BillOfMaterials** - Defines component requirements for finished products
6. **Suppliers** - Vendor information with ordering URLs
7. **SupplierItems** - Maps items to supplier catalogs with pricing
8. **SalesHistory** - Transaction records for demand forecasting
9. **FinishedInventorySnapshot** - External warehouse stock levels (Extensiv/Pivot integration)
10. **IntegrationHealth** - Status monitoring for external services
11. **Settings** - User preferences and API configurations
12. **Barcodes** - Barcode registry for items and bins

**Key Relationships**:
- Products → BOM → Components (many-to-many with quantities)
- Items → InventoryByBin → Bins (many-to-many with stock levels)
- Items → SupplierItems → Suppliers (many-to-many with pricing)

### Forecasting & Analytics

**Constraint-based Planning**:
- Calculate "days until stockout" based on current stock and daily usage
- Identify bottleneck components limiting production capacity
- Surface at-risk items requiring immediate action

**Production Capacity**:
- Use BOM to determine maximum finished products producible
- Account for component constraints across multiple product lines

## External Dependencies

### Third-Party UI Libraries
- **Radix UI**: Accessible component primitives (dialogs, dropdowns, tooltips, etc.)
- **shadcn/ui**: Pre-built component patterns built on Radix
- **Lucide React**: Icon system
- **Tailwind CSS**: Utility-first styling framework

### Data & State Management
- **TanStack Query**: Server state synchronization and caching
- **React Hook Form**: Form state management with Zod validation
- **Drizzle ORM**: Type-safe database queries and migrations

### External Service Integrations (Planned)
1. **GoHighLevel** - CRM/marketing automation (API key stored in settings)
2. **Shopify** - E-commerce platform integration (optional)
3. **Extensiv/Pivot** - 3PL warehouse management for finished goods inventory
4. **PhantomBuster** - Web scraping/automation tool

### LLM Providers (Configurable)
- **OpenAI (ChatGPT)** - Default AI provider for forecasting
- **Anthropic (Claude)** - Alternative LLM option
- **Grok** - X.AI's language model
- **Custom Endpoint** - Bring-your-own-model support

### Development Tools
- **Vite Plugins**: Runtime error overlay, Replit-specific tooling (cartographer, dev banner)
- **TypeScript**: Type safety across frontend and backend
- **ESBuild**: Production bundling for server code

### Barcode Hardware Support
- USB/Bluetooth barcode scanners in HID keyboard mode (simulates keyboard input)
- Optimized for desktop and tablet form factors

### Database Provider
- **Neon**: Serverless PostgreSQL with connection pooling
- Environment variable: `DATABASE_URL`