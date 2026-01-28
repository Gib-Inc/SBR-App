# Manufacturing Inventory Management System

## Overview

This project is a full-stack inventory management web application for manufacturing companies. It tracks component and finished product inventory, integrates with external services for order management, and features barcode scanning, Bill of Materials (BOM) management, and LLM-powered forecasting. The system aims to streamline inventory operations, predict stockouts, monitor production capacity, and automate ordering with AI-assisted recommendations, ultimately enhancing efficiency and reducing operational costs for manufacturing businesses.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

*   **Frameworks**: React with TypeScript, Wouter, TanStack Query.
*   **UI/UX**: Radix UI primitives, shadcn/ui, Tailwind CSS, inspired by Carbon Design System. IBM Plex Sans typography, light/dark mode, responsive layouts.
*   **Key Pages**: Dashboard, Products, Barcodes, Settings.

### Backend

*   **Framework**: Node.js with Express and TypeScript.
*   **Database ORM**: Drizzle ORM.
*   **Authentication**: Session-based.
*   **API**: RESTful endpoints.
*   **Core Services**: LLMService, BarcodeService, ShopifyClient, AmazonClient, ExtensivClient, GoHighLevelClient, QuickBooksClient, PhantomBusterClient, Storage Layer.

### Data Architecture

*   **Database**: PostgreSQL (Neon serverless driver), Drizzle Kit for migrations.
*   **Core Entities**: Users, Items, Bins, Inventory, BOMs, Suppliers, Sales & Purchase Orders, Integration configurations, System Logs, Returns.

### Features & Design Decisions

*   **Inventory Tracking**: Dual-warehouse model (`hildaleQty` for production, `pivotQty` for 3PL sellable stock) with strict data source ownership rules to prevent data inconsistencies. `availableForSaleQty` is the working sellable field, derived from `pivotQty` or Shopify sync. All movements are tracked via `InventoryTransaction`.
*   **Forecasting & Planning**: Constraint-based stockout prediction and production capacity planning. LLM-powered multi-period forecasting for reorder recommendations.
*   **AI Batch Recommendation System**: Scheduled batch processing for LLM-powered inventory recommendations, detecting critical stock levels and determining optimal order timing. Includes deterministic fallback for LLM unavailability.
*   **Order Management**: Multi-channel order synchronization (Shopify, Amazon) with duplicate prevention and SKU mapping.
*   **Purchase Order (PO) System**: LLM-powered PO creation wizard, state machine for PO lifecycle management, detailed receipt tracking, supplier acknowledgment, and auto-suggestion of purchase costs.
*   **Returns Management**: Comprehensive return lifecycle with RMA generation, Shippo integration for labels, GoHighLevel integration for refund opportunities, and QuickBooks Credit Memo creation.
*   **GHL AI Agent Custom Actions**: API endpoints for GoHighLevel to initiate returns, create labels, and manage tasks, with built-in eligibility rules, error handling, and GHL opportunity creation.
*   **GHL Agent API**: External API providing authenticated access for GoHighLevel agents to inventory reorder status, order lookup, refund calculations, return initiation, PO creation, and task creation.
*   **Daily Sales Snapshots**: Aggregated daily sales data with trend metrics and rolling averages for LLM analysis.
*   **Integrations**: Configurable per-user AI Agent Rules for automation. Sync mode confirmation modals for GHL, Amazon, Extensiv, and QuickBooks with "safe" vs. "align" options. Includes Shopify/Amazon two-way inventory sync, Extensiv 3PL integration, GoHighLevel CRM integration, and webhooks for real-time updates (Shopify, SendGrid).
*   **Commerce Attribution Sync**: Tracks customer purchase sources (Amazon/Shopify) and syncs attribution data (first/latest source, purchase count, lifetime value) to GoHighLevel custom fields and tags.
*   **SKU Mapping Wizard**: Centralized interface for mapping internal SKUs to external platform SKUs.
*   **QuickBooks Automatic Token Refresh**: Proactive token refresh with GHL "Needs Attention" opportunity creation on failure, ensuring continuous operation.
*   **System of Record**: This application serves as the primary system of record for inventory quantities.
*   **Production Security**: Enforces single-user mode, disables new user registration, implements login rate limiting, and provides secure admin endpoints.
*   **Intuit Compliance Security**: AES-256-GCM token encryption, strict caching headers (`no-cache, no-store`), secure cookies (always `Secure`/`HttpOnly`), sanitized OAuth redirects (pure 302, no HTML body), and logging redaction for all sensitive data.

## Pre-Production Checklist

Before publishing to production, the following secrets must be configured:

| Secret | Description | How to Generate |
|--------|-------------|-----------------|
| `QB_ENCRYPTION_KEY` | 64-char hex key for QuickBooks token encryption (Intuit compliance) | `openssl rand -hex 32` |

**Note**: The app will refuse to start in production without `QB_ENCRYPTION_KEY`. This is required for Intuit app submission compliance.

## External Dependencies

*   **UI Libraries**: Radix UI, shadcn/ui, Lucide React, Tailwind CSS.
*   **Data & State Management**: TanStack Query, React Hook Form, Drizzle ORM.
*   **External Service Integrations**: GoHighLevel (CRM), Shopify (e-commerce), Amazon (e-commerce), Extensiv/Pivot (3PL warehouse management), PhantomBuster (web scraping), Shippo (shipping labels), SendGrid (email).
*   **LLM Providers**: OpenAI (ChatGPT), Anthropic (Claude), Grok, Custom Endpoint support.
*   **Database Provider**: Neon (Serverless PostgreSQL).
*   **Hardware Support**: USB/Bluetooth barcode scanners.