# CLAUDE.md — SBR Inventory App Context

> This file provides full context for AI agents (Claude Code, Haiku, etc.) working on this codebase.
> Read this BEFORE making any changes. It describes how every piece connects.

## What This App Is

SBR Inventory is the internal operations system for **Sticker Burr Roller** (SBR), a company that manufactures and sells outdoor/lawn products. This app replaces Katana MRP entirely. It manages inventory, purchase orders, sales orders, returns, production tracking, and integrates with Shopify, Extensiv (3PL warehouse), GoHighLevel (CRM), QuickBooks, and Shippo (shipping).

**Deployed on:** Railway (https://sbr-app-production.up.railway.app)
**Repo:** GitHub → Gib-Inc/SBR-App

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL (Railway-hosted, via Drizzle ORM) |
| Auth | Session-based (express-session) |
| API Client | TanStack React Query |
| Schema | Drizzle ORM (shared/schema.ts is the single source of truth) |

## Project Structure

```
SBR-App/
├── shared/
│   └── schema.ts              # ALL database tables + types (Drizzle ORM)
├── server/
│   ├── routes.ts              # ALL API endpoints (~20k lines)
│   ├── storage.ts             # IStorage interface + MemStorage + PostgresStorage
│   ├── transaction-service.ts # Production, inventory transactions
│   ├── import-service.ts      # CSV/XLSX import with upsert logic
│   ├── services/
│   │   ├── inventory-movement.ts    # CENTRALIZED inventory change handler
│   │   ├── extensiv-client.ts       # Extensiv API client (OAuth2)
│   │   ├── extensiv-inventory-sync-service.ts  # Extensiv → app sync
│   │   ├── shopify-client.ts        # Shopify API client
│   │   ├── shopify-inventory-sync-service.ts
│   │   ├── gohighlevel-client.ts    # GHL CRM integration
│   │   ├── audit-logger.ts          # Centralized audit trail
│   │   ├── log-service.ts           # AI agent logging
│   │   ├── llm.ts                   # LLM integration for AI recommendations
│   │   ├── backorder-service.ts     # Auto-fulfill backorders
│   │   └── po-state-machine.ts      # PO lifecycle states
│   └── shopify/
│       ├── webhook-handlers.ts      # Shopify webhook processing
│       └── webhooks-config.ts       # Webhook registration
├── client/src/
│   ├── pages/                 # React page components
│   ├── components/            # Reusable UI components
│   ├── hooks/                 # Custom React hooks
│   └── lib/                   # Auth, query client, utils
├── extensiv-sync.js           # Standalone cron script for Extensiv sync
├── migration_add_extensiv_columns.sql  # One-time DB migration
└── extensiv_clean_stock.csv   # Manual import data (March 2026 snapshot)
```

## Critical Architecture Rules

### Inventory Movement System (MOST IMPORTANT)

**ALL inventory changes MUST go through `InventoryMovement.apply()`** in `server/services/inventory-movement.ts`. This is the single gateway for stock changes. It handles the math, updates the correct fields, and logs an audit trail.

**Key invariants:**

1. **`pivotQty` is READ-ONLY from Extensiv** — only `EXTENSIV_SYNC` events can change it
2. **`availableForSaleQty`** is the working sellable quantity for finished products — decremented by sales, restored by cancellations
3. **`hildaleQty`** is buffer/production stock — only changed by production, transfers, and manual adjustments
4. **`currentStock`** is for raw materials/components only — changed by PO receipts, BOM consumption, and manual counts
5. **Finished products** use `hildaleQty` + `availableForSaleQty` as on-hand; they do NOT use `currentStock`
6. **Components** use `currentStock` only

**Event types and what they affect:**

| Event | Finished Products | Components |
|-------|------------------|------------|
| SALES_ORDER_CREATED | ↓ availableForSaleQty | — |
| SALES_ORDER_CANCELLED | ↑ availableForSaleQty | — |
| PURCHASE_ORDER_RECEIVED | NO-OP (warning logged) | ↑ currentStock |
| RETURN_RECEIVED | ↑ hildaleQty | ↑ currentStock |
| PRODUCTION_COMPLETED | ↑ hildaleQty | — |
| BOM_CONSUMPTION | — | ↓ currentStock |
| MANUAL_COUNT | ± hildaleQty or availableForSaleQty | ± currentStock |
| EXTENSIV_SYNC | Updates pivotQty + reconciles availableForSaleQty | — |
| TRANSFER (Hildale→Pivot) | ↓ hildaleQty, ↑ availableForSaleQty | — |

### Database Schema (shared/schema.ts)

This is the **single source of truth** for all table definitions. Key tables:

- **`items`** — Products and raw materials. Has `type` field: `'finished_product'` or `'component'`
- **`billOfMaterials`** — BOM recipes linking finished products to components
- **`suppliers`** / **`supplierItems`** — Supplier info and item-supplier links
- **`purchaseOrders`** / **`purchaseOrderLines`** — PO tracking with line items
- **`salesOrders`** — Synced from Shopify via webhooks
- **`returns`** — Customer return processing
- **`inventoryTransactions`** — Legacy transaction log
- **`inventoryAdjustments`** — Manual count records (Sammie/Clarence weekly counts)
- **`auditLogs`** — Centralized audit trail for all events
- **`integrationConfigs`** — Per-integration API credentials and settings
- **`settings`** — App-wide configuration

### Storage Layer (server/storage.ts)

- **`IStorage` interface** defines all data access methods
- **`MemStorage`** — in-memory implementation (dev/testing)
- **`PostgresStorage`** — production implementation using Drizzle ORM
- Always add methods to BOTH implementations when modifying

### Routing (server/routes.ts)

Single monolithic file with all API endpoints. ~20,000 lines. Key sections:
- Auth routes: `/api/auth/*`
- Items/Products: `/api/items/*`, `/api/products/*`
- Import: `/api/import/*`
- Purchase Orders: `/api/purchase-orders/*`
- Sales Orders: `/api/sales-orders/*`
- Returns: `/api/returns/*`
- Inventory Adjustments: `/api/inventory-adjustments/*`
- AI Agent: `/api/ai/*`
- Webhooks: handled in `server/shopify/webhook-handlers.ts`
- GHL Agent API: `server/routes/ghl-agent-api.ts`

## Shopify Integration

- Webhooks fire on: `orders/create`, `orders/paid`, `orders/fulfilled`, `orders/cancelled`, `orders/partially_fulfilled`, `refunds/create`
- `orders/fulfilled` triggers **BOM subtraction** — automatically subtracts raw materials from component inventory based on the BOM
- `orders/create` creates a SalesOrder record and decrements `availableForSaleQty`
- Shopify SKU matching: tries `shopifySku` first, then falls back to house `sku`

## Extensiv Integration (3PL Warehouse)

Two sync paths exist:

1. **In-app sync service** (`server/services/extensiv-inventory-sync-service.ts`) — triggered via the app's UI or scheduler
2. **Standalone cron script** (`extensiv-sync.js`) — runs as a Railway cron job independently of the app

Both update `pivot_qty`, `extensiv_on_hand_snapshot`, and `extensiv_last_sync_at` on matched items.

Matching logic: `extensiv_sku` column → fallback to house `sku`

## People and Roles

| Person | Role | What they do in the app |
|--------|------|------------------------|
| **Clarence** | Production / Warehouse | Logs production builds, counts raw materials weekly |
| **Sammie** | Operations / Inventory | Counts finished goods weekly, manages CSV imports |
| **Matt** | Operations Lead | Oversees all operations, manages app configuration |
| **Charles** | Developer | Builds features, deploys to Railway |
| **Zo** | Admin | Manages Extensiv account and API credentials |

## Common Patterns

### Adding a new feature:
1. Add table to `shared/schema.ts`
2. Add storage methods to `IStorage` interface + both implementations in `server/storage.ts`
3. Add API routes to `server/routes.ts`
4. Add frontend page/component in `client/src/`
5. If it changes inventory → use `InventoryMovement.apply()` with appropriate event type

### Adding a new integration:
1. Create client in `server/services/{name}-client.ts`
2. Add integration config to `integrationConfigs` table
3. Add health check to `integration-health-service.ts`
4. Add audit event types to `server/services/audit-logger.ts`

### Import/CSV flow:
- `ImportService` in `server/import-service.ts` handles parsing and validation
- Uses application-level upsert (findMatchingItem → create or update)
- Column mapping is auto-suggested then user-confirmed

## Environment Variables

Required for production:
- `DATABASE_URL` — PostgreSQL connection string (auto-set by Railway)
- `SESSION_SECRET` — Express session secret
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_STORE_URL` — Shopify integration
- `EXTENSIV_CLIENT_ID`, `EXTENSIV_CLIENT_SECRET`, `EXTENSIV_USER_LOGIN` — Extensiv API
- `GHL_API_KEY`, `GHL_LOCATION_ID` — GoHighLevel CRM
- `ANTHROPIC_API_KEY` — AI agent recommendations

## Known Issues / Technical Debt

1. `routes.ts` is ~20k lines — should be split into route modules
2. Some finished products have duplicate entries with `#` prefix SKUs — need cleanup
3. Extensiv SKU mapping (`extensiv_sku` column) needs to be populated on all items
4. BOM entries need to be filled in by Clarence for all finished products
5. GHL connector in Settings is not yet configured

## Testing Changes

- Run locally: `npm run dev`
- Database push: `npm run db:push` (applies schema changes)
- Extensiv sync test: `node extensiv-sync.js` (requires env vars)
- The app uses Drizzle ORM — schema changes in `shared/schema.ts` are applied via `drizzle-kit push`
