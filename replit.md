# Manufacturing Inventory Management System

## Overview

This is a production-ready full-stack inventory management web application designed for manufacturing companies. The system tracks component inventory (nuts, bolts, springs, bars), finished products, and integrates with external services for order management and fulfillment. It features barcode scanning capabilities, bill of materials (BOM) management, LLM-powered forecasting, and real-time inventory tracking.

**Core Purpose**: Enable manufacturing operations to manage inventory levels, predict stockouts, track production capacity, and automate ordering processes with AI-assisted recommendations.

## Recent Changes

**November 21, 2025**:
- ✅ Implemented session-based authentication with PostgreSQL session store (connect-pg-simple)
- ✅ Protected 35 business API routes with requireAuth middleware (90% coverage)
- ✅ Created Zod partial validation schemas for all PATCH endpoints
- ✅ Made database seeding fully idempotent with existence checks
- ✅ Fixed LSP errors in storage layer (finishedInventorySnapshot table reference)
- 🔜 Integration webhooks protected with requireAuth (should use HMAC signatures in production)

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